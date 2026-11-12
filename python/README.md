# screenshot-ready (Python)

Get a Playwright page ready for `page.screenshot()`: wait for web fonts, load lazy images, hide cookie banners and freeze animations, in one call with a time budget. Works with Playwright's sync and async APIs.

```bash
pip install screenshot-ready
playwright install chromium
```

This is the Python port of the [screenshot-ready](https://www.npmjs.com/package/screenshot-ready) npm package. Both run the same browser-side code, so a page prepared from Python comes out the same as one prepared from Node.

## Why

`page.screenshot()` looks fine on example.com. On real sites the same call keeps producing captures with:

- **Blank boxes where images should be.** `loading="lazy"` images and IntersectionObserver loaders only fetch near the viewport, and a full-page capture never scrolls.
- **A cookie banner over the page**, often with a dark backdrop and the page scroll locked behind it.
- **Text in the wrong font, or no text at all**, because the load event fired before web fonts arrived.
- **Two captures of the same page that never match**, because of spinners, fade-ins and the blinking caret.
- **Loading skeletons**, because the page fires its API calls after load.

## Quick start

### Sync

```python
from playwright.sync_api import sync_playwright
from screenshot_ready import prepare_for_capture

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto("https://example.com", wait_until="load")

    prepare_for_capture(page)
    page.screenshot(path="page.png", full_page=True)

    browser.close()
```

### Async

```python
import asyncio
from playwright.async_api import async_playwright
from screenshot_ready.async_api import prepare_for_capture

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        await page.goto("https://example.com", wait_until="load")

        await prepare_for_capture(page)
        await page.screenshot(path="page.png", full_page=True)

        await browser.close()

asyncio.run(main())
```

`screenshot_ready` is the sync API and `screenshot_ready.async_api` has the same functions as coroutines, the same way Playwright splits `playwright.sync_api` and `playwright.async_api`.

### One call

```python
from screenshot_ready import ready_screenshot

png = ready_screenshot(page, full_page=True, path="page.png", prepare={"timeout": 10000})
```

Everything except `prepare` goes to `page.screenshot()` unchanged.

## What prepare_for_capture does

In this order, each step with its own cap, all inside a total budget (`timeout`, default 15000 ms):

1. **Hide consent banners** (`consent`). Known consent platforms by selector, plus fixed overlays that mention cookies or consent and offer a choice. Nothing is clicked.
2. **Hide your selectors** (`hide`). Chat widgets, promo bars, anything you list.
3. **Wait for web fonts** (`fonts`, 3 s cap).
4. **Scroll through the page** (`lazy`, 5 s cap, up to 20,000 px), including pages that scroll inside a full-height container, then scroll back.
5. **Wait for the network to go quiet** (`network`, 3 s cap, 500 ms of quiet). Requests started by the scroll are counted.
6. **Wait for images to load and decode** (`images`, 3 s cap).
7. **Hide consent banners again**, for dialogs that showed up late.
8. **Wait for fonts again** (1 s cap), for fonts used by content that just loaded.
9. **Freeze animations** (`freeze`). Finite animations and transitions jump to their end state, infinite ones pause, the caret is hidden, playing media pauses.

It does not raise for anything the page does. A step that fails or runs out of time is reported and the rest still run:

```python
report = prepare_for_capture(page)
print(report.ms, report.timed_out)
for step in report.steps:
    print(step.step, step.ms, step.ok, step.timed_out, step.error, step.result)
```

Time limits hold even when the page's main thread is stuck (a plain `page.evaluate()` would block until it frees up). Passing something that is not a Playwright page raises `TypeError`, and so does passing a sync page to the async API or the other way round.

Turn any step off or tune it:

```python
prepare_for_capture(
    page,
    timeout=10000,
    consent={"selectors": [".my-site-cookie-bar"]},
    hide=["#intercom-container", ".promo-ribbon"],
    lazy={"max_height": 8000},
    network={"quiet_ms": 800},
    freeze=False,
)
```

## API

Every function takes a Playwright `Page` (sync or async to match the module) as its first argument, with options as keyword arguments. Times are in milliseconds, sizes in CSS pixels. Helpers return a dict and report timeouts in it (`timed_out`) instead of raising. They do raise if the page itself is gone; `prepare_for_capture` catches that too.

### `prepare_for_capture(page, **options)`

| Option | Default | |
|---|---|---|
| `timeout` | `15000` | Total budget. The last two quick steps may add up to about a second. |
| `consent` | `True` | `False`, or a dict of `hide_consent_banners` options (without `timeout`). |
| `hide` | `None` | Selectors to hide. |
| `hide_mode` | `"visibility"` | `"visibility"` keeps the layout, `"display"` removes the element from it. |
| `fonts` | `True` | `False`, or `{"timeout": ms}`. |
| `lazy` | `True` | `False`, or a dict of `scroll_through` options. |
| `network` | `True` | `False`, or a dict of `wait_for_network_quiet` options. |
| `images` | `True` | `False`, or a dict of `wait_for_images` options. |
| `freeze` | `True` | `False`, or a dict of `freeze_animations` options. |

Returns a `PrepareResult` with `ms`, `timed_out` and `steps`. Each `StepReport` has `step`, `ms`, `ok`, `timed_out`, `skipped`, `error` and `result` (the helper's dict). An unknown option key shows up as that step's `error`.

### `ready_screenshot(page, prepare=None, **screenshot_options)`

`prepare_for_capture(page, **prepare)`, then `page.screenshot(**screenshot_options)`. Returns the image bytes.

### `hide_consent_banners(page, selectors=None, replace_built_in=False, heuristics=True, unlock_scroll=True, timeout=2000)`

Returns `hidden`, `by_selector`, `by_heuristic`, `overlays`, `scroll_unlocked`, `details` and `timed_out`. Built-in selectors cover OneTrust, Cookiebot, Didomi, Quantcast Choice, TrustArc, Usercentrics, Osano, Google Funding Choices, Sourcepoint, CookieYes, Complianz, iubenda, Termly, Borlabs, Ketch, CookieConsent and Klaro (`CONSENT_SELECTORS`). Elements are hidden with a stylesheet rule and a `data-screenshot-ready-hidden` attribute, not removed.

### `hide_elements(page, selectors, mode="visibility")`

Hides elements with a stylesheet rule. Returns how many matched.

### `wait_for_fonts(page, timeout=3000)`

Returns `timed_out`, `loaded`, `pending` and `failed` (family names).

### `scroll_through(page, timeout=5000, max_height=20000, step_ratio=0.85, step_delay_ms=0)`

Scrolls down in viewport-sized steps, then back to the original position. Scrolls a full-height container when the window does not scroll. Returns `steps`, `reached_px`, `page_height`, `scroller` and `timed_out`.

### `load_lazy_content(page, ..., load_timeout=5000)`

`scroll_through`, then waits for the network to go quiet and for images to decode. Returns `scroll`, `network`, `images` and `timed_out`.

### `wait_for_network_quiet(page, quiet_ms=500, timeout=5000, max_inflight=0, relax_after_ms=None)` and `track_requests(page)`

Waits until no request has been open for `quiet_ms`. After `relax_after_ms` (default half the timeout) up to two open requests still count as quiet, so long-polls and analytics beacons do not hold the capture forever. Pass `float("inf")` to keep the strict rule. Only requests that start after the call are seen; to count everything, track before you navigate:

```python
tracker = track_requests(page)
page.goto(url)
tracker.wait_for_quiet(quiet_ms=500, timeout=5000)  # await it in the async API
tracker.stop()
```

Given a `Frame`, it falls back to watching Resource Timing entries inside the page.

### `wait_for_images(page, timeout=5000, max_height=20000)`

Returns `total`, `ready`, `broken`, `pending` and `timed_out`. Lazy images the browser will not fetch at the current scroll position (carousel slides off to the side, collapsed panels) are skipped.

### `freeze_animations(page, caret=True, pause_media=True)`

Returns `finished`, `paused`, `media` and `timed_out`.

## Limits

- Consent banners inside cross-origin iframes are hidden through their container on the page, but the iframe itself cannot be inspected. Closed shadow roots cannot be inspected either.
- The heuristics are conservative on purpose and will miss some custom banners. Add a selector for those.
- Hiding is not consenting: content that waits for consent stays empty.
- JavaScript-driven motion (carousels on timers, canvas, WebGL) is not frozen.
- Tested with Chromium. Requires `playwright>=1.40`. The sync API runs its work on Playwright's own event loop through an internal method that every Playwright sync call uses; it is tested against the oldest supported and the latest Playwright release.

## Don't want to run browsers?

[SnapRender](https://snap-render.com) is a hosted screenshot API that handles cookie banners and lazy images for full-page captures (free plan: 200 captures a month).

```python
import os, requests

res = requests.get(
    "https://app.snap-render.com/v1/screenshot",
    params={"url": "https://example.com", "full_page": "true", "lazy_load": "true"},
    headers={"X-API-Key": os.environ["SNAPRENDER_API_KEY"]},
)
open("page.png", "wb").write(res.content)
```

## License

MIT
