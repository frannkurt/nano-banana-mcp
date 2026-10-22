import type { Page } from "playwright-core";
import { readFile } from "node:fs/promises";
import { config } from "./config.js";
import { getFlowTab } from "./browser.js";
import { applySettings, closeSettings, ensureComposer, submitPrompt } from "./ui.js";
import { clearReferences } from "./reference.js";
import { FlowError, type Aspect } from "./types.js";
import { M } from "./i18n.js";

/**
 * GENERACIÓN DE VÍDEO (Veo, dentro de Flow)
 *
 * Misma filosofía que las imágenes: no hay API pública, así que se maneja la UI
 * como una persona (modo `videocam` en el panel, prompt en el compositor, envío).
 * DOS diferencias que importan:
 *
 *   1. COSTO. El vídeo NO es gratis. El portón de costo de `applySettings`+acá es
 *      la única barrera: con FLOW_MAX_COST=0 (el default) cualquier vídeo se niega
 *      ANTES de enviarse. Subir ese techo es lo que lo habilita.
 *
 *   2. COSECHA. El resultado no es un <img> `flow-content/image/...` sino un
 *      <video> (o <source>) cuyo src puede ser una URL firmada http(s) o un
 *      blob:. Por eso hay un recolector y una descarga propios.
 */

/** Firmas de contenedor de vídeo, para no guardar un cuerpo de error como .mp4. */
function sniffVideo(b: Buffer): "mp4" | "webm" | null {
  // ISO-BMFF (mp4/mov): "....ftyp" en el offset 4.
  if (b.length > 12 && b.subarray(4, 8).toString("latin1") === "ftyp") return "mp4";
  // Matroska/WebM: EBML magic 1A 45 DF A3.
  if (b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  return null;
}

const MIN_VIDEO_BYTES = 10_000;

/**
 * Clave estable de un vídeo. La URL firmada de flow-content se RE-FIRMA sola (la
 * `Signature`/`Expires` cambia), así que comparar por src entero hace que un
 * vídeo viejo reaparezca como "nuevo" y se lo re-descargue (gastando el crédito
 * de una generación que en realidad falló). El uuid de `/video/<uuid>` no cambia:
 * es la identidad real. Para blob: (sin uuid) se cae al src completo.
 */
function videoKeyExpr(): string {
  return `(function(s){var m=/\\/video\\/([0-9a-f-]{36})/i.exec(s);return m?m[1]:s;})`;
}

/** Claves de los vídeos presentes ahora (uuid cuando se puede, si no el src). */
async function snapshotVideoKeys(page: Page): Promise<Set<string>> {
  const list = await page.evaluate(`(() => {
    const key = ${videoKeyExpr()};
    const out = [];
    for (const el of Array.from(document.querySelectorAll('video'))) {
      const cands = [el.currentSrc, el.src, ...Array.from(el.querySelectorAll('source')).map((s) => s.src)];
      for (const s of cands) if (s && (s.startsWith('blob:') || s.startsWith('http'))) out.push(key(s));
    }
    return out;
  })()`) as string[];
  return new Set(list);
}

/**
 * Espera a que aparezca un <video> con una CLAVE nueva respecto de `antes` y que
 * esté cargado (readyState o duración reales, no un placeholder). Devuelve su src.
 */
async function collectVideoFromDom(page: Page, antes: Set<string>, timeoutMs: number): Promise<string> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const ready = (await page.evaluate(
      `(() => {
        const key = ${videoKeyExpr()};
        const seen = new Set(${JSON.stringify([...antes])});
        for (const el of Array.from(document.querySelectorAll('video'))) {
          const cands = [el.currentSrc, el.src, ...Array.from(el.querySelectorAll('source')).map((s) => s.src)];
          for (const s of cands) {
            if (!s || (!s.startsWith('blob:') && !s.startsWith('http'))) continue;
            if (seen.has(key(s))) continue;
            if (el.readyState >= 1 || (Number.isFinite(el.duration) && el.duration > 0)) return s;
          }
        }
        return null;
      })()`,
    )) as string | null;
    if (ready) return ready;
    await page.waitForTimeout(2000);
  }
  throw new FlowError(M.noVideo(), M.noVideoHint());
}

/** Baja los bytes del vídeo. http(s): por el APIRequestContext (comparte cookies). blob:: leído dentro de la página. */
async function fetchVideo(page: Page, src: string): Promise<Buffer> {
  if (src.startsWith("blob:")) {
    const b64 = await page.evaluate(async (url: string) => {
      const r = await fetch(url);
      const buf = new Uint8Array(await r.arrayBuffer());
      let bin = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < buf.length; i += CHUNK) bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
      return btoa(bin);
    }, src);
    const bytes = Buffer.from(b64, "base64");
    if (!sniffVideo(bytes) || bytes.length < MIN_VIDEO_BYTES) {
      throw new FlowError(M.videoDownloadFailed(`blob de ${bytes.length} bytes sin firma de vídeo`));
    }
    return bytes;
  }

  const api = page.context().request;
  const res = await api.get(src, { headers: { referer: page.url() }, timeout: 120_000 });
  if (!res.ok()) throw new FlowError(M.videoDownloadFailed(`${res.status()} en ${src.split("?")[0]}`));
  const bytes = Buffer.from(await res.body());
  if (!sniffVideo(bytes) || bytes.length < MIN_VIDEO_BYTES) {
    throw new FlowError(M.videoDownloadFailed(`respuesta de ${bytes.length} bytes sin firma de vídeo`));
  }
  return bytes;
}

