import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import InterfacesPage from './InterfacesPage';

const deleteButton = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const post = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { initReactI18next: { type: '3rdParty', init: () => undefined }, useTranslation: () => translation };
});
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key, language: 'en' } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../api', () => ({ default: { get: vi.fn(async () => ({ data: [] })), post } }));
vi.mock('../../hooks/useApplicationClassificationCatalog', () => ({ default: () => ({ data: { businessCriticalityLevels: [] } }) }));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ byField: { lifecycleStatus: [], interfaceDataCategory: [] }, labelFor: (_field: string, code: string) => code }),
}));
vi.mock('../../components/ServerDataGrid', () => ({ default: () => null }));
vi.mock('../../components/DeleteSelectedButton', () => ({
  default: (props: Record<string, any>) => {
    deleteButton.props = props;
    return null;
  },
}));

describe('InterfacesPage delete', () => {
  it('asks the check before its confirmation, and lets the bindings option lift the refusal', async () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter><InterfacesPage /></MemoryRouter>
      </ThemeProvider>,
    );
    const props = deleteButton.props!;
    expect(props).not.toBeNull();
    expect(props.endpoint).toBe('/interfaces/bulk');
    const refused = [{ id: 'a', name: 'Orders', code: 'INTERFACE_HAS_BINDINGS', usages: [{ type: 'interface_bindings', total: 2 }] }];
    post.mockResolvedValueOnce({ data: { refused } });
    expect(await props.checkDelete(['a', 'b'])).toEqual({ refused, cascadeLifts: ['INTERFACE_HAS_BINDINGS'] });
    expect(post).toHaveBeenCalledWith('/interfaces/delete-check', { ids: ['a', 'b'] });
    expect(props.cascadeOption.apiKey).toBe('deleteRelatedBindings');
    expect(String(props.itemLabels.toDelete(2))).toBe('pages.interfaces.delete.toDelete');
    expect(String(props.itemLabels.kept(1))).toBe('pages.interfaces.delete.kept');
    expect(String(props.itemLabels.deleted(2))).toBe('pages.interfaces.delete.deleted');
  });
});
