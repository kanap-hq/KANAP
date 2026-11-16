import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import TeamMemberMultiSelect from './TeamMemberMultiSelect';

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => (opts?.name ? `${key}(${opts.name})` : key),
  i18n: { language: 'en' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ profile: null }) }));

// Records what the field forwards to the lookup. The real picker ignores `reset` and does not
// clear the box; a stable handler, because Autocomplete resets its text when `onInputChange` changes.
const lookup = vi.hoisted(() => {
  const changes: string[] = [];
  const options: Array<{ id: string; first_name: string; last_name: string }> = [];
  const onInputChange = (_event: unknown, next: string, reason: string) => {
    changes.push(`${reason}:${next}`);
  };
  return { options, changes, onInputChange };
});
vi.mock('../../hooks/useLookupPicker', () => ({
  useLookupPicker: () => ({
    options: lookup.options,
    searching: false,
    loading: false,
    autocomplete: { onInputChange: lookup.onInputChange },
  }),
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

const NAMES: Record<string, string> = {
  'u-marc': 'Marc Petit',
  'u-sophie': 'Sophie Martin',
};

function renderOwners() {
  const added: string[][] = [];
  function Owners() {
    const [members, setMembers] = React.useState<Array<{ user_id: string; user_display_name: string }>>([]);
    return (
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <TeamMemberMultiSelect
            label="IT owners"
            hideLabel
            value={members}
            onChange={async (ids) => {
              added.push(ids);
              setMembers(ids.map((id) => ({ user_id: id, user_display_name: NAMES[id] ?? id })));
            }}
          />
        </MemoryRouter>
      </ThemeProvider>
    );
  }
  render(<Owners />);
  return { added };
}

describe('TeamMemberMultiSelect', () => {
  beforeEach(() => {
    lookup.options.splice(0, lookup.options.length);
    lookup.changes.splice(0, lookup.changes.length);
  });

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

  it('empties the field after a choice by mouse and by keyboard, and keeps the focus', async () => {
    lookup.options.push(
      { id: 'u-marc', first_name: 'Marc', last_name: 'Petit' },
      { id: 'u-sophie', first_name: 'Sophie', last_name: 'Martin' },
    );
    const { added } = renderOwners();
    const user = userEvent.setup();
    const input = screen.getByRole('combobox');

    await user.click(input);
    await user.type(input, 'mar');
    expect((input as HTMLInputElement).value).toBe('mar');
    await user.click(await screen.findByRole('option', { name: 'Marc Petit' }));

    await waitFor(() => expect(added[added.length - 1]).toEqual(['u-marc']));
    expect((input as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole('button', { name: 'selects.removeNamed(Marc Petit)' })).toBeTruthy();
    // The typed text still reaches the lookup, which is what searches the colleagues.
    expect(lookup.changes).toContain('input:mar');

    await user.type(input, 'so');
    expect((input as HTMLInputElement).value).toBe('so');
    await user.keyboard('{ArrowDown}{Enter}');

    await waitFor(() => expect(added[added.length - 1]).toEqual(['u-marc', 'u-sophie']));
    expect((input as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole('button', { name: 'selects.removeNamed(Sophie Martin)' })).toBeTruthy();
  });
});
