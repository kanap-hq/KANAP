import React from 'react';
import {
  Alert,
  Box,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { KanapDialog, PropertyRow } from '../../../components/design';
import { drawerMenuItemSx, drawerSelectSx } from '../../../theme/formSx';
import { knowledgeLibraryName, localizeKnowledgeFolderTree } from '../../../utils/knowledgeNames';

type DocumentLibrary = {
  id: string;
  name: string;
  slug: string;
  is_system: boolean;
  display_order: number;
  can_write?: boolean;
};

type DocumentSelectionRow = {
  id: string;
  item_ref: string;
  title: string;
  library_id: string | null;
  library_name: string | null;
  library_slug?: string | null;
  folder_id: string | null;
};

type FolderNode = {
  id: string;
  name: string;
  system_key?: string | null;
  children?: FolderNode[];
};

type FlatFolder = {
  id: string;
  name: string;
  depth: number;
};

const UNFILED_OPTION_VALUE = '__unfiled__';

export type KnowledgeMoveRequest = {
  target_library_id: string;
  target_folder_id: string | null;
};

interface KnowledgeMoveDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (value: KnowledgeMoveRequest) => void;
  pending?: boolean;
  selectedRows: DocumentSelectionRow[];
  libraries: DocumentLibrary[];
  activeLibraryId: string | null;
  canChangeLibrary: boolean;
  initialTargetLibraryId?: string | null;
  templateLibraryId?: string | null;
  error?: string | null;
}

function flattenFolders(nodes: FolderNode[], depth = 0): FlatFolder[] {
  const out: FlatFolder[] = [];
  nodes.forEach((node) => {
    out.push({ id: node.id, name: node.name, depth });
    if (Array.isArray(node.children) && node.children.length > 0) {
      out.push(...flattenFolders(node.children, depth + 1));
    }
  });
  return out;
}

function getSharedFolderId(rows: DocumentSelectionRow[]): string | null {
  if (!rows.length) return null;
  const values = Array.from(new Set(rows.map((row) => row.folder_id || UNFILED_OPTION_VALUE)));
  if (values.length !== 1) return null;
  return values[0] === UNFILED_OPTION_VALUE ? null : values[0];
}

