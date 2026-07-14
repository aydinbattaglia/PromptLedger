// Content script — runs on billing/account pages to detect the user's current plan.
// Stores plan_rate_${tool} and plan_name_${tool} in chrome.storage.local on detection.
//
// Verified live 2026-07-14:
//   Runway  — app.runwayml.com/.../settings/billing shows "Subscription\n<Plan>"
//   ElevenLabs — elevenlabs.io/app/subscription shows "You're currently on <Plan> plan"
//   Midjourney — unverified (requires subscribed account)
// Text-based parsing is used as fallback when the anchor lines are missing.

import { KNOWN_PLANS, computeRate } from './data.js';
import type { ToolId } from '../types/index.js';

interface DetectedPlan {
  tool: ToolId;
  plan_name: string;
  credits_per_dollar: number;
  is_free?: boolean;
}

// Maps a plan name from page text to a KNOWN_PLANS entry for the tool.
function planByName(tool: ToolId, name: string): DetectedPlan | null {
  const plans = KNOWN_PLANS[tool] ?? {};
  const plan = plans[name.trim().toLowerCase()];
  if (!plan) return null;
  const isFree = plan.monthly_cost_usd === 0 || plan.credits_per_dollar === 0;
  return {
    tool,
    plan_name: plan.plan_name,
    credits_per_dollar: plan.credits_per_dollar,
    is_free: isFree,
  };
}

// ─── Runway ──────────────────────────────────────────────────────────────────

function detectRunway(): DetectedPlan | null {
  // Primary (2026-07 UI): the billing page shows a "Subscription" row whose
  // value is the bare plan name — "Subscription\nFree" / "Subscription\nStandard"
  const subM = document.body.innerText.match(
    /Subscription\s*\n\s*(Free|Standard|Pro|Max|Basic|Unlimited|Enterprise)\b/i,
  );
  if (subM) {
    const byName = planByName('runway', subM[1]!);
    if (byName) return byName;
  }

  // Fallback: selector-based active plan card (pre-2026-07 UI)
  const activeCard = document.querySelector(
    '[data-testid="current-plan"], [class*="currentPlan"], [class*="activePlan"], [aria-current="true"]',
  );
  const root = activeCard ?? document.body;

  const text = (root as HTMLElement).innerText ?? '';

  // Parse "2,250 credits" or "625 credits/month"
  const creditsM = text.match(/(\d[\d,]*)\s*credits?/i);
  // Parse "$35/month", "$35/mo", "35 USD/month"
  const costM = text.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:\/\s*mo(?:nth)?|per\s*mo(?:nth)?)/i)
    ?? text.match(/(\d+(?:\.\d+)?)\s*USD\s*\/\s*mo(?:nth)?/i);

  if (creditsM && costM) {
    const credits = parseInt(creditsM[1]!.replace(/,/g, ''), 10);
    const cost = parseFloat(costM[1]!);
    const rate = computeRate(credits, cost);
    if (rate !== null) {
      const nameM = text.match(/\b(Standard|Pro|Max|Basic|Unlimited)\b/i);
      return { tool: 'runway', plan_name: nameM?.[1] ?? 'Custom', credits_per_dollar: rate };
    }
  }

  // Fallback: match plan name in page text
  const fullText = document.body.innerText.toLowerCase();
  for (const [key, plan] of Object.entries(KNOWN_PLANS['runway'] ?? {})) {
    if (!fullText.includes(key)) continue;
    if (plan.credits_per_dollar > 0) {
      return { tool: 'runway', plan_name: plan.plan_name, credits_per_dollar: plan.credits_per_dollar };
    }
    if (plan.monthly_cost_usd === 0) {
      return { tool: 'runway', plan_name: plan.plan_name, credits_per_dollar: 0, is_free: true };
    }
  }

  return null;
}

// ─── ElevenLabs ──────────────────────────────────────────────────────────────

