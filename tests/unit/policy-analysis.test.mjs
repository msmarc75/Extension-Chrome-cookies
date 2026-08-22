/*
 * The pipeline, driven from recorded answers.
 *
 * The model call is injected, so everything below is deterministic: what the
 * server does with a faithful answer, and — the tests that matter — what it
 * does with an answer that is confident and wrong. A summariser passes the
 * first set. Only a tool that checks its source passes the second.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  SUBJECT_IDS,
  analysePolicy,
  assemble,
  cacheKey,
} from '../../server/policy-analysis.mjs';
import { foldText, normaliseText, sha256, truncateForAnalysis, verifyQuote } from '../../server/text.mjs';
import { validate } from '../../shared/schema/validate.mjs';

const SCHEMA = JSON.parse(
  readFileSync(new URL('../../shared/schema/policy-analysis.schema.json', import.meta.url), 'utf8'),
);

const POLICY = `Privacy policy

Éditions Fixture SAS, 12 rue de la Paix, 75002 Paris, is the controller for the personal data processed through this website. Our data protection officer can be reached at dpo@fixture.example.

We process your browsing data, your IP address and the identifiers stored on your device in order to deliver personalised advertising, to measure our audience and to secure the service against fraud.

Advertising is based on your consent, which you give through the banner shown on your first visit. Fraud prevention rests on our legitimate interest in keeping the service available, which is our interest in preventing automated abuse of our infrastructure.

Your data is shared with our advertising partners, listed in the cookie table below, and with our hosting provider. Some of these partners are established in the United States, and those transfers are covered by standard contractual clauses approved by the European Commission.

Browsing data is kept for thirteen months from collection, after which it is deleted.

You have the right to access, rectify and erase your data, to restrict or object to its processing, and to receive it in a portable form. You may withdraw your consent at any time, as easily as you gave it, through the "Manage my cookies" link in the footer of every page. You may also lodge a complaint with the CNIL.

We do not carry out automated decision-making producing legal effects.

The cookies we set, their purpose and their lifetime are listed in the table below.`;

const NORMALISED = normaliseText(POLICY);
const FOLDED = foldText(NORMALISED);

/** A faithful answer: every quote copied from the document above. */
const faithful = () => ({
  model: 'claude-opus-5',
  mentions: [
    { subject: 'identity_controller', status: 'present', quote: 'Éditions Fixture SAS, 12 rue de la Paix, 75002 Paris, is the controller for the personal data processed through this website.', note: null },
    { subject: 'contact_dpo', status: 'present', quote: 'Our data protection officer can be reached at dpo@fixture.example.', note: null },
    { subject: 'data_categories', status: 'present', quote: 'We process your browsing data, your IP address and the identifiers stored on your device', note: null },
    { subject: 'purposes', status: 'present', quote: 'to deliver personalised advertising, to measure our audience and to secure the service against fraud', note: null },
    { subject: 'legal_bases', status: 'present', quote: 'Advertising is based on your consent, which you give through the banner shown on your first visit.', note: null },
    { subject: 'legitimate_interests', status: 'present', quote: 'which is our interest in preventing automated abuse of our infrastructure', note: null },
    { subject: 'recipients', status: 'present', quote: 'Your data is shared with our advertising partners, listed in the cookie table below, and with our hosting provider.', note: null },
    { subject: 'third_country_transfers', status: 'present', quote: 'those transfers are covered by standard contractual clauses approved by the European Commission', note: null },
    { subject: 'retention', status: 'present', quote: 'Browsing data is kept for thirteen months from collection, after which it is deleted.', note: null },
    { subject: 'rights_access_rectify_erase', status: 'present', quote: 'You have the right to access, rectify and erase your data, to restrict or object to its processing', note: null },
    { subject: 'right_withdraw_consent', status: 'present', quote: 'You may withdraw your consent at any time, as easily as you gave it', note: null },
    { subject: 'right_complain_supervisory', status: 'present', quote: 'You may also lodge a complaint with the CNIL.', note: null },
    { subject: 'automated_decision_making', status: 'present', quote: 'We do not carry out automated decision-making producing legal effects.', note: null },
    { subject: 'cookies_described', status: 'present', quote: 'The cookies we set, their purpose and their lifetime are listed in the table below.', note: null },
    { subject: 'consent_withdrawal_mechanism', status: 'present', quote: 'through the "Manage my cookies" link in the footer of every page', note: null },
  ],
});

