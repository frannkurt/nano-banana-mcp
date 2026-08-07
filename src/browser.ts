import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { config } from "./config.js";
import { FlowError } from "./types.js";

const FLOW_HOST = "labs.google";
const PROJECT_RE = /\/tools\/flow\/project\/([0-9a-f-]{36})/i;

let browser: Browser | null = null;

/**
 * Nos enganchamos a un Chrome que ya está corriendo con --remote-debugging-port.
 * Nunca lanzamos uno propio ni pedimos credenciales: la sesión es la que la
 * persona abrió a mano, y este proceso solo la usa prestada.
 */
async function attach(): Promise<BrowserContext> {
  if (!browser || !browser.isConnected()) {
    try {
      browser = await chromium.connectOverCDP(config.cdpUrl);
    } catch (err) {
      throw new FlowError(
        `No pude conectarme a Chrome en ${config.cdpUrl}: ${(err as Error).message}`,
        "Abrí Chrome con --remote-debugging-port=9222 y un --user-data-dir propio, después entrá a labs.google/fx/tools/flow. Ver el README.",
      );
    }
  }
  const ctx = browser.contexts()[0];
  if (!ctx) throw new FlowError("Chrome respondió pero no tiene ningún contexto abierto.");
  return ctx;
}

export interface FlowTab {
  page: Page;
  context: BrowserContext;
  projectId: string | null;
}

/** Ubica la pestaña de Flow. Si hay un proyecto abierto, la prefiere. */
export async function getFlowTab(): Promise<FlowTab> {
  const context = await attach();
  const pages = context.pages().filter((p) => p.url().includes(FLOW_HOST));

  if (pages.length === 0) {
    throw new FlowError(
      "No hay ninguna pestaña de labs.google abierta en ese Chrome.",
      "Entrá a labs.google/fx/tools/flow, iniciá sesión y abrí un proyecto.",
    );
  }

  // Una pestaña dentro de un proyecto es la única donde existe el compositor.
  const page = pages.find((p) => PROJECT_RE.test(p.url())) ?? pages[0]!;
  return { page, context, projectId: PROJECT_RE.exec(page.url())?.[1] ?? null };
}

/**
 * Todas las pestañas que tienen un proyecto abierto.
 *
 * Una por hilo es lo que habilita generar en paralelo: el cuello de botella no
 * es la red sino el compositor, que es un único elemento por pestaña.
 */
export async function listFlowTabs(): Promise<FlowTab[]> {
  const context = await attach();
  return context
    .pages()
    .filter((p) => p.url().includes(FLOW_HOST) && PROJECT_RE.test(p.url()))
    .map((page) => ({ page, context, projectId: PROJECT_RE.exec(page.url())?.[1] ?? null }));
}

/**
 * Garantiza al menos `n` pestañas con el proyecto abierto, clonando la primera
 * si faltan. Devuelve exactamente `n`.
 */
export async function ensureFlowTabs(n: number): Promise<FlowTab[]> {
  const existing = await listFlowTabs();
  const first = existing[0];
  if (!first) {
    throw new FlowError(
      "No hay ninguna pestaña con un proyecto de Flow abierto.",
      "Abrí un proyecto en labs.google/fx/tools/flow antes de generar.",
    );
  }

  const tabs = [...existing];
  while (tabs.length < n) {
    const page = await first.context.newPage();
    await page.goto(first.page.url(), { waitUntil: "domcontentloaded", timeout: 60_000 });
    // React monta el compositor despues del load; sin esta espera el primer
    // prompt de esa pestaña se escribiria en el vacio.
    await page.waitForSelector('[contenteditable="true"]', { timeout: 60_000 });
    tabs.push({ page, context: first.context, projectId: first.projectId });
  }
  return tabs.slice(0, n);
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
    .catch(() => null);

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

export async function disconnect(): Promise<void> {
  if (browser?.isConnected()) await browser.close();
  browser = null;
}
