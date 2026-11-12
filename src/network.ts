import { GRACE_MS, inPage, withTimeout, type PageLike } from './page.js';

export interface WaitForNetworkQuietOptions {
  /** How long the network must stay quiet. Default 500 ms. */
  quietMs?: number;
  /** Give up after this many ms. Default 5000. */
  timeout?: number;
  /** Requests allowed to stay open while still counting as quiet. Default 0. */
  maxInflight?: number;
  /**
   * After this many ms, up to 2 open requests count as quiet (long-polls, analytics beacons, streams).
   * Default: half of `timeout`. Set to `Infinity` to keep the strict rule.
   */
  relaxAfterMs?: number;
}

export interface WaitForNetworkQuietResult {
  quiet: boolean;
  timedOut: boolean;
  /** Requests still open at the end (only requests started while tracking are seen). */
  inflight: number;
  ms: number;
  /** 'events' when the page's request events were used, 'in-page' for the Resource Timing fallback. */
  method: 'events' | 'in-page';
}

export interface RequestTracker {
  /** Requests seen starting and not yet finished or failed. */
  readonly inflight: number;
  /** Waits until the tracked requests have been quiet for `quietMs`. */
  waitForQuiet(options?: WaitForNetworkQuietOptions): Promise<WaitForNetworkQuietResult>;
  /** Removes the event listeners. */
  stop(): void;
}

interface RequestLike {
  url?: () => string;
}

/**
 * Starts counting open requests through the page's `request` / `requestfinished` / `requestfailed` events,
 * which Playwright and Puppeteer both emit. Start it before `page.goto()` (or before an action) when you want
 * every request counted, then call `waitForQuiet()`. Returns undefined when the object has no `on` method.
 */
export function trackRequests(page: PageLike): RequestTracker | undefined {
  if (typeof page.on !== 'function') return undefined;
  const open = new Set<unknown>();
  let lastChange = Date.now();
  let stopped = false;
  const ignored = (req: RequestLike) => {
    try {
      const url = typeof req?.url === 'function' ? req.url() : '';
      return url.startsWith('data:') || url.startsWith('blob:');
    } catch {
      return false;
    }
  };
  const onRequest = (req: RequestLike) => {
    if (ignored(req)) return;
    open.add(req);
    lastChange = Date.now();
  };
  const onDone = (req: RequestLike) => {
    if (open.delete(req)) lastChange = Date.now();
  };
  const off = (event: string, listener: (req: RequestLike) => void) => {
    if (typeof page.off === 'function') page.off(event, listener);
    else if (typeof page.removeListener === 'function') page.removeListener(event, listener);
  };
  page.on('request', onRequest);
  page.on('requestfinished', onDone);
  page.on('requestfailed', onDone);

  return {
    get inflight() {
      return open.size;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      off('request', onRequest);
      off('requestfinished', onDone);
      off('requestfailed', onDone);
    },
    waitForQuiet(options: WaitForNetworkQuietOptions = {}) {
      const quietMs = Math.max(0, options.quietMs ?? 500);
      const timeout = Math.max(0, options.timeout ?? 5000);
      const maxInflight = Math.max(0, options.maxInflight ?? 0);
      const relaxAfterMs = options.relaxAfterMs ?? timeout / 2;
      const started = Date.now();
      // Quiet time counts from the last request start or finish (or from when tracking began).
      const since = () => Date.now() - lastChange;
      return new Promise<WaitForNetworkQuietResult>((resolve) => {
        const tick = () => {
          const elapsed = Date.now() - started;
          const allowed = elapsed >= relaxAfterMs ? Math.max(maxInflight, 2) : maxInflight;
          if (open.size <= allowed && since() >= quietMs) {
            resolve({ quiet: true, timedOut: false, inflight: open.size, ms: elapsed, method: 'events' });
          } else if (elapsed >= timeout) {
            resolve({ quiet: false, timedOut: true, inflight: open.size, ms: elapsed, method: 'events' });
          } else setTimeout(tick, 50);
        };
        tick();
      });
    },
  };
}

/**
 * Waits until no requests have been in flight for `quietMs`.
 *
 * Works the same for Playwright and Puppeteer and also covers background images and fetch/XHR. Requests that
 * were already open before the call are not seen (use {@link trackRequests} before navigating for that). When
 * the object has no `on` method (a Frame), it falls back to watching Resource Timing entries in the page.
 */
export async function waitForNetworkQuiet(page: PageLike, options: WaitForNetworkQuietOptions = {}): Promise<WaitForNetworkQuietResult> {
  const tracker = trackRequests(page);
  if (!tracker) return inPageQuiet(page, Math.max(0, options.quietMs ?? 500), Math.max(0, options.timeout ?? 5000));
  try {
    return await tracker.waitForQuiet(options);
  } finally {
    tracker.stop();
  }
}

function resourcesQuietInPage(arg: { quietMs: number; timeoutMs: number }) {
  return new Promise<{ quiet: boolean; ms: number }>((resolve) => {
    const started = performance.now();
    let last = started;
    let observer: PerformanceObserver | undefined;
    try {
      observer = new PerformanceObserver(() => {
        last = performance.now();
      });
      observer.observe({ type: 'resource', buffered: false });
    } catch {
      observer = undefined;
    }
    const tick = () => {
      const now = performance.now();
      if (now - last >= arg.quietMs) {
        observer?.disconnect();
        resolve({ quiet: true, ms: now - started });
      } else if (now - started >= arg.timeoutMs) {
        observer?.disconnect();
        resolve({ quiet: false, ms: now - started });
      } else setTimeout(tick, 50);
    };
    tick();
  });
}

async function inPageQuiet(page: PageLike, quietMs: number, timeout: number): Promise<WaitForNetworkQuietResult> {
  const started = Date.now();
  const result = await withTimeout(inPage(page, resourcesQuietInPage, { quietMs, timeoutMs: timeout }), timeout + GRACE_MS);
  const quiet = !result.timedOut && result.value.quiet;
  return { quiet, timedOut: !quiet, inflight: 0, ms: Date.now() - started, method: 'in-page' };
}
