# screenshot-ready

Get a Playwright or Puppeteer page ready for `page.screenshot()`: wait for web fonts, load lazy images, hide cookie banners and freeze animations, in one call with a time budget.

```bash
npm install screenshot-ready
```

## Why

`page.screenshot()` looks fine on example.com. On real sites the same call keeps producing captures like these:

- **Blank boxes where images should be.** `<img loading="lazy">` and IntersectionObserver loaders only fetch images near the viewport. A full-page capture never scrolls, so everything below the first screen comes out empty.
- **A cookie banner over the page.** Half the sites you capture show a consent dialog, often with a dark backdrop and the page scroll locked behind it.
- **Text in the wrong font, or no text at all.** The load event can fire before web fonts arrive. With `font-display: block` the text is invisible until they do.
- **Two captures of the same page never match.** Spinners, fade-ins, carousels and the blinking caret make every capture a little different, which breaks visual diffs.
- **A capture taken while data is still arriving.** The page fires its API calls after load and the capture shows loading skeletons.

`screenshot-ready` fixes these with small, bounded steps that run inside the page. It works with Playwright and Puppeteer pages and has no runtime dependencies.

## Quick start

### Playwright

```js
import { chromium } from 'playwright';
import { prepareForCapture } from 'screenshot-ready';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('https://example.com', { waitUntil: 'load' });

await prepareForCapture(page);
await page.screenshot({ path: 'page.png', fullPage: true });

await browser.close();
```

### Puppeteer

```js
import puppeteer from 'puppeteer';
import { prepareForCapture } from 'screenshot-ready';

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto('https://example.com', { waitUntil: 'load' });

await prepareForCapture(page);
await page.screenshot({ path: 'page.png', fullPage: true });

await browser.close();
```

CommonJS works too: `const { prepareForCapture } = require('screenshot-ready')`.

### One call

```js
import { readyScreenshot } from 'screenshot-ready';

const png = await readyScreenshot(page, { fullPage: true, path: 'page.png', prepare: { timeout: 10000 } });
```

Everything except `prepare` goes to `page.screenshot()` unchanged.

## What prepareForCapture does

In this order, each step with its own cap, all inside a total budget (`timeout`, default 15 seconds):

1. **Hide consent banners** (`consent`). Known consent platforms by selector, plus fixed overlays that mention cookies or consent and offer a choice. Nothing is clicked.
2. **Hide your selectors** (`hide`). Chat widgets, promo bars, anything you list.
3. **Wait for web fonts** (`fonts`, 3 s cap).
4. **Scroll through the page** (`lazy`, 5 s cap, up to 20,000 px) so lazy images, IntersectionObserver loaders and scroll-reveal effects fire, then scroll back.
5. **Wait for the network to go quiet** (`network`, 3 s cap, 500 ms of quiet). Requests started by the scroll are counted.
6. **Wait for images to load and decode** (`images`, 3 s cap).
7. **Hide consent banners again**, for dialogs that showed up late.
8. **Wait for fonts again** (1 s cap), for fonts used by content that just loaded.
9. **Freeze animations** (`freeze`). Finite animations and transitions jump to their end state, infinite ones pause, the caret is hidden, playing media pauses.

It never throws. A step that fails or runs out of time is reported and the rest still run:

```js
const report = await prepareForCapture(page);
// { ms: 1840, timedOut: false, steps: [{ step: 'consent', ms: 12, ok: true, timedOut: false, result: { hidden: 2, ... } }, ...] }
```

Turn any step off or tune it:

```js
await prepareForCapture(page, {
  timeout: 10000,
  consent: { selectors: ['.my-site-cookie-bar'] },
  hide: ['#intercom-container', '.promo-ribbon'],
  lazy: { maxHeight: 8000 },
  network: { quietMs: 800 },
  freeze: false,
});
```

## API

