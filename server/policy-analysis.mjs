/*
 * From a privacy policy to a document the report can cite.
 *
 * Everything here except one call is deterministic, and that is deliberate: the
 * model's answer is treated as a claim to be checked, not as an output to be
 * passed through. The order below is the whole design.
 *
 *   normalise → hash → truncate → ask → validate → VERIFY EVERY QUOTE → issue
 *
 * The verification step is what separates this from a summariser. A model that
 * says "the policy states its retention period" and hands back a sentence the
 * document does not contain has not found a retention period; it has written
 * one. Such a claim becomes `unverified`: it is not reported as present, and it
 * is not reported as absent either, because the tool has not established
 * absence — it has established that it cannot tell.
 */

import { readFileSync } from 'node:fs';
import { assertValid } from '../shared/schema/validate.mjs';
import {
  MODEL_SCHEMA,
  PROMPT_VERSION,
  SUBJECTS,
  SUBJECT_IDS,
  SYSTEM,
  buildUserMessage,
} from './prompts/policy-v1.mjs';
import { foldText, normaliseText, sha256, truncateForAnalysis, verifyQuote } from './text.mjs';

const SCHEMA = JSON.parse(
  readFileSync(new URL('../shared/schema/policy-analysis.schema.json', import.meta.url), 'utf8'),
);

/** A policy shorter than this is a link page, a consent wall, or an error. */
const MIN_POLICY_CHARACTERS = 400;

export class PolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PolicyError';
    this.code = code;
  }
}

/** The subject list, exported so the rules and the report speak the same names. */
export { SUBJECTS, SUBJECT_IDS, PROMPT_VERSION, MODEL_SCHEMA, SYSTEM, buildUserMessage };

/**
 * Analyse one policy.
 *
 * @param {object} options
 * @param {string} options.text the extracted policy text, as the page gave it
 * @param {string|null} [options.url]
 * @param {(request: {system: string, user: string, schema: object}) => Promise<{mentions: Array<object>, model: string}>} options.ask
 *   the model call, injected: the pipeline is tested against recorded answers,
 *   and the transport is tested separately.
 * @returns {Promise<object>} a document matching shared/schema/policy-analysis.schema.json
 */
export async function analysePolicy({ text, url = null, ask }) {
  const normalised = normaliseText(text);
  if (normalised.length < MIN_POLICY_CHARACTERS) {
    throw new PolicyError(
      'POLICY_TOO_SHORT',
      `Only ${normalised.length} characters of text — this is not a policy to analyse`,
    );
  }

  const folded = foldText(normalised);
  const { text: submitted, truncated } = truncateForAnalysis(normalised);

  const answer = await ask({
    system: SYSTEM,
    user: buildUserMessage({ text: submitted, url, truncated }),
    schema: MODEL_SCHEMA,
  });

  return assemble({ answer, normalised, folded, truncated, url });
}

/**
 * Turn the model's claims into the issued document.
 *
 * Separate from the call above so it can be driven from a recorded answer, and
 * because this is where the guarantees live: one entry per subject, in the
 * fixed order, every quote checked against the source.
 */
export function assemble({ answer, normalised, folded, truncated, url }) {
  const notes = [];
  const claimed = new Map();
  let duplicates = 0;

  for (const mention of answer?.mentions ?? []) {
    if (!SUBJECT_IDS.includes(mention?.subject)) continue;
    if (claimed.has(mention.subject)) {
      duplicates += 1;
      continue;
    }
    claimed.set(mention.subject, mention);
  }
  if (duplicates > 0) {
    notes.push({
      code: 'DUPLICATE_SUBJECTS',
      detail: `${duplicates} repeated subject(s) in the analysis; the first entry for each was kept`,
    });
  }

  let unverified = 0;
  const mentions = SUBJECTS.map(({ id }) => {
    const mention = claimed.get(id);
    if (!mention) {
      return {
        subject: id,
        status: 'unverified',
        quote: null,
        quoteVerified: false,
        note: 'The analysis returned nothing for this subject.',
      };
    }

    const note = typeof mention.note === 'string' && mention.note.trim() ? mention.note.trim() : null;

    if (mention.status === 'absent') {
      return { subject: id, status: 'absent', quote: null, quoteVerified: false, note };
    }

    const found = verifyQuote(mention.quote, normalised, folded);
    if (!found.verified) {
      unverified += 1;
      return {
        subject: id,
        status: 'unverified',
        quote: null,
        quoteVerified: false,
        /*
         * The note says what happened rather than hiding it: a reader who sees
         * a subject neither present nor absent is owed the reason, and it is
         * the reason a claim was dropped rather than a judgement on the site.
         */
        note: `Reported as ${mention.status}, but the sentence quoted could not be found in the policy, so the claim was not issued.${note ? ` The analysis added: ${note}` : ''}`,
      };
    }

    return {
      subject: id,
      status: mention.status === 'partial' ? 'partial' : 'present',
      quote: found.quote,
      quoteVerified: true,
      note,
    };
  });

  if (unverified > 0) {
    notes.push({
      code: 'UNVERIFIED_QUOTES',
      detail: `${unverified} claim(s) came back with a sentence the policy does not contain and were not issued`,
    });
  }
  if (truncated) {
    notes.push({
      code: 'POLICY_TRUNCATED',
      detail: 'The policy was longer than the analysis ceiling; a subject stated only in the part that was cut would read as absent',
    });
  }

  const document = {
    schemaVersion: 1,
    promptVersion: PROMPT_VERSION,
    model: answer?.model ?? 'unknown',
    source: {
      sha256: sha256(normalised),
      characters: normalised.length,
      truncated,
      url: url ?? null,
    },
    mentions,
    notes,
  };

  assertValid(document, SCHEMA, 'Policy analysis');
  return document;
}

/** The cache key: same text, same prompt, same model — same answer. */
export const cacheKey = ({ sha256: hash, model }) =>
  `${hash}.${PROMPT_VERSION}.${String(model).replace(/[^\w.-]/g, '_')}`;

export { SCHEMA as POLICY_ANALYSIS_SCHEMA, sha256, normaliseText };
