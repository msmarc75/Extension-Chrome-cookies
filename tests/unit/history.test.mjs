/*
 * The local history: what is kept, what is dropped, and what never leaves.
 *
 * `chrome.storage.local` holds a few megabytes and a news homepage's capture is
 * not small, so the shelf has to be finite and the record has to be trimmed —
 * without ever showing a shortened list as though it were complete.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

/* A storage double, installed before the module reads `chrome`. */
const store = new Map();
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        const wanted = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const key of wanted) if (store.has(key)) out[key] = store.get(key);
        return out;
      },
      set: async (entries) => {
        for (const [key, value] of Object.entries(entries)) store.set(key, value);
      },
      remove: async (keys) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
      },
    },
  },
};

const {
  HISTORY_LIMIT,
  auditId,
  clearHistory,
  deleteAudit,
  getAudit,
  listAudits,
  saveAudit,
  trimForHistory,
} = await import('../../extension/src/background/history.js');

const result = (overrides = {}) => ({
  target: 'https://site.fr/',
  finalUrl: 'https://site.fr/',
  captureA: {
    profile: 'incognito-fresh',
    window: { startedAt: 1, durationMs: 5000, navigationCommittedAt: 8 },
    interaction: 'none',
    requests: [
      { url: 'https://site.fr/', host: 'site.fr', party: 'first', tMs: 0 },
      { url: 'https://ads.example/px', host: 'ads.example', party: 'third', tMs: 900 },
    ],
    cookies: [{ name: '_ga', host: '.site.fr', party: 'first', tMs: 300 }],
    storage: [],
    fingerprinting: [],
    notes: [],
  },
  cmp: { id: null },
  banner: { found: true },
  report: { score: 62, band: { key: 'departures' }, provisional: false, blockingFailures: [] },
  policy: { url: 'https://site.fr/privacy', text: 'a very long policy…', analysis: { mentions: [] } },
  ...overrides,
});

beforeEach(() => store.clear());

describe('trimming an audit for the shelf', () => {
  it('keeps the third-party calls and counts the rest', () => {
    const record = trimForHistory(result(), { id: 'x', at: 5 });

    assert.equal(record.capture.requests.length, 1);
    assert.equal(record.capture.requestsTotal, 2);
    assert.equal(record.capture.requestsThirdParty, 1);
    assert.equal(record.capture.requestsDropped, 0);
  });

  it('says how many it did not keep, rather than showing a short list as complete', () => {
    const many = result();
    many.captureA.requests = Array.from({ length: 500 }, (_, index) => ({
      url: `https://ads${index}.example/`,
      host: `ads${index}.example`,
      party: 'third',
      tMs: index,
    }));

    const record = trimForHistory(many, { id: 'x', at: 5 });
    assert.equal(record.capture.requestsThirdParty, 500);
    assert.ok(record.capture.requests.length < 500);
    assert.equal(
      record.capture.requestsDropped,
      500 - record.capture.requests.length,
    );
  });

  it('does not keep the site’s policy text, only what was quoted from it', () => {
    const record = trimForHistory(result(), { id: 'x', at: 5 });

    assert.equal(record.policy.text, undefined);
    assert.ok(record.policy.analysis);
  });
});

describe('the shelf', () => {
  it('returns what was stored, newest first', async () => {
    await saveAudit(result(), { id: 'a', at: 100 });
    await saveAudit(result(), { id: 'b', at: 200 });

    const index = await listAudits();
    assert.deepEqual(index.map((entry) => entry.id), ['b', 'a']);
    assert.equal(index[0].score, 62);
    assert.equal((await getAudit('a')).id, 'a');
  });

  it('drops the oldest once it is full, and removes what it dropped', async () => {
    for (let index = 0; index < HISTORY_LIMIT + 3; index += 1) {
      await saveAudit(result(), { id: `id-${index}`, at: 1000 + index });
    }

    const index = await listAudits();
    assert.equal(index.length, HISTORY_LIMIT);
    assert.equal(await getAudit('id-0'), null, 'the dropped entry is still taking up room');
    assert.ok(await getAudit(`id-${HISTORY_LIMIT + 2}`));
  });

  it('forgets one audit, and all of them', async () => {
    await saveAudit(result(), { id: 'a', at: 1 });
    await saveAudit(result(), { id: 'b', at: 2 });

    assert.equal(await deleteAudit('a'), true);
    assert.equal(await deleteAudit('a'), false);
    assert.equal(await getAudit('a'), null);

    assert.equal(await clearHistory(), 1);
    assert.deepEqual(await listAudits(), []);
    assert.equal(await getAudit('b'), null);
  });

  it('answers an id it never saw with null rather than throwing', async () => {
    assert.equal(await getAudit('nothing'), null);
    assert.equal(await getAudit(''), null);
    assert.equal(await getAudit(undefined), null);
  });
});

describe('the audit id', () => {
  it('sorts by time and does not collide', () => {
    const first = auditId(Date.parse('2026-08-22T09:00:00Z'));
    const second = auditId(Date.parse('2026-08-22T10:00:00Z'));

    assert.ok(first < second);
    assert.notEqual(auditId(1), auditId(1));
    assert.match(first, /^\d{14}-[a-z0-9]+$/);
  });
});
