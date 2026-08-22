/*
 * Is the policy one click away from the question?
 *
 * The cheapest requirement in the set to satisfy, which is what makes failing
 * it worth reporting.
 */

import { CATEGORY, SEVERITY, defineRule, evidence, fail, notApplicable, pass, labelOf } from '../rule.js';

export const policyReachable = defineRule({
  id: 'POLICY_REACHABLE',
  category: CATEGORY.INFORMATION,
  severity: SEVERITY.MAJOR,
  weight: 4,
  title: 'Privacy policy reachable from the banner',
  legalBasis: [
    { source: 'GDPR', ref: 'art. 12(1), art. 13' },
    { source: 'CNIL', ref: 'délib. 2020-091, art. 2' },
  ],
  remediation:
    'Put a link to the privacy or cookie policy on the first screen of the banner, labelled as such.',

  evaluate(audit) {
    const banner = audit.banner;
    if (!banner?.found) return notApplicable('no banner was located');

    const policy = banner.controls?.policy ?? null;
    if (policy) {
      return pass([evidence('The policy is linked from the banner', `“${labelOf(policy)}”`)], {
        measured: { linked: true },
      });
    }
    return fail([evidence('No link to the policy appears on the banner', null)], {
      measured: { linked: false },
    });
  },
});
