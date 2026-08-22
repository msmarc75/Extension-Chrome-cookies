import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import vm from 'node:vm';

import {
  COLLECT_EXPRESSION,
  INSTRUMENT_SOURCE,
  parsePageMarks,
} from '../../extension/src/background/page-instrument.js';

/**
 * A page-shaped sandbox: enough of `Storage` and `Document.prototype.cookie`
 * for the instrument to hook, and nothing more. Running the real source in it
 * catches the failure that matters most — an instrument that throws into the
 * page, or one that stops a write from happening.
 */
function fakePage() {
  const written = { local: new Map(), session: new Map(), cookies: [] };

  class Storage {
    constructor(store) {
      this.store = store;
    }
    setItem(key, value) {
      this.store.set(String(key), String(value));
    }
    getItem(key) {
      return this.store.has(String(key)) ? this.store.get(String(key)) : null;
    }
    key(index) {
      return [...this.store.keys()][index] ?? null;
    }
    get length() {
      return this.store.size;
    }
  }

  class Document {}
  Object.defineProperty(Document.prototype, 'cookie', {
    configurable: true,
    get() {
      return written.cookies.join('; ');
    },
    set(value) {
      written.cookies.push(String(value));
    },
  });

  const context = vm.createContext({
    localStorage: new Storage(written.local),
    sessionStorage: new Storage(written.session),
    Document,
    document: new Document(),
    performance: { timeOrigin: 1_700_000_000_000, now: () => 250 },
    TextEncoder,
  });
  context.globalThis = context;

  return { context, written };
}

describe('the injected instrument', () => {
  it('records a storage write and still performs it', () => {
    const { context, written } = fakePage();
    vm.runInContext(INSTRUMENT_SOURCE, context);

    vm.runInContext("localStorage.setItem('visitor', 'abc')", context);

    assert.equal(written.local.get('visitor'), 'abc');
    const [mark] = context.__consentAudit.marks;
    assert.equal(mark.kind, 'storage');
    assert.equal(mark.area, 'localStorage');
    assert.equal(mark.key, 'visitor');
    assert.equal(mark.size, 3);
    assert.equal(mark.at, 1_700_000_000_250);
  });

  it('tells the two storage areas apart', () => {
    const { context } = fakePage();
    vm.runInContext(INSTRUMENT_SOURCE, context);

    vm.runInContext("sessionStorage.setItem('a', '1'); localStorage.setItem('b', '2')", context);

    // Joined rather than compared as arrays: these come from another realm,
    // so they are structurally equal but not the same Array.
    assert.equal(
      context.__consentAudit.marks.map((m) => m.area).join(','),
      'sessionStorage,localStorage',
    );
  });

  it('records a cookie assignment and still performs it', () => {
    const { context, written } = fakePage();
    vm.runInContext(INSTRUMENT_SOURCE, context);

    vm.runInContext("document.cookie = '_ga=GA1.2; path=/'", context);

    assert.deepEqual(written.cookies, ['_ga=GA1.2; path=/']);
    const [mark] = context.__consentAudit.marks;
    assert.equal(mark.kind, 'cookie');
    assert.equal(mark.header, '_ga=GA1.2; path=/');
  });

  it('leaves reading cookies untouched', () => {
    const { context } = fakePage();
    vm.runInContext(INSTRUMENT_SOURCE, context);

    vm.runInContext("document.cookie = 'a=1'", context);

    assert.equal(vm.runInContext('document.cookie', context), 'a=1');
  });

  it('installs once, so a re-injection does not double-count', () => {
    const { context } = fakePage();
    vm.runInContext(INSTRUMENT_SOURCE, context);
    vm.runInContext(INSTRUMENT_SOURCE, context);

    vm.runInContext("localStorage.setItem('x', '1')", context);

    assert.equal(context.__consentAudit.marks.length, 1);
  });

  it('does not advertise itself on the global object', () => {
    // A page enumerating its own globals should not trip over the audit.
    const { context } = fakePage();
    vm.runInContext(INSTRUMENT_SOURCE, context);

    assert.equal(vm.runInContext("Object.keys(globalThis).includes('__consentAudit')", context), false);
  });

  it('collects the marks and an inventory of what the areas hold', () => {
    const { context } = fakePage();
    vm.runInContext(INSTRUMENT_SOURCE, context);
    vm.runInContext("localStorage.setItem('watched', 'yes')", context);
    vm.runInContext("localStorage.store.set('unwatched', 'four')", context);

    const collected = parsePageMarks(vm.runInContext(COLLECT_EXPRESSION, context));

    assert.equal(collected.installed, true);
    assert.equal(collected.marks.length, 1);
    assert.deepEqual(collected.inventory.localStorage, [
      ['watched', 3],
      ['unwatched', 4],
    ]);
  });

  it('reports honestly when it was never installed', () => {
    const { context } = fakePage();

    const collected = parsePageMarks(vm.runInContext(COLLECT_EXPRESSION, context));

    assert.equal(collected.installed, false);
    assert.deepEqual(collected.marks, []);
  });
});

describe('parsePageMarks', () => {
  it('survives anything the page could put in that global', () => {
    // The instrument's global is reachable from page script, so its contents
    // are input, not data this side may trust.
    for (const hostile of [
      undefined,
      null,
      42,
      'not json',
      '{"marks": "not an array"}',
      '{"marks": [1, null, {"kind": "storage"}, {"at": 5}]}',
      '{"inventory": {"localStorage": ["not a pair", [7, 7]]}}',
    ]) {
      const result = parsePageMarks(hostile);
      assert.ok(Array.isArray(result.marks));
      assert.ok(Array.isArray(result.inventory.localStorage));
      assert.equal(result.installed, false);
    }
  });

  it('keeps only marks that carry a kind and a time', () => {
    const raw = JSON.stringify({
      marks: [
        { kind: 'storage', at: 1 },
        { kind: 'cookie', at: 2 },
        { kind: 'storage' },
        { kind: 'nonsense', at: 3 },
      ],
      installed: true,
    });

    assert.deepEqual(parsePageMarks(raw).marks, [
      { kind: 'storage', at: 1 },
      { kind: 'cookie', at: 2 },
    ]);
  });
});
