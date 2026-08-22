/*
 * Category D, over the analyses of two real policies.
 *
 * The fixtures are the ones in tests/fixtures/policies, run through the same
 * pipeline the service runs — so what these rules are judging is a document
 * whose every quote was checked against the page it came from.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { assess } from '../../extension/src/engine/index.js';
import { policyStatesRetention, policyStatesRights } from '../../extension/src/engine/rules/policy-rules.js';
import { analysePolicy } from '../../server/policy-analysis.mjs';

const load = async (slug) => {
  const base = new URL(`../fixtures/policies/${slug}/`, import.meta.url);
  const text = readFileSync(new URL('policy.txt', base), 'utf8');
  const recorded = JSON.parse(readFileSync(new URL('answer.json', base), 'utf8'));
  return analysePolicy({ text, url: `https://fixture.example/${slug}`, ask: async () => recorded });
};

const govUk = await load('gov-uk');
const cnil = await load('cnil');

/* Enough of an audit for the D rules; the rest of the rulebook reads other
   fields and reports not_applicable, which is what it should do. */
const auditWith = (policyAnalysis) => ({
  captureA: {
    profile: 'incognito-fresh',
    window: { navigationCommittedAt: 12 },
    requests: [],
    cookies: [],
    storage: [],
    fingerprinting: [],
    notes: [],
    target: { finalUrl: 'https://fixture.example/' },
  },
  policy: { url: 'https://fixture.example/privacy', text: 'x', error: null },
  policyAnalysis,
});

const finding = (report, id) => report.findings.find((f) => f.id === id);

describe('category D over a real policy', () => {
  it('passes a policy that states what the articles ask for', () => {
    const report = assess(auditWith(govUk));

    assert.equal(finding(report, 'POLICY_IDENTIFIES_CONTROLLER').verdict, 'pass');
    assert.equal(finding(report, 'POLICY_NAMES_RECIPIENTS').verdict, 'pass');
    assert.equal(finding(report, 'POLICY_STATES_RETENTION').verdict, 'pass');
  });

  it('fails the subjects the policy genuinely does not state', () => {
    /* GOV.UK names consent as the basis for analytics, and neither says it can
       be withdrawn nor describes any way of doing so. That is the finding, and
       it is about the document. */
    const rights = finding(assess(auditWith(govUk)), 'POLICY_STATES_RIGHTS');

    assert.equal(rights.verdict, 'fail');
    assert.equal(rights.measured.absent, 2);
    assert.ok(
      rights.evidence.some((e) => /does not state the right to withdraw consent/.test(e.what)),
      JSON.stringify(rights.evidence),
    );
    assert.ok(
      rights.evidence.some((e) => /does not state how to change the cookie choice later/.test(e.what)),
    );
  });

  it('carries the quote under every finding it makes', () => {
    const report = assess(auditWith(govUk));
    const controller = finding(report, 'POLICY_IDENTIFIES_CONTROLLER');

    const stated = controller.evidence.find((e) => /states who the controller is/.test(e.what));
    assert.match(stated.detail, /Government Digital Service/);
  });

  it('does not fail a policy for saying nothing about what may not apply to it', () => {
    /* GOV.UK relies on legitimate interests and says so; a site that does not
       would be silent on the subject, and must not be marked down for it. */
    const withoutLI = {
      ...govUk,
      mentions: govUk.mentions.map((mention) =>
        mention.subject === 'legitimate_interests'
          ? { ...mention, status: 'absent', quote: null, quoteVerified: false }
          : mention,
      ),
    };

    const purposes = finding(assess(auditWith(withoutLI)), 'POLICY_STATES_PURPOSES');
    assert.notEqual(purposes.verdict, 'fail');
  });

  it('warns rather than accuses when a claim could not be verified', () => {
    const unverifiable = {
      ...govUk,
      mentions: govUk.mentions.map((mention) =>
        mention.subject === 'retention'
          ? { ...mention, status: 'unverified', quote: null, quoteVerified: false, note: 'the sentence was not in the policy' }
          : mention,
      ),
    };

    const retention = finding(assess(auditWith(unverifiable)), 'POLICY_STATES_RETENTION');
    assert.equal(retention.verdict, 'warn');
    assert.equal(retention.measured.unverified, 1);
  });

  it('reads a landing page for what it is, not for whose site it is on', () => {
    /* The page reached from cnil.fr is a data-protection landing page, not an
       article 13 notice. A tool that scored it well because of the domain it
       sits on would be measuring reputation. */
    const report = assess(auditWith(cnil));

    assert.equal(finding(report, 'POLICY_STATES_PURPOSES').verdict, 'fail');
    assert.equal(finding(report, 'POLICY_IDENTIFIES_CONTROLLER').verdict, 'warn');
  });
});

describe('category D without an analysis', () => {
  it('does not apply, and says why', () => {
    const audit = auditWith(null);
    audit.policy.error = { code: 'NO_POLICY_LINK', message: 'No link to a policy was found' };

    const report = assess(audit);
    const retention = finding(report, 'POLICY_STATES_RETENTION');

    assert.equal(retention.verdict, 'not_applicable');
    assert.match(retention.because, /No link to a policy was found/);
    assert.ok(report.disclosures.some((line) => /policy was not analysed/.test(line)));
  });

  it('costs the site nothing, and is excluded from the score’s denominator', () => {
    const withPolicy = assess(auditWith(govUk));
    const without = assess(auditWith(null));

    assert.ok(without.notApplicableWeight >= 15);
    assert.ok(without.coverage < withPolicy.coverage);
  });
});

describe('the rules’ own declarations', () => {
  it('cite something, and say what to do about it', () => {
    for (const rule of [policyStatesRetention, policyStatesRights]) {
      assert.ok(rule.legalBasis.length > 0);
      assert.ok(rule.remediation.length > 20);
      assert.equal(rule.category, 'policy');
    }
  });
});
