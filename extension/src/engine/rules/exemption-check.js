/*
 * What was set aside, and on what ground.
 *
 * This rule scores nothing. It exists so the report can show its work: every
 * cookie the deposit rules declined to count, with the exemption it claimed.
 * Without it, a site owner reading a short list of findings has no way to tell
 * whether the tool understood their session cookie or simply missed it — and a
 * consultant has nothing to answer with when asked.
 */

import { CATEGORY, SEVERITY, defineRule, evidence, notApplicable, pass } from '../rule.js';
import { exemptionFor } from '../data/exemptions.js';

export const exemptionCheck = defineRule({
  id: 'EXEMPTION_CHECK',
  category: CATEGORY.DEPOSIT,
  severity: SEVERITY.INFORMATIONAL,
  weight: 0,
  title: 'Cookies set aside as not requiring consent',
  legalBasis: [
    { source: 'ePrivacy', ref: 'art. 5(3), second exception' },
    { source: 'CNIL', ref: 'délib. 2020-091, art. 5' },
    { source: 'CNIL', ref: 'audience-measurement exemption criteria' },
  ],
  remediation:
    'Nothing to correct. If a cookie listed here is not in fact strictly necessary, it belongs in the findings above and should be gated on consent.',

  evaluate(audit) {
    const capture = audit.captureA;
    if (!capture) return notApplicable('no capture');

    const exempted = capture.cookies
      .map((cookie) => ({ cookie, exemption: exemptionFor(cookie) }))
      .filter(({ exemption }) => exemption.exempt);

    if (exempted.length === 0) {
      return pass([], { measured: { exempted: 0, forReview: 0 } });
    }

    return pass(
      exempted.map(({ cookie, exemption }) =>
        evidence(
          `${cookie.name} on ${cookie.host}`,
          `${exemption.note} — ${exemption.ground}${exemption.needsReview ? ' (conditions not verifiable from outside; check them)' : ''}`,
          cookie.tMs,
        ),
      ),
      {
        measured: {
          exempted: exempted.length,
          forReview: exempted.filter(({ exemption }) => exemption.needsReview).length,
        },
      },
    );
  },
});
