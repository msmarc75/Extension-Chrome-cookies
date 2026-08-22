/*
 * The report, as data.
 *
 * Everything a reader ends up quoting is computed here rather than in the view:
 * the moment of the first deposit, the order things arrived in, the rows of the
 * exported file. A consultant will paste these numbers into a document with
 * their name on it, so they are arithmetic that can be tested without a
 * browser, not something assembled while rendering.
 *
 * The timeline is the product's signature element. Its rule is that **it shows
 * what was observed and nothing else**: an undated cookie is not placed at zero
 * to make the picture tidy, it is listed apart, said to be undated, and counted.
 */

/**
 * Milliseconds since the observation window opened, as a figure a report can
 * quote. It lives here rather than beside the popup because the popup, the
 * report and the exported file must all print the same instant the same way.
 */
export function formatOffset(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 'undated';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** The lanes of the timeline, in the order they are drawn. */
export const LANES = Object.freeze([
  {
    key: 'request',
    label: 'Requests to third parties',
    hint: 'Each call the page made to another party before anything was answered.',
  },
  {
    key: 'cookie',
    label: 'Cookies written',
    hint: 'Written by a response header or by script, with the moment it happened.',
  },
  {
    key: 'storage',
    label: 'Storage writes',
    hint: 'localStorage and sessionStorage keys written before the choice.',
  },
  {
    key: 'fingerprint',
    label: 'Identification surface',
    hint: 'Canvas, WebGL and audio APIs reached before the choice.',
  },
]);

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Turn a capture into the events the timeline draws.
 *
 * Only third-party requests are drawn: the page asking for itself is the visit,
 * not a deposit, and a lane holding two hundred first-party assets would bury
 * the four calls that matter.
 *
 * @param {object} capture matching shared/schema/capture.schema.json
 * @param {(host: string) => {category: string|null, matched: string|null}} [classify]
 * @returns {{events: Array<object>, undated: Array<object>, windowMs: number, firstMs: number|null, lastMs: number|null}}
 */
export function buildTimeline(capture, classify = null) {
  const events = [];
  const undated = [];

  const place = (event) => (finite(event.tMs) ? events : undated).push(event);

  for (const request of capture?.requests ?? []) {
    if (request.party !== 'third') continue;
    const classification = classify ? classify(request.host ?? '') : null;
    place({
      lane: 'request',
      tMs: request.tMs,
      label: request.host ?? request.url,
      detail: request.url,
      category: classification?.category ?? null,
      owner: classification?.owner ?? null,
      party: 'third',
    });
  }

  for (const cookie of capture?.cookies ?? []) {
    place({
      lane: 'cookie',
      tMs: cookie.tMs,
      label: cookie.name,
      detail: `${cookie.host}${cookie.source ? ` · ${cookie.source}` : ''}`,
      category: null,
      party: cookie.party ?? null,
    });
  }

  for (const write of capture?.storage ?? []) {
    place({
      lane: 'storage',
      tMs: write.tMs,
      label: write.key,
      detail: `${write.type}${write.source ? ` · ${write.source}` : ''}`,
      category: null,
      party: null,
    });
  }

  for (const use of capture?.fingerprinting ?? []) {
    place({
      lane: 'fingerprint',
      tMs: use.tMs,
      label: use.api,
      detail: 'reached before any choice was offered',
      category: null,
      party: null,
    });
  }

  events.sort((a, b) => a.tMs - b.tMs || a.lane.localeCompare(b.lane));

  const times = events.map((event) => event.tMs);
  return {
    events,
    undated,
    /* The axis is the observation window, not the last event: a page whose
       last deposit lands at 300 ms has a short bar on a five-second axis, and
       that shape is the finding. */
    windowMs: Math.max(1, capture?.window?.durationMs ?? 5000),
    firstMs: times.length > 0 ? times[0] : null,
    lastMs: times.length > 0 ? times[times.length - 1] : null,
  };
}

/**
 * Where to draw the ticks.
 *
 * Round seconds, and never so many that the axis becomes a ruler: five
 * intervals is what a printed page can label without them touching.
 */
export function axisTicks(windowMs) {
  const seconds = windowMs / 1000;
  const step = seconds <= 2 ? 0.5 : seconds <= 6 ? 1 : Math.ceil(seconds / 5);
  const ticks = [];
  for (let at = 0; at <= seconds + 1e-9; at += step) {
    ticks.push({ tMs: at * 1000, label: at >= 1 || at === 0 ? `${at}s` : `${at * 1000}ms` });
  }
  return ticks;
}

/** Position of an event along the axis, as a percentage. */
export const positionOf = (tMs, windowMs) =>
  Math.min(100, Math.max(0, (tMs / Math.max(1, windowMs)) * 100));

/*
 * CSV, to the letter of RFC 4180: fields containing a comma, a quote or a line
 * break are quoted and their quotes doubled. Spreadsheet software is
 * unforgiving, and a report that opens with its columns shifted is a report
 * that gets sent back.
 */
const cell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (rows) => rows.map((row) => row.map(cell).join(',')).join('\r\n');

/**
 * The findings register, as a client annex would want it: one row per rule,
 * with what it found, what it rests on, and what to do about it.
 */
export function findingsCsv(report, context = {}) {
  const rows = [
    [
      'Site',
      'Audited at',
      'Profile',
      'Rule',
      'Title',
      'Category',
      'Severity',
      'Weight',
      'Verdict',
      'Evidence',
      'Legal basis',
      'Remediation',
      'Note',
    ],
  ];

  for (const finding of report?.findings ?? []) {
    rows.push([
      context.site ?? '',
      context.auditedAt ?? '',
      context.profile ?? '',
      finding.id,
      finding.title,
      finding.category,
      finding.severity,
      finding.weight,
      finding.verdict,
      (finding.evidence ?? [])
        .map((e) => [e.what, e.detail].filter(Boolean).join(' — '))
        .join('\n'),
      (finding.legalBasis ?? []).map((basis) => `${basis.source} ${basis.ref}`).join('; '),
      finding.remediation,
      finding.temperedBecause ?? finding.because ?? '',
    ]);
  }

  return toCsv(rows);
}

/** The deposit register: every dated observation, in the order it happened. */
export function depositsCsv(timeline, context = {}) {
  const rows = [['Site', 'Audited at', 'At (ms)', 'At', 'Kind', 'What', 'Detail', 'Category', 'Party']];

  for (const event of timeline.events) {
    rows.push([
      context.site ?? '',
      context.auditedAt ?? '',
      Math.round(event.tMs),
      formatOffset(event.tMs),
      event.lane,
      event.label,
      event.detail,
      event.category ?? '',
      event.party ?? '',
    ]);
  }
  for (const event of timeline.undated) {
    rows.push([
      context.site ?? '',
      context.auditedAt ?? '',
      '',
      'undated',
      event.lane,
      event.label,
      event.detail,
      event.category ?? '',
      event.party ?? '',
    ]);
  }

  return toCsv(rows);
}

/**
 * A filename a consultant can drop into a folder of client work without
 * renaming it: the site, the date, and what the file is.
 */
export function exportFilename(site, at, kind, extension) {
  const host = String(site ?? 'audit')
    .replace(/^https?:\/\//, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const date = new Date(at ?? Date.now()).toISOString().slice(0, 10);
  return `consent-audit_${host}_${date}_${kind}.${extension}`;
}
