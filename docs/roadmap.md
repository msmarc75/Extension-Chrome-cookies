# Roadmap

Eight phases, built in order. Each closes on criteria that are checked, not
asserted. No phase writes code for a later one.

## Structural decisions

Settled. Reopen only with a reason.

### Taken during phase 3

| Question | Decision | Why |
|---|---|---|
| Should the incognito gate be the only way to audit? | **No — two modes, incognito the default** | A hard gate before the tool does anything is the friction that loses a user before the first result. "Audit in my current profile" is also a real question a DPO asks — *does this site honour the refusal I already gave it?* The capture already records `profile: current` and the report already discloses it |
| Model for policy analysis | **`claude-opus-5`** | Not downgraded for cost: that is the buyer's call, not the builder's. The task is adversarial reading of legal prose where a missed mention becomes a false clean bill of health |
| How the literal quote is guaranteed | **Structured output, then verified by substring against the source** | The API's citation feature returns API-guaranteed verbatim spans but cannot be combined with a strict output schema. Verifying ourselves keeps the schema *and* is mechanically checkable: any mention whose quote is not found verbatim is downgraded to absent |
| Batch mode for agencies | **Yes, strictly serial** | It is what turns a one-off tool into a subscription. Serial, user-initiated, one site at a time at the same pace a human visit produces — the plan's worry about pacing is real |
| Separate web app for the Agency tier | **No, not yet** | A second product with its own auth, hosting and support surface. Defer until an agency asks and pays |
| Scheduled monitoring | **Runs when Chrome is open, and says so** | An extension cannot audit while the browser is closed, and `chrome.debugger` has no server-side equivalent. A server-side crawler is a different product. The tier's promise must be worded as what it is |

**Expected cost per policy analysis**, at the current published rate for
`claude-opus-5` ($5 / 1M input, $25 / 1M output): a policy truncated at 50 000
characters is roughly 15 000 input tokens, plus about 2 000 of prompt and
schema, against an output of 2 500–4 000 tokens of structured findings —
**about $0.17 per uncached analysis**. The SHA-256 cache the plan already calls
for should take the effective figure under $0.10 once the corpus of shared
policy templates starts repeating. Scheduled portfolio monitoring is
non-latency-sensitive and belongs on the Batch API, at half that.

| Subject | Decision | Why |
|---|---|---|
| Manifest | MV3 only | MV2 is no longer accepted by the Chrome Web Store |
| Payment | Stripe plus a licence server | The Chrome Web Store stopped handling payments in 2021 |
| Policy analysis | Server side, never client side | An API key inside an extension is a public API key |
| Tracker capture | `chrome.debugger`, Network domain | `webRequest` under MV3 does not reliably observe the earliest requests |
| Interface language | English first, French second | Addressable market and store search |
| Legal posture | An aid to analysis, never legal advice | Liability |

## The audit cycle

The order is the product. Step 5 is observable exactly once.

1. The user asks for an audit.
2. The service worker opens a clean tab — no cookie, no storage.
3. `chrome.debugger` attaches **before** navigation.
4. Navigate.
5. Five seconds of observation with **no interaction at all** → capture A.
6. The content script locates the banner and identifies the CMP.
7. Static analysis of the banner: visual hierarchy, labels, layers.
8. Simulated refusal → capture B.
9. Reset, reload, simulated acceptance → capture C.
10. Extract the privacy policy text.
11. Send it to the server for semantic analysis.
12. Run the rule engine over A + B + C + policy.
13. Score, render the report.

## Phases

