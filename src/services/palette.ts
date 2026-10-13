export type RGBTuple = [number, number, number];

/**
 * Calculates relative luminance of an sRGB color according to W3C WCAG 2.1 standards.
 */
export function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((channel) => {
    const clamped = Math.max(0, Math.min(255, channel)) / 255;
    return clamped <= 0.03928
      ? clamped / 12.92
      : Math.pow((clamped + 0.055) / 1.055, 2.4);
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

function rgbToHex([r, g, b]: RGBTuple): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function enforceWcagTextColors(
  bgRgb: RGBTuple,
  isLight: boolean,
  candidatePrimary: RGBTuple,
  candidateSecondary: RGBTuple
): { primaryHex: string; secondaryHex: string } {
  const primaryContrast = getContrastRatio(bgRgb, candidatePrimary);
  let finalPrimary: RGBTuple = candidatePrimary;

  // Enforce strict WCAG AA >= 4.5:1 contrast ratio for primary text
  if (primaryContrast < 4.5) {
    finalPrimary = isLight ? [18, 18, 22] : [255, 255, 255];
  }

  const secondaryContrast = getContrastRatio(bgRgb, candidateSecondary);
  let finalSecondary: RGBTuple = candidateSecondary;

  // Enforce >= 4.5:1 contrast ratio for secondary text so subtitles/labels never wash out
  if (secondaryContrast < 4.5) {
    finalSecondary = isLight ? [68, 62, 58] : [203, 213, 225];
    if (getContrastRatio(bgRgb, finalSecondary) < 4.5) {
      finalSecondary = isLight ? [32, 30, 28] : [241, 245, 249];
    }
  }

  return {
    primaryHex: rgbToHex(finalPrimary),
    secondaryHex: rgbToHex(finalSecondary),
  };
}

function applyComputedRootVariables(
  bgRgb: RGBTuple,
  accentRgb: RGBTuple,
  isLight: boolean,
  candidatePrimary: RGBTuple,
  candidateSecondary: RGBTuple
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = isLight ? 'light' : 'dark';

  const { primaryHex, secondaryHex } = enforceWcagTextColors(
    bgRgb,
    isLight,
    candidatePrimary,
    candidateSecondary
  );

  // Ensure accent color also maintains legible contrast against the surface
  let safeAccent: RGBTuple = accentRgb;
  if (getContrastRatio(bgRgb, safeAccent) < 3.0) {
    safeAccent = isLight ? [168, 74, 58] : [162, 155, 254];
  }

  const [bgR, bgG, bgB] = bgRgb;
  const defaultOpacity = isLight ? 0.9 : 0.86;

  root.style.setProperty(
    '--theme-bg',
    `rgba(${bgR}, ${bgG}, ${bgB}, var(--glass-opacity, ${defaultOpacity}))`
  );
  root.style.setProperty(
    '--theme-card',
    isLight ? 'rgba(0, 0, 0, 0.045)' : 'rgba(255, 255, 255, 0.04)'
  );
  root.style.setProperty(
    '--theme-border',
    isLight ? 'rgba(0, 0, 0, 0.09)' : 'rgba(255, 255, 255, 0.08)'
  );
  root.style.setProperty('--theme-text-primary', primaryHex);
  root.style.setProperty('--theme-text-secondary', secondaryHex);
  root.style.setProperty('--theme-accent', rgbToHex(safeAccent));
  root.style.setProperty(
    '--theme-track',
    isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)'
  );
}

export function applyThemeModeFallback(
  themeMode: 'auto' | 'dark' | 'light' = 'auto',
  glassOpacity?: number,
  glassBlurStrength?: number
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  if (typeof glassOpacity === 'number' && Number.isFinite(glassOpacity)) {
    root.style.setProperty('--glass-opacity', String(glassOpacity));
  }
  if (typeof glassBlurStrength === 'number' && Number.isFinite(glassBlurStrength)) {
    root.style.setProperty('--glass-blur', `${glassBlurStrength}px`);
  }

  const isLight = themeMode === 'light';
  if (isLight) {
    applyComputedRootVariables(
      [244, 239, 234],
      [184, 92, 75],
      true,
      [34, 30, 28],
      [92, 83, 78]
    );
  } else {
    applyComputedRootVariables(
      [18, 18, 24],
      [162, 155, 254],
      false,
      [241, 242, 246],
      [158, 158, 167]
    );
  }
}

export function applyThemePalette(
  imgElement: HTMLImageElement,
  themeMode: 'auto' | 'dark' | 'light' = 'auto'
): void {
  if (typeof document === 'undefined') return;

  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 64;
    canvas.height = 64;

    if (!ctx) {
      applyThemeModeFallback(themeMode);
      return;
    }

    ctx.drawImage(imgElement, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;

    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let count = 0;

    let vibrantR = 162;
    let vibrantG = 155;
    let vibrantB = 254;
    let maxSat = -1;

    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      rSum += r;
      gSum += g;
      bSum += b;
      count++;

      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const sat = maxC - minC;
      if (sat > maxSat && maxC > 45 && minC < 235) {
        maxSat = sat;
        vibrantR = r;
        vibrantG = g;
        vibrantB = b;
      }
    }

    if (count === 0) {
      applyThemeModeFallback(themeMode);
      return;
    }

    const avgR = Math.round(rSum / count);
    const avgG = Math.round(gSum / count);
    const avgB = Math.round(bSum / count);

    // Perceived brightness (0..255)
    const brightness = (avgR * 299 + avgG * 587 + avgB * 114) / 1000;
    const isLight =
      themeMode === 'light'
        ? true
        : themeMode === 'dark'
          ? false
          : brightness > 145;

    if (isLight) {
      // Warm alabaster/tinted light surface
      const bgRgb: RGBTuple = [
        Math.min(250, Math.max(228, Math.round(avgR * 0.25 + 186))),
        Math.min(248, Math.max(224, Math.round(avgG * 0.25 + 182))),
        Math.min(245, Math.max(220, Math.round(avgB * 0.25 + 178))),
      ];
      const accentRgb: RGBTuple =
        maxSat > 35
          ? [
              Math.max(40, Math.min(195, vibrantR)),
              Math.max(40, Math.min(165, vibrantG)),
              Math.max(40, Math.min(195, vibrantB)),
            ]
          : [184, 92, 75];

      applyComputedRootVariables(
        bgRgb,
        accentRgb,
        true,
        [45, 40, 38],
        [104, 94, 88]
      );
    } else {
      // Deep obsidian/tinted dark surface
      const bgRgb: RGBTuple = [
        Math.max(12, Math.min(34, Math.round(avgR * 0.18 + 10))),
        Math.max(12, Math.min(34, Math.round(avgG * 0.18 + 10))),
        Math.max(16, Math.min(42, Math.round(avgB * 0.18 + 14))),
      ];
      const accentRgb: RGBTuple =
        maxSat > 35
          ? [
              Math.max(130, Math.min(245, vibrantR + 35)),
              Math.max(120, Math.min(235, vibrantG + 35)),
              Math.max(145, Math.min(255, vibrantB + 35)),
            ]
          : [162, 155, 254];

      applyComputedRootVariables(
        bgRgb,
        accentRgb,
        false,
        [241, 242, 246],
        [168, 174, 190]
      );
    }
  } catch {
    applyThemeModeFallback(themeMode);
  }
}

export async function applyThemeFromImageSrc(
  imageSrc: string,
  themeMode: 'auto' | 'dark' | 'light' = 'auto'
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
