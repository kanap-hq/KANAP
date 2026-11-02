import { render, screen } from '@testing-library/react';
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
});
