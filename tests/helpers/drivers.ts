import { chromium, type Browser as PwBrowser } from 'playwright';
import puppeteer, { type Browser as PpBrowser } from 'puppeteer';
import type { ScreenshotPage } from '../../src/index.js';

export interface TestPage extends ScreenshotPage {
  goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' }): Promise<unknown>;
  close(): Promise<void>;
}

export interface Driver {
  name: 'playwright' | 'puppeteer';
  start(): Promise<void>;
  stop(): Promise<void>;
  /** A fresh 1280x800 page in its own context. */
  newPage(): Promise<TestPage>;
}

function playwrightDriver(): Driver {
  let browser: PwBrowser | undefined;
  return {
    name: 'playwright',
    async start() {
      browser = await chromium.launch({ headless: true });
    },
    async stop() {
      await browser?.close();
    },
    async newPage() {
      const context = await browser!.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      // Typecheck: a real Playwright Page satisfies the library's page type.
      const typed: ScreenshotPage = page;
      void typed;
      const close = page.close.bind(page);
      return Object.assign(page, { close: async () => { await close(); await context.close(); } }) as unknown as TestPage;
    },
  };
}

function puppeteerDriver(): Driver {
  let browser: PpBrowser | undefined;
  return {
    name: 'puppeteer',
    async start() {
      browser = await puppeteer.launch({ headless: true });
    },
    async stop() {
      await browser?.close();
    },
    async newPage() {
      const context = await browser!.createBrowserContext();
      const page = await context.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      const typed: ScreenshotPage = page;
      void typed;
      const close = page.close.bind(page);
      return Object.assign(page, { close: async () => { await close(); await context.close(); } }) as unknown as TestPage;
    },
  };
}

export const drivers: Driver[] = [playwrightDriver(), puppeteerDriver()];
