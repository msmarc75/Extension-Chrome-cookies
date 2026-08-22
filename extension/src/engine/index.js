/*
 * Running the rulebook over one audit.
 *
 * Pure: an audit in, a report out, no browser and no clock. Everything the
 * rules read was measured elsewhere and is already in the audit object, which
 * is what lets the whole engine be driven from recorded captures.
 */

import { VERDICT } from './rule.js';
import { score } from './scoring.js';

import { exemptionCheck } from './rules/exemption-check.js';
import { preConsentCookies } from './rules/pre-consent-cookies.js';
import { preConsentFingerprint } from './rules/pre-consent-fingerprint.js';
import { preConsentStorage } from './rules/pre-consent-storage.js';
import { preConsentTrackers } from './rules/pre-consent-trackers.js';

import { granularity } from './rules/granularity.js';
import { noCookieWall } from './rules/no-cookie-wall.js';
import { noDarkPattern } from './rules/no-dark-pattern.js';
import { noPrechecked } from './rules/no-prechecked.js';
import { refuseEqualProminence } from './rules/refuse-equal-prominence.js';
import { refuseSameLayer } from './rules/refuse-same-layer.js';
import { withdrawalAccessible } from './rules/withdrawal-accessible.js';

import { controllersIdentified } from './rules/controllers-identified.js';
import { policyReachable } from './rules/policy-reachable.js';
import { purposesStated } from './rules/purposes-stated.js';
import { retentionStated } from './rules/retention-stated.js';

/*
 * Order matters in one place only: NO_DARK_PATTERN reads what the other
 * fairness rules found, so it runs last.
 */
export const RULES = Object.freeze([
  preConsentTrackers,
  preConsentCookies,
  preConsentStorage,
  preConsentFingerprint,
  exemptionCheck,

  refuseSameLayer,
  refuseEqualProminence,
  noPrechecked,
  granularity,
  noCookieWall,
  withdrawalAccessible,
  noDarkPattern,

  purposesStated,
  controllersIdentified,
  retentionStated,
  policyReachable,
]);

export const ruleById = (id) => RULES.find((rule) => rule.id === id) ?? null;

/**
 * @param {object} audit
 * @param {object} audit.captureA the untouched observation
 * @param {object} [audit.profile] the page profile the banner was found in
 * @param {object} [audit.cmp] result of identifyCmp
 * @param {object} [audit.banner] result of locateBanner
 * @param {object} [audit.refusal] result of driving a refusal
 * @param {object} [audit.profileAfterAcceptance] the page as it stands after accepting
 * @returns {object} the report
 */
export function assess(audit) {
  const byId = new Map();
  const findings = [];

  for (const rule of RULES) {
    let result;
    try {
      result = rule.evaluate(audit, byId);
    } catch (cause) {
      /*
       * A rule that throws is a defect in this project, not a finding about the
       * site. It is reported as unevaluated rather than swallowed, and it never
       * costs the site a point.
       */
      result = {
        verdict: VERDICT.NOT_APPLICABLE,
        evidence: [],
        because: `the rule failed to evaluate: ${cause instanceof Error ? cause.message : String(cause)}`,
        errored: true,
      };
    }
    byId.set(rule.id, result);
    findings.push({ rule, result });
  }

  const scored = score(findings);

  return {
    ...scored,
    findings: findings.map(({ rule, result }) => ({
      id: rule.id,
      title: rule.title,
      category: rule.category,
      severity: rule.severity,
      weight: rule.weight,
      legalBasis: rule.legalBasis,
      remediation: rule.remediation,
      verdict: result.verdict,
      evidence: result.evidence,
      measured: result.measured ?? null,
      because: result.because ?? null,
      temperedBecause: result.temperedBecause ?? null,
      errored: result.errored === true,
    })),
    /*
     * Everything that limits how far the report can be read, gathered where the
     * reader will see it rather than left in the documentation.
     */
    disclosures: [
      ...(audit.captureA?.profile === 'current'
        ? [
            'Measured in the visitor’s own profile. What was deposited is recorded, but that it was deposited before consent is not established — the site may be acting on a choice made earlier.',
          ]
        : []),
      ...(audit.banner?.disclosure ? [audit.banner.disclosure] : []),
      ...(audit.captureA?.notes ?? []).map((note) => `Capture limitation: ${note.code}.`),
      ...(scored.coverage < 0.8
        ? [
            `Scored over ${Math.round(scored.coverage * 100)}% of the rulebook — the rest did not apply to this page. A score computed over part of the rules is not comparable with one computed over all of them.`,
          ]
        : []),
      'Privacy policy analysis is not yet part of this build, so 15 points of the rulebook are absent from every score.',
    ],
  };
}
