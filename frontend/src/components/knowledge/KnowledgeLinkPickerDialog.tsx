import React from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { fieldResetSx } from '../../theme/formSx';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { MONO_FONT_FAMILY } from '../../config/ThemeContext';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

export type KnowledgeLinkOption = {
  id: string;
  item_number: number;
  item_ref?: string;
  title: string;
  status: string;
  updated_at?: string | null;
};

type DocumentsListResponse = {
  items: KnowledgeLinkOption[];
  total: number;
  page: number;
  limit: number;
};

type KnowledgeLinkPickerDialogProps = {
  open: boolean;
  onClose: () => void;
  onLink: (document: KnowledgeLinkOption) => void;
  linkedDocumentIds?: Iterable<string>;
  linkPending?: boolean;
  title?: React.ReactNode;
};

const LINK_OPTIONS_PAGE_SIZE = 200;

export default function KnowledgeLinkPickerDialog({
  open,
  onClose,
  onLink,
  linkedDocumentIds,
  linkPending = false,
  title,
}: KnowledgeLinkPickerDialogProps) {
  const { t } = useTranslation('common');
  const [search, setSearch] = React.useState('');
  const [items, setItems] = React.useState<KnowledgeLinkOption[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const requestIdRef = React.useRef(0);
  const trimmedSearch = search.trim();

  const linkedIds = React.useMemo(() => new Set(linkedDocumentIds || []), [linkedDocumentIds]);

  const reset = React.useCallback(() => {
    setSearch('');
    setItems([]);
    setTotal(0);
    setPage(1);
    setError(null);
    setLoading(false);
    setLoadingMore(false);
    requestIdRef.current += 1;
  }, []);

  const handleClose = React.useCallback(() => {
    onClose();
    reset();
  }, [onClose, reset]);

  const loadOptions = React.useCallback(async (
    nextPage: number,
    mode: 'replace' | 'append',
    signal?: AbortSignal,
  ) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const requestedPage = Math.max(1, nextPage);

    if (mode === 'replace') {
      setLoading(true);
      setPage(1);
    } else {
      setLoadingMore(true);
    }
    setError(null);

    try {
      const res = await api.get<DocumentsListResponse>('/knowledge/link-options', {
        params: {
          page: requestedPage,
          limit: LINK_OPTIONS_PAGE_SIZE,
          ...(trimmedSearch ? { q: trimmedSearch } : {}),
        },
        signal,
      });
      if (requestId !== requestIdRef.current) return;
      setTotal(Number(res.data.total || 0));
      setPage(Number(res.data.page || requestedPage));
      setItems((current) => {
        const byId = new Map<string, KnowledgeLinkOption>();
        for (const item of mode === 'append' ? current : []) byId.set(item.id, item);
        for (const item of res.data.items || []) byId.set(item.id, item);
        return Array.from(byId.values());
      });
    } catch (err: any) {
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
      if (requestId !== requestIdRef.current) return;
      setError(getApiErrorMessage(err, t, t('knowledgePanel.failedToUpdateLinks')));
    } finally {
      if (requestId !== requestIdRef.current) return;
      if (mode === 'replace') {
        setLoading(false);
      } else {
        setLoadingMore(false);
      }
    }
  }, [t, trimmedSearch]);

  const availableDocs = React.useMemo(
    () => items.filter((item) => !linkedIds.has(item.id)),
    [items, linkedIds],
  );

  const hasMore = page * LINK_OPTIONS_PAGE_SIZE < total;
  const fetchMore = React.useCallback(() => {
    if (!hasMore || loading || loadingMore) return;
    void loadOptions(page + 1, 'append');
  }, [hasMore, loadOptions, loading, loadingMore, page]);

  React.useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void loadOptions(1, 'replace', controller.signal);
    }, trimmedSearch ? 220 : 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [loadOptions, open, reset, trimmedSearch]);

  React.useEffect(() => {
    if (!open || !hasMore || loading || loadingMore) return;
    if (availableDocs.length >= 10) return;
    void loadOptions(page + 1, 'append');
  }, [availableDocs.length, hasMore, loadOptions, loading, loadingMore, open, page]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullWidth
      maxWidth="sm"
      PaperProps={{
        sx: (theme) => ({
          borderRadius: '8px',
          border: `0.5px solid ${theme.palette.kanap.border.default}`,
          bgcolor: theme.palette.kanap.bg.primary,
          backgroundImage: 'none',
          boxShadow: 'none',
        }),
      }}
    >
      <DialogTitle sx={{ fontSize: 16, fontWeight: 500, pb: 1.5 }}>
        {title || t('knowledgePanel.linkExistingKnowledge')}
      </DialogTitle>
      <DialogContent sx={{ pt: '0 !important' }}>
        <Stack spacing={1.25}>
          <TextField
            autoFocus
            fullWidth
            size="small"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('knowledgePanel.searchByNameOrRef')}
            variant="standard"
            sx={[fieldResetSx, (theme) => ({
              px: 1,
              py: 0.75,
              borderRadius: '6px',
              bgcolor: theme.palette.kanap.bg.composer,
              '& input': { fontSize: 13, py: 0 },
            })]}
          />

          {error && (
            <Alert severity="error">{error}</Alert>
          )}

          <Box
            aria-busy={loading}
            sx={(theme) => ({
              border: `1px solid ${theme.palette.kanap.border.default}`,
              borderRadius: '6px',
              height: 360,
              overflowY: 'auto',
              position: 'relative',
            })}
          >
            {loading && availableDocs.length > 0 && (
              <LinearProgress
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 2,
                  zIndex: 1,
                }}
              />
            )}
            {availableDocs.map((document) => {
              const ref = document.item_ref || `DOC-${document.item_number}`;
              return (
                <Box
                  key={document.id}
                  sx={(theme) => ({
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1,
                    py: 0.875,
                    borderBottom: `1px solid ${theme.palette.kanap.border.soft}`,
                    '&:last-of-type': { borderBottom: 0 },
                  })}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography noWrap title={document.title} sx={{ fontSize: 13, fontWeight: 500, color: 'kanap.text.primary' }}>
                      {document.title || ref}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: 'kanap.text.secondary', fontFamily: MONO_FONT_FAMILY }}>
                      {ref}
                    </Typography>
                  </Box>
                  <Button
                    variant="action"
                    size="small"
                    onClick={() => onLink(document)}
                    disabled={linkPending || loading}
                  >
                    {t('knowledgePanel.linkExisting')}
                  </Button>
                </Box>
              );
            })}
            {loading && availableDocs.length === 0 && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                <CircularProgress size={20} />
              </Box>
            )}
            {!loading && !error && availableDocs.length === 0 && (
              <Typography sx={{ px: 1.25, py: 2, fontSize: 13, color: 'kanap.text.secondary' }}>
                {trimmedSearch ? t('knowledgePanel.noMatchingKnowledge') : t('knowledgePanel.noAvailableKnowledge')}
              </Typography>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
          {loading && availableDocs.length > 0 ? <CircularProgress size={16} /> : null}
          {total > 0 && (
            <Typography sx={{ fontSize: 12, color: 'kanap.text.secondary' }}>
              {availableDocs.length} / {total}
            </Typography>
          )}
        </Box>
        {hasMore && (
          <Button
            variant="action"
            onClick={fetchMore}
            disabled={loadingMore}
            startIcon={loadingMore ? <CircularProgress size={14} /> : undefined}
          >
            {t('buttons.loadMore')}
          </Button>
        )}
        <Button variant="action" onClick={handleClose}>
          {t('buttons.cancel')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
