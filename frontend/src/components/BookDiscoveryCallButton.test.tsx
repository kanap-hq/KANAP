import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import BookDiscoveryCallButton from './BookDiscoveryCallButton';

const state = vi.hoisted(() => ({
  deploymentMode: 'multi-tenant' as 'multi-tenant' | 'single-tenant',
  discoveryCall: { url: 'https://cal.example/discovery', fallbackEmail: '' },
  subscription: { status: 'trialing', trial_days_remaining: 9 } as null | { status?: string; trial_days_remaining?: number | null },
  isPlatformAdmin: false,
  post: vi.fn(),
}));

vi.mock('../api', () => ({ default: { post: (...args: unknown[]) => state.post(...args) } }));
vi.mock('../config/FeaturesContext', () => ({
  useFeatures: () => ({
    config: { deploymentMode: state.deploymentMode, features: {}, discoveryCall: state.discoveryCall },
    isLoading: false,
  }),
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ subscription: state.subscription, claims: { isPlatformAdmin: state.isPlatformAdmin } }),
}));

function renderButton(props: { asLink?: boolean } = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <BookDiscoveryCallButton placement="last_step" {...props} />
    </I18nextProvider>,
  );
}

afterEach(() => {
  state.deploymentMode = 'multi-tenant';
  state.discoveryCall = { url: 'https://cal.example/discovery', fallbackEmail: '' };
  state.subscription = { status: 'trialing', trial_days_remaining: 9 };
  state.isPlatformAdmin = false;
  state.post.mockReset();
});

describe('BookDiscoveryCallButton', () => {
  it('opens the booking page in a new tab and records the click with its placement', () => {
    state.post.mockResolvedValue({});
    renderButton();
    const link = screen.getByRole('link', { name: 'Book a discovery call' });
    expect(link).toHaveAttribute('href', 'https://cal.example/discovery');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener');
    fireEvent.click(link);
    expect(state.post).toHaveBeenCalledWith('/discovery-call/clicks', { placement: 'last_step' });
  });

  it('keeps the link when the click cannot be recorded', () => {
    state.post.mockRejectedValue(new Error('offline'));
    renderButton({ asLink: true });
    fireEvent.click(screen.getByRole('link', { name: 'Book a discovery call' }));
    expect(screen.getByRole('link', { name: 'Book a discovery call' })).toBeInTheDocument();
  });

  it('writes to the fallback address when no booking page is set', () => {
    state.discoveryCall = { url: '', fallbackEmail: 'hello@kanap.example' };
    renderButton();
    expect(screen.getByRole('link', { name: 'Book a discovery call' })).toHaveAttribute('href', 'mailto:hello@kanap.example');
  });

  it.each([
    ['no booking page nor address', () => { state.discoveryCall = { url: '', fallbackEmail: '' }; }],
    ['on-premise', () => { state.deploymentMode = 'single-tenant'; }],
    ['a paid subscription', () => { state.subscription = { status: 'active', trial_days_remaining: null }; }],
    ['an ended trial', () => { state.subscription = { status: 'trialing', trial_days_remaining: 0 }; }],
    ['no subscription', () => { state.subscription = null; }],
    ['a platform administrator', () => { state.isPlatformAdmin = true; }],
  ])('shows nothing with %s', (_label, arrange) => {
    arrange();
    const { container } = renderButton();
    expect(container).toBeEmptyDOMElement();
  });
});
