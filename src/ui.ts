import type { Page } from "playwright-core";
import { ASPECTS, FlowError, type Aspect } from "./types.js";

/**
 * MANEJO DE LA INTERFAZ
 *
 * Flow no expone una API pública, y la llamada interna de generación va firmada
 * con un token de reCAPTCHA Enterprise que acuña el JavaScript de la página. Eso
 * significa que la generación se pide como la pide una persona: escribiendo en el
 * compositor. Este módulo es la única parte del servidor que toca el DOM.
 *
 * Para que aguante, se ancla en dos cosas que no cambian con el idioma:
 *
 *   - los nombres de ligature de Material Symbols (`crop_16_9`, `image`), que son
 *     identificadores de icono y se renderizan igual en cualquier locale;
 *   - las etiquetas numéricas ("16:9", "x2"), que tampoco se traducen.
 *
 * Nunca se busca copy traducible como "Aprobar" o "Crear".
 */

/** Los eventos sintéticos de .click() no los levanta React; usamos puntero real. */
async function clickAt(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.waitForTimeout(80);
  await page.mouse.click(x, y);
}

interface Hit {
  text: string;
  cx: number;
  cy: number;
}

/** Pestañas visibles del popover, con su texto normalizado y su centro. */
async function visibleTabs(page: Page): Promise<Hit[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')]
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

async function settingsOpen(page: Page): Promise<boolean> {
  const tabs = await visibleTabs(page);
  return tabs.some((t) => /^crop_/.test(t.text));
}

/**
 * Abre la barra de configuración. El disparador es el icono que muestra la
 * relación actual; se distingue de las pestañas del popover porque no vive
 * dentro de un [role=tab].
 */
export async function openSettings(page: Page): Promise<void> {
  if (await settingsOpen(page)) return;

  const trigger = await page.evaluate(() => {
    const leaves = [...document.querySelectorAll("*")].filter(
      (el) => (el as HTMLElement).offsetParent && el.querySelectorAll("*").length === 0,
    );
    const hit = leaves.find(
      (el) => /^crop_/.test(((el as HTMLElement).innerText || "").trim()) && !el.closest('[role="tab"]'),
    );
    if (!hit) return null;
    const r = hit.getBoundingClientRect();
    return { text: (hit as HTMLElement).innerText.trim(), cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });

  if (!trigger) {
    throw new FlowError(
      "No encontré el control de configuración de generación en la página.",
      "Confirmá que hay un proyecto de Flow abierto (labs.google/fx/tools/flow/project/<id>) y que la ventana no está tapada.",
    );
  }

  await clickAt(page, trigger.cx, trigger.cy);
  await page.waitForTimeout(600);

  if (!(await settingsOpen(page))) {
    throw new FlowError("Hice clic en el control de configuración pero el panel no se abrió.");
  }
}

export async function closeSettings(page: Page): Promise<void> {
  if (!(await settingsOpen(page))) return;
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}

async function clickTab(page: Page, match: (text: string) => boolean, what: string): Promise<void> {
  const tabs = await visibleTabs(page);
  const hit = tabs.find((t) => match(t.text));
  if (!hit) {
    throw new FlowError(
      `No encontré la opción de ${what} en el panel de configuración.`,
      `Pestañas visibles: ${tabs.map((t) => t.text).join(" / ") || "(ninguna)"}`,
    );
  }
  await clickAt(page, hit.cx, hit.cy);
  await page.waitForTimeout(400);
}

/**
 * El número que Flow calcula por su cuenta antes de enviar. Lo leemos del panel
 * en vez de estimarlo nosotros: es la fuente de verdad y aparece antes de que se
 * gaste nada. Devuelve null si no se pudo interpretar, y el texto crudo para que
 * quien llame pueda reportar con honestidad qué vio.
 */
export async function readQuotedCost(page: Page): Promise<{ cost: number | null; raw: string }> {
  // Subimos por la cadena de ancestros del popover y devolvemos el texto de cada
  // nivel. Decidir cuál sirve se hace acá en Node y no dentro del navegador: la
  // línea del costo está varios niveles más arriba que las pestañas, y cuál es
  // el nivel exacto depende de cómo esté armado el árbol ese día.
  const chain = await page.evaluate(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((el) =>
      /^crop_/.test(((el as HTMLElement).innerText || "").trim()),
    );
    if (!tab) return [];
    const texts: string[] = [];
    let node: HTMLElement | null = tab.parentElement;
    for (let i = 0; i < 8 && node; i++) {
      const t = (node.innerText || "").trim();
      // Más allá de unos pocos miles de caracteres ya estamos leyendo la página
      // entera, y ahí cualquier número suelto daría un falso positivo.
      if (t && t.length < 3000) texts.push(t);
      node = node.parentElement;
    }
    return texts;
  });

  const COST_RE = /(\d[\d.,]*)\s*(?:puntos?|points?|cr[ée]ditos?|credits?)/i;
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

/**
 * Deja el panel en modo imagen, con la relación y la cantidad pedidas, y devuelve
 * el costo que Flow cotiza para esa combinación.
 */
export async function applySettings(page: Page, settings: Settings): Promise<{ cost: number | null; raw: string }> {
  await openSettings(page);

  // Modo imagen. El ligature `image` distingue la pestaña de la de vídeo
  // (`videocam`) sin depender de las palabras "Imagen"/"Vídeo".
  await clickTab(page, (t) => /^image\b/.test(t), "tipo de medio (imagen)");

  const { ligature } = ASPECTS[settings.aspect];
  await clickTab(page, (t) => t.startsWith(ligature), `relación de aspecto ${settings.aspect}`);

  await clickTab(page, (t) => t === `x${settings.count}`, `cantidad de salidas (x${settings.count})`);

  return readQuotedCost(page);
}

/**
 * Escribe el prompt en el compositor y lo envía.
 *
 * El compositor es un div contenteditable, no un input: asignarle `value` no
 * hace nada y un fill genérico puede terminar en el buscador. Hay que hacer foco
 * con un clic real y tipear con el teclado.
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
    throw new FlowError(
      "No encontré el compositor de prompts en la página.",
      "Abrí un proyecto de Flow (labs.google/fx/tools/flow/project/<id>) antes de generar.",
    );
  }

  await clickAt(page, box.cx, box.cy);
  await page.waitForTimeout(200);

  // Limpiamos lo que haya quedado de un turno anterior: un prompt viejo pegado
  // adelante cambiaría la imagen sin que se note.
  const selectAll = process.platform === "darwin" ? "Meta+A" : "Control+A";
  await page.keyboard.press(selectAll);
  await page.keyboard.press("Backspace");

  await page.keyboard.type(prompt, { delay: 4 });
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
}
