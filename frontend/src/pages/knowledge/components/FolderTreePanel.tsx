import React from 'react';
import {
  Alert,
  Box,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import FolderIcon from '@mui/icons-material/Folder';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { useTenant } from '../../../tenant/TenantContext';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { localizeKnowledgeFolderTree } from '../../../utils/knowledgeNames';
import { recordRefusal } from '../../../utils/deleteCheck';
import { deleteFailureReason } from '../../../utils/deleteRefusal';
import { KanapDialog, PropertyRow, useKanapDialogs } from '../../../components/design';
import { drawerMenuItemSx, drawerSelectSx } from '../../../theme/formSx';

type FolderNode = {
  id: string;
  name: string;
  system_key?: string | null;
  children?: FolderNode[];
};

interface FolderTreePanelProps {
  libraryId: string;
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  canManage: boolean;
  folderExternalDragAndDrop?: {
    onDragStart: (folder: DraggedFolderState) => void;
    onDragEnd: () => void;
  };
  documentDragAndDrop?: {
    active: boolean;
    hoverFolderId: string | null;
    canDropOnFolder: (folderId: string | null) => boolean;
    onFolderDragOver: (folderId: string | null, event: React.DragEvent<HTMLDivElement>) => void;
    onFolderDrop: (folderId: string | null, event: React.DragEvent<HTMLDivElement>) => void;
  };
}

const FOLDER_TREE_STORAGE_PREFIX = 'kanap-knowledge-folder-tree';
export const ROOT_FOLDER_DROP_TARGET = '__root__';

export type DraggedFolderState = {
  id: string;
  name: string;
  parentId: string | null;
  libraryId: string;
};

function flattenFolders(nodes: FolderNode[], depth = 0): Array<{ id: string; name: string; depth: number }> {
  const out: Array<{ id: string; name: string; depth: number }> = [];
  nodes.forEach((node) => {
    out.push({ id: node.id, name: node.name, depth });
    if (Array.isArray(node.children) && node.children.length > 0) {
      out.push(...flattenFolders(node.children, depth + 1));
    }
  });
  return out;
}

function collectFolderMetadata(
  nodes: FolderNode[],
  parentId: string | null = null,
  folderIds: Set<string> = new Set<string>(),
  parentById: Map<string, string | null> = new Map<string, string | null>(),
): { folderIds: Set<string>; parentById: Map<string, string | null> } {
  nodes.forEach((node) => {
    folderIds.add(node.id);
    parentById.set(node.id, parentId);
    if (Array.isArray(node.children) && node.children.length > 0) {
      collectFolderMetadata(node.children, node.id, folderIds, parentById);
    }
  });
  return { folderIds, parentById };
}

function getExpandedFolderStorageKey(tenantSlug: string | null, userId: string | null, libraryId: string): string {
  return `${FOLDER_TREE_STORAGE_PREFIX}:${tenantSlug ?? 'unknown'}:${userId ?? 'anon'}:${libraryId}`;
}

function readStoredExpandedFolderIds(storageKey: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === 'string');
  } catch {
    return [];
  }
}

function writeStoredExpandedFolderIds(storageKey: string, ids: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(ids));
  } catch {
    // ignore storage errors
  }
}

function isFolderDescendant(
  candidateId: string,
  ancestorId: string,
  parentById: Map<string, string | null>,
): boolean {
  let currentId: string | null = candidateId;
  while (currentId) {
    if (currentId === ancestorId) return true;
    currentId = parentById.get(currentId) ?? null;
  }
  return false;
}

