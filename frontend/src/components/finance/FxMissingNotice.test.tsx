import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';

const auth = vi.hoisted(() => ({ levels: {} as Record<string, string> }));
const ORDER = ['reader', 'contributor', 'member', 'manager', 'admin'];
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => ORDER.indexOf(auth.levels[resource] ?? '') >= ORDER.indexOf(level),
  }),
}));

import FxMissingNotice from './FxMissingNotice';
import { mergeFxMissing } from './fxMissing';

const renderNotice = (items: Parameters<typeof FxMissingNotice>[0]['items']) => render(
  <MemoryRouter>
    <FxMissingNotice items={items} />
  </MemoryRouter>,
);

describe('FxMissingNotice', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });
  beforeEach(() => { auth.levels = { budget: 'reader' }; });

  it('renders nothing for an empty or absent list', () => {
    const { container: empty } = renderNotice([]);
    expect(empty).toBeEmptyDOMElement();
    const { container: absent } = renderNotice(undefined);
    expect(absent).toBeEmptyDOMElement();
  });

  it('names one currency and year, singular and plural', () => {
    renderNotice([{ currency: 'USD', year: 2026, lines: 1 }]);
    expect(screen.getByRole('status')).toHaveTextContent('Excluding 1 line with no exchange rate: USD 2026.');
    renderNotice([{ currency: 'JPY', year: 2025, lines: 3 }]);
    expect(screen.getByText('Excluding 3 lines with no exchange rate: JPY 2025.')).toBeInTheDocument();
  });

  it('lists several currencies and years in the order received, with their line counts', () => {
    renderNotice([{ currency: 'USD', year: 2026, lines: 2 }, { currency: 'JPY', year: 2025, lines: 1 }]);
    expect(screen.getByRole('status')).toHaveTextContent('Excluding lines with no exchange rate: USD 2026 (2), JPY 2025 (1).');
  });

  it('offers to enter a rate to budget administrators only', () => {
    const reader = renderNotice([{ currency: 'USD', year: 2026, lines: 2 }]);
    expect(screen.queryByRole('link', { name: 'Enter a rate' })).not.toBeInTheDocument();
    reader.unmount();
    auth.levels = { budget: 'admin', budget_ops: 'admin' };
    renderNotice([{ currency: 'ZAR', year: 2028, lines: 1 }]);
    expect(screen.getByRole('link', { name: 'Enter a rate' })).toHaveAttribute(
      'href',
      '/ops/operations/currency?currency=ZAR&year=2028',
    );
  });

  it('links several pairs to the first one', () => {
    auth.levels = { budget: 'admin', budget_ops: 'admin' };
    renderNotice([
      { currency: 'ZAR', year: 2028, lines: 1 },
      { currency: 'USD', year: 2026, lines: 2 },
    ]);
    expect(screen.getByRole('link', { name: 'Enter a rate' })).toHaveAttribute(
      'href',
      '/ops/operations/currency?currency=ZAR&year=2028',
    );
  });

  it('words the notice in every language', () => {
    for (const lng of ['fr', 'de', 'es']) {
      const t = i18n.getFixedT(lng, 'ops');
      expect(t('shared.fxMissing.excluding', { count: 2, pairs: 'USD 2026' })).toContain('USD 2026');
      expect(t('shared.fxMissing.lineTooltip', { currency: 'USD', year: 2026 })).not.toContain('shared.fxMissing');
    }
  });
});

describe('mergeFxMissing', () => {
  it('keeps the first order and the larger count of the same currency and year', () => {
    expect(mergeFxMissing(
      [{ currency: 'USD', year: 2026, lines: 2 }, { currency: 'JPY', year: 2025, lines: 1 }],
      undefined,
      [{ currency: 'USD', year: 2026, lines: 3 }, { currency: 'USD', year: 2025, lines: 1 }],
      [{ currency: 'JPY', year: 2025, lines: 1 }],
    )).toEqual([
      { currency: 'USD', year: 2026, lines: 3 },
      { currency: 'JPY', year: 2025, lines: 1 },
      { currency: 'USD', year: 2025, lines: 1 },
    ]);
  });
});
