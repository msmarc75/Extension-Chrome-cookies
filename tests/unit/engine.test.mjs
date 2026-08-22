import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { locateBanner } from '../../extension/src/content/banner-detector.js';
import { identifyCmp } from '../../extension/src/content/cmp-adapters/index.js';
import { contrastRatio, parseColour, prominenceOf } from '../../extension/src/engine/colour.js';
import { exemptionFor, knownTrackerCookie } from '../../extension/src/engine/data/exemptions.js';
import { RULES, assess } from '../../extension/src/engine/index.js';
import { SEVERITY, VERDICT } from '../../extension/src/engine/rule.js';
import { BLOCKING_CEILING, bandFor, score } from '../../extension/src/engine/scoring.js';
import { classifyHost } from '../../extension/src/engine/tracker-classifier.js';

const CORPUS = fileURLToPath(new URL('../fixtures/banners/', import.meta.url));

const capture = (overrides = {}) => ({
  schemaVersion: 1,
  phase: 'A',
  target: { requestedUrl: 'https://x.fr/', finalUrl: 'https://x.fr/', origin: 'https://x.fr' },
  profile: 'incognito-fresh',
  window: { startedAt: 0, durationMs: 5000, navigationCommittedAt: 100 },
  interaction: 'none',
  requests: [],
  cookies: [],
  storage: [],
  fingerprinting: [],
  notes: [],
  ...overrides,
});

const request = (host, tMs = 500, party = 'third') => ({
  id: host + tMs,
  tMs,
  url: `https://${host}/x`,
  host,
  party,
  method: 'GET',
  resourceType: 'Script',
  initiator: { type: 'parser', host: 'x.fr' },
  status: 200,
  fromCache: false,
});

const cookie = (name, host, tMs = 500, party = 'first') => ({
  name,
  host,
  path: '/',
  party,
  secure: true,
  httpOnly: false,
  sameSite: 'Lax',
  session: false,
  expiresAt: Date.now() + 1000,
  size: 10,
  tMs,
  source: 'set-cookie',
});

const findingOf = (report, id) => report.findings.find((f) => f.id === id);

describe('the rulebook', () => {
  it('weighs each category as the plan does', () => {
    const byCategory = {};
    for (const rule of RULES) {
      byCategory[rule.category] = (byCategory[rule.category] ?? 0) + rule.weight;
    }

    assert.equal(byCategory.deposit, 35);
    assert.equal(byCategory.fairness, 30);
    assert.equal(byCategory.information, 20);
  });

  it('makes every rule cite something and every blocking rule admit how it could be wrong', () => {
    for (const rule of RULES) {
      assert.ok(rule.legalBasis.length > 0, rule.id);
      assert.ok(rule.remediation.length > 20, `${rule.id} has no usable remediation`);
      if (rule.severity === SEVERITY.BLOCKING) {
        assert.ok(rule.falsePositiveNotes, `${rule.id} is blocking and says nothing about its limits`);
      }
    }
  });

  it('never returns a failure without evidence', () => {
    // A verdict with nothing under it is not something a consultant can bill
    // for or a site owner can answer.
    const report = assess({
      captureA: capture({
        requests: [request('securepubads.g.doubleclick.net')],
        cookies: [cookie('_ga', 'x.fr')],
      }),
    });

    for (const finding of report.findings) {
      if (finding.verdict !== VERDICT.FAIL) continue;
      assert.ok(finding.evidence.length > 0, `${finding.id} failed with no evidence`);
      for (const item of finding.evidence) {
        assert.ok(item.what && !/undefined/.test(item.what), `${finding.id}: ${item.what}`);
        assert.ok(!/undefined/.test(item.detail ?? ''), `${finding.id}: ${item.detail}`);
      }
    }
  });
});

