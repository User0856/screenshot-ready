import { describe, expect, it } from 'vitest';
import { trackRequests, waitForNetworkQuiet } from '../src/index.js';
import { drivers } from './helpers/drivers.js';
import { js, useBrowser } from './helpers/setup.js';

describe.each(drivers)('network quiet ($name)', (driver) => {
  const ctx = useBrowser(driver);

  it('waits for a request started after load', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/network.html?delay=800'), { waitUntil: 'load' });
    const result = await waitForNetworkQuiet(page, { quietMs: 300, timeout: 5000 });
    expect(result.quiet).toBe(true);
    expect(result.method).toBe('events');
    expect(result.ms).toBeGreaterThanOrEqual(600);
    expect(await js(page, `document.getElementById('out').textContent`)).toBe('done');
    await page.close();
  });

  it('treats a never-ending request as quiet after the relax point', async () => {
    const page = await driver.newPage();
    const tracker = trackRequests(page)!;
    await page.goto(ctx.server.url('/network.html?delay=200&hang=1'), { waitUntil: 'load' });
    const result = await tracker.waitForQuiet({ quietMs: 300, timeout: 4000, relaxAfterMs: 1000 });
    tracker.stop();
    expect(result.quiet).toBe(true);
    expect(result.inflight).toBe(1);
    expect(result.ms).toBeGreaterThanOrEqual(1000);
    await page.close();
  });

  it('times out on a never-ending request with the strict rule', async () => {
    const page = await driver.newPage();
    const tracker = trackRequests(page)!;
    await page.goto(ctx.server.url('/network.html?delay=200&hang=1'), { waitUntil: 'load' });
    const result = await tracker.waitForQuiet({ quietMs: 300, timeout: 1200, relaxAfterMs: Infinity });
    tracker.stop();
    expect(result.quiet).toBe(false);
    expect(result.timedOut).toBe(true);
    await page.close();
  });

  it('falls back to an in-page check for objects without events (frames)', async () => {
    const page = await driver.newPage();
    await page.goto(ctx.server.url('/network.html?delay=500'), { waitUntil: 'load' });
    const frameLike = { evaluate: (expr: string) => page.evaluate(expr) };
    const result = await waitForNetworkQuiet(frameLike, { quietMs: 300, timeout: 4000 });
    expect(result.method).toBe('in-page');
    expect(result.quiet).toBe(true);
    await page.close();
  });
});
