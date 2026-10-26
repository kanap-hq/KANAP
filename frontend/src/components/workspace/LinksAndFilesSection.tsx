import React from 'react';
import { Alert, Box, Button, IconButton, Stack, TextField } from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import LinkIcon from '@mui/icons-material/Link';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import { useTranslation } from 'react-i18next';
import { KanapDialog, PropertyRow } from '../design';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { normalizeWebsiteUrl } from '../design/RelevantWebsitesList';
import { formatShortDate } from '../../lib/dateFormat';
import { drawerFieldValueSx } from '../../theme/formSx';
import { RelationsEmpty, RelationsSection, RelationsTable, type RelationsColumn } from './RelationsTable';

/** A web link of the object: `name` is its description, the URL shows when it has none. */
export type LinksAndFilesLink = { id: string; name?: string | null; url: string; added_at?: string | null };
/** A file attached to the object. */
export type LinksAndFilesFile = { id: string; name: string; size?: number | null; added_at?: string | null };
/** What the link dialog saves. */
export type LinkDraft = { name: string | null; url: string };

type Row =
  | { kind: 'link'; key: string; link: LinksAndFilesLink }
  | { kind: 'file'; key: string; file: LinksAndFilesFile };

type Props = {
  links: LinksAndFilesLink[];
  files: LinksAndFilesFile[];
  /** False while the lists load: the count is left out. */
  loaded?: boolean;
  /** Readers get the table and the opening, without add, edit or remove. */
  canEdit: boolean;
  /** How many files are uploading (0: none). */
  uploading?: number;
  onAddLink: (draft: LinkDraft) => Promise<void>;
  onEditLink: (link: LinksAndFilesLink, draft: LinkDraft) => Promise<void>;
  onRemoveLink: (link: LinksAndFilesLink) => void;
  onUploadFiles: (files: File[]) => void;
  onOpenFile: (file: LinksAndFilesFile) => void;
  onRemoveFile: (file: LinksAndFilesFile) => void;
  /** Web links only (a location): no file chooser, no drop, the section is titled "Web links". */
  linksOnly?: boolean;
};

/** A file size in the user's language (`12 kB`, `1.4 MB`). */
export function formatFileSize(bytes: number, lang: string): string {
  const [value, unit, digits] = bytes < 1024 ? [bytes, 'byte', 0] : bytes < 1024 * 1024 ? [bytes / 1024, 'kilobyte', 0] : [bytes / (1024 * 1024), 'megabyte', 1];
  return new Intl.NumberFormat(lang, { style: 'unit', unit: unit as string, unitDisplay: 'short', maximumFractionDigits: digits as number }).format(value as number);
}

/** The domain of a URL (`learn.microsoft.com`), or the URL itself when it cannot be read. */
export function urlDomain(url: string): string {
  try {
    return new URL(normalizeWebsiteUrl(url)).hostname || url;
  } catch {
    return url;
  }
}

const linkName = (link: LinksAndFilesLink) => String(link.name || '').trim() || link.url;

/** The row of a web link: a real address, opened in a new tab. Only http or https. */
function webLinkAnchor(url: string, children: React.ReactNode) {
  return (
    <a href={normalizeWebsiteUrl(url)} target="_blank" rel="noopener noreferrer" className="relations-row-link">
      {children}
    </a>
  );
}
const dragHasFiles = (event: React.DragEvent) => Array.from(event.dataTransfer?.types || []).includes('Files');

/**
 * The web links and the files of an object in one Relations section (lot R1b): one dense row per
 * link or file (type icon, name, domain or size, date added), a click opens the link in a new tab
 * or downloads the file. Editors add a link through a dialog, attach files with the file chooser
 * or by dropping them on the section (highlighted only while dragging), edit a link and remove a
 * row on hover. Each change is the caller's, saved at once.
 */
