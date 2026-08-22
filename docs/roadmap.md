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
| How the literal quote is guaranteed | **Structured output, then verified by substring against the source** | The API's citation feature returns API-guaranteed verbatim spans but cannot be combined with a strict output schema. Verifying ourselves keeps the schema *and* is mechanically checkable. ~~Any mention whose quote is not found verbatim is downgraded to absent~~ — **revised in phase 5**: such a mention becomes `unverified`, which is neither present nor absent. Downgrading to absent would turn the tool's own uncertainty into an accusation against the site |
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
| 4 | Rule engine | Categories A, B, C plus `EXEMPTION_CHECK`; zero false positives on `blocking` rules | **done** |
| 5 | Server and policy | `POST /analyze-policy`, versioned prompt, schema-validated output, SHA-256 cache; fifteen real policies, >90 % detection, every "present" backed by a literal quote actually found in the source | **built; the live measurement needs a key** |
| 6 | Report and export | Deposit timeline, PDF and CSV export, local history; an exported report usable as a client annex without retouching | **done** |
| 7 | Licence and billing | Full Stripe test purchase, seven-day cache, fail-open degradation, local free-tier counter | **built; the test purchase needs Stripe keys** |
| 8 | Publication | Extension privacy policy, written justification per permission, screenshots, store listing | **done** |

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

### Phase 4 — what shipped

Sixteen rules, each carrying its legal basis, its evidence, its remediation
sentence and — for every `blocking` one — a written note on how it could be
wrong. A rule that cannot cite anything throws at load rather than shipping.

| Category | Rules |
|---|---|
| A — deposit | `PRE_CONSENT_TRACKERS` (blocking, 12), `PRE_CONSENT_COOKIES` (blocking, 10), `PRE_CONSENT_STORAGE` (7), `PRE_CONSENT_FINGERPRINT` (6), `EXEMPTION_CHECK` (informational, 0) |
| B — fairness | `REFUSE_SAME_LAYER` (blocking, 8), `REFUSE_EQUAL_PROMINENCE` (6), `NO_PRECHECKED` (blocking, 5), `NO_COOKIE_WALL` (blocking, 4), `GRANULARITY` (4), `WITHDRAWAL_ACCESSIBLE` (2), `NO_DARK_PATTERN` (1) |
| C — information | `PURPOSES_STATED` (6), `CONTROLLERS_IDENTIFIED` (6), `POLICY_REACHABLE` (4), `RETENTION_STATED` (4) |

- `engine/data/trackers.js` — the classification table, **written by this
  project** rather than imported. DuckDuckGo's Tracker Radar is licensed CC
  BY-NC-SA 4.0, whose NonCommercial clause makes it unusable in a paid product;
  the plan's assumption of a permissive licence is wrong. The table names
  categories, and only `advertising`, `analytics` and `social` count as a
  deposit — a publisher's own CDN on a second domain is not a tracker.
- `engine/data/exemptions.js` — what does not need consent, and on which ground.
  Anchored name patterns, never substrings: a loose match on "id" would exempt
  half the web.
- `engine/colour.js` — WCAG relative luminance and surface area, so
  "the refusal is less prominent" is a pair of numbers a designer can check
  rather than an impression.
- `engine/scoring.js` — a failed blocking rule caps the score at 49; rules that
  did not apply are excluded rather than counted as passes; anything under 80 %
  coverage is marked provisional; and the score is never returned or rendered
  without its band and its counts.
- Popup: the score block, which shows the number, the band wording and the
  fail/warn/not-applicable counts together or not at all.

**Where it stands against the criteria.** `npm run verify:rules` runs the
rulebook over all 38 recorded fixtures and prints **every** blocking failure with
its evidence, in
[`verification/rules-2026-08-22.md`](verification/rules-2026-08-22.md). The 53
blocking failures were read one by one against the fixture that produced them;
all are substantiated. The six sites in the corpus with nothing to answer for —
wikipedia, cnil, gov-uk, seloger, telegraph, nu-nl — carry none.

Two false positives were found that way and fixed rather than tolerated:

- **Wikipedia failed `PRE_CONSENT_COOKIES` on the first run.** The rule was
  inverting the exemption — treating "not on the list" as "not necessary". It now
  counts only what it can positively identify as non-necessary and raises the
  rest for review. See `docs/methodology.md`.
- **Analytics-only calls were failing `PRE_CONSENT_TRACKERS` outright.** The
  CNIL's measurement exemption is conditional on things no capture can see, so
  those are now a `warn` that says exactly that.

