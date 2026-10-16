import {
  Check,
  ChevronDown,
  ChevronUp,
  Disc,
  Globe,
  Headphones,
  Mic2,
  Music,
  Pause,
  Play,
  Radio,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Sliders,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CanopyMascot } from '../components/CanopyMascot';
import { RadialGauge } from '../components/RadialGauge';
import { useSettings } from '../context/SettingsContext';
import { useAlbumArt } from '../hooks/useAlbumArt';
import { usePanelOpen } from '../hooks/usePanelOpen';
import { usePlaybackClock } from '../hooks/usePlaybackClock';
import {
  type AudioSessionEntry,
  getAudioSessions,
  getAudioSpectrum,
  getMediaSessions,
  type MediaInfo,
  type MediaSessionItem,
  mediaCycleRepeat,
  mediaToggleShuffle,
  selectMediaSession,
  setAudioSessionMute,
  setAudioSessionVolume,
} from '../services/hostBridge';

export interface MediaViewProps {
  media: MediaInfo;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek?: (seconds: number) => void;
  onSelectSession?: (sessionId: string) => void;
}

interface LyricLine {
  time: number;
  text: string;
}

const DEFAULT_FALLBACK_SESSIONS: MediaSessionItem[] = [
  {
    id: 'Spotify.exe',
    app_name: 'Spotify',
    title: 'Bad Apple!!',
    artist: 'Alstroemeria Records',
    is_playing: true,
    is_current: true,
  },
  {
    id: 'Feishin.exe',
    app_name: 'Feishin',
    title: 'Night of Nights',
    artist: 'COOL&CREATE • BeatMARIO',
    is_playing: false,
    is_current: false,
  },
  {
    id: 'chrome.exe',
    app_name: 'Chrome',
    title: 'Lofi Hip Hop Radio',
    artist: 'ChilledCow • YouTube Music',
    is_playing: false,
    is_current: false,
  },
];

const BUILTIN_SYNCED_LYRICS: Record<string, LyricLine[]> = {
  'bad apple': [
    { time: 0, text: '♪ Instrumental Intro — Bad Apple!! ♪' },
    { time: 14, text: 'Ever on and on, I continue circling' },
    { time: 21, text: 'With nothing but my hate in a carousel of agony' },
    { time: 28, text: 'Till slowly I forget and my heart starts vanishing' },
    { time: 35, text: 'And suddenly I see that I cannot break free — I’m' },
    { time: 42, text: 'Slipping through the cracks of a dark eternity' },
    { time: 49, text: 'With nothing but my pain and the paralyzing agony' },
    { time: 56, text: 'To tell me who I am! Who I was!' },
    { time: 63, text: 'Uncertainty enveloping my mind' },
    { time: 70, text: 'Till I cannot break free, and Maybe it’s a dream' },
    { time: 78, text: 'Maybe nothing else is real' },
    { time: 86, text: 'But it wouldn’t mean a thing if I told you how I feel' },
    { time: 94, text: 'So I’m tired of all the pain, all the misery inside' },
    { time: 102, text: 'And I wish that I could live feeling nothing but the night' },
    { time: 112, text: 'You can tell me what to say, you can tell me where to go' },
    { time: 120, text: 'But I doubt that I would care, and my heart would never know' },
    { time: 130, text: 'If I make another move there’ll be no more turning back' },
    { time: 140, text: 'Everything will change and it all will fade to black' },
    { time: 152, text: 'Will tomorrow ever come? Will I make it through the night?' },
    { time: 164, text: 'Will there ever be a place for the broken in the light?' },
    { time: 178, text: 'Am I hurting? Am I sad? Should I stay or should I go?' },
    { time: 192, text: 'I’ve forgotten how to tell — did I ever even know?' },
  ],
  'night of nights': [
    { time: 0, text: '♪ Flowering Night — High-BPM Touhou Arrange ♪' },
    { time: 8, text: 'Silver blades of time flash across the scarlet hall' },
    { time: 18, text: 'Ticking clockwork freezes under lunar waterfall' },
    { time: 29, text: 'Step into the rhythm of the everlasting night' },
    { time: 40, text: 'Chasing phantom shadows in a storm of danmaku light' },
    { time: 54, text: 'Every second fractures into sixteen-bit sparks' },
    { time: 68, text: 'Accelerating heartbeats through the velvet dark' },
    { time: 84, text: 'Stop the dial — spin the fate — let the melody ignite' },
    { time: 102, text: 'Dancing on the edge of the Night of Nights!' },
    { time: 124, text: '♪ Solo — Synth & Piano Overdrive ♪' },
    { time: 150, text: 'Endless crescendo echoing across Gensokyo' },
    { time: 178, text: 'Until the final chime releases the dawn' },
  ],
  lofi: [
    { time: 0, text: '♪ Warm vinyl crackle & rainy window ambiance ♪' },
    { time: 12, text: 'Late night study session under soft amber light' },
    { time: 28, text: 'Mellow Rhodes chords drifting through the quiet street' },
    { time: 46, text: 'Coffee steam rising while the city sleeps outside' },
    { time: 64, text: 'Dusty boom-bap snare keeping time with the rain' },
    { time: 85, text: 'Take a breath — let the static wash the day away' },
    { time: 108, text: 'Lo-fi tape flutter looping into midnight calm' },
    { time: 136, text: 'Turning another page as the bassline hums along' },
    { time: 168, text: '♪ Chillhop instrumental groove continues ♪' },
  ],
  'midnight city': [
    { time: 0, text: '♪ Iconic synth riff — Midnight City ♪' },
    { time: 18, text: 'Waiting in a car' },
    { time: 26, text: 'Waiting for a ride in the dark' },
    { time: 36, text: 'The night city grows' },
    { time: 45, text: 'Look and see her eyes, they glow' },
    { time: 58, text: 'Waiting in a car' },
    { time: 68, text: 'Waiting for a ride in the dark' },
    { time: 78, text: 'Drinking in the lounge' },
    { time: 88, text: 'Following the neon signs' },
    { time: 98, text: 'Waiting for a roar' },
    { time: 108, text: 'Looking at the mutating skyline' },
    { time: 120, text: 'The city is my church' },
    { time: 132, text: 'It wraps me in its blinding twilight' },
    { time: 148, text: 'Waiting in a car' },
    { time: 162, text: 'Waiting for the right time' },
    { time: 182, text: '♪ Euphoric saxophone solo ♪' },
  ],
  resonance: [
    { time: 0, text: '♪ Analog synth arpeggio — HOME: Resonance ♪' },
    { time: 16, text: 'Horizon glowing in VHS magenta and cyan' },
    { time: 36, text: 'Warm tape saturation drifting across the coast' },
    { time: 56, text: 'Nostalgic echoes of a summer that never existed' },
    { time: 78, text: 'Slow gated reverb drums lock into the night drive' },
    { time: 104, text: 'Reflections shimmering on empty midnight highways' },
    { time: 134, text: 'Suspended in synthwave weightlessness' },
    { time: 168, text: 'Fading into the analog twilight glow' },
  ],
  'after dark': [
    { time: 0, text: '♪ Darkwave synth pulse — After Dark ♪' },
    { time: 18, text: 'I see you, you see me' },
    { time: 28, text: 'How pleasant, this feeling' },
    { time: 38, text: 'The moment you hold me' },
    { time: 48, text: 'I missed you, I’m sorry' },
    { time: 60, text: 'I’ve given what I have' },
    { time: 72, text: 'I showed you I’m growing' },
    { time: 84, text: 'The ashes fall slowly' },
    { time: 96, text: 'As your voice consoles me' },
    { time: 110, text: 'As the hours pass, I will let you know' },
    { time: 124, text: 'That I need to ask before I’m alone' },
    { time: 138, text: 'How it feels to rest on your patient lips' },
    { time: 152, text: 'To eternal bliss, I’m so glad to know' },
  ],
};

function formatMediaTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function renderSessionIcon(appName?: string): React.ReactNode {
  const lower = (appName || '').toLowerCase();
  if (lower.includes('spotify')) {
    return <Radio className="w-3.5 h-3.5 text-[#a6e3a1]" strokeWidth={2} />;
  }
  if (lower.includes('feishin') || lower.includes('foobar') || lower.includes('musicbee')) {
    return <Headphones className="w-3.5 h-3.5 text-[#cba6f7]" strokeWidth={2} />;
  }
  if (
    lower.includes('chrome') ||
    lower.includes('edge') ||
    lower.includes('firefox') ||
    lower.includes('brave')
  ) {
    return <Globe className="w-3.5 h-3.5 text-[#89dceb]" strokeWidth={2} />;
  }
  return <Music className="w-3.5 h-3.5 text-[#cba6f7]" strokeWidth={2} />;
}

function resolveBuiltinLyrics(title: string, artist: string): LyricLine[] {
  const haystack = `${title} ${artist}`.toLowerCase();
  for (const [key, lines] of Object.entries(BUILTIN_SYNCED_LYRICS)) {
    if (haystack.includes(key)) {
      return lines;
    }
  }
  return [];
}

function cleanTrackMetadata(
  rawTitle: string,
  rawArtist: string,
): { cleanTitle: string; cleanArtist: string } {
  let cleanTitle = rawTitle
    .replace(
      /\s*[([【](?:official\s*(?:music\s*)?(?:video|audio|lyric\s*video|lyrics|visualizer|mv)|lyric\s*video|lyrics?|audio|video|visualizer|mv|hd|hq|4k|remastered[^)\]]*|live[^)\]]*|feat\.?[^)\]]*|ft\.?[^)\]]*)[)\]】]/gi,
      '',
    )
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.+$/i, '')
    .replace(/\s*[-|]\s*(?:youtube(?:\s+music)?|spotify|soundcloud).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  let cleanArtist = rawArtist
    .replace(/\s*-\s*topic$/i, '')
    .replace(/\s*[([](?:feat\.?|ft\.?)[^)\]]*[)\]]/gi, '')
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.+$/i, '')
    .split('•')[0]
    .replace(/\s+/g, ' ')
    .trim();

  if (
    cleanArtist.toLowerCase() === 'windows smtc audio' ||
    cleanArtist.toLowerCase() === 'unknown artist' ||
    cleanArtist.toLowerCase() === 'no media playing'
  ) {
    cleanArtist = '';
  }

  if (cleanTitle.includes(' - ')) {
    const parts = cleanTitle
      .split(' - ')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2 && (!cleanArtist || cleanArtist.toLowerCase().includes('youtube'))) {
      cleanArtist = parts[0];
      cleanTitle = parts.slice(1).join(' - ');
    }
  }

  return {
    cleanTitle: cleanTitle || rawTitle.trim(),
    cleanArtist: cleanArtist || rawArtist.trim(),
  };
}

function parseLrcLyrics(
  syncedLrc?: string | null,
  plainText?: string | null,
  durationSecs = 210,
): LyricLine[] {
  if (syncedLrc && syncedLrc.trim().length > 0) {
    const parsed: LyricLine[] = [];
    const lineRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/;
    for (const rawLine of syncedLrc.split(/\r?\n/)) {
      const match = rawLine.match(lineRegex);
      if (!match) continue;
      const mins = Number(match[1]);
      const secs = Number(match[2]);
      const frac = match[3] ? Number(match[3].padEnd(3, '0')) / 1000 : 0;
      const text = match[4].trim();
      if (text.length > 0) {
        parsed.push({
          time: mins * 60 + secs + frac,
          text,
        });
      }
    }
    if (parsed.length > 0) {
      return parsed.sort((a, b) => a.time - b.time);
    }
  }

  if (plainText && plainText.trim().length > 0) {
    const cleanLines = plainText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (cleanLines.length > 0) {
      const span = Math.max(60, durationSecs || 210) * 0.88;
      return cleanLines.map((text, idx) => ({
        time: Math.floor((idx / Math.max(1, cleanLines.length)) * span),
        text,
      }));
    }
  }

  return [];
}

