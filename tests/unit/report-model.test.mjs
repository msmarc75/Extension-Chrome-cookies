/*
 * The arithmetic behind the report and the exported files.
 *
 * These numbers end up in a document with a consultant's name on it. The tests
 * that matter here are the ones about what the timeline refuses to do: place an
 * undated observation at zero, draw a first-party asset as a deposit, or let a
 * comma in a URL shift every column of a spreadsheet.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  axisTicks,
  buildTimeline,
  depositsCsv,
  exportFilename,
  findingsCsv,
  formatOffset,
  positionOf,
  toCsv,
} from '../../extension/src/shared/report-model.js';

const capture = (overrides = {}) => ({
  window: { startedAt: 1_700_000_000_000, durationMs: 5000, navigationCommittedAt: 8 },
  requests: [],
  cookies: [],
  storage: [],
  fingerprinting: [],
  notes: [],
  ...overrides,
});

describe('the timeline', () => {
  it('draws only what the site sent to somebody else', () => {
    const timeline = buildTimeline(
      capture({
        requests: [
          { url: 'https://site.fr/', host: 'site.fr', party: 'first', tMs: 0 },
          { url: 'https://ads.example/px', host: 'ads.example', party: 'third', tMs: 900 },
        ],
      }),
    );

    assert.equal(timeline.events.length, 1);
    assert.equal(timeline.events[0].label, 'ads.example');
  });

  it('orders every lane on one clock', () => {
    const timeline = buildTimeline(
      capture({
        requests: [{ url: 'https://ads.example/px', host: 'ads.example', party: 'third', tMs: 1200 }],
        cookies: [{ name: '_ga', host: '.site.fr', party: 'first', tMs: 300, source: 'script' }],
        storage: [{ key: 'visitor', type: 'localStorage', tMs: 800, source: 'event' }],
        fingerprinting: [{ api: 'CanvasRenderingContext2D.getImageData', tMs: 1000 }],
      }),
    );

    assert.deepEqual(
      timeline.events.map((event) => event.lane),
      ['cookie', 'storage', 'fingerprint', 'request'],
    );
    assert.equal(timeline.firstMs, 300);
    assert.equal(timeline.lastMs, 1200);
  });

  it('never places an undated observation on the axis', () => {
    /* A cookie found in the jar with no observable moment of writing is real
       and cannot be dated. Drawing it at zero would be inventing evidence. */
    const timeline = buildTimeline(
      capture({ cookies: [{ name: 'legacy', host: '.site.fr', party: 'first', tMs: null }] }),
    );

    assert.equal(timeline.events.length, 0);
    assert.equal(timeline.undated.length, 1);
    assert.equal(timeline.undated[0].label, 'legacy');
  });

  it('keeps the axis at the observation window, not at the last event', () => {
    const timeline = buildTimeline(
      capture({
        window: { durationMs: 5000 },
        requests: [{ url: 'https://ads.example/', host: 'ads.example', party: 'third', tMs: 200 }],
      }),
    );

    assert.equal(timeline.windowMs, 5000);
    assert.equal(Math.round(positionOf(200, timeline.windowMs)), 4);
  });

  it('carries the classification through, where there is one', () => {
    const timeline = buildTimeline(
      capture({
        requests: [{ url: 'https://doubleclick.net/x', host: 'doubleclick.net', party: 'third', tMs: 10 }],
      }),
      () => ({ category: 'advertising', owner: 'Google' }),
    );

    assert.equal(timeline.events[0].category, 'advertising');
    assert.equal(timeline.events[0].owner, 'Google');
  });
});

describe('the axis', () => {
  it('labels a five-second window in whole seconds', () => {
    assert.deepEqual(
      axisTicks(5000).map((tick) => tick.label),
      ['0s', '1s', '2s', '3s', '4s', '5s'],
    );
  });

  it('does not turn a long window into a ruler', () => {
    assert.ok(axisTicks(30_000).length <= 7);
  });

  it('clamps a position to the axis rather than drawing off the page', () => {
    assert.equal(positionOf(-100, 5000), 0);
    assert.equal(positionOf(9000, 5000), 100);
  });
});

describe('CSV', () => {
  it('quotes what RFC 4180 says to quote, and nothing else', () => {
    assert.equal(toCsv([['plain', 'with,comma']]), 'plain,"with,comma"');
    assert.equal(toCsv([['say "hi"']]), '"say ""hi"""');
    assert.equal(toCsv([['two\nlines']]), '"two\nlines"');
    assert.equal(toCsv([['a'], ['b']]), 'a\r\nb');
  });

  it('writes a findings register a spreadsheet opens straight', () => {
    const csv = findingsCsv(
      {
        findings: [
          {
            id: 'PRE_CONSENT_TRACKERS',
            title: 'Trackers contacted before consent',
            category: 'deposit',
            severity: 'blocking',
            weight: 12,
            verdict: 'fail',
            evidence: [{ what: 'doubleclick.net, advertising', detail: 'at 412 ms', tMs: 412 }],
            legalBasis: [{ source: 'ePrivacy', ref: 'art. 5(3)' }],
            remediation: 'Gate the tag manager, not just the tags.',
            because: null,
            temperedBecause: null,
          },
        ],
      },
      { site: 'https://site.fr/', auditedAt: '2026-08-22T10:00:00.000Z', profile: 'incognito-fresh' },
    );

    const [header, row] = csv.split('\r\n');
    assert.equal(header.split(',').length, 13);
    assert.ok(row.includes('PRE_CONSENT_TRACKERS'));
    assert.ok(row.includes('"doubleclick.net, advertising — at 412 ms"'));
  });

  it('writes the deposits in the order they happened, undated ones last', () => {
    const timeline = buildTimeline(
      capture({
        requests: [{ url: 'https://ads.example/px', host: 'ads.example', party: 'third', tMs: 1200 }],
        cookies: [
          { name: '_ga', host: '.site.fr', party: 'first', tMs: 300, source: 'script' },
          { name: 'legacy', host: '.site.fr', party: 'first', tMs: null, source: 'jar' },
        ],
      }),
    );

    const rows = depositsCsv(timeline, { site: 'https://site.fr/' }).split('\r\n');
    assert.equal(rows.length, 4);
    assert.ok(rows[1].includes('_ga'));
    assert.ok(rows[2].includes('ads.example'));
    assert.ok(rows[3].includes('undated'));
  });
});

describe('the exported filename', () => {
  it('names the site, the date and the file', () => {
    const name = exportFilename('https://www.lemonde.fr/', Date.parse('2026-08-22T09:00:00Z'), 'findings', 'csv');
    assert.equal(name, 'consent-audit_www.lemonde.fr_2026-08-22_findings.csv');
  });

  it('survives a URL that is not one', () => {
    assert.match(exportFilename(null, 0, 'deposits', 'csv'), /^consent-audit_audit_1970-01-01_deposits\.csv$/);
  });
});

describe('printing an instant', () => {
  it('is the same everywhere it is printed', () => {
    assert.equal(formatOffset(413), '413 ms');
    assert.equal(formatOffset(4321), '4.3 s');
    assert.equal(formatOffset(null), 'undated');
  });
});
