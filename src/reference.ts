import type { Page } from "playwright-core";
import * as path from "node:path";
import { FlowError } from "./types.js";

/**
 * IMÁGENES DE REFERENCIA
 *
 * Flow no acepta un archivo directamente en el compositor: primero sube a la
 * biblioteca del proyecto y después se elige desde ahí. Son dos pasos y hay que
 * hacer los dos.
 *
 *   1. subir   -> POST v1/flow/uploadImage, devuelve el mediaId
 *   2. adjuntar-> abrir el selector junto al compositor y elegir por nombre
 *
 * La subida se hace escribiendo el archivo en el <input type="file"> que Flow ya
 * tiene oculto en el DOM. No hace falta simular un arrastre ni abrir el diálogo
 * del sistema operativo, que sería imposible de automatizar.
 */

const UPLOAD_ENDPOINT = "v1/flow/uploadImage";

/** Sube un archivo local a la biblioteca del proyecto y devuelve su mediaId. */
export async function uploadImage(page: Page, filePath: string): Promise<{ mediaId: string; fileName: string }> {
  const fileName = path.basename(filePath);

  const esperando = page.waitForResponse((r) => r.url().includes(UPLOAD_ENDPOINT) && r.request().method() === "POST", {
    timeout: 120_000,
  });

  const input = await page.$('input[type="file"]');
  if (!input) {
    throw new FlowError(
      "No encontré el campo de subida de archivos en la página de Flow.",
      "Confirmá que hay un proyecto abierto. Si la interfaz cambió, abrí un issue.",
    );
  }
  await input.setInputFiles(filePath);

  let res;
  try {
    res = await esperando;
  } catch {
    throw new FlowError(`Subí ${fileName} pero Flow no confirmó la carga.`, "Revisá la ventana del navegador.");
  }
  if (!res.ok()) {
    throw new FlowError(`Flow devolvió ${res.status()} al subir ${fileName}.`);
  }

  const cuerpo = (await res.json().catch(() => null)) as { media?: { name?: string } } | null;
  const mediaId = cuerpo?.media?.name;
  if (!mediaId) {
    throw new FlowError(`Flow aceptó ${fileName} pero no devolvió un identificador de medio.`);
  }
  return { mediaId, fileName };
}

/** Los eventos sintéticos no los levanta React; hace falta puntero real. */
async function clickAt(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.waitForTimeout(80);
  await page.mouse.click(x, y);
}

/** ¿Quedó alguna imagen adjunta al compositor? */
function composerHasImage(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const comp = [...document.querySelectorAll('[contenteditable="true"]')]
      .filter((e) => (e as HTMLElement).offsetParent)
      .pop();
    let z: HTMLElement | null = comp as HTMLElement | null;
    for (let i = 0; i < 6 && z; i++) {
      if (z.querySelectorAll("img").length > 0) return true;
      z = z.parentElement;
    }
    return false;
  });
}

/**
 * Confirma la selección del selector de biblioteca.
 *
 * Elegir la fila sólo la marca y muestra una vista previa; recién el botón del
 * pie del diálogo la adjunta al compositor. Sin ese segundo paso el clic parece
 * haber funcionado y no adjuntó nada.
 *
 * Encontrarlo tiene dos trampas. No tiene atributo estable —las clases son hashes
 * de styled-components, sin aria-label ni testid— y su texto está en el idioma de
 * la cuenta, así que buscar por texto ata el conector a un idioma. Y en el pie del
 * diálogo también vive el botón de subir archivos, así que "el de más abajo" agarra
 * ese: el clic se va a otro lado y el fallo aparece recién al verificar.
 *
 * Lo que los separa limpio es el ancho. El de confirmar ocupa todo el panel de
 * vista previa; el de subir es un control chico de la barra lateral. Se toma el
 * más ancho del tercio inferior, que no depende del idioma ni de qué lado se
 * dibuje cada cosa.
 *
 * Devuelve false si no hay ninguno, que es lo correcto si alguna variante de la
 * interfaz adjunta directamente al hacer clic en la fila.
 */
