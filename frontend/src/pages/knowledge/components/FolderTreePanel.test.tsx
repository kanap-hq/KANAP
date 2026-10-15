import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { KanapDialogProvider } from '../../../components/design';
import FolderTreePanel from './FolderTreePanel';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() }));

vi.mock('../../../api', () => ({ default: api }));
vi.mock('react-i18next', () => {
  const t = (key: string, options?: Record<string, unknown>) => {
    const values = options ? Object.entries(options).filter(([name]) => name !== 'defaultValue') : [];
    return values.length ? `${key} ${JSON.stringify(Object.fromEntries(values))}` : key;
  };
  return {
    initReactI18next: { type: '3rdParty', init: () => undefined },
    useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
  };
});
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'me' } }) }));
vi.mock('../../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'acme' }) }));

const OPS = '11111111-1111-4111-8111-111111111111';
const EMPTY = '22222222-2222-4222-8222-222222222222';

function renderPanel() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <FolderTreePanel libraryId="lib" selectedFolderId={null} onSelectFolder={() => undefined} canManage />
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

async function deleteFolder(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: `folderTree.aria.folderActions {"name":"${name}"}` }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'common:buttons.delete' }));
  return screen.findByRole('dialog');
}

describe('FolderTreePanel delete', () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.get.mockResolvedValue({ data: { items: [{ id: OPS, name: 'Ops', children: [{ id: 'night', name: 'Night' }] }, { id: EMPTY, name: 'Empty' }] } });
  });

  it('asks first, and a folder with subfolders gets the refusal and why, with Close only', async () => {
    api.post.mockResolvedValue({ data: { refused: [{ id: OPS, name: 'Ops', code: 'KNOWLEDGE_FOLDER_HAS_SUBFOLDERS', usages: [{ type: 'sub_folders', total: 1 }] }] } });
    renderPanel();
    const dialog = await deleteFolder('Ops');
    expect(api.post).toHaveBeenCalledWith('/knowledge-folders/delete-check', { ids: [OPS] });
    expect(dialog).toHaveTextContent('common:delete.recordTitle {"name":"Ops"}');
    expect(dialog).toHaveTextContent('errors:KNOWLEDGE_FOLDER_HAS_SUBFOLDERS');
    expect(within(dialog).getAllByRole('button').map((button) => button.textContent).filter(Boolean)).toEqual(['buttons.close']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'buttons.close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('confirms the delete of a folder it can delete, naming it, and deletes it', async () => {
    api.post.mockResolvedValue({ data: { refused: [] } });
    api.delete.mockResolvedValue({ data: { ok: true } });
    renderPanel();
    const dialog = await deleteFolder('Empty');
    expect(dialog).toHaveTextContent('common:delete.recordTitle {"name":"Empty"}');
    expect(dialog).toHaveTextContent('folderTree.confirmations.deleteFolder {"name":"Empty"}');
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(`/knowledge-folders/${EMPTY}`));
  });

  it('says what happens to the documents, and nothing about subfolders, in each language', async () => {
    for (const lang of ['en', 'fr', 'de', 'es']) {
      const knowledge = (await import(`../../../locales/${lang}/knowledge.json`)).default as any;
      const text: string = knowledge.folderTree.confirmations.deleteFolder;
      expect(text, lang).toContain('{{name}}');
      expect(text, lang).not.toMatch(/subfolder|sous-dossier|Unterordner|subcarpeta/i);
    }
  });
});
