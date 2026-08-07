import * as os from "node:os";
import * as path from "node:path";

/**
 * Todo sale del entorno. Este servidor nunca maneja una credencial: se engancha
 * a un Chrome donde una persona ya inició sesión a mano.
 */
export interface Config {
  cdpUrl: string;
  outputDir: string;
  /** Techo de costo en puntos. 0 = solo generaciones gratuitas (imágenes). */
  maxCost: number;
  /** Timeout de una generación completa. */
  generateTimeoutMs: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(): Config {
  return {
    cdpUrl: process.env.FLOW_CDP_URL || "http://127.0.0.1:9222",
    outputDir: path.resolve(process.env.FLOW_OUTPUT_DIR || path.join(os.homedir(), "flow-images")),
    maxCost: envInt("FLOW_MAX_COST", 0),
    generateTimeoutMs: envInt("FLOW_GENERATE_TIMEOUT_MS", 180_000),
  };
}

export const config = loadConfig();
