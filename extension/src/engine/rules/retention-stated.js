/*
 * Is the visitor told how long?
 *
 * The least often satisfied of the information requirements, and the easiest to
 * check: a duration either appears on the first screen or it does not.
 */

import { CATEGORY, SEVERITY, defineRule, evidence, fail, notApplicable, pass } from '../rule.js';

const DURATION =
  /(\d[\d\s .,]{0,4})\s*(?:mois|months?|jours?|days?|ans?|années?|years?|semaines?|weeks?|monate|tage|jahre|meses|dias|años|mesi|giorni|anni)\b/i;

export const retentionStated = defineRule({
  id: 'RETENTION_STATED',
  category: CATEGORY.INFORMATION,
  severity: SEVERITY.MINOR,
  weight: 4,
  title: 'Retention period stated',
  legalBasis: [
    { source: 'GDPR', ref: 'art. 13(2)(a)' },
    { source: 'CNIL', ref: 'délib. 2020-091, art. 2 — 6 months for the consent record, 13 months for trackers' },
  ],
  remediation:
    'State how long the trackers last and how long the choice is remembered. The CNIL’s reference figures — trackers no more than 13 months, the record of the choice about 6 — are what a reader will compare against.',

  evaluate(audit) {
    const banner = audit.banner;
    if (!banner?.found) return notApplicable('no banner was located');

    const text = banner.container?.text ?? '';
    if (text.length === 0) return notApplicable('the banner carried no readable text');

    const match = DURATION.exec(text);
    if (!match) {
      return fail([evidence('No retention period appears on the first screen', null)], {
        measured: { stated: false },
      });
    }
    return pass([evidence('A retention period is stated', `“${match[0].trim()}”`)], {
      measured: { stated: true, quoted: match[0].trim() },
    });
  },
});
