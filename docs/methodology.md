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

## Open questions

Legal points this project has deliberately not settled. Each one names the rule
that depends on it and the conservative reading currently shipped.

*None recorded yet — the rule engine lands in phase 4.*
