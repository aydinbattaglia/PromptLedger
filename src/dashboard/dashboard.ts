import {
  Chart,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  LineController,
  ArcElement,
  DoughnutController,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';

import { getRecords, saveRecord, deleteRecord, clearAll } from '../storage/idb.js';
import type { GenerationRecord, RecordFilters, ToolId } from '../types/index.js';

Chart.register(
  CategoryScale, LinearScale, LineElement, PointElement, LineController,
  ArcElement, DoughnutController, Tooltip, Legend, Filler,
);

const PAGE_SIZE = 25;
const TOOL_COLORS: Record<string, string> = {
  runway: '#7c7cff',
  midjourney: '#7cffcf',
  elevenlabs: '#ffcf7c',
  pika: '#ff7cae',
  udio: '#ae7cff',
};

// ── State ────────────────────────────────────────────────────────────────────

let allRecords: GenerationRecord[] = [];
let filteredRecords: GenerationRecord[] = [];
let projectList: string[] = [];
let currentPage = 0;
let chartDays = 30;
let timeseriesChart: Chart | null = null;
let donutChart: Chart | null = null;

// ── Filters ──────────────────────────────────────────────────────────────────

function getFilters(): RecordFilters {
  const tool = (document.getElementById('filter-tool') as HTMLSelectElement).value as ToolId | '';
  const project = (document.getElementById('filter-project') as HTMLSelectElement).value;
  const from = (document.getElementById('filter-from') as HTMLInputElement).value;
  const to = (document.getElementById('filter-to') as HTMLInputElement).value;
  const search = (document.getElementById('filter-search') as HTMLInputElement).value.trim();

  return {
    ...(tool ? { tool } : {}),
    ...(project ? { project_tag: project } : {}),
    ...(from ? { from: new Date(from).toISOString() } : {}),
    ...(to ? { to: new Date(to + 'T23:59:59').toISOString() } : {}),
    ...(search ? { search } : {}),
  };
}

function applyFilters(): void {
  const filters = getFilters();
  filteredRecords = allRecords.filter((r) => {
    if (filters.tool && r.tool !== filters.tool) return false;
    if (filters.project_tag && r.project_tag !== filters.project_tag) return false;
    if (filters.from && r.timestamp < filters.from) return false;
    if (filters.to && r.timestamp > filters.to) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!r.prompt?.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  currentPage = 0;
  renderAll();
}

// ── Load ─────────────────────────────────────────────────────────────────────

async function load(): Promise<void> {
  const [records] = await Promise.all([
    getRecords(),
    loadProjectFilter(),
  ]);
  allRecords = records;
  filteredRecords = allRecords;
  renderAll();
}

async function loadProjectFilter(): Promise<void> {
  const stored = await new Promise<Record<string, unknown>>((resolve) =>
    chrome.storage.local.get('project_list', resolve),
  );
  projectList = (stored['project_list'] as string[] | undefined) ?? [];
  const select = document.getElementById('filter-project') as HTMLSelectElement;
  for (const name of projectList) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }
}

function renderAll(): void {
  renderSummary();
  renderTimeseries();
  renderDonut();
  renderTable();
}

// ── Summary cards ─────────────────────────────────────────────────────────────

function renderSummary(): void {
  const records = filteredRecords;
  const totalCost = records.reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  const totalCredits = records.reduce((s, r) => s + (r.credits_used ?? 0), 0);
  const flagged = records.filter((r) => r.flagged).length;

  setText('sum-cost', `$${totalCost.toFixed(2)}`);
  setText('sum-credits', Math.round(totalCredits).toLocaleString());
  setText('sum-count', records.length.toLocaleString());
  setText('sum-flagged', String(flagged));
}

// ── Time series chart ─────────────────────────────────────────────────────────

function renderTimeseries(): void {
  const canvas = document.getElementById('timeseries-chart') as HTMLCanvasElement;

  const buckets = new Map<string, number>();
  for (let i = chartDays - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }

  for (const r of filteredRecords) {
    const day = r.timestamp.slice(0, 10);
    if (buckets.has(day)) {
      buckets.set(day, (buckets.get(day) ?? 0) + (r.cost_usd ?? 0));
    }
  }

  const labels = [...buckets.keys()].map((d) => {
    const [, m, day] = d.split('-') as [string, string, string];
    return `${m}/${day}`;
  });
  const data = [...buckets.values()];

  if (timeseriesChart) {
    timeseriesChart.data.labels = labels;
    (timeseriesChart.data.datasets[0] as { data: number[] }).data = data;
    timeseriesChart.update();
    return;
  }

  const gridColor = chartColor('#1e1e24', '#dcdce8');
  const tickColor = chartColor('#686878', '#808098');

  timeseriesChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: chartColor('#7c7cff', '#4f4fd4'),
        backgroundColor: chartColor('rgba(124,124,255,0.08)', 'rgba(79,79,212,0.07)'),
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        tension: 0.3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: (ctx) => ` $${(ctx.raw as number).toFixed(2)}` },
      } },
      scales: {
        x: { ticks: { color: tickColor, font: { size: 10 }, maxTicksLimit: 8 }, grid: { color: gridColor } },
        y: { ticks: { color: tickColor, font: { size: 10 }, callback: (v) => `$${Number(v).toFixed(2)}` }, grid: { color: gridColor }, beginAtZero: true },
      },
    },
  });
}

