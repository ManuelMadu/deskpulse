import { useEffect, useRef } from 'react';

/**
 * Visibility-aware polling (PDD FR-3, OD-9): fires immediately, then every
 * `intervalMs`; fully stops while the document is hidden so a closed or
 * hidden window generates zero agent traffic, and fires again the moment
 * visibility returns.
 */
export function usePolling(fn: () => void | Promise<void>, intervalMs: number): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    const tick = (): void => {
      void fnRef.current();
    };

    const start = (): void => {
      if (timer === undefined) {
        tick();
        timer = setInterval(tick, intervalMs);
      }
    };

    const stop = (): void => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        start();
      } else {
        stop();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    onVisibility();

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [intervalMs]);
}
