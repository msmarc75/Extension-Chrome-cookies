/*
 * Turns a stream of CDP events into a capture object matching
 * shared/schema/capture.schema.json.
 *
 * Deliberately free of any `chrome.*` call: everything that talks to the
 * browser lives in debugger-session.js, so the part that decides what a
 * finding *is* can be driven from recorded event fixtures under plain Node.
 *
 * No cookie value and no storage value ever enters the record. The report
 * needs to establish that something was written, by whom and when. What it
 * contained is the site's business, and a compliance tool that hoovers it up
 * has no standing to lecture anyone.
 */

import { hostOf, normaliseCookieDomain, partyOf } from '../shared/hosts.js';

const encoder = new TextEncoder();

const byteLength = (value) => (typeof value === 'string' ? encoder.encode(value).length : 0);

/* CDP `Storage.getUsageAndQuota` storage types → the schema's vocabulary. */
const USAGE_TYPES = new Map([
  ['local_storage', 'localStorage'],
  ['indexeddb', 'indexedDB'],
  ['cache_storage', 'cacheStorage'],
  ['service_workers', 'serviceWorker'],
  ['file_systems', 'fileSystem'],
  ['websql', 'webSQL'],
]);

/** Storage types the usage snapshot must not restate — cookies have their own list. */
const USAGE_IGNORED = new Set(['cookies']);

/**
 * Parse one `Set-Cookie` header value. Returns null for a header we cannot
 * make sense of rather than guessing at it.
 */
export function parseSetCookie(header, { requestHost, now }) {
  const [pair, ...attributes] = header.split(';');
  const separator = pair.indexOf('=');
  if (separator <= 0) return null;

  const name = pair.slice(0, separator).trim();
  const value = pair.slice(separator + 1).trim();
  if (name.length === 0) return null;

  const cookie = {
    name,
    host: requestHost,
    path: '/',
    secure: false,
    httpOnly: false,
    sameSite: null,
    session: true,
    expiresAt: null,
    size: byteLength(value),
  };

  for (const attribute of attributes) {
    const index = attribute.indexOf('=');
    const key = (index === -1 ? attribute : attribute.slice(0, index)).trim().toLowerCase();
    const attributeValue = index === -1 ? '' : attribute.slice(index + 1).trim();

    switch (key) {
      case 'domain': {
        cookie.host = normaliseCookieDomain(attributeValue) ?? cookie.host;
        break;
      }
      case 'path':
        if (attributeValue) cookie.path = attributeValue;
        break;
      case 'secure':
        cookie.secure = true;
        break;
      case 'httponly':
        cookie.httpOnly = true;
        break;
      case 'samesite':
        cookie.sameSite = attributeValue || null;
        break;
      case 'max-age': {
        const seconds = Number.parseInt(attributeValue, 10);
        if (Number.isFinite(seconds)) {
          cookie.session = false;
          cookie.expiresAt = now + seconds * 1000;
        }
        break;
      }
      case 'expires': {
        const parsed = Date.parse(attributeValue);
        if (Number.isFinite(parsed)) {
          cookie.session = false;
          cookie.expiresAt = parsed;
        }
        break;
      }
      default:
        break;
    }
  }

  return cookie;
}

const cookieKey = (cookie) => [cookie.name, cookie.host, cookie.path].join(String.fromCharCode(31));

