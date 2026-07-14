/**
 * A CSS selector string, or a function returning the target element (for
 * elements with no stable attributes to select on).
 */
export type ElementFinder = string | (() => Element | null);

function findElement(finder: ElementFinder, root: ParentNode): Element | null {
  return typeof finder === 'string'
    ? (root as Element | Document).querySelector(finder)
    : finder();
}

/**
 * Waits for the first element matching `finder` to appear in the DOM,
 * then calls `callback`. If the element already exists, callback fires synchronously.
 *
 * The callback may return a cleanup function that is called when the outer
 * cleanup is invoked. Returns a cleanup function.
 */
export function waitForElement(
  finder: ElementFinder,
  callback: (el: Element) => (() => void) | void,
  root: ParentNode = document,
): () => void {
  const existing = findElement(finder, root);
  if (existing) {
    const teardown = callback(existing);
    return teardown ?? noOp;
  }

  let innerTeardown: (() => void) | undefined;

  const observer = new MutationObserver(() => {
    const el = findElement(finder, root);
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
 * Watches the text content of the element matching `finder` for changes.
 * Calls `callback(currentText, previousText)` on each change.
 */
export function watchText(
  finder: ElementFinder,
  callback: (current: string, previous: string) => void,
  root: ParentNode = document,
): () => void {
  return waitForElement(
    finder,
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
