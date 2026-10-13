import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { BongoCat } from '../components/BongoCat';
import {
  MediaInfo,
  MediaSessionItem,
  getAudioSpectrum,
  getMediaSessions,
  selectMediaSession,
} from '../services/tauriBridge';

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

function renderSessionIcon(appName: string): React.ReactNode {
  const lower = appName.toLowerCase();
  if (lower.includes('spotify')) {
    return <Radio className="w-3.5 h-3.5 text-[#a6e3a1]" strokeWidth={2} />;
  }
  if (lower.includes('feishin') || lower.includes('foobar') || lower.includes('musicbee')) {
    return <Headphones className="w-3.5 h-3.5 text-[#cba6f7]" strokeWidth={2} />;
  }
  if (lower.includes('chrome') || lower.includes('edge') || lower.includes('firefox')) {
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
  rawArtist: string
): { cleanTitle: string; cleanArtist: string } {
  let cleanTitle = rawTitle
    .replace(
      /\s*[\(\[【](?:official\s*(?:music\s*)?(?:video|audio|lyric\s*video|lyrics|visualizer|mv)|lyric\s*video|lyrics?|audio|video|visualizer|mv|hd|hq|4k|remastered[^)\]]*|live[^)\]]*|feat\.?[^)\]]*|ft\.?[^)\]]*)[\)\]】]/gi,
      ''
    )
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.+$/i, '')
    .replace(/\s*[-|]\s*(?:youtube(?:\s+music)?|spotify|soundcloud).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  let cleanArtist = rawArtist
    .replace(/\s*-\s*topic$/i, '')
    .replace(/\s*[\(\[](?:feat\.?|ft\.?)[^)\]]*[\)\]]/gi, '')
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

