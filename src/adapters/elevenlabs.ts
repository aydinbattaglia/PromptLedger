// ElevenLabs adapter — charges per character of synthesised text.
// Complexity: Low (DOM observer only; no network parsing needed).
//
// SELECTORS: verified against elevenlabs.io as of 2026-05.
// Update only the SEL constants if the UI changes — no logic changes needed.

import { registerAdapter } from './registry.js';
import { watchText, delegateClick } from '../util/dom-observer.js';
import type { Adapter, AdapterContext } from './types.js';

const SEL = {
  // Character counter — typically reads "X / 5,000" or "X characters remaining"
  balance:
    '[data-testid="character-count"], [class*="CharacterCount"], [class*="character-count"]',
  // Primary generate / synthesise button
  generateBtn:
    'button[data-testid="generate-speech"], button[aria-label="Generate speech"], button[class*="generate" i]:not([disabled])',
  // TTS text input
  textArea:
    'textarea[data-testid="editor-input"], textarea[aria-label*="text" i], div[contenteditable="true"][data-testid]',
  // Selected voice model label
  model:
    '[data-testid="voice-model-name"], [class*="VoiceModelName"], [data-testid="model-selector"] [aria-selected="true"]',
} as const;

function parseChars(text: string): number {
  // Handles "1,234", "1,234 / 10,000", "1234 characters remaining"
  const m = text.replace(/,/g, '').match(/\d+/);
  return m ? parseInt(m[0]!, 10) : 0;
}

function makeIdempotent(fn: () => void): () => void {
  let called = false;
  return () => {
    if (!called) { called = true; fn(); }
  };
}

function createElevenLabsAdapter(): Adapter {
  const cleanups: Array<() => void> = [];

  return {
    tool: 'elevenlabs',

    mount(context: AdapterContext): void {
      cleanups.push(
        delegateClick(SEL.generateBtn, () => {
          if (context.isPaused()) return;

          const balanceBefore = parseChars(
            document.querySelector(SEL.balance)?.textContent ?? '0',
          );

          const textEl = document.querySelector(SEL.textArea);
          const prompt =
            textEl instanceof HTMLTextAreaElement
              ? textEl.value
              : textEl?.textContent ?? null;

          const modelEl = document.querySelector(SEL.model);

          const sessionKey = context.start({
            model: modelEl?.textContent?.trim() ?? 'unknown',
            prompt,
            balance_before: balanceBefore,
          });
          if (!sessionKey) return;

          // Watch the character counter for a decrease — that signals completion.
          // ElevenLabs generations complete in seconds; 60s covers all cases.
          const unwatch = makeIdempotent(
            watchText(SEL.balance, (current) => {
              const balanceAfter = parseChars(current);
              if (balanceAfter < balanceBefore) {
                unwatch();
                context.complete(sessionKey, { balance_after: balanceAfter });
              }
            }),
          );

          const timeout = setTimeout(unwatch, 60_000);
          cleanups.push(() => { unwatch(); clearTimeout(timeout); });
        }),
      );
    },

    unmount(): void {
      cleanups.forEach((c) => c());
      cleanups.length = 0;
    },
  };
}

registerAdapter('elevenlabs.io', createElevenLabsAdapter);
