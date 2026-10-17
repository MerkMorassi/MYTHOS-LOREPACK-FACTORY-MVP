# CHIP SPEC v1 - how a proper chip is built

A chip is a small sharp tool: one job, zero dependencies, proven live before
it ships. This spec is the contract both realms build to.

## 1. layout

```
scratch/<name>-chip/
  <name>-standalone.js   the tool (dashes, never spaces)
  <snippet>.html          static markup, ONLY if it needs DOM (gate did, bridge did not)
  README.md               the contract (always)
scratch/<name>-chip.zip   the ship (zip of the above, nothing else)
```

## 2. the js

- One IIFE, `"use strict"`, one global: `window.MythosThing = (function(){...})();`
- Node tolerance: `if (typeof module !== "undefined" && module.exports) module.exports = MythosThing;`
- Entry is a factory: `MythosThing.client(opts)` - never bare globals, never
  constructor-new. Options carry the host's specifics (baseUrl, agent, tag,
  containerId, kvFolder, slot, timeouts).
- NO host assumptions. Every host feature is feature-detected with a working
  fallback: kv folder -> localStorage mirror; window.print -> self-paint;
  fetch -> proxy fetch passed in opts. If the fallback cannot work, fail
  CLOSED (gate) or fail LOUD (one honest error line, never silent).
- NO code comments. The why lives in README, not in the file.
- Secrets: never logged, never printed whole - masks only (`first7...last4`).
  Keys live in the host's keyring/panel, never in the chip.
- Storage shape: `{ ts, ... }` records, numeric ms stamps, append-only,
  dedupe by stamp. One file/slot per agent where shared.
- Errors are sentences: `STORE REFUSED (401) :: ...`, `DENIED - ...`,
  `FAILED AFTER 3.2S :: ... :: NOTHING ELSE WAS TOUCHED.`

## 3. the README

Always these sections, in this order:

1. Title line: `# NAME - one-line what (for WHO)`.
2. Origin line: what it was ported from + file + date proven.
3. `## use` - copy-paste block that runs as-is.
4. `## the contract` / `## protocol` - every function/endpoint, exact shapes.
5. `## deliberately left out` - what was NOT ported and what unlocks it.
6. `## honesty note` where it matters - what the chip is NOT (not a lock
   against source readers, not the Authority, etc).

## 4. proof before ship

No chip attaches without all three, in order:

1. Parse: `new Function(src)` must not throw.
2. Live: exercised in the real preview against the real counterpart -
   happy path, refusal path, and idempotence (push twice changes nothing).
3. Residue: test hosts, IDs, and localStorage keys removed after proving.

Then zip (tool files only), `attach_file` the zip, one line in
`src/agent/CHATLOG.md` (date, what, what was left out).

## 5. versioning

Spec changes are `CHIP SPEC vN` with a dated line in CHATLOG. Chips state
the spec they were built to in their README origin line. Breaking changes
mint a new spec version; old chips keep working, they just predate it.
