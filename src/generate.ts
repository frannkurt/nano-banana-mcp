import type { Page } from "playwright-core";
import { config } from "./config.js";
import { getFlowTab } from "./browser.js";
import { applySettings, closeSettings, ensureComposer, submitPrompt } from "./ui.js";
import { attachReference, clearReferences, uploadImage } from "./reference.js";
import { FlowError, type Aspect, type GeneratedImage } from "./types.js";
import { M } from "./i18n.js";

/**
 * DE DÓNDE SALE EL RESULTADO
 *
 * Hasta la migración a flow.google.com (frontend Angular) el resultado se leía de
 * la respuesta de red `flowMedia:batchGenerateImages`, que traía id firmado y
 * dimensiones en JSON limpio. Esa llamada ya no existe: ahora todo va por el RPC
 * ofuscado `batchexecute`, impráctico de parsear.
 *
 * Así que cosechamos del DOM. Cada imagen generada aparece como un <img> cuyo src
 * es `https://flow-content.google/image/<uuid>?Expires=…&Signature=…`, con el
 * tamaño nativo en naturalWidth/Height y la URL ya firmada (se baja sin auth, y
 * como comparte el tarro de cookies del navegador no la frena CORS). Tomamos una
 * foto de los ids presentes ANTES de enviar y esperamos a que aparezcan los
 * nuevos. Es estable entre idiomas e independiente del transporte interno.
 */
const MEDIA_RE = /flow-content\.google\/image\/([0-9a-f-]{36})/i;

interface DomMedia {
  id: string;
  src: string;
  width: number;
  height: number;
  /** Posición en el documento: Flow inserta lo recién generado arriba de todo. */
  orden: number;
}

/**
 * Ids ya entregados en este proceso. La grilla de Flow es virtual: con muchos
 * medios, uno viejo que no estaba en el DOM al sacar la foto de "antes" puede
 * aparecer después y pasar por nuevo. Nunca se devuelve dos veces el mismo.
 */
const entregados = new Set<string>();

/** Todos los medios `flow-content` presentes ahora, el de mayor resolución por id. */
export async function snapshotMedia(page: Page): Promise<Map<string, DomMedia>> {
  const list = await page.evaluate((reSrc) => {
    const re = new RegExp(reSrc, "i");
    const out: { id: string; src: string; width: number; height: number; orden: number }[] = [];
    Array.from(document.images).forEach((im, orden) => {
      const src = im.currentSrc || im.src || "";
      const m = re.exec(src);
      if (!m) return;
      out.push({ id: m[1]!, src, width: im.naturalWidth || 0, height: im.naturalHeight || 0, orden });
    });
    return out;
  }, MEDIA_RE.source);

  const map = new Map<string, DomMedia>();
  for (const it of list) {
    const prev = map.get(it.id);
    if (!prev || it.width * it.height > prev.width * prev.height) map.set(it.id, { ...it, orden: Math.min(it.orden, prev?.orden ?? it.orden) });
  }
  return map;
}

/** Tras un rato con al menos una imagen nueva pero sin llegar a todas, se entrega. */
const SILENCIO_MS = 15_000;

/**
 * Espera a que aparezcan `esperadas` imágenes nuevas respecto de `antes`. Corta
 * por cualquiera de tres vías: llegaron todas, pasó un rato con algunas sin
 * novedad, o se agotó el tiempo. Nunca descarta lo ya visto.
 */
export async function collectFromDom(
  page: Page,
  antes: Set<string>,
  esperadas: number,
  aspect: string,
  timeoutMs: number,
): Promise<GeneratedImage[]> {
  const t0 = Date.now();
  let primeraNueva = 0;
  const nuevas = new Map<string, DomMedia>();

  while (Date.now() - t0 < timeoutMs) {
    const actual = await snapshotMedia(page);
    // Lo nuevo aparece arriba de lo que ya estaba. Un medio viejo que la grilla
    // virtual recién dibuja queda abajo, y no cuenta.
    let tope = Infinity;
    for (const [id, m] of actual) if (antes.has(id)) tope = Math.min(tope, m.orden);
    for (const [id, m] of actual) {
      // Sólo ids nuevos, arriba de los previos, nunca entregados, y con la imagen
      // ya cargada (naturalWidth real, no el placeholder de 0 ancho).
      if (!antes.has(id) && !entregados.has(id) && m.orden < tope && m.width > 200 && !nuevas.has(id)) {
        nuevas.set(id, m);
        if (primeraNueva === 0) primeraNueva = Date.now();
      }
    }
    if (nuevas.size >= esperadas) break;
    if (primeraNueva && Date.now() - primeraNueva > SILENCIO_MS) break;
    await page.waitForTimeout(1500);
  }

  const elegidas = [...nuevas.values()].slice(0, esperadas);
  for (const m of elegidas) entregados.add(m.id);
  return elegidas.map((m) => ({
    mediaId: m.id,
    width: m.width,
    height: m.height,
    aspect,
    seed: null,
    signedUrl: m.src,
    effectivePrompt: null,
  }));
}

