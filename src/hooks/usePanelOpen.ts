import { useEffect, useState } from 'react';

/**
 * Reads the open/closed flag out of a host event payload.
 * Accepts a bare boolean or an object shaped `{ open: boolean }`; returns null when absent.
 */
function readOpenDetail(detail: unknown): boolean | null {
  if (typeof detail === 'boolean') {
    return detail;
  }
  if (detail && typeof detail === 'object' && 'open' in detail) {
    const value = detail.open;
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return null;
}

/**
 * True while the Canopy panel is expanded.
 * Backed by the host `canopy:set-open` (boolean or `{ open }`) and `toggle-dropdown` events.
 */
export function usePanelOpen(): boolean {
  const [isOpen, setIsOpen] = useState<boolean>(true);

  useEffect(() => {
    const onSetOpen = (event: Event) => {
      const next = readOpenDetail((event as CustomEvent<unknown>).detail);
      if (next !== null) {
        setIsOpen(next);
      }
    };

    const onToggle = (event: Event) => {
      const next = readOpenDetail((event as CustomEvent<unknown>).detail);
      if (next !== null) {
        setIsOpen(next);
      } else {
        setIsOpen((prev) => !prev);
      }
    };

    window.addEventListener('canopy:set-open', onSetOpen);
    window.addEventListener('toggle-dropdown', onToggle);

    return () => {
      window.removeEventListener('canopy:set-open', onSetOpen);
      window.removeEventListener('toggle-dropdown', onToggle);
    };
  }, []);

  return isOpen;
}

export default usePanelOpen;
