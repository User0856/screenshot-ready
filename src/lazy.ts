import { waitForImages, type WaitForImagesResult } from './images.js';
import { trackRequests, type WaitForNetworkQuietResult } from './network.js';
import { GRACE_MS, inPage, withTimeout, type PageLike } from './page.js';

export interface ScrollThroughOptions {
  /** Stop scrolling after this many ms even if the bottom was not reached. Default 5000. */
  timeout?: number;
  /** Scroll at most this many CSS px down (infinite feeds keep growing). Default 20000. */
  maxHeight?: number;
  /** Step size as a share of the viewport height. Default 0.85 (steps overlap a little). */
  stepRatio?: number;
  /** Extra wait at each step in ms, for pages that load on a scroll debounce. Default 0. */
  stepDelayMs?: number;
}

export interface ScrollThroughResult {
  /** Scroll steps taken (0: the page fits in the viewport or does not scroll). */
  steps: number;
  /** How far down the scroll reached, in CSS px from the top. */
  reachedPx: number;
  /** Page height at the end, in CSS px. */
  pageHeight: number;
  /** 'window', or 'element' when the page scrolls inside a full-height container instead of the window. */
  scroller: 'window' | 'element' | 'none';
  timedOut: boolean;
}

function scrollInPage(arg: { timeoutMs: number; maxHeight: number; stepRatio: number; stepDelayMs: number }) {
  const started = performance.now();
  const frame = (extra: number) =>
    new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          setTimeout(resolve, extra);
        }
      };
      // IntersectionObserver callbacks and lazy-image decisions run on rendering updates; the timer covers
      // pages whose animation frames are throttled.
      requestAnimationFrame(() => requestAnimationFrame(finish));
      setTimeout(finish, 150);
    });

  type Scroller = { kind: 'window' | 'element'; get: () => number; set: (y: number) => void; height: () => number; view: () => number };
  const root = document.scrollingElement || document.documentElement;
  const windowScroller: Scroller = {
    kind: 'window',
    get: () => window.scrollY,
    set: (y) => window.scrollTo({ left: window.scrollX, top: y, behavior: 'instant' as ScrollBehavior }),
    height: () => Math.max(root.scrollHeight, document.body ? document.body.scrollHeight : 0),
    view: () => window.innerHeight,
  };
  // Some app layouts keep the window fixed and scroll a full-height container. Pick the largest one.
  const findElementScroller = (): Scroller | undefined => {
    let best: Element | undefined;
    let bestArea = 0;
    const minArea = window.innerWidth * window.innerHeight * 0.4;
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (el.scrollHeight <= el.clientHeight + 50) continue;
      const style = getComputedStyle(el);
      if (!/(auto|scroll|overlay)/.test(style.overflowY)) continue;
      const area = el.clientWidth * el.clientHeight;
      if (area >= minArea && area > bestArea) {
        best = el;
        bestArea = area;
      }
    }
    if (!best) return undefined;
    const el = best;
    return {
      kind: 'element',
      get: () => el.scrollTop,
      set: (y) => el.scrollTo({ left: el.scrollLeft, top: y, behavior: 'instant' as ScrollBehavior }),
      height: () => el.scrollHeight,
      view: () => el.clientHeight,
    };
  };

  return (async () => {
    let scroller: Scroller | undefined = windowScroller;
    if (windowScroller.height() <= windowScroller.view() + 1) scroller = findElementScroller();
    if (!scroller) return { steps: 0, reachedPx: window.innerHeight, pageHeight: windowScroller.height(), scroller: 'none' as const, timedOut: false };

    const startY = scroller.get();
    let steps = 0;
    let reached = 0;
    let timedOut = false;
    for (;;) {
      const view = scroller.view();
      const step = Math.max(100, Math.floor(view * arg.stepRatio));
      // Re-measure every step: the page can grow as content loads (up to maxHeight).
      const limit = Math.min(scroller.height(), arg.maxHeight) - view;
      const target = Math.min(reached + step, limit);
      if (target <= reached) break;
      scroller.set(target);
      const now = scroller.get();
      if (now <= reached) {
        // The window did not move although the document is taller (overflow hidden on html/body, or an inner
        // scroller): try a scrolling container once.
        if (steps === 0 && scroller.kind === 'window') {
          const inner = findElementScroller();
          if (inner) {
            scroller = inner;
            continue;
          }
        }
        break;
      }
      reached = now;
      steps += 1;
      await frame(arg.stepDelayMs);
      if (performance.now() - started > arg.timeoutMs) {
        timedOut = true;
        break;
      }
    }
    const reachedPx = reached + scroller.view();
    scroller.set(startY);
    await frame(0);
    return { steps, reachedPx, pageHeight: scroller.height(), scroller: steps > 0 ? scroller.kind : ('none' as const), timedOut };
  })();
}

/**
 * Scrolls down through the page in viewport-sized steps, then back to where it was, so that
 * `loading="lazy"` images, IntersectionObserver loaders and scroll-reveal effects fire as they would for a
 * visitor. Does not wait for the loads it triggered; {@link loadLazyContent} does.
 */
export async function scrollThrough(page: PageLike, options: ScrollThroughOptions = {}): Promise<ScrollThroughResult> {
  const timeoutMs = Math.max(0, options.timeout ?? 5000);
  const arg = {
    timeoutMs,
    maxHeight: Math.max(0, options.maxHeight ?? 20_000),
    stepRatio: Math.min(1, Math.max(0.1, options.stepRatio ?? 0.85)),
    stepDelayMs: Math.max(0, options.stepDelayMs ?? 0),
  };
  const result = await withTimeout(inPage(page, scrollInPage, arg), timeoutMs + GRACE_MS * 2);
  if (!result.timedOut) return result.value;
  // A busy main thread kept the loop from finishing: put the page back at the top before the capture.
  await withTimeout(inPage(page, () => window.scrollTo({ left: 0, top: 0, behavior: 'instant' as ScrollBehavior }), null), 500).catch(() => undefined);
  return { steps: 0, reachedPx: 0, pageHeight: 0, scroller: 'none', timedOut: true };
}

export interface LoadLazyContentOptions extends ScrollThroughOptions {
  /** Time to wait for the loads after scrolling (network quiet, then images). Default 5000. */
  loadTimeout?: number;
}

export interface LoadLazyContentResult {
  scroll: ScrollThroughResult;
  network?: WaitForNetworkQuietResult;
  images: WaitForImagesResult;
  timedOut: boolean;
}

/**
 * {@link scrollThrough}, then waits (bounded by `loadTimeout`) for the network to go quiet and for images to
 * decode. Requests are counted from the start of the scroll, so the loads it triggers are seen.
 */
export async function loadLazyContent(page: PageLike, options: LoadLazyContentOptions = {}): Promise<LoadLazyContentResult> {
  const loadTimeout = Math.max(0, options.loadTimeout ?? 5000);
  const tracker = trackRequests(page);
  let scroll: ScrollThroughResult;
  let network: WaitForNetworkQuietResult | undefined;
  try {
    scroll = await scrollThrough(page, options);
    if (tracker) network = await tracker.waitForQuiet({ quietMs: 400, timeout: loadTimeout });
  } finally {
    tracker?.stop();
  }
  const left = Math.max(500, loadTimeout - (network?.ms ?? 0));
  const images = await waitForImages(page, { timeout: left, maxHeight: options.maxHeight ?? 20_000 });
  return { scroll, network, images, timedOut: scroll.timedOut || Boolean(network?.timedOut) || images.timedOut };
}
