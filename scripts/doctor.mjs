#!/usr/bin/env node
/**
 * Diagnóstico de puesta en marcha.
 *
 * Casi todo el soporte que pide este proyecto es la misma media docena de causas:
 * Chrome sin depuración, sesión sin iniciar, o la lista de proyectos en vez de un
 * proyecto abierto. Cada una da un error distinto y ninguno dice qué hacer.
 *
 * Este script las revisa en orden y se detiene en la primera que falla, porque
 * revisar lo de más abajo sin lo de arriba sólo produce ruido. Cada fallo termina
 * en qué hacer, no en qué pasó.
 */
import { config } from "../dist/config.js";
import { lang } from "../dist/i18n.js";

const T = {
  en: {
    title: "nano-banana-mcp — diagnostics",
    out: "Output:  ",
    ceiling: "Ceiling: ",
    chromeOk: (v) => `Chrome reachable — ${v}`,
    chromeBad: (url) => `Nothing is listening on ${url}`,
    chromeFix: (cmd) => `Recommended — use your everyday Chrome (version 144 or newer):
  1. Open chrome://inspect/#remote-debugging
  2. Tick "Allow remote debugging for this browser instance"
  3. Run this again and accept the prompt Chrome shows.

Alternative — a separate Chrome with its own profile, then set FLOW_CDP_URL=http://127.0.0.1:9222:

${cmd}

If you already did and it still fails, it most likely attached to an existing instance:
close EVERY window of that profile and reopen it with the command above.`,
    tabOk: (url) => `Flow tab found — ${url}`,
    tabFix: `Open Flow in that Chrome window and go into a project:
https://flow.google.com`,
    signedOk: (who) => `Signed in — ${who}`,
    signedBad: "The Google session is not signed in on that window",
    signedFix: `Sign in with your Google account in that same Chrome window. This project never asks for or
handles your password: it attaches to the session you open yourself.`,
    projectOk: (id) => `Project open — ${id}`,
    projectBad: "Flow is open but you are not inside a project",
    projectFix: `You're on the project list. Open one: the URL must end up at
flow.google.com/project/<id>

Without an open project there is no composer, and nothing can be generated.`,
    composerOk: "Composer ready",
    composerBad: "The project is open but the composer isn't showing",
    composerFix: `The page may not have finished loading: reload it and try again.
If it persists, Flow's interface may have changed — open an issue using the
"Flow's interface changed" template.`,
    balance: (c, t) => `Balance — ${c ?? "unknown"} credits${t ? ` (${t})` : ""}`,
    done: "All good. Try a real generation:",
  },
  es: {
    title: "nano-banana-mcp — diagnóstico",
    out: "Salida:  ",
    ceiling: "Techo:   ",
    chromeOk: (v) => `Chrome accesible — ${v}`,
    chromeBad: (url) => `No hay ningún Chrome escuchando en ${url}`,
    chromeFix: (cmd) => `Recomendado — usar tu Chrome de todos los días (versión 144 o más nueva):
  1. Abrí chrome://inspect/#remote-debugging
  2. Tildá "Permitir la depuración remota para esta instancia del navegador"
  3. Volvé a correr esto y aceptá el aviso que muestra Chrome.

Alternativa — un Chrome aparte con su propio perfil, y FLOW_CDP_URL=http://127.0.0.1:9222:

${cmd}

Si ya lo lanzaste y sigue fallando, lo más probable es que se haya pegado a una instancia que ya existía:
cerrá TODAS las ventanas de ese perfil y volvé a abrirlo con el comando de arriba.`,
    tabOk: (url) => `Pestaña de Flow encontrada — ${url}`,
    tabFix: `Abrí Flow en esa ventana de Chrome y entrá a un proyecto:
https://flow.google.com`,
    signedOk: (who) => `Sesión iniciada — ${who}`,
    signedBad: "La sesión de Google no está iniciada en esa ventana",
    signedFix: `Entrá con tu cuenta de Google en esa misma ventana de Chrome. Este proyecto nunca pide ni maneja
tu contraseña: se engancha a la sesión que abrís vos.`,
    projectOk: (id) => `Proyecto abierto — ${id}`,
    projectBad: "Hay Flow abierto pero no estás dentro de un proyecto",
    projectFix: `Estás en la lista de proyectos. Abrí uno: la URL tiene que quedar en
flow.google.com/project/<id>

Sin un proyecto abierto no existe el compositor, y no se puede generar.`,
    composerOk: "Compositor listo",
    composerBad: "El proyecto está abierto pero no aparece el compositor",
    composerFix: `Puede que la página no haya terminado de cargar: recargala y volvé a probar.
Si persiste, la interfaz de Flow puede haber cambiado — abrí un issue con el template
"Flow's interface changed".`,
    balance: (c, t) => `Saldo — ${c ?? "desconocido"} puntos${t ? ` (${t})` : ""}`,
    done: "Todo en orden. Probá una generación real:",
  },
}[lang];