Two deviations from what phase 3 left open, both deliberate:

- **The current-profile cap is a tempering, not a blanket
  `not_applicable`.** Phase 3 proposed that category B and C rules return
  `not_applicable` on a capture taken in the user's own profile. That would
  discard true findings: a banner whose refusal is buried is buried whoever is
  looking. What cannot be concluded from such a capture is *when* something was
  deposited, so a `fail` there becomes a `warn` carrying the reason and the
  suggestion to re-run in a clean window, and the rules that judge the banner as
  it stands are unaffected.
- **The fingerprinting hooks install defensively.** The first version threw when
  a global was absent — `HTMLCanvasElement` in a bare frame — and took the
  cookie hook down with it, silently. The wrapper now takes the global's *name*
  and skips what is not there.

A defect found while closing the phase, and worth recording because it was
invisible: the start-up sweep that releases debugger sessions left by an evicted
worker was also clearing the registry of sessions attached *after* it started —
which, on a cold service worker, is the user's first audit. Its events went
nowhere and the capture came back empty with nothing in its notes to explain it.
The sweep now leaves live sessions alone and audits wait for it;
`tests/unit/debugger-session.test.mjs` holds the regression.

Verified: 200 unit tests and 26 end-to-end tests green, `npm run check:tokens`
and `npm run build` clean, and the full corpus run linked above.

### Phase 5 — what shipped

**The service.** `server/`, `node:http`, no framework — it routes two paths and
parses one JSON body, and a process that holds an API key should have a
dependency list readable in an afternoon. One dependency was added and is
justified in the commit: `@anthropic-ai/sdk`, the official client, for retries,
typed errors and streaming.

- `POST /analyze-policy` takes `{text, url}` and answers `{ok, data, cached}`.
  `GET /health` answers without a key, so a deployment can be checked before it
  is trusted with one.
- `server/prompts/policy-v1.mjs` — the prompt as a versioned file. A change of
  wording changes the findings, so the analysis records which prompt produced it
  and the cache is keyed on it: editing the prompt invalidates nothing silently,
  it simply stops being a cache hit.
- Structured output through `output_config.format`, then validated against
  `shared/schema/policy-analysis.schema.json` by the project's own validator —
  the one written in phase 2 to run in two places, which is now doing so.
- SHA-256 cache over the *normalised* text, the prompt version and the model.
  Those three decide the answer, so nothing else is in the key — and a policy
  that changed a word is a different document with a different hash, which is
  why there is no expiry.
- An optional bearer token, because a process that spends money per request
  should not answer to anyone who finds its port. It is an operational guard,
  not the licence system; that is phase 7.

**The reading of it.** Fifteen subjects, each tied to the article that asks for
it, and every claim of presence checked against the source before it is issued.
A claim whose sentence is not in the document becomes `unverified` — neither
present nor absent — which is the phase's one reversal of an earlier decision
and is argued in `docs/methodology.md`.

**Reaching the policy.** From the banner's own policy control first, then from
the page's links, *ranked*. The ranking is not decoration: the first corpus run
followed "the first link mentioning privacy" and analysed a Guardian article
about a Meta trial, a Spiegel article about Uber's fine, and — the one worth
remembering — a Belgian publisher's Cloudflare interstitial through to
*Cloudflare's* privacy policy. Ranking by path shape, by article markers, by
same-site and by file type fixed all three. One hop is allowed from a hub page
to the policy it links to, which is how theguardian.com goes from 574 characters
of table of contents to 39 000 characters of policy.

**Category D.** Five rules, fifteen points, which completes the weight budget
the plan set: deposit 35, fairness 30, information 20, policy 15 — 100 exactly.
Subjects that only some controllers must state — a DPO, legitimate interests,
transfers outside the EEA, automated decisions — are conditional: their absence
is an observation, never a departure. A policy is not defective for being silent
about something that does not apply to it.

**The corpus.** `npm run capture:policies` records real policies the way the
extension reaches them — homepage, profile, detector, policy control — so a
document the extension could not have found does not enter by the back door.
17 usable policies from 22 attempts, in five countries, overlapping the phase 3
banner corpus wherever possible. The five failures are recorded rather than
dropped: four homepages offered no discoverable policy link from this sandbox
(a consent wall, a Cloudflare interstitial, two banners rendered in frames whose
links the page does not carry), and they are in the corpus as failures.

**Where it stands against the criteria.**