export const MediaView: React.FC<MediaViewProps> = ({
  media,
  onPlayPause,
  onPrev,
  onNext,
  onSeek,
  onSelectSession,
}) => {
  const { settings } = useSettings();
  const isPlaying = Boolean(media.is_playing);
  // Whether the Canopy panel is currently expanded: no point polling the host while closed.
  const panelOpen = usePanelOpen();
  // Guards against queueing spectrum polls when the host is slower than the 40 ms cadence.
  const spectrumInFlightRef = useRef<boolean>(false);

  // The dashboard already runs the shared playhead and hands it to us through `media.position_secs`;
  // re-anchoring here keeps this view correct even if it is ever mounted on its own.
  const [isDraggingScrubber, setIsDraggingScrubber] = useState<boolean>(false);
  const playbackClock = usePlaybackClock(media, { enabled: panelOpen, hold: isDraggingScrubber });

  // Continuous rhythmic harmonic tick (dances whenever music is playing)
  const [visualizerTick, setVisualizerTick] = useState<number>(0);
  // Live 40-band WASAPI Loopback FFT spectrum amplitudes in [0.0, 1.0]
  const [spectrumBands, setSpectrumBands] = useState<number[]>(() => new Array(40).fill(0));
  const resolvedArtwork = useAlbumArt(media.title, media.artist, media.artwork_url);
  // Interactive Lyrics Toggle & Synced Lyrics state
  const [showLyrics, setShowLyrics] = useState<boolean>(false);
  const [lyricsLines, setLyricsLines] = useState<LyricLine[]>([]);
  const [lyricsSourceLabel, setLyricsSourceLabel] = useState<string>('Synced Lyrics');
  const [inferredDuration, setInferredDuration] = useState<number>(0);
  const [isShuffle, setIsShuffle] = useState<boolean>(Boolean(media.is_shuffle));
  const [repeatMode, setRepeatMode] = useState<number>(media.auto_repeat ?? 0);

  useEffect(() => {
    if (typeof media.is_shuffle === 'boolean') {
      setIsShuffle(media.is_shuffle);
    }
    if (typeof media.auto_repeat === 'number') {
      setRepeatMode(media.auto_repeat);
    }
  }, [media.is_shuffle, media.auto_repeat]);

  const handleToggleShuffle = async () => {
    const next = !isShuffle;
    setIsShuffle(next);
    await mediaToggleShuffle();
  };

  const handleCycleRepeat = async () => {
    const next = (repeatMode + 1) % 3;
    setRepeatMode(next);
    await mediaCycleRepeat();
  };
  const lyricsCacheRef = useRef<
    Record<string, { lines: LyricLine[]; label: string; duration?: number }>
  >({});
  const lyricsScrollRef = useRef<HTMLDivElement | null>(null);
  const activeLyricItemRef = useRef<HTMLButtonElement | null>(null);

  // Active SMTC session switcher popover state
  const [sessionMenuOpen, setSessionMenuOpen] = useState<boolean>(false);
  const [fetchedSessions, setFetchedSessions] = useState<MediaSessionItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const sessionPopoverRef = useRef<HTMLDivElement | null>(null);

  // Per-application volume mixer state (polled only while the mixer panel is visible)
  const [showMixer, setShowMixer] = useState<boolean>(false);
  const [mixerSessions, setMixerSessions] = useState<AudioSessionEntry[]>([]);
  const [mixerLoading, setMixerLoading] = useState<boolean>(false);
  const mixerInFlightRef = useRef<boolean>(false);

  // Poll the real 40-band WASAPI Loopback FFT spectrum only while music is playing AND the
  // panel is expanded. A poll is skipped while the previous one is still in flight, so the
  // host is never queued with more than one outstanding get_audio_spectrum request.
  useEffect(() => {
    if (!panelOpen) {
      setSpectrumBands(new Array(40).fill(0));
      return;
    }
    let active = true;
    const pollSpectrum = async () => {
      if (spectrumInFlightRef.current) return;
      spectrumInFlightRef.current = true;
      try {
        const bands = await getAudioSpectrum();
        if (active && Array.isArray(bands) && bands.length > 0) {
          setSpectrumBands(bands);
        }
      } catch {
        // Ignore transient spectrum read errors
      } finally {
        spectrumInFlightRef.current = false;
      }
    };
    void pollSpectrum();
    const timer = window.setInterval(pollSpectrum, 40);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [panelOpen]);

  // Harmonic wave ticker for the synthetic fallback shapes: ticks while the panel is visible
  useEffect(() => {
    if (!panelOpen) return;
    const timer = window.setInterval(() => {
      setVisualizerTick((prev) => (prev + 1) % 360);
    }, 45);
    return () => window.clearInterval(timer);
  }, [panelOpen]);

  // Per-app mixer: poll host sessions only while the mixer panel is visible and the panel is
  // open. Skips a tick while the previous request is still in flight (no queueing).
  useEffect(() => {
    if (!showMixer || !panelOpen) return;
    let active = true;
    const pollSessions = async () => {
      if (mixerInFlightRef.current) return;
      mixerInFlightRef.current = true;
      try {
        const list = await getAudioSessions();
        if (active) {
          setMixerSessions(Array.isArray(list) ? list : []);
          setMixerLoading(false);
        }
      } catch {
        if (active) setMixerLoading(false);
      } finally {
        mixerInFlightRef.current = false;
      }
    };
    setMixerLoading(true);
    void pollSessions();
    const timer = window.setInterval(pollSessions, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [showMixer, panelOpen]);

  const handleMixerVolume = (id: string, level: number) => {
    setMixerSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, volume: level, muted: false } : s)),
    );
    void setAudioSessionVolume(id, level).catch(() => {});
  };

  const handleMixerMute = (id: string, muted: boolean) => {
    setMixerSessions((prev) => prev.map((s) => (s.id === id ? { ...s, muted } : s)));
    void setAudioSessionMute(id, muted).catch(() => {});
  };
  // Load available SMTC sessions when popover opens or media updates
  useEffect(() => {
    let mounted = true;
    getMediaSessions()
      .then((list) => {
        if (mounted && Array.isArray(list) && list.length > 0) {
          setFetchedSessions(list);
        }
      })
      .catch(() => {
        // Fallback sessions used automatically
      });
    return () => {
      mounted = false;
    };
  }, [media.source_app, sessionMenuOpen]);

  // Close session popover when clicking outside
  useEffect(() => {
    if (!sessionMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (sessionPopoverRef.current && !sessionPopoverRef.current.contains(e.target as Node)) {
        setSessionMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [sessionMenuOpen]);

  const sessions: MediaSessionItem[] = useMemo(() => {
    const base =
      media.sessions && media.sessions.length > 0
        ? media.sessions
        : fetchedSessions.length > 0
          ? fetchedSessions
          : DEFAULT_FALLBACK_SESSIONS;

    if (!selectedSessionId) return base;
    return base.map((item) => ({
      ...item,
      is_current: item.id === selectedSessionId,
    }));
  }, [media.sessions, fetchedSessions, selectedSessionId]);

  const currentSession = useMemo(() => {
    const base = sessions && sessions.length > 0 ? sessions : DEFAULT_FALLBACK_SESSIONS;
    const active = base.find((s) => s && s.is_current);
    if (active) return active;
    if (media.source_app) {
      const src = (media.source_app || '').toLowerCase();
      const matched = base.find(
        (s) => (s.app_name || '').toLowerCase() === src || (s.id || '').toLowerCase() === src,
      );
      if (matched) return matched;
    }
    return base[0] || DEFAULT_FALLBACK_SESSIONS[0];
  }, [sessions, media.source_app]);
  const smtcDuration = Number(media.duration_secs) || 0;
  const effectiveDuration =
    smtcDuration > 2.0 ? smtcDuration : inferredDuration > 2.0 ? inferredDuration : 219;
  const clampedPosition = Math.min(effectiveDuration, Math.max(0, playbackClock.position));
  const progressPercent = Math.min(100, Math.max(0, (clampedPosition / effectiveDuration) * 100));

  const trackTitle = media.title?.trim() || 'No Media Playing';
  const trackArtist = media.artist?.trim() || 'Windows SMTC Audio';
  const trackAlbum = media.album?.trim() || '';

  const handleUserSeek = (targetSec: number) => {
    const clamped = Math.max(0, Math.min(effectiveDuration, targetSec));
    playbackClock.seek(clamped);
    onSeek?.(clamped);
  };
  // Automatically populate built-in time-synced lyrics and fetch live lyrics from LRCLIB
  useEffect(() => {
    const rawTitle = media.title?.trim() || '';
    const rawArtist = media.artist?.trim() || '';

    if (!rawTitle || rawTitle === 'No Media Playing') {
      setLyricsLines([]);
      setLyricsSourceLabel('No Lyrics');
      return;
    }

    const cacheKey = `${rawTitle.toLowerCase()}__${rawArtist.toLowerCase()}`;
    const cached = lyricsCacheRef.current[cacheKey];
    if (cached) {
      setLyricsLines(cached.lines);
      setLyricsSourceLabel(cached.label);
      return;
    }

    const builtinLines = resolveBuiltinLyrics(rawTitle, rawArtist);
    if (builtinLines.length > 0) {
      setLyricsLines(builtinLines);
      setLyricsSourceLabel('Synced Lyrics');
    } else {
      setLyricsLines([]);
      setLyricsSourceLabel('Searching LRCLIB...');
    }

    const controller = new AbortController();
    const { cleanTitle, cleanArtist } = cleanTrackMetadata(rawTitle, rawArtist);

    interface LrclibTrackResponse {
      syncedLyrics?: string | null;
      plainLyrics?: string | null;
      duration?: number;
    }

    const extractValidLyrics = (
      item: LrclibTrackResponse | null | undefined,
    ): { lines: LyricLine[]; label: string; duration?: number } | null => {
      if (!item) return null;
      const parsed = parseLrcLyrics(item.syncedLyrics, item.plainLyrics, effectiveDuration);
      if (parsed.length > 0) {
        const dur =
          typeof item.duration === 'number' && item.duration > 10
            ? item.duration
            : parsed[parsed.length - 1].time + 14;
        setInferredDuration(dur);
        return {
          lines: parsed,
          label: item.syncedLyrics ? 'LRCLIB Synced' : 'LRCLIB Lyrics',
          duration: dur,
        };
      }
      return null;
    };

    const fetchFromLrclib = async () => {
      try {
        // 1. Primary query: /api/get?artist_name={artist}&track_name={title}
        const getUrl = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(
          rawArtist,
        )}&track_name=${encodeURIComponent(rawTitle)}`;
        const getRes = await fetch(getUrl, { signal: controller.signal });
        if (getRes.ok) {
          const getData = (await getRes.json()) as LrclibTrackResponse;
          const found = extractValidLyrics(getData);
          if (found) {
            lyricsCacheRef.current[cacheKey] = found;
            setLyricsLines(found.lines);
            setLyricsSourceLabel(found.label);
            return;
          }
        }

        // 2. If cleaned metadata differs, try /api/get with cleaned artist & title
        if (cleanTitle !== rawTitle || cleanArtist !== rawArtist) {
          const cleanGetUrl = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(
            cleanArtist,
          )}&track_name=${encodeURIComponent(cleanTitle)}`;
          const cleanGetRes = await fetch(cleanGetUrl, { signal: controller.signal });
          if (cleanGetRes.ok) {
            const cleanGetData = (await cleanGetRes.json()) as LrclibTrackResponse;
            const found = extractValidLyrics(cleanGetData);
            if (found) {
              lyricsCacheRef.current[cacheKey] = found;
              setLyricsLines(found.lines);
              setLyricsSourceLabel(found.label);
              return;
            }
          }
        }

        // 3. Fallback search: /api/search?track_name={cleanTitle}&artist_name={cleanArtist}
        const searchByFieldsUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(
          cleanTitle,
        )}&artist_name=${encodeURIComponent(cleanArtist)}`;
        const searchRes = await fetch(searchByFieldsUrl, { signal: controller.signal });
        if (searchRes.ok) {
          const list = (await searchRes.json()) as LrclibTrackResponse[];
          if (Array.isArray(list)) {
            const syncedMatch = list.find((item) => item?.syncedLyrics?.trim());
            const firstMatch = syncedMatch || list.find((item) => item?.plainLyrics?.trim());
            const found = extractValidLyrics(firstMatch);
            if (found) {
              lyricsCacheRef.current[cacheKey] = found;
              setLyricsLines(found.lines);
              setLyricsSourceLabel(found.label);
              return;
            }
          }
        }

        // 4. Broad fallback search: /api/search?q={cleanArtist} {cleanTitle}
        const queryText = `${cleanArtist} ${cleanTitle}`.trim();
        if (queryText) {
          const searchByQueryUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(
            queryText,
          )}`;
          const queryRes = await fetch(searchByQueryUrl, { signal: controller.signal });
          if (queryRes.ok) {
            const list = (await queryRes.json()) as LrclibTrackResponse[];
            if (Array.isArray(list)) {
              const syncedMatch = list.find((item) => item?.syncedLyrics?.trim());
              const firstMatch = syncedMatch || list.find((item) => item?.plainLyrics?.trim());
              const found = extractValidLyrics(firstMatch);
              if (found) {
                lyricsCacheRef.current[cacheKey] = found;
                setLyricsLines(found.lines);
                setLyricsSourceLabel(found.label);
                return;
              }
            }
          }
        }

        // 5. No LRCLIB match found: keep builtinLines if present, otherwise []
        if (builtinLines.length > 0) {
          const fallbackEntry = { lines: builtinLines, label: 'Synced Lyrics' };
          lyricsCacheRef.current[cacheKey] = fallbackEntry;
          setLyricsLines(builtinLines);
          setLyricsSourceLabel('Synced Lyrics');
        } else {
          const emptyEntry = { lines: [], label: 'No Lyrics' };
          lyricsCacheRef.current[cacheKey] = emptyEntry;
          setLyricsLines([]);
          setLyricsSourceLabel('No Lyrics');
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        if (builtinLines.length > 0) {
          setLyricsLines(builtinLines);
          setLyricsSourceLabel('Synced Lyrics');
        } else {
          setLyricsLines([]);
          setLyricsSourceLabel('No Lyrics');
        }
      }
    };

    void fetchFromLrclib();

    return () => controller.abort();
  }, [media.title, media.artist, effectiveDuration]);

  // Lyric highlight is a pure function of (clock position, user offset): a positive offset makes a
  // line light up later, compensating for whatever lag the source's timestamps carry.
  const lyricPosition = clampedPosition - (settings.lyricOffsetMs ?? 0) / 1000;
  const activeLyricIndex = useMemo(() => {
    if (lyricsLines.length === 0) return 0;
    let idx = 0;
    for (let i = 0; i < lyricsLines.length; i++) {
      if (lyricPosition >= lyricsLines[i].time) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  }, [lyricsLines, lyricPosition]);

  // Lyric motion gate: settings, panel visibility and transport state all have to agree before
  // anything animates.
  const lyricMotionEnabled = Boolean(settings.animationsEnabled) && panelOpen && isPlaying;

  // Smoothly center the active lyric line in the scrollable stage. Keyed on the active index only,
  // so the column never animates on every clock tick.
  useEffect(() => {
    if (!showLyrics || !panelOpen) return;
    const container = lyricsScrollRef.current;
    const item = activeLyricItemRef.current;
    if (!container || !item) return;
    const targetTop =
      item.offsetTop - container.offsetTop - container.clientHeight / 2 + item.clientHeight / 2;
    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: lyricMotionEnabled ? 'smooth' : 'auto',
    });
  }, [activeLyricIndex, showLyrics, panelOpen, lyricMotionEnabled]);

  return (
    <div
      data-tauri-drag-region="false"
      className="w-full h-full bento-card p-4 flex items-center justify-between gap-4 relative overflow-visible pointer-events-auto select-none"
      style={{
        background: 'var(--theme-card, rgba(255, 255, 255, 0.04))',
        borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
      }}
    >
      {/* Subtle Ambient Accent Glow */}
      <div
        className="absolute -left-10 -bottom-10 w-44 h-44 rounded-full blur-3xl pointer-events-none opacity-20"
        style={{ background: 'var(--theme-accent, #cba6f7)' }}
      />
      <div
        className="absolute -right-10 -top-10 w-44 h-44 rounded-full blur-3xl pointer-events-none opacity-15"
        style={{ background: 'var(--theme-accent, #cba6f7)' }}
      />

      {/* ========================================================================= */}
      {/* COLUMN 1 (Left w-[210px]): Circular Vinyl + 40-Spoke Radial Visualizer    */}
      {/* ========================================================================= */}
      <div className="w-[210px] shrink-0 h-full flex flex-col items-center justify-center relative">
        <div className="relative w-[190px] h-[190px] flex items-center justify-center">
          {/* 40-Spoke Radial Visualizer: the live WASAPI loopback FFT bands drive the gauge */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <RadialGauge
              bands={spectrumBands}
              active={isPlaying || spectrumBands.some((b) => b > 0.02)}
              size={190}
              accentColor="var(--theme-accent, #cba6f7)"
              secondaryColor="#89dceb"
            />
          </div>

          {/* Circular Rotating Album Thumbnail / Stylized Vinyl Disc at Center */}
          <div
            data-tauri-drag-region="false"
            onClick={onPlayPause}
            className={`relative w-[114px] h-[114px] rounded-full overflow-hidden flex items-center justify-center border-2 shadow-[0_8px_28px_rgba(0,0,0,0.45)] pointer-events-auto cursor-pointer ${
              isPlaying ? 'animate-vinyl-spin' : ''
            }`}
            style={{
              borderColor: 'var(--theme-accent, #cba6f7)',
              background: 'linear-gradient(135deg, #181825 0%, #313244 50%, #11111b 100%)',
            }}
            title={isPlaying ? 'Click to pause' : 'Click to play'}
          >
            {resolvedArtwork ? (
              <>
                <img
                  src={resolvedArtwork}
                  alt={trackTitle}
                  className="w-full h-full object-cover"
                />
                <div className="absolute w-5 h-5 rounded-full bg-[#11111b]/90 border border-white/25 shadow-inner flex items-center justify-center">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: 'var(--theme-accent, #cba6f7)' }}
                  />
                </div>
              </>
            ) : (
              <>
                {/* Stylized Vinyl Record Grooves */}
                <div className="absolute inset-2.5 rounded-full border border-white/[0.08]" />
                <div className="absolute inset-5 rounded-full border border-white/[0.07]" />
                <div className="absolute inset-8 rounded-full border border-white/[0.06]" />
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center shadow-inner"
                  style={{
                    background:
                      'linear-gradient(135deg, var(--theme-accent, #cba6f7) 0%, #89dceb 100%)',
                  }}
                >
                  <Disc className="w-5 h-5 text-[#11111b]" strokeWidth={2.2} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* COLUMN 2 (Center flex-1): Header + [ Lyrics ] Toggle | Controls / Lyrics  */}
      {/* ========================================================================= */}
      <div className="flex-1 min-w-0 h-full flex flex-col justify-between py-1 px-2 relative overflow-hidden">
        {/* Center Header: Track Metadata + [ Lyrics ] Toggle Pill */}
        <div className="w-full flex items-start justify-between gap-2 z-20">
          <div className="min-w-0 flex-1 text-left pl-1">
            <h2
              className="text-base font-bold tracking-tight truncate"
              style={{ color: 'var(--theme-text-primary, #cdd6f4)' }}
              title={trackTitle}
            >
              {trackTitle}
            </h2>
            <p
              className="text-xs font-medium truncate"
              style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.75))' }}
              title={trackAlbum ? `${trackArtist} — ${trackAlbum}` : trackArtist}
            >
              {trackArtist}
              {trackAlbum ? ` • ${trackAlbum}` : ''}
            </p>
          </div>

          <div className="shrink-0 flex items-center gap-1.5">
            <button
              type="button"
              data-tauri-drag-region="false"
              onClick={() => {
                setSessionMenuOpen(false);
                setShowMixer(false);
                setShowLyrics((prev) => !prev);
              }}
              aria-pressed={showLyrics}
              className="shrink-0 px-3 py-1 rounded-full border text-[11px] font-semibold flex items-center gap-1.5 transition-all duration-200 hover:scale-105 active:scale-95 pointer-events-auto cursor-pointer"
              style={
                showLyrics
                  ? {
                      background: 'var(--theme-accent, #cba6f7)',
                      borderColor: 'var(--theme-accent, #cba6f7)',
                      color: '#11111b',
                      boxShadow: '0 0 16px rgba(203, 166, 247, 0.38)',
                    }
                  : {
                      background: 'var(--theme-track, rgba(255, 255, 255, 0.06))',
                      borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.12))',
                      color: 'var(--theme-text-primary, #cdd6f4)',
                    }
              }
              title={showLyrics ? 'Return to transport controls' : 'Show time-synced lyrics'}
            >
              <Mic2 className="w-3.5 h-3.5" strokeWidth={2.1} />
              <span>Lyrics</span>
            </button>

            <button
              type="button"
              data-tauri-drag-region="false"
              onClick={() => {
                setSessionMenuOpen(false);
                setShowLyrics(false);
                setShowMixer((prev) => !prev);
              }}
              aria-pressed={showMixer}
              className="shrink-0 px-3 py-1 rounded-full border text-[11px] font-semibold flex items-center gap-1.5 transition-all duration-200 hover:scale-105 active:scale-95 pointer-events-auto cursor-pointer"
              style={
                showMixer
                  ? {
                      background: 'var(--theme-accent, #cba6f7)',
                      borderColor: 'var(--theme-accent, #cba6f7)',
                      color: '#11111b',
                      boxShadow: '0 0 16px rgba(203, 166, 247, 0.38)',
                    }
                  : {
                      background: 'var(--theme-track, rgba(255, 255, 255, 0.06))',
                      borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.12))',
                      color: 'var(--theme-text-primary, #cdd6f4)',
                    }
              }
              title={showMixer ? 'Close volume mixer' : 'Open per-app volume mixer'}
            >
              <Sliders className="w-3.5 h-3.5" strokeWidth={2.1} />
              <span>Mixer</span>
            </button>
          </div>
        </div>

        {/* Animated Dual Stage: Transport Controls <-> Time-Synced Lyrics */}
        <div className="relative flex-1 w-full min-h-0 flex items-center justify-center mt-1">
          {/* STAGE A: Transport Controls, Scrub Bar & Session Switcher */}
          <div
            className={`w-full h-full flex flex-col items-center justify-center gap-3 transition-all duration-300 ease-out ${
              showLyrics || showMixer
                ? 'opacity-0 translate-y-2 pointer-events-none hidden'
                : 'opacity-100 translate-y-0 pointer-events-auto relative z-10'
            }`}
          >
            {/* Large Transport Buttons: Previous (|<), Circular Play/Pause (( > )), Next (>|) */}
            {/* Transport Row: Shuffle, Previous, Play/Pause, Next, Repeat */}
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                data-tauri-drag-region="false"
                onClick={handleToggleShuffle}
                className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all hover:scale-105 active:scale-95 pointer-events-auto cursor-pointer ${
                  isShuffle ? 'shadow-sm' : 'opacity-50 hover:opacity-80'
                }`}
                style={{
                  background: isShuffle ? 'var(--theme-track)' : 'transparent',
                  borderColor: isShuffle ? 'var(--theme-accent)' : 'var(--theme-border)',
                  color: isShuffle ? 'var(--theme-accent)' : 'var(--theme-text-secondary)',
                }}
                title={isShuffle ? 'Shuffle is On' : 'Shuffle is Off'}
              >
                <Shuffle className="w-3.5 h-3.5" strokeWidth={2} />
              </button>

              <button
                type="button"
                data-tauri-drag-region="false"
                onClick={onPrev}
                className="w-10 h-10 rounded-full flex items-center justify-center border transition-all hover:scale-105 active:scale-95 pointer-events-auto cursor-pointer"
                style={{
                  background: 'var(--theme-track, rgba(255, 255, 255, 0.06))',
                  borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.1))',
                  color: 'var(--theme-text-primary, #cdd6f4)',
                }}
                title="Previous Track"
              >
                <SkipBack className="w-4 h-4 fill-current" strokeWidth={2} />
              </button>

              <button
                type="button"
                data-tauri-drag-region="false"
                onClick={onPlayPause}
                className="w-13 h-13 p-3.5 rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-105 hover:brightness-110 active:scale-95 pointer-events-auto cursor-pointer"
                style={{
                  background: 'var(--theme-accent, #cba6f7)',
                  color: '#11111b',
                  boxShadow: '0 0 22px rgba(203, 166, 247, 0.42)',
                }}
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5 fill-current" strokeWidth={2.4} />
                ) : (
                  <Play className="w-5 h-5 fill-current ml-0.5" strokeWidth={2.4} />
                )}
              </button>

              <button
                type="button"
                data-tauri-drag-region="false"
                onClick={onNext}
                className="w-10 h-10 rounded-full flex items-center justify-center border transition-all hover:scale-105 active:scale-95 pointer-events-auto cursor-pointer"
                style={{
                  background: 'var(--theme-track, rgba(255, 255, 255, 0.06))',
                  borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.1))',
                  color: 'var(--theme-text-primary, #cdd6f4)',
                }}
                title="Next Track"
              >
                <SkipForward className="w-4 h-4 fill-current" strokeWidth={2} />
              </button>

              <button
                type="button"
                data-tauri-drag-region="false"
                onClick={handleCycleRepeat}
                className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all hover:scale-105 active:scale-95 pointer-events-auto cursor-pointer relative ${
                  repeatMode > 0 ? 'shadow-sm' : 'opacity-50 hover:opacity-80'
                }`}
                style={{
                  background: repeatMode > 0 ? 'var(--theme-track)' : 'transparent',
                  borderColor: repeatMode > 0 ? 'var(--theme-accent)' : 'var(--theme-border)',
                  color: repeatMode > 0 ? 'var(--theme-accent)' : 'var(--theme-text-secondary)',
                }}
                title={
                  repeatMode === 2
                    ? 'Repeat All'
                    : repeatMode === 1
                      ? 'Repeat Current Track'
                      : 'Repeat Off'
                }
              >
                <Repeat className="w-3.5 h-3.5" strokeWidth={2} />
                {repeatMode === 1 && (
                  <span
                    className="absolute text-[8px] font-bold font-mono -top-1 -right-1 px-1 rounded-full"
                    style={{ background: 'var(--theme-accent)', color: '#11111b' }}
                  >
                    1
                  </span>
                )}
              </button>
            </div>

            {/* Interactive Horizontal Scrub Bar with Left Current Time & Right Duration */}
            <div className="w-full max-w-[330px] flex items-center gap-2.5">
              <span
                className="text-[11px] font-mono tabular-nums w-9 text-right shrink-0"
                style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.72))' }}
              >
                {formatMediaTime(clampedPosition)}
              </span>

              <input
                type="range"
                data-tauri-drag-region="false"
                min={0}
                max={effectiveDuration}
                value={clampedPosition}
                onMouseDown={() => setIsDraggingScrubber(true)}
                onMouseUp={() => setIsDraggingScrubber(false)}
                onTouchStart={() => setIsDraggingScrubber(true)}
                onTouchEnd={() => setIsDraggingScrubber(false)}
                onChange={(e) => {
                  handleUserSeek(Number(e.target.value));
                }}
                className="caelestia-slider flex-1 h-1.5 rounded-full pointer-events-auto cursor-pointer"
                style={{
                  background: `linear-gradient(to right, var(--theme-accent, #cba6f7) 0%, #89dceb ${progressPercent}%, var(--theme-track, rgba(255,255,255,0.14)) ${progressPercent}%, var(--theme-track, rgba(255,255,255,0.14)) 100%)`,
                }}
              />

              <span
                className="text-[11px] font-mono tabular-nums w-9 shrink-0"
                style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.72))' }}
              >
                {formatMediaTime(effectiveDuration)}
              </span>
            </div>

            {/* Alternate Audio Visualizer Modes (Linear Bars vs Oscilloscope Wave) */}
            {(settings.visualizerStyle === 'bars' ||
              settings.visualizerStyle === 'radial' ||
              !settings.visualizerStyle) && (
              <div className="w-full max-w-[330px] h-9 flex items-end justify-between gap-1 px-1 pt-1.5 overflow-hidden">
                {Array.from({ length: 32 }, (_, i) => {
                  const rawAmp = spectrumBands[i] || 0;
                  const amp = rawAmp > 0.005 ? Math.min(1, rawAmp * 2.5) : 0;
                  const heightPercent = Math.max(8, Math.min(100, Math.round(amp * 100)));
                  return (
                    <div
                      key={i}
                      className="flex-1 rounded-t-sm transition-all duration-75"
                      style={{
                        height: `${heightPercent}%`,
                        background:
                          'linear-gradient(180deg, var(--theme-accent), var(--theme-border))',
                        opacity: amp > 0.04 ? 0.95 : 0.3,
                      }}
                    />
                  );
                })}
              </div>
            )}

            {settings.visualizerStyle === 'wave' && (
              <div className="w-full max-w-[330px] h-9 relative flex items-center justify-center overflow-hidden">
                <svg className="w-full h-full" viewBox="0 0 330 36" preserveAspectRatio="none">
                  <path
                    d={`M 0 18 ${Array.from({ length: 22 }, (_, i) => {
                      const x = (i / 21) * 330;
                      const rawAmp = spectrumBands[i] || 0;
                      const amp = rawAmp > 0.03 ? rawAmp * 2.0 : isPlaying ? 0.45 : 0.05;
                      const y =
                        18 +
                        Math.sin(visualizerTick * 0.5 + i * 0.6) * (amp * 14 + (isPlaying ? 3 : 1));
                      return `L ${x.toFixed(1)} ${y.toFixed(1)}`;
                    }).join(' ')}`}
                    fill="none"
                    stroke="var(--theme-accent)"
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            )}

            {/* Active Session Switcher Capsule + Popover Dropdown */}
            <div ref={sessionPopoverRef} className="relative flex flex-col items-center">
              <button
                type="button"
                data-tauri-drag-region="false"
                onClick={() => setSessionMenuOpen((prev) => !prev)}
                className="px-3.5 py-1.5 rounded-full border flex items-center gap-2 text-xs font-semibold transition-all hover:scale-[1.02] active:scale-95 pointer-events-auto cursor-pointer"
                style={{
                  background: 'var(--theme-track, rgba(255, 255, 255, 0.06))',
                  borderColor: sessionMenuOpen
                    ? 'var(--theme-accent, #cba6f7)'
                    : 'var(--theme-border, rgba(255, 255, 255, 0.1))',
                  color: 'var(--theme-text-primary, #cdd6f4)',
                }}
                title="Switch active Windows SMTC media session"
              >
                {renderSessionIcon(currentSession?.app_name)}
                <span className="truncate max-w-[130px]">
                  {currentSession?.app_name || 'System Audio'}
                </span>
                {sessionMenuOpen ? (
                  <ChevronUp style={{ color: 'var(--theme-accent, #cba6f7)' }} strokeWidth={2} />
                ) : (
                  <ChevronDown
                    className="w-3.5 h-3.5"
                    style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.72))' }}
                    strokeWidth={2}
                  />
                )}
              </button>

              {/* Popover Dropdown List */}
              {sessionMenuOpen && (
                <div
                  data-tauri-drag-region="false"
                  className="absolute bottom-full mb-2 w-[240px] rounded-2xl p-1.5 border shadow-2xl z-40 backdrop-blur-xl pointer-events-auto"
                  style={{
                    background: 'var(--theme-surface, rgba(20, 20, 28, 0.96))',
                    borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.12))',
                  }}
                >
                  <div
                    className="px-2.5 py-1 text-[9px] font-mono uppercase tracking-widest border-b mb-1 flex items-center justify-between"
                    style={{
                      color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.65))',
                      borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
                    }}
                  >
                    <span>Active SMTC Sessions</span>
                    <span>{sessions.length} sources</span>
                  </div>

                  <div className="space-y-1 max-h-[140px] overflow-y-auto">
                    {sessions.map((session) => {
                      const isCurrent = session.id === (currentSession?.id ?? '');
                      return (
                        <button
                          key={session.id}
                          data-tauri-drag-region="false"
                          onClick={async () => {
                            setSelectedSessionId(session.id);
                            setSessionMenuOpen(false);
                            try {
                              await selectMediaSession(session.id);
                            } catch {
                              // Ignore if running in browser preview
                            }
                            onSelectSession?.(session.id);
                          }}
                          className="w-full px-2.5 py-1.5 rounded-xl flex items-center justify-between gap-2 text-left transition-all pointer-events-auto cursor-pointer"
                          style={{
                            background: isCurrent
                              ? 'var(--theme-track, rgba(203, 166, 247, 0.16))'
                              : 'transparent',
                            color: 'var(--theme-text-primary, #cdd6f4)',
                          }}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {renderSessionIcon(session.app_name)}
                            <div className="min-w-0">
                              <div className="text-xs font-semibold truncate">
                                {session.app_name}
                              </div>
                              <div
                                className="text-[10px] truncate"
                                style={{
                                  color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.65))',
                                }}
                              >
                                {session.title || 'Ready for playback'}
                              </div>
                            </div>
                          </div>
                          {isCurrent && (
                            <Check
                              className="w-3.5 h-3.5 shrink-0"
                              style={{ color: 'var(--theme-accent, #cba6f7)' }}
                              strokeWidth={2.5}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* STAGE B: Scrollable Time-Synced Lyrics View */}
          <div
            className={`w-full h-full rounded-xl border px-3 py-2 flex flex-col justify-between transition-all duration-300 ease-out bg-[#18171c]/95 backdrop-blur-xl z-20 ${
              showLyrics
                ? 'opacity-100 translate-y-0 pointer-events-auto relative'
                : 'opacity-0 translate-y-2 pointer-events-none hidden'
            }`}
            style={{
              background: 'rgba(24, 23, 28, 0.95)',
              borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.12))',
            }}
          >
            <div
              ref={lyricsScrollRef}
              data-tauri-drag-region="false"
              className={`flex-1 overflow-y-auto space-y-1.5 pr-1 py-2 ${
                showLyrics ? 'pointer-events-auto' : 'pointer-events-none'
              }`}
            >
              {lyricsLines.length === 0 ? (
                <div className="w-full h-full flex flex-col items-center justify-center text-center px-4 py-6 gap-1.5">
                  <Mic2
                    className="w-5 h-5 opacity-45"
                    style={{ color: 'var(--theme-accent, #cba6f7)' }}
                    strokeWidth={1.8}
                  />
                  <p
                    className="text-xs font-medium"
                    style={{
                      color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.72))',
                    }}
                  >
                    No lyrics available for this track
                  </p>
                </div>
              ) : (
                lyricsLines.map((line, index) => {
                  const isActive = index === activeLyricIndex;
                  const isPast = index < activeLyricIndex;
                  // The line that just became active rises in. The class only ever sits on the
                  // active line, so a clock tick cannot restart the animation.
                  const riseIn = isActive && lyricMotionEnabled;
                  return (
                    <button
                      key={`${line.time}-${index}`}
                      ref={isActive ? activeLyricItemRef : null}
                      type="button"
                      data-tauri-drag-region="false"
                      onClick={() => {
                        handleUserSeek(line.time);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg transition-all duration-200 flex items-center justify-between gap-2 pointer-events-auto cursor-pointer ${
                        isActive
                          ? 'font-bold scale-[1.01]'
                          : isPast
                            ? 'opacity-45 hover:opacity-80'
                            : 'opacity-70 hover:opacity-100'
                      }${riseIn ? ' canopy-lyric-active' : ''}`}
                      style={{
                        ...(isActive
                          ? {
                              background: 'var(--theme-track, rgba(203, 166, 247, 0.14))',
                              color: 'var(--theme-accent, #cba6f7)',
                            }
                          : {
                              color: 'var(--theme-text-primary, #cdd6f4)',
                            }),
                        ...(riseIn
                          ? {
                              animationDuration: `${Math.max(120, Math.min(600, settings.animationDurationMs))}ms`,
                            }
                          : {}),
                      }}
                      title={`Jump to ${formatMediaTime(line.time)}`}
                    >
                      <span className="text-xs leading-snug">{line.text}</span>
                      <span
                        className="text-[10px] font-mono tabular-nums shrink-0 opacity-75"
                        style={{
                          color: isActive
                            ? 'var(--theme-accent, #cba6f7)'
                            : 'var(--theme-text-secondary, rgba(205, 214, 244, 0.6))',
                        }}
                      >
                        {formatMediaTime(line.time)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div
              className="pt-1.5 border-t flex items-center justify-between text-[10px] font-mono"
              style={{
                borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.06))',
                color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.65))',
              }}
            >
              <span>{lyricsSourceLabel}</span>
              <span className="tabular-nums">
                {formatMediaTime(clampedPosition)} / {formatMediaTime(effectiveDuration)}
              </span>
            </div>
          </div>

          {/* STAGE C: Per-app volume mixer overlay, polled only while visible */}
          {showMixer && (
            <div
              data-tauri-drag-region="false"
              className="absolute inset-0 z-30 rounded-xl border px-3 py-2.5 flex flex-col pointer-events-auto bg-[#18171c]/95 backdrop-blur-xl shadow-2xl"
              style={{
                background: 'rgba(24, 23, 28, 0.95)',
                borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.12))',
              }}
            >
              <div
                className="flex items-center justify-between pb-1.5 mb-1 border-b text-[10px] font-mono uppercase tracking-widest"
                style={{
                  color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.65))',
                  borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
                }}
              >
                <span>Volume Mixer</span>
                <span>{mixerSessions.length} apps</span>
              </div>

              {mixerSessions.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center gap-1.5">
                  <Sliders
                    className="w-5 h-5 opacity-45"
                    style={{ color: 'var(--theme-accent, #cba6f7)' }}
                    strokeWidth={1.8}
                  />
                  <p
                    className="text-xs font-medium"
                    style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.72))' }}
                  >
                    {mixerLoading ? 'Loading audio sessions…' : 'No active audio sessions'}
                  </p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                  {mixerSessions.map((session) => (
                    <div key={session.id} className="flex items-center gap-2">
                      <button
                        type="button"
                        data-tauri-drag-region="false"
                        onClick={() => handleMixerMute(session.id, !session.muted)}
                        className="w-6 h-6 shrink-0 rounded-md flex items-center justify-center border transition-all hover:scale-105 active:scale-95 pointer-events-auto cursor-pointer"
                        style={{
                          background: session.muted
                            ? 'var(--theme-accent, #cba6f7)'
                            : 'transparent',
                          borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.12))',
                          color: session.muted ? '#11111b' : 'var(--theme-text-primary, #cdd6f4)',
                        }}
                        title={session.muted ? `Unmute ${session.name}` : `Mute ${session.name}`}
                      >
                        {session.muted ? (
                          <VolumeX className="w-3 h-3" strokeWidth={2} />
                        ) : (
                          <Volume2 className="w-3 h-3" strokeWidth={2} />
                        )}
                      </button>
                      {session.icon_data_url && (
                        <img
                          src={session.icon_data_url}
                          alt={session.name}
                          className="w-4 h-4 rounded shrink-0 object-contain"
                        />
                      )}
                      <span
                        className="w-[74px] shrink-0 text-[11px] font-medium truncate"
                        title={session.name}
                        style={{ color: 'var(--theme-text-primary, #cdd6f4)' }}
                      >
                        {session.name}
                      </span>
                      <input
                        type="range"
                        data-tauri-drag-region="false"
                        min={0}
                        max={100}
                        value={Math.round(session.volume)}
                        onChange={(e) => handleMixerVolume(session.id, Number(e.target.value))}
                        className="flex-1 h-1.5 rounded-full pointer-events-auto cursor-pointer"
                        style={{
                          background: `linear-gradient(to right, var(--theme-accent, #cba6f7) 0%, #89dceb ${Math.round(
                            session.volume,
                          )}%, var(--theme-track, rgba(255,255,255,0.14)) ${Math.round(
                            session.volume,
                          )}%, var(--theme-track, rgba(255,255,255,0.14)) 100%)`,
                          opacity: session.is_active ? 1 : 0.55,
                        }}
                        title={`${session.name} — ${Math.round(session.volume)}%`}
                      />
                      <span
                        className="w-8 shrink-0 text-right text-[10px] font-mono tabular-nums"
                        style={{ color: 'var(--theme-text-secondary, rgba(205, 214, 244, 0.7))' }}
                      >
                        {Math.round(session.volume)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* COLUMN 3 (Right w-[205px]): Natural Music-Reactive Mascot / Custom GIF    */}
      {/* COLUMN 3 (Right w-[205px]): Natural Music-Reactive Mascot / Custom GIF (toggleable) */}
      {settings.mascotMode !== 'none' && (
        <div className="w-[205px] shrink-0 h-full flex items-center justify-center relative overflow-visible">
          <CanopyMascot
            isPlaying={isPlaying}
            showSleepZzz={true}
            showAmbientGlow={true}
            className="w-[185px] h-[140px] transition-transform duration-200"
          />
        </div>
      )}
    </div>
  );
};