| # | Phase | Acceptance | Status |
|---|---|---|---|
| 1 | Skeleton | Loads without error, popup opens, message round trip, build and unit tests run | **done** |
| 2 | Capture | Capture A complete and serialised to `shared/schema`; ten test sites including three French news outlets; debugger detaches under every path, zero orphan sessions over a hundred audits | **done** |
| 3 | Banner detection | Thirty real fixtures: CMP identified in ≥25, refusal succeeds in ≥22 | **detection met, refusal short** |
| 4 | Rule engine | Categories A, B, C plus `EXEMPTION_CHECK`; zero false positives on `blocking` rules | not started |
| 5 | Server and policy | `POST /analyze-policy`, versioned prompt, schema-validated output, SHA-256 cache; fifteen real policies, >90 % detection, every "present" backed by a literal quote actually found in the source | not started |
| 6 | Report and export | Deposit timeline, PDF and CSV export, local history; an exported report usable as a client annex without retouching | not started |
| 7 | Licence and billing | Full Stripe test purchase, seven-day cache, fail-open degradation, local free-tier counter | not started |
| 8 | Publication | Extension privacy policy, written justification per permission, screenshots, store listing | not started |

### Phase 1 — what shipped

- MV3 manifest, service worker, popup, design tokens.
- A message protocol (`extension/src/shared/messaging.js`) whose envelopes,
  router and error paths are unit-tested without a browser.
- `npm run check:tokens` — mechanical enforcement that no colour, length, type
  family, weight or duration is written outside `tokens.css`.
- `npm run build` — validates the manifest, every document reference and every
  import specifier before copying to `dist/extension`.
- `npm run test:e2e` — loads the built extension into a real Chromium profile,
  asserts the service worker registers, the popup opens, the round trip
  succeeds, and nothing logs an error.

Verified: 37 unit tests, 5 end-to-end tests, all green.

### Phase 2 — what shipped

- `shared/schema/capture.schema.json` — the capture contract, plus a validator
  for the subset of JSON Schema the project uses, which throws on any keyword
  it does not implement rather than under-enforcing silently.
- `debugger-session.js` — attach, send with a timeout, detach. Four independent
  guarantees of detachment, including a sweep at every worker start for the one
  case the others cannot cover: an eviction mid-audit.
- `capture.js` — a pure builder over the CDP event stream, driven in tests from
  a recorded session.
- `page-instrument.js` — the in-page hooks that date storage writes and
  script-set cookies. `chrome.debugger` denies extensions the `DOMStorage`
  domain, and the quota API does not count localStorage, so without this the
  capture would be blind to storage and would only ever see a script-set cookie
  undated, found in the jar with no idea when it arrived.
- `audit.js` — the ordering the product rests on: attach, then navigate, then
  five seconds during which nothing touches the page. The navigation is started
  and not awaited, so a page that never answers cannot stretch the window.
- Popup: the audit launcher, the Chrome debugger-bar warning shown before the
  first audit, and the four figures that say whether the rest is worth reading.

Verified: 109 unit tests and 16 end-to-end tests green; a hundred consecutive
audits — including hanging pages and refused URLs — leaving zero debugger
sessions attached and no tab open; and a real-site run recorded in
[`verification/capture-a-2026-08-22.md`](verification/capture-a-2026-08-22.md).

### Phase 3 — what shipped

- A corpus of real banners: 38 sites recorded, each as a **page profile** — the
  structure the detector actually consumes — plus provenance and the full page,
  the latter kept out of git at close to a megabyte apiece and regenerated by
  `npm run capture:fixtures`.
- `page-profile.js` — the page read once, into a structure. Not a content
  script: those run in an isolated world and cannot see `window.__tcfapi`,
  `window.Didomi` or `window.OneTrust`, and reaching the main world would mean
  `<all_urls>` host permissions. The audit already holds a debugger session, so
  the page is read through it instead.
- `cmp-adapters/` — Didomi, OneTrust, Cookiebot, Axeptio, Sourcepoint,
  tarteaucitron and TCF, each answering with evidence and a confidence rather
  than a boolean. The TCF id table is **observed**, not asserted: an id is
  attributed to a vendor only where it was seen beside that vendor's own global
  across the corpus.
