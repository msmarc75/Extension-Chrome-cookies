/*
 * The score, and the honesty constraints on it.
 *
 * A number out of a hundred is the most quotable thing this product makes and
 * therefore the easiest to misuse, so three rules govern it.
 *
 * A failed blocking rule caps it at 49. A site that sends data to an ad
 * exchange before anyone has been asked does not get a respectable score
 * because its banner is well laid out.
 *
 * Rules that did not apply are not counted as passes. A page where no banner
 * could be found has not earned the fairness points; it has simply not been
 * measured on them, and the score says over how much it was computed.
 *
 * And it is never returned on its own. `bands` carries the wording, the count
 * of findings travels with it, and the report is expected to show both.
 */

import { SEVERITY, VERDICT } from './rule.js';

/** What a verdict costs, as a fraction of the rule's weight. */
const COST = {
  [VERDICT.FAIL]: 1,
  [VERDICT.WARN]: 0.5,
  [VERDICT.PASS]: 0,
  [VERDICT.NOT_APPLICABLE]: 0,
};

/** Ceiling imposed when a blocking rule fails. */
export const BLOCKING_CEILING = 49;

export const BANDS = Object.freeze([
  { from: 85, to: 100, key: 'broadly-compliant', label: 'Broadly consistent with the guidance' },
  { from: 60, to: 84, key: 'departures', label: 'Departures to correct' },
  { from: 0, to: 59, key: 'characterised', label: 'Characterised failures' },
]);

export const bandFor = (score) =>
  BANDS.find((band) => score >= band.from && score <= band.to) ?? BANDS[BANDS.length - 1];

/**
 * @param {Array<{rule: object, result: object}>} findings
 * @returns {object} the score and everything needed to read it honestly
 */
export function score(findings) {
  let deducted = 0;
  let applicableWeight = 0;
  let notApplicableWeight = 0;
  const blocking = [];

  for (const { rule, result } of findings) {
    if (rule.weight === 0) {
      /* Informational rules carry no weight but can still be blocking. */
      if (rule.severity === SEVERITY.BLOCKING && result.verdict === VERDICT.FAIL) {
        blocking.push(rule.id);
      }
      continue;
    }

    if (result.verdict === VERDICT.NOT_APPLICABLE) {
      notApplicableWeight += rule.weight;
      continue;
    }

    applicableWeight += rule.weight;
    deducted += rule.weight * (COST[result.verdict] ?? 0);
    if (rule.severity === SEVERITY.BLOCKING && result.verdict === VERDICT.FAIL) {
      blocking.push(rule.id);
    }
  }

  const raw = Math.max(0, Math.round(100 - deducted));
  const capped = blocking.length > 0 ? Math.min(raw, BLOCKING_CEILING) : raw;

  const counts = { fail: 0, warn: 0, pass: 0, not_applicable: 0 };
  for (const { result } of findings) counts[result.verdict] += 1;

  const coverage =
    applicableWeight + notApplicableWeight === 0
      ? 0
      : applicableWeight / (applicableWeight + notApplicableWeight);

  return {
    score: capped,
    rawScore: raw,
    /*
     * A score computed over a fraction of the rulebook is not the same object
     * as one computed over all of it, and it will be quoted as though it were
     * unless something says otherwise loudly.
     */
    provisional: coverage < 0.8,
    cappedByBlocking: blocking.length > 0 && raw > BLOCKING_CEILING,
    blockingFailures: blocking,
    band: bandFor(capped),
    deducted: Math.round(deducted * 10) / 10,
    applicableWeight,
    notApplicableWeight,
    counts,
    /*
     * The share of the rulebook that actually applied. A high score computed
     * over a third of the rules is not a high score, and the report has to be
     * able to say so.
     */
    coverage: Number(coverage.toFixed(2)),
  };
}
