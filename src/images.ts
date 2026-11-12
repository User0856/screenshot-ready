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

function imagesInPage(arg: { timeoutMs: number; maxHeight: number }) {
  const scrollY = window.scrollY;
  const inView = (img: HTMLImageElement, rect: DOMRect) => {
    if (rect.right <= 0 || rect.left >= window.innerWidth) return false;
    for (let el = img.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const box = el.getBoundingClientRect();
      if (rect.right <= box.left || rect.left >= box.right || rect.bottom <= box.top || rect.top >= box.bottom) return false;
    }
    return true;
  };
  const images = Array.from(document.images).filter((img) => {
    if (!img.currentSrc && !img.getAttribute('src') && !img.getAttribute('srcset')) return false;
    // No client rects: the image or an ancestor is display:none, so it is not in the capture.
    if (img.getClientRects().length === 0) return false;
    const rect = img.getBoundingClientRect();
    if (rect.top + scrollY > arg.maxHeight) return false;
    // A lazy image the browser has not fetched yet and never will at this scroll position: off to the side
    // (carousel slides) or clipped away by an ancestor (collapsed panels). It is not in the capture either,
    // so waiting for it would only burn the timeout.
    if (!img.complete && img.loading === 'lazy' && !inView(img, rect)) return false;
    return true;
  });
  let ready = 0;
  let broken = 0;
  const settle = (img: HTMLImageElement) =>
    new Promise<void>((resolve) => {
      const decoded = () => {
        // decode() makes sure the pixels are ready to paint, so the capture does not show a blank box.
        img
          .decode()
          .then(() => {
            ready += 1;
          })
          .catch(() => {
            if (img.naturalWidth > 0) ready += 1;
            else broken += 1;
          })
          .finally(resolve);
      };
      if (img.complete) {
        if (img.naturalWidth === 0 && (img.currentSrc || img.src)) {
          broken += 1;
          resolve();
        } else decoded();
        return;
      }
      img.addEventListener('load', decoded, { once: true });
      img.addEventListener(
        'error',
        () => {
          broken += 1;
          resolve();
        },
        { once: true },
      );
    });
  return new Promise<{ total: number; ready: number; broken: number; pending: number; timedOut: boolean }>((resolve) => {
    let finished = false;
    const done = (timedOut: boolean) => {
      if (finished) return;
      finished = true;
      resolve({ total: images.length, ready, broken, pending: images.length - ready - broken, timedOut });
    };
    setTimeout(() => done(true), arg.timeoutMs);
    Promise.all(images.map(settle)).then(() => done(false));
  });
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
