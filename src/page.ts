/**
 * The small slice of a page this library needs. A Playwright `Page` and a Puppeteer `Page` both fit it, so the
 * library never imports either package. A Playwright or Puppeteer `Frame` also fits for everything except
 * request tracking (frames have no `on`), where an in-page fallback is used.
 */
export interface PageLike {
  // Both libraries accept a string expression and await a returned promise.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evaluate(pageFunction: any, ...args: any[]): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on?(event: any, listener: any): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off?(event: any, listener: any): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeListener?(event: any, listener: any): unknown;
}

/**
 * Runs a self-contained function inside the page with one JSON argument.
 *
 * The function is sent as source text inside a string expression, which Playwright and Puppeteer evaluate the
 * same way. The `__name` shim keeps it working when a build tool (esbuild/tsx with keepNames) wraps nested
 * functions in `__name(...)` calls that do not exist in the page.
 */
export function inPage<A, R>(page: PageLike, fn: (arg: A) => R | Promise<R>, arg: A): Promise<R> {
  const expression = `(() => { const __name = (f) => f; return (${fn.toString()})(${JSON.stringify(arg ?? null)}); })()`;
  return page.evaluate(expression) as Promise<R>;
}

export type Timed<T> = { timedOut: false; value: T } | { timedOut: true; value?: undefined };

/** Resolves with the promise's value, or with `timedOut: true` after `ms`. Rejections pass through. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<Timed<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Timed<T>>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), Math.max(0, ms));
  });
  return Promise.race([promise.then((value): Timed<T> => ({ timedOut: false, value })), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** Extra time allowed on the Node side before a stuck page (busy main thread) is given up on. */
export const GRACE_MS = 1000;