describe('deposit rules', () => {
  it('reports an advertising call before consent', () => {
    const report = assess({
      captureA: capture({ requests: [request('securepubads.g.doubleclick.net', 420)] }),
    });
    const finding = findingOf(report, 'PRE_CONSENT_TRACKERS');

    assert.equal(finding.verdict, VERDICT.FAIL);
    assert.equal(finding.measured.advertisingOrSocial, 1);
    assert.match(finding.evidence[0].what, /doubleclick\.net/);
  });

  it('asks rather than concludes when the only calls are audience measurement', () => {
    // The CNIL exempts measurement under conditions invisible from outside the
    // site. Calling that a breach would be a guess dressed as a finding.
    const report = assess({ captureA: capture({ requests: [request('xiti.com', 900)] }) });
    const finding = findingOf(report, 'PRE_CONSENT_TRACKERS');

    assert.equal(finding.verdict, VERDICT.WARN);
    assert.equal(finding.measured.advertisingOrSocial, 0);
  });

  it('does not count a publisher serving its own assets from another domain', () => {
    // bbci.co.uk is the BBC. Counting it would have been a blocking failure on
    // a third of the corpus.
    const report = assess({
      captureA: capture({ requests: [request('static.files.bbci.co.uk'), request('img.lemde.fr')] }),
    });
    const finding = findingOf(report, 'PRE_CONSENT_TRACKERS');

    assert.equal(finding.verdict, VERDICT.PASS);
    assert.equal(finding.measured.unclassified, 2);
    assert.match(finding.evidence[0].what, /not in the shipped table/);
  });

  it('does not count a consent platform as a deposit', () => {
    const report = assess({ captureA: capture({ requests: [request('sdk.privacy-center.org')] }) });

    assert.equal(findingOf(report, 'PRE_CONSENT_TRACKERS').verdict, VERDICT.PASS);
  });

  it('counts a tracker cookie wherever it sits, including the site’s own domain', () => {
    const report = assess({
      captureA: capture({ cookies: [cookie('_ga', 'x.fr'), cookie('cto_bundle', 'criteo.com', 600, 'third')] }),
    });
    const finding = findingOf(report, 'PRE_CONSENT_COOKIES');

    assert.equal(finding.verdict, VERDICT.FAIL);
    assert.equal(finding.measured.counted, 2);
  });

  it('raises a cookie it cannot identify for review instead of counting it', () => {
    // The regression that mattered: on the first run this rule gave Wikipedia —
    // the control site — a blocking failure for its own operational cookies.
    const wikipedia = capture({
      target: { requestedUrl: 'https://www.wikipedia.org/', finalUrl: 'https://www.wikipedia.org/', origin: 'https://www.wikipedia.org' },
      cookies: [
        cookie('GeoIP', 'wikipedia.org', 2),
        cookie('NetworkProbeLimit', 'www.wikipedia.org', 2),
        cookie('WMF-Last-Access', 'www.wikipedia.org', 2),
        cookie('WMF-Uniq', 'wikipedia.org', 2),
      ],
    });
    const report = assess({ captureA: wikipedia });
    const finding = findingOf(report, 'PRE_CONSENT_COOKIES');

    assert.notEqual(finding.verdict, VERDICT.FAIL);
    assert.equal(finding.measured.counted, 0);
    assert.equal(finding.measured.forReview, 4);
    assert.deepEqual(report.blockingFailures, []);
  });

  it('sets aside session, security and consent-record cookies, saying which ground', () => {
    const report = assess({
      captureA: capture({
        cookies: [
          cookie('PHPSESSID', 'x.fr'),
          cookie('bm_sz', 'x.fr'),
          cookie('cookies_policy', 'x.fr'),
          cookie('didomi_token', 'x.fr'),
        ],
      }),
    });

    assert.equal(findingOf(report, 'PRE_CONSENT_COOKIES').measured.exempted, 4);
    assert.equal(findingOf(report, 'EXEMPTION_CHECK').evidence.length, 4);
  });

  it('never counts a cookie it could not date', () => {
    const undated = { ...cookie('_ga', 'x.fr'), tMs: null, source: 'jar' };
    const report = assess({ captureA: capture({ cookies: [undated] }) });

    assert.notEqual(findingOf(report, 'PRE_CONSENT_COOKIES').verdict, VERDICT.FAIL);
  });

  it('treats one fingerprinting technique as a question and several as a pattern', () => {
    const one = assess({
      captureA: capture({ fingerprinting: [{ api: 'canvas.toDataURL', tMs: 100 }] }),
    });
    assert.equal(findingOf(one, 'PRE_CONSENT_FINGERPRINT').verdict, VERDICT.WARN);

    const several = assess({
      captureA: capture({
        fingerprinting: [
          { api: 'canvas.toDataURL', tMs: 100 },
          { api: 'webgl.unmaskedRenderer', tMs: 120 },
        ],
      }),
    });
    assert.equal(findingOf(several, 'PRE_CONSENT_FINGERPRINT').verdict, VERDICT.FAIL);
  });

  it('tempers a deposit failure measured in the visitor’s own profile', () => {
    const report = assess({
      captureA: capture({
        profile: 'current',
        requests: [request('securepubads.g.doubleclick.net')],
      }),
    });
    const finding = findingOf(report, 'PRE_CONSENT_TRACKERS');

    assert.equal(finding.verdict, VERDICT.WARN);
    assert.match(finding.temperedBecause, /own profile/);
    assert.deepEqual(report.blockingFailures, []);
  });
});

