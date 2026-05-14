import { getStats } from '../storage/idb.js';

async function init(): Promise<void> {
  const stats = await getStats();

  (document.getElementById('credits-today') as HTMLElement).textContent =
    `${Math.round(stats.credits_today)}`;
  (document.getElementById('credits-week') as HTMLElement).textContent =
    `${Math.round(stats.credits_week)}`;
  (document.getElementById('cost-month') as HTMLElement).textContent =
    `$${stats.cost_month_usd.toFixed(2)}`;

  const byToolEl = document.getElementById('by-tool') as HTMLElement;
  const tools = Object.entries(stats.by_tool);

  if (tools.length === 0) {
    byToolEl.innerHTML =
      '<p class="empty-state">No generations logged yet.<br>Use Runway, Midjourney, or ElevenLabs to get started.</p>';
  } else {
    for (const [tool, data] of tools) {
      const row = document.createElement('div');
      row.className = 'tool-row';
      row.innerHTML = `<span class="tool-name">${tool}</span><span class="tool-cost">$${data.cost_usd.toFixed(2)}</span>`;
      byToolEl.appendChild(row);
    }
  }

  document.getElementById('dashboard-link')!.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  });

  document.getElementById('pause-btn')!.addEventListener('click', () => {
    chrome.storage.local.get('paused', ({ paused }) => {
      const next = !paused;
      chrome.storage.local.set({ paused: next });
      (document.getElementById('pause-btn') as HTMLButtonElement).textContent =
        next ? 'Resume' : 'Pause';
    });
  });

  chrome.storage.local.get('paused', ({ paused }) => {
    if (paused) {
      (document.getElementById('pause-btn') as HTMLButtonElement).textContent = 'Resume';
    }
  });
}

init().catch(console.error);
