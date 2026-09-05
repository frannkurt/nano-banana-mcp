#!/usr/bin/env node
/**
 * Levanta Chrome con el puerto de depuración que el servidor necesita, usando un
 * perfil DEDICADO Y PERSISTENTE para Flow.
 *
 * El problema que resuelve: si cada vez se abre Chrome con un `--user-data-dir`
 * distinto (o temporal), el navegador arranca sin cookies y hay que loguearse en
 * Google de nuevo TODAS las veces. Acá el perfil vive siempre en el mismo lugar
 * (`<userData>/nano-banana-flow-profile`), así que te logueás UNA vez y queda
 * logueado para las próximas. Y como es un perfil aparte, no pisa ni bloquea el
 * Chrome que usás para todo lo demás (que puede seguir abierto en paralelo).
 *
 * Uso:
 *   node scripts/launch-chrome.mjs           # abre Flow y queda corriendo
 *   FLOW_CDP_URL=http://127.0.0.1:9333 node scripts/launch-chrome.mjs
 *
 * La primera vez: se abre Flow, iniciás sesión con tu cuenta de Google y abrís (o
 * creás) un proyecto. De ahí en más el servidor MCP se engancha solo por CDP.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const FLOW_URL = "https://flow.google.com";

function cdpPort() {
  const raw = process.env.FLOW_CDP_URL || "http://127.0.0.1:9222";
  const m = /:(\d+)(?:\/|$)/.exec(raw);
  return m ? m[1] : "9222";
}

function chromePath() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const os = platform();
  const candidates =
    os === "win32"
      ? [
          `${process.env["ProgramFiles"] || "C:\\Program Files"}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)"}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.LOCALAPPDATA || ""}\\Google\\Chrome\\Application\\chrome.exe`,
        ]
      : os === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
          ]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return candidates.find((p) => p && existsSync(p)) || null;
}

function profileDir() {
  if (process.env.FLOW_USER_DATA_DIR) return process.env.FLOW_USER_DATA_DIR;
  const os = platform();
  const base =
    os === "win32"
      ? process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
      : os === "darwin"
        ? join(homedir(), "Library", "Application Support")
        : process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(base, "nano-banana-flow-profile");
}

const chrome = chromePath();
if (!chrome) {
  console.error("No encontré chrome.exe / Google Chrome. Definí CHROME_PATH con la ruta al ejecutable.");
  process.exit(1);
}

const port = cdpPort();
const userDataDir = profileDir();
mkdirSync(userDataDir, { recursive: true });

const args = [
  `--remote-debugging-port=${port}`,
  "--remote-allow-origins=*",
  `--user-data-dir=${userDataDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  FLOW_URL,
];

console.log(`Chrome:  ${chrome}`);
console.log(`Perfil:  ${userDataDir}  (persistente: te logueás una sola vez)`);
console.log(`CDP:     http://127.0.0.1:${port}`);
console.log("Abriendo Flow… iniciá sesión y abrí un proyecto la primera vez.");

const child = spawn(chrome, args, { detached: true, stdio: "ignore" });
child.unref();
