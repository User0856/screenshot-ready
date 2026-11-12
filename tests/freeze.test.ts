import { describe, expect, it } from 'vitest';
import { freezeAnimations } from '../src/index.js';
import { drivers } from './helpers/drivers.js';
import { js, useBrowser } from './helpers/setup.js';

describe.each(drivers)('freeze animations ($name)', (driver) => {
  const ctx = useBrowser(driver);

  it('two captures in a row differ before freezing (the problem)', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/animations.html'), { waitUntil: 'load' });
    const a = Buffer.from(await page.screenshot());
    await new Promise((r) => setTimeout(r, 150));
    const b = Buffer.from(await page.screenshot());
    expect(a.equals(b)).toBe(false);
    await page.close();
  });

  it('ends finite animations, pauses infinite ones, hides the caret, and captures are identical', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/animations.html'), { waitUntil: 'load' });
    const result = await freezeAnimations(page);
    expect(result.paused).toBeGreaterThanOrEqual(1); // the infinite Web Animations API loop
    expect(await js(page, `getComputedStyle(document.getElementById('fade')).opacity`)).toBe('1');
    expect(await js(page, `getComputedStyle(document.getElementById('slide')).transform`)).toContain('400');
    expect(await js(page, `getComputedStyle(document.getElementById('field')).caretColor`)).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    expect(await js(page, `document.getAnimations().filter((a) => a.playState === 'running').length`)).toBe(0);
    const a = Buffer.from(await page.screenshot());
    await new Promise((r) => setTimeout(r, 300));
    const b = Buffer.from(await page.screenshot());
    expect(a.equals(b)).toBe(true);
    await page.close();
  });
});
