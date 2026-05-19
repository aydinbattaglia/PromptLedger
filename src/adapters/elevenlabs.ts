// ElevenLabs adapter — charges per character of synthesised text.
// Complexity: Low (DOM observer only; no network parsing needed).
// Studio mode (/app/studio/*) uses audio element observation — no balance in DOM.
//
// SELECTORS: verified against elevenlabs.io as of 2026-05.
// Update only the SEL constants if the UI changes — no logic changes needed.

import { registerAdapter } from './registry.js';
import { watchText, delegateClick } from '../util/dom-observer.js';
import { interceptNetwork } from '../util/network-listener.js';
import type { Adapter, AdapterContext } from './types.js';

// Matches api.elevenlabs.io TTS synthesis endpoints
const EL_API = /elevenlabs\.io/;

// Studio selectors (elevenlabs.io/app/studio/*)
const STUDIO = {
  generateBtn: 'button[aria-label="Send"]',
  prompt: '[aria-label="Edit field"]',
} as const;

const SEL = {
  // Monthly character quota — "9,500 / 10,000" (remaining) or "500 / 10,000" (used)
  // NOTE: [data-testid="character-count"] is the *input* text length, not account quota.
  // These selectors target the account quota display instead.
  balance: [
    '[data-testid="characters-remaining"]',
    '[data-testid="quota-remaining"]',
    '[data-testid="monthly-quota"]',
    '[class*="MonthlyQuota"]',
    '[class*="monthly-quota"]',
    '[class*="CharactersRemaining"]',
    '[class*="characters-remaining"]',
    '[aria-label*="characters remaining" i]',
    '[aria-label*="monthly quota" i]',
  ].join(', '),
  // Primary generate / synthesise button
  generateBtn: [
    'button[data-testid="generate-speech"]',
    'button[aria-label="Generate speech"]',
    'button[data-testid="tts-generate"]',
    'button[class*="GenerateSpeech" i]',
    'button[class*="generate-speech" i]',
  ].join(', '),
  // TTS text input
  textArea:
    'textarea[data-testid="editor-input"], textarea[aria-label*="text" i], div[contenteditable="true"][data-testid]',
  // Selected voice model label
  model:
    '[data-testid="voice-model-name"], [class*="VoiceModelName"], [data-testid="model-selector"] [aria-selected="true"]',
} as const;

export function parseChars(text: string): number {
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

function mountStudio(context: AdapterContext, cleanups: Array<() => void>): void {
  const startGeneration = () => {
    if (context.isPaused()) { console.debug('[PL] el-studio: paused, skipping'); return; }

    const promptEl = document.querySelector(STUDIO.prompt);
    const promptText = promptEl?.textContent?.trim() || null;

    console.debug('[PL] el-studio: generation started', { prompt: promptText });

    const sessionKey = context.start({ model: 'Studio', prompt: promptText, balance_before: null });
    if (!sessionKey) return;

    let completed = false;

    const existingAudioSrcs = new Set(
      Array.from(document.querySelectorAll<HTMLAudioElement>('audio[src]')).map((a) => a.src),
    );

    const finish = () => {
      if (completed) return;
      completed = true;
      audioObs.disconnect();
      unwatchNet();
      clearTimeout(timeout);
    };

    const completeSession = (balanceAfter: number | null) => {
      finish();
      context.complete(sessionKey, { balance_after: balanceAfter });
    };

    // Path 1: new audio element appears in the timeline
    const audioObs = new MutationObserver(() => {
      if (completed) { audioObs.disconnect(); return; }
      const audio = document.querySelector<HTMLAudioElement>('audio[src]:not([src=""])');
      if (!audio?.src || existingAudioSrcs.has(audio.src)) return;
      console.debug('[PL] el-studio: completing via audio element');
      completeSession(null);
    });
    audioObs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });

    // Path 2: any ElevenLabs API response fires after the generation
    const unwatchNet = interceptNetwork(EL_API, ({ url }) => {
      if (completed || !/content\/generations/.test(url)) return;
      console.debug('[PL] el-studio: completing via network', { url });
      completeSession(null);
    });

    const timeout = setTimeout(() => {
      console.debug('[PL] el-studio: timed out');
      completeSession(null);
    }, 3 * 60_000);

    cleanups.push(() => { finish(); clearTimeout(timeout); });
  };

  cleanups.push(delegateClick(STUDIO.generateBtn, startGeneration));

  const keyHandler = (event: Event) => {
    const ke = event as KeyboardEvent;
    if (ke.key !== 'Enter' || ke.shiftKey) return;
    const target = ke.target as Element | null;
    if (!target?.closest(STUDIO.prompt)) return;
    startGeneration();
  };
  document.addEventListener('keydown', keyHandler, true);
  cleanups.push(() => document.removeEventListener('keydown', keyHandler, true));
}

