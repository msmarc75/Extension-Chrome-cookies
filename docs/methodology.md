# Methodology

This document is published with the product. A consultant billing for a report
built on this tool has to be able to show where each finding comes from, and a
site owner contesting a finding has to be able to read the same page.

Its second job is to hold the doubts. When a rule cannot be written without
resolving a legal question this project has no standing to resolve, the rule
ships with its most conservative verdict and the question is recorded in
[Open questions](#open-questions) rather than settled quietly in code.

## What the tool claims, and what it does not

Consent Audit records **observable facts** about a page and compares them
against published guidance. It states what happened — "this cookie was written
1.2 s after load, before any interaction with the banner" — and which text that
observation engages.

It never states that a site is unlawful. Lawfulness depends on facts the tool
cannot see: the controller's purposes, its records of processing, its contracts
with processors, the configuration behind a measurement tool. Every finding is
a *constat*, phrased so it can be reproduced by a third party, and the report
carries that distinction in its own wording.

The output is an input to a professional's analysis. It is not legal advice.

## Reference texts

| Short name | Full reference |
|---|---|
| GDPR | Regulation (EU) 2016/679, in particular arts. 4(11), 6, 7, 12–14, 21 |
| ePrivacy | Directive 2002/58/EC as amended, art. 5(3) |
| LIL | Loi n° 78-17 du 6 janvier 1978 modifiée, art. 82 |
| CNIL 2020-091 | Délibération n° 2020-091 du 17 septembre 2020, lignes directrices « cookies et autres traceurs » |
| CNIL 2020-092 | Délibération n° 2020-092 du 17 septembre 2020, recommandation « cookies et autres traceurs » |
| CNIL exemption | CNIL, exemption criteria for audience-measurement trackers |
| EDPB 03/2022 | Guidelines 03/2022 on deceptive design patterns in social media platform interfaces |
| EDPB 05/2020 | Guidelines 05/2020 on consent under Regulation 2016/679 |
| TCF | IAB Europe Transparency & Consent Framework, v2.2 policies and technical specification |

Each rule cites the specific article or paragraph it rests on. A rule that
cannot cite one does not ship.

## Verdict vocabulary

| Verdict | Meaning |
|---|---|
| `pass` | The observation is consistent with the cited guidance. |
| `fail` | The observation departs from the cited guidance. |
| `warn` | The observation is ambiguous, or the measurement is less reliable than usual (for example, the banner was located heuristically rather than through a known CMP). |
| `not_applicable` | The precondition for the rule was not present on this page. |

Severity is separate from verdict. `blocking`, `major`, `minor` and
`informational` describe how much a `fail` weighs on the score, not how certain
it is.

Every verdict travels with its evidence. A verdict without the underlying
observation is not something a professional can put in front of a client, and
this project treats an unevidenced finding as a bug.

## Measurement conventions

**The pre-consent window.** The most incriminating measurement in the report is
what a site deposits before the visitor can express any choice. It is only
observable once, and only if nothing touches the page: no click, no scroll, no
simulated pointer movement between attaching the debugger and closing the
observation window. Some CMPs read any input event as implied consent, which
would contaminate the measurement it exists to make.

**Reliability disclosure.** When the consent platform could not be identified
and the banner was found heuristically, the report says so, on the report
itself and not only in the documentation. A reader must be able to weight the
finding.

**A clean profile, not a cleaned one.** A profile that already holds the site's
data measures a *returning* visitor: the site may find a stored choice, show no
banner, and load everything — which is a different question from the one this
tool asks. The audit therefore runs in an incognito window. The alternative,
clearing the site's data in the user's own profile first, would destroy
something the user owns in order to measure it, and is not on offer. Each
capture records which of `incognito-fresh`, `incognito-shared` or `current` it
was taken under, and the report shows it.

## What capture A can and cannot see

Stated plainly, because a finding is only as good as the instrument behind it.

**Requests** come from the CDP `Network` domain, attached before navigation. A
request is recorded when the page asks for it, whether or not the network
allows it — which is the right unit: what the site chose to send is the fact at
issue.

**Cookies** have two sources. `Set-Cookie` response headers give the moment of
writing. A reading of the jar at the end of the window gives what actually
persisted. Where the two disagree, the jar decides what is recorded and the
header decides when.

**Storage and script-set cookies** need in-page instrumentation, because the
protocol will not give them up: `chrome.debugger` refuses the `DOMStorage`
domain to extensions outright, and `Storage.getUsageAndQuota` does not account
for localStorage at all. A small script installed before navigation wraps
`Storage.prototype.setItem` and the `document.cookie` setter, and is read back
once the window has closed. It dispatches no event and clicks nothing: there is
nothing in it a consent platform could mistake for agreement.

Known limits of that approach, each of which the capture discloses rather than
papers over:

- A write that bypasses `setItem` — `localStorage.foo = 1` sets a named
  property — leaves no mark. The end-of-window inventory catches the key, and it
  is recorded as `snapshot`, without a time.
- IndexedDB and Cache Storage are visible only as a quota reading: present,
  sized, undated, and without keys.
- A cross-document navigation during the window resets the marks, since the
  instrument re-installs per document. What was written before a redirect is
  lost to the timeline, though its cookies still appear in the jar.
- Anything recorded without an observable moment of writing is shown as
  undated. It is never given a plausible-looking time.

**First and third party** are separated by registrable domain, using a compact
list of multi-label public suffixes rather than the full Public Suffix List.
The classification is a convenience for reading a capture; it is not the basis
of a finding. Tracker classification proper arrives with the Tracker Radar data
and its entity ownership.

## Identifying the consent platform

Naming the platform matters because it decides how much the rest can be
trusted. Four kinds of evidence, in descending order:

| Evidence | Confidence | Why |
|---|---|---|
| A platform global — `window.Didomi`, `window.OneTrust`, `window._sp_` | certain | Only that platform's own script defines it |
| A registered TCF `cmpId` | certain | The vendor identifies itself through a standard API |
| The platform's own markup — id or class names | likely | Class names are copied, forked and left behind |
| A consent iframe on the platform's own host | certain | The frame is served by the platform |

Every finding carries the evidence that produced it. "Didomi, because
`window.Didomi` exists and the TCF API reports CMP 7" is something a reader can
check; "Didomi" is not.

**The TCF id table is observed, not asserted.** The IAB registry is not
available in a form this project can vendor, so an id is only attributed to a
vendor where it was seen next to that vendor's own global across the recorded
corpus — cmpId 7 with `window.Didomi` on a dozen French publishers, 6 and 35
with `window._sp_`, 28 with `window.OneTrust`. An id never seen that way is
reported as `TCF CMP #<id>`: the framework is named, the vendor is not, and the
report does not pretend otherwise.

## Finding the banner, and admitting when it was a guess

Most of the web runs no platform this project will ever recognise by name. A
banner is then located by what it looks like — pinned, dialog-shaped, occupying
a plausible share of the viewport — and by what its buttons say, against a
multilingual label table.

That fallback works, and it is weaker. Which is why:

- the report states the method, `platform-markup` or `heuristic`, on the report
  itself and not only here;
- a heuristically located banner carries the sentence *"No known consent
  platform was identified. The banner was located by appearance and by what its
  buttons say, so these findings are weaker than usual."*;
- **"no banner" and "could not look" are different outcomes.** A consent frame
  that could not be read is reported as exactly that. A site that looks
  compliant because the tool went blind is the most expensive false negative
  available, and it is not on offer.

Cross-site iframes deserve their own note. Several large platforms render the
whole banner inside one, in a separate renderer process where a session
attached to the tab sees an empty wrapper. Each such frame is therefore read
through a session of its own, and the buttons found in it are pressed there.

## Driving a refusal, and proving it took

Two routes, in order of how much they can be trusted. The platform's own call —
`Didomi.setUserDisagreeToAll()`, `OneTrust.RejectAll()`,
`Cookiebot.submitCustomConsent(false, false, false)` — is the same call the
platform's own button makes and does not depend on a button still being where
it was last week. Where no such call is documented, or the platform is
unrecognised, the button is pressed: the service worker decides which label,
the page finds it and presses it, so the label table lives in one place.

Where an undocumented method might exist, this project does not guess at one. A
refusal that silently does nothing, reported as a refusal, is the worst failure
this tool can produce.

**Nothing is taken on trust.** After the instruction, the banner is read again
and, where the TCF API exists, it is asked what it now records. A refusal is
only a refusal if consent is recorded for no purpose at all; where there is no
TCF to ask, the banner going away is the fallback proof. A click that landed on
a banner that closed while consent stayed recorded is reported as a failure.

**When the refusal is one layer deeper.** Where the visitor's first screen
offers acceptance and preferences but no refusal, the preferences panel is
opened and the refusal looked for there. That the refusal took a second click
is recorded, because it is the imbalance the guidelines are about. A panel whose
toggles merely start switched off, saved with a neutral "Save" button, is not
treated as a refusal — only an explicit refusal label counts.

## Limits of the recorded corpus

The banner corpus in `tests/fixtures/banners/` was recorded from a sandbox whose
egress leaves the EU. Some sites therefore served their non-EU consent
experience — theguardian.com resolved to `/us`, lemonde.fr to `/en` — and what
was recorded for those is not what a European visitor sees. Sites that refused
the automated visit outright are in the corpus as failures rather than quietly
dropped. Neither limitation affects the extension: it runs in the user's own
browser, from wherever they are.

## Open questions

Legal points this project has deliberately not settled. Each one names the rule
that depends on it and the conservative reading currently shipped.

*None recorded yet — the rule engine lands in phase 4.*
