// Runway adapter — charges credits (1 credit ≈ $0.01–$0.024 depending on plan).
// Complexity: Medium — async video generation (30s–2min) + XHR balance updates.
//
// SELECTORS: verify against app.runwayml.com before shipping.
// When Runway updates their UI, update only the SEL constants below.

import { registerAdapter } from './registry.js';
import { watchText, delegateClick } from '../util/dom-observer.js';
import { interceptNetwork } from '../util/network-listener.js';
import type { Adapter, AdapterContext } from './types.js';

const SEL = {
  // Credit balance button — text like "290 credits" or "2,150 credits"
  balance:
    '[data-testid="credit-info-button"], [data-testid="credits-display"], [class*="CreditsDisplay"], [data-testid="user-credits"]',
  // Primary Generate button — no testid/aria in current UI; falls back to aria match for older UI
  generateBtn:
    'button[class*="primaryBlue"], button[data-testid="generate-button"], button[aria-label*="Generate" i][type="button"]:not([disabled])',
  // Prompt textarea or contenteditable div in the editor
  prompt:
    'textarea[data-testid="prompt-input"], textarea[placeholder*="Describe" i], textarea[placeholder*="prompt" i], [data-testid="prompt-input"][contenteditable], [contenteditable="true"][aria-label*="prompt" i], [contenteditable="true"][aria-label*="Describe" i]',
  // Active model label (e.g. "Gen-4 Turbo")
  model:
    '[data-testid="select-base-model"], [data-testid="model-name"], [class*="ModelName"]',
  // Resolution / aspect ratio button
  resolution:
    'button[aria-label="Aspect ratio"], [data-testid="resolution-selector"] [aria-selected="true"]',
} as const;

// URL patterns that Runway uses for their generation API
const RUNWAY_API = /runwayml\.com/;

export function parseCredits(text: string): number {
  const m = text.replace(/,/g, '').match(/\d+/);
  return m ? parseInt(m[0]!, 10) : 0;
}

export function extractBalance(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  for (const key of ['credits', 'remainingCredits', 'credit_balance', 'balance', 'creditsRemaining']) {
    if (typeof b[key] === 'number') return b[key] as number;
  }
  // Nested: { user: { credits: N } } or { data: { credits: N } }
  for (const key of ['user', 'data', 'account']) {
    if (b[key] && typeof b[key] === 'object') {
      const nested = extractBalance(b[key]);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function makeIdempotent(fn: () => void): () => void {
  let called = false;
  return () => { if (!called) { called = true; fn(); } };
}

function createRunwayAdapter(): Adapter {
  const cleanups: Array<() => void> = [];
  // Most recent balance reported by API (more reliable than DOM parsing)
  let networkBalance: number | null = null;

  return {
    tool: 'runway',

    mount(context: AdapterContext): void {
      // Keep networkBalance in sync with API responses at all times
      cleanups.push(
        interceptNetwork(RUNWAY_API, ({ body }) => {
          const bal = extractBalance(body);
          if (bal !== null) networkBalance = bal;
        }),
      );

      const startGeneration = () => {
        if (context.isPaused()) { console.debug('[PL] runway: paused, skipping'); return; }

        const balEl = document.querySelector(SEL.balance);
        const domBefore = parseCredits(balEl?.textContent ?? '0');
        const balanceBefore = networkBalance ?? domBefore;

        const promptEl = document.querySelector(SEL.prompt) as HTMLElement | null;
        const modelEl = document.querySelector(SEL.model);
        const resEl = document.querySelector(SEL.resolution);

        const promptText =
          promptEl instanceof HTMLTextAreaElement
            ? promptEl.value || null
            : promptEl?.textContent?.trim() || null;

        console.debug('[PL] runway: generation started', {
          balanceBefore, prompt: promptText,
          model: modelEl?.textContent?.trim(),
          balanceElFound: !!balEl, promptElFound: !!promptEl,
        });

        const sessionKey = context.start({
          model: modelEl?.textContent?.trim() ?? 'unknown',
          prompt: promptText,
          balance_before: balanceBefore,
        });
        if (!sessionKey) { console.debug('[PL] runway: context.start returned empty key'); return; }

        let completed = false;

        const finish = makeIdempotent(() => {
          completed = true;
          unwatchDom();
          unwatchNet();
          clearTimeout(timeout);
        });

        // Path 1: DOM balance drops
        const unwatchDom = makeIdempotent(
          watchText(SEL.balance, (current) => {
            if (completed) return;
            const bal = parseCredits(current);
            console.debug('[PL] runway: DOM balance changed', { current, bal, balanceBefore });
            if (bal < balanceBefore) {
              console.debug('[PL] runway: completing via DOM path', { balance_after: networkBalance ?? bal });
              finish();
              context.complete(sessionKey, {
                balance_after: networkBalance ?? bal,
                resolution: resEl?.textContent?.trim(),
              });
            }
          }),
        );

        // Path 2: API response carries updated balance before DOM updates
        const unwatchNet = makeIdempotent(
          interceptNetwork(RUNWAY_API, ({ url, body }) => {
            if (completed) return;
            const bal = extractBalance(body);
            console.debug('[PL] runway: API response', { url, bal, balanceBefore });
            if (bal !== null) {
              networkBalance = bal;
              if (bal < balanceBefore) {
                console.debug('[PL] runway: completing via network path', { balance_after: bal });
                finish();
                context.complete(sessionKey, {
                  balance_after: bal,
                  resolution: resEl?.textContent?.trim(),
                });
              }
            }
          }),
        );

        // Timeout: Runway video generation max ~5 min; null signals "cost unknown → flag"
        const timeout = setTimeout(() => {
          if (completed) return;
          console.debug('[PL] runway: timed out, completing with null balance');
          finish();
          context.complete(sessionKey, { balance_after: null });
        }, 5 * 60_000);

        cleanups.push(() => { finish(); clearTimeout(timeout); });
      };

      cleanups.push(delegateClick(SEL.generateBtn, startGeneration));

      // Enter key in the prompt field also submits on Runway
      const keyHandler = (event: Event) => {
        const ke = event as KeyboardEvent;
        if (ke.key !== 'Enter' || ke.shiftKey) return;
        const target = ke.target as Element | null;
        if (!target?.closest(SEL.prompt)) return;
        startGeneration();
      };
      document.addEventListener('keydown', keyHandler, true);
      cleanups.push(() => document.removeEventListener('keydown', keyHandler, true));
    },

    unmount(): void {
      cleanups.forEach((c) => c());
      cleanups.length = 0;
    },
  };
}

registerAdapter('runwayml.com', createRunwayAdapter);
