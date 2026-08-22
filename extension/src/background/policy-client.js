/*
 * Talking to the analysis service.
 *
 * The extension holds no API key and never will: anything shipped to a browser
 * is public, and a key in a published extension is a key on the internet. What
 * it holds is the address of a service that has one — configurable, because the
 * buyer of a self-hosted deployment will not be pointing at ours.
 *
 * The policy text is what leaves the browser. Not the URL alone: a policy
 * behind a login, a geo-fenced variant or a page rendered by script is not
 * fetchable from a server, and analysing a document the visitor did not see
 * would be analysing the wrong thing.
 */

/** Where the hosted service lives, when nothing else is configured. */
export const DEFAULT_SERVICE_ORIGIN = 'https://api.consent-audit.dev';

const ENDPOINT = '/analyze-policy';
const TIMEOUT_MS = 120_000;

export class ServiceError extends Error {
  constructor(code, message, { status = null } = {}) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Where to send policies, and with what.
 *
 * Read from `chrome.storage.local` so a deployment can be pointed elsewhere
 * without a rebuild, and so the licence token — which arrives in phase 7 — has
 * somewhere to live that the popup can write.
 */
export async function serviceSettings(storage = chrome.storage?.local) {
  const stored = (await storage?.get(['serviceOrigin', 'serviceToken'])) ?? {};
  return {
    origin: typeof stored.serviceOrigin === 'string' && stored.serviceOrigin
      ? stored.serviceOrigin.replace(/\/+$/, '')
      : DEFAULT_SERVICE_ORIGIN,
    token: typeof stored.serviceToken === 'string' ? stored.serviceToken : null,
  };
}

/**
 * Send one policy for analysis.
 *
 * @param {{text: string, url?: string|null, finalUrl?: string|null}} policy
 * @param {{origin?: string, token?: string|null, fetch?: typeof fetch}} [options]
 * @returns {Promise<object>} an analysis matching shared/schema/policy-analysis.schema.json
 */
export async function analysePolicyText(policy, options = {}) {
  const settings = options.origin ? { origin: options.origin, token: options.token ?? null } : await serviceSettings();
  const request = options.fetch ?? fetch;

  if (!policy?.text) {
    throw new ServiceError('NO_POLICY_TEXT', 'There is no policy text to analyse');
  }

  /* A model call can legitimately take half a minute; a hung socket must not
     take the audit with it. */
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await request(`${settings.origin}${ENDPOINT}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(settings.token ? { authorization: `Bearer ${settings.token}` } : {}),
      },
      body: JSON.stringify({
        text: policy.text,
        url: policy.finalUrl ?? policy.url ?? null,
      }),
      signal: abort.signal,
    });
  } catch (cause) {
    throw new ServiceError(
      abort.signal.aborted ? 'SERVICE_TIMEOUT' : 'SERVICE_UNREACHABLE',
      abort.signal.aborted
        ? `The analysis service did not answer within ${TIMEOUT_MS / 1000} s`
        : `The analysis service could not be reached: ${cause?.message ?? cause}`,
    );
  } finally {
    clearTimeout(timer);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ServiceError('SERVICE_BAD_RESPONSE', 'The analysis service did not answer with JSON', {
      status: response.status,
    });
  }

  if (!response.ok || payload?.ok !== true) {
    throw new ServiceError(
      payload?.error?.code ?? 'SERVICE_FAILED',
      payload?.error?.message ?? `The analysis service answered ${response.status}`,
      { status: response.status },
    );
  }

  return payload.data;
}
