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
of a finding. What makes a host a *tracker* is a separate question, answered
below.

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

## Deciding that a host is a tracker

**Third party is not the same thing as tracker**, and conflating them is how an
audit tool loses its reader. Publishers routinely serve their own assets from a
separate registrable domain — `bbci.co.uk` for the BBC, `guim.co.uk` for The
Guardian, `lemde.fr` for Le Monde. On the recorded corpus, counting every
third-party call as a tracker would have produced a blocking failure on roughly
a third of the sites for nothing but their own CDN.

So a host is only counted when the shipped table names it, and the table names
categories rather than a verdict: `advertising`, `analytics`, `social`,
`consent`, `cdn`, `essential`. Only the first three count as a deposit to answer
for. A consent platform's own script is how the site asks the question and is
never a finding in itself. An unrecognised host is not counted at all — the
table is short, it misses trackers, and **the miss is deliberate**: a false
positive on a blocking rule costs more than a false negative on one.

**Why the table is written here rather than imported.** DuckDuckGo's Tracker
Radar is the obvious source and cannot be used: it is licensed **CC BY-NC-SA
4.0**, whose NonCommercial clause rules it out of a paid product without a
commercial licence from DuckDuckGo. (The construction plan assumed a permissive
licence. It is wrong on that point.) The shipped table is therefore written by
this project from public facts about who operates each domain, seeded from the
third-party hosts actually observed across the corpus, and it says so in its own
`provenance` field. Its shortness is stated on the report rather than hidden:
what the tool did not recognise, it does not pretend to have cleared.

## Exemptions, and what the tool refuses to conclude

The exemption in law is narrow — strictly necessary for a service the user
asked for (ePrivacy art. 5(3)) — and the temptation is to invert it: treat
"not on the exemption list" as "not necessary". The first corpus run did exactly
that and produced a blocking failure on Wikipedia, which asks nothing of anyone.
That is the failure mode this project cares most about, so the rule was rewritten
to count only what it can positively identify:

- a cookie written by a domain classified `advertising` or `social`;
- a cookie whose name is a known tracker identifier (`_ga`, `_fbp`, `IDE`, …).

Everything else is raised **for review** with the reason it could not be
settled — "purpose not determinable from outside the site" — and carries no
deduction. A capture cannot see what a first-party cookie is for.

**Audience measurement is the deliberate soft spot.** The CNIL exempts it only
where it measures the site's own audience, builds no cross-site profile and
shares nothing, and none of those conditions is visible from outside. Where the
only pre-consent calls are to measurement, the verdict is a `warn`, not a `fail`.
That is the conservative reading, and it is recorded here rather than settled
alone.

**Undated cookies are never counted.** A cookie found in the jar with no
observable moment of writing cannot be shown to predate the choice. It appears
in the capture and stays out of the finding.

## Scoring, and the honesty constraints on it

A number out of a hundred is the most quotable thing this product makes, and
therefore the easiest to misuse. Four constraints govern it:

- **A failed blocking rule caps the score at 49.** A site that contacts an ad
  exchange before anyone was asked does not earn a respectable score for a
  well-laid-out banner.
- **Rules that did not apply are not counted as passes.** They are excluded from
  the denominator, and the report carries the share of the rulebook that actually
  applied. A score computed over a third of the rules is not a high score.
- **A score under 80 % coverage is marked `provisional`** — a page where no
  banner could be located has not passed the fairness rules, it has not been
  measured on them.
- **The score is never shown alone.** The band wording and the count of findings
  travel with it, in the payload and on screen.

The bands are worded as findings, not as legal conclusions: *Broadly consistent
with the guidance* (85–100), *Departures to correct* (60–84), *Characterised
failures* (0–59).

**Measured in the visitor's own profile, a `fail` becomes a `warn`.** The site
may be acting on a choice made weeks ago; what was deposited is still a fact,
but that it was deposited *before consent* is not established. The finding says
so and points at re-running in a clean window.

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
that depends on it and the conservative reading currently shipped. "Conservative"
here means conservative *about the accusation*: where the law is unsettled, the
tool reports less than it could, not more.

**Is audience measurement exempt?** *(`PRE_CONSENT_TRACKERS`,
`PRE_CONSENT_COOKIES`, `EXEMPTION_CHECK`)* The CNIL's exemption (délib. 2020-091)
holds only where the measurement is confined to the site's own audience,
produces no cross-site profile and shares nothing — conditions invisible from
outside. **Shipped:** a page whose only pre-consent calls are to measurement gets
a `warn`, not a `fail`, and the finding says the exemption could not be checked.
A stricter reading is defensible; it is not this tool's to impose.

**Is a cookie wall a breach?** *(`NO_COOKIE_WALL`)* Consent conditioned on
payment is not freely given in the ordinary sense (GDPR art. 7(4), recital 42),
but the CNIL assesses cookie walls case by case and the EDPB's Opinion 08/2024
turns on facts — a reasonable price, a genuine alternative — that no capture can
see. **Shipped:** the finding states the observation ("refusing is offered as a
purchase; accepting is free") and cites the question. It does not say the
arrangement is unlawful. It is nonetheless `blocking`, because a refusal that
costs money is not a refusal the rest of the report can be read against.

**Does a refusal one layer deeper breach anything by itself?**
*(`REFUSE_SAME_LAYER`)* The CNIL's recommendation is that refusing be as easy as
accepting, and its January 2022 sanctions against Google and Facebook rested on
exactly that asymmetry. Whether *one* extra click is per se a breach has not
been decided in terms. **Shipped:** blocking only where an acceptance was
positively identified on the first layer **and** no refusal was — never where the
banner could not be read.

**Is reading a canvas "access to information stored in the terminal"?**
*(`PRE_CONSENT_FINGERPRINT`)* The EDPB's Guidelines 2/2023 say yes, and the
question has not been litigated in those terms. **Shipped:** `major`, not
blocking, and only where two or more distinct techniques were reached inside the
untouched window — a single canvas read is a chart as often as a fingerprint.

**How unequal is too unequal?** *(`REFUSE_EQUAL_PROMINENCE`, `NO_DARK_PATTERN`)*
No instrument publishes a threshold; the guidance says "as easy". **Shipped:** a
20 % tolerance on surface area, WCAG relative luminance for contrast, and both
sides' figures printed side by side so the reader can disagree with the
threshold and still use the measurement.

**Does loading a consent platform before consent count against the site?**
**Shipped:** no. Loading the CMP is how the site asks the question, and its own
domain is classified `consent` and excluded from the deposit rules. Where a
consent platform also sells advertising, only its advertising domains count.
