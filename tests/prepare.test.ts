import { describe, expect, it } from 'vitest';
import { prepareForCapture, readyScreenshot } from '../src/index.js';
import { drivers } from './helpers/drivers.js';
import { js, shown, useBrowser } from './helpers/setup.js';

describe.each(drivers)('prepareForCapture ($name)', (driver) => {
  const ctx = useBrowser(driver);

  it('runs every step in order and leaves the page ready', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/kitchen-sink.html'), { waitUntil: 'domcontentloaded' });
    const result = await prepareForCapture(page);
    expect(result.steps.map((s) => s.step)).toEqual(['consent', 'fonts', 'lazy', 'network', 'images', 'consent-again', 'fonts-again', 'freeze']);
    expect(result.steps.every((s) => s.ok)).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(await shown(page, '#onetrust-banner-sdk')).toBe(false);
    expect(await js(page, `document.fonts.check('16px SlowInter')`)).toBe(true);
    expect(await js(page, `Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0)`)).toBe(true);
    expect(await js(page, `document.getAnimations().filter((a) => a.playState === 'running').length`)).toBe(0);
    expect(await js(page, 'window.scrollY')).toBe(0);
    expect(await js(page, 'window.__accepted')).toBeUndefined();
    await page.close();
  });

  it('steps can be switched off and hide takes extra selectors', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/consent.html'), { waitUntil: 'load' });
    const result = await prepareForCapture(page, { lazy: false, fonts: false, network: false, images: false, freeze: false, hide: ['#chat'] });
    expect(result.steps.map((s) => s.step)).toEqual(['consent', 'hide', 'consent-again']);
    expect(await shown(page, '#chat')).toBe(false);
    await page.close();
  });

  it('stays within the time budget when the network never goes quiet', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/network.html?delay=100'), { waitUntil: 'load' });
    // A page that keeps polling: the network never goes quiet.
    await js(page, `(() => { setInterval(() => fetch('/api/slow?delay=150').catch(() => {}), 100); })()`);
    const started = Date.now();
    const result = await prepareForCapture(page, { timeout: 2500, network: { relaxAfterMs: Infinity } });
    expect(Date.now() - started).toBeLessThan(2500 + 1500);
    expect(result.timedOut).toBe(true);
    expect(result.steps.find((s) => s.step === 'freeze')?.ok).toBe(true);
    await page.close();
  });

  it('returns on a page whose main thread is stuck', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/busy.html'), { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 300));
    const started = Date.now();
    const result = await prepareForCapture(page, { timeout: 2000 });
    expect(Date.now() - started).toBeLessThan(2000 + 4500);
    expect(result.timedOut).toBe(true);
    await new Promise((r) => setTimeout(r, 4000));
    await page.close();
  }, 30_000);

  it('readyScreenshot prepares the page and returns the capture', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/kitchen-sink.html'), { waitUntil: 'load' });
    const shot = Buffer.from(await readyScreenshot(page, { fullPage: true, prepare: { timeout: 10_000 } }));
    expect(shot.subarray(1, 4).toString()).toBe('PNG');
    expect(shot.readUInt32BE(20)).toBeGreaterThan(3000); // PNG height: the full page, not one screen
    await page.close();
  });

  it('never throws, even on a closed page', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/network.html?delay=1'), { waitUntil: 'load' });
    await page.close();
    const result = await prepareForCapture(page, { timeout: 3000 });
    expect(result.steps.some((s) => s.error)).toBe(true);
  });
});
