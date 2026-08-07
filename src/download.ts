import type { Page } from "playwright-core";
import { FlowError } from "./types.js";

/** Firmas de archivo, para que un cuerpo JSON de error nunca se guarde como .jpg. */
const SIGNATURES: { ext: string; test: (b: Buffer) => boolean }[] = [
  { ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: "png",
    test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  { ext: "webp", test: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
];

const MIN_BYTES = 2_000;

/**
 * Trae los bytes de un medio.
 *
 * Detalle que cuesta una tarde descubrir: esto NO se puede hacer con fetch desde
 * adentro de la página. El endpoint responde 307 hacia flow-content.google, que
 * es otro origen y no manda cabeceras CORS, así que el navegador aborta el
 * redirect. El APIRequestContext de Playwright comparte el mismo tarro de
 * cookies pero no pasa por CORS, y sigue el redirect sin problema.
 */
export async function fetchMedia(page: Page, mediaId: string, signedUrl?: string | null): Promise<Buffer> {
  const api = page.context().request;
  const referer = page.url();

  const attempts = [
    // La URL firmada que vino en la respuesta de generación: directa y sin auth.
    signedUrl ?? null,
    // Resolución por id. Sirve siempre, también para medios viejos cuya URL
    // firmada ya caducó.
    `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${encodeURIComponent(mediaId)}`,
  ].filter((u): u is string => Boolean(u));

  const errors: string[] = [];
  for (const url of attempts) {
    try {
      const res = await api.get(url, { headers: { referer }, timeout: 60_000 });
      if (!res.ok()) {
        errors.push(`${res.status()} en ${url.split("?")[0]}`);
        continue;
      }
      const bytes = Buffer.from(await res.body());
      const sig = SIGNATURES.find((s) => s.test(bytes));
      if (!sig) {
        errors.push(`respuesta sin firma de imagen en ${url.split("?")[0]} (${bytes.length} bytes)`);
        continue;
      }
      if (bytes.length < MIN_BYTES) {
        errors.push(`solo ${bytes.length} bytes en ${url.split("?")[0]}`);
        continue;
      }
      return bytes;
    } catch (err) {
      errors.push(`${(err as Error).message} en ${url.split("?")[0]}`);
    }
  }

  throw new FlowError(`No pude descargar el medio ${mediaId}.`, errors.join("; "));
}
