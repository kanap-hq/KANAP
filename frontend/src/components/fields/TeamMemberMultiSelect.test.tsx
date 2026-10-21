import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import TeamMemberMultiSelect from './TeamMemberMultiSelect';

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => (opts?.name ? `${key}(${opts.name})` : key),
  i18n: { language: 'en' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ profile: null }) }));
vi.mock('../../hooks/useLookupPicker', () => ({
  useLookupPicker: () => ({ options: [], searching: false, loading: false, autocomplete: {} }),
}));

function renderSelect(props: Partial<React.ComponentProps<typeof TeamMemberMultiSelect>> = {}) {
  const onChange = vi.fn().mockResolvedValue(undefined);
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter>
        <TeamMemberMultiSelect
          label="Business owners"
          hideLabel
          value={[{ user_id: 'u-1', user_display_name: 'Claire Dubois' }, { user_id: 'u-2', user_display_name: 'Marc Petit' }]}
          onChange={onChange}
          {...props}
        />
      </MemoryRouter>
    </ThemeProvider>,
  );
  return { onChange };
}

describe('TeamMemberMultiSelect', () => {
  it('lists the members on compact lines with a named remove action revealed on hover', () => {
    renderSelect();
    const remove = screen.getByRole('button', { name: 'selects.removeNamed(Claire Dubois)' });
    expect(remove.className).toContain('picked-name-remove');
    expect(remove.querySelector('[data-testid="CloseIcon"]')).toBeTruthy();
    expect(screen.queryByTestId('DeleteIcon')).toBeNull();
  });

  it('removes a member at once and keeps the others', async () => {
    const { onChange } = renderSelect();
    fireEvent.click(screen.getByRole('button', { name: 'selects.removeNamed(Marc Petit)' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(['u-1']));
  });

  it('shows no remove action when disabled', () => {
    renderSelect({ disabled: true });
    expect(screen.getByText('Claire Dubois')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /selects\.removeNamed/ })).toBeNull();
  });
});
