import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatOffset, summarise } from '../../extension/src/ui/popup/summary.js';

const capture = (overrides = {}) => ({
  requests: [],
  cookies: [],
  storage: [],
  ...overrides,
});

const request = (party, tMs) => ({ party, tMs });
const cookie = (party, tMs) => ({ party, tMs });
const storage = (tMs) => ({ tMs });

describe('formatOffset', () => {
  it('keeps sub-second figures in milliseconds', () => {
    assert.equal(formatOffset(0), '0 ms');
    assert.equal(formatOffset(412.6), '413 ms');
    assert.equal(formatOffset(999), '999 ms');
  });

  it('switches to seconds with one decimal above a second', () => {
    assert.equal(formatOffset(1000), '1.0 s');
    assert.equal(formatOffset(4321), '4.3 s');
  });

  it('says undated rather than printing a fake zero', () => {
    assert.equal(formatOffset(null), 'undated');
    assert.equal(formatOffset(undefined), 'undated');
    assert.equal(formatOffset(Number.NaN), 'undated');
  });
});

describe('summarise', () => {
  it('counts third parties against the total', () => {
    const summary = summarise(
      capture({
        requests: [request('first', 10), request('third', 20), request('third', 30)],
      }),
    );

    assert.equal(summary.thirdPartyRequests, 2);
    assert.equal(summary.totalRequests, 3);
  });

  it('takes the first deposit from the earliest thing the visitor received', () => {
    const summary = summarise(
      capture({
        requests: [request('third', 900)],
        cookies: [cookie('first', 400)],
        storage: [storage(1200)],
      }),
    );

    assert.equal(summary.firstDepositMs, 400);
  });

  it('does not count the visit itself as a deposit', () => {
    // A first-party request for the page is the visit. If it counted, every
    // site on earth would show a deposit at 0 ms and the figure would mean
    // nothing.
    const summary = summarise(capture({ requests: [request('first', 5)] }));

    assert.equal(summary.firstDepositMs, null);
  });

  it('reports nothing observed rather than zero', () => {
    assert.equal(summarise(capture()).firstDepositMs, null);
  });

  it('ignores undated entries when looking for the earliest', () => {
    const summary = summarise(
      capture({ cookies: [cookie('third', null), cookie('third', 700)] }),
    );

    assert.equal(summary.firstDepositMs, 700);
    assert.equal(summary.undatedCookies, 1);
  });

  it('separates third-party cookies from the rest', () => {
    const summary = summarise(
      capture({ cookies: [cookie('first', 1), cookie('third', 2), cookie('third', 3)] }),
    );

    assert.equal(summary.cookies, 3);
    assert.equal(summary.thirdPartyCookies, 2);
  });
});
