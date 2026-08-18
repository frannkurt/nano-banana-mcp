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
    const hit =
      leaves.find(
        (el) => /^crop_/.test(((el as HTMLElement).innerText || "").trim()) && !el.closest('[role="tab"]'),
      ) ??
      // Flow UI (2026-08) renders icons as aria-labels, not Material Symbols
      // ligature text: the settings trigger is the "tune" button (leaf text
      // "tune"), not a crop_* glyph. Fall back to it when no crop_* leaf exists.
      leaves.find((el) => ((el as HTMLElement).innerText || "").trim() === "tune");
    if (!hit) return null;
    const r = hit.getBoundingClientRect();
    return { text: (hit as HTMLElement).innerText.trim(), cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });

  if (!trigger) {
    throw new FlowError(M.noSettingsControl(), M.noSettingsControlHint());
  }

  await clickAt(page, trigger.cx, trigger.cy);
  await page.waitForTimeout(600);

  if (!(await settingsOpen(page))) {
    throw new FlowError(M.settingsWontOpen());
  }
}

export async function closeSettings(page: Page): Promise<void> {
  if (!(await settingsOpen(page))) return;
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  if (!(await settingsOpen(page))) return;
  // Flow UI (2026-08) moved settings to a fullscreen page; Escape doesn't leave
  // it. Click the panel's "Back" (arrow_back + Back) button instead.
  const back = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].filter((b) => {
      if (!(b as HTMLElement).offsetParent) return false;
      const t = ((b as HTMLElement).innerText || "").trim().replace(/\s+/g, " ");
      return /^arrow_back back$/i.test(t) || (b.getAttribute("aria-label") || "").trim() === "Back";
    });
    if (!btns.length) return null;
    const b0 = btns[0];
    if (!b0) return null;
    const r = b0.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });
  if (!back) return;
  await clickAt(page, back.cx, back.cy);
  await page.waitForTimeout(500);
}

/**
 * Flow UI (2026-08): the agent settings panel gates media generation behind a
 * confirmation prompt ("Always" by default). That setting is the user's safety
 * brake, so this server NEVER flips it on its own: only when `authorized`
 * (FLOW_AGENT_AUTO_CONFIRM=1) it clicks "Never" (auto-spend) and persists with
 * Save; otherwise it fails with a hint. When the control is absent (old UI),
 * there is no gate and nothing to do.
 */
export async function enableAutoGenerate(page: Page, authorized: boolean): Promise<void> {
  const never = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].filter(
      (b) => (b as HTMLElement).offsetParent && /never/i.test((b as HTMLElement).innerText || ""),
    );
    if (!btns.length) return null;
    const b0 = btns[0];
    if (!b0) return null;
    const r = b0.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });
  if (!never) return; // old UI: no confirmation gate
  if (!authorized) {
    throw new FlowError(M.autoConfirm(), M.autoConfirmHint());
  }
  await clickAt(page, never.cx, never.cy);
  await page.waitForTimeout(300);
  const save = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].filter(
      (b) => (b as HTMLElement).offsetParent && ((b as HTMLElement).innerText || "").trim() === "Save",
    );
    if (!btns.length) return null;
    const b0 = btns[0];
    if (!b0) return null;
    const r = b0.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });
  if (!save) return;
  await clickAt(page, save.cx, save.cy);
  await page.waitForTimeout(600);
}

async function clickTab(page: Page, match: (text: string) => boolean, what: string, optional = false): Promise<void> {
  const tabs = await visibleTabs(page);
  const hit = tabs.find((t) => match(t.text));
  if (!hit) {
    if (optional) return;
    throw new FlowError(M.noOption(what), M.visibleTabs(tabs.map((t) => t.text).join(" / ")));
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
async function readCostFromAnchor(page: Page): Promise<{ cost: number; raw: string } | null> {
  const hit = await page.evaluate(() => {
    // Panel = el ancestro más cercano de la pestaña crop_ que ya contiene los
    // botones de cantidad. Acotar la búsqueda evita que un número suelto de
    // cualquier otra parte de la página se haga pasar por el costo.
    const tab = [...document.querySelectorAll('[role="tab"]')].find((el) =>
      /^crop_/.test(((el as HTMLElement).innerText || "").trim()),
    );
    if (!tab) return null;

    let panel: HTMLElement | null = tab.parentElement;
    for (let i = 0; i < 8 && panel; i++) {
      const botones = [...panel.querySelectorAll("button")].filter((b) =>
        /^x\d+$/.test(((b as HTMLElement).innerText || "").trim()),
      );
      if (botones.length >= 2) break;
      panel = panel.parentElement;
    }
    if (!panel) return null;

    const hojas = [...panel.querySelectorAll("a")].filter(
      (a) => (a as HTMLElement).offsetParent && a.children.length === 0 && /\d/.test((a as HTMLElement).innerText || ""),
    );
    const ultima = hojas[hojas.length - 1];
    return ultima ? ((ultima as HTMLElement).innerText || "").trim() : null;
  });

  if (!hit) return null;
  const m = /(\d[\d.,]*)/.exec(hit);
  if (!m) return null;
  const cost = Number.parseInt(m[1]!.replace(/[.,]/g, ""), 10);
  return Number.isFinite(cost) ? { cost, raw: hit.replace(/\s+/g, " ").trim().slice(0, 300) } : null;
}

export async function readQuotedCost(page: Page): Promise<{ cost: number | null; raw: string }> {
  // Primero por estructura, que vale en cualquier idioma.
  const porAncla = await readCostFromAnchor(page);
  if (porAncla) return porAncla;

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

  // Red de seguridad por texto, para si Flow reacomoda el panel y el ancla de
  // arriba deja de existir. Cubre los idiomas que cubre y nada más: cuando no
  // alcanza, el portón se niega a enviar, que es la falla correcta.
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

/**
 * Deja el panel en modo imagen, con la relación y la cantidad pedidas, y devuelve
 * el costo que Flow cotiza para esa combinación.
 */
export async function applySettings(page: Page, settings: Settings): Promise<{ cost: number | null; raw: string }> {
  await openSettings(page);

  // Modo imagen. El ligature `image` distingue la pestaña de la de vídeo
  // (`videocam`) sin depender de las palabras "Imagen"/"Vídeo".
  // Flow UI (2026-08) dropped the media-type tab: image is the only default
  // in the panel, so skip when absent instead of failing.
  await clickTab(page, (t) => /^image\b/.test(t), M.optionMediaType(), true);

  const { ligature } = ASPECTS[settings.aspect];
  await clickTab(page, (t) => t.startsWith(ligature), M.optionAspect(settings.aspect));

  await clickTab(page, (t) => t === `x${settings.count}`, M.optionCount(settings.count));

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
    throw new FlowError(M.noComposer(), M.noComposerHint());
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
