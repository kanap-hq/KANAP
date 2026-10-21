import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const i18n = vi.hoisted(() => ({ t: (key: string) => key }));
vi.mock('react-i18next', () => ({ useTranslation: () => i18n }));

import DeleteIconButton from './DeleteIconButton';

function renderButton(props: React.ComponentProps<typeof DeleteIconButton>) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <DeleteIconButton {...props} />
    </ThemeProvider>,
  );
}

describe('DeleteIconButton', () => {
  it('is an icon-only button named Delete that runs its action', () => {
    const onClick = vi.fn();
    renderButton({ onClick });
    const button = screen.getByRole('button', { name: 'common:buttons.delete' });
    expect(button).toHaveAttribute('aria-label', 'common:buttons.delete');
    expect(button).not.toHaveTextContent('common:buttons.delete');
    expect(button.querySelector('svg')).not.toBeNull();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows the Delete tooltip on hover', async () => {
    renderButton({ onClick: vi.fn() });
    fireEvent.mouseOver(screen.getByRole('button', { name: 'common:buttons.delete' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('common:buttons.delete');
  });

  it('does nothing while disabled', () => {
    const onClick = vi.fn();
    renderButton({ onClick, disabled: true });
    const button = screen.getByRole('button', { name: 'common:buttons.delete' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
