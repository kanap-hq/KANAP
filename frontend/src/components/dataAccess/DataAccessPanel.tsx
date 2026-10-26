import React from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  Link,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../api';
import { useKanapDialogs } from '../design';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDate } from '../../lib/dateFormat';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { getDocPageUrl } from '../../utils/docUrls';
import DataAccessNodePicker from './DataAccessNodePicker';
import {
  accessBody,
  accessLevelLabel,
  accessNodeName,
  accessNodeTypeLabel,
  previewText,
  sortAccessNodes,
  type AccessNode,
  type DataAccessLevel,
  type DataAccessPreview,
  type PersonAccess,
} from './dataAccess';

export type DataAccessPanelState = {
  /** The proposed access differs from the stored one. */
  dirty: boolean;
  /** The proposed access can be saved (it can never be for an administrator or an unavailable limitation). */
  canSave: boolean;
};

export type DataAccessPanelHandle = {
  /** Writes the proposed access; false when the server refused it (the panel shows why). */
  save: () => Promise<boolean>;
};

type Props = {
  open: boolean;
  userId: string;
  personName: string;
  onStateChange?: (state: DataAccessPanelState) => void;
};

const nodeKey = (node: Pick<AccessNode, 'type' | 'id'>) => `${node.type}:${node.id ?? ''}`;

/**
 * "Data access" of a person (spec §7.1): all data or a set of company and cost-center nodes, each
 * read or edit. The counts of the access are previewed through the server route on every change
 * (debounced), and saved with `PUT /users/:id/data-access`.
 *
 * The dialog chrome lives in the user dialog: this panel only holds the access itself and saves it
 * when that dialog's footer asks (`DataAccessPanelHandle.save`).
 */
