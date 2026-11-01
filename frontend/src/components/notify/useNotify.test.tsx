import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { i18nReady } from '../../i18n';
import { NOTICE_MS, NOTICE_UNDO_MS, NotifyProvider, useNotify, type NotifyOptions } from './NotifyProvider';

function Show({ options }: { options: NotifyOptions }) {
  const notify = useNotify();
  return <button type="button" onClick={() => notify(options)}>Show</button>;
}

function renderNotice(options: NotifyOptions) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <NotifyProvider>
        <Show options={options} />
      </NotifyProvider>
    </ThemeProvider>,
  );
}

describe('useNotify', () => {
  beforeEach(async () => {
    await i18nReady;
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('shows a message, then hides it after 4 seconds', () => {
    renderNotice({ message: 'Recommendation submitted' });
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByRole('status').textContent).toContain('Recommendation submitted');

    act(() => { vi.advanceTimersByTime(NOTICE_MS - 1); });
    expect(screen.getByRole('status').textContent).toContain('Recommendation submitted');

    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('stays 8 seconds when Undo is offered, and Undo runs its callback once', () => {
    const undo = vi.fn();
    renderNotice({ message: 'Link removed', undo });
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByRole('status').textContent).toContain('Link removed');

    act(() => { vi.advanceTimersByTime(NOTICE_MS); });
    expect(screen.getByRole('status').textContent).toContain('Link removed');

    const undoButton = screen.getByRole('button', { name: 'Undo' });
    fireEvent.click(undoButton);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).toBeNull();

    act(() => { vi.advanceTimersByTime(NOTICE_UNDO_MS); });
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('hides an Undo notice after 8 seconds when Undo is not used', () => {
    renderNotice({ message: 'Link removed', undo: () => undefined });
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));

    act(() => { vi.advanceTimersByTime(NOTICE_UNDO_MS - 1); });
    expect(screen.getByRole('status')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('replaces the notice on screen, and the first Undo is not called', () => {
    const firstUndo = vi.fn();
    const secondUndo = vi.fn();
    const notify = { current: null as null | ((options: NotifyOptions) => void) };
    function Two() {
      const send = useNotify();
      notify.current = send;
      return null;
    }
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <NotifyProvider>
          <Two />
        </NotifyProvider>
      </ThemeProvider>,
    );

    act(() => { notify.current?.({ message: 'First', undo: firstUndo }); });
    expect(screen.getByRole('status').textContent).toContain('First');

    act(() => { vi.advanceTimersByTime(NOTICE_MS - 1); });
    act(() => { notify.current?.({ message: 'Second', undo: secondUndo }); });
    expect(screen.getByRole('status').textContent).toContain('Second');
    expect(screen.getByRole('status').textContent).not.toContain('First');

    // The first notice's remaining time must not dismiss the replacement.
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole('status').textContent).toContain('Second');

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(secondUndo).toHaveBeenCalledTimes(1);
    expect(firstUndo).not.toHaveBeenCalled();
  });
});