async function confirmPicker(page: Page): Promise<boolean> {
  const boton = await page.evaluate(() => {
    const dlg = document.querySelector("[role=dialog][data-state=open]");
    if (!dlg) return null;
    const caja = dlg.getBoundingClientRect();
    const cands = [...dlg.querySelectorAll("button")]
      .filter((b) => {
        if (!(b as HTMLElement).offsetParent) return false;
        const r = b.getBoundingClientRect();
        if (r.width < 160 || r.height < 20) return false;
        return r.y + r.height / 2 > caja.y + caja.height * 0.66;
      })
      .map((b) => {
        const r = b.getBoundingClientRect();
        return { ancho: r.width, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      })
      .sort((a, b) => b.ancho - a.ancho);
    return cands[0] ?? null;
  });
  if (!boton) return false;
  await clickAt(page, boton.cx, boton.cy);
  await page.waitForTimeout(2_000);
  return true;
}

/** Cierra el selector si quedó abierto de un intento anterior. */
async function closePicker(page: Page): Promise<void> {
  const abierto = await page.evaluate(() => !!document.querySelector('[role=dialog][data-state=open]'));
  if (!abierto) return;
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
}

/**
 * Adjunta al compositor una imagen que ya está en la biblioteca, buscándola por
 * el nombre de archivo con el que se subió.
 */
export async function attachReference(page: Page, fileName: string): Promise<void> {
  // Un diálogo abierto de un intento previo haría que el clic siguiente lo
  // cierre en vez de abrirlo, y el fallo se atribuiría a la búsqueda.
  await closePicker(page);

  const abrir = await page.evaluate(() => {
    const els = [...document.querySelectorAll("button,[role=button]")].filter((e) => (e as HTMLElement).offsetParent);
    const hit = els.find((e) => /^add_2\b/.test(((e as HTMLElement).innerText || "").trim()));
    if (!hit) return null;
    const r = hit.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });
  if (!abrir) {
    throw new FlowError("No encontré el control para adjuntar medios junto al compositor.");
  }
  await clickAt(page, abrir.cx, abrir.cy);

  // La biblioteca se puebla por red. Una espera fija falla justo cuando el
  // proyecto tiene muchos medios, que es cuando más se la necesita: hay que
  // esperar al elemento, no a un reloj.
  const buscar = () =>
    page.evaluate((n) => {
      // Varios elementos anidados contienen el mismo texto: la fila entera, un
      // envoltorio interno y la etiqueta suelta. Hay que clickear la FILA; la
      // etiqueta no tiene manejador y el clic se pierde en silencio, que es el
      // peor modo de fallar porque parece que anduvo.
      //
      // Entre filas repetidas —el mismo archivo subido dos veces— gana la de
      // más arriba, que es la más reciente.
      const cands = [...document.querySelectorAll("div,li,button")]
        .filter((el) => {
          if (!(el as HTMLElement).offsetParent) return false;
          if (!((el as HTMLElement).innerText || "").includes(n)) return false;
          const r = el.getBoundingClientRect();
          return r.height >= 28 && r.height <= 140 && r.width >= 80;
        })
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { area: r.width * r.height, y: r.y, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
        })
        .sort((a, b) => a.y - b.y || b.area - a.area);
      return cands[0] ?? null;
    }, fileName);

  let item = await buscar();
  for (let intento = 0; !item && intento < 15; intento++) {
    await page.waitForTimeout(1_000);
    item = await buscar();
  }

  if (!item) {
    await page.keyboard.press("Escape");
    throw new FlowError(
      `No encontré ${fileName} en el selector de la biblioteca.`,
      "Si recién lo subiste puede que Flow aún no lo haya indexado; si el nombre es de un archivo viejo, revisá que siga en el proyecto.",
    );
  }

  await clickAt(page, item.cx, item.cy);
  await page.waitForTimeout(1_500);

  // Elegir la fila sólo la marca: falta confirmar. Se chequea antes por si
  // alguna variante de la interfaz adjunta de una.
  if (!(await composerHasImage(page))) {
    await confirmPicker(page);
  }

  if (!(await composerHasImage(page))) {
    await closePicker(page);
    throw new FlowError(
      `Elegí ${fileName} en la biblioteca pero no quedó adjunto al compositor.`,
      "Puede que Flow haya cambiado el botón de confirmar del selector. Abrí un issue.",
    );
  }
}

/**
 * Deja el compositor sin referencias.
 *
 * Es obligatorio antes de cada generación: una referencia olvidada de un turno
 * anterior cambia la imagen sin que nada lo indique, y el resultado se atribuye
 * al prompt. Recargar es tosco pero es lo único que garantiza el estado limpio
 * sin depender de encontrar el botón de quitar, que no siempre está.
 */
export async function clearReferences(page: Page): Promise<void> {
  const hay = await page.evaluate(() => {
    const comp = [...document.querySelectorAll('[contenteditable="true"]')]
      .filter((e) => (e as HTMLElement).offsetParent)
      .pop();
    let z: HTMLElement | null = comp as HTMLElement | null;
    for (let i = 0; i < 6 && z; i++) {
      if (z.querySelectorAll("img").length > 0) return true;
      z = z.parentElement;
    }
    return false;
  });
  if (!hay) return;

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('[contenteditable="true"]', { timeout: 60_000 });
  await page.waitForTimeout(1_500);
}
