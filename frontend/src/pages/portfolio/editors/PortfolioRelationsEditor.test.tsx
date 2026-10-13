import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { KanapDialogProvider } from '../../../components/design';
import api from '../../../api';
import PortfolioRelationsEditor, { type PortfolioRelationsEditorHandle } from './PortfolioRelationsEditor';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
const mocked = vi.mocked(api);

beforeEach(() => {
  mocked.get.mockReset();
  mocked.post.mockReset();
  mocked.post.mockResolvedValue({ data: { ok: true } } as never);
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/portfolio/projects/prj-1') {
      return {
        data: {
          opex_items: [{ id: 'opex-2', item_number: 2, product_name: 'SAP S/4HANA Maintenance', description: 'Support contract' }],
          capex_items: [{ id: 'capex-125', item_number: 125, description: 'Migration S/4HANA' }],
          urls: [],
          attachments: [],
        },
      };
    }
    return { data: { items: [] } };
  });
});

describe('PortfolioRelationsEditor budget lines', () => {
  it('lists the lines of both natures in one picker and saves each nature through its own route', async () => {
    const ref = React.createRef<PortfolioRelationsEditorHandle>();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThemeProvider theme={createAppTheme('light')}>
          <KanapDialogProvider>
            <PortfolioRelationsEditor ref={ref} entityId="prj-1" entityType="project" />
          </KanapDialogProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );

    const field = await screen.findByLabelText('common:selects.budgetLines');
    const picker = field.closest('.MuiAutocomplete-root') as HTMLElement;
    expect(within(picker).getByText('BL-125 · Migration S/4HANA')).toBeTruthy();
    const opexTag = within(picker).getByText('BL-2 · SAP S/4HANA Maintenance').closest('.MuiChip-root') as HTMLElement;
    expect(screen.queryByLabelText('editors.relations.fields.opexItems')).toBeNull();

    // Unlinking the OPEX line keeps the CAPEX one: each route gets the ids of its own nature.
    fireEvent.click(within(opexTag).getByTestId('CancelIcon'));
    await waitFor(() => expect(ref.current?.isDirty()).toBe(true));
    await ref.current!.save();

    expect(mocked.post).toHaveBeenCalledWith('/portfolio/projects/prj-1/opex/bulk-replace', { opex_ids: [] });
    expect(mocked.post).toHaveBeenCalledWith('/portfolio/projects/prj-1/capex/bulk-replace', { capex_ids: ['capex-125'] });
    await waitFor(() => expect(ref.current?.isDirty()).toBe(false));
  });
});
