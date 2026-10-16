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
import { Trans, useTranslation } from 'react-i18next';
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

// A row keeps its key from the moment it is added: saving a new sub-location only fills `item`, so
// the row being typed in stays mounted and keeps its focus and what was typed.
type Entry = { key: string; item: SubItem | null };
type SubItemPatch = Partial<{ name: string; description: string | null }>;

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

// Stored rows by name, then the new rows not saved yet, in the order they were added.
function sortByName(rows: Entry[]): Entry[] {
  const stored = rows.filter((e) => e.item).sort((a, b) =>
    a.item!.name.localeCompare(b.item!.name, undefined, { sensitivity: 'base', numeric: true }),
  );
  return [...stored, ...rows.filter((e) => !e.item)];
}

function storedCount(rows: Entry[]): number {
  return rows.filter((e) => e.item).length;
}

export default function LocationSubItemsTable({ locationId, canManage, onCountChange }: Props) {
  const { t } = useTranslation(['it', 'common']);
  const [items, setItems] = React.useState<Entry[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  // A name another sub-location of the location has shows under that row's name, by row key.
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
      const stored = (res.data || []) as SubItem[];
      setItems((prev) => {
        const keyById = new Map(prev.flatMap((e) => (e.item ? [[e.item.id, e.key] as const] : [])));
        return sortByName([
          ...stored.map((item) => ({ key: keyById.get(item.id) ?? item.id, item })),
          ...prev.filter((e) => !e.item),
        ]);
      });
      onCountChange?.(stored.length);
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.loadSubLocationsFailed')));
    }
  }, [locationId, onCountChange, t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleSaveRow = async (key: string, item: SubItem, patch: SubItemPatch) => {
    const trimmedName = (patch.name ?? item.name).trim();
    if (!trimmedName) {
      setError(t('it:workspace.location.subItems.nameRequired'));
      return;
    }
    setItems((prev) => sortByName(prev.map((e) => (
      e.item && e.item.id === item.id ? { ...e, item: { ...e.item, ...patch } } : e
    ))));
    setNameError(key, null);
    try {
      await api.patch(`/locations/${locationId}/sub-items/${item.id}`, {
        name: trimmedName,
        description: 'description' in patch ? patch.description : item.description,
      });
      setError(null);
    } catch (e: any) {
      if (isDuplicateError(e)) setNameError(key, t('messages.subLocationNameTaken'));
      else setError(getApiErrorMessage(e, t, t('messages.saveSubLocationsFailed')));
      void load();
    }
  };

  const performDelete = async (item: SubItem) => {
    if (!canManage) return;
    const prev = items;
    setDeleting(true);
    setItems((current) => {
      const next = current.filter((e) => e.item?.id !== item.id);
      onCountChange?.(storedCount(next));
      return next;
    });
    try {
      await api.delete(`/locations/${locationId}/sub-items/${item.id}`);
      setError(null);
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.saveSubLocationsFailed')));
      setItems(prev);
      onCountChange?.(storedCount(prev));
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

  const removeDraft = (key: string) => {
    setItems((rows) => rows.filter((e) => e.key !== key));
    setNameError(key, null);
  };

  const createRow = async (key: string, values: { name: string; description: string | null }) => {
    try {
      const res = await api.post(`/locations/${locationId}/sub-items`, values);
      const saved: SubItem = { ...(res.data as SubItem), usage_count: 0 };
      setItems((prev) => {
        const next = sortByName(prev.map((e) => (e.key === key ? { ...e, item: saved } : e)));
        onCountChange?.(storedCount(next));
        return next;
      });
      setNameError(key, null);
      setError(null);
      return saved;
    } catch (e: any) {
      if (isDuplicateError(e)) setNameError(key, t('messages.subLocationNameTaken'));
      else setError(getApiErrorMessage(e, t, t('messages.saveSubLocationsFailed')));
      return null;
    }
  };

  const addDraft = () => {
    setItems((rows) => [...rows, { key: `draft-${Date.now()}-${rows.length}`, item: null }]);
  };

  const hasContent = items.length > 0;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
        <Typography sx={{ fontSize: 16, fontWeight: 500, color: 'kanap.text.primary' }}>
          {t('it:workspace.location.subItems.title')}
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
            {t('it:workspace.location.subItems.add')}
          </Box>
        )}
      </Box>
      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
      {!hasContent && (
        <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>
          {t('it:workspace.location.subItems.empty')}
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
              <Box component="th" sx={{ width: '36%' }}>{t('it:common.name')}</Box>
              <Box component="th">{t('it:workspace.location.contacts.description')}</Box>
              <Box component="th" sx={{ width: 90, textAlign: 'right' }}>{t('it:workspace.location.subItems.usage')}</Box>
              {canManage && <Box component="th" sx={{ width: 40 }} />}
            </Box>
          </Box>
          <Box component="tbody">
            {items.map((entry) => (
              <SubItemRow
                key={entry.key}
                row={entry.item}
                canManage={canManage}
                nameError={nameErrors[entry.key]}
                onCreate={(values) => createRow(entry.key, values)}
                onSave={(item, patch) => handleSaveRow(entry.key, item, patch)}
                onDelete={() => (entry.item ? requestDelete(entry.item) : removeDraft(entry.key))}
              />
            ))}
          </Box>
        </Box>
      )}

      <KanapDialog
        open={!!pendingDelete}
        title={t('it:workspace.location.subItems.deleteTitle')}
        onClose={() => !deleting && setPendingDelete(null)}
        onSave={async () => {
          if (pendingDelete) await performDelete(pendingDelete);
        }}
        saveLabel={t('it:workspace.location.subItems.deleteAnyway')}
        saveDisabled={deleting}
        saveLoading={deleting}
      >
        <Stack spacing={1}>
          <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>
            <Trans
              t={t}
              i18nKey="it:workspace.location.subItems.deleteUsage"
              values={{ count: pendingDelete?.usage_count ?? 0, name: pendingDelete?.name ?? '' }}
              components={{ strong: <Box component="strong" sx={{ fontWeight: 500 }} /> }}
            />
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
            {t('it:workspace.location.subItems.deleteKeepsAssets')}
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
  onCreate,
  onSave,
  onDelete,
}: {
  /** The stored sub-location, or null while the row is new and not saved yet. */
  row: SubItem | null;
  canManage: boolean;
  nameError?: string;
  onCreate: (values: { name: string; description: string | null }) => Promise<SubItem | null>;
  onSave: (row: SubItem, patch: SubItemPatch) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation(['it', 'common']);
  const [name, setName] = React.useState(row?.name ?? '');
  const [description, setDescription] = React.useState(row?.description || '');
  // The fields follow the stored row (a refused rename puts the name back) during the render that
  // receives it. An effect would run after the commit and could overwrite what was typed meanwhile.
  // A new row keeps what was typed while it was being saved: it is not a change of the stored row.
  const [shown, setShown] = React.useState(row ? { name: row.name, description: row.description } : null);
  if (row && (!shown || shown.name !== row.name || shown.description !== row.description)) {
    setShown({ name: row.name, description: row.description });
    if (shown && shown.name !== row.name) setName(row.name);
    if (shown && shown.description !== row.description) setDescription(row.description || '');
  }

  // Read after the creation request returns, so they hold what was typed meanwhile.
  const typed = React.useRef({ name, description });
  const editing = React.useRef<'name' | 'description' | null>(null);
  const creating = React.useRef(false);
  const rowRef = React.useRef<HTMLTableRowElement | null>(null);

  const create = async () => {
    const nextName = name.trim();
    if (creating.current || !nextName) return;
    creating.current = true;
    const saved = await onCreate({ name: nextName, description: description.trim() || null });
    creating.current = false;
    if (!saved) return;
    // A field left while the row was being saved is saved now; the one still being edited is
    // saved when it is left, against the stored row.
    const patch: SubItemPatch = {};
    const latestName = typed.current.name.trim();
    if (editing.current !== 'name' && latestName && latestName !== saved.name) patch.name = latestName;
    const nextDescription = typed.current.description.trim() || null;
    if (editing.current !== 'description' && nextDescription !== (saved.description || null)) {
      patch.description = nextDescription;
    }
    if (Object.keys(patch).length > 0) onSave(saved, patch);
  };

  return (
    <Box component="tr" ref={rowRef}>
      <Box component="td">
        <Stack direction="row" spacing={0.75} alignItems="center">
          <TextField
            value={name}
            onChange={(e) => {
              typed.current.name = e.target.value;
              setName(e.target.value);
            }}
            onFocus={() => { editing.current = 'name'; }}
            onBlur={(e) => {
              editing.current = null;
              if (!row) {
                // A new row left empty goes away, unless the focus moves to its description.
                const stillInRow = rowRef.current?.contains(e.relatedTarget as Node | null) ?? false;
                if (name.trim()) void create();
                else if (!description.trim() && !stillInRow) onDelete();
                return;
              }
              if (name.trim() !== row.name) onSave(row, { name });
            }}
            placeholder={row ? undefined : t('it:workspace.location.subItems.namePlaceholder')}
            error={!!nameError}
            helperText={nameError}
            variant="standard"
            fullWidth
            autoFocus={!row}
            disabled={!canManage}
            sx={inputSx}
          />
          {/* The row is kept in step with an inventory: a manual rename is put
              back in line at the next run. It stays fully editable. */}
          {row?.external_source === 'netbox' ? (
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
          onChange={(e) => {
            typed.current.description = e.target.value;
            setDescription(e.target.value);
          }}
          onFocus={() => { editing.current = 'description'; }}
          onBlur={() => {
            editing.current = null;
            if (!row) {
              void create();
              return;
            }
            const next = description || null;
            if (next !== (row.description || null)) onSave(row, { description: next });
          }}
          placeholder={t('it:workspace.location.subItems.descriptionPlaceholder')}
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
          color: row && row.usage_count > 0 ? 'kanap.text.secondary' : 'kanap.text.tertiary',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {row && row.usage_count > 0
          ? `${row.usage_count} asset${row.usage_count === 1 ? '' : 's'}`
          : '—'}
      </Box>
      {canManage && (
        <Box component="td">
          <IconButton
            size="small"
            onClick={onDelete}
            aria-label={row ? t('it:workspace.location.subItems.deleteAria') : t('common:buttons.discard')}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      )}
    </Box>
  );
}