Every helper takes a Playwright or Puppeteer `Page` as its first argument. Times are in milliseconds, sizes in CSS pixels. The helpers return a result object and report timeouts in it instead of throwing. They do throw if the page itself is gone (closed or crashed); `prepareForCapture` catches that too.

### `prepareForCapture(page, options?)`

Runs the steps above. Options:

| Option | Default | |
|---|---|---|
| `timeout` | `15000` | Total budget. The last two quick steps may add up to about a second. |
| `consent` | `true` | `false`, or options for `hideConsentBanners` (without `timeout`). |
| `hide` | `[]` | Selectors to hide. |
| `hideMode` | `'visibility'` | `'visibility'` keeps the layout, `'display'` removes the element from it. |
| `fonts` | `true` | `false`, or `{ timeout }`. |
| `lazy` | `true` | `false`, or options for `scrollThrough`. |
| `network` | `true` | `false`, or options for `waitForNetworkQuiet`. |
| `images` | `true` | `false`, or options for `waitForImages`. |
| `freeze` | `true` | `false`, or options for `freezeAnimations`. |

Returns `{ ms, timedOut, steps }`, where each step is `{ step, ms, ok, timedOut, skipped?, error?, result? }`.

### `readyScreenshot(page, options?)`

`prepareForCapture(page, options.prepare)`, then `page.screenshot(rest)`. Returns what `page.screenshot()` returns.

### `hideConsentBanners(page, options?)`

| Option | Default | |
|---|---|---|
| `selectors` | `[]` | More selectors to hide. |
| `replaceBuiltIn` | `false` | Use only your selectors. |
| `heuristics` | `true` | Also match fixed overlays by text and buttons. |
| `unlockScroll` | `true` | Reset `overflow: hidden` (and a pinned `position: fixed` body) left by the dialog. |
| `timeout` | `2000` | |

Returns `{ hidden, bySelector, byHeuristic, overlays, scrollUnlocked, details, timedOut }`. `details` lists what was hidden, like `div#onetrust-consent-sdk`.

Built-in selectors cover OneTrust, Cookiebot, Didomi, Quantcast Choice, TrustArc, Usercentrics, Osano, Google Funding Choices, Sourcepoint, CookieYes, Complianz, iubenda, Termly, Borlabs, Ketch, CookieConsent and Klaro. The list is exported as `CONSENT_SELECTORS`.

The heuristic pass looks for elements that are `position: fixed` (or sticky, or a dialog), visible, mention cookies or consent (English plus common European languages) and contain an accept, reject or settings button. It skips elements that look like page content (a full-screen element with `main`, `nav`, `h1`, video or several images) and menus with many links. When it hides a banner it also hides an empty full-screen dimming layer behind it.

Elements are hidden with a stylesheet rule and a `data-screenshot-ready-hidden` attribute, not removed, so page scripts that hold references to them keep working. The selector rules stay in the page, so a banner the platform injects later is hidden as well.

### `hideElements(page, selectors, options?)`

Hides elements with a stylesheet rule. `options.mode`: `'visibility'` (default) or `'display'`. Returns how many elements matched.

### `waitForFonts(page, options?)`

Waits for `document.fonts` to finish loading, including fonts that start loading during the wait. `timeout` default 3000. Returns `{ timedOut, loaded, pending, failed }` with family names.

### `scrollThrough(page, options?)`

Scrolls down in viewport-sized steps, then back to the original position. If the window does not scroll but a full-height container does (common in app layouts), it scrolls that container.

| Option | Default | |
|---|---|---|
| `timeout` | `5000` | Stop scrolling after this long. |
| `maxHeight` | `20000` | Stop this far down (infinite feeds keep growing). |
| `stepRatio` | `0.85` | Step size as a share of the viewport height. |
| `stepDelayMs` | `0` | Extra wait per step, for pages that load on a scroll debounce. |

Returns `{ steps, reachedPx, pageHeight, scroller, timedOut }`.

### `loadLazyContent(page, options?)`

