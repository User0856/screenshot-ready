from __future__ import annotations

import json
from typing import Any, Iterator, Optional

import pytest

from fixture_server import FONT, FixtureServer


@pytest.fixture(scope="session")
def server() -> Iterator[FixtureServer]:
    if not FONT.exists():
        pytest.exit(f"test font missing at {FONT}: run `npm ci --ignore-scripts` in the repo root (or set SCREENSHOT_READY_TEST_FONT)", 2)
    s = FixtureServer()
    yield s
    s.close()


def js(page: Any, expr: str) -> Any:
    """Evaluates an expression in a sync page."""
    return page.evaluate(expr)


def shown_expr(selector: str, host: Optional[str] = None) -> str:
    """An expression: true when the element (optionally inside the open shadow root of `host`) is visible."""
    find = (
        f"document.querySelector({json.dumps(host)}).shadowRoot.querySelector({json.dumps(selector)})"
        if host
        else f"document.querySelector({json.dumps(selector)})"
    )
    return (
        f"(() => {{ const el = {find}; if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);"
        " return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && el.checkVisibility(); })()"
    )
