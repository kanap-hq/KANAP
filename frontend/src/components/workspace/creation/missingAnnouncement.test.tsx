import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { PropertyRow } from '../../design';
import CreationActions from './CreationActions';
import useMissingMarks from './useMissingMarks';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { fields?: string }) => (options?.fields ? `${key}: ${options.fields}` : key),
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));

/** A record page: Create marks the fields still empty, as every page through `useMissingMarks`. */
function Page({ empty }: { empty: () => string[] }) {
  const marks = useMissingMarks({ recordKey: 'new', missingNow: empty, valueOf: () => '' });
  return (
    <ThemeProvider theme={createAppTheme('light')}>
      <div data-workspace-shell="">
        <CreationActions onCreate={() => marks.mark(empty())} onCancel={vi.fn()} />
        <PropertyRow label="Paying company" required missing={marks.marked.has('company')}><input aria-label="company" /></PropertyRow>
        <PropertyRow label="IT tower" required missing={marks.marked.has('tower')}><input aria-label="tower" /></PropertyRow>
        <PropertyRow label="Account" required missing={marks.marked.has('account')}><input aria-label="account" /></PropertyRow>
      </div>
    </ThemeProvider>
  );
}

const create = () => fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
const announcement = () => screen.getAllByRole('status').map((node) => node.textContent).join('');

describe('the announcement of the missing fields', () => {
  it('has one polite region, empty until a check marks fields, then names them in screen order', async () => {
    render(<Page empty={() => ['account', 'company']} />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(announcement()).toBe('');
    create();
    await waitFor(() => expect(announcement()).toBe('common:creation.missingFields: paying company, account'));
  });

  it('keeps an acronym label as it is', async () => {
    render(<Page empty={() => ['tower']} />);
    create();
    await waitFor(() => expect(announcement()).toBe('common:creation.missingFields: IT tower'));
  });

  it('says nothing when the check finds nothing missing', async () => {
    render(<Page empty={() => []} />);
    create();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
    expect(announcement()).toBe('');
  });

  it('does not repeat on its own, and says it again at the next refused Create', async () => {
    render(<Page empty={() => ['company']} />);
    create();
    await waitFor(() => expect(announcement()).not.toBe(''));
    const region = screen.getByRole('status');
    const writes: string[] = [];
    new MutationObserver(() => writes.push(region.textContent ?? '')).observe(region, { childList: true, characterData: true, subtree: true });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
    expect(writes).toEqual([]);
    create();
    await waitFor(() => expect(writes).toContain(''));
    await waitFor(() => expect(writes[writes.length - 1]).toBe('common:creation.missingFields: paying company'));
  });
});
