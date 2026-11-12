import { GRACE_MS, inPage, withTimeout, type PageLike } from './page.js';

/**
 * Containers of common consent management platforms (CMPs). Hidden with a stylesheet rule, so a banner the
 * CMP injects after the call is hidden too. Kept to IDs and class names the vendors use for the banner itself.
 */
export const CONSENT_SELECTORS: readonly string[] = [
  // OneTrust
  '#onetrust-consent-sdk',
  '#onetrust-banner-sdk',
  '.onetrust-pc-dark-filter',
  // Cookiebot
  '#CybotCookiebotDialog',
  '#CybotCookiebotDialogBodyUnderlay',
  // Didomi
  '#didomi-host',
  '#didomi-popup',
  '#didomi-notice',
  '.didomi-popup-backdrop',
  // Quantcast Choice
  '#qc-cmp2-container',
  '.qc-cmp2-container',
  '#qcCmpUi',
  // TrustArc
  '#truste-consent-track',
  '#consent_blackbar',
  '#trustarc-banner-overlay',
  '.truste_overlay',
  '.truste_box_overlay',
  // Usercentrics
  '#usercentrics-root',
  '#usercentrics-cmp-ui',
  // Osano
  '.osano-cm-window',
  '.osano-cm-dialog',
  // Google Funding Choices
  '.fc-consent-root',
  // Sourcepoint
  '[id^="sp_message_container"]',
  // CookieYes
  '.cky-consent-container',
  '.cky-overlay',
  // Complianz
  '#cmplz-cookiebanner-container',
  // iubenda
  '#iubenda-cs-banner',
  // Termly
  '#termly-code-snippet-support',
  // Borlabs Cookie
  '#BorlabsCookieBox',
  // Ketch
  '#lanyard_root',
  // CookieConsent (orestbida) v3
  '#cc-main',
  // Cookie Consent by Osano (open-source script)
  '.cc-window.cc-banner',
  '.cc-window.cc-floating',
  // Klaro
  '.klaro .cookie-notice',
  '.klaro .cookie-modal',
];

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

export const HIDDEN_ATTRIBUTE = 'data-screenshot-ready-hidden';

