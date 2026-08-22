#!/usr/bin/env node
/*
 * Runs capture A against a list of real sites and writes the evidence out for
 * a human to read.
 *
 * The end-to-end suite proves the machinery is correct against a fixture whose
 * every byte is known. This proves it is *useful*: that on a real French news
 * site, with a real consent banner nobody has touched, the capture actually
 * contains the advertising and analytics calls a practitioner would expect to
 * find, at plausible times.
 *
 * It is not part of `npm test`: it needs the open internet, real sites change
 * under it, and its output is a document to be read rather than an assertion to
 * be passed. Run it with `npm run verify:capture`.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { registrableDomain } from '../extension/src/shared/hosts.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXTENSION = join(ROOT, 'dist', 'extension');
const OUT_DIR = join(ROOT, 'docs', 'verification');
const SITES = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/sites/phase2.json'), 'utf8'));

const OBSERVATION_MS = 5_000;

/*
 * --- Sandbox accommodations -------------------------------------------------
 *
 * None of this belongs to the product; it is what makes a browser reach the
 * internet from inside this container, and it is confined to this script.
 *
 * Outbound HTTPS is tunnelled through a local proxy that re-terminates TLS. The
 * standard CA environment variables point every other tool at its bundle, but
 * Chromium reads neither those nor the system store — it uses its own root
 * store plus the NSS user database, and there is no `certutil` here to populate
 * one. So the interception CAs are extracted from the bundle and allowed by
 * public-key hash: the same trust decision the rest of the toolchain already
 * makes, expressed the only way Chromium accepts it. Certificate verification
 * stays on for everything else.
 *
 * Chromium also resolves names over DNS-over-HTTPS by default, directly rather
 * than through the proxy, which simply fails here. With the proxy doing
 * resolution, DoH has nothing to add.
 *
 * Finally, the egress gateway resets Chromium's TLS 1.3 ClientHello — 1785
 * bytes of it, most of them the post-quantum key share — while accepting the
 * same handshake from `openssl` and from TLS 1.2. Capping the harness browser
 * at 1.2 is transport-level only: it changes nothing about which scripts a page
 * loads or which trackers it calls, but it is an artefact of this container and
 * is recorded in the run's own report so no reader mistakes it for a finding.
 */
function sandboxArgs() {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!proxy) return [];

  const bundlePath = process.env.SSL_CERT_FILE ?? '/root/.ccr/ca-bundle.crt';
  const spki = interceptionCaSpki(bundlePath);

  return [
    `--proxy-server=${proxy}`,
    '--disable-features=DnsOverHttps',
    '--ssl-version-max=tls1.2',
    ...(spki.length > 0 ? [`--ignore-certificate-errors-spki-list=${spki.join(',')}`] : []),
  ];
}

/** True when the run was taken through the container's inspecting proxy. */
const sandboxed = () => sandboxArgs().length > 0;

/** SHA-256 public-key hashes of the self-signed interception CAs in a bundle. */
function interceptionCaSpki(bundlePath) {
  let bundle;
  try {
    bundle = readFileSync(bundlePath, 'utf8');
  } catch {
    return [];
  }

  const certificates = bundle.match(
    /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
  );
  const hashes = [];

  for (const certificate of certificates ?? []) {
    const subject = openssl(['x509', '-noout', '-subject'], certificate);
    if (!/O\s*=\s*Anthropic/.test(subject)) continue;
    const publicKey = openssl(['x509', '-pubkey', '-noout'], certificate);
    const hash = execFileSync(
      'sh',
      [
        '-c',
        'openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl enc -base64',
      ],
      { input: publicKey, encoding: 'utf8' },
    ).trim();
    if (!hashes.includes(hash)) hashes.push(hash);
  }
  return hashes;
}

function openssl(args, input) {
  return execFileSync('openssl', args, { input, encoding: 'utf8' });
}

