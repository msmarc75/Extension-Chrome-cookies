/*
 * The report page, in the browser, over a real audit.
 *
 * What is being proved is the deliverable: that the page opens on the audit the
 * user just ran, that the timeline draws what was measured and only that, that
 * the exported CSV is the file a spreadsheet opens, and that the printed form
 * drops the controls and keeps the evidence.
 */

import { callBackground, expect, test } from './fixtures.mjs';
import { startBannerSite } from './banner-site.mjs';

/** @type {Awaited<ReturnType<typeof startBannerSite>>} */
let site;

test.beforeAll(async () => {
  site = await startBannerSite();
});

test.afterAll(async () => {
  await site.close();
});

async function audit(page, path = '/plain') {
  const response = await callBackground(page, 'probe_banner', {
    url: `${site.origin}${path}`,
    mode: 'current',
    observationMs: 800,
    act: false,
    analysePolicy: false,
  });
  expect(response.ok, response.ok ? '' : JSON.stringify(response.error)).toBe(true);
  return response.data;
}

async function openReport(context, extensionId, id) {
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${extensionId}/src/ui/report/report.html${id ? `?audit=${id}` : ''}`,
  );
  await page.waitForSelector('[data-field="site"]');
  return page;
}

test('the audit is kept, and the report opens on it', async ({
  extensionPage,
  context,
  extensionId,
}) => {
  const result = await audit(extensionPage);
  expect(result.auditId).toBeTruthy();

  const report = await openReport(context, extensionId, result.auditId);

  await expect(report.locator('[data-field="site"]')).toContainText(site.origin);
  await expect(report.locator('[data-field="footer-meta"]')).toContainText(result.auditId);
  await expect(report.locator('[data-field="score"]')).not.toHaveText('—');
  await report.close();
});

test('the timeline draws what was measured, on the observation window', async ({
  extensionPage,
  context,
  extensionId,
}) => {
  const result = await audit(extensionPage);
  const report = await openReport(context, extensionId, result.auditId);

  /* Four lanes, always: a lane with nothing in it is itself a finding. */
  await expect(report.locator('.ca-lane')).toHaveCount(4);

  const markers = report.locator('.ca-marker');
  const drawn = await markers.count();
  const dated = [
    ...result.captureA.requests.filter((r) => r.party === 'third' && r.tMs !== null),
    ...result.captureA.cookies.filter((c) => c.tMs !== null),
    ...result.captureA.storage.filter((s) => s.tMs !== null),
    ...result.captureA.fingerprinting,
  ].length;
  expect(drawn).toBe(dated);

  /* Every marker names its own observation, so the page is readable without
     colour and survives being printed. */
  for (let index = 0; index < drawn; index += 1) {
    const label = await markers.nth(index).getAttribute('aria-label');
    expect(label).toMatch(/(ms|s) —/);
  }

  await report.close();
});

test('the exported findings file is what a spreadsheet opens', async ({
  extensionPage,
  context,
  extensionId,
}) => {
  const result = await audit(extensionPage);
  const report = await openReport(context, extensionId, result.auditId);

  const download = report.waitForEvent('download');
  await report.click('[data-action="csv-findings"]');
  const file = await download;

  expect(file.suggestedFilename()).toMatch(/^consent-audit_.*_findings\.csv$/);

  const stream = await file.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString('utf8');

  const [header, ...rows] = csv.split('\r\n');
  expect(header.startsWith('Site,Audited at,Profile,Rule')).toBe(true);
  expect(rows.length).toBe(result.report.findings.length);
  expect(csv).toContain('PRE_CONSENT_TRACKERS');
  /* A remediation sentence contains commas; it must be quoted, not spilled. */
  expect(csv).toMatch(/,"[^"]*,[^"]*"/);

  await report.close();
});

test('the deposits file lists every observation, dated or not', async ({
  extensionPage,
  context,
  extensionId,
}) => {
  const result = await audit(extensionPage);
  const report = await openReport(context, extensionId, result.auditId);

  const download = report.waitForEvent('download');
  await report.click('[data-action="csv-deposits"]');
  const file = await download;

  const stream = await file.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString('utf8');

  const rows = csv.split('\r\n');
  expect(rows[0]).toContain('At (ms)');
  const observed =
    result.captureA.requests.filter((r) => r.party === 'third').length +
    result.captureA.cookies.length +
    result.captureA.storage.length +
    result.captureA.fingerprinting.length;
  expect(rows.length - 1).toBe(observed);

  await report.close();
});

test('the printed form drops the controls and keeps the evidence', async ({
  extensionPage,
  context,
  extensionId,
}) => {
  const result = await audit(extensionPage);
  const report = await openReport(context, extensionId, result.auditId);

  await report.emulateMedia({ media: 'print' });
  await expect(report.locator('[data-field="actions"]')).toBeHidden();
  await expect(report.locator('[data-field="history-section"]')).toBeHidden();
  await expect(report.locator('.ca-timeline')).toBeVisible();
  await expect(report.locator('.ca-finding').first()).toBeVisible();

  /*
   * And the PDF itself. "Save as PDF" is Chrome printing this page, so
   * rendering it here is the same operation the user performs — a report that
   * printed to one blank page would pass every assertion above.
   */
  const pdf = await report.pdf({ format: 'A4', printBackground: true });
  expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(pdf.byteLength).toBeGreaterThan(10_000);

  await report.close();
});

test('earlier audits are listed, and forgetting them means forgetting them', async ({
  extensionPage,
  context,
  extensionId,
}) => {
  const first = await audit(extensionPage, '/plain');
  const second = await audit(extensionPage, '/clean');

  const report = await openReport(context, extensionId, second.auditId);
  await expect(report.locator('.ca-history__row')).toHaveCount(2);
  /* The one being read is not a link to itself. */
  await expect(report.locator(`a[href*="${first.auditId}"]`)).toHaveCount(1);

  await report.click('[data-action="clear-history"]');
  await report.waitForSelector('[data-field="empty"]:not([hidden])');
  await expect(report.locator('.ca-history__row')).toHaveCount(1);
  await expect(report.locator('.ca-history__row')).toContainText('No audits kept');

  await report.close();
});

test('a report id that no longer exists falls back rather than showing a blank page', async ({
  extensionPage,
  context,
  extensionId,
}) => {
  await audit(extensionPage);
  const report = await openReport(context, extensionId, 'nothing-by-that-name');

  await expect(report.locator('[data-field="empty"]')).toBeHidden();
  await expect(report.locator('[data-field="site"]')).toContainText(site.origin);

  await report.close();
});
