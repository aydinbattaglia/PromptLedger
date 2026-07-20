// ElevenLabs adapter — charges per character of synthesised text (1 credit = 1 char).
//
// Two capture surfaces share one flow (see Surface + captureGeneration):
//   - Text to Speech  (/app/speech-synthesis/*)
//   - Studio audio    (/app/studio/<project>) — the long-form editor
// Both expose the same "N credits remaining" balance, a generate button, an
// editable prompt, and the same completion signals (balance change, new audio
// element, or synthesis API response). They differ only in selectors.
//
// SELECTORS: verified against elevenlabs.io as of 2026-07-17.
// Balance has no stable attributes in the 2026-07 UI, so findBalanceEl() falls
// back to a text scan. The Studio "Generate" button has no attributes either, so
// it is matched by text via the surface's isGenerateButton guard.

import { registerAdapter } from './registry.js';
import { watchText, delegateClick } from '../util/dom-observer.js';
import { interceptNetwork } from '../util/network-listener.js';
import type { Adapter, AdapterContext } from './types.js';

// Matches api.elevenlabs.io synthesis endpoints
const EL_API = /elevenlabs\.io/;

// A capture surface: how to find the controls on one ElevenLabs page type.
interface Surface {
  name: string;
  /** CSS selector for the generate button. May over-match when the button has
   *  no stable attributes — isGenerateButton then confirms each click. */
  generateBtn: string;
  isGenerateButton?: (el: Element) => boolean;
  /** CSS selector for the text input (textarea or contenteditable). */
  prompt: string;
  /** CSS selector for the model label, or null when the surface has none. */
  model: string | null;
  /** Model name to record when `model` is null or not found. */
  defaultModel: string;
  /** How long to wait for a completion signal before recording cost unknown. */
  timeoutMs: number;
}

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
  // TTS generate button (2026-07: data-testid="tts-generate",
  // aria-label "Generate speech ⌘+Enter" — hence the prefix match)
  ttsGenerateBtn: [
    'button[data-testid="generate-speech"]',
    'button[aria-label^="Generate speech"]',
    'button[data-testid="tts-generate"]',
    'button[class*="GenerateSpeech" i]',
    'button[class*="generate-speech" i]',
  ].join(', '),
  // TTS text input (2026-07: div[contenteditable] with data-testid="tts-editor")
  ttsPrompt:
    'textarea[data-testid="editor-input"], textarea[data-testid="tts-editor"], textarea[aria-label*="text" i], div[contenteditable="true"][data-testid]',
  // TTS model label (2026-07: button[data-testid="tts-model-selector"],
  // text content is the model name, e.g. "Eleven Multilingual v2")
  ttsModel:
    '[data-testid="tts-model-selector"], [data-testid="voice-model-name"], [class*="VoiceModelName"], [data-testid="model-selector"] [aria-selected="true"]',
} as const;

// Text to Speech page.
const TTS_SURFACE: Surface = {
  name: 'tts',
  generateBtn: SEL.ttsGenerateBtn,
  prompt: SEL.ttsPrompt,
  model: SEL.ttsModel,
  defaultModel: 'unknown',
  timeoutMs: 60_000,
};

// Studio audio editor (/app/studio/<project>). 2026-07: the "Generate" button has
// no attributes (matched by exact text), the prompt is a TipTap ProseMirror
// contenteditable, and the model label is a plain div with no stable hook.
const STUDIO_SURFACE: Surface = {
  name: 'studio',
  generateBtn: 'button',
  isGenerateButton: (el) => el.textContent?.trim() === 'Generate',
  prompt: '.tiptap.ProseMirror, div[contenteditable="true"]',
  model: null,
  defaultModel: 'Studio',
  timeoutMs: 3 * 60_000,
};

// Balance text in the 2026-07 UI, e.g. "10,000 credits remaining".
// ElevenLabs rebranded character quota as "credits" (1 credit = 1 character);
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

// Shared capture flow for both surfaces: read the balance and prompt, then
// complete on the first of three signals (balance change, new audio element,
// synthesis API response), falling back to prompt length when the balance
// display does not refresh (the 2026-07 UI updates it only on reload).
function captureGeneration(
  context: AdapterContext,
  cleanups: Array<() => void>,
  surface: Surface,
): void {
  if (context.isPaused()) return;

  const balanceEl = findBalanceEl();
  const balanceBefore = balanceEl ? parseChars(balanceEl.textContent ?? '0') : 0;
  const hasQuota = balanceEl !== null && balanceBefore > 0;

  const textEl = document.querySelector(surface.prompt);
  const prompt =
    textEl instanceof HTMLTextAreaElement ? textEl.value : textEl?.textContent ?? null;

  const modelEl = surface.model ? document.querySelector(surface.model) : null;
  const model = modelEl?.textContent?.trim() || surface.defaultModel;

  console.debug(`[PL] el-${surface.name}: generation started`, { balanceBefore, model });

  const sessionKey = context.start({ model, prompt, balance_before: balanceBefore });
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

  // The 2026-07 UI does not refresh the quota display after a generation (it
  // only updates on page reload), so the DOM delta is usually unavailable.
  // TTS/Studio charge 1 credit per character of submitted text (verified live
  // 2026-07-14: 68 chars → 68 credits), so derive the balance from prompt length.
  const promptChars = prompt?.length ?? 0;
  const derivedBalance = (): number | null =>
    hasQuota && promptChars > 0 ? Math.max(0, balanceBefore - promptChars) : null;

  // ── Path 1: quota counter changes (paid plans that do refresh) ──
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

  // ── Path 2: NEW audio element appears ──
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

  // ── Path 3: synthesis API response ──
  const unwatchNet = makeIdempotent(
    interceptNetwork(EL_API, ({ url }) => {
      if (surface.name === 'studio' && !/content\/generations|studio|chapter/i.test(url)) return;
      completeSession(readBalance() ?? derivedBalance());
    }),
  );

  const timeout = setTimeout(() => completeSession(null), surface.timeoutMs);

  cleanups.push(() => { completeSession(null); clearTimeout(timeout); });
}

function createElevenLabsAdapter(): Adapter {
  const cleanups: Array<() => void> = [];

  return {
    tool: 'elevenlabs',

    mount(context: AdapterContext): void {
      const surface = location.pathname.startsWith('/app/studio')
        ? STUDIO_SURFACE
        : TTS_SURFACE;

      cleanups.push(
        delegateClick(surface.generateBtn, (el) => {
          if (surface.isGenerateButton && !surface.isGenerateButton(el)) return;
          captureGeneration(context, cleanups, surface);
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
