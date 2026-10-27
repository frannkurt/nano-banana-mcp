import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { config } from "./config.js";
import { FlowError } from "./types.js";
import { M } from "./i18n.js";

// Google migró Flow de labs.google/fx/tools/flow a flow.google.com/project.
// Aceptamos ambos: el dominio nuevo (donde vive todo hoy) y el viejo por si
// alguna pestaña quedó ahí. La ruta de proyecto perdió el prefijo /tools/flow/.
const FLOW_HOSTS = ["flow.google.com", "labs.google"];
const isFlowUrl = (u: string) => FLOW_HOSTS.some((h) => u.includes(h));
const PROJECT_RE = /\/(?:tools\/flow\/)?project\/([0-9a-f-]{36})/i;

let browser: Browser | null = null;

/** Carpeta de datos del Chrome de todos los días, según el sistema. */
function defaultUserDataDir(): string {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "Google", "Chrome", "User Data");
  }
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "google-chrome");
}

export interface Endpoint {
  url: string;
  /** De dónde salió: variable explícita, el Chrome de todos los días, o el puerto clásico. */
  source: "env" | "user-chrome" | "port";
}

/**
 * A qué Chrome engancharse.
 *
 * Lo preferido es el Chrome que la persona ya usa, con su sesión, sus extensiones
 * y sus pestañas. Chrome no deja abrir `--remote-debugging-port` sobre el perfil
 * de todos los días, pero desde la versión 144 se puede permitir la conexión al
 * navegador abierto en chrome://inspect/#remote-debugging. Con eso activado,
 * Chrome escribe el puerto y la ruta del WebSocket en `DevToolsActivePort`, dentro
 * de su carpeta de datos, y pide permiso a la persona en cada conexión nueva.
 *
 * Orden: FLOW_CDP_URL si está puesta (http://… o ws://…, para un Chrome lanzado a
 * mano); si no, el `DevToolsActivePort` del Chrome de todos los días; si no, el
 * puerto clásico 9222.
 */
export function resolveEndpoint(): Endpoint {
  if (config.cdpUrl) return { url: config.cdpUrl, source: "env" };
  const archivo = path.join(config.chromeUserDataDir || defaultUserDataDir(), "DevToolsActivePort");
  if (existsSync(archivo)) {
    const [puerto, ruta] = readFileSync(archivo, "utf8").split(/\r?\n/);
    if (puerto && /^\d+$/.test(puerto.trim()) && ruta?.trim()) {
      return { url: `ws://127.0.0.1:${puerto.trim()}${ruta.trim()}`, source: "user-chrome" };
    }
  }
  return { url: "http://127.0.0.1:9222", source: "port" };
}

/**
 * Nos enganchamos a un Chrome que ya está corriendo. Nunca lanzamos uno propio ni
 * pedimos credenciales: la sesión es la que la persona abrió a mano, y este
 * proceso solo la usa prestada.
 *
 * La conexión se reusa entre llamadas: con el Chrome de todos los días, cada
 * conexión nueva hace que Chrome pida permiso otra vez.
 */
async function attach(): Promise<BrowserContext> {
  if (!browser || !browser.isConnected()) {
    const ep = resolveEndpoint();
    try {
      browser = await chromium.connectOverCDP(ep.url, { timeout: 60_000 });
    } catch (err) {
      throw new FlowError(M.chromeUnreachable(ep.url, (err as Error).message), M.chromeUnreachableHint());
    }
  }
  const ctx = browser.contexts()[0];
  if (!ctx) throw new FlowError(M.noContext());
  return ctx;
}

export interface FlowTab {
  page: Page;
  context: BrowserContext;
  projectId: string | null;
}

/** Último proyecto usado, para volver a él si no queda ninguna pestaña de Flow. */
const ESTADO = path.join(os.homedir(), ".nano-banana-mcp", "state.json");

function leerUltimoProyecto(): string | null {
  try {
    const j = JSON.parse(readFileSync(ESTADO, "utf8")) as { lastProject?: string };
    return j.lastProject && /^[0-9a-f-]{36}$/i.test(j.lastProject) ? j.lastProject : null;
  } catch {
    return null;
  }
}

function guardarUltimoProyecto(id: string): void {
  try {
    mkdirSync(path.dirname(ESTADO), { recursive: true });
    writeFileSync(ESTADO, JSON.stringify({ lastProject: id }));
  } catch {
    /* recordar el proyecto es una comodidad: si no se puede, no es fatal */
  }
}

