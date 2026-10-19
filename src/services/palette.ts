import { setHostConfig } from './hostBridge';

export type RGBTuple = [number, number, number];

export type ThemePreset = 'canopy' | 'adaptive' | 'dark' | 'light' | 'auto';

/**
 * Calculates relative luminance of an sRGB color according to W3C WCAG 2.1 standards.
 */
export function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((channel) => {
    const clamped = Math.max(0, Math.min(255, channel)) / 255;
    return clamped <= 0.03928 ? clamped / 12.92 : ((clamped + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Calculates the WCAG contrast ratio (1.0 to 21.0) between two RGB colors.
 */
export function getContrastRatio(rgb1: RGBTuple, rgb2: RGBTuple): number {
  const lum1 = getLuminance(rgb1[0], rgb1[1], rgb1[2]);
  const lum2 = getLuminance(rgb2[0], rgb2[1], rgb2[2]);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

export function rgbToHex([r, g, b]: RGBTuple): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const delta = max - min;
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (delta > 0.00001) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === rf) {
      h = ((gf - bf) / delta + (gf < bf ? 6 : 0)) * 60;
    } else if (max === gf) {
      h = ((bf - rf) / delta + 2) * 60;
    } else {
      h = ((rf - gf) / delta + 4) * 60;
    }
  }

  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): RGBTuple {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }

  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// ---------------------------------------------------------------------------
// Signature Preset Definitions
// ---------------------------------------------------------------------------

export const CANOPY_FOREST_THEME = {
  bg: 'rgba(17, 25, 19, 0.92)',
  card: 'rgba(26, 38, 29, 0.78)',
  border: 'rgba(116, 168, 108, 0.22)',
  accent: '#74a86c',
  accentSoft: 'rgba(116, 168, 108, 0.18)',
  accentWarm: '#e07a5f',
  textPrimary: '#f5efe6',
  textSecondary: '#9eb09a',
  track: 'rgba(116, 168, 108, 0.12)',
  isLight: false,
};

export const OBSIDIAN_DARK_THEME = {
  bg: 'rgba(18, 18, 24, 0.92)',
  card: 'rgba(255, 255, 255, 0.04)',
  border: 'rgba(162, 155, 254, 0.28)',
  accent: '#a29bfe',
  accentSoft: 'rgba(162, 155, 254, 0.18)',
  accentWarm: '#fab387',
  textPrimary: '#f1f2f6',
  textSecondary: '#9e9ea7',
  track: 'rgba(255, 255, 255, 0.08)',
  isLight: false,
};

export const ALABASTER_LIGHT_THEME = {
  bg: 'rgba(248, 250, 248, 0.94)',
  card: 'rgba(255, 255, 255, 0.85)',
  border: 'rgba(45, 65, 50, 0.14)',
  accent: '#447a40',
  accentSoft: 'rgba(68, 122, 64, 0.14)',
  accentWarm: '#d9684c',
  textPrimary: '#1a261d',
  textSecondary: '#4a6350',
  track: 'rgba(45, 65, 50, 0.10)',
  isLight: true,
};

function applyThemeVariables(vars: {
  bg: string;
  card: string;
  border: string;
  accent: string;
  accentSoft: string;
  accentWarm: string;
  textPrimary: string;
  textSecondary: string;
  track: string;
  isLight: boolean;
}): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = vars.isLight ? 'light' : 'dark';

  root.style.setProperty('--theme-bg', vars.bg);
  root.style.setProperty('--theme-card', vars.card);
  root.style.setProperty('--theme-border', vars.border);
  root.style.setProperty('--theme-accent', vars.accent);
  root.style.setProperty('--theme-accent-soft', vars.accentSoft);
  root.style.setProperty('--theme-accent-warm', vars.accentWarm);
  root.style.setProperty('--theme-text', vars.textPrimary);
  root.style.setProperty('--theme-text-primary', vars.textPrimary);
  root.style.setProperty('--theme-text-muted', vars.textSecondary);
  root.style.setProperty('--theme-text-secondary', vars.textSecondary);
  root.style.setProperty('--theme-track', vars.track);
  root.style.setProperty(
    '--theme-surface-hover',
    vars.isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.08)',
  );

  // Compute perceived luminance of the accent color to guarantee high-contrast text
  let onAccent = '#ffffff';
  const rgbMatch = vars.accent.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  const hexMatch = vars.accent.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (rgbMatch) {
    const lum =
      0.299 * Number(rgbMatch[1]) + 0.587 * Number(rgbMatch[2]) + 0.114 * Number(rgbMatch[3]);
    if (lum > 140) onAccent = '#111913';
  } else if (hexMatch) {
    const r = parseInt(hexMatch[1], 16);
    const g = parseInt(hexMatch[2], 16);
    const b = parseInt(hexMatch[3], 16);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum > 140) onAccent = '#111913';
  }
  root.style.setProperty('--theme-on-accent', onAccent);

  try {
    setHostConfig({ themeAccent: vars.accent, themeBg: vars.bg }).catch(() => {});
  } catch {
    // Non-fatal if host bridge is not ready
  }
}

