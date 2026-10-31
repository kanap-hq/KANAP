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

  it('stays a danger pill, disabled, with no selection', () => {
    renderIdle([]);
    const button = screen.getByRole('button', { name: 'buttons.deleteSelected (0)' });
    expect(button).toBeDisabled();
    expect(button).toHaveClass('MuiButton-action-danger');
  });

  it('turns into the danger pill once rows are selected', () => {
    renderIdle(rows);
    const button = screen.getByRole('button', { name: 'buttons.deleteSelected (2)' });
    expect(button).toBeEnabled();
    expect(button).toHaveClass('MuiButton-action-danger');
  });

  it('shows the selected count as a badge on the icon for 0, 1 and 12 rows', async () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ({ id: String(i), name: `Row ${i}` }));
    const { rerender } = renderIdle([]);
    const none = screen.getByRole('button', { name: 'buttons.deleteSelected (0)' });
    expect(none.querySelector('.MuiBadge-badge')).toHaveTextContent('0');
    expect(none.textContent?.replace(/\s/g, '')).toBe('0');
    expect(none.querySelector('svg')).not.toBeNull();
    expect(none).not.toHaveTextContent('buttons.deleteSelected');
    fireEvent.mouseOver(none.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('buttons.deleteSelected (0)');

    rerender(
      <ThemeProvider theme={createAppTheme('light')}>
        <DeleteSelectedButton<Row>
          selectedRows={[rows[0]]}
          endpoint="/spend-items/bulk"
          getItemId={(row) => row.id}
          getItemName={(row) => row.name}
          onDeleteSuccess={vi.fn()}
        />
      </ThemeProvider>,
    );
    const one = screen.getByRole('button', { name: 'buttons.deleteSelected (1)' });
    expect(one.querySelector('.MuiBadge-badge')).toHaveTextContent('1');
    expect(one.textContent?.replace(/\s/g, '')).toBe('1');

    rerender(
      <ThemeProvider theme={createAppTheme('dark')}>
        <DeleteSelectedButton<Row>
          selectedRows={twelve}
          endpoint="/spend-items/bulk"
          getItemId={(row) => row.id}
          getItemName={(row) => row.name}
          onDeleteSuccess={vi.fn()}
        />
      </ThemeProvider>,
    );
    const many = screen.getByRole('button', { name: 'buttons.deleteSelected (12)' });
    const badge = many.querySelector('.MuiBadge-badge') as HTMLElement;
    expect(badge).toHaveTextContent('12');
    expect(many.textContent?.replace(/\s/g, '')).toBe('12');
    expect(badge).toHaveStyle({ backgroundColor: 'rgb(248, 113, 113)', color: 'rgb(15, 17, 23)' });
    fireEvent.mouseOver(many);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('buttons.deleteSelected (12)');
  });

  it('shows the reason of each failed item when the others are deleted', async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: { deleted: ['a'], failed: [{ id: 'b', name: 'Frozen', reason: FROZEN }] } } as any);
    const { onDeleteSuccess } = renderButton();
    const message = await screen.findByText(/delete\.partialResult/);
    expect(message).toHaveTextContent(/delete\.successAll \W+count\W+1/);
    expect(message).toHaveTextContent('delete.partialFailed {\\"count\\":1');
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

  it('names a single selected item in the title and shows the warning it is given', async () => {
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
    // One item: "Delete First?", never the generic "Delete the selected item".
    expect(dialog).toHaveTextContent('delete.recordTitle {"name":"First"}');
    expect(dialog).not.toHaveTextContent('deleteSelectedTitle');
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

  it('names what was deleted in the success message, up to three names', async () => {
    const many: Row[] = ['First', 'Second', 'Third', 'Fourth', 'Fifth'].map((name, i) => ({ id: String(i), name }));
    vi.mocked(api.delete).mockResolvedValue({ data: { deleted: many.map((row) => row.id), failed: [] } } as any);
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <DeleteSelectedButton<Row>
          selectedRows={many}
          endpoint="/contracts/bulk"
          getItemId={(row) => row.id}
          getItemName={(row) => row.name}
          onDeleteSuccess={vi.fn()}
          itemLabels={{ toDelete: (n) => `to delete:${n}`, kept: (n) => `kept:${n}`, deleted: (n) => `contracts deleted:${n}` }}
        />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /buttons.deleteSelected/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'buttons.delete' }));
    const message = await screen.findByText(/delete\.namedList/);
    expect(message).toHaveTextContent('contracts deleted:5');
    expect(message).toHaveTextContent('"names":"First, Second, Third, and delete.namesMore {\\"count\\":2}"');
    expect(message).not.toHaveTextContent('Fourth');
  });

  it('names the deleted ones when others fail', async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: { deleted: ['a'], failed: [{ id: 'b', name: 'Frozen', reason: FROZEN }] } } as any);
    renderButton();
    const message = await screen.findByText(/delete\.partialResult/);
    expect(message).toHaveTextContent(/delete\.namedList .*delete\.successAll \W+count\W+1.*names\W+First\W/);
  });

  it('keeps the dialog content while it closes, when the selection is cleared', async () => {
    // A delete clears the grid selection while the dialog fades out: the dialog keeps what it said
    // when it opened (no "Delete the 0 selected items", no "0 items will be deleted").
    const props = {
      endpoint: '/contracts/bulk',
      getItemId: (row: Row) => row.id,
      getItemName: (row: Row) => row.name,
      onDeleteSuccess: vi.fn(),
    };
    const view = render(
      <ThemeProvider theme={createAppTheme('light')}>
        <DeleteSelectedButton<Row> selectedRows={rows} {...props} />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /buttons.deleteSelected/ }));
    const dialog = await screen.findByRole('dialog');
    view.rerender(
      <ThemeProvider theme={createAppTheme('light')}>
        <DeleteSelectedButton<Row> selectedRows={[]} {...props} />
      </ThemeProvider>,
    );
    expect(dialog).toHaveTextContent('delete.deleteSelectedTitle {"count":2}');
    expect(dialog).toHaveTextContent('delete.itemsToDelete {"count":2}');
    expect(dialog).toHaveTextContent('First');
    expect(dialog).not.toHaveTextContent('"count":0');
  });

  describe('with a check before the dialog', () => {
    const REFUSAL = { id: 'b', name: 'Frozen', code: 'CONTRACT_HAS_COMPLIANCE_RECORDS', usages: [{ type: 'compliance_requirements', total: 1 }] };
    const itemLabels = { toDelete: (count: number) => `to delete:${count}`, kept: (count: number) => `kept:${count}` };

    function renderChecked(selected: Row[], check: () => Promise<any>, labels: Record<string, unknown> = itemLabels) {
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
            itemLabels={labels as typeof itemLabels}
          />
        </ThemeProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: /buttons.deleteSelected/ }));
      return checkDelete;
    }

    it('writes the note of an asset that goes under its name, and gives the main action the label of the check', async () => {
      renderChecked(rows, async () => ({
        refused: [],
        notes: { a: 'Member of CL-1: it will leave this cluster.\n2 links will be removed: esx-01 and esx-02.' },
        confirmLabel: 'Delete anyway',
      }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/Member of CL-1/)).toBeInTheDocument();
      expect(within(dialog).getByText(/2 links will be removed/)).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Delete anyway' })).toBeInTheDocument();
    });

    it('titles the window by the items really deleted, and gives the reason of a kept one as a sentence, when the list asks', async () => {
      renderChecked(rows, async () => ({ refused: [REFUSAL] }), {
        ...itemLabels,
        title: (count: number) => `Delete ${count} things`,
        titleCountsDeleted: true,
        keptReason: ({ name, usages, count }: { name: string; usages: string; count: number }) => `${name} is kept: ${usages} (${count}).`,
      });
      const dialog = await screen.findByRole('dialog');
      // One of the two selected rows is kept: the title names the one that goes.
      expect(dialog).toHaveTextContent('delete.recordTitle {"name":"First"}');
      expect(dialog).toHaveTextContent('Frozen is kept: common:delete.usages.compliance_requirements');
      expect(dialog).toHaveTextContent('(1).');
    });

    it('names the connection that keeps one asset, reference and name', async () => {
      renderChecked([{ id: 'a', name: 'srv-01' }], async () => ({
        refused: [{ id: 'a', name: 'srv-01', code: 'ASSET_IN_USE', usages: [{ type: 'connections', total: 1 }], connections: ['CONN-4 · Paris to Gouda'] }],
      }), {
        ...itemLabels,
        keptReason: ({ usages }: { usages: string }) => `Kept: ${usages}.`,
      });
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent('Kept:');
      expect(dialog).toHaveTextContent('CONN-4 · Paris to Gouda');
    });

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
      // The title counts the selection; the lists below say what goes and what stays.
      expect(dialog).toHaveTextContent('delete.deleteSelectedTitle {"count":2}');
      expect(dialog).toHaveTextContent('to delete:1');
      expect(dialog).toHaveTextContent('First');
      expect(dialog).toHaveTextContent('kept:1');
      expect(dialog).toHaveTextContent('Frozen');
      expect(dialog).toHaveTextContent('common:delete.usages.compliance_requirements');
      expect(dialog).toHaveTextContent('Also deleted: 1 task.');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete anyway' }));
      await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/contracts/bulk', { data: { ids: ['a'] } }));
      // The message once done names what was deleted and what was kept.
      const done = await screen.findByText(/^delete\.withKept/);
      expect(done).toHaveTextContent(/delete\.keptDone .*Frozen/);
      expect(done).toHaveTextContent(/delete\.successAll .*First/);
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

    it('drops the "referenced items are kept" warning once the check has answered', async () => {
      renderChecked(rows, async () => ({ refused: [] }));
      const dialog = await screen.findByRole('dialog');
      expect(dialog).not.toHaveTextContent('delete.warningMessage');
      expect(dialog).toHaveTextContent('delete.cannotUndo');
    });

    describe('when the option in the window lifts the refusal', () => {
      const BOUND = { id: 'b', name: 'Frozen', code: 'INTERFACE_HAS_BINDINGS', usages: [{ type: 'interface_bindings', total: 2 }] };
      const cascadeOption = { label: 'Also delete bindings', apiKey: 'deleteRelatedBindings' };

      function renderLiftable(selected: Row[], refused: any[]) {
        render(
          <ThemeProvider theme={createAppTheme('light')}>
            <DeleteSelectedButton<Row>
              selectedRows={selected}
              endpoint="/interfaces/bulk"
              getItemId={(row) => row.id}
              getItemName={(row) => row.name}
              onDeleteSuccess={vi.fn()}
              checkDelete={async () => ({ refused, cascadeLifts: ['INTERFACE_HAS_BINDINGS'] })}
              itemLabels={itemLabels}
              cascadeOption={cascadeOption}
            />
          </ThemeProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: /buttons.deleteSelected/ }));
      }

      it('lists the item as kept, then deletes it with the option checked', async () => {
        vi.mocked(api.delete).mockResolvedValue({ data: { deleted: ['a', 'b'], failed: [] } } as any);
        renderLiftable(rows, [BOUND]);
        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveTextContent('to delete:1');
        expect(within(dialog).getByTestId('delete-kept')).toHaveTextContent('Frozen');
        fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Also delete bindings' }));
        expect(dialog).toHaveTextContent('to delete:2');
        expect(within(dialog).queryByTestId('delete-kept')).toBeNull();
        fireEvent.click(within(dialog).getByRole('button', { name: 'buttons.delete' }));
        await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/interfaces/bulk', { data: { ids: ['a', 'b'], deleteRelatedBindings: true } }));
      });

      it('sends only the free items with the option unchecked', async () => {
        vi.mocked(api.delete).mockResolvedValue({ data: { deleted: ['a'], failed: [] } } as any);
        renderLiftable(rows, [BOUND]);
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'buttons.delete' }));
        await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/interfaces/bulk', { data: { ids: ['a'] } }));
      });

      it('offers the option for a single refused item, the delete disabled until it is checked', async () => {
        vi.mocked(api.delete).mockResolvedValue({ data: { deleted: ['b'], failed: [] } } as any);
        renderLiftable([rows[1]], [BOUND]);
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByTestId('delete-kept')).toHaveTextContent('Frozen');
        // Nothing can go until the option is checked: no "0 will be deleted".
        expect(dialog).not.toHaveTextContent('to delete:0');
        const remove = within(dialog).getByRole('button', { name: 'buttons.delete' });
        expect(remove).toBeDisabled();
        fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Also delete bindings' }));
        expect(dialog).toHaveTextContent('to delete:1');
        expect(remove).toBeEnabled();
        fireEvent.click(remove);
        await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/interfaces/bulk', { data: { ids: ['b'], deleteRelatedBindings: true } }));
      });

      it('keeps the Close-only window for a refusal the option does not lift', async () => {
        renderLiftable([rows[1]], [{ ...BOUND, code: 'OTHER' }]);
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getAllByRole('button').map((button) => button.textContent).filter(Boolean)).toEqual(['buttons.close']);
      });
    });

    it('falls back to the usual confirmation when the check fails', async () => {
      renderChecked(rows, async () => { throw new Error('offline'); });
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent('to delete:2');
      expect(dialog).not.toHaveTextContent('kept:');
      expect(within(dialog).getByRole('button', { name: 'buttons.delete' })).toBeInTheDocument();
      // No check answered: the generic warning says referenced items are kept.
      expect(dialog).toHaveTextContent('delete.warningMessage');
    });
  });
});