const analyse = (answer, options = {}) =>
  analysePolicy({ text: POLICY, url: 'https://fixture.example/privacy', ask: async () => answer, ...options });

const by = (analysis, subject) => analysis.mentions.find((m) => m.subject === subject);

describe('the policy pipeline', () => {
  it('issues a document that matches the shared schema', async () => {
    const analysis = await analyse(faithful());
    const { valid, errors } = validate(analysis, SCHEMA);

    assert.deepEqual(errors, []);
    assert.equal(valid, true);
  });

  it('reports every subject, in the fixed order, always', async () => {
    const analysis = await analyse({ model: 'claude-opus-5', mentions: [] });

    assert.deepEqual(analysis.mentions.map((m) => m.subject), SUBJECT_IDS);
    for (const mention of analysis.mentions) {
      assert.equal(mention.status, 'unverified');
      assert.match(mention.note, /returned nothing/);
    }
  });

  it('keeps the quote the document actually contains, not the one it was handed', async () => {
    const answer = faithful();
    /* Same sentence, straightened quotes and a collapsed space — a faithful
       copy by any human standard, and not byte-identical. */
    answer.mentions[10].quote = 'You  may withdraw your consent at any time,  as easily as you gave it';

    const analysis = await analyse(answer);
    const withdrawal = by(analysis, 'right_withdraw_consent');

    assert.equal(withdrawal.status, 'present');
    assert.equal(withdrawal.quoteVerified, true);
    assert.ok(NORMALISED.includes(withdrawal.quote));
  });

  it('does not issue a claim whose sentence the policy does not contain', async () => {
    const answer = faithful();
    answer.mentions[8].quote = 'We retain your personal data for a period of twenty-four months.';

    const analysis = await analyse(answer);
    const retention = by(analysis, 'retention');

    assert.equal(retention.status, 'unverified');
    assert.equal(retention.quote, null);
    assert.equal(retention.quoteVerified, false);
    assert.match(retention.note, /could not be found/);
    assert.ok(analysis.notes.some((note) => note.code === 'UNVERIFIED_QUOTES'));
  });

  it('does not turn an unverifiable claim into an accusation', async () => {
    /* The subject is not reported present — and not reported absent either.
       The tool has not established that the policy is silent; it has
       established that it cannot tell, which is a different finding. */
    const answer = faithful();
    answer.mentions[3].quote = 'We use your data for purposes described elsewhere in this document.';

    const analysis = await analyse(answer);

    assert.equal(by(analysis, 'purposes').status, 'unverified');
    assert.notEqual(by(analysis, 'purposes').status, 'absent');
  });

  it('takes an absence at its word, since it has no quote to check', async () => {
    const answer = faithful();
    answer.mentions[1] = { subject: 'contact_dpo', status: 'absent', quote: null, note: 'No DPO is named.' };

    const analysis = await analyse(answer);
    const dpo = by(analysis, 'contact_dpo');

    assert.equal(dpo.status, 'absent');
    assert.equal(dpo.quote, null);
    assert.equal(dpo.note, 'No DPO is named.');
  });

  it('keeps partial as partial, with its quote', async () => {
    const answer = faithful();
    answer.mentions[8] = {
      subject: 'retention',
      status: 'partial',
      quote: 'Browsing data is kept for thirteen months from collection',
      note: 'Only one category of data is given a period.',
    };

    const analysis = await analyse(answer);
    assert.equal(by(analysis, 'retention').status, 'partial');
    assert.equal(by(analysis, 'retention').quoteVerified, true);
  });

  it('keeps the first entry when a subject comes back twice, and says it did', async () => {
    const answer = faithful();
    answer.mentions.push({
      subject: 'retention',
      status: 'absent',
      quote: null,
      note: 'contradicting itself',
    });

    const analysis = await analyse(answer);
    assert.equal(by(analysis, 'retention').status, 'present');
    assert.ok(analysis.notes.some((note) => note.code === 'DUPLICATE_SUBJECTS'));
  });

  it('ignores a subject the checklist does not have', async () => {
    const answer = faithful();
    answer.mentions.push({ subject: 'invented_subject', status: 'present', quote: 'x', note: null });

    const analysis = await analyse(answer);
    assert.equal(analysis.mentions.length, SUBJECT_IDS.length);
  });

  it('refuses a document too short to be a policy', async () => {
    await assert.rejects(
      () => analysePolicy({ text: 'Cookies. We use them.', ask: async () => faithful() }),
      /POLICY_TOO_SHORT|not a policy/,
    );
  });

  it('records the hash of what it analysed, not of what it was sent', async () => {
    const analysis = await analyse(faithful());
    assert.equal(analysis.source.sha256, sha256(NORMALISED));
    assert.equal(analysis.source.characters, NORMALISED.length);
    assert.equal(analysis.source.truncated, false);
  });

  it('says so when the policy was longer than the ceiling', () => {
    const long = `${NORMALISED}\n\n${'Filler sentence for length. '.repeat(3_000)}`;
    const { text, truncated } = truncateForAnalysis(long, 5_000);

    assert.equal(truncated, true);
    assert.ok(text.length <= 5_000);

    const analysis = assemble({
      answer: faithful(),
      normalised: long,
      folded: foldText(long),
      truncated,
      url: null,
    });
    assert.ok(analysis.notes.some((note) => note.code === 'POLICY_TRUNCATED'));
  });
});

