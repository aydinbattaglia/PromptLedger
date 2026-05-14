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
  // Parse "$35/month" or "35 USD/month"
  const costM = text.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:\/\s*mo|per\s*mo)/i)
    ?? text.match(/(\d+(?:\.\d+)?)\s*USD\s*\/\s*mo/i);

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
    if (fullText.includes(key) && plan.credits_per_dollar > 0) {
      return { tool: 'runway', plan_name: plan.plan_name, credits_per_dollar: plan.credits_per_dollar };
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

  // Parse "30,000 characters/month" or "30k characters"
  const charsM = text.match(/(\d[\d,]*)\s*(?:k\s*)?characters?/i);
  const kM = !charsM && text.match(/(\d+)k\s*chars?/i);
  const costM = text.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:\/\s*mo|per\s*mo)/i);

  const chars = charsM
    ? parseInt(charsM[1]!.replace(/,/g, ''), 10)
    : kM
    ? parseInt(kM[1]!, 10) * 1_000
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
    if (fullText.includes(key) && plan.credits_per_dollar > 0) {
      return { tool: 'elevenlabs', plan_name: plan.plan_name, credits_per_dollar: plan.credits_per_dollar };
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
  const costM = text.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:\/\s*mo|per\s*mo)/i);

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

// Run after DOM settles; billing pages are SSR so content is ready at document_idle
const plan = detect();

if (plan) {
  chrome.storage.local.set({
    [`plan_rate_${plan.tool}`]: plan.credits_per_dollar,
    [`plan_name_${plan.tool}`]: plan.plan_name,
    [`plan_override_${plan.tool}`]: false,
    [`plan_detected_at_${plan.tool}`]: new Date().toISOString(),
  });
  console.debug(`[PromptLedger] Detected plan: ${plan.tool} ${plan.plan_name} (${plan.credits_per_dollar} cr/$)`);
}