const OK = "  ok   ";
const MAL = " FALLA ";

function chau(que, comoArreglarlo) {
  console.log(`${MAL} ${que}\n`);
  console.log(comoArreglarlo.trim() + "\n");
  process.exit(1);
}

/**
 * A esta salida le pedimos que la peguen en los issues, así que no puede llevar
 * la dirección de correo entera: alcanza con que quien reporta vea que es la
 * cuenta que esperaba.
 */
function taparCorreo(correo) {
  if (!correo) return "?";
  const [usuario, dominio] = correo.split("@");
  if (!dominio) return "?";
  return `${usuario.slice(0, 2)}${"*".repeat(Math.max(usuario.length - 2, 1))}@${dominio}`;
}

const chrome = {
  win: `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\\.nano-banana-mcp\\chrome" https://flow.google.com`,
  mac: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir="$HOME/.nano-banana-mcp/chrome" https://flow.google.com`,
  linux: `google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.nano-banana-mcp/chrome" https://flow.google.com`,
};
const lanzar =
  process.platform === "win32" ? chrome.win : process.platform === "darwin" ? chrome.mac : chrome.linux;

console.log(`\n${T.title}\n`);
const { resolveEndpoint } = await import("../dist/browser.js");
const ep = resolveEndpoint();
console.log(`  CDP:     ${ep.source === "user-chrome" ? "Chrome de todos los días / everyday Chrome" : ep.url}`);
console.log(`  ${T.out} ${config.outputDir}`);
console.log(`  ${T.ceiling} ${config.maxCost}\n`);

// 1. ¿Hay un Chrome al que engancharse? Con el Chrome de todos los días no hay
// /json/version: la prueba es conectarse (y Chrome pide permiso).
if (ep.source === "user-chrome") {
  try {
    const { getFlowTab } = await import("../dist/browser.js");
    await getFlowTab();
  } catch (e) {
    if (/connect|ECONNREFUSED|WebSocket|Timeout/i.test(e.message)) chau(T.chromeBad(ep.url), T.chromeFix(lanzar));
  }
  console.log(`${OK} ${T.chromeOk("Chrome")}`);
} else {
  let version;
  try {
    const r = await fetch(new URL("/json/version", ep.url.replace(/^ws/, "http")), { signal: AbortSignal.timeout(4000) });
    version = await r.json();
  } catch {
    chau(T.chromeBad(ep.url), T.chromeFix(lanzar));
  }
  console.log(`${OK} ${T.chromeOk(version["Browser"] ?? "?")}`);
}

// 2. ¿Se puede hablar por CDP y hay una pestaña de Flow?
let status;
try {
  const { readStatus } = await import("../dist/browser.js");
  status = await readStatus();
} catch (e) {
  chau(e.message, e.hint ?? T.tabFix);
}
console.log(`${OK} ${T.tabOk(status.url)}`);

// 3. Sesión iniciada.
if (!status.signedIn) chau(T.signedBad, T.signedFix);
console.log(`${OK} ${T.signedOk(taparCorreo(status.account))}`);

// 4. Proyecto abierto. Sin proyecto no existe el compositor.
if (!status.projectId) chau(T.projectBad, T.projectFix);
console.log(`${OK} ${T.projectOk(status.projectId)}`);

// 5. El compositor en sí, que es lo que se usa para escribir el prompt.
try {
  const { getFlowTab } = await import("../dist/browser.js");
  const { page } = await getFlowTab();
  await page.waitForSelector('[contenteditable="true"]', { timeout: 15_000 });
} catch {
  chau(T.composerBad, T.composerFix);
}
console.log(`${OK} ${T.composerOk}`);
console.log(`${OK} ${T.balance(status.credits, status.tier)}`);

console.log(`\n${T.done}\n`);
console.log(`  node scripts/smoke.mjs "an orange fox on a white background" 1200x630\n`);

// El CDP queda enganchado y mantendría el proceso vivo para siempre.
const { disconnect } = await import("../dist/browser.js");
await disconnect();
process.exit(0);
