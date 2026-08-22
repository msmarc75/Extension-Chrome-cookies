/*
 * The shared shape of a policy rule.
 *
 * Category D asks one question over and over — does the policy state this? —
 * over subjects the analysis has already read. What differs between the rules
 * is which subjects and what they are worth, so the reading lives here once.
 *
 * The four statuses map onto verdicts in a way worth stating plainly, because
 * it is where the analysis's honesty either survives or is thrown away:
 *
 *   present     → pass
 *   partial     → warn, with what the policy did say
 *   absent      → fail, quoting nothing, because there was nothing to quote
 *   unverified  → warn, never fail: the analysis claimed the policy said
 *                 something and the sentence was not in the document. That
 *                 makes the claim unusable — it does not make the site silent.
 *
 * A rule that treated `unverified` as `absent` would turn the tool's own
 * uncertainty into an accusation against the site, which is exactly the trade
 * this project refuses everywhere else.
 *
 * The second distinction is between what every policy must state and what only
 * some must. A controller with no DPO has none to name; a site relying on no
 * legitimate interest has none to describe; a site transferring nothing outside
 * the EEA has no safeguard to disclose. Those subjects are `optional`: their
 * absence is reported as an observation and never as a failure. Treating them
 * as required would fail a compliant policy for saying nothing about something
 * that does not apply to it.
 */

import { CATEGORY, SEVERITY, defineRule, evidence, fail, notApplicable, pass, warn } from '../rule.js';

/** Human wording for a subject, for the finding a reader sees. */
export const SUBJECT_LABEL = Object.freeze({
  identity_controller: 'who the controller is',
  contact_dpo: 'how to reach the data protection officer',
  data_categories: 'what data is processed',
  purposes: 'what it is used for',
  legal_bases: 'the legal basis for each purpose',
  legitimate_interests: 'which legitimate interests are relied on',
  recipients: 'who receives the data',
  third_country_transfers: 'transfers outside the EEA and their safeguard',
  retention: 'how long the data is kept',
  rights_access_rectify_erase: 'the rights of access, rectification and erasure',
  right_withdraw_consent: 'the right to withdraw consent',
  right_complain_supervisory: 'the right to complain to a supervisory authority',
  automated_decision_making: 'whether automated decisions are made',
  cookies_described: 'what is stored on the device, and why',
  consent_withdrawal_mechanism: 'how to change the cookie choice later',
});

const quoted = (text, limit = 240) =>
  text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;

/**
 * Build a category D rule over a set of subjects.
 *
 * @param {object} spec
 * @param {string} spec.id
 * @param {Array<string>} spec.subjects the ones every policy must state
 * @param {Array<string>} [spec.optional] the ones only some policies must state
 * @param {number} spec.weight
 * @param {string} spec.title
 * @param {Array<object>} spec.legalBasis
 * @param {string} spec.remediation
 * @param {'major'|'minor'} [spec.severity]
 */
export function definePolicyRule({
  id,
  subjects,
  optional = [],
  weight,
  title,
  legalBasis,
  remediation,
  severity = SEVERITY.MAJOR,
}) {
  return defineRule({
    id,
    category: CATEGORY.POLICY,
    severity,
    weight,
    title,
    legalBasis,
    remediation,

    evaluate(audit) {
      const analysis = audit.policyAnalysis;
      if (!analysis) {
        const why = audit.policy?.error
          ? `the policy could not be analysed: ${audit.policy.error.message}`
          : 'no policy analysis was available for this audit';
        return notApplicable(why);
      }

      const found = [...subjects, ...optional].map((subject) => ({
        subject,
        required: subjects.includes(subject),
        mention: analysis.mentions.find((m) => m.subject === subject) ?? null,
      }));

      const missing = [];
      const thin = [];
      const unusable = [];
      const stated = [];
      const inapplicable = [];

      for (const { subject, required, mention } of found) {
        const label = SUBJECT_LABEL[subject] ?? subject;
        if (!mention || mention.status === 'unverified') {
          unusable.push(
            evidence(
              `Could not establish whether the policy states ${label}`,
              mention?.note ?? 'the analysis returned nothing usable for this subject',
            ),
          );
          continue;
        }
        if (mention.status === 'absent') {
          const line = evidence(`The policy does not state ${label}`, mention.note ?? null);
          /* Silence about something that may not apply is not a departure. */
          if (required) missing.push(line);
          else inapplicable.push(evidence(`The policy says nothing about ${label}`, 'which is required only where it applies to the site'));
          continue;
        }
        const detail = mention.quote ? `“${quoted(mention.quote)}”` : null;
        if (mention.status === 'partial') {
          thin.push(
            evidence(
              `The policy addresses ${label} without the substance the article asks for`,
              mention.note ? `${detail ?? ''}${detail ? ' — ' : ''}${mention.note}` : detail,
            ),
          );
          continue;
        }
        stated.push(evidence(`The policy states ${label}`, detail));
      }

      const measured = {
        stated: stated.length,
        partial: thin.length,
        absent: missing.length,
        unverified: unusable.length,
        notApplicable: inapplicable.length,
        of: subjects.length,
      };

      const rest = [...thin, ...unusable, ...stated, ...inapplicable];
      if (missing.length > 0) return fail([...missing, ...rest], { measured });
      if (thin.length > 0 || unusable.length > 0) return warn(rest, { measured });
      return pass(rest, { measured });
    },
  });
}
