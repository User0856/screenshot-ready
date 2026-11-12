"""Serves the repo's tests/fixtures (shared with the Node tests) plus a few slow endpoints, on 127.0.0.1."""

from __future__ import annotations

import os
import struct
import threading
import time
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

REPO = Path(__file__).resolve().parents[2]
FIXTURES = REPO / "tests" / "fixtures"
FONT = Path(os.environ.get("SCREENSHOT_READY_TEST_FONT", REPO / "node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2"))
TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript"}


def solid_png(width: int, height: int, hex_color: str) -> bytes:
    r, g, b = (int(hex_color[i : i + 2], 16) for i in (0, 2, 4))
    row = b"\x00" + bytes([r, g, b]) * width
    raw = row * height

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


class FixtureServer:
    def __init__(self) -> None:
        self.requests: list[str] = []
        self._stopping = threading.Event()
        server = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args: object) -> None:  # keep test output clean
                pass

            def send(self, status: int, content_type: str, body: bytes) -> None:
                self.send_response(status)
                self.send_header("content-type", content_type)
                self.send_header("cache-control", "no-store")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self) -> None:  # noqa: N802 (http.server naming)
                url = urlparse(self.path)
                query = {k: v[0] for k, v in parse_qs(url.query).items()}
                server.requests.append(self.path)
                delay = float(query.get("delay", 0))
                if delay > 0:
                    time.sleep(delay / 1000)
                try:
                    if url.path.startswith("/img/"):
                        png = solid_png(int(query.get("w", 40)), int(query.get("h", 30)), query.get("color", "e53935"))
                        return self.send(200, "image/png", png)
                    if url.path == "/font/inter.woff2":
                        return self.send(200, "font/woff2", FONT.read_bytes())
                    if url.path == "/api/slow":
                        return self.send(200, "application/json", b'{"ok":true}')
                    if url.path == "/api/hang":
                        # Never answers (a long-poll) until the server stops.
                        server._stopping.wait()
                        return
                    file = (FIXTURES / url.path.lstrip("/")).resolve()
                    if FIXTURES.resolve() not in file.parents:
                        raise FileNotFoundError(url.path)
                    self.send(200, TYPES.get(file.suffix, "application/octet-stream"), file.read_bytes())
                except (FileNotFoundError, IsADirectoryError):
                    self.send(404, "text/plain", b"not found")
                except (BrokenPipeError, ConnectionResetError):
                    pass

        self._httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._httpd.daemon_threads = True
        self.port = self._httpd.server_address[1]
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()

    def url(self, path: str) -> str:
        return f"http://127.0.0.1:{self.port}{path}"

    def close(self) -> None:
        self._stopping.set()
        self._httpd.shutdown()
        self._httpd.server_close()
