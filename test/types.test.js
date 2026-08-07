import { test } from "node:test";
import assert from "node:assert/strict";
import { nearestAspect, parseSize } from "../dist/types.js";

test("parseSize acepta formatos razonables", () => {
  assert.deepEqual(parseSize("1200x630"), { width: 1200, height: 630 });
  assert.deepEqual(parseSize(" 800 X 600 "), { width: 800, height: 600 });
  assert.deepEqual(parseSize("1080×1080"), { width: 1080, height: 1080 });
});

test("parseSize rechaza basura y tamaños absurdos", () => {
  assert.throws(() => parseSize("grande"));
  assert.throws(() => parseSize("1200"));
  assert.throws(() => parseSize("4x4"));
  assert.throws(() => parseSize("99999x100"));
});

test("nearestAspect elige la relación nativa correcta", () => {
  assert.equal(nearestAspect(1920, 1080), "16:9");
  assert.equal(nearestAspect(1080, 1080), "1:1");
  assert.equal(nearestAspect(1080, 1920), "9:16");
  assert.equal(nearestAspect(1024, 768), "4:3");
  assert.equal(nearestAspect(768, 1024), "3:4");
});

test("nearestAspect es simétrico: 2:1 y 1:2 caen en los extremos correctos", () => {
  // La distancia logarítmica evita que las relaciones anchas ganen siempre por
  // tener numeros mas grandes.
  assert.equal(nearestAspect(1200, 600), "16:9");
  assert.equal(nearestAspect(600, 1200), "9:16");
});

test("nearestAspect cae en 1:1 para cuadrados imperfectos", () => {
  assert.equal(nearestAspect(1000, 1010), "1:1");
});
