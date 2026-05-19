import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Browser, Page } from 'puppeteer';
import { launchBrowser, readExtensionRecords, clearExtensionRecords } from './setup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNWAY_HTML = readFileSync(path.resolve(__dirname, '../fixtures/runway.html'), 'utf8');

let browser: Browser;

beforeAll(async () => {
  browser = await launchBrowser();
  await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'),
    { timeout: 15_000 },
  );
});
afterAll(async () => { await browser?.close(); });
beforeEach(async () => { await clearExtensionRecords(browser); });

async function openRunwayPage(): Promise<Page> {
  const page = await browser.newPage();

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (!/runwayml\.com/.test(url)) { req.continue().catch(() => {}); return; }
    if (req.resourceType() === 'document') {
      req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: RUNWAY_HTML });
    } else {
      req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ credits: 2450 }) });
    }
  });

  await page.goto('https://app.runwayml.com/studio', { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 600));
  return page;
}

// Sets textarea value and dispatches a click on the generate button via evaluate()
// so we don't block on Puppeteer's native interaction methods under request interception.
async function typeAndClickGenerate(page: Page, prompt: string): Promise<void> {
  await page.evaluate((text) => {
    const el = document.querySelector('[data-testid="prompt-input"]') as HTMLTextAreaElement | null;
    if (el) el.value = text;
  }, prompt);
  await page.evaluate(() => {
    document.querySelector('[data-testid="generate-button"]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
    );
  });
}

// Simulates an API response using an absolute same-origin URL so the full hostname
// appears in args[0] and passes the RUNWAY_API regex check in the content script.
// Relative URLs strip the hostname, causing the URL pattern match to fail silently.
async function simulateApiResponse(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await fetch('https://app.runwayml.com/api/generate', { method: 'POST' }).catch(() => {});
  });
}

describe('Runway adapter — network path', () => {
  it('patches window.fetch in the page main world', async () => {
    const page = await openRunwayPage();
    const isPatched = await page.evaluate(
      () => window.fetch.toString().includes('[native code]') === false,
    );
    expect(isPatched).toBe(true);
    await page.close();
  });

  it('emits __pl_network__ postMessage for matching fetch responses', async () => {
    const page = await openRunwayPage();

    await page.evaluate(() => {
      (window as Window & { _pl_msgs: unknown[] })._pl_msgs = [];
      window.addEventListener('message', (e) => {
        if ((e.data as { type?: string })?.type === '__pl_network__') {
          (window as Window & { _pl_msgs: unknown[] })._pl_msgs.push(e.data);
        }
      });
    });

    await simulateApiResponse(page);
    await new Promise((r) => setTimeout(r, 500));

    const msgs = await page.evaluate(
      () => (window as Window & { _pl_msgs: unknown[] })._pl_msgs,
    );
    expect(msgs.length).toBeGreaterThan(0);
    await page.close();
  });
});

describe('Runway adapter — generation recording', () => {
  it('records a generation via API balance response when button is clicked', async () => {
    const page = await openRunwayPage();

    await typeAndClickGenerate(page, 'a beautiful sunset over mountains');
    await new Promise((r) => setTimeout(r, 400));
    await simulateApiResponse(page);

    await new Promise((r) => setTimeout(r, 3_000));

    const records = await readExtensionRecords(browser);
    expect(records).toHaveLength(1);
    expect(records[0]!['tool']).toBe('runway');
    expect(records[0]!['prompt']).toBe('a beautiful sunset over mountains');
    expect(records[0]!['credits_used']).toBe(50); // 2500 - 2450
    expect(records[0]!['model']).toBe('Gen-4 Turbo');

    await page.close();
  });

  it('records a generation via DOM balance drop when button is clicked', async () => {
    const page = await openRunwayPage();

    await typeAndClickGenerate(page, 'a stormy ocean at night');
    await new Promise((r) => setTimeout(r, 400));

    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="credits-display"]');
      if (el) el.textContent = '2430';
    });

    await new Promise((r) => setTimeout(r, 3_000));

    const records = await readExtensionRecords(browser);
    expect(records[0]!['credits_used']).toBe(70); // 2500 - 2430
    expect(records[0]!['prompt']).toBe('a stormy ocean at night');

    await page.close();
  });

  it('records a generation when Enter is pressed in the prompt field', async () => {
    const page = await openRunwayPage();

    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="prompt-input"]') as HTMLTextAreaElement | null;
      if (el) el.value = 'flying through clouds';
    });
    // Dispatch keydown Enter on the textarea to trigger the keydown handler
    await page.evaluate(() => {
      document.querySelector('[data-testid="prompt-input"]')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, composed: true }),
      );
    });
    await new Promise((r) => setTimeout(r, 400));

    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="credits-display"]');
      if (el) el.textContent = '2460';
    });

    await new Promise((r) => setTimeout(r, 3_000));

    const records = await readExtensionRecords(browser);
    expect(records[0]!['prompt']).toBe('flying through clouds');
    expect(records[0]!['credits_used']).toBe(40); // 2500 - 2460

    await page.close();
  });

  it('does not double-record when both paths fire', async () => {
    const page = await openRunwayPage();

    await typeAndClickGenerate(page, 'sunset timelapse');
    await new Promise((r) => setTimeout(r, 400));

    await Promise.all([
      simulateApiResponse(page),
      page.evaluate(() => {
        const el = document.querySelector('[data-testid="credits-display"]');
        if (el) el.textContent = '2450';
      }),
    ]);

    await new Promise((r) => setTimeout(r, 3_000));
    await new Promise((r) => setTimeout(r, 500));

    const records = await readExtensionRecords(browser);
    expect(records).toHaveLength(1);

    await page.close();
  });
});
