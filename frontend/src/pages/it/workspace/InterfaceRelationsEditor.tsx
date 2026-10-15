import React from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { KanapDialog } from '../../../components/design';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import type {
  InterfaceAttachment,
  InterfaceDependency,
  InterfaceDetail,
  InterfaceLink,
  InterfaceOption,
} from '../components/interface-workspace/types';

type Props = {
  canManage: boolean;
  data: InterfaceDetail | null;
  isCreate: boolean;
  markDirty: () => void;
  onReplaceDependencies?: (rows: InterfaceDependency[]) => Promise<void>;
  onReplaceLinks?: (rows: InterfaceLink[]) => Promise<void>;
  update: (patch: Partial<InterfaceDetail>) => void;
};

function normalizeUrl(raw: string) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export default function InterfaceRelationsEditor({
  canManage,
  data,
  isCreate,
  markDirty,
  onReplaceDependencies,
  onReplaceLinks,
  update,
}: Props) {
  const { t } = useTranslation(['it', 'common', 'errors']);
  const links = (data?.links || []) as InterfaceLink[];
  const attachments = (data?.attachments || []) as InterfaceAttachment[];
  const dependencies = (data?.dependencies || []) as InterfaceDependency[];
  const [error, setError] = React.useState<string | null>(null);
  const [hover, setHover] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [uploadCount, setUploadCount] = React.useState(0);
  const [pendingAttachmentDeleteId, setPendingAttachmentDeleteId] = React.useState<string | null>(null);

  const { data: interfacesData, isLoading: loadingInterfaces } = useQuery({
    queryKey: ['interfaces', 'select', 'all'],
    queryFn: async () => {
      const res = await api.get<{ items: InterfaceOption[] }>('/interfaces', {
        params: { limit: 500, sort: 'name:ASC' },
      });
      return res.data.items || [];
    },
  });

  const interfaceOptions = React.useMemo(() => {
    const list = (interfacesData || []) as InterfaceOption[];
    return data?.id ? list.filter((item) => item.id !== data.id) : list;
  }, [data?.id, interfacesData]);

  const upstreamIds = React.useMemo(
    () => dependencies.filter((item) => item.direction === 'upstream').map((item) => item.related_interface_id),
    [dependencies],
  );
  const downstreamIds = React.useMemo(
    () => dependencies.filter((item) => item.direction === 'downstream').map((item) => item.related_interface_id),
    [dependencies],
  );

  const syncDependencies = React.useCallback((nextUpstreamIds: string[], nextDownstreamIds: string[]) => {
    const rows: InterfaceDependency[] = [];
    nextUpstreamIds.forEach((id) => rows.push({ related_interface_id: id, direction: 'upstream' }));
    nextDownstreamIds.forEach((id) => rows.push({ related_interface_id: id, direction: 'downstream' }));
    markDirty();
    update({ dependencies: rows });
    if (!isCreate && canManage && onReplaceDependencies) {
      void onReplaceDependencies(rows);
    }
  }, [canManage, isCreate, markDirty, onReplaceDependencies, update]);

  const updateLinks = React.useCallback((nextLinks: InterfaceLink[]) => {
    markDirty();
    update({ links: nextLinks });
    if (!isCreate && canManage && onReplaceLinks) {
      void onReplaceLinks(nextLinks);
    }
  }, [canManage, isCreate, markDirty, onReplaceLinks, update]);

  const addLink = () => {
    updateLinks([
      ...links,
      {
        kind: 'functional',
        description: null,
        url: '',
      },
    ]);
  };

  const handleLinkChange = (index: number, field: 'description' | 'url', value: string) => {
    updateLinks(
      links.map((link, currentIndex) => {
        if (currentIndex !== index) return link;
        if (field === 'description') {
          return { ...link, description: value };
        }
        return { ...link, url: value };
      }),
    );
  };

  const removeLink = (index: number) => {
    updateLinks(links.filter((_, currentIndex) => currentIndex !== index));
  };

  const refreshAttachments = React.useCallback(async () => {
    if (!data?.id) return;
    const response = await api.get<InterfaceAttachment[]>(`/interfaces/${data.id}/attachments`);
    update({ attachments: response.data || [] });
  }, [data?.id, update]);

  const handleAttachmentUpload = async (files: File[]) => {
    if (!data?.id || files.length === 0) return;
    setUploading(true);
    setUploadCount(files.length);
    setError(null);
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('kind', 'functional');
        await api.post<InterfaceAttachment>(`/interfaces/${data.id}/attachments`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      await refreshAttachments();
    } catch (uploadError: any) {
      setError(getApiErrorMessage(uploadError, t, t('messages.saveInterfaceFailed')));
    } finally {
      setUploading(false);
      setUploadCount(0);
    }
  };

  const handleAttachmentDelete = async (attachmentId: string) => {
    setPendingAttachmentDeleteId(attachmentId);
  };

  const confirmAttachmentDelete = async () => {
    const attachmentId = pendingAttachmentDeleteId;
    if (!attachmentId) return;
    setError(null);
    try {
      await api.patch(`/interfaces/attachments/${attachmentId}/delete`);
      setPendingAttachmentDeleteId(null);
      await refreshAttachments();
    } catch (deleteError: any) {
      setError(getApiErrorMessage(deleteError, t, t('messages.saveInterfaceFailed')));
    }
  };

  return (
    <Stack spacing={2}>
      {!!error && <Alert severity="error">{error}</Alert>}

      <Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
          {t('it:workspace.interface.relations.dependencies')}
        </Typography>
        <Stack spacing={1.25}>
          <Autocomplete
            multiple
            size="small"
            options={interfaceOptions}
            value={interfaceOptions.filter((item) => upstreamIds.includes(item.id))}
            onChange={(_, value) => syncDependencies(value.map((item) => item.id), downstreamIds)}
            getOptionLabel={(option) => option.name || option.interface_reference || option.interface_id || ''}
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2">{option.name}</Typography>
                  {option.interface_reference || option.interface_id ? (
                    <Typography variant="caption" color="text.secondary">
                      {option.interface_reference || option.interface_id}
                    </Typography>
                  ) : null}
                </Box>
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t('it:workspace.interface.relations.upstream')}
                placeholder={t('it:workspace.interface.relations.selectUpstream')}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {loadingInterfaces ? <CircularProgress color="inherit" size={18} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            fullWidth
          />

          <Autocomplete
            multiple
            size="small"
            options={interfaceOptions}
            value={interfaceOptions.filter((item) => downstreamIds.includes(item.id))}
            onChange={(_, value) => syncDependencies(upstreamIds, value.map((item) => item.id))}
            getOptionLabel={(option) => option.name || option.interface_reference || option.interface_id || ''}
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2">{option.name}</Typography>
                  {option.interface_reference || option.interface_id ? (
                    <Typography variant="caption" color="text.secondary">
                      {option.interface_reference || option.interface_id}
                    </Typography>
                  ) : null}
                </Box>
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t('it:workspace.interface.relations.downstream')}
                placeholder={t('it:workspace.interface.relations.selectDownstream')}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {loadingInterfaces ? <CircularProgress color="inherit" size={18} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            fullWidth
          />
        </Stack>
      </Box>

      <Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {t('it:workspace.interface.relations.externalUrls')}
          </Typography>
          <Button startIcon={<AddIcon />} onClick={addLink} size="small">
            {t('it:workspace.interface.relations.addLink')}
          </Button>
        </Stack>
        <Stack spacing={1}>
          {links.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('it:workspace.interface.relations.noLinks')}
            </Typography>
          ) : (
            links.map((link, index) => (
              <Box
                key={link.id || `link-${index}`}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', md: '1.2fr 1.8fr auto auto' },
                  gap: 1,
                  alignItems: 'center',
                }}
              >
                <TextField
                  label={t('it:workspace.interface.relations.description')}
                  size="small"
                  value={link.description || ''}
                  onChange={(event) => handleLinkChange(index, 'description', event.target.value)}
                />
                <TextField
                  label="URL"
                  size="small"
                  value={link.url || ''}
                  onChange={(event) => handleLinkChange(index, 'url', event.target.value)}
                />
                <IconButton
                  aria-label={t('it:workspace.interface.relations.openLink')}
                  size="small"
                  component="a"
                  href={normalizeUrl(link.url)}
                  target="_blank"
                  rel="noreferrer"
                  disabled={!String(link.url || '').trim()}
                >
                  <OpenInNewIcon fontSize="small" />
                </IconButton>
                <IconButton
                  aria-label={t('common:buttons.remove')}
                  size="small"
                  onClick={() => removeLink(index)}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            ))
          )}
        </Stack>
      </Box>

      <Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
          {t('it:workspace.interface.relations.attachments')}
        </Typography>
        <Stack spacing={1}>
          <Box
            onDragOver={(event) => {
              if (!data?.id || !canManage) return;
              event.preventDefault();
              setHover(true);
            }}
            onDragLeave={() => setHover(false)}
            onDrop={async (event) => {
              if (!data?.id || !canManage) return;
              event.preventDefault();
              setHover(false);
              const files = Array.from(event.dataTransfer.files || []);
              if (files.length === 0) return;
              await handleAttachmentUpload(files);
            }}
            sx={{
              border: '2px dashed',
              borderColor: hover ? 'primary.main' : 'divider',
              borderRadius: 1,
              p: 2,
              textAlign: 'center',
              cursor: canManage && data?.id ? 'pointer' : 'default',
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {t('it:workspace.interface.relations.dropHint')}
            </Typography>
            <Box sx={{ mt: 1 }}>
              <Button
                component="label"
                size="small"
                variant="outlined"
                disabled={!data?.id || uploading || !canManage}
              >
                {t('it:workspace.interface.relations.selectFiles')}
                <input
                  type="file"
                  hidden
                  multiple
                  onChange={(event) => {
                    const input = event.currentTarget as HTMLInputElement | null;
                    const files = Array.from(event.target.files || []);
                    if (files.length > 0) {
                      void handleAttachmentUpload(files);
                    }
                    if (input) {
                      input.value = '';
                    }
                  }}
                />
              </Button>
            </Box>
          </Box>
          {isCreate && (
            <Typography variant="caption" color="text.secondary">
              {t('it:workspace.interface.relations.saveFirst')}
            </Typography>
          )}
          {uploading && <LinearProgress sx={{ mt: 1 }} />}
          {uploading && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {t('it:workspace.interface.relations.uploading', { count: uploadCount })}
            </Typography>
          )}
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {attachments.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t('it:workspace.interface.relations.noAttachments')}
              </Typography>
            ) : (
              attachments.map((attachment) => (
                <Chip
                  key={attachment.id}
                  label={attachment.original_filename}
                  onClick={async () => {
                    const response = await api.get(`/interfaces/attachments/${attachment.id}`, { responseType: 'blob' });
                    const blob = new Blob([response.data]);
                    const url = window.URL.createObjectURL(blob);
                    const element = document.createElement('a');
                    element.href = url;
                    element.download = attachment.original_filename;
                    element.click();
                    window.URL.revokeObjectURL(url);
                  }}
                  onDelete={canManage ? () => { void handleAttachmentDelete(attachment.id); } : undefined}
                  deleteIcon={canManage ? <DeleteIcon fontSize="small" /> : undefined}
                />
              ))
            )}
          </Stack>
        </Stack>
      </Box>

      <KanapDialog
        open={!!pendingAttachmentDeleteId}
        title={t('it:workspace.interface.relations.deleteAttachmentTitle')}
        onClose={() => setPendingAttachmentDeleteId(null)}
        saveLabel="Delete"
        onSave={() => { void confirmAttachmentDelete(); }}
      >
        <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
          {t('it:workspace.interface.relations.deleteAttachmentMessage')}
        </Typography>
      </KanapDialog>
    </Stack>
  );
}
