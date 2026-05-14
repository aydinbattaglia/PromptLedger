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
  // Credit balance in the top nav — typically "2,150" or "2,150 credits"
  balance:
    '[data-testid="credits-display"], [class*="CreditsDisplay"], [class*="creditsDisplay"], [data-testid="user-credits"]',
  // Generate / create button in the editor
  generateBtn:
    'button[data-testid="generate-button"], button[aria-label*="Generate" i][type="button"]:not([disabled])',
  // Prompt textarea in the editor
  prompt:
    'textarea[data-testid="prompt-input"], textarea[placeholder*="Describe" i], textarea[placeholder*="prompt" i]',
  // Active model label (e.g. "Gen-4 Turbo")
  model:
    '[data-testid="model-name"], [class*="ModelName"], [data-testid="model-selector"] [aria-selected="true"]',
  // Resolution / aspect ratio if shown
  resolution:
    '[data-testid="resolution-selector"] [aria-selected="true"], [class*="AspectRatio"] [class*="active"]',
} as const;

// URL patterns that Runway uses for their generation API
const RUNWAY_API = /runwayml\.com\/api|app\.runwayml\.com\/(api|v\d)/;

function parseCredits(text: string): number {
  const m = text.replace(/,/g, '').match(/\d+/);
  return m ? parseInt(m[0]!, 10) : 0;
}

function extractBalance(body: unknown): number | null {
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

      cleanups.push(
        delegateClick(SEL.generateBtn, () => {
          if (context.isPaused()) return;

          const domBefore = parseCredits(
            document.querySelector(SEL.balance)?.textContent ?? '0',
          );
          const balanceBefore = networkBalance ?? domBefore;

          const promptEl = document.querySelector(SEL.prompt) as HTMLTextAreaElement | null;
          const modelEl = document.querySelector(SEL.model);
          const resEl = document.querySelector(SEL.resolution);

          const sessionKey = context.start({
            model: modelEl?.textContent?.trim() ?? 'unknown',
            prompt: promptEl?.value ?? null,
            balance_before: balanceBefore,
          });
          if (!sessionKey) return;

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
              if (bal < balanceBefore) {
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
            interceptNetwork(RUNWAY_API, ({ body }) => {
              if (completed) return;
              const bal = extractBalance(body);
              if (bal !== null) {
                networkBalance = bal;
                if (bal < balanceBefore) {
                  finish();
                  context.complete(sessionKey, {
                    balance_after: bal,
                    resolution: resEl?.textContent?.trim(),
                  });
                }
              }
            }),
          );

          // Timeout: Runway video generation max ~5 min; complete with null balance if exceeded
          const timeout = setTimeout(() => {
            if (completed) return;
            finish();
            // Pass balanceBefore so SW sees delta=0 → credits_used=null → flagged=true
            context.complete(sessionKey, { balance_after: balanceBefore });
          }, 5 * 60_000);

          cleanups.push(() => { finish(); clearTimeout(timeout); });
        }),
      );
    },

    unmount(): void {
      cleanups.forEach((c) => c());
      cleanups.length = 0;
    },
  };
}

registerAdapter('runwayml.com', createRunwayAdapter);
