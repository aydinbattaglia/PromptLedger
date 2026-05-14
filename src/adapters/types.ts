import type { ToolId } from '../types/index.js';

export interface AdapterContext {
  /**
   * Fire GENERATION_START. Returns a session key to pass to complete().
   * Returns an empty string if logging is paused — complete() treats '' as a no-op.
   */
  start(opts: { model?: string; prompt: string | null; balance_before: number }): string;

  /** Fire GENERATION_COMPLETE. No-op if sessionKey is empty (paused).
   *  Pass balance_after: null when the generation timed out and cost is unknown. */
  complete(
    sessionKey: string,
    opts: {
      balance_after: number | null;
      generation_id?: string;
      duration_sec?: number;
      resolution?: string;
    },
  ): void;

  isPaused(): boolean;
}

export interface Adapter {
  readonly tool: ToolId;
  /** Set up DOM observers, network listeners, and click handlers. */
  mount(context: AdapterContext): void;
  /** Tear down all listeners. Called on page unload or adapter swap. */
  unmount(): void;
}

export type AdapterFactory = () => Adapter;
