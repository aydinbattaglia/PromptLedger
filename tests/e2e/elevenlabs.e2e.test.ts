import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Browser, Page } from 'puppeteer';
import { launchBrowser, readExtensionRecords, clearExtensionRecords } from './setup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EL_HTML = readFileSync(path.resolve(__dirname, '../fixtures/elevenlabs.html'), 'utf8');
const EL_STUDIO_HTML = readFileSync(path.resolve(__dirname, '../fixtures/elevenlabs-studio.html'), 'utf8');

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

async function openElevenLabsPage(): Promise<Page> {
  const page = await browser.newPage();

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (!/elevenlabs\.io/.test(url)) { req.continue().catch(() => {}); return; }
    if (req.resourceType() === 'document') {
      req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: EL_HTML });
    } else {
      req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ character_count: 500, remaining_character_count: 9500 }) });
    }
  });

  await page.goto('https://elevenlabs.io/app/speech-synthesis', { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 600));
  return page;
}

// Click via evaluate() to avoid Puppeteer blocking under request interception.
async function clickGenerate(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelector('[data-testid="generate-speech"]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
    );
  });
}

async function openStudioPage(): Promise<Page> {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (!/elevenlabs\.io/.test(url)) { req.continue().catch(() => {}); return; }
    if (req.resourceType() === 'document') {
      req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: EL_STUDIO_HTML });
    } else {
      req.respond({ status: 200, contentType: 'application/json', body: '{}' });
    }
  });
  await page.goto('https://elevenlabs.io/app/studio/project', { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 600));
  return page;
}

async function clickStudioSend(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelector('button[aria-label="Send"]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
    );
  });
}

describe('ElevenLabs adapter — Studio mode', () => {
  it('records a generation when a new audio element appears', async () => {
    const page = await openStudioPage();
    await clickStudioSend(page);
    await new Promise((r) => setTimeout(r, 400));

    await page.evaluate(() => {
      const audio = document.createElement('audio');
      audio.src = 'blob:https://elevenlabs.io/studio-audio-123';
      document.body.appendChild(audio);
    });

    await new Promise((r) => setTimeout(r, 3_000));

    const records = await readExtensionRecords(browser);
    expect(records).toHaveLength(1);
    expect(records[0]!['tool']).toBe('elevenlabs');
    expect(records[0]!['model']).toBe('Studio');
    await page.close();
  });

  it('records a generation via content/generations network response', async () => {
    const page = await openStudioPage();
    await clickStudioSend(page);
    await new Promise((r) => setTimeout(r, 400));

    await page.evaluate(async () => {
      await fetch('https://elevenlabs.io/api/content/generations/mock').catch(() => {});
    });

    await new Promise((r) => setTimeout(r, 3_000));

    const records = await readExtensionRecords(browser);
    expect(records).toHaveLength(1);
    expect(records[0]!['tool']).toBe('elevenlabs');
    await page.close();
  });

  it('does not double-record when both audio and network complete fire', async () => {
    const page = await openStudioPage();
    await clickStudioSend(page);
    await new Promise((r) => setTimeout(r, 400));

    await page.evaluate(async () => {
      await fetch('https://elevenlabs.io/api/content/generations/test').catch(() => {});
      const audio = document.createElement('audio');
      audio.src = 'blob:https://elevenlabs.io/studio-audio-456';
      document.body.appendChild(audio);
    });

    await new Promise((r) => setTimeout(r, 3_000));

    const records = await readExtensionRecords(browser);
    expect(records).toHaveLength(1);
    await page.close();
  });

  it('captures prompt text from the Edit field', async () => {
    const page = await openStudioPage();
    await clickStudioSend(page);
    await new Promise((r) => setTimeout(r, 400));

    await page.evaluate(() => {
      const audio = document.createElement('audio');
      audio.src = 'blob:https://elevenlabs.io/studio-audio-789';
      document.body.appendChild(audio);
    });

    await new Promise((r) => setTimeout(r, 3_000));

    const records = await readExtensionRecords(browser);
    expect(records[0]!['prompt']).toBe('Hello studio world');
    await page.close();
  });

  it('records a generation when Enter is pressed in the Edit field', async () => {
    const page = await openStudioPage();

    await page.evaluate(() => {
      document.querySelector('[aria-label="Edit field"]')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    await new Promise((r) => setTimeout(r, 400));

    await page.evaluate(() => {
      const audio = document.createElement('audio');
      audio.src = 'blob:https://elevenlabs.io/studio-audio-enter';
      document.body.appendChild(audio);
    });

    await new Promise((r) => setTimeout(r, 3_000));

    const records = await readExtensionRecords(browser);
    expect(records).toHaveLength(1);
    await page.close();
  });
});

describe('ElevenLabs adapter — generation recording', () => {
  it('records a generation when a new audio element appears', async () => {
    const page = await openElevenLabsPage();

    await clickGenerate(page);
    await new Promise((r) => setTimeout(r, 400));

    await page.evaluate(() => {
      const audio = document.createElement('audio');
      audio.src = 'blob:https://elevenlabs.io/mock-audio-id-123';
      document.body.appendChild(audio);
    });

    await new Promise((r) => setTimeout(r, 3_000));

    const records = await readExtensionRecords(browser);
    expect(records).toHaveLength(1);
    expect(records[0]!['tool']).toBe('elevenlabs');
    expect(records[0]!['model']).toBe('Eleven Multilingual v2');

    await page.close();
  });

  it('records credits used when quota counter changes', async () => {
    const page = await openElevenLabsPage();

    await clickGenerate(page);
    await new Promise((r) => setTimeout(r, 400));

    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="characters-remaining"]');
      if (el) el.textContent = '9889'; // used 111 chars
    });

    await new Promise((r) => setTimeout(r, 3_000));

    const records = await readExtensionRecords(browser);
    expect(records[0]!['credits_used']).toBe(111); // 10000 - 9889

    await page.close();
  });

  it('records a generation via API response path', async () => {
    const page = await openElevenLabsPage();

    await clickGenerate(page);
    await new Promise((r) => setTimeout(r, 400));

    // Absolute same-origin URL so the hostname appears in args[0] and passes the
    // EL_API regex in the content script. Relative URLs strip the hostname, failing silently.
    await page.evaluate(async () => {
      await fetch('https://elevenlabs.io/api/v1/text-to-speech/mock', { method: 'POST' }).catch(() => {});
    });

    await new Promise((r) => setTimeout(r, 3_000));

    const records = await readExtensionRecords(browser);
    expect(records).toHaveLength(1);
    expect(records[0]!['tool']).toBe('elevenlabs');

    await page.close();
  });

  it('does not record an existing audio element as a new generation', async () => {
    const page = await openElevenLabsPage();

    await page.evaluate(() => {
      const audio = document.createElement('audio');
      audio.src = 'blob:https://elevenlabs.io/existing-audio-id';
      document.body.appendChild(audio);
    });

    await clickGenerate(page);
    await new Promise((r) => setTimeout(r, 1000));

    const records = await readExtensionRecords(browser);
    expect(records).toHaveLength(0);

    await page.close();
  });
});
