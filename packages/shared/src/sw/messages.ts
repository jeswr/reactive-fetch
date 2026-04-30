// Wire protocol for `@jeswr/solid-reactive-fetch-sw`.
//
// Two message channels are at play:
//
//   1. SW -> page  : `LoginRequiredMessage`. Posted via
//                    `Client.postMessage` when the worker receives a fetch
//                    that needs auth and no Session is active in IDB.
//   2. page -> SW  : `LoginCompleteMessage` / `LoginFailedMessage`. Posted via
//                    `navigator.serviceWorker.controller.postMessage` (or
//                    the active registration) once the page-side
//                    `loginDriver` resolves or rejects.
//
// `requestId` correlates the page response with the worker's awaiting
// `respondWith` Promise. The worker also single-flights concurrent
// requests by sharing one pending Promise across all queued requestIds —
// the requestId is informational so a slow/late page can still match a
// stale request to its origin worker call without dropping responses.
//
// Tokens NEVER cross this channel. The Session is restored from IDB on
// both sides; postMessage carries control signals only.

export const LOGIN_REQUIRED_MESSAGE_TYPE = 'reactive-fetch-sw:login-required' as const;
export const LOGIN_COMPLETE_MESSAGE_TYPE = 'reactive-fetch-sw:login-complete' as const;
export const LOGIN_FAILED_MESSAGE_TYPE = 'reactive-fetch-sw:login-failed' as const;
export const REGISTER_HANDSHAKE_MESSAGE_TYPE = 'reactive-fetch-sw:register' as const;
export const REGISTER_ACK_MESSAGE_TYPE = 'reactive-fetch-sw:register-ack' as const;

export interface LoginRequiredMessage {
  readonly type: typeof LOGIN_REQUIRED_MESSAGE_TYPE;
  readonly requestId: string;
  /** The URL of the request that triggered the login requirement (for diagnostics / UX). */
  readonly url: string;
}

export interface LoginCompleteMessage {
  readonly type: typeof LOGIN_COMPLETE_MESSAGE_TYPE;
  readonly requestId: string;
}

export interface LoginFailedMessage {
  readonly type: typeof LOGIN_FAILED_MESSAGE_TYPE;
  readonly requestId: string;
  readonly reason: string;
}

/**
 * Sent by the page exactly once after the SW activates so the worker can
 * pick up the page-side configuration (clientId, login-timeout, etc.).
 * The worker waits for the first handshake before processing fetches
 * that match the configured URL set; without it the worker has no
 * clientId to restore the Session under.
 */
export interface RegisterHandshakeMessage {
  readonly type: typeof REGISTER_HANDSHAKE_MESSAGE_TYPE;
  readonly clientId: string;
  /** ms; how long the worker waits for a `login-complete` after dispatching `login-required`. */
  readonly loginTimeoutMs: number;
}

export interface RegisterAckMessage {
  readonly type: typeof REGISTER_ACK_MESSAGE_TYPE;
  readonly clientId: string;
}

export type ServiceWorkerOutboundMessage = LoginRequiredMessage | RegisterAckMessage;
export type ServiceWorkerInboundMessage =
  | LoginCompleteMessage
  | LoginFailedMessage
  | RegisterHandshakeMessage;

export function isLoginRequiredMessage(value: unknown): value is LoginRequiredMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === LOGIN_REQUIRED_MESSAGE_TYPE &&
    typeof (value as { requestId?: unknown }).requestId === 'string' &&
    typeof (value as { url?: unknown }).url === 'string'
  );
}

export function isLoginCompleteMessage(value: unknown): value is LoginCompleteMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === LOGIN_COMPLETE_MESSAGE_TYPE &&
    typeof (value as { requestId?: unknown }).requestId === 'string'
  );
}

export function isLoginFailedMessage(value: unknown): value is LoginFailedMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === LOGIN_FAILED_MESSAGE_TYPE &&
    typeof (value as { requestId?: unknown }).requestId === 'string' &&
    typeof (value as { reason?: unknown }).reason === 'string'
  );
}

export function isRegisterHandshakeMessage(value: unknown): value is RegisterHandshakeMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === REGISTER_HANDSHAKE_MESSAGE_TYPE &&
    typeof (value as { clientId?: unknown }).clientId === 'string' &&
    typeof (value as { loginTimeoutMs?: unknown }).loginTimeoutMs === 'number'
  );
}

export function isRegisterAckMessage(value: unknown): value is RegisterAckMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === REGISTER_ACK_MESSAGE_TYPE &&
    typeof (value as { clientId?: unknown }).clientId === 'string'
  );
}
