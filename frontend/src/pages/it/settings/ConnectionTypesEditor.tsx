import React from 'react';
import {
  Button,
  Checkbox,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { RequiredMark } from '../../../components/design';
import { useVirtualRows } from '../../../hooks/useVirtualRows';
import { useCatalogRemoval } from '../../../components/settings/useCatalogRemoval';
import { useEditorRows } from '../../../components/settings/useEditorRows';
import { useCatalogTranslations } from '../../../components/settings/CatalogTranslationsDialog';
import { catalogListIssues } from '../../../components/settings/catalogValidation';
import { connectionTypeCategoryLabel } from '../../../utils/itOpsCatalogDefaults';
import { useCatalogLocale } from '../../../hooks/useLocalizedTaskTypes';
import type { ConnectionTypeOption } from '../../../services/itOpsSettings';
import { IssueText, TranslateButton, withLocalIds } from './editorParts';

interface ConnectionTypesEditorProps {
  items: ConnectionTypeOption[];
  onChange: (items: ConnectionTypeOption[]) => void;
  readOnly?: boolean;
}

export const ConnectionTypesEditor = React.memo(function ConnectionTypesEditor({
  items,
  onChange,
  readOnly = false,
}: ConnectionTypesEditorProps) {
  const itemsWithIds = React.useMemo(() => withLocalIds(items, 'ct'), [items]);
  const [localItems, changeRows] = useEditorRows(itemsWithIds, onChange);
  const { containerRef, onScroll, useVirtual, visibleItems, paddingTop, paddingBottom, maxHeight } =
    useVirtualRows({ items: localItems, rowHeight: 60 });

  const handleUpdate = React.useCallback(
    (localId: string, patch: Partial<ConnectionTypeOption>) => {
      if (readOnly) return;
      changeRows((prev) => prev.map((row: any) => (row.localId === localId ? { ...row, ...patch } : row)));
    },
    [changeRows, readOnly]
  );

  const handleRemove = React.useCallback(
    (localId: string) => {
      changeRows((prev) => prev.filter((row: any) => row.localId !== localId));
    },
    [changeRows]
  );

  const { t } = useTranslation(['it', 'common']);
  // A shipped category is shown in the user's language until it is retyped; typing replaces the stored text.
  const catalogLocale = useCatalogLocale();
  const removal = useCatalogRemoval('connectionTypes');
  const translations = useCatalogTranslations();
  const issues = React.useMemo(() => catalogListIssues(localItems), [localItems]);
  const columnCount = readOnly ? 4 : 5;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <TableContainer ref={containerRef as any} onScroll={onScroll} sx={{ maxHeight }}>
        <Table size="small" stickyHeader={useVirtual}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: '22%' }}>{t('common:enumEditor.category')}</TableCell>
              <TableCell sx={{ width: '28%' }}>{t('common:enumEditor.name')}<RequiredMark /></TableCell>
              <TableCell sx={{ width: '25%' }}>{t('pages.settings.columns.typicalPorts')}</TableCell>
              <TableCell sx={{ width: '12%' }}>{t('common:enumEditor.noLongerOffered')}</TableCell>
              {!readOnly && <TableCell align="right" sx={{ width: '13%' }}>{t('common:labels.actions')}</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {useVirtual && paddingTop > 0 && (
              <TableRow><TableCell colSpan={columnCount} sx={{ p: 0, height: paddingTop, border: 0 }} /></TableRow>
            )}
            {localItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={columnCount}>
                  <Typography variant="body2" color="text.secondary">{t('pages.settings.empty.connectionTypes')}</Typography>
                </TableCell>
              </TableRow>
            )}
            {visibleItems.map((item: any) => (
              <TableRow key={item.localId}>
                <TableCell><TextField value={connectionTypeCategoryLabel(item.category || '', catalogLocale)} onChange={(e) => handleUpdate(item.localId, { category: e.target.value })} size="small" fullWidth placeholder={t('common:enumEditor.category')} disabled={readOnly} /></TableCell>
                <TableCell sx={{ verticalAlign: 'top' }}><TextField value={item.label} onChange={(e) => handleUpdate(item.localId, { label: e.target.value })} size="small" fullWidth required placeholder={t('pages.settings.placeholders.connectionName')} disabled={readOnly} inputProps={{ 'aria-label': t('common:enumEditor.name') }} /><IssueText issue={issues.get(localItems.indexOf(item))} /></TableCell>
                <TableCell><TextField value={item.typicalPorts || ''} onChange={(e) => handleUpdate(item.localId, { typicalPorts: e.target.value })} size="small" fullWidth placeholder={t('pages.settings.placeholders.typicalPorts')} disabled={readOnly} /></TableCell>
                <TableCell><Checkbox size="small" checked={!!item.deprecated} onChange={(e) => handleUpdate(item.localId, { deprecated: e.target.checked })} disabled={readOnly} inputProps={{ 'aria-label': `${t('common:enumEditor.noLongerOffered')} ${item.label}` }} /></TableCell>
                {!readOnly && (
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {item.code && <TranslateButton label={item.label} onClick={() => translations.openTranslations({ item, onSave: (next) => handleUpdate(item.localId, { translations: next } as any) })} />}
                    <Button size="small" color="error" onClick={() => void removal.requestRemoval({ name: item.label || item.code, key: item.code ? { code: item.code } : null, onRemove: () => handleRemove(item.localId), onRetire: () => handleUpdate(item.localId, { deprecated: true }) })}>{t('common:enumEditor.remove')}</Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {useVirtual && paddingBottom > 0 && (
              <TableRow><TableCell colSpan={columnCount} sx={{ p: 0, height: paddingBottom, border: 0 }} /></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {removal.dialog}
      {translations.dialog}
    </Paper>
  );
});

export default ConnectionTypesEditor;
