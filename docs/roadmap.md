# Roadmap

Eight phases, built in order. Each closes on criteria that are checked, not
asserted. No phase writes code for a later one.

## Structural decisions

Settled. Reopen only with a reason.

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
| 2 | Capture | Capture A complete and serialised to `shared/schema`; ten test sites including three French news outlets; debugger detaches under every path, zero orphan sessions over a hundred audits | not started |
| 3 | Banner detection | Thirty real fixtures: CMP identified in ≥25, refusal succeeds in ≥22 | not started |
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

## Standing constraints

- Build in order. Do not write code for a phase that has not started.
- No dependency without a justification in the commit message.
- No colour, spacing or type value outside `extension/src/ui/tokens.css`.
- Test fixtures are captured **before** the rule engine is written. Rules
  written against imagined banners drift; rules written against thirty real
  ones do not.
- On a legal doubt, ship the most conservative verdict and record the question
  in `docs/methodology.md` rather than settling it alone.
