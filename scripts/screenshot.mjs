import puppeteer from 'puppeteer';
import { readFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT  = path.join(ROOT, 'store');
mkdirSync(OUT, { recursive: true });

function extractCSS(file) {
  const html = readFileSync(path.join(ROOT, file), 'utf-8');
  return (html.match(/<style>([\s\S]*?)<\/style>/) ?? ['', ''])[1];
}

const popupCSS = extractCSS('src/popup/popup.html');
const dashCSS  = extractCSS('src/dashboard/dashboard.html');

const LOGO = `<svg width="15" height="15" viewBox="0 0 15 15" fill="none" style="vertical-align:-2px;margin-right:6px;color:var(--accent)"><rect x="2" y="1" width="10" height="13" rx="1.75" stroke="currentColor" stroke-width="1.35"/><path d="M4.5 5h6M4.5 7.75h6M4.5 10.5h3.5" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/></svg>`;

// 30 days of daily spend ending 2026-07-21
const SPEND = [0.27,0.63,0.45,0.99,0.81,1.26,0.54,0.72,1.08,0.36,1.35,0.63,0.81,1.17,0.45,0.72,0.90,1.26,0.54,0.81,0.99,0.63,1.17,0.72,1.35,0.81,1.08,0.63,1.26,0.54];
const base = new Date('2026-06-22');
const chartLabels = SPEND.map((_, i) => {
  const d = new Date(base); d.setDate(base.getDate() + i);
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
});

// ── Popup mock (640×400, popup centered, top sections only) ───────────────────

function popupHtml(dark) {
  const bg = dark ? '#0f0f18' : '#e8eaf4';
  const shadow = dark
    ? '0 24px 64px rgba(0,0,0,0.55), 0 4px 16px rgba(0,0,0,0.4)'
    : '0 20px 60px rgba(0,0,0,0.14), 0 4px 16px rgba(0,0,0,0.07)';
  return `<!DOCTYPE html>
<html lang="en"${dark ? ' data-theme="dark"' : ''}><head><meta charset="UTF-8"><style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
${popupCSS}
html,body{width:640px;height:400px;background:${bg};display:flex;align-items:flex-start;justify-content:center;padding-top:26px}
.popup-frame{width:320px;border-radius:10px;overflow:hidden;box-shadow:${shadow}}
</style></head><body>
<div class="popup-frame">

<header>
  <h1>${LOGO}PromptLedger</h1>
  <button id="pause-btn">Pause</button>
</header>

<div class="stats">
  <div class="stat"><span class="label">Today</span><span class="value">142</span></div>
  <div class="stat"><span class="label">This week</span><span class="value">891</span></div>
  <div class="stat"><span class="label">This month</span><span class="value">$18.40</span></div>
</div>

<div id="by-tool">
  <div class="tool-row">
    <div class="tool-row-header"><span class="tool-name">Runway</span><span class="tool-cost">$14.30</span></div>
    <div class="tool-bar-track"><div class="tool-bar-fill" style="width:100%"></div></div>
  </div>
  <div class="tool-row">
    <div class="tool-row-header"><span class="tool-name">ElevenLabs</span><span class="tool-cost">$4.10</span></div>
    <div class="tool-bar-track"><div class="tool-bar-fill" style="width:29%"></div></div>
  </div>
</div>

<section id="projects">
  <div class="section-label">Active project</div>
  <div class="project-row">
    <select id="project-select">
      <option value="">None — don't tag</option>
      <option selected>Website Rebrand</option>
      <option>Product Videos</option>
      <option>Podcast</option>
    </select>
    <button id="new-proj-btn" title="New project">+</button>
  </div>
</section>

<section id="plans">
  <div class="section-label">Plans</div>
  <div class="plan-row">
    <span class="plan-tool">Runway</span>
    <select class="plan-select"><option>Standard — 625 cr/mo</option></select>
  </div>
  <div class="plan-row">
    <span class="plan-tool">ElevenLabs</span>
    <select class="plan-select"><option>Creator — 121k/mo</option></select>
  </div>
</section>

</div>
</body></html>`;
}

// ── Dashboard mock (1280×800, charts + table) ─────────────────────────────────

function dashHtml(dark) {
  const lineColor  = dark ? 'rgba(124,124,255,0.9)' : 'rgba(79,79,212,0.9)';
  const lineFill   = dark ? 'rgba(124,124,255,0.1)' : 'rgba(79,79,212,0.07)';
  const gridColor  = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
  const tickColor  = dark ? '#686878' : '#808098';
  const donutColors = dark ? ['#7c7cff','#7cffcf'] : ['#4f4fd4','#2da870'];
  const legendColor = dark ? '#b0b0c0' : '#4c4c68';

  const rows = [
    { ts: 'Jul 21, 14:32', tool: 'Runway',     model: 'Gen-4 Turbo',           prompt: 'Cinematic crane shot through morning forest mist',        credits: '25',    cost: '$0.25', proj: 'Website Rebrand' },
    { ts: 'Jul 21, 13:15', tool: 'ElevenLabs', model: 'Eleven Multilingual v2', prompt: 'Welcome to our annual product launch event…',            credits: '1,240', cost: '$0.06', proj: 'Podcast' },
    { ts: 'Jul 20, 16:20', tool: 'Runway',     model: 'Gen-4',                 prompt: 'Abstract fluid simulation, purple and teal palette',      credits: '10',    cost: '$0.10', proj: 'Product Videos' },
    { ts: 'Jul 20, 14:05', tool: 'ElevenLabs', model: 'Studio',                prompt: 'Chapter 3 narration — final pass',                        credits: '880',   cost: '$0.04', proj: 'Podcast' },
    { ts: 'Jul 19, 09:30', tool: 'Runway',     model: 'Gen-4 Turbo',           prompt: 'Time-lapse storm clouds over mountain range',             credits: '25',    cost: '$0.25', proj: 'Product Videos' },
    { ts: 'Jul 18, 17:12', tool: 'ElevenLabs', model: 'Eleven Multilingual v2', prompt: 'Podcast intro — episode 14',                             credits: '620',   cost: '$0.03', proj: '' },
  ];

  const tableRows = rows.map(r => `<tr>
    <td class="ts">${r.ts}</td>
    <td class="tool">${r.tool}</td>
    <td class="model">${r.model}</td>
    <td class="prompt-cell">${r.prompt}</td>
    <td class="num">${r.credits}</td>
    <td class="cost">${r.cost}</td>
    <td class="proj-cell">${r.proj ? `<span class="proj-badge">${r.proj}</span>` : '—'}</td>
  </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en"${dark ? ' data-theme="dark"' : ''}><head><meta charset="UTF-8">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<style>*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
${dashCSS}
body{width:1280px}
</style></head><body>

<header>
  <h1>${LOGO}PromptLedger</h1>
  <div class="header-actions">
    <button class="btn">${dark ? 'Light mode' : 'Dark mode'}</button>
    <select class="btn" style="min-width:80px"><option>USD $</option></select>
    <button class="btn btn-primary">Export CSV</button>
    <button class="btn btn-danger">Clear all</button>
  </div>
</header>

<main>
  <div class="tabs">
    <button class="tab active">Generations</button>
    <button class="tab">Plans &amp; Settings</button>
  </div>

  <div class="filter-bar">
    <div class="filter-group"><span class="filter-label">Tool</span>
      <select><option>All tools</option></select></div>
    <div class="filter-group"><span class="filter-label">Project</span>
      <select><option>All projects</option></select></div>
    <div class="filter-group"><span class="filter-label">From</span>
      <input type="date" value="2026-06-22"/></div>
    <div class="filter-group"><span class="filter-label">To</span>
      <input type="date" value="2026-07-21"/></div>
    <div class="filter-group"><span class="filter-label">Search</span>
      <input type="text" placeholder="Filter by prompt…"/></div>
    <div class="filter-actions">
      <button class="btn">Apply</button>
      <button class="btn">Clear</button>
    </div>
  </div>

  <div class="summary-cards">
    <div class="card"><span class="card-label">Total cost</span><span class="card-value">$18.40</span></div>
    <div class="card"><span class="card-label">Total credits</span><span class="card-value">2,847</span></div>
    <div class="card"><span class="card-label">Generations</span><span class="card-value">47</span></div>
    <div class="card"><span class="card-label">Flagged</span><span class="card-value flagged">2</span></div>
  </div>

  <div class="charts-row">
    <div class="chart-box">
      <div class="chart-header">
        <span class="chart-title">Daily spend</span>
        <div class="range-toggle">
          <button class="range-btn active">30d</button>
          <button class="range-btn">90d</button>
        </div>
      </div>
      <div class="chart-canvas-wrap"><canvas id="ts-chart"></canvas></div>
    </div>
    <div class="chart-box">
      <div class="chart-header"><span class="chart-title">By tool</span></div>
      <div class="chart-canvas-wrap"><canvas id="donut-chart"></canvas></div>
    </div>
  </div>

  <div class="table-section">
    <div class="table-header">
      <span class="chart-title">Generations</span>
      <span class="record-count">47 records</span>
    </div>
    <table>
      <thead><tr>
        <th>Time</th><th>Tool</th><th>Model</th><th>Prompt</th>
        <th style="text-align:right">Credits</th><th style="text-align:right">Cost</th><th>Project</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>
</main>

<script>
new Chart(document.getElementById('ts-chart'), {
  type: 'line',
  data: {
    labels: ${JSON.stringify(chartLabels)},
    datasets: [{
      data: ${JSON.stringify(SPEND)},
      borderColor: '${lineColor}',
      backgroundColor: '${lineFill}',
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0.35,
      fill: true,
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: {
      x: { grid: { color: '${gridColor}' }, ticks: { color: '${tickColor}', font: { size: 10 }, maxTicksLimit: 8 }, border: { display: false } },
      y: { grid: { color: '${gridColor}' }, ticks: { color: '${tickColor}', font: { size: 10 }, callback: v => '$' + v }, border: { display: false } }
    }
  }
});

new Chart(document.getElementById('donut-chart'), {
  type: 'doughnut',
  data: {
    labels: ['Runway', 'ElevenLabs'],
    datasets: [{ data: [14.30, 4.10], backgroundColor: ${JSON.stringify(donutColors)}, borderWidth: 0 }]
  },
  options: {
    responsive: true, maintainAspectRatio: false, cutout: '65%',
    plugins: {
      legend: { position: 'bottom', labels: { color: '${legendColor}', font: { size: 11 }, padding: 12, boxWidth: 10, boxHeight: 10 } },
      tooltip: { enabled: true }
    }
  }
});
</script>
</body></html>`;
}

// ── Render ────────────────────────────────────────────────────────────────────

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

async function shot(html, file, w, h) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.screenshot({ path: file });
  await page.close();
  console.log('✓', path.relative(ROOT, file));
}

await shot(popupHtml(false), path.join(OUT, '1-popup-light.png'),     640,  400);
await shot(popupHtml(true),  path.join(OUT, '2-popup-dark.png'),      640,  400);
await shot(dashHtml(false),  path.join(OUT, '3-dashboard-light.png'), 1280, 800);
await shot(dashHtml(true),   path.join(OUT, '4-dashboard-dark.png'),  1280, 800);

await browser.close();
console.log('\nSaved to store/');