describe('the cache key', () => {
  it('changes with the text, the prompt and the model', () => {
    const a = cacheKey({ sha256: sha256('one'), model: 'claude-opus-5' });
    const b = cacheKey({ sha256: sha256('two'), model: 'claude-opus-5' });
    const c = cacheKey({ sha256: sha256('one'), model: 'claude-sonnet-5' });

    assert.notEqual(a, b);
    assert.notEqual(a, c);
    assert.equal(a, cacheKey({ sha256: sha256('one'), model: 'claude-opus-5' }));
    assert.match(a, /^[a-f0-9]{64}\.policy-v1\.claude-opus-5$/);
  });
});

describe('quote verification', () => {
  const source = normaliseText('We keep your data for thirteen months. We do not sell it.');
  const fold = foldText(source);

  it('accepts a sentence copied exactly', () => {
    assert.equal(verifyQuote('We keep your data for thirteen months.', source, fold).verified, true);
  });

  it('accepts one whose punctuation was straightened', () => {
    const curly = normaliseText('You may not “opt out” of security cookies.');
    const analysis = verifyQuote('You may not "opt out" of security cookies.', curly, foldText(curly));
    assert.equal(analysis.verified, true);
  });

  it('accepts a faithful quote with a trailing artefact, and reports only the part it found', () => {
    /* A footnote marker, a "read more", a bullet the page rendered into the
       sentence: the copy is faithful and its tail is not in the document. */
    const found = verifyQuote('We keep your data for thirteen months. [1]', source, fold);

    assert.equal(found.verified, true);
    assert.equal(found.how, 'prefix');
    assert.ok(source.includes(found.quote));
    assert.ok(!found.quote.includes('[1]'));
  });

  it('will not stretch a prefix match past a quarter of the sentence', () => {
    /* Half a sentence from the document and half from nowhere is not evidence
       that the document says the whole thing. */
    const found = verifyQuote('We keep your data for six years, and we sell it on', source, fold);
    assert.equal(found.verified, false);
  });

  it('rejects a sentence that is not there', () => {
    assert.equal(verifyQuote('We keep your data for six months.', source, fold).verified, false);
  });

  it('rejects a scrap too short to mean anything', () => {
    assert.equal(verifyQuote('data', source, fold).verified, false);
    assert.equal(verifyQuote('We keep', source, fold).verified, false);
  });

  it('never lets a fold shift an index', () => {
    /* "İ" lower-cases into two characters. One of them anywhere in a document
       would move every quote after it if the fold were done naively. */
    const turkish = normaliseText('İstanbul residents may object at any time to this processing.');
    const folded = foldText(turkish);

    assert.equal(folded.length, turkish.length);
    const found = verifyQuote('residents may object at any time to this processing', turkish, folded);
    assert.equal(found.verified, true);
    assert.ok(turkish.includes(found.quote));
  });
});
