# Consent Audit

A Chrome extension that measures what a website does before you answer its
cookie banner, and reports it against published data-protection guidance.

It states what happened — *"this call to an ad exchange went out 412 ms after
load, before any interaction with the banner"* — and which text that observation
engages. It never states that a site is unlawful: that depends on records,
contracts and purposes no browser can see.

Built for people who have to prove things: outsourced DPOs, privacy
consultants, agencies demonstrating that what they shipped is compliant,
lawyers in practice. Every finding travels with the observation behind it —
what a consultant bills for is the evidence, not the verdict. Not legal advice;
see [`docs/methodology.md`](docs/methodology.md).

## What it does

1. Opens a clean window and attaches Chrome's debugger **before** the page
   navigates, because the requests that matter are the first ones.
2. Watches for five seconds **without touching the page** — no click, no scroll,
   no keystroke. Several consent platforms read any input as agreement, so a
   single stray event would contaminate the measurement.
3. Finds the banner, names the consent platform, and measures how the choice is
   offered: same layer, equal prominence, nothing pre-ticked, refusal free.
4. Refuses through the platform's own API where one exists — then asks that API
   what it recorded, because a click that closes a banner without withdrawing
   consent is the failure that matters most.
5. Reads the privacy policy and, if asked to, has it analysed against the
   articles of the GDPR — with every claim checked, word for word, against the
   document itself.
6. Scores what it found, and produces a report a consultant can attach to their
   own work.

## Running it

```sh
npm install
npm run build          # validate and copy to dist/extension
npm test               # token discipline, unit tests, build, end-to-end
```

Then load `dist/extension` in `chrome://extensions` with developer mode on, and
turn on *Allow in Incognito*. That is not a formality: in your normal profile a
site may find a stored choice, show no banner and load everything — a
measurement of a *returning* visitor, not a new one. The extension will audit in
the ordinary profile if you prefer, and labels the result as such everywhere it
appears.

`debugger` makes Chrome show a warning bar on the audited window. That is
unavoidable and visible; the popup says so before the first audit rather than
let it read as a malfunction.

The end-to-end suite uses the Chromium already on the machine where there is one
(`/opt/pw-browsers/chromium`, override with `CHROMIUM_PATH`), otherwise
Playwright's own download.

## Layout

| Path | What lives there |
|---|---|
| `extension/src/background/` | The service worker, the debugger session, capture A, the licence and history stores |
| `extension/src/content/` | Reading the page: profile, CMP adapters, banner detection, the interaction driver, policy extraction. **Not** content scripts — see the note at the top of `page-profile.js` |
| `extension/src/engine/` | The rulebook: 21 rules, their evidence, and the score |
| `extension/src/ui/` | Popup and report, over one set of design tokens |
| `server/` | The analysis and licence service: `POST /analyze-policy`, Stripe, licences |
| `shared/schema/` | The contracts, and a validator that throws on anything it does not implement |
| `tests/` | Unit tests, end-to-end tests, and the recorded corpora they run against |
| `docs/` | Methodology, roadmap, store submission, and the verification runs |

## The documents worth reading first

- [`docs/methodology.md`](docs/methodology.md) — what each measurement can and
  cannot establish, and the legal questions this project deliberately leaves
  open with the conservative reading it ships.
- [`docs/roadmap.md`](docs/roadmap.md) — the eight phases, what each delivered,
  and what it found out.
- [`docs/store/permissions.md`](docs/store/permissions.md) — why each permission
  is asked for, and the two that were removed for being conveniences.
- [`docs/verification/`](docs/verification) — the runs behind the claims: real
  captures, the whole corpus through the rulebook, an exported report.

## Design

The register is the inspection report, not the marketing dashboard: precise,
dense, legible in a screenshot pasted into a client deliverable. Verdict colours
never carry meaning alone — every state also has a mark and a label, so the
report survives greyscale printing and colour vision deficiency. All design
values live in `extension/src/ui/tokens.css` and nowhere else;
`npm run check:tokens` enforces it mechanically.

## Verification you can run yourself

Each of these touches the network or an API and is deliberately outside
`npm test`:

```sh
npm run verify:capture      # capture A against real sites
npm run verify:banners      # banner detection and refusal over the corpus
npm run verify:rules        # every rule over every recorded fixture
npm run verify:policies     # the policy analysis (needs ANTHROPIC_API_KEY for --live)
npm run verify:report       # a real audit, exported as PDF and CSV
npm run verify:stripe       # a Stripe test-mode purchase (needs test keys)
npm run capture:fixtures    # re-record the banner corpus from live sites
npm run capture:policies    # re-record the policy corpus, the way the extension finds them
npm run store:screenshots   # the store images, from a real audit
```

## Licence

Not yet decided. The extension is a commercial product; this repository is its
source, and the source of the service it talks to.
