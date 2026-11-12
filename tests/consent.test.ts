import { describe, expect, it } from 'vitest';
import { hideConsentBanners, hideElements } from '../src/index.js';
import { drivers } from './helpers/drivers.js';
import { js, shown, useBrowser } from './helpers/setup.js';

describe.each(drivers)('consent banners ($name)', (driver) => {
  const ctx = useBrowser(driver);

  it('hides CMP, generic, shadow DOM and late banners plus the backdrop, without clicking', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/consent.html'), { waitUntil: 'load' });
    expect(await shown(page, '#generic-banner')).toBe(true);

    const result = await hideConsentBanners(page);
    expect(result.bySelector).toBeGreaterThanOrEqual(1);
    expect(result.byHeuristic).toBeGreaterThanOrEqual(2);
    expect(result.overlays).toBe(1);
    expect(result.scrollUnlocked).toBe(true);

    expect(await shown(page, '#onetrust-banner-sdk')).toBe(false);
    expect(await shown(page, '#generic-banner')).toBe(false);
    expect(await shown(page, '#backdrop')).toBe(false);
    expect(await shown(page, '#shadow-banner', '#shadow-host')).toBe(false);

    // The dialog that appears later is caught by the stylesheet rule.
    await new Promise((r) => setTimeout(r, 1200));
    expect(await js(page, `!!document.getElementById('CybotCookiebotDialog')`)).toBe(true);
    expect(await shown(page, '#CybotCookiebotDialog')).toBe(false);

    // Page content and non-consent fixed elements stay.
    for (const sel of ['#site-header', '#promo', '#content', '#chat', '#decor']) {
      expect(await shown(page, sel), sel).toBe(true);
    }
    expect(await js(page, 'window.__accepted')).toBeUndefined();
    expect(await js(page, `getComputedStyle(document.body).overflowY`)).toBe('visible');
    await page.close();
  });

  it('leaves a fixed full-screen app shell and a newsletter bar alone', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/app-shell.html'), { waitUntil: 'load' });
    const result = await hideConsentBanners(page);
    expect(result.hidden).toBe(0);
    expect(await shown(page, '#shell')).toBe(true);
    expect(await shown(page, '#newsletter')).toBe(true);
    await page.close();
  });

  it('is safe to call twice and accepts extra selectors', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/consent.html'), { waitUntil: 'load' });
    await hideConsentBanners(page);
    const again = await hideConsentBanners(page, { selectors: ['#chat', 'not a [valid selector'] });
    expect(again.byHeuristic).toBe(0);
    expect(await shown(page, '#chat')).toBe(false);
    expect(await shown(page, '#content')).toBe(true);
    expect(await js(page, `document.querySelectorAll('#screenshot-ready-consent-style').length`)).toBe(1);
    await page.close();
  });

  it('heuristics can be turned off', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/consent.html'), { waitUntil: 'load' });
    const result = await hideConsentBanners(page, { heuristics: false });
    expect(result.byHeuristic).toBe(0);
    expect(await shown(page, '#onetrust-banner-sdk')).toBe(false);
    expect(await shown(page, '#generic-banner')).toBe(true);
    await page.close();
  });

  it('hideElements hides named elements and keeps the layout', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/consent.html'), { waitUntil: 'load' });
    const matched = await hideElements(page, ['#chat', '#promo']);
    expect(matched).toBe(2);
    expect(await shown(page, '#chat')).toBe(false);
    expect(await js(page, `document.getElementById('promo').getBoundingClientRect().height > 0`)).toBe(true);
    await page.close();
  });

  it('hides a full-screen consent wall that lists partner links', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/consent-wall.html'), { waitUntil: 'load' });
    const result = await hideConsentBanners(page);
    expect(result.byHeuristic).toBe(1);
    expect(await shown(page, '#wall')).toBe(false);
    expect(await shown(page, 'main')).toBe(true);
    expect(await js(page, 'window.__accepted')).toBeUndefined();
    await page.close();
  });
});
