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
import { clearHistory, deleteAudit, getAudit, listAudits, saveAudit } from './history.js';
import {
  auditAllowance,
  countAudit,
  forgetLicence,
  setLicenceKey,
  startCheckout,
  storedLicence,
  verifyLicence,
} from './licence.js';

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
    guarded(async () => {
      /*
       * The allowance is checked before the tab is opened, not after the work
       * is done: an audit that runs and is then refused has already cost the
       * user a debugger warning bar and five seconds of their attention.
       */
      const allowance = await auditAllowance();
      if (!allowance.allowed) {
        throw new AuditError('ALLOWANCE_EXHAUSTED', allowance.reason);
      }

      const result = await probeBanner({
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
        /* Policy analysis is what costs the operator money, so it is what a
           licence buys. A free installation is told, not billed. */
        analyse:
          payload?.analysePolicy === false || !allowance.policyAnalysis
            ? null
            : (policy) =>
                analysePolicyText(policy, {
                  origin: payload?.serviceOrigin,
                  token: payload?.serviceToken ?? null,
                }),
      });

      /*
       * Kept before it is returned, so the report the user opens is the record
       * that was stored rather than a second rendering of the same audit. The
       * history is local; see history.js for why that is not negotiable.
       */
      if (payload?.remember !== false) {
        const saved = await saveAudit(result);
        result.auditId = saved.id;
        result.auditAt = saved.at;
      }

      const counter = await countAudit();
      result.allowance = {
        plan: allowance.plan,
        auditsLeft: allowance.auditsLeft === null ? null : Math.max(0, allowance.auditsLeft - 1),
        policyAnalysis: allowance.policyAnalysis,
        usedThisMonth: counter.used,
      };
      if (!allowance.policyAnalysis && payload?.analysePolicy) {
        result.policy = result.policy ?? {};
        result.policy.error = {
          code: 'PLAN_WITHOUT_POLICY_ANALYSIS',
          message: 'Policy analysis is part of the Pro plan; the rest of the audit is unaffected.',
        };
      }
      return result;
    }),
  )
  .on(MessageType.SERVICE_SETTINGS, () => serviceSettings())
  .on(MessageType.HISTORY_LIST, () => listAudits())
  .on(MessageType.HISTORY_GET, (payload) => getAudit(payload?.id))
  .on(MessageType.HISTORY_DELETE, (payload) => deleteAudit(payload?.id))
  .on(MessageType.HISTORY_CLEAR, () => clearHistory())
  .on(MessageType.LICENCE_STATE, async () => ({
    licence: await storedLicence(),
    allowance: await auditAllowance(),
  }))
  .on(MessageType.LICENCE_SET, async (payload) => {
    await setLicenceKey(payload?.key);
    /* Checked immediately: a key typed into a box and silently not verified is
       how a customer discovers on Friday that they pasted the wrong line. */
    const licence = await verifyLicence({ force: true, origin: payload?.origin ?? null });
    return { licence, allowance: await auditAllowance() };
  })
  .on(MessageType.LICENCE_FORGET, async () => ({
    licence: await forgetLicence(),
    allowance: await auditAllowance(),
  }))
  .on(MessageType.LICENCE_CHECKOUT, (payload) =>
    startCheckout({ plan: payload?.plan ?? 'pro', email: payload?.email ?? null, origin: payload?.origin ?? null }),
  );

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
