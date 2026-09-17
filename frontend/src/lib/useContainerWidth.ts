import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Width of a container element, kept current through a ResizeObserver.
 * Used to size the canvas charts to whatever space the modal actually has
 * (a phone gives them ~340px, a desktop the full 860px) instead of a fixed
 * width that scrolls off-screen on anything narrow.
 */
export function useContainerWidth<T extends HTMLElement>(): [React.RefObject<T>, number | null] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
}
