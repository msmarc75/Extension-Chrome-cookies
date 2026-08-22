import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ErrorCode,
  MessageType,
  PROTOCOL_VERSION,
  bindRuntime,
  createErrorResponse,
  createRequest,
  createResponse,
  createRouter,
  isRequest,
  isResponse,
  request,
} from '../../extension/src/shared/messaging.js';

describe('envelopes', () => {
  it('stamps requests with the protocol version and a unique id', () => {
    const a = createRequest(MessageType.PING);
    const b = createRequest(MessageType.PING);

    assert.equal(a.protocol, PROTOCOL_VERSION);
    assert.equal(a.kind, 'request');
    assert.equal(a.type, MessageType.PING);
    assert.notEqual(a.id, b.id);
    assert.ok(isRequest(a));
  });

  it('rejects an empty type at construction rather than at dispatch', () => {
    assert.throws(() => createRequest(''), TypeError);
  });

  it('carries the request id and type onto the response', () => {
    const req = createRequest(MessageType.GET_STATUS, { verbose: true });
    const res = createResponse(req, { version: '0.1.0' });

    assert.ok(isResponse(res));
    assert.equal(res.id, req.id);
    assert.equal(res.type, req.type);
    assert.equal(res.ok, true);
    assert.deepEqual(res.data, { version: '0.1.0' });
  });

  it('builds an error response even when the request could not be parsed', () => {
    const res = createErrorResponse(null, ErrorCode.BAD_ENVELOPE, 'nope');

    assert.ok(isResponse(res));
    assert.equal(res.ok, false);
    assert.equal(res.id, null);
    assert.deepEqual(res.error, { code: ErrorCode.BAD_ENVELOPE, message: 'nope' });
  });

  it('does not accept a foreign or stale protocol version as a request', () => {
    assert.equal(isRequest({ ...createRequest(MessageType.PING), protocol: 99 }), false);
    assert.equal(isRequest({ kind: 'request', id: 'x', type: 'ping' }), false);
    assert.equal(isRequest(null), false);
    assert.equal(isRequest('ping'), false);
  });
});

describe('router', () => {
  it('routes a request to its handler and wraps the result', async () => {
    const router = createRouter().on(MessageType.PING, (payload) => ({ echo: payload }));

    const res = await router.dispatch(createRequest(MessageType.PING, 'hello'));

    assert.equal(res.ok, true);
    assert.deepEqual(res.data, { echo: 'hello' });
  });

  it('passes the sender context through to the handler', async () => {
    let seen = null;
    const router = createRouter().on(MessageType.PING, (_payload, context) => {
      seen = context;
      return null;
    });

    const req = createRequest(MessageType.PING);
    await router.dispatch(req, { sender: { tab: { id: 7 } } });

    assert.deepEqual(seen.sender, { tab: { id: 7 } });
    assert.equal(seen.request.id, req.id);
  });

  it('refuses to register the same type twice', () => {
    const router = createRouter().on(MessageType.PING, () => null);

    assert.throws(() => router.on(MessageType.PING, () => null), /already registered/);
    assert.throws(() => router.on('other', 'not-a-function'), TypeError);
  });

  it('reports an unknown type instead of throwing', async () => {
    const res = await createRouter().dispatch(createRequest('nonexistent'));

    assert.equal(res.ok, false);
    assert.equal(res.error.code, ErrorCode.UNKNOWN_TYPE);
  });

  it('reports a malformed message instead of throwing', async () => {
    const res = await createRouter().dispatch({ hello: 'world' });

    assert.equal(res.ok, false);
    assert.equal(res.error.code, ErrorCode.BAD_ENVELOPE);
  });

  it('contains a throwing handler so one bad handler cannot kill the worker', async () => {
    const router = createRouter()
      .on('boom', () => {
        throw new Error('handler exploded');
      })
      .on('reject', async () => {
        throw new Error('handler rejected');
      });

    for (const type of ['boom', 'reject']) {
      const res = await router.dispatch(createRequest(type));
      assert.equal(res.ok, false);
      assert.equal(res.error.code, ErrorCode.HANDLER_FAILED);
      assert.match(res.error.message, /handler (exploded|rejected)/);
    }
  });

  it('normalises an undefined handler result to null', async () => {
    const router = createRouter().on(MessageType.PING, () => undefined);

    const res = await router.dispatch(createRequest(MessageType.PING));

    assert.equal(res.ok, true);
    assert.equal(res.data, null);
  });
});

describe('bindRuntime', () => {
  function fakeRuntime() {
    const listeners = new Set();
    return {
      listeners,
      onMessage: {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
      },
    };
  }

  it('keeps the message channel open for the async dispatch', async () => {
    const runtime = fakeRuntime();
    const router = createRouter().on(MessageType.PING, async () => 'pong');
    bindRuntime(router, runtime);

    const [listener] = runtime.listeners;
    const replies = [];
    // The MV3 contract: returning true synchronously is what stops Chrome from
    // closing the port before the promise settles.
    assert.equal(listener(createRequest(MessageType.PING), {}, (r) => replies.push(r)), true);

    await new Promise(setImmediate);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].data, 'pong');
  });

  it('detaches cleanly', () => {
    const runtime = fakeRuntime();
    const detach = bindRuntime(createRouter(), runtime);

    assert.equal(runtime.listeners.size, 1);
    detach();
    assert.equal(runtime.listeners.size, 0);
  });

  it('fails loudly when there is no runtime to bind to', () => {
    assert.throws(() => bindRuntime(createRouter(), undefined), TypeError);
    assert.throws(() => bindRuntime(createRouter(), {}), TypeError);
  });
});

describe('request', () => {
  it('returns the response envelope on success', async () => {
    const router = createRouter().on(MessageType.PING, () => 'pong');
    const runtime = { sendMessage: (message) => router.dispatch(message) };

    const res = await request(MessageType.PING, null, runtime);

    assert.equal(res.ok, true);
    assert.equal(res.data, 'pong');
  });

  it('turns a missing receiver into a failed envelope rather than a rejection', async () => {
    const res = await request(MessageType.PING, null, {
      sendMessage: () => Promise.reject(new Error('Receiving end does not exist')),
    });

    assert.equal(res.ok, false);
    assert.equal(res.error.code, ErrorCode.NO_RECEIVER);
    assert.match(res.error.message, /Receiving end/);
  });

  it('turns an absent runtime into a failed envelope', async () => {
    const res = await request(MessageType.PING, null, undefined);

    assert.equal(res.ok, false);
    assert.equal(res.error.code, ErrorCode.NO_RECEIVER);
  });

  it('rejects a reply that is not a protocol envelope', async () => {
    const res = await request(MessageType.PING, null, {
      sendMessage: async () => ({ surprise: true }),
    });

    assert.equal(res.ok, false);
    assert.equal(res.error.code, ErrorCode.BAD_ENVELOPE);
  });
});
