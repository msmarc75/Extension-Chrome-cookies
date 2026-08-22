import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  hostOf,
  normaliseCookieDomain,
  partyOf,
  registrableDomain,
} from '../../extension/src/shared/hosts.js';

describe('hostOf', () => {
  it('lowercases the host and ignores the rest of the URL', () => {
    assert.equal(hostOf('https://WWW.Lemonde.FR/economie?x=1'), 'www.lemonde.fr');
  });

  it('returns null for anything that is not a URL with a host', () => {
    assert.equal(hostOf('about:blank'), null);
    assert.equal(hostOf('not a url'), null);
    assert.equal(hostOf(''), null);
  });
});

describe('registrableDomain', () => {
  it('drops subdomains', () => {
    assert.equal(registrableDomain('www.lemonde.fr'), 'lemonde.fr');
    assert.equal(registrableDomain('a.b.c.example.com'), 'example.com');
  });

  it('keeps three labels under a known multi-label suffix', () => {
    assert.equal(registrableDomain('ads.bbc.co.uk'), 'bbc.co.uk');
    assert.equal(registrableDomain('shop.com.br'), 'shop.com.br');
    assert.equal(registrableDomain('club.asso.fr'), 'club.asso.fr');
  });

  it('leaves short hosts and addresses alone', () => {
    assert.equal(registrableDomain('example.com'), 'example.com');
    assert.equal(registrableDomain('localhost'), 'localhost');
    assert.equal(registrableDomain('127.0.0.1'), '127.0.0.1');
    assert.equal(registrableDomain(null), null);
  });
});

describe('partyOf', () => {
  it('counts subdomains of the audited site as the site itself', () => {
    assert.equal(partyOf('cdn.lemonde.fr', 'www.lemonde.fr'), 'first');
    assert.equal(partyOf('lemonde.fr', 'www.lemonde.fr'), 'first');
  });

  it('counts anyone else as a third party', () => {
    assert.equal(partyOf('www.google-analytics.com', 'www.lemonde.fr'), 'third');
    assert.equal(partyOf('lemonde.fr.evil.com', 'www.lemonde.fr'), 'third');
  });

  it('says unknown rather than guessing when a host is missing', () => {
    assert.equal(partyOf(null, 'www.lemonde.fr'), 'unknown');
    assert.equal(partyOf('www.lemonde.fr', null), 'unknown');
  });
});

describe('normaliseCookieDomain', () => {
  it('drops the leading dot and lowercases', () => {
    assert.equal(normaliseCookieDomain('.DoubleClick.net'), 'doubleclick.net');
    assert.equal(normaliseCookieDomain('example.fr'), 'example.fr');
  });

  it('returns null for an absent domain', () => {
    assert.equal(normaliseCookieDomain(''), null);
    assert.equal(normaliseCookieDomain(undefined), null);
  });
});