| Criterion | Status |
|---|---|
| `POST /analyze-policy` | met |
| Versioned prompt | met — `policy-v1`, recorded in every analysis |
| Schema-validated output | met — every issued document is validated or the request fails |
| SHA-256 cache | met — measured in the tests: the second identical request never reaches the model |
| Fifteen real policies | met — 17 recorded |
| >90 % detection | **not measured** |
| Every "present" backed by a literal quote found in the source | met by construction, and measured on what has been run: 21 of 21 |

The detection figure needs a model call, and this container has no
`ANTHROPIC_API_KEY`. What exists instead is the harness that produces it —
`npm run verify:policies -- --live` runs the corpus and writes the figures into
`docs/verification/` — and a dry run of the prompt over two policies, applied by
hand and labelled as such in the fixtures, which exercises everything except the
model: normalisation, quote verification, assembly, schema and the category D
rules, against real documents. Its output is
[`verification/policies-2026-08-22.md`](verification/policies-2026-08-22.md).
**That is not the acceptance measurement and must not be quoted as one.** The
cost of the real run, at the rate recorded above, is roughly $3 for the whole
corpus.

Verified: 251 unit tests and 32 end-to-end tests green, `npm run check:tokens`
and `npm run build` clean. The end-to-end run includes the whole path — banner
to hub page to policy to service to report — against a local service whose
model is a stub, including the case that matters most: a fabricated sentence in
the answer, which the server drops and the rules never see.

### Phase 6 — what shipped

**The report page.** `src/ui/report/`, opened in a tab from the popup, written
as a document rather than a dashboard: it states what was measured, under what
conditions, and what limits how far it can be read — on the page, not in the
documentation. It renders a *stored record*, never a re-run, so what a client is
shown is what was observed at the time and not a second measurement that might
disagree with the figure they were quoted.

**The deposit timeline** — the plan's signature element, and the one part of the
report that is an observation rather than an assessment. Four lanes on one
clock: third-party requests, cookies, storage writes, identification surface.
Its rule is that it draws what was observed and nothing else:

- a first-party request is not drawn, because the page asking for itself is the
  visit, not a deposit — and two hundred of the site's own assets would bury the
  four calls that matter;
- an **undated** observation is never placed at zero to tidy the picture. It is
  listed apart, counted, and said to be undated;
- the axis is the observation window, not the last event, so a page whose
  deposits all land in the first 300 ms has a short cluster on a five-second
  axis — and that shape is itself the finding;
- every marker carries its own observation as its accessible name, so the
  picture survives greyscale printing and a screen reader.

**Exports.** Two CSVs and a PDF.

- `findings.csv` — one row per rule: verdict, evidence, legal basis,
  remediation. RFC 4180 to the letter, because a remediation sentence contains
  commas and a report that opens with its columns shifted is a report that gets
  sent back.
- `deposits.csv` — one row per observation, in the order they happened, undated
  ones last and marked as such.
- The PDF is Chrome's own "Save as PDF" over a print stylesheet that drops the
  controls and the history, keeps the evidence, and stops a finding breaking
  across a page halfway through its evidence. No dependency: a PDF library in an
  extension would be a megabyte to reproduce what the browser already does well.

**Local history.** The last 30 audits, in `chrome.storage.local`, listed on the
report and openable from it. Local by design and not by omission: a history of
the pages someone audited is a history of the pages they visited, and sending
that anywhere would be a worse disclosure than any this tool reports. The stored
record is trimmed to what the report renders — the capture's first-party
requests are dropped and *counted*, so a shortened list is never shown as though
it were complete — and the site's policy text is not kept at all, since the
analysis already carries every sentence the report quotes.

**Where it stands against the criteria.**

| Criterion | Status |
|---|---|
| Deposit timeline | met |
| PDF export | met — generated in the end-to-end run and checked to be a real PDF, not a blank page |
| CSV export | met — both files, parsed back and checked against the audit they came from |
| Local history | met — kept, listed, capped, and forgettable |
| Usable as a client annex without retouching | see below |

The last one is not something an assertion can establish, so
`npm run verify:report` produces it: a live audit of a real site, printed
exactly as the user's "Save as PDF" prints it, with both CSVs beside it —
[`verification/report-lemonde.fr-2026-08-22.md`](verification/report-lemonde.fr-2026-08-22.md)
and the PDF next to it. Reading that output is what found the three defects
this phase closed: a duplicated timestamp under every timed finding, an axis
label falling off the page, and five identical "did not apply" panels where a
one-line note belonged.

Verified: 273 unit tests and 39 end-to-end tests green, `npm run check:tokens`
and `npm run build` clean.

### Phase 7 — what shipped

