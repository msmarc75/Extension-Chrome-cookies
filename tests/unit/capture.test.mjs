import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { CaptureBuilder, parseSetCookie } from '../../extension/src/background/capture.js';
import { assertValid, validate } from '../../shared/schema/validate.mjs';

const schema = JSON.parse(
  readFileSync(new URL('../../shared/schema/capture.schema.json', import.meta.url), 'utf8'),
);
const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/cdp/pre-consent-session.json', import.meta.url), 'utf8'),
);

function buildFromFixture(overrides = {}) {
  const builder = new CaptureBuilder({
    phase: 'A',
    requestedUrl: fixture.requestedUrl,
    profile: 'incognito-fresh',
    startedAt: fixture.startedAt,
    ...overrides,
  });
  for (const event of fixture.events) {
    builder.onEvent(event.method, event.params, event.receivedAt);
  }
  return builder;
}

const capture = buildFromFixture().finish({
  durationMs: 5000,
  jarCookies: fixture.jarCookies,
  usageBreakdown: fixture.usageBreakdown,
  pageMarks: fixture.pageMarks,
});

const requestFor = (url) => capture.requests.find((r) => r.url === url);
const cookieFor = (name) => capture.cookies.find((c) => c.name === name);

describe('capture A', () => {
  it('matches the shared schema', () => {
    assertValid(capture, schema, 'capture');
  });

  it('is declared as the untouched observation it is', () => {
    assert.equal(capture.phase, 'A');
    assert.equal(capture.interaction, 'none');
    assert.equal(capture.profile, 'incognito-fresh');
  });

  it('records where the navigation actually landed', () => {
    assert.equal(capture.target.requestedUrl, 'https://shop.example.fr/');
    assert.equal(capture.target.finalUrl, 'https://shop.example.fr/');
    assert.equal(capture.target.origin, 'https://shop.example.fr');
    // Page.frameNavigated carries no clock of its own, so the commit is timed
    // by arrival. Every other mark on the timeline comes from the CDP clock.
    assert.equal(capture.window.navigationCommittedAt, 350);
  });
});

describe('requests', () => {
  it('times every request against the moment the window opened', () => {
    // The CDP clock is monotonic and arbitrary; wallTime on the first request
    // is what anchors it. A drift here would move every mark on the timeline.
    assert.equal(requestFor('https://shop.example.fr/').tMs, 100);
    assert.equal(requestFor('https://www.google-analytics.com/analytics.js').tMs, 450);
    assert.equal(requestFor('https://ads.doubleclick.net/pixel?id=42').tMs, 1000);
  });

  it('is ordered by time, so the list reads as the timeline', () => {
    const times = capture.requests.map((r) => r.tMs);
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  });

  it('separates the site from everyone else', () => {
    assert.equal(requestFor('https://shop.example.fr/').party, 'first');
    // A subdomain of the audited site is still the site.
    assert.equal(requestFor('https://cdn.shop.example.fr/logo.svg').party, 'first');
    assert.equal(requestFor('https://www.google-analytics.com/analytics.js').party, 'third');
    assert.equal(requestFor('https://ads.doubleclick.net/pixel?id=42').party, 'third');
  });

  it('keeps who asked for what — the chain is the evidence', () => {
    const pixel = requestFor('https://ads.doubleclick.net/pixel?id=42');
    assert.equal(pixel.initiator.type, 'script');
    assert.equal(pixel.initiator.host, 'www.google-analytics.com');
  });

  it('carries response status and cache provenance', () => {
    assert.equal(requestFor('https://shop.example.fr/').status, 200);
    assert.equal(requestFor('https://cdn.shop.example.fr/logo.svg').fromCache, true);
  });

  it('keeps a request that failed to load — it was still sent', () => {
    const failed = requestFor('https://ads.doubleclick.net/collect');
    assert.ok(failed);
    assert.equal(failed.status, null);
  });
});

describe('cookies', () => {
  it('dates the ones it watched being set', () => {
    assert.equal(cookieFor('PHPSESSID').tMs, 100);
    assert.equal(cookieFor('IDE').tMs, 1000);
  });

  it('dates a script-set cookie from the moment the assignment was watched', () => {
    // Nothing in the CDP stream carries this. It only has a time because the
    // in-page instrument saw `document.cookie` being assigned.
    const scripted = cookieFor('_hjSession');
    assert.equal(scripted.source, 'jar');
    assert.equal(scripted.tMs, 1600);
  });

  it('leaves a cookie nothing observed undated rather than inventing a time', () => {
    const silent = cookieFor('_ga');
    assert.equal(silent.source, 'jar');
    assert.equal(silent.tMs, null);
  });

  it('prefers the jar for what persisted and the header stream for when', () => {
    const session = cookieFor('PHPSESSID');
    assert.equal(session.source, 'jar');
    assert.equal(session.tMs, 100);
    assert.equal(session.httpOnly, true);
    assert.equal(session.session, true);
  });

  it('attributes a cookie to the domain in its Domain attribute', () => {
    const ide = cookieFor('IDE');
    assert.equal(ide.host, 'doubleclick.net');
    assert.equal(ide.party, 'third');
    assert.equal(ide.secure, true);
    assert.equal(ide.sameSite, 'None');
  });

  it('never records a cookie value, only its length', () => {
    for (const cookie of capture.cookies) {
      assert.ok(!('value' in cookie), `${cookie.name} carries its value`);
      assert.equal(typeof cookie.size, 'number');
    }
  });

  it('splits a multi-cookie Set-Cookie header', () => {
    assert.ok(cookieFor('_shop_ab'));
    assert.equal(cookieFor('_shop_ab').session, false);
  });
});

