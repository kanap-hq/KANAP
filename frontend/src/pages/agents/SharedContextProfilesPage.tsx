import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, CircularProgress, Divider, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import ArchiveIcon from '@mui/icons-material/Archive';
import PageHeader from '../../components/PageHeader';
import { EmptyState, formatDateTime, Section } from '../../components/agents/agentControlPrimitives';
import { PropertyRow } from '../../components/design';
import KanapDialog from '../../components/design/KanapDialog';
import { useAuth } from '../../auth/AuthContext';
import { useLocale } from '../../i18n/useLocale';
import { aiAgentControlApi, AiSharedContextProfile } from '../../ai/aiApi';
import { SHARED_CONTEXT_PROFILES_QUERY_KEY } from './useAgentControlData';
import { drawerFieldValueSx, longFormSurfaceFieldSx } from '../../theme/formSx';

function profileLines(profile: AiSharedContextProfile): string[] {
  const content = profile.content_json as { lines?: unknown } | null;
  return Array.isArray(content?.lines)
    ? (content!.lines as unknown[]).filter((line): line is string => typeof line === 'string')
    : [];
}

export default function SharedContextProfilesPage() {
  const { t } = useTranslation(['agents']);
  const locale = useLocale();
  const { hasLevel } = useAuth();
  const queryClient = useQueryClient();
  const canAdmin = hasLevel('ai_agents', 'admin') || hasLevel('ai_settings', 'admin');

  const profilesQuery = useQuery({
    queryKey: SHARED_CONTEXT_PROFILES_QUERY_KEY,
    queryFn: () => aiAgentControlApi.listSharedContextProfiles(),
    staleTime: 30_000,
  });

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draftName, setDraftName] = React.useState('');
  const [draftDescription, setDraftDescription] = React.useState('');
  const [draftLines, setDraftLines] = React.useState('');
  const [archiveTarget, setArchiveTarget] = React.useState<AiSharedContextProfile | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: SHARED_CONTEXT_PROFILES_QUERY_KEY });
  const readError = (err: unknown, fallback: string): string => {
    const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
    return message ?? fallback;
  };

  const saveMutation = useMutation({
    mutationFn: (input: { id: string | null; name: string; description: string; lines: string[] }) =>
      input.id
        ? aiAgentControlApi.updateSharedContextProfile(input.id, { name: input.name, description: input.description || null, lines: input.lines })
        : aiAgentControlApi.createSharedContextProfile({ name: input.name, description: input.description || null, lines: input.lines }),
    onSuccess: () => { invalidate(); setDialogOpen(false); setError(null); },
    onError: (err) => setError(readError(err, t('sharedContext.saveFailed'))),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => aiAgentControlApi.archiveSharedContextProfile(id),
    onSuccess: () => { invalidate(); setArchiveTarget(null); setError(null); },
    onError: (err) => setError(readError(err, t('sharedContext.archiveFailed'))),
  });

  const openCreate = () => {
    setEditingId(null);
    setDraftName('');
    setDraftDescription('');
    setDraftLines('');
    setError(null);
    setDialogOpen(true);
  };
  const openEdit = (profile: AiSharedContextProfile) => {
    setEditingId(profile.id);
    setDraftName(profile.name);
    setDraftDescription(profile.description ?? '');
    setDraftLines(profileLines(profile).join('\n'));
    setError(null);
    setDialogOpen(true);
  };

  const draftLineList = draftLines.split('\n').map((line) => line.trim()).filter(Boolean);
  const saveDisabled = draftName.trim().length === 0 || draftLineList.length === 0;

  const handleSave = () => {
    if (saveDisabled) return;
    saveMutation.mutate({ id: editingId, name: draftName.trim(), description: draftDescription.trim(), lines: draftLineList });
  };

  const profiles = profilesQuery.data?.items ?? [];

  return (
    <Box sx={{ p: 2 }}>
      <PageHeader
        title={t('sharedContext.title')}
        actions={canAdmin ? (
          <Button variant="action-primary" onClick={openCreate}>{t('sharedContext.new')}</Button>
        ) : undefined}
      />
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('sharedContext.subtitle')}</Typography>
      <Stack spacing={2}>
        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        <Section title={t('sharedContext.profiles')}>
          {profilesQuery.isLoading ? (
            <Box display="flex" justifyContent="center" py={4}><CircularProgress size={24} /></Box>
          ) : profilesQuery.isError ? (
            <Alert severity="error">{t('sharedContext.loadFailed')}</Alert>
          ) : profiles.length === 0 ? (
            <EmptyState>{t('sharedContext.empty')}</EmptyState>
          ) : (
            <Stack divider={<Divider flexItem />}>
              {profiles.map((profile) => {
                const archived = profile.status !== 'active';
                const lineCount = profileLines(profile).length;
                return (
                  <Box key={profile.id} sx={{ p: 1.5, opacity: archived ? 0.55 : 1 }}>
                    <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="flex-start">
                      <Box sx={{ minWidth: 0 }}>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                          <Typography variant="subtitle2">{profile.name}</Typography>
                          {archived && <Typography variant="caption" color="text.secondary">{t('sharedContext.archived')}</Typography>}
                        </Stack>
                        {profile.description && (
                          <Typography variant="body2" color="text.secondary">{profile.description}</Typography>
                        )}
                        <Typography variant="caption" color="text.secondary">
                          {t('sharedContext.lineCount', { count: lineCount })}
                          {profile.updated_at ? ` · ${t('sharedContext.updated', { value: formatDateTime(profile.updated_at, locale) })}` : ''}
                        </Typography>
                      </Box>
                      {canAdmin && !archived && (
                        <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0 }}>
                          <Tooltip title={t('sharedContext.edit')}>
                            <IconButton size="small" aria-label={t('sharedContext.edit')} onClick={() => openEdit(profile)}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={t('sharedContext.archive')}>
                            <IconButton size="small" aria-label={t('sharedContext.archive')} onClick={() => setArchiveTarget(profile)}>
                              <ArchiveIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      )}
                    </Stack>
                  </Box>
                );
              })}
            </Stack>
          )}
        </Section>
      </Stack>

      {dialogOpen && (
        <KanapDialog
          open={dialogOpen}
          title={editingId ? t('sharedContext.editTitle') : t('settings.sharedContextDialog.title')}
          onClose={() => setDialogOpen(false)}
          onSave={handleSave}
          saveLabel={editingId ? t('sharedContext.save') : t('settings.sharedContextDialog.create')}
          saveDisabled={saveDisabled}
          saveLoading={saveMutation.isPending}
        >
          <Stack spacing={1.5}>
            <PropertyRow label={t('settings.sharedContextDialog.name')}>
              <TextField
                size="small"
                variant="standard"
                value={draftName}
                placeholder={t('settings.sharedContextDialog.namePlaceholder')}
                sx={drawerFieldValueSx}
                onChange={(event) => setDraftName(event.target.value)}
              />
            </PropertyRow>
            <PropertyRow label={t('sharedContext.description')}>
              <TextField
                size="small"
                variant="standard"
                value={draftDescription}
                placeholder={t('sharedContext.descriptionPlaceholder')}
                sx={drawerFieldValueSx}
                onChange={(event) => setDraftDescription(event.target.value)}
              />
            </PropertyRow>
            <PropertyRow label={t('settings.sharedContextDialog.lines')} helperText={t('settings.sharedContextDialog.linesHint')}>
              <TextField
                size="small"
                variant="standard"
                multiline
                minRows={6}
                value={draftLines}
                placeholder={t('settings.sharedContextDialog.linesPlaceholder')}
                sx={[longFormSurfaceFieldSx, { maxWidth: 'none' }]}
                onChange={(event) => setDraftLines(event.target.value)}
              />
            </PropertyRow>
          </Stack>
        </KanapDialog>
      )}

      {archiveTarget && (
        <KanapDialog
          open={!!archiveTarget}
          title={t('sharedContext.archiveTitle')}
          onClose={() => setArchiveTarget(null)}
          onSave={() => archiveMutation.mutate(archiveTarget.id)}
          saveLabel={t('sharedContext.archive')}
          saveColor="error"
          saveLoading={archiveMutation.isPending}
        >
          <Typography variant="body2">{t('sharedContext.archiveBody', { name: archiveTarget.name })}</Typography>
        </KanapDialog>
      )}
    </Box>
  );
}
