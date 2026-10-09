import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import DateCalendarPopover, { CALENDAR_HEIGHT, computeCalendarPlacement } from './DateCalendarPopover';

const fullDate = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dayLabel = (y: number, m: number, d: number) => fullDate.format(new Date(y, m - 1, d));

const anchors: HTMLElement[] = [];

function anchorAt(top: number, bottom: number): HTMLElement {
  const anchor = document.createElement('div');
  document.body.appendChild(anchor);
  anchors.push(anchor);
  anchor.getBoundingClientRect = () =>
    ({ top, bottom, left: 20, right: 220, width: 200, height: bottom - top, x: 20, y: top, toJSON: () => ({}) }) as DOMRect;
  return anchor;
}

function renderCalendar(props: Partial<React.ComponentProps<typeof DateCalendarPopover>> = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const { unmount } = render(
    <ThemeProvider theme={createAppTheme('light')}>
      <DateCalendarPopover
        anchorEl={props.anchorEl ?? anchorAt(100, 132)}
        open
        valueYmd="2026-10-14"
        onSelect={onSelect}
        onClose={onClose}
        {...props}
      />
    </ThemeProvider>,
  );
  return { onSelect, onClose, unmount };
}

const heading = () => within(screen.getByRole('dialog')).getByText(/\d{4}$/);