function detectElevenLabs(): DetectedPlan | null {
  // Primary (2026-07 UI): the subscription page states the active plan directly —
  // "You're currently on Free plan". The page also lists every OTHER plan's card,
  // so unanchored credits/$ regexes would match the wrong plan; only use them
  // when this anchor is missing.
  const currentM = document.body.innerText.match(/You'?re currently on ([\w ]+?) plan/i);
  if (currentM) {
    const byName = planByName('elevenlabs', currentM[1]!);
    if (byName) return byName;
  }

  // Fallback: selector-based active plan card (pre-2026-07 UI)
  const activeCard = document.querySelector(
    '[data-testid="current-plan"], [class*="currentPlan"], [class*="activePlan"], [class*="CurrentSubscription"]',
  );
  const root = activeCard ?? document.body;
  const text = (root as HTMLElement).innerText ?? '';

  // Parse "121k credits", "30,000 credits" (2026-07) or "30k characters" (legacy)
  const unitsKM = text.match(/(\d+(?:\.\d+)?)\s*k\s*(?:credits?|characters?|chars?)/i);
  const unitsM = !unitsKM && text.match(/(\d[\d,]*)\s*(?:credits?|characters?)/i);
  const costM = text.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:\/\s*mo(?:nth)?|per\s*mo(?:nth)?)/i);

  const units = unitsKM
    ? Math.round(parseFloat(unitsKM[1]!) * 1_000)
    : unitsM
    ? parseInt(unitsM[1]!.replace(/,/g, ''), 10)
    : 0;

  if (units > 0 && costM) {
    const cost = parseFloat(costM[1]!);
    const rate = computeRate(units, cost);
    if (rate !== null) {
      const nameM = text.match(/\b(Free|Starter|Creator|Pro|Scale|Business|Enterprise)\b/i);
      return { tool: 'elevenlabs', plan_name: nameM?.[1] ?? 'Custom', credits_per_dollar: rate };
    }
  }

  const fullText = document.body.innerText.toLowerCase();
  for (const [key, plan] of Object.entries(KNOWN_PLANS['elevenlabs'] ?? {})) {
    if (!fullText.includes(key)) continue;
    if (plan.credits_per_dollar > 0) {
      return { tool: 'elevenlabs', plan_name: plan.plan_name, credits_per_dollar: plan.credits_per_dollar };
    }
    if (plan.monthly_cost_usd === 0) {
      return { tool: 'elevenlabs', plan_name: plan.plan_name, credits_per_dollar: 0, is_free: true };
    }
  }

  return null;
}

// ─── Midjourney ──────────────────────────────────────────────────────────────

function detectMidjourney(): DetectedPlan | null {
  const activeCard = document.querySelector(
    '[data-testid="plan-info"], [class*="PlanInfo"], [class*="planInfo"], [class*="subscription"]',
  );
  const root = activeCard ?? document.body;
  const text = (root as HTMLElement).innerText ?? '';

  // Parse "15 fast GPU hours/month" or "15 hr"
  const hrsM = text.match(/(\d+(?:\.\d+)?)\s*(?:fast\s*)?(?:GPU\s*)?hours?/i)
    ?? text.match(/(\d+(?:\.\d+)?)\s*hr/i);
  const costM = text.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:\/\s*mo(?:nth)?|per\s*mo(?:nth)?)/i);

  if (hrsM && costM) {
    const hours = parseFloat(hrsM[1]!);
    const cost = parseFloat(costM[1]!);
    const rate = computeRate(hours, cost);
    if (rate !== null) {
      const nameM = text.match(/\b(Basic|Standard|Pro|Mega)\b/i);
      return { tool: 'midjourney', plan_name: nameM?.[1] ?? 'Custom', credits_per_dollar: rate };
    }
  }

  const fullText = document.body.innerText.toLowerCase();
  for (const [key, plan] of Object.entries(KNOWN_PLANS['midjourney'] ?? {})) {
    if (fullText.includes(key) && plan.credits_per_dollar > 0) {
      return { tool: 'midjourney', plan_name: plan.plan_name, credits_per_dollar: plan.credits_per_dollar };
    }
  }

  return null;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

function detect(): DetectedPlan | null {
  const host = location.hostname;
  if (host.includes('runwayml.com')) return detectRunway();
  if (host.includes('elevenlabs.io')) return detectElevenLabs();
  if (host.includes('midjourney.com')) return detectMidjourney();
  return null;
}

function savePlan(plan: DetectedPlan): void {
  chrome.storage.local.set({
    [`plan_rate_${plan.tool}`]: plan.is_free ? null : plan.credits_per_dollar,
    [`plan_name_${plan.tool}`]: plan.plan_name,
    [`plan_override_${plan.tool}`]: false,
    [`plan_is_free_${plan.tool}`]: plan.is_free ?? false,
    [`plan_detected_at_${plan.tool}`]: new Date().toISOString(),
  });
  console.debug(`[PromptLedger] Detected plan: ${plan.tool} ${plan.plan_name}${plan.is_free ? ' (free)' : ` (${plan.credits_per_dollar} cr/$)`}`);
}

// Run after DOM settles. SPA billing pages may still be fetching user data at
// document_idle, so keep retrying every 2 s (up to 5 tries) until detection succeeds.
let attempts = 0;
function tryDetect(): void {
  attempts += 1;
  const plan = detect();
  if (plan) {
    savePlan(plan);
  } else if (attempts < 5) {
    setTimeout(tryDetect, 2000);
  }
}
tryDetect();