export function applyThemeModeFallback(
  themeMode: string = 'canopy',
  glassOpacity?: number,
  glassBlurStrength?: number,
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  if (typeof glassOpacity === 'number' && Number.isFinite(glassOpacity)) {
    root.style.setProperty('--glass-opacity', String(glassOpacity));
  }
  if (typeof glassBlurStrength === 'number' && Number.isFinite(glassBlurStrength)) {
    root.style.setProperty('--glass-blur', `${glassBlurStrength}px`);
  }

  const mode = themeMode.toLowerCase();
  const prefersLight =
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches;
  if (mode === 'light' || mode === 'alabaster' || (mode === 'auto' && prefersLight)) {
    applyThemeVariables(ALABASTER_LIGHT_THEME);
  } else if (mode === 'dark' || mode === 'obsidian' || (mode === 'auto' && !prefersLight)) {
    applyThemeVariables(OBSIDIAN_DARK_THEME);
  } else {
    // Default signature: Canopy Forest
    applyThemeVariables(CANOPY_FOREST_THEME);
  }
}

/**
 * Extracts a vibrant, full-gamut dominant color from a wallpaper and computes
 * balanced UI glass tokens without blue-floor clamping (orange remains orange, red remains red).
 */
export function applyThemePalette(
  imgElement: HTMLImageElement,
  themeMode: string = 'adaptive',
): void {
  if (typeof document === 'undefined') return;

  const mode = themeMode.toLowerCase();
  if (mode === 'canopy') {
    applyThemeVariables(CANOPY_FOREST_THEME);
    return;
  }
  const prefersLight =
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches;
  if (mode === 'dark' || mode === 'obsidian' || (mode === 'auto' && !prefersLight)) {
    applyThemeVariables(OBSIDIAN_DARK_THEME);
    return;
  }
  if (mode === 'light' || mode === 'alabaster' || (mode === 'auto' && prefersLight)) {
    applyThemeVariables(ALABASTER_LIGHT_THEME);
    return;
  }

  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 64;
    canvas.height = 64;

    if (!ctx) {
      applyThemeModeFallback('canopy');
      return;
    }

    ctx.drawImage(imgElement, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;

    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let totalPixels = 0;

    // 12 Hue Buckets (30 deg each: 0=Red, 1=Orange, 2=Yellow, 3=Lime, 4=Green, 5=Cyan,
    // 6=Sky, 7=Blue, 8=Violet, 9=Purple, 10=Magenta, 11=Pink)
    const HUE_BUCKET_COUNT = 12;
    const bucketWeights = new Float32Array(HUE_BUCKET_COUNT);
    const bucketHues = new Float32Array(HUE_BUCKET_COUNT);
    const bucketSats = new Float32Array(HUE_BUCKET_COUNT);
    const bucketCounts = new Uint32Array(HUE_BUCKET_COUNT);

    let chromaticPixels = 0;
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      rSum += r;
      gSum += g;
      bSum += b;
      totalPixels++;

      const [h, s, l] = rgbToHsl(r, g, b);

      // Filter out neutral grays / blacks / whites for accent extraction
      if (s >= 0.16 && l >= 0.12 && l <= 0.9) {
        chromaticPixels++;
        // Shift hue so 0 is centered around Red (345..15)
        const shiftedHue = (h + 15) % 360;
        const bucketIndex = Math.floor(shiftedHue / 30);
        // Weight by saturation and distance from extreme lightness
        const weight = s * (1.0 - Math.abs(l - 0.5));
        bucketHues[bucketIndex] += shiftedHue * weight;
        bucketWeights[bucketIndex] += weight;
        bucketSats[bucketIndex] += s * weight;
        bucketCounts[bucketIndex]++;
      }
    }

    if (totalPixels === 0) {
      applyThemeModeFallback('canopy');
      return;
    }

    const avgR = Math.round(rSum / totalPixels);
    const avgG = Math.round(gSum / totalPixels);
    const avgB = Math.round(bSum / totalPixels);

    // Find the winning chromatic hue bucket
    let bestBucket = -1;
    let maxWeight = 0;
    for (let b = 0; b < HUE_BUCKET_COUNT; b++) {
      if (bucketWeights[b] > maxWeight) {
        maxWeight = bucketWeights[b];
        bestBucket = b;
      }
    }

    // Determine theme mode (light if brightness > 155)
    const brightness = (avgR * 299 + avgG * 587 + avgB * 114) / 1000;
    const isLight = brightness > 155;

    // Check if the image is predominantly grayscale / shades of gray
    const isGrayscale = chromaticPixels < totalPixels * 0.05 || maxWeight < 1.0;
    if (isGrayscale) {
      if (isLight) {
        applyThemeVariables({
          bg: 'rgba(248, 250, 252, 0.94)',
          card: 'rgba(255, 255, 255, 0.85)',
          border: 'rgba(15, 23, 42, 0.12)',
          accent: '#475569',
          accentSoft: 'rgba(71, 85, 105, 0.14)',
          accentWarm: '#64748b',
          textPrimary: '#0f172a',
          textSecondary: '#475569',
          track: 'rgba(15, 23, 42, 0.08)',
          isLight: true,
        });
      } else {
        applyThemeVariables({
          bg: 'rgba(18, 18, 24, 0.94)',
          card: 'rgba(255, 255, 255, 0.05)',
          border: 'rgba(255, 255, 255, 0.10)',
          accent: '#94a3b8',
          accentSoft: 'rgba(148, 163, 184, 0.18)',
          accentWarm: '#cbd5e1',
          textPrimary: '#f8fafc',
          textSecondary: '#94a3b8',
          track: 'rgba(255, 255, 255, 0.08)',
          isLight: false,
        });
      }
      return;
    }

    const avgShifted = bucketHues[bestBucket] / bucketWeights[bestBucket];
    let accentH = (avgShifted - 15 + 360) % 360;
    let accentS = Math.min(
      0.95,
      Math.max(0.65, bucketSats[bestBucket] / bucketWeights[bestBucket]),
    );

    // If red channel strongly dominates, prevent snapping into magenta/pink
    const isRedDominated = avgR > avgG * 1.25 && avgR > avgB * 1.2;
    if (isRedDominated && (accentH > 315 || accentH < 35 || (accentH >= 160 && accentH <= 210))) {
      accentH = accentH > 315 || accentH < 35 ? (accentH > 315 ? 355 : accentH) : 355;
    }

    const isRedHue = accentH >= 340 || accentH <= 22;

    // For red hues, keep targetL around 0.50 (in dark mode) so it stays vivid crimson/red rather than turning pastel pink
    let targetL: number;
    if (isRedHue) {
      targetL = isLight ? 0.42 : 0.5;
      accentS = Math.max(0.85, accentS);
    } else {
      targetL = isLight ? 0.38 : 0.62;
    }

    const accentRgb = hslToRgb(accentH, accentS, targetL);
    const accentHex = rgbToHex(accentRgb);

    // Secondary warm complementary accent: for red, stay in warm amber/orange (24°)
    const warmH = isRedHue ? 24 : (accentH + 30) % 360;
    const warmRgb = hslToRgb(warmH, 0.85, isLight ? 0.45 : 0.65);
    const warmHex = rgbToHex(warmRgb);
    if (isLight) {
      const bgRgb: RGBTuple = [
        Math.min(252, Math.max(242, Math.round(250 - (255 - avgR) * 0.08))),
        Math.min(252, Math.max(242, Math.round(250 - (255 - avgG) * 0.08))),
        Math.min(252, Math.max(242, Math.round(250 - (255 - avgB) * 0.08))),
      ];
      applyThemeVariables({
        bg: `rgba(${bgRgb[0]}, ${bgRgb[1]}, ${bgRgb[2]}, 0.94)`,
        card: 'rgba(255, 255, 255, 0.85)',
        border: 'rgba(15, 23, 42, 0.12)',
        accent: accentHex,
        accentSoft: `rgba(${accentRgb[0]}, ${accentRgb[1]}, ${accentRgb[2]}, 0.14)`,
        accentWarm: warmHex,
        textPrimary: '#0f172a',
        textSecondary: '#475569',
        track: 'rgba(15, 23, 42, 0.08)',
        isLight: true,
      });
    } else {
      // Dark glass with subtle chromatic undertone of the wallpaper
      const bgRgb: RGBTuple = [
        Math.max(12, Math.min(32, Math.round(avgR * 0.12 + 10))),
        Math.max(12, Math.min(32, Math.round(avgG * 0.12 + 10))),
        Math.max(14, Math.min(36, Math.round(avgB * 0.12 + 12))),
      ];
      applyThemeVariables({
        bg: `rgba(${bgRgb[0]}, ${bgRgb[1]}, ${bgRgb[2]}, 0.92)`,
        card: `rgba(255, 255, 255, 0.05)`,
        border: `rgba(${accentRgb[0]}, ${accentRgb[1]}, ${accentRgb[2]}, 0.32)`,
        accent: accentHex,
        accentSoft: `rgba(${accentRgb[0]}, ${accentRgb[1]}, ${accentRgb[2]}, 0.18)`,
        accentWarm: warmHex,
        textPrimary: '#f5efe6',
        textSecondary: '#9eb09a',
        track: `rgba(${accentRgb[0]}, ${accentRgb[1]}, ${accentRgb[2]}, 0.12)`,
        isLight: false,
      });
    }
  } catch {
    applyThemeModeFallback('canopy');
  }
}

export async function applyThemeFromImageSrc(
  imageSrc: string,
  themeMode: string = 'adaptive',
): Promise<void> {
  if (typeof window === 'undefined' || !imageSrc) {
    applyThemeModeFallback(themeMode);
    return;
  }

  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = imageSrc;
    await img.decode();
    applyThemePalette(img, themeMode);
  } catch {
    applyThemeModeFallback(themeMode);
  }
}

export function initializeSystemThemeWatcher(onThemeChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const media = window.matchMedia('(prefers-color-scheme: light)');
  const listener = () => onThemeChange();
  media.addEventListener('change', listener);
  window.addEventListener('canopy:system-theme-changed', listener);
  return () => {
    media.removeEventListener('change', listener);
    window.removeEventListener('canopy:system-theme-changed', listener);
  };
}
