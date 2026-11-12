import { describe, expect, it } from 'vitest';
import { loadLazyContent, scrollThrough, waitForImages } from '../src/index.js';
import { drivers } from './helpers/drivers.js';
import { js, useBrowser } from './helpers/setup.js';

const imageState = `Array.from(document.querySelectorAll('img.native, img.observed')).map((i) => ({ complete: i.complete && i.naturalWidth > 0, src: i.getAttribute('src') }))`;

describe.each(drivers)('lazy content ($name)', (driver) => {
  const ctx = useBrowser(driver);

  it('a plain load leaves images below the fold unloaded (the problem)', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/lazy.html'), { waitUntil: 'load' });
    const images = await js<{ complete: boolean; src: string | null }[]>(page, imageState);
    expect(images.filter((i) => !i.complete).length).toBeGreaterThanOrEqual(4);
    await page.close();
  });

  it('loadLazyContent loads loading=lazy and IntersectionObserver images, then scrolls back', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/lazy.html'), { waitUntil: 'load' });
    const result = await loadLazyContent(page);
    expect(result.scroll.steps).toBeGreaterThan(5);
    expect(result.scroll.scroller).toBe('window');
    expect(result.timedOut).toBe(false);
    const images = await js<{ complete: boolean }[]>(page, imageState);
    expect(images).toHaveLength(6);
    expect(images.every((i) => i.complete)).toBe(true);
    expect(await js(page, 'window.scrollY')).toBe(0);
    expect(await js(page, `document.getElementById('reveal').classList.contains('shown')`)).toBe(true);
    expect(result.images.broken).toBe(0);
    expect(result.images.pending).toBe(0);
    await page.close();
  });

  it('restores a scroll position that was not the top', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/lazy.html'), { waitUntil: 'load' });
    await js(page, `window.scrollTo(0, 1000)`);
    await scrollThrough(page);
    expect(await js(page, 'window.scrollY')).toBe(1000);
    await page.close();
  });

  it('scrolls a full-height inner container when the window does not scroll', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/inner-scroll.html'), { waitUntil: 'load' });
    const result = await loadLazyContent(page);
    expect(result.scroll.scroller).toBe('element');
    expect(result.scroll.steps).toBeGreaterThan(2);
    const images = await js<{ complete: boolean }[]>(page, imageState);
    expect(images.every((i) => i.complete)).toBe(true);
    expect(await js(page, `document.getElementById('app').scrollTop`)).toBe(0);
    await page.close();
  });

  it('stops at maxHeight on an infinite feed', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/infinite.html'), { waitUntil: 'load' });
    const result = await scrollThrough(page, { maxHeight: 6000 });
    expect(result.reachedPx).toBeLessThanOrEqual(6000);
    expect(result.reachedPx).toBeGreaterThan(4000);
    expect(result.timedOut).toBe(false);
    await page.close();
  });

  it('stops scrolling when its time budget runs out', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/infinite.html'), { waitUntil: 'load' });
    const started = Date.now();
    const result = await scrollThrough(page, { maxHeight: 1_000_000, timeout: 600, stepDelayMs: 100 });
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(await js(page, 'window.scrollY')).toBe(0);
    await page.close();
  });

  it('does nothing on a page that fits in the viewport', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/network.html?delay=1'), { waitUntil: 'load' });
    const result = await scrollThrough(page);
    expect(result.steps).toBe(0);
    await page.close();
  });

  it('waitForImages reports broken images without waiting for them', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/network.html?delay=1'), { waitUntil: 'load' });
    await js(page, `(() => { const ok = new Image(); ok.src = '/img/x.png?delay=300'; document.body.appendChild(ok); const bad = new Image(); bad.src = '/nope.png'; document.body.appendChild(bad); })()`);
    const result = await waitForImages(page, { timeout: 3000 });
    expect(result.total).toBe(2);
    expect(result.ready).toBe(1);
    expect(result.broken).toBe(1);
    expect(result.timedOut).toBe(false);
    await page.close();
  });

  it('waitForImages does not wait for lazy images the browser will never fetch', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/lazy-unreachable.html'), { waitUntil: 'load' });
    // The far carousel slide is never fetched by the browser at this scroll position.
    expect(await js(page, `document.getElementById('slide-far').complete`)).toBe(false);
    const started = Date.now();
    const result = await waitForImages(page, { timeout: 4000 });
    expect(result.timedOut).toBe(false);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(result.pending).toBe(0);
    await page.close();
  });
});
