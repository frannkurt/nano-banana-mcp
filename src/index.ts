#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import sharp from "sharp";
import * as path from "node:path";

import { config } from "./config.js";
import { getFlowTab, readStatus } from "./browser.js";
import { generateImages } from "./generate.js";
import { fetchMedia } from "./download.js";
import { slugify, writeImage } from "./image.js";
import { ASPECT_KEYS, FlowError, nearestAspect, parseSize, type Aspect } from "./types.js";
import { M } from "./i18n.js";

const server = new McpServer({ name: "nano-banana-mcp", version: "0.1.0" });

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

function fail(err: unknown) {
  const e = err as FlowError;
  const text = e instanceof FlowError && e.hint ? `${e.message}\n\n${e.hint}` : ((e?.message ?? String(err)) as string);
  return { isError: true as const, content: [{ type: "text" as const, text }] };
}

/**
 * El estado se pega en informes de error y además queda en el contexto del
 * modelo, así que la dirección va tapada: alcanza con poder confirmar que es la
 * cuenta esperada, la dirección entera no aporta nada.
 */
function taparCorreo(correo: string | null): string | null {
  if (!correo) return null;
  const [usuario, dominio] = correo.split("@");
  if (!dominio || !usuario) return "?";
  return `${usuario.slice(0, 2)}${"*".repeat(Math.max(usuario.length - 2, 1))}@${dominio}`;
}

/**
 * Miniatura para que el modelo pueda ver lo que salió sin arrastrar un megabyte
 * de base64 por el protocolo. Sin esto, generar a ciegas y esperar que esté bien
 * es lo único que se puede hacer.
 */
async function preview(bytes: Buffer): Promise<Content> {
  const thumb = await sharp(bytes).resize({ width: 512, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
  return { type: "image", data: thumb.toString("base64"), mimeType: "image/jpeg" };
}

server.tool(
  "flow_status",
  M.toolStatus(),
  {},
  async () => {
    try {
      const s = await readStatus();
      const lines = [
        M.statusBrowser(config.cdpUrl),
        M.statusSession(s.signedIn ? taparCorreo(s.account) : null),
        M.statusProject(s.projectId),
        M.statusCredits(s.credits, s.tier),
        M.statusCeiling(config.maxCost),
        M.statusOutput(config.outputDir),
      ];
      if (!s.projectId) {
        lines.push("", M.statusNoProject());
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "generate_image",
  M.toolGenerate(),
  {
    prompt: z.string().min(1).describe(M.argPrompt()),
    size: z
      .string()
      .optional()
      .describe(M.argSize()),
    aspect: z
      .enum(ASPECT_KEYS as [Aspect, ...Aspect[]])
      .optional()
      .describe(M.argAspect()),
    count: z.number().int().min(1).max(4).default(1).describe(M.argCount()),
    reference_images: z
      .array(z.string())
      .optional()
      .describe(M.argReferenceImages()),
    reference_library_names: z
      .array(z.string())
      .optional()
      .describe(M.argReferenceLibrary()),
    out_dir: z.string().optional().describe(M.argOutDir()),
    basename: z.string().optional().describe(M.argBasename()),
    format: z.enum(["jpg", "png", "webp"]).default("jpg").describe(M.argFormat()),
    fit: z
      .enum(["cover", "contain"])
      .default("cover")
      .describe(M.argFit()),
    background: z.string().optional().describe(M.argBackground()),
  },
  async (args) => {
    try {
      const target = args.size ? parseSize(args.size) : null;
      const aspect: Aspect = args.aspect ?? (target ? nearestAspect(target.width, target.height) : "1:1");

      const { images, quotedCost } = await generateImages({
        prompt: args.prompt,
        aspect,
        count: args.count,
        referenceImages: args.reference_images,
        referenceLibraryNames: args.reference_library_names,
      });

      const { page } = await getFlowTab();
      const dir = path.resolve(args.out_dir ?? config.outputDir);
      const base = args.basename ? slugify(args.basename) : slugify(args.prompt);

      // Las descargas no comparten estado entre sí: en paralelo, que con count=4
      // la espera es la de la más lenta y no la suma de las cuatro.
      const results = await Promise.all(
        images.map(async (img, i) => {
          const bytes = await fetchMedia(page, img.mediaId, img.signedUrl);
          const suffix = images.length > 1 ? `-${i + 1}` : "";
          const out = path.join(dir, `${base}${suffix}.${args.format}`);
          const res = await writeImage(
            bytes,
            out,
            target ? { ...target, fit: args.fit, background: args.background } : undefined,
          );
          return {
            line: `${res.file}  (${res.width}x${res.height}, ${Math.round(res.bytes / 1024)} KB, id ${img.mediaId})`,
            thumb: await preview(bytes),
          };
        }),
      );
      const content: Content[] = results.map((r) => r.thumb);
      const saved = results.map((r) => r.line);

      const header = [
        M.resultHeader(images.length, quotedCost),
        M.resultNative(aspect, images[0]?.width ?? 0, images[0]?.height ?? 0),
        target ? M.resultCropped(target.width, target.height, args.fit) : M.resultNative0(),
        "",
        ...saved,
      ];

      // Pedir más grande que el nativo no genera más detalle: lo interpola. El
      // archivo sale del tamaño pedido igual, así que sin avisar esto se lee como
      // si el modelo hubiera generado a esa resolución.
      const nativo = images[0];
      if (target && nativo?.width && (target.width > nativo.width || target.height > nativo.height)) {
        header.push("", M.upscaleWarning(target.width, target.height, nativo.width, nativo.height));
      }

      // Flow a veces reescribe o traduce el prompt; conviene saber qué pidió de verdad.
      const effective = images[0]?.effectivePrompt;
      if (effective && effective.trim() !== args.prompt.trim()) {
        header.push("", M.effectivePrompt(effective.slice(0, 300)));
      }

      return { content: [{ type: "text" as const, text: header.join("\n") }, ...content] };
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "download_image",
  M.toolDownload(),
  {
    media_id: z.string().describe(M.argMediaId()),
    out_file: z.string().describe(M.argOutFile()),
    size: z.string().optional().describe(M.argSizePlain()),
    fit: z.enum(["cover", "contain"]).default("cover"),
    background: z.string().optional().describe(M.argBackground()),
  },
  async (args) => {
    try {
      const { page } = await getFlowTab();
      const bytes = await fetchMedia(page, args.media_id);
      const target = args.size ? parseSize(args.size) : null;
      const out = path.resolve(args.out_file);
      const res = await writeImage(
        bytes,
        out,
        target ? { ...target, fit: args.fit, background: args.background } : undefined,
      );
      return {
        content: [
          {
            type: "text" as const,
            text: M.savedAs(res.file, res.width, res.height, Math.round(res.bytes / 1024)),
          },
          await preview(bytes),
        ],
      };
    } catch (err) {
      return fail(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(M.ready(config.cdpUrl, config.outputDir, config.maxCost));
