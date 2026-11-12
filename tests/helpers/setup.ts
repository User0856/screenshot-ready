import { afterAll, beforeAll } from 'vitest';
import type { Driver } from './drivers.js';
import { startServer, type FixtureServer } from './server.js';

/** Starts the fixture server and the driver's browser for one describe block. */
export function useBrowser(driver: Driver) {
  const ctx = {} as { server: FixtureServer };
  beforeAll(async () => {
    ctx.server = await startServer();
    await driver.start();
  });
  afterAll(async () => {
    await driver.stop();
    await ctx.server?.close();
  });
  return ctx;
}

/** Evaluates an expression string in the page (same call shape for Playwright and Puppeteer). */
export function js<T = unknown>(page: { evaluate(expr: string): Promise<unknown> }, expr: string): Promise<T> {
  return page.evaluate(expr) as Promise<T>;
}

/** True when the element (CSS selector, optionally inside the open shadow root of `host`) is rendered and visible. */
export function shown(page: { evaluate(expr: string): Promise<unknown> }, selector: string, host?: string): Promise<boolean> {
  const find = host
    ? `document.querySelector(${JSON.stringify(host)}).shadowRoot.querySelector(${JSON.stringify(selector)})`
    : `document.querySelector(${JSON.stringify(selector)})`;
  return js<boolean>(
    page,
    `(() => { const el = ${find}; if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && el.checkVisibility(); })()`,
  );
}
