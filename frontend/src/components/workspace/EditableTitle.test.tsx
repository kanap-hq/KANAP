import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import EditableTitle from './EditableTitle';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const LABEL = 'common:buttons.editTitle';

function renderTitle(props: Partial<React.ComponentProps<typeof EditableTitle>> = {}) {
  const onSave = props.onSave ?? vi.fn();
  const view = render(
    <ThemeProvider theme={createAppTheme('light')}>
      <EditableTitle value="Payroll" fallback="New incident" canEdit onSave={onSave} {...props} />
    </ThemeProvider>,
  );
  return { ...view, onSave };
}

function cue(container: HTMLElement) {
  return container.querySelector('.editable-title-cue') as HTMLElement | null;
}

describe('EditableTitle', () => {
  it('is focusable and opens the field on Enter', () => {
    renderTitle();
    const title = screen.getByRole('button', { name: LABEL });
    expect(title).toHaveAttribute('tabindex', '0');
    expect(title).toHaveTextContent('Payroll');
    title.focus();
    expect(title).toHaveFocus();

    fireEvent.keyDown(title, { key: 'Enter' });
    const input = screen.getByRole('textbox', { name: LABEL });
    expect(input).toHaveValue('Payroll');
    expect(input).toHaveFocus();
  });

  it('opens on Space when the key is released, so the space is not typed into the field', () => {
    renderTitle();
    const title = screen.getByRole('button', { name: LABEL });
    fireEvent.keyDown(title, { key: ' ' });
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.keyUp(title, { key: ' ' });
    expect(screen.getByRole('textbox')).toHaveValue('Payroll');
  });

  it('commits on Enter and cancels on Escape, then returns focus to the title', () => {
    const { onSave } = renderTitle();
    fireEvent.keyDown(screen.getByRole('button', { name: LABEL }), { key: 'Enter' });
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '  Payroll renamed  ' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: LABEL })).toHaveFocus();
    expect(screen.getByRole('button', { name: LABEL })).toHaveTextContent('Payroll');

    fireEvent.keyDown(screen.getByRole('button', { name: LABEL }), { key: 'Enter' });
    const again = screen.getByRole('textbox');
    fireEvent.change(again, { target: { value: '  Payroll renamed  ' } });
    fireEvent.keyDown(again, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('Payroll renamed');
    expect(screen.getByRole('button', { name: LABEL })).toHaveFocus();
  });

  it('keeps an empty title open when a message says it is required', () => {
    const { onSave } = renderTitle({ requiredMessage: 'The name is required' });
    fireEvent.click(screen.getByText('Payroll'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('The name is required');
    expect(screen.getByRole('textbox')).toHaveValue('   ');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows a dashed underline and a pencil on an empty title', () => {
    const { container } = renderTitle({ value: '' });
    const text = screen.getByText('New incident');
    expect(text).toHaveStyle({ borderBottomStyle: 'dashed' });
    const pencil = cue(container);
    expect(pencil).not.toBeNull();
    expect(getComputedStyle(pencil as HTMLElement).display).not.toBe('none');
  });

  it('hides the pencil of a saved title until hover or focus', () => {
    const { container } = renderTitle();
    const pencil = cue(container);
    expect(pencil).not.toBeNull();
    expect(getComputedStyle(pencil as HTMLElement).display).toBe('none');
    expect(screen.getByText('Payroll')).not.toHaveStyle({ borderBottomStyle: 'dashed' });

    const title = screen.getByRole('button', { name: LABEL });
    title.focus();
    expect(getComputedStyle(pencil as HTMLElement).display).toBe('inline-block');
    expect(title).toHaveStyle({ backgroundColor: 'rgba(0, 0, 0, 0.04)' });
  });

  it('keeps a caller-supplied title size', () => {
    renderTitle({ typography: { fontSize: '1.25rem', fontWeight: 500, lineHeight: 1.334 } });
    const title = screen.getByRole('button', { name: LABEL });
    expect(getComputedStyle(title).fontSize).toBe('20px');
    expect(getComputedStyle(title).fontWeight).toBe('500');
  });

  it('draws no cue when the title cannot be edited', () => {
    const { container } = renderTitle({ canEdit: false, value: '' });
    expect(screen.queryByRole('button', { name: LABEL })).toBeNull();
    expect(cue(container)).toBeNull();
    expect(screen.getByText('New incident')).not.toHaveStyle({ borderBottomStyle: 'dashed' });
    expect(screen.getByText('New incident')).toBeInTheDocument();
  });
});
