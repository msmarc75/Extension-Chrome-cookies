import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { express, resetOrigin } from '../../extension/src/content/interaction-driver.js';

/**
 * A session that answers `Runtime.evaluate` from a script keyed on what the
 * expression is trying to do. Everything the driver decides — which route to
 * take, whether to go a layer deeper, and above all whether to believe the
 * refusal worked — is decided here rather than in a browser.
 */
function fakeSession(script = {}) {
  const calls = [];
  let profileReads = 0;

  const answer = (expression) => {
    /*
     * The profile collector is matched first and by its own marker: it also
     * calls `__tcfapi`, so matching on that would answer every profile read
     * with the TCF script and quietly blind the driver.
     */
    if (expression.includes('const GLOBALS =')) {
      profileReads += 1;
      const profiles = script.profiles ?? [];
      return JSON.stringify(profiles[Math.min(profileReads - 1, profiles.length - 1)] ?? blank());
    }
    if (expression.includes('const WANTED =')) {
      calls.push({ click: /const WANTED = "([^"]*)"/.exec(expression)?.[1] });
      return script.click ?? { ok: true, point: { x: 10, y: 10 } };
    }
    if (expression.includes('setUserDisagreeToAll')) return script.didomiRefuse;
    if (expression.includes('setUserAgreeToAll')) return script.didomiAccept;
    if (expression.includes('__tcfapi')) return script.tcf ?? null;
    return null;
  };

  return {
    calls,
    frameContexts: () => [],
    childSessions: () => [],
    async trySend(method, params) {
      calls.push({ method });
      if (method !== 'Runtime.evaluate') return {};
      const value = answer(params.expression);
      return value === undefined ? null : { result: { value } };
    },
  };
}

const blank = (overrides = {}) => ({
  url: 'https://example.fr/',
  title: '',
  lang: 'fr',
  viewport: { width: 1280, height: 800 },
  globals: [],
  tcf: null,
  containers: [],
  frames: [],
  ...overrides,
});

const control = (text) => ({
  path: 'button',
  tag: 'button',
  text,
  classes: [],
  rect: { x: 0, y: 0, width: 100, height: 40 },
  visible: true,
  disabled: false,
});

const container = (controls, overrides = {}) => ({
  path: 'div.banner',
  tag: 'div',
  id: 'cookie-banner',
  classes: ['banner'],
  role: null,
  ariaModal: false,
  position: 'fixed',
  zIndex: '9999',
  rect: { x: 0, y: 600, width: 1280, height: 200 },
  viewportShare: 0.2,
  namedForConsent: true,
  text: 'cookies et données personnelles',
  inShadow: false,
  controls,
  ...overrides,
});

const banner = (controls) => ({
  found: true,
  method: 'heuristic',
  confidence: 'heuristic',
  container: container(Object.values(controls).map((found) => found?.control).filter(Boolean)),
  controls,
  reasons: [],
  disclosure: null,
});

const found = (text, intent, score = 1) => ({ control: control(text), match: { intent, score, label: text.toLowerCase() } });

describe('express, through a platform API', () => {
  it('prefers the platform call over pressing anything', async () => {
    const session = fakeSession({
      didomiRefuse: { ok: true, via: 'api' },
      tcf: { available: true, purposeConsents: [] },
    });

    const result = await express({
      session,
      cmp: { id: 'didomi', name: 'Didomi', confidence: 'certain' },
      banner: banner({ accept: found('Tout accepter', 'accept'), refuse: found('Tout refuser', 'refuse') }),
      intent: 'refuse',
    });

    assert.equal(result.via, 'platform-api');
    assert.equal(result.ok, true);
    assert.equal(session.calls.some((call) => call.click), false, 'nothing should have been pressed');
  });

  it('falls back to the button when the platform call is not there', async () => {
    const session = fakeSession({
      didomiRefuse: { ok: false, reason: 'api-absent' },
      tcf: { available: true, purposeConsents: [] },
    });

    const result = await express({
      session,
      cmp: { id: 'didomi', name: 'Didomi', confidence: 'certain' },
      banner: banner({ refuse: found('Tout refuser', 'refuse') }),
      intent: 'refuse',
    });

    assert.equal(result.via, 'button');
    assert.equal(result.ok, true);
    assert.ok(session.calls.some((call) => call.click === 'tout refuser'));
  });
});

