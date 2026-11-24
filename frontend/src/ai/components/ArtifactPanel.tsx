import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import KeyboardArrowLeftIcon from '@mui/icons-material/KeyboardArrowLeft';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import CloseIcon from '@mui/icons-material/CloseRounded';
import { useTranslation } from 'react-i18next';
import { AiMutationPreview } from '../aiTypes';
import { isApprovable, isRejectable } from '../previewApproval';
import { usePreviewBusy } from '../usePreviewBusy';
import { getPreviewLabel } from '../utils/previewClassification';
import { getPreviewStatusColorKey, getPreviewStatusDisplay } from '../utils/previewStatus';
import { getDotColor } from '../../utils/statusColors';
import PreviewCard from './PreviewCard';
import PanelResizeHandle, { clampPanelWidth, useStoredPanelWidth } from '../../components/workspace/PanelResizeHandle';

const DEFAULT_PANEL_WIDTH = 480;
const MIN_PANEL_WIDTH = 320;
const TAB_WIDTH = 28;
const TAB_HEIGHT = 132;
const BULK_APPROVAL_MIN = 2;
const WIDTH_STORAGE_KEY = 'kanap.ai.artifactPanelWidth';

/** At most 70% of the window, so the chat thread always keeps a usable column. */
function maxPanelWidth(): number {
  return Math.max(MIN_PANEL_WIDTH, Math.floor(window.innerWidth * 0.7));
}

type ArtifactPanelProps = {
  previews: AiMutationPreview[];
  selectedId: string | null;
  open: boolean;
  disabled?: boolean;
  onToggle: () => void;
  onSelect: (previewId: string) => void;
  onApprove: (previewId: string) => void;
  onReject: (previewId: string) => void;
  onApproveMany: (previewIds: string[]) => void;
  /** Reject all: every pending card at once, with no confirmation (nothing is written). */
  onRejectMany: (previewIds: string[]) => void;
  /** A choice on an import card made a new card, which takes the place of the previous one. */
  onReplace?: (previous: AiMutationPreview, next: AiMutationPreview) => void;
};

function ArtifactTab({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <Box sx={{ position: 'relative', width: 0, flexShrink: 0 }}>
      <Box
        component="button"
        type="button"
        onClick={onToggle}
        aria-label={label}
        sx={(theme) => ({
          position: 'absolute',
          top: 20,
          right: 0,
          width: TAB_WIDTH,
          height: TAB_HEIGHT,
          borderTopLeftRadius: 8,
          borderBottomLeftRadius: 8,
          border: `1px solid ${theme.palette.kanap.tab.border}`,
          borderRight: 'none',
          bgcolor: open ? theme.palette.kanap.tab.bgActive : theme.palette.kanap.tab.bg,
          color: open ? theme.palette.kanap.tab.fgActive : theme.palette.kanap.tab.fg,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 0.5,
          padding: 0,
          fontFamily: theme.typography.fontFamily,
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: 0.4,
          zIndex: 2,
          transition: 'background-color 120ms ease, color 120ms ease',
          '&:focus-visible': {
            outline: 'none',
            boxShadow: `0 0 0 2px ${theme.palette.primary.main}`,
          },
        })}
      >
        {open ? (
          <KeyboardArrowRightIcon sx={{ fontSize: 16 }} />
        ) : (
          <KeyboardArrowLeftIcon sx={{ fontSize: 16 }} />
        )}
        <Box
          component="span"
          sx={{
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
            textTransform: 'none',
            fontWeight: 500,
          }}
        >
          {label}
        </Box>
      </Box>
    </Box>
  );
}

