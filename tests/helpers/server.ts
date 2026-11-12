import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));
const require = createRequire(import.meta.url);
const fontPath = require.resolve('@fontsource/inter/files/inter-latin-400-normal.woff2');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** A solid-color RGB PNG. */
export function solidPng(width: number, height: number, hex: string) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r!, g!, b!], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

export interface FixtureServer {
  url: (path: string) => string;
  close: () => Promise<void>;
  /** Paths requested so far (with query). */
  requests: string[];
}

/** Serves tests/fixtures plus a few slow endpoints, bound to 127.0.0.1 on a free port. */
export async function startServer(): Promise<FixtureServer> {
  const requests: string[] = [];
  const hanging = new Set<import('node:http').ServerResponse>();
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    requests.push(url.pathname + url.search);
    const delay = Number(url.searchParams.get('delay') ?? 0);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      if (url.pathname.startsWith('/img/')) {
        const w = Number(url.searchParams.get('w') ?? 40);
        const h = Number(url.searchParams.get('h') ?? 30);
        const color = url.searchParams.get('color') ?? 'e53935';
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
        res.end(solidPng(w, h, color));
        return;
      }
      if (url.pathname === '/font/inter.woff2') {
        res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'no-store' });
        res.end(await readFile(fontPath));
        return;
      }
      if (url.pathname === '/api/slow') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end('{"ok":true}');
        return;
      }
      if (url.pathname === '/api/hang') {
        // Never answers (a long-poll); closed when the server stops.
        hanging.add(res);
        return;
      }
      const file = normalize(join(fixtures, url.pathname === '/' ? 'index.html' : url.pathname));
      if (!file.startsWith(fixtures)) throw new Error('outside fixtures');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: (path) => `http://127.0.0.1:${port}${path}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        for (const res of hanging) res.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
