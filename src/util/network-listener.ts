// Content-script side of the network bridge.
// Receives postMessage events from inject/network-interceptor.js (main world)
// and calls registered callbacks when the response URL matches a pattern.

const PL_NETWORK_EVENT = '__pl_network__';

export interface NetworkEvent {
  url: string;
  body: unknown;
}

/**
 * Listens for JSON responses forwarded by the main-world network interceptor.
 * Calls `callback` when the URL matches `urlPattern`.
 * Returns a cleanup function.
 */
export function interceptNetwork(
  urlPattern: RegExp,
  callback: (event: NetworkEvent) => void,
): () => void {
  const handler = (event: MessageEvent<unknown>) => {
    if (!event.data || typeof event.data !== 'object') return;
    const data = event.data as Record<string, unknown>;
    if (data['type'] !== PL_NETWORK_EVENT) return;
    const url = String(data['url'] ?? '');
    if (!urlPattern.test(url)) return;
    callback({ url, body: data['body'] });
  };

  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
