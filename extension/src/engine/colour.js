/*
 * Contrast, measured.
 *
 * `REFUSE_EQUAL_PROMINENCE` is the rule most likely to be argued with, so it
 * cannot rest on an impression that one button "looks louder". It rests on the
 * WCAG 2.x relative-luminance formula, applied to the colours the browser
 * actually resolved, and the report prints both numbers side by side. That
 * figure is what ends up in the consultant's deliverable.
 */

/**
 * Parse a CSS colour as the browser reports it. `getComputedStyle` always
 * returns `rgb()` or `rgba()`, so this deliberately understands nothing else —
 * a parser that guessed at named colours would be guessing about input that
 * never arrives.
 *
 * @param {string|null} value
 * @returns {{r: number, g: number, b: number, a: number}|null}
 */
export function parseColour(value) {
  if (typeof value !== 'string') return null;
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.%]+))?\s*\)$/i.exec(
    value.trim(),
  );
  if (!match) return null;

  const [, r, g, b, alpha] = match;
  const a = alpha === undefined ? 1 : alpha.endsWith('%')
    ? Number.parseFloat(alpha) / 100
    : Number.parseFloat(alpha);

  const channel = (raw) => Math.min(255, Math.max(0, Number.parseFloat(raw)));
  return {
    r: channel(r),
    g: channel(g),
    b: channel(b),
    a: Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 1,
  };
}

/** WCAG relative luminance. */
export function relativeLuminance({ r, g, b }) {
  const linear = (channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * Contrast ratio between a foreground and a background, 1 to 21.
 * Returns null when either colour could not be read — the report says
 * "not measured" rather than inventing a figure.
 *
 * @param {string|null} foreground CSS colour
 * @param {string|null} background CSS colour
 */
export function contrastRatio(foreground, background) {
  const fg = parseColour(foreground);
  const bg = parseColour(background);
  if (!fg || !bg) return null;

  /* A translucent foreground is composited over its background first. */
  const composited =
    fg.a >= 1
      ? fg
      : {
          r: fg.r * fg.a + bg.r * (1 - fg.a),
          g: fg.g * fg.a + bg.g * (1 - fg.a),
          b: fg.b * fg.a + bg.b * (1 - fg.a),
        };

  const l1 = relativeLuminance(composited);
  const l2 = relativeLuminance(bg);
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

/**
 * How loudly a control is painted, as the few numbers a comparison needs.
 * @param {object} control a control from a page profile
 */
export function prominenceOf(control) {
  const { rect, styles } = control;
  const area = Math.max(0, rect.width) * Math.max(0, rect.height);
  return {
    area,
    width: rect.width,
    height: rect.height,
    fontSize: styles?.fontSize ?? null,
    fontWeight: normaliseWeight(styles?.fontWeight),
    contrast: contrastRatio(styles?.color ?? null, styles?.backgroundColor ?? null),
    /* A button with no background of its own reads as a link, not a button. */
    painted: Boolean(
      styles?.ownBackgroundColor &&
        !/^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$/.test(styles.ownBackgroundColor),
    ),
  };
}

function normaliseWeight(weight) {
  if (weight === null || weight === undefined) return null;
  const named = { normal: 400, bold: 700, lighter: 300, bolder: 700 };
  if (typeof weight === 'string' && weight in named) return named[weight];
  const parsed = Number.parseInt(weight, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
