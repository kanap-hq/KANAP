import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import enCommon from '../locales/en/common.json';

// During the grace of an unpaid invoice the banner warns with the amount due and the freeze date;
// "access is limited" comes only once the workspace is frozen.

const translation = vi.hoisted(() => ({ t: null as unknown as (key: string, options?: Record<string, unknown>) => string }));
translation.t = (key: string, options?: Record<string, unknown>) => {
  const value = key.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    enCommon,
  );
  const template = typeof value === 'string' ? value : key;
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translation.t, i18n: { language: 'en' } }) }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));

const authState = vi.hoisted(() => ({
  subscription: null as Record<string, unknown> | null,
  claims: { isBillingAdmin: true, isPlatformAdmin: false } as Record<string, unknown>,
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => authState }));
vi.mock('../config/FeaturesContext', () => ({
  useFeatures: () => ({ isLoading: false, config: { features: { billing: true } } }),
}));

import SubscriptionBanner from './SubscriptionBanner';

const IN_GRACE = {
  status: 'past_due',
  is_subscription_healthy: false,
  access_allowed: true,
  freeze_effective_at: '2099-11-24T00:00:00.000Z',
  latest_invoice_amount: 24900,
  latest_invoice_currency: 'eur',
};

function renderBanner(subscription: Record<string, unknown>, isBillingAdmin = true) {
  authState.subscription = subscription;
  authState.claims = { isBillingAdmin, isPlatformAdmin: false };
  return render(
    <MemoryRouter>
      <SubscriptionBanner />
    </MemoryRouter>,
  );
}

describe('SubscriptionBanner', () => {
  it('warns a billing administrator with the amount due and the freeze date during the grace', () => {
    renderBanner(IN_GRACE);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Payment of €249.00 overdue. Access will be limited on 24 Nov 2099.');
    expect(alert.className).toMatch(/Warning/);
    expect(screen.getByRole('button', { name: 'Go to billing' })).toBeInTheDocument();
    expect(screen.queryByText(/access is limited/i)).not.toBeInTheDocument();
  });

  it('warns the other users with the freeze date during the grace', () => {
    // Without a billing permission the summary carries no amount.
    renderBanner({ status: 'past_due', is_subscription_healthy: false, access_allowed: true, freeze_effective_at: '2099-11-24T00:00:00.000Z' }, false);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('A payment is overdue. Access will be limited on 24 Nov 2099. Contact your billing admin.');
    expect(alert.className).toMatch(/Warning/);
  });

  it('says access is limited once the workspace is frozen', () => {
    renderBanner({ status: 'past_due', is_subscription_healthy: false, access_allowed: false, freeze_effective_at: '2026-11-01T00:00:00.000Z' }, false);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Account access is limited. Contact your billing admin.');
    expect(alert.className).toMatch(/Error/);
  });

  it('keeps the banner of before the grace when the summary does not say whether access is allowed', () => {
    // An older summary (no access_allowed): the error of a subscription that needs attention.
    renderBanner({ status: 'past_due', is_subscription_healthy: false });
    expect(screen.getByRole('alert')).toHaveTextContent('Your subscription needs attention.');
    expect(screen.getByRole('alert').className).toMatch(/Error/);
    renderBanner({ status: 'past_due', is_subscription_healthy: false, freeze_effective_at: '2099-11-24T00:00:00.000Z' }, false);
    expect(screen.getAllByRole('alert')[1]).toHaveTextContent('Account access is limited. Contact your billing admin.');
    expect(screen.getAllByRole('alert')[1].className).toMatch(/Error/);
  });

  it('shows nothing for a healthy subscription', () => {
    renderBanner({ status: 'active', is_subscription_healthy: true, access_allowed: true });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
