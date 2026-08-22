/*
 * Turning a page into something a quote can be checked against.
 *
 * The whole credibility of the policy analysis rests on one operation: given a
 * sentence the model says it found, decide whether the document really contains
 * it. That decision has to survive the differences that carry no meaning — a
 * non-breaking space, a curly apostrophe the model straightened, a line break
 * where the page had one — and it must not survive the difference that does:
 * a sentence the document never said.
 *
 * So there are two texts. The **normalised** text is what gets analysed, hashed
 * and stored: readable, whitespace-collapsed, still the site's own wording. The
 * **folded** text is a comparison key nobody ever reads: lower-cased, with
 * quotes, dashes and spaces reduced to one form each. A quote is looked for in
 * the fold, and what comes back is the corresponding span of the normalised
 * text — so the quote finally reported is the document's own characters, never
 * the model's.
 */

import { createHash } from 'node:crypto';

/** Beyond this, the analysis is of an excerpt, and says so. */
export const ANALYSIS_CEILING = 50_000;

/** A quote shorter than this is not evidence of anything. */
const MIN_QUOTE = 12;

const NORMALISE = [
  [/\r\n?/g, '\n'],
  [/[   ]/g, ' '], // the spaces that are not spaces
  [/[​-‍﻿]/g, ''], // zero-width everything
  [/[‘’‚‛′]/g, "'"],
  [/[“”„‟″]/g, '"'],
  [/[‐-―−]/g, '-'],
  [/…/g, '...'],
  [/[ \t]+/g, ' '],
  [/ ?\n ?/g, '\n'],
  [/\n{3,}/g, '\n\n'],
];

/**
 * The text as it will be analysed, hashed and quoted from.
 * @param {string} input
 */
export function normaliseText(input) {
  let text = String(input ?? '').normalize('NFC');
  for (const [pattern, replacement] of NORMALISE) text = text.replace(pattern, replacement);
  return text.trim();
}

/**
 * The comparison key. Same length as the normalised text, unit for unit, so an
 * index into one is an index into the other — which is what lets a match in the
 * fold be reported as a span of the original.
 *
 * Built a character at a time rather than with `toLowerCase()` on the whole
 * string, because a handful of characters lower-case into two ("İ" is the
 * famous one) and a single one of those anywhere in the document would shift
 * every index after it. A case fold that would change the length is skipped:
 * the worst outcome is one character that fails to match, rather than a quote
 * reported from the wrong place in the page.
 *
 * @param {string} normalised
 */
export function foldText(normalised) {
  let folded = '';
  for (const character of normalised) {
    let mapped = character.toLowerCase();
    if (mapped.length !== character.length) mapped = character;
    if (mapped === '\n' || mapped === '\t') mapped = ' ';
    else if ('’‘`´'.includes(mapped)) mapped = "'";
    else if ('“”'.includes(mapped)) mapped = '"';
    folded += mapped;
  }
  return folded;
}

/** @param {string} text */
export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Cut to the analysis ceiling on a paragraph boundary where there is one
 * nearby, so the model is not handed half a sentence.
 * @param {string} normalised
 * @returns {{text: string, truncated: boolean}}
 */
export function truncateForAnalysis(normalised, ceiling = ANALYSIS_CEILING) {
  if (normalised.length <= ceiling) return { text: normalised, truncated: false };

  const cut = normalised.slice(0, ceiling);
  const boundary = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('. '));
  const at = boundary > ceiling * 0.9 ? boundary : ceiling;
  return { text: cut.slice(0, at).trim(), truncated: true };
}

/**
 * Look for a claimed sentence in the source.
 *
 * The first attempt is the whole quote. A model that has copied faithfully
 * except for a swallowed space or a repaired ligature would fail that, and
 * failing it costs a true finding — so the fallback looks for a long run of the
 * quote's own words, anchored at its start. What it never does is match on a
 * few common words: below `MIN_QUOTE` characters, and below three quarters of
 * the quote's length, nothing is returned.
 *
 * @param {string|null|undefined} quote what the model says the document says
 * @param {string} normalised the document
 * @param {string} folded its comparison key
 * @returns {{verified: boolean, quote: string|null, how: string|null}}
 */
export function verifyQuote(quote, normalised, folded) {
  const claimed = normaliseText(quote ?? '');
  if (claimed.length < MIN_QUOTE) return { verified: false, quote: null, how: null };

  const needle = foldText(claimed);
  const exact = folded.indexOf(needle);
  if (exact !== -1) {
    return { verified: true, quote: normalised.slice(exact, exact + needle.length), how: 'exact' };
  }

  /*
   * Words rather than characters: the differences that survive folding are
   * almost always inside the gaps between words — a stray bullet, a footnote
   * marker, a soft hyphen the page rendered and the model did not.
   */
  const words = needle.split(' ').filter(Boolean);
  const floor = Math.max(4, Math.ceil(words.length * 0.75));
  for (let take = words.length - 1; take >= floor; take -= 1) {
    const prefix = words.slice(0, take).join(' ');
    if (prefix.length < MIN_QUOTE) break;
    const at = folded.indexOf(prefix);
    if (at !== -1) {
      return { verified: true, quote: normalised.slice(at, at + prefix.length), how: 'prefix' };
    }
  }

  return { verified: false, quote: null, how: null };
}
