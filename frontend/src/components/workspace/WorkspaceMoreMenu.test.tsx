import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const i18n = vi.hoisted(() => ({ t: (key: string) => key }));
vi.mock('react-i18next', () => ({ useTranslation: () => i18n }));

import WorkspaceMoreMenu from './WorkspaceMoreMenu';

function renderMenu(items: Parameters<typeof WorkspaceMoreMenu>[0]['items']) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <WorkspaceMoreMenu items={items} />
    </ThemeProvider>,
  );
}

describe('WorkspaceMoreMenu', () => {
  it('opens a menu of its actions; an action closes it and runs', () => {
    const onClick = vi.fn();
    renderMenu([{ key: 'change-type', label: 'Change type…', onClick }]);
    const pill = screen.getByRole('button', { name: 'buttons.moreActions' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(pill);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Change type…' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows nothing without an action', () => {
    const { container } = renderMenu([]);
    expect(container).toBeEmptyDOMElement();
  });
});
