import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ICellRendererParams } from 'ag-grid-community';
import { LinkCellRenderer } from './LinkCellRenderer';

type Row = { id: string | null; name: string };

function params(data: Row): ICellRendererParams<Row> {
  return { value: data.name, data, colDef: { field: 'name' } } as unknown as ICellRendererParams<Row>;
}

describe('LinkCellRenderer', () => {
  it('with newTab, renders a real link that opens the internal page in a new tab', () => {
    const onNavigate = vi.fn();
    const row = { id: 'o1', name: 'Opex line' };
    render(
      <LinkCellRenderer<Row>
        {...params(row)}
        linkType="internal"
        newTab
        getHref={(data) => (data.id ? `/ops/opex/${data.id}` : null)}
        onNavigate={onNavigate}
      />,
    );
    const link = screen.getByRole('link', { name: 'Opex line' });
    expect(link).toHaveAttribute('href', '/ops/opex/o1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.querySelector('svg')).toBeNull();

    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    fireEvent(link, click);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(false);
  });

  it('with newTab and no href, renders plain text', () => {
    render(<LinkCellRenderer<Row> {...params({ id: null, name: 'Common costs' })} newTab getHref={(data) => (data.id ? `/ops/opex/${data.id}` : null)} />);
    expect(screen.getByText('Common costs')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('without newTab, an internal link still navigates in place', () => {
    const onNavigate = vi.fn();
    const row = { id: 'o1', name: 'Opex line' };
    render(<LinkCellRenderer<Row> {...params(row)} linkType="internal" getHref={() => '/ops/opex/o1'} onNavigate={onNavigate} />);
    const link = screen.getByRole('link', { name: 'Opex line' });
    expect(link).not.toHaveAttribute('target');
    expect(link).not.toHaveAttribute('rel');
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith('/ops/opex/o1', row);
  });
});
