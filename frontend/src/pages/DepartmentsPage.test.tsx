import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';
import DepartmentsPage from './DepartmentsPage';

const deleteButton = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const post = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })), post } }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../components/ServerDataGrid', () => ({ default: () => null }));
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvImportDialog', () => ({ default: () => null }));
vi.mock('../components/DeleteSelectedButton', () => ({
  default: (props: Record<string, any>) => {
    deleteButton.props = props;
    return null;
  },
}));

describe('DepartmentsPage delete', () => {
  it('asks the delete check before its confirmation, and names the records in its words', async () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter><DepartmentsPage /></MemoryRouter>
      </ThemeProvider>,
    );
    const props = deleteButton.props!;
    expect(props).not.toBeNull();
    const refused = [{ id: 'a', name: 'Finance', code: 'DEPARTMENT_IN_USE', usages: [{ type: 'opex_lines', total: 2 }] }];
    post.mockResolvedValueOnce({ data: { refused } });
    expect(await props.checkDelete(['a', 'b'])).toEqual({ refused });
    expect(post).toHaveBeenCalledWith('/departments/delete-check', { ids: ['a', 'b'] });
    expect(String(props.itemLabels.toDelete(2))).toBe('departments.delete.toDelete');
    expect(String(props.itemLabels.kept(1))).toBe('departments.delete.kept');
  });
});
