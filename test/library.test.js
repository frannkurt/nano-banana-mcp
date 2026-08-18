import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProjectContents } from "../dist/library.js";

// Forma real (recortada) de la respuesta de flow.projectInitialData.
const payload = {
  result: {
    data: {
      json: {
        projectContents: {
          workflows: [
            { name: "wf-1", metadata: { displayName: "Blue paper origami fox" } },
            { name: "wf-2", metadata: { displayName: "test-e2e-fox.jpg" } },
          ],
          media: [
            {
              name: "gen-1",
              workflowId: "wf-1",
              mediaMetadata: {
                createTime: "2026-08-18T07:19:45Z",
                requestData: { promptInputs: [{ textInput: "the same origami fox but made of blue paper" }] },
              },
              image: { dimensions: { width: 1024, height: 1024 } },
            },
            {
              name: "up-1",
              workflowId: "wf-2",
              mediaMetadata: { createTime: "2026-08-18T07:19:26Z", requestData: {} },
              image: { userUploadedImage: {}, dimensions: { width: 1200, height: 630 } },
            },
            // Un audio del proyecto: no tiene image y debe quedar afuera.
            { name: "audio-1", workflowId: "wf-3", mediaMetadata: { createTime: "2026-08-18T07:00:00Z" } },
          ],
        },
      },
    },
  },
};

test("parseProjectContents distingue subidas de generadas y las nombra", () => {
  const items = parseProjectContents(payload);
  assert.equal(items.length, 2);

  const [gen, up] = items; // más recientes primero
  assert.equal(gen.kind, "generated");
  assert.equal(gen.displayName, "Blue paper origami fox");
  assert.equal(gen.prompt, "the same origami fox but made of blue paper");
  assert.equal(gen.width, 1024);

  assert.equal(up.kind, "uploaded");
  assert.equal(up.displayName, "test-e2e-fox.jpg");
  assert.equal(up.prompt, null);
  assert.equal(up.mediaId, "up-1");
});

test("parseProjectContents ordena más recientes primero", () => {
  const items = parseProjectContents(payload);
  assert.deepEqual(
    items.map((i) => i.mediaId),
    ["gen-1", "up-1"],
  );
});

test("parseProjectContents tolera payloads vacíos o rotos", () => {
  assert.deepEqual(parseProjectContents(null), []);
  assert.deepEqual(parseProjectContents({}), []);
  assert.deepEqual(parseProjectContents({ result: { data: { json: {} } } }), []);
});
