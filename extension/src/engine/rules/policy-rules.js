/*
 * Category D — what the privacy policy states.
 *
 * Fifteen points across five rules, each over the subjects an article of the
 * Regulation actually asks for. They are grouped by what a site would fix in
 * one sitting rather than one rule per article: a policy that names no
 * recipients and discloses no transfer has one problem, not two.
 *
 * Every finding here is downstream of the quote verification in the analysis
 * service. A rule can only see what survived it.
 */

import { SEVERITY } from '../rule.js';
import { definePolicyRule } from './policy-subject.js';

export const policyIdentifiesController = definePolicyRule({
  id: 'POLICY_IDENTIFIES_CONTROLLER',
  subjects: ['identity_controller'],
  /* Not every controller must designate a DPO, so its absence is an
     observation rather than a departure. */
  optional: ['contact_dpo'],
  weight: 3,
  title: 'Controller identified in the policy',
  legalBasis: [
    { source: 'GDPR', ref: 'art. 13(1)(a), art. 13(1)(b)' },
    { source: 'GDPR', ref: 'art. 37 (designation of a DPO)' },
  ],
  remediation:
    'Name the controller as a legal person, with an address and a means of contact, and the data protection officer where one is designated. "We" and the brand name are not an identity.',
});

export const policyStatesPurposes = definePolicyRule({
  id: 'POLICY_STATES_PURPOSES',
  subjects: ['purposes', 'legal_bases', 'data_categories', 'cookies_described'],
  optional: ['legitimate_interests'],
  weight: 4,
  title: 'Purposes, legal bases and data stated in the policy',
  legalBasis: [
    { source: 'GDPR', ref: 'art. 13(1)(c)' },
    { source: 'GDPR', ref: 'art. 6' },
    { source: 'EDPB', ref: 'Guidelines on transparency (WP260 rev.01)' },
  ],
  remediation:
    'State each purpose in the visitor’s terms and the legal basis it rests on, purpose by purpose. A single list of purposes followed by a single list of bases leaves the reader to guess which goes with which.',
});

export const policyNamesRecipients = definePolicyRule({
  id: 'POLICY_NAMES_RECIPIENTS',
  subjects: ['recipients'],
  /* A site transferring nothing outside the EEA has no safeguard to disclose. */
  optional: ['third_country_transfers'],
  weight: 3,
  title: 'Recipients and transfers disclosed',
  legalBasis: [
    { source: 'GDPR', ref: 'art. 13(1)(e), art. 13(1)(f)' },
    { source: 'GDPR', ref: 'art. 44 et seq.' },
  ],
  remediation:
    'Name the recipients, or at minimum their categories, and for any transfer outside the EEA the safeguard relied on — adequacy decision, standard contractual clauses, or the derogation invoked.',
});

export const policyStatesRetention = definePolicyRule({
  id: 'POLICY_STATES_RETENTION',
  subjects: ['retention'],
  weight: 2,
  severity: SEVERITY.MINOR,
  title: 'Retention period stated in the policy',
  legalBasis: [
    { source: 'GDPR', ref: 'art. 13(2)(a)' },
    { source: 'CNIL', ref: 'délib. 2020-091 (13 months for consent and for measurement data)' },
  ],
  remediation:
    'Give a period, or the criteria that fix one, for each category of data. "As long as necessary" states nothing a reader can check.',
});

export const policyStatesRights = definePolicyRule({
  id: 'POLICY_STATES_RIGHTS',
  subjects: [
    'rights_access_rectify_erase',
    'right_withdraw_consent',
    'right_complain_supervisory',
    'consent_withdrawal_mechanism',
  ],
  optional: ['automated_decision_making'],
  weight: 3,
  title: 'Rights and how to exercise them',
  legalBasis: [
    { source: 'GDPR', ref: 'art. 13(2)(b), art. 13(2)(c), art. 13(2)(d)' },
    { source: 'GDPR', ref: 'art. 7(3), art. 15–21, art. 77' },
  ],
  remediation:
    'List the rights, say how to exercise them, and give a working way to change or withdraw the cookie choice — a named link or control, not a description of one.',
});