const DataAccessPanel = React.forwardRef<DataAccessPanelHandle, Props>(function DataAccessPanel(
  { open, userId, personName, onStateChange },
  ref,
) {
  const { t } = useTranslation(['admin', 'common']);
  const dialogs = useKanapDialogs();
  const queryClient = useQueryClient();
  const locale = useLocale();

  const [mode, setMode] = React.useState<'all' | 'limited'>('all');
  const [nodes, setNodes] = React.useState<AccessNode[]>([]);
  const [addOpen, setAddOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [ready, setReady] = React.useState(false);

  const accessKey = React.useMemo(() => ['user-data-access', userId] as const, [userId]);
  const accessQuery = useQuery({
    queryKey: accessKey,
    queryFn: async () => (await api.get<PersonAccess>(`/users/${userId}/data-access`)).data,
    enabled: open && !!userId,
    refetchOnWindowFocus: false,
  });
  const data = accessQuery.data;

  // The stored access is the starting point of every opening; a failed load keeps the panel empty.
  React.useEffect(() => {
    if (!open || !data) return;
    setMode(data.mode);
    setNodes(sortAccessNodes(data.nodes));
    setAddOpen(false);
    setError(null);
    setReady(true);
  }, [open, data]);

  const body = React.useMemo(() => accessBody(mode, nodes), [mode, nodes]);
  const storedBody = React.useMemo(
    () => (data ? accessBody(data.mode, sortAccessNodes(data.nodes)) : null),
    [data],
  );
  const administrator = !!data?.is_administrator;
  const dirty = !!storedBody && !administrator && JSON.stringify(body) !== JSON.stringify(storedBody);
  const canSave = !!data && !administrator && !(!data.available && mode === 'limited');

  React.useEffect(() => {
    onStateChange?.({ dirty, canSave });
  }, [canSave, dirty, onStateChange]);

  const serialized = JSON.stringify(body);
  const debouncedBody = useDebouncedValue(serialized, 250);
  const previewQuery = useQuery({
    queryKey: ['user-data-access-preview', userId, debouncedBody],
    queryFn: async () => (await api.post<DataAccessPreview>(
      `/users/${userId}/data-access/preview`,
      JSON.parse(debouncedBody) as unknown,
    )).data,
    enabled: open && ready && !!data && !administrator,
    placeholderData: (previous: DataAccessPreview | undefined) => previous,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const addNode = (node: AccessNode) => {
    setNodes((prev) => (prev.some((current) => nodeKey(current) === nodeKey(node))
      ? prev
      : sortAccessNodes([...prev, node])));
    setAddOpen(false);
  };

  const addOwnerCenters = () => {
    if (!data) return;
    setNodes((prev) => {
      const next = new Map(prev.map((node) => [nodeKey(node), node]));
      for (const center of data.budget_owner_centers) {
        const node: AccessNode = {
          type: 'cost_center',
          id: center.id,
          name: center.name,
          code: center.code,
          kind: 'cost_center',
          access: 'edit',
        };
        if (!next.has(nodeKey(node))) next.set(nodeKey(node), node);
      }
      return sortAccessNodes(Array.from(next.values()));
    });
    setAddOpen(false);
  };

  const removeNode = (node: AccessNode) => {
    setNodes((prev) => prev.filter((current) => nodeKey(current) !== nodeKey(node)));
  };

  const changeNodeAccess = (node: AccessNode, access: DataAccessLevel) => {
    setNodes((prev) => prev.map((current) => (nodeKey(current) === nodeKey(node) ? { ...current, access } : current)));
  };

  const changeMode = async (next: 'all' | 'limited') => {
    if (next === mode) return;
    if (next === 'all') {
      const confirmed = await dialogs.confirm({
        title: t('admin:dataAccess.allData'),
        message: t('admin:dataAccess.confirmAll', { name: personName }),
        confirmLabel: t('admin:dataAccess.allData'),
      });
      if (!confirmed) return;
    }
    setMode(next);
  };

  const save = React.useCallback(async (): Promise<boolean> => {
    if (!data) return false;
    if (data.is_administrator) return true;
    setSaving(true);
    setError(null);
    try {
      const res = await api.put<PersonAccess>(`/users/${userId}/data-access`, body);
      queryClient.setQueryData(accessKey, res.data);
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['data-access'] });
      return true;
    } catch (e) {
      setError(getApiErrorMessage(e, t, t('admin:dataAccess.saveFailed')));
      return false;
    } finally {
      setSaving(false);
    }
  }, [accessKey, body, data, queryClient, t, userId]);

  React.useImperativeHandle(ref, () => ({ save }), [save]);

  const preview = previewQuery.data;

  return (
    <Stack spacing={2}>
      {accessQuery.isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={20} />
        </Box>
      )}
      {accessQuery.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {getApiErrorMessage(accessQuery.error, t, t('admin:dataAccess.loadFailed'))}
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {administrator ? (
        <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
          {t('admin:dataAccess.administratorsSeeAll')}
        </Typography>
      ) : data && (
        <>
          <RadioGroup
            value={mode}
            onChange={(_event, value) => { void changeMode(value === 'all' ? 'all' : 'limited'); }}
          >
            <FormControlLabel
              value="all"
              control={<Radio size="small" />}
              label={<Typography sx={{ fontSize: 13 }}>{t('admin:dataAccess.allData')}</Typography>}
            />
            <FormControlLabel
              value="limited"
              disabled={!data.available}
              control={<Radio size="small" />}
              label={<Typography sx={{ fontSize: 13 }}>{t('admin:dataAccess.limitedTo')}</Typography>}
            />
          </RadioGroup>

          {!data.available && (
            <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
              {t('admin:dataAccess.unavailable')}{' '}
              <Link href={getDocPageUrl('data-access', locale)} target="_blank" rel="noopener" underline="hover">
                {t('admin:dataAccess.guide')}
              </Link>
            </Typography>
          )}

          {mode === 'limited' && (
            <>
              {nodes.length > 0 && (
                <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                  {nodes.map((node) => {
                    const name = accessNodeName(node, t);
                    return (
                      <Box
                        component="li"
                        key={nodeKey(node)}
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: 'minmax(0, 1fr) 130px 96px 32px',
                          alignItems: 'center',
                          gap: 1,
                          py: 0.75,
                          borderBottom: '1px solid',
                          borderColor: 'kanap.border.soft',
                          '&:last-of-type': { borderBottom: 0 },
                        }}
                      >
                        <Typography sx={{ fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {name}
                        </Typography>
                        <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary' }}>
                          {accessNodeTypeLabel(node, t)}
                        </Typography>
                        <TextField
                          select
                          variant="standard"
                          size="small"
                          value={node.access}
                          onChange={(event) => changeNodeAccess(node, event.target.value as DataAccessLevel)}
                          inputProps={{ 'aria-label': t('admin:dataAccess.accessLabel', { name }) }}
                          SelectProps={{ SelectDisplayProps: { 'aria-label': t('admin:dataAccess.accessLabel', { name }) } }}
                        >
                          <MenuItem value="read">{accessLevelLabel('read', t)}</MenuItem>
                          <MenuItem value="edit">{accessLevelLabel('edit', t)}</MenuItem>
                        </TextField>
                        <IconButton
                          size="small"
                          aria-label={t('admin:dataAccess.remove', { name })}
                          onClick={() => removeNode(node)}
                          disabled={saving}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    );
                  })}
                </Box>
              )}
              {!addOpen ? (
                <Box>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<AddIcon />}
                    onClick={() => setAddOpen(true)}
                    disabled={saving}
                  >
                    {t('admin:dataAccess.add')}
                  </Button>
                </Box>
              ) : (
                <Box
                  sx={{
                    border: '1px solid',
                    borderColor: 'kanap.border.default',
                    borderRadius: '6px',
                    p: 1.5,
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.5 }}>
                    <IconButton
                      size="small"
                      aria-label={t('common:buttons.cancel')}
                      onClick={() => setAddOpen(false)}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Box>
                  <DataAccessNodePicker
                    allowEverything
                    ownerCenters={data.budget_owner_centers}
                    onPick={addNode}
                    onPickOwnerCenters={addOwnerCenters}
                  />
                </Box>
              )}
              <Box>
                <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
                  {t('admin:dataAccess.alwaysSees')}
                </Typography>
                <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
                  {t('admin:dataAccess.appliesTo')}
                </Typography>
              </Box>
            </>
          )}

          {preview && (
            <>
              <Divider sx={{ borderColor: 'kanap.border.soft' }} />
              <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
                {previewText(preview, t, locale)}
              </Typography>
            </>
          )}

          {data.updated_at && data.updated_by_name && (
            <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
              {t('admin:dataAccess.modified', {
                name: data.updated_by_name,
                date: formatShortDate(data.updated_at, locale, { year: 'always' }),
              })}
            </Typography>
          )}
        </>
      )}
    </Stack>
  );
});

export default DataAccessPanel;
