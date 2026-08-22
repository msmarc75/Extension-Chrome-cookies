/*
 * The analysis service.
 *
 * Written against `node:http` with no framework: it routes five paths and parses
 * one JSON body, which is not a problem worth a dependency — and this process
 * holds an API key and a Stripe key, so its dependency list is something to be
 * able to read in an afternoon.
 *
 * What it exists for: the key stays here. An extension cannot hold one, because
 * anything shipped to a browser is public. Every policy the extension wants
 * analysed is posted here as text, and the extension never learns how the
 * analysis is made.
 */

import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AnalysisCache } from './cache.mjs';
import { BillingError, decideFromEvent } from './billing.mjs';
import { LicenceStore, PLANS, issueLicence, revokeLicence, verifyLicence } from './licence.mjs';
import { DEFAULT_MODEL, ModelError, claudeAsk } from './claude.mjs';
import {
  PROMPT_VERSION,
  PolicyError,
  analysePolicy,
  cacheKey,
  normaliseText,
  sha256,
} from './policy-analysis.mjs';

/** A policy is text. A megabyte of it is already three times the ceiling. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const json = (response, status, payload) => {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    /* The caller is an extension, which is not an origin any browser will
       send a useful `Origin` for. Nothing here is credentialed. */
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization',
  });
  response.end(body);
};

const fail = (response, status, code, message) =>
  json(response, status, { ok: false, error: { code, message } });

function readRawBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new PolicyError('BODY_TOO_LARGE', `More than ${MAX_BODY_BYTES} bytes of body`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

/*
 * Stripe signs the bytes it sent. Parsing the body and re-serialising it
 * changes one somewhere — a space, a number's exponent — and the signature
 * stops matching, which is the classic way this integration is broken. So the
 * webhook route reads the buffer and nothing else touches it.
 */
const readBody = async (request) => (await readRawBody(request)).toString('utf8');

/**
 * A shared secret, when one is configured.
 *
 * An operational guard for a self-hosted deployment, and separate from the
 * licence system: the token says which *deployment* may be used, the licence
 * says which *customer* may use it. A self-hoster wants the first and no part
 * of the second. Compared in constant time because a token comparison that
 * leaks its position is a token comparison worth nothing.
 */
function authorised(request, token) {
  if (!token) return true;
  const offered = String(request.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(offered);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * @param {object} [options]
 * @param {(request: object) => Promise<object>} [options.ask] the model call, injectable for tests
 * @param {AnalysisCache} [options.cache]
 * @param {string} [options.model]
 * @param {string|null} [options.token]
 * @param {LicenceStore|null} [options.licences] when given, the analysis endpoint
 *   requires a valid licence key and the billing routes are served
 * @param {object|null} [options.billing] the Stripe wrapper, injectable for tests
 * @param {{successUrl: string, cancelUrl: string}} [options.checkoutUrls]
 */
export function createAnalysisServer({
  ask = null,
  cache = new AnalysisCache(
    process.env.CONSENT_AUDIT_CACHE_DIR ?? fileURLToPath(new URL('.cache/', import.meta.url)),
  ),
  model = process.env.CONSENT_AUDIT_MODEL ?? DEFAULT_MODEL,
  token = process.env.CONSENT_AUDIT_SERVER_TOKEN ?? null,
  licences = process.env.CONSENT_AUDIT_LICENCE_DIR
    ? new LicenceStore(process.env.CONSENT_AUDIT_LICENCE_DIR)
    : null,
  billing = null,
  checkoutUrls = {
    successUrl: process.env.CONSENT_AUDIT_SUCCESS_URL ?? 'https://consent-audit.dev/thanks',
    cancelUrl: process.env.CONSENT_AUDIT_CANCEL_URL ?? 'https://consent-audit.dev/pricing',
  },
} = {}) {
  /* Built on the first request rather than at construction, so a server can be
     started and health-checked in an environment that has no key. */
  let askModel = ask;
  const modelCall = () => {
    if (!askModel) askModel = claudeAsk({ model });
    return askModel;
  };

  return createServer(async (request, response) => {
    const { pathname } = new URL(request.url, 'http://localhost');

    if (request.method === 'OPTIONS') {
      json(response, 204, {});
      return;
    }

    if (request.method === 'GET' && pathname === '/health') {
      json(response, 200, {
        ok: true,
        data: {
          model,
          promptVersion: PROMPT_VERSION,
          keyConfigured: Boolean(ask || process.env.ANTHROPIC_API_KEY),
          cache: cache.stats(),
        },
      });
      return;
    }

    /* ---- Billing ------------------------------------------------------- */

    if (pathname === '/stripe/webhook') {
      if (request.method !== 'POST') {
        fail(response, 405, 'METHOD_NOT_ALLOWED', 'Stripe posts to this endpoint');
        return;
      }
      await handleWebhook(request, response, { licences, billing });
      return;
    }

    if (pathname === '/checkout') {
      if (request.method !== 'POST') {
        fail(response, 405, 'METHOD_NOT_ALLOWED', 'POST a plan to this endpoint');
        return;
      }
      await handleCheckout(request, response, { billing, checkoutUrls });
      return;
    }

    if (pathname === '/licence/verify') {
      if (request.method !== 'POST') {
        fail(response, 405, 'METHOD_NOT_ALLOWED', 'POST a licence key to this endpoint');
        return;
      }
      await handleVerify(request, response, { licences });
      return;
    }

    /* ---- Analysis ------------------------------------------------------- */

    if (pathname !== '/analyze-policy') {
      fail(response, 404, 'NOT_FOUND', `No route for ${request.method} ${pathname}`);
      return;
    }
    if (request.method !== 'POST') {
      fail(response, 405, 'METHOD_NOT_ALLOWED', 'POST a policy to this endpoint');
      return;
    }
    if (!authorised(request, token)) {
      fail(response, 401, 'UNAUTHORISED', 'A valid bearer token is required');
      return;
    }

    try {
      const raw = await readBody(request);
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        fail(response, 400, 'BAD_JSON', 'The body is not JSON');
        return;
      }

      if (typeof payload?.text !== 'string') {
        fail(response, 400, 'NO_TEXT', 'Send the policy text as `text`');
        return;
      }

      /*
       * Where the money is. An analysis costs the operator real tokens, so a
       * deployment that sells licences requires one here — and says which plan
       * would be needed rather than refusing blankly, because a caller who
       * cannot tell a lapsed licence from a missing feature opens a ticket.
       */
      if (licences) {
        const licence = verifyLicence(licences, payload.licenceKey);
        if (!licence.valid) {
          fail(response, 402, `LICENCE_${licence.reason}`, 'A valid licence is required to analyse a policy');
          return;
        }
        if (!licence.entitlements.policyAnalysis) {
          fail(response, 402, 'PLAN_WITHOUT_POLICY_ANALYSIS', `The ${licence.plan} plan does not include policy analysis`);
          return;
        }
      }

      const url = typeof payload.url === 'string' ? payload.url : null;
      const key = cacheKey({ sha256: sha256(normaliseText(payload.text)), model });

      const hit = payload.refresh === true ? null : cache.get(key);
      if (hit) {
        json(response, 200, { ok: true, data: hit, cached: true });
        return;
      }

      const analysis = await analysePolicy({ text: payload.text, url, ask: modelCall() });
      cache.set(key, analysis);
      json(response, 200, { ok: true, data: analysis, cached: false });
    } catch (cause) {
      if (cause instanceof PolicyError) {
        fail(response, 400, cause.code, cause.message);
        return;
      }
      if (cause instanceof ModelError) {
        /* A refusal or a bad key is not the caller's fault to fix by retrying. */
        const status = cause.code === 'NO_API_KEY' ? 503 : 502;
        fail(response, status, cause.code, cause.message);
        return;
      }
      fail(response, 500, 'UNEXPECTED', cause?.message ?? 'unexpected failure');
    }
  });
}

/**
 * Stripe calls this, nobody else does.
 *
 * Two rules that are not obvious and are both about retries. A webhook is
 * delivered more than once by design, so issuing is idempotent on the session
 * id. And an event this service does not handle is answered 200, because Stripe
 * retries an endpoint that errors and eventually disables it — taking the
 * events that do matter with it.
 */
async function handleWebhook(request, response, { licences, billing }) {
  if (!licences || !billing) {
    fail(response, 503, 'BILLING_NOT_CONFIGURED', 'This deployment does not sell licences');
    return;
  }

  const raw = await readRawBody(request);
  let event;
  try {
    event = billing.constructEvent(raw, request.headers['stripe-signature']);
  } catch (cause) {
    /* 400, not 500: the request was rejected, and Stripe should not retry it. */
    fail(response, 400, cause?.code ?? 'BAD_SIGNATURE', cause?.message ?? 'signature rejected');
    return;
  }

  const decision = decideFromEvent(event);

  if (decision.action === 'issue') {
    const { record, reissued } = issueLicence(licences, decision);
    json(response, 200, {
      ok: true,
      data: { action: 'issue', plan: record.plan, reissued },
    });
    return;
  }

  if (decision.action === 'revoke') {
    const record =
      licences.findBy('subscriptionId', decision.subscriptionId) ??
      licences.findBy('customerId', decision.customerId);
    if (record) revokeLicence(licences, record, { reason: decision.reason });
    json(response, 200, { ok: true, data: { action: 'revoke', found: Boolean(record) } });
    return;
  }

  json(response, 200, { ok: true, data: { action: 'ignore', reason: decision.reason } });
}

async function handleCheckout(request, response, { billing, checkoutUrls }) {
  if (!billing) {
    fail(response, 503, 'BILLING_NOT_CONFIGURED', 'This deployment does not sell licences');
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(request));
  } catch {
    fail(response, 400, 'BAD_JSON', 'The body is not JSON');
    return;
  }

  try {
    const session = await billing.createCheckout({
      plan: payload?.plan ?? 'pro',
      email: typeof payload?.email === 'string' ? payload.email : null,
      successUrl: checkoutUrls.successUrl,
      cancelUrl: checkoutUrls.cancelUrl,
    });
    json(response, 200, { ok: true, data: session });
  } catch (cause) {
    if (cause instanceof BillingError) {
      fail(response, cause.code === 'UNKNOWN_PLAN' ? 400 : 503, cause.code, cause.message);
      return;
    }
    fail(response, 502, 'CHECKOUT_FAILED', cause?.message ?? 'Stripe refused the session');
  }
}

/**
 * The question the extension asks at most once a week.
 *
 * It answers with everything the client needs to keep working without asking
 * again: the plan, what it allows, when the answer goes stale and when the
 * licence itself ends. An invalid key is a 200 with `valid: false` — the
 * request succeeded, and a client that cannot distinguish "your key is wrong"
 * from "the service is down" will do the wrong thing about it.
 */
async function handleVerify(request, response, { licences }) {
  if (!licences) {
    fail(response, 503, 'BILLING_NOT_CONFIGURED', 'This deployment does not issue licences');
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(request));
  } catch {
    fail(response, 400, 'BAD_JSON', 'The body is not JSON');
    return;
  }

  const result = verifyLicence(licences, payload?.key);
  json(response, 200, { ok: true, data: { ...result, plans: PLANS } });
}

/* Started directly: `node server/index.mjs`. Imported by the tests otherwise. */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8787);
  createAnalysisServer().listen(port, () => {
    process.stdout.write(`consent-audit analysis service on :${port}\n`);
  });
}
