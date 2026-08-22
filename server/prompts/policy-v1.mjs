/*
 * The policy prompt, version 1.
 *
 * Versioned as a file rather than a string constant because a change of wording
 * changes the findings, and a report issued last month must remain
 * reproducible: the analysis records which prompt produced it and the cache is
 * keyed on it, so editing this file invalidates nothing silently — it simply
 * stops being a cache hit.
 *
 * Two properties matter more than any phrasing here:
 *
 *   The model is asked for the sentence, not for a summary. Every claim that a
 *   policy says something comes back with the sentence it says it in, and the
 *   server then looks for that sentence in the source. A claim whose sentence
 *   cannot be found does not become a finding. (The API's citation feature
 *   would guarantee verbatim spans, but cannot be combined with a strict output
 *   schema — see docs/roadmap.md. Verifying here keeps both.)
 *
 *   Absence is a claim too. "The policy does not say" is the finding a site
 *   will argue with, so the model is told to prefer `partial` when in doubt and
 *   the server records what could have limited it.
 */

export const PROMPT_VERSION = 'policy-v1';

/** What the analysis looks for, and the article that asks for it. */
export const SUBJECTS = Object.freeze([
  {
    id: 'identity_controller',
    ref: 'GDPR art. 13(1)(a)',
    asks: 'The identity of the controller — a nameable legal person, not "we" or the site name alone — and how to reach them.',
  },
  {
    id: 'contact_dpo',
    ref: 'GDPR art. 13(1)(b)',
    asks: 'Contact details of the data protection officer, where one exists. A generic contact form is not a DPO contact.',
  },
  {
    id: 'data_categories',
    ref: 'GDPR art. 14(1)(d), art. 13',
    asks: 'What categories of personal data are processed, stated specifically enough to be checked.',
  },
  {
    id: 'purposes',
    ref: 'GDPR art. 13(1)(c)',
    asks: 'The purposes of the processing, named rather than gestured at. "To improve your experience" alone is not a purpose.',
  },
  {
    id: 'legal_bases',
    ref: 'GDPR art. 6, art. 13(1)(c)',
    asks: 'The legal basis for each purpose — consent, contract, legal obligation, legitimate interests.',
  },
  {
    id: 'legitimate_interests',
    ref: 'GDPR art. 13(1)(d)',
    asks: 'Where legitimate interests are relied on, which interests, stated specifically.',
  },
  {
    id: 'recipients',
    ref: 'GDPR art. 13(1)(e)',
    asks: 'Who receives the data — recipients or categories of recipients, including processors and advertising partners.',
  },
  {
    id: 'third_country_transfers',
    ref: 'GDPR art. 13(1)(f), art. 44 et seq.',
    asks: 'Transfers outside the EEA, and the safeguard relied on (adequacy decision, standard contractual clauses, derogation).',
  },
  {
    id: 'retention',
    ref: 'GDPR art. 13(2)(a)',
    asks: 'How long the data is kept, or the criteria used to decide. "As long as necessary" alone is at best partial.',
  },
  {
    id: 'rights_access_rectify_erase',
    ref: 'GDPR art. 13(2)(b), art. 15–18, art. 20–21',
    asks: 'The data subject rights: access, rectification, erasure, restriction, portability, objection.',
  },
  {
    id: 'right_withdraw_consent',
    ref: 'GDPR art. 7(3), art. 13(2)(c)',
    asks: 'The right to withdraw consent at any time, and that withdrawal is as easy as giving it.',
  },
  {
    id: 'right_complain_supervisory',
    ref: 'GDPR art. 13(2)(d), art. 77',
    asks: 'The right to lodge a complaint with a supervisory authority.',
  },
  {
    id: 'automated_decision_making',
    ref: 'GDPR art. 13(2)(f), art. 22',
    asks: 'Whether automated decision-making or profiling with legal or similarly significant effects takes place, and its logic.',
  },
  {
    id: 'cookies_described',
    ref: 'ePrivacy art. 5(3); CNIL délib. 2020-091',
    asks: 'What is stored on or read from the terminal, and what for. A cookie table, or prose naming the trackers, both count.',
  },
  {
    id: 'consent_withdrawal_mechanism',
    ref: 'GDPR art. 7(3); CNIL recomm. 2020-092',
    asks: 'A stated way to change or withdraw the cookie choice later — a named link, a settings page, a described control.',
  },
]);

export const SUBJECT_IDS = Object.freeze(SUBJECTS.map((subject) => subject.id));

/**
 * The schema handed to the API, which is not the schema of the document this
 * server issues: `quoteVerified` is the server's word, never the model's, and
 * `unverified` is a status only the server can assign.
 */
export const MODEL_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['mentions'],
  properties: {
    mentions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['subject', 'status', 'quote', 'note'],
        properties: {
          subject: { type: 'string', enum: [...SUBJECT_IDS] },
          status: { type: 'string', enum: ['present', 'partial', 'absent'] },
          quote: {
            type: ['string', 'null'],
            description:
              'One sentence copied character for character from the policy, or null when the status is absent.',
          },
          note: {
            type: ['string', 'null'],
            description: 'At most one sentence saying what is missing or why this is only partial.',
          },
        },
      },
    },
  },
});

export const SYSTEM = `You read privacy policies against a fixed checklist and report what each one states. You are a careful reader working for an auditor, not an advocate for either side.

Rules you do not depart from:

1. For every subject in the checklist, return exactly one entry. Never omit a subject, never invent one, never return two entries for the same subject.

2. When a subject is addressed, quote ONE sentence from the policy, copied character for character. Do not paraphrase, do not repair grammar, do not translate, do not join two sentences, do not add an ellipsis. The quote is checked against the source and a claim whose quote cannot be found is discarded.

3. Status:
   - "present": the policy states what the checklist asks for, with the substance, not only the topic.
   - "partial": the subject is addressed but the substance the article asks for is missing — a purpose named as "improving your experience", a retention stated as "as long as necessary", a list of recipients given as "our partners".
   - "absent": you found nothing on the subject. Use null for the quote.
   Prefer "partial" over "absent" when you are unsure; absence is a claim the site will contest.

4. Judge only what is in the text you were given. If the text refers to another document — a cookie policy, a group privacy charter — that is at most "partial", with a note saying so. Never assume what an unread page contains.

5. The note is at most one sentence, and only where it adds something: what is missing, or why this is partial rather than present. Otherwise null.

You are producing findings, not legal advice. Describe what the document says. Do not pronounce on lawfulness, do not recommend, do not warn.`;

/**
 * @param {object} options
 * @param {string} options.text the normalised policy text
 * @param {string|null} [options.url]
 * @param {boolean} [options.truncated]
 */
export function buildUserMessage({ text, url = null, truncated = false }) {
  const checklist = SUBJECTS.map(
    (subject) => `- ${subject.id} (${subject.ref}): ${subject.asks}`,
  ).join('\n');

  const provenance = url ? `The document was retrieved from ${url}.` : 'The source URL is unknown.';
  const cut = truncated
    ? '\n\nThis text was truncated at the analysis ceiling. A subject stated only in the part that was cut will look absent to you; where a subject seems absent and the document reads as unfinished, say so in the note.'
    : '';

  return `${provenance}${cut}

Checklist:
${checklist}

Policy text:
<policy>
${text}
</policy>`;
}
