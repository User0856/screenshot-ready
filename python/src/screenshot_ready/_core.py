"""The implementation, written once as coroutines.

The async API runs these on the caller's event loop. The sync API runs them on Playwright's own loop (the one
its sync wrappers drive), which is what lets a sync call give up on a page whose main thread is stuck.
"""

from __future__ import annotations

import asyncio
import re
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Literal, Mapping, Optional, TypeVar

from . import _js

T = TypeVar("T")

# Extra time allowed on the Python side before a stuck page (busy main thread) is given up on.
GRACE_MS = 1000
# Time kept back from the main steps for the two quick final steps (second consent pass, freeze).
RESERVE_MS = 1000

StepName = Literal["consent", "hide", "fonts", "lazy", "network", "images", "consent-again", "fonts-again", "freeze"]


@dataclass
class StepReport:
    step: str
    ms: int
    #: False when the step raised (the message is in `error`) or was skipped because the budget ran out.
    ok: bool
    timed_out: bool
    skipped: bool = False
    error: Optional[str] = None
    #: The step function's own result (see each helper's return value).
    result: Any = None


@dataclass
class PrepareResult:
    ms: int
    #: True when any step hit its cap or the total budget ran out.
    timed_out: bool
    steps: list[StepReport] = field(default_factory=list)


class Target:
    """What the core needs from a page: an async `evaluate(expression)`, and optionally an object with
    Playwright's `on` / `remove_listener` for request events (a Page has them; a Frame does not emit them)."""

    def __init__(self, evaluate: Callable[[str], Awaitable[Any]], events: Any = None) -> None:
        self.evaluate = evaluate
        self.events = events

    def run(self, function: str, arg: Any = None) -> Awaitable[Any]:
        return self.evaluate(_js.expression(function, arg))


def _now() -> float:
    return time.monotonic() * 1000


_CAMEL = re.compile(r"(?<!^)(?=[A-Z])")


def _snake(value: Any) -> dict[str, Any]:
    """Result keys from the page are camelCase (shared with Node); Python callers get snake_case."""
    if not isinstance(value, dict):
        raise TypeError(f"unexpected result from the page: {value!r}")
    return {_CAMEL.sub("_", k).lower(): v for k, v in value.items()}


def _consume(task: "asyncio.Future[Any]") -> None:
    if not task.cancelled():
        task.exception()


async def with_timeout(awaitable: Awaitable[T], ms: float) -> tuple[bool, Optional[T]]:
    """(False, value) when the awaitable finishes within `ms`, (True, None) otherwise. Errors pass through.

    The awaitable is not cancelled on timeout (like the Node version): it finishes in the background and its
    result or error is dropped.
    """
    task = asyncio.ensure_future(awaitable)
    done, _ = await asyncio.wait({task}, timeout=max(0.0, ms) / 1000)
    if task in done:
        return False, task.result()
    task.add_done_callback(_consume)
    return True, None


# --- fonts -------------------------------------------------------------------------------------------------


async def wait_for_fonts(target: Target, timeout: float = 3000) -> dict[str, Any]:
    timeout_ms = max(0, timeout)
    timed_out, value = await with_timeout(target.run("fontsInPage", {"timeoutMs": timeout_ms}), timeout_ms + GRACE_MS)
    if timed_out:
        return {"timed_out": True, "loaded": 0, "pending": [], "failed": []}
    return _snake(value)


# --- consent and hiding ------------------------------------------------------------------------------------


async def hide_consent_banners(
    target: Target,
    selectors: Optional[list[str]] = None,
    replace_built_in: bool = False,
    heuristics: bool = True,
    unlock_scroll: bool = True,
    timeout: float = 2000,
) -> dict[str, Any]:
    timeout_ms = max(0, timeout)
    all_selectors = [*([] if replace_built_in else _js.CONSENT_SELECTORS), *(selectors or [])]
    arg = {"selectors": all_selectors, "heuristics": heuristics, "unlockScroll": unlock_scroll, "attr": _js.HIDDEN_ATTRIBUTE}
    timed_out, value = await with_timeout(target.run("consentInPage", arg), timeout_ms + GRACE_MS)
    if timed_out:
        return {"hidden": 0, "by_selector": 0, "by_heuristic": 0, "overlays": 0, "scroll_unlocked": False, "details": [], "timed_out": True}
    return _snake(value)


