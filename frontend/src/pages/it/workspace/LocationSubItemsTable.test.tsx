import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

// QA lot 14, point 13: leaving the name of a new row saves it, and the saved row replaced the one
// being typed in, so the first description typed there was lost.
describe('LocationSubItemsTable new rows', () => {
  const stored = { id: 'sub-c', name: 'Room C', description: null };

  beforeEach(() => {
    vi.clearAllMocks();
    mocked.get.mockResolvedValue({ data: [{ id: 'sub-a', name: 'Room A', description: null, usage_count: 0 }] });
    mocked.patch.mockResolvedValue({ data: {} });
  });

  it('saves the first description typed on a sub-location once its name has created it', async () => {
    mocked.post.mockResolvedValueOnce({ data: stored });
    const user = userEvent.setup();
    renderTable();
    await screen.findByDisplayValue('Room A');
    await user.click(screen.getByText('it:workspace.location.subItems.add'));
    await user.type(screen.getByPlaceholderText('it:workspace.location.subItems.namePlaceholder'), 'Room C');
    const descriptions = screen.getAllByPlaceholderText('it:workspace.location.subItems.descriptionPlaceholder');
    await user.click(descriptions[descriptions.length - 1]);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/locations/loc-1/sub-items', { name: 'Room C', description: null }));
    await user.keyboard('North wing');
    await user.tab();
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/locations/loc-1/sub-items/sub-c', {
      name: 'Room C',
      description: 'North wing',
    }));
    expect(screen.getByDisplayValue('North wing')).toBeInTheDocument();
  });

  it('saves a description typed and left while the sub-location is still being created', async () => {
    let resolve!: (value: { data: typeof stored }) => void;
    mocked.post.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const user = userEvent.setup();
    renderTable();
    await screen.findByDisplayValue('Room A');
    await user.click(screen.getByText('it:workspace.location.subItems.add'));
    await user.type(screen.getByPlaceholderText('it:workspace.location.subItems.namePlaceholder'), 'Room C');
    const descriptions = screen.getAllByPlaceholderText('it:workspace.location.subItems.descriptionPlaceholder');
    await user.click(descriptions[descriptions.length - 1]);
    await user.keyboard('North wing');
    await user.tab();
    resolve({ data: stored });
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/locations/loc-1/sub-items/sub-c', {
      name: 'Room C',
      description: 'North wing',
    }));
    expect(screen.getByDisplayValue('North wing')).toBeInTheDocument();
    expect(mocked.post).toHaveBeenCalledTimes(1);
  });
});
