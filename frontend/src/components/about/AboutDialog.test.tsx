import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import AboutDialog from './AboutDialog';

vi.mock('react-i18next', () => {
  // One stable `t`: keys render as themselves.
  const t = (key: string) => key;
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});
vi.mock('./AboutContent', () => ({ default: () => <div>about-content</div> }));

function renderDialog(open: boolean, onClose = vi.fn()) {
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <AboutDialog open={open} onClose={onClose} />
    </ThemeProvider>,
  );
  return onClose;
}

describe('AboutDialog', () => {
  it('shows the title and the shared content, and closes from the close button', () => {
    const onClose = renderDialog(true);

    expect(screen.getByRole('dialog', { name: 'settings:about.title' })).toBeInTheDocument();
    expect(screen.getByText('about-content')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common:labels.closeDialog' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while closed', () => {
    renderDialog(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
