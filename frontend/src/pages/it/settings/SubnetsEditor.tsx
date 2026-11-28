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
import { useVirtualRows } from '../../../hooks/useVirtualRows';
import { useCatalogRemoval } from '../../../components/settings/useCatalogRemoval';
import { useEditorRows } from '../../../components/settings/useEditorRows';
import type { LocationOption } from '../../../hooks/useLocationOptions';
import type { ItOpsEnumOption, SubnetOption } from '../../../services/itOpsSettings';
import { withLocalIds } from './editorParts';

interface SubnetsEditorProps {
  items: SubnetOption[];
  networkZones: ItOpsEnumOption[];
  locations: LocationOption[];
  onChange: (items: SubnetOption[]) => void;
  readOnly?: boolean;
}

export const SubnetsEditor = React.memo(function SubnetsEditor({
  items,
  networkZones,
  locations,
  onChange,
  readOnly = false,
}: SubnetsEditorProps) {
  const itemsWithIds = React.useMemo(() => withLocalIds(items, 'subnet'), [items]);
  const [localItems, changeRows] = useEditorRows(itemsWithIds, onChange);
  const { containerRef, onScroll, useVirtual, visibleItems, paddingTop, paddingBottom, maxHeight } =
    useVirtualRows({ items: localItems, rowHeight: 60 });

  const handleUpdate = React.useCallback(
    (localId: string, patch: Partial<SubnetOption>) => {
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
  const removal = useCatalogRemoval('subnets');
  const columnCount = readOnly ? 6 : 7;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <TableContainer ref={containerRef as any} onScroll={onScroll} sx={{ maxHeight }}>
        <Table size="small" stickyHeader={useVirtual}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: '18%' }}>{t('pages.settings.columns.location')}</TableCell>
              <TableCell sx={{ width: '18%' }}>{t('pages.settings.columns.cidr')}</TableCell>
              <TableCell sx={{ width: '10%' }}>{t('pages.settings.columns.vlan')}</TableCell>
              <TableCell sx={{ width: '16%' }}>{t('pages.settings.columns.networkZone')}</TableCell>
              <TableCell sx={{ width: '20%' }}>{t('pages.settings.columns.description')}</TableCell>
              <TableCell sx={{ width: '8%' }}>{t('common:enumEditor.noLongerOffered')}</TableCell>
              {!readOnly && <TableCell align="right" sx={{ width: '10%' }}>{t('common:labels.actions')}</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {useVirtual && paddingTop > 0 && (
              <TableRow><TableCell colSpan={columnCount} sx={{ p: 0, height: paddingTop, border: 0 }} /></TableRow>
            )}
            {localItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={columnCount}>
                  <Typography variant="body2" color="text.secondary">{t('pages.settings.empty.subnets')}</Typography>
                </TableCell>
              </TableRow>
            )}
            {visibleItems.map((item: any) => (
              <TableRow key={item.localId}>
                <TableCell>
                  <TextField select value={item.location_id || ''} onChange={(e) => handleUpdate(item.localId, { location_id: e.target.value })} size="small" fullWidth disabled={readOnly} SelectProps={{ native: true }}>
                    <option value="">{t('pages.settings.placeholders.select')}</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.location_reference}{loc.name ? ` · ${loc.name}` : ''}
                      </option>
                    ))}
                  </TextField>
                </TableCell>
                <TableCell><TextField value={item.cidr || ''} onChange={(e) => handleUpdate(item.localId, { cidr: e.target.value })} size="small" fullWidth placeholder={t('pages.settings.placeholders.cidr')} disabled={readOnly} /></TableCell>
                <TableCell>
                  <TextField value={item.vlan_number ?? ''} onChange={(e) => handleUpdate(item.localId, { vlan_number: e.target.value.trim() === '' ? undefined : parseInt(e.target.value, 10) || undefined })} size="small" fullWidth placeholder="1-4094" type="number" disabled={readOnly} inputProps={{ min: 1, max: 4094 }} sx={{ '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 }, '& input[type=number]': { MozAppearance: 'textfield' } }} />
                </TableCell>
                <TableCell>
                  <TextField select value={item.network_zone || ''} onChange={(e) => handleUpdate(item.localId, { network_zone: e.target.value })} size="small" fullWidth disabled={readOnly} SelectProps={{ native: true }}>
                    <option value="">{t('pages.settings.placeholders.select')}</option>
                    {networkZones.filter((zone) => !zone.deprecated || zone.code === item.network_zone).map((zone) => <option key={zone.code} value={zone.code}>{zone.label}</option>)}
                  </TextField>
                </TableCell>
                <TableCell><TextField value={item.description || ''} onChange={(e) => handleUpdate(item.localId, { description: e.target.value })} size="small" fullWidth placeholder={t('pages.settings.columns.description')} disabled={readOnly} /></TableCell>
                <TableCell><Checkbox size="small" checked={!!item.deprecated} onChange={(e) => handleUpdate(item.localId, { deprecated: e.target.checked })} disabled={readOnly} inputProps={{ 'aria-label': `${t('common:enumEditor.noLongerOffered')} ${item.cidr}` }} /></TableCell>
                {!readOnly && <TableCell align="right"><Button size="small" color="error" onClick={() => void removal.requestRemoval({ name: item.cidr || '', key: item.location_id && item.cidr ? { location_id: item.location_id, cidr: item.cidr } : null, onRemove: () => handleRemove(item.localId), onRetire: () => handleUpdate(item.localId, { deprecated: true }) })}>{t('common:enumEditor.remove')}</Button></TableCell>}
              </TableRow>
            ))}
            {useVirtual && paddingBottom > 0 && (
              <TableRow><TableCell colSpan={columnCount} sx={{ p: 0, height: paddingBottom, border: 0 }} /></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {removal.dialog}
    </Paper>
  );
});

export default SubnetsEditor;