export default function KnowledgeMoveDialog({
  open,
  onClose,
  onConfirm,
  pending = false,
  selectedRows,
  libraries,
  activeLibraryId,
  canChangeLibrary,
  initialTargetLibraryId = null,
  templateLibraryId = null,
  error = null,
}: KnowledgeMoveDialogProps) {
  const { t } = useTranslation(['knowledge', 'common']);
  const selectedLibraryIds = React.useMemo(
    () => Array.from(new Set(selectedRows.map((row) => row.library_id).filter(Boolean))),
    [selectedRows],
  );
  const selectedLibraryNames = React.useMemo(
    () => Array.from(new Set(selectedRows.map((row) => (
      row.library_name ? knowledgeLibraryName(t, { slug: row.library_slug, name: row.library_name }) : t('shared.unknown')
    )))),
    [selectedRows, t],
  );
  const selectionIsMixedLibraries = selectedLibraryIds.length > 1;
  const selectionIncludesTemplateLibrary = !!templateLibraryId && selectedLibraryIds.includes(templateLibraryId);
  const commonLibraryId = selectedLibraryIds.length === 1 ? selectedLibraryIds[0] : null;
  const selectableLibraries = React.useMemo(
    () => libraries.filter((library) => {
      if (library.id === commonLibraryId) return true;
      if (library.id === templateLibraryId) return false;
      return library.can_write !== false;
    }),
    [commonLibraryId, libraries, templateLibraryId],
  );
  const defaultLibraryId = React.useMemo(() => {
    if (commonLibraryId) return commonLibraryId;
    if (activeLibraryId) return activeLibraryId;
    return selectableLibraries[0]?.id || '';
  }, [activeLibraryId, commonLibraryId, selectableLibraries]);
  const canChangeLibraryForSelection = canChangeLibrary && !selectionIncludesTemplateLibrary;
  const preferredLibraryId = React.useMemo(() => {
    if (initialTargetLibraryId && selectableLibraries.some((library) => library.id === initialTargetLibraryId)) {
      return initialTargetLibraryId;
    }
    return defaultLibraryId;
  }, [defaultLibraryId, initialTargetLibraryId, selectableLibraries]);

  const [targetLibraryId, setTargetLibraryId] = React.useState('');
  const [targetFolderId, setTargetFolderId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const nextLibraryId = canChangeLibraryForSelection
      ? preferredLibraryId
      : (commonLibraryId || preferredLibraryId);
    setTargetLibraryId(nextLibraryId);
    setTargetFolderId(
      !selectionIsMixedLibraries && nextLibraryId && nextLibraryId === commonLibraryId
        ? getSharedFolderId(selectedRows)
        : null,
    );
  }, [open, canChangeLibraryForSelection, commonLibraryId, preferredLibraryId, selectedRows, selectionIsMixedLibraries]);

  const { data: folderTree } = useQuery({
    queryKey: ['knowledge-folders-tree', targetLibraryId],
    queryFn: async () => (await api.get('/knowledge-folders/tree', { params: { library_id: targetLibraryId } })).data as { items: FolderNode[] },
    enabled: open && !!targetLibraryId,
  });

  const flatFolders = React.useMemo(
    () => flattenFolders(localizeKnowledgeFolderTree(t, folderTree?.items)),
    [folderTree?.items, t],
  );

  const libraryChangeBlocked =
    (!canChangeLibrary && selectionIsMixedLibraries)
    || (selectionIncludesTemplateLibrary && selectionIsMixedLibraries);
  const disableSubmit = pending || !selectedRows.length || !targetLibraryId || libraryChangeBlocked;
  const selectionSummary = selectedRows.length === 1
    ? t('moveDialog.selection.single', { ref: selectedRows[0].item_ref, title: selectedRows[0].title })
    : t('moveDialog.selection.multiple', { count: selectedRows.length });

  return (
    <KanapDialog
      open={open}
      onClose={pending ? () => undefined : onClose}
      title={t('moveDialog.title')}
      onSave={() => onConfirm({ target_library_id: targetLibraryId, target_folder_id: targetFolderId })}
      saveLabel={t('moveDialog.actions.move')}
      saveDisabled={disableSubmit}
      saveLoading={pending}
    >
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <Typography variant="body2" color="text.secondary">
            {selectionSummary}
          </Typography>

          <Typography variant="body2" color="text.secondary">
            {selectedLibraryNames.length === 1
              ? t('moveDialog.currentLibrary.single', { names: selectedLibraryNames.join(', ') })
              : t('moveDialog.currentLibrary.multiple', { names: selectedLibraryNames.join(', ') })}
          </Typography>

          {!canChangeLibrary && !selectionIncludesTemplateLibrary && (
            <Alert severity="info">
              {t('moveDialog.messages.crossLibraryAdminOnly')}
            </Alert>
          )}

          {selectionIncludesTemplateLibrary && (
            <Alert severity={selectionIsMixedLibraries ? 'error' : 'info'}>
              {selectionIsMixedLibraries
                ? t('moveDialog.messages.templatesMixed')
                : t('moveDialog.messages.templatesOnly')}
            </Alert>
          )}

          {libraryChangeBlocked && (
            <Alert severity="error">
              {selectionIncludesTemplateLibrary && selectionIsMixedLibraries
                ? t('moveDialog.messages.templatesBlocked')
                : t('moveDialog.messages.selectSingleLibrary')}
            </Alert>
          )}

          <PropertyRow label={t('moveDialog.fields.targetLibrary')}>
            <TextField
              select
              variant="standard"
              fullWidth
              value={targetLibraryId}
              onChange={(e) => {
                const nextLibraryId = e.target.value;
                setTargetLibraryId(nextLibraryId);
                setTargetFolderId(null);
              }}
              disabled={!canChangeLibraryForSelection || libraryChangeBlocked}
              sx={drawerSelectSx}
            >
              {selectableLibraries.map((library) => (
                <MenuItem key={library.id} value={library.id} sx={drawerMenuItemSx}>
                  {library.name}
                </MenuItem>
              ))}
            </TextField>
          </PropertyRow>

          <PropertyRow label={t('moveDialog.fields.targetFolder')}>
            <TextField
              select
              variant="standard"
              fullWidth
              value={targetFolderId ?? UNFILED_OPTION_VALUE}
              onChange={(e) => setTargetFolderId(e.target.value === UNFILED_OPTION_VALUE ? null : e.target.value)}
              disabled={!targetLibraryId || libraryChangeBlocked}
              sx={drawerSelectSx}
            >
              <MenuItem value={UNFILED_OPTION_VALUE} sx={drawerMenuItemSx}>{t('shared.unfiled')}</MenuItem>
              {flatFolders.map((folder) => (
                <MenuItem key={folder.id} value={folder.id} sx={drawerMenuItemSx}>
                  <Box component="span" sx={{ pl: folder.depth * 2 }}>
                    {folder.name}
                  </Box>
                </MenuItem>
              ))}
            </TextField>
          </PropertyRow>
        </Stack>
    </KanapDialog>
  );
}