function consentInPage(arg: { selectors: string[]; heuristics: boolean; unlockScroll: boolean; attr: string }) {
  const ATTR = arg.attr;
  const details: string[] = [];
  const describe = (el: Element) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = !id && typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };
  const roots: (Document | ShadowRoot)[] = [document];
  const collectShadowRoots = (root: Document | ShadowRoot) => {
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (el.shadowRoot) {
        roots.push(el.shadowRoot);
        collectShadowRoots(el.shadowRoot);
      }
    }
  };
  collectShadowRoots(document);
  const allIn = (root: Document | ShadowRoot): Element[] =>
    root === document ? (document.body ? Array.from(document.body.querySelectorAll('*')) : []) : Array.from(root.querySelectorAll('*'));

  // A stylesheet in the document plus the attribute: wins over the CMP's own inline styles and keeps applying
  // when the CMP re-renders. Inside shadow roots the document stylesheet does not apply, so those get an
  // inline !important style as well.
  const hide = (el: Element, kind: string) => {
    if (el.hasAttribute(ATTR)) return false;
    el.setAttribute(ATTR, kind);
    if (el.getRootNode() !== document && el instanceof HTMLElement) el.style.setProperty('display', 'none', 'important');
    if (details.length < 50) details.push(describe(el));
    return true;
  };

  const styleId = 'screenshot-ready-consent-style';
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement('style');
    style.id = styleId;
    (document.head || document.documentElement).appendChild(style);
  }
  const valid = arg.selectors.filter((sel) => {
    try {
      document.querySelector(sel);
      return true;
    } catch {
      return false;
    }
  });
  // One rule per selector, so one bad selector cannot void the rest.
  style.textContent = [...valid.map((sel) => `${sel}{display:none!important}`), `[${ATTR}]{display:none!important}`].join('\n');

  let bySelector = 0;
  for (const root of roots) {
    for (const sel of valid) {
      for (const el of Array.from(root.querySelectorAll(sel))) {
        if (hide(el, 'cmp')) bySelector += 1;
      }
    }
  }

  let byHeuristic = 0;
  let overlays = 0;
  if (arg.heuristics) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const consentText =
      /\b(cookies?|cookie-?richtlinie|consent|gdpr|dsgvo|ccpa|datenschutz\w*|einwilligung|consentement|consentimiento|consenso|toestemming|privacy (settings|preferences|choices|center)|your privacy|tracking technolog\w+)\b/i;
    const actionText =
      /\b(accept|agree|allow|got it|i understand|understood|ok(ay)?|reject|decline|deny|refuse|manage|customi[sz]e|preferences|settings|necessary|essential|continue|akzeptieren|zustimmen|ablehnen|einverstanden|accepter|refuser|aceptar|rechazar|accetta|accetto|rifiuta|accepteren|weigeren|aceitar|rejeitar)\b/i;
    const controls = 'button, a, [role="button"], input[type="button"], input[type="submit"]';
    const visible = (el: Element, cs: CSSStyleDeclaration) => {
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const hasAction = (el: Element) =>
      Array.from(el.querySelectorAll(controls)).some((c) => {
        const t = ((c as HTMLElement).innerText || (c as HTMLInputElement).value || c.getAttribute('aria-label') || '').trim();
        return t.length > 0 && t.length <= 40 && actionText.test(t);
      });
    // Things a consent banner does not contain. Guards against hiding a fixed full-screen app shell.
    const looksLikePage = (el: Element) => el.querySelector('main, article, nav, h1, video, canvas') !== null || el.querySelectorAll('img').length > 3;
    // Many visible links: a menu or footer that happens to mention cookies, unless the text reads like a
    // consent notice (some consent walls list partners and policies as links).
    const consentSentence =
      /\b(we|this (site|website)|our partners)\b[^.]{0,60}\buses?\b[^.]{0,40}\bcookies\b|\bcookies? (to|for|and similar)\b|\b(your|votre|ihre|su|tua|uw) (consent|consentement|einwilligung|consentimiento|consenso|toestemming)\b|\buse of cookies\b/i;
    const navLike = (el: Element, text: string) =>
      Array.from(el.querySelectorAll('a[href]')).filter((a) => a.getClientRects().length > 0).length >= 10 && !consentSentence.test(text);

    const banners: Element[] = [];
    for (const root of roots) {
      for (const el of allIn(root)) {
        if (el.closest(`[${ATTR}]`)) continue;
        const cs = getComputedStyle(el);
        const isDialog = el.matches('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]');
        if (cs.position !== 'fixed' && cs.position !== 'sticky' && !isDialog) continue;
        if (!visible(el, cs)) continue;
        const text = ((el as HTMLElement).innerText || el.textContent || '').trim();
        if (text.length === 0 || text.length > 3000) continue;
        if (!consentText.test(text) || !hasAction(el)) continue;
        if (navLike(el, text)) continue;
        const r = el.getBoundingClientRect();
        const large = r.width * r.height >= vw * vh * 0.5;
        if (large && looksLikePage(el)) continue;
        // A sticky element is part of the page flow (headers, footers): only hide it when the text is clearly a
        // consent notice, not a "Cookie settings" link among others.
        if (cs.position === 'sticky' && !consentSentence.test(text)) continue;
        if (hide(el, 'heuristic')) {
          byHeuristic += 1;
          banners.push(el);
        }
      }
    }

    // Empty dimming layers that sit behind a consent dialog.
    if (banners.length > 0 || bySelector > 0) {
      for (const root of roots) {
        for (const el of allIn(root)) {
          if (el.closest(`[${ATTR}]`)) continue;
          const cs = getComputedStyle(el);
          if (cs.position !== 'fixed' || !visible(el, cs)) continue;
          if (((el as HTMLElement).innerText || '').trim().length > 0) continue;
          if (el.querySelector('img, svg, video, canvas, iframe, picture')) continue;
          const z = parseInt(cs.zIndex, 10);
          if (!(z >= 10)) continue;
          const r = el.getBoundingClientRect();
          if (r.width < vw * 0.9 || r.height < vh * 0.9) continue;
          const tinted = !/rgba?\(\s*0,\s*0,\s*0,\s*0\s*\)|transparent/.test(cs.backgroundColor) || (cs.backdropFilter && cs.backdropFilter !== 'none');
          if (!tinted) continue;
          if (hide(el, 'overlay')) overlays += 1;
        }
      }
    }
  }

  let scrollUnlocked = false;
  if (arg.unlockScroll && bySelector + byHeuristic + overlays > 0) {
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.overflowY === 'hidden' || cs.overflow === 'hidden') {
        el.style.setProperty('overflow', 'visible', 'important');
        scrollUnlocked = true;
      }
      // Scroll locks that pin the body in place: position fixed with a negative top.
      if (el === document.body && cs.position === 'fixed') {
        el.style.setProperty('position', 'static', 'important');
        el.style.setProperty('top', 'auto', 'important');
        scrollUnlocked = true;
      }
    }
  }

  return { hidden: bySelector + byHeuristic + overlays, bySelector, byHeuristic, overlays, scrollUnlocked, details, timedOut: false };
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

function hideInPage(arg: { selectors: string[]; mode: 'visibility' | 'display' }) {
  const styleId = 'screenshot-ready-hide-style';
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement('style');
    style.id = styleId;
    (document.head || document.documentElement).appendChild(style);
  }
  const rule = arg.mode === 'display' ? 'display:none!important' : 'visibility:hidden!important';
  let matched = 0;
  const rules: string[] = [];
  for (const sel of arg.selectors) {
    try {
      matched += document.querySelectorAll(sel).length;
      rules.push(`${sel}{${rule}}`);
    } catch {
      // invalid selector: skip it
    }
  }
  style.textContent = (style.textContent ? style.textContent + '\n' : '') + rules.join('\n');
  return matched;
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
