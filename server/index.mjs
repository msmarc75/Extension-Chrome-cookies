/*
 * The analysis service.
 *
 * One endpoint that matters, written against `node:http` with no framework: it
 * routes two paths and parses one JSON body, which is not a problem worth a
 * dependency — and this process holds an API key, so its dependency list is
 * something to be able to read in an afternoon.
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

function readBody(request) {
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
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

/**
 * A shared secret, when one is configured.
 *
 * This is an operational guard on a process that spends money per request, not
 * the licence system — that arrives in phase 7 and will decide *who* may ask.
 * Compared in constant time because a token comparison that leaks its position
 * is a token comparison worth nothing.
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
 */
export function createAnalysisServer({
  ask = null,
  cache = new AnalysisCache(
    process.env.CONSENT_AUDIT_CACHE_DIR ?? fileURLToPath(new URL('.cache/', import.meta.url)),
  ),
  model = process.env.CONSENT_AUDIT_MODEL ?? DEFAULT_MODEL,
  token = process.env.CONSENT_AUDIT_SERVER_TOKEN ?? null,
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

/* Started directly: `node server/index.mjs`. Imported by the tests otherwise. */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8787);
  createAnalysisServer().listen(port, () => {
    process.stdout.write(`consent-audit analysis service on :${port}\n`);
  });
}
