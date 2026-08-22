/*
 * The rules behind `npm run check:tokens`.
 *
 * Outside extension/src/ui/tokens.css, no stylesheet may carry a literal
 * colour, length, type family, weight or duration, and no document may carry a
 * `style=` attribute or an inline <style> block. The rule is worth a checker
 * rather than a convention: it is the kind of discipline that erodes one "just
 * this once" at a time, and the report is meant to look like one document, not
 * seven.
 */

/* Values that carry no design decision and would only add noise if banned. */
const NEUTRAL_LENGTHS = new Set(['0', '1']);

export const RULES = [
  {
    name: 'literal colour',
    // Hex, rgb()/rgba(), hsl()/hsla() and the handful of bare colour keywords
    // that actually get typed by hand. `transparent` and `currentColor` are
    // structural, not palette choices, so they stay legal.
    pattern:
      /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\s*\(|\b(?:white|black|red|green|blue|orange|grey|gray|silver)\b/gi,
    applies: (file) => file.endsWith('.css'),
  },
  {
    name: 'literal length',
    pattern: /(?<![\w-])-?\d*\.?\d+(?:px|rem|em|pt|ch|vw|vh)\b/g,
    applies: (file) => file.endsWith('.css'),
    allow: (match) => NEUTRAL_LENGTHS.has(match[0]),
  },
  {
    name: 'literal type family',
    pattern: /font-family\s*:\s*([^;}]+)/gi,
    applies: (file) => file.endsWith('.css'),
    allow: (match) => /^var\(/.test(match[1].trim()),
  },
  {
    name: 'literal font weight',
    pattern: /font-weight\s*:\s*([^;}]+)/gi,
    applies: (file) => file.endsWith('.css'),
    allow: (match) => /^(?:var\(|inherit\b)/.test(match[1].trim()),
  },
  {
    name: 'literal duration',
    pattern: /(?<![\w-])-?\d*\.?\d+m?s\b/g,
    applies: (file) => file.endsWith('.css'),
  },
  {
    name: 'inline style attribute',
    pattern: /\sstyle\s*=/gi,
    applies: (file) => file.endsWith('.html'),
  },
  {
    name: 'inline <style> block',
    pattern: /<style\b/gi,
    applies: (file) => file.endsWith('.html'),
  },
];

/** Strip comment text so a hex code quoted in prose is not reported. */
function stripComments(line) {
  return line.replace(/\/\*.*?\*\//g, '').replace(/^\s*\*.*$/, '');
}

/**
 * @param {string} file path, used to pick applicable rules and to label findings
 * @param {string} source file contents
 * @returns {Array<{file: string, line: number, rule: string, text: string}>}
 */
export function lintSource(file, source) {
  const violations = [];
  source.split('\n').forEach((line, index) => {
    const scannable = stripComments(line);
    for (const rule of RULES) {
      if (!rule.applies(file)) continue;
      for (const match of scannable.matchAll(rule.pattern)) {
        if (rule.allow?.(match)) continue;
        violations.push({ file, line: index + 1, rule: rule.name, text: line.trim() });
      }
    }
  });
  return violations;
}
