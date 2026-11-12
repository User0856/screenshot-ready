import { GRACE_MS, inPage, withTimeout, type PageLike } from './page.js';

export interface FreezeAnimationsOptions {
  /** Make the text caret in focused inputs transparent. Default true. */
  caret?: boolean;
  /** Pause playing <video> and <audio> elements on their current frame. Default true. */
  pauseMedia?: boolean;
}

export interface FreezeAnimationsResult {
  /** Finite animations and transitions jumped to their end state. */
  finished: number;
  /** Infinite animations (spinners, pulses) paused at their start. */
  paused: number;
  /** Media elements paused. */
  media: number;
  timedOut: boolean;
}

function freezeInPage(arg: { caret: boolean; pauseMedia: boolean }) {
  const styleId = 'screenshot-ready-freeze-style';
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement('style');
    style.id = styleId;
    (document.head || document.documentElement).appendChild(style);
  }
  // New CSS animations and transitions resolve to their end state at once. A zero duration keeps fill-mode
  // end states (a fade-in that ends at opacity 1 stays visible), which `animation: none` would undo.
  style.textContent = [
    '*, *::before, *::after {',
    '  animation-delay: 0s !important; animation-duration: 0s !important;',
    '  transition-delay: 0s !important; transition-duration: 0s !important;',
    '  scroll-behavior: auto !important;',
    arg.caret ? '  caret-color: transparent !important;' : '',
    '}',
  ].join('\n');

  let finished = 0;
  let paused = 0;
  // getAnimations() flushes styles, so CSS animations already reflect the rule above. This also reaches Web
  // Animations API animations (element.animate) and animations inside shadow roots, which the rule does not.
  const animations = typeof document.getAnimations === 'function' ? document.getAnimations() : [];
  for (const a of animations) {
    try {
      const timing = a.effect ? a.effect.getComputedTiming() : undefined;
      if (timing && Number.isFinite(timing.endTime as number)) {
        if (a.playState !== 'finished') {
          a.finish();
          finished += 1;
        }
      } else {
        a.pause();
        a.currentTime = 0;
        paused += 1;
      }
    } catch {
      // An animation that cannot be finished (zero playback rate, detached effect): leave it.
    }
  }

  let media = 0;
  if (arg.pauseMedia) {
    for (const m of Array.from(document.querySelectorAll('video, audio')) as HTMLMediaElement[]) {
      if (!m.paused) {
        m.pause();
        media += 1;
      }
    }
  }
  return { finished, paused, media, timedOut: false };
}

/**
 * Stops motion so two captures of the same page come out the same: finite CSS animations, transitions and
 * Web Animations jump to their end state, infinite ones pause at the start, the text caret is hidden and
 * playing media is paused. Call it right before the capture.
 */
export async function freezeAnimations(page: PageLike, options: FreezeAnimationsOptions = {}): Promise<FreezeAnimationsResult> {
  const arg = { caret: options.caret ?? true, pauseMedia: options.pauseMedia ?? true };
  const result = await withTimeout(inPage(page, freezeInPage, arg), 2000 + GRACE_MS);
  return result.timedOut ? { finished: 0, paused: 0, media: 0, timedOut: true } : result.value;
}