export class CaptureBuilder {
  /**
   * @param {object} options
   * @param {'A'|'B'|'C'} options.phase
   * @param {string} options.requestedUrl
   * @param {'incognito-fresh'|'incognito-shared'|'current'} options.profile
   * @param {number} options.startedAt epoch ms; every tMs is relative to it
   * @param {'none'|'refuse-all'|'accept-all'} [options.interaction]
   */
  constructor({ phase, requestedUrl, profile, startedAt, interaction = 'none' }) {
    this.phase = phase;
    this.requestedUrl = requestedUrl;
    this.profile = profile;
    this.startedAt = startedAt;
    this.interaction = interaction;

    this.siteHost = hostOf(requestedUrl);
    this.finalUrl = null;
    this.navigationCommittedAt = null;

    /** @type {Map<string, object>} requestId → request record */
    this.requests = new Map();
    /** @type {Map<string, object>} cookie key → cookie record */
    this.cookies = new Map();
    /** @type {Array<object>} */
    this.storage = [];
    /** @type {Array<{api: string, tMs: number}>} */
    this.fingerprinting = [];
    /** @type {Array<{code: string, detail: string}>} */
    this.notes = [];

    /*
     * CDP timestamps are monotonic seconds from an arbitrary origin.
     * `Network.requestWillBeSent` carries both that clock and `wallTime`, so
     * the first one seen fixes the offset and every later event converts.
     */
    this.monotonicOffsetMs = null;
  }

  note(code, detail) {
    this.notes.push({ code, detail: String(detail) });
    return this;
  }

  /** Monotonic CDP timestamp → milliseconds since the window opened. */
  toRelative(timestamp, receivedAt) {
    if (typeof timestamp === 'number' && this.monotonicOffsetMs !== null) {
      return timestamp * 1000 + this.monotonicOffsetMs - this.startedAt;
    }
    if (typeof receivedAt === 'number') return receivedAt - this.startedAt;
    return null;
  }

  /**
   * @param {string} method CDP event name
   * @param {object} params CDP event parameters
   * @param {number} [receivedAt] epoch ms, for events that carry no clock
   */
  onEvent(method, params, receivedAt = Date.now()) {
    switch (method) {
      case 'Network.requestWillBeSent':
        this.#onRequest(params, receivedAt);
        break;
      case 'Network.responseReceived':
        this.#onResponse(params, receivedAt);
        break;
      case 'Network.responseReceivedExtraInfo':
        this.#onResponseExtraInfo(params, receivedAt);
        break;
      case 'Network.requestServedFromCache':
        this.#patchRequest(params.requestId, { fromCache: true });
        break;
      case 'Network.loadingFailed':
        this.#patchRequest(params.requestId, { fromCache: Boolean(params.fromCache) });
        break;
      case 'Page.frameNavigated':
        this.#onFrameNavigated(params, receivedAt);
        break;
      default:
        break;
    }
    return this;
  }

  #onRequest(params, receivedAt) {
    if (this.monotonicOffsetMs === null && typeof params.wallTime === 'number') {
      this.monotonicOffsetMs = params.wallTime * 1000 - params.timestamp * 1000;
    }

    const url = params.request?.url ?? '';
    const host = hostOf(url);
    const initiatorHost = hostOf(params.initiator?.url ?? '');

    /*
     * A redirect reuses its requestId. Keeping only the first hop would hide
     * where the chain landed, and keeping only the last would erase the
     * moment the site reached out. Each hop gets its own record.
     */
    const id = this.requests.has(params.requestId)
      ? `${params.requestId}#${this.requests.size}`
      : params.requestId;

