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

## Open questions

Legal points this project has deliberately not settled. Each one names the rule
that depends on it and the conservative reading currently shipped.

*None recorded yet — the rule engine lands in phase 4.*