function ArtifactTabBar({
  previews,
  selectedId,
  onSelect,
}: {
  previews: AiMutationPreview[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const mode = useTheme().palette.mode;
  if (previews.length <= 1) return null;
  return (
    <Stack
      direction="row"
      spacing={0}
      sx={(theme) => ({
        borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
        overflowX: 'auto',
        flexShrink: 0,
      })}
    >
      {previews.map((preview) => {
        const active = preview.preview_id === selectedId;
        const statusDisplay = getPreviewStatusDisplay(preview);
        const colorKey = getPreviewStatusColorKey(statusDisplay);
        return (
          <Box
            key={preview.preview_id}
            component="button"
            type="button"
            onClick={() => onSelect(preview.preview_id)}
            sx={(theme) => ({
              border: 'none',
              bgcolor: 'transparent',
              cursor: 'pointer',
              fontFamily: theme.typography.fontFamily,
              fontSize: 12,
              fontWeight: active ? 500 : 400,
              color: active ? theme.palette.kanap.text.primary : theme.palette.kanap.text.secondary,
              px: 1.25,
              py: 1,
              borderBottom: `2px solid ${active ? theme.palette.primary.main : 'transparent'}`,
              whiteSpace: 'nowrap',
              maxWidth: 180,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              transition: 'color 120ms ease, border-color 120ms ease',
              '&:hover': { color: theme.palette.kanap.text.primary },
              '&:focus-visible': {
                outline: 'none',
                boxShadow: `inset 0 0 0 2px ${theme.palette.primary.main}`,
              },
            })}
          >
            <Stack direction="row" spacing={0.75} alignItems="center" component="span" sx={{ minWidth: 0 }}>
              <Box
                component="span"
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  bgcolor: getDotColor(colorKey, mode),
                  flexShrink: 0,
                }}
              />
              <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {getPreviewLabel(preview)}
              </Box>
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
}

export default function ArtifactPanel({
  previews,
  selectedId,
  open,
  disabled,
  onToggle,
  onSelect,
  onApprove,
  onReject,
  onApproveMany,
  onRejectMany,
  onReplace,
}: ArtifactPanelProps) {
  const { t } = useTranslation(['ai']);
  const [preferredWidth, setPreferredWidth] = useStoredPanelWidth(WIDTH_STORAGE_KEY, DEFAULT_PANEL_WIDTH);
  const [maxWidth, setMaxWidth] = useState(maxPanelWidth);
  const width = clampPanelWidth(preferredWidth, MIN_PANEL_WIDTH, maxWidth);
  const [confirmBulkOpen, setConfirmBulkOpen] = useState(false);
  const { onBusy, anyBusy } = usePreviewBusy();

  // The bound follows the window; the width the person gave comes back when there is room again.
  useEffect(() => {
    const handler = () => setMaxWidth(maxPanelWidth());
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const handleResize = useCallback((next: number) => {
    setPreferredWidth(clampPanelWidth(next, MIN_PANEL_WIDTH, maxWidth));
  }, [maxWidth, setPreferredWidth]);
  const handleResetWidth = useCallback(() => setPreferredWidth(DEFAULT_PANEL_WIDTH), [setPreferredWidth]);

  const approvablePreviews = previews.filter(isApprovable);
  // A card whose choices are being counted is about to be replaced: "Approve all" waits for it.
  const counting = anyBusy(approvablePreviews);
  const rejectablePreviews = previews.filter(isRejectable);
  const showBulkApproval = approvablePreviews.length >= BULK_APPROVAL_MIN;
  const visibleConfirmPreviews = approvablePreviews.slice(0, 6);
  const remainingConfirmCount = Math.max(0, approvablePreviews.length - visibleConfirmPreviews.length);

  const handleApproveAll = useCallback(() => {
    setConfirmBulkOpen(false);
    onApproveMany(approvablePreviews.map((preview) => preview.preview_id));
  }, [onApproveMany, approvablePreviews]);

  if (previews.length === 0) return null;

  const tabLabel = t('artifactPanel.tab');
  const selected = previews.find((p) => p.preview_id === selectedId) || previews[previews.length - 1];

  return (
    <Box sx={{ display: 'flex', flexShrink: 0, height: '100%' }}>
      <ArtifactTab open={open} onToggle={onToggle} label={tabLabel} />

      {open && (
        <Box
          // Inline: a drag gives a new width on each frame, which must not each make a style rule.
          style={{ width }}
          sx={(theme) => ({
            minWidth: MIN_PANEL_WIDTH,
            display: 'flex',
            flexDirection: 'column',
            bgcolor: theme.palette.kanap.bg.drawer,
            borderLeft: `1px solid ${theme.palette.kanap.border.default}`,
            height: '100%',
            position: 'relative',
            zIndex: 1,
          })}
        >
          <PanelResizeHandle
            ariaLabel={t('artifactPanel.resize')}
            width={width}
            min={MIN_PANEL_WIDTH}
            max={maxWidth}
            onResize={handleResize}
            onReset={handleResetWidth}
            sx={{ zIndex: 3 }}
          />

          <Stack
            direction="row"
            alignItems="center"
            sx={(theme) => ({
              height: 36,
              px: 1.5,
              borderBottom: `1px solid ${theme.palette.kanap.border.soft}`,
              flexShrink: 0,
            })}
          >
            <Typography
              component="span"
              sx={{
                fontSize: 12,
                fontWeight: 500,
                color: 'kanap.text.secondary',
                letterSpacing: 0.2,
                flex: 1,
              }}
            >
              {t('artifactPanel.title')}
            </Typography>
            <Typography
              component="span"
              sx={{
                fontSize: 11,
                fontWeight: 500,
                color: 'kanap.text.tertiary',
                whiteSpace: 'nowrap',
                mr: 1,
              }}
            >
              {t('previewBatch.title', { count: previews.length })}
            </Typography>
            <IconButton
              size="small"
              aria-label={t('artifactPanel.close')}
              onClick={onToggle}
              sx={{ color: 'kanap.text.tertiary', width: 24, height: 24 }}
            >
              <CloseIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Stack>

          <ArtifactTabBar previews={previews} selectedId={selected.preview_id} onSelect={onSelect} />

          <Box
            sx={{
              flex: 1,
              overflow: 'auto',
              p: 1.5,
              minHeight: 0,
            }}
          >
            {showBulkApproval && (
              <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mb: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  color="inherit"
                  disabled={disabled || counting}
                  onClick={() => setConfirmBulkOpen(true)}
                  sx={{ textTransform: 'none', fontSize: 12 }}
                >
                  {t('previewBatch.approveAll')}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="inherit"
                  disabled={disabled}
                  onClick={() => onRejectMany(rejectablePreviews.map((preview) => preview.preview_id))}
                  sx={{ textTransform: 'none', fontSize: 12 }}
                >
                  {t('previewBatch.rejectAll')}
                </Button>
              </Stack>
            )}
            <PreviewCard
              preview={selected}
              disabled={disabled}
              onApprove={onApprove}
              onReject={onReject}
              onReplace={onReplace}
              onBusy={onBusy}
              stickyActions
            />
          </Box>

          <Dialog
            open={confirmBulkOpen}
            onClose={() => setConfirmBulkOpen(false)}
            maxWidth="xs"
            fullWidth
          >
            <DialogTitle sx={{ fontSize: 14, fontWeight: 500, color: 'kanap.text.primary' }}>
              {t('previewBatch.confirmTitle', { count: approvablePreviews.length })}
            </DialogTitle>
            <DialogContent>
              <Stack spacing={1}>
                <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary', lineHeight: 1.5 }}>
                  {t('previewBatch.confirmBody', { count: approvablePreviews.length })}
                </Typography>
                <Stack spacing={0.5}>
                  {visibleConfirmPreviews.map((preview) => (
                    <Typography
                      key={preview.preview_id}
                      sx={{
                        fontSize: 12,
                        color: 'kanap.text.secondary',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {getPreviewLabel(preview)}
                    </Typography>
                  ))}
                  {remainingConfirmCount > 0 && (
                    <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
                      {t('previewBatch.more', { count: remainingConfirmCount })}
                    </Typography>
                  )}
                </Stack>
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
              <Button
                variant="action"
                onClick={() => setConfirmBulkOpen(false)}
              >
                {t('messageList.cancel')}
              </Button>
              <Button
                variant="action-primary"
                onClick={handleApproveAll}
                disabled={disabled || counting || approvablePreviews.length === 0}
              >
                {t('previewBatch.approveAll')}
              </Button>
            </DialogActions>
          </Dialog>
        </Box>
      )}
    </Box>
  );
}
