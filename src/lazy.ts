import { waitForImages, type WaitForImagesResult } from './images.js';
import { trackRequests, type WaitForNetworkQuietResult } from './network.js';
import { scrollInPage, scrollTopInPage } from './inpage.js';
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
  await withTimeout(inPage(page, scrollTopInPage, null), 500).catch(() => undefined);
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
