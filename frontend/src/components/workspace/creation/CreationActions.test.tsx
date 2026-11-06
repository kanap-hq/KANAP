import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CreationActions from './CreationActions';

describe('CreationActions', () => {
  it('keeps Create clickable while the record is written, Cancel waits', () => {
    const onCreate = vi.fn();
    render(<CreationActions onCreate={onCreate} onCancel={vi.fn()} writing />);
    const [cancel, create] = screen.getAllByRole('button');
    expect(cancel).toBeDisabled();
    expect(create).toBeEnabled();
    fireEvent.click(create);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('holds both while a check or a cancel runs', () => {
    render(<CreationActions onCreate={vi.fn()} onCancel={vi.fn()} busy />);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  });
});
