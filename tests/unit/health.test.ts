import { describe, it, expect } from 'vitest';
import {
  emptyHealth,
  recordStart,
  recordComplete,
  assessHealth,
  RECENT_WINDOW,
  STALL_MS,
} from '../../src/util/health.js';

const T0 = new Date('2026-07-14T12:00:00Z');
const after = (ms: number) => new Date(T0.getTime() + ms);

describe('recordStart / recordComplete', () => {
  it('records start timestamp', () => {
    const h = recordStart(emptyHealth(), T0);
    expect(h.last_start).toBe(T0.toISOString());
    expect(h.last_complete).toBeNull();
  });

  it('records completion with cost capture', () => {
    const h = recordComplete(emptyHealth(), true, T0);
    expect(h.last_complete).toBe(T0.toISOString());
    expect(h.last_credit_capture).toBe(T0.toISOString());
    expect(h.recent).toEqual([true]);
  });

  it('completion without cost does not update last_credit_capture', () => {
    const h = recordComplete(emptyHealth(), false, T0);
    expect(h.last_credit_capture).toBeNull();
    expect(h.recent).toEqual([false]);
  });

  it('caps the recent window', () => {
    let h = emptyHealth();
    for (let i = 0; i < RECENT_WINDOW + 5; i++) h = recordComplete(h, true, T0);
    expect(h.recent).toHaveLength(RECENT_WINDOW);
  });
});

describe('assessHealth', () => {
  it('reports no-data with no observations', () => {
    expect(assessHealth(emptyHealth(), T0)).toBe('no-data');
  });

  it('reports ok for a healthy capture cycle', () => {
    let h = recordStart(emptyHealth(), T0);
    h = recordComplete(h, true, after(5_000));
    expect(assessHealth(h, after(10_000))).toBe('ok');
  });

  it('reports ok while a generation is still in flight', () => {
    const h = recordStart(emptyHealth(), T0);
    expect(assessHealth(h, after(60_000))).toBe('ok');
  });

  it('reports capture-stalled when a start never completes', () => {
    const h = recordStart(emptyHealth(), T0);
    expect(assessHealth(h, after(STALL_MS + 1_000))).toBe('capture-stalled');
  });

  it('reports cost-blind after 3 consecutive costless completions', () => {
    let h = emptyHealth();
    for (let i = 0; i < 3; i++) {
      h = recordStart(h, T0);
      h = recordComplete(h, false, after(1_000));
    }
    expect(assessHealth(h, after(10_000))).toBe('cost-blind');
  });

  it('does not report cost-blind with fewer than 3 completions', () => {
    let h = recordStart(emptyHealth(), T0);
    h = recordComplete(h, false, after(1_000));
    h = recordComplete(h, false, after(2_000));
    expect(assessHealth(h, after(10_000))).toBe('ok');
  });

  it('recovers to ok when a recent completion captures cost', () => {
    let h = emptyHealth();
    h = recordComplete(h, false, T0);
    h = recordComplete(h, false, T0);
    h = recordComplete(h, false, T0);
    h = recordComplete(h, true, after(1_000));
    expect(assessHealth(h, after(10_000))).toBe('ok');
  });
});
