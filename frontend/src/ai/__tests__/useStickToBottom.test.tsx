import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStickToBottom } from '../useStickToBottom';

let resizeCallback: (() => void) | null = null;

class FakeResizeObserver {
  constructor(cb: () => void) { resizeCallback = cb; }
  observe() {}
  disconnect() {}
}

const originalResizeObserver = globalThis.ResizeObserver;

function Harness({ resetKey }: { resetKey: string }) {
  const { scrollRef, contentRef } = useStickToBottom(resetKey);
  return (
    <div ref={scrollRef} data-testid="scroll">
      <div ref={contentRef} />
    </div>
  );
}

// jsdom has no layout: drive scrollHeight / clientHeight by hand.
function setup(resetKey = 'a') {
  const utils = render(<Harness resetKey={resetKey} />);
  const el = utils.getByTestId('scroll');
  let scrollHeight = 1000;
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 400 });
  const grow = (px: number) => {
    scrollHeight += px;
    act(() => { resizeCallback?.(); });
  };
  const userScrollTo = (top: number) => {
    el.scrollTop = top;
    act(() => { el.dispatchEvent(new Event('scroll')); });
  };
  return { ...utils, el, grow, userScrollTo };
}

describe('useStickToBottom', () => {
  beforeEach(() => {
    resizeCallback = null;
    (globalThis as any).ResizeObserver = FakeResizeObserver;
  });
  afterEach(() => {
    (globalThis as any).ResizeObserver = originalResizeObserver;
  });

  it('follows content growth while at the bottom', () => {
    const { el, grow, userScrollTo } = setup();
    userScrollTo(600);
    grow(200);
    expect(el.scrollTop).toBe(1200);
  });

  it('stops following once the user scrolls up, and resumes near the bottom', () => {
    const { el, grow, userScrollTo } = setup();
    userScrollTo(600);
    userScrollTo(200);
    grow(200);
    expect(el.scrollTop).toBe(200);

    userScrollTo(790);
    grow(100);
    expect(el.scrollTop).toBe(1300);
  });

  it('unpins on an upward wheel before the scroll event lands', () => {
    const { el, grow, userScrollTo } = setup();
    userScrollTo(600);
    act(() => { el.dispatchEvent(new WheelEvent('wheel', { deltaY: -40 })); });
    grow(200);
    expect(el.scrollTop).toBe(600);
  });

  it('re-pins when the reset key changes', () => {
    const { el, grow, userScrollTo, rerender } = setup('a');
    userScrollTo(600);
    userScrollTo(100);
    rerender(<Harness resetKey="b" />);
    grow(50);
    expect(el.scrollTop).toBe(1050);
  });
});