**The licence server**, three routes beside the analysis one: `POST /checkout`
starts a purchase, `POST /stripe/webhook` turns a completed one into a key, and
`POST /licence/verify` answers the question the extension asks at most once a
week.

One dependency added, `stripe`, and the justification is not convenience but
**webhook signature verification**. That endpoint is the only one on this
service that anyone on the internet can reach and that hands out something worth
money; getting the verification wrong lets a stranger mint licences, and the
failure is silent — a hand-written verifier that forgets the timestamp tolerance
or compares with `===` passes every test you would think to write. The library
also *generates* valid signatures, which is how the webhook path is exercised in
the suite without a Stripe account.

Three things about the webhook that are not obvious and are all about retries
and refunds:

- **Issuing is idempotent on the Stripe session id.** Webhooks are delivered
  more than once by design, and a customer sent two keys for one payment has
  been given a problem rather than a product.
- **An event this service does not handle is answered `200`.** Stripe retries an
  endpoint that errors and eventually disables it, which would take the events
  that *do* matter with it.
- **A cancellation or refund revokes the licence**, matched by subscription or
  customer id — the webhook carries no key.

Licences are stored under the SHA-256 of the key rather than the key itself:
whoever ends up reading a backup of that directory learns which licences exist
and what they are worth, and cannot use one. The key format is Crockford's
alphabet without the characters that get misread, because a customer reads it
off an invoice and types it into a popup.

**Fail open, with an end to it.** This is the part of licensing that decides
whether a paying customer's tool works on the morning our service does not:

| When | What happens |
|---|---|
| Verified less than 7 days ago | Full plan, no network call at all |
| Older than 7 days, service reachable | Re-verified, cache renewed |
| Older than 7 days, service unreachable | **Full plan continues**, for a further 7 days of grace, and the popup says the last verification is being honoured |
| Beyond that | Free allowance — the tool never stops working, it stops being paid-for |
| Licence expired or revoked, answer received | Free allowance immediately: that is not an outage, it is an answer |

**The free counter is local, and only local.** A quota enforced by a server
would mean telling that server every time somebody audits a page — a record of
their browsing, held by us, to protect five audits a month. It can be reset by a
determined user; that is a price worth paying and it is cheaper than the
alternative in every sense that matters.

The gate sits on the audit itself and is checked *before* the tab is opened: an
audit that runs and is then refused has already cost the user a debugger warning
bar and five seconds of their attention. Policy analysis is what costs the
operator money, so it is what the Pro plan buys; a free installation is **told**
rather than billed, and the rest of its audit is unaffected.

A defect found by the end-to-end run and worth recording: re-entering the *same*
licence key while the service happened to be unreachable wiped the cached
verification and dropped the installation to the free tier — the exact opposite
of what the customer was trying to do. Entering a key that is already stored now
keeps what is known about it.

**Where it stands against the criteria.**

| Criterion | Status |
|---|---|
| Seven-day cache | met — measured in the tests: no call is made until it lapses |
| Fail-open degradation | met — every branch of the table above is a test |
| Local free-tier counter | met — counted by calendar month, refused at the limit, lifted by a licence without a restart |
| Full Stripe test purchase | **not run here** |

The purchase needs Stripe test keys, which this container does not have. What is
proved without them is everything up to Stripe's own servers: a signed webhook
issues a licence, an unsigned or replayed one does not, a duplicate delivery
issues nothing further, a cancellation revokes, and the extension accepts the
key that came out. What is not proved is that Stripe creates the session and
charges the card, and `npm run verify:stripe` is the harness for that — it
refuses to run against anything but a test key, prints the Checkout URL, waits
for the webhook and checks the licence verifies as the extension expects.

Verified: 305 unit tests and 46 end-to-end tests green, `npm run check:tokens`
and `npm run build` clean.

### Phase 8 — what shipped

Everything the Chrome Web Store submission needs, in the repository rather than
in somebody's browser tab, so that a change to the product and a change to what
is claimed about it arrive in the same commit.

- [`docs/store/privacy-policy.md`](store/privacy-policy.md) — the extension's
  own policy, written against the checklist the extension applies to other
  people: who the controller is, what stays local (nearly everything), the two
  things that leave the browser and when, what the licence service stores, the
  legal basis for holding it, and the rights. If it would fail one of the
  product's own rules, that is a defect worth reporting.
- [`docs/store/permissions.md`](store/permissions.md) — a justification per
  permission, written for the reviewer's form and for the user. It says what each
  permission allows *in principle*, not only what this extension does with it,
  and it records the two that were removed for being conveniences: `scripting`,
  which would have dragged `<all_urls>` in with it, and `downloads`, which the
  report does not need.
