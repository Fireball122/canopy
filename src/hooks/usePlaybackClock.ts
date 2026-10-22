import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * One playback clock for the whole panel.
 *
 * The host reports a SMTC timeline *snapshot*: it is quantised to 0.1 s, sampled at 800 ms, and
 * can even be frozen for minutes (Chromium publishes its position state once and never again).
 * Everything the user can see moving — the scrubber, the elapsed/total readout and the synced
 * lyric highlight — must therefore read a single playhead that is anchored on those snapshots and
 * advanced locally from `performance.now()` deltas in between.
 */

export interface PlaybackClockMedia {
  title?: string | null;
  artist?: string | null;
  is_playing?: boolean | null;
  position_secs?: number | null;
  duration_secs?: number | null;
}

export interface PlaybackClockOptions {
  /**
   * Freeze the clock and ignore host corrections: a user is dragging the scrubber, so the
   * playhead belongs to the pointer until the drag ends.
   */
  hold?: boolean;
  /** Stop sampling (panel closed / hidden tab). Anchoring still happens, just no ticking. */
  enabled?: boolean;
  /** Sampling cadence in ms. Small enough that the readout never visibly steps. */
  tickMs?: number;
}

export interface PlaybackClockValue {
  /** Seconds into the current track: monotonic while playing, frozen while paused. */
  position: number;
  /** Adopt `seconds` immediately — used by drags/seeks and by "jump to this lyric line". */
  seek: (seconds: number) => void;
}

/** Host snapshots further than this from the local estimate are corrections, not jitter. */
export const REANCHOR_THRESHOLD_SECS = 0.75;
/** A backwards host jump this large is a deliberate restart/seek, not SMTC jitter. */
export const BACKWARD_SEEK_SECS = 3;
/** After a user seek the host may still report the pre-seek position for a moment. */
export const SEEK_GRACE_MS = 2500;
/** Mirrors the shell's placeholder duration when the host has no timeline yet. */
export const FALLBACK_DURATION_SECS = 219;
export const DEFAULT_TICK_MS = 100;

/**
 * Framework-free clock core so the anchoring rules can be exercised outside React.
 *
 * Invariants:
 *  - `position` advances at exactly 1 s per second of wall clock while playing (rate scaling
 *    outside 1× is not modelled: SMTC reports `PlaybackRate` and players use it rarely).
 *  - `position` never moves backwards unless the host says so with a real seek or the track changed.
 *  - a paused transport is pinned to the value it was paused at, and follows the host exactly.
 */
export class PlaybackClockCore {
  private readonly now: () => number;
  private anchorSeconds = 0;
  private anchorAtMs: number;
  private emitted = 0;
  private trackKey: string | null = null;
  private playing = false;
  private held = false;
  private coasting = false;
  private duration = FALLBACK_DURATION_SECS;
  private graceUntilMs = 0;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
    this.anchorAtMs = this.now();
  }

  /** Freeze/unfreeze the clock for a pointer drag. */
  setHold(held: boolean): void {
    this.held = held;
  }

  /** Current playhead in seconds, clamped to the track duration and monotonic. */
  sample(): number {
    const projected = this.project();
    if (projected > this.emitted) {
      this.emitted = projected;
    }
    return this.emitted;
  }

  /** Explicit seek (user drag, transport action): the new value wins immediately. */
  seek(seconds: number): number {
    this.coasting = false;
    this.anchor(seconds);
    this.graceUntilMs = this.now() + SEEK_GRACE_MS;
    return this.sample();
  }

  /**
   * Ingest the newest host snapshot. Returns the playhead that should be displayed.
   */
  update(media: PlaybackClockMedia): number {
    const host = Math.max(0, Number(media.position_secs) || 0);
    const duration = Number(media.duration_secs);
    this.duration = Number.isFinite(duration) && duration > 2 ? duration : FALLBACK_DURATION_SECS;

    const key = `${media.title ?? ''}__${media.artist ?? ''}`;
    const trackChanged = this.trackKey !== null && this.trackKey !== key;
    this.trackKey = key;
    const nextPlaying = Boolean(media.is_playing);

    if (trackChanged) {
      // New track: the host owns the playhead outright, forwards or backwards.
      this.playing = nextPlaying;
      this.coasting = false;
      this.graceUntilMs = 0;
      this.anchor(host);
      return this.sample();
    }

    // Play/pause must never move the displayed playhead on its own.
    if (this.playing !== nextPlaying) {
      const projected = this.project();
      this.playing = nextPlaying;
      this.anchor(projected);
    }

    if (this.held) {
      return this.sample();
    }

    const error = host - this.project();

    if (this.coasting) {
      // The local estimate ran slightly ahead; hold still until the host catches up so the
      // readout stays monotonic instead of snapping backwards.
      if (error < 0) return this.sample();
      this.coasting = false;
      this.anchor(host);
      return this.sample();
    }

    if (this.now() < this.graceUntilMs) {
      if (Math.abs(error) <= REANCHOR_THRESHOLD_SECS) {
        this.graceUntilMs = 0; // The host confirmed our seek; back to normal anchoring.
      } else {
        return this.sample(); // Still reporting the pre-seek position.
      }
    }

    if (!this.playing) {
      // Frozen transport: it is authoritative in both directions.
      if (Math.abs(error) > REANCHOR_THRESHOLD_SECS) {
        this.anchor(host);
      }
      return this.sample();
    }

    if (error > REANCHOR_THRESHOLD_SECS) {
      this.anchor(host); // We lagged behind the audio.
    } else if (error < -BACKWARD_SEEK_SECS) {
      this.anchor(host); // Someone seeked/restarted the track outside Canopy.
    } else if (error < -REANCHOR_THRESHOLD_SECS) {
      this.anchor(this.emitted); // Slightly ahead: coast until the host catches up.
      this.coasting = true;
    }
    return this.sample();
  }

  private project(): number {
    if (!this.playing || this.held || this.coasting) {
      return this.anchorSeconds;
    }
    const elapsed = (this.now() - this.anchorAtMs) / 1000;
    return Math.min(this.duration, Math.max(0, this.anchorSeconds + elapsed));
  }

  private anchor(seconds: number): number {
    this.anchorSeconds = Number.isFinite(seconds)
      ? Math.min(this.duration, Math.max(0, seconds))
      : 0;
    this.anchorAtMs = this.now();
    this.emitted = this.anchorSeconds;
    return this.anchorSeconds;
  }
}

/**
 * Single source of truth for "where is the song right now", shared by the dashboard scrubber and
 * the synced-lyric highlight.
 */
export function usePlaybackClock(
  media: PlaybackClockMedia,
  options: PlaybackClockOptions = {},
): PlaybackClockValue {
  const { hold = false, enabled = true, tickMs = DEFAULT_TICK_MS } = options;

  const coreRef = useRef<PlaybackClockCore | null>(null);
  if (coreRef.current === null) {
    coreRef.current = new PlaybackClockCore();
  }
  const core = coreRef.current;

  const [position, setPosition] = useState<number>(() => core.sample());

  // Order matters: the drag wins over the host snapshot that is being ingested right now.
  useEffect(() => {
    core.setHold(hold);
    core.update(media);
    setPosition(core.sample());
  }, [core, hold, media]);

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      setPosition(core.sample());
    }, tickMs);
    return () => window.clearInterval(id);
  }, [core, enabled, tickMs]);

  const seek = useCallback(
    (seconds: number) => {
      core.seek(seconds);
      setPosition(core.sample());
    },
    [core],
  );

  return useMemo(() => ({ position, seek }), [position, seek]);
}

export default usePlaybackClock;
