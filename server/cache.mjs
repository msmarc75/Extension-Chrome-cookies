/*
 * The analysis cache.
 *
 * Keyed on the SHA-256 of the normalised text, the prompt version and the
 * model. Those three decide the answer, so nothing else belongs in the key —
 * and a policy that changed a word is a different document with a different
 * hash, which is why there is no expiry: an entry cannot go stale, it can only
 * stop being asked for.
 *
 * It matters commercially as well as technically. Large publishers share
 * policy templates, and an agency auditing a portfolio will hit the same text
 * repeatedly; the cache is what keeps the per-analysis cost at roughly half the
 * uncached figure recorded in docs/roadmap.md.
 */

import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Keys are built here, so anything else in a filename is a bug worth catching. */
const SAFE_KEY = /^[a-f0-9]{64}\.[\w.-]+\.[\w.-]+$/;

export class AnalysisCache {
  /** @param {string} directory */
  constructor(directory) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true });
  }

  #path(key) {
    if (!SAFE_KEY.test(key)) throw new Error(`Refusing to use "${key}" as a cache key`);
    return join(this.directory, `${key}.json`);
  }

  /** @returns {object|null} */
  get(key) {
    /* Outside the try on purpose: a key this class did not build is a
       programming error, and swallowing it here would hide it behind a cache
       that quietly never hits. */
    const path = this.#path(key);
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      /* A missing entry and an unreadable one are the same thing to a caller:
         it has to produce the answer either way. */
      return null;
    }
  }

  /** Written to a temporary name and renamed, so a reader never sees half a file. */
  set(key, value) {
    const path = this.#path(key);
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    renameSync(temporary, path);
    return value;
  }

  /** @returns {{entries: number, bytes: number}} */
  stats() {
    let entries = 0;
    let bytes = 0;
    for (const name of readdirSync(this.directory)) {
      if (!name.endsWith('.json')) continue;
      entries += 1;
      bytes += statSync(join(this.directory, name)).size;
    }
    return { entries, bytes };
  }
}