describe('storage', () => {
  const entryFor = (type) => capture.storage.find((s) => s.type === type);
  const keyed = (key) => capture.storage.find((s) => s.key === key);

  it('dates a localStorage write it watched', () => {
    const local = keyed('consent_seen');
    assert.equal(local.type, 'localStorage');
    assert.equal(local.source, 'event');
    assert.equal(local.tMs, 1450);
    assert.equal(local.origin, 'https://shop.example.fr');
  });

  it('picks up a key that never went through setItem, undated', () => {
    // `localStorage.theme = 'dark'` sets a named property and leaves no mark.
    // The end-of-window inventory is what stops it disappearing.
    const inventoried = keyed('theme');
    assert.equal(inventoried.source, 'snapshot');
    assert.equal(inventoried.tMs, null);
    assert.equal(inventoried.bytes, 4);
  });

  it('reports a store it can only see through the quota reading', () => {
    const idb = entryFor('indexedDB');
    assert.equal(idb.source, 'snapshot');
    assert.equal(idb.key, null);
    assert.equal(idb.tMs, null);
    assert.equal(idb.bytes, 4096);
  });

  it('does not restate a key it already watched, or an empty store', () => {
    assert.equal(capture.storage.filter((s) => s.key === 'consent_seen').length, 1);
    assert.equal(entryFor('cacheStorage'), undefined);
  });

  it('leaves cookie usage to the cookie list', () => {
    assert.equal(
      capture.storage.some((s) => s.type === 'other'),
      false,
    );
  });

  it('puts the dated writes before the undated ones', () => {
    const times = capture.storage.map((s) => s.tMs);
    assert.deepEqual(times, [...times].sort((a, b) => (a ?? Infinity) - (b ?? Infinity)));
  });
});

describe('degraded inputs', () => {
  it('produces a schema-valid capture from an empty session', () => {
    const empty = new CaptureBuilder({
      phase: 'A',
      requestedUrl: 'https://nowhere.example/',
      profile: 'current',
      startedAt: 1700000000000,
    }).finish({ durationMs: 5000 });

    assert.equal(validate(empty, schema).valid, true);
    assert.deepEqual(empty.requests, []);
    assert.equal(empty.window.navigationCommittedAt, null);
  });

  it('records a note instead of dropping an unparseable Set-Cookie', () => {
    const builder = new CaptureBuilder({
      phase: 'A',
      requestedUrl: 'https://shop.example.fr/',
      profile: 'current',
      startedAt: 1700000000000,
    });
    builder.onEvent('Network.responseReceivedExtraInfo', {
      requestId: 'unknown',
      headers: { 'set-cookie': 'this-is-not-a-cookie' },
    });
    const result = builder.finish({ durationMs: 100 });

    assert.equal(result.cookies.length, 0);
    assert.equal(result.notes[0].code, 'SET_COOKIE_UNPARSED');
    assert.equal(validate(result, schema).valid, true);
  });

  it('keeps each hop of a redirect chain as its own mark', () => {
    const builder = new CaptureBuilder({
      phase: 'A',
      requestedUrl: 'https://shop.example.fr/',
      profile: 'current',
      startedAt: 1700000000000,
    });
    const base = { requestId: 'r', type: 'Document', initiator: { type: 'other' } };
    builder.onEvent('Network.requestWillBeSent', {
      ...base,
      timestamp: 10,
      wallTime: 1700000000.01,
      request: { url: 'http://shop.example.fr/', method: 'GET' },
    });
    builder.onEvent('Network.requestWillBeSent', {
      ...base,
      timestamp: 10.05,
      request: { url: 'https://shop.example.fr/', method: 'GET' },
      redirectResponse: { status: 301 },
    });
    const result = builder.finish({ durationMs: 100 });

    assert.equal(result.requests.length, 2);
    assert.deepEqual(
      result.requests.map((r) => r.url),
      ['http://shop.example.fr/', 'https://shop.example.fr/'],
    );
  });
});

describe('parseSetCookie', () => {
  const parse = (header) =>
    parseSetCookie(header, { requestHost: 'example.fr', now: 1700000000000 });

  it('defaults to a host-only session cookie at the root path', () => {
    const cookie = parse('a=1');

    assert.equal(cookie.host, 'example.fr');
    assert.equal(cookie.path, '/');
    assert.equal(cookie.session, true);
    assert.equal(cookie.expiresAt, null);
  });

  it('reads Max-Age as an offset from the moment of the header', () => {
    assert.equal(parse('a=1; Max-Age=60').expiresAt, 1700000000000 + 60_000);
  });

  it('reads Expires as an absolute instant', () => {
    assert.equal(
      parse('a=1; Expires=Wed, 01 Jan 2025 00:00:00 GMT').expiresAt,
      Date.parse('2025-01-01T00:00:00Z'),
    );
  });

  it('drops the leading dot Domain attributes still carry', () => {
    assert.equal(parse('a=1; Domain=.example.fr').host, 'example.fr');
  });

  it('measures the value without keeping it', () => {
    const cookie = parse('a=abcdef');

    assert.equal(cookie.size, 6);
    assert.equal(cookie.value, undefined);
  });

  it('accepts a value containing an equals sign', () => {
    assert.equal(parse('a=b=c=d').size, 5);
  });

  it('returns null on a header with no name', () => {
    assert.equal(parse('=orphan'), null);
    assert.equal(parse('novalue'), null);
  });
});
