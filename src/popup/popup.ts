import { getStats } from '../storage/idb.js';
import { KNOWN_PLANS, planOptionLabel } from '../plans/data.js';
import { type CurrencyCode, CURRENCY_META, convertUsd, formatCostSummary } from '../util/currency.js';

const TOOLS = ['runway', 'elevenlabs', 'midjourney'] as const;
type Tool = typeof TOOLS[number];

let displayCurrency: CurrencyCode = 'USD';
let exchangeRates: Record<string, number> = { USD: 1 };

async function init(): Promise<void> {
  // Apply theme before rendering to avoid flash
  if (localStorage.getItem('pl-theme') === 'dark') {
    document.documentElement.dataset['theme'] = 'dark';
  } else if (localStorage.getItem('pl-theme') === 'light') {
    delete document.documentElement.dataset['theme'];
  }
  wireProjectEvents();
  await Promise.all([loadCurrencySettings(), renderStats(), renderPlans(), renderProjects(), renderBudgets(), wirePause(), wireDashboard()]);
}

async function loadCurrencySettings(): Promise<void> {
  const stored = await storageGet(['display_currency', 'exchange_rates']);
  displayCurrency = ((stored['display_currency'] as string | undefined) ?? 'USD') as CurrencyCode;
  exchangeRates = (stored['exchange_rates'] as Record<string, number> | undefined) ?? { USD: 1 };
}

// ── Stats ────────────────────────────────────────────────────────────────────

async function renderStats(): Promise<void> {
  const stats = await getStats();

  setText('credits-today', String(Math.round(stats.credits_today)));
  setText('credits-week', String(Math.round(stats.credits_week)));
  setText('cost-month', formatCostSummary(stats.cost_month_usd, displayCurrency, exchangeRates));

  const byToolEl = document.getElementById('by-tool')!;
  const tools = Object.entries(stats.by_tool);

  if (tools.length === 0) {
    byToolEl.innerHTML =
      '<p class="empty-state">No generations logged yet.<br>Visit Runway, Midjourney, or ElevenLabs to get started.</p>';
    return;
  }

  for (const [tool, data] of tools) {
    const row = document.createElement('div');
    row.className = 'tool-row';
    row.innerHTML = `<span class="tool-name">${tool}</span><span class="tool-cost">${formatCostSummary(data.cost_usd, displayCurrency, exchangeRates)}</span>`;
    byToolEl.appendChild(row);
  }
}

// ── Projects ─────────────────────────────────────────────────────────────────

async function renderProjects(): Promise<void> {
  const { project_list, active_project } = await storageGet(['project_list', 'active_project']);
  const list = (project_list as string[] | undefined) ?? [];
  const active = (active_project as string | undefined) ?? '';

  const select = document.getElementById('project-select') as HTMLSelectElement;
  const current = select.value;
  select.innerHTML = "<option value=''>None — don't tag</option>";
  for (const name of list) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }
  select.value = active || current;
}

function wireProjectEvents(): void {
  const select = document.getElementById('project-select') as HTMLSelectElement;
  const form = document.getElementById('project-form')!;
  const input = document.getElementById('proj-input') as HTMLInputElement;

  select.addEventListener('change', () => {
    storageSet({ active_project: select.value }).catch(console.error);
  });

  document.getElementById('new-proj-btn')!.addEventListener('click', () => {
    form.classList.add('visible');
    input.focus();
  });

  document.getElementById('proj-cancel')!.addEventListener('click', () => {
    form.classList.remove('visible');
    input.value = '';
  });

  const doSave = async () => {
    const name = input.value.trim();
    if (!name) return;
    const { project_list: cur } = await storageGet(['project_list']);
    const existing = (cur as string[] | undefined) ?? [];
    if (!existing.includes(name)) {
      await storageSet({ project_list: [...existing, name] });
    }
    await storageSet({ active_project: name });
    form.classList.remove('visible');
    input.value = '';
    await renderProjects();
  };

  document.getElementById('proj-save')!.addEventListener('click', () => void doSave());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') void doSave(); });
}

// ── Plans ────────────────────────────────────────────────────────────────────

async function renderPlans(): Promise<void> {
  const keys = TOOLS.flatMap((t) => [`plan_key_${t}`]);
  const stored = await storageGet(keys);
  const container = document.getElementById('plans')!;
  container.querySelectorAll('.plan-row').forEach((el) => el.remove());

  for (const tool of TOOLS) {
    const currentKey = stored[`plan_key_${tool}`] as string | undefined;

    const row = document.createElement('div');
    row.className = 'plan-row';

    const label = document.createElement('span');
    label.className = 'plan-tool';
    label.textContent = tool;

    const select = document.createElement('select');
    select.className = 'plan-select';

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '— not set —';
    select.appendChild(defaultOpt);

    for (const key of Object.keys(KNOWN_PLANS[tool] ?? {})) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = planOptionLabel(tool, key);
      select.appendChild(opt);
    }

    if (currentKey) select.value = currentKey;

    select.addEventListener('change', async () => {
      const key = select.value;
      if (!key) {
        await storageSet({
          [`plan_key_${tool}`]: null,
          [`plan_rate_${tool}`]: null,
          [`plan_name_${tool}`]: null,
          [`plan_is_free_${tool}`]: false,
          [`plan_override_${tool}`]: false,
        });
        return;
      }
      const plan = KNOWN_PLANS[tool]?.[key];
      if (!plan) return;
      await storageSet({
        [`plan_key_${tool}`]: key,
        [`plan_rate_${tool}`]: plan.credits_per_dollar > 0 ? plan.credits_per_dollar : null,
        [`plan_name_${tool}`]: plan.plan_name,
        [`plan_is_free_${tool}`]: plan.monthly_cost_usd === 0,
        [`plan_override_${tool}`]: false,
      });
    });

    row.appendChild(label);
    row.appendChild(select);
    container.appendChild(row);
  }
}