describe('scoring', () => {
  const rule = (id, weight, severity = SEVERITY.MAJOR) => ({ id, weight, severity });

  it('caps a site with a blocking failure below the passing bands', () => {
    const result = score([
      { rule: rule('A', 12, SEVERITY.BLOCKING), result: { verdict: VERDICT.FAIL } },
      { rule: rule('B', 6), result: { verdict: VERDICT.PASS } },
    ]);

    assert.equal(result.rawScore, 88);
    assert.equal(result.score, BLOCKING_CEILING);
    assert.equal(result.cappedByBlocking, true);
    assert.equal(result.band.key, 'characterised');
  });

  it('costs a warning half of what a failure costs', () => {
    const failed = score([{ rule: rule('A', 10), result: { verdict: VERDICT.FAIL } }]);
    const warned = score([{ rule: rule('A', 10), result: { verdict: VERDICT.WARN } }]);

    assert.equal(failed.score, 90);
    assert.equal(warned.score, 95);
  });

  it('does not treat a rule that did not apply as a rule that passed', () => {
    const result = score([
      { rule: rule('A', 30), result: { verdict: VERDICT.NOT_APPLICABLE } },
      { rule: rule('B', 10), result: { verdict: VERDICT.PASS } },
    ]);

    assert.equal(result.notApplicableWeight, 30);
    assert.equal(result.coverage, 0.25);
    assert.equal(result.provisional, true);
  });

  it('bands the score the way the report words it', () => {
    assert.equal(bandFor(100).key, 'broadly-compliant');
    assert.equal(bandFor(85).key, 'broadly-compliant');
    assert.equal(bandFor(84).key, 'departures');
    assert.equal(bandFor(60).key, 'departures');
    assert.equal(bandFor(59).key, 'characterised');
    assert.equal(bandFor(0).key, 'characterised');
  });
});

