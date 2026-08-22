/*
 * Finding the policy, and not finding an article about privacy.
 *
 * Every candidate below is a real link, taken from the run that produced the
 * corpus. Three of them were followed by the first version of this code, which
 * is why the ranking exists: a news site publishes articles about privacy, and
 * "the first link whose text mentions privacy" is a headline about as often as
 * it is a policy.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  nextPolicyHop,
  parsePolicyText,
  policyUrlFrom,
  scorePolicyLink,
} from '../../extension/src/content/policy-text.js';

const link = (href, text = '') => ({ href, text });

describe('ranking a policy link', () => {
  it('prefers a policy path over an article that mentions privacy', () => {
    const policy = scorePolicyLink(link('https://www.theguardian.com/help/privacy-policy'));
    const article = scorePolicyLink(
      link(
        'https://www.theguardian.com/technology/2026/aug/22/meta-trial-children-privacy',
        'Meta trial over children’s privacy begins',
      ),
    );

    assert.ok(policy > article, `${policy} should beat ${article}`);
    assert.ok(article < 4, 'an article must not clear the bar to be followed');
  });

  it('recognises the document by its host as well as its path', () => {
    assert.ok(scorePolicyLink(link('https://datenschutz.zeit.de/zon')) >= 6);
    assert.ok(
      scorePolicyLink(
        link('https://mentions-legales.lefigaro.fr/le-figaro/politique-de-confidentialite-figaro'),
      ) >= 6,
    );
  });

  it('refuses a PDF, which a browser cannot read into text', () => {
    /* The CNIL's homepage offers one, and the first run analysed nothing. */
    assert.equal(
      scorePolicyLink(link('https://www.cnil.fr/sites/default/files/2025-09/l-agence-privacy-cnil-chap1.pdf')),
      -Infinity,
    );
  });

  it('is not fooled by a subscription funnel carrying the page you came from', () => {
    const funnel = link(
      'https://support.theguardian.com/subscribe/weekly?INTCMP=header&acquisitionData=%7B%22referrerUrl%22%3A%22https%3A%2F%2Fwww.theguardian.com%2Finfo%2Fprivacy%22%7D',
      'Print subscriptions',
    );
    assert.ok(scorePolicyLink(funnel) < 4);
  });

  it('prefers the site’s own policy to somebody else’s', () => {
    /* A Belgian publisher behind a Cloudflare interstitial, whose only
       "privacy policy" link led to Cloudflare's own. */
    const theirs = scorePolicyLink(
      link('https://www.cloudflare.com/fr-fr/privacypolicy/', 'privacy policy'),
      'www.standaard.be',
    );
    const ours = scorePolicyLink(
      link('https://www.standaard.be/privacy', 'Privacybeleid'),
      'www.standaard.be',
    );

    assert.ok(ours > theirs);
    assert.ok(theirs < 4, 'another company’s policy must not clear the bar');
  });
});

describe('choosing where to look', () => {
  const profile = (links, url = 'https://www.example.fr/') => ({ url, policyLinks: links });

  it('takes the banner’s own policy control first', () => {
    const banner = { controls: { policy: { control: { href: 'https://www.example.fr/vie-privee' } } } };
    const chosen = policyUrlFrom(banner, profile([link('https://www.example.fr/cookies')]));

    assert.deepEqual(chosen, { url: 'https://www.example.fr/vie-privee', via: 'banner' });
  });

  it('ranks the page’s links when the banner offers none', () => {
    const chosen = policyUrlFrom(
      { controls: {} },
      profile([
        link('https://www.example.fr/2026/08/22/privacy-scandal', 'A privacy scandal'),
        link('https://www.example.fr/politique-de-confidentialite', 'Confidentialité'),
      ]),
    );

    assert.equal(chosen.url, 'https://www.example.fr/politique-de-confidentialite');
    assert.equal(chosen.via, 'page-link');
  });

  it('says it found nothing rather than following a bad candidate', () => {
    const chosen = policyUrlFrom(
      { controls: {} },
      profile([link('https://www.example.fr/2026/08/22/privacy-scandal', 'A privacy scandal')]),
    );

    assert.deepEqual(chosen, { url: null, via: 'none' });
  });
});

describe('following a hub page', () => {
  const hub = {
    url: 'https://www.theguardian.com/info/privacy',
    links: [
      link('https://www.theguardian.com/info/privacy#maincontent', 'Skip to main content'),
      link('https://www.theguardian.com/info/privacy', 'Privacy policy'),
      link('https://www.theguardian.com/info/video/2019/sep/12/the-guardians-privacy-policy-video'),
      link('https://www.theguardian.com/help/privacy-policy'),
      link('https://www.theguardian.com/info/cookies'),
    ],
  };

  it('goes to the policy, not to an anchor on the page it is already on', () => {
    assert.equal(nextPolicyHop(hub), 'https://www.theguardian.com/help/privacy-policy');
  });

  it('goes nowhere when nothing scores well enough', () => {
    assert.equal(
      nextPolicyHop({ url: 'https://www.example.fr/privacy', links: [link('https://www.example.fr/about', 'About us')] }),
      null,
    );
  });
});

describe('reading back what the page returned', () => {
  it('survives anything that is not a policy extraction', () => {
    for (const raw of [null, undefined, 42, '[]', '{', 'null']) {
      const read = parsePolicyText(raw);
      assert.equal(read.text, '');
      assert.deepEqual(read.links, []);
    }
  });

  it('keeps only what it can type', () => {
    const read = parsePolicyText(
      JSON.stringify({
        url: 'https://example.fr/privacy',
        title: 'Privacy',
        text: 'Some policy text',
        truncated: 'yes please',
        links: [{ href: 'https://example.fr/x', text: 'x' }, { text: 'no href' }, 'nonsense'],
      }),
    );

    assert.equal(read.truncated, false, 'a non-boolean must not become true');
    assert.equal(read.links.length, 1);
    assert.equal(read.from, 'none');
  });
});
