<!-- One concern per pull request. -->

## What this changes

## Why

<!-- For DOM fixes this is the valuable part. What did you observe that proved the old behaviour was wrong?
     Paste the geometry or the dump — with any tokens stripped. -->

## How it was tested

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Tested by hand against a live Flow project

<!-- Anything touching the browser can't run in CI. If you tested by hand, say which browser interface language
     you tested in — the UI anchors are meant to be language-independent and that's exactly where it breaks. -->

Interface language tested in:

## Confirmations

- [ ] This does not touch reCAPTCHA, tokens, or automated sign-in
- [ ] This does not remove the cost gate or raise the default `FLOW_MAX_COST` above 0
- [ ] No new dependency, or the reason for it is explained above