`scrollThrough`, then waits for the network to go quiet and for images to decode. Takes the `scrollThrough` options plus `loadTimeout` (default 5000).

### `waitForNetworkQuiet(page, options?)` and `trackRequests(page)`

Waits until no request has been open for `quietMs` (default 500), up to `timeout` (default 5000). After `relaxAfterMs` (default half the timeout) up to two open requests still count as quiet, so long-polls and analytics beacons do not hold the capture forever. `maxInflight` sets the strict allowance (default 0).

It listens to the page's request events, so it only sees requests that start after the call. To count everything, start tracking before you navigate:

```js
const tracker = trackRequests(page);
await page.goto(url);
await tracker.waitForQuiet({ quietMs: 500, timeout: 5000 });
tracker.stop();
```

Given an object without events (a Frame), it falls back to watching Resource Timing entries inside the page.

### `waitForImages(page, options?)`

Waits for rendered `<img>` elements within `maxHeight` (default 20000) to load and decode, up to `timeout` (default 5000). Broken images count as settled. Lazy images the browser will not fetch at the current scroll position (off to the side in a carousel, or clipped inside a collapsed panel) are skipped, since they are not in the capture. Returns `{ total, ready, broken, pending, timedOut }`.

### `freezeAnimations(page, options?)`

| Option | Default | |
|---|---|---|
| `caret` | `true` | Hide the text caret. |
| `pauseMedia` | `true` | Pause playing video and audio. |

Returns `{ finished, paused, media, timedOut }`. Playwright users can also pass `animations: 'disabled'` and `caret: 'hide'` to `page.screenshot()`; this helper does the same for Puppeteer and also covers transitions that start after the call.

## Limits

Be aware of what this does not do:

- **Consent banners inside cross-origin iframes** are hidden through their container on the page (Sourcepoint, for example), but the library cannot look inside the iframe. A platform outside the built-in list that renders only in an iframe needs your own selector.
- **Closed shadow roots** cannot be inspected. Open shadow roots are searched.
- **The heuristics are conservative on purpose.** They will miss some custom banners. Add a selector for those rather than loosening the rules.
- **Hiding is not consenting.** The site behaves as if the visitor has not chosen yet, so content that waits for consent (some embeds, some ads) stays empty.
- **JavaScript-driven motion** (a carousel on `setInterval`, canvas or WebGL animations) is not frozen. Hide it or wait for a known state.
- **Lazy content past `maxHeight`** is left alone, so infinite feeds stay finite. Raise `maxHeight` if your pages are taller.
- **Network quiet** only sees requests that start after the call, unless you use `trackRequests` before navigating.
- **Bot checks and logins** are out of scope. If the site serves a challenge page, that is what gets captured.
- Tested with Chromium in Playwright and Puppeteer. The code uses standard DOM APIs, but Firefox and WebKit are not part of the test suite yet.

## Don't want to run browsers?

Running headless browsers in production means keeping Chromium and its system libraries installed, sizing memory for it and handling crashes and timeouts. [SnapRender](https://snap-render.com) does this as a hosted API, including cookie banner removal and lazy-image loading for full-page captures (free plan: 200 captures a month).

```js
const url = 'https://app.snap-render.com/v1/screenshot?url=https://example.com&full_page=true&lazy_load=true';
const res = await fetch(url, { headers: { 'X-API-Key': process.env.SNAPRENDER_API_KEY } });
await fs.promises.writeFile('page.png', Buffer.from(await res.arrayBuffer()));
```

Related: [pagequiet](https://github.com/User0856/pagequiet) watches pages for visible changes and alerts only when the text a reader sees changes.

## Development

```bash
npm install
npx playwright install chromium
npx puppeteer browsers install chrome
npm run build
npm test
```

The tests drive headless Chromium through both Playwright and Puppeteer against local fixture pages (lazy images, consent banners, slow web fonts, animations) served on 127.0.0.1.

## License

MIT
