import { describe, expect, it } from 'vitest';
import { waitForFonts } from '../src/index.js';
import { drivers } from './helpers/drivers.js';
import { js, useBrowser } from './helpers/setup.js';

describe.each(drivers)('web fonts ($name)', (driver) => {
  const ctx = useBrowser(driver);

  it('waits for a slow web font and reports a broken one', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/fonts.html'), { waitUntil: 'domcontentloaded' });
    const before = await js<boolean>(page, `document.fonts.check('24px SlowInter')`);
    const result = await waitForFonts(page, { timeout: 5000 });
    expect(before).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(await js(page, `document.fonts.check('24px SlowInter')`)).toBe(true);
    expect(result.failed).toContain('BrokenFont');
    expect(result.pending).toEqual([]);
    await page.close();
  });

  it('picks up a font a script adds after the page is up', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/fonts.html'), { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 300));
    await waitForFonts(page, { timeout: 5000 });
    expect(await js(page, `document.fonts.check('16px LateInter')`)).toBe(true);
    await page.close();
  });

  it('gives up at the timeout and names the font still loading', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/fonts-hang.html'), { waitUntil: 'domcontentloaded' });
    const started = Date.now();
    const result = await waitForFonts(page, { timeout: 500 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.timedOut).toBe(true);
    expect(result.pending).toContain('HangFont');
    await page.close();
  });
});
