import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));

import { CountryField } from './CompanyFields';

function Harness({ initial = '', clearable = false }: { initial?: string; clearable?: boolean }) {
  const [value, setValue] = React.useState(initial);
  return (
    <>
      <CountryField value={value} onChange={setValue} clearable={clearable} />
      <span data-testid="code">{value}</span>
      <button type="button">Next</button>
    </>
  );
}

function countryInput() {
  return screen.getByRole('combobox', { name: 'companies.fields.country' });
}

describe('CountryField', () => {
  it('selects FR when the full name is typed and Enter is pressed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = countryInput();
    await user.click(input);
    await user.type(input, 'France');
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('code')).toHaveTextContent('FR');
    expect(input).toHaveValue('France (FR)');
  });

  it('keeps FR when the full name is typed and the field is left with Tab', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = countryInput();
    await user.click(input);
    await user.type(input, 'France');
    await user.tab();
    expect(screen.getByTestId('code')).toHaveTextContent('FR');
    expect(input).toHaveValue('France (FR)');
  });

  it('leaves a cleared country empty when the field is left with Tab', async () => {
    const user = userEvent.setup();
    render(<Harness clearable />);
    const input = countryInput();
    await user.click(input);
    await user.type(input, 'X');
    await user.clear(input);
    await user.tab();
    expect(screen.getByTestId('code').textContent).toBe('');
    expect(input).toHaveValue('');
  });
});
