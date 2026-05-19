// Midjourney web adapter — charges Fast GPU hours.
// Complexity: Medium — GPU time units, SPA prompt submission.
// Target: midjourney.com (web app, NOT Discord bot).
//
// SELECTORS: verify against midjourney.com before shipping.
// The web UI changed significantly in 2024–2025; update SEL constants as needed.

import { registerAdapter } from './registry.js';
import { watchText, delegateClick } from '../util/dom-observer.js';
import type { Adapter, AdapterContext } from './types.js';

const SEL = {
  // Fast GPU hours remaining — e.g. "14.7 hr" or "14 hr 42 min"
  balance:
    '[data-testid="fast-hours-remaining"], [class*="FastHours"], [class*="fast-hours"], [aria-label*="fast hours" i]',
  // Prompt submission button — "Create", "Imagine", or submit icon
  generateBtn:
    'button[data-testid="create-button"], button[aria-label*="Create" i], button[aria-label*="Imagine" i], form[data-testid="prompt-form"] button[type="submit"]',
  // Text prompt input
  prompt:
    'textarea[data-testid="prompt-input"], input[data-testid="prompt-input"], [contenteditable="true"][data-testid*="prompt"]',
  // Active model or version label (e.g. "v7", "Niji 6")
  model:
    '[data-testid="model-version"], [class*="ModelVersion"], [data-testid="active-model"]',
} as const;

// Parse GPU hours from display strings like "14.7 hr", "14 hr 42 min", "876 min"
export function parseGpuHours(text: string): number {
  text = text.trim();
  // "X hr Y min"
  const hrMin = text.match(/(\d+(?:\.\d+)?)\s*hr\s*(\d+)\s*min/i);
  if (hrMin) return parseFloat(hrMin[1]!) + parseInt(hrMin[2]!, 10) / 60;
  // "X.Y hr"
  const hr = text.match(/(\d+(?:\.\d+)?)\s*hr/i);
  if (hr) return parseFloat(hr[1]!);
  // "X min"
  const min = text.match(/(\d+(?:\.\d+)?)\s*min/i);
  if (min) return parseFloat(min[1]!) / 60;
  // Plain number (assume hours)
  const plain = text.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return plain ? parseFloat(plain[0]!) : 0;
}

function makeIdempotent(fn: () => void): () => void {
  let called = false;
  return () => { if (!called) { called = true; fn(); } };
}

function createMidjourneyAdapter(): Adapter {
  const cleanups: Array<() => void> = [];

  return {
    tool: 'midjourney',

    mount(context: AdapterContext): void {
      cleanups.push(
        delegateClick(SEL.generateBtn, (_, event) => {
          if (context.isPaused()) return;

          const balanceBefore = parseGpuHours(
            document.querySelector(SEL.balance)?.textContent ?? '0',
          );

          const promptEl = document.querySelector(SEL.prompt);
          const prompt =
            promptEl instanceof HTMLInputElement || promptEl instanceof HTMLTextAreaElement
              ? promptEl.value
              : promptEl?.textContent ?? null;

          const modelEl = document.querySelector(SEL.model);

          const sessionKey = context.start({
            model: modelEl?.textContent?.trim() ?? 'unknown',
            prompt,
            balance_before: balanceBefore,
          });
          if (!sessionKey) return;

          // Midjourney image generation is near-instant on Fast mode;
          // watch for GPU hours to decrease within 3 minutes.
          const unwatch = makeIdempotent(
            watchText(SEL.balance, (current) => {
              const balanceAfter = parseGpuHours(current);
              if (balanceAfter < balanceBefore) {
                unwatch();
                clearTimeout(timeout);
                context.complete(sessionKey, { balance_after: balanceAfter });
              }
            }),
          );

          const timeout = setTimeout(() => {
            unwatch();
            context.complete(sessionKey, { balance_after: null });
          }, 3 * 60_000);

          cleanups.push(() => { unwatch(); clearTimeout(timeout); });
          void event; // suppress unused param warning
        }),
      );
    },

    unmount(): void {
      cleanups.forEach((c) => c());
      cleanups.length = 0;
    },
  };
}

registerAdapter('midjourney.com', createMidjourneyAdapter);
