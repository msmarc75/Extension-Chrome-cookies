/*
 * Consent banners in the shapes the corpus actually showed, served locally.
 *
 * The recorded corpus proves the detector works on the real web on the day it
 * was recorded. These pages are the other half: fixed, fast, and each isolating
 * one structural pattern, so a regression names the pattern it broke.
 *
 * Every page here was written after reading the corpus, not before.
 */

import { createServer } from 'node:http';

const html = (body, head = '') => `<!doctype html>
<html lang="fr">
  <head><meta charset="utf-8"><title>Fixture</title><style>
    body { font-family: sans-serif; margin: 0; }
    .banner { position: fixed; left: 0; right: 0; bottom: 0; background: #fff;
              border-top: 2px solid #333; padding: 24px; z-index: 9999; }
    .banner button { font-size: 16px; padding: 12px 20px; margin-right: 8px; }
    article { padding: 24px; }
  </style>${head}</head>
  <body><article><h1>Publisher</h1><p>Some content.</p></article>${body}</body>
</html>`;

/* The ordinary case: a fixed bar offering both answers at the same level. */
const PLAIN = html(`
  <div class="banner" id="cookie-notice" role="dialog" aria-modal="true">
    <p>Nous utilisons des cookies et nos partenaires traitent vos données personnelles.</p>
    <button id="accept" onclick="document.getElementById('cookie-notice').remove()">Tout accepter</button>
    <button id="refuse" onclick="document.getElementById('cookie-notice').remove()">Tout refuser</button>
    <a href="/policy">Politique de confidentialité</a>
  </div>`);

/* The refusal one layer deeper than the acceptance — heise's shape. */
const SECOND_LAYER = html(`
  <div class="banner" id="cookie-notice">
    <p>Wir und unsere Partner verwenden Cookies und verarbeiten personenbezogene Daten.</p>
    <button id="accept" onclick="document.getElementById('cookie-notice').remove()">Zustimmen</button>
    <button id="settings" onclick="document.getElementById('prefs').hidden = false">Einstellungen</button>
  </div>
  <div class="banner" id="prefs" hidden>
    <p>Datenschutz-Einstellungen</p>
    <button id="reject" onclick="document.getElementById('prefs').remove(); document.getElementById('cookie-notice').remove()">Alle ablehnen</button>
    <button id="save">Speichern</button>
  </div>`);

/* A banner behind a shadow boundary, which a naive query never reaches. */
const SHADOW = html(
  '<consent-banner></consent-banner>',
  `<script type="module">
    class ConsentBanner extends HTMLElement {
      connectedCallback() {
        const root = this.attachShadow({ mode: 'open' });
        root.innerHTML = \`
          <style>.banner { position: fixed; inset: auto 0 0 0; background: #fff;
                 border-top: 2px solid #333; padding: 24px; z-index: 9999; }</style>
          <div class="banner" id="cookie-notice">
            <p>Nous utilisons des cookies et traitons vos données personnelles.</p>
            <button id="accept">Tout accepter</button>
            <button id="refuse">Continuer sans accepter</button>
          </div>\`;
        for (const button of root.querySelectorAll('button')) {
          button.addEventListener('click', () => root.querySelector('.banner').remove());
        }
      }
    }
    customElements.define('consent-banner', ConsentBanner);
  </script>`,
);

/* Nothing to consent to. A tool that finds a banner here is broken. */
const CLEAN = html('<p>No banner at all.</p>');

/** The banner as a cross-origin frame, the way Sourcepoint renders it. */
const FRAME_INNER = html(`
  <div class="banner" id="cookie-notice" style="position: static">
    <p>Wir verwenden Cookies und verarbeiten personenbezogene Daten mit unseren Partnern.</p>
    <button id="accept" onclick="document.body.innerHTML = 'done'">Alle akzeptieren</button>
    <button id="refuse" onclick="document.body.innerHTML = 'done'">Alle ablehnen</button>
  </div>`);

function listen(server) {
  return new Promise((resolve) => server.listen(0, () => resolve(server.address().port)));
}

const close = (server) => new Promise((resolve) => server.close(resolve));

const send = (response, body) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(body);
};

/**
 * @returns {Promise<{origin: string, frameOrigin: string, close: () => Promise<void>}>}
 */
export async function startBannerSite() {
  let frameOrigin = '';

  const inner = createServer((request, response) => send(response, FRAME_INNER));
  const framePort = await listen(inner);
  /* A different host, so the frame is genuinely cross-origin. */
  frameOrigin = `http://localhost:${framePort}`;

  const main = createServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path === '/plain') return send(response, PLAIN);
    if (path === '/second-layer') return send(response, SECOND_LAYER);
    if (path === '/shadow') return send(response, SHADOW);
    if (path === '/clean') return send(response, CLEAN);
    if (path === '/framed') {
      return send(
        response,
        html(
          `<div id="sp_message_container_1" style="position: fixed; inset: auto 0 0 0; z-index: 9999;">
             <iframe src="${frameOrigin}/" style="width: 100%; height: 220px; border: 0;"></iframe>
           </div>`,
        ),
      );
    }
    response.writeHead(404);
    response.end();
  });

  const mainPort = await listen(main);

  return {
    origin: `http://127.0.0.1:${mainPort}`,
    frameOrigin,
    close: async () => {
      main.closeAllConnections?.();
      inner.closeAllConnections?.();
      await Promise.all([close(main), close(inner)]);
    },
  };
}
