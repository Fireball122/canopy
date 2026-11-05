import { useEffect, useState } from 'react';

/** Resolved cover URL per `artist|title`; '' records a confirmed "no artwork" answer. */
const artworkCache = new Map<string, string>();

/** Titles the host reports when nothing is playing; never looked up on iTunes. */
const PLACEHOLDER_TITLES: Readonly<Record<string, true>> = {
  'system audio': true,
  'no media': true,
  'no media playing': true,
};

function readArtworkUrl(data: unknown): string | null {
  if (!data || typeof data !== 'object' || !('results' in data) || !Array.isArray(data.results)) {
    return null;
  }
  const first: unknown = data.results[0];
  if (
    !first ||
    typeof first !== 'object' ||
    !('artworkUrl100' in first) ||
    typeof first.artworkUrl100 !== 'string'
  ) {
    return null;
  }
  return first.artworkUrl100.replace(/\d+x\d+bb/, '600x600bb');
}

/**
 * Custom hook to resolve high-resolution album artwork for active music tracks.
 * If SMTC provides a base64 thumbnail, it uses it immediately.
 * If SMTC thumbnail is missing or null, it queries the iTunes search API (with in-memory cache)
 * to fetch the 600x600 high-res album cover.
 */
export function useAlbumArt(
  title?: string | null,
  artist?: string | null,
  smtcThumbnail?: string | null,
): string | null {
  const [artworkUrl, setArtworkUrl] = useState<string | null>(smtcThumbnail || null);

  useEffect(() => {
    // 1. If SMTC already provided a valid base64 or URL thumbnail, use it directly
    if (smtcThumbnail && smtcThumbnail.trim().length > 0) {
      setArtworkUrl(smtcThumbnail);
      return;
    }

    const cleanTitle = (title || '').trim();
    const cleanArtist = (artist || '').trim();

    if (!cleanTitle || Object.hasOwn(PLACEHOLDER_TITLES, cleanTitle.toLowerCase())) {
      setArtworkUrl(null);
      return;
    }

    const cacheKey = `${cleanArtist.toLowerCase()}|${cleanTitle.toLowerCase()}`;
    const cached = artworkCache.get(cacheKey);
    if (cached !== undefined) {
      setArtworkUrl(cached || null);
      return;
    }

    // Never keep showing the previous track's cover while (or if) this lookup fails.
    setArtworkUrl(null);

    // Aborting on track change/unmount also keeps a superseded lookup from writing the cache:
    // only an answer for the track still on screen is recorded, including "no artwork".
    const controller = new AbortController();
    const fetchArt = async () => {
      try {
        const query = cleanArtist ? `${cleanArtist} ${cleanTitle}` : cleanTitle;
        const res = await fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=1`,
          { signal: controller.signal },
        );
        if (!res.ok) return;

        const resolved = readArtworkUrl(await res.json());
        if (controller.signal.aborted) return;
        artworkCache.set(cacheKey, resolved ?? '');
        setArtworkUrl(resolved);
      } catch {
        // Network offline, query failed, or the lookup was superseded
      }
    };

    void fetchArt();

    return () => {
      controller.abort();
    };
  }, [title, artist, smtcThumbnail]);

  return artworkUrl || smtcThumbnail || null;
}
