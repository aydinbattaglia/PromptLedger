import { saveRecord, getToolSpend } from '../storage/idb.js';
import { CURRENCY_META, type CurrencyCode } from '../util/currency.js';
import type { ExtensionMessage, GenerationRecord, ToolId } from '../types/index.js';

interface InFlightEntry {
  partial: Partial<Omit<GenerationRecord, 'id'>>;
  balance_before: number;
}

// Lost if SW is killed between GENERATION_START and GENERATION_COMPLETE.
// Future: persist via chrome.storage.session for durability.
const inFlight = new Map<string, InFlightEntry>();

// Hard ceiling on credits per single generation, per tool (PRD §F-02)
const TOOL_CREDIT_CAPS: Record<string, number> = {
  runway: 2_500,       // ~$60 at Standard plan — well above any real generation
  midjourney: 60,      // 60 GPU hours would be extreme; real jobs are <1 hr
  elevenlabs: 100_000, // 100k chars is beyond any single request limit
  pika: 2_500,
  udio: 2_500,
};

const RATE_CURRENCIES = ['EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'MXN'];

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') });
  }
  void fetchExchangeRates();
  chrome.alarms.create('refresh-rates', { periodInMinutes: 1440 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refresh-rates') void fetchExchangeRates();
});

async function fetchExchangeRates(): Promise<void> {
  try {
    const symbols = RATE_CURRENCIES.join(',');
    const res = await fetch(`https://api.frankfurter.app/latest?from=USD&to=${symbols}`);
    if (!res.ok) return;
    const data = await res.json() as { rates: Record<string, number> };
    const rates: Record<string, number> = { USD: 1, ...data.rates };
    await new Promise<void>((resolve) =>
      chrome.storage.local.set({ exchange_rates: rates, exchange_rates_updated: new Date().toISOString() }, resolve),
    );
  } catch {
    // Keep stale rates on failure
  }
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    handleMessage(message)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error('[PromptLedger SW]', err);
        sendResponse({ ok: false });
      });
    return true; // async response
  },
);

async function handleMessage(message: ExtensionMessage): Promise<void> {
  if (message.type === 'GENERATION_START') {
    const { session_key, tool, model, prompt, balance_before } = message.payload;
    inFlight.set(session_key, {
      partial: {
        tool,
        model: model ?? 'unknown',
        prompt,
        plan_rate: await getPlanRate(tool),
        timestamp: new Date().toISOString(),
      },
      balance_before,
    });
    return;
  }

  if (message.type === 'GENERATION_COMPLETE') {
    const { session_key, tool, balance_after, generation_id, duration_sec, resolution } =
      message.payload;

    const entry = inFlight.get(session_key);
    inFlight.delete(session_key);

    const credits_used =
      entry !== undefined && balance_after !== null
        ? Math.max(0, entry.balance_before - balance_after)
        : null;

    const plan_rate = entry?.partial.plan_rate ?? null;
    const cost_usd =
      credits_used !== null && plan_rate !== null
        ? parseFloat((credits_used / plan_rate).toFixed(4))
        : null;

    const flagged =
      credits_used !== null && !(await isValidDelta(tool, credits_used));

    const record: GenerationRecord = {
      id: crypto.randomUUID(),
      timestamp: entry?.partial.timestamp ?? new Date().toISOString(),
      tool,
      model: entry?.partial.model ?? 'unknown',
      prompt: entry?.partial.prompt ?? null,
      credits_used: flagged ? null : credits_used,
      cost_usd: flagged ? null : cost_usd,
      plan_rate,
      project_tag: await getActiveProject(),
      duration_sec: duration_sec ?? null,
      resolution: resolution ?? null,
      generation_id: generation_id ?? null,
      flagged,
    };

    await saveRecord(record);

    if (!flagged && credits_used !== null && credits_used > 0) {
      await updateRunningAverage(tool, credits_used);
    }

    void checkBudgets(tool);
  }
}

// ── Budget alerts ─────────────────────────────────────────────────────────────

async function checkBudgets(tool: ToolId): Promise<void> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const dateKey = now.toISOString().slice(0, 10);
  const monthKey = now.toISOString().slice(0, 7);

  const [dailyLimit, monthlyLimit] = await Promise.all([
    getStoredNumber(`budget_daily_${tool}`),
    getStoredNumber(`budget_monthly_${tool}`),
  ]);

  if (dailyLimit === null && monthlyLimit === null) return;

  const [todaySpend, monthSpend] = await Promise.all([
    dailyLimit !== null ? getToolSpend(tool, todayStart) : Promise.resolve(0),
    monthlyLimit !== null ? getToolSpend(tool, monthStart) : Promise.resolve(0),
  ]);

  if (dailyLimit !== null) await maybeNotify(tool, 'daily', dailyLimit, todaySpend, dateKey);
  if (monthlyLimit !== null) await maybeNotify(tool, 'monthly', monthlyLimit, monthSpend, monthKey);
}

