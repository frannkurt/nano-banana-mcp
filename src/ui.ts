import type { Page } from "playwright-core";
import { ASPECTS, FlowError, type Aspect } from "./types.js";
import { M } from "./i18n.js";

/**
 * MANEJO DE LA INTERFAZ
 *
 * Flow no expone una API pública, y la llamada interna de generación va firmada
 * con un token de reCAPTCHA Enterprise que acuña el JavaScript de la página. Eso
 * significa que la generación se pide como la pide una persona: escribiendo en el
 * compositor. Este módulo es la única parte del servidor que toca el DOM.
 *
 * Para que aguante, se ancla en cosas que no cambian con el idioma:
 *
 *   - los nombres de ligature de Material Symbols (`crop_16_9`, `image`,
 *     `arrow_forward`), que son identificadores de icono y se renderizan igual en
 *     cualquier locale;
 *   - las etiquetas numéricas ("16:9", "x2"), que tampoco se traducen.
 *
 * Nunca se busca copy traducible como "Aprobar" o "Crear".
 *
 * NOTA DE MIGRACIÓN (Flow → flow.google.com, frontend Angular):
 * la UI dejó de armar el panel de ajustes con [role="tab"] y ahora usa <button>
 * con el texto "<ligature> <etiqueta>" (p. ej. "image Imagen", "crop_9_16 9:16",
 * "x1"). El disparador del panel es un botón cuyo texto resume el estado actual e
 * incluye el ligature de recorte y la cantidad ("… crop_16_9 x2"). Este módulo
 * habla con esa UI y mantiene un respaldo para la vieja de [role="tab"].
 */

/** Los eventos sintéticos de .click() no los levanta el framework; usamos puntero real. */
export async function clickAt(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.waitForTimeout(80);
  await page.mouse.click(x, y);
}

interface Hit {
  text: string;
  cx: number;
  cy: number;
}

/**
 * Controles visibles con los que se maneja el panel: pestañas de la UI vieja y
 * botones de la nueva. Se devuelven con el texto normalizado y su centro.
 */
async function visibleControls(page: Page): Promise<Hit[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"], button, [role="button"]')]
      .filter((el) => (el as HTMLElement).offsetParent)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          text: ((el as HTMLElement).innerText || "").trim().replace(/\s+/g, " "),
          cx: r.x + r.width / 2,
          cy: r.y + r.height / 2,
        };
      }),
  );
}

/**
 * El panel está abierto cuando se ven a la vez las opciones de recorte (algún
 * control cuyo texto EMPIEZA con `crop_`) y las de cantidad (`x1`..`x9`). Vale
 * tanto para los botones nuevos como para las pestañas viejas.
 */
async function settingsOpen(page: Page): Promise<boolean> {
  const controls = await visibleControls(page);
  const hayRecorte = controls.some((c) => /^crop_/.test(c.text));
  const hayCantidad = controls.some((c) => /^x\d$/.test(c.text));
  return hayRecorte && hayCantidad;
}

/**
 * Abre la barra de configuración. El disparador es el control que RESUME el
 * estado: su texto contiene un ligature de recorte y la cantidad en el mismo
 * botón ("… crop_16_9 x2"), a diferencia de las opciones, que empiezan con
 * `crop_` o son exactamente `xN`. Se mantiene un respaldo para la UI vieja, donde
 * el disparador era una hoja con `crop_` fuera de todo [role="tab"].
 */
export async function openSettings(page: Page): Promise<void> {
  if (await settingsOpen(page)) return;

  const controls = await visibleControls(page);
  const trigger = controls.find(
    (c) => /crop_[0-9a-z]/.test(c.text) && /(^|\s)x\d(\s|$)/.test(c.text) && !/^crop_/.test(c.text),
  );

  if (trigger) {
    await clickAt(page, trigger.cx, trigger.cy);
    await page.waitForTimeout(600);
  } else {
    // Respaldo UI vieja: hoja con `crop_` que no vive dentro de un [role="tab"].
    const legacy = await page.evaluate(() => {
      const leaves = [...document.querySelectorAll("*")].filter(
        (el) => (el as HTMLElement).offsetParent && el.querySelectorAll("*").length === 0,
      );
      const hit = leaves.find(
        (el) => /^crop_/.test(((el as HTMLElement).innerText || "").trim()) && !el.closest('[role="tab"]'),
      );
      if (!hit) return null;
      const r = hit.getBoundingClientRect();
      return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    });
    if (!legacy) {
      throw new FlowError(M.noSettingsControl(), M.noSettingsControlHint());
    }
    await clickAt(page, legacy.cx, legacy.cy);
    await page.waitForTimeout(600);
  }

  if (!(await settingsOpen(page))) {
    throw new FlowError(M.settingsWontOpen());
  }
}