function parseLrcLyrics(syncedLrc?: string | null, plainText?: string | null, durationSecs = 210): LyricLine[] {
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
  const isPlaying = Boolean(media.is_playing);

  // Local interactive scrub state synced with media.position_secs
  const [localPosition, setLocalPosition] = useState<number>(media.position_secs || 0);
  const [isDraggingScrubber, setIsDraggingScrubber] = useState<boolean>(false);

  // Radial spoke visualizer phase (animates strictly when media.is_playing is true)
  // Live 40-band WASAPI Loopback FFT spectrum amplitudes in [0.0, 1.0]
  const [spectrumBands, setSpectrumBands] = useState<number[]>(() => new Array(40).fill(0));
  // Interactive Lyrics Toggle & Synced Lyrics state
  const [showLyrics, setShowLyrics] = useState<boolean>(false);
  const [lyricsLines, setLyricsLines] = useState<LyricLine[]>([]);
  const [lyricsSourceLabel, setLyricsSourceLabel] = useState<string>('Synced Lyrics');
  const lyricsCacheRef = useRef<Record<string, { lines: LyricLine[]; label: string }>>({});
  const lyricsScrollRef = useRef<HTMLDivElement | null>(null);
  const activeLyricItemRef = useRef<HTMLButtonElement | null>(null);

  // Active SMTC session switcher popover state
  const [sessionMenuOpen, setSessionMenuOpen] = useState<boolean>(false);
  const [fetchedSessions, setFetchedSessions] = useState<MediaSessionItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const sessionPopoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isDraggingScrubber) {
      setLocalPosition(media.position_secs || 0);
    }
  }, [media.position_secs, isDraggingScrubber]);

  // Animate radial 40-spoke visualizer strictly when music is actively playing
  // Poll real 40-band WASAPI Loopback FFT spectrum strictly when audio is playing
  useEffect(() => {
    if (!isPlaying) {
      setSpectrumBands(new Array(40).fill(0));
      return;
    }
    let active = true;
    const pollSpectrum = async () => {
      try {
        const bands = await getAudioSpectrum();
        if (active && Array.isArray(bands) && bands.length > 0) {
          setSpectrumBands(bands);
        }
      } catch {
        // Ignore transient spectrum read errors
      }
    };
    void pollSpectrum();
    const timer = window.setInterval(pollSpectrum, 45);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [isPlaying]);
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
      if (
        sessionPopoverRef.current &&
        !sessionPopoverRef.current.contains(e.target as Node)
      ) {
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
    const active = sessions.find((s) => s.is_current);
    if (active) return active;
    if (media.source_app) {
      const matched = sessions.find(
        (s) =>
          s.app_name.toLowerCase() === media.source_app?.toLowerCase() ||
          s.id.toLowerCase() === media.source_app?.toLowerCase()
      );
      if (matched) return matched;
    }
    return sessions[0] || DEFAULT_FALLBACK_SESSIONS[0];
  }, [sessions, media.source_app]);

  const effectiveDuration = Math.max(1, media.duration_secs || 219);
  const clampedPosition = Math.min(effectiveDuration, Math.max(0, localPosition));
  const progressPercent = Math.min(100, Math.max(0, (clampedPosition / effectiveDuration) * 100));

  const trackTitle = media.title?.trim() || 'No Media Playing';
  const trackArtist = media.artist?.trim() || 'Windows SMTC Audio';
  const trackAlbum = media.album?.trim() || '';

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
    }

    const extractValidLyrics = (
      item: LrclibTrackResponse | null | undefined
    ): { lines: LyricLine[]; label: string } | null => {
      if (!item) return null;
      const parsed = parseLrcLyrics(
        item.syncedLyrics,
        item.plainLyrics,
        effectiveDuration
      );
      if (parsed.length > 0) {
        return {
          lines: parsed,
          label: item.syncedLyrics ? 'LRCLIB Synced' : 'LRCLIB Lyrics',
        };
      }
      return null;
    };

    const fetchFromLrclib = async () => {
      try {
        // 1. Primary query: /api/get?artist_name={artist}&track_name={title}
        const getUrl = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(
          rawArtist
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
            cleanArtist
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
          cleanTitle
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
            queryText
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

  const activeLyricIndex = useMemo(() => {
    if (lyricsLines.length === 0) return 0;
    let idx = 0;
    for (let i = 0; i < lyricsLines.length; i++) {
      if (clampedPosition >= lyricsLines[i].time) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  }, [lyricsLines, clampedPosition]);

  // Smoothly center the active lyric line in the scrollable stage
  useEffect(() => {
    if (!showLyrics || !activeLyricItemRef.current || !lyricsScrollRef.current) return;
    const container = lyricsScrollRef.current;
    const item = activeLyricItemRef.current;
    const targetTop =
      item.offsetTop - container.clientHeight / 2 + item.clientHeight / 2;
    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: 'smooth',
    });
  }, [activeLyricIndex, showLyrics]);

  // Precompute 40 radial spoke bars around cx=95, cy=95
  // Precompute 40 radial spoke bars driven by live 40-band FFT audio spectrum
  const spokes = useMemo(() => {
    const count = 40;
    const cx = 95;
    const cy = 95;
    const innerRadius = 64;

    return Array.from({ length: count }, (_, idx) => {
      const angle = (idx / count) * Math.PI * 2 - Math.PI / 2;
      let length = 5.5;

      if (isPlaying) {
        const rawAmp =
          Array.isArray(spectrumBands) && typeof spectrumBands[idx] === 'number'
            ? spectrumBands[idx]
            : 0;
        length = Math.max(5.5, Math.min(26, 5.5 + rawAmp * 21.5));
      }

      const outerRadius = innerRadius + length;
      const x1 = cx + Math.cos(angle) * innerRadius;
      const y1 = cy + Math.sin(angle) * innerRadius;
      const x2 = cx + Math.cos(angle) * outerRadius;
      const y2 = cy + Math.sin(angle) * outerRadius;

      return { idx, x1, y1, x2, y2, length };
    });
  }, [isPlaying, spectrumBands]);
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
          {/* 40-Spoke Radial Visualizer SVG around cx=95, cy=95 */}
          <svg
            width={190}
            height={190}
            viewBox="0 0 190 190"
            className="absolute inset-0 overflow-visible pointer-events-none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="canopyMediaSpokeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="var(--theme-accent, #cba6f7)" />
                <stop offset="100%" stopColor="#89dceb" />
              </linearGradient>
            </defs>

            {/* Subtle inner guide track circle */}
            <circle
              cx={95}
              cy={95}
              r={61}
              fill="none"
              stroke="var(--theme-track, rgba(255, 255, 255, 0.08))"
              strokeWidth={1.25}
            />

            {/* 40 Radial SVG Spoke Bars */}
            {spokes.map((spoke) => (
              <line
                key={spoke.idx}
                x1={spoke.x1}
                y1={spoke.y1}
                x2={spoke.x2}
                y2={spoke.y2}
                stroke={
                  isPlaying
                    ? 'url(#canopyMediaSpokeGrad)'
                    : 'var(--theme-track, rgba(255, 255, 255, 0.22))'
                }
                strokeWidth={2.6}
                strokeLinecap="round"
                style={{
                  transition: 'all 85ms ease-out',
                  opacity: isPlaying ? Math.min(1, 0.55 + spoke.length / 32) : 0.45,
                }}
              />
            ))}
          </svg>

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
            {media.artwork_url ? (
              <>
                <img
                  src={media.artwork_url}
                  alt={trackTitle}
                  className="w-full h-full object-cover"
                />
                {/* Subtle vinyl center spindle hole */}
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

          <button
            type="button"
            data-tauri-drag-region="false"
            onClick={() => {
              setSessionMenuOpen(false);
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
        </div>

        {/* Animated Dual Stage: Transport Controls <-> Time-Synced Lyrics */}
        <div className="relative flex-1 w-full min-h-0 flex items-center justify-center mt-1">
          {/* STAGE A: Transport Controls, Scrub Bar & Session Switcher */}
          <div
            className={`w-full h-full flex flex-col items-center justify-center gap-3 transition-all duration-300 ease-out ${
              showLyrics
                ? 'opacity-0 translate-y-2 pointer-events-none hidden'
                : 'opacity-100 translate-y-0 pointer-events-auto relative z-10'
            }`}
          >
            {/* Large Transport Buttons: Previous (|<), Circular Play/Pause (( > )), Next (>|) */}
            <div className="flex items-center justify-center gap-4">
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
                  const nextSeconds = Number(e.target.value);
                  setLocalPosition(nextSeconds);
                  onSeek?.(nextSeconds);
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
                {renderSessionIcon(currentSession.app_name)}
                <span className="truncate max-w-[130px]">{currentSession.app_name}</span>
                {sessionMenuOpen ? (
                  <ChevronUp
                    className="w-3.5 h-3.5"
                    style={{ color: 'var(--theme-accent, #cba6f7)' }}
                    strokeWidth={2}
                  />
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
                      const isCurrent = session.id === currentSession.id;
                      return (
                        <button
                          key={session.id}
                          type="button"
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
            className={`w-full h-full rounded-xl border px-3 py-2 flex flex-col justify-between transition-all duration-300 ease-out ${
              showLyrics
                ? 'opacity-100 translate-y-0 pointer-events-auto relative z-10'
                : 'opacity-0 translate-y-2 pointer-events-none hidden'
            }`}
            style={{
              background: 'var(--theme-track, rgba(255, 255, 255, 0.03))',
              borderColor: 'var(--theme-border, rgba(255, 255, 255, 0.08))',
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
                  return (
                    <button
                      key={`${line.time}-${index}`}
                      ref={isActive ? activeLyricItemRef : null}
                      type="button"
                      data-tauri-drag-region="false"
                      onClick={() => {
                        setLocalPosition(line.time);
                        onSeek?.(line.time);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg transition-all duration-200 flex items-center justify-between gap-2 pointer-events-auto cursor-pointer ${
                        isActive
                          ? 'font-bold scale-[1.01]'
                          : isPast
                          ? 'opacity-45 hover:opacity-80'
                          : 'opacity-70 hover:opacity-100'
                      }`}
                      style={
                        isActive
                          ? {
                              background: 'var(--theme-track, rgba(203, 166, 247, 0.14))',
                              color: 'var(--theme-accent, #cba6f7)',
                            }
                          : {
                              color: 'var(--theme-text-primary, #cdd6f4)',
                            }
                      }
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
        </div>
      </div>

      {/* ========================================================================= */}
      {/* COLUMN 3 (Right w-[205px]): Natural Music-Reactive Mascot / Custom GIF    */}
      {/* ========================================================================= */}
      <div className="w-[205px] shrink-0 h-full flex items-center justify-center relative overflow-hidden">
        <BongoCat
          isPlaying={isPlaying}
          className="w-[185px] h-[140px] transition-transform duration-200"
        />
      </div>
    </div>
  );
};
