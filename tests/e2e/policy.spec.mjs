/*
 * The policy, end to end: found from the banner, walked through a hub page,
 * read out of the rendered document, and posted to a service that answers.
 *
 * The service here is local and its "model" is a stub, because what is being
 * proved is the path — that the extension reaches the right document, sends its
 * text and nobody's key, and folds what comes back into the report. What the
 * model itself makes of a policy is measured elsewhere, by
 * `npm run verify:policies -- --live`.
 */

import { createAnalysisServer } from '../../server/index.mjs';
import { AnalysisCache } from '../../server/cache.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { callBackground, expect, grantPro, test } from './fixtures.mjs';
import { startBannerSite } from './banner-site.mjs';

/** @type {Awaited<ReturnType<typeof startBannerSite>>} */
let site;
/** @type {{origin: string, close: () => Promise<void>, calls: {count: number, sent: Array<string>}}} */
let service;
let cacheDirectory;

/* The answer a model would give about the policy this site serves. Every quote
   is copied from tests/e2e/banner-site.mjs, which is the point: the server
   checks them against the text the extension actually extracted. */
const ANSWER = {
  model: 'stub/policy-v1',
  mentions: [
    {
      subject: 'identity_controller',
      status: 'present',
      quote: 'Fixture Presse SAS, 4 rue de Rivoli, 75001 Paris, est responsable du traitement des donnees personnelles collectees sur ce site.',
      note: null,
    },
    {
      subject: 'retention',
      status: 'present',
      quote: 'Vos donnees sont conservees treize mois a compter de leur collecte.',
      note: null,
    },
    {
      subject: 'right_complain_supervisory',
      status: 'present',
      quote: 'Vous pouvez introduire une reclamation aupres de la CNIL.',
      note: null,
    },
    {
      /* A fabricated sentence, deliberately: the server must drop it. */
      subject: 'third_country_transfers',
      status: 'present',
      quote: 'Vos donnees sont transferees aux Etats-Unis sous clauses contractuelles types.',
      note: null,
    },
  ],
};

test.beforeAll(async () => {
  site = await startBannerSite();

  cacheDirectory = mkdtempSync(join(tmpdir(), 'consent-audit-e2e-cache-'));
  const calls = { count: 0, sent: [] };
  const server = createAnalysisServer({
    cache: new AnalysisCache(cacheDirectory),
    ask: async ({ user }) => {
      calls.count += 1;
      calls.sent.push(user);
      return ANSWER;
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  service = {
    origin: `http://127.0.0.1:${server.address().port}`,
    calls,
    close: () => new Promise((done) => server.close(done)),
  };
});

test.afterAll(async () => {
  await site.close();
  await service.close();
  rmSync(cacheDirectory, { recursive: true, force: true });
});

async function probe(page, path, extra = {}) {
  /* Policy analysis is what a licence buys; this file is about the analysis,
     not about who may have it. */
  await grantPro(page);
  const response = await callBackground(page, 'probe_banner', {
    url: `${site.origin}${path}`,
    mode: 'current',
    observationMs: 800,
    act: false,
    serviceOrigin: service.origin,
    ...extra,
  });
  expect(response.ok, response.ok ? '' : JSON.stringify(response.error)).toBe(true);
  return response.data;
}

test('it follows the banner’s own link, through a hub, to the policy', async ({ extensionPage }) => {
  const result = await probe(extensionPage, '/plain', { analysePolicy: false });

  expect(result.policy.via).toBe('banner+hop');
  expect(result.policy.finalUrl).toBe(`${site.origin}/privacy-policy`);
  expect(result.policy.error).toBeNull();
  expect(result.policy.text).toContain('Fixture Presse SAS');
  /* The banner on the policy page is furniture, not policy. */
  expect(result.policy.text).not.toContain('Tout accepter');
});

test('the analysis comes back and the rulebook uses it', async ({ extensionPage }) => {
  const result = await probe(extensionPage, '/plain');

  expect(result.policy.analysis).toBeTruthy();
  expect(result.policy.analysis.promptVersion).toBe('policy-v1');
  expect(result.policy.analysis.source.url).toBe(`${site.origin}/privacy-policy`);

  const retention = result.report.findings.find((f) => f.id === 'POLICY_STATES_RETENTION');
  expect(retention.verdict).toBe('pass');
  expect(retention.evidence[0].detail).toContain('treize mois');
});

test('a sentence the policy never contained does not become a finding', async ({
  extensionPage,
}) => {
  const result = await probe(extensionPage, '/plain');

  const transfers = result.policy.analysis.mentions.find(
    (m) => m.subject === 'third_country_transfers',
  );
  expect(transfers.status).toBe('unverified');
  expect(transfers.quote).toBeNull();

  /* And it is a warning about the tool's own reach, never a failure charged to
     the site. */
  const recipients = result.report.findings.find((f) => f.id === 'POLICY_NAMES_RECIPIENTS');
  expect(recipients.verdict).not.toBe('pass');
  expect(result.report.blockingFailures).toEqual([]);
});

test('what leaves the browser is the text, and no key', async ({ extensionPage }) => {
  await probe(extensionPage, '/plain');

  const sent = service.calls.sent.at(-1);
  expect(sent).toContain('Fixture Presse SAS');
  expect(sent).not.toMatch(/sk-ant|api[_-]?key/i);
});

test('an audit still finishes when the service is not there', async ({ extensionPage }) => {
  const result = await probe(extensionPage, '/plain', { serviceOrigin: 'http://127.0.0.1:1' });

  expect(result.policy.analysis).toBeNull();
  expect(result.policy.error.code).toMatch(/SERVICE_UNREACHABLE|SERVICE_FAILED/);
  /* The rest of the report is unaffected, and says what is missing from it. */
  expect(result.report.findings.length).toBeGreaterThan(15);
  expect(result.report.disclosures.some((d) => /policy was not analysed/.test(d))).toBe(true);
});

test('a page with no policy link says so instead of guessing', async ({ extensionPage }) => {
  const result = await probe(extensionPage, '/clean');

  expect(result.policy.url).toBeNull();
  expect(result.policy.error.code).toBe('NO_POLICY_LINK');
});
