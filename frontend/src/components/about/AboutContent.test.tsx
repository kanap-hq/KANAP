import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AboutContent from './AboutContent';

// The path line reads the onboarding API: covered by its own test.
vi.mock('../onboarding/AboutOnboardingLine', () => ({ default: () => null }));
vi.mock('react-i18next', async () => {
  const { default: settings } = await import('../../locales/en/settings.json');
  // One stable `t` that renders the English text of settings keys, with interpolation and plurals.
  const t = (key: string, options?: Record<string, unknown>) => {
    const lookup = (k: string) => k.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], settings);
    const plural = options && typeof options.count === 'number' ? (options.count === 1 ? '_one' : '_other') : '';
    const value = lookup(`${key}${plural}`) ?? lookup(key);
    if (typeof value !== 'string') return key;
    return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
  };
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

const state = vi.hoisted(() => ({
  deploymentMode: 'multi-tenant' as 'multi-tenant' | 'single-tenant',
  version: '26.10.1',
  billing: true,
  locale: 'en',
  subscription: null as null | { status?: string; trial_days_remaining?: number | null },
  isBillingAdmin: false,
  tenantName: 'Acme' as string | null,
  tenantSlug: 'acme' as string | null,
}));

vi.mock('../../config/FeaturesContext', () => ({
  useFeatures: () => ({
    config: { deploymentMode: state.deploymentMode, features: { billing: state.billing }, version: state.version },
    isLoading: false,
  }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ subscription: state.subscription, claims: { isBillingAdmin: state.isBillingAdmin } }),
}));
vi.mock('../../tenant/TenantContext', () => ({
  useTenant: () => ({ tenantName: state.tenantName, tenantSlug: state.tenantSlug }),
}));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => state.locale }));

const writeText = vi.fn();

function renderContent() {
  return render(
    <MemoryRouter>
      <AboutContent />
    </MemoryRouter>,
  );
}

afterEach(() => {
  state.deploymentMode = 'multi-tenant';
  state.version = '26.10.1';
  state.billing = true;
  state.locale = 'en';
  state.subscription = null;
  state.isBillingAdmin = false;
  state.tenantName = 'Acme';
  state.tenantSlug = 'acme';
  writeText.mockReset();
});

