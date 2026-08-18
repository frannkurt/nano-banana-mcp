import type { Page } from "playwright-core";
import { FlowError } from "./types.js";
import { M } from "./i18n.js";

/**
 * BIBLIOTECA DEL PROYECTO
 *
 * Flow expone el contenido completo de un proyecto en un solo endpoint tRPC,
 * `flow.projectInitialData`: cada medio con sus dimensiones y metadatos, y los
 * workflows que les dan nombre. Leerlo por API evita abrir el selector de
 * referencias sólo para mirar, que además de lento deja la interfaz en un estado
 * que después hay que deshacer.
 *
 * La llamada corre DENTRO de la pestaña, igual que las de sesión y créditos: la
 * cookie la pone el navegador y a este proceso solo cruza el JSON resultante.
 *
 * Qué es cada cosa en la respuesta:
 *
 *   - `projectContents.media[]`: los medios en sí. Los subidos a mano llevan
 *     `image.userUploadedImage`; los generados llevan el prompt en
 *     `mediaMetadata.requestData.promptInputs`.
 *   - `projectContents.workflows[]`: el nombre visible de cada uno. Para una
 *     subida es el nombre de archivo original — exactamente lo que acepta
 *     `reference_library_names` — y para una generación, el título que Flow
 *     le puso.
 */

export interface LibraryItem {
  kind: "uploaded" | "generated";
  mediaId: string;
  /** Nombre de archivo para subidas; título de Flow para generadas. */
  displayName: string;
  width: number;
  height: number;
  createTime: string;
  /** Prompt con el que se generó, si aplica. */
  prompt: string | null;
}

interface RawProject {
  result?: {
    data?: {
      json?: {
        projectContents?: {
          workflows?: { name?: string; metadata?: { displayName?: string } }[];
          media?: {
            name?: string;
            workflowId?: string;
            mediaMetadata?: {
              createTime?: string;
              requestData?: { promptInputs?: { textInput?: string }[] };
            };
            image?: {
              userUploadedImage?: unknown;
              dimensions?: { width?: number; height?: number };
            };
          }[];
        };
      };
    };
  };
}

/** Parte pura: de la respuesta cruda del endpoint a la lista ordenada. */
export function parseProjectContents(payload: RawProject | null): LibraryItem[] {
  const contents = payload?.result?.data?.json?.projectContents ?? {};

  const names = new Map<string, string>();
  for (const wf of contents.workflows ?? []) {
    if (wf?.name && wf?.metadata?.displayName) names.set(wf.name, wf.metadata.displayName);
  }

  const out: LibraryItem[] = [];
  for (const m of contents.media ?? []) {
    // Un proyecto también puede tener audio y video; acá solo interesan imágenes.
    if (!m?.name || !m.image) continue;
    out.push({
      kind: m.image.userUploadedImage ? "uploaded" : "generated",
      mediaId: m.name,
      displayName: names.get(m.workflowId ?? "") ?? "",
      width: m.image.dimensions?.width ?? 0,
      height: m.image.dimensions?.height ?? 0,
      createTime: m.mediaMetadata?.createTime ?? "",
      prompt: m.mediaMetadata?.requestData?.promptInputs?.[0]?.textInput ?? null,
    });
  }

  // Más recientes primero, que es el orden en que se las busca.
  out.sort((a, b) => (a.createTime < b.createTime ? 1 : -1));
  return out;
}

export async function listLibrary(page: Page, projectId: string): Promise<LibraryItem[]> {
  const payload = (await page
    .evaluate(async (pid) => {
      const input = encodeURIComponent(JSON.stringify({ json: { projectId: pid } }));
      const r = await fetch(`/fx/api/trpc/flow.projectInitialData?input=${input}`, { credentials: "include" });
      if (!r.ok) return { failed: r.status };
      return (await r.json()) as unknown;
    }, projectId)
    .catch(() => null)) as (RawProject & { failed?: number }) | null;

  if (!payload || payload.failed) {
    throw new FlowError(M.libraryFetchFailed(payload?.failed ?? 0), M.libraryFetchFailedHint());
  }

  return parseProjectContents(payload);
}
