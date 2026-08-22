/*
 * Is refusing free?
 *
 * Observed across the corpus and impossible to miss once you look: the refusal
 * button on several large French and Italian publishers reads "refuse and
 * subscribe". Consent conditioned on payment is not freely given in the sense
 * the Regulation uses, and the CNIL's position on cookie walls is that they
 * must be assessed case by case — so this reports the fact and cites the
 * question, without pronouncing on the answer.
 */

import { CATEGORY, SEVERITY, defineRule, evidence, fail, notApplicable, pass, labelOf } from '../rule.js';
import { normaliseLabel } from '../../content/label-match.js';

/* Words that turn a refusal into a purchase. */
const PAYWALLED =
  /\b(?:s ?abonner|abonnement|abonne|subscribe|subscription|abbonati|abbonamento|suscribirse|suscripcion|abonnieren|abo|pay|payer|paid|premium|sans publicite|senza pubblicita|sin publicidad|werbefrei)\b/;

export const noCookieWall = defineRule({
  id: 'NO_COOKIE_WALL',
  category: CATEGORY.FAIRNESS,
  severity: SEVERITY.BLOCKING,
  weight: 4,
  title: 'Refusal not conditioned on payment',
  legalBasis: [
    { source: 'GDPR', ref: 'art. 4(11), art. 7(4), recital 42' },
    { source: 'CNIL', ref: 'critères d’évaluation des cookie walls, 2022' },
    { source: 'EDPB', ref: 'Opinion 08/2024 on consent or pay' },
  ],
  remediation:
    'Offer a way to refuse that costs nothing. Where a paid alternative is also offered, it has to sit beside a free refusal rather than replace it — and the free path must not be materially worse.',
  falsePositiveNotes:
    'Fires only on the label of the control the tool identified as the refusal, matched on whole words against a small multilingual list. It reports that refusing was offered as a purchase; it does not pronounce on whether that particular arrangement is lawful, which the guidance says depends on facts this tool cannot see.',

  evaluate(audit) {
    const refuse = audit.banner?.controls?.refuse ?? null;
    if (!audit.banner?.found) return notApplicable('no banner was located');
    if (!refuse) {
      return notApplicable('no refusal control was identified on the first layer');
    }

    const label = normaliseLabel(labelOf(refuse));
    if (!PAYWALLED.test(label)) {
      return pass([evidence('The refusal is offered without a price', `“${labelOf(refuse)}”`)]);
    }

    return fail(
      [
        evidence('Refusing is offered as a purchase', `the control reads “${labelOf(refuse)}”`),
        ...(audit.banner.controls?.accept
          ? [evidence('Accepting is free', `“${labelOf(audit.banner.controls.accept)}”`)]
          : []),
      ],
      { measured: { refuseLabel: labelOf(refuse) } },
    );
  },
});
