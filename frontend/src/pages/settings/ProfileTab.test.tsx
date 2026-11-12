import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ProfileTab from './ProfileTab';

vi.mock('react-i18next', async () => {
  const { default: settings } = await import('../../locales/en/settings.json');
  // One stable `t` that renders the English text of settings keys, with interpolation; other keys render as themselves.
  const t = (key: string, options?: Record<string, string>) => {
    const path = key.startsWith('settings:') ? key.slice('settings:'.length) : key;
    const value = path.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], settings);
    if (typeof value !== 'string') return key;
    return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => options?.[name] ?? '');
  };
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

// ProfileTab reads the language list from the i18n module, which initialises i18next. The mock above replaces react-i18next, so that module must not load.
vi.mock('../../i18n', () => ({
  SUPPORTED_LANGUAGES: [
    { code: 'en', nativeLabel: 'English' },
    { code: 'fr', nativeLabel: 'Français' },
    { code: 'de', nativeLabel: 'Deutsch' },
    { code: 'es', nativeLabel: 'Español' },
  ],
}));

const api = vi.hoisted(() => ({ patch: vi.fn() }));
vi.mock('../../api', () => ({ default: api }));

const auth = vi.hoisted(() => ({
  profile: {
    id: 'user-1',
    email: 'ada@example.com',
    first_name: 'Ada',
    last_name: 'Lovelace',
    job_title: '',
    business_phone: '' as string | null,
    mobile_phone: '' as string | null,
    locale: 'en',
    status: 'enabled',
  },
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: () => false,
    isAuthenticating: false,
    profile: auth.profile,
    refreshMe: vi.fn(),
  }),
}));

function renderTab() {
  return render(
    <MemoryRouter>
      <ProfileTab />
    </MemoryRouter>,
  );
}

describe('ProfileTab', () => {
  it('shows translated phone examples on the empty fields', () => {
    auth.profile.business_phone = '';
    auth.profile.mobile_phone = '';
    renderTab();

    const business = screen.getByLabelText('Business phone');
    const mobile = screen.getByLabelText('Mobile phone');
    expect(business).toHaveValue('');
    expect(mobile).toHaveValue('');
    expect(business).toHaveAttribute('placeholder', 'e.g., +33 1 23 45 67 89');
    expect(mobile).toHaveAttribute('placeholder', 'e.g., +33 6 12 34 56 78');
    expect(screen.queryByPlaceholderText('+1 (555) 123-4567')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('+1 (555) 987-6543')).not.toBeInTheDocument();
  });

  it('saves a language chosen just before the click: the menu is gone at once', async () => {
    api.patch.mockResolvedValue({ data: {} });
    // jsdom has no layout: give the menu a height, so a fading menu would take real time to leave.
    const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
    try {
      renderTab();

      const language = screen.getByRole('combobox', { name: 'Language' });
      language.focus();
      fireEvent.mouseDown(language);
      fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Français' }));

      // A menu still on screen covers "Save changes" and holds the focus: it must leave before the next click.
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(screen.queryByRole('listbox', { hidden: true })).not.toBeInTheDocument();
      // The focus comes back to the list, so Tab goes on to "Save changes".
      expect(language).toHaveFocus();

      fireEvent.click(screen.getByRole('button', { name: 'common:buttons.saveChanges' }));

      await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
      expect(api.patch).toHaveBeenCalledWith('/users/me', expect.objectContaining({ locale: 'fr' }));
    } finally {
      height.mockRestore();
    }
  });
});