describe('contrast', () => {
  it('measures the WCAG ratio between the extremes', () => {
    assert.equal(contrastRatio('rgb(0, 0, 0)', 'rgb(255, 255, 255)'), 21);
    assert.equal(contrastRatio('rgb(255, 255, 255)', 'rgb(255, 255, 255)'), 1);
  });

  it('composites a translucent foreground before measuring', () => {
    const opaque = contrastRatio('rgb(0, 0, 0)', 'rgb(255, 255, 255)');
    const faded = contrastRatio('rgba(0, 0, 0, 0.5)', 'rgb(255, 255, 255)');

    assert.ok(faded < opaque);
  });

  it('says it could not measure rather than inventing a number', () => {
    assert.equal(contrastRatio(null, 'rgb(0,0,0)'), null);
    assert.equal(contrastRatio('goldenrod', 'rgb(0,0,0)'), null);
    assert.equal(parseColour('#fff'), null);
  });

  it('reads a control as unpainted when it has no background of its own', () => {
    const control = {
      rect: { x: 0, y: 0, width: 100, height: 40 },
      styles: { color: 'rgb(0,0,0)', backgroundColor: 'rgb(255,255,255)', ownBackgroundColor: 'rgba(0, 0, 0, 0)', fontSize: 16, fontWeight: '400' },
    };

    assert.equal(prominenceOf(control).painted, false);
    assert.equal(prominenceOf(control).area, 4000);
  });
});

describe('classification and exemptions', () => {
  it('walks up the labels to find the operator', () => {
    assert.equal(classifyHost('securepubads.g.doubleclick.net').category, 'advertising');
    assert.equal(classifyHost('ep2.adtrafficquality.google').entity, 'Google');
    assert.equal(classifyHost('cdn.jsdelivr.net').category, 'cdn');
  });

  it('leaves an unknown host unclassified rather than guessing', () => {
    assert.equal(classifyHost('static.files.bbci.co.uk').category, 'unclassified');
    assert.equal(classifyHost('').category, 'unclassified');
  });

  it('recognises a consent record however the site spells it', () => {
    for (const name of ['cookies_policy', 'cookie-consent', 'consent_v2', 'didomi_token', '_sp_v1_p']) {
      assert.equal(exemptionFor({ name }).exempt, true, name);
    }
  });

  it('raises audience measurement for review instead of exempting it outright', () => {
    const matomo = exemptionFor({ name: '_pk_id' });

    assert.equal(matomo.exempt, true);
    assert.equal(matomo.needsReview, true);
  });

  it('knows a tracker identifier by name', () => {
    assert.equal(knownTrackerCookie({ name: '_ga_ABC123' }).known, true);
    assert.equal(knownTrackerCookie({ name: 'panoramaId' }).known, true);
    assert.equal(knownTrackerCookie({ name: 'GeoIP' }).known, false);
  });
});

describe('over the recorded corpus', () => {
  const fixtures = existsSync(CORPUS)
    ? readdirSync(CORPUS)
        .filter((slug) => existsSync(join(CORPUS, slug, 'profile.json')))
        .sort()
        .map((slug) => ({
          slug,
          profile: JSON.parse(readFileSync(join(CORPUS, slug, 'profile.json'), 'utf8')),
        }))
    : [];

  it('never fails a blocking rule without evidence a reader could check', () => {
    for (const { slug, profile } of fixtures) {
      const cmp = identifyCmp(profile);
      const report = assess({
        captureA: capture({ requests: [], cookies: [] }),
        profile,
        cmp,
        banner: locateBanner(profile, cmp),
      });

      for (const finding of report.findings) {
        if (finding.severity !== SEVERITY.BLOCKING || finding.verdict !== VERDICT.FAIL) continue;
        assert.ok(finding.evidence.length > 0, `${slug}/${finding.id}`);
        for (const item of finding.evidence) {
          /* A detail may legitimately be absent; what it may not be is the
             word "undefined" leaking into a client's report. */
          if (item.detail === null) continue;
          assert.ok(
            !/undefined|\bnull\b/.test(String(item.detail)),
            `${slug}/${finding.id}: ${item.detail}`,
          );
        }
      }
    }
  });

  it('never throws on a real page', () => {
    for (const { slug, profile } of fixtures) {
      const cmp = identifyCmp(profile);
      const report = assess({ captureA: capture(), profile, cmp, banner: locateBanner(profile, cmp) });
      const errored = report.findings.filter((finding) => finding.errored);

      assert.deepEqual(errored.map((f) => f.id), [], slug);
    }
  });
});
