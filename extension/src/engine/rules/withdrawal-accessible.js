/*
 * Can the visitor change their mind afterwards?
 *
 * Withdrawing consent must be as easy as giving it. Judged on the page as it
 * stands after an acceptance — if nothing on it offers a way back to the
 * choice, there is nothing to withdraw with.
 */

import { CATEGORY, SEVERITY, defineRule, evidence, fail, notApplicable, pass } from '../rule.js';
import { classifyControl } from '../../content/label-match.js';

const WITHDRAWAL = /cookie|consent|consentement|privacy|confidentialite|traceur|datenschutz|privacidad|preferen/i;

export const withdrawalAccessible = defineRule({
  id: 'WITHDRAWAL_ACCESSIBLE',
  category: CATEGORY.FAIRNESS,
  severity: SEVERITY.MAJOR,
  weight: 2,
  title: 'A permanent way back to the choice',
  legalBasis: [
    { source: 'GDPR', ref: 'art. 7(3)' },
    { source: 'CNIL', ref: 'délib. 2020-091, art. 3' },
  ],
  remediation:
    'Keep a visible, permanent control — a footer link or a floating badge — that reopens the consent choice from any page, and make using it no harder than giving consent was.',

  evaluate(audit) {
    const after = audit.profileAfterAcceptance ?? null;
    if (!after) {
      return notApplicable('the page after acceptance was not examined');
    }

    const candidates = [];
    for (const container of after.containers ?? []) {
      for (const control of container.controls ?? []) {
        if (!control.visible) continue;
        const text = `${control.text} ${control.ariaLabel ?? ''} ${control.id ?? ''} ${control.classes.join(' ')}`;
        if (!WITHDRAWAL.test(text)) continue;
        const classified = classifyControl(control);
        if (classified.intent === 'policy') continue;
        candidates.push(control);
      }
    }

    if (candidates.length === 0) {
      return fail([
        evidence('Nothing on the page after acceptance offers a way back to the choice', null),
      ]);
    }

    return pass(
      candidates
        .slice(0, 5)
        .map((control) => evidence('A way back to the choice', `“${control.text || control.ariaLabel}”`)),
      { measured: { controls: candidates.length } },
    );
  },
});