function FolderTreeNode({
  node,
  depth,
  selectedFolderId,
  onSelectFolder,
  expandedIds,
  onToggle,
  canManage,
  onRename,
  onDelete,
  onCreateChild,
  folderDragAndDrop,
  documentDragAndDrop,
}: {
  node: FolderNode;
  depth: number;
  selectedFolderId: string | null;
  onSelectFolder: (id: string) => void;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  canManage: boolean;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onCreateChild: (parentId: string) => void;
  folderDragAndDrop?: {
    active: boolean;
    hoverTargetId: string | null;
    onDragStart: (node: FolderNode, event: React.DragEvent<HTMLSpanElement>) => void;
    onDragEnd: () => void;
    canDropOnFolder: (folderId: string) => boolean;
    onFolderDragOver: (folderId: string, event: React.DragEvent<HTMLDivElement>) => void;
    onFolderDrop: (folderId: string, event: React.DragEvent<HTMLDivElement>) => void;
    movePending: boolean;
  };
  documentDragAndDrop?: FolderTreePanelProps['documentDragAndDrop'];
}) {
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedFolderId === node.id;
  const canDropDraggedFolderHere = !!folderDragAndDrop?.active && folderDragAndDrop.canDropOnFolder(node.id);
  const isHoveredFolderDropTarget = canDropDraggedFolderHere && folderDragAndDrop?.hoverTargetId === node.id;
  const canDropHere = !!documentDragAndDrop?.active && documentDragAndDrop.canDropOnFolder(node.id);
  const isHoveredDropTarget = canDropHere && documentDragAndDrop?.hoverFolderId === node.id;
  const isAnyDropTargetHovered = isHoveredFolderDropTarget || isHoveredDropTarget;
  const [editing, setEditing] = React.useState(false);
  const [editName, setEditName] = React.useState(node.name);
  const editInputRef = React.useRef<HTMLInputElement | null>(null);
  const [menuAnchorEl, setMenuAnchorEl] = React.useState<HTMLElement | null>(null);
  const menuOpen = !!menuAnchorEl;
  const { t } = useTranslation(['knowledge', 'common']);

  React.useEffect(() => {
    if (!editing) return;
    editInputRef.current?.focus();
    editInputRef.current?.select();
  }, [editing]);

  return (
    <>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          pl: depth * 2,
          pr: 0.5,
          py: 0.25,
          borderRadius: 1,
          cursor: 'pointer',
          border: '1px solid',
          borderColor: isAnyDropTargetHovered ? 'primary.main' : 'transparent',
          bgcolor: isAnyDropTargetHovered ? 'action.focus' : (isSelected ? 'action.selected' : 'transparent'),
          '&:hover': { bgcolor: isSelected ? 'action.selected' : 'action.hover' },
        }}
        onClick={() => onSelectFolder(node.id)}
        onDragOver={(event) => {
          if (folderDragAndDrop && canDropDraggedFolderHere) {
            folderDragAndDrop.onFolderDragOver(node.id, event);
            return;
          }
          if (!documentDragAndDrop || !canDropHere) return;
          documentDragAndDrop.onFolderDragOver(node.id, event);
        }}
        onDrop={(event) => {
          if (folderDragAndDrop && canDropDraggedFolderHere) {
            folderDragAndDrop.onFolderDrop(node.id, event);
            return;
          }
          if (!documentDragAndDrop || !canDropHere) return;
          documentDragAndDrop.onFolderDrop(node.id, event);
        }}
      >
        {hasChildren ? (
          <IconButton
            size="small"
            sx={{ p: 0.25, mr: 0.25 }}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
          >
            {isExpanded ? <ExpandMoreIcon sx={{ fontSize: 16 }} /> : <ChevronRightIcon sx={{ fontSize: 16 }} />}
          </IconButton>
        ) : (
          <Box sx={{ width: 24 }} />
        )}
        {canManage && !editing && folderDragAndDrop ? (
          <Tooltip title={folderDragAndDrop.movePending ? t('folderTree.messages.moveInProgress') : t('folderTree.actions.dragFolder')}>
            <Box
              component="span"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 16,
                mr: 0.25,
                color: folderDragAndDrop.movePending ? 'text.disabled' : 'text.secondary',
                cursor: folderDragAndDrop.movePending ? 'not-allowed' : 'grab',
              }}
              draggable={!folderDragAndDrop.movePending}
              onClick={(event) => event.stopPropagation()}
              onDragStart={(event: React.DragEvent<HTMLSpanElement>) => folderDragAndDrop.onDragStart(node, event)}
              onDragEnd={folderDragAndDrop.onDragEnd}
            >
              <DragIndicatorIcon sx={{ fontSize: 14 }} />
            </Box>
          </Tooltip>
        ) : (
          <Box sx={{ width: 16, mr: 0.25 }} />
        )}
        {isExpanded && hasChildren ? (
          <FolderOpenIcon sx={{ fontSize: 18, mr: 0.75, color: 'text.secondary' }} />
        ) : (
          <FolderIcon sx={{ fontSize: 18, mr: 0.75, color: 'text.secondary' }} />
        )}
        {editing ? (
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flex: 1 }} onClick={(e) => e.stopPropagation()}>
            <TextField
              size="small"
              value={editName}
              inputRef={editInputRef}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && editName.trim()) {
                  onRename(node.id, editName.trim());
                  setEditing(false);
                }
                if (e.key === 'Escape') {
                  setEditName(node.name);
                  setEditing(false);
                }
              }}
              sx={{ '& .MuiInputBase-input': { py: 0.25, px: 0.5, fontSize: '0.8rem' } }}
            />
            <IconButton size="small" onClick={() => { if (editName.trim()) { onRename(node.id, editName.trim()); setEditing(false); } }}>
              <CheckIcon sx={{ fontSize: 14 }} />
            </IconButton>
            <IconButton size="small" onClick={() => { setEditName(node.name); setEditing(false); }}>
              <CloseIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Stack>
        ) : (
          <Typography
            variant="body2"
            sx={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontWeight: isSelected ? 500 : 400,
            }}
          >
            {node.name}
          </Typography>
        )}
        {canManage && !editing && (
          <>
            <IconButton
              size="small"
              aria-label={t('folderTree.aria.folderActions', { name: node.name })}
              onClick={(e) => {
                e.stopPropagation();
                setMenuAnchorEl(e.currentTarget);
              }}
            >
              <MoreHorizIcon sx={{ fontSize: 16 }} />
            </IconButton>
            <Menu
              anchorEl={menuAnchorEl}
              open={menuOpen}
              onClose={() => setMenuAnchorEl(null)}
              onClick={(e) => e.stopPropagation()}
            >
              <MenuItem onClick={() => { setMenuAnchorEl(null); onCreateChild(node.id); }}>
                {t('folderTree.actions.newSubfolder')}
              </MenuItem>
              <MenuItem onClick={() => { setMenuAnchorEl(null); setEditName(node.name); setEditing(true); }}>
                {t('folderTree.actions.rename')}
              </MenuItem>
              <MenuItem
                sx={{ color: 'error.main' }}
                onClick={() => { setMenuAnchorEl(null); onDelete(node.id); }}
              >
                {t('common:buttons.delete')}
              </MenuItem>
            </Menu>
          </>
        )}
      </Box>
      {hasChildren && isExpanded && node.children!.map((child) => (
        <FolderTreeNode
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
          expandedIds={expandedIds}
          onToggle={onToggle}
          canManage={canManage}
          onRename={onRename}
          onDelete={onDelete}
          onCreateChild={onCreateChild}
          folderDragAndDrop={folderDragAndDrop}
          documentDragAndDrop={documentDragAndDrop}
        />
      ))}
    </>
  );
}

