import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});

import ReportExclusionPicker, { EXCLUSION_OPTION_HEIGHT, type ExclusionOption } from './ReportExclusionPicker';

const MANY: ExclusionOption[] = Array.from({ length: 5000 }, (_, i) => ({ id: `id-${i}`, label: `Line ${String(i).padStart(4, '0')}` }));

function Harness({ options, onFirstOpen }: { options: ExclusionOption[] | undefined; onFirstOpen?: () => void }) {
  const [value, setValue] = useState<string[]>([]);
  return (
    <ThemeProvider theme={createAppTheme('light')}>
      <ReportExclusionPicker
        label="Exclude items"
        placeholder="Select items to exclude"
        selectedText={(count) => `${count} selected`}
        noOptionsText="No matching items"
        options={options}
        loading={!options}
        onFirstOpen={onFirstOpen}
        value={value}
        onChange={setValue}
      />
    </ThemeProvider>
  );
}

const open = () => fireEvent.keyDown(screen.getByRole('combobox', { name: 'Exclude items' }), { key: 'ArrowDown' });

describe('ReportExclusionPicker', () => {
  it('asks for its options when first opened, not before', () => {
    const onFirstOpen = vi.fn();
    render(<Harness options={undefined} onFirstOpen={onFirstOpen} />);
    expect(onFirstOpen).not.toHaveBeenCalled();
    open();
    expect(onFirstOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByText('reports.shared.loadingData')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Exclude items' }), { key: 'Escape' });
    open();
    expect(onFirstOpen).toHaveBeenCalledTimes(1);
  });

  it('draws a window of rows of 5,000 options, the height of every row kept', () => {
    render(<Harness options={MANY} />);
    open();
    const listbox = screen.getByRole('listbox');
    const drawn = within(listbox).getAllByRole('option');
    expect(drawn.length).toBeGreaterThan(10);
    expect(drawn.length).toBeLessThan(100);
    expect(drawn[0].textContent).toBe('Line 0000');
    const spacer = listbox.querySelector('li[aria-hidden]') as HTMLElement;
    expect(spacer.style.height).toBe(`${(MANY.length - drawn.length) * EXCLUSION_OPTION_HEIGHT}px`);

    // Scrolled down, the window moves.
    Object.defineProperty(listbox, 'scrollTop', { value: 2000 * EXCLUSION_OPTION_HEIGHT, configurable: true });
    fireEvent.scroll(listbox);
    const moved = within(listbox).getAllByRole('option').map((option) => option.textContent);
    expect(moved).toContain('Line 2000');
    expect(moved).not.toContain('Line 0100');
    // The first and the last option stay drawn (Home and End reach them).
    expect(moved[0]).toBe('Line 0000');
    expect(moved[moved.length - 1]).toBe('Line 4999');
  });

  it('keeps the highlighted option drawn: arrow keys past the window, End, Home, PageDown', () => {
    render(<Harness options={MANY.slice(0, 400)} />);
    const input = screen.getByRole('combobox', { name: 'Exclude items' });
    open();
    const highlighted = () => {
      const id = input.getAttribute('aria-activedescendant');
      return id ? document.getElementById(id)?.textContent : null;
    };
    // The first ArrowDown opened the list; each next one moves the highlight one row, past the drawn window.
    for (let i = 0; i < 60; i += 1) fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(highlighted()).toBe('Line 0059');
    fireEvent.keyDown(input, { key: 'PageDown' });
    expect(highlighted()).toBe('Line 0064');
    fireEvent.keyDown(input, { key: 'End' });
    expect(highlighted()).toBe('Line 0399');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(highlighted()).toBe('Line 0398');
    fireEvent.keyDown(input, { key: 'Home' });
    expect(highlighted()).toBe('Line 0000');
    // The rows drawn stay a window, not the whole list.
    expect(within(screen.getByRole('listbox')).getAllByRole('option').length).toBeLessThan(100);
  });

  it('names a cut option in full on hover', () => {
    const long = 'A very long line name that a narrow list cuts with an ellipsis';
    render(<Harness options={[{ id: 'x', label: long }, ...MANY.slice(0, 5)]} />);
    open();
    expect(screen.getByRole('option', { name: long })).toHaveAttribute('title', long);
  });

  it('searches every option, picks one and counts it', () => {
    render(<Harness options={MANY} />);
    const input = screen.getByRole('combobox', { name: 'Exclude items' });
    fireEvent.focus(input);
    open();
    fireEvent.change(input, { target: { value: 'Line 4321' } });
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getAllByRole('option').map((option) => option.textContent)).toEqual(['Line 4321']);
    fireEvent.click(within(listbox).getByRole('option', { name: 'Line 4321' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });
});