/* --- The run --------------------------------------------------------------- */

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'consent-audit-verify-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: '/opt/pw-browsers/chromium',
    args: [
      `--disable-extensions-except=${EXTENSION}`,
      `--load-extension=${EXTENSION}`,
      '--no-sandbox',
      ...sandboxArgs(),
    ],
  });

  const worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/ui/popup/popup.html`);

  const results = [];
  for (const site of SITES.sites) {
    process.stdout.write(`… ${site.url}\n`);
    const response = await page.evaluate(
      ([url, observationMs]) =>
        chrome.runtime.sendMessage({
          protocol: 1,
          kind: 'request',
          id: crypto.randomUUID(),
          type: 'capture_pre_consent',
          payload: { url, mode: 'current', observationMs },
          sentAt: Date.now(),
        }),
      [site.url, OBSERVATION_MS],
    );

    results.push(
      response.ok
        ? { site, capture: response.data }
        : { site, error: response.error.message },
    );
  }

  await context.close();
  rmSync(profile, { recursive: true, force: true });

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  writeFileSync(join(OUT_DIR, `capture-a-${stamp}.json`), JSON.stringify(results, null, 2));
  const report = renderReport(results, stamp);
  writeFileSync(join(OUT_DIR, `capture-a-${stamp}.md`), report);
  process.stdout.write(`\n${report}`);
}

/* --- Reading the evidence --------------------------------------------------- */

function thirdPartyDomains(capture) {
  const byDomain = new Map();
  for (const request of capture.requests) {
    if (request.party !== 'third') continue;
    const domain = registrableDomain(request.host);
    if (!byDomain.has(domain)) byDomain.set(domain, { domain, tMs: request.tMs, count: 0 });
    byDomain.get(domain).count += 1;
  }
  return [...byDomain.values()].sort((a, b) => a.tMs - b.tMs);
}

function renderReport(results, stamp) {
  const lines = [
    `# Capture A — verification run, ${stamp}`,
    '',
    'Every figure below was measured with no interaction whatsoever: the page was',
    'loaded in a clean profile, watched for five seconds, and never touched. Whatever',
    'appears here, the visitor received before being asked anything.',
    '',
    ...(sandboxed()
      ? [
          '> Taken from inside a sandbox whose egress gateway re-terminates TLS, caps the',
          '> browser at TLS 1.2, and may refuse hosts a normal network would allow. Counts',
          '> here are therefore a floor, not a measurement of what these sites do in the',
          '> wild. What the run establishes is that capture A sees what the page asks for.',
          '',
        ]
      : []),
    '| Site | 3rd-party domains | Requests | Cookies (3rd) | Storage | First deposit |',
    '|---|---|---|---|---|---|',
  ];

  for (const result of results) {
    if (result.error) {
      lines.push(`| ${result.site.url} | — | — | — | — | **${result.error}** |`);
      continue;
    }
    const capture = result.capture;
    const domains = thirdPartyDomains(capture);
    const thirdPartyCookies = capture.cookies.filter((c) => c.party === 'third').length;
    const timed = [
      ...capture.requests.filter((r) => r.party === 'third').map((r) => r.tMs),
      ...capture.cookies.map((c) => c.tMs),
      ...capture.storage.map((s) => s.tMs),
    ].filter((t) => typeof t === 'number');
    const first = timed.length > 0 ? `${Math.round(Math.min(...timed))} ms` : 'none';

    lines.push(
      `| ${capture.target.finalUrl ?? result.site.url} | ${domains.length} | ` +
        `${capture.requests.length} | ${capture.cookies.length} (${thirdPartyCookies}) | ` +
        `${capture.storage.length} | ${first} |`,
    );
  }

  lines.push('', '## Third parties reached before consent, in the order they were called', '');

  for (const result of results) {
    if (result.error) continue;
    const domains = thirdPartyDomains(result.capture);
    lines.push(`### ${result.site.url}`, '');
    if (result.capture.notes.length > 0) {
      lines.push(`Notes: ${result.capture.notes.map((n) => n.code).join(', ')}`, '');
    }
    if (domains.length === 0) {
      lines.push('No third party contacted.', '');
      continue;
    }
    for (const { domain, tMs, count } of domains) {
      lines.push(`- \`${domain}\` — first at ${Math.round(tMs)} ms, ${count} request(s)`);
    }
    const cookies = result.capture.cookies;
    if (cookies.length > 0) {
      lines.push('', 'Cookies:');
      for (const cookie of cookies.slice(0, 25)) {
        const when = cookie.tMs === null ? 'undated' : `${Math.round(cookie.tMs)} ms`;
        lines.push(`- \`${cookie.name}\` on \`${cookie.host}\` (${cookie.party}, ${when})`);
      }
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

await main();