function createElevenLabsAdapter(): Adapter {
  const cleanups: Array<() => void> = [];

  return {
    tool: 'elevenlabs',

    mount(context: AdapterContext): void {
      // Studio pages use a different UI — delegate to Studio handler
      if (location.pathname.startsWith('/app/studio')) {
        mountStudio(context, cleanups);
        return;
      }

      cleanups.push(
        delegateClick(SEL.generateBtn, () => {
          if (context.isPaused()) return;

          const balanceEl = document.querySelector(SEL.balance);
          const balanceBefore = balanceEl ? parseChars(balanceEl.textContent ?? '0') : 0;
          const hasQuota = balanceEl !== null && balanceBefore > 0;

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

          let completed = false;

          // Snapshot existing audio sources so the observer only reacts to NEW ones
          const existingAudioSrcs = new Set(
            Array.from(document.querySelectorAll<HTMLAudioElement>('audio[src]')).map((a) => a.src),
          );

          const completeSession = (balanceAfter: number | null) => {
            if (completed) return;
            completed = true;
            unwatchBalance();
            audioObs.disconnect();
            unwatchNet();
            clearTimeout(timeout);
            context.complete(sessionKey, { balance_after: balanceAfter });
          };

          const readBalance = (): number | null => {
            const afterEl = document.querySelector(SEL.balance);
            const after = afterEl ? parseChars(afterEl.textContent ?? '0') : null;
            if (after === null || !hasQuota || after === balanceBefore) return null;
            return after < balanceBefore
              ? after
              : Math.max(0, balanceBefore - (after - balanceBefore));
          };

          // ── Path 1: quota counter changes (paid plans) ──
          let unwatchBalance = () => {};
          if (hasQuota) {
            unwatchBalance = makeIdempotent(
              watchText(SEL.balance, (current) => {
                const after = parseChars(current);
                if (after === balanceBefore) return;
                const normalised = after < balanceBefore
                  ? after
                  : Math.max(0, balanceBefore - (after - balanceBefore));
                completeSession(normalised);
              }),
            );
          }

          // ── Path 2: NEW audio element appears (free plans + reliable fallback) ──
          const audioObs = new MutationObserver(() => {
            if (completed) { audioObs.disconnect(); return; }
            const audio = document.querySelector<HTMLAudioElement>('audio[src]:not([src=""])');
            if (!audio?.src || existingAudioSrcs.has(audio.src)) return;
            completeSession(readBalance());
          });
          audioObs.observe(document.body, {
            subtree: true, childList: true,
            attributes: true, attributeFilter: ['src'],
          });

          // ── Path 3: API response (most reliable — fires when synthesis completes) ──
          const unwatchNet = makeIdempotent(
            interceptNetwork(EL_API, () => {
              completeSession(readBalance());
            }),
          );

          const timeout = setTimeout(() => {
            completeSession(null);
          }, 60_000);

          cleanups.push(() => { completeSession(null); clearTimeout(timeout); });
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
