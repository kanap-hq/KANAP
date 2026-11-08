import React from 'react';
import {
  Box,
  Button,
  Stack,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { AiMutationPreview } from '../aiTypes';
import { isApprovable } from '../previewApproval';
import { MarkdownContent } from '../../components/MarkdownContent';
import { getDotColor } from '../../utils/statusColors';
import { getPreviewStatusColorKey, getPreviewStatusDisplay } from '../utils/previewStatus';
import { getPreviewTitle } from '../utils/previewClassification';
import { usePreviewChangeLabels } from './previewChangeLabels';
import ImportMappingPreview from './ImportMappingPreview';
import { downloadServerExport } from '../../components/csv/serverExport';

const LINKED_MARKDOWN_IMAGE_RE = /\[\s*!\[[^\]]*]\(\s*<?[^)\s>]+>?[\s\S]*?\)\s*]\(\s*<?[^)\s>]+>?[\s\S]*?\)/g;
const MARKDOWN_IMAGE_RE = /!\[[^\]]*]\(\s*<?[^)\s>]+>?[\s\S]*?\)/g;
const HTML_IMAGE_RE = /<img\b[\s\S]*?>/gi;
const TICKET_IMPORT_TOOL_NAMES = new Set(['import_ticket', 'import_glpi_ticket']);

type PreviewCardProps = {
  preview: AiMutationPreview;
  disabled?: boolean;
  onApprove: (previewId: string) => void;
  onReject: (previewId: string) => void;
};

function hasDisplayValue(value: string | null | undefined): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : value != null;
}

function replacePendingImportImages(markdown: string, placeholder: string): string {
  const replacement = `\n\n_${placeholder}_\n\n`;
  return String(markdown || '')
    .replace(LINKED_MARKDOWN_IMAGE_RE, replacement)
    .replace(MARKDOWN_IMAGE_RE, replacement)
    .replace(HTML_IMAGE_RE, replacement);
}

function renderValue(
  preview: AiMutationPreview,
  diff: AiMutationPreview['changes'][string],
  value: string | null,
  noneLabel: string,
  pendingImagePlaceholder: string,
) {
  if (!value) {
    return (
      <Typography variant="body2" color="text.secondary">
        {noneLabel}
      </Typography>
    );
  }

  if (diff.format === 'markdown') {
    const content = preview.status === 'pending' && TICKET_IMPORT_TOOL_NAMES.has(preview.tool_name)
      ? replacePendingImportImages(value, pendingImagePlaceholder)
      : value;
    return <MarkdownContent content={content} variant="compact" externalImages="link" />;
  }

  return (
    <Typography variant="body2">
      {value}
    </Typography>
  );
}

function DiffSection({
  variant,
  label,
  children,
}: {
  variant: 'before' | 'after';
  label: string;
  children: React.ReactNode;
}) {
  const isAfter = variant === 'after';
  return (
    <Box
      sx={(theme) => ({
        position: 'relative',
        pl: 1.5,
        // 2px accent stripe on the left edge — borrowed from git/IDE diff conventions.
        // Before stays neutral (grey tertiary), After takes kanap.orange so the
        // user's eye lands on the section that requires their attention.
        borderLeft: `2px solid ${isAfter ? theme.palette.warning.main : theme.palette.kanap.text.tertiary}`,
        py: 0.25,
      })}
    >
      <Typography
        component="div"
        sx={(theme) => ({
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: 0.2,
          color: isAfter ? theme.palette.warning.main : theme.palette.kanap.text.secondary,
          mb: 0.5,
        })}
      >
        {label}
      </Typography>
      <Box
        sx={(theme) => ({
          fontSize: 13,
          lineHeight: 1.55,
          // Before reads as faded/historical, After is full-strength so it draws focus.
          color: isAfter ? theme.palette.kanap.text.primary : theme.palette.kanap.text.secondary,
        })}
      >
        {children}
      </Box>
    </Box>
  );
}