async def hide_elements(target: Target, selectors: list[str], mode: Literal["visibility", "display"] = "visibility") -> int:
    if not selectors:
        return 0
    timed_out, value = await with_timeout(target.run("hideInPage", {"selectors": list(selectors), "mode": mode}), 2000 + GRACE_MS)
    return 0 if timed_out else int(value or 0)


# --- lazy content ------------------------------------------------------------------------------------------


async def scroll_through(
    target: Target,
    timeout: float = 5000,
    max_height: float = 20_000,
    step_ratio: float = 0.85,
    step_delay_ms: float = 0,
) -> dict[str, Any]:
    timeout_ms = max(0, timeout)
    arg = {
        "timeoutMs": timeout_ms,
        "maxHeight": max(0, max_height),
        "stepRatio": min(1, max(0.1, step_ratio)),
        "stepDelayMs": max(0, step_delay_ms),
    }
    timed_out, value = await with_timeout(target.run("scrollInPage", arg), timeout_ms + GRACE_MS * 2)
    if not timed_out:
        return _snake(value)
    # A busy main thread kept the loop from finishing: put the page back at the top before the capture.
    try:
        await with_timeout(target.run("scrollTopInPage"), 500)
    except Exception:
        pass
    return {"steps": 0, "reached_px": 0, "page_height": 0, "scroller": "none", "timed_out": True}


async def wait_for_images(target: Target, timeout: float = 5000, max_height: Optional[float] = None) -> dict[str, Any]:
    timeout_ms = max(0, timeout)
    arg = {"timeoutMs": timeout_ms, "maxHeight": max(0, 20_000 if max_height is None else max_height)}
    timed_out, value = await with_timeout(target.run("imagesInPage", arg), timeout_ms + GRACE_MS)
    if timed_out:
        return {"total": 0, "ready": 0, "broken": 0, "pending": 0, "timed_out": True}
    return _snake(value)


# --- network -----------------------------------------------------------------------------------------------


class RequestTracker:
    """Counts open requests through the page's `request` / `requestfinished` / `requestfailed` events."""

    def __init__(self, events: Any) -> None:
        self._events = events
        self._open: set[Any] = set()
        self._last_change = _now()
        self._stopped = False

        def on_request(request: Any) -> None:
            try:
                url = request.url
            except Exception:
                url = ""
            if isinstance(url, str) and (url.startswith("data:") or url.startswith("blob:")):
                return
            self._open.add(self._key(request))
            self._last_change = _now()

        def on_done(request: Any) -> None:
            key = self._key(request)
            if key in self._open:
                self._open.discard(key)
                self._last_change = _now()

        self._on_request = on_request
        self._on_done = on_done
        events.on("request", on_request)
        events.on("requestfinished", on_done)
        events.on("requestfailed", on_done)

    @staticmethod
    def _key(request: Any) -> Any:
        # Playwright hands out wrapper objects; key by the object underneath so start and finish always match.
        return getattr(request, "_impl_obj", request)

    @property
    def inflight(self) -> int:
        return len(self._open)

    def stop(self) -> None:
        if self._stopped:
            return
        self._stopped = True
        for event, listener in (("request", self._on_request), ("requestfinished", self._on_done), ("requestfailed", self._on_done)):
            try:
                self._events.remove_listener(event, listener)
            except Exception:
                pass

    async def wait_for_quiet(
        self,
        quiet_ms: float = 500,
        timeout: float = 5000,
        max_inflight: int = 0,
        relax_after_ms: Optional[float] = None,
    ) -> dict[str, Any]:
        quiet_ms = max(0, quiet_ms)
        timeout = max(0, timeout)
        max_inflight = max(0, max_inflight)
        relax = timeout / 2 if relax_after_ms is None else relax_after_ms
        started = _now()
        # Quiet time counts from the last request start or finish (or from when tracking began).
        while True:
            elapsed = _now() - started
            allowed = max(max_inflight, 2) if elapsed >= relax else max_inflight
            if len(self._open) <= allowed and _now() - self._last_change >= quiet_ms:
                return {"quiet": True, "timed_out": False, "inflight": len(self._open), "ms": round(elapsed), "method": "events"}
            if elapsed >= timeout:
                return {"quiet": False, "timed_out": True, "inflight": len(self._open), "ms": round(elapsed), "method": "events"}
            await asyncio.sleep(0.05)


