import React from 'react';
import {
  Box,
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
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { RequiredMark } from '../../../components/design';
import { useCatalogRemoval } from '../../../components/settings/useCatalogRemoval';
import { useEditorRows } from '../../../components/settings/useEditorRows';
import { useCatalogTranslations } from '../../../components/settings/CatalogTranslationsDialog';
import { catalogListIssues } from '../../../components/settings/catalogValidation';
import type { AdminZoneOption } from '../../../services/itOpsSettings';
import { IssueText, TranslateButton, withLocalIds } from './editorParts';

/** The server's limits (`it-ops-settings.service.ts`): a longer value would be refused. */
const ADMIN_ZONE_LIMITS = { admin_group: 200, description: 2000 } as const;

interface AdminZonesEditorProps {
  items: AdminZoneOption[];
  onChange: (items: AdminZoneOption[]) => void;
  readOnly?: boolean;
}

/** Move the row `activeId` to the place of `overId`. Same array when nothing moves. */
export function reorderById<T extends { localId?: string }>(items: T[], activeId: string, overId: string): T[] {
  if (activeId === overId) return items;
  const oldIndex = items.findIndex((row) => row.localId === activeId);
  const newIndex = items.findIndex((row) => row.localId === overId);
  if (oldIndex < 0 || newIndex < 0) return items;
  return arrayMove(items, oldIndex, newIndex);
}

function SortableAdminZoneRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { t } = useTranslation(['it', 'common']);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <TableRow
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
    >
      <TableCell sx={{ width: '4%', verticalAlign: 'top', px: 0.5 }}>
        <Box
          component="span"
          aria-label={t('pages.settings.lists.adminZones.dragToReorder')}
          sx={{ display: 'inline-flex', cursor: 'grab', touchAction: 'none', color: 'kanap.text.secondary', mt: 0.75 }}
          {...attributes}
          {...listeners}
        >
          <DragIndicatorIcon sx={{ fontSize: 18 }} />
        </Box>
      </TableCell>
      {children}
    </TableRow>
  );
}

/** Administration zones: name, administrator group and description per zone. */
export const AdminZonesEditor = React.memo(function AdminZonesEditor({ items, onChange, readOnly = false }: AdminZonesEditorProps) {
  const itemsWithIds = React.useMemo(() => withLocalIds(items, 'adminZones'), [items]);
  const [localItems, changeRows] = useEditorRows(itemsWithIds, onChange);

  const handleUpdate = React.useCallback((localId: string, patch: Partial<AdminZoneOption>) => {
    if (readOnly) return;
    changeRows((prev) => prev.map((row: any) => (row.localId === localId ? { ...row, ...patch } : row)));
  }, [changeRows, readOnly]);

  const handleRemove = React.useCallback((localId: string) => {
    changeRows((prev) => prev.filter((row: any) => row.localId !== localId));
  }, [changeRows]);

  const { t } = useTranslation(['it', 'common']);
  const removal = useCatalogRemoval('adminZones');
  const translations = useCatalogTranslations();
  const issues = React.useMemo(() => catalogListIssues(localItems), [localItems]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    if (readOnly) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    changeRows((prev) => reorderById(prev, String(active.id), String(over.id)));
  }, [changeRows, readOnly]);
  const text = (item: any, key: 'admin_group' | 'description', placeholder: string) => (
    <TextField value={item[key] || ''} onChange={(e) => handleUpdate(item.localId, { [key]: e.target.value || undefined })} size="small" fullWidth placeholder={placeholder} disabled={readOnly} inputProps={{ maxLength: ADMIN_ZONE_LIMITS[key], 'aria-label': `${t(`pages.settings.columns.${key === 'admin_group' ? 'adminGroup' : 'description'}`)} ${item.label}` }} />
  );
  const columnCount = readOnly ? 5 : 6;
  const zoneRows = localItems.map((item: any) => {
    const cells = (
      <>
        <TableCell sx={{ verticalAlign: 'top' }}>
          <TextField value={item.label} onChange={(e) => handleUpdate(item.localId, { label: e.target.value })} size="small" fullWidth required placeholder={t('pages.settings.placeholders.adminZoneName')} disabled={readOnly} inputProps={{ maxLength: 200, 'aria-label': t('common:enumEditor.name') }} />
          <IssueText issue={issues.get(localItems.indexOf(item))} />
        </TableCell>
        <TableCell>{text(item, 'admin_group', t('pages.settings.placeholders.adminGroup'))}</TableCell>
        <TableCell>{text(item, 'description', t('pages.settings.placeholders.adminZoneDescription'))}</TableCell>
        <TableCell><Checkbox size="small" checked={!!item.deprecated} onChange={(e) => handleUpdate(item.localId, { deprecated: e.target.checked })} disabled={readOnly} inputProps={{ 'aria-label': `${t('common:enumEditor.noLongerOffered')} ${item.label}` }} /></TableCell>
        {!readOnly && (
          <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
            {item.code && <TranslateButton label={item.label} onClick={() => translations.openTranslations({ item, onSave: (next) => handleUpdate(item.localId, { translations: next } as any) })} />}
            <Button size="small" color="error" onClick={() => void removal.requestRemoval({ name: item.label || item.code, key: item.code ? { code: item.code } : null, onRemove: () => handleRemove(item.localId), onRetire: () => handleUpdate(item.localId, { deprecated: true }) })}>{t('common:enumEditor.remove')}</Button>
          </TableCell>
        )}
      </>
    );
    return readOnly
      ? <TableRow key={item.localId}>{cells}</TableRow>
      : <SortableAdminZoneRow key={item.localId} id={item.localId}>{cells}</SortableAdminZoneRow>;
  });
  const zoneBody = (
    <>
      {localItems.length === 0 && (
        <TableRow>
          <TableCell colSpan={columnCount}>
            <Typography variant="body2" color="text.secondary">{t('pages.settings.empty.adminZones')}</Typography>
          </TableCell>
        </TableRow>
      )}
      {zoneRows}
    </>
  );

  const zoneTable = (
    <Table size="small" sx={{ tableLayout: 'fixed' }}>
      <TableHead>
        <TableRow>
          {!readOnly && <TableCell sx={{ width: '4%' }} />}
          <TableCell sx={{ width: '22%' }}>{t('common:enumEditor.name')}<RequiredMark /></TableCell>
          <TableCell sx={{ width: '20%' }}>{t('pages.settings.columns.adminGroup')}</TableCell>
          <TableCell sx={{ width: '28%' }}>{t('pages.settings.columns.description')}</TableCell>
          <TableCell sx={{ width: '8%' }}>{t('common:enumEditor.noLongerOffered')}</TableCell>
          {!readOnly && <TableCell align="right" sx={{ width: '18%' }}>{t('common:labels.actions')}</TableCell>}
        </TableRow>
      </TableHead>
      <TableBody>
        {readOnly ? zoneBody : (
          <SortableContext items={localItems.map((item: any) => item.localId)} strategy={verticalListSortingStrategy}>
            {zoneBody}
          </SortableContext>
        )}
      </TableBody>
    </Table>
  );

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t('pages.settings.lists.adminZones.orderHint')}</Typography>
      <TableContainer>
        {readOnly ? zoneTable : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            {zoneTable}
          </DndContext>
        )}
      </TableContainer>
      {removal.dialog}
      {translations.dialog}
    </Paper>
  );
});

export default AdminZonesEditor;
