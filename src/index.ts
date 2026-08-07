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

const server = new McpServer({ name: "flow-image-mcp", version: "0.1.0" });

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

function fail(err: unknown) {
  const e = err as FlowError;
  const text = e instanceof FlowError && e.hint ? `${e.message}\n\n${e.hint}` : ((e?.message ?? String(err)) as string);
  return { isError: true as const, content: [{ type: "text" as const, text }] };
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
  "Comprueba la conexión con el Chrome de Google Flow: sesión iniciada, cuenta, proyecto abierto y saldo de puntos. Llamalo primero si algo falla.",
  {},
  async () => {
    try {
      const s = await readStatus();
      const lines = [
        `Navegador:  conectado (${config.cdpUrl})`,
        `Sesión:     ${s.signedIn ? `iniciada como ${s.account}` : "SIN INICIAR"}`,
        `Proyecto:   ${s.projectId ?? "ninguno abierto"}`,
        `Saldo:      ${s.credits ?? "desconocido"} puntos${s.tier ? ` (${s.tier})` : ""}`,
        `Techo:      ${config.maxCost} puntos por generación`,
        `Salida:     ${config.outputDir}`,
      ];
      if (!s.projectId) {
        lines.push("", "Abrí un proyecto en Flow: sin proyecto no existe el compositor y no se puede generar.");
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "generate_image",
  "Genera una o varias imágenes con Google Flow y las guarda en disco. Podés pedir un tamaño exacto en píxeles (por ejemplo 1200x630): se genera en la relación de aspecto nativa más cercana y se recorta al tamaño pedido. Las imágenes no consumen puntos.",
  {
    prompt: z.string().min(1).describe("Descripción de la imagen. En cualquier idioma."),
    size: z
      .string()
      .optional()
      .describe('Tamaño exacto de salida, formato "ANCHOxALTO", por ejemplo "1200x630". Si se omite, se usa el nativo.'),
    aspect: z
      .enum(ASPECT_KEYS as [Aspect, ...Aspect[]])
      .optional()
      .describe("Relación de aspecto nativa. Si se omite y hay `size`, se elige la más cercana."),
    count: z.number().int().min(1).max(4).default(1).describe("Cuántas variantes generar (1 a 4)."),
    out_dir: z.string().optional().describe("Carpeta destino. Por defecto, la configurada en FLOW_OUTPUT_DIR."),
    basename: z.string().optional().describe("Nombre base de los archivos. Por defecto se deriva del prompt."),
    format: z.enum(["jpg", "png", "webp"]).default("jpg").describe("Formato de salida."),
    fit: z
      .enum(["cover", "contain"])
      .default("cover")
      .describe('Cómo encajar en `size`: "cover" recorta para llenar, "contain" mete todo y rellena bordes.'),
  },
  async (args) => {
    try {
      const target = args.size ? parseSize(args.size) : null;
      const aspect: Aspect = args.aspect ?? (target ? nearestAspect(target.width, target.height) : "1:1");

      const { images, quotedCost } = await generateImages({
        prompt: args.prompt,
        aspect,
        count: args.count,
      });

      const { page } = await getFlowTab();
      const dir = path.resolve(args.out_dir ?? config.outputDir);
      const base = args.basename ? slugify(args.basename) : slugify(args.prompt);

      const content: Content[] = [];
      const saved: string[] = [];

      for (const [i, img] of images.entries()) {
        const bytes = await fetchMedia(page, img.mediaId, img.signedUrl);
        const suffix = images.length > 1 ? `-${i + 1}` : "";
        const out = path.join(dir, `${base}${suffix}.${args.format}`);
        const res = await writeImage(bytes, out, target ? { ...target, fit: args.fit } : undefined);
        saved.push(`${res.file}  (${res.width}x${res.height}, ${Math.round(res.bytes / 1024)} KB, id ${img.mediaId})`);
        content.push(await preview(bytes));
      }

      const header = [
        `${images.length} imagen(es) generada(s). Costo: ${quotedCost} puntos.`,
        `Relación nativa: ${aspect} (Flow devolvió ${images[0]?.width}x${images[0]?.height})`,
        target ? `Recortadas a ${target.width}x${target.height} con fit=${args.fit}.` : "Sin recorte: tamaño nativo.",
        "",
        ...saved,
      ];

      // Flow a veces reescribe o traduce el prompt; conviene saber qué pidió de verdad.
      const effective = images[0]?.effectivePrompt;
      if (effective && effective.trim() !== args.prompt.trim()) {
        header.push("", `Prompt efectivo que usó Flow: ${effective.slice(0, 300)}`);
      }

      return { content: [{ type: "text" as const, text: header.join("\n") }, ...content] };
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "download_image",
  "Descarga una imagen ya existente en Flow a partir de su id de medio, con recorte opcional a un tamaño exacto.",
  {
    media_id: z.string().describe("Id del medio, tal como lo devuelve generate_image."),
    out_file: z.string().describe("Ruta de salida. La extensión decide el formato."),
    size: z.string().optional().describe('Tamaño exacto, formato "ANCHOxALTO".'),
    fit: z.enum(["cover", "contain"]).default("cover"),
  },
  async (args) => {
    try {
      const { page } = await getFlowTab();
      const bytes = await fetchMedia(page, args.media_id);
      const target = args.size ? parseSize(args.size) : null;
      const out = path.resolve(args.out_file);
      const res = await writeImage(bytes, out, target ? { ...target, fit: args.fit } : undefined);
      return {
        content: [
          {
            type: "text" as const,
            text: `Guardada en ${res.file} (${res.width}x${res.height}, ${Math.round(res.bytes / 1024)} KB)`,
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
console.error(`flow-image-mcp listo — CDP ${config.cdpUrl}, salida ${config.outputDir}, techo ${config.maxCost} puntos`);
