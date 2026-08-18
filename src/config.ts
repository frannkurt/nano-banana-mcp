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
  /**
   * La UI de Flow (2026-08) dejó de cotizar el costo en el panel de ajustes.
   * Por defecto el portón se niega a enviar cuando el costo no se puede leer.
   * `FLOW_ALLOW_UNQUOTED_COST=1` permite enviar sin cotización: habilita gasto
   * que el servidor no pudo verificar, sólo para quien entiende el riesgo.
   */
  allowUnquotedCost: boolean;
  /**
   * La UI nueva pide confirmación antes de gastar créditos ("Always" por
   * defecto). `FLOW_AGENT_AUTO_CONFIRM=1` autoriza al servidor a cambiarla a
   * "Never" (gasto automático) y guardar. Sin esto, si el panel pide
   * confirmación el servidor falla con una pista en vez de tocar ese switch.
   */
  agentAutoConfirm: boolean;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string): boolean {
  return process.env[name] === "1" || process.env[name]?.toLowerCase() === "true";
}

export function loadConfig(): Config {
  return {
    cdpUrl: process.env.FLOW_CDP_URL || "http://127.0.0.1:9222",
    outputDir: path.resolve(process.env.FLOW_OUTPUT_DIR || path.join(os.homedir(), "nano-banana-images")),
    maxCost: envInt("FLOW_MAX_COST", 0),
    generateTimeoutMs: envInt("FLOW_GENERATE_TIMEOUT_MS", 180_000),
    allowUnquotedCost: envBool("FLOW_ALLOW_UNQUOTED_COST"),
    agentAutoConfirm: envBool("FLOW_AGENT_AUTO_CONFIRM"),
  };
}

export const config = loadConfig();
