import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useIncompleteLeave from './useIncompleteLeave';

vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  const i18n = { resolvedLanguage: 'en', language: 'en' };
  return { useTranslation: () => ({ t, i18n }) };
});

type Props = { beingCreated: boolean; lacking: boolean };

function mount(initial: Props) {
  const discardOnUnload = vi.fn();
  const view = renderHook((props: Props) => useIncompleteLeave({
    keys: 'it:workspace.asset.creation',
    beingCreated: props.beingCreated,
    missing: () => (props.lacking ? [{ key: 'location', label: 'Site' }] : []),
    focus: vi.fn(),
    onDelete: vi.fn().mockResolvedValue(true),
    discardOnUnload,
  }), { initialProps: initial });
  return { ...view, discardOnUnload };
}

function beforeUnload(): BeforeUnloadEvent {
  const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
  window.dispatchEvent(event);
  return event;
}

function pageHide(persisted = false) {
  const event = new Event('pagehide') as PageTransitionEvent;
  Object.defineProperty(event, 'persisted', { value: persisted });
  window.dispatchEvent(event);
}

describe('useIncompleteLeave on a reload or a closed tab', () => {
  afterEach(() => vi.restoreAllMocks());

  it('asks the browser question while the record is being created and lacks a field', () => {
    mount({ beingCreated: true, lacking: true });
    expect(beforeUnload().defaultPrevented).toBe(true);
  });

  it('asks nothing once the field is given, or when the record is not being created', () => {
    const view = mount({ beingCreated: true, lacking: true });
    view.rerender({ beingCreated: true, lacking: false });
    expect(beforeUnload().defaultPrevented).toBe(false);
    view.rerender({ beingCreated: false, lacking: true });
    expect(beforeUnload().defaultPrevented).toBe(false);
  });

  it('asks nothing after Create or Cancel ended the creation, and after the page left', () => {
    const view = mount({ beingCreated: true, lacking: true });
    view.rerender({ beingCreated: false, lacking: true });
    expect(beforeUnload().defaultPrevented).toBe(false);
    pageHide();
    expect(view.discardOnUnload).not.toHaveBeenCalled();

    const other = mount({ beingCreated: true, lacking: true });
    other.unmount();
    expect(beforeUnload().defaultPrevented).toBe(false);
    pageHide();
    expect(other.discardOnUnload).not.toHaveBeenCalled();
  });

  it('deletes the incomplete record once when the page is gone', () => {
    const view = mount({ beingCreated: true, lacking: true });
    pageHide();
    expect(view.discardOnUnload).toHaveBeenCalledTimes(1);
  });

  it('keeps the record when the page only goes to the back-forward cache', () => {
    const view = mount({ beingCreated: true, lacking: true });
    pageHide(true);
    expect(view.discardOnUnload).not.toHaveBeenCalled();
  });

  it('keeps a complete record, and a record not being created', () => {
    const complete = mount({ beingCreated: true, lacking: false });
    const left = mount({ beingCreated: false, lacking: true });
    pageHide();
    expect(complete.discardOnUnload).not.toHaveBeenCalled();
    expect(left.discardOnUnload).not.toHaveBeenCalled();
  });

  it('keeps the record when the tab only becomes hidden', () => {
    const view = mount({ beingCreated: true, lacking: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('blur'));
    expect(view.discardOnUnload).not.toHaveBeenCalled();
  });
});
