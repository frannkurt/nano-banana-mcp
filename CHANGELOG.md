# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added

- **`generate_video` tool** (Veo inside Flow). Text-to-video in 16:9 or 9:16. Video costs credits, so it only runs
  when `FLOW_MAX_COST` is raised above the quoted cost; otherwise it refuses before submitting. On the new UI the
  result is taken from the video tile: open it, Download → "720p" (original size), via Playwright's `download`
  event. 1080p/4K are upscales and are never chosen. Verified live with three 8 s clips.

### Fixed

- **Media type click hit the sidebar.** "image Imágenes" / "videocam Vídeos" in the left rail matched the same
  ligature as the panel options, so the click closed the settings panel and every following step failed
  ("couldn't find the 16:9 option"). The panel option, which is drawn later in the DOM, now wins, and the panel is
  reopened if choosing the media type closed it.
- **Stuck after upscaling.** Download → 2K leaves Flow in the media detail view, where the settings trigger opens
  nothing. Every image and video generation now starts with `ensureComposer()`, which goes back to the project URL
  when it sees the detail view, an open dialog or menu, or no settings trigger.
- **Old images returned as new.** The project grid is virtual: an old tile that was off the DOM when the "before"
  snapshot was taken could show up later and be harvested as the new result. Only media that appear above every
  pre-existing one count, and an id is never returned twice in the same process.
- **Reference upload on the new UI.** There is no fixed `<input type="file">` any more: the composer's `add`
  button opens the picker, its `upload` button raises a file chooser, and the upload is confirmed when the file
  name shows up in the list. That happens through `batchexecute`, so there's no readable id. The picker closes
  itself shortly after an upload, so the attach waits for it to close and starts clean. Picker rows (which start
  with the `image` ligature) are preferred over grid tiles that show the same file name.
- **Rights notice.** If Flow asks to confirm the rights over an uploaded image, the connector stops and says so
  instead of clicking "accept": accepting terms is up to the person. In practice it is asked once per account.

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
