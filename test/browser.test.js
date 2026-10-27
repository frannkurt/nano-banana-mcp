import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { config } from "../dist/config.js";
import { resolveEndpoint } from "../dist/browser.js";

// config se lee una vez al importar; para probar cada caso se pisa el objeto.
function conConfig(cambios, fn) {
  const antes = { cdpUrl: config.cdpUrl, chromeUserDataDir: config.chromeUserDataDir };
  Object.assign(config, cambios);
  try {
    return fn();
  } finally {
    Object.assign(config, antes);
  }
}

test("resolveEndpoint usa el Chrome de todos los días si dejó DevToolsActivePort", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "nb-chrome-"));
  // Forma real del archivo: puerto en la primera línea, ruta del WebSocket en la segunda.
  writeFileSync(path.join(dir, "DevToolsActivePort"), "9222\r\n/devtools/browser/abc-123\r\n");
  const ep = conConfig({ cdpUrl: "", chromeUserDataDir: dir }, resolveEndpoint);
  assert.deepEqual(ep, { url: "ws://127.0.0.1:9222/devtools/browser/abc-123", source: "user-chrome" });
});

test("resolveEndpoint cae al puerto 9222 si no hay DevToolsActivePort", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "nb-chrome-"));
  const ep = conConfig({ cdpUrl: "", chromeUserDataDir: dir }, resolveEndpoint);
  assert.deepEqual(ep, { url: "http://127.0.0.1:9222", source: "port" });
});

test("resolveEndpoint ignora un DevToolsActivePort roto", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "nb-chrome-"));
  writeFileSync(path.join(dir, "DevToolsActivePort"), "no-es-un-puerto\n");
  const ep = conConfig({ cdpUrl: "", chromeUserDataDir: dir }, resolveEndpoint);
  assert.equal(ep.source, "port");
});

test("FLOW_CDP_URL explícita gana sobre todo", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "nb-chrome-"));
  writeFileSync(path.join(dir, "DevToolsActivePort"), "9333\n/devtools/browser/x\n");
  const ep = conConfig({ cdpUrl: "http://127.0.0.1:9444", chromeUserDataDir: dir }, resolveEndpoint);
  assert.deepEqual(ep, { url: "http://127.0.0.1:9444", source: "env" });
});
