import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    const message = await screen.findByText(/delete\.partialDeleted/);
    expect(message).toHaveTextContent('delete.partialDeleted {"count":1}');
    expect(message).toHaveTextContent('delete.partialFailed {"count":1');
    expect(message).toHaveTextContent(`Frozen: ${FROZEN}`);
    // Each count drives its own plural forms: the deleted ones, then the failed ones.
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

  it('counts the selection in the title and shows the warning it is given', async () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <DeleteSelectedButton<Row>
          selectedRows={[rows[0]]}
          endpoint="/contracts/bulk"
          getItemId={(row) => row.id}
          getItemName={(row) => row.name}
          onDeleteSuccess={vi.fn()}
          warning="This contract is linked to nothing."
        />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /buttons.deleteSelected/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('delete.deleteSelectedTitle {"count":1}');
    expect(dialog).toHaveTextContent('delete.itemsToDelete {"count":1}');
    expect(dialog).toHaveTextContent('This contract is linked to nothing.');
    expect(dialog).not.toHaveTextContent('delete.warningMessage');
    // No "Delete anyway": nothing goes besides the item.
    expect(screen.getByRole('button', { name: 'buttons.delete' })).toBeInTheDocument();
  });

  it('shows the reasons when every item fails', async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: { deleted: [], failed: [{ id: 'b', name: 'Frozen', reason: FROZEN }] } } as any);
    renderButton();
    const message = await screen.findByText(/delete\.failedAll/);
    expect(message).toHaveTextContent(`Frozen: ${FROZEN}`);
  });

  describe('with a check before the dialog', () => {
    const REFUSAL = { id: 'b', name: 'Frozen', code: 'CONTRACT_HAS_COMPLIANCE_RECORDS', usages: [{ type: 'compliance_requirements', total: 1 }] };
    const itemLabels = { toDelete: (count: number) => `to delete:${count}`, kept: (count: number) => `kept:${count}` };

    function renderChecked(selected: Row[], check: () => Promise<any>) {
      const checkDelete = vi.fn(check);
      render(
        <ThemeProvider theme={createAppTheme('light')}>
          <DeleteSelectedButton<Row>
            selectedRows={selected}
            endpoint="/contracts/bulk"
            getItemId={(row) => row.id}
            getItemName={(row) => row.name}
            onDeleteSuccess={vi.fn()}
            checkDelete={checkDelete}
            itemLabels={itemLabels}
          />
        </ThemeProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: /buttons.deleteSelected/ }));
      return checkDelete;
    }

    it('shows a single refused item as the record does: the reason and Close only', async () => {
      const checkDelete = renderChecked([rows[1]], async () => ({ refused: [REFUSAL] }));
      const dialog = await screen.findByRole('dialog');
      expect(checkDelete).toHaveBeenCalledWith(['b']);
      expect(dialog).toHaveTextContent('delete.recordTitle {"name":"Frozen"}');
      expect(dialog).toHaveTextContent('errors:CONTRACT_HAS_COMPLIANCE_RECORDS');
      expect(within(dialog).getAllByRole('button').map((button) => button.textContent).filter(Boolean)).toEqual(['buttons.close']);
      fireEvent.click(within(dialog).getByRole('button', { name: 'buttons.close' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(api.delete).not.toHaveBeenCalled();
    });

    it('lists what is deleted and what is kept, with why, and deletes only the rest', async () => {
      vi.mocked(api.delete).mockResolvedValue({ data: { deleted: ['a'], failed: [] } } as any);
      renderChecked(rows, async () => ({ refused: [REFUSAL], warning: 'Also deleted: 1 task.', confirmLabel: 'Delete anyway' }));
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent('delete.deleteSelectedTitle {"count":1}');
      expect(dialog).toHaveTextContent('to delete:1');
      expect(dialog).toHaveTextContent('First');
      expect(dialog).toHaveTextContent('kept:1');
      expect(dialog).toHaveTextContent('Frozen');
      expect(dialog).toHaveTextContent('common:delete.usages.compliance_requirements');
      expect(dialog).toHaveTextContent('Also deleted: 1 task.');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete anyway' }));
      await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/contracts/bulk', { data: { ids: ['a'] } }));
    });

    it('offers no delete when every selected item is refused', async () => {
      renderChecked(rows, async () => ({ refused: [{ ...REFUSAL, id: 'a', name: 'First' }, REFUSAL] }));
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent('kept:2');
      expect(dialog).toHaveTextContent('First');
      expect(dialog).toHaveTextContent('Frozen');
      expect(within(dialog).getAllByRole('button').map((button) => button.textContent).filter(Boolean)).toEqual(['buttons.close']);
    });

    it('sends the force key the check names, with its warning and label', async () => {
      vi.mocked(api.delete).mockResolvedValue({ data: { deleted: ['a', 'b'], failed: [] } } as any);
      renderChecked(rows, async () => ({ refused: [], warning: '2 budget lines lose it.', confirmLabel: 'Delete anyway', forceKey: 'force' }));
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent('2 budget lines lose it.');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete anyway' }));
      await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/contracts/bulk', { data: { ids: ['a', 'b'], force: true } }));
    });

    it('falls back to the usual confirmation when the check fails', async () => {
      renderChecked(rows, async () => { throw new Error('offline'); });
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent('to delete:2');
      expect(dialog).not.toHaveTextContent('kept:');
      expect(within(dialog).getByRole('button', { name: 'buttons.delete' })).toBeInTheDocument();
    });
  });
});
