import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SaveIcon from '@mui/icons-material/Save';
import api from '../api';
import { importDocument as importMarkdownDocument, type ImportDocumentResult } from '../api/endpoints/import';
import { useAuth } from '../auth/AuthContext';
import { useTenant } from '../tenant/TenantContext';
import { buildInlineImageUrl, resolveInlineImageTenantSlug } from '../utils/inlineImageUrls';
import { useTranslation } from 'react-i18next';
import ExportButton from './ExportButton';
import ImportButton from './ImportButton';
import { MarkdownContent } from './MarkdownContent';
import { normalizeMarkdownForRichTextEditor } from '../lib/markdownEditorNormalization';
import type { AutosaveStatus } from '../hooks/useAutosave';

const MarkdownEditor = React.lazy(() => import('./MarkdownEditor'));

type SourceEntityType = 'requests' | 'projects' | 'interfaces' | 'applications' | 'incidents';
type SlotKey = 'purpose' | 'risks_mitigations' | 'specification' | 'overview' | 'review';

/** Same vocabulary as the debounced field autosave, so a host screen can show one hint. */
export type IntegratedDocumentSaveStatus = AutosaveStatus;

type EditLockInfo = {
  holder_user_id: string;
  holder_name: string;
  acquired_at?: string | null;
  heartbeat_at?: string | null;
  expires_at?: string | null;
};

type IntegratedDocumentDetails = {
  id: string;
  item_number: number | null;
  item_ref?: string | null;
  content_markdown: string;
  revision: number;
  edit_lock?: EditLockInfo | null;
};

export type IntegratedDocumentEditorHandle = {
  isDirty: () => boolean;
  /**
   * Drains the pending work: an autosave already in flight is awaited first,
   * then the current draft is saved when it is still dirty. Returns false when
   * anything failed, so the caller can abort its transition and keep the draft.
   */
  save: () => Promise<boolean>;
  reset: () => Promise<void>;
};

