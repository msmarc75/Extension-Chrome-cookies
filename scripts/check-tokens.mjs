#!/usr/bin/env node
/*
 * CLI for the token-discipline rules in lib/token-lint.mjs.
 * Exits non-zero and prints every offending line.
 */

import { globSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintSource } from './lib/token-lint.mjs';
import { TOKENS_PATH } from './lib/tokens.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const files = globSync('extension/**/*.{css,html}', { cwd: ROOT })
  .map((file) => `${ROOT}${file}`)
  .filter((file) => file !== TOKENS_PATH)
  .sort();

if (files.length === 0) {
  process.stderr.write('check-tokens: no stylesheets or documents found to check\n');
  process.exit(1);
}

const violations = files.flatMap((file) =>
  lintSource(relative(ROOT, file), readFileSync(file, 'utf8')),
);

if (violations.length > 0) {
  for (const v of violations) {
    process.stderr.write(`${v.file}:${v.line}  ${v.rule}\n    ${v.text}\n`);
  }
  process.stderr.write(
    `\ncheck-tokens: ${violations.length} violation(s). Add a token to ` +
      'extension/src/ui/tokens.css and reference it with var().\n',
  );
  process.exit(1);
}

process.stdout.write(`check-tokens: ${files.length} file(s) clean\n`);
