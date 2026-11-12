import { CONSENT_SELECTORS, HIDDEN_ATTRIBUTE, consentInPage, hideInPage } from './inpage.js';
import { GRACE_MS, inPage, withTimeout, type PageLike } from './page.js';

export { CONSENT_SELECTORS, HIDDEN_ATTRIBUTE };

export interface HideConsentOptions {
  /** More selectors to hide, on top of the built-in list. */
  selectors?: string[];
  /** Use only `selectors` (yours) instead of adding them to the built-in list. Default false. */
  replaceBuiltIn?: boolean;
  /** Also find consent banners by position and text (fixed overlays that mention cookies and offer a choice). Default true. */
  heuristics?: boolean;
  /** Undo the scroll lock (overflow hidden on html/body) a consent dialog leaves behind. Default true. */
  unlockScroll?: boolean;
  /** Give up after this many ms. Default 2000. */
  timeout?: number;
}

export interface HideConsentResult {
  /** Elements hidden in total. */
  hidden: number;
  /** Elements matched by the selector list. */
  bySelector: number;
  /** Elements matched by the position and text heuristics. */
  byHeuristic: number;
  /** Empty full-screen backdrops hidden along with a banner. */
  overlays: number;
  /** True when overflow or position on html/body was reset. */
  scrollUnlocked: boolean;
  /** Short descriptions of what was hidden, like `div#onetrust-consent-sdk`. */
  details: string[];
  timedOut: boolean;
}

/**
 * Hides cookie and consent banners without clicking anything: known consent platforms by selector, plus
 * fixed overlays that talk about cookies or consent and offer a choice. It never clicks "accept", so no
 * consent is given and the page does not reload. Elements are hidden with CSS, not removed, so page scripts
 * that reference them keep working.
 */
export async function hideConsentBanners(page: PageLike, options: HideConsentOptions = {}): Promise<HideConsentResult> {
  const timeoutMs = Math.max(0, options.timeout ?? 2000);
  const selectors = [...(options.replaceBuiltIn ? [] : CONSENT_SELECTORS), ...(options.selectors ?? [])];
  const arg = { selectors, heuristics: options.heuristics ?? true, unlockScroll: options.unlockScroll ?? true, attr: HIDDEN_ATTRIBUTE };
  const result = await withTimeout(inPage(page, consentInPage, arg), timeoutMs + GRACE_MS);
  if (result.timedOut) return { hidden: 0, bySelector: 0, byHeuristic: 0, overlays: 0, scrollUnlocked: false, details: [], timedOut: true };
  return result.value;
}

export interface HideElementsOptions {
  /** 'visibility' keeps the layout (default), 'display' removes the element from the layout. */
  mode?: 'visibility' | 'display';
}

/**
 * Hides elements you name (chat widgets, promo bars, ads) with a stylesheet rule, so they stay hidden if they
 * are re-rendered. Returns how many elements matched at the time of the call.
 */
export async function hideElements(page: PageLike, selectors: string[], options: HideElementsOptions = {}): Promise<number> {
  if (selectors.length === 0) return 0;
  const result = await withTimeout(inPage(page, hideInPage, { selectors, mode: options.mode ?? 'visibility' }), 2000 + GRACE_MS);
  return result.timedOut ? 0 : result.value;
}
