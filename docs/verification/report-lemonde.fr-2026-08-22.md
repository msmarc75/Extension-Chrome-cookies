# Report export — lemonde.fr

> Taken from inside a sandbox whose egress gateway re-terminates TLS, caps the
> browser at TLS 1.2, and may refuse hosts a normal network would allow. Counts
> here are a floor, not a measurement of what these sites do in the wild.

Audited `https://www.lemonde.fr/` on 2026-08-22, in the visitor's own profile (this harness cannot
tick Chrome's incognito checkbox), and printed from the report page exactly as
"Save as PDF" prints it.

| | |
|---|---|
| Score | 49 (Characterised failures) |
| Blocking failures | REFUSE_SAME_LAYER |
| Findings | 7 departures, 3 to review |
| Deposits drawn on the timeline | 30 |
| Consent platform | TCF (vendor unidentified) |
| Refusal | not completed |

- [`report-lemonde.fr-2026-08-22.pdf`](report-lemonde.fr-2026-08-22.pdf) — the annex
- [`report-lemonde.fr-2026-08-22-findings.csv`](report-lemonde.fr-2026-08-22-findings.csv) — one row per rule
- [`report-lemonde.fr-2026-08-22-deposits.csv`](report-lemonde.fr-2026-08-22-deposits.csv) — one row per observation