function PreviewCard({
  preview,
  disabled,
  onApprove,
  onReject,
}: PreviewCardProps) {
  const { t, i18n } = useTranslation(['ai', 'common']);
  const mode = useTheme().palette.mode;
  const isPending = preview.status === 'pending';
  // The file prepared for an import, in the import's format: downloaded whatever the card's status.
  const canDownload = !!preview.import_mapping && !!preview.conversation_id;
  const [downloading, setDownloading] = React.useState(false);
  const [downloadFailed, setDownloadFailed] = React.useState(false);
  const pendingImagePlaceholder = t('ai:previewCard.pendingInlineImage');
  const statusDisplay = getPreviewStatusDisplay(preview);
  const statusColorKey = getPreviewStatusColorKey(statusDisplay);
  const statusLabel = t(`ai:previewStatuses.${statusDisplay}`);
  const { fieldLabel, valueLabel, amountsLabel, classificationLabel, relationItemsLabel } = usePreviewChangeLabels(preview);
  // The reference shows once: the server's title often starts with it ("APP-36 - CheeseTrack").
  const title = getPreviewTitle(preview);

  return (
    <Box
      sx={(theme) => ({
        border: 1,
        borderColor: theme.palette.kanap.border.default,
        borderRadius: 2,
        p: 1.75,
        bgcolor: isPending ? theme.palette.kanap.bg.composer : theme.palette.kanap.bg.drawer,
      })}
    >
      <Stack spacing={1.5}>
        {/* Header — entity ref + title get the visual weight; preview tag and status are secondary. */}
        <Stack spacing={0.5}>
          <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap" useFlexGap>
            {preview.target.ref && (
              <Typography
                component="span"
                sx={(theme) => ({
                  fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
                  fontSize: 13,
                  fontWeight: 500,
                  color: theme.palette.kanap.text.secondary,
                })}
              >
                {preview.target.ref}
              </Typography>
            )}
            {title && (
              <Typography
                component="span"
                sx={(theme) => ({
                  fontSize: 14,
                  fontWeight: 500,
                  color: theme.palette.kanap.text.primary,
                  flex: 1,
                  minWidth: 0,
                })}
              >
                {title}
              </Typography>
            )}
            <Stack
              component="span"
              direction="row"
              spacing={0.75}
              alignItems="center"
              sx={{
                flexShrink: 0,
              }}
            >
              <Box
                component="span"
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  bgcolor: getDotColor(statusColorKey, mode),
                }}
              />
              <Typography
                component="span"
                sx={{
                  color: getDotColor(statusColorKey, mode),
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                {statusLabel}
              </Typography>
            </Stack>
          </Stack>
          <Typography
            component="span"
            sx={{
              fontSize: 11,
              fontWeight: 500,
              color: 'kanap.text.tertiary',
            }}
          >
            {t('ai:previewCard.preview')}
          </Typography>
        </Stack>

        {preview.import_mapping && <ImportMappingPreview mapping={preview.import_mapping} />}

        {Object.keys(preview.changes).length > 0 && (
        <Stack spacing={1.25}>
          {Object.entries(preview.changes).map(([field, change]) => {
            // A list value reads as on the screens, budget amounts as on the budget screens, a classification level
            // as the tenant's catalog names it; a markdown text stays as written.
            const diff = change.amounts
              ? {
                ...change,
                from: change.amounts.from ? amountsLabel(change.amounts.from) : change.from,
                to: change.amounts.to ? amountsLabel(change.amounts.to) : change.to,
              }
              : change.classification
                ? {
                  ...change,
                  from: classificationLabel(change.classification, 'from', change.from),
                  to: classificationLabel(change.classification, 'to', change.to),
                }
              : change.relation_items
                ? {
                  ...change,
                  from: relationItemsLabel(change.relation_items.from),
                  to: relationItemsLabel(change.relation_items.to),
                }
              : change.format === 'markdown'
                ? change
                : { ...change, from: valueLabel(preview, field, change.from), to: valueLabel(preview, field, change.to) };
            return (
            <Stack key={field} spacing={0.75}>
              <Typography
                component="div"
                sx={(theme) => ({
                  fontSize: 12,
                  fontWeight: 500,
                  color: theme.palette.kanap.text.secondary,
                  letterSpacing: 0.1,
                })}
              >
                {fieldLabel(preview, field, diff.label)}
              </Typography>
              {diff.format === 'markdown' ? (
                <Stack spacing={0.75}>
                  {hasDisplayValue(diff.from) && (
                    <DiffSection variant="before" label={t('ai:previewCard.before')}>
                      {renderValue(preview, diff, diff.from, t('ai:previewCard.none'), pendingImagePlaceholder)}
                    </DiffSection>
                  )}
                  {hasDisplayValue(diff.from) ? (
                    <DiffSection variant="after" label={t('ai:previewCard.after')}>
                      {renderValue(preview, diff, diff.to, t('ai:previewCard.none'), pendingImagePlaceholder)}
                    </DiffSection>
                  ) : (
                    <Box
                      sx={{
                        fontSize: 13,
                        lineHeight: 1.55,
                        color: 'kanap.text.primary',
                      }}
                    >
                      {renderValue(preview, diff, diff.to, t('ai:previewCard.none'), pendingImagePlaceholder)}
                    </Box>
                  )}
                </Stack>
              ) : (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="baseline">
                  {hasDisplayValue(diff.from) && (
                    <>
                      <Box
                        sx={(theme) => ({
                          fontSize: 13,
                          color: theme.palette.kanap.text.tertiary,
                          textDecoration: 'line-through',
                        })}
                      >
                        {renderValue(preview, diff, diff.from, t('ai:previewCard.none'), pendingImagePlaceholder)}
                      </Box>
                      <Box component="span" sx={{ color: 'kanap.text.tertiary', fontSize: 12 }}>→</Box>
                    </>
                  )}
                  <Box
                    sx={(theme) => ({
                      fontSize: 13,
                      fontWeight: 500,
                      color: theme.palette.warning.main,
                    })}
                  >
                    {renderValue(preview, diff, diff.to, t('ai:previewCard.none'), pendingImagePlaceholder)}
                  </Box>
                </Stack>
              )}
            </Stack>
            );
          })}
        </Stack>
        )}

        {/* A failure of the service reads as a sentence in the person's language, its message as the detail. */}
        {preview.error_message && preview.error_is_technical ? (
          <Stack spacing={0.25}>
            <Typography variant="caption" sx={{ fontSize: 12, color: 'error.main' }}>
              {t('ai:previewCard.notApplied')}
            </Typography>
            <Typography variant="caption" sx={{ fontSize: 11, color: 'kanap.text.tertiary', overflowWrap: 'anywhere' }}>
              {preview.error_message}
            </Typography>
          </Stack>
        ) : (
          <Typography
            variant="caption"
            sx={{
              fontSize: 12,
              color: preview.error_message ? 'error.main' : 'kanap.text.tertiary',
            }}
          >
            {preview.error_message || preview.summary}
          </Typography>
        )}

        {(isPending || canDownload) && (
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {isPending && (
              <>
                <Button
                  size="small"
                  variant="contained"
                  // An import whose check refuses the file cannot run: the card says why.
                  disabled={disabled || !isApprovable(preview)}
                  onClick={() => onApprove(preview.preview_id)}
                >
                  {t('ai:previewCard.approve')}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="inherit"
                  disabled={disabled}
                  onClick={() => onReject(preview.preview_id)}
                >
                  {t('ai:previewCard.reject')}
                </Button>
              </>
            )}
            {canDownload && (
              <Button
                size="small"
                variant="outlined"
                color="inherit"
                disabled={downloading}
                onClick={() => {
                  setDownloading(true);
                  setDownloadFailed(false);
                  downloadServerExport({
                    url: `/ai/conversations/${preview.conversation_id}/previews/${preview.preview_id}/import-file/export`,
                    format: 'xlsx',
                    language: i18n.resolvedLanguage,
                    fileBase: 'import',
                  })
                    .catch(() => setDownloadFailed(true))
                    .finally(() => setDownloading(false));
                }}
              >
                {t('ai:previewCard.importRun.download')}
              </Button>
            )}
          </Stack>
        )}
        {downloadFailed && (
          <Typography variant="caption" sx={{ fontSize: 12, color: 'error.main' }}>
            {t('common:messages.exportFailed')}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}

const MemoizedPreviewCard = React.memo(PreviewCard);
MemoizedPreviewCard.displayName = 'PreviewCard';

export default MemoizedPreviewCard;
