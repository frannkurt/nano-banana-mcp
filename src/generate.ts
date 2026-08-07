import type { Page } from "playwright-core";
import { config } from "./config.js";
import { getFlowTab } from "./browser.js";
import { applySettings, closeSettings, submitPrompt } from "./ui.js";
import { attachReference, clearReferences, uploadImage } from "./reference.js";
import { FlowError, type Aspect, type GeneratedImage } from "./types.js";

/** La llamada interna que dispara la página cuando se pide una imagen. */
const GENERATE_ENDPOINT = "flowMedia:batchGenerateImages";

/**
 * De dónde sale el resultado.
 *
 * En vez de pollear la biblioteca del proyecto esperando que aparezca algo nuevo
 * —frágil, lento y ambiguo si hay varias generaciones en vuelo— escuchamos la
 * respuesta de red de la propia página. Ahí viene ya resuelto el id del medio,
 * sus dimensiones reales y la URL firmada. Es determinístico y no depende de
 * cómo esté renderizada la interfaz ni en qué idioma.
 */
function parseResponse(payload: unknown): GeneratedImage[] {
  const media = (payload as { media?: unknown[] })?.media;
  if (!Array.isArray(media) || media.length === 0) return [];

  const out: GeneratedImage[] = [];
  for (const entry of media) {
    const image = (entry as { image?: Record<string, unknown> })?.image;
    const gen = image?.["generatedImage"] as Record<string, unknown> | undefined;
    const dims = image?.["dimensions"] as { width?: number; height?: number } | undefined;

    const mediaId = (gen?.["mediaId"] ?? (entry as { name?: string })?.name) as string | undefined;
    if (!mediaId) continue;

    out.push({
      mediaId,
      width: dims?.width ?? 0,
      height: dims?.height ?? 0,
      aspect: (gen?.["aspectRatio"] as string) ?? "unknown",
      seed: typeof gen?.["seed"] === "number" ? (gen["seed"] as number) : null,
      signedUrl: (gen?.["fifeUrl"] as string) ?? null,
      effectivePrompt: (gen?.["prompt"] as string) ?? null,
    });
  }
  return out;
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
   * pisan escribiendo el prompt. Con una pestaña por hilo cada una espera su
   * propia respuesta de red y no hay ambigüedad sobre qué imagen es de quién.
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

/** Si tras la última respuesta pasa este rato sin novedad, se entrega lo que haya. */
const SILENCIO_MS = 20_000;

/**
 * Cosecha las imágenes de una generación.
 *
 * Con `count` mayor que uno Flow NO devuelve un arreglo con todas: manda una
 * respuesta HTTP separada por cada imagen, escalonadas por un par de segundos.
 * Esperar "la próxima respuesta" y quedarse con esa —que es lo que hacía este
 * código— descartaba silenciosamente las otras tres, y desde afuera parecía un
 * límite de la cuenta.
 *
 * Por eso acá se escucha el flujo completo y se corta por cualquiera de tres
 * vías: llegaron todas las esperadas, pasó un rato sin novedad, o se agotó el
 * tiempo. Nunca se descarta lo ya recibido.
 */
function collectGenerated(page: Page, esperadas: number, timeoutMs: number): Promise<GeneratedImage[]> {
  return new Promise<GeneratedImage[]>((resolve, reject) => {
    const encontradas: GeneratedImage[] = [];
    let cerrado = false;
    let silencio: ReturnType<typeof setTimeout> | null = null;

    const cerrar = (accion: () => void) => {
      if (cerrado) return;
      cerrado = true;
      page.off("response", onResponse);
      clearTimeout(duro);
      if (silencio) clearTimeout(silencio);
      accion();
    };

    const onResponse = async (res: import("playwright-core").Response) => {
      if (cerrado) return;
      if (!res.url().includes(GENERATE_ENDPOINT) || res.request().method() !== "POST") return;

      if (!res.ok()) {
        const cuerpo = await res.text().catch(() => "");
        return cerrar(() =>
          reject(
            new FlowError(
              `Flow devolvió ${res.status()} al generar.`,
              cuerpo.slice(0, 300) || "Sin cuerpo en la respuesta.",
            ),
          ),
        );
      }

      const nuevas = parseResponse(await res.json().catch(() => null));
      if (nuevas.length === 0) return;
      encontradas.push(...nuevas);

      if (encontradas.length >= esperadas) return cerrar(() => resolve(encontradas));
      if (silencio) clearTimeout(silencio);
      silencio = setTimeout(() => cerrar(() => resolve(encontradas)), SILENCIO_MS);
    };

    const duro = setTimeout(() => {
      cerrar(() => {
        if (encontradas.length > 0) resolve(encontradas);
        else
          reject(
            new FlowError(
              `Envié el prompt pero Flow no respondió en ${Math.round(timeoutMs / 1000)}s.`,
              "Mirá la ventana del navegador: puede haber un cartel de error, un límite de uso o un pedido de reautenticación. No reenvíes a ciegas.",
            ),
          );
      });
    }, timeoutMs);

    page.on("response", onResponse);
  });
}

export interface GenerateResult {
  images: GeneratedImage[];
  quotedCost: number | null;
  quoteText: string;
  page: Page;
}

export async function generateImages(opts: GenerateOptions): Promise<GenerateResult> {
  const maxCost = opts.maxCost ?? config.maxCost;
  const page = opts.page ?? (await getFlowTab()).page;

  // Una referencia olvidada de un turno anterior cambiaría la imagen sin que
  // nada lo indique, y el resultado se le atribuiría al prompt. Se limpia
  // siempre, se vayan a adjuntar referencias nuevas o no.
  await clearReferences(page);

  // Subir el mismo archivo dos veces deja filas duplicadas en la biblioteca y no
  // aporta nada, así que lo ya subido se reusa por nombre.
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
  if (quote.cost === null) {
    await closeSettings(page);
    throw new FlowError(
      "No pude leer cuánto va a costar esta generación, así que no la envío.",
      `El panel decía: "${quote.raw.slice(0, 200)}". Si la interfaz de Flow cambió, abrí un issue con ese texto.`,
    );
  }
  if (quote.cost > maxCost) {
    await closeSettings(page);
    throw new FlowError(
      `Flow cotiza ${quote.cost} puntos y el techo configurado es ${maxCost}. No envié nada, no se gastó nada.`,
      maxCost === 0
        ? "Este servidor viene limitado a generaciones gratuitas. Las imágenes cuestan 0; si esto cotiza más, revisá que el panel haya quedado en modo imagen."
        : "Subí FLOW_MAX_COST solo si sabés lo que estás gastando.",
    );
  }

  await closeSettings(page);

  // Nos suscribimos ANTES de enviar: si la respuesta llegara rapidísimo, un
  // listener tardío se la perdería y quedaríamos esperando para siempre.
  const timeout = opts.timeoutMs ?? config.generateTimeoutMs;
  const cosecha = collectGenerated(page, opts.count, timeout);

  await submitPrompt(page, opts.prompt);

  const images = await cosecha;
  if (images.length === 0) {
    throw new FlowError(
      "Flow respondió correctamente pero no vino ninguna imagen.",
      "Puede haber rechazado el prompt por políticas de contenido. Revisá el chat en el navegador.",
    );
  }

  return { images, quotedCost: quote.cost, quoteText: quote.raw, page };
}