describe('DateCalendarPopover', () => {
  beforeEach(() => {
    // Only Date is faked: MUI's transitions still need real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 9, 10, 0, 0));
    window.innerHeight = 800;
  });

  afterEach(() => {
    vi.useRealTimers();
    anchors.splice(0).forEach((anchor) => anchor.remove());
  });

  it("shows the value's month, weeks starting on Monday", () => {
    renderCalendar();
    expect(heading()).toHaveTextContent('October 2026');
    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(7);
    expect(headers[0]).toHaveAttribute('aria-label', 'Monday');
    expect(headers[6]).toHaveAttribute('aria-label', 'Sunday');
    // 1 Oct 2026 is a Thursday: the grid opens on Monday 28 Sep, dimmed but still a day button.
    const grid = screen.getByRole('grid');
    const days = within(grid).getAllByRole('button');
    expect(days).toHaveLength(42);
    expect(days[0]).toHaveAttribute('aria-label', dayLabel(2026, 9, 28));
    expect(days[41]).toHaveAttribute('aria-label', dayLabel(2026, 11, 8));
  });

  it('marks the selected day and today', () => {
    renderCalendar();
    const selected = screen.getByRole('button', { name: dayLabel(2026, 10, 14) });
    expect(selected.closest('[role="gridcell"]')).toHaveAttribute('aria-selected', 'true');
    const today = screen.getByRole('button', { name: dayLabel(2026, 10, 9) });
    expect(today).toHaveAttribute('aria-current', 'date');
    expect(selected).not.toHaveAttribute('aria-current');
  });

  it('emits the clicked day as YYYY-MM-DD and closes', () => {
    const { onSelect, onClose } = renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: dayLabel(2026, 10, 20) }));
    expect(onSelect).toHaveBeenCalledWith('2026-10-20');
    expect(onClose).toHaveBeenCalled();
  });

  it('picks a day of the next month from the dimmed tail of the grid', () => {
    const { onSelect } = renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: dayLabel(2026, 11, 2) }));
    expect(onSelect).toHaveBeenCalledWith('2026-11-02');
  });

  it('moves by month and by year', () => {
    renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(heading()).toHaveTextContent('November 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Previous year' }));
    expect(heading()).toHaveTextContent('November 2025');
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(heading()).toHaveTextContent('September 2025');
    fireEvent.click(screen.getByRole('button', { name: 'Next year' }));
    expect(heading()).toHaveTextContent('September 2026');
  });

  it('opens on today when the field is empty, and Today picks it', () => {
    const { onSelect, onClose } = renderCalendar({ valueYmd: '' });
    expect(heading()).toHaveTextContent('October 2026');
    expect(document.activeElement).toHaveAttribute('aria-label', dayLabel(2026, 10, 9));
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(onSelect).toHaveBeenCalledWith('2026-10-09');
    expect(onClose).toHaveBeenCalled();
  });

  it('offers Clear only when allowed and the field has a value', () => {
    const { onSelect } = renderCalendar({ allowClear: true });
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onSelect).toHaveBeenCalledWith('');
  });

  it('hides Clear without allowClear or without a value', () => {
    const { unmount } = renderCalendar();
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    unmount();
    renderCalendar({ allowClear: true, valueYmd: '' });
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });

  it('ignores a time part in the value', () => {
    renderCalendar({ valueYmd: '2027-03-31T00:00:00.000Z' });
    expect(heading()).toHaveTextContent('March 2027');
  });

  describe('keyboard', () => {
    const active = () => document.activeElement as HTMLElement;
    const press = (key: string, init: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(active(), { key, ...init });

    it('focuses the selected day, then moves by day, week, month and year', () => {
      const { onSelect, onClose } = renderCalendar();
      expect(active()).toHaveAttribute('aria-label', dayLabel(2026, 10, 14));
      expect(active()).toHaveAttribute('tabindex', '0');

      press('ArrowRight');
      expect(active()).toHaveAttribute('aria-label', dayLabel(2026, 10, 15));
      press('ArrowDown');
      expect(active()).toHaveAttribute('aria-label', dayLabel(2026, 10, 22));
      press('ArrowLeft');
      press('ArrowUp');
      expect(active()).toHaveAttribute('aria-label', dayLabel(2026, 10, 14));
      press('Home');
      expect(active()).toHaveAttribute('aria-label', dayLabel(2026, 10, 12));
      press('End');
      expect(active()).toHaveAttribute('aria-label', dayLabel(2026, 10, 18));
      press('PageDown');
      expect(heading()).toHaveTextContent('November 2026');
      expect(active()).toHaveAttribute('aria-label', dayLabel(2026, 11, 18));
      press('PageUp', { shiftKey: true });
      expect(heading()).toHaveTextContent('November 2025');
      expect(active()).toHaveAttribute('aria-label', dayLabel(2025, 11, 18));

      press('Enter');
      expect(onSelect).toHaveBeenCalledWith('2025-11-18');
      expect(onClose).toHaveBeenCalled();
    });

    it('changes month when an arrow leaves it, and clamps a month jump to the last day', () => {
      renderCalendar({ valueYmd: '2026-01-31' });
      press('ArrowRight');
      expect(heading()).toHaveTextContent('February 2026');
      expect(active()).toHaveAttribute('aria-label', dayLabel(2026, 2, 1));
      press('ArrowLeft');
      press('PageDown');
      expect(active()).toHaveAttribute('aria-label', dayLabel(2026, 2, 28));
    });

    it('selects with Space', () => {
      const { onSelect } = renderCalendar();
      press(' ');
      expect(onSelect).toHaveBeenCalledWith('2026-10-14');
    });

    it('closes on Escape', () => {
      const { onSelect, onClose } = renderCalendar();
      press('Escape');
      expect(onClose).toHaveBeenCalled();
      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  describe('placement', () => {
    it('opens below the field when it fits there', () => {
      expect(computeCalendarPlacement({ top: 100, bottom: 132 }, 800)).toBe('below');
    });

    it('opens above the field when the room below is short and there is more above', () => {
      expect(computeCalendarPlacement({ top: 700, bottom: 732 }, 800)).toBe('above');
    });

    it('stays below when the room above is not larger', () => {
      // 150 px each side: neither fits, so the calendar keeps its default side and MUI clamps it.
      expect(computeCalendarPlacement({ top: 150, bottom: 182 }, 332)).toBe('below');
    });

    it('opens above exactly when the calendar does not fit below', () => {
      const height = CALENDAR_HEIGHT + 4;
      expect(computeCalendarPlacement({ top: 500, bottom: 532 }, 532 + height)).toBe('below');
      expect(computeCalendarPlacement({ top: 500, bottom: 532 }, 532 + height - 1)).toBe('above');
    });

    it('applies the placement to the rendered calendar', () => {
      const { unmount } = renderCalendar({ anchorEl: anchorAt(100, 132) });
      expect(screen.getByRole('dialog')).toHaveAttribute('data-placement', 'below');
      unmount();
      renderCalendar({ anchorEl: anchorAt(720, 752) });
      expect(screen.getByRole('dialog')).toHaveAttribute('data-placement', 'above');
    });
  });
});
