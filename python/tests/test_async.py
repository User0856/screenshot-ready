"""The async API against headless Chromium.

Each test runs its own event loop in a separate thread, so it never meets the sync tests' Playwright loop.
"""

from __future__ import annotations

import asyncio
import struct
import threading
import time
from typing import Any, Awaitable, Callable

import pytest
from playwright.async_api import async_playwright

from conftest import shown_expr
from fixture_server import FixtureServer
from screenshot_ready import async_api as sr


def with_page(test: Callable[[Any], Awaitable[None]]) -> None:
    """Runs `test(page)` with a fresh 1280x800 async page, in its own thread and event loop."""

    async def main() -> None:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            try:
                context = await browser.new_context(viewport={"width": 1280, "height": 800})
                await test(await context.new_page())
            finally:
                await browser.close()

    errors: list[BaseException] = []

    def target() -> None:
        try:
            asyncio.run(main())
        except BaseException as error:  # re-raised in the test thread
            errors.append(error)

    thread = threading.Thread(target=target)
    thread.start()
    thread.join()
    if errors:
        raise errors[0]


def test_prepare_runs_every_step(server: FixtureServer) -> None:
    async def test(page: Any) -> None:
        await page.goto(server.url("/kitchen-sink.html"), wait_until="domcontentloaded")
        result = await sr.prepare_for_capture(page)
        assert [s.step for s in result.steps] == ["consent", "fonts", "lazy", "network", "images", "consent-again", "fonts-again", "freeze"]
        assert all(s.ok for s in result.steps), result
        assert not await page.evaluate(shown_expr("#onetrust-banner-sdk"))
        assert await page.evaluate("Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0)")
        assert await page.evaluate("window.scrollY") == 0

    with_page(test)


def test_prepare_returns_on_a_page_whose_main_thread_is_stuck(server: FixtureServer) -> None:
    async def test(page: Any) -> None:
        await page.goto(server.url("/busy.html"), wait_until="load")
        await asyncio.sleep(0.3)
        started = time.monotonic()
        result = await sr.prepare_for_capture(page, timeout=2000)
        assert (time.monotonic() - started) * 1000 < 2000 + 4500
        assert result.timed_out is True
        await asyncio.sleep(4)

    with_page(test)


def test_ready_screenshot(server: FixtureServer) -> None:
    async def test(page: Any) -> None:
        await page.goto(server.url("/kitchen-sink.html"), wait_until="load")
        shot = await sr.ready_screenshot(page, full_page=True, prepare={"timeout": 10_000})
        assert shot[1:4] == b"PNG"
        assert struct.unpack(">I", shot[20:24])[0] > 3000

    with_page(test)


def test_prepare_never_raises_on_a_closed_page(server: FixtureServer) -> None:
    async def test(page: Any) -> None:
        await page.goto(server.url("/network.html?delay=1"), wait_until="load")
        await page.close()
        result = await sr.prepare_for_capture(page, timeout=3000)
        assert any(s.error for s in result.steps)

    with_page(test)


def test_lazy_content_in_an_inner_container(server: FixtureServer) -> None:
    async def test(page: Any) -> None:
        await page.goto(server.url("/inner-scroll.html"), wait_until="load")
        result = await sr.load_lazy_content(page)
        assert result["scroll"]["scroller"] == "element"
        assert all(await page.evaluate("Array.from(document.querySelectorAll('img.native')).map((i) => i.complete && i.naturalWidth > 0)"))

    with_page(test)


def test_consent_and_tracker(server: FixtureServer) -> None:
    async def test(page: Any) -> None:
        tracker = sr.track_requests(page)
        assert tracker is not None
        await page.goto(server.url("/network.html?delay=200&hang=1"), wait_until="load")
        result = await tracker.wait_for_quiet(quiet_ms=300, timeout=4000, relax_after_ms=1000)
        tracker.stop()
        assert result["quiet"] is True and result["inflight"] == 1
        await page.goto(server.url("/consent.html"), wait_until="load")
        consent = await sr.hide_consent_banners(page)
        assert consent["by_selector"] >= 1 and consent["overlays"] == 1
        assert not await page.evaluate(shown_expr("#generic-banner"))

    with_page(test)


def test_frames_and_duck_typed_objects_fall_back_to_an_in_page_check(server: FixtureServer) -> None:
    async def test(page: Any) -> None:
        await page.goto(server.url("/network.html?delay=500"), wait_until="load")

        class FrameLike:
            async def evaluate(self, expression: str) -> Any:
                return await page.evaluate(expression)

        for target in (page.main_frame, FrameLike()):
            result = await sr.wait_for_network_quiet(target, quiet_ms=300, timeout=4000)
            assert result["method"] == "in-page" and result["quiet"] is True

    with_page(test)


def test_fonts_freeze_and_images(server: FixtureServer) -> None:
    async def test(page: Any) -> None:
        await page.goto(server.url("/fonts.html"), wait_until="domcontentloaded")
        fonts = await sr.wait_for_fonts(page, timeout=5000)
        assert fonts["timed_out"] is False and "BrokenFont" in fonts["failed"]
        await page.goto(server.url("/animations.html"), wait_until="load")
        frozen = await sr.freeze_animations(page)
        assert frozen["paused"] >= 1
        assert await sr.hide_elements(page, ["#field"]) == 1
        images = await sr.wait_for_images(page)
        assert images["timed_out"] is False

    with_page(test)


def test_a_sync_page_is_rejected() -> None:
    class SyncLike:
        def _sync(self, coro: Any) -> None: ...

        def evaluate(self, expression: str) -> None: ...

    with pytest.raises(TypeError):
        # The check runs before the coroutine starts, so no event loop is needed.
        sr.prepare_for_capture(SyncLike()).send(None)
