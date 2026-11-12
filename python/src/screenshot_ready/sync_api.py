"""screenshot-ready for Playwright's sync API (`playwright.sync_api`).

Pass a sync `Page` (or `Frame`). The work runs on Playwright's own event loop, so time limits hold even when the
page's main thread is stuck and `page.evaluate()` alone would block.
"""

from __future__ import annotations

from typing import Any, Callable, Literal, Optional, Union, cast

from . import _core
from ._core import PrepareResult, StepReport
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
    impl = getattr(page, "_impl_obj", None)
    if not callable(getattr(page, "_sync", None)) or impl is None or not callable(getattr(impl, "evaluate", None)):
        if impl is not None:
            raise TypeError("expected a Playwright sync API Page or Frame; for playwright.async_api use screenshot_ready.async_api")
        raise TypeError("expected a Playwright sync API Page or Frame")
    # Request events come from a Page (which has main_frame); a Frame does not emit them.
    events = page if hasattr(page, "main_frame") and callable(getattr(page, "on", None)) else None
    evaluate = impl.evaluate
    return _core.Target(evaluate=lambda expression: evaluate(expression, None), events=events)


def _run(page: Any, make: Callable[[_core.Target], Any]) -> Any:
    target = _target(page)
    return page._sync(make(target))


def prepare_for_capture(
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
    """Gets a loaded page ready for `page.screenshot()`, in this order: hide consent banners, hide your selectors,
    wait for fonts, scroll through for lazy content, wait for the network to go quiet, wait for images to decode,
    hide late consent banners, catch fonts used by late content, freeze animations.

    Every step is bounded and the run stays within `timeout` ms (plus about a second for the final steps). It
    does not raise for anything the page does: a step that fails is reported in the result and the rest still
    run. Passing something that is not a Playwright sync Page or Frame raises TypeError.
    """
    options: dict[str, Any] = dict(consent=consent, hide=hide, fonts=fonts, lazy=lazy, network=network, images=images, freeze=freeze)
    target = _target(page)
    try:
        return cast(PrepareResult, page._sync(_core.prepare_for_capture(target, timeout=timeout, hide_mode=hide_mode, **options)))
    except Exception as error:  # Playwright stopped or the browser connection is gone
        return _core.failed_result(str(error) or type(error).__name__, **options)


def ready_screenshot(page: Any, *, prepare: Optional[dict[str, Any]] = None, **screenshot_options: Any) -> bytes:
    """`prepare_for_capture(page, **prepare)`, then `page.screenshot(**screenshot_options)`. Returns the image bytes."""
    prepare_for_capture(page, **(prepare or {}))
    return cast(bytes, page.screenshot(**screenshot_options))


def hide_consent_banners(
    page: Any,
    *,
    selectors: Optional[list[str]] = None,
    replace_built_in: bool = False,
    heuristics: bool = True,
    unlock_scroll: bool = True,
    timeout: float = 2000,
) -> HideConsentResult:
    """Hides cookie and consent banners without clicking anything: known consent platforms by selector, plus fixed
    overlays that talk about cookies or consent and offer a choice. Elements are hidden with CSS, not removed."""
    return cast(
        HideConsentResult,
        _run(
            page,
            lambda t: _core.hide_consent_banners(
                t, selectors=selectors, replace_built_in=replace_built_in, heuristics=heuristics, unlock_scroll=unlock_scroll, timeout=timeout
            ),
        ),
    )


def hide_elements(page: Any, selectors: list[str], *, mode: Literal["visibility", "display"] = "visibility") -> int:
    """Hides the elements you name with a stylesheet rule. Returns how many matched at the time of the call."""
    return cast(int, _run(page, lambda t: _core.hide_elements(t, selectors, mode=mode)))


def wait_for_fonts(page: Any, *, timeout: float = 3000) -> WaitForFontsResult:
    """Waits until the page's web fonts have loaded (or failed), including fonts that start loading meanwhile."""
    return cast(WaitForFontsResult, _run(page, lambda t: _core.wait_for_fonts(t, timeout=timeout)))


def scroll_through(
    page: Any,
    *,
    timeout: float = 5000,
    max_height: float = 20_000,
    step_ratio: float = 0.85,
    step_delay_ms: float = 0,
) -> ScrollThroughResult:
    """Scrolls down through the page (or its full-height scrolling container) in viewport-sized steps, then back,
    so lazy images and scroll-triggered loaders fire. Does not wait for the loads; load_lazy_content does."""
    return cast(
        ScrollThroughResult,
        _run(page, lambda t: _core.scroll_through(t, timeout=timeout, max_height=max_height, step_ratio=step_ratio, step_delay_ms=step_delay_ms)),
    )


def load_lazy_content(
    page: Any,
    *,
    timeout: float = 5000,
    max_height: float = 20_000,
    step_ratio: float = 0.85,
    step_delay_ms: float = 0,
    load_timeout: float = 5000,
) -> LoadLazyContentResult:
    """scroll_through, then waits (up to `load_timeout`) for the network to go quiet and for images to decode."""
    return cast(
        LoadLazyContentResult,
        _run(
            page,
            lambda t: _core.load_lazy_content(
                t, timeout=timeout, max_height=max_height, step_ratio=step_ratio, step_delay_ms=step_delay_ms, load_timeout=load_timeout
            ),
        ),
    )


def wait_for_images(page: Any, *, timeout: float = 5000, max_height: float = 20_000) -> WaitForImagesResult:
    """Waits until every rendered <img> within `max_height` has loaded and decoded. Broken images count as settled."""
    return cast(WaitForImagesResult, _run(page, lambda t: _core.wait_for_images(t, timeout=timeout, max_height=max_height)))


def freeze_animations(page: Any, *, caret: bool = True, pause_media: bool = True) -> FreezeAnimationsResult:
    """Finite animations and transitions jump to their end state, infinite ones pause, the caret is hidden and
    playing media pauses. Call it right before the capture."""
    return cast(FreezeAnimationsResult, _run(page, lambda t: _core.freeze_animations(t, caret=caret, pause_media=pause_media)))


def wait_for_network_quiet(
    page: Any,
    *,
    quiet_ms: float = 500,
    timeout: float = 5000,
    max_inflight: int = 0,
    relax_after_ms: Optional[float] = None,
) -> WaitForNetworkQuietResult:
    """Waits until no request has been open for `quiet_ms`. After `relax_after_ms` (default half the timeout) up
    to two open requests still count as quiet. Only requests that start after the call are seen; use
    track_requests before navigating to count everything. A Frame falls back to an in-page check."""
    return cast(
        WaitForNetworkQuietResult,
        _run(
            page,
            lambda t: _core.wait_for_network_quiet(t, quiet_ms=quiet_ms, timeout=timeout, max_inflight=max_inflight, relax_after_ms=relax_after_ms),
        ),
    )


class RequestTracker:
    """Counts open requests on a sync Page. Create it with track_requests()."""

    def __init__(self, page: Any, tracker: _core.RequestTracker) -> None:
        self._page = page
        self._tracker = tracker

    @property
    def inflight(self) -> int:
        """Requests seen starting and not yet finished or failed."""
        return self._tracker.inflight

    def wait_for_quiet(
        self,
        *,
        quiet_ms: float = 500,
        timeout: float = 5000,
        max_inflight: int = 0,
        relax_after_ms: Optional[float] = None,
    ) -> WaitForNetworkQuietResult:
        """Waits until the tracked requests have been quiet for `quiet_ms`."""
        coro = self._tracker.wait_for_quiet(quiet_ms=quiet_ms, timeout=timeout, max_inflight=max_inflight, relax_after_ms=relax_after_ms)
        return cast(WaitForNetworkQuietResult, self._page._sync(coro))

    def stop(self) -> None:
        """Removes the event listeners."""
        self._tracker.stop()


def track_requests(page: Any) -> Optional[RequestTracker]:
    """Starts counting open requests. Start it before `page.goto()` when you want every request counted, then call
    `wait_for_quiet()`. Returns None for an object without request events (a Frame)."""
    target = _target(page)
    tracker = _core.track_requests(target)
    return RequestTracker(page, tracker) if tracker is not None else None
