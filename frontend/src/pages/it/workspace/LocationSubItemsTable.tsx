import React from 'react';
import {
  Alert,
  Box,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { tableCellTextFieldSx } from '../../../theme/formSx';
import DeleteIcon from '@mui/icons-material/Delete';
import api from '../../../api';
import { useTranslation } from 'react-i18next';
import KanapDialog from '../../../components/design/KanapDialog';
import { getApiErrorMessage, isDuplicateError } from '../../../utils/apiErrorMessage';

type SubItem = {
  id: string;
  name: string;
  description: string | null;
  usage_count: number;
  /** 'netbox' when an inventory synchronisation owns this row. */
  external_source?: string | null;
  external_url?: string | null;
};

type DraftRow = {
  draftId: string;
  name: string;
  description: string;
};

type Props = {
  locationId: string;
  canManage: boolean;
  onCountChange?: (count: number) => void;
};

const headerSx = {
  fontSize: 12,
  fontWeight: 500,
  color: 'kanap.text.tertiary',
  textTransform: 'none',
  letterSpacing: 0,
  pb: 1,
} as const;

const cellSx = {
  fontSize: 13,
  color: 'kanap.text.primary',
  py: '8px',
} as const;

const inputSx = tableCellTextFieldSx;

function sortByName(rows: SubItem[]): SubItem[] {
  return [...rows].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
  );
}