- [`docs/store/listing.md`](store/listing.md) — name, 129-character summary,
  category, description, single-purpose statement, the data-usage answers with
  their three certifications, and a pre-submission checklist.
- [`docs/store/screenshots/`](store/screenshots) — 1280×800, produced by
  `npm run store:screenshots` from a live audit of a real site. Not mock-ups: the
  store shows these to people deciding whether to trust the thing, and a
  screenshot assembled by hand is a claim nobody checked. Four of the five are
  committed; the privacy-policy one needs a deployed analysis service, and the
  generator says so rather than inventing one.
- `README.md`, rewritten for a repository that is now eight phases old rather
  than three.

Two product defects were found by producing all of that, both of them the kind
that only appear when you use the thing rather than test it:

- **The popup blocked entirely without incognito access.** Phase 3 decided that
  a current-profile mode ships alongside the incognito default; the popup never
  offered it, so a user who had not ticked Chrome's box could not audit at all.
  It now offers to audit in the ordinary profile, with the sentence that says
  what that measurement is worth.
- **The popup lost its result the moment it closed.** An MV3 popup closes on any
  click elsewhere, and losing a five-second measurement to a stray click is a bad
  way to treat somebody's attention. It now shows the last audit when reopened,
  dated, so it is never mistaken for a reading taken just now.

**Where it stands against the criteria.**

| Criterion | Status |
|---|---|
| Extension privacy policy | met |
| Written justification per permission | met |
| Screenshots centred on the timeline | met — the timeline is the first image, and the set is generated from a real audit |
| Store listing | met |

What is not met, and cannot be from here: the item is not submitted. Submission
needs a Chrome Web Store developer account, the service deployed at the host in
`host_permissions`, and live Stripe prices — none of which exist yet, and all of
which are in the checklist at the end of the listing.

Verified: 305 unit tests and 47 end-to-end tests green, `npm run check:tokens`
and `npm run build` clean.

## Where the project stands

Eight phases, built in order, each closing on criteria that were checked rather
than asserted. Three of those criteria could not be measured from inside this
container and each says so in its own section rather than being quietly counted
as met:

| Phase | What is outstanding |
|---|---|
| 3 | The refusal rate was measured from a non-EU exit IP with filtered egress: 21 of 38, against a target of 22 of 30. A run from Europe is what would settle it |
| 5 | The >90 % detection figure needs `ANTHROPIC_API_KEY` |
| 7 | The Stripe test purchase needs Stripe test keys |
| 8 | Submission needs a developer account and a deployed service |

Everything else in this repository is checked by something that runs: 305 unit
tests, 47 end-to-end tests against a real Chromium with the real extension
loaded, and the verification runs recorded in
[`verification/`](verification).

### What is left, and what it needs

None of this is code waiting to be written; each item is a run that needs
something this container does not have.

- **The detection measurement.** `ANTHROPIC_API_KEY=… npm run verify:policies --
  --live`. Nothing in the code needs to change for it, and the document it
  writes is the phase 5 evidence.
- **The service has no home yet.** `DEFAULT_SERVICE_ORIGIN` names
  `api.consent-audit.dev`, which is where the manifest's host permission points
  and where nothing is deployed. Until it is, an installation that buys a licence
  has nothing to verify against — which is why the pre-submission checklist puts
  the deployment before the store listing.
- **A measurement from Europe.** The refusal figure in phase 3 is a floor taken
  from a non-EU exit IP with a filtered egress. Re-running `npm run
  verify:banners --live` from a European network is what would settle whether
  the criterion is met; nothing in the code needs to change for it. The same run
  would tighten the rule figures, which inherit the same corpus.
- **The tracker table is short, and shipping it is not maintaining it.** The
  weekly refresh — JSON into `chrome.storage`, overriding the shipped copy —
  needs the service to be deployed before it means anything, so it moves with
  the deployment.
- **The test purchase.** `STRIPE_SECRET_KEY=sk_test_… npm run verify:stripe`,
  with `stripe listen` forwarding webhooks. Nothing in the code needs to change
  for it.

## Standing constraints

- Build in order. Do not write code for a phase that has not started.
- No dependency without a justification in the commit message.
- No colour, spacing or type value outside `extension/src/ui/tokens.css`.
- Test fixtures are captured **before** the rule engine is written. Rules
  written against imagined banners drift; rules written against thirty real
  ones do not.
- On a legal doubt, ship the most conservative verdict and record the question
  in `docs/methodology.md` rather than settling it alone.
