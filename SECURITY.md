# Security

## Reporting

Report privately through
[GitHub's advisory form](https://github.com/frannkurt/nano-banana-mcp/security/advisories/new). Don't open a public
issue for anything involving credentials, tokens or account access.

## What this software does with your credentials

**Nothing.** It attaches over the Chrome DevTools Protocol to a browser window you launched and signed into yourself.
It never sees, stores, requests or transmits a password.

The one credential it comes near is the Flow session token used to read your credit balance. That token is fetched
and used **inside the page**, via `page.evaluate`. It never crosses into the Node process, is never written to disk,
and is never logged. If you change that code, keep it that way.

Nothing is sent anywhere except Google Flow.

## If you're reporting a leak

Flow's own network responses can carry `access_token` values and JWTs. If you're reporting that something leaks one,
**describe where it appears — don't paste the token itself**, not even in a private advisory. If you already pasted
one somewhere public, revoke the session first: sign out of that Chrome profile, then report.

## Scope

In scope:

- A token, cookie or credential reaching disk, logs, stdout, or any process outside the browser tab.
- The cost gate being bypassable — anything that spends credits without the quoted cost being read and checked first.
- Path traversal or arbitrary writes through `out_dir`, `out_file` or `basename`.
- Reference-image uploads reaching anywhere other than the user's own Flow project.

Out of scope:

- That it automates a browser at all. That's the design, and it's documented.
- Vulnerabilities in Google Flow itself — report those to Google.
- Anything requiring an attacker who already controls the machine or the Chrome profile. At that point the session
  is theirs regardless of this software.

## A note on what this project won't accept

Flow's generation endpoint is protected by reCAPTCHA Enterprise. This project does not forge, replay or bypass that
token, and will not merge anything that does. It isn't a limitation waiting to be solved — it's bot-detection evasion,
and it would put users' Google accounts at risk.
