/*
 * The endpoint, over a real socket, with the model call stubbed.
 *
 * What is being tested is the contract the extension depends on: the shape of a
 * success, the shape of a failure, that a second identical request costs
 * nothing, and that a process holding an API key does not answer to anyone who
 * finds its port.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { AnalysisCache } from '../../server/cache.mjs';
import { ModelError } from '../../server/claude.mjs';
import { createAnalysisServer } from '../../server/index.mjs';

const POLICY = `Privacy policy of Fixture SAS.

Fixture SAS, 12 rue de la Paix, Paris, is the controller for the data processed through this website, and can be reached at contact@fixture.example for any question about it.

We process browsing data in order to measure our audience and to deliver advertising, and we keep it for thirteen months. You may withdraw your consent at any time through the link in the footer, and you may lodge a complaint with the CNIL.`;

const answer = (calls) => async () => {
  calls.count += 1;
  return {
    model: 'claude-opus-5',
    mentions: [
      {
        subject: 'identity_controller',
        status: 'present',
        quote: 'Fixture SAS, 12 rue de la Paix, Paris, is the controller for the data processed through this website',
        note: null,
      },
      {
        subject: 'retention',
        status: 'present',
        quote: 'we keep it for thirteen months',
        note: null,
      },
    ],
  };
};

const directories = [];

function start(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'consent-audit-cache-'));
  directories.push(directory);
  const server = createAnalysisServer({ cache: new AnalysisCache(directory), ...options });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

const post = (origin, body, headers = {}) =>
  fetch(`${origin}/analyze-policy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

describe('POST /analyze-policy', () => {
  it('analyses a policy and returns the document', async () => {
    const calls = { count: 0 };
    const server = await start({ ask: answer(calls) });
    try {
      const response = await post(server.origin, { text: POLICY, url: 'https://fixture.example/privacy' });
      const payload = await response.json();

      assert.equal(response.status, 200);
      assert.equal(payload.ok, true);
      assert.equal(payload.cached, false);
      assert.equal(payload.data.promptVersion, 'policy-v1');
      assert.equal(payload.data.source.url, 'https://fixture.example/privacy');
      assert.equal(payload.data.mentions.length, 15);
      assert.equal(
        payload.data.mentions.find((m) => m.subject === 'retention').status,
        'present',
      );
    } finally {
      await server.close();
    }
  });

  it('answers the second identical request from the cache, without asking the model', async () => {
    const calls = { count: 0 };
    const server = await start({ ask: answer(calls) });
    try {
      await post(server.origin, { text: POLICY });
      const again = await (await post(server.origin, { text: POLICY })).json();

      assert.equal(calls.count, 1);
      assert.equal(again.cached, true);

      /* Whitespace is not a different policy. */
      const spaced = await (await post(server.origin, { text: `  ${POLICY}\n\n ` })).json();
      assert.equal(calls.count, 1);
      assert.equal(spaced.cached, true);
    } finally {
      await server.close();
    }
  });

  it('asks again when the caller says the answer is stale', async () => {
    const calls = { count: 0 };
    const server = await start({ ask: answer(calls) });
    try {
      await post(server.origin, { text: POLICY });
      await post(server.origin, { text: POLICY, refresh: true });
      assert.equal(calls.count, 2);
    } finally {
      await server.close();
    }
  });

  it('refuses a body that is not JSON, and one with no text', async () => {
    const server = await start({ ask: answer({ count: 0 }) });
    try {
      const bad = await post(server.origin, 'not json at all');
      assert.equal(bad.status, 400);
      assert.equal((await bad.json()).error.code, 'BAD_JSON');

      const empty = await post(server.origin, { url: 'https://fixture.example' });
      assert.equal(empty.status, 400);
      assert.equal((await empty.json()).error.code, 'NO_TEXT');
    } finally {
      await server.close();
    }
  });

  it('reports a policy too short to analyse as the caller’s problem, not a failure', async () => {
    const server = await start({ ask: answer({ count: 0 }) });
    try {
      const response = await post(server.origin, { text: 'We use cookies.' });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, 'POLICY_TOO_SHORT');
    } finally {
      await server.close();
    }
  });

  it('reports a model failure as a gateway failure, with its code', async () => {
    const server = await start({
      ask: async () => {
        throw new ModelError('MODEL_REFUSED', 'The model declined to analyse this document');
      },
    });
    try {
      const response = await post(server.origin, { text: POLICY });
      assert.equal(response.status, 502);
      assert.equal((await response.json()).error.code, 'MODEL_REFUSED');
    } finally {
      await server.close();
    }
  });

  it('does not answer to a caller without the token, when one is configured', async () => {
    const calls = { count: 0 };
    const server = await start({ ask: answer(calls), token: 'a-shared-secret' });
    try {
      const refused = await post(server.origin, { text: POLICY });
      assert.equal(refused.status, 401);
      assert.equal(calls.count, 0);

      const wrong = await post(server.origin, { text: POLICY }, { authorization: 'Bearer nope' });
      assert.equal(wrong.status, 401);

      const allowed = await post(
        server.origin,
        { text: POLICY },
        { authorization: 'Bearer a-shared-secret' },
      );
      assert.equal(allowed.status, 200);
      assert.equal(calls.count, 1);
    } finally {
      await server.close();
    }
  });

  it('answers a health check without needing a key', async () => {
    const server = await start({ ask: answer({ count: 0 }) });
    try {
      const payload = await (await fetch(`${server.origin}/health`)).json();
      assert.equal(payload.ok, true);
      assert.equal(payload.data.promptVersion, 'policy-v1');
      assert.equal(typeof payload.data.cache.entries, 'number');
    } finally {
      await server.close();
    }
  });

  it('has nothing at any other path', async () => {
    const server = await start({ ask: answer({ count: 0 }) });
    try {
      const missing = await fetch(`${server.origin}/analyse-policy`);
      assert.equal(missing.status, 404);

      const wrongMethod = await fetch(`${server.origin}/analyze-policy`);
      assert.equal(wrongMethod.status, 405);
    } finally {
      await server.close();
    }
  });
});

describe('the cache', () => {
  it('refuses a key it did not build', () => {
    const directory = mkdtempSync(join(tmpdir(), 'consent-audit-cache-'));
    directories.push(directory);
    const cache = new AnalysisCache(directory);

    assert.throws(() => cache.set('../../etc/passwd', {}), /Refusing to use/);
    assert.throws(() => cache.get('nope'), /Refusing to use/);
  });
});
