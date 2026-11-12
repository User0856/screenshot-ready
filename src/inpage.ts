/**
 * Everything this library runs inside the page, in one file.
 *
 * Each function is sent to the browser as source text (see `inPage` in page.ts), so it must be self-contained:
 * no imports, no references to anything outside its own body. The Python package runs the same compiled
 * functions: `npm run build` writes them to python/src/screenshot_ready/inpage.js, and CI fails when that copy
 * is out of date.
 */

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

/** Attribute set on every element hidden by `hideConsentBanners`. */
export const HIDDEN_ATTRIBUTE = 'data-screenshot-ready-hidden';

export function consentInPage(arg: { selectors: string[]; heuristics: boolean; unlockScroll: boolean; attr: string }) {
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

export function hideInPage(arg: { selectors: string[]; mode: 'visibility' | 'display' }) {
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

export function fontsInPage(arg: { timeoutMs: number }) {
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

export function scrollInPage(arg: { timeoutMs: number; maxHeight: number; stepRatio: number; stepDelayMs: number }) {
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

export function resourcesQuietInPage(arg: { quietMs: number; timeoutMs: number }) {
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

export function imagesInPage(arg: { timeoutMs: number; maxHeight: number }) {
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

export function freezeInPage(arg: { caret: boolean; pauseMedia: boolean }) {
  const styleId = 'screenshot-ready-freeze-style';
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement('style');
    style.id = styleId;
    (document.head || document.documentElement).appendChild(style);
  }
  // New CSS animations and transitions resolve to their end state at once. A zero duration keeps fill-mode
  // end states (a fade-in that ends at opacity 1 stays visible), which `animation: none` would undo.
  style.textContent = [
    '*, *::before, *::after {',
    '  animation-delay: 0s !important; animation-duration: 0s !important;',
    '  transition-delay: 0s !important; transition-duration: 0s !important;',
    '  scroll-behavior: auto !important;',
    arg.caret ? '  caret-color: transparent !important;' : '',
    '}',
  ].join('\n');

  let finished = 0;
  let paused = 0;
  // getAnimations() flushes styles, so CSS animations already reflect the rule above. This also reaches Web
  // Animations API animations (element.animate) and animations inside shadow roots, which the rule does not.
  const animations = typeof document.getAnimations === 'function' ? document.getAnimations() : [];
  for (const a of animations) {
    try {
      const timing = a.effect ? a.effect.getComputedTiming() : undefined;
      if (timing && Number.isFinite(timing.endTime as number)) {
        if (a.playState !== 'finished') {
          a.finish();
          finished += 1;
        }
      } else {
        a.pause();
        a.currentTime = 0;
        paused += 1;
      }
    } catch {
      // An animation that cannot be finished (zero playback rate, detached effect): leave it.
    }
  }

  let media = 0;
  if (arg.pauseMedia) {
    for (const m of Array.from(document.querySelectorAll('video, audio')) as HTMLMediaElement[]) {
      if (!m.paused) {
        m.pause();
        media += 1;
      }
    }
  }
  return { finished, paused, media, timedOut: false };
}

/** Puts the window back at the top (used when a scroll-through could not finish). */
export function scrollTopInPage() {
  window.scrollTo({ left: 0, top: 0, behavior: 'instant' as ScrollBehavior });
}
