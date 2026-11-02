import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CreationPreview from './CreationPreview';

describe('CreationPreview', () => {
  it('shows its children dimmed, out of the pointer, keyboard and accessibility reach', () => {
    render(
      <CreationPreview>
        <label>Version <input /></label>
        <button type="button">Add contact</button>
      </CreationPreview>,
    );
    const preview = screen.getByTestId('creation-preview');
    expect(preview).toHaveAttribute('inert', '');
    expect(preview).toHaveAttribute('aria-hidden', 'true');
    const style = getComputedStyle(preview);
    expect(style.opacity).toBe('0.45');
    expect(style.pointerEvents).toBe('none');
    // Drawn, but absent from the accessibility tree.
    expect(within(preview).getByText('Add contact')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add contact' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(within(preview).getAllByRole('button', { hidden: true })).toHaveLength(1);
  });
});