/**
 * COSECHA EN LA UI NUEVA (flow.google.com, Angular)
 *
 * La grilla ya no tiene <video>: cada vídeo es un <flow-video-tile> con una
 * miniatura <img class="thumbnail"> servida por el proxy /asb/. El archivo sólo
 * se obtiene como lo baja una persona: abrir la tarjeta (vista /edit/<uuid>),
 * botón `download` y la opción "720p" (tamaño original; 1080p y 4K son escalados
 * que pueden costar). Lo nuevo aparece arriba de todo en la grilla.
 */
async function snapshotVideoTiles(page: Page): Promise<Set<string>> {
  const srcs = await page.evaluate(() =>
    [...document.querySelectorAll("flow-video-tile img.thumbnail")].map((i) => (i as HTMLImageElement).src),
  );
  return new Set(srcs);
}

/** Índice (en orden del DOM) de la primera tarjeta nueva ya terminada, o -1. */
function newVideoTileIndex(page: Page, antes: Set<string>): Promise<number> {
  return page.evaluate((prev) => {
    const seen = new Set(prev);
    const tiles = [...document.querySelectorAll("flow-video-tile")];
    for (let i = 0; i < tiles.length; i++) {
      const img = tiles[i]!.querySelector("img.thumbnail") as HTMLImageElement | null;
      if (!img || seen.has(img.src)) continue;
      // Mientras genera muestra un porcentaje y no tiene miniatura cargada.
      if (/\d+\s*%/.test((tiles[i] as HTMLElement).innerText || "")) continue;
      if (img.complete && img.naturalWidth > 0) return i;
    }
    return -1;
  }, [...antes]);
}

/** Abre la tarjeta y baja el archivo con el menú de descarga, en tamaño original. */
async function downloadVideoTile(page: Page, index: number): Promise<{ bytes: Buffer; src: string }> {
  await page.locator("flow-video-tile").nth(index).click();
  await page.waitForURL(/\/edit\//, { timeout: 30_000 });
  await page.waitForTimeout(2_500);
  await page.locator("button", { hasText: /^download$/ }).first().click();
  await page.waitForTimeout(1_200);
  const [descarga] = await Promise.all([
    page.waitForEvent("download", { timeout: 180_000 }),
    page.locator('[role="menuitem"]', { hasText: "720p" }).first().click(),
  ]);
  const ruta = await descarga.path();
  if (!ruta) throw new FlowError(M.videoDownloadFailed("la descarga no dejó archivo"));
  const bytes = await readFile(ruta);
  if (!sniffVideo(bytes) || bytes.length < MIN_VIDEO_BYTES) {
    throw new FlowError(M.videoDownloadFailed(`descarga de ${bytes.length} bytes sin firma de vídeo`));
  }
  return { bytes, src: page.url() };
}

/** Espera el vídeo nuevo por cualquiera de las dos UIs y devuelve sus bytes. */
async function harvestVideo(
  page: Page,
  antes: Set<string>,
  antesTiles: Set<string>,
  timeoutMs: number,
): Promise<{ bytes: Buffer; src: string }> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const idx = await newVideoTileIndex(page, antesTiles);
    if (idx >= 0) return downloadVideoTile(page, idx);
    try {
      // UI vieja: <video> con src propio. Un intento corto por vuelta.
      const src = await collectVideoFromDom(page, antes, 1);
      return { bytes: await fetchVideo(page, src), src };
    } catch {
      /* todavía nada */
    }
    await page.waitForTimeout(3_000);
  }
  throw new FlowError(M.noVideo(), M.noVideoHint());
}

export interface VideoOptions {
  prompt: string;
  aspect: Aspect;
  maxCost?: number;
  timeoutMs?: number;
  page?: Page;
}

export interface VideoResult {
  bytes: Buffer;
  cost: number;
  src: string;
}

/**
 * Genera un vídeo respetando el portón de costo. Con FLOW_MAX_COST=0 se niega
 * antes de enviar nada (el vídeo cuesta créditos).
 */
export async function generateVideo(opts: VideoOptions): Promise<VideoResult> {
  const maxCost = opts.maxCost ?? config.maxCost;
  const page = opts.page ?? (await getFlowTab()).page;

  // Tras un escalado Flow puede quedar en la vista de detalle: se vuelve al proyecto.
  await ensureComposer(page);

  // Una referencia colgada de un turno anterior cambiaría el resultado sin avisar.
  try {
    await clearReferences(page);
  } catch {
    /* nada que limpiar o cambió la UI: no es fatal */
  }

  const quote = await applySettings(page, { aspect: opts.aspect, count: 1 }, "video");

  // El portón: se cierra ANTES de enviar, el único momento en que negarse es gratis.
  if (quote.cost === null) {
    await closeSettings(page);
    throw new FlowError(M.costUnreadable(), M.costUnreadableHint(quote.raw.slice(0, 200)));
  }
  if (quote.cost > maxCost) {
    await closeSettings(page);
    throw new FlowError(
      M.costTooHigh(quote.cost, maxCost),
      maxCost === 0 ? M.costTooHighHintZero() : M.costTooHighHint(),
    );
  }

  await closeSettings(page);
  // En vídeo el panel puede no tener el selector de cantidad, con lo que
  // closeSettings quizá no lo detecte abierto: forzamos el cierre.
  await page.keyboard.press("Escape").catch(() => {});

  const antes = await snapshotVideoKeys(page);
  const antesTiles = await snapshotVideoTiles(page);
  // Los vídeos de Veo tardan varios minutos.
  const timeout = opts.timeoutMs ?? Math.max(config.generateTimeoutMs, 600_000);

  await submitPrompt(page, opts.prompt);

  const { bytes, src } = await harvestVideo(page, antes, antesTiles, timeout);
  return { bytes, cost: quote.cost, src };
}
