import sharp from "sharp";
import { promises as fs } from "node:fs";
import * as path from "node:path";

/**
 * Flow genera en cinco relaciones fijas. Un encargo de diseño real casi nunca cae
 * justo en una de ellas: un Open Graph son 1200x630, un banner 1456x180. Así que
 * generamos en la relación nativa más cercana y recortamos acá al tamaño exacto.
 *
 * El recorte usa la estrategia `attention` de sharp, que centra la ventana en la
 * zona de mayor entropía en vez de en el centro geométrico. En la práctica es la
 * diferencia entre conservar al sujeto o decapitarlo.
 */
export interface FitOptions {
  width: number;
  height: number;
  /** `cover` recorta para llenar; `contain` mete todo y rellena los bordes. */
  fit?: "cover" | "contain";
  /** Color de relleno para `contain`. */
  background?: string;
}

export async function writeImage(
  bytes: Buffer,
  outFile: string,
  fitTo?: FitOptions,
): Promise<{ file: string; width: number; height: number; bytes: number }> {
  await fs.mkdir(path.dirname(outFile), { recursive: true });

  let pipeline = sharp(bytes);

  if (fitTo) {
    pipeline = pipeline.resize({
      width: fitTo.width,
      height: fitTo.height,
      fit: fitTo.fit ?? "cover",
      position: (fitTo.fit ?? "cover") === "cover" ? sharp.strategy.attention : "centre",
      background: fitTo.background ?? "#ffffff",
      withoutEnlargement: false,
    });
  }

  // El formato sale de la extensión pedida, no de lo que haya devuelto Flow.
  const ext = path.extname(outFile).toLowerCase();
  if (ext === ".png") pipeline = pipeline.png({ compressionLevel: 9 });
  else if (ext === ".webp") pipeline = pipeline.webp({ quality: 92 });
  else pipeline = pipeline.jpeg({ quality: 92, mozjpeg: true });

  const buf = await pipeline.toBuffer();
  await fs.writeFile(outFile, buf);

  const meta = await sharp(buf).metadata();
  return { file: outFile, width: meta.width ?? 0, height: meta.height ?? 0, bytes: buf.length };
}

/** Nombre de archivo seguro a partir de un prompt, para cuando no se pide uno. */
export function slugify(text: string, max = 40): string {
  const base = text
    // NFD separa la tilde de la letra; \p{M} barre esas marcas combinantes.
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return base || "imagen";
}
