import { test } from "node:test";
import assert from "node:assert/strict";
import { parseResponse } from "../dist/generate.js";
import { slugify } from "../dist/image.js";

// Forma real (recortada) de una respuesta de flowMedia:batchGenerateImages.
const respuesta = {
  media: [
    {
      name: "aaaa-1111",
      image: {
        dimensions: { width: 1376, height: 768 },
        generatedImage: {
          mediaId: "aaaa-1111",
          aspectRatio: "IMAGE_ASPECT_RATIO_LANDSCAPE",
          seed: 42,
          fifeUrl: "https://flow-content.google/image/aaaa-1111?sig=x",
          prompt: "a fox",
        },
      },
    },
  ],
};

test("parseResponse extrae id, dimensiones, seed, URL y prompt efectivo", () => {
  const [img] = parseResponse(respuesta);
  assert.equal(img.mediaId, "aaaa-1111");
  assert.equal(img.width, 1376);
  assert.equal(img.height, 768);
  assert.equal(img.seed, 42);
  assert.equal(img.signedUrl, "https://flow-content.google/image/aaaa-1111?sig=x");
  assert.equal(img.effectivePrompt, "a fox");
});

test("parseResponse cae en name cuando falta generatedImage.mediaId", () => {
  const [img] = parseResponse({ media: [{ name: "bbbb-2222", image: {} }] });
  assert.equal(img.mediaId, "bbbb-2222");
  assert.equal(img.width, 0);
  assert.equal(img.seed, null);
});

test("parseResponse ignora payloads sin media y entradas sin id", () => {
  assert.deepEqual(parseResponse(null), []);
  assert.deepEqual(parseResponse({}), []);
  assert.deepEqual(parseResponse({ media: [] }), []);
  assert.deepEqual(parseResponse({ media: [{ image: {} }] }), []);
});

test("slugify limpia tildes, espacios y símbolos", () => {
  assert.equal(slugify("Un Ñandú veloz, ¡al 100%!"), "un-nandu-veloz-al-100");
  assert.equal(slugify("  ---  "), "imagen");
});

test("slugify corta a lo pedido sin dejar guion colgando", () => {
  const s = slugify("una frase bastante larga que se pasa del limite maximo", 20);
  assert.ok(s.length <= 20);
  assert.ok(!s.endsWith("-"));
});
