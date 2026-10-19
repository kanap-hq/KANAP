import '../../i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import { DomainsEditor } from './ItOperationsSettingsPage';
import type { DomainOption } from '../../services/itOpsSettings';

vi.mock('../../api', () => ({ default: { get: vi.fn(async () => ({ data: { total: 0, usage: [] } })), patch: vi.fn(), post: vi.fn() } }));

const DOMAINS: DomainOption[] = [
  { code: 'corp', label: 'Corp', dns_suffix: 'corp.example.com', deprecated: false, account_count: 1200 } as DomainOption,
];

function renderEditor(onChange = vi.fn()) {
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <KanapDialogProvider><DomainsEditor items={DOMAINS} onChange={onChange} /></KanapDialogProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return onChange;
}

describe('Domains settings', () => {
  it('names the counts plainly and says on hover where to find each value', async () => {
    renderEditor();
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toContain('Number of accounts');
    expect(headers).toContain('Number of computers');
    expect(headers).not.toContain('Accounts');
    expect(headers).not.toContain('Machines');
    fireEvent.mouseOver(screen.getByText('Number of accounts'));
    expect((await screen.findByRole('tooltip')).textContent).toBe('Active Directory Users and Computers, or a count of user objects in the domain.');
    fireEvent.mouseLeave(screen.getByText('Number of accounts'));
    fireEvent.mouseOver(screen.getByText('Number of computers'));
    expect((await screen.findByText('Active Directory Users and Computers, or a count of computer objects in the domain.'))).toBeTruthy();
    fireEvent.mouseOver(screen.getByText('Forest'));
    expect(await screen.findByText('Active Directory Domains and Trusts.')).toBeTruthy();
  });

  it('types the counts in fields without the browser arrows, with room for the example', () => {
    renderEditor();
    const accounts = screen.getByRole('spinbutton', { name: 'Number of accounts Corp' }) as HTMLInputElement;
    const computers = screen.getByRole('spinbutton', { name: 'Number of computers Corp' }) as HTMLInputElement;
    expect(accounts.value).toBe('1200');
    expect(computers.placeholder).toBe('e.g., 300');
    // The arrows are hidden by the field's rules (Firefox and WebKit).
    const css = Array.from(document.querySelectorAll('style')).map((style) => style.textContent).join('\n');
    expect(css).toMatch(/-moz-appearance:\s*textfield/);
    expect(css).toMatch(/::-webkit-inner-spin-button/);
    // Each count column keeps at least 110 px: "e.g., 1200" stays readable.
    const header = screen.getByText('Number of accounts').closest('th') as HTMLElement;
    expect(getComputedStyle(header).minWidth).toBe('110px');
    fireEvent.change(computers, { target: { value: '450' } });
    expect(computers.value).toBe('450');
  });
});
