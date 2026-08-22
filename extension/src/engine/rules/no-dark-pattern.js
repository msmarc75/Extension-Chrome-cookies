/*
 * The things that are wrong only in combination.
 *
 * The individual fairness rules each measure one thing. This one reads what
 * they found together, because deceptive design is rarely a single choice: a
 * refusal that is smaller, unpainted, one layer deeper and priced is not four
 * independent slips.
 *
 * It scores almost nothing on its own. Its job is to name the pattern, so the
 * report says what a reader would otherwise have to assemble.
 */

import { CATEGORY, SEVERITY, VERDICT, defineRule, evidence, fail, notApplicable, pass } from '../rule.js';

export const noDarkPattern = defineRule({
  id: 'NO_DARK_PATTERN',
  category: CATEGORY.FAIRNESS,
  severity: SEVERITY.MAJOR,
  weight: 1,
  title: 'No deceptive design across the banner as a whole',
  legalBasis: [
    { source: 'EDPB', ref: 'Guidelines 03/2022 on deceptive design patterns' },
    { source: 'GDPR', ref: 'art. 4(11), art. 5(1)(a)' },
    { source: 'CNIL', ref: 'recomm. 2020-092' },
  ],
  remediation:
    'Treat the two answers identically: same layer, same surface, same contrast, same cost, nothing pre-selected. Where several of those differ at once, the imbalance is the design, not an accident of it.',

  evaluate(audit, findings) {
    if (!audit.banner?.found) return notApplicable('no banner was located');
    if (!findings) return notApplicable('the other fairness rules have not run');

    const failed = (id) => findings.get(id)?.verdict === VERDICT.FAIL;

    const signals = [
      failed('REFUSE_SAME_LAYER') && 'refusing takes an extra step',
      failed('REFUSE_EQUAL_PROMINENCE') && 'the refusal is rendered less prominently',
      failed('NO_PRECHECKED') && 'purposes start switched on',
      failed('NO_COOKIE_WALL') && 'refusing is offered as a purchase',
      failed('GRANULARITY') && 'there is no per-purpose choice',
    ].filter(Boolean);

    if (signals.length <= 1) {
      return pass(
        signals.length === 0
          ? []
          : [evidence('One departure was found, which the rule above already reports', signals[0])],
        { measured: { signals: signals.length } },
      );
    }

    return fail(
      [
        evidence(
          `${signals.length} departures point the same way`,
          signals.join('; '),
        ),
      ],
      { measured: { signals: signals.length } },
    );
  },
});