def track_requests(target: Target) -> Optional[RequestTracker]:
    if target.events is None:
        return None
    return RequestTracker(target.events)


async def _in_page_quiet(target: Target, quiet_ms: float, timeout: float) -> dict[str, Any]:
    started = _now()
    timed_out, value = await with_timeout(target.run("resourcesQuietInPage", {"quietMs": quiet_ms, "timeoutMs": timeout}), timeout + GRACE_MS)
    quiet = (not timed_out) and bool(value and value.get("quiet"))
    return {"quiet": quiet, "timed_out": not quiet, "inflight": 0, "ms": round(_now() - started), "method": "in-page"}


async def wait_for_network_quiet(
    target: Target,
    quiet_ms: float = 500,
    timeout: float = 5000,
    max_inflight: int = 0,
    relax_after_ms: Optional[float] = None,
) -> dict[str, Any]:
    tracker = track_requests(target)
    if tracker is None:
        return await _in_page_quiet(target, max(0, quiet_ms), max(0, timeout))
    try:
        return await tracker.wait_for_quiet(quiet_ms=quiet_ms, timeout=timeout, max_inflight=max_inflight, relax_after_ms=relax_after_ms)
    finally:
        tracker.stop()


async def load_lazy_content(
    target: Target,
    timeout: float = 5000,
    max_height: float = 20_000,
    step_ratio: float = 0.85,
    step_delay_ms: float = 0,
    load_timeout: float = 5000,
) -> dict[str, Any]:
    load_timeout = max(0, load_timeout)
    tracker = track_requests(target)
    network: Optional[dict[str, Any]] = None
    try:
        scroll = await scroll_through(target, timeout=timeout, max_height=max_height, step_ratio=step_ratio, step_delay_ms=step_delay_ms)
        if tracker is not None:
            network = await tracker.wait_for_quiet(quiet_ms=400, timeout=load_timeout)
    finally:
        if tracker is not None:
            tracker.stop()
    left = max(500, load_timeout - (network["ms"] if network else 0))
    images = await wait_for_images(target, timeout=left, max_height=max_height)
    timed_out = bool(scroll.get("timed_out")) or bool(network and network.get("timed_out")) or bool(images.get("timed_out"))
    return {"scroll": scroll, "network": network, "images": images, "timed_out": timed_out}


# --- freeze ------------------------------------------------------------------------------------------------


async def freeze_animations(target: Target, caret: bool = True, pause_media: bool = True) -> dict[str, Any]:
    timed_out, value = await with_timeout(target.run("freezeInPage", {"caret": caret, "pauseMedia": pause_media}), 2000 + GRACE_MS)
    if timed_out:
        return {"finished": 0, "paused": 0, "media": 0, "timed_out": True}
    return _snake(value)


# --- prepare_for_capture -----------------------------------------------------------------------------------


def _pick(value: Any) -> Optional[dict[str, Any]]:
    if value is False:
        return None
    if isinstance(value, Mapping):
        return dict(value)
    return {}


def planned_steps(consent: Any, hide: Any, fonts: Any, lazy: Any, network: Any, images: Any, freeze: Any) -> list[str]:
    """The steps prepare_for_capture would run with these options, in order."""
    on = {name: _pick(v) is not None for name, v in (("consent", consent), ("fonts", fonts), ("lazy", lazy), ("network", network), ("images", images), ("freeze", freeze))}
    names = []
    if on["consent"]:
        names.append("consent")
    if hide:
        names.append("hide")
    for name in ("fonts", "lazy", "network", "images"):
        if on[name]:
            names.append(name)
    if on["consent"]:
        names.append("consent-again")
    if on["fonts"]:
        names.append("fonts-again")
    if on["freeze"]:
        names.append("freeze")
    return names


