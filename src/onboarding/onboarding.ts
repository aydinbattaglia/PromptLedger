import { KNOWN_PLANS, planOptionLabel } from '../plans/data.js';
import { isExperimental } from '../types/index.js';

const TOOLS = ['runway', 'midjourney', 'elevenlabs'] as const;
type Tool = typeof TOOLS[number];

function storageGet(keys: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}
function storageSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set(items, resolve));
}

async function render(): Promise<void> {
  const keys = TOOLS.flatMap((t) => [`plan_key_${t}`]);
  const stored = await storageGet(keys);

  const container = document.getElementById('tool-cards')!;
  container.innerHTML = '';

  let anySet = false;

  for (const tool of TOOLS) {
    const currentKey = stored[`plan_key_${tool}`] as string | undefined;
    if (currentKey) anySet = true;

    const card = document.createElement('div');
    card.className = 'tool-card';

    const select = document.createElement('select');
    select.className = 'plan-select';

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '— Select your plan —';
    select.appendChild(defaultOpt);

    for (const key of Object.keys(KNOWN_PLANS[tool] ?? {})) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = planOptionLabel(tool, key);
      select.appendChild(opt);
    }

    if (currentKey) select.value = currentKey;

    select.addEventListener('change', () => void onPlanSelect(tool, select.value));

    const experimental = isExperimental(tool);
    card.innerHTML = `<span class="tool-name">${tool}${experimental ? '<span class="exp-badge">Experimental</span>' : ''}</span>`;
    card.appendChild(select);
    if (experimental) {
      card.style.flexWrap = 'wrap';
      const note = document.createElement('div');
      note.className = 'tool-note';
      note.style.width = '100%';
      note.textContent = 'Midjourney capture is not yet reliable — costs may be missing or incomplete.';
      card.appendChild(note);
    }
    container.appendChild(card);
  }

  updateCta(anySet);
}

async function onPlanSelect(tool: Tool, key: string): Promise<void> {
  if (!key) {
    await storageSet({
      [`plan_key_${tool}`]: null,
      [`plan_rate_${tool}`]: null,
      [`plan_name_${tool}`]: null,
      [`plan_is_free_${tool}`]: false,
      [`plan_override_${tool}`]: false,
    });
  } else {
    const plan = KNOWN_PLANS[tool]?.[key];
    if (!plan) return;
    await storageSet({
      [`plan_key_${tool}`]: key,
      [`plan_rate_${tool}`]: plan.credits_per_dollar > 0 ? plan.credits_per_dollar : null,
      [`plan_name_${tool}`]: plan.plan_name,
      [`plan_is_free_${tool}`]: plan.monthly_cost_usd === 0,
      [`plan_override_${tool}`]: false,
    });
  }

  const keys = TOOLS.map((t) => `plan_key_${t}`);
  const stored = await storageGet(keys);
  const anySet = TOOLS.some((t) => !!stored[`plan_key_${t}`]);
  updateCta(anySet);
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

document.getElementById('dashboard-btn')!.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  window.close();
});

document.getElementById('skip-btn')!.addEventListener('click', () => {
  window.close();
});

render().catch(console.error);
