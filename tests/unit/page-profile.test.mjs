import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CONSENT_GLOBALS,
  PROFILE_EXPRESSION,
  parsePageProfile,
} from '../../extension/src/content/page-profile.js';

describe('the collector expression', () => {
  it('is a self-contained async expression', () => {
    // It is sent to the page as text and shares nothing with this module, so a
    // stray reference to anything here would only fail at audit time.
    assert.match(PROFILE_EXPRESSION, /^\(async \(\) => \{/);
    assert.match(PROFILE_EXPRESSION, /\}\)\(\)$/);
  });

  it('carries the globals table it was built with', () => {
    for (const global of ['__tcfapi', 'Didomi', 'OneTrust', '_sp_']) {
      assert.ok(PROFILE_EXPRESSION.includes(`"${global}"`), global);
      assert.ok(CONSENT_GLOBALS.includes(global), global);
    }
  });

  it('never dispatches an event or moves the page', () => {
    // Reading is not interacting. A collector that focused, scrolled or
    // clicked would contaminate the very measurement it is there to support.
    for (const forbidden of ['.click(', 'dispatchEvent', 'scrollIntoView', '.focus(']) {
      assert.ok(!PROFILE_EXPRESSION.includes(forbidden), `collector uses ${forbidden}`);
    }
  });

  it('bounds what it collects', () => {
    assert.match(PROFILE_EXPRESSION, /"containers":\s*\d+/);
    assert.match(PROFILE_EXPRESSION, /"controlsPerContainer":\s*\d+/);
  });
});

describe('parsePageProfile', () => {
  const valid = JSON.stringify({
    url: 'https://example.fr/',
    title: 'Example',
    lang: 'fr',
    viewport: { width: 1280, height: 800 },
    globals: ['__tcfapi'],
    tcf: { cmpId: 7 },
    containers: [
      {
        path: 'div#banner',
        tag: 'div',
        id: 'banner',
        classes: ['a', 'b'],
        role: 'dialog',
        ariaModal: true,
        position: 'fixed',
        zIndex: '10',
        rect: { x: 1, y: 2, width: 3, height: 4 },
        viewportShare: 0.2,
        namedForConsent: true,
        text: 'cookies',
        inShadow: false,
        controls: [
          {
            path: 'button',
            tag: 'button',
            type: null,
            role: null,
            id: null,
            classes: [],
            text: 'Tout refuser',
            ariaLabel: null,
            title: null,
            rect: { x: 0, y: 0, width: 10, height: 10 },
            visible: true,
            disabled: false,
          },
        ],
      },
    ],
    frames: [{ src: 'https://cdn.privacy-mgmt.com/x', name: null }],
  });

  it('round-trips a well-formed profile', () => {
    const profile = parsePageProfile(valid);

    assert.equal(profile.url, 'https://example.fr/');
    assert.deepEqual(profile.globals, ['__tcfapi']);
    assert.equal(profile.tcf.cmpId, 7);
    assert.equal(profile.containers[0].controls[0].text, 'Tout refuser');
    assert.equal(profile.frames[0].src, 'https://cdn.privacy-mgmt.com/x');
    assert.equal(profile.unreadable, false);
  });

  it('marks an unreadable page rather than pretending it was empty', () => {
    // "No banner" and "could not look" are different findings, and only one of
    // them clears a site.
    for (const broken of [undefined, null, 42, 'not json', '"a string"', '[]']) {
      const profile = parsePageProfile(broken);
      assert.equal(profile.unreadable, true, String(broken));
      assert.deepEqual(profile.containers, []);
    }
  });

  it('survives a page that fills the profile with rubbish', () => {
    // Everything the collector touches is reachable from page script, so what
    // comes back is input, not data this side may trust.
    const hostile = JSON.stringify({
      url: { nope: true },
      globals: 'not an array',
      containers: [null, 'string', { controls: 'not an array' }],
      frames: [{ src: 5 }, 'x'],
      viewport: 'no',
    });

    const profile = parsePageProfile(hostile);

    assert.equal(profile.url, null);
    assert.deepEqual(profile.globals, []);
    assert.equal(profile.containers.length, 1);
    assert.deepEqual(profile.containers[0].controls, []);
    assert.deepEqual(profile.frames, []);
    assert.deepEqual(profile.viewport, { width: 0, height: 0 });
  });

  it('fills in a missing rect rather than leaving geometry undefined', () => {
    const profile = parsePageProfile(
      JSON.stringify({ containers: [{ path: 'div', controls: [{ text: 'x' }] }] }),
    );

    assert.deepEqual(profile.containers[0].rect, { x: 0, y: 0, width: 0, height: 0 });
    assert.deepEqual(profile.containers[0].controls[0].rect, { x: 0, y: 0, width: 0, height: 0 });
  });

  it('treats a control as visible unless it was told otherwise', () => {
    const profile = parsePageProfile(
      JSON.stringify({ containers: [{ controls: [{ text: 'a' }, { text: 'b', visible: false }] }] }),
    );

    assert.equal(profile.containers[0].controls[0].visible, true);
    assert.equal(profile.containers[0].controls[1].visible, false);
  });
});
