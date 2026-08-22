/*
 * Is refusing as visible as accepting?
 *
 * Measured, never eyeballed: surface area from the layout box, contrast from
 * the WCAG relative-luminance formula over the colours the browser actually
 * resolved, size and weight from the computed style. The report prints both
 * sides by side, and that pair of numbers is what ends up in the consultant's
 * deliverable.
 */

import { CATEGORY, SEVERITY, defineRule, evidence, fail, notApplicable, pass } from '../rule.js';
import { prominenceOf } from '../colour.js';

/** Beyond this gap in surface area, the two answers are not offered alike. */
const AREA_TOLERANCE = 0.2;

export const refuseEqualProminence = defineRule({
  id: 'REFUSE_EQUAL_PROMINENCE',
  category: CATEGORY.FAIRNESS,
  severity: SEVERITY.MAJOR,
  weight: 6,
  title: 'Refusal as prominent as acceptance',
  legalBasis: [
    { source: 'GDPR', ref: 'art. 4(11)' },
    { source: 'CNIL', ref: 'recomm. 2020-092' },
    { source: 'EDPB', ref: 'Guidelines 03/2022 on deceptive design' },
  ],
  remediation:
    'Give both answers the same treatment: same surface, same contrast, same weight. A refusal rendered as unpainted text beside a filled acceptance button is a design choice with a legal consequence.',

  evaluate(audit) {
    const accept = audit.banner?.controls?.accept?.control ?? null;
    const refuse = audit.banner?.controls?.refuse?.control ?? null;
    if (!accept || !refuse) {
      return notApplicable('both answers must be on the same layer before they can be compared');
    }

    const a = prominenceOf(accept);
    const r = prominenceOf(refuse);
    if (a.area <= 0 || r.area <= 0) {
      return notApplicable('one of the controls had no measurable box');
    }

    const areaRatio = r.area / a.area;
    const measured = {
      acceptAreaPx: Math.round(a.area),
      refuseAreaPx: Math.round(r.area),
      areaRatio: Number(areaRatio.toFixed(2)),
      acceptContrast: a.contrast,
      refuseContrast: r.contrast,
      acceptFontSize: a.fontSize,
      refuseFontSize: r.fontSize,
      acceptFontWeight: a.fontWeight,
      refuseFontWeight: r.fontWeight,
      acceptPainted: a.painted,
      refusePainted: r.painted,
    };

    const found = [
      evidence(
        'Surface',
        `acceptance ${Math.round(a.area)} px², refusal ${Math.round(r.area)} px² (${Math.round(areaRatio * 100)}%)`,
      ),
    ];
    if (a.contrast !== null && r.contrast !== null) {
      found.push(evidence('Contrast', `acceptance ${a.contrast}:1, refusal ${r.contrast}:1`));
    }
    if (a.fontSize && r.fontSize) {
      found.push(evidence('Type size', `acceptance ${a.fontSize} px, refusal ${r.fontSize} px`));
    }
    if (a.painted !== r.painted) {
      found.push(
        evidence(
          'Treatment',
          a.painted
            ? 'the acceptance is a filled button, the refusal is not'
            : 'the refusal is a filled button, the acceptance is not',
        ),
      );
    }

    const reasons = [];
    if (areaRatio < 1 - AREA_TOLERANCE) {
      reasons.push(`the refusal covers ${Math.round((1 - areaRatio) * 100)}% less surface`);
    }
    if (a.contrast !== null && r.contrast !== null && r.contrast < a.contrast / 2) {
      reasons.push(`its contrast is less than half (${r.contrast}:1 against ${a.contrast}:1)`);
    }
    if (a.fontSize && r.fontSize && r.fontSize < a.fontSize * 0.9) {
      reasons.push('its type is smaller');
    }
    if (a.painted && !r.painted) reasons.push('it is not painted as a button at all');

    return reasons.length === 0
      ? pass(found, { measured })
      : fail([...found, evidence('Departure', reasons.join('; '))], { measured });
  },
});
