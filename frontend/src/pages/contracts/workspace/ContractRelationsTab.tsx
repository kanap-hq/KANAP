import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, LinearProgress, Stack, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import ItemContactsSection from '../../../components/contacts/ItemContactsSection';
import { RelevantWebsitesList, useKanapDialogs } from '../../../components/design';
import { denseTableFrameSx, denseTableSx } from '../../../components/EntityTasksSection';
import RelationLookupPicker, { type NamedRelation } from '../../../components/workspace/RelationLookupPicker';
import RelationsSectionTitle from '../../portfolio/components/RelationsSectionTitle';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import type { ContractAttachment } from '../contractForm';

type LinkItem = { id: string; description: string | null; url: string };
type RelationSet = 'applications' | 'assets' | 'technologies';

/**
 * Where each picker searches (the list or lookup routes, whose access rules apply), where a chip
 * leads, the body key of the replacement and the placeholder.
 */
const PICKERS: Record<RelationSet, { endpoint: string; sorted: boolean; href: (row: NamedRelation) => string; idsKey: string; placeholder: string }> = {
  applications: { endpoint: '/applications', sorted: true, href: (row) => `/it/applications/${row.id}/overview`, idsKey: 'application_ids', placeholder: 'selectApplications' },
  assets: { endpoint: '/assets', sorted: true, href: (row) => `/it/assets/${row.id}/overview`, idsKey: 'asset_ids', placeholder: 'selectAssets' },
  technologies: { endpoint: '/technologies/lookup', sorted: false, href: (row) => `/it/technologies/${row.id}/overview`, idsKey: 'technology_ids', placeholder: 'selectTechnologies' },
};

export const contractRelationKey = (contractId: string, set: string) => ['contract-relations', contractId, set] as const;

const sectionWidthSx = { maxWidth: 640 } as const;

