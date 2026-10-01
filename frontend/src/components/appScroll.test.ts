import { afterEach, describe, expect, it, vi } from 'vitest';
import { canTakeFocus, focusPageScroller } from './appScroll';

function setup() {
  document.body.innerHTML = `
    <nav><a id="nav-link" href="/x">Nav</a></nav>
    <div id="scroller" tabindex="-1">
      <button id="page-button" type="button">Tab</button>
      <input id="page-input" />
    </div>
    <div role="dialog"><button id="dialog-button" type="button">OK</button></div>
  `;
  return document.getElementById('scroller') as HTMLElement;
}

const el = (id: string) => document.getElementById(id) as HTMLElement;
const flushMutations = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('canTakeFocus', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('takes focus that is nowhere, on the app scroller, or on the link that navigated', () => {
    const scroller = setup();
    expect(canTakeFocus(scroller, document.body, true)).toBe(true);
    expect(canTakeFocus(scroller, scroller, false)).toBe(true);
    expect(canTakeFocus(scroller, el('nav-link'), true)).toBe(true);
    expect(canTakeFocus(scroller, el('page-button'), true)).toBe(true);
  });

  it('never takes it from a field, a dialog, or once the page has had a chance to focus something', () => {
    const scroller = setup();
    expect(canTakeFocus(scroller, el('page-input'), true)).toBe(false);
    expect(canTakeFocus(scroller, el('dialog-button'), true)).toBe(false);
    expect(canTakeFocus(scroller, el('nav-link'), false)).toBe(false);
    expect(canTakeFocus(scroller, el('page-button'), false)).toBe(false);
  });

  it('leaves focus that is already inside the workspace content column', () => {
    const scroller = setup();
    scroller.insertAdjacentHTML('beforeend', '<div data-primary-scroll tabindex="-1"><a id="inner" href="/y">y</a></div>');
    expect(canTakeFocus(scroller, el('inner'), true)).toBe(false);
  });
});

describe('focusPageScroller', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('focuses the app scroller when the page has no content column', () => {
    const scroller = setup();
    el('nav-link').focus();
    const stop = focusPageScroller(scroller);
    expect(document.activeElement).toBe(scroller);
    stop();
  });

  it('moves focus to the workspace content column once it renders', async () => {
    const scroller = setup();
    el('nav-link').focus();
    const stop = focusPageScroller(scroller);
    expect(document.activeElement).toBe(scroller);

    scroller.insertAdjacentHTML('beforeend', '<div id="column" data-primary-scroll tabindex="-1"></div>');
    await flushMutations();
    expect(document.activeElement).toBe(el('column'));
    stop();
  });

  it('does not steal focus from a field the page focused while loading', async () => {
    const scroller = setup();
    const stop = focusPageScroller(scroller);
    el('page-input').focus();

    scroller.insertAdjacentHTML('beforeend', '<div id="column" data-primary-scroll tabindex="-1"></div>');
    await flushMutations();
    expect(document.activeElement).toBe(el('page-input'));
    stop();
  });

  it('focuses without scrolling and stops watching after the timeout', async () => {
    vi.useFakeTimers();
    const scroller = setup();
    const focusSpy = vi.spyOn(scroller, 'focus');
    focusPageScroller(scroller, 100);
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });

    vi.advanceTimersByTime(150);
    vi.useRealTimers();
    document.body.focus();
    scroller.insertAdjacentHTML('beforeend', '<div id="late" data-primary-scroll tabindex="-1"></div>');
    await flushMutations();
    expect(document.activeElement).not.toBe(el('late'));
  });
});
