/*
 * The shape every rule has, and the guarantees the engine enforces on it.
 *
 * A rule that returns a verdict without the observations behind it is not
 * something a consultant can bill for, and not something a site owner can
 * argue with. So `evaluate` returns the verdict *and* its evidence together
 * rather than exposing them as two functions the caller might use apart — a
 * deliberate departure from the plan's sketch, for that reason.
 *
 * The vocabulary is that of a finding, never of a legal conclusion. A rule may
 * say "this cookie was written 1.2 s after load, before any interaction". It
 * may not say the site is unlawful. See docs/methodology.md.
 */

export const VERDICT = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
  WARN: 'warn',
  NOT_APPLICABLE: 'not_applicable',
});

export const SEVERITY = Object.freeze({
  BLOCKING: 'blocking',
  MAJOR: 'major',
  MINOR: 'minor',
  INFORMATIONAL: 'informational',
});

export const CATEGORY = Object.freeze({
  DEPOSIT: 'deposit',
  FAIRNESS: 'fairness',
  INFORMATION: 'information',
  POLICY: 'policy',
});

const REQUIRED = ['id', 'category', 'severity', 'weight', 'legalBasis', 'evaluate', 'remediation'];

/**
 * Declare a rule, failing loudly on a malformed one.
 *
 * The checks are not ceremony. A rule with no legal basis is an opinion; a
 * blocking rule with no note on how it could be wrong is a rule nobody has
 * thought adversarially about, and blocking rules are the ones that cost the
 * product its credibility when they misfire.
 */
export function defineRule(spec) {
  for (const key of REQUIRED) {
    if (spec[key] === undefined) throw new Error(`Rule ${spec.id ?? '?'} is missing "${key}"`);
  }
  if (!Object.values(SEVERITY).includes(spec.severity)) {
    throw new Error(`Rule ${spec.id}: unknown severity "${spec.severity}"`);
  }
  if (!Object.values(CATEGORY).includes(spec.category)) {
    throw new Error(`Rule ${spec.id}: unknown category "${spec.category}"`);
  }
  if (!Array.isArray(spec.legalBasis) || spec.legalBasis.length === 0) {
    throw new Error(`Rule ${spec.id}: a rule that cannot cite anything does not ship`);
  }
  if (spec.severity === SEVERITY.BLOCKING && !spec.falsePositiveNotes) {
    throw new Error(`Rule ${spec.id}: a blocking rule must say how it could be wrong`);
  }
  return Object.freeze({ falsePositiveNotes: null, ...spec });
}

/**
 * The label of a located control.
 *
 * The detector returns `{control, match}`; anything that has already been
 * summarised for transport carries a bare `label`. A rule must not have to know
 * which it was handed — and a finding whose evidence reads "undefined" is worse
 * than no finding at all, which is what this exists to prevent.
 */
export const labelOf = (found) => found?.match?.label ?? found?.label ?? null;

/** An observation, as it will be printed under the finding. */
export const evidence = (what, detail = null, tMs = null) => ({ what, detail, tMs });

export const pass = (evidenceList = [], extra = {}) => ({
  verdict: VERDICT.PASS,
  evidence: evidenceList,
  ...extra,
});
export const fail = (evidenceList, extra = {}) => ({
  verdict: VERDICT.FAIL,
  evidence: evidenceList,
  ...extra,
});
export const warn = (evidenceList, extra = {}) => ({
  verdict: VERDICT.WARN,
  evidence: evidenceList,
  ...extra,
});
export const notApplicable = (why) => ({
  verdict: VERDICT.NOT_APPLICABLE,
  evidence: [],
  because: why,
});

/**
 * A capture taken in the visitor's own profile cannot establish what a *first*
 * visitor receives: the site may be acting on a choice made weeks ago. What was
 * deposited is still a fact, so the finding stands — but as a question, not as
 * a breach, and it says why.
 *
 * @param {object} result a rule result
 * @param {object} capture the capture it was drawn from
 */
export function temperForProfile(result, capture) {
  if (capture?.profile !== 'current' || result.verdict !== VERDICT.FAIL) return result;
  return {
    ...result,
    verdict: VERDICT.WARN,
    temperedBecause:
      'Measured in the visitor’s own profile, where the site may be acting on a choice made earlier. What was deposited is recorded; that it was deposited *before consent* is not established. Re-run in a clean window to settle it.',
  };
}
