import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ADAPTERS, identifyCmp, matchAdapter } from '../../extension/src/content/cmp-adapters/index.js';

const CORPUS = fileURLToPath(new URL('../fixtures/banners/', import.meta.url));

/** The recorded corpus. Committed, so these tests are deterministic. */
function corpus() {
  if (!existsSync(CORPUS)) return [];
  return readdirSync(CORPUS)
    .filter((slug) => existsSync(join(CORPUS, slug, 'profile.json')))
    .sort()
    .map((slug) => ({
      slug,
      profile: JSON.parse(readFileSync(join(CORPUS, slug, 'profile.json'), 'utf8')),
    }));
}

const blank = (overrides = {}) => ({
  url: 'https://example.fr/',
  title: '',
  lang: null,
  viewport: { width: 1280, height: 800 },
  globals: [],
  tcf: null,
  containers: [],
  frames: [],
  unreadable: false,
  ...overrides,
});

describe('adapter registry', () => {
  it('gives every adapter an id, a name and detection signals', () => {
    for (const adapter of ADAPTERS) {
      assert.equal(typeof adapter.id, 'string', 'id');
      assert.equal(typeof adapter.name, 'string', `${adapter.id} name`);
      const signals =
        (adapter.globals?.length ?? 0) +
        (adapter.tcfCmpIds?.length ?? 0) +
        (adapter.markers?.length ?? 0) +
        (adapter.frameHosts?.length ?? 0);
      assert.ok(signals > 0, `${adapter.id} can never match anything`);
    }
  });

  it('does not register the same id twice', () => {
    const ids = ADAPTERS.map((adapter) => adapter.id);

    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('matchAdapter', () => {
  const didomi = ADAPTERS.find((adapter) => adapter.id === 'didomi');

  it('is certain from a global, and says which one', () => {
    const match = matchAdapter(didomi, blank({ globals: ['Didomi'] }));

    assert.equal(match.confidence, 'certain');
    assert.deepEqual(match.evidence, ['window.Didomi']);
  });

  it('is certain from a registered TCF id', () => {
    const match = matchAdapter(didomi, blank({ tcf: { cmpId: 7 } }));

    assert.equal(match.confidence, 'certain');
    assert.deepEqual(match.evidence, ['TCF cmpId 7']);
  });

  it('is only likely from markup, which anyone can copy', () => {
    const match = matchAdapter(
      didomi,
      blank({
        containers: [{ id: 'didomi-popup', classes: [], path: 'div#didomi-popup', controls: [] }],
      }),
    );

    assert.equal(match.confidence, 'likely');
  });

  it('reports nothing at all rather than a weak guess', () => {
    assert.equal(matchAdapter(didomi, blank()).confidence, null);
  });
});

describe('identifyCmp', () => {
  it('prefers the named vendor over the framework it speaks through', () => {
    // Didomi implements TCF. Reporting "TCF" for a page running Didomi would
    // name the transport instead of the platform.
    const result = identifyCmp(blank({ globals: ['__tcfapi', 'Didomi'], tcf: { cmpId: 7 } }));

    assert.equal(result.id, 'didomi');
    assert.equal(result.confidence, 'certain');
    assert.ok(result.alternatives.some((alternative) => alternative.id === 'tcf'));
  });

  it('names an unrecognised TCF vendor by its number rather than guessing', () => {
    const result = identifyCmp(blank({ globals: ['__tcfapi'], tcf: { cmpId: 314 } }));

    assert.equal(result.id, 'tcf');
    assert.equal(result.name, 'TCF CMP #314');
  });

  it('admits when the framework is there but the vendor is not identifiable', () => {
    const result = identifyCmp(blank({ globals: ['__tcfapi'], tcf: { unresponsive: true } }));

    assert.equal(result.name, 'TCF (vendor unidentified)');
  });

  it('says no platform rather than inventing one', () => {
    const result = identifyCmp(blank());

    assert.equal(result.id, null);
    assert.equal(result.confidence, 'none');
    assert.deepEqual(result.evidence, []);
  });
});

describe('the recorded corpus', () => {
  const fixtures = corpus();

  it('is present', () => {
    // Committed on purpose: the detector was written against these pages, and
    // a change that breaks one of them should break a test, not a client report.
    assert.ok(fixtures.length >= 30, `expected at least 30 fixtures, found ${fixtures.length}`);
  });

  it('names Didomi wherever the page carries its global', () => {
    const didomiSites = fixtures.filter(({ profile }) => profile.globals.includes('Didomi'));

    assert.ok(didomiSites.length >= 8, 'corpus should hold several Didomi sites');
    for (const { slug, profile } of didomiSites) {
      assert.equal(identifyCmp(profile).id, 'didomi', slug);
    }
  });

  it('agrees with itself on what a TCF id means', () => {
    // Each registered id should map to one vendor across the whole corpus. A
    // disagreement means an id was attributed from a guess rather than from
    // what was observed next to it.
    const byCmpId = new Map();
    for (const { slug, profile } of fixtures) {
      const cmpId = profile.tcf?.cmpId;
      if (typeof cmpId !== 'number') continue;
      const identified = identifyCmp(profile);
      if (!byCmpId.has(cmpId)) byCmpId.set(cmpId, new Map());
      byCmpId.get(cmpId).set(slug, identified.id);
    }

    for (const [cmpId, bySlug] of byCmpId) {
      const distinct = new Set(bySlug.values());
      assert.equal(
        distinct.size,
        1,
        `TCF id ${cmpId} was attributed to ${[...distinct].join(' and ')}`,
      );
    }
  });

  it('leaves a page with no consent signal unnamed', () => {
    const silent = fixtures.filter(
      ({ profile }) => profile.globals.length === 0 && profile.tcf === null,
    );

    for (const { slug, profile } of silent) {
      const identified = identifyCmp(profile);
      assert.notEqual(identified.confidence, 'certain', `${slug} was named from nothing`);
    }
  });
});
