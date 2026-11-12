"""Loads the browser-side code shared with the Node package and builds the expressions sent to the page."""

from __future__ import annotations

import json
import re
from importlib import resources
from typing import Any

# inpage.js is generated from the Node package's src/inpage.ts (see scripts/export-inpage.mjs). Both packages
# send the same functions to the browser.
SOURCE: str = resources.files(__package__).joinpath("inpage.js").read_text(encoding="utf-8")


def _constant(name: str) -> Any:
    match = re.search(rf"^const {name} = (.*);$", SOURCE, re.MULTILINE)
    if not match:
        raise RuntimeError(f"inpage.js has no constant {name}")
    return json.loads(match.group(1))


CONSENT_SELECTORS: tuple[str, ...] = tuple(_constant("CONSENT_SELECTORS"))
HIDDEN_ATTRIBUTE: str = _constant("HIDDEN_ATTRIBUTE")


def expression(function: str, arg: Any = None) -> str:
    """An expression that calls one of the in-page functions with a JSON argument.

    The `__name` shim matches the Node package, which needs it when a build tool wraps nested functions in
    `__name(...)` calls.
    """
    if not re.search(rf"^function {function}\(", SOURCE, re.MULTILINE):
        raise ValueError(f"unknown in-page function {function}")
    return f"(() => {{ const __name = (f) => f;\n{SOURCE}\nreturn {function}({json.dumps(arg)}); }})()"
