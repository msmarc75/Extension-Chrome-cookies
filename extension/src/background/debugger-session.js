/*
 * chrome.debugger lifecycle.
 *
 * The whole product rests on attaching the CDP Network domain *before* the
 * page navigates — `webRequest` under MV3 does not see the earliest requests
 * reliably, and the earliest requests are the ones the report is about.
 *
 * The cost of that choice is a debugger session per audit, and a debugger
 * session that outlives its audit is a visible defect: Chrome keeps a warning
 * bar pinned to the tab, and the user cannot dismiss it. Detachment therefore
 * has four independent guarantees:
 *
 *   1. `run()` detaches in a `finally`, on every path including a throw.
 *   2. A watchdog detaches a session that overruns its budget.
 *   3. `chrome.debugger.onDetach` and `chrome.tabs.onRemoved` reconcile the
 *      registry when the browser detaches for us.
 *   4. `sweepOrphans()` runs at every service-worker start, because an eviction
 *      mid-audit is the one path the first three cannot cover.
 */

const CDP_VERSION = '1.3';
const COMMAND_TIMEOUT_MS = 15_000;

/** @type {Map<number, DebuggerSession>} tabId → live session */
const live = new Map();

/*
 * Registered at module scope. An MV3 worker woken for one of these events must
 * already know how to handle it — a listener added later in an async
 * initialisation is a listener the browser will not find.
 */
chrome.debugger.onEvent.addListener((source, method, params) => {
  live.get(source.tabId)?.receive(method, params);
});

chrome.debugger.onDetach.addListener((source, reason) => {
  const session = live.get(source.tabId);
  if (!session) return;
  session.attached = false;
  session.detachReason = reason;
  live.delete(source.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const session = live.get(tabId);
  if (!session) return;
  session.attached = false;
  session.detachReason = 'target_closed';
  live.delete(tabId);
});

function lastError() {
  return chrome.runtime.lastError?.message ?? null;
}

/**
 * Detach every debugger session this extension still holds.
 *
 * Called at worker start-up: if the worker was evicted mid-audit, the registry
 * above is gone but the attachment may not be, and nothing else will clean it
 * up. Detaching a target we are not attached to is a no-op that reports an
 * error, which is why the failure is swallowed here and only here.
 *
 * @returns {Promise<number>} how many sessions were released
 */
export async function sweepOrphans() {
  let released = 0;
  let targets = [];
  try {
    targets = await chrome.debugger.getTargets();
  } catch {
    return 0;
  }

  for (const target of targets) {
    if (!target.attached || typeof target.tabId !== 'number') continue;
    try {
      await chrome.debugger.detach({ tabId: target.tabId });
      released += 1;
    } catch {
      /* Attached by DevTools or by another extension — not ours to release. */
    }
  }
  live.clear();
  return released;
}

/** Sessions currently attached by this worker. Exposed for diagnostics. */
export function liveSessionCount() {
  return live.size;
}

export class DebuggerSession {
  /**
   * @param {number} tabId
   * @param {(method: string, params: object) => void} onEvent
   */
  constructor(tabId, onEvent) {
    this.tabId = tabId;
    this.onEvent = onEvent;
    this.attached = false;
    this.detachReason = null;
  }

  receive(method, params) {
    try {
      this.onEvent(method, params);
    } catch {
      /* A malformed event must not take the audit down with it. */
    }
  }

  async attach() {
    if (live.has(this.tabId)) {
      throw new Error(`A debugger session is already attached to tab ${this.tabId}`);
    }
    await chrome.debugger.attach({ tabId: this.tabId }, CDP_VERSION);
    const error = lastError();
    if (error) throw new Error(`Could not attach the debugger: ${error}`);

    this.attached = true;
    live.set(this.tabId, this);
    return this;
  }

  /**
   * Send a CDP command. A command that never settles would hang the audit and,
   * with it, the detachment — hence the timeout. A page whose navigation is
   * still pending will hold `Runtime.evaluate` open indefinitely, which is
   * exactly the case the caller wants a short budget for.
   */
  async send(method, params = {}, { timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
    if (!this.attached) {
      throw new Error(`Cannot send ${method}: the debugger is not attached`);
    }

    let timer;
    try {
      return await Promise.race([
        chrome.debugger.sendCommand({ tabId: this.tabId }, method, params),
        new Promise((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${method} did not answer within ${timeoutMs} ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Same as `send`, but a failure becomes null instead of aborting the audit. */
  async trySend(method, params = {}, options = {}) {
    try {
      return await this.send(method, params, options);
    } catch {
      return null;
    }
  }

  async detach() {
    live.delete(this.tabId);
    if (!this.attached) return false;
    this.attached = false;
    try {
      await chrome.debugger.detach({ tabId: this.tabId });
      return true;
    } catch {
      /* Already gone — the tab closed, or the browser detached us first. */
      return false;
    }
  }
}

/**
 * Attach, run, and detach — whatever happens in between.
 *
 * @param {number} tabId
 * @param {(method: string, params: object) => void} onEvent
 * @param {(session: DebuggerSession) => Promise<T>} body
 * @param {{budgetMs?: number}} [options] hard ceiling on the whole session
 * @returns {Promise<T>}
 * @template T
 */
export async function withSession(tabId, onEvent, body, { budgetMs = 120_000 } = {}) {
  const session = new DebuggerSession(tabId, onEvent);
  await session.attach();

  const watchdog = setTimeout(() => {
    void session.detach();
  }, budgetMs);

  try {
    return await body(session);
  } finally {
    clearTimeout(watchdog);
    await session.detach();
  }
}
