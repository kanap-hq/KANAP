import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// Distance from the bottom (px) under which the view counts as "at the bottom".
const PIN_THRESHOLD = 48;

/**
 * Keeps a scroll container glued to its bottom while its content grows
 * (streamed replies, images loading, activity panels expanding), and lets go
 * as soon as the user scrolls up. Scrolling back near the bottom re-pins.
 *
 * Scrolls are instant and only touch the container itself: a smooth
 * scrollIntoView per streamed token restarts an animation on every delta
 * and also scrolls every ancestor, which made the conversation jump.
 *
 * `resetKey` forces a re-pin when it changes (new conversation, message sent).
 */
export function useStickToBottom(resetKey: unknown) {
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLElement | null>(null);
  const pinnedRef = useRef(true);
  const lastTopRef = useRef(0);

  const scrollToBottom = useCallback(() => {
    if (!scrollEl) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }, [scrollEl]);

  // Track whether the user wants to follow the bottom.
  useEffect(() => {
    if (!scrollEl) return undefined;
    lastTopRef.current = scrollEl.scrollTop;
    const onScroll = () => {
      const top = scrollEl.scrollTop;
      const distance = scrollEl.scrollHeight - top - scrollEl.clientHeight;
      if (distance <= PIN_THRESHOLD) {
        pinnedRef.current = true;
      } else if (top < lastTopRef.current) {
        // Only an upward move unpins: content growing between our scroll and
        // this event must not be mistaken for the user leaving the bottom.
        pinnedRef.current = false;
      }
      lastTopRef.current = top;
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) pinnedRef.current = false;
    };
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    scrollEl.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      scrollEl.removeEventListener('scroll', onScroll);
      scrollEl.removeEventListener('wheel', onWheel);
    };
  }, [scrollEl]);

  // Follow content growth while pinned.
  useEffect(() => {
    if (!scrollEl || !contentEl || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) scrollToBottom();
    });
    observer.observe(contentEl);
    return () => observer.disconnect();
  }, [scrollEl, contentEl, scrollToBottom]);

  useLayoutEffect(() => {
    pinnedRef.current = true;
    scrollToBottom();
  }, [resetKey, scrollToBottom]);

  return { scrollRef: setScrollEl, contentRef: setContentEl };
}
