// ElevenLabs adapter — charges per character of synthesised text.
// Complexity: Low (DOM observer only; no network parsing needed).
// Studio mode (/app/studio/*) uses audio element observation — no balance in DOM.
//
// SELECTORS: verified against elevenlabs.io as of 2026-07-14.
// Update only the SEL constants if the UI changes — no logic changes needed.
// (Exception: balance has no stable attributes in the 2026-07 UI, so
// findBalanceEl() adds a text-scan fallback.)

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
  // Account quota display. Older UI: "9,500 / 10,000" characters with testid/class
  // hooks. 2026-07 UI: a plain span "10,000 credits remaining" with NO stable
  // attributes — findBalanceEl() below falls back to a text scan for that case.
  // NOTE: [data-testid="character-count"] is the *input* text length, not account quota.
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
  // Primary generate / synthesise button (2026-07: data-testid="tts-generate",
  // aria-label "Generate speech ⌘+Enter" — hence the prefix match)
  generateBtn: [
    'button[data-testid="generate-speech"]',
    'button[aria-label^="Generate speech"]',
    'button[data-testid="tts-generate"]',
    'button[class*="GenerateSpeech" i]',
    'button[class*="generate-speech" i]',
  ].join(', '),
  // TTS text input (2026-07: div[contenteditable] with data-testid="tts-editor")
  textArea:
    'textarea[data-testid="editor-input"], textarea[aria-label*="text" i], div[contenteditable="true"][data-testid]',
  // Selected voice model label (2026-07: button[data-testid="tts-model-selector"],
  // text content is the model name, e.g. "Eleven Multilingual v2")
  model:
    '[data-testid="tts-model-selector"], [data-testid="voice-model-name"], [class*="VoiceModelName"], [data-testid="model-selector"] [aria-selected="true"]',
} as const;

// Balance text in the 2026-07 UI, e.g. "10,000 credits remaining".
// ElevenLabs rebranded character quota as "credits" (1 credit = 1 character for TTS);
// parseChars extracts the number either way, so the delta logic is unit-agnostic.
const BALANCE_TEXT_RE = /[\d,]+\s+(?:credits?|characters?)\s+remaining/i;

// Finds the quota element: attribute selectors first (older UI), then a leaf-node
// text scan (2026-07 UI has no stable attributes on the balance span).
export function findBalanceEl(): Element | null {
  const bySelector = document.querySelector(SEL.balance);
  if (bySelector) return bySelector;
  for (const el of document.querySelectorAll('span, div, p')) {
    if (el.childElementCount === 0 && BALANCE_TEXT_RE.test(el.textContent ?? '')) return el;
  }
  return null;
}

export function parseChars(text: string): number {
  // Handles "1,234", "1,234 / 10,000", "1234 characters remaining", "10,000 credits remaining"
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

          const balanceEl = findBalanceEl();
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
            const afterEl = findBalanceEl();
            const after = afterEl ? parseChars(afterEl.textContent ?? '0') : null;
            if (after === null || !hasQuota || after === balanceBefore) return null;
            return after < balanceBefore
              ? after
              : Math.max(0, balanceBefore - (after - balanceBefore));
          };

          // The 2026-07 UI does not refresh the quota display after a generation
          // (it only updates on page reload), so the DOM delta is usually
          // unavailable. Standard TTS charges exactly 1 credit per character of
          // submitted text (verified live 2026-07-14: 68 chars → 68 credits), so
          // derive the post-generation balance from the prompt length instead.
          const promptChars = prompt?.length ?? 0;
          const derivedBalance = (): number | null =>
            hasQuota && promptChars > 0
              ? Math.max(0, balanceBefore - promptChars)
              : null;

          // ── Path 1: quota counter changes (paid plans) ──
          let unwatchBalance = () => {};
          if (hasQuota) {
            unwatchBalance = makeIdempotent(
              watchText(findBalanceEl, (current) => {
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
            completeSession(readBalance() ?? derivedBalance());
          });
          audioObs.observe(document.body, {
            subtree: true, childList: true,
            attributes: true, attributeFilter: ['src'],
          });

          // ── Path 3: API response (most reliable — fires when synthesis completes) ──
          const unwatchNet = makeIdempotent(
            interceptNetwork(EL_API, () => {
              completeSession(readBalance() ?? derivedBalance());
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
