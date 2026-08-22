/*
 * In-page instrumentation for writes the protocol will not report.
 *
 * `chrome.debugger` refuses the `DOMStorage` domain outright — extensions get
 * `'DOMStorage.enable' wasn't found` — and `Storage.getUsageAndQuota` does not
 * account for localStorage at all. Without something else, capture A would be
 * blind to storage, and a cookie written from script would only ever appear
 * undated, found in the jar at the end with no idea when it arrived.
 *
 * So a small script is installed before navigation, through
 * `Page.addScriptToEvaluateOnNewDocument`, wrapping `Storage.prototype.setItem`
 * and the `document.cookie` setter to record what was written and when. It is
 * read back once, after the observation window has closed.
 *
 * This is not an interaction with the page. It dispatches no event and clicks
 * nothing; a consent platform has nothing here to mistake for agreement.
 *
 * Two rules govern the source below. It must never throw into the page — every
 * hook is wrapped, and every hook calls through to the original, so a site that
 * breaks under audit would be a defect in this file. And it must stay
 * self-contained: it is injected as text, with no access to anything here.
 */

const MARK_GLOBAL = '__consentAudit';

export const INSTRUMENT_SOURCE = `(() => {
  try {
    if (globalThis.${MARK_GLOBAL}) return;

    const marks = [];
    Object.defineProperty(globalThis, '${MARK_GLOBAL}', {
      value: { marks },
      enumerable: false,
      configurable: true,
    });

    const now = () => performance.timeOrigin + performance.now();
    const sizeOf = (value) => {
      try { return new TextEncoder().encode(String(value)).length; }
      catch (_) { return String(value).length; }
    };

    const storagePrototype = Object.getPrototypeOf(localStorage);
    const setItem = storagePrototype.setItem;
    storagePrototype.setItem = function (key, value) {
      try {
        let area = 'localStorage';
        try { if (this === sessionStorage) area = 'sessionStorage'; } catch (_) {}
        marks.push({ kind: 'storage', area, key: String(key), size: sizeOf(value), at: now() });
      } catch (_) {}
      return setItem.call(this, key, value);
    };

    const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    if (cookie && cookie.get && cookie.set) {
      Object.defineProperty(Document.prototype, 'cookie', {
        configurable: true,
        enumerable: cookie.enumerable,
        get() { return cookie.get.call(this); },
        set(value) {
          try { marks.push({ kind: 'cookie', header: String(value), at: now() }); } catch (_) {}
          cookie.set.call(this, value);
        },
      });
    }
  } catch (_) {
    /* An audited page must not break because it is being audited. */
  }
})();`;

/*
 * Read back the marks, plus an inventory of what the two storage areas hold.
 * The inventory is the safety net: `localStorage.foo = 1` sets a named property
 * without going through `Storage.prototype.setItem`, so it leaves no mark.
 */
export const COLLECT_EXPRESSION = `(() => {
  const readArea = (area) => {
    try {
      const entries = [];
      for (let index = 0; index < area.length; index += 1) {
        const key = area.key(index);
        entries.push([key, String(area.getItem(key) ?? '').length]);
      }
      return entries;
    } catch (_) {
      return [];
    }
  };
  const state = globalThis.${MARK_GLOBAL};
  return JSON.stringify({
    marks: state ? state.marks : [],
    inventory: { localStorage: readArea(localStorage), sessionStorage: readArea(sessionStorage) },
    installed: Boolean(state),
  });
})()`;

const EMPTY = Object.freeze({
  marks: [],
  inventory: { localStorage: [], sessionStorage: [] },
  installed: false,
});

/**
 * Parse what `COLLECT_EXPRESSION` returned, discarding anything malformed.
 * A page can reach this global, so nothing here may be trusted on its shape.
 *
 * @param {unknown} raw the JSON string returned by Runtime.evaluate
 */
export function parsePageMarks(raw) {
  if (typeof raw !== 'string') return EMPTY;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (typeof parsed !== 'object' || parsed === null) return EMPTY;

  const marks = Array.isArray(parsed.marks)
    ? parsed.marks.filter(
        (mark) =>
          typeof mark === 'object' &&
          mark !== null &&
          typeof mark.at === 'number' &&
          (mark.kind === 'storage' || mark.kind === 'cookie'),
      )
    : [];

  const readInventory = (entries) =>
    Array.isArray(entries)
      ? entries
          .filter((entry) => Array.isArray(entry) && typeof entry[0] === 'string')
          .map(([key, size]) => [key, Number.isFinite(size) ? size : 0])
      : [];

  return {
    marks,
    inventory: {
      localStorage: readInventory(parsed.inventory?.localStorage),
      sessionStorage: readInventory(parsed.inventory?.sessionStorage),
    },
    installed: parsed.installed === true,
  };
}
