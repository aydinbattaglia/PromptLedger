import puppeteer, { type Browser, type Page } from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const EXTENSION_PATH = path.resolve(__dirname, '../../dist');

export async function launchBrowser(): Promise<Browser> {
  return puppeteer.launch({
    // Set PUPPETEER_HEADLESS=true for CI (requires Chrome 112+).
    headless: process.env['PUPPETEER_HEADLESS'] === 'true' ? true : false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });
}

/** Derive the extension ID from the service worker target URL. */
async function getExtensionId(browser: Browser): Promise<string | null> {
  const existing = browser.targets().find(
    (t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'),
  );
  const target = existing ?? await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'),
    { timeout: 8_000 },
  ).catch(() => null);

  if (!target) return null;
  return target.url().match(/chrome-extension:\/\/([^/]+)/)?.[1] ?? null;
}

/**
 * Read GenerationRecords by opening the extension's popup page (same origin as the SW)
 * and querying IndexedDB there. Avoids attaching a CDP session to the SW, which can
 * block message delivery from content scripts.
 */
export async function readExtensionRecords(browser: Browser): Promise<Record<string, unknown>[]> {
  const extensionId = await getExtensionId(browser);
  if (!extensionId) return [];

  const page: Page = await browser.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 5_000,
    });
    return await page.evaluate(async () => {
      return new Promise<Record<string, unknown>[]>((resolve) => {
        const req = indexedDB.open('promptledger', 1);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('generations')) { resolve([]); return; }
          const all = db.transaction('generations', 'readonly').objectStore('generations').getAll();
          all.onsuccess = () => resolve(all.result as Record<string, unknown>[]);
          all.onerror = () => resolve([]);
        };
        req.onerror = () => resolve([]);
      });
    });
  } catch {
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

/** Clear the GenerationRecord store via the extension popup page. */
export async function clearExtensionRecords(browser: Browser): Promise<void> {
  const extensionId = await getExtensionId(browser);
  if (!extensionId) return;

  const page: Page = await browser.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 5_000,
    });
    await page.evaluate(async () => {
      return new Promise<void>((resolve) => {
        const req = indexedDB.open('promptledger', 1);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('generations')) { resolve(); return; }
          const tx = db.transaction('generations', 'readwrite');
          tx.objectStore('generations').clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        };
        req.onerror = () => resolve();
      });
    });
    // Also reset per-tool EMA validation state so credit deltas recorded by one
    // test don't cause 5×-average flagging in the next
    await page.evaluate(async () => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.get(null, (all) => {
          const emaKeys = Object.keys(all).filter((k) => k.startsWith('avg_') || k.startsWith('avgn_'));
          if (emaKeys.length === 0) { resolve(); return; }
          chrome.storage.local.remove(emaKeys, () => resolve());
        });
      });
    });
  } catch {
    // ignore — empty store is fine
  } finally {
    await page.close().catch(() => {});
  }
}