// ── Donut chart ───────────────────────────────────────────────────────────────

function renderDonut(): void {
  const canvas = document.getElementById('donut-chart') as HTMLCanvasElement;

  const byTool = new Map<string, number>();
  for (const r of filteredRecords) {
    const cost = r.cost_usd ?? 0;
    if (cost > 0) byTool.set(r.tool, (byTool.get(r.tool) ?? 0) + cost);
  }

  const labels = byTool.size > 0 ? [...byTool.keys()] : ['No data'];
  const data = byTool.size > 0 ? [...byTool.values()] : [1];
  const colors = byTool.size > 0 ? labels.map((t) => TOOL_COLORS[t] ?? '#686878') : ['#2e2e38'];

  if (donutChart) {
    donutChart.data.labels = labels;
    (donutChart.data.datasets[0] as { data: number[]; backgroundColor: string[] }).data = data;
    (donutChart.data.datasets[0] as { data: number[]; backgroundColor: string[] }).backgroundColor = colors;
    donutChart.update();
    return;
  }

  donutChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: 0,
        hoverOffset: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#9898a8', font: { size: 10 }, padding: 10, boxWidth: 10 },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const val = ctx.raw as number;
              const total = (ctx.dataset.data as number[]).reduce((a, b) => a + b, 0);
              const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0';
              return ` $${val.toFixed(2)} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

// ── Table ─────────────────────────────────────────────────────────────────────

function renderTable(): void {
  const wrap = document.getElementById('table-wrap')!;
  const pagination = document.getElementById('pagination')!;
  const countEl = document.getElementById('record-count')!;

  const total = filteredRecords.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage >= totalPages) currentPage = totalPages - 1;

  const start = currentPage * PAGE_SIZE;
  const page = filteredRecords.slice(start, start + PAGE_SIZE);

  countEl.textContent = `${total.toLocaleString()} record${total !== 1 ? 's' : ''}`;

  if (total === 0) {
    wrap.innerHTML = '<div class="empty-state"><p>No generations found.<br>Adjust your filters or visit Runway, Midjourney, or ElevenLabs to get started.</p></div>';
    pagination.style.display = 'none';
    return;
  }

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Time</th>
        <th>Tool</th>
        <th>Model</th>
        <th>Prompt</th>
        <th style="text-align:right">Credits</th>
        <th style="text-align:right">Cost</th>
        <th></th>
      </tr>
    </thead>
    <tbody></tbody>`;

  const tbody = table.querySelector('tbody')!;

  for (const r of page) {
    const tr = document.createElement('tr');
    if (r.flagged) tr.classList.add('flagged-row');
    tr.dataset['id'] = r.id;

    const ts = new Date(r.timestamp);
    const tsStr = `${ts.toLocaleDateString()} ${ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    const projBadge = r.project_tag
      ? `<span class="proj-badge">${escHtml(r.project_tag)}</span>`
      : '';
    tr.innerHTML = `
      <td class="ts">${tsStr}</td>
      <td class="tool">${r.tool}${r.flagged ? '<span class="flag-badge">flagged</span>' : ''}${projBadge}</td>
      <td class="model" title="${escHtml(r.model)}">${escHtml(r.model)}</td>
      <td class="prompt-cell" title="${escHtml(r.prompt ?? '')}">${escHtml(r.prompt ?? '—')}</td>
      <td class="num">${r.credits_used !== null ? Math.round(r.credits_used).toLocaleString() : '—'}</td>
      <td class="cost">${r.cost_usd !== null ? `$${r.cost_usd.toFixed(4)}` : '—'}</td>
      <td class="actions">
        <button class="tag-btn" title="Set project">tag</button>
        <button class="del-btn" title="Delete">✕</button>
      </td>`;

    tr.querySelector('.tag-btn')!.addEventListener('click', () => showRetagSelect(tr, r));
    tr.querySelector('.del-btn')!.addEventListener('click', () => handleDelete(r.id));
    tbody.appendChild(tr);
  }

  wrap.innerHTML = '';
  wrap.appendChild(table);

  renderPagination(totalPages, pagination);
}

function renderPagination(totalPages: number, el: HTMLElement): void {
  el.innerHTML = '';
  if (totalPages <= 1) { el.style.display = 'none'; return; }
  el.style.display = 'flex';

  const prev = document.createElement('button');
  prev.className = 'page-btn';
  prev.textContent = '←';
  prev.disabled = currentPage === 0;
  prev.addEventListener('click', () => { currentPage--; renderTable(); });
  el.appendChild(prev);

  const maxButtons = 7;
  const half = Math.floor(maxButtons / 2);
  let rangeStart = Math.max(0, currentPage - half);
  const rangeEnd = Math.min(totalPages - 1, rangeStart + maxButtons - 1);
  if (rangeEnd - rangeStart < maxButtons - 1) {
    rangeStart = Math.max(0, rangeEnd - maxButtons + 1);
  }

  for (let i = rangeStart; i <= rangeEnd; i++) {
    const btn = document.createElement('button');
    btn.className = `page-btn${i === currentPage ? ' active' : ''}`;
    btn.textContent = String(i + 1);
    const page = i;
    btn.addEventListener('click', () => { currentPage = page; renderTable(); });
    el.appendChild(btn);
  }

  const next = document.createElement('button');
  next.className = 'page-btn';
  next.textContent = '→';
  next.disabled = currentPage === totalPages - 1;
  next.addEventListener('click', () => { currentPage++; renderTable(); });
  el.appendChild(next);
}

// ── Retag ─────────────────────────────────────────────────────────────────────

function showRetagSelect(tr: HTMLTableRowElement, r: GenerationRecord): void {
  const cell = tr.querySelector('.actions') as HTMLTableCellElement;

  const sel = document.createElement('select');
  sel.className = 'retag-select';
  sel.innerHTML =
    '<option value="">None</option>' +
    projectList
      .map((p) => `<option value="${escHtml(p)}">${escHtml(p)}</option>`)
      .join('');
  sel.value = r.project_tag ?? '';

  cell.innerHTML = '';
  cell.appendChild(sel);
  sel.focus();

  let committed = false;

  const doSave = async (val: string) => {
    committed = true;
    const tag = val || null;
    const updated: GenerationRecord = { ...r, project_tag: tag };
    await saveRecord(updated);
    const ai = allRecords.findIndex((x) => x.id === r.id);
    if (ai !== -1) allRecords[ai] = updated;
    const fi = filteredRecords.findIndex((x) => x.id === r.id);
    if (fi !== -1) filteredRecords[fi] = updated;
    renderTable();
  };

  sel.addEventListener('change', () => void doSave(sel.value));
  sel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { committed = true; renderTable(); } });
  sel.addEventListener('blur', () => setTimeout(() => { if (!committed) renderTable(); }, 0));
}

// ── Delete ────────────────────────────────────────────────────────────────────

async function handleDelete(id: string): Promise<void> {
  await deleteRecord(id);
  allRecords = allRecords.filter((r) => r.id !== id);
  filteredRecords = filteredRecords.filter((r) => r.id !== id);
  renderAll();
}

// ── CSV export ────────────────────────────────────────────────────────────────

function exportCSV(): void {
  const headers = [
    'id', 'timestamp', 'tool', 'model', 'prompt', 'credits_used', 'cost_usd',
    'plan_rate', 'project_tag', 'duration_sec', 'resolution', 'generation_id', 'flagged',
  ];

  const rows = filteredRecords.map((r) =>
    headers.map((h) => {
      const val = r[h as keyof GenerationRecord];
      if (val === null || val === undefined) return '';
      const s = String(val);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    }).join(','),
  );

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);

  const a = document.createElement('a');
  a.href = url;
  a.download = `promptledger-export-${date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Clear all ─────────────────────────────────────────────────────────────────

async function handleClearAll(): Promise<void> {
  if (!confirm('Delete all generation records? This cannot be undone.')) return;
  await clearAll();
  allRecords = [];
  filteredRecords = [];
  renderAll();
}

// ── Theme ─────────────────────────────────────────────────────────────────────

function isDark(): boolean {
  return document.documentElement.dataset['theme'] === 'dark';
}

function chartColor(dark: string, light: string): string {
  return isDark() ? dark : light;
}

function initTheme(): void {
  if (localStorage.getItem('pl-theme') === 'dark') {
    document.documentElement.dataset['theme'] = 'dark';
    (document.getElementById('theme-btn') as HTMLButtonElement).textContent = 'Light mode';
  }
}

function toggleTheme(): void {
  const toDark = !isDark();
  if (toDark) {
    document.documentElement.dataset['theme'] = 'dark';
    localStorage.setItem('pl-theme', 'dark');
    (document.getElementById('theme-btn') as HTMLButtonElement).textContent = 'Light mode';
  } else {
    delete document.documentElement.dataset['theme'];
    localStorage.setItem('pl-theme', 'light');
    (document.getElementById('theme-btn') as HTMLButtonElement).textContent = 'Dark mode';
  }
  if (timeseriesChart) { timeseriesChart.destroy(); timeseriesChart = null; }
  if (donutChart) { donutChart.destroy(); donutChart = null; }
  renderTimeseries();
  renderDonut();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Wire up events ────────────────────────────────────────────────────────────

document.getElementById('filter-apply')!.addEventListener('click', applyFilters);
document.getElementById('filter-tool')!.addEventListener('change', applyFilters);
document.getElementById('filter-project')!.addEventListener('change', applyFilters);
document.getElementById('filter-clear')!.addEventListener('click', () => {
  (document.getElementById('filter-tool') as HTMLSelectElement).value = '';
  (document.getElementById('filter-project') as HTMLSelectElement).value = '';
  (document.getElementById('filter-from') as HTMLInputElement).value = '';
  (document.getElementById('filter-to') as HTMLInputElement).value = '';
  (document.getElementById('filter-search') as HTMLInputElement).value = '';
  filteredRecords = allRecords;
  currentPage = 0;
  renderAll();
});

document.getElementById('filter-search')!.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyFilters();
});

document.querySelectorAll('.range-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.range-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    chartDays = Number((btn as HTMLElement).dataset['days']);
    if (timeseriesChart) { timeseriesChart.destroy(); timeseriesChart = null; }
    renderTimeseries();
  });
});

document.getElementById('theme-btn')!.addEventListener('click', toggleTheme);
document.getElementById('export-btn')!.addEventListener('click', exportCSV);
document.getElementById('clear-btn')!.addEventListener('click', () => void handleClearAll());

// ── Boot ──────────────────────────────────────────────────────────────────────

initTheme();
load().catch(console.error);
