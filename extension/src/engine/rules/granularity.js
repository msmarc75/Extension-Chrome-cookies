/*
 * Can the visitor answer per purpose, or only all-or-nothing?
 *
 * Consent must be specific. A banner offering only "accept everything" and
 * "refuse everything" cannot deliver that, whatever else it does well.
 */

import { CATEGORY, SEVERITY, defineRule, evidence, fail, notApplicable, pass, labelOf } from '../rule.js';

export const granularity = defineRule({
  id: 'GRANULARITY',
  category: CATEGORY.FAIRNESS,
  severity: SEVERITY.MAJOR,
  weight: 4,
  title: 'Choice available purpose by purpose',
  legalBasis: [
    { source: 'GDPR', ref: 'art. 6(1)(a), art. 7, recital 43' },
    { source: 'EDPB', ref: 'Guidelines 05/2020, §§ 44-46' },
    { source: 'CNIL', ref: 'délib. 2020-091, art. 2' },
  ],
  remediation:
    'Offer a per-purpose choice, reachable from the first screen, with each purpose named in terms a visitor can act on rather than by a framework category number.',

  evaluate(audit) {
    const banner = audit.banner;
    if (!banner?.found) return notApplicable('no banner was located');

    const preferences = banner.controls?.preferences ?? null;
    const inputs = banner.container?.inputs ?? [];
    const tcfPurposes = audit.profile?.tcf?.purposeConsents;

    if (preferences) {
      return pass([evidence('A per-purpose route is offered', `“${labelOf(preferences)}”`)], {
        measured: { route: 'preferences', inputsOnFirstLayer: inputs.length },
      });
    }
    if (inputs.length >= 2) {
      return pass([evidence(`${inputs.length} per-purpose controls on the first screen`)], {
        measured: { route: 'first-layer', inputsOnFirstLayer: inputs.length },
      });
    }

    return fail(
      [
        evidence('No per-purpose route was found', 'neither a preferences control nor per-purpose switches'),
        ...(Array.isArray(tcfPurposes)
          ? [evidence('The TCF API is present', `${tcfPurposes.length} purpose(s) currently consented`)]
          : []),
      ],
      { measured: { route: null, inputsOnFirstLayer: inputs.length } },
    );
  },
});
