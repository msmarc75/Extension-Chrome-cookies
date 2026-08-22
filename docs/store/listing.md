# Chrome Web Store listing

Everything the submission form asks for, in the order it asks for it. Kept in
the repository so a change to the product and a change to what is claimed about
it arrive in the same commit.

---

## Name

**Consent Audit**

## Summary — 132 characters maximum

> See what a site drops before you consent, whether refusing really works, and
> what its privacy policy actually states.

*(129 characters.)*

## Category

Developer Tools. Not "Productivity": the audience is DPOs, privacy consultants
and the people who build consent banners, and that is where they look.

## Language

English (United Kingdom), with French to follow. The interface is written in
English first because that is where the addressable market and the store search
are; the guidance it cites is mostly French and European, which is a good reason
for the French version to be a real translation rather than an afterthought.

## Detailed description

> **What a site does before you answer its cookie banner is a measurement, not
> an opinion. Consent Audit takes it.**
>
> Press the button and the extension opens a clean window, attaches Chrome's own
> debugger *before* the page loads, and watches for five seconds without
> touching anything — no click, no scroll, no keystroke. Some consent platforms
> read any input as agreement, so the only way to see what a site sends before
> consent is to genuinely not interact with it.
>
> Then it reads the banner: which consent platform is asking, whether a refusal
> is offered on the same screen as the acceptance, whether both answers are
> equally prominent (measured — surface area, contrast, weight), whether any box
> starts ticked, and whether refusing costs money. Where a platform's own API
> exists, it refuses through that API and then asks the API what was recorded,
> because a click that closes a banner without withdrawing consent is the
> failure that matters most.
>
> **What you get**
>
> • A deposit timeline — every third-party call, cookie, storage write and
>   fingerprinting API, on one clock, at the moment it happened
> • Findings with the observation behind each one, the article it engages, and
>   what would resolve it
> • A score out of 100 that never appears without the count of findings that
>   produced it, and that is capped at 49 when something blocking failed
> • PDF and CSV export, usable as a client annex without retouching
> • A local history of your audits — on your computer, and nowhere else
>
> **What it will not do**
>
> It will not tell you a site is unlawful. Lawfulness depends on records,
> contracts and purposes that no browser can see. Every finding is phrased as
> what was observed and which text it engages, so a professional can rely on it
> and a site owner can argue with it. Where the law is genuinely unsettled — the
> audience-measurement exemption, cookie walls — the tool reports the observation
> and says the question is open, rather than settling it for you.
>
> It will not invent evidence either. A cookie it cannot date is shown as
> undated, never placed at zero. A privacy-policy finding is issued only if the
> sentence it rests on is found, word for word, in the policy itself.
>
> **Free, and paid**
>
> Five audits a month, free, with everything above except the privacy-policy
> analysis. The count is kept on your computer: enforcing it on a server would
> mean telling that server every page you audit, and we would rather not know.
>
> Pro adds unlimited audits and the policy analysis. If our licence service is
> unreachable, a licence already checked keeps working for two weeks — your tool
> does not depend on our uptime.
>
> **Chrome will warn you**
>
> Measuring the earliest requests means attaching Chrome's debugger, so Chrome
> pins a warning bar to the audited window. That is Chrome telling you the truth
> and the extension says so before your first audit. The bar disappears with the
> window.
>
> Methodology, permissions and privacy policy are published in full:
> github.com/msmarc75/Extension-Chrome-cookies

## Single purpose

> Measuring what a website does before and after a visitor answers its cookie
> banner, and reporting those observations against published data-protection
> guidance.

## Justification per permission

See [`permissions.md`](permissions.md), which is written for the reviewer form
and is what should be pasted into it.

## Privacy policy URL

The published copy of [`privacy-policy.md`](privacy-policy.md).

## Data usage disclosures

The store asks a series of yes/no questions. The honest answers:

| Question | Answer |
|---|---|
| Does it collect personally identifiable information? | No |
| Health information? | No |
| Financial and payment information? | No — payment is taken by Stripe on Stripe's own pages |
| Authentication information? | No |
| Personal communications? | No |
| Location? | No |
| Web history? | No — the sites audited are recorded in local storage only, and are never transmitted |
| User activity? | No |
| Website content? | **Yes** — the text of a privacy-policy page, and only when the user ticks the box that sends it for analysis |

And the three certifications:

- Data is not sold to third parties. **Certified.**
- Data is not used or transferred for purposes unrelated to the item's single
  purpose. **Certified.**
- Data is not used or transferred to determine creditworthiness or for lending.
  **Certified.**

## Screenshots

1280×800, generated by `npm run store:screenshots` from a real audit of a real
site, so that what is shown is what the product produces. They live in
[`screenshots/`](screenshots/):

1. **The deposit timeline** — the signature element, and the first thing a
   reviewer should see.
2. **The report's verdict and disclosures** — the score with its band and counts,
   and the sentences that limit how far it can be read.
3. **Findings with their evidence** — an observation, the article it engages, the
   remediation.
4. **What the privacy policy states** — subject by subject, each with the sentence
   found in the document. *Produced only when the analysis service is reachable
   with a key; the generator skips it and says so otherwise, rather than
   inventing one.*
5. **The popup** — the four figures and the score, as they look when the popup is
   reopened after an audit.

The set committed here was taken from `20minutes.fr` with no analysis service
running, so it has four images and not five. Regenerate against a deployed
service before submitting.

## Support

Issues at github.com/msmarc75/Extension-Chrome-cookies/issues, and
`support@consent-audit.dev`.

---

## Before submitting

- [ ] `npm test` green, `npm run build` clean, `dist/extension` zipped from a
      clean tree
- [ ] `version` in `manifest.json` bumped, and the release notes written
- [ ] The privacy policy published at a stable URL and linked in the listing
- [ ] The analysis and licence service deployed at the host in
      `host_permissions`, with a certificate — the extension has no fallback and
      would fail closed for every paying customer
- [ ] Screenshots regenerated against a deployed service, so the set includes
      the privacy-policy one
- [ ] `stripe listen` verification run against the live prices, not the test ones
