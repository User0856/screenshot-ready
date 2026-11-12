"""screenshot-ready for Playwright's async API (`playwright.async_api`).

Same functions and options as the sync API in `screenshot_ready`, as coroutines. Pass an async `Page` or `Frame`
(or any object with an async `evaluate(expression)` method).
"""

from __future__ import annotations

from typing import Any, Literal, Optional, Union, cast

from . import _core
from ._core import PrepareResult, RequestTracker, StepReport
from ._js import CONSENT_SELECTORS, HIDDEN_ATTRIBUTE
from ._types import (
    ConsentOptions,
    FontsOptions,
    FreezeAnimationsResult,
    FreezeOptions,
    HideConsentResult,
    ImagesOptions,
    LazyOptions,
    LoadLazyContentResult,
    NetworkOptions,
    ScrollThroughResult,
    WaitForFontsResult,
    WaitForImagesResult,
    WaitForNetworkQuietResult,
)

__all__ = [
    "CONSENT_SELECTORS",
    "HIDDEN_ATTRIBUTE",
    "PrepareResult",
    "RequestTracker",
    "StepReport",
    "freeze_animations",
    "hide_consent_banners",
    "hide_elements",
    "load_lazy_content",
    "prepare_for_capture",
    "ready_screenshot",
    "scroll_through",
    "track_requests",
    "wait_for_fonts",
    "wait_for_images",
    "wait_for_network_quiet",
]


def _target(page: Any) -> _core.Target:
    if callable(getattr(page, "_sync", None)):
        raise TypeError("expected a Playwright async API Page or Frame; for playwright.sync_api use screenshot_ready (sync)")
    if not callable(getattr(page, "evaluate", None)):
        raise TypeError("expected a Playwright async API Page or Frame")
    # Request events come from a Page (which has main_frame); a Frame does not emit them.
    events = page if hasattr(page, "main_frame") and callable(getattr(page, "on", None)) else None
    return _core.Target(evaluate=page.evaluate, events=events)


async def prepare_for_capture(
    page: Any,
    *,
    timeout: float = 15_000,
    consent: Union[bool, ConsentOptions] = True,
    hide: Optional[list[str]] = None,
    hide_mode: Literal["visibility", "display"] = "visibility",
    fonts: Union[bool, FontsOptions] = True,
    lazy: Union[bool, LazyOptions] = True,
    network: Union[bool, NetworkOptions] = True,
    images: Union[bool, ImagesOptions] = True,
    freeze: Union[bool, FreezeOptions] = True,
) -> PrepareResult:
    """Gets a loaded page ready for `page.screenshot()`. See `screenshot_ready.prepare_for_capture` for the steps.

    It does not raise for anything the page does: a step that fails is reported in the result and the rest still
    run. Passing a sync API page raises TypeError.
    """
    target = _target(page)
    return await _core.prepare_for_capture(
        target, timeout=timeout, consent=consent, hide=hide, hide_mode=hide_mode, fonts=fonts, lazy=lazy, network=network, images=images, freeze=freeze
    )


async def ready_screenshot(page: Any, *, prepare: Optional[dict[str, Any]] = None, **screenshot_options: Any) -> bytes:
    """`await prepare_for_capture(page, **prepare)`, then `await page.screenshot(**screenshot_options)`."""
    await prepare_for_capture(page, **(prepare or {}))
    return cast(bytes, await page.screenshot(**screenshot_options))


async def hide_consent_banners(
    page: Any,
    *,
    selectors: Optional[list[str]] = None,
    replace_built_in: bool = False,
    heuristics: bool = True,
    unlock_scroll: bool = True,
    timeout: float = 2000,
) -> HideConsentResult:
    """Hides cookie and consent banners without clicking anything."""
    result = await _core.hide_consent_banners(
        _target(page), selectors=selectors, replace_built_in=replace_built_in, heuristics=heuristics, unlock_scroll=unlock_scroll, timeout=timeout
    )
    return cast(HideConsentResult, result)


async def hide_elements(page: Any, selectors: list[str], *, mode: Literal["visibility", "display"] = "visibility") -> int:
    """Hides the elements you name with a stylesheet rule. Returns how many matched at the time of the call."""
    return await _core.hide_elements(_target(page), selectors, mode=mode)


async def wait_for_fonts(page: Any, *, timeout: float = 3000) -> WaitForFontsResult:
    """Waits until the page's web fonts have loaded (or failed)."""
    return cast(WaitForFontsResult, await _core.wait_for_fonts(_target(page), timeout=timeout))


async def scroll_through(
    page: Any,
    *,
    timeout: float = 5000,
    max_height: float = 20_000,
    step_ratio: float = 0.85,
    step_delay_ms: float = 0,
) -> ScrollThroughResult:
    """Scrolls down through the page in viewport-sized steps, then back, so lazy content fires."""
    result = await _core.scroll_through(_target(page), timeout=timeout, max_height=max_height, step_ratio=step_ratio, step_delay_ms=step_delay_ms)
    return cast(ScrollThroughResult, result)


async def load_lazy_content(
    page: Any,
    *,
    timeout: float = 5000,
    max_height: float = 20_000,
    step_ratio: float = 0.85,
    step_delay_ms: float = 0,
    load_timeout: float = 5000,
) -> LoadLazyContentResult:
    """scroll_through, then waits for the network to go quiet and for images to decode."""
    result = await _core.load_lazy_content(
        _target(page), timeout=timeout, max_height=max_height, step_ratio=step_ratio, step_delay_ms=step_delay_ms, load_timeout=load_timeout
    )
    return cast(LoadLazyContentResult, result)


async def wait_for_images(page: Any, *, timeout: float = 5000, max_height: float = 20_000) -> WaitForImagesResult:
    """Waits until every rendered <img> within `max_height` has loaded and decoded."""
    return cast(WaitForImagesResult, await _core.wait_for_images(_target(page), timeout=timeout, max_height=max_height))


async def freeze_animations(page: Any, *, caret: bool = True, pause_media: bool = True) -> FreezeAnimationsResult:
    """Stops CSS and Web Animations, hides the caret and pauses media. Call it right before the capture."""
    return cast(FreezeAnimationsResult, await _core.freeze_animations(_target(page), caret=caret, pause_media=pause_media))


async def wait_for_network_quiet(
    page: Any,
    *,
    quiet_ms: float = 500,
    timeout: float = 5000,
    max_inflight: int = 0,
    relax_after_ms: Optional[float] = None,
) -> WaitForNetworkQuietResult:
    """Waits until no request has been open for `quiet_ms`. A Frame falls back to an in-page check."""
    result = await _core.wait_for_network_quiet(
        _target(page), quiet_ms=quiet_ms, timeout=timeout, max_inflight=max_inflight, relax_after_ms=relax_after_ms
    )
    return cast(WaitForNetworkQuietResult, result)


def track_requests(page: Any) -> Optional[RequestTracker]:
    """Starts counting open requests (call it before `page.goto()` to count everything). `await
    tracker.wait_for_quiet()` later, then `tracker.stop()`. Returns None for a Frame."""
    return _core.track_requests(_target(page))