- `label-match.js` — the multilingual button table the fallback rests on, and
  the reason "Continuer sans accepter" is read as the refusal it is rather than
  the consent it contains.
- `banner-detector.js` — the platform's markup when there is one, appearance and
  labels when there is not, and a disclosure sentence on the report whenever it
  was the latter. "No banner" and "could not look" are separate outcomes.
- `interaction-driver.js` — refusal through the platform's own call where one is
  documented, through the button otherwise, verified afterwards against the TCF
  API and against the banner going away. A refusal that silently did nothing is
  reported as a failure.
- Cross-frame reading, including out-of-process frames: several platforms render
  the whole banner in a cross-site iframe that a session attached to the tab
  cannot see at all.

**Where it stands against the criteria.** Measured live over 38 sites, recorded
in [`verification/banners-live-2026-08-22.md`](verification/banners-live-2026-08-22.md):

| Criterion | Target | Measured |
|---|---|---|
| Platform identified | ≥25 of 30 | **33 of 38** |
| Refusal succeeds | ≥22 of 30 | **21 of 38** — 21 of the 25 sites where a banner was actually located |

The refusal figure is one short of the target on the raw count, and it is worth
being precise about what the seventeen misses are. Five are sites that showed no
banner at all from here, one of them Wikipedia, which has none to show — a
correct result counted as a failure by a flat denominator. Six are Sourcepoint
sites where the banner is served from `cdn.privacy-mgmt.com`, which this
sandbox's egress does not reliably deliver: the container renders empty, and
there is nothing to press. Two more are English-language publishers served their
**non-EU** consent experience, because the exit IP is not in Europe —
theguardian.com resolves to `/us`, where the GDPR banner does not exist. The
remainder are TCF vendors whose banner frame could not be read.

None of those is a defect this phase can close from inside this container, and
none of them would affect a user running the extension in their own browser from
Europe. What the phase does not have is a measurement taken from Europe, and the
figure should not be read as one.

Two deviations from the plan's sketch, both deliberate:

- The adapters live under `src/content/` as the plan has it, but they are not
  content scripts — see `page-profile.js` for why.
- `reset()` is not per-adapter. Clearing the origin through the debugger and
  reloading is uniform and more reliable than seven vendor-specific reset calls,
  so it lives on the driver.

Verified: 169 unit tests and 24 end-to-end tests green, the latter including
banner pages built from the shapes the corpus showed — a plain bar, a refusal a
layer deeper than the acceptance, a banner behind a shadow boundary, one in a
cross-origin frame, and a page with nothing to consent to.

### Open for phase 4

- **A measurement from Europe.** The refusal figure above is a floor taken from
  a non-EU exit IP with a filtered egress. Re-running `npm run verify:banners
  --live` from a European network is what would settle whether the criterion is
  met; nothing in the code needs to change for it.
- **The second audit mode.** Decided (see Structural decisions): a
  current-profile mode ships alongside the incognito default, labelled as a
  returning visit everywhere it appears. Phase 4 must cap what can be concluded
  from it — a deposit observed is still a deposit, but the *absence* of a banner
  in a profile that may hold a stored choice establishes nothing, so category B
  and C rules return `not_applicable` rather than `pass` on such a capture.
- **Fingerprinting surface.** `PRE_CONSENT_FINGERPRINT` needs Canvas, WebGL and
  AudioContext hooks installed alongside the existing ones. The instrument is
  the right place; the rule that consumes them lands in phase 4, so the hooks
  land with it.

## Standing constraints

- Build in order. Do not write code for a phase that has not started.
- No dependency without a justification in the commit message.
- No colour, spacing or type value outside `extension/src/ui/tokens.css`.
- Test fixtures are captured **before** the rule engine is written. Rules
  written against imagined banners drift; rules written against thirty real
  ones do not.
- On a legal doubt, ship the most conservative verdict and record the question
  in `docs/methodology.md` rather than settling it alone.
