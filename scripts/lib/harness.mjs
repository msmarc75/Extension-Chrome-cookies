/*
 * Launches a Chromium that can reach the open web, with the extension loaded
 * when asked for.
 *
 * Shared by the scripts that produce evidence rather than assertions —
 * verify-capture.mjs and capture-fixtures.mjs. Everything sandbox-specific
 * lives here and nowhere near the extension.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

export const EXTENSION_PATH = fileURLToPath(new URL('../../dist/extension', import.meta.url));

const CHROMIUM = '/opt/pw-browsers/chromium';

/*
 * --- Sandbox accommodations -------------------------------------------------
 *
 * None of this belongs to the product; it is what makes a browser reach the
 * internet from inside this container.
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
 * than through the proxy, which simply fails here. With the proxy resolving,
 * DoH has nothing to add.
 *
 * Finally, the egress gateway resets Chromium's TLS 1.3 ClientHello — 1785
 * bytes of it, most of them the post-quantum key share — while accepting the
 * same handshake from `openssl` and over TLS 1.2. Capping the harness browser
 * at 1.2 is transport-level only: it changes nothing about which scripts a page
 * loads or which trackers it calls. It is an artefact of this container, and
 * every report produced here says so.
 */
export function sandboxArgs() {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!proxy) return [];

  const spki = interceptionCaSpki(process.env.SSL_CERT_FILE ?? '/root/.ccr/ca-bundle.crt');

  return [
    `--proxy-server=${proxy}`,
    '--disable-features=DnsOverHttps',
    '--ssl-version-max=tls1.2',
    ...(spki.length > 0 ? [`--ignore-certificate-errors-spki-list=${spki.join(',')}`] : []),
  ];
}

/** True when this run goes through the container's inspecting proxy. */
export const sandboxed = () => sandboxArgs().length > 0;

/** SHA-256 public-key hashes of the self-signed interception CAs in a bundle. */
function interceptionCaSpki(bundlePath) {
  let bundle;
  try {
    bundle = readFileSync(bundlePath, 'utf8');
  } catch {
    return [];
  }

  const hashes = [];
  const certificates =
    bundle.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];

  for (const certificate of certificates) {
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

/*
 * A user agent that does not announce itself as headless.
 *
 * This is not cosmetic and it is not evasion: with the default
 * "HeadlessChrome" agent, consent platforms decline to render their banner at
 * all. Measured on leparisien.fr, Didomi's host element goes from empty to ten
 * kilobytes of markup on nothing but this string. A corpus recorded without it
 * would be a corpus of pages that never showed a banner — the opposite of what
 * it is for. Real users run a real Chrome; the harness has to look like one to
 * observe what they observe.
 */
function realisticUserAgent() {
  let version = '141.0.0.0';
  try {
    const reported = execFileSync(CHROMIUM, ['--version'], { encoding: 'utf8' });
    const match = /(\d+\.\d+\.\d+\.\d+)/.exec(reported);
    if (match) version = match[1];
  } catch {
    /* Fall back to the pinned version above. */
  }
  return (
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    `Chrome/${version} Safari/537.36`
  );
}

/**
 * @param {{extension?: boolean, deviceScaleFactor?: number}} [options]
 * @returns {Promise<{context: import('@playwright/test').BrowserContext, close: () => Promise<void>}>}
 */
export async function launchHarness({ extension = false, deviceScaleFactor } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'consent-audit-harness-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: CHROMIUM,
    deviceScaleFactor,
    userAgent: realisticUserAgent(),
    viewport: { width: 1280, height: 800 },
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    args: [
      '--no-sandbox',
      /* Same reason as the user agent: some platforms check this flag too. */
      '--disable-blink-features=AutomationControlled',
      ...(extension
        ? [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`]
        : []),
      ...sandboxArgs(),
    ],
  });

  return {
    context,
    close: async () => {
      await context.close();
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

/** The note every report produced inside this container has to carry. */
export const SANDBOX_CAVEAT = [
  '> Taken from inside a sandbox whose egress gateway re-terminates TLS, caps the',
  '> browser at TLS 1.2, and may refuse hosts a normal network would allow. Counts',
  '> here are a floor, not a measurement of what these sites do in the wild.',
];
