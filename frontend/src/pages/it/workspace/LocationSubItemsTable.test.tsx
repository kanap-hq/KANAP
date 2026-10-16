import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';

const stableT = vi.hoisted(() => (key: string) => key);
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
  Trans: ({ i18nKey }: { i18nKey?: string }) => i18nKey ?? null,
}));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

import api from '../../../api';
import LocationSubItemsTable from './LocationSubItemsTable';

const mocked = api as unknown as Record<'get' | 'post' | 'patch', ReturnType<typeof vi.fn>>;
const duplicate = { response: { status: 409, data: { code: 'duplicate', message: 'Sub-location "room b" already exists at this location' } } };

function renderTable() {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <LocationSubItemsTable locationId="loc-1" canManage />
    </ThemeProvider>,
  );
}

describe('LocationSubItemsTable name refusals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.get.mockResolvedValue({ data: [
      { id: 'sub-a', name: 'Room A', description: null, usage_count: 0 },
      { id: 'sub-b', name: 'Room B', description: null, usage_count: 0 },
    ] });
  });

  it('says another sub-location has the name, under that row, when a rename is a duplicate', async () => {
    mocked.patch.mockRejectedValueOnce(duplicate);
    renderTable();
    const input = await screen.findByDisplayValue('Room A');
    fireEvent.change(input, { target: { value: 'room b' } });
    fireEvent.blur(input);
    expect(await screen.findByText('messages.subLocationNameTaken')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(screen.getByDisplayValue('Room A')).toHaveAttribute('aria-invalid', 'true'));
  });

  it('keeps a new row refused as a duplicate, with the reason under its name', async () => {
    mocked.post.mockRejectedValueOnce(duplicate);
    renderTable();
    await screen.findByDisplayValue('Room A');
    fireEvent.click(screen.getByText('it:workspace.location.subItems.add'));
    const input = screen.getByPlaceholderText('it:workspace.location.subItems.namePlaceholder');
    fireEvent.change(input, { target: { value: 'room b' } });
    fireEvent.blur(input);
    expect(await screen.findByText('messages.subLocationNameTaken')).toBeInTheDocument();
    expect(screen.getByDisplayValue('room b')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
