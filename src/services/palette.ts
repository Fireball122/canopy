function setRootThemeVariables(isLight: boolean): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = isLight ? 'light' : 'dark';

  if (isLight) {
    root.style.setProperty('--theme-bg', 'rgba(244, 239, 234, var(--glass-opacity, 0.88))');
    root.style.setProperty('--theme-card', 'rgba(0, 0, 0, 0.04)');
    root.style.setProperty('--theme-border', 'rgba(0, 0, 0, 0.08)');
    root.style.setProperty('--theme-text-primary', '#2C2623');
    root.style.setProperty('--theme-text-secondary', '#736862');
    root.style.setProperty('--theme-accent', '#B85C4B');
    root.style.setProperty('--theme-track', 'rgba(0, 0, 0, 0.08)');
  } else {
    root.style.setProperty('--theme-bg', 'rgba(18, 18, 24, var(--glass-opacity, 0.86))');
    root.style.setProperty('--theme-card', 'rgba(255, 255, 255, 0.04)');
    root.style.setProperty('--theme-border', 'rgba(255, 255, 255, 0.08)');
    root.style.setProperty('--theme-text-primary', '#F8FAFC');
    root.style.setProperty('--theme-text-secondary', '#94A3B8');
    root.style.setProperty('--theme-accent', '#A29BFE');
    root.style.setProperty('--theme-track', 'rgba(255, 255, 255, 0.10)');
  }
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
  setRootThemeVariables(isLight);
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

    for (let i = 0; i < data.length; i += 16) {
      rSum += data[i];
      gSum += data[i + 1];
      bSum += data[i + 2];
      count++;
    }

    if (count === 0) {
      applyThemeModeFallback(themeMode);
      return;
    }

    const avgR = Math.round(rSum / count);
    const avgG = Math.round(gSum / count);
    const avgB = Math.round(bSum / count);

    // Perceived luminance formula
    const brightness = (avgR * 299 + avgG * 587 + avgB * 114) / 1000;
    const isLight =
      themeMode === 'light'
        ? true
        : themeMode === 'dark'
          ? false
          : brightness > 140;

    setRootThemeVariables(isLight);
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
