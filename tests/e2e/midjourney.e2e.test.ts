import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Browser, Page } from 'puppeteer';
import { launchBrowser, readExtensionRecords, clearExtensionRecords } from './setup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MJ_HTML = readFileSync(path.resolve(__dirname, '../fixtures/midjourney.html'), 'utf8');

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

async function openMidjourneyPage(): Promise<Page> {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (!/midjourney\.com/.test(url)) { req.continue().catch(() => {}); return; }
    if (req.resourceType() === 'document') {
      req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: MJ_HTML });
    } else {
      req.respond({ status: 200, contentType: 'application/json', body: '{}' });
    }
  });
  await page.goto('https://www.midjourney.com/imagine', { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 600));
  return page;
}

async function typeAndClickCreate(page: Page, prompt: string): Promise<void> {
  await page.evaluate((text) => {
    const el = document.querySelector('[data-testid="prompt-input"]') as HTMLTextAreaElement | null;
    if (el) el.value = text;
  }, prompt);
  await page.evaluate(() => {
    document.querySelector('[data-testid="create-button"]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
    );
  });
}

describe('Midjourney adapter — generation recording', () => {
  it('records a generation when GPU hours balance drops', async () => {
    const page = await openMidjourneyPage();
    await typeAndClickCreate(page, 'a cyberpunk cityscape at night');
    await new Promise((r) => setTimeout(r, 400));

    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="fast-hours-remaining"]');
      if (el) el.textContent = '9.5 hr';
    });

    await new Promise((r) => setTimeout(r, 3_000));

    const records = await readExtensionRecords(browser);
    expect(records).toHaveLength(1);
    expect(records[0]!['tool']).toBe('midjourney');
    expect(records[0]!['model']).toBe('v7');
    expect(records[0]!['prompt']).toBe('a cyberpunk cityscape at night');
    await page.close();
  });

  it('calculates credits_used as the GPU hours delta', async () => {
    const page = await openMidjourneyPage();
    await typeAndClickCreate(page, 'floating islands in the sky');
    await new Promise((r) => setTimeout(r, 400));

    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="fast-hours-remaining"]');
      if (el) el.textContent = '9.5 hr'; // 10 - 9.5 = 0.5 hr used
    });

    await new Promise((r) => setTimeout(r, 3_000));

    const records = await readExtensionRecords(browser);
    expect(records[0]!['credits_used']).toBeCloseTo(0.5, 5);
    await page.close();
  });

  it('parses "hr min" format balance correctly', async () => {
    const page = await openMidjourneyPage();

    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="fast-hours-remaining"]');
      if (el) el.textContent = '14 hr 42 min'; // 14.7 hr
    });

    await typeAndClickCreate(page, 'misty mountain valleys');
    await new Promise((r) => setTimeout(r, 400));

    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="fast-hours-remaining"]');
      if (el) el.textContent = '14 hr 12 min'; // 14.2 hr — used 0.5 hr
    });

    await new Promise((r) => setTimeout(r, 3_000));

    const records = await readExtensionRecords(browser);
    expect(records[0]!['credits_used']).toBeCloseTo(0.5, 5);
    await page.close();
  });

  it('does not record when balance has not changed after click', async () => {
    const page = await openMidjourneyPage();
    await typeAndClickCreate(page, 'abstract art');
    await new Promise((r) => setTimeout(r, 2_000));

    const records = await readExtensionRecords(browser);
    expect(records).toHaveLength(0);
    await page.close();
  });

  it('does not record for balance changes before the button is clicked', async () => {
    const page = await openMidjourneyPage();

    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="fast-hours-remaining"]');
      if (el) el.textContent = '9 hr';
    });
    await new Promise((r) => setTimeout(r, 1_000));

    const records = await readExtensionRecords(browser);
    expect(records).toHaveLength(0);
    await page.close();
  });
});