async def prepare_for_capture(
    target: Target,
    timeout: Optional[float] = 15_000,
    consent: Any = True,
    hide: Optional[list[str]] = None,
    hide_mode: Literal["visibility", "display"] = "visibility",
    fonts: Any = True,
    lazy: Any = True,
    network: Any = True,
    images: Any = True,
    freeze: Any = True,
) -> PrepareResult:
    started = _now()
    budget = max(0, 15_000 if timeout is None else timeout)
    deadline = started + budget
    steps: list[StepReport] = []

    async def run(step: str, cap: float, fn: Callable[[float], Awaitable[Any]], final: bool = False) -> None:
        left = (deadline if final else deadline - RESERVE_MS) - _now()
        step_timeout = min(cap, max(left, 500) if final else left)
        t0 = _now()
        if step_timeout < 100:
            steps.append(StepReport(step=step, ms=0, ok=False, timed_out=True, skipped=True))
            return
        try:
            timed_out, result = await with_timeout(fn(step_timeout), step_timeout + GRACE_MS * 2)
            reported = timed_out or bool(isinstance(result, dict) and result.get("timed_out"))
            steps.append(StepReport(step=step, ms=round(_now() - t0), ok=not timed_out, timed_out=reported, result=result))
        except Exception as error:  # a step that fails is reported; the rest still run
            steps.append(StepReport(step=step, ms=round(_now() - t0), ok=False, timed_out=False, error=str(error) or type(error).__name__))

    consent_opts = _pick(consent)
    fonts_opts = _pick(fonts)
    lazy_opts = _pick(lazy)
    network_opts = _pick(network)
    images_opts = _pick(images)
    freeze_opts = _pick(freeze)

    if consent_opts is not None:
        await run("consent", 2000, lambda t: hide_consent_banners(target, **{**consent_opts, "timeout": t}))
    if hide:
        selectors = list(hide)
        await run("hide", 2000, lambda t: hide_elements(target, selectors, mode=hide_mode))
    if fonts_opts is not None:
        await run("fonts", fonts_opts.get("timeout", 3000), lambda t: wait_for_fonts(target, timeout=t))

    # Count requests from the start of the scroll so the loads it triggers are seen by the network step.
    tracker = track_requests(target) if network_opts is not None else None
    try:
        if lazy_opts is not None:
            await run("lazy", lazy_opts.get("timeout", 5000), lambda t: scroll_through(target, **{**lazy_opts, "timeout": t}))
        if network_opts is not None:
            quiet = {"quiet_ms": 500, **network_opts}

            def network_step(t: float) -> Awaitable[Any]:
                options = {**quiet, "timeout": t}
                return tracker.wait_for_quiet(**options) if tracker is not None else wait_for_network_quiet(target, **options)

            await run("network", network_opts.get("timeout", 3000), network_step)
    finally:
        if tracker is not None:
            tracker.stop()
    if images_opts is not None:
        max_height = images_opts.get("max_height", lazy_opts.get("max_height") if lazy_opts is not None else None)
        await run("images", images_opts.get("timeout", 3000), lambda t: wait_for_images(target, timeout=t, max_height=max_height))
    if consent_opts is not None:
        await run("consent-again", 1000, lambda t: hide_consent_banners(target, **{**consent_opts, "timeout": t}), final=True)
    if fonts_opts is not None:
        await run("fonts-again", 1000, lambda t: wait_for_fonts(target, timeout=t))
    if freeze_opts is not None:
        await run("freeze", 1000, lambda t: freeze_animations(target, **freeze_opts), final=True)

    return PrepareResult(ms=round(_now() - started), timed_out=any(s.timed_out for s in steps), steps=steps)


def failed_result(message: str, **options: Any) -> PrepareResult:
    """A report for a run that could not start at all (Playwright already stopped)."""
    names = planned_steps(**options)
    return PrepareResult(ms=0, timed_out=False, steps=[StepReport(step=n, ms=0, ok=False, timed_out=False, error=message) for n in names])