// ── Budget alerts ────────────────────────────────────────────────────────────

async function renderBudgets(): Promise<void> {
  const keys = TOOLS.flatMap((t) => [`budget_daily_${t}`, `budget_monthly_${t}`]);
  const stored = await storageGet(keys);
  const container = document.getElementById('budgets')!;
  container.querySelectorAll('.budget-row, .budget-form').forEach((el) => el.remove());

  for (const tool of TOOLS) {
    const daily = stored[`budget_daily_${tool}`] as number | undefined;
    const monthly = stored[`budget_monthly_${tool}`] as number | undefined;

    const meta = CURRENCY_META[displayCurrency];
    const rate = exchangeRates[displayCurrency] ?? 1;

    const fmtLimit = (v: number | undefined) =>
      v !== undefined && v > 0
        ? `<span>${meta.symbol}${convertUsd(v, displayCurrency, exchangeRates).toFixed(meta.decimals)}</span>`
        : '—';

    const toDisplayVal = (usd: number | undefined) =>
      usd !== undefined && usd > 0
        ? (usd * rate).toFixed(meta.decimals)
        : '';

    const row = document.createElement('div');
    row.className = 'budget-row';
    row.innerHTML = `
      <span class="budget-tool">${tool}</span>
      <span class="budget-limits">D: ${fmtLimit(daily)} &nbsp; M: ${fmtLimit(monthly)}</span>
      <button class="budget-edit">edit</button>`;

    const form = document.createElement('div');
    form.className = 'budget-form';
    form.innerHTML = `
      <span class="budget-form-tool">${tool}</span>
      <div class="budget-input-row">
        <span class="budget-label">Daily</span>
        <span class="budget-prefix">${meta.symbol}</span>
        <input class="budget-input" data-period="daily" type="number" min="0" step="any"
               placeholder="no limit" value="${toDisplayVal(daily)}" />
      </div>
      <div class="budget-input-row">
        <span class="budget-label">Monthly</span>
        <span class="budget-prefix">${meta.symbol}</span>
        <input class="budget-input" data-period="monthly" type="number" min="0" step="any"
               placeholder="no limit" value="${toDisplayVal(monthly)}" />
      </div>
      <div class="budget-actions">
        <button class="budget-save">Save</button>
        <button class="budget-cancel">Cancel</button>
      </div>`;

    row.querySelector('.budget-edit')!.addEventListener('click', () => {
      row.style.display = 'none';
      form.classList.add('visible');
      (form.querySelector('.budget-input') as HTMLInputElement).focus();
    });

    form.querySelector('.budget-save')!.addEventListener('click', async () => {
      const inputs = form.querySelectorAll<HTMLInputElement>('.budget-input');
      const vals: Record<string, unknown> = {};
      for (const input of inputs) {
        const period = input.dataset['period']!;
        const raw = parseFloat(input.value);
        // Always persist in USD so the service worker can compare against USD spend
        vals[`budget_${period}_${tool}`] = isNaN(raw) || raw <= 0 ? null : raw / rate;
      }
      await storageSet(vals);
      form.classList.remove('visible');
      row.style.display = '';
      await renderBudgets();
    });

    form.querySelector('.budget-cancel')!.addEventListener('click', () => {
      form.classList.remove('visible');
      row.style.display = '';
    });

    container.appendChild(row);
    container.appendChild(form);
  }
}

// ── Pause & dashboard ────────────────────────────────────────────────────────

async function wirePause(): Promise<void> {
  const btn = document.getElementById('pause-btn') as HTMLButtonElement;
  const { paused } = await storageGet(['paused']);
  if (paused) btn.textContent = 'Resume';

  btn.addEventListener('click', () => {
    storageGet(['paused']).then(({ paused: p }) => {
      const next = !p;
      storageSet({ paused: next });
      btn.textContent = next ? 'Resume' : 'Pause';
    });
  });
}

function wireDashboard(): void {
  document.getElementById('dashboard-link')!.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  });
}

// ── Storage helpers ──────────────────────────────────────────────────────────

function storageGet(keys: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set(items, resolve));
}

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

init().catch(console.error);
