/*
 * A two-host site to measure against.
 *
 * `127.0.0.1` is the audited site; `localhost` stands in for everyone else.
 * They are different registrable domains as far as the classifier is
 * concerned, which is exactly the distinction capture A has to draw, and
 * neither needs a certificate or a real network.
 *
 * The page behaves like a small publisher that has not asked anything yet: a
 * session cookie and an A/B cookie in the response headers, a localStorage
 * write, a third-party script, and a pixel that the third party answers with a
 * cookie of its own.
 */

import { createServer } from 'node:http';

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Fixture publisher</title>
    <script src="__THIRD_PARTY__/tracker.js"></script>
  </head>
  <body>
    <h1>Fixture publisher</h1>
    <p>Nothing here asks for consent.</p>
    <script>
      localStorage.setItem('visitor_id', 'fixture-visitor');
      document.cookie = 'written_by_script=1; path=/';
      new Image().src = '__THIRD_PARTY__/pixel.gif?t=' + Date.now();
    </script>
  </body>
</html>`;

/* A one-pixel transparent GIF. */
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

/* Bound on every interface so both `127.0.0.1` and `localhost` reach it. */
function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

/**
 * @returns {Promise<{origin: string, thirdPartyOrigin: string, slowUrl: string, close: () => Promise<void>}>}
 */
export async function startFixtureSite() {
  let page = '';

  const thirdParty = createServer((request, response) => {
    if (request.url.startsWith('/tracker.js')) {
      response.writeHead(200, {
        'content-type': 'application/javascript',
        'set-cookie': 'tp_session=abc; Path=/',
      });
      response.end('window.__fixtureTracker = true;');
      return;
    }
    if (request.url.startsWith('/pixel.gif')) {
      response.writeHead(200, {
        'content-type': 'image/gif',
        'set-cookie': 'tp_id=pixel-value; Path=/; Max-Age=86400',
      });
      response.end(PIXEL);
      return;
    }
    response.writeHead(404);
    response.end();
  });

  const firstParty = createServer((request, response) => {
    if (request.url.startsWith('/never-answers')) {
      /* Left hanging on purpose: the audit must still release the debugger. */
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'set-cookie': [
        'FIXTURESESSID=session-value; Path=/; HttpOnly; SameSite=Lax',
        'ab_variant=b; Path=/; Max-Age=2592000',
      ],
    });
    response.end(page);
  });

  const thirdPartyPort = await listen(thirdParty);
  /* localhost and 127.0.0.1 resolve to the same socket but are different hosts. */
  const thirdPartyOrigin = `http://localhost:${thirdPartyPort}`;
  page = PAGE.replaceAll('__THIRD_PARTY__', thirdPartyOrigin);

  const firstPartyPort = await listen(firstParty);
  const origin = `http://127.0.0.1:${firstPartyPort}`;

  return {
    origin,
    thirdPartyOrigin,
    slowUrl: `${origin}/never-answers`,
    close: async () => {
      firstParty.closeAllConnections?.();
      thirdParty.closeAllConnections?.();
      await Promise.all([close(firstParty), close(thirdParty)]);
    },
  };
}