export default function LinksAndFilesSection({
  links, files, loaded = true, canEdit, uploading = 0,
  onAddLink, onEditLink, onRemoveLink, onUploadFiles, onOpenFile, onRemoveFile, linksOnly = false,
}: Props) {
  const { t, i18n } = useTranslation('common');
  const lang = i18n.language;
  const fileInput = React.useRef<HTMLInputElement | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  /** The link the dialog edits; null when it adds one. */
  const [editing, setEditing] = React.useState<LinksAndFilesLink | null>(null);
  const [draft, setDraft] = React.useState({ name: '', url: '' });
  const [dialogError, setDialogError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const dragDepth = React.useRef(0);
  const nameInput = React.useRef<HTMLInputElement | null>(null);

  const title = linksOnly ? t('linksAndFiles.linksTitle') : t('linksAndFiles.title');
  const withFiles = canEdit && !linksOnly;
  const rows: Row[] = [
    ...links.map((link): Row => ({ kind: 'link', key: `link:${link.id}`, link })),
    ...files.map((file): Row => ({ kind: 'file', key: `file:${file.id}`, file })),
  ];
  const nameOf = (row: Row) => (row.kind === 'link' ? linkName(row.link) : row.file.name);

  const openDialog = (link: LinksAndFilesLink | null) => {
    setEditing(link);
    setDraft({ name: link?.name ?? '', url: link?.url ?? '' });
    setDialogError(null);
    setDialogOpen(true);
  };

  const save = async () => {
    const url = draft.url.trim();
    if (!url) return;
    const next = { name: draft.name.trim() || null, url };
    setSaving(true);
    setDialogError(null);
    try {
      if (editing) await onEditLink(editing, next);
      else await onAddLink(next);
      setDialogOpen(false);
    } catch (e) {
      // A refusal stays in the dialog. The page banner sits under the dialog veil.
      setDialogError(getApiErrorMessage(e, t, t('linksAndFiles.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const open = (row: Row) => {
    if (row.kind === 'link') window.open(normalizeWebsiteUrl(row.link.url), '_blank', 'noopener,noreferrer');
    else onOpenFile(row.file);
  };

  const date = (value?: string | null) => (value ? formatShortDate(value, lang) : '—');
  const iconSx = { fontSize: 16, color: 'kanap.text.tertiary', verticalAlign: 'middle' } as const;
  const columns: Array<RelationsColumn<Row>> = [
    {
      key: 'type', header: '', width: 28,
      render: (row) => (row.kind === 'link'
        ? <LinkIcon sx={iconSx} titleAccess={t('linksAndFiles.types.link')} />
        : <InsertDriveFileOutlinedIcon sx={iconSx} titleAccess={t('linksAndFiles.types.file')} />),
    },
    {
      key: 'name', header: t('linksAndFiles.columns.name'),
      render: (row) => (row.kind === 'link' ? webLinkAnchor(row.link.url, nameOf(row)) : nameOf(row)),
    },
    {
      key: 'detail', header: linksOnly ? t('linksAndFiles.columns.address') : t('linksAndFiles.columns.detail'), width: 180, hideOrder: 2,
      render: (row) => (
        <Box component="span" sx={{ color: 'kanap.text.secondary' }} title={row.kind === 'link' ? row.link.url : undefined}>
          {row.kind === 'link'
            ? webLinkAnchor(row.link.url, urlDomain(row.link.url))
            : row.file.size != null ? formatFileSize(row.file.size, lang) : '—'}
        </Box>
      ),
    },
    {
      key: 'added', header: t('linksAndFiles.columns.added'), width: 110, hideOrder: 1,
      render: (row) => date(row.kind === 'link' ? row.link.added_at : row.file.added_at),
    },
  ];

  const dropHandlers = withFiles ? {
    onDragEnter: (event: React.DragEvent) => {
      if (!dragHasFiles(event)) return;
      event.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragOver: (event: React.DragEvent) => {
      if (dragHasFiles(event)) event.preventDefault();
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    },
    onDrop: (event: React.DragEvent) => {
      if (!dragHasFiles(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const dropped = Array.from(event.dataTransfer.files || []);
      if (dropped.length) onUploadFiles(dropped);
    },
  } : {};

  const textButtonSx = { fontSize: 12, minWidth: 0, px: 1 } as const;
  const count = !loaded ? undefined : uploading ? t('linksAndFiles.uploading', { count: uploading }) : rows.length;

  return (
    <Box
      {...dropHandlers}
      data-dragging={dragging || undefined}
      sx={(theme) => ({
        borderRadius: '6px',
        outline: '1px dashed transparent',
        outlineOffset: 4,
        transition: 'background-color 120ms, outline-color 120ms',
        ...(dragging ? { outlineColor: theme.palette.primary.main, backgroundColor: theme.palette.kanap.bg.hover } : {}),
      })}
    >
      <RelationsSection
        title={title}
        count={count}
        actions={canEdit ? (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Button variant="text" size="small" onClick={() => openDialog(null)} sx={textButtonSx}>{t('linksAndFiles.addLink')}</Button>
            {!linksOnly && (
              <Button variant="text" size="small" disabled={uploading > 0} onClick={() => fileInput.current?.click()} sx={textButtonSx}>{t('linksAndFiles.attachFile')}</Button>
            )}
          </Box>
        ) : undefined}
      >
        {withFiles && (
          <input
            ref={fileInput}
            type="file"
            hidden
            multiple
            aria-label={t('linksAndFiles.attachFile')}
            onChange={(event) => {
              const chosen = Array.from(event.target.files || []);
              event.target.value = '';
              if (chosen.length) onUploadFiles(chosen);
            }}
          />
        )}
        {rows.length === 0 ? (
          <RelationsEmpty>{linksOnly ? t('linksAndFiles.linksEmpty') : t('linksAndFiles.empty')}</RelationsEmpty>
        ) : (
          <RelationsTable
            ariaLabel={title}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.key}
            onRowOpen={open}
            action={canEdit ? {
              width: 28,
              render: (row) => (row.kind === 'link' ? (
                <IconButton
                  className="relations-remove"
                  size="small"
                  aria-label={t('linksAndFiles.editLinkNamed', { name: linkName(row.link) })}
                  onClick={() => openDialog(row.link)}
                  sx={{ p: '2px', color: 'kanap.text.tertiary' }}
                >
                  <EditOutlinedIcon sx={{ fontSize: 16 }} />
                </IconButton>
              ) : null),
            } : undefined}
            onRemove={canEdit ? (row) => (row.kind === 'link' ? onRemoveLink(row.link) : onRemoveFile(row.file)) : undefined}
            removeLabel={(row) => t(row.kind === 'file' ? 'linksAndFiles.removeFileNamed' : 'linksAndFiles.removeNamed', { name: nameOf(row) })}
          />
        )}
      </RelationsSection>

      <KanapDialog
        open={dialogOpen}
        title={editing ? t('linksAndFiles.editLink') : t('linksAndFiles.newLink')}
        onClose={() => setDialogOpen(false)}
        onSave={save}
        saveLabel={editing ? t('buttons.save') : t('buttons.add')}
        saveDisabled={!draft.url.trim()}
        saveLoading={saving}
        initialFocusRef={nameInput}
      >
        <Stack spacing={1.25}>
          {dialogError && <Alert severity="error">{dialogError}</Alert>}
          <PropertyRow label={t('linksAndFiles.columns.name')}>
            <TextField
              value={draft.name}
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
              variant="standard"
              fullWidth
              inputRef={nameInput}
              placeholder={t('linksAndFiles.placeholders.name')}
              inputProps={{ 'aria-label': t('linksAndFiles.columns.name') }}
              sx={drawerFieldValueSx}
            />
          </PropertyRow>
          <PropertyRow label={t('linksAndFiles.url')} required>
            <TextField
              value={draft.url}
              onChange={(event) => setDraft((prev) => ({ ...prev, url: event.target.value }))}
              variant="standard"
              fullWidth
              placeholder={t('linksAndFiles.placeholders.url')}
              inputProps={{ 'aria-label': t('linksAndFiles.url') }}
              sx={drawerFieldValueSx}
            />
          </PropertyRow>
        </Stack>
      </KanapDialog>
    </Box>
  );
}
