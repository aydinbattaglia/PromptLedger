/**
 * Waits for the first element matching `selector` to appear in the DOM,
 * then calls `callback`. If the element already exists, callback fires synchronously.
 *
 * The callback may return a cleanup function that is called when the outer
 * cleanup is invoked. Returns a cleanup function.
 */
export function waitForElement(
  selector: string,
  callback: (el: Element) => (() => void) | void,
  root: ParentNode = document,
): () => void {
  const existing = (root as Element | Document).querySelector(selector);
  if (existing) {
    const teardown = callback(existing);
    return teardown ?? noOp;
  }

  let innerTeardown: (() => void) | undefined;

  const observer = new MutationObserver(() => {
    const el = (root as Element | Document).querySelector(selector);
    if (!el) return;
    observer.disconnect();
    const teardown = callback(el);
    if (teardown) innerTeardown = teardown;
  });

  observer.observe(root as Node, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    innerTeardown?.();
  };
}

/**
 * Watches the text content of the element matching `selector` for changes.
 * Calls `callback(currentText, previousText)` on each change.
 */
export function watchText(
  selector: string,
  callback: (current: string, previous: string) => void,
  root: ParentNode = document,
): () => void {
  return waitForElement(
    selector,
    (el) => {
      let prev = el.textContent ?? '';

      const observer = new MutationObserver(() => {
        const current = el.textContent ?? '';
        if (current !== prev) {
          callback(current, prev);
          prev = current;
        }
      });

      observer.observe(el, { characterData: true, childList: true, subtree: true });
      return () => observer.disconnect();
    },
    root,
  );
}

/**
 * Uses event delegation to detect clicks on elements matching `selector`.
 * Safer than attaching directly to SPA-rendered elements that get replaced on re-render.
 * Listens in capture phase so it fires before the page's own handlers.
 * Returns a cleanup function.
 */
export function delegateClick(
  selector: string,
  callback: (el: Element, event: MouseEvent) => void,
  root: Document | Element = document,
): () => void {
  const handler = (event: Event) => {
    const target = (event as MouseEvent).target as Element | null;
    const match = target?.closest(selector);
    if (match) callback(match, event as MouseEvent);
  };
  (root as EventTarget).addEventListener('click', handler, true);
  return () => (root as EventTarget).removeEventListener('click', handler, true);
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noOp = () => {};
