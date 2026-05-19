// Known plan configurations — used as fallback when DOM parsing fails.
// Rates change; DOM-computed rates are always preferred over these constants.
// Source: PRD Appendix A (2026-05).

import type { ToolId } from '../types/index.js';

export interface PlanInfo {
  tool: ToolId;
  plan_name: string;
  /** How many "credit units" one dollar buys for this tool. */
  credits_per_dollar: number;
  monthly_credits: number | null; // null = unlimited
  monthly_cost_usd: number | null; // null = free
}

export const KNOWN_PLANS: Record<string, Record<string, Omit<PlanInfo, 'tool'>>> = {
  runway: {
    basic:     { plan_name: 'Basic',     credits_per_dollar: 8.33,  monthly_credits: 125,  monthly_cost_usd: 15 },
    standard:  { plan_name: 'Standard',  credits_per_dollar: 41.67, monthly_credits: 625,  monthly_cost_usd: 15 },
    pro:       { plan_name: 'Pro',       credits_per_dollar: 64.29, monthly_credits: 2250, monthly_cost_usd: 35 },
    unlimited: { plan_name: 'Unlimited', credits_per_dollar: 0,     monthly_credits: null, monthly_cost_usd: 95 },
  },
  elevenlabs: {
    free:       { plan_name: 'Free',       credits_per_dollar: 0,     monthly_credits: 10_000,  monthly_cost_usd: 0  },
    starter:    { plan_name: 'Starter',    credits_per_dollar: 6_000, monthly_credits: 30_000,  monthly_cost_usd: 5  },
    creator:    { plan_name: 'Creator',    credits_per_dollar: 4_545, monthly_credits: 100_000, monthly_cost_usd: 22 },
    pro:        { plan_name: 'Pro',        credits_per_dollar: 5_051, monthly_credits: 500_000, monthly_cost_usd: 99 },
    enterprise: { plan_name: 'Enterprise', credits_per_dollar: 0,     monthly_credits: null,    monthly_cost_usd: null },
  },
  // Midjourney unit: Fast GPU hours. credits_per_dollar = GPU hours per dollar.
  midjourney: {
    basic:    { plan_name: 'Basic',    credits_per_dollar: 0.33, monthly_credits: 3.33, monthly_cost_usd: 10  },
    standard: { plan_name: 'Standard', credits_per_dollar: 0.5,  monthly_credits: 15,   monthly_cost_usd: 30  },
    pro:      { plan_name: 'Pro',      credits_per_dollar: 0.5,  monthly_credits: 30,   monthly_cost_usd: 60  },
    mega:     { plan_name: 'Mega',     credits_per_dollar: 0.5,  monthly_credits: 60,   monthly_cost_usd: 120 },
  },
};

/** Compute credits-per-dollar from raw allowance and monthly cost. Returns null for free/unlimited. */
export function computeRate(credits: number, costUsd: number): number | null {
  if (costUsd <= 0 || credits <= 0) return null;
  return parseFloat((credits / costUsd).toFixed(4));
}

/** Human-readable label for a plan dropdown option. */
export function planOptionLabel(tool: string, planKey: string): string {
  const plan = KNOWN_PLANS[tool]?.[planKey];
  if (!plan) return planKey;
  const { plan_name, credits_per_dollar, monthly_credits, monthly_cost_usd } = plan;
  if (monthly_cost_usd === 0) {
    const quota = monthly_credits ? formatQuota(tool, monthly_credits) : 'unlimited';
    return `${plan_name} — ${quota}/mo (free)`;
  }
  if (credits_per_dollar === 0) {
    const costStr = monthly_cost_usd !== null ? `$${monthly_cost_usd}/mo` : 'custom';
    return `${plan_name} — ${costStr} (usage only)`;
  }
  const quota = monthly_credits ? formatQuota(tool, monthly_credits) : '?';
  return `${plan_name} — ${quota}/mo · $${monthly_cost_usd}/mo`;
}

function formatQuota(tool: string, n: number): string {
  if (tool === 'midjourney') return `${n} hr`;
  if (tool === 'elevenlabs') return `${Math.round(n / 1_000)}k ch`;
  return n.toLocaleString() + ' cr';
}

/** Billing page URLs to open when plan is not yet configured. */
export const BILLING_URLS: Record<string, string> = {
  runway:     'https://app.runwayml.com/settings',
  elevenlabs: 'https://elevenlabs.io/subscription',
  midjourney: 'https://www.midjourney.com/account',
};
