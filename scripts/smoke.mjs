/**
 * Prueba de humo de punta a punta, sin pasar por MCP.
 *
 * Sirve para verificar la instalación y para depurar cuando algo se rompe: acá
 * los errores salen directos en la consola en vez de envueltos en el protocolo.
 *
 *   node scripts/smoke.mjs "un zorro naranja sobre fondo blanco" 1200x630
 *
 * Genera una imagen real en tu cuenta. Las imágenes cuestan 0 puntos.
 */
import { readStatus, getFlowTab } from "../dist/browser.js";
import { generateImages } from "../dist/generate.js";
import { fetchMedia } from "../dist/download.js";
import { writeImage, slugify } from "../dist/image.js";
import { nearestAspect, parseSize } from "../dist/types.js";
import { config } from "../dist/config.js";
import * as path from "node:path";

const prompt = process.argv[2] ?? "un zorro naranja sobre fondo blanco, estilo plano, minimalista";
const sizeArg = process.argv[3] ?? null;

console.log("== estado ==");
const status = await readStatus();
console.log(status);
if (!status.projectId) {
  console.error("\nNo hay proyecto abierto en Flow. Abrí uno y volvé a intentar.");
  process.exit(1);
}

const target = sizeArg ? parseSize(sizeArg) : null;
const aspect = target ? nearestAspect(target.width, target.height) : "1:1";
console.log(`\n== generando ==\nprompt: ${prompt}\naspecto: ${aspect}${target ? `  ->  recorte ${target.width}x${target.height}` : ""}`);

const t0 = Date.now();
const { images, quotedCost, quoteText } = await generateImages({ prompt, aspect, count: 1 });
console.log(`\ncotizacion: ${quotedCost} puntos  ("${quoteText.slice(0, 80)}")`);
console.log(`respuesta en ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(images);

const { page } = await getFlowTab();
for (const img of images) {
  const bytes = await fetchMedia(page, img.mediaId, img.signedUrl);
  const out = path.join(config.outputDir, `${slugify(prompt)}.jpg`);
  const res = await writeImage(bytes, out, target ? { ...target, fit: "cover" } : undefined);
  console.log(`\nOK  ${res.file}  ${res.width}x${res.height}  ${Math.round(res.bytes / 1024)} KB`);
}

process.exit(0);
