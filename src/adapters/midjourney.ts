// Midjourney web adapter — charges Fast GPU hours.
// Complexity: Medium — GPU time units, SPA prompt submission.
// Target: midjourney.com (web app, NOT Discord bot).
//
// STATUS: EXPERIMENTAL — this adapter does not currently capture generations.
// Verified on a subscribed Basic account 2026-07-17:
//   - The web app has NO generate button and NO <form>: generation is submitted
//     with the ENTER key on the prompt input. delegateClick(generateBtn) never
//     fires, so nothing below runs. A rewrite must hook the Enter key instead.
//   - Remaining Fast hours ("3h 20m / 3h 20m") appear ONLY on /account, never on
//     the create page — so a per-prompt balance delta cannot be read at gen time.
//     A viable rewrite would intercept MJ's job-submit API and reconcile GPU time
//     from /account separately.
//   - parseGpuHours also needs to handle the "3h 20m" (h/m) format, not just hr/min.
//   - The app uses NO data-testid attributes; only the prompt (#desktop_input_bar)
//     has a stable hook. Model version ("8.1") shows only in the open settings panel.
// Midjourney is flagged via EXPERIMENTAL_TOOLS (src/types) and surfaced as such in
// onboarding/help. The adapter stays registered so the plan detector still runs.

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
  // Text prompt input — #desktop_input_bar verified live 2026-07-14
  prompt:
    'textarea#desktop_input_bar, textarea[data-testid="prompt-input"], input[data-testid="prompt-input"], [contenteditable="true"][data-testid*="prompt"]',
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
