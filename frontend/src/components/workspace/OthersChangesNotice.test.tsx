import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import i18next from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import frCommon from '../../locales/fr/common.json';
import enCommon from '../../locales/en/common.json';

// The real French and English strings: the wording is what this lot is about.
const instance = i18next.createInstance();
void instance.init({
  lng: 'fr',
  resources: { fr: { common: frCommon }, en: { common: enCommon } },
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  initImmediate: false,
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => instance.t(key, options), i18n: { language: instance.language, resolvedLanguage: instance.language } }),
}));

import OthersChangesNotice, { othersChangeMessage } from './OthersChangesNotice';

const theme = createAppTheme('light');
const t = (key: string, options?: Record<string, unknown>) => instance.t(key, options) as string;
const MARIE = { id: 'marie', name: 'Marie Dupont' };
// 14:02 local time, today.
const today = new Date();
today.setHours(14, 2, 0, 0);
const at = today.toISOString();

describe('othersChangeMessage', () => {
  it('names who and when, in plain words', () => {
    expect(othersChangeMessage({ by: MARIE, at }, t as never, 'fr', new Date(today))).toBe('Modifié par Marie Dupont à 14:02');
  });

  it('the user\'s own change from another window says so', () => {
    expect(othersChangeMessage({ by: { id: 'me', name: 'Moi' }, at }, t as never, 'fr', new Date(today), 'me'))
      .toBe('Vous avez modifié ce poste ailleurs à 14:02');
  });

  it('a user without a name is "a user", never an e-mail', () => {
    expect(othersChangeMessage({ by: { id: 'u-9', name: null }, at }, t as never, 'fr', new Date(today))).toBe('Modifié par un utilisateur à 14:02');
  });

  it('nobody known, no time known, another day', () => {
    expect(othersChangeMessage({ by: null, at }, t as never, 'fr', new Date(today))).toBe('Modifié ailleurs à 14:02');
    expect(othersChangeMessage({ by: null, at: null }, t as never, 'fr')).toBe('Modifié ailleurs');
    expect(othersChangeMessage({ by: MARIE, at: null }, t as never, 'fr')).toBe('Modifié par Marie Dupont');
    const later = new Date(today);
    later.setDate(later.getDate() + 3);
    expect(othersChangeMessage({ by: MARIE, at }, t as never, 'fr', later)).toMatch(/^Modifié par Marie Dupont le .+ à 14:02$/);
  });

  it('English', () => {
    void instance.changeLanguage('en');
    try {
      expect(othersChangeMessage({ by: MARIE, at }, t as never, 'en-GB', new Date(today))).toBe('Changed by Marie Dupont at 14:02');
      expect(othersChangeMessage({ by: { id: 'me', name: 'Me' }, at }, t as never, 'en-GB', new Date(today), 'me'))
        .toBe('You changed this item elsewhere at 14:02');
      expect(othersChangeMessage({ by: { id: 'u-9', name: null }, at }, t as never, 'en-GB', new Date(today))).toBe('Changed by a user at 14:02');
    } finally {
      void instance.changeLanguage('fr');
    }
  });
});

describe('OthersChangesNotice', () => {
  const renderNotice = (props: Partial<React.ComponentProps<typeof OthersChangesNotice>>) => render(
    <ThemeProvider theme={theme}>
      <OthersChangesNotice notice={null} outdated={null} onReload={() => undefined} {...props} />
    </ThemeProvider>,
  );

  it('after a refresh: a quiet line in a polite live region', () => {
    renderNotice({ notice: { by: MARIE, at } });
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByTestId('others-changes-notice')).toHaveTextContent('Modifié par Marie Dupont à');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('while something is pending: the mark and Reload, which keeps it', () => {
    const onReload = vi.fn();
    renderNotice({ outdated: { by: MARIE, at }, onReload });
    expect(screen.getByTestId('others-changes-outdated')).toHaveTextContent('Modifié ailleurs');
    // The details, for screen readers too.
    expect(screen.getByRole('status')).toHaveTextContent('Recharger affiche ces modifications');
    fireEvent.click(screen.getByRole('button', { name: 'Recharger' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('a line deleted elsewhere says so, in place of anything else', () => {
    renderNotice({ gone: true, outdated: { by: MARIE, at }, notice: { by: MARIE, at } });
    expect(screen.getByTestId('others-changes-gone')).toHaveTextContent('Ce poste a été supprimé');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('others-changes-notice')).toBeNull();
  });

  it('Reload is unavailable while it runs', () => {
    renderNotice({ outdated: { by: null, at: null }, reloading: true });
    expect(screen.getByRole('button', { name: 'Recharger' })).toBeDisabled();
  });

  it('nothing to say: an empty live region, kept for the next announcement', () => {
    renderNotice({});
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
