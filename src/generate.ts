import type { Page } from "playwright-core";
import { config } from "./config.js";
import { getFlowTab } from "./browser.js";
import { applySettings, closeSettings, submitPrompt } from "./ui.js";
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
}

export interface GenerateResult {
  images: GeneratedImage[];
  quotedCost: number | null;
  quoteText: string;
  page: Page;
}

export async function generateImages(opts: GenerateOptions): Promise<GenerateResult> {
  const maxCost = opts.maxCost ?? config.maxCost;
  const { page } = await getFlowTab();

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
  const waiting = page.waitForResponse((r) => r.url().includes(GENERATE_ENDPOINT) && r.request().method() === "POST", {
    timeout,
  });

  await submitPrompt(page, opts.prompt);

  let response;
  try {
    response = await waiting;
  } catch {
    throw new FlowError(
      `Envié el prompt pero Flow no respondió en ${Math.round(timeout / 1000)}s.`,
      "Mirá la ventana del navegador: puede haber un cartel de error, un límite de uso o un pedido de reautenticación. No reenvíes a ciegas.",
    );
  }

  if (!response.ok()) {
    const body = await response.text().catch(() => "");
    throw new FlowError(
      `Flow devolvió ${response.status()} al generar.`,
      body.slice(0, 300) || "Sin cuerpo en la respuesta.",
    );
  }

  const images = parseResponse(await response.json().catch(() => null));
  if (images.length === 0) {
    throw new FlowError(
      "Flow respondió correctamente pero no vino ninguna imagen en la respuesta.",
      "Puede haber rechazado el prompt por políticas de contenido. Revisá el chat en el navegador.",
    );
  }

  return { images, quotedCost: quote.cost, quoteText: quote.raw, page };
}
