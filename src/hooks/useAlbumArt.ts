import { useEffect, useState } from 'react';

const artworkCache = new Map<string, string>();

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

    if (
      !cleanTitle ||
      cleanTitle.toLowerCase() === 'system audio' ||
      cleanTitle.toLowerCase() === 'no media playing'
    ) {
      setArtworkUrl(null);
      return;
    }

    const cacheKey = `${cleanArtist.toLowerCase()}|${cleanTitle.toLowerCase()}`;
    if (artworkCache.has(cacheKey)) {
      setArtworkUrl(artworkCache.get(cacheKey) || null);
      return;
    }

    let active = true;
    const fetchArt = async () => {
      try {
        const query = cleanArtist ? `${cleanArtist} ${cleanTitle}` : cleanTitle;
        const res = await fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=1`,
        );
        if (!res.ok) return;

        const data = await res.json();
        if (active && data.results && data.results.length > 0 && data.results[0].artworkUrl100) {
          const highRes = data.results[0].artworkUrl100.replace(/\d+x\d+bb/, '600x600bb');
          artworkCache.set(cacheKey, highRes);
          setArtworkUrl(highRes);
        } else {
          artworkCache.set(cacheKey, '');
        }
      } catch {
        // Network offline or query failed
      }
    };

    fetchArt();

    return () => {
      active = false;
    };
  }, [title, artist, smtcThumbnail]);

  return artworkUrl || smtcThumbnail || null;
}
