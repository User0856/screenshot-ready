import { imagesInPage } from './inpage.js';
import { GRACE_MS, inPage, withTimeout, type PageLike } from './page.js';

export interface WaitForImagesOptions {
  /** Give up after this many ms. Default 5000. */
  timeout?: number;
  /** Ignore images that start below this many CSS px from the top of the page. Default 20000. */
  maxHeight?: number;
}

export interface WaitForImagesResult {
  /** Images considered (rendered, with a source, within maxHeight). */
  total: number;
  /** Images loaded and decoded. */
  ready: number;
  /** Images that failed to load. */
  broken: number;
  /** Images still loading when the timeout hit. */
  pending: number;
  timedOut: boolean;
}

/**
 * Waits until every rendered `<img>` near the top of the page (within `maxHeight`) has loaded and decoded.
 * Broken images count as settled. Lazy images that have not started loading are only picked up after a
 * scroll-through ({@link scrollThrough} or {@link loadLazyContent}).
 */
export async function waitForImages(page: PageLike, options: WaitForImagesOptions = {}): Promise<WaitForImagesResult> {
  const timeoutMs = Math.max(0, options.timeout ?? 5000);
  const maxHeight = Math.max(0, options.maxHeight ?? 20_000);
  const result = await withTimeout(inPage(page, imagesInPage, { timeoutMs, maxHeight }), timeoutMs + GRACE_MS);
  return result.timedOut ? { total: 0, ready: 0, broken: 0, pending: 0, timedOut: true } : result.value;
}
