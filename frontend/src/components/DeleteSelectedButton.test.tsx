import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../api';
import DeleteSelectedButton from './DeleteSelectedButton';
import { createAppTheme } from '../config/ThemeContext';

vi.mock('../api', () => ({
  default: { delete: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
    i18n: { language: 'en' },
  }),
}));

const FROZEN = 'This line has amounts in Budget 2026, a frozen budget column. '
  + 'Unfreeze the column first, or set an end of validity date instead of deleting the line.';

type Row = { id: string; name: string };
const rows: Row[] = [{ id: 'a', name: 'First' }, { id: 'b', name: 'Frozen' }];

function renderIdle(selectedRows: Row[]) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <DeleteSelectedButton<Row>
        selectedRows={selectedRows}
        endpoint="/spend-items/bulk"
        getItemId={(row) => row.id}
        getItemName={(row) => row.name}
        onDeleteSuccess={vi.fn()}
      />
    </ThemeProvider>,
  );
}

function renderButton() {
  const onDeleteSuccess = vi.fn();
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <DeleteSelectedButton<Row>
        selectedRows={rows}
        endpoint="/spend-items/bulk"
        getItemId={(row) => row.id}
        getItemName={(row) => row.name}
        onDeleteSuccess={onDeleteSuccess}
      />
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /buttons.deleteSelected/ }));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.delete' }));
  return { onDeleteSuccess };
}

describe('DeleteSelectedButton', () => {
  beforeEach(() => {
    vi.mocked(api.delete).mockReset();
  });

  it('with a force option, says what goes too, asks "Delete anyway" and sends the force key', async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: { deleted: ['a', 'b'], failed: [] } } as any);
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <DeleteSelectedButton<Row>
          selectedRows={rows}
          endpoint="/analytics-categories/bulk"
          getItemId={(row) => row.id}
          getItemName={(row) => row.name}
          onDeleteSuccess={vi.fn()}
          forceOption={{ message: '1 selected value is used: it is removed from 6 budget lines.', confirmLabel: 'Delete anyway', apiKey: 'force' }}
        />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /buttons.deleteSelected/ }));
    expect(await screen.findByText('1 selected value is used: it is removed from 6 budget lines.')).toBeInTheDocument();
    // In place of the generic warning, which says a referenced item is kept.
    expect(screen.queryByText('delete.warningMessage')).toBeNull();
    expect(screen.queryByRole('button', { name: 'buttons.delete' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete anyway' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/analytics-categories/bulk', { data: { ids: ['a', 'b'], force: true } }));
  });

  it('without one, sends no force key', async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: { deleted: ['a', 'b'], failed: [] } } as any);
    renderButton();
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/spend-items/bulk', { data: { ids: ['a', 'b'] } }));
  });

  it('is a disabled neutral pill with no selection', () => {
    renderIdle([]);
    const button = screen.getByRole('button', { name: 'buttons.deleteSelected (0)' });
    expect(button).toBeDisabled();
    expect(button).toHaveClass('MuiButton-action');
    expect(button).not.toHaveClass('MuiButton-action-danger');
  });

  it('turns into the danger pill once rows are selected', () => {
    renderIdle(rows);
    const button = screen.getByRole('button', { name: 'buttons.deleteSelected (2)' });
    expect(button).toBeEnabled();
    expect(button).toHaveClass('MuiButton-action-danger');
  });

  it('shows the reason of each failed item when the others are deleted', async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: { deleted: ['a'], failed: [{ id: 'b', name: 'Frozen', reason: FROZEN }] } } as any);
    const { onDeleteSuccess } = renderButton();
    const message = await screen.findByText(/delete\.partial/);
    expect(message).toHaveTextContent(`Frozen: ${FROZEN}`);
    // The deleted count drives the plural forms.
    expect(message).toHaveTextContent('"count":1');
    expect(message).toHaveTextContent('"failed":1');
    await waitFor(() => expect(onDeleteSuccess).toHaveBeenCalled());
  });

  it('translates a refusal that has a code, with what uses the item', async () => {
    vi.mocked(api.delete).mockResolvedValue({
      data: {
        deleted: ['a'],
        failed: [{
          id: 'b',
          name: 'Acme',
          reason: 'Cannot delete supplier "Acme": it is used by 2 contracts. Disable it instead.',
          code: 'SUPPLIER_IN_USE',
          usages: [{ type: 'contracts', total: 2 }],
        }],
      },
    } as any);
    renderButton();
    const message = await screen.findByText(/delete\.partial/);
    expect(message).toHaveTextContent(/Acme: errors:SUPPLIER_IN_USE/);
    expect(message).toHaveTextContent(/common:delete\.usages\.contracts/);
    expect(message).not.toHaveTextContent(/Cannot delete supplier "Acme": it is used by 2 contracts\. Disable it instead\.;/);
  });

  it('shows the reasons when every item fails', async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: { deleted: [], failed: [{ id: 'b', name: 'Frozen', reason: FROZEN }] } } as any);
    renderButton();
    const message = await screen.findByText(/delete\.failedAll/);
    expect(message).toHaveTextContent(`Frozen: ${FROZEN}`);
  });
});
