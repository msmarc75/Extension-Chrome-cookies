/*
 * Service worker — orchestrator entry point.
 *
 * MV3 service workers are evicted aggressively. Every listener must therefore
 * be registered synchronously at module top level, or the worker will be woken
 * for an event it no longer knows how to answer.
 */

import { MessageType, PROTOCOL_VERSION, bindRuntime, createRouter } from '../shared/messaging.js';
import { AuditError, auditCapability, captureBeforeConsent, probeBanner } from './audit.js';
import { liveSessionCount, sweepOrphans } from './debugger-session.js';
import { analysePolicyText, serviceSettings } from './policy-client.js';

/**
 * Wall-clock instant at which this worker instance started. It resets on every
 * eviction, so it measures the current worker generation, not the session.
 */
const startedAt = Date.now();

/** Debugger sessions released by the most recent sweep, for the self-check. */
let orphansReleased = 0;

const router = createRouter()
  .on(MessageType.PING, (payload) => ({
    pong: true,
    echo: payload ?? null,
    receivedAt: Date.now(),
  }))
  .on(MessageType.GET_STATUS, () => {
    const { name, version } = chrome.runtime.getManifest();
    return {
      name,
      version,
      protocol: PROTOCOL_VERSION,
      startedAt,
      workerUptimeMs: Date.now() - startedAt,
      liveDebuggerSessions: liveSessionCount(),
      orphansReleased,
    };
  })
  .on(MessageType.AUDIT_CAPABILITY, () => auditCapability())
  .on(MessageType.CAPTURE_PRE_CONSENT, (payload) =>
    guarded(() =>
      captureBeforeConsent({
        url: payload?.url,
        mode: payload?.mode ?? 'incognito',
        observationMs: payload?.observationMs,
      }),
    ),
  )
  .on(MessageType.PROBE_BANNER, (payload) =>
    guarded(() =>
      probeBanner({
        url: payload?.url,
        mode: payload?.mode ?? 'incognito',
        observationMs: payload?.observationMs,
        act: payload?.act !== false,
        /*
         * The audit hands the policy over only when asked to. An audit is
         * useful without it — the deposit and fairness findings stand on their
         * own — and sending a document to a service is not something to do by
         * default because it happened to be reachable.
         */
        analyse:
          payload?.analysePolicy === false
            ? null
            : (policy) =>
                analysePolicyText(policy, {
                  origin: payload?.serviceOrigin,
                  token: payload?.serviceToken ?? null,
                }),
      }),
    ),
  )
  .on(MessageType.SERVICE_SETTINGS, () => serviceSettings());

/*
 * An audit that cannot run is an outcome, not a crash: the popup has a screen
 * for each reason and needs the code, not a stack trace.
 */
async function guarded(run) {
  try {
    return await run();
  } catch (cause) {
    if (cause instanceof AuditError) {
      throw new Error(`${cause.code}: ${cause.message}`);
    }
    throw cause;
  }
}

bindRuntime(router);

/*
 * An eviction in the middle of an audit is the one path the session's own
 * `finally` cannot cover: the worker dies holding an attachment, and Chrome
 * leaves its warning bar pinned to a tab the user cannot clear. Sweeping at
 * every start is what closes it.
 */
function reconcileDebuggerSessions() {
  sweepOrphans().then((released) => {
    orphansReleased = released;
  });
}

chrome.runtime.onStartup.addListener(reconcileDebuggerSessions);
chrome.runtime.onInstalled.addListener(reconcileDebuggerSessions);
reconcileDebuggerSessions();
