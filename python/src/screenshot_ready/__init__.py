"""Get a Playwright page ready for page.screenshot(): wait for web fonts, load lazy images, hide cookie banners,
freeze animations, in one call with a time budget.

This module is the sync API (`playwright.sync_api`). For `playwright.async_api`, import from
`screenshot_ready.async_api`; it has the same functions as coroutines.
"""

from .sync_api import (
    CONSENT_SELECTORS,
    HIDDEN_ATTRIBUTE,
    PrepareResult,
    RequestTracker,
    StepReport,
    freeze_animations,
    hide_consent_banners,
    hide_elements,
    load_lazy_content,
    prepare_for_capture,
    ready_screenshot,
    scroll_through,
    track_requests,
    wait_for_fonts,
    wait_for_images,
    wait_for_network_quiet,
)

__version__ = "0.1.0"

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
