import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TrialChip, { TrialMenuLine } from './TrialChip';

vi.mock('react-i18next', async () => {
  const { default: common } = await import('../locales/en/common.json');
  const sub = common.subscription as Record<string, string>;
  // One stable `t`, English strings with the plural suffix i18next picks for English.
  const t = (key: string, options?: { count?: number; date?: string }) => {
    const name = key.replace('subscription.', '');
    const text = options?.count !== undefined ? sub[`${name}_${options.count === 1 ? 'one' : 'other'}`] : sub[name];
    return text.replace('{{count}}', String(options?.count)).replace('{{date}}', options?.date ?? '');
  };
  return { useTranslation: () => ({ t }) };
});

vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));

const state = vi.hoisted(() => ({
  billing: true,
  isLoading: false,
  claims: { isBillingAdmin: false, isPlatformAdmin: false },
  subscription: null as Record<string, unknown> | null,
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ claims: state.claims, subscription: state.subscription }),
}));

vi.mock('../config/FeaturesContext', () => ({
  useFeatures: () => ({ config: { features: { billing: state.billing } }, isLoading: state.isLoading }),
}));

const trial = (days: number | null, extra: Record<string, unknown> = {}) => ({
  status: 'trialing',
  is_subscription_healthy: true,
  trial_days_remaining: days,
  trial_end: '2026-11-05T12:00:00.000Z',
  ...extra,
});

function renderChip() {
  return render(<MemoryRouter><TrialChip /></MemoryRouter>);
}

describe('TrialChip', () => {
  beforeEach(() => {
    state.billing = true;
    state.isLoading = false;
    state.claims = { isBillingAdmin: false, isPlatformAdmin: false };
    state.subscription = trial(9);
  });

  it('shows the days left as plain text for a member', () => {
    renderChip();
    expect(screen.getByText('Trial: 9 days')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('links a billing administrator to the billing page', () => {
    state.claims = { isBillingAdmin: true, isPlatformAdmin: false };
    renderChip();
    const link = screen.getByRole('link', { name: 'Trial: 9 days' });
    expect(link.getAttribute('href')).toBe('/admin/billing');
  });

  it('describes the end date on hover without renaming the chip', () => {
    renderChip();
    expect(screen.getByText('Trial: 9 days').getAttribute('aria-label')).toBeNull();
    expect(screen.getByText('Trial: 9 days').getAttribute('title')).toBe(`Trial ends on ${new Date('2026-11-05T12:00:00.000Z').toLocaleDateString('en')}`);
  });

  it('uses the singular on the last day', () => {
    state.subscription = trial(1);
    renderChip();
    expect(screen.getByText('Trial: 1 day')).toBeTruthy();
  });

  it.each([0, -2, null])('shows nothing when the trial has %s days left', (days) => {
    state.subscription = trial(days, { is_subscription_healthy: false });
    const { container } = renderChip();
    expect(container.textContent).toBe('');
  });

  it('shows nothing for a trial reported healthy with no day left', () => {
    state.subscription = trial(0);
    const { container } = renderChip();
    expect(container.textContent).toBe('');
  });

  it('shows nothing for an active paid subscription', () => {
    state.subscription = { status: 'active', is_subscription_healthy: true, trial_days_remaining: null };
    const { container } = renderChip();
    expect(container.textContent).toBe('');
  });

  it('shows nothing for a frozen subscription', () => {
    state.subscription = { status: 'past_due', is_subscription_healthy: false, trial_days_remaining: null };
    const { container } = renderChip();
    expect(container.textContent).toBe('');
  });

  it('shows nothing before the subscription is loaded', () => {
    state.subscription = null;
    const { container } = renderChip();
    expect(container.textContent).toBe('');
  });

  it('shows nothing when billing is off (on-premise)', () => {
    state.billing = false;
    const { container } = renderChip();
    expect(container.textContent).toBe('');
  });

  it('shows nothing for a platform administrator', () => {
    state.claims = { isBillingAdmin: false, isPlatformAdmin: true };
    const { container } = renderChip();
    expect(container.textContent).toBe('');
  });
});

describe('TrialMenuLine', () => {
  beforeEach(() => {
    state.billing = true;
    state.isLoading = false;
    state.claims = { isBillingAdmin: false, isPlatformAdmin: false };
    state.subscription = trial(9);
  });

  it('shows the days left in the account menu for a member, without a link', () => {
    render(<MemoryRouter><TrialMenuLine /></MemoryRouter>);
    expect(screen.getByText('Trial: 9 days')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('links a billing administrator to the billing page and closes the menu', () => {
    state.claims = { isBillingAdmin: true, isPlatformAdmin: false };
    const onNavigate = vi.fn();
    render(<MemoryRouter><TrialMenuLine onNavigate={onNavigate} /></MemoryRouter>);
    const link = screen.getByRole('link', { name: 'Trial: 9 days' });
    expect(link.getAttribute('href')).toBe('/admin/billing');
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalled();
  });

  it('shows nothing without a running trial', () => {
    state.subscription = { status: 'active', is_subscription_healthy: true, trial_days_remaining: null };
    const { container } = render(<MemoryRouter><TrialMenuLine /></MemoryRouter>);
    expect(container.textContent).toBe('');
  });
});