export default function LocationSubItemsTable({ locationId, canManage, onCountChange }: Props) {
  const { t } = useTranslation(['it', 'common']);
  const [items, setItems] = React.useState<SubItem[]>([]);
  const [drafts, setDrafts] = React.useState<DraftRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  // A name another sub-location of the location has shows under that row's name, by row or draft id.
  const [nameErrors, setNameErrors] = React.useState<Record<string, string>>({});
  const setNameError = (key: string, message: string | null) => setNameErrors((prev) => {
    const next = { ...prev };
    if (message) next[key] = message;
    else delete next[key];
    return next;
  });
  const [pendingDelete, setPendingDelete] = React.useState<SubItem | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await api.get(`/locations/${locationId}/sub-items`);
      const data: SubItem[] = sortByName((res.data || []) as SubItem[]);
      setItems(data);
      onCountChange?.(data.length);
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.loadSubLocationsFailed')));
    }
  }, [locationId, onCountChange, t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleSaveRow = async (item: SubItem, patch: Partial<{ name: string; description: string | null }>) => {
    const trimmedName = (patch.name ?? item.name).trim();
    if (!trimmedName) {
      setError('Sub-location name is required.');
      return;
    }
    setItems((prev) => sortByName(prev.map((r) => (r.id === item.id ? { ...r, ...patch } : r))));
    setNameError(item.id, null);
    try {
      await api.patch(`/locations/${locationId}/sub-items/${item.id}`, {
        name: trimmedName,
        description: patch.description ?? item.description,
      });
      setError(null);
    } catch (e: any) {
      if (isDuplicateError(e)) setNameError(item.id, t('messages.subLocationNameTaken'));
      else setError(getApiErrorMessage(e, t, t('messages.saveSubLocationsFailed')));
      void load();
    }
  };

  const performDelete = async (item: SubItem) => {
    if (!canManage) return;
    const prev = items;
    setDeleting(true);
    setItems((current) => {
      const next = current.filter((r) => r.id !== item.id);
      onCountChange?.(next.length);
      return next;
    });
    try {
      await api.delete(`/locations/${locationId}/sub-items/${item.id}`);
      setError(null);
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.saveSubLocationsFailed')));
      setItems(prev);
      onCountChange?.(prev.length);
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  const requestDelete = (item: SubItem) => {
    if (!canManage) return;
    if (item.usage_count > 0) {
      setPendingDelete(item);
    } else {
      void performDelete(item);
    }
  };

  const updateDraft = (draftId: string, patch: Partial<DraftRow>) => {
    setDrafts((rows) => rows.map((r) => (r.draftId === draftId ? { ...r, ...patch } : r)));
  };

  const removeDraft = (draftId: string) => {
    setDrafts((rows) => rows.filter((r) => r.draftId !== draftId));
    setNameError(draftId, null);
  };

  const commitDraft = async (draft: DraftRow) => {
    const trimmedName = draft.name.trim();
    if (!trimmedName) {
      removeDraft(draft.draftId);
      return;
    }
    try {
      const res = await api.post(`/locations/${locationId}/sub-items`, {
        name: trimmedName,
        description: draft.description.trim() || null,
      });
      const saved: SubItem = { ...(res.data as SubItem), usage_count: 0 };
      setItems((prev) => {
        const next = sortByName([...prev, saved]);
        onCountChange?.(next.length);
        return next;
      });
      removeDraft(draft.draftId);
      setError(null);
    } catch (e: any) {
      if (isDuplicateError(e)) setNameError(draft.draftId, t('messages.subLocationNameTaken'));
      else setError(getApiErrorMessage(e, t, t('messages.saveSubLocationsFailed')));
    }
  };

  const addDraft = () => {
    setDrafts((rows) => [
      ...rows,
      { draftId: `draft-${Date.now()}-${rows.length}`, name: '', description: '' },
    ]);
  };

  const hasContent = items.length > 0 || drafts.length > 0;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
        <Typography sx={{ fontSize: 16, fontWeight: 500, color: 'kanap.text.primary' }}>
          Sub-locations
        </Typography>
        {canManage && (
          <Box
            component="button"
            type="button"
            onClick={addDraft}
            sx={(theme) => ({
              all: 'unset',
              cursor: 'pointer',
              fontSize: 12,
              color: theme.palette.kanap.teal,
              fontWeight: 400,
              '&:hover': { textDecoration: 'underline' },
            })}
          >
            + Add sub-location
          </Box>
        )}
      </Box>
      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
      {!hasContent && (
        <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>
          No sub-locations defined. Add buildings, rooms, racks, or other physical areas.
        </Typography>
      )}
      {hasContent && (
        <Box
          component="table"
          sx={(theme) => ({
            width: '100%',
            borderCollapse: 'collapse',
            '& th': {
              ...headerSx,
              textAlign: 'left',
              borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
            },
            '& td': {
              ...cellSx,
              borderBottom: `1px solid ${theme.palette.kanap.border.soft}`,
              verticalAlign: 'top',
            },
            '& tbody tr:hover': {
              backgroundColor: theme.palette.kanap.bg.hover,
            },
          })}
        >
          <Box component="thead">
            <Box component="tr">
              <Box component="th" sx={{ width: '36%' }}>Name</Box>
              <Box component="th">Description</Box>
              <Box component="th" sx={{ width: 90, textAlign: 'right' }}>Usage</Box>
              {canManage && <Box component="th" sx={{ width: 40 }} />}
            </Box>
          </Box>
          <Box component="tbody">
            {items.map((row) => (
              <SubItemRow
                key={row.id}
                row={row}
                canManage={canManage}
                nameError={nameErrors[row.id]}
                onSave={(patch) => handleSaveRow(row, patch)}
                onDelete={() => requestDelete(row)}
              />
            ))}
            {drafts.map((draft) => (
              <Box component="tr" key={draft.draftId}>
                <Box component="td">
                  <TextField
                    value={draft.name}
                    onChange={(e) => updateDraft(draft.draftId, { name: e.target.value })}
                    onBlur={() => { void commitDraft(draft); }}
                    placeholder="e.g., Building A — Room 1 — Rack 5"
                    error={!!nameErrors[draft.draftId]}
                    helperText={nameErrors[draft.draftId]}
                    variant="standard"
                    fullWidth
                    autoFocus
                    sx={inputSx}
                  />
                </Box>
                <Box component="td">
                  <TextField
                    value={draft.description}
                    onChange={(e) => updateDraft(draft.draftId, { description: e.target.value })}
                    placeholder="Optional description"
                    variant="standard"
                    fullWidth
                    sx={inputSx}
                  />
                </Box>
                <Box component="td" sx={{ textAlign: 'right', color: 'kanap.text.tertiary' }}>—</Box>
                {canManage && (
                  <Box component="td">
                    <IconButton size="small" onClick={() => removeDraft(draft.draftId)} aria-label="Discard">
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      <KanapDialog
        open={!!pendingDelete}
        title="Delete sub-location?"
        onClose={() => !deleting && setPendingDelete(null)}
        onSave={async () => {
          if (pendingDelete) await performDelete(pendingDelete);
        }}
        saveLabel="Delete anyway"
        saveDisabled={deleting}
        saveLoading={deleting}
      >
        <Stack spacing={1}>
          <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>
            <Box component="strong" sx={{ fontWeight: 500 }}>
              {pendingDelete?.usage_count ?? 0} asset{(pendingDelete?.usage_count ?? 0) === 1 ? ' is' : 's are'}
            </Box>{' '}
            currently assigned to{' '}
            <Box component="strong" sx={{ fontWeight: 500 }}>
              {pendingDelete?.name}
            </Box>
            . Deleting this sub-location will leave{' '}
            {(pendingDelete?.usage_count ?? 0) === 1 ? 'it' : 'them'} without a sub-location assignment.
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
            The asset records themselves are kept; only their sub-location link is cleared.
          </Typography>
        </Stack>
      </KanapDialog>
    </Box>
  );
}

function SubItemRow({
  row,
  canManage,
  nameError,
  onSave,
  onDelete,
}: {
  row: SubItem;
  canManage: boolean;
  nameError?: string;
  onSave: (patch: Partial<{ name: string; description: string | null }>) => void;
  onDelete: () => void;
}) {
  const [name, setName] = React.useState(row.name);
  const [description, setDescription] = React.useState(row.description || '');

  React.useEffect(() => { setName(row.name); }, [row.name]);
  React.useEffect(() => { setDescription(row.description || ''); }, [row.description]);

  return (
    <Box component="tr">
      <Box component="td">
        <Stack direction="row" spacing={0.75} alignItems="center">
          <TextField
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim() !== row.name) onSave({ name });
            }}
            error={!!nameError}
            helperText={nameError}
            variant="standard"
            fullWidth
            disabled={!canManage}
            sx={inputSx}
          />
          {/* The row is kept in step with an inventory: a manual rename is put
              back in line at the next run. It stays fully editable. */}
          {row.external_source === 'netbox' ? (
            row.external_url ? (
              <Box
                component="a"
                href={row.external_url}
                target="_blank"
                rel="noreferrer"
                sx={{ fontSize: 11, color: 'kanap.text.tertiary', whiteSpace: 'nowrap', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
              >
                Netbox
              </Box>
            ) : (
              <Box component="span" sx={{ fontSize: 11, color: 'kanap.text.tertiary', whiteSpace: 'nowrap' }}>
                Netbox
              </Box>
            )
          ) : null}
        </Stack>
      </Box>
      <Box component="td">
        <TextField
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => {
            const next = description || null;
            if (next !== (row.description || null)) onSave({ description: next });
          }}
          placeholder="Optional description"
          variant="standard"
          fullWidth
          disabled={!canManage}
          sx={inputSx}
        />
      </Box>
      <Box
        component="td"
        sx={{
          textAlign: 'right',
          color: row.usage_count > 0 ? 'kanap.text.secondary' : 'kanap.text.tertiary',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {row.usage_count > 0
          ? `${row.usage_count} asset${row.usage_count === 1 ? '' : 's'}`
          : '—'}
      </Box>
      {canManage && (
        <Box component="td">
          <IconButton size="small" onClick={onDelete} aria-label="Delete sub-location">
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      )}
    </Box>
  );
}
