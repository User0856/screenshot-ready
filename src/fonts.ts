import { fontsInPage } from './inpage.js';
import { GRACE_MS, inPage, withTimeout, type PageLike } from './page.js';

export interface WaitForFontsOptions {
  /** Give up after this many ms. Default 3000. */
  timeout?: number;
}

export interface WaitForFontsResult {
  /** True when fonts were still loading when the timeout hit. */
  timedOut: boolean;
  /** Font faces that finished loading. */
  loaded: number;
  /** Families still loading at the end. */
  pending: string[];
  /** Families that failed to load (the browser falls back to another font for these). */
  failed: string[];
}

/**
 * Waits until the page's web fonts have loaded (or failed), so text is not captured in a fallback font or
 * invisible while a font with `font-display: block` downloads.
 */
export async function waitForFonts(page: PageLike, options: WaitForFontsOptions = {}): Promise<WaitForFontsResult> {
  const timeoutMs = Math.max(0, options.timeout ?? 3000);
  const result = await withTimeout(inPage(page, fontsInPage, { timeoutMs }), timeoutMs + GRACE_MS);
  return result.timedOut ? { timedOut: true, loaded: 0, pending: [], failed: [] } : result.value;
}
