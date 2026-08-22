/*
 * Service worker — orchestrator entry point.
 *
 * MV3 service workers are evicted aggressively. Every listener must therefore
 * be registered synchronously at module top level, or the worker will be woken
 * for an event it no longer knows how to answer.
 */

import { MessageType, PROTOCOL_VERSION, bindRuntime, createRouter } from '../shared/messaging.js';

/**
 * Wall-clock instant at which this worker instance started. It resets on every
 * eviction, so it measures the current worker generation, not the session.
 */
const startedAt = Date.now();

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
    };
  });

bindRuntime(router);
