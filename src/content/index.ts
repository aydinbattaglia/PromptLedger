import type { AdapterContext } from '../adapters/types.js';
import { getAdapter } from '../adapters/registry.js';

// Side-effect imports — each file calls registerAdapter() on load
import '../adapters/elevenlabs.js';
import '../adapters/runway.js';
import '../adapters/midjourney.js';

let paused = false;

chrome.storage.local.get('paused', ({ paused: p }) => {
  paused = Boolean(p);
});

chrome.storage.onChanged.addListener((changes) => {
  if ('paused' in changes) {
    paused = Boolean(changes['paused']?.newValue);
  }
});

const factory = getAdapter(location.hostname);

if (factory) {
  const adapter = factory();
  console.debug(`[PromptLedger] Loaded adapter: ${adapter.tool}`);

  const context: AdapterContext = {
    start({ model, prompt, balance_before }) {
      if (paused) return '';
      const session_key = crypto.randomUUID();
      chrome.runtime.sendMessage({
        type: 'GENERATION_START' as const,
        payload: { session_key, tool: adapter.tool, model, prompt, balance_before },
      });
      return session_key;
    },

    complete(session_key, opts) {
      if (!session_key) return; // empty key = was paused at start time
      chrome.runtime.sendMessage({
        type: 'GENERATION_COMPLETE' as const,
        payload: { session_key, tool: adapter.tool, ...opts },
      });
    },

    isPaused() {
      return paused;
    },
  };

  adapter.mount(context);
  window.addEventListener('beforeunload', () => adapter.unmount());
} else {
  console.debug(`[PromptLedger] No adapter for ${location.hostname}`);
}
