import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { drivers } from './helpers/drivers.js';
import { js, shown, useBrowser } from './helpers/setup.js';

// The published files (run `npm run build` first; CI does). In-page functions are sent to the browser as
// source text, so this checks the compiled output, not just the TypeScript source.
const built = existsSync(new URL('../dist/esm/index.js', import.meta.url)) && existsSync(new URL('../dist/cjs/index.js', import.meta.url));
const require = createRequire(import.meta.url);

describe.skipIf(!built).each(drivers)('built package ($name)', (driver) => {
  const ctx = useBrowser(driver);

  it.each(['esm', 'cjs'] as const)('%s build prepares a page', async (format) => {
    const lib = format === 'esm' ? await import('../dist/esm/index.js') : require('../dist/cjs/index.js');
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/kitchen-sink.html'), { waitUntil: 'domcontentloaded' });
    const result = await lib.prepareForCapture(page);
    expect(result.steps.every((s: { ok: boolean }) => s.ok)).toBe(true);
    expect(await shown(page, '#onetrust-banner-sdk')).toBe(false);
    expect(await js(page, `Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0)`)).toBe(true);
    await page.close();
  });
});