function formatSize(bytes: number | null | undefined, locale: string): string {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value)} ${units[unit]}`;
}

/** One set of links (applications, assets or technologies), saved on each change. */
function RelationSetSection({ contractId, set, readOnly, onChanged }: { contractId: string; set: RelationSet; readOnly: boolean; onChanged: () => void }) {
  const { t } = useTranslation(['ops', 'common']);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: contractRelationKey(contractId, set),
    queryFn: async ({ signal }) => (await api.get<{ items: NamedRelation[] }>(`/contracts/${contractId}/${set}`, { signal })).data.items,
    staleTime: 0,
  });
  const [value, setValue] = React.useState<NamedRelation[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const chainRef = React.useRef<Promise<unknown>>(Promise.resolve());
  const pendingRef = React.useRef(0);
  React.useEffect(() => {
    if (query.data && pendingRef.current === 0) setValue(query.data);
  }, [query.data]);

  const save = (next: NamedRelation[]) => {
    setValue(next);
    setError(null);
    pendingRef.current += 1;
    const run = async () => {
      try {
        await api.post(`/contracts/${contractId}/${set}/bulk-replace`, { [PICKERS[set].idsKey]: next.map((row) => row.id) });
        onChanged();
      } catch (e) {
        setError(getApiErrorMessage(e, t, t('contracts.messages.saveFailed')));
      } finally {
        pendingRef.current -= 1;
        if (pendingRef.current === 0) await queryClient.invalidateQueries({ queryKey: contractRelationKey(contractId, set) });
      }
    };
    chainRef.current = chainRef.current.then(run, run);
  };

  const title = t(`contracts.relations.${set}`);
  return (
    <Stack spacing={1.25}>
      <RelationsSectionTitle>{title}</RelationsSectionTitle>
      {error && <Alert severity="error" onClose={() => setError(null)} sx={sectionWidthSx}>{error}</Alert>}
      <RelationLookupPicker
        endpoint={PICKERS[set].endpoint}
        scope={PICKERS[set].sorted ? { sort: 'name:ASC' } : undefined}
        href={PICKERS[set].href}
        placeholder={t(`contracts.relations.${PICKERS[set].placeholder}`)}
        ariaLabel={title}
        value={value ?? query.data ?? []}
        onChange={save}
        // A set read for this visit only: a save replaces the whole set.
        disabled={readOnly || !query.isFetchedAfterMount || query.isError}
      />
    </Stack>
  );
}

/**
 * The Relations tab of a contract, aligned on the other pages: applications, assets and
 * technologies pickers (technologies for a reader of the infrastructure only), contacts, relevant
 * websites and attachments. Every change saves at once.
 */
export default function ContractRelationsTab({
  contractId,
  readOnly,
  links,
  attachments,
  onChanged,
}: {
  contractId: string;
  readOnly: boolean;
  links: LinkItem[];
  attachments: ContractAttachment[];
  /** The contract's detail and tab counts are read again. */
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation(['ops', 'common']);
  const { hasLevel } = useAuth();
  const dialogs = useKanapDialogs();
  const [error, setError] = React.useState<string | null>(null);
  const [linkDialog, setLinkDialog] = React.useState<{ index: number | null; description: string; url: string } | null>(null);
  const [uploading, setUploading] = React.useState(0);
  const [dragOver, setDragOver] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const locale = i18n.resolvedLanguage || i18n.language || 'en';

  const run = async (task: () => Promise<unknown>) => {
    setError(null);
    try {
      await task();
      onChanged();
    } catch (e) {
      setError(getApiErrorMessage(e, t, t('contracts.messages.saveFailed')));
    }
  };

  const saveLink = (event: React.FormEvent) => {
    event.preventDefault();
    if (!linkDialog) return;
    const url = linkDialog.url.trim();
    if (!url) return;
    const description = linkDialog.description.trim() || null;
    const existing = linkDialog.index === null ? null : links[linkDialog.index];
    setLinkDialog(null);
    void run(() => (existing
      ? api.patch(`/contracts/${contractId}/links/${existing.id}`, { description, url })
      : api.post(`/contracts/${contractId}/links`, { description, url })));
  };

  const upload = async (files: File[]) => {
    if (readOnly || files.length === 0) return;
    setUploading(files.length);
    await run(async () => {
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        await api.post(`/contracts/${contractId}/attachments`, fd);
      }
    });
    setUploading(0);
  };

  const download = async (attachment: ContractAttachment) => {
    const res = await api.get(`/contracts/attachments/${attachment.id}`, { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const el = document.createElement('a');
    el.href = url;
    el.download = attachment.original_filename;
    el.click();
    window.URL.revokeObjectURL(url);
  };

  const removeAttachment = async (attachment: ContractAttachment) => {
    const ok = await dialogs.confirm({
      message: t('confirmations.deleteAttachment', { name: attachment.original_filename }),
      confirmLabel: t('common:buttons.delete'),
      intent: 'danger',
    });
    if (ok) await run(() => api.patch(`/contracts/attachments/${attachment.id}/delete`, {}));
  };

  return (
    <>
      <Stack spacing={3} sx={{ pt: 1 }}>
        {error && <Alert severity="error" onClose={() => setError(null)} sx={sectionWidthSx}>{error}</Alert>}

        <RelationSetSection contractId={contractId} set="applications" readOnly={readOnly} onChanged={onChanged} />
        <RelationSetSection contractId={contractId} set="assets" readOnly={readOnly} onChanged={onChanged} />
        {hasLevel('infrastructure', 'reader') && (
          <RelationSetSection contractId={contractId} set="technologies" readOnly={readOnly} onChanged={onChanged} />
        )}

        <ItemContactsSection itemType="contracts" itemId={contractId} canManage={!readOnly} syncFromSupplier onChanged={onChanged} />

        <Stack spacing={1}>
          <Stack direction="row" alignItems="center" spacing={1} sx={sectionWidthSx}>
            <RelationsSectionTitle>{t('contracts.relations.relevantWebsites')}</RelationsSectionTitle>
            {!readOnly && (
              <Button size="small" startIcon={<AddIcon />} onClick={() => setLinkDialog({ index: null, description: '', url: '' })}>
                {t('contracts.relations.addUrl')}
              </Button>
            )}
          </Stack>
          <RelevantWebsitesList
            items={links.map((link) => ({ id: link.id, name: String(link.description || '').trim() || link.url, url: link.url }))}
            nameHeader={t('contracts.relations.linkName')}
            urlHeader={t('contracts.relations.linkUrl')}
            emptyLabel={t('contracts.relations.noWebsites')}
            deleteLabel={t('contracts.relations.deleteWebsite')}
            canEdit={!readOnly}
            canDelete={!readOnly}
            onEdit={(index) => {
              const link = links[index];
              if (link) setLinkDialog({ index, description: link.description || '', url: link.url });
            }}
            onDelete={(index) => {
              const link = links[index];
              if (link) void run(() => api.delete(`/contracts/${contractId}/links/${link.id}`));
            }}
            sx={sectionWidthSx}
          />
        </Stack>

        {/* Files dropped anywhere on the section are attached; no drop zone stays on screen. */}
        <Stack
          spacing={1}
          data-testid="contract-attachments"
          onDragOver={(event) => { if (!readOnly) { event.preventDefault(); setDragOver(true); } }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            if (readOnly) return;
            event.preventDefault();
            setDragOver(false);
            void upload(Array.from(event.dataTransfer.files || []));
          }}
          sx={(theme) => ({
            ...sectionWidthSx,
            borderRadius: '8px',
            outline: dragOver ? `1px dashed ${theme.palette.kanap.teal}` : 'none',
            outlineOffset: '6px',
          })}
        >
          <Stack direction="row" alignItems="center" spacing={1}>
            <RelationsSectionTitle>{t('contracts.relations.attachments')}</RelationsSectionTitle>
            {!readOnly && (
              <Button size="small" startIcon={<AddIcon />} onClick={() => fileInputRef.current?.click()} disabled={uploading > 0}>
                {t('contracts.relations.addFiles')}
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              hidden
              multiple
              aria-label={t('contracts.relations.addFiles')}
              onChange={(event) => {
                const input = event.currentTarget;
                void upload(Array.from(input.files || [])).finally(() => { input.value = ''; });
              }}
            />
          </Stack>
          {uploading > 0 && (
            <>
              <LinearProgress />
              <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>{t('contracts.relations.uploadingFiles', { count: uploading })}</Typography>
            </>
          )}
          {attachments.length === 0 ? (
            <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>
              {readOnly ? t('contracts.relations.noAttachments') : t('contracts.relations.noAttachmentsDrop')}
            </Typography>
          ) : (
            <Box sx={denseTableFrameSx}>
              <Box component="table" sx={[denseTableSx, { '& tbody tr:hover .attachment-delete': { opacity: 1 } }]}>
                <tbody>
                  {attachments.map((attachment) => (
                    <tr key={attachment.id} className="clickable" tabIndex={0} onClick={() => { void download(attachment); }} onKeyDown={(event) => { if (event.key === 'Enter') void download(attachment); }}>
                      <Box component="td" sx={{ width: '100%', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis' }} title={attachment.original_filename}>{attachment.original_filename}</Box>
                      <Box component="td" sx={{ color: 'kanap.text.tertiary !important', textAlign: 'right' }}>{formatSize(attachment.size, locale)}</Box>
                      <Box component="td" sx={{ width: 40, py: '0 !important', textAlign: 'right' }}>
                        {!readOnly && (
                          <IconButton
                            className="attachment-delete"
                            size="small"
                            aria-label={t('contracts.relations.deleteAttachment')}
                            onClick={(event) => { event.stopPropagation(); void removeAttachment(attachment); }}
                            sx={{ opacity: 0, transition: 'opacity 120ms', color: 'kanap.text.tertiary', '&:hover': { color: 'kanap.danger' }, '&:focus-visible': { opacity: 1 } }}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        )}
                      </Box>
                    </tr>
                  ))}
                </tbody>
              </Box>
            </Box>
          )}
        </Stack>
      </Stack>

      <Dialog open={!!linkDialog} onClose={() => setLinkDialog(null)} fullWidth maxWidth="xs">
        <Box component="form" onSubmit={saveLink}>
          <DialogTitle>{linkDialog?.index === null ? t('contracts.relations.addLinkTitle') : t('contracts.relations.editLinkTitle')}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                autoFocus
                variant="standard"
                inputProps={{ 'aria-label': t('contracts.relations.linkName') }}
                placeholder={t('contracts.relations.linkNamePlaceholder')}
                value={linkDialog?.description ?? ''}
                onChange={(event) => setLinkDialog((prev) => (prev ? { ...prev, description: event.target.value } : prev))}
              />
              <TextField
                variant="standard"
                inputProps={{ 'aria-label': t('contracts.relations.linkUrl') }}
                placeholder="https://..."
                value={linkDialog?.url ?? ''}
                onChange={(event) => setLinkDialog((prev) => (prev ? { ...prev, url: event.target.value } : prev))}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button variant="action" onClick={() => setLinkDialog(null)}>{t('common:buttons.cancel')}</Button>
            <Button type="submit" variant="action-primary" disabled={!linkDialog?.url.trim()}>
              {linkDialog?.index === null ? t('common:buttons.add') : t('common:buttons.save')}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </>
  );
}
