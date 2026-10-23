import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, describe, expect, it, vi } from 'vitest';
import deAuth from '../locales/de/auth.json';
import enAuth from '../locales/en/auth.json';
import frAuth from '../locales/fr/auth.json';

// The app's own source: one lazy loader per language and namespace. Each download is recorded.
const downloads = vi.hoisted(() => [] as string[]);
vi.mock('./localeSource', () => {
  const lazy = import.meta.glob<Record<string, unknown>>('../locales/*/*.json', { import: 'default' });
  return {
    bundledLocales: null,
    localeLoaders: Object.fromEntries(
      Object.entries(lazy).map(([path, load]) => [
        path,
        () => {
          downloads.push(path.replace('../locales/', '').replace('.json', ''));
          return load();
        },
      ]),
    ),
  };
});

vi.mock('../api', () => ({ default: { post: vi.fn() } }));
vi.mock('../components/AuthFrame', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// A French browser, nothing stored: the language every public page starts in.
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
const languages = vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['fr-FR', 'en-US']);
const language = vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('fr-FR');
afterAll(() => {
  languages.mockRestore();
  language.mockRestore();
  vi.unstubAllGlobals();
});

const namespaceCount = Object.keys(import.meta.glob('../locales/fr/*.json')).length;
const downloaded = (locale: string) => downloads.filter((entry) => entry.startsWith(`${locale}/`)).sort();

function SubmitLabel() {
  const { t } = useTranslation('auth');
  return <span data-testid="label">{t('reset.submit')}</span>;
}

describe('i18n loads the active language only', () => {
  it('starts in the browser language with every French namespace and nothing else', async () => {
    const { default: i18n, i18nReady } = await import('./index');
    expect(i18n.isInitialized).toBeFalsy();
    expect(i18n.t('auth:reset.submit')).not.toBe(frAuth.reset.submit);

    await i18nReady;

    expect(i18n.language).toBe('fr');
    expect(i18n.resolvedLanguage).toBe('fr');
    expect(downloaded('fr')).toHaveLength(namespaceCount);
    expect(downloads).toEqual(downloaded('fr'));
    expect(i18n.hasResourceBundle('en', 'common')).toBe(false);
    expect(i18n.t('auth:reset.submit')).toBe(frAuth.reset.submit);
    expect(document.documentElement.lang).toBe('fr');
  });

  it('renders a public page in French from the first render', async () => {
    const { default: ResetPasswordPage } = await import('../pages/ResetPasswordPage');
    render(
      <MemoryRouter initialEntries={[{ pathname: '/reset-password', hash: '#token=link-token' }]}>
        <ResetPasswordPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: frAuth.reset.submit })).toBeInTheDocument();
    expect(screen.getByLabelText(new RegExp(frAuth.reset.newPassword))).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('auth:');
    expect(document.body).not.toHaveTextContent(enAuth.reset.submit);
  });

  it('shows the English text of a key missing in French, downloading only that namespace', async () => {
    const { default: i18n } = await import('./index');
    const { submit: _missing, ...reset } = frAuth.reset;
    i18n.removeResourceBundle('fr', 'auth');
    i18n.addResourceBundle('fr', 'auth', { ...frAuth, reset }, true, true);

    render(<SubmitLabel />);

    expect(await screen.findByText(enAuth.reset.submit)).toBeInTheDocument();
    expect(downloaded('en')).toEqual(['en/auth', 'en/common']);
    // The other keys stay French.
    expect(i18n.t('auth:reset.newPassword')).toBe(frAuth.reset.newPassword);
    i18n.removeResourceBundle('fr', 'auth');
    i18n.addResourceBundle('fr', 'auth', frAuth, true, true);
  });

  it('switches language without a reload once the new texts are downloaded', async () => {
    const { default: i18n, changeAppLanguage } = await import('./index');
    render(<SubmitLabel />);
    expect(screen.getByTestId('label')).toHaveTextContent(frAuth.reset.submit);

    await act(() => changeAppLanguage('de'));

    expect(downloaded('de')).toHaveLength(namespaceCount);
    expect(i18n.language).toBe('de');
    expect(i18n.resolvedLanguage).toBe('de');
    expect(screen.getByTestId('label')).toHaveTextContent(deAuth.reset.submit);
    expect(document.documentElement.lang).toBe('de');
  });

  it('still downloads the texts when a component switches with i18n.changeLanguage directly', async () => {
    const { default: i18n } = await import('./index');
    render(<SubmitLabel />);

    await act(() => i18n.changeLanguage('es'));

    expect(await screen.findByText((await import('../locales/es/auth.json')).default.reset.submit)).toBeInTheDocument();
    expect(downloaded('es')).toHaveLength(namespaceCount);
    // The language is applied again once the texts are in, after they first render.
    await waitFor(() => expect(i18n.resolvedLanguage).toBe('es'));
    expect(document.documentElement.lang).toBe('es');
  });

  it('marks the page with the active language', async () => {
    const { changeAppLanguage } = await import('./index');

    await act(() => changeAppLanguage('en-GB'));
    expect(document.documentElement.lang).toBe('en');

    await act(() => changeAppLanguage('fr'));
    expect(document.documentElement.lang).toBe('fr');
  });
});