/**
 * Deja la pestaña en la vista del proyecto, con el compositor a mano.
 *
 * Tras un escalado (menú contextual → Descargar → 2K) Flow puede quedar en la
 * vista de detalle del medio (botón `keyboard_return`) o con un diálogo o menú
 * abierto; desde ahí el disparador de configuración no abre nada y la próxima
 * generación falla con "el panel no se abrió". Volver a la URL del proyecto es
 * lo único que garantiza el estado limpio.
 */
export async function ensureComposer(page: Page): Promise<void> {
  const estado = await page.evaluate(() => {
    const vis = [...document.querySelectorAll('[role="tab"], button, [role="button"]')].filter(
      (el) => (el as HTMLElement).offsetParent,
    );
    const textos = vis.map((el) => ((el as HTMLElement).innerText || "").trim());
    return {
      detalle: textos.some((t) => /^keyboard_return\b/.test(t)),
      disparador: textos.some((t) => /crop_[0-9a-z]/.test(t) && /(^|\s)x\d(\s|$)/.test(t)),
      dialogo: !!document.querySelector('[role=dialog][data-state=open], [role="menu"]'),
    };
  });
  if (!estado.detalle && estado.disparador && !estado.dialogo) return;

  const m = /^(https:\/\/[^/]+\/project\/[^/?#]+)/.exec(page.url());
  if (m) {
    await page.goto(m[1]!, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } else {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  }
  await page.waitForSelector('[contenteditable="true"]', { timeout: 60_000 });
  await page.waitForTimeout(1_500);
}

export async function closeSettings(page: Page): Promise<void> {
  if (!(await settingsOpen(page))) return;
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}

async function clickControl(page: Page, match: (text: string) => boolean, what: string): Promise<void> {
  const controls = await visibleControls(page);
  const hit = controls.find((c) => match(c.text));
  if (!hit) {
    throw new FlowError(M.noOption(what), M.visibleTabs(controls.map((c) => c.text).join(" / ")));
  }
  await clickAt(page, hit.cx, hit.cy);
  await page.waitForTimeout(400);
}

/** Igual que clickControl pero devuelve si estaba o no, sin fallar. */
async function clickControlIfPresent(
  page: Page,
  match: (text: string) => boolean,
  last = false,
): Promise<boolean> {
  const controls = await visibleControls(page);
  // `last`: el panel se dibuja después en el DOM; sirve cuando una pestaña de la
  // biblioteca ("image Imágenes") matchea igual que la opción del panel.
  const hit = last ? controls.filter((c) => match(c.text)).pop() : controls.find((c) => match(c.text));
  if (!hit) return false;
  await clickAt(page, hit.cx, hit.cy);
  await page.waitForTimeout(400);
  return true;
}

/**
 * Lee el costo que Flow cotiza, si lo muestra. En la UI nueva el modo imagen es
 * gratis y NO muestra ningún número; en ese caso devuelve null y quien llama lo
 * interpreta como 0 (ver applySettings). Se conserva la lectura por estructura y
 * por texto para la UI vieja y para el modo vídeo.
 */
export async function readQuotedCost(page: Page): Promise<{ cost: number | null; raw: string }> {
  const chain = await page.evaluate(() => {
    // Ancla: el control de recorte (pestaña vieja o botón nuevo) del panel.
    const anchor =
      [...document.querySelectorAll('[role="tab"], button, [role="button"]')].find((el) =>
        /^crop_/.test(((el as HTMLElement).innerText || "").trim()),
      ) ?? null;
    if (!anchor) return [] as string[];
    const texts: string[] = [];
    let node: HTMLElement | null = anchor.parentElement;
    for (let i = 0; i < 8 && node; i++) {
      const t = (node.innerText || "").trim();
      if (t && t.length < 3000) texts.push(t);
      node = node.parentElement;
    }
    return texts;
  });

  // Red de seguridad por texto: cubre los idiomas que cubre y nada más. Cuando no
  // alcanza, applySettings decide (modo imagen = gratis).
  const COST_RE =
    /(\d[\d.,]*)\s*(?:puntos?|points?|cr[ée]dit(?:o|e)?s?|credits?|punkte?|crediti|krediter|pontos?|クレジット|积分|点数)/i;
  for (const text of chain) {
    const m = COST_RE.exec(text);
    if (!m) continue;
    const cost = Number.parseInt(m[1]!.replace(/[.,]/g, ""), 10);
    if (Number.isFinite(cost)) return { cost, raw: text.replace(/\s+/g, " ").trim().slice(0, 300) };
  }

  return { cost: null, raw: (chain[chain.length - 1] ?? "").replace(/\s+/g, " ").trim().slice(0, 300) };
}

export interface Settings {
  aspect: Aspect;
  count: number;
}

export type MediaMode = "image" | "video";

/**
 * Deja el panel en el modo pedido, con la relación (y en imagen, la cantidad), y
 * devuelve el costo cotizado.
 *
 * En modo imagen la generación es gratuita: si Flow no muestra ningún costo, se
 * cotiza 0. En modo VÍDEO nunca se coacciona a 0: el vídeo cuesta créditos, así
 * que si no se pudo leer el número se devuelve null y quien llama DEBE negarse
 * (nunca generar vídeo creyendo que es gratis).
 */
export async function applySettings(
  page: Page,
  settings: Settings,
  mode: MediaMode = "image",
): Promise<{ cost: number | null; raw: string }> {
  await openSettings(page);

  // Tipo de medio por ligature (`image` / `videocam`), estable entre idiomas.
  if (mode === "video") {
    // `last`: la barra lateral ahora tiene una sección "videocam Vídeos" que matchea igual.
    if (!(await clickControlIfPresent(page, (t) => /^videocam\b/.test(t), true))) {
      // Puede que ya esté en vídeo; si tampoco existe el control, no hay modo vídeo.
      const controls = await visibleControls(page);
      if (!controls.some((c) => /^videocam\b/.test(c.text))) {
        throw new FlowError(M.videoModeMissing(), M.visibleTabs(controls.map((c) => c.text).join(" / ")));
      }
    }
  } else if (!(await clickControlIfPresent(page, (t) => /^image\b/.test(t), true))) {
    const controls = await visibleControls(page);
    if (controls.some((c) => /^videocam\b/.test(c.text))) {
      throw new FlowError(M.noOption(M.optionMediaType()), M.visibleTabs(controls.map((c) => c.text).join(" / ")));
    }
  }

  // Elegir el tipo de medio puede cerrar el panel; se reabre si hace falta.
  await openSettings(page);

  // Relación de aspecto. Se matchea por el ligature (`crop_9_16`) o por la
  // etiqueta numérica ("9:16") que el botón muestra al lado; ambas son estables
  // entre idiomas.
  const { ligature } = ASPECTS[settings.aspect];
  const label = settings.aspect;
  await clickControl(
    page,
    (t) => t.startsWith(ligature) || t.split(" ").includes(label),
    M.optionAspect(settings.aspect),
  );

  // Cantidad: sólo en imagen. Si no se ofrece y se pidió una sola, no hay nada que
  // elegir; si se pidieron varias, callarse daría menos.
  if (mode === "image") {
    if (!(await clickControlIfPresent(page, (t) => t === `x${settings.count}`)) && settings.count > 1) {
      const controls = await visibleControls(page);
      throw new FlowError(M.noOption(M.optionCount(settings.count)), M.visibleTabs(controls.map((c) => c.text).join(" / ")));
    }
  }

  const quote = await readQuotedCost(page);
  // Sólo en imagen "sin número" significa gratis. En vídeo, null se propaga para
  // que el portón de costo se niegue (jamás generar vídeo creyéndolo gratis).
  if (mode === "image" && quote.cost === null) return { cost: 0, raw: quote.raw || "image mode (free)" };
  return quote;
}

/**
 * Escribe el prompt en el compositor y lo envía.
 *
 * El compositor es un div contenteditable, no un input: asignarle `value` no hace
 * nada y un fill genérico puede terminar en el buscador. Hay que hacer foco con un
 * clic real y tipear con el teclado. El envío es el botón con el ligature
 * `arrow_forward` (respaldo: Enter).
 */
export async function submitPrompt(page: Page, prompt: string): Promise<void> {
  const box = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('[contenteditable="true"]')].filter(
      (el) => (el as HTMLElement).offsetParent,
    );
    const el = boxes[boxes.length - 1] as HTMLElement | undefined;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });

  if (!box) {
    throw new FlowError(M.noComposer(), M.noComposerHint());
  }

  await clickAt(page, box.cx, box.cy);
  await page.waitForTimeout(200);

  // Limpiamos lo que haya quedado de un turno anterior.
  const selectAll = process.platform === "darwin" ? "Meta+A" : "Control+A";
  await page.keyboard.press(selectAll);
  await page.keyboard.press("Backspace");

  await page.keyboard.type(prompt, { delay: 4 });
  await page.waitForTimeout(200);

  // Enviar por el botón `arrow_forward` (último visible, el del compositor). Si no
  // está, Enter.
  const send = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, [role="button"]')].filter(
      (el) => (el as HTMLElement).offsetParent && ((el as HTMLElement).innerText || "").trim() === "arrow_forward",
    );
    const el = btns[btns.length - 1] as HTMLElement | undefined;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });
  if (send) await clickAt(page, send.cx, send.cy);
  else await page.keyboard.press("Enter");
}
