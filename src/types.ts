import { M } from "./i18n.js";

/**
 * Las cinco relaciones de aspecto que ofrece Flow.
 *
 * `ligature` es el nombre del icono de Material Symbols que la UI renderiza como
 * texto dentro del elemento. Es un identificador, no copy: no se traduce cuando
 * la interfaz cambia de idioma. Por eso anclamos ahi y no en la etiqueta visible.
 */
export const ASPECTS = {
  "16:9": { ligature: "crop_16_9", ratio: 16 / 9 },
  "4:3": { ligature: "crop_landscape", ratio: 4 / 3 },
  "1:1": { ligature: "crop_square", ratio: 1 },
  "3:4": { ligature: "crop_portrait", ratio: 3 / 4 },
  "9:16": { ligature: "crop_9_16", ratio: 9 / 16 },
} as const;

export type Aspect = keyof typeof ASPECTS;
export const ASPECT_KEYS = Object.keys(ASPECTS) as Aspect[];

/** Elige la relación nativa más cercana a un tamaño pedido, en escala log. */
export function nearestAspect(width: number, height: number): Aspect {
  const target = width / height;
  let best: Aspect = "1:1";
  let bestDelta = Infinity;
  for (const key of ASPECT_KEYS) {
    // Distancia logarítmica: 2:1 y 1:2 quedan igual de lejos de 1:1.
    const delta = Math.abs(Math.log(ASPECTS[key].ratio / target));
    if (delta < bestDelta) {
      bestDelta = delta;
      best = key;
    }
  }
  return best;
}

/** Parsea "1200x630" -> {width, height}. */
export function parseSize(size: string): { width: number; height: number } {
  const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(size.trim());
  if (!m) throw new Error(M.badSize(size));
  const width = Number.parseInt(m[1]!, 10);
  const height = Number.parseInt(m[2]!, 10);
  if (width < 16 || height < 16 || width > 8192 || height > 8192) {
    throw new Error(M.sizeOutOfRange(width, height));
  }
  return { width, height };
}

export interface GeneratedImage {
  mediaId: string;
  width: number;
  height: number;
  aspect: string;
  seed: number | null;
  /** URL firmada del CDN. Caduca, así que se usa apenas se recibe. */
  signedUrl: string | null;
  /** El prompt que Flow terminó usando (a veces reescribe o traduce el tuyo). */
  effectivePrompt: string | null;
}

export class FlowError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "FlowError";
  }
}