const FolderTreePanel = React.memo(function FolderTreePanel({
  libraryId,
  selectedFolderId,
  onSelectFolder,
  canManage,
  folderExternalDragAndDrop,
  documentDragAndDrop,
}: FolderTreePanelProps) {
  const { t, i18n } = useTranslation(['knowledge', 'common']);
  const dialogs = useKanapDialogs();
  const { profile } = useAuth();
  const { tenantSlug } = useTenant();
  const qc = useQueryClient();
  const storageKey = React.useMemo(
    () => getExpandedFolderStorageKey(tenantSlug, profile?.id ?? null, libraryId),
    [tenantSlug, profile?.id, libraryId],
  );
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(
    () => new Set(readStoredExpandedFolderIds(storageKey)),
  );
  const [folderDialogOpen, setFolderDialogOpen] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState('');
  const [newFolderParentId, setNewFolderParentId] = React.useState('');
  const [deleteFolderId, setDeleteFolderId] = React.useState<string | null>(null);
  const [rootMenuAnchorEl, setRootMenuAnchorEl] = React.useState<HTMLElement | null>(null);
  const [draggedFolder, setDraggedFolder] = React.useState<DraggedFolderState | null>(null);
  const [folderHoverTargetId, setFolderHoverTargetId] = React.useState<string | null>(null);
  const [treeError, setTreeError] = React.useState<string | null>(null);

  const { data: folderTree } = useQuery({
    queryKey: ['knowledge-folders-tree', libraryId],
    queryFn: async () => (await api.get('/knowledge-folders/tree', { params: { library_id: libraryId } })).data as { items: FolderNode[] },
    enabled: !!libraryId,
  });

  // The Managed Docs folders in the reader's language.
  const folderItems = React.useMemo(
    () => localizeKnowledgeFolderTree(t, folderTree?.items),
    [folderTree?.items, t],
  );
  const flatFolders = React.useMemo(
    () => flattenFolders(folderItems),
    [folderItems],
  );
  const folderMetadata = React.useMemo(
    () => collectFolderMetadata(folderItems),
    [folderItems],
  );
  const selectedFolderAncestorIds = React.useMemo(() => {
    if (!selectedFolderId) return [] as string[];
    if (!folderMetadata.parentById.has(selectedFolderId)) return [] as string[];
    const ancestors: string[] = [];
    let parentId = folderMetadata.parentById.get(selectedFolderId) ?? null;
    while (parentId) {
      ancestors.push(parentId);
      parentId = folderMetadata.parentById.get(parentId) ?? null;
    }
    return ancestors;
  }, [folderMetadata.parentById, selectedFolderId]);

  React.useEffect(() => {
    setExpandedIds(new Set(readStoredExpandedFolderIds(storageKey)));
  }, [storageKey]);

  React.useEffect(() => {
    setExpandedIds((prev) => {
      const next = new Set<string>();
      prev.forEach((id) => {
        if (folderMetadata.folderIds.has(id)) next.add(id);
      });
      selectedFolderAncestorIds.forEach((id) => next.add(id));
      if (next.size === prev.size && Array.from(next).every((id) => prev.has(id))) {
        return prev;
      }
      return next;
    });
  }, [folderMetadata.folderIds, selectedFolderAncestorIds]);

  React.useEffect(() => {
    writeStoredExpandedFolderIds(storageKey, Array.from(expandedIds));
  }, [expandedIds, storageKey]);

  const onToggle = React.useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const createFolderMutation = useMutation({
    mutationFn: async ({ name, parentId }: { name: string; parentId: string | null }) => {
      await api.post('/knowledge-folders', {
        name,
        parent_id: parentId,
        library_id: libraryId,
      });
    },
    onSuccess: async (_data, variables) => {
      const parentId = variables.parentId;
      if (parentId) {
        setExpandedIds((prev) => new Set(prev).add(parentId));
      }
      setFolderDialogOpen(false);
      setNewFolderName('');
      setNewFolderParentId('');
      await qc.invalidateQueries({ queryKey: ['knowledge-folders-tree', libraryId] });
    },
  });

  const renameFolderMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      await api.patch(`/knowledge-folders/${id}`, { name });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['knowledge-folders-tree', libraryId] });
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/knowledge-folders/${id}`);
    },
    onSuccess: async () => {
      setTreeError(null);
      await qc.invalidateQueries({ queryKey: ['knowledge-folders-tree', libraryId] });
      if (selectedFolderId) onSelectFolder(null);
    },
    // A refused delete (a folder with subfolders) says why, in the interface language.
    onError: (error: any) => {
      setTreeError(getApiErrorMessage(error, t, t('folderTree.messages.deleteFailed')));
    },
  });

  const handleRename = React.useCallback((id: string, name: string) => {
    renameFolderMutation.mutate({ id, name });
  }, [renameFolderMutation]);

  // Asked first: a folder the delete would refuse (one with subfolders) gets the refusal and why, with Close only.
  const handleDelete = React.useCallback(async (id: string) => {
    const refusal = await recordRefusal('/knowledge-folders', id);
    if (refusal) {
      const name = flatFolders.find((folder) => folder.id === id)?.name || refusal.name || '';
      await dialogs.alert({
        title: t('common:delete.recordTitle', { name }),
        message: deleteFailureReason(refusal, t, i18n?.resolvedLanguage || i18n?.language || 'en'),
      });
      return;
    }
    setDeleteFolderId(id);
  }, [dialogs, flatFolders, i18n, t]);

  const moveFolderMutation = useMutation({
    mutationFn: async ({ id, parentId }: { id: string; parentId: string | null }) => {
      await api.post(`/knowledge-folders/${id}/move`, {
        parent_id: parentId,
      });
    },
    onSuccess: async (_data, variables) => {
      const parentId = variables.parentId;
      if (parentId) {
        setExpandedIds((prev) => new Set(prev).add(parentId));
      }
      setDraggedFolder(null);
      setFolderHoverTargetId(null);
      folderExternalDragAndDrop?.onDragEnd();
      setTreeError(null);
      await qc.invalidateQueries({ queryKey: ['knowledge-folders-tree', libraryId] });
    },
    onError: (error: any) => {
      setDraggedFolder(null);
      setFolderHoverTargetId(null);
      folderExternalDragAndDrop?.onDragEnd();
      setTreeError(getApiErrorMessage(error, t, t('folderTree.messages.moveFailed')));
    },
  });

  const openCreateDialog = React.useCallback((parentId: string | null) => {
    setNewFolderName('');
    setNewFolderParentId(parentId || '');
    setFolderDialogOpen(true);
  }, []);

  const canDropDraggedFolderOnParent = React.useCallback((parentId: string | null) => {
    if (!draggedFolder || moveFolderMutation.isPending) return false;
    if (draggedFolder.libraryId !== libraryId) return false;
    if (parentId === draggedFolder.id) return false;
    if ((draggedFolder.parentId || null) === parentId) return false;
    if (parentId && isFolderDescendant(parentId, draggedFolder.id, folderMetadata.parentById)) return false;
    return true;
  }, [draggedFolder, folderMetadata.parentById, libraryId, moveFolderMutation.isPending]);

  const handleFolderMoveDragStart = React.useCallback((node: FolderNode, event: React.DragEvent<HTMLSpanElement>) => {
    const payload: DraggedFolderState = {
      id: node.id,
      name: node.name,
      parentId: folderMetadata.parentById.get(node.id) ?? null,
      libraryId,
    };
    setDraggedFolder(payload);
    setFolderHoverTargetId(null);
    folderExternalDragAndDrop?.onDragStart(payload);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-kanap-folder', JSON.stringify(payload));
    event.dataTransfer.setData('text/plain', node.name);
  }, [folderExternalDragAndDrop, folderMetadata.parentById, libraryId]);

  const clearDraggedFolderState = React.useCallback(() => {
    setDraggedFolder(null);
    setFolderHoverTargetId(null);
    folderExternalDragAndDrop?.onDragEnd();
  }, [folderExternalDragAndDrop]);

  const handleFolderMoveDragOver = React.useCallback((parentId: string | null, event: React.DragEvent<HTMLDivElement>) => {
    if (!canDropDraggedFolderOnParent(parentId)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setFolderHoverTargetId(parentId ?? ROOT_FOLDER_DROP_TARGET);
  }, [canDropDraggedFolderOnParent]);

  const handleFolderMoveDrop = React.useCallback((parentId: string | null, event: React.DragEvent<HTMLDivElement>) => {
    if (!draggedFolder || !canDropDraggedFolderOnParent(parentId)) return;
    event.preventDefault();
    setFolderHoverTargetId(null);
    moveFolderMutation.mutate({
      id: draggedFolder.id,
      parentId,
    });
  }, [canDropDraggedFolderOnParent, draggedFolder, moveFolderMutation]);

  const canDropDocumentsOnRoot = !!documentDragAndDrop?.active && documentDragAndDrop.canDropOnFolder(null);
  const isRootDocumentDropTarget = canDropDocumentsOnRoot && documentDragAndDrop?.hoverFolderId === ROOT_FOLDER_DROP_TARGET;
  const isRootFolderDropTarget = folderHoverTargetId === ROOT_FOLDER_DROP_TARGET && canDropDraggedFolderOnParent(null);
  const isRootDropTarget = isRootFolderDropTarget || isRootDocumentDropTarget;
  const deleteFolderName = deleteFolderId
    ? flatFolders.find((folder) => folder.id === deleteFolderId)?.name || ''
    : '';

  return (
    <Box
      sx={{
        width: 240,
        minWidth: 240,
        alignSelf: 'flex-start',
        overflow: 'auto',
        maxHeight: 'calc(100vh - 180px)',
        border: 1,
        borderColor: 'kanap.border.default',
        borderRadius: '8px',
        bgcolor: 'kanap.bg.primary',
      }}
    >
      <Box sx={{ p: 1.5 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('folderTree.title')}</Typography>
        {treeError && (
          <Alert severity="error" sx={{ mb: 1 }} onClose={() => setTreeError(null)}>{treeError}</Alert>
        )}

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            py: 0.5,
            px: 0.5,
            borderRadius: 1,
            cursor: 'pointer',
            border: '1px solid',
            borderColor: isRootDropTarget ? 'primary.main' : 'transparent',
            bgcolor: isRootDropTarget ? 'action.focus' : (selectedFolderId === null ? 'action.selected' : 'transparent'),
            '&:hover': { bgcolor: selectedFolderId === null ? 'action.selected' : 'action.hover' },
            mb: 0.5,
          }}
          onClick={() => onSelectFolder(null)}
          onDragOver={(event) => {
            if (canDropDraggedFolderOnParent(null)) {
              handleFolderMoveDragOver(null, event);
              return;
            }
            if (!documentDragAndDrop || !canDropDocumentsOnRoot) return;
            documentDragAndDrop.onFolderDragOver(null, event);
          }}
          onDrop={(event) => {
            if (draggedFolder && canDropDraggedFolderOnParent(null)) {
              handleFolderMoveDrop(null, event);
              return;
            }
            if (!documentDragAndDrop || !canDropDocumentsOnRoot) return;
            documentDragAndDrop.onFolderDrop(null, event);
          }}
        >
          <Box sx={{ width: 16, mr: 0.25 }} />
          <FolderOpenIcon sx={{ fontSize: 18, mr: 0.75, color: 'text.secondary' }} />
          <Typography variant="body2" sx={{ flex: 1, fontWeight: selectedFolderId === null ? 500 : 400 }}>
            {t('folderTree.libraryRoot')}
          </Typography>
          {canManage && (
            <>
              <IconButton
                size="small"
                aria-label={t('folderTree.aria.rootActions')}
                onClick={(e) => {
                  e.stopPropagation();
                  setRootMenuAnchorEl(e.currentTarget);
                }}
              >
                <MoreHorizIcon sx={{ fontSize: 16 }} />
              </IconButton>
              <Menu
                anchorEl={rootMenuAnchorEl}
                open={!!rootMenuAnchorEl}
                onClose={() => setRootMenuAnchorEl(null)}
                onClick={(e) => e.stopPropagation()}
              >
                <MenuItem onClick={() => { setRootMenuAnchorEl(null); openCreateDialog(null); }}>
                  {t('folderTree.actions.newTopLevelFolder')}
                </MenuItem>
              </Menu>
            </>
          )}
        </Box>

        {folderItems.map((node) => (
          <FolderTreeNode
            key={node.id}
            node={node}
            depth={0}
            selectedFolderId={selectedFolderId}
            onSelectFolder={onSelectFolder}
            expandedIds={expandedIds}
            onToggle={onToggle}
            canManage={canManage}
            onRename={handleRename}
            onDelete={handleDelete}
            onCreateChild={(parentId) => openCreateDialog(parentId)}
            folderDragAndDrop={canManage ? {
              active: !!draggedFolder,
              hoverTargetId: folderHoverTargetId,
              onDragStart: handleFolderMoveDragStart,
              onDragEnd: clearDraggedFolderState,
              canDropOnFolder: canDropDraggedFolderOnParent,
              onFolderDragOver: (folderId, event) => handleFolderMoveDragOver(folderId, event),
              onFolderDrop: (folderId, event) => handleFolderMoveDrop(folderId, event),
              movePending: moveFolderMutation.isPending,
            } : undefined}
            documentDragAndDrop={documentDragAndDrop}
          />
        ))}
      </Box>

      <KanapDialog
        open={folderDialogOpen}
        onClose={() => setFolderDialogOpen(false)}
        title={newFolderParentId ? t('folderTree.dialogs.createSubfolderTitle') : t('folderTree.dialogs.createFolderTitle')}
        onSave={() => createFolderMutation.mutate({
          name: newFolderName.trim(),
          parentId: newFolderParentId || null,
        })}
        saveLabel={t('common:buttons.create')}
        saveDisabled={!newFolderName.trim() || createFolderMutation.isPending}
        saveLoading={createFolderMutation.isPending}
      >
        <Stack spacing={1.5}>
          <PropertyRow label={t('folderTree.fields.folderName')} required>
            <TextField
              variant="standard"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder={t('folderTree.fields.folderName')}
              fullWidth
            />
          </PropertyRow>
          <PropertyRow label={t('folderTree.fields.parentFolder')}>
            <TextField
              select
              variant="standard"
              value={newFolderParentId}
              onChange={(e) => setNewFolderParentId(e.target.value)}
              fullWidth
              sx={drawerSelectSx}
            >
              <MenuItem value="" sx={drawerMenuItemSx}>{t('folderTree.values.root')}</MenuItem>
              {flatFolders.map((folder) => (
                <MenuItem key={folder.id} value={folder.id} sx={drawerMenuItemSx}>
                  {`${'  '.repeat(folder.depth)}${folder.name}`}
                </MenuItem>
              ))}
            </TextField>
          </PropertyRow>
        </Stack>
      </KanapDialog>

      <KanapDialog
        open={!!deleteFolderId}
        onClose={() => setDeleteFolderId(null)}
        title={t('common:delete.recordTitle', { name: deleteFolderName })}
        onSave={() => {
          if (!deleteFolderId) return;
          deleteFolderMutation.mutate(deleteFolderId);
          setDeleteFolderId(null);
        }}
        saveLabel={t('common:buttons.delete')}
        saveVariant="action-danger"
        saveDisabled={!deleteFolderId || deleteFolderMutation.isPending}
        saveLoading={deleteFolderMutation.isPending}
      >
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            {t('folderTree.confirmations.deleteFolder', { name: deleteFolderName })}
          </Typography>
        </Stack>
      </KanapDialog>
    </Box>
  );
});

export default FolderTreePanel;
