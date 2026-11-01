import { useEffect, useState } from 'react';

/** Counts finished font loads, so a still canvas drawn on fallback metrics draws again once its face is in. */
export function useFontTick(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const fonts = globalThis.document?.fonts;
    if (!fonts) return;
    const on = () => setN((x) => x + 1);
    fonts.addEventListener('loadingdone', on);
    return () => fonts.removeEventListener('loadingdone', on);
  }, []);
  return n;
}
