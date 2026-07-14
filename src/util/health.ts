// Capture-health tracking — surfaces silent adapter breakage.
//
// The adapters scrape third-party UIs that change without notice (2026-07: all
// three drifted within seven weeks). When selectors break, captures silently
// stop or lose their cost data. The service worker records per-tool signals
// here, and the popup warns the user instead of failing silently.

export interface ToolHealth {
  /** ISO timestamp of the last GENERATION_START seen. */
  last_start: string | null;
  /** ISO timestamp of the last GENERATION_COMPLETE seen. */
  last_complete: string | null;
  /** ISO timestamp of the last completion that captured a real credit cost. */
  last_credit_capture: string | null;
  /** Outcomes of the most recent completions, newest last (true = cost captured). */
  recent: boolean[];
}

export type HealthStatus =
  | 'ok'
  /** Generations complete, but cost capture keeps failing (balance selectors broken). */
  | 'cost-blind'
  /** Generations start but never complete (completion detection broken / SW killed). */
  | 'capture-stalled'
  /** Nothing observed yet. */
  | 'no-data';

export const RECENT_WINDOW = 10;

/** A start with no completion after this long means completion detection failed
 *  (the longest adapter timeout is Runway's at 5 minutes). */
export const STALL_MS = 6 * 60_000;

export function emptyHealth(): ToolHealth {
  return { last_start: null, last_complete: null, last_credit_capture: null, recent: [] };
}

export function recordStart(h: ToolHealth, now: Date = new Date()): ToolHealth {
  return { ...h, last_start: now.toISOString() };
}

export function recordComplete(h: ToolHealth, costCaptured: boolean, now: Date = new Date()): ToolHealth {
  return {
    ...h,
    last_complete: now.toISOString(),
    last_credit_capture: costCaptured ? now.toISOString() : h.last_credit_capture,
    recent: [...h.recent, costCaptured].slice(-RECENT_WINDOW),
  };
}

export function assessHealth(h: ToolHealth, now: Date = new Date()): HealthStatus {
  if (!h.last_start && !h.last_complete) return 'no-data';

  // A start with no matching completion long past every adapter timeout
  const startMs = h.last_start ? Date.parse(h.last_start) : 0;
  const completeMs = h.last_complete ? Date.parse(h.last_complete) : 0;
  if (startMs > completeMs && now.getTime() - startMs > STALL_MS) return 'capture-stalled';

  // Cost capture failing: 3+ recent completions and none carried a credit cost
  const window = h.recent.slice(-3);
  if (window.length >= 3 && window.every((ok) => !ok)) return 'cost-blind';

  return 'ok';
}