describe('AboutContent', () => {
  it('links the release notes of the running version, and the site, the manual and the source code', () => {
    renderContent();

    expect(screen.getByText('Version 26.10.1')).toBeInTheDocument();
    const notes = screen.getByRole('link', { name: 'Release notes' });
    expect(notes).toHaveAttribute('href', 'https://github.com/kanap-hq/KANAP/releases/tag/v26.10.1');
    expect(notes).toHaveAttribute('target', '_blank');
    expect(notes).toHaveAttribute('rel', 'noopener');
    expect(screen.getByRole('link', { name: 'kanap.net' })).toHaveAttribute('href', 'https://kanap.net');
    expect(screen.getByRole('link', { name: 'Documentation' })).toHaveAttribute('href', 'https://doc.kanap.net/');
    expect(screen.getByRole('link', { name: 'Source code under the AGPL-3.0 license' }))
      .toHaveAttribute('href', 'https://github.com/kanap-hq/KANAP');
  });

  it('falls back to the list of releases while the version is unknown, and shows no version line', () => {
    state.version = 'unknown';
    renderContent();

    expect(screen.queryByText(/Version/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Release notes' })).toHaveAttribute('href', 'https://github.com/kanap-hq/KANAP/releases');
  });

  it('on-premise, shows the upgrade guide, the contract line and the offer in the user language', () => {
    state.deploymentMode = 'single-tenant';
    state.locale = 'fr';
    renderContent();

    expect(screen.getByText('Deployment: on-premise')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upgrade guide' })).toHaveAttribute('href', 'https://doc.kanap.net/fr/on-premise/operations/');
    expect(screen.getByRole('link', { name: 'Documentation' })).toHaveAttribute('href', 'https://doc.kanap.net/fr/');
    expect(screen.getByText(/If you have a support contract, write to/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'the support offer' })).toHaveAttribute('href', 'https://kanap.net/fr/offer');
    expect(screen.getByRole('link', { name: 'GitHub Discussions' })).toHaveAttribute('href', 'https://github.com/kanap-hq/KANAP/discussions');
    expect(screen.getByRole('link', { name: 'GitHub Issues' })).toHaveAttribute('href', 'https://github.com/kanap-hq/KANAP/issues');
  });

  it('on-premise, the offer link is the English page for English', () => {
    state.deploymentMode = 'single-tenant';
    renderContent();
    expect(screen.getByRole('link', { name: 'the support offer' })).toHaveAttribute('href', 'https://kanap.net/offer');
  });

  it('in the cloud, points to e-mail support only, with no upgrade guide, offer or GitHub links', () => {
    renderContent();

    expect(screen.getByText('Deployment: cloud')).toBeInTheDocument();
    expect(screen.getByText(/Email support: write to/)).toBeInTheDocument();
    expect(screen.queryByText(/If you have a support contract/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Upgrade guide' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'the support offer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'GitHub Discussions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'GitHub Issues' })).not.toBeInTheDocument();
  });

  it('shows the trial days only during a running trial, with a plan link for billing admins', () => {
    state.subscription = { status: 'trialing', trial_days_remaining: 9 };
    const { unmount } = renderContent();
    expect(screen.getByText(/9 days left in your trial/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Choose a plan' })).not.toBeInTheDocument();
    unmount();

    state.isBillingAdmin = true;
    state.subscription = { status: 'trialing', trial_days_remaining: 1 };
    renderContent();
    expect(screen.getByText(/1 day left in your trial/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose a plan' })).toHaveAttribute('href', '/admin/billing');
  });

  it.each([
    ['an active subscription', { status: 'active', trial_days_remaining: null }],
    ['an ended trial', { status: 'trialing', trial_days_remaining: 0 }],
    ['no subscription', null],
  ])('shows no trial line with %s', (_label, subscription) => {
    state.subscription = subscription;
    renderContent();
    expect(screen.queryByText(/left in your trial/)).not.toBeInTheDocument();
  });

  it('shows no trial line on-premise', () => {
    state.deploymentMode = 'single-tenant';
    state.subscription = { status: 'trialing', trial_days_remaining: 9 };
    renderContent();
    expect(screen.queryByText(/left in your trial/)).not.toBeInTheDocument();
  });

  it('prefills the support e-mail with the version and the workspace', () => {
    renderContent();

    const mail = screen.getByRole('link', { name: 'support@kanap.net' });
    const href = mail.getAttribute('href') ?? '';
    expect(href.startsWith('mailto:support@kanap.net?')).toBe(true);
    const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    expect(params.get('subject')).toBe('KANAP support: Acme / acme');
    expect(params.get('body')).toContain('KANAP version: 26.10.1');
    expect(params.get('body')).toContain('Workspace: Acme / acme');
    expect(params.get('body')).toContain('Deployment: cloud');
    expect(params.get('body')).toContain(`Browser: ${navigator.userAgent}`);
  });

  it('copies the same details and confirms', async () => {
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderContent();

    fireEvent.click(screen.getByRole('button', { name: 'Copy the details for support' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('KANAP version: 26.10.1');
    expect(copied).toContain('Workspace: Acme / acme');
    const mail = screen.getByRole('link', { name: 'support@kanap.net' }).getAttribute('href') ?? '';
    expect(new URLSearchParams(mail.slice(mail.indexOf('?') + 1)).get('body')).toContain(copied);
  });

  it('keeps the button label when the clipboard refuses', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderContent();

    fireEvent.click(screen.getByRole('button', { name: 'Copy the details for support' }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Copy the details for support' })).toBeInTheDocument();
  });
});
