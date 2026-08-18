import type { Page } from "playwright-core";
import { config } from "./config.js";
import { getFlowTab } from "./browser.js";
import { applySettings, closeSettings, enableAutoGenerate, submitPrompt } from "./ui.js";
import { attachReference, clearReferences, uploadImage } from "./reference.js";
import { FlowError, type Aspect, type GeneratedImage } from "./types.js";
import { M } from "./i18n.js";

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
export function parseResponse(payload: unknown): GeneratedImage[] {
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
 * Cosecha los resultados de la UI nueva (2026-08): el agente de Flow habla por
 * SSE (`flowCreationAgent:streamChat`) y entrega los medios generados como
 * eventos `agentEvents[].toolResult` del tool `generate_image`; el endpoint
 * antiguo (`flowMedia:batchGenerateImages`) ya no se dispara. Ambas rutas
 * conviven: la UI vieja sigue viva en otras cuentas, así que el colector acepta
 * las dos.
 */
function parseSseToolResults(payload: string): GeneratedImage[] {
  const out: GeneratedImage[] = [];
  for (const line of payload.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    let json: unknown;
    try {
      json = JSON.parse(line.slice(6).trim());
    } catch {
      continue;
    }
    const events = (json as { agentMessage?: { agentEvents?: unknown[] } })?.agentMessage?.agentEvents;
    for (const ev of events ?? []) {
      const tr = (ev as { toolResult?: { toolName?: string; toolResult?: Record<string, unknown> } })
        ?.toolResult;
      if (!tr || tr.toolName !== "generate_image") continue;
      const res = tr.toolResult as { media_id?: string; status?: string; display_name?: string };
      if (!res.media_id || (res.status && res.status !== "success")) continue;
      out.push({
        mediaId: res.media_id,
        width: 0,
        height: 0,
        aspect: "unknown",
        seed: null,
        signedUrl: null,
        effectivePrompt: res.display_name ?? null,
      });
    }
  }
  return out;
}

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
      const url = res.url();
      const esSse = url.includes("streamChat");
      if (!url.includes(GENERATE_ENDPOINT) && !esSse) return;
      if (!esSse && res.request().method() !== "POST") return;

      if (!res.ok()) {
        const cuerpo = await res.text().catch(() => "");
        return cerrar(() =>
          reject(
            new FlowError(M.generateFailed(res.status()), cuerpo.slice(0, 300) || M.emptyBody()),
          ),
        );
      }

      let nuevas: GeneratedImage[] = [];
      if (esSse) {
        nuevas = parseSseToolResults(await res.text().catch(() => ""));
      } else {
        nuevas = parseResponse(await res.json().catch(() => null));
      }
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
            new FlowError(M.noAnswer(Math.round(timeoutMs / 1000)), M.noAnswerHint()),
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
 * fondo: les congela requestAnimationFrame, así que React no procesa los clics
 * y la interfaz no responde. Manipular la UI exige la pestaña en primer plano.
 * Esperar la respuesta de red, en cambio, funciona igual con la pestaña tapada.
 *
 * Entonces, para varias generaciones a la vez: la fase de UI —unos segundos por
 * pestaña— se hace de a una con `bringToFront`, y la espera —que es lo que de
 * verdad tarda— corre en paralelo para todas.
 */
export async function startGeneration(opts: GenerateOptions): Promise<StartedGeneration> {
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
  // todavía es gratis. La UI nueva (2026-08) no cotiza el costo en el panel, así
  // que "no se pudo leer" se niega por defecto: gastar créditos porque un default
  // lo permitió es exactamente lo que este servidor no hace. La única salida es
  // un opt-in explícito (FLOW_ALLOW_UNQUOTED_COST=1) para quien entiende qué
  // habilita.
  if (quote.cost === null && !config.allowUnquotedCost) {
    await closeSettings(page);
    throw new FlowError(M.costUnreadable(), M.costUnreadableHint(quote.raw.slice(0, 200)));
  }
  if (quote.cost !== null && quote.cost > maxCost) {
    await closeSettings(page);
    throw new FlowError(
      M.costTooHigh(quote.cost, maxCost),
      maxCost === 0 ? M.costTooHighHintZero() : M.costTooHighHint(),
    );
  }

  // La UI nueva pide confirmación antes de gastar créditos ("Always" por
  // defecto). Ese switch es el freno de seguridad de la persona: nunca se toca
  // por cuenta propia, sólo con opt-in (FLOW_AGENT_AUTO_CONFIRM=1). En la UI
  // vieja el control no existe y esto es un no-op.
  await enableAutoGenerate(page, config.agentAutoConfirm);

  await closeSettings(page);

  // Nos suscribimos ANTES de enviar: si la respuesta llegara rapidísimo, un
  // listener tardío se la perdería y quedaríamos esperando para siempre.
  const timeout = opts.timeoutMs ?? config.generateTimeoutMs;
  const cosecha = collectGenerated(page, opts.count, timeout).then((images) => {
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