export interface GenerateOptions {
  prompt: string;
  aspect: Aspect;
  count: number;
  /** Techo de costo. Por defecto el del entorno, que es 0 = solo gratis. */
  maxCost?: number;
  timeoutMs?: number;
  /**
   * Pestaña donde generar. Si se omite se usa la primera de Flow que aparezca.
   *
   * Pasarla explícitamente es lo que permite generar en paralelo: el compositor
   * es un único elemento por pestaña, así que dos generaciones en la misma se
   * pisan escribiendo el prompt. Con una pestaña por hilo cada una vigila su
   * propio DOM y no hay ambigüedad sobre qué imagen es de quién.
   */
  page?: Page;
  /**
   * Rutas locales de imágenes a usar como referencia. Se suben a la biblioteca
   * del proyecto y se adjuntan al compositor antes de enviar el prompt.
   *
   * Cambian lo que hace el prompt: con una referencia adjunta Flow parte de esa
   * imagen en vez de partir de cero, así que el texto pasa a describir qué
   * cambiar y no qué crear.
   */
  referenceImages?: string[];
  /**
   * Nombres de archivos que YA están en la biblioteca del proyecto, para
   * adjuntarlos sin volver a subirlos. Subir dos veces el mismo archivo sólo
   * deja filas duplicadas y hace más lenta cada iteración.
   */
  referenceLibraryNames?: string[];
}

export interface GenerateResult {
  images: GeneratedImage[];
  quotedCost: number | null;
  quoteText: string;
  page: Page;
}

export interface StartedGeneration {
  /** Se resuelve cuando llegan las imágenes. Rechaza si no llegó ninguna. */
  harvest: Promise<GeneratedImage[]>;
  quotedCost: number | null;
  quoteText: string;
  page: Page;
}

/**
 * Deja una generación EN VUELO y devuelve sin esperarla.
 *
 * La separación en dos fases existe por cómo trata Chrome a las pestañas de
 * fondo: les congela requestAnimationFrame, así que la interfaz no responde.
 * Manipular la UI —y tomar la foto de los medios previos— exige la pestaña en
 * primer plano; la espera del resultado, en cambio, tolera la pestaña tapada.
 *
 * Entonces, para varias generaciones a la vez: la fase de UI —unos segundos por
 * pestaña— se hace de a una con `bringToFront`, y la cosecha —que es lo que de
 * verdad tarda— corre en paralelo para todas.
 */
export async function startGeneration(opts: GenerateOptions): Promise<StartedGeneration> {
  const maxCost = opts.maxCost ?? config.maxCost;
  const page = opts.page ?? (await getFlowTab()).page;

  // Tras un escalado Flow puede quedar en la vista de detalle: se vuelve al proyecto.
  await ensureComposer(page);

  // Una referencia olvidada de un turno anterior cambiaría la imagen sin que nada
  // lo indique. Se limpia siempre. Si la UI cambió y esto fallara, no debe tumbar
  // una generación sin referencias: se ignora.
  try {
    await clearReferences(page);
  } catch {
    /* sin referencias que limpiar, o la UI cambió: no es fatal */
  }

  for (const nombre of opts.referenceLibraryNames ?? []) {
    await attachReference(page, nombre);
  }
  for (const ruta of opts.referenceImages ?? []) {
    const { fileName } = await uploadImage(page, ruta);
    await attachReference(page, fileName);
  }

  const quote = await applySettings(page, { aspect: opts.aspect, count: opts.count });

  // El portón. Se cierra ANTES de enviar, que es el único momento en que negarse
  // todavía es gratis. Si el número no se pudo leer, no adivinamos: paramos.
  // (En modo imagen applySettings ya devuelve 0, que es lo real.)
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

  // Foto de los medios presentes ANTES de enviar: lo nuevo es lo que sale de acá.
  // Se toma con la pestaña todavía en primer plano (fin de la fase de UI).
  const antes = new Set((await snapshotMedia(page)).keys());

  const timeout = opts.timeoutMs ?? config.generateTimeoutMs;
  const cosecha = collectFromDom(page, antes, opts.count, opts.aspect, timeout).then((images) => {
    if (images.length === 0) {
      throw new FlowError(M.noImages(), M.noImagesHint());
    }
    return images;
  });

  await submitPrompt(page, opts.prompt);

  return { harvest: cosecha, quotedCost: quote.cost, quoteText: quote.raw, page };
}

export async function generateImages(opts: GenerateOptions): Promise<GenerateResult> {
  const started = await startGeneration(opts);
  const images = await started.harvest;
  return { images, quotedCost: started.quotedCost, quoteText: started.quoteText, page: started.page };
}
