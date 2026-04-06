import type { AceEvent, AceEventType } from './contracts'

/**
 * AceEventHandler — called when an event is emitted.
 */
export type AceEventHandler<T = unknown> = (event: AceEvent<T>) => void | Promise<void>

/**
 * AceEmitter — minimal publish/subscribe contract for Ace events.
 *
 * Implementations may use in-process event emitters, Cloudflare Queues,
 * webhooks, or any other transport. The interface is transport-agnostic.
 */
export interface AceEmitter {
  /**
   * emit — publish an event to all registered handlers for its type.
   */
  emit<T>(event: AceEvent<T>): void | Promise<void>

  /**
   * on — register a handler for a specific event type.
   * Returns an unsubscribe function.
   */
  on<T>(type: AceEventType, handler: AceEventHandler<T>): () => void

  /**
   * off — remove a handler for a specific event type.
   */
  off<T>(type: AceEventType, handler: AceEventHandler<T>): void
}

/**
 * makeAceEvent — convenience factory for creating typed Ace events.
 */
export function makeAceEvent<T>(
  type: AceEventType,
  principalId: string,
  payload: T,
  opts: { sessionId?: string; intentId?: string } = {},
): AceEvent<T> {
  return {
    type,
    principalId,
    payload,
    ts: new Date().toISOString(),
    ...opts,
  }
}
