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

import { getRecords, deleteRecord, clearAll } from '../storage/idb.js';
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
let currentPage = 0;
let chartDays = 30;
let timeseriesChart: Chart | null = null;
let donutChart: Chart | null = null;

// ── Filters ──────────────────────────────────────────────────────────────────

function getFilters(): RecordFilters {
  const tool = (document.getElementById('filter-tool') as HTMLSelectElement).value as ToolId | '';
  const from = (document.getElementById('filter-from') as HTMLInputElement).value;
  const to = (document.getElementById('filter-to') as HTMLInputElement).value;
  const search = (document.getElementById('filter-search') as HTMLInputElement).value.trim();

  return {
    ...(tool ? { tool } : {}),
    ...(from ? { from: new Date(from).toISOString() } : {}),
    ...(to ? { to: new Date(to + 'T23:59:59').toISOString() } : {}),
    ...(search ? { search } : {}),
  };
}

function applyFilters(): void {
  const filters = getFilters();
  filteredRecords = allRecords.filter((r) => {
    if (filters.tool && r.tool !== filters.tool) return false;
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
  allRecords = await getRecords();
  filteredRecords = allRecords;
  renderAll();
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
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - chartDays);
  cutoff.setHours(0, 0, 0, 0);

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

  timeseriesChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: '#7c7cff',
        backgroundColor: 'rgba(124,124,255,0.08)',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        tension: 0.3,
      }],
    },
    options: {
      responsive: false,
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: (ctx) => ` $${(ctx.raw as number).toFixed(2)}` },
      } },
      scales: {
        x: { ticks: { color: '#686878', font: { size: 10 }, maxTicksLimit: 8 }, grid: { color: '#1e1e24' } },
        y: { ticks: { color: '#686878', font: { size: 10 }, callback: (v) => `$${Number(v).toFixed(2)}` }, grid: { color: '#1e1e24' }, beginAtZero: true },
      },
    },
  });
}

// ── Donut chart ───────────────────────────────────────────────────────────────

function renderDonut(): void {
  const canvas = document.getElementById('donut-chart') as HTMLCanvasElement;

  const byTool = new Map<string, number>();
  for (const r of filteredRecords) {
    byTool.set(r.tool, (byTool.get(r.tool) ?? 0) + (r.cost_usd ?? 0));
  }

  const labels = [...byTool.keys()];
  const data = [...byTool.values()];
  const colors = labels.map((t) => TOOL_COLORS[t] ?? '#686878');

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
      responsive: false,
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

    tr.innerHTML = `
      <td class="ts">${tsStr}</td>
      <td class="tool">${r.tool}${r.flagged ? '<span class="flag-badge">flagged</span>' : ''}</td>
      <td class="model" title="${escHtml(r.model)}">${escHtml(r.model)}</td>
      <td class="prompt-cell" title="${escHtml(r.prompt ?? '')}">${escHtml(r.prompt ?? '—')}</td>
      <td class="num">${r.credits_used !== null ? Math.round(r.credits_used).toLocaleString() : '—'}</td>
      <td class="cost">${r.cost_usd !== null ? `$${r.cost_usd.toFixed(4)}` : '—'}</td>
      <td class="actions"><button class="del-btn" title="Delete">✕</button></td>`;

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
document.getElementById('filter-clear')!.addEventListener('click', () => {
  (document.getElementById('filter-tool') as HTMLSelectElement).value = '';
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

document.getElementById('export-btn')!.addEventListener('click', exportCSV);
document.getElementById('clear-btn')!.addEventListener('click', () => void handleClearAll());

// ── Boot ──────────────────────────────────────────────────────────────────────

load().catch(console.error);
