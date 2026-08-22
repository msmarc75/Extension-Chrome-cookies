/*
 * Nothing switched on before the visitor switched it on.
 *
 * Consent is an unambiguous affirmative action. A pre-ticked box is the
 * archetypal failure — settled since Planet49 — and it is measurable exactly:
 * the state the control was in before anything touched the page.
 */

import { CATEGORY, SEVERITY, defineRule, evidence, fail, notApplicable, pass } from '../rule.js';

/* A switch that cannot be turned off is disclosure, not consent. */
const STRICTLY_NECESSARY =
  /necessa|necessair|essentiel|essential|strictly|technique|technical|erforderlich|notwendig|obligatoir|required|funcional|funzional/i;

export const noPrechecked = defineRule({
  id: 'NO_PRECHECKED',
  category: CATEGORY.FAIRNESS,
  severity: SEVERITY.BLOCKING,
  weight: 5,
  title: 'No purpose switched on by default',
  legalBasis: [
    { source: 'GDPR', ref: 'art. 4(11), recital 32' },
    { source: 'CJEU', ref: 'C-673/17 Planet49' },
    { source: 'CNIL', ref: 'délib. 2020-091, art. 2' },
  ],
  remediation:
    'Every optional purpose starts off. Only strictly necessary processing may be shown as active, and it should be shown as disabled rather than as a ticked choice the visitor appears to have made.',
  falsePositiveNotes:
    'A control whose label marks it strictly necessary is not counted, nor is a disabled control — both are disclosure rather than a choice. Only controls read as visible and enabled in the located banner are considered, and the state is the one recorded before anything touched the page.',

  evaluate(audit) {
    const container = audit.banner?.container ?? null;
    const inputs = container?.inputs ?? [];
    if (!audit.banner?.found) return notApplicable('no banner was located');
    if (inputs.length === 0) {
      return notApplicable('the first layer offers no per-purpose controls to inspect');
    }

    const offending = inputs.filter(
      (input) =>
        input.checked &&
        input.visible &&
        !input.disabled &&
        !STRICTLY_NECESSARY.test(input.label ?? ''),
    );

    const necessary = inputs.filter((input) => STRICTLY_NECESSARY.test(input.label ?? ''));
    const context = necessary.length
      ? [evidence(`${necessary.length} control(s) marked strictly necessary were not counted`, necessary.map((i) => i.label).slice(0, 6).join(', '))]
      : [];

    if (offending.length === 0) {
      return pass(context, { measured: { inputs: inputs.length, prechecked: 0 } });
    }

    return fail(
      [
        ...offending.map((input) =>
          evidence(`“${input.label || input.name || input.path}” starts switched on`, input.type),
        ),
        ...context,
      ],
      { measured: { inputs: inputs.length, prechecked: offending.length } },
    );
  },
});
