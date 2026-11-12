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

function fontsInPage(arg: { timeoutMs: number }) {
  const fonts = document.fonts;
  const list = () => {
    const faces: FontFace[] = [];
    if (fonts) fonts.forEach((f) => faces.push(f));
    return faces;
  };
  const families = (status: FontFaceLoadStatus) =>
    Array.from(new Set(list().filter((f) => f.status === status).map((f) => f.family.replace(/^["']|["']$/g, ''))));
  const report = (timedOut: boolean) => ({
    timedOut,
    loaded: list().filter((f) => f.status === 'loaded').length,
    pending: families('loading'),
    failed: families('error'),
  });
  if (!fonts) return Promise.resolve(report(false));

  const deadline = performance.now() + arg.timeoutMs;
  const frame = () =>
    new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      requestAnimationFrame(() => requestAnimationFrame(finish));
      setTimeout(finish, 100);
    });
  // Fonts start loading when text that uses them is laid out, so make sure layout is current first.
  const layout = () => void (document.body && document.body.offsetHeight);

  return (async () => {
    layout();
    // document.fonts.ready is replaced each time a new batch starts loading, so re-read it every round.
    for (;;) {
      const left = deadline - performance.now();
      if (left <= 0) return report(true);
      const settled = await Promise.race([
        fonts.ready.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), left)),
      ]);
      if (!settled) return report(true);
      await frame();
      layout();
      if (fonts.status === 'loaded') return report(false);
    }
  })();
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
