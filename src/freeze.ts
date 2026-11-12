import { freezeInPage } from './inpage.js';
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
