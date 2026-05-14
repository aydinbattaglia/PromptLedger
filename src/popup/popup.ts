import { getStats } from '../storage/idb.js';
import { BILLING_URLS } from '../plans/data.js';

const TOOLS = ['runway', 'elevenlabs', 'midjourney'] as const;
type Tool = typeof TOOLS[number];

async function init(): Promise<void> {
  await Promise.all([renderStats(), renderPlans(), wirePause(), wireDashboard()]);
}

// ── Stats ────────────────────────────────────────────────────────────────────

async function renderStats(): Promise<void> {
  const stats = await getStats();

  setText('credits-today', String(Math.round(stats.credits_today)));
  setText('credits-week', String(Math.round(stats.credits_week)));
  setText('cost-month', `$${stats.cost_month_usd.toFixed(2)}`);

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
    row.innerHTML = `<span class="tool-name">${tool}</span><span class="tool-cost">$${data.cost_usd.toFixed(2)}</span>`;
    byToolEl.appendChild(row);
  }
}

// ── Plans ────────────────────────────────────────────────────────────────────

async function renderPlans(): Promise<void> {
  const keys = TOOLS.flatMap((t) => [
    `plan_rate_${t}`, `plan_name_${t}`, `plan_override_${t}`,
  ]);

  const stored = await storageGet(keys);
  const container = document.getElementById('plans')!;
  // Remove existing rows (keep the label)
  container.querySelectorAll('.plan-row, .plan-form').forEach((el) => el.remove());

  for (const tool of TOOLS) {
    const rate = stored[`plan_rate_${tool}`] as number | undefined;
    const name = stored[`plan_name_${tool}`] as string | undefined;
    const override = stored[`plan_override_${tool}`] as boolean | undefined;

    const row = document.createElement('div');
    row.className = 'plan-row';
    row.dataset['tool'] = tool;

    const form = document.createElement('div');
    form.className = 'plan-form';
    form.dataset['tool'] = tool;

    if (rate !== undefined && rate > 0) {
      const label = override ? 'custom' : (name ?? 'detected');
      const display = formatRate(tool, rate);
      row.innerHTML = `
        <span class="plan-tool">${tool}</span>
        <span class="plan-status">${label} · ${display}</span>
        <button class="plan-action edit-btn">edit</button>`;
    } else {
      const billingUrl = BILLING_URLS[tool] ?? '#';
      row.innerHTML = `
        <span class="plan-tool">${tool}</span>
        <span class="plan-status unset">not set up</span>
        <a class="plan-action" href="${billingUrl}" target="_blank">Set up ↗</a>`;
    }

    form.innerHTML = `
      <span class="plan-tool">${tool}</span>
      <input class="plan-input" type="number" min="0" step="any"
             placeholder="${formatRatePlaceholder(tool)}"
             value="${rate && rate > 0 ? rate : ''}"/>
      <span class="plan-unit">${unitLabel(tool)}</span>
      <button class="plan-save">Save</button>
      <button class="plan-cancel">✕</button>`;

    // Wire edit toggle
    row.querySelector('.edit-btn')?.addEventListener('click', () => {
      row.style.display = 'none';
      form.classList.add('visible');
      (form.querySelector('.plan-input') as HTMLInputElement)?.focus();
    });

    // Wire save
    form.querySelector('.plan-save')?.addEventListener('click', async () => {
      const val = parseFloat((form.querySelector('.plan-input') as HTMLInputElement).value);
      if (isNaN(val) || val < 0) return;
      await storageSet({
        [`plan_rate_${tool}`]: val,
        [`plan_name_${tool}`]: name ?? 'Custom',
        [`plan_override_${tool}`]: true,
      });
      form.classList.remove('visible');
      row.style.display = '';
      // Re-render plans to reflect new value
      renderPlans();
    });

    // Wire cancel
    form.querySelector('.plan-cancel')?.addEventListener('click', () => {
      form.classList.remove('visible');
      row.style.display = '';
    });

    container.appendChild(row);
    container.appendChild(form);
  }
}

function formatRate(tool: string, rate: number): string {
  if (tool === 'midjourney') return `${rate.toFixed(2)} hr/$`;
  if (tool === 'elevenlabs') return `${Math.round(rate).toLocaleString()} ch/$`;
  return `${Math.round(rate)} cr/$`;
}

function formatRatePlaceholder(tool: string): string {
  if (tool === 'midjourney') return 'e.g. 0.5';
  if (tool === 'elevenlabs') return 'e.g. 6000';
  return 'e.g. 64';
}

function unitLabel(tool: string): string {
  if (tool === 'midjourney') return 'hr/$';
  if (tool === 'elevenlabs') return 'ch/$';
  return 'cr/$';
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
