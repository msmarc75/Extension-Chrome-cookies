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

    /*
     * Fingerprinting surface. Reading pixels back off a canvas, asking WebGL
     * which GPU is installed, or spinning up an audio context are the classic
     * ways to build an identifier without storing anything — which is exactly
     * why they matter before consent, and exactly why they leave no cookie to
     * find afterwards.
     *
     * Each of these has honest uses too: charts read canvases, maps use WebGL.
     * The instrument only records that the call happened and when; deciding
     * what it means is the rule engine's job, and it treats a single call as a
     * question rather than a finding.
     */
    const mark = (api) => { try { marks.push({ kind: 'fingerprint', api, at: now() }); } catch (_) {} };

    /*
     * Named, never referenced directly: a missing global throws on the way in
     * and would abort every hook after it — including the cookie hook, which is
     * the one that matters most.
     */
    const wrap = (globalName, name, api) => {
      try {
        const holder = globalThis[globalName];
        const object = holder && holder.prototype;
        if (!object) return;
        const original = object[name];
        if (typeof original !== 'function') return;
        object[name] = function (...args) {
          mark(api);
          return original.apply(this, args);
        };
      } catch (_) {}
    };

    wrap('HTMLCanvasElement', 'toDataURL', 'canvas.toDataURL');
    wrap('HTMLCanvasElement', 'toBlob', 'canvas.toBlob');
    wrap('CanvasRenderingContext2D', 'getImageData', 'canvas.getImageData');
    wrap('OffscreenCanvas', 'convertToBlob', 'canvas.convertToBlob');

    /* Only the two parameters that name the actual GPU are worth recording. */
    for (const context of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
      try {
        const proto = globalThis[context] && globalThis[context].prototype;
        if (!proto || typeof proto.getParameter !== 'function') continue;
        const original = proto.getParameter;
        proto.getParameter = function (parameter) {
          if (parameter === 0x9245 || parameter === 0x9246) mark('webgl.unmaskedRenderer');
          return original.call(this, parameter);
        };
      } catch (_) {}
    }

    for (const name of ['AudioContext', 'OfflineAudioContext', 'webkitOfflineAudioContext']) {
      try {
        const Original = globalThis[name];
        if (typeof Original !== 'function') continue;
        const Wrapped = function (...args) { mark('audio.' + name); return new Original(...args); };
        Wrapped.prototype = Original.prototype;
        globalThis[name] = Wrapped;
      } catch (_) {}
    }

    try {
      const navigatorPrototype = globalThis.Navigator && globalThis.Navigator.prototype;
      const plugins =
        navigatorPrototype && Object.getOwnPropertyDescriptor(navigatorPrototype, 'plugins');
      if (plugins && plugins.get) {
        Object.defineProperty(navigatorPrototype, 'plugins', {
          configurable: true,
          enumerable: plugins.enumerable,
          get() { mark('navigator.plugins'); return plugins.get.call(this); },
        });
      }
    } catch (_) {}

    const documentPrototype = globalThis.Document && globalThis.Document.prototype;
    const cookie =
      documentPrototype && Object.getOwnPropertyDescriptor(documentPrototype, 'cookie');
    if (cookie && cookie.get && cookie.set) {
      Object.defineProperty(documentPrototype, 'cookie', {
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
          (mark.kind === 'storage' || mark.kind === 'cookie' || mark.kind === 'fingerprint'),
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
