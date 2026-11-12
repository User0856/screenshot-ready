import { hideConsentBanners, hideElements, type HideConsentOptions, type HideElementsOptions } from './consent.js';
import { waitForFonts, type WaitForFontsOptions } from './fonts.js';
import { freezeAnimations, type FreezeAnimationsOptions } from './freeze.js';
import { waitForImages, type WaitForImagesOptions } from './images.js';
import { scrollThrough, type ScrollThroughOptions } from './lazy.js';
import { trackRequests, waitForNetworkQuiet, type WaitForNetworkQuietOptions } from './network.js';
import { GRACE_MS, withTimeout, type PageLike } from './page.js';

export interface PrepareOptions {
  /** Total time budget in ms for all steps. Default 15000. Each step also has its own cap. */
  timeout?: number;
  /** Hide cookie and consent banners (twice: first and again before the capture). Default true. */
  consent?: boolean | Omit<HideConsentOptions, 'timeout'>;
  /** Extra selectors to hide, such as chat widgets or promo bars. */
  hide?: string[];
  /** How `hide` selectors are hidden. Default 'visibility'. */
  hideMode?: HideElementsOptions['mode'];
  /** Wait for web fonts. Default true (3000 ms cap). */
  fonts?: boolean | WaitForFontsOptions;
  /** Scroll through the page so lazy content loads. Default true (5000 ms cap, 20000 px). */
  lazy?: boolean | ScrollThroughOptions;
  /** Wait for the network to go quiet. Default true (3000 ms cap, 500 ms quiet). */
  network?: boolean | WaitForNetworkQuietOptions;
  /** Wait for images to load and decode. Default true (3000 ms cap). */
  images?: boolean | WaitForImagesOptions;
  /** Freeze animations, transitions, caret and media at the end. Default true. */
  freeze?: boolean | FreezeAnimationsOptions;
}

export type StepName = 'consent' | 'hide' | 'fonts' | 'lazy' | 'network' | 'images' | 'consent-again' | 'fonts-again' | 'freeze';

export interface StepReport {
  step: StepName;
  ms: number;
  /** False when the step threw (the error is in `error`) or was skipped because the budget ran out. */
  ok: boolean;
  timedOut: boolean;
  skipped?: boolean;
  error?: string;
  /** The step function's own result (see each helper's result type). */
  result?: unknown;
}

export interface PrepareResult {
  ms: number;
  /** True when any step hit its cap or the total budget ran out. */
  timedOut: boolean;
  steps: StepReport[];
}

// Time kept back from the main steps for the two quick final steps (second consent pass, freeze).
const RESERVE_MS = 1000;

const pick = <T extends object>(value: boolean | T | undefined): T | undefined => (value === false ? undefined : typeof value === 'object' ? value : ({} as T));

/**
 * Gets a loaded page ready for `page.screenshot()`, in this order: hide consent banners, hide your selectors,
 * wait for fonts, scroll through for lazy content, wait for the network to go quiet, wait for images to
 * decode, hide late consent banners, catch fonts used by late content, freeze animations.
 *
 * Every step is bounded and the whole run stays within `timeout` (plus about a second for the final steps).
 * It never throws: a step that fails is reported in the result and the rest still run.
 */
export async function prepareForCapture(page: PageLike, options: PrepareOptions = {}): Promise<PrepareResult> {
  const started = Date.now();
  const budget = Math.max(0, options.timeout ?? 15_000);
  const deadline = started + budget;
  const steps: StepReport[] = [];

  const run = async (step: StepName, cap: number, fn: (timeout: number) => Promise<unknown>, final = false) => {
    const left = (final ? deadline : deadline - RESERVE_MS) - Date.now();
    const timeout = Math.min(cap, final ? Math.max(left, 500) : left);
    const t0 = Date.now();
    if (timeout < 100) {
      steps.push({ step, ms: 0, ok: false, timedOut: true, skipped: true });
      return;
    }
    try {
      const out = await withTimeout(fn(timeout), timeout + GRACE_MS * 2);
      const result = out.timedOut ? undefined : out.value;
      const timedOut = out.timedOut || Boolean(result && typeof result === 'object' && (result as { timedOut?: boolean }).timedOut);
      steps.push({ step, ms: Date.now() - t0, ok: !out.timedOut, timedOut, result });
    } catch (error) {
      steps.push({ step, ms: Date.now() - t0, ok: false, timedOut: false, error: error instanceof Error ? error.message : String(error) });
    }
  };

  const consent = pick(options.consent);
  const fonts = pick(options.fonts);
  const lazy = pick(options.lazy);
  const network = pick(options.network);
  const images = pick(options.images);
  const freeze = pick(options.freeze);

  if (consent) await run('consent', 2000, (timeout) => hideConsentBanners(page, { ...consent, timeout }));
  if (options.hide && options.hide.length > 0) {
    const selectors = options.hide;
    await run('hide', 2000, () => hideElements(page, selectors, { mode: options.hideMode }));
  }
  if (fonts) await run('fonts', fonts.timeout ?? 3000, (timeout) => waitForFonts(page, { timeout }));

  // Count requests from the start of the scroll so the loads it triggers are seen by the network step.
  const tracker = network ? trackRequests(page) : undefined;
  try {
    if (lazy) await run('lazy', lazy.timeout ?? 5000, (timeout) => scrollThrough(page, { ...lazy, timeout }));
    if (network) {
      const quiet = { quietMs: 500, ...network };
      await run('network', network.timeout ?? 3000, (timeout) =>
        tracker ? tracker.waitForQuiet({ ...quiet, timeout }) : waitForNetworkQuiet(page, { ...quiet, timeout }),
      );
    }
  } finally {
    tracker?.stop();
  }
  if (images) {
    const maxHeight = images.maxHeight ?? (lazy ? lazy.maxHeight : undefined);
    await run('images', images.timeout ?? 3000, (timeout) => waitForImages(page, { maxHeight, timeout }));
  }
  if (consent) await run('consent-again', 1000, (timeout) => hideConsentBanners(page, { ...consent, timeout }), true);
  if (fonts) await run('fonts-again', 1000, (timeout) => waitForFonts(page, { timeout }));
  if (freeze) await run('freeze', 1000, () => freezeAnimations(page, freeze), true);

  return { ms: Date.now() - started, timedOut: steps.some((s) => s.timedOut), steps };
}

export interface ReadyScreenshotOptions {
  /** Options for {@link prepareForCapture}. */
  prepare?: PrepareOptions;
  // Everything else is passed to page.screenshot() as is (path, fullPage, type, clip, ...).
  [key: string]: unknown;
}

/** A page that can take a screenshot: a Playwright or Puppeteer Page. */
export interface ScreenshotPage extends PageLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  screenshot(options?: any): Promise<any>;
}

/**
 * `prepareForCapture(page, options.prepare)` followed by `page.screenshot(rest)`. Returns whatever the
 * library's screenshot returns (a Buffer in Playwright, a Uint8Array/Buffer in Puppeteer).
 */
export async function readyScreenshot<P extends ScreenshotPage>(page: P, options: ReadyScreenshotOptions = {}): Promise<Awaited<ReturnType<P['screenshot']>>> {
  const { prepare, ...screenshotOptions } = options;
  await prepareForCapture(page, prepare);
  return page.screenshot(screenshotOptions);
}
