import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { locateBanner } from '../../extension/src/content/banner-detector.js';
import { identifyCmp } from '../../extension/src/content/cmp-adapters/index.js';

const CORPUS = fileURLToPath(new URL('../fixtures/banners/', import.meta.url));

const control = (text, overrides = {}) => ({
  path: `button.${text.replace(/\W+/g, '-')}`,
  tag: 'button',
  type: null,
  role: null,
  id: null,
  classes: [],
  text,
  ariaLabel: null,
  title: null,
  rect: { x: 0, y: 0, width: 120, height: 40 },
  visible: true,
  disabled: false,
  ...overrides,
});

const container = (overrides = {}) => ({
  path: 'div.notice',
  tag: 'div',
  id: null,
  classes: [],
  role: null,
  ariaModal: false,
  position: 'fixed',
  zIndex: '9999',
  rect: { x: 0, y: 600, width: 1280, height: 200 },
  viewportShare: 0.2,
  namedForConsent: false,
  text: 'Nous utilisons des cookies et nos partenaires traitent vos données personnelles.',
  inShadow: false,
  controls: [control('Tout accepter'), control('Tout refuser')],
  ...overrides,
});

const profile = (overrides = {}) => ({
  url: 'https://example.fr/',
  title: '',
  lang: 'fr',
  viewport: { width: 1280, height: 800 },
  globals: [],
  tcf: null,
  containers: [],
  frames: [],
  unreadable: false,
  ...overrides,
});

const none = { id: null, name: 'No known consent platform', confidence: 'none', evidence: [] };

describe('locateBanner, without a known platform', () => {
  it('finds a banner that looks and reads like one', () => {
    const found = locateBanner(profile({ containers: [container()] }), none);

    assert.equal(found.found, true);
    assert.equal(found.method, 'heuristic');
    assert.equal(found.controls.accept.match.intent, 'accept');
    assert.equal(found.controls.refuse.match.intent, 'refuse');
  });

  it('says out loud that the banner was guessed at', () => {
    // The single most important honesty requirement in the product: a finding
    // built on a guessed banner must not read like one built on a known
    // platform.
    const found = locateBanner(profile({ containers: [container()] }), none);

    assert.equal(found.confidence, 'heuristic');
    assert.match(found.disclosure, /No known consent platform/);
  });

  it('does not mistake the site header for a banner', () => {
    const header = container({
      path: 'header#header',
      position: 'sticky',
      viewportShare: 0.12,
      text: 'Menu Accueil Se connecter S’abonner',
      controls: [control('Menu'), control('Se connecter'), control("S'abonner")],
    });

    const found = locateBanner(profile({ containers: [header] }), none);

    assert.equal(found.found, false);
    assert.equal(found.method, 'none');
  });

  it('prefers the box that offers a choice over one that only offers consent', () => {
    const chooser = container({ path: 'div.chooser' });
    const nagger = container({
      path: 'div.nag',
      controls: [control('Accepter')],
      text: 'Cookies',
    });

    const found = locateBanner(profile({ containers: [nagger, chooser] }), none);

    assert.equal(found.container.path, 'div.chooser');
  });

  it('gives its reasons, so the report can quote them', () => {
    const found = locateBanner(profile({ containers: [container()] }), none);

    assert.ok(found.reasons.length > 0);
    assert.ok(found.reasons.some((reason) => /choice/.test(reason)));
  });
});

describe('locateBanner, with a known platform', () => {
  const didomiProfile = profile({
    globals: ['Didomi'],
    containers: [
      container({ path: 'div#didomi-popup', id: 'didomi-popup', namedForConsent: true }),
      container({ path: 'div.other', text: 'unrelated', controls: [] }),
    ],
  });

  it('lets the platform markup settle which box it is', () => {
    const cmp = identifyCmp(didomiProfile);
    const found = locateBanner(didomiProfile, cmp);

    assert.equal(found.method, 'platform-markup');
    assert.equal(found.confidence, 'certain');
    assert.equal(found.container.id, 'didomi-popup');
    assert.equal(found.disclosure, null);
  });

  it('follows the buttons when the named box is only a wrapper', () => {
    // Sourcepoint names an empty container and renders the banner in a frame.
    // Reporting the wrapper would leave the audit with nothing to press.
    const wrapper = container({
      path: 'div#sp_message_container_1',
      id: 'sp_message_container_1',
      text: '',
      controls: [],
    });
    const inFrame = container({ path: 'div.message', frameContextId: 4 });
    const spProfile = profile({ globals: ['_sp_'], containers: [wrapper, inFrame] });

    const found = locateBanner(spProfile, identifyCmp(spProfile));

    assert.equal(found.method, 'platform-markup');
    assert.equal(found.container.path, 'div.message');
    assert.match(found.disclosure, /separate box/);
    assert.ok(found.controls.refuse);
  });
});

describe('locateBanner, when it cannot see', () => {
  it('reports an unreadable consent frame rather than a clean bill of health', () => {
    // The worst false negative available: a site looks compliant because the
    // tool went blind.
    const found = locateBanner(
      profile({ frames: [{ src: 'https://cdn.privacy-mgmt.com/index.html', name: null }] }),
      none,
    );

    assert.equal(found.found, false);
    assert.equal(found.method, 'frame-only');
    assert.match(found.disclosure, /separate frame/);
  });

  it('reports nothing found when there is genuinely nothing', () => {
    const found = locateBanner(profile(), none);

    assert.equal(found.found, false);
    assert.equal(found.method, 'none');
    assert.equal(found.disclosure, null);
  });

  it('ignores a control that is present but invisible or disabled', () => {
    const hidden = container({
      controls: [control('Tout accepter'), control('Tout refuser', { visible: false })],
    });

    const found = locateBanner(profile({ containers: [hidden] }), none);

    assert.equal(found.controls.refuse, null);
    assert.ok(found.controls.accept);
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

  it('never claims certainty for a banner it guessed at', () => {
    for (const { slug, profile: recorded } of fixtures) {
      const found = locateBanner(recorded, identifyCmp(recorded));
      if (found.method !== 'heuristic') continue;
      assert.notEqual(found.confidence, 'certain', slug);
      assert.ok(found.disclosure, `${slug} guessed without saying so`);
    }
  });

  it('locates a banner on most of the corpus', () => {
    const located = fixtures.filter(({ profile: recorded }) =>
      locateBanner(recorded, identifyCmp(recorded)).found,
    );

    // The floor, not the target: these profiles are re-derived from saved
    // pages, where a cross-origin consent frame cannot load. The live run in
    // docs/verification/ is what measures the real figure.
    assert.ok(located.length >= 18, `located ${located.length} of ${fixtures.length}`);
  });
});