describe('express, verifying the outcome', () => {
  it('refuses to call a refusal successful when TCF still records consent', async () => {
    // The failure this whole verification step exists for: the click landed,
    // the banner closed, and nothing was actually refused. Reporting that as a
    // refusal would put a false statement in a client's report.
    const session = fakeSession({
      didomiRefuse: { ok: true, via: 'api' },
      tcf: { available: true, purposeConsents: ['1', '2', '3'] },
    });

    const result = await express({
      session,
      cmp: { id: 'didomi', name: 'Didomi', confidence: 'certain' },
      banner: banner({ refuse: found('Tout refuser', 'refuse') }),
      intent: 'refuse',
    });

    assert.equal(result.tcfAgrees, false);
    assert.equal(result.ok, false);
  });

  it('believes TCF over the banner disappearing', async () => {
    const session = fakeSession({
      didomiRefuse: { ok: true, via: 'api' },
      tcf: { available: true, purposeConsents: [] },
      /* The banner is still on screen after the refusal — several platforms leave it. */
      profiles: [blank({ containers: [container([control('Tout refuser')])] })],
    });

    const result = await express({
      session,
      cmp: { id: 'didomi', name: 'Didomi', confidence: 'certain' },
      banner: banner({ refuse: found('Tout refuser', 'refuse') }),
      intent: 'refuse',
    });

    assert.equal(result.bannerGone, false);
    assert.equal(result.ok, true, 'TCF is the authority when it is available');
  });

  it('falls back to the banner going away when there is no TCF to ask', async () => {
    const session = fakeSession({
      didomiRefuse: { ok: true, via: 'api' },
      tcf: { available: false },
      profiles: [blank()],
    });

    const result = await express({
      session,
      cmp: { id: 'didomi', name: 'Didomi', confidence: 'certain' },
      banner: banner({ refuse: found('Tout refuser', 'refuse') }),
      intent: 'refuse',
    });

    assert.equal(result.tcfAgrees, null);
    assert.equal(result.bannerGone, true);
    assert.equal(result.ok, true);
  });

  it('expects the opposite of TCF when accepting', async () => {
    const session = fakeSession({
      didomiAccept: { ok: true, via: 'api' },
      tcf: { available: true, purposeConsents: [] },
    });

    const result = await express({
      session,
      cmp: { id: 'didomi', name: 'Didomi', confidence: 'certain' },
      banner: banner({ accept: found('Tout accepter', 'accept') }),
      intent: 'accept',
    });

    assert.equal(result.ok, false, 'an acceptance that records no consent did not accept');
  });
});

describe('express, when the first layer offers no refusal', () => {
  it('opens preferences and looks again', async () => {
    const session = fakeSession({
      tcf: { available: true, purposeConsents: [] },
      profiles: [
        /* After pressing "Einstellungen": the panel with the refusal. */
        blank({ containers: [container([control('Alle ablehnen'), control('Speichern')])] }),
      ],
    });

    const result = await express({
      session,
      cmp: { id: null, name: 'No known consent platform', confidence: 'none' },
      banner: banner({
        accept: found('Zustimmen', 'accept'),
        preferences: found('Einstellungen', 'preferences'),
      }),
      intent: 'refuse',
    });

    assert.equal(result.layer, 2);
    assert.match(result.via, /^button-second-layer/);
    assert.deepEqual(
      session.calls.filter((call) => call.click).map((call) => call.click),
      ['einstellungen', 'alle ablehnen'],
    );
  });

  it('gives up honestly when there is no refusal behind preferences either', async () => {
    const session = fakeSession({
      tcf: { available: true, purposeConsents: ['1'] },
      profiles: [blank({ containers: [container([control('Speichern')])] })],
    });

    const result = await express({
      session,
      cmp: { id: null, name: 'none', confidence: 'none' },
      banner: banner({
        accept: found('Zustimmen', 'accept'),
        preferences: found('Einstellungen', 'preferences'),
      }),
      intent: 'refuse',
    });

    assert.equal(result.ok, false);
    assert.equal(result.via, null);
    assert.ok(
      session.calls.length > 0 &&
        result.steps.some((step) => step.result?.reason === 'no-refusal-behind-preferences'),
    );
  });

  it('does not press a neutral "save" and call it a refusal', async () => {
    const session = fakeSession({
      profiles: [blank({ containers: [container([control('Enregistrer'), control('Valider')])] })],
    });

    const result = await express({
      session,
      cmp: { id: null, name: 'none', confidence: 'none' },
      banner: banner({
        accept: found('Tout accepter', 'accept'),
        preferences: found('Personnaliser', 'preferences'),
      }),
      intent: 'refuse',
    });

    assert.equal(result.ok, false);
    assert.equal(
      session.calls.filter((call) => call.click).length,
      1,
      'only the preferences button should have been pressed',
    );
  });
});

describe('resetOrigin', () => {
  it('clears the audited origin and reloads it', async () => {
    const session = fakeSession();

    const result = await resetOrigin(session, {
      origin: 'https://example.fr',
      url: 'https://example.fr/',
    });

    assert.deepEqual(result, { cleared: true, navigated: true });
    const methods = session.calls.map((call) => call.method);
    assert.ok(methods.includes('Storage.clearDataForOrigin'));
    assert.ok(methods.includes('Page.navigate'));
  });
});
