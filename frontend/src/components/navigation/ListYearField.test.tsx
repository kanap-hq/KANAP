import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));

import ListYearField from './ListYearField';

function renderField(draft: string, year: number) {
  const onChange = vi.fn();
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <ListYearField draft={draft} year={year} onChange={onChange} />
    </ThemeProvider>,
  );
  return onChange;
}

const yearInput = () => screen.getByLabelText('shared.fields.year');
const previous = () => screen.getByRole('button', { name: 'common:yearTabs.previous' });
const next = () => screen.getByRole('button', { name: 'common:yearTabs.next' });

describe('ListYearField', () => {
  afterEach(() => cleanup());

  it('reports a partial year as typed and a complete year as typed', () => {
    const onChange = renderField('2026', 2026);
    fireEvent.change(yearInput(), { target: { value: '2' } });
    fireEvent.change(yearInput(), { target: { value: '2030' } });
    expect(onChange.mock.calls).toEqual([['2'], ['2030']]);
  });

  it('steps from the year on screen, including while a partial year is typed', () => {
    const onChange = renderField('20', 2026);
    fireEvent.click(previous());
    fireEvent.click(next());
    expect(onChange.mock.calls).toEqual([['2025'], ['2027']]);
  });

  it('stops the previous arrow at 1900', () => {
    const onChange = renderField('1900', 1900);
    expect(previous()).toBeDisabled();
    fireEvent.click(previous());
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(next());
    expect(onChange).toHaveBeenCalledWith('1901');
  });

  it('is the height of an action pill', () => {
    renderField('2026', 2026);
    const field = yearInput().closest('.MuiInputBase-root') as HTMLElement;
    const row = yearInput().closest('.MuiStack-root') as HTMLElement;
    expect(getComputedStyle(field).height).toBe('31px');
    expect(getComputedStyle(previous()).height).toBe('31px');
    expect(getComputedStyle(next()).height).toBe('31px');
    expect(getComputedStyle(row).height).toBe('31px');
  });

  it('stops the next arrow at 2999', () => {
    const onChange = renderField('2999', 2999);
    expect(next()).toBeDisabled();
    fireEvent.click(next());
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(previous());
    expect(onChange).toHaveBeenCalledWith('2998');
  });
});