async function maybeNotify(
  tool: string,
  period: 'daily' | 'monthly',
  limit: number,
  spend: number,
  periodKey: string,
): Promise<void> {
  const ratio = spend / limit;
  if (ratio < 0.8) return;
  const threshold = ratio >= 1 ? 100 : 80;
  const notifKey = `notified_${threshold}_${period}_${tool}_${periodKey}`;

  const already = await new Promise<boolean>((resolve) =>
    chrome.storage.local.get(notifKey, (r) => resolve(r[notifKey] === true)),
  );
  if (already) return;

  await new Promise<void>((resolve) => chrome.storage.local.set({ [notifKey]: true }, resolve));

  const { currency, rate } = await getDisplayCurrency();
  const meta = CURRENCY_META[currency];
  const fmt = (usd: number) => `${meta.symbol}${(usd * rate).toFixed(meta.decimals)}`;

  const spent = fmt(spend);
  const lim = fmt(limit);
  const title = threshold === 100
    ? `PromptLedger — ${tool} ${period} limit reached`
    : `PromptLedger — ${tool} ${period} budget at 80%`;
  const message = threshold === 100
    ? `You've spent ${spent} of your ${lim} ${period} budget on ${tool}.`
    : `You've used 80% (${spent}) of your ${lim} ${period} budget on ${tool}.`;

  chrome.notifications.create(`pl-${tool}-${period}-${threshold}-${periodKey}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon48.png'),
    title,
    message,
  });
}

async function getDisplayCurrency(): Promise<{ currency: CurrencyCode; rate: number }> {
  return new Promise((resolve) =>
    chrome.storage.local.get(['display_currency', 'exchange_rates'], (result) => {
      const currency = ((result['display_currency'] as string | undefined) ?? 'USD') as CurrencyCode;
      const rates = (result['exchange_rates'] as Record<string, number> | undefined) ?? { USD: 1 };
      resolve({ currency, rate: rates[currency] ?? 1 });
    }),
  );
}

function getStoredNumber(key: string): Promise<number | null> {
  return new Promise((resolve) =>
    chrome.storage.local.get(key, (result) => {
      const val = result[key];
      resolve(typeof val === 'number' ? val : null);
    }),
  );
}

async function isValidDelta(tool: string, delta: number): Promise<boolean> {
  if (delta < 0) return false;

  const cap = TOOL_CREDIT_CAPS[tool] ?? 10_000;
  if (delta > cap) return false;

  // Flag if delta is more than 5× the tool's running average (PRD §F-02)
  const avg = await getRunningAverage(tool);
  if (avg > 0 && delta > avg * 5) return false;

  return true;
}

async function getRunningAverage(tool: string): Promise<number> {
  return new Promise((resolve) => {
    chrome.storage.local.get(`avg_${tool}`, (result) => {
      resolve((result[`avg_${tool}`] as number | undefined) ?? 0);
    });
  });
}

async function updateRunningAverage(tool: string, delta: number): Promise<void> {
  return new Promise((resolve) => {
    const avgKey = `avg_${tool}`;
    const cntKey = `avgn_${tool}`;
    chrome.storage.local.get([avgKey, cntKey], (result) => {
      const prev = (result[avgKey] as number | undefined) ?? 0;
      const count = (result[cntKey] as number | undefined) ?? 0;
      // Exponential moving average (α = 0.3) — recent generations weighted higher
      const newAvg = count === 0 ? delta : prev * 0.7 + delta * 0.3;
      chrome.storage.local.set({ [avgKey]: newAvg, [cntKey]: count + 1 }, resolve);
    });
  });
}

async function getPlanRate(tool: ToolId): Promise<number | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(`plan_rate_${tool}`, (result) => {
      const val = result[`plan_rate_${tool}`];
      resolve(typeof val === 'number' ? val : null);
    });
  });
}

async function getActiveProject(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get('active_project', (result) => {
      const val = result['active_project'];
      resolve(typeof val === 'string' && val.length > 0 ? val : null);
    });
  });
}
