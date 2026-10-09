import { vi } from 'vitest';

/**
 * jsdom lays nothing out and answers null for `offsetParent`. Its computed style now says
 * `position: static`, so ag-grid asks for the offset parent of its popup parent and reads null.
 * Call this in a `beforeEach` of a test that opens a grid menu.
 */
export function stubOffsetParent() {
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
    return this.parentElement;
  });
}
