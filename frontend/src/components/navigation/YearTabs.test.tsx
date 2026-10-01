import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  const translation = { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});

import YearTabs from './YearTabs';

const AVAILABLE = [2024, 2025, 2026, 2027, 2028];

function renderTabs(currentYear: number, availableYears: number[] = AVAILABLE) {
  const onYearChange = vi.fn();
  render(<YearTabs currentYear={currentYear} availableYears={availableYears} onYearChange={onYearChange} />);
  return onYearChange;
}

const tabs = () => screen.getAllByRole('tab').map((tab) => tab.textContent);
const selected = () => screen.getByRole('tab', { selected: true }).textContent;

describe('YearTabs', () => {
  it('a year before the list is shown and selected; Next goes to the first year of the list', () => {
    const onYearChange = renderTabs(2020);
    expect(tabs()).toEqual(['2020', '2024', '2025', '2026', '2027']);
    expect(selected()).toBe('2020');
    expect(screen.getByRole('button', { name: 'yearTabs.previous' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'yearTabs.next' }));
    expect(onYearChange).toHaveBeenCalledWith(2024);
  });

  it('a year after the list is shown and selected; Previous goes to the last year of the list', () => {
    const onYearChange = renderTabs(2031);
    expect(tabs()).toEqual(['2025', '2026', '2027', '2028', '2031']);
    expect(selected()).toBe('2031');
    expect(screen.getByRole('button', { name: 'yearTabs.next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'yearTabs.previous' }));
    expect(onYearChange).toHaveBeenCalledWith(2028);
  });

  it('a year of the list is selected once, with Previous and Next on each side', () => {
    const onYearChange = renderTabs(2026);
    expect(tabs()).toEqual(['2024', '2025', '2026', '2027', '2028']);
    expect(selected()).toBe('2026');
    fireEvent.click(screen.getByRole('button', { name: 'yearTabs.previous' }));
    fireEvent.click(screen.getByRole('button', { name: 'yearTabs.next' }));
    expect(onYearChange.mock.calls).toEqual([[2025], [2027]]);
  });

  it('a list of one other year shows both', () => {
    renderTabs(2020, [2026]);
    expect(tabs()).toEqual(['2020', '2026']);
    expect(selected()).toBe('2020');
  });
});
