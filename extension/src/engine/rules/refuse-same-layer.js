/*
 * Is refusing available where accepting is?
 *
 * The clearest and most-cited requirement in the French guidance: refusing must
 * be as easy as accepting. A banner offering "Accept" and "Settings" makes
 * acceptance one click and refusal three — and the difference is measurable
 * without interpretation, which is why this rule is blocking.
 */

import { CATEGORY, SEVERITY, defineRule, evidence, fail, notApplicable, pass, labelOf } from '../rule.js';

export const refuseSameLayer = defineRule({
  id: 'REFUSE_SAME_LAYER',
  category: CATEGORY.FAIRNESS,
  severity: SEVERITY.BLOCKING,
  weight: 8,
  title: 'Refusal offered on the same layer as acceptance',
  legalBasis: [
    { source: 'GDPR', ref: 'art. 4(11), art. 7(3)' },
    { source: 'CNIL', ref: 'délib. 2020-091, art. 2' },
    { source: 'EDPB', ref: 'Guidelines 05/2020, §§ 47-50' },
  ],
  remediation:
    'Put a refusal control on the first screen, beside the acceptance and reachable in the same single click. "Settings" is not a refusal: it is a route to one.',
  falsePositiveNotes:
    'Only fires when an acceptance was positively identified on the first layer and no refusal was. A banner the tool could not read at all returns not applicable rather than a finding, and a banner located only by appearance carries that disclosure with it. Labels are matched against a multilingual table in which "continuer sans accepter" counts as a refusal despite containing the word accept.',

  evaluate(audit) {
    const banner = audit.banner;
    if (!banner?.found) return notApplicable('no banner was located, so there is no layer to judge');

    const accept = banner.controls?.accept ?? null;
    const refuse = banner.controls?.refuse ?? null;
    const preferences = banner.controls?.preferences ?? null;

    if (!accept) {
      return notApplicable('no acceptance control was identified, so there is nothing to compare');
    }

    if (refuse) {
      return pass([
        evidence('Acceptance', `“${labelOf(accept)}”`),
        evidence('Refusal, same layer', `“${labelOf(refuse)}”`),
      ]);
    }

    const found = [
      evidence('Acceptance is offered on the first screen', `“${labelOf(accept)}”`),
      evidence('No refusal is offered on the first screen', null),
    ];
    if (preferences) {
      found.push(
        evidence('Refusal is reachable only through preferences', `“${labelOf(preferences)}”`),
      );
    }
    if (audit.refusal?.ok && audit.refusal.layer > 1) {
      found.push(
        evidence(
          'Confirmed by driving the banner',
          `the refusal succeeded only after opening preferences (layer ${audit.refusal.layer})`,
        ),
      );
    }

    return fail(found, {
      measured: { acceptLayer: 1, refuseLayer: audit.refusal?.layer ?? null },
    });
  },
});
