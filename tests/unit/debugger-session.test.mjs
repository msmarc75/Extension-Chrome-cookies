/*
 * The start-up sweep, and what it must not touch.
 *
 * The sweep exists for one case: the worker was evicted mid-audit, so the
 * registry is gone but the attachment is not. It runs at every worker start,
 * which means it runs concurrently with the very first audit — the click that
 * wakes the worker is the click that starts the audit. A sweep that treated
 * that audit's own session as an orphan would unhook it: the events would go
 * nowhere and the capture would come back empty, with nothing in its notes to
 * say why. That happened, on every cold start, until this test existed.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/* Installed before the module is imported: its listeners register at load. */
const listeners = { event: [], detach: [], removed: [] };
let targets = [];
const detached = [];
let resolveTargets = null;

globalThis.chrome = {
  runtime: { lastError: undefined },
  debugger: {
    onEvent: { addListener: (fn) => listeners.event.push(fn) },
    onDetach: { addListener: (fn) => listeners.detach.push(fn) },
    getTargets: () =>
      resolveTargets ? new Promise((resolve) => (resolveTargets = resolve)) : Promise.resolve(targets),
    attach: async () => {},
    detach: async ({ tabId }) => {
      detached.push(tabId);
    },
    sendCommand: async () => ({}),
  },
  tabs: { onRemoved: { addListener: (fn) => listeners.removed.push(fn) } },
};

const { DebuggerSession, liveSessionCount, sweepOrphans, withSession } = await import(
  '../../extension/src/background/debugger-session.js'
);

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the start-up sweep', () => {
  it('releases an attachment left behind by an evicted worker', async () => {
    targets = [{ tabId: 7, attached: true }, { tabId: 8, attached: false }];
    detached.length = 0;

    assert.equal(await sweepOrphans(), 1);
    assert.deepEqual(detached, [7]);
  });

  it('leaves a session this worker is holding alone', async () => {
    /* The sweep stalls on getTargets while a session of our own attaches. */
    resolveTargets = true;
    detached.length = 0;
    const sweeping = sweepOrphans();
    await settle();

    let sawEvent = null;
    const session = new DebuggerSession(42, (method) => {
      sawEvent = method;
    });
    await session.attach();

    /* The sweep sees the tab as attached — because it is, and by us. */
    resolveTargets([{ tabId: 42, attached: true }]);
    resolveTargets = null;
    assert.equal(await sweeping, 0);

    assert.deepEqual(detached, [], 'the sweep released a live session');
    assert.equal(liveSessionCount(), 1, 'the sweep forgot a live session');

    /* And the registry still routes the events the capture is made of. */
    listeners.event[0]({ tabId: 42 }, 'Network.requestWillBeSent', {});
    assert.equal(sawEvent, 'Network.requestWillBeSent');

    await session.detach();
    assert.deepEqual(detached, [42]);
  });

  it('makes an audit wait for the sweep before attaching', async () => {
    resolveTargets = true;
    const sweeping = sweepOrphans();
    let swept = false;
    void sweeping.then(() => {
      swept = true;
    });

    let attachedDuringSweep = null;
    const audit = withSession(9, () => {}, async () => {
      attachedDuringSweep = swept;
      return true;
    });

    await settle();
    assert.equal(attachedDuringSweep, null, 'the audit attached before the sweep had finished');

    resolveTargets([]);
    resolveTargets = null;
    await audit;
    assert.equal(attachedDuringSweep, true);
  });
});
