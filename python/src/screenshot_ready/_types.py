"""Option and result shapes, for type checkers. At runtime these are plain dicts."""

from __future__ import annotations

from typing import List, Literal, Optional, TypedDict


class ConsentOptions(TypedDict, total=False):
    #: More selectors to hide, on top of the built-in list.
    selectors: List[str]
    #: Use only `selectors` instead of adding them to the built-in list.
    replace_built_in: bool
    #: Also find banners by position and text. Default True.
    heuristics: bool
    #: Undo the scroll lock a consent dialog leaves behind. Default True.
    unlock_scroll: bool


class FontsOptions(TypedDict, total=False):
    timeout: float


class LazyOptions(TypedDict, total=False):
    timeout: float
    max_height: float
    step_ratio: float
    step_delay_ms: float


class NetworkOptions(TypedDict, total=False):
    quiet_ms: float
    timeout: float
    max_inflight: int
    relax_after_ms: float


class ImagesOptions(TypedDict, total=False):
    timeout: float
    max_height: float


class FreezeOptions(TypedDict, total=False):
    caret: bool
    pause_media: bool


class HideConsentResult(TypedDict):
    hidden: int
    by_selector: int
    by_heuristic: int
    overlays: int
    scroll_unlocked: bool
    details: List[str]
    timed_out: bool


class WaitForFontsResult(TypedDict):
    timed_out: bool
    loaded: int
    pending: List[str]
    failed: List[str]


class ScrollThroughResult(TypedDict):
    steps: int
    reached_px: float
    page_height: float
    scroller: Literal["window", "element", "none"]
    timed_out: bool


class WaitForImagesResult(TypedDict):
    total: int
    ready: int
    broken: int
    pending: int
    timed_out: bool


class WaitForNetworkQuietResult(TypedDict):
    quiet: bool
    timed_out: bool
    inflight: int
    ms: int
    method: Literal["events", "in-page"]


class LoadLazyContentResult(TypedDict):
    scroll: ScrollThroughResult
    network: Optional[WaitForNetworkQuietResult]
    images: WaitForImagesResult
    timed_out: bool


class FreezeAnimationsResult(TypedDict):
    finished: int
    paused: int
    media: int
    timed_out: bool
