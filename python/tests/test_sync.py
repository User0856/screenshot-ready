"""The sync API against headless Chromium, mirroring the Node test suite."""

from __future__ import annotations

import struct
import time
from typing import Any, Iterator

import pytest
from playwright.sync_api import sync_playwright

import screenshot_ready as sr
from conftest import js, shown_expr
from fixture_server import FixtureServer


@pytest.fixture(scope="module")
def browser() -> Iterator[Any]:
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        yield b
        b.close()


@pytest.fixture
def page(browser: Any) -> Iterator[Any]:
    context = browser.new_context(viewport={"width": 1280, "height": 800})
    pg = context.new_page()
    yield pg
    context.close()


def shown(page: Any, selector: str, host: Any = None) -> bool:
    return bool(page.evaluate(shown_expr(selector, host)))


IMAGE_STATE = "Array.from(document.querySelectorAll('img.native, img.observed')).map((i) => i.complete && i.naturalWidth > 0)"
ALL_IMAGES_LOADED = "Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0)"
RUNNING_ANIMATIONS = "document.getAnimations().filter((a) => a.playState === 'running').length"


# --- prepare_for_capture -----------------------------------------------------------------------------------


def test_prepare_runs_every_step_in_order(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/kitchen-sink.html"), wait_until="domcontentloaded")
    result = sr.prepare_for_capture(page)
    assert [s.step for s in result.steps] == ["consent", "fonts", "lazy", "network", "images", "consent-again", "fonts-again", "freeze"]
    assert all(s.ok for s in result.steps), result
    assert result.timed_out is False
    assert not shown(page, "#onetrust-banner-sdk")
    assert js(page, "document.fonts.check('16px SlowInter')") is True
    assert js(page, ALL_IMAGES_LOADED) is True
    assert js(page, RUNNING_ANIMATIONS) == 0
    assert js(page, "window.scrollY") == 0
    assert js(page, "window.__accepted") is None
    consent = result.steps[0].result
    assert consent["by_selector"] >= 1 and "timed_out" in consent


def test_prepare_steps_can_be_switched_off_and_hide_takes_selectors(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/consent.html"), wait_until="load")
    result = sr.prepare_for_capture(page, lazy=False, fonts=False, network=False, images=False, freeze=False, hide=["#chat"])
    assert [s.step for s in result.steps] == ["consent", "hide", "consent-again"]
    assert not shown(page, "#chat")


def test_prepare_stays_within_budget_when_network_never_goes_quiet(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/network.html?delay=100"), wait_until="load")
    js(page, "(() => { setInterval(() => fetch('/api/slow?delay=150').catch(() => {}), 100); })()")
    started = time.monotonic()
    result = sr.prepare_for_capture(page, timeout=2500, network={"relax_after_ms": float("inf")})
    assert (time.monotonic() - started) * 1000 < 2500 + 1500
    assert result.timed_out is True
    freeze = next(s for s in result.steps if s.step == "freeze")
    assert freeze.ok is True


def test_prepare_returns_on_a_page_whose_main_thread_is_stuck(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/busy.html"), wait_until="load")
    time.sleep(0.3)
    started = time.monotonic()
    result = sr.prepare_for_capture(page, timeout=2000)
    assert (time.monotonic() - started) * 1000 < 2000 + 4500
    assert result.timed_out is True
    time.sleep(4)


def test_ready_screenshot_prepares_and_returns_the_capture(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/kitchen-sink.html"), wait_until="load")
    shot = sr.ready_screenshot(page, full_page=True, prepare={"timeout": 10_000})
    assert shot[1:4] == b"PNG"
    assert struct.unpack(">I", shot[20:24])[0] > 3000  # PNG height: the full page, not one screen


def test_prepare_never_raises_on_a_closed_page(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/network.html?delay=1"), wait_until="load")
    page.close()
    result = sr.prepare_for_capture(page, timeout=3000)
    assert any(s.error for s in result.steps)


def test_prepare_reports_an_unknown_option_as_a_step_error(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/network.html?delay=1"), wait_until="load")
    result = sr.prepare_for_capture(page, lazy={"max_heigth": 100}, network=False)  # type: ignore[typeddict-unknown-key]
    lazy = next(s for s in result.steps if s.step == "lazy")
    assert lazy.ok is False and "max_heigth" in (lazy.error or "")
    assert next(s for s in result.steps if s.step == "freeze").ok is True


def test_wrong_page_type_raises_type_error() -> None:
    with pytest.raises(TypeError):
        sr.prepare_for_capture(object())


# --- consent ------------------------------------------------------------------------------------------------


def test_hides_cmp_generic_shadow_and_late_banners_without_clicking(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/consent.html"), wait_until="load")
    assert shown(page, "#generic-banner")
    result = sr.hide_consent_banners(page)
    assert result["by_selector"] >= 1
    assert result["by_heuristic"] >= 2
    assert result["overlays"] == 1
    assert result["scroll_unlocked"] is True
    for sel in ["#onetrust-banner-sdk", "#generic-banner", "#backdrop"]:
        assert not shown(page, sel), sel
    assert not shown(page, "#shadow-banner", "#shadow-host")
    time.sleep(1.2)
    assert js(page, "!!document.getElementById('CybotCookiebotDialog')") is True
    assert not shown(page, "#CybotCookiebotDialog")
    for sel in ["#site-header", "#promo", "#content", "#chat", "#decor"]:
        assert shown(page, sel), sel
    assert js(page, "window.__accepted") is None
    assert js(page, "getComputedStyle(document.body).overflowY") == "visible"


def test_leaves_app_shell_and_newsletter_bar_alone(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/app-shell.html"), wait_until="load")
    assert sr.hide_consent_banners(page)["hidden"] == 0
    assert shown(page, "#shell")
    assert shown(page, "#newsletter")


def test_consent_is_safe_to_call_twice_and_accepts_selectors(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/consent.html"), wait_until="load")
    sr.hide_consent_banners(page)
    again = sr.hide_consent_banners(page, selectors=["#chat", "not a [valid selector"])
    assert again["by_heuristic"] == 0
    assert not shown(page, "#chat")
    assert shown(page, "#content")
    assert js(page, "document.querySelectorAll('#screenshot-ready-consent-style').length") == 1


def test_heuristics_can_be_turned_off(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/consent.html"), wait_until="load")
    result = sr.hide_consent_banners(page, heuristics=False)
    assert result["by_heuristic"] == 0
    assert not shown(page, "#onetrust-banner-sdk")
    assert shown(page, "#generic-banner")


def test_hide_elements_keeps_the_layout(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/consent.html"), wait_until="load")
    assert sr.hide_elements(page, ["#chat", "#promo"]) == 2
    assert not shown(page, "#chat")
    assert js(page, "document.getElementById('promo').getBoundingClientRect().height > 0") is True


def test_hides_a_full_screen_consent_wall(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/consent-wall.html"), wait_until="load")
    assert sr.hide_consent_banners(page)["by_heuristic"] == 1
    assert not shown(page, "#wall")
    assert shown(page, "main")


def test_consent_selectors_are_shared_with_node() -> None:
    assert "#onetrust-consent-sdk" in sr.CONSENT_SELECTORS
    assert sr.HIDDEN_ATTRIBUTE == "data-screenshot-ready-hidden"


# --- fonts --------------------------------------------------------------------------------------------------


def test_waits_for_a_slow_font_and_reports_a_broken_one(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/fonts.html"), wait_until="domcontentloaded")
    before = js(page, "document.fonts.check('24px SlowInter')")
    result = sr.wait_for_fonts(page, timeout=5000)
    assert before is False
    assert result["timed_out"] is False
    assert js(page, "document.fonts.check('24px SlowInter')") is True
    assert "BrokenFont" in result["failed"]
    assert result["pending"] == []


def test_picks_up_a_font_added_later(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/fonts.html"), wait_until="domcontentloaded")
    time.sleep(0.3)
    sr.wait_for_fonts(page, timeout=5000)
    assert js(page, "document.fonts.check('16px LateInter')") is True


def test_fonts_give_up_at_the_timeout(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/fonts-hang.html"), wait_until="domcontentloaded")
    started = time.monotonic()
    result = sr.wait_for_fonts(page, timeout=500)
    assert time.monotonic() - started < 2
    assert result["timed_out"] is True
    assert "HangFont" in result["pending"]


# --- lazy content ------------------------------------------------------------------------------------------


def test_plain_load_leaves_lazy_images_unloaded(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/lazy.html"), wait_until="load")
    assert js(page, IMAGE_STATE).count(False) >= 4


def test_load_lazy_content_loads_images_and_scrolls_back(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/lazy.html"), wait_until="load")
    result = sr.load_lazy_content(page)
    assert result["scroll"]["steps"] > 5
    assert result["scroll"]["scroller"] == "window"
    assert result["timed_out"] is False
    images = js(page, IMAGE_STATE)
    assert len(images) == 6 and all(images)
    assert js(page, "window.scrollY") == 0
    assert js(page, "document.getElementById('reveal').classList.contains('shown')") is True
    assert result["images"]["broken"] == 0 and result["images"]["pending"] == 0


def test_restores_a_scroll_position_that_was_not_the_top(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/lazy.html"), wait_until="load")
    js(page, "window.scrollTo(0, 1000)")
    sr.scroll_through(page)
    assert js(page, "window.scrollY") == 1000


def test_scrolls_an_inner_container(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/inner-scroll.html"), wait_until="load")
    result = sr.load_lazy_content(page)
    assert result["scroll"]["scroller"] == "element"
    assert result["scroll"]["steps"] > 2
    assert all(js(page, IMAGE_STATE))
    assert js(page, "document.getElementById('app').scrollTop") == 0


def test_stops_at_max_height_on_an_infinite_feed(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/infinite.html"), wait_until="load")
    result = sr.scroll_through(page, max_height=6000)
    assert 4000 < result["reached_px"] <= 6000
    assert result["timed_out"] is False


def test_scroll_stops_when_its_budget_runs_out(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/infinite.html"), wait_until="load")
    started = time.monotonic()
    result = sr.scroll_through(page, max_height=1_000_000, timeout=600, step_delay_ms=100)
    assert result["timed_out"] is True
    assert time.monotonic() - started < 3
    assert js(page, "window.scrollY") == 0


def test_scroll_does_nothing_on_a_page_that_fits(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/network.html?delay=1"), wait_until="load")
    assert sr.scroll_through(page)["steps"] == 0


def test_wait_for_images_reports_broken_images(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/network.html?delay=1"), wait_until="load")
    js(
        page,
        "(() => { const ok = new Image(); ok.src = '/img/x.png?delay=300'; document.body.appendChild(ok);"
        " const bad = new Image(); bad.src = '/nope.png'; document.body.appendChild(bad); })()",
    )
    result = sr.wait_for_images(page, timeout=3000)
    assert (result["total"], result["ready"], result["broken"], result["timed_out"]) == (2, 1, 1, False)


def test_wait_for_images_skips_lazy_images_never_fetched(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/lazy-unreachable.html"), wait_until="load")
    assert js(page, "document.getElementById('slide-far').complete") is False
    started = time.monotonic()
    result = sr.wait_for_images(page, timeout=4000)
    assert result["timed_out"] is False
    assert time.monotonic() - started < 1.5
    assert result["pending"] == 0


# --- network ------------------------------------------------------------------------------------------------


def test_waits_for_a_request_started_after_load(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/network.html?delay=800"), wait_until="load")
    result = sr.wait_for_network_quiet(page, quiet_ms=300, timeout=5000)
    assert result["quiet"] is True
    assert result["method"] == "events"
    assert result["ms"] >= 600
    assert js(page, "document.getElementById('out').textContent") == "done"


def test_never_ending_request_is_quiet_after_the_relax_point(page: Any, server: FixtureServer) -> None:
    tracker = sr.track_requests(page)
    assert tracker is not None
    page.goto(server.url("/network.html?delay=200&hang=1"), wait_until="load")
    result = tracker.wait_for_quiet(quiet_ms=300, timeout=4000, relax_after_ms=1000)
    tracker.stop()
    assert result["quiet"] is True
    assert result["inflight"] == 1
    assert result["ms"] >= 1000


def test_never_ending_request_times_out_with_the_strict_rule(page: Any, server: FixtureServer) -> None:
    tracker = sr.track_requests(page)
    assert tracker is not None
    page.goto(server.url("/network.html?delay=200&hang=1"), wait_until="load")
    result = tracker.wait_for_quiet(quiet_ms=300, timeout=1200, relax_after_ms=float("inf"))
    tracker.stop()
    assert result["quiet"] is False
    assert result["timed_out"] is True


def test_tracker_stop_removes_its_listeners(page: Any, server: FixtureServer) -> None:
    tracker = sr.track_requests(page)
    assert tracker is not None
    tracker.stop()
    page.goto(server.url("/network.html?delay=200&hang=1"), wait_until="load")
    assert tracker.inflight == 0


def test_frames_fall_back_to_an_in_page_check(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/network.html?delay=500"), wait_until="load")
    assert sr.track_requests(page.main_frame) is None
    result = sr.wait_for_network_quiet(page.main_frame, quiet_ms=300, timeout=4000)
    assert result["method"] == "in-page"
    assert result["quiet"] is True


# --- freeze -------------------------------------------------------------------------------------------------


def test_captures_differ_before_freezing(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/animations.html"), wait_until="load")
    a = page.screenshot()
    time.sleep(0.15)
    assert a != page.screenshot()


def test_freeze_makes_captures_identical(page: Any, server: FixtureServer) -> None:
    page.goto(server.url("/animations.html"), wait_until="load")
    result = sr.freeze_animations(page)
    assert result["paused"] >= 1
    assert js(page, "getComputedStyle(document.getElementById('fade')).opacity") == "1"
    assert "400" in js(page, "getComputedStyle(document.getElementById('slide')).transform")
    assert js(page, "getComputedStyle(document.getElementById('field')).caretColor") in ("rgba(0, 0, 0, 0)", "transparent")
    assert js(page, RUNNING_ANIMATIONS) == 0
    a = page.screenshot()
    time.sleep(0.3)
    assert a == page.screenshot()


def test_prepare_never_raises_when_playwright_is_stopped() -> None:
    class Impl:
        async def evaluate(self, expression: str, arg: Any) -> Any: ...

    class StoppedPage:
        _impl_obj = Impl()

        def _sync(self, coro: Any) -> Any:
            coro.close()
            raise RuntimeError("Event loop is closed! Is Playwright already stopped?")

    result = sr.prepare_for_capture(StoppedPage(), hide=["#x"], freeze=False)
    assert [s.step for s in result.steps] == ["consent", "hide", "fonts", "lazy", "network", "images", "consent-again", "fonts-again"]
    assert all(not s.ok and "stopped" in (s.error or "") for s in result.steps)
