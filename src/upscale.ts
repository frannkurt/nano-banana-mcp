import type { Download, Page } from "playwright-core";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FlowError } from "./types.js";
import { clickAt } from "./ui.js";
import { sniffImage } from "./download.js";
import { M } from "./i18n.js";

/**
 * ESCALADO
 *
 * Nano Banana entrega 1024x1024 en cuadrado y 1376x768 en apaisado, y ahí se
 * termina el detalle real. Flow tiene además un escalador propio que reconstruye
 * la imagen a 2K o 4K, y es lo único que sube el detalle de verdad: pedirle a
 * sharp que agrande el nativo sólo interpola.
 *
 * Por qué esto pasa por la interfaz y no por la API, igual que la generación: el
 * RPC de escalado va firmado con un token de reCAPTCHA Enterprise que acuña el
 * JavaScript de la página. No es replicable desde Node, así que el escalado se
 * pide como lo pide una persona: menú contextual sobre la baldosa → Descargar →
 * "2K".
 *
 * NOTA DE MIGRACIÓN (Flow → flow.google.com, frontend Angular): antes el
 * resultado se leía de la respuesta de `flow/upsampleImage`, que traía el id de
 * un medio nuevo. Ahora todo va por el RPC ofuscado `batchexecute`, y lo que la
 * interfaz hace con el resultado es DESCARGARLO como archivo (un blob:). Así que
 * el resultado se toma de esa descarga, con el evento `download` de Playwright:
 * los bytes llegan enteros y ya escalados, sin volver a pedirle nada al CDN.
 *
 * Anclajes, con el mismo criterio que el resto del conector: el atributo
 * `data-media-id` de la miniatura (respaldo: el id en el `src`), el ligature
 * `download` de Material Symbols para la entrada del menú, y las etiquetas
 * numéricas "2K" y "4K" del submenú. Ninguna se traduce.
 */

export const UPSCALE_TARGETS = { "2k": "2K", "4k": "4K" } as const;
export type UpscaleTarget = keyof typeof UPSCALE_TARGETS;

/** El ligature de la entrada "Descargar" del menú contextual. */
const DOWNLOAD_LIGATURE = /^download\b/;

interface MenuHit {
  text: string;
  cx: number;
  cy: number;
  disabled: boolean;
}

async function visibleMenuItems(page: Page): Promise<MenuHit[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[role="menuitem"]')]
      .filter((el) => (el as HTMLElement).offsetParent)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          text: ((el as HTMLElement).innerText || "").trim().replace(/\s+/g, " "),
          cx: r.x + r.width / 2,
          cy: r.y + r.height / 2,
          // Flow marca así las opciones que exigen un plan pago — hoy, la de 4K.
          disabled:
            el.getAttribute("aria-disabled") === "true" ||
            el.hasAttribute("data-disabled") ||
            (el as HTMLButtonElement).disabled === true,
        };
      }),
  );
}

/**
 * Deja la baldosa de ese medio visible y devuelve su centro.
 *
 * El ancla es `data-media-id` en la miniatura; la UI nueva sirve el `src` por un
 * proxy (`/asb/…`) que no lleva el id, así que el atributo es lo único que
 * identifica a la imagen sin depender del árbol ni del idioma. Se conserva el
 * respaldo por `src` para la UI vieja.
 */
