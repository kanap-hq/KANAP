import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';
import ChipToggleBar, { ChipToggleContextLine } from './ChipToggleBar';

const ITEMS = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: <>Beta<span> off</span></>, ariaLabel: 'Beta, disabled' },
  { id: 'c', label: 'Gamma', tooltip: 'Gamma chart' },
];

function renderBar(props: Partial<React.ComponentProps<typeof ChipToggleBar>> = {}) {
  const onSelect = vi.fn();
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <ChipToggleBar items={ITEMS} selectedId="a" onSelect={onSelect} ariaLabel="Things" {...props} />
    </ThemeProvider>,
  );
  return onSelect;
}

describe('ChipToggleBar', () => {
  it('renders one toggle per item in a labelled group, the selected one pressed', () => {
    renderBar({ selectedId: 'c' });
    const toggles = within(screen.getByRole('group', { name: 'Things' })).getAllByRole('button');
    expect(toggles.map((el) => el.textContent)).toEqual(['Alpha', 'Beta off', 'Gamma']);
    expect(toggles.map((el) => el.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
    expect(screen.getByRole('button', { name: 'Beta, disabled' })).toBe(toggles[1]);
  });

  it('reports the clicked item', () => {
    const onSelect = renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Gamma' }));
    expect(onSelect).toHaveBeenCalledWith('c');
  });

  it('renders the actions next to the group, outside it', () => {
    const onAction = vi.fn();
    renderBar({ actions: <button type="button" onClick={onAction}>New</button> });
    const action = screen.getByRole('button', { name: 'New' });
    expect(within(screen.getByRole('group', { name: 'Things' })).queryByRole('button', { name: 'New' })).toBeNull();
    fireEvent.click(action);
    expect(onAction).toHaveBeenCalled();
  });

  it('renders no action area without actions', () => {
    renderBar();
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('passes drag events to the item and marks the highlighted one', () => {
    const onDragOver = vi.fn();
    const onDragLeave = vi.fn();
    const onDrop = vi.fn();
    renderBar({
      items: [
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Beta', onDragOver, onDragLeave, onDrop, highlighted: true },
      ],
    });
    const beta = screen.getByRole('button', { name: 'Beta' });
    fireEvent.dragOver(beta);
    fireEvent.dragLeave(beta);
    fireEvent.drop(beta);
    expect(onDragOver).toHaveBeenCalledTimes(1);
    expect(onDragLeave).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(beta).toHaveAttribute('data-highlighted', 'true');
    expect(screen.getByRole('button', { name: 'Alpha' })).not.toHaveAttribute('data-highlighted');
  });
});

describe('ChipToggleContextLine', () => {
  it('renders the title, the actions on its line and the secondary lines', () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <ChipToggleContextLine testId="ctx" title="Alpha · 3 things" actions={<button type="button">New thing</button>}>
          <span>Restricted</span>
        </ChipToggleContextLine>
      </ThemeProvider>,
    );
    const line = screen.getByTestId('ctx');
    expect(line).toHaveTextContent('Alpha · 3 things');
    expect(within(line).getByRole('button', { name: 'New thing' })).toBeInTheDocument();
    expect(line).toHaveTextContent('Restricted');
  });
});
