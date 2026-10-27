import { expect, vi } from 'vitest';

/**
 * jsdom lays nothing out, and MUI places a right-aligned popover from the paper's `offsetWidth`.
 * The paper reports the width its style already names. Restore the spy when the test ends.
 */
export function stubPopoverPaperWidth(): () => void {
  const spy = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('MuiPopover-paper')) {
      const parsed = Number.parseFloat(getComputedStyle(this).width);
      if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
  });
  return () => spy.mockRestore();
}

/** An anchor rect MUI can read. jsdom's own rect is empty. */
export function placeAnchor(element: HTMLElement, box: { left: number; top: number; width: number; height: number }) {
  const { left, top, width, height } = box;
  element.getBoundingClientRect = () => ({
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;
}

function popoverPaper(): HTMLElement {
  const paper = document.querySelector('.MuiPopover-paper');
  if (!(paper instanceof HTMLElement)) throw new Error('popover paper missing');
  return paper;
}

/** The panel's top-left meets the anchor's bottom-left and the panel grows to the right. */
export function expectAnchoredLeft(anchor: { left: number; bottom: number }) {
  const paper = popoverPaper();
  expect(paper.style.left).toBe(`${anchor.left}px`);
  expect(paper.style.top).toBe(`${anchor.bottom}px`);
}

/** The panel's top-right meets the anchor's bottom-right and the panel grows to the left. */
export function expectAnchoredRight(anchorRight: number, width: number) {
  const paper = popoverPaper();
  expect(paper.offsetWidth).toBe(width);
  expect(paper.style.left).toBe(`${anchorRight - width}px`);
}
