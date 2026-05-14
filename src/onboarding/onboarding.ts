import { BILLING_URLS } from '../plans/data.js';

const TOOLS = ['runway', 'midjourney', 'elevenlabs'] as const;
type Tool = typeof TOOLS[number];

const UNIT_LABEL: Record<Tool, string> = {
  runway: 'cr/$',
  midjourney: 'hr/$',
  elevenlabs: 'ch/$',
};

const PLACEHOLDER: Record<Tool, string> = {
  runway: 'e.g. 64',
  midjourney: 'e.g. 0.5',
  elevenlabs: 'e.g. 6000',
};

// ── Storage helpers ───────────────────────────────────────────────────────────

function storageGet(keys: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set(items, resolve));
}

// ── Render ────────────────────────────────────────────────────────────────────

async function render(): Promise<void> {
  const keys = TOOLS.flatMap((t) => [
    `plan_rate_${t}`, `plan_name_${t}`, `plan_override_${t}`,
  ]);
  const stored = await storageGet(keys);

  const container = document.getElementById('tool-cards')!;
  container.innerHTML = '';

  let anySet = false;

  for (const tool of TOOLS) {
    const rate = stored[`plan_rate_${tool}`] as number | undefined;
    const name = stored[`plan_name_${tool}`] as string | undefined;
    const override = stored[`plan_override_${tool}`] as boolean | undefined;
    const isSet = rate !== undefined && rate > 0;
    if (isSet) anySet = true;

    const card = document.createElement('div');
    card.className = 'tool-card';

    const statusClass = !isSet ? 'unset' : override ? 'custom' : 'detected';
    const statusText = !isSet
      ? 'Not set up'
      : override
        ? `Custom · ${formatRate(tool, rate!)}`
        : `Detected · ${name ?? ''} · ${formatRate(tool, rate!)}`;

    const billingUrl = BILLING_URLS[tool] ?? '#';

    card.innerHTML = `
      <div class="tool-card-top">
        <span class="tool-name">${tool}</span>
        <span class="status-badge ${statusClass}" data-status="${tool}">${statusText}</span>
        <a class="billing-link" href="${billingUrl}" target="_blank">Visit billing ↗</a>
      </div>
      <button class="manual-toggle" data-toggle="${tool}">Set rate manually</button>
      <div class="manual-form" data-form="${tool}">
        <input type="number" min="0" step="any"
               placeholder="${PLACEHOLDER[tool]}"
               value="${isSet ? rate! : ''}"
               data-input="${tool}" />
        <span class="manual-unit">${UNIT_LABEL[tool]}</span>
        <button class="save-btn" data-save="${tool}">Save</button>
      </div>`;

    // Toggle manual form
    card.querySelector(`[data-toggle="${tool}"]`)!.addEventListener('click', () => {
      const form = card.querySelector(`[data-form="${tool}"]`) as HTMLElement;
      form.classList.toggle('visible');
    });

    // Save rate
    card.querySelector(`[data-save="${tool}"]`)!.addEventListener('click', () =>
      void saveRate(tool, card),
    );

    // Save on Enter
    (card.querySelector(`[data-input="${tool}"]`) as HTMLInputElement)
      .addEventListener('keydown', (e) => {
        if (e.key === 'Enter') void saveRate(tool, card);
      });

    container.appendChild(card);
  }

  updateCta(anySet);
}

async function saveRate(tool: Tool, card: HTMLElement): Promise<void> {
  const input = card.querySelector(`[data-input="${tool}"]`) as HTMLInputElement;
  const val = parseFloat(input.value);
  if (isNaN(val) || val <= 0) return;

  await storageSet({
    [`plan_rate_${tool}`]: val,
    [`plan_name_${tool}`]: 'Custom',
    [`plan_override_${tool}`]: true,
  });

  // Update status badge in place
  const badge = card.querySelector(`[data-status="${tool}"]`) as HTMLElement;
  badge.className = 'status-badge custom';
  badge.textContent = `Custom · ${formatRate(tool, val)}`;

  // Hide form
  const form = card.querySelector(`[data-form="${tool}"]`) as HTMLElement;
  form.classList.remove('visible');

  updateCta(true);
}

function updateCta(anySet: boolean): void {
  const status = document.getElementById('cta-status')!;
  if (anySet) {
    status.className = 'cta-ready has-plan';
    status.textContent = "You're all set. Start generating and PromptLedger will track your usage automatically.";
  } else {
    status.className = 'cta-ready';
    status.textContent = 'Set up at least one tool above to start tracking — or skip for now and configure from the popup.';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRate(tool: string, rate: number): string {
  if (tool === 'midjourney') return `${rate.toFixed(2)} hr/$`;
  if (tool === 'elevenlabs') return `${Math.round(rate).toLocaleString()} ch/$`;
  return `${Math.round(rate)} cr/$`;
}

// ── Wire buttons ──────────────────────────────────────────────────────────────

document.getElementById('dashboard-btn')!.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  window.close();
});

document.getElementById('skip-btn')!.addEventListener('click', () => {
  window.close();
});

// ── Boot ──────────────────────────────────────────────────────────────────────

render().catch(console.error);