async function focusTile(page: Page, mediaId: string): Promise<{ cx: number; cy: number }> {
  const buscar = (id: string) =>
    page.evaluate((mid) => {
      const img =
        (document.querySelector(`img[data-media-id="${mid}"]`) as HTMLImageElement | null) ??
        [...document.querySelectorAll("img")].find((i) => i.src.includes(mid)) ??
        null;
      if (!img) return false;
      img.scrollIntoView({ block: "center", inline: "center" });
      return true;
    }, id);

  let visto = await buscar(mediaId);

  // El tablero monta las baldosas a medida que se ven: una imagen vieja, con
  // decenas de generaciones más nuevas encima, sencillamente no existe todavía
  // en el DOM. Bajamos el contenedor de a una pantalla hasta que aparezca o
  // hasta que deje de haber más para bajar.
  for (let paso = 0; !visto && paso < 40; paso++) {
    const avanzo = await page.evaluate(() => {
      const desplazables = [...document.querySelectorAll<HTMLElement>("*")].filter((el) => {
        const s = getComputedStyle(el);
        return (
          el.scrollHeight > el.clientHeight + 40 &&
          /auto|scroll/.test(s.overflowY) &&
          el.clientHeight > 200
        );
      });
      // El más alto es el del tablero; los popovers y barras laterales son chicos.
      const caja = desplazables.sort((a, b) => b.clientHeight - a.clientHeight)[0];
      const antes = caja ? caja.scrollTop : window.scrollY;
      if (caja) caja.scrollBy(0, caja.clientHeight * 0.9);
      else window.scrollBy(0, window.innerHeight * 0.9);
      const despues = caja ? caja.scrollTop : window.scrollY;
      return despues > antes;
    });

    await page.waitForTimeout(500);
    visto = await buscar(mediaId);

    // Tocamos fondo y la baldosa no está: seguir bajando no la va a traer.
    if (!visto && !avanzo) break;
  }

  if (!visto) {
    throw new FlowError(M.tileNotFound(mediaId), M.tileNotFoundHint());
  }

  // El desplazamiento es animado: medir antes de que termine da una caja vieja.
  await page.waitForTimeout(700);

  const rect = await page.evaluate((mid) => {
    const img =
      (document.querySelector(`img[data-media-id="${mid}"]`) as HTMLImageElement | null) ??
      [...document.querySelectorAll("img")].find((i) => i.src.includes(mid)) ??
      null;
    if (!img) return null;
    const r = img.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return null;
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  }, mediaId);

  if (!rect) {
    throw new FlowError(M.tileNotFound(mediaId), M.tileNotFoundHint());
  }
  return rect;
}

/** Lee la descarga a memoria y borra el archivo temporal que deja Playwright. */
async function leerDescarga(d: Download, mediaId: string): Promise<Buffer> {
  const tmp = path.join(os.tmpdir(), `nano-banana-${mediaId}-${process.pid}-${Date.now()}.bin`);
  try {
    await d.saveAs(tmp);
    return await fs.readFile(tmp);
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}

export interface UpscaleOptions {
  target: UpscaleTarget;
  timeoutMs?: number;
}

/**
 * Escala una imagen ya generada y devuelve los bytes escalados.
 *
 * Los bytes salen de la descarga que dispara la propia interfaz, así que quien
 * llama los guarda con `writeImage` igual que cualquier otro medio. Exige la
 * pestaña en primer plano: Chrome congela la interfaz de las pestañas tapadas.
 */
export async function upscaleImage(page: Page, mediaId: string, opts: UpscaleOptions): Promise<Buffer> {
  const etiqueta = UPSCALE_TARGETS[opts.target];
  const timeout = opts.timeoutMs ?? 180_000;

  await page.bringToFront();

  try {
    const tile = await focusTile(page, mediaId);

    await page.mouse.click(tile.cx, tile.cy, { button: "right" });
    await page.waitForTimeout(700);

    const menu = await visibleMenuItems(page);
    const descargar = menu.find((i) => DOWNLOAD_LIGATURE.test(i.text));
    if (!descargar) {
      throw new FlowError(M.noDownloadEntry(), M.visibleMenu(menu.map((i) => i.text).join(" / ")));
    }

    await clickAt(page, descargar.cx, descargar.cy);
    await page.waitForTimeout(900);

    const submenu = await visibleMenuItems(page);
    const opcion = submenu.find((i) => new RegExp(`^${etiqueta}\\b`).test(i.text));
    if (!opcion) {
      throw new FlowError(M.noUpscaleOption(etiqueta), M.visibleMenu(submenu.map((i) => i.text).join(" / ")));
    }
    if (opcion.disabled) {
      throw new FlowError(M.upscaleLocked(etiqueta), M.upscaleLockedHint(opcion.text));
    }

    // Nos suscribimos ANTES de hacer clic: la descarga puede llegar enseguida y
    // un oyente tardío se la perdería.
    const espera = page.waitForEvent("download", { timeout }).catch(() => null);
    await clickAt(page, opcion.cx, opcion.cy);

    const descarga = await espera;
    if (!descarga) {
      throw new FlowError(M.upscaleTimeout(Math.round(timeout / 1000)));
    }

    const bytes = await leerDescarga(descarga, mediaId);
    if (!sniffImage(bytes)) {
      throw new FlowError(M.upscaleNotImage(descarga.suggestedFilename(), bytes.length));
    }
    return bytes;
  } finally {
    // Un menú abierto se come el primer clic del turno siguiente.
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(200);
  }
}