/**
 * La ÚNICA pestaña de Flow con la que se trabaja.
 *
 * Se reusa siempre la que ya está abierta (la de un proyecto, si hay). Nunca se
 * abren pestañas de más: si no hay ninguna de Flow, se abre UNA, en el último
 * proyecto usado si se conoce. Las demás pestañas de la persona no se tocan.
 */
export async function getFlowTab(): Promise<FlowTab> {
  const context = await attach();
  const pages = context.pages().filter((p) => isFlowUrl(p.url()));

  let page = pages.find((p) => PROJECT_RE.test(p.url())) ?? pages[0];
  if (page && !PROJECT_RE.test(page.url())) {
    // Flow abierto pero en la portada: la misma pestaña va al último proyecto.
    const ultimo = leerUltimoProyecto();
    if (ultimo) {
      await page.goto(`https://flow.google.com/project/${ultimo}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForSelector('[contenteditable="true"]', { timeout: 60_000 }).catch(() => {});
    }
  }
  if (!page) {
    const ultimo = leerUltimoProyecto();
    page = await context.newPage();
    await page.goto(ultimo ? `https://flow.google.com/project/${ultimo}` : "https://flow.google.com", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    if (!ultimo) throw new FlowError(M.noProjectTab(), M.noProjectTabHint());
    // React monta el compositor después del load.
    await page.waitForSelector('[contenteditable="true"]', { timeout: 60_000 }).catch(() => {});
  }

  const projectId = PROJECT_RE.exec(page.url())?.[1] ?? null;
  if (projectId) guardarUltimoProyecto(projectId);
  return { page, context, projectId };
}

/**
 * Estado de sesión y saldo, leídos por API en vez de raspando el DOM.
 * Ambas llamadas corren dentro de la pestaña, así que la cookie la pone el
 * navegador y nosotros no vemos ningún token.
 */
export interface Status {
  connected: boolean;
  signedIn: boolean;
  account: string | null;
  projectId: string | null;
  url: string;
  credits: number | null;
  tier: string | null;
}

export async function readStatus(): Promise<Status> {
  const { page, projectId } = await getFlowTab();

  const account = await page
    .evaluate(async () => {
      const r = await fetch("/fx/api/auth/session", { credentials: "include" });
      if (!r.ok) return null;
      const j = (await r.json()) as { user?: { email?: string } };
      return j?.user?.email ?? null;
    })
    .catch(() => null)
    // flow.google.com ya no tiene ese endpoint (devuelve la página). La cuenta está
    // en la etiqueta del botón de Google: "Cuenta de Google: Nombre (correo)",
    // en el idioma que sea; se toma el correo entre paréntesis.
    .then(
      (cuenta) =>
        cuenta ??
        page
          .evaluate(() => {
            for (const el of document.querySelectorAll("[aria-label]")) {
              const m = /\(([^()\s]+@[^()\s]+)\)/.exec(el.getAttribute("aria-label") || "");
              if (m) return m[1]!;
            }
            return null;
          })
          .catch(() => null),
    );

  const credits = await readCredits(page);

  return {
    connected: true,
    signedIn: Boolean(account),
    account,
    projectId,
    url: page.url(),
    credits: credits?.credits ?? null,
    tier: credits?.tier ?? null,
  };
}

/**
 * Saldo real desde el backend, en vez de adivinarlo con expresiones regulares
 * sobre el texto de la página.
 *
 * El endpoint de créditos es de otro origen y exige un bearer, que vive en la
 * respuesta de sesión. Toda la cadena — leer el token y usarlo — corre DENTRO de
 * la pestaña: lo único que cruza de vuelta a Node es el número. El token nunca
 * toca este proceso, nunca se loguea y nunca se escribe a disco.
 */
export async function readCredits(page: Page): Promise<{ credits: number; tier: string } | null> {
  return page
    .evaluate(async () => {
      const s = await fetch("/fx/api/auth/session", { credentials: "include" });
      if (!s.ok) return null;
      const token = ((await s.json()) as { access_token?: string })?.access_token;
      if (!token) return null;

      const r = await fetch("https://aisandbox-pa.googleapis.com/v1/credits", {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!r.ok) return null;
      const j = (await r.json()) as { credits?: number; sku?: string };
      if (typeof j.credits !== "number") return null;
      return { credits: j.credits, tier: j.sku ?? "unknown" };
    })
    .catch(() => null);
}

/**
 * Suelta la conexión SIN cerrar el navegador. `browser.close()` sobre una
 * conexión CDP puede cerrar el Chrome entero, y ese Chrome es el de la persona.
 */
export async function disconnect(): Promise<void> {
  browser = null;
}
