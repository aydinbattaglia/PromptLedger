// Content script — runs on billing/account pages to detect the user's current plan.
// Stores plan_rate_${tool} and plan_name_${tool} in chrome.storage.local on detection.
//
// SELECTORS: verified as of 2026-05. Update the detect*() functions if UIs change.
// Text-based parsing is used as fallback when selector-based detection fails.

import { KNOWN_PLANS, computeRate } from './data.js';
import type { ToolId } from '../types/index.js';

interface DetectedPlan {
  tool: ToolId;
  plan_name: string;
  credits_per_dollar: number;
  is_free?: boolean;
}

// ─── Runway ──────────────────────────────────────────────────────────────────

function detectRunway(): DetectedPlan | null {
  // Try selector-based: look for active/current plan card
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
      const nameM = text.match(/\b(Basic|Standard|Pro|Unlimited)\b/i);
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
  const activeCard = document.querySelector(
    '[data-testid="current-plan"], [class*="currentPlan"], [class*="activePlan"], [class*="CurrentSubscription"]',
  );
  const root = activeCard ?? document.body;
  const text = (root as HTMLElement).innerText ?? '';

  // Parse "30,000 characters/month", "30k characters", or "30k chars"
  const charsKM = text.match(/(\d+(?:\.\d+)?)\s*k\s*(?:characters?|chars?)/i);
  const charsM = !charsKM && text.match(/(\d[\d,]*)\s*characters?/i);
  const costM = text.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:\/\s*mo(?:nth)?|per\s*mo(?:nth)?)/i);

  const chars = charsKM
    ? Math.round(parseFloat(charsKM[1]!) * 1_000)
    : charsM
    ? parseInt(charsM[1]!.replace(/,/g, ''), 10)
    : 0;

  if (chars > 0 && costM) {
    const cost = parseFloat(costM[1]!);
    const rate = computeRate(chars, cost);
    if (rate !== null) {
      const nameM = text.match(/\b(Free|Starter|Creator|Pro|Enterprise)\b/i);
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

// Run after DOM settles. SPA billing pages (Runway, Midjourney) may still be
// fetching user data at document_idle, so retry once after 2 s if first pass fails.
const initial = detect();
if (initial) {
  savePlan(initial);
} else {
  setTimeout(() => {
    const retried = detect();
    if (retried) savePlan(retried);
  }, 2000);
}
