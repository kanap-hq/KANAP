import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import i18n from '../../../i18n';
import ConvertToProjectDialog from './ConvertToProjectDialog';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../api', () => ({ default: api }));

function renderDialog() {
  const onSuccess = vi.fn();
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <ConvertToProjectDialog
        open
        onClose={vi.fn()}
        onSuccess={onSuccess}
        request={{ id: 'req-1', name: 'Portail' }}
      />
    </ThemeProvider>,
  );
  return { onSuccess };
}

describe('ConvertToProjectDialog effort', () => {
  beforeEach(async () => {
    api.get.mockReset();
    api.post.mockReset();
    api.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/estimated-effort')) return { data: { estimated_effort_it: null, estimated_effort_business: null } };
      return { data: { content_markdown: '' } };
    });
    api.post.mockResolvedValue({ data: { id: 'prj-1' } });
    await i18n.changeLanguage('fr');
  });

  it('sends 1.5 for each effort when French types 1,5', async () => {
    const { onSuccess } = renderDialog();
    const itEffort = await screen.findByRole('textbox', { name: 'Charge IT (JH)' });
    const businessEffort = screen.getByRole('textbox', { name: 'Charge métier (JH)' });

    fireEvent.change(itEffort, { target: { value: '1,5' } });
    fireEvent.change(businessEffort, { target: { value: '1,5' } });

    expect(itEffort).toHaveValue('1,5');
    expect(businessEffort).toHaveValue('1,5');
    fireEvent.click(screen.getByRole('button', { name: 'Créer le projet' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/portfolio/requests/req-1/convert', {
      name: 'Portail',
      estimated_effort_it: 1.5,
      estimated_effort_business: 1.5,
    }));
    expect(onSuccess).toHaveBeenCalledWith('prj-1');
  });
});