    this.requests.set(id, {
      id,
      tMs: this.toRelative(params.timestamp, receivedAt) ?? 0,
      url,
      host: host ?? '',
      party: partyOf(host, this.siteHost),
      method: params.request?.method ?? 'GET',
      resourceType: params.type ?? 'Other',
      initiator: { type: params.initiator?.type ?? 'other', host: initiatorHost },
      status: null,
      fromCache: false,
    });
  }

  #patchRequest(requestId, patch) {
    const record = this.requests.get(requestId);
    if (record) Object.assign(record, patch);
  }

  #onResponse(params, receivedAt) {
    this.#patchRequest(params.requestId, {
      status: typeof params.response?.status === 'number' ? params.response.status : null,
      fromCache: Boolean(params.response?.fromDiskCache),
    });
    void receivedAt;
  }

  #onResponseExtraInfo(params, receivedAt) {
    const raw = params.headers?.['set-cookie'] ?? params.headers?.['Set-Cookie'];
    if (!raw) return;

    const request = this.requests.get(params.requestId);
    const requestHost = request?.host ?? this.siteHost ?? '';
    const tMs = request?.tMs ?? this.toRelative(undefined, receivedAt);
    const now = this.startedAt + (tMs ?? 0);

    for (const header of String(raw).split('\n')) {
      const parsed = parseSetCookie(header, { requestHost, now });
      if (!parsed) {
        this.note('SET_COOKIE_UNPARSED', header.slice(0, 120));
        continue;
      }
      const record = {
        ...parsed,
        party: partyOf(parsed.host, this.siteHost),
        tMs,
        source: 'set-cookie',
      };
      /* First write wins: the report is about when the deposit started. */
      if (!this.cookies.has(cookieKey(record))) {
        this.cookies.set(cookieKey(record), record);
      }
    }
  }

  #onFrameNavigated(params, receivedAt) {
    if (params.frame?.parentId) return;
    this.finalUrl = params.frame?.url ?? this.finalUrl;
    if (this.navigationCommittedAt === null) {
      this.navigationCommittedAt = this.toRelative(params.timestamp, receivedAt);
    }
  }

  /**
   * Merge the end-of-window snapshots and emit the capture.
   *
   * @param {object} snapshot
   * @param {number} snapshot.durationMs
   * @param {Array<object>} [snapshot.jarCookies] CDP `Network.getCookies` result
   * @param {Array<{storageType: string, usage: number}>} [snapshot.usageBreakdown]
   * @param {object} [snapshot.pageMarks] parsed output of the page instrument
   * @param {string} [snapshot.finalUrl]
   */
  finish({ durationMs, jarCookies = [], usageBreakdown = [], pageMarks = null, finalUrl } = {}) {
    if (finalUrl) this.finalUrl = finalUrl;

    const origin = this.#origin();

    /*
     * Order matters. Watched writes first, so they own their moment; then the
     * jar and the end-of-window inventories, which only fill in what was
     * missed and never overwrite a time that was actually observed.
     */
    this.#applyStorageMarks(pageMarks?.marks ?? [], origin);
    this.#applyFingerprintMarks(pageMarks?.marks ?? []);
    this.#mergeJarCookies(jarCookies);
    this.#applyCookieMarks(pageMarks?.marks ?? []);
    this.#mergeInventory(pageMarks?.inventory, origin);
    this.#mergeUsage(usageBreakdown, origin);

    return {
      schemaVersion: 1,
      phase: this.phase,
      target: {
        requestedUrl: this.requestedUrl,
        finalUrl: this.finalUrl,
        origin,
      },
      profile: this.profile,
      window: {
        startedAt: this.startedAt,
        durationMs,
        navigationCommittedAt: this.navigationCommittedAt,
      },
      interaction: this.interaction,
      requests: [...this.requests.values()].sort((a, b) => a.tMs - b.tMs),
      cookies: [...this.cookies.values()].sort(
        (a, b) => (a.tMs ?? Infinity) - (b.tMs ?? Infinity) || a.name.localeCompare(b.name),
      ),
      storage: this.storage.sort((a, b) => (a.tMs ?? Infinity) - (b.tMs ?? Infinity)),
      fingerprinting: this.fingerprinting.sort((a, b) => a.tMs - b.tMs),
      notes: this.notes,
    };
  }

  /*
   * The jar is authoritative on what actually persisted; the Set-Cookie stream
   * is authoritative on when. A cookie written from script appears only in the
   * jar, and is recorded undated rather than given a plausible-looking time.
   */
  #mergeJarCookies(jarCookies) {
    for (const cookie of jarCookies) {
      const host = normaliseCookieDomain(cookie.domain);
      if (!host || typeof cookie.name !== 'string') continue;

      const record = {
        name: cookie.name,
        host,
        path: cookie.path ?? '/',
        party: partyOf(host, this.siteHost),
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
        sameSite: cookie.sameSite ?? null,
        session: Boolean(cookie.session),
        expiresAt:
          typeof cookie.expires === 'number' && cookie.expires > 0 ? cookie.expires * 1000 : null,
        size: typeof cookie.size === 'number' ? cookie.size : byteLength(cookie.value),
        tMs: null,
        source: 'jar',
      };

      const observed = this.cookies.get(cookieKey(record));
      this.cookies.set(cookieKey(record), observed ? { ...record, tMs: observed.tMs } : record);
    }
  }

  #mergeUsage(usageBreakdown, origin) {
    if (!origin) return;

    const observedTypes = new Set(this.storage.map((entry) => entry.type));

    for (const { storageType, usage } of usageBreakdown) {
      if (!usage || usage <= 0 || USAGE_IGNORED.has(storageType)) continue;

      const type = USAGE_TYPES.get(storageType) ?? 'other';
      if (observedTypes.has(type)) continue;

      this.storage.push({ origin, type, key: null, tMs: null, bytes: usage, source: 'snapshot' });
    }
  }

  /*
   * One entry per API, at the moment it was first reached. A page that reads a
   * canvas in a loop is doing one thing, not four hundred, and a timeline that
   * said otherwise would be unreadable.
   */
  #applyFingerprintMarks(marks) {
    const firstUse = new Map();
    for (const mark of marks) {
      if (mark.kind !== 'fingerprint' || typeof mark.api !== 'string') continue;
      const tMs = mark.at - this.startedAt;
      if (!firstUse.has(mark.api) || tMs < firstUse.get(mark.api)) firstUse.set(mark.api, tMs);
    }
    for (const [api, tMs] of firstUse) this.fingerprinting.push({ api, tMs });
  }

  /** Storage writes the in-page instrument watched happen, with their moment. */
  #applyStorageMarks(marks, origin) {
    for (const mark of marks) {
      if (mark.kind !== 'storage') continue;
      this.storage.push({
        origin: origin ?? '',
        type: mark.area === 'sessionStorage' ? 'sessionStorage' : 'localStorage',
        key: typeof mark.key === 'string' ? mark.key : null,
        tMs: mark.at - this.startedAt,
        bytes: Number.isFinite(mark.size) ? mark.size : null,
        source: 'event',
      });
    }
  }

  /*
   * A cookie written from script reaches the jar with no moment attached. The
   * instrument saw the assignment, so the name can be matched back and the
   * cookie dated — which is the difference between a mark on the timeline and
   * a row in a table nobody can place.
   */
  #applyCookieMarks(marks) {
    for (const mark of marks) {
      if (mark.kind !== 'cookie' || typeof mark.header !== 'string') continue;

      const separator = mark.header.indexOf('=');
      if (separator <= 0) continue;
      const name = mark.header.slice(0, separator).trim();
      const tMs = mark.at - this.startedAt;

      for (const record of this.cookies.values()) {
        if (record.name === name && record.tMs === null) {
          record.tMs = tMs;
          break;
        }
      }
    }
  }

  /*
   * Whatever is in the storage areas at the end of the window and was not
   * watched being written — `localStorage.foo = 1` sets a named property and
   * never reaches `setItem`, so it leaves no mark.
   */
  #mergeInventory(inventory, origin) {
    if (!inventory || !origin) return;

    for (const area of ['localStorage', 'sessionStorage']) {
      const watched = new Set(
        this.storage.filter((entry) => entry.type === area).map((entry) => entry.key),
      );
      for (const [key, size] of inventory[area] ?? []) {
        if (watched.has(key)) continue;
        this.storage.push({
          origin,
          type: area,
          key,
          tMs: null,
          bytes: Number.isFinite(size) ? size : null,
          source: 'snapshot',
        });
      }
    }
  }

  #origin() {
    try {
      const { origin } = new URL(this.finalUrl ?? this.requestedUrl);
      return origin === 'null' ? null : origin;
    } catch {
      return null;
    }
  }
}
