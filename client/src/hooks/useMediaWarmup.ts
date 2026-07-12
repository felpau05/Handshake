// Call once near the app root — kicks off camera + ASL model loading
// immediately on page load, instead of waiting for the SPELL phase to mount.
import { useEffect } from 'react';
import { useMediaStore } from '../state/mediaStore.js';

export function useMediaWarmup(): void {
  const warm = useMediaStore((s) => s.warm);
  useEffect(() => {
    void warm();
  }, [warm]);
}
