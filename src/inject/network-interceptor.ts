// Runs in the page's main world (world: "MAIN", run_at: "document_start").
// Patches window.fetch and XMLHttpRequest to forward JSON responses to the
// isolated content-script world via postMessage.
//
// Built as IIFE → dist/inject/network-interceptor.js

const PL_NETWORK_EVENT = '__pl_network__';

function emit(url: string, body: unknown): void {
  window.postMessage({ type: PL_NETWORK_EVENT, url, body }, '*');
}

// --- fetch patch ---
const _fetch = window.fetch.bind(window);
window.fetch = async function (...args: Parameters<typeof fetch>): Promise<Response> {
  const response = await _fetch(...args);
  const url = args[0] instanceof Request ? args[0].url : String(args[0]);
  response
    .clone()
    .json()
    .then(
      (body: unknown) => emit(url, body),
      () => {}, // not JSON — ignore
    );
  return response;
};

// --- XMLHttpRequest patch ---
type AugXHR = XMLHttpRequest & { _pl_url?: string };

const _open = XMLHttpRequest.prototype.open;
const _send = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function (
  this: AugXHR,
  method: string,
  url: string | URL,
  async?: boolean,
  username?: string | null,
  password?: string | null,
): void {
  this._pl_url = url.toString();
  _open.call(this, method, url, async ?? true, username ?? null, password ?? null);
};

XMLHttpRequest.prototype.send = function (
  this: AugXHR,
  body?: Document | XMLHttpRequestBodyInit | null,
): void {
  this.addEventListener('load', () => {
    if (!this._pl_url) return;
    try {
      emit(this._pl_url, JSON.parse(this.responseText));
    } catch {
      // not JSON — ignore
    }
  });
  _send.call(this, body);
};
