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
        getHref={(data) => (data.id ? `/ops/budget/${data.id}` : null)}
        onNavigate={onNavigate}
      />,
    );
    const link = screen.getByRole('link', { name: 'Opex line' });
    expect(link).toHaveAttribute('href', '/ops/budget/o1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.querySelector('svg')).toBeNull();

    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    fireEvent(link, click);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(false);
  });

  it('with newTab and no href, renders plain text', () => {
    render(<LinkCellRenderer<Row> {...params({ id: null, name: 'Common costs' })} newTab getHref={(data) => (data.id ? `/ops/budget/${data.id}` : null)} />);
    expect(screen.getByText('Common costs')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('without newTab, an internal link still navigates in place', () => {
    const onNavigate = vi.fn();
    const row = { id: 'o1', name: 'Opex line' };
    render(<LinkCellRenderer<Row> {...params(row)} linkType="internal" getHref={() => '/ops/budget/o1'} onNavigate={onNavigate} />);
    const link = screen.getByRole('link', { name: 'Opex line' });
    expect(link).not.toHaveAttribute('target');
    expect(link).not.toHaveAttribute('rel');
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith('/ops/budget/o1', row);
  });

  it('fills its grid cell with the link: any click in the cell opens the row, the href stays real', () => {
    const onNavigate = vi.fn();
    const row = { id: 's1', name: 'Okta' };
    const { container } = render(
      <div className="ag-cell">
        <LinkCellRenderer<Row> {...params(row)} linkType="internal" getHref={() => '/master-data/suppliers/s1'} onNavigate={onNavigate} />
      </div>,
    );
    const link = screen.getByRole('link', { name: 'Okta' });
    expect(link).toHaveAttribute('href', '/master-data/suppliers/s1');
    expect(container.querySelectorAll('a')).toHaveLength(1);

    // Ctrl/Cmd and middle clicks keep the browser's new tab; a plain click navigates in the app.
    const ctrlClick = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
    fireEvent(link, ctrlClick);
    expect(ctrlClick.defaultPrevented).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled();
    const cmdClick = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true });
    fireEvent(link, cmdClick);
    expect(cmdClick.defaultPrevented).toBe(false);
    const middleClick = new MouseEvent('click', { bubbles: true, cancelable: true, button: 1 });
    fireEvent(link, middleClick);
    expect(middleClick.defaultPrevented).toBe(false);
    const shiftClick = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, shiftKey: true });
    fireEvent(link, shiftClick);
    expect(shiftClick.defaultPrevented).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith('/master-data/suppliers/s1', row);

    // Inside a grid cell, the link's ::after covers the whole cell, padding included.
    const css = Array.from(document.querySelectorAll('style')).map((style) => style.textContent ?? '').join('');
    const linkClasses = Array.from(link.classList).filter((name) => name.startsWith('css-'));
    expect(linkClasses.some((name) => new RegExp(`\\.ag-cell \\.${name}::after\\{[^}]*position:absolute;[^}]*inset:0;`).test(css))).toBe(true);
  });
});