type IntegratedDocumentEditorProps = {
  entityType: SourceEntityType;
  entityId?: string | null;
  slotKey: SlotKey;
  collapsed?: boolean;
  collapsible?: boolean;
  headerTitle?: React.ReactNode;
  label: string;
  hideHeaderLabel?: boolean;
  onToggleCollapsed?: () => void;
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
  disabled?: boolean;
  showManagedDocChip?: boolean;
  draftValue?: string;
  onDraftChange?: (value: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  editModeBehavior?: 'explicit' | 'auto';
  showDocumentControls?: boolean;
  autosaveEnabled?: boolean;
  autosaveDelayMs?: number;
  surface?: boolean;
  hideToolbarUntilFocus?: boolean;
  /**
   * Opt-in: reports the save state so a host screen can render its own
   * "Saving… / Saved" hint next to a section label (used when the document
   * controls are hidden).
   */
  onSaveStateChange?: (status: IntegratedDocumentSaveStatus, error: string | null) => void;
};

const ENTITY_ENDPOINTS: Record<SourceEntityType, string> = {
  requests: '/portfolio/requests',
  projects: '/portfolio/projects',
  interfaces: '/interfaces',
  applications: '/applications',
  incidents: '/incidents',
};

function MarkdownEditorLoadingFallback({ minRows }: { minRows: number }) {
  return (
    <Box
      sx={{
        minHeight: minRows * 24,
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <CircularProgress size={24} />
    </Box>
  );
}

export const IntegratedDocumentEditor = React.forwardRef<
  IntegratedDocumentEditorHandle,
  IntegratedDocumentEditorProps
>(function IntegratedDocumentEditor(
  {
    entityType,
    entityId,
    slotKey,
    collapsed = false,
    collapsible = false,
    headerTitle,
    label,
    hideHeaderLabel = false,
    onToggleCollapsed,
    placeholder,
    minRows = 12,
    maxRows = 24,
    disabled = false,
    showManagedDocChip = true,
    draftValue = '',
    onDraftChange,
    onDirtyChange,
    editModeBehavior = 'explicit',
    showDocumentControls = true,
    autosaveEnabled = true,
    autosaveDelayMs = 1800,
    surface = false,
    hideToolbarUntilFocus = false,
    onSaveStateChange,
  },
  ref,
) {
  const { hasLevel, profile } = useAuth();
  const { tenantSlug } = useTenant();
  const { t } = useTranslation('common');
  const qc = useQueryClient();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [form, setForm] = React.useState<{ content_markdown: string; revision: number }>({
    content_markdown: '',
    revision: 1,
  });
  const [dirty, setDirty] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [editMode, setEditMode] = React.useState(false);
  const [lockToken, setLockTokenState] = React.useState<string | null>(null);
  const [lockExpiresAt, setLockExpiresAt] = React.useState<string | null>(null);
  const [saveStatus, setSaveStatus] = React.useState<IntegratedDocumentSaveStatus>('idle');
  const [activeLockInfo, setActiveLockInfo] = React.useState<EditLockInfo | null>(null);
  const [importInteractionActive, setImportInteractionActive] = React.useState(false);
  const [contentResetNonce, setContentResetNonce] = React.useState(0);
  const [contentFocusNonce, setContentFocusNonce] = React.useState(0);
  const startEditPendingRef = React.useRef(false);

  // Mirrors read by the save pipeline: a save started from an imperative handle
  // must use the very latest draft/lock, not the values captured by the render
  // that created the callback.
  const formRef = React.useRef(form);
  formRef.current = form;
  const dirtyRef = React.useRef(dirty);
  dirtyRef.current = dirty;
  // Last content the server acknowledged. Refs settle immediately, unlike the
  // `dirty` state, so a save started right after another one completed knows
  // whether there is anything left to persist.
  const savedContentRef = React.useRef('');
  const hasUnsavedContent = React.useCallback(
    () => String(formRef.current.content_markdown || '') !== savedContentRef.current,
    [],
  );
  const lockTokenRef = React.useRef<string | null>(lockToken);
  const setLockToken = React.useCallback((next: string | null) => {
    lockTokenRef.current = next;
    setLockTokenState(next);
  }, []);
  const savedStatusTimerRef = React.useRef<number | null>(null);
  const markSaveStatus = React.useCallback((next: IntegratedDocumentSaveStatus) => {
    if (savedStatusTimerRef.current != null) {
      window.clearTimeout(savedStatusTimerRef.current);
      savedStatusTimerRef.current = null;
    }
    setSaveStatus(next);
    if (next !== 'saved') return;
    savedStatusTimerRef.current = window.setTimeout(() => {
      savedStatusTimerRef.current = null;
      setSaveStatus('idle');
    }, 1500);
  }, []);
  React.useEffect(() => () => {
    if (savedStatusTimerRef.current != null) window.clearTimeout(savedStatusTimerRef.current);
  }, []);

  const onSaveStateChangeRef = React.useRef(onSaveStateChange);
  onSaveStateChangeRef.current = onSaveStateChange;
  React.useEffect(() => {
    onSaveStateChangeRef.current?.(saveStatus, error);
  }, [error, saveStatus]);

  const isDraftMode = !entityId;
  const canEdit = !disabled;
  const canOpenKnowledge = hasLevel('knowledge', 'reader');
  const inlineImageTenantSlug = resolveInlineImageTenantSlug(tenantSlug, window.location.hostname);
  const docQueryKey = React.useMemo(
    () => ['integrated-document', entityType, entityId, slotKey],
    [entityId, entityType, slotKey],
  );
  const endpointBase = entityId ? `${ENTITY_ENDPOINTS[entityType]}/${entityId}/integrated-documents/${slotKey}` : '';

  const parseLockInfo = React.useCallback((raw: any): EditLockInfo | null => {
    if (!raw || typeof raw !== 'object') return null;
    const holderUserId = String(raw.holder_user_id || '').trim();
    const holderName = String(raw.holder_name || '').trim();
    if (!holderUserId && !holderName) return null;
    return {
      holder_user_id: holderUserId,
      holder_name: holderName || holderUserId || 'another user',
      acquired_at: raw.acquired_at || null,
      heartbeat_at: raw.heartbeat_at || null,
      expires_at: raw.expires_at || null,
    };
  }, []);

  const parseLockInfoFromError = React.useCallback(
    (e: any) => parseLockInfo(e?.response?.data?.lock),
    [parseLockInfo],
  );

  const { data: doc, error: loadError, isLoading, refetch } = useQuery({
    queryKey: docQueryKey,
    queryFn: async () => (await api.get(endpointBase)).data as IntegratedDocumentDetails,
    enabled: !isDraftMode,
  });

  React.useEffect(() => {
    if (isDraftMode || !doc || dirty || editMode) return;
    savedContentRef.current = doc.content_markdown || '';
    setForm({
      content_markdown: doc.content_markdown || '',
      revision: Number(doc.revision || 1),
    });
  }, [dirty, doc, editMode, isDraftMode]);

  React.useEffect(() => {
    if (isDraftMode || lockToken) {
      setActiveLockInfo(null);
      return;
    }
    setActiveLockInfo(parseLockInfo(doc?.edit_lock));
  }, [doc?.edit_lock, isDraftMode, lockToken, parseLockInfo]);

  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const acquireLock = React.useCallback(async () => {
    if (isDraftMode || !entityId) return null;
    if (lockToken) return lockToken;
    const res = await api.post(`${endpointBase}/locks`);
    const nextLockToken = res.data?.lock_token || null;
    setLockToken(nextLockToken);
    setLockExpiresAt(res.data?.expires_at || null);
    setActiveLockInfo(null);
    return nextLockToken;
  }, [endpointBase, entityId, isDraftMode, lockToken]);

  const releaseLock = React.useCallback(async () => {
    // Claim the token first: a second caller (the unmount cleanup after a
    // reset) finds nothing left to release.
    const heldToken = lockTokenRef.current;
    if (isDraftMode || !entityId || !heldToken) return;
    lockTokenRef.current = null;
    try {
      await api.delete(`${endpointBase}/locks`, {
        headers: { 'X-Lock-Token': heldToken },
      });
    } catch {
      // Best effort.
    }
    setLockToken(null);
    setLockExpiresAt(null);
  }, [endpointBase, entityId, isDraftMode, setLockToken]);

  const startEdit = React.useCallback(async (opts?: {
    silentConflict?: boolean;
    focusAfterStart?: boolean;
  }) => {
    if (!canEdit || isDraftMode || startEditPendingRef.current) return;
    if (editMode && lockToken) {
      if (opts?.focusAfterStart) {
        window.setTimeout(() => {
          setContentFocusNonce((prev) => prev + 1);
        }, 0);
      }
      return;
    }
    startEditPendingRef.current = true;
    try {
      setError(null);
      const nextLockToken = await acquireLock();
      if (!nextLockToken) {
        throw new Error('Unable to acquire lock');
      }
      setActiveLockInfo(null);
      setEditMode(true);
      if (opts?.focusAfterStart) {
        window.setTimeout(() => {
          setContentFocusNonce((prev) => prev + 1);
        }, 0);
      }
    } catch (e: any) {
      const status = Number(e?.response?.status || 0);
      const lockInfo = parseLockInfoFromError(e) || parseLockInfo(doc?.edit_lock);
      if (status === 423 && lockInfo) {
        setEditMode(false);
        setActiveLockInfo(lockInfo);
        if (!opts?.silentConflict) setError(null);
        return;
      }
      if (!opts?.silentConflict) {
        setError(e?.response?.data?.message || e?.message || 'Unable to acquire lock');
      }
    } finally {
      startEditPendingRef.current = false;
    }
  }, [acquireLock, canEdit, doc?.edit_lock, editMode, isDraftMode, lockToken, parseLockInfo, parseLockInfoFromError]);

  const saveMutation = useMutation({
    mutationFn: async (mode: 'manual' | 'autosave') => {
      if (isDraftMode || !entityId) {
        throw new Error('Managed document is not available until the source item is created');
      }
      const sentContent = String(formRef.current.content_markdown || '');
      const res = await api.patch(
        endpointBase,
        {
          content_markdown: normalizeMarkdownForRichTextEditor(sentContent),
          revision: formRef.current.revision,
          save_mode: mode,
        },
        {
          headers: lockTokenRef.current ? { 'X-Lock-Token': lockTokenRef.current } : undefined,
        },
      );
      return { mode, sentContent, data: res.data as IntegratedDocumentDetails };
    },
    onSuccess: async (result) => {
      setError(null);
      savedContentRef.current = result.sentContent;
      // Typing while the request was in flight must survive: the draft stays
      // dirty and the newer text is never overwritten by the server echo.
      const changedDuringSave = hasUnsavedContent();
      setDirty(changedDuringSave);
      markSaveStatus(changedDuringSave ? 'pending' : 'saved');
      qc.setQueryData(docQueryKey, result.data);
      if (result.mode === 'autosave' || changedDuringSave) {
        setForm((prev) => ({
          ...prev,
          revision: Number(result.data?.revision || prev.revision + 1),
        }));
        return;
      }
      // The editor now shows the stored (normalized) text: align the baseline so
      // the next flush does not resend an unchanged document.
      const storedContent = result.data?.content_markdown || '';
      savedContentRef.current = storedContent;
      setForm({
        content_markdown: storedContent,
        revision: Number(result.data?.revision || formRef.current.revision + 1),
      });
      await qc.invalidateQueries({ queryKey: docQueryKey });
    },
    onError: (e: any, mode: 'manual' | 'autosave') => {
      const status = Number(e?.response?.status || 0);
      const lockInfo = parseLockInfoFromError(e);
      markSaveStatus('error');
      if ((status === 410 || status === 423) && mode === 'autosave') {
        setEditMode(false);
        setLockToken(null);
        setLockExpiresAt(null);
        if (lockInfo) setActiveLockInfo(lockInfo);
        return;
      }
      if (status === 423) {
        setEditMode(false);
        setLockToken(null);
        setLockExpiresAt(null);
        setActiveLockInfo(lockInfo || parseLockInfo(doc?.edit_lock));
        setError(null);
        return;
      }
      if (status === 410) {
        setEditMode(false);
        setLockToken(null);
        setLockExpiresAt(null);
        setError(t('documentEditor.lockExpired'));
        return;
      }
      setError(e?.response?.data?.message || e?.message || t('documentEditor.failedToSave'));
    },
  });

  // Saves are strictly serialized: two overlapping PATCHes would both carry the
  // same revision, so the second one would either be rejected or silently drop
  // the first one's result.
  const saveMutationRef = React.useRef(saveMutation);
  saveMutationRef.current = saveMutation;
  const saveChainRef = React.useRef<Promise<boolean>>(Promise.resolve(true));
  const savesInFlightRef = React.useRef(0);

  const enqueueSave = React.useCallback((mode: 'manual' | 'autosave'): Promise<boolean> => {
    savesInFlightRef.current += 1;
    const run = async (): Promise<boolean> => {
      markSaveStatus('saving');
      try {
        await saveMutationRef.current.mutateAsync(mode);
        return true;
      } catch {
        // Reported through the mutation's onError (alert + status).
        return false;
      } finally {
        savesInFlightRef.current -= 1;
      }
    };
    const next = saveChainRef.current.then(run, run);
    saveChainRef.current = next;
    return next;
  }, [markSaveStatus]);

  /** Awaits every queued/in-flight save. False when any of them failed. */
  const drainSaves = React.useCallback(async (): Promise<boolean> => {
    let ok = true;
    while (savesInFlightRef.current > 0) {
      // eslint-disable-next-line no-await-in-loop
      ok = (await saveChainRef.current) && ok;
    }
    return ok;
  }, []);

  React.useEffect(() => {
    if (isDraftMode || !editMode || !lockToken) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await api.post(`${endpointBase}/locks/heartbeat`, null, {
          headers: { 'X-Lock-Token': lockToken },
        });
        setLockExpiresAt(res.data?.expires_at || null);
      } catch (e: any) {
        setEditMode(false);
        setLockToken(null);
        setLockExpiresAt(null);
        const lockInfo = parseLockInfoFromError(e);
        if (lockInfo) setActiveLockInfo(lockInfo);
      }
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [editMode, endpointBase, isDraftMode, lockToken, parseLockInfoFromError]);

  React.useEffect(() => {
    if (!autosaveEnabled) return;
    if (isDraftMode || !editMode || !dirty || !lockToken || saveMutation.isPending) return;
    const timer = window.setTimeout(() => {
      void enqueueSave('autosave');
    }, autosaveDelayMs);
    return () => window.clearTimeout(timer);
  }, [
    autosaveDelayMs,
    autosaveEnabled,
    dirty,
    editMode,
    enqueueSave,
    form.content_markdown,
    form.revision,
    isDraftMode,
    lockToken,
    saveMutation,
  ]);

  React.useEffect(() => {
    return () => {
      void releaseLock();
    };
  }, [releaseLock]);

  // The host can revoke editing under the user's feet (an incident closed in
  // another tab freezes its review). Leaving edit mode is not enough: the edit
  // lock would stay held until it expires, blocking everyone else.
  React.useEffect(() => {
    if (canEdit || isDraftMode || !editMode) return;
    setEditMode(false);
    void releaseLock();
  }, [canEdit, editMode, isDraftMode, releaseLock]);

  const save = React.useCallback(async (): Promise<boolean> => {
    if (isDraftMode) return true;
    // An autosave may already be running: the caller must wait for it even when
    // the editor no longer looks dirty.
    if (!(await drainSaves())) return false;
    if (!hasUnsavedContent()) {
      if (dirtyRef.current) setDirty(false);
      return true;
    }
    if (!lockTokenRef.current) {
      try {
        await startEdit();
      } catch {
        return false;
      }
      if (!lockTokenRef.current) return false;
    }
    return enqueueSave('manual');
  }, [drainSaves, enqueueSave, hasUnsavedContent, isDraftMode, startEdit]);

  const reset = React.useCallback(async () => {
    if (isDraftMode) return;
    const result = await refetch();
    const latest = result.data || doc;
    if (latest) {
      savedContentRef.current = latest.content_markdown || '';
      setForm({
        content_markdown: latest.content_markdown || '',
        revision: Number(latest.revision || 1),
      });
    }
    setDirty(false);
    setError(null);
    setEditMode(false);
    markSaveStatus('idle');
    await releaseLock();
  }, [doc, isDraftMode, markSaveStatus, refetch, releaseLock]);

  React.useImperativeHandle(ref, () => ({
    isDirty: () => dirtyRef.current || savesInFlightRef.current > 0,
    save,
    reset,
  }), [reset, save]);

  const discardChanges = React.useCallback(async () => {
    await reset();
  }, [reset]);

  const handleEnterEdit = React.useCallback(() => {
    if (collapsible && collapsed) {
      onToggleCollapsed?.();
    }
    void startEdit({ focusAfterStart: true });
  }, [collapsed, collapsible, onToggleCollapsed, startEdit]);

  const handleInlineImageUpload = React.useCallback(async (file: File): Promise<string> => {
    if (isDraftMode || !entityId) {
      throw new Error('Inline image upload is available after the source item is created');
    }
    if (!lockToken) {
      throw new Error('Acquire an editing lock before uploading inline images');
    }
    const formData = new FormData();
    formData.append('file', file);
    const res = await api.post<{ id: string }>(`${endpointBase}/attachments/inline`, formData, {
      headers: { 'X-Lock-Token': lockToken },
    });
    return buildInlineImageUrl(`/knowledge/inline/${inlineImageTenantSlug}/${res.data.id}`);
  }, [endpointBase, entityId, inlineImageTenantSlug, isDraftMode, lockToken]);

  const handleInlineImageImport = React.useCallback(async (sourceUrl: string): Promise<string> => {
    if (isDraftMode || !entityId) {
      throw new Error('Inline image import is available after the source item is created');
    }
    if (!lockToken) {
      throw new Error('Acquire an editing lock before importing inline images');
    }
    const res = await api.post<{ id: string }>(`${endpointBase}/attachments/inline/import`, {
      source_url: sourceUrl,
    }, {
      headers: { 'X-Lock-Token': lockToken },
    });
    return buildInlineImageUrl(`/knowledge/inline/${inlineImageTenantSlug}/${res.data.id}`);
  }, [endpointBase, entityId, inlineImageTenantSlug, isDraftMode, lockToken]);

  const handleDocumentImportError = React.useCallback((e: unknown) => {
    const status = Number((e as any)?.response?.status || 0);
    const lockInfo = parseLockInfoFromError(e) || parseLockInfo(doc?.edit_lock);
    if (status === 423) {
      setEditMode(false);
      setLockToken(null);
      setLockExpiresAt(null);
      setActiveLockInfo(lockInfo);
      setError(null);
      return;
    }
    if (status === 410) {
      setEditMode(false);
      setLockToken(null);
      setLockExpiresAt(null);
      setError('Editing lock expired. Re-enter edit mode to continue.');
      return;
    }
    setError((e as any)?.response?.data?.message || (e as any)?.message || t('documentEditor.importFailed'));
  }, [doc?.edit_lock, parseLockInfo, parseLockInfoFromError]);

  const handleDocumentImport = React.useCallback(async (file: File): Promise<ImportDocumentResult> => {
    if (isDraftMode || !entityId) {
      throw new Error('Managed document is not available until the source item is created');
    }
    if (!lockToken) {
      throw new Error('Acquire an editing lock before importing a document');
    }
    return importMarkdownDocument(`${endpointBase}/import`, file, {
      headers: { 'X-Lock-Token': lockToken },
    });
  }, [endpointBase, entityId, isDraftMode, lockToken]);

  const handleDocumentImported = React.useCallback((result: ImportDocumentResult) => {
    setError(null);
    setForm((prev) => ({ ...prev, content_markdown: result.markdown }));
    setDirty(true);
    markSaveStatus('pending');
    setContentResetNonce((prev) => prev + 1);
    window.setTimeout(() => {
      setContentFocusNonce((prev) => prev + 1);
    }, 0);
  }, [markSaveStatus]);

  const handleBlurCapture = React.useCallback(() => {
    if (showDocumentControls) return;
    if (editModeBehavior === 'auto') return;
    if (isDraftMode || !editMode || dirty || importInteractionActive) return;
    window.setTimeout(() => {
      const active = document.activeElement;
      if (containerRef.current && active instanceof Node && containerRef.current.contains(active)) {
        return;
      }
      setEditMode(false);
      void releaseLock();
    }, 0);
  }, [dirty, editMode, editModeBehavior, importInteractionActive, isDraftMode, releaseLock, showDocumentControls]);

  const lockHolderLabel = activeLockInfo?.holder_name || 'another user';
  const loadErrorMessage = React.useMemo(() => {
    if (!loadError) return null;
    return (
      (loadError as any)?.response?.data?.message
      || (loadError as any)?.message
      || t('documentEditor.failedToLoad')
    );
  }, [loadError]);
  const lockExpiryLabel = React.useMemo(() => {
    const raw = activeLockInfo?.expires_at || lockExpiresAt || null;
    if (!raw) return null;
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toLocaleString();
  }, [activeLockInfo?.expires_at, lockExpiresAt]);
  const isLockedByAnotherUser = !!activeLockInfo?.holder_user_id && activeLockInfo.holder_user_id !== profile?.id;
  const canEditContent = isDraftMode ? canEdit : (canEdit && editMode && !!lockToken && !isLockedByAnotherUser);
  const shouldStartInlineEdit = React.useCallback((target: EventTarget | null) => {
    if (editModeBehavior !== 'auto' || editMode || isDraftMode || !canEdit || isLockedByAnotherUser) {
      return false;
    }
    if (!(target instanceof HTMLElement)) return true;
    return !target.closest('button, a, input, textarea, select, [role="button"], [role="menu"], [role="dialog"], [contenteditable="true"]');
  }, [canEdit, editMode, editModeBehavior, isDraftMode, isLockedByAnotherUser]);
  const exportTitle = label.toLowerCase().replace(/\s+/g, '-');
  const deepLinkRef = doc?.item_ref || (doc?.item_number ? `DOC-${doc.item_number}` : null);
  const headerNode = headerTitle || (!hideHeaderLabel ? (
    <Typography variant="body2" color="text.secondary">
      {label}
    </Typography>
  ) : null);

  const renderHeader = React.useCallback((actions: React.ReactNode) => (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      sx={{ mb: collapsed ? 0 : (headerNode ? 0.5 : 0.25), gap: 1, flexWrap: 'nowrap' }}
    >
      <Box sx={{ minWidth: 0, flex: headerNode ? '1 1 auto' : '0 1 auto' }}>
        {headerNode}
      </Box>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" justifyContent="flex-end">
        {actions}
        {collapsible && (
          <IconButton
            size="small"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? t('documentEditor.expandDocument') : t('documentEditor.collapseDocument')}
            sx={{
              ml: 0.25,
              transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
            }}
          >
            <ExpandMoreIcon fontSize="small" />
          </IconButton>
        )}
      </Stack>
    </Stack>
  ), [collapsed, collapsible, headerNode, onToggleCollapsed]);

  if (isDraftMode) {
    const draftActions = (
      <ExportButton
        content={normalizeMarkdownForRichTextEditor(draftValue || '')}
        title={exportTitle}
        disabled={!String(draftValue || '').trim()}
      />
    );

    return (
      <Box>
        {renderHeader(draftActions)}
        {collapsible && collapsed ? null : (
          <React.Suspense fallback={<MarkdownEditorLoadingFallback minRows={minRows} />}>
            <MarkdownEditor
              value={draftValue || ''}
              onChange={(value) => onDraftChange?.(value)}
              placeholder={placeholder}
              minRows={minRows}
              maxRows={maxRows}
              disabled={disabled}
              surface={surface}
              hideToolbarUntilFocus={hideToolbarUntilFocus}
            />
          </React.Suspense>
        )}
      </Box>
    );
  }

  const persistedActions = (
    <>
      {showManagedDocChip && <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem' }}>{t('labels.managedDoc')}</Typography>}
      {showDocumentControls && !editMode && (
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'text.secondary', fontSize: '0.8125rem' }}>
          <LockOutlinedIcon sx={{ fontSize: 14 }} />
          {t('labels.readOnly')}
        </Box>
      )}
      {canOpenKnowledge && deepLinkRef && (
        <Button
          size="small"
          variant="outlined"
          href={`/knowledge/${deepLinkRef}`}
          target="_blank"
          rel="noreferrer"
          startIcon={<OpenInNewIcon fontSize="small" />}
        >
          {t('documentEditor.openFullDocument')}
        </Button>
      )}
      {showDocumentControls && !editMode && canEdit && (
        <Button
          size="small"
          variant="outlined"
          startIcon={<EditIcon fontSize="small" />}
          onClick={handleEnterEdit}
        >
          {isLockedByAnotherUser ? t('documentEditor.retryLock') : t('buttons.edit')}
        </Button>
      )}
      {showDocumentControls && editMode && canEdit && (
        <Button
          size="small"
          variant="outlined"
          onClick={() => { void discardChanges(); }}
        >
          Discard
        </Button>
      )}
      {showDocumentControls && editMode && canEdit && (
        <Button
          size="small"
          variant="contained"
          startIcon={<SaveIcon fontSize="small" />}
          disabled={!dirty || saveMutation.isPending}
          onClick={() => { void save(); }}
        >
          Save
        </Button>
      )}
      {canEditContent && (
        <ImportButton
          onImportFile={handleDocumentImport}
          onImported={handleDocumentImported}
          onError={handleDocumentImportError}
          onDialogStateChange={setImportInteractionActive}
          hasContent={!!String(form.content_markdown || '').trim()}
          size="small"
        />
      )}
      <ExportButton
        content={normalizeMarkdownForRichTextEditor(form.content_markdown || '')}
        title={deepLinkRef || exportTitle}
        disabled={!String(form.content_markdown || '').trim()}
      />
    </>
  );

  return (
    <Box
      ref={containerRef}
      onBlurCapture={handleBlurCapture}
    >
      {renderHeader(persistedActions)}

      {collapsible && collapsed ? null : (
        <>

      {!!loadErrorMessage && (
        <Alert
          severity="error"
          sx={{ mb: 1 }}
          action={(
            <Button size="small" onClick={() => { void refetch(); }}>
              {t('buttons.retry')}
            </Button>
          )}
        >
          {loadErrorMessage}
        </Alert>
      )}
      {!!error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}

      {isLockedByAnotherUser && (
        <Alert
          severity="info"
          sx={{ mb: 1 }}
          action={canEdit ? (
            <Button size="small" onClick={handleEnterEdit}>
              {t('documentEditor.retryLock')}
            </Button>
          ) : undefined}
        >
          {lockExpiryLabel
            ? t('documentEditor.lockedByUntil', { name: lockHolderLabel, expires: lockExpiryLabel })
            : t('documentEditor.lockedByReadOnly', { name: lockHolderLabel })}
        </Alert>
      )}

      {isLoading ? (
        <Box sx={{ minHeight: minRows * 24, border: 1, borderColor: 'divider', borderRadius: 1, display: 'grid', placeItems: 'center' }}>
          <CircularProgress size={24} />
        </Box>
      ) : loadErrorMessage ? (
        <Box sx={{ minHeight: minRows * 24, border: 1, borderColor: 'divider', borderRadius: 1, display: 'grid', placeItems: 'center', px: 2 }}>
          <Typography variant="body2" color="text.secondary" align="center">
            {t('documentEditor.contentUnavailable')}
          </Typography>
        </Box>
      ) : editMode ? (
        <React.Suspense fallback={<MarkdownEditorLoadingFallback minRows={minRows} />}>
          <MarkdownEditor
            key={`${entityType}:${entityId || 'draft'}:${slotKey}:${contentResetNonce}`}
            value={form.content_markdown || ''}
            onChange={(value) => {
              setForm((prev) => ({ ...prev, content_markdown: value }));
              setDirty(true);
              markSaveStatus('pending');
            }}
            placeholder={placeholder}
            minRows={minRows}
            maxRows={maxRows}
            disabled={!canEditContent}
            focusNonce={contentFocusNonce}
            refreshNonce={contentResetNonce}
            onImageUpload={canEditContent ? handleInlineImageUpload : undefined}
            onImageUrlImport={canEditContent ? handleInlineImageImport : undefined}
            surface={surface}
            hideToolbarUntilFocus={hideToolbarUntilFocus}
          />
        </React.Suspense>
      ) : (
        <Box
          onPointerDownCapture={(event) => {
            if (!shouldStartInlineEdit(event.target)) return;
            void startEdit({ silentConflict: true, focusAfterStart: true });
          }}
          onClick={editModeBehavior === 'auto' && canEdit && !isLockedByAnotherUser ? handleEnterEdit : undefined}
          onFocus={editModeBehavior === 'auto' && canEdit && !isLockedByAnotherUser ? handleEnterEdit : undefined}
          tabIndex={editModeBehavior === 'auto' && canEdit && !isLockedByAnotherUser ? 0 : undefined}
          role={editModeBehavior === 'auto' && canEdit && !isLockedByAnotherUser ? 'textbox' : undefined}
          aria-label={editModeBehavior === 'auto' && canEdit && !isLockedByAnotherUser ? label : undefined}
          sx={{
            minHeight: minRows * 24,
            maxHeight: maxRows * 24,
            overflowY: 'auto',
            overflowX: 'hidden',
            border: 1,
            borderColor: surface ? 'kanap.border.default' : 'divider',
            borderRadius: surface ? '8px' : 1,
            bgcolor: surface ? 'kanap.bg.composer' : 'background.paper',
            p: surface ? '14px 16px' : 1.5,
            cursor: editModeBehavior === 'auto' && canEdit && !isLockedByAnotherUser ? 'text' : 'default',
          }}
        >
          {String(form.content_markdown || '').trim() ? (
            <MarkdownContent content={form.content_markdown || ''} />
          ) : (
            <Typography variant="body2" color="text.secondary">
              {placeholder || t('messages.noContent')}
            </Typography>
          )}
        </Box>
      )}
        </>
      )}
    </Box>
  );
});

export default IntegratedDocumentEditor;
