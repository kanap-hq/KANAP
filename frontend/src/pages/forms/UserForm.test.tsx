import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { createAppTheme } from '../../config/ThemeContext';
import UserForm, { type UserFormHandle } from './UserForm';

const stableT = (key: string) => key;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: stableT, i18n: { language: 'en' } }),
}));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../components/fields/CompanySelect', () => ({
  default: ({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) => (
    <button type="button" data-testid="company" onClick={() => onChange('22222222-2222-4222-8222-222222222222')}>{value ?? ''}</button>
  ),
}));
vi.mock('../../components/fields/DepartmentSelect', () => ({
  default: ({ value, companyId }: { value: string | null; companyId?: string }) => (
    <span data-testid="department">{`${companyId ?? ''}/${value ?? ''}`}</span>
  ),
}));
vi.mock('../../components/fields/MultiRoleSelect', () => ({ default: () => null }));
vi.mock('../../components/fields/StatusSwitch', () => ({ default: () => null }));

const theme = createAppTheme('light');
const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';
const FINANCE_A = '33333333-3333-4333-8333-333333333333';

describe('UserForm', () => {
  it('clears the department of the old company when the company changes', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const ref = React.createRef<UserFormHandle>();
    render(
      <ThemeProvider theme={theme}><UserForm
        ref={ref}
        onSubmit={onSubmit}
        defaultValues={{ email: 'ada@example.com', company_id: COMPANY_A, department_id: FINANCE_A, status: 'enabled', role_ids: [] }}
      /></ThemeProvider>,
    );
    expect(screen.getByTestId('department').textContent).toBe(`${COMPANY_A}/${FINANCE_A}`);

    fireEvent.click(screen.getByTestId('company'));
    expect(screen.getByTestId('department').textContent).toBe(`${COMPANY_B}/`);

    await act(async () => { await ref.current!.submit('save'); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ company_id: COMPANY_B, department_id: null });
  });

  it('keeps the department when the same company is chosen again', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const ref = React.createRef<UserFormHandle>();
    render(
      <ThemeProvider theme={theme}><UserForm
        ref={ref}
        onSubmit={onSubmit}
        defaultValues={{ email: 'ada@example.com', company_id: COMPANY_B, department_id: FINANCE_A, status: 'enabled', role_ids: [] }}
      /></ThemeProvider>,
    );
    fireEvent.click(screen.getByTestId('company'));
    await act(async () => { await ref.current!.submit('save'); });
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ company_id: COMPANY_B, department_id: FINANCE_A });
  });
});
