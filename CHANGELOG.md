# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [0.3.0] — 2026-09-05

### Added

- **Upscaling with Flow's own upscaler.** New `upscale` parameter (`2k` or `4k`) on `generate_image` and
  `download_image`, and a new `upscale_image` tool for media that already exists in the open project. 2K is free,
  takes about 10 s per image and doubles the native size (1376x768 → 2752x1536, 1024² → 2048²); it is the only way to
  get real detail beyond native, since a larger `size` alone just interpolates. 4K is detected as disabled on free
  accounts and reported instead of attempted. Verified live on flow.google.com.

### Changed

- The upscaler works against the new Angular frontend: the tile is located by its `data-media-id` attribute (the
  thumbnail `src` is now a proxy URL without the id), and the result is taken from the download the page itself
  starts after Download → 2K, via Playwright's `download` event, instead of the old `flow/upsampleImage` response
  that the migration removed.
- `sniffImage()` exported from `download.ts` so any module can check that a buffer is really an image before
  saving it.

## [0.2.0] — 2026-08-18

### Added

- **`list_library` tool.** Lists every image in the project library, newest first, read straight from the
  `flow.projectInitialData` API instead of scraping the reference picker. Uploads come with the exact filename that
  `reference_library_names` expects; generated images come with their original prompt and media id. Filter with
  `only`: `uploaded`, `generated` or `all`.
- **`generate_batch` tool.** Generates up to 4 **different** prompts at once, one browser tab per prompt, each job
  with its own optional `size`, `aspect` and `basename`. One failed job doesn't sink the rest. Verified live:
  2 jobs in ~26 s versus ~50 s sequentially.
- **`background` parameter** on `generate_image` and `download_image`: padding color (any CSS color) when
  `fit="contain"`. Previously always white.
- **`startGeneration()` library API** in `generate.ts`: submits a generation and returns without waiting, exposing
  the harvest as a promise. This is what makes real parallelism possible from scripts (see README, "Generating in
  parallel").

### Changed

- **Parallel generation reworked into two phases.** The pattern previously documented in the README
  (`Promise.all` over `generateImages` on several tabs) did not actually work: Chrome freezes
  `requestAnimationFrame` in background tabs, so React never processes the clicks and the settings panel never
  opens. Now the UI phase (settings + submit, a few seconds per job) runs one tab at a time via `bringToFront`,
  and only the wait for Flow's answer — where nearly all the time goes — runs in parallel. Both READMEs updated
  accordingly.
- `generate_image` now downloads multiple results (`count` > 1) in parallel instead of one by one.
- Test suite grew from 5 to 13 tests: `parseResponse` (the network-response parser, including fallbacks and broken
  payloads), `slugify`, and the new library parser `parseProjectContents`.

## [0.1.1] — 2026-08-18

### Security

- **Upgraded `sharp` 0.34 → 0.35.3**, clearing four high-severity CVEs inherited from libvips
  (CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591 — GHSA-f88m-g3jw-g9cj).
  `npm audit` now reports 0 vulnerabilities. No API changes were needed.

## [0.1.0] — 2026-08-07

Initial release: `flow_status`, `generate_image` (exact pixel sizes, reference images, cost gate) and
`download_image`, in English and Spanish.
