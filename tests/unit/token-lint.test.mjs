import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { lintSource } from '../../scripts/lib/token-lint.mjs';
import { TOKENS_PATH, readTokens, tokenRgb } from '../../scripts/lib/tokens.mjs';

const rulesFired = (file, source) => new Set(lintSource(file, source).map((v) => v.rule));

describe('token lint', () => {
  it('accepts a stylesheet built entirely from var() references', () => {
    const clean = `.panel {
      color: var(--ca-ink);
      padding: var(--ca-space-5);
      font-family: var(--ca-font-body);
      font-size: var(--ca-size-200);
      font-weight: var(--ca-weight-medium);
      transition: opacity var(--ca-duration-quick) var(--ca-ease-standard);
      width: 100%;
    }`;

    assert.deepEqual(lintSource('popup.css', clean), []);
  });

  it('catches every literal it is meant to catch', () => {
    assert.ok(rulesFired('a.css', '.x { color: #a4243b; }').has('literal colour'));
    assert.ok(rulesFired('a.css', '.x { color: rgb(0 0 0); }').has('literal colour'));
    assert.ok(rulesFired('a.css', '.x { border-color: white; }').has('literal colour'));
    assert.ok(rulesFired('a.css', '.x { padding: 12px; }').has('literal length'));
    assert.ok(rulesFired('a.css', '.x { font-size: 0.875rem; }').has('literal length'));
    assert.ok(rulesFired('a.css', '.x { font-family: Arial; }').has('literal type family'));
    assert.ok(rulesFired('a.css', '.x { font-weight: 600; }').has('literal font weight'));
    assert.ok(rulesFired('a.css', '.x { transition: all 140ms; }').has('literal duration'));
  });

  it('catches inline styling in documents', () => {
    const rules = rulesFired('popup.html', '<div style="color:red"></div><style>a{}</style>');

    assert.ok(rules.has('inline style attribute'));
    assert.ok(rules.has('inline <style> block'));
  });

  it('does not flag CSS literals quoted inside a comment', () => {
    assert.deepEqual(lintSource('a.css', '/* was #a4243b at 12px before tokens */'), []);
  });

  it('does not apply stylesheet rules to documents, or the reverse', () => {
    assert.deepEqual(lintSource('a.html', '.x { color: #ffffff; }'), []);
    assert.deepEqual(lintSource('a.css', '.x { background: var(--ca-paper); }'), []);
  });

  it('reports the line number so the finding is actionable', () => {
    const [violation] = lintSource('a.css', '.x {\n  color: #123456;\n}');

    assert.equal(violation.line, 2);
    assert.equal(violation.file, 'a.css');
  });
});

describe('tokens.css', () => {
  const tokens = readTokens();

  it('parses into a non-trivial token table', () => {
    assert.ok(tokens.size > 40, `expected a full token set, found ${tokens.size}`);
  });

  it('defines every token the popup and the icon generator reference', () => {
    const referenced = new Set();
    for (const file of [
      new URL('../../extension/src/ui/popup/popup.css', import.meta.url),
      new URL('../../scripts/gen-icons.mjs', import.meta.url),
    ]) {
      for (const [, name] of readFileSync(file, 'utf8').matchAll(/(--ca-[a-z0-9-]+)/g)) {
        referenced.add(name);
      }
    }

    assert.ok(referenced.size > 0, 'found no token references to check');
    const missing = [...referenced].filter((name) => !tokens.has(name));
    assert.deepEqual(missing, [], `undefined token(s): ${missing.join(', ')}`);
  });

  it('exposes the verdict palette as hex colours the build can rasterise', () => {
    for (const name of ['--ca-ink', '--ca-paper', '--ca-breach', '--ca-caution', '--ca-clear']) {
      const [r, g, b] = tokenRgb(tokens, name);
      assert.ok([r, g, b].every((c) => Number.isInteger(c) && c >= 0 && c <= 255));
    }
    assert.throws(() => tokenRgb(tokens, '--ca-does-not-exist'), /Unknown token/);
    assert.throws(() => tokenRgb(tokens, '--ca-space-5'), /not a 6-digit hex/);
  });

  it('is the only stylesheet allowed to hold literals', () => {
    const violations = lintSource('tokens.css', readFileSync(TOKENS_PATH, 'utf8'));

    // Sanity check on the checker itself: if tokens.css ever stopped holding
    // literals, the exemption would be hiding nothing and the rule would be
    // vacuous everywhere else too.
    assert.ok(violations.length > 0);
  });
});
