/*
 * Message protocol between the popup / content scripts and the service worker.
 *
 * The protocol layer is deliberately free of any `chrome.*` reference at module
 * scope so it can be unit-tested under plain Node. The two functions that do
 * touch the extension runtime (`bindRuntime`, `request`) take the runtime as an
 * argument, defaulting to `chrome.runtime` only when actually called.
 */

export const PROTOCOL_VERSION = 1;

/** Message types understood by the service worker. */
export const MessageType = Object.freeze({
  PING: 'ping',
  GET_STATUS: 'get_status',
});

/** Error codes carried by a failed response envelope. */
export const ErrorCode = Object.freeze({
  BAD_ENVELOPE: 'E_BAD_ENVELOPE',
  UNKNOWN_TYPE: 'E_UNKNOWN_TYPE',
  HANDLER_FAILED: 'E_HANDLER_FAILED',
  NO_RECEIVER: 'E_NO_RECEIVER',
});

function newId() {
  return globalThis.crypto.randomUUID();
}

/**
 * Build a request envelope.
 * @param {string} type one of MessageType
 * @param {unknown} [payload]
 * @param {{id?: string, sentAt?: number}} [meta] injectable for deterministic tests
 */
export function createRequest(type, payload = null, meta = {}) {
  if (typeof type !== 'string' || type.length === 0) {
    throw new TypeError('createRequest: type must be a non-empty string');
  }
  return {
    protocol: PROTOCOL_VERSION,
    kind: 'request',
    id: meta.id ?? newId(),
    type,
    payload,
    sentAt: meta.sentAt ?? Date.now(),
  };
}

/**
 * Build a successful response envelope answering `request`.
 * @param {object} request
 * @param {unknown} data
 * @param {{sentAt?: number}} [meta]
 */
export function createResponse(request, data = null, meta = {}) {
  return {
    protocol: PROTOCOL_VERSION,
    kind: 'response',
    id: request.id,
    type: request.type,
    ok: true,
    data,
    sentAt: meta.sentAt ?? Date.now(),
  };
}

/**
 * Build a failed response envelope. `request` may be null when the incoming
 * message was too malformed to identify.
 * @param {object|null} request
 * @param {string} code one of ErrorCode
 * @param {string} message operator-facing detail, never shown raw to the user
 * @param {{sentAt?: number}} [meta]
 */
export function createErrorResponse(request, code, message, meta = {}) {
  return {
    protocol: PROTOCOL_VERSION,
    kind: 'response',
    id: request?.id ?? null,
    type: request?.type ?? null,
    ok: false,
    error: { code, message },
    sentAt: meta.sentAt ?? Date.now(),
  };
}

/** True when `value` is a well-formed request envelope of the current protocol. */
export function isRequest(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    value.protocol === PROTOCOL_VERSION &&
    value.kind === 'request' &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.type === 'string' &&
    value.type.length > 0
  );
}

/** True when `value` is a well-formed response envelope of the current protocol. */
export function isResponse(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    value.protocol === PROTOCOL_VERSION &&
    value.kind === 'response' &&
    typeof value.ok === 'boolean'
  );
}

/**
 * A type-indexed handler table. `dispatch` never throws: a handler that rejects
 * becomes a failed response envelope, so one broken handler cannot take the
 * service worker down mid-audit.
 */
export function createRouter() {
  const handlers = new Map();

  return {
    /**
     * @param {string} type
     * @param {(payload: unknown, context: object) => unknown} handler
     */
    on(type, handler) {
      if (typeof handler !== 'function') {
        throw new TypeError(`router.on(${type}): handler must be a function`);
      }
      if (handlers.has(type)) {
        throw new Error(`router.on(${type}): already registered`);
      }
      handlers.set(type, handler);
      return this;
    },

    has(type) {
      return handlers.has(type);
    },

    types() {
      return [...handlers.keys()];
    },

    /**
     * @param {unknown} message raw value received from the runtime
     * @param {object} [context] forwarded to the handler (sender, etc.)
     * @returns {Promise<object>} a response envelope, always
     */
    async dispatch(message, context = {}) {
      if (!isRequest(message)) {
        return createErrorResponse(
          null,
          ErrorCode.BAD_ENVELOPE,
          'Message is not a protocol request envelope',
        );
      }
      const handler = handlers.get(message.type);
      if (!handler) {
        return createErrorResponse(
          message,
          ErrorCode.UNKNOWN_TYPE,
          `No handler registered for "${message.type}"`,
        );
      }
      try {
        const data = await handler(message.payload, { ...context, request: message });
        return createResponse(message, data ?? null);
      } catch (cause) {
        return createErrorResponse(
          message,
          ErrorCode.HANDLER_FAILED,
          cause instanceof Error ? cause.message : String(cause),
        );
      }
    },
  };
}

/**
 * Wire a router onto a runtime's `onMessage` event.
 *
 * The listener returns `true` synchronously so the channel stays open for the
 * async dispatch — the MV3 rule that bites hardest if forgotten.
 *
 * @param {ReturnType<createRouter>} router
 * @param {{onMessage: {addListener: Function}}} [runtime]
 * @returns {() => void} detach function
 */
export function bindRuntime(router, runtime = globalThis.chrome?.runtime) {
  if (!runtime?.onMessage?.addListener) {
    throw new TypeError('bindRuntime: runtime.onMessage.addListener is unavailable');
  }
  const listener = (message, sender, sendResponse) => {
    router.dispatch(message, { sender }).then(sendResponse);
    return true;
  };
  runtime.onMessage.addListener(listener);
  return () => runtime.onMessage.removeListener?.(listener);
}

/**
 * Send a request to the service worker and resolve with its response envelope.
 * Never rejects: a dead receiver becomes a failed envelope so callers have one
 * shape to handle.
 *
 * @param {string} type
 * @param {unknown} [payload]
 * @param {{sendMessage: Function, lastError?: unknown}} [runtime]
 */
export async function request(type, payload = null, runtime = globalThis.chrome?.runtime) {
  const envelope = createRequest(type, payload);
  if (!runtime?.sendMessage) {
    return createErrorResponse(envelope, ErrorCode.NO_RECEIVER, 'Extension runtime unavailable');
  }
  try {
    const response = await runtime.sendMessage(envelope);
    if (!isResponse(response)) {
      return createErrorResponse(
        envelope,
        ErrorCode.BAD_ENVELOPE,
        'Reply is not a protocol response envelope',
      );
    }
    return response;
  } catch (cause) {
    return createErrorResponse(
      envelope,
      ErrorCode.NO_RECEIVER,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}
