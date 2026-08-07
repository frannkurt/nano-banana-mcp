# Contributing

Thanks for being here. This project is small and the surface area is well defined, so a useful contribution doesn't
have to be big.

> Documentation and issues are in English. **Code comments and error messages are in Spanish** — that's deliberate and
> not up for migration, but you never need to write Spanish to contribute. Write comments in whichever of the two you
> think in; consistency of *meaning* matters more than consistency of language.

## The one thing worth understanding first

Flow has no public API, and its generation call is signed by a reCAPTCHA Enterprise token minted inside the page.
**That token cannot be reproduced from outside the browser, and this project will never try.** Any pull request that
fabricates, replays, or works around it will be closed — it's bot-detection evasion, and it would also get users'
accounts banned.

Everything else follows from that constraint. We drive a real browser because it's the only honest way in.

## Where the fragility lives

Almost all breakage is in one place: **reading and clicking Flow's interface**. That's `src/ui.ts` and
`src/reference.ts`. Google ships UI changes without notice, and when they do, the failure is usually a click that
lands on the wrong element and reports success.

The rest is stable by design. `src/generate.ts` reads results off the network response, not the DOM, so it survives
redesigns.

| File               | What it does                                          | How fragile        |
| ------------------ | ----------------------------------------------------- | ------------------ |
| `src/browser.ts`   | Attaches over CDP, finds Flow tabs, reads status       | Low                |
| `src/ui.ts`        | Settings panel, cost quote, prompt submission          | **High** — the DOM |
| `src/reference.ts` | Upload, attach from library, clear                     | **High** — the DOM |
| `src/generate.ts`  | Cost gate, network interception, collecting results    | Low                |
| `src/download.ts`  | Fetching media bytes                                   | Low                |
| `src/image.ts`     | Cropping and encoding                                  | None — pure        |
| `src/types.ts`     | Aspect maths, parsing, errors                          | None — pure        |

## Rules for touching the DOM code

These aren't style preferences. Each one is a bug we already shipped.

**Never select by visible text.** Flow's UI is localised — the same button reads "Add to prompt", "Añadir a la
petición" or "プロンプトに追加" depending on the account. Anchor on Material Symbols ligature names (`crop_16_9`,
`add_2`, `image`) and numeric labels (`16:9`, `x4`). Those are identifiers, not copy.

**Click the element that has the handler, not the one that has the text.** Several nested elements often contain the
same string: the row, an inner wrapper, and a loose label. React only listens on one of them. Clicking a label
succeeds silently and attaches nothing, which is the worst failure mode because it looks like it worked. Filter
candidates by geometry — a real row has plausible width and height; a label is thin.

**Use `page.mouse.click`, not `element.click()`.** React ignores synthetic events on many of these controls.

**Wait for the element, never for a clock.** `waitForTimeout(1800)` passes on your machine and fails on a project with
a lot of media — that is, exactly when it matters. Poll for what you need.

**Verify the effect, don't assume it.** After a click that should change state, check that the state changed. If it
didn't, throw with a message that says what you tried.

### How to actually debug one of these

Don't guess at selectors. Dump reality first. Write a throwaway script that attaches to your live tab and prints the
candidates with their geometry:

```js
const { getFlowTab } = await import("./dist/browser.js");
const { page } = await getFlowTab();

const cands = await page.evaluate(() => {
  const dlg = document.querySelector("[role=dialog][data-state=open]") ?? document.body;
  return [...dlg.querySelectorAll("button,[role=button]")]
    .filter((e) => e.offsetParent)
    .map((e) => {
      const r = e.getBoundingClientRect();
      return {
        txt: (e.innerText || "").trim().slice(0, 40),
        box: `${Math.round(r.width)}x${Math.round(r.height)}`,
        pos: `${Math.round(r.x)},${Math.round(r.y)}`,
      };
    });
});
console.log(cands);
await page.screenshot({ path: "state.png" });
```

The screenshot next to the geometry is what tells you which candidate is the real control. That's how the library
picker's confirm button was found: two buttons sat in the dialog's bottom strip, and only their widths told them
apart — 368px for confirm, 120px for upload.

**Redact before pasting.** Flow responses can carry `access_token` values and JWTs. Never paste raw network output
into an issue or a commit without stripping them.

## Setup

```bash
git clone https://github.com/frannkurt/nano-banana-mcp.git
cd nano-banana-mcp
npm install
npm run build
```

You need a Chrome running with remote debugging and a Flow project open — see the README's setup section. Then:

```bash
node scripts/doctor.mjs
```

That tells you whether the browser, session, project and composer are all reachable before you start changing things.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

CI runs all three on Node 20, 22 and 24. The unit tests cover the pure modules only — anything touching the browser
can't run in CI, so **test UI changes by hand and say so in the pull request**, including which browser language you
tested in.

## Pull requests

- One concern per pull request.
- Say what you observed, not just what you changed. For DOM fixes, the *why* is the valuable part — include the
  geometry or the dump that proves the old selector was wrong.
- If you fixed something that silently did nothing, say so explicitly. Those are the bugs that waste the most time.
- No dependencies without a reason in the description. The install footprint is a feature.

## What's welcome

- Fixes for Flow UI changes — the most valuable thing you can send.
- Setup and troubleshooting reports from macOS and Linux. This was built on Windows and gets the least testing
  elsewhere.
- Non-Spanish, non-English UI testing. If the ligature anchors hold in your language, say so; if they don't, that's a
  bug.
- Video and scene support. It's on the roadmap and not started — open an issue before writing much, so we agree on the
  cost-gate design first. Nothing that spends credits may run from a default.

## What isn't

- Anything that touches reCAPTCHA, tokens, or automated sign-in.
- Headless or CI-based generation. It needs a real signed-in window; pretending otherwise just moves the failure.
- Removing the cost gate, or defaulting `FLOW_MAX_COST` above 0.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
