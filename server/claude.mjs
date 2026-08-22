/*
 * The one call in this service that leaves the building.
 *
 * It lives alone in its own module for two reasons. The pipeline is tested
 * against recorded answers and must not need an API key to be tested at all;
 * and the key itself must never be anywhere near the extension — this file is
 * the reason the analysis is server-side, and the only place `ANTHROPIC_API_KEY`
 * is read.
 *
 * The model is `claude-opus-5` and is not downgraded to save money: the task is
 * adversarial reading of legal prose, where a missed mention becomes a false
 * clean bill of health. That is a decision for whoever pays for the product,
 * recorded in docs/roadmap.md, not one to take quietly here.
 */

import Anthropic from '@anthropic-ai/sdk';

export const DEFAULT_MODEL = 'claude-opus-5';

/** Enough for fifteen findings with a quote each, and their notes. */
const MAX_TOKENS = 16_000;

export class ModelError extends Error {
  constructor(code, message, { status = null, cause = null } = {}) {
    super(message);
    this.name = 'ModelError';
    this.code = code;
    this.status = status;
    this.cause = cause;
  }
}

/**
 * Build the `ask` function the pipeline takes.
 *
 * @param {object} [options]
 * @param {string} [options.apiKey] defaults to ANTHROPIC_API_KEY
 * @param {string} [options.model]
 * @returns {(request: {system: string, user: string, schema: object}) => Promise<{mentions: Array<object>, model: string}>}
 */
export function claudeAsk({ apiKey = process.env.ANTHROPIC_API_KEY, model = DEFAULT_MODEL } = {}) {
  if (!apiKey) {
    throw new ModelError('NO_API_KEY', 'ANTHROPIC_API_KEY is not set — the analysis cannot run');
  }
  const client = new Anthropic({ apiKey });

  return async function ask({ system, user, schema }) {
    let message;
    try {
      /*
       * Streamed, not because anything downstream consumes tokens as they
       * arrive, but because a policy of fifty thousand characters against a
       * large output budget is exactly the shape of request that meets a
       * transport timeout when it is sent as one blocking call.
       */
      message = await client.messages
        .stream({
          model,
          max_tokens: MAX_TOKENS,
          thinking: { type: 'adaptive' },
          system,
          messages: [{ role: 'user', content: user }],
          output_config: { format: { type: 'json_schema', schema } },
        })
        .finalMessage();
    } catch (cause) {
      throw new ModelError('MODEL_CALL_FAILED', cause?.message ?? 'the model call failed', {
        status: cause?.status ?? null,
        cause,
      });
    }

    if (message.stop_reason === 'refusal') {
      throw new ModelError('MODEL_REFUSED', 'The model declined to analyse this document');
    }
    if (message.stop_reason === 'max_tokens') {
      throw new ModelError('MODEL_TRUNCATED', 'The analysis was cut off before it was complete');
    }

    const text = message.content.find((block) => block.type === 'text')?.text;
    if (!text) {
      throw new ModelError('MODEL_EMPTY', 'The model returned no text block');
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (cause) {
      /* With a format schema this should not happen; if it does, it is not
         something to paper over with a regex. */
      throw new ModelError('MODEL_NOT_JSON', 'The model returned text that is not JSON', { cause });
    }

    return { mentions: parsed?.mentions ?? [], model: message.model ?? model };
  };
}
