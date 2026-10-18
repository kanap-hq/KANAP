import React from 'react';
import { useTranslation } from 'react-i18next';
import DeleteIcon from '@mui/icons-material/Delete';
import { Box, IconButton, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

export type RelevantWebsiteItem = {
  id?: string;
  name?: string;
  url: string;
};

type RelevantWebsitesListProps = {
  items: RelevantWebsiteItem[];
  nameHeader?: string;
  urlHeader?: string;
  emptyLabel?: string;
  deleteLabel?: string;
  canEdit?: boolean;
  canDelete?: boolean;
  onEdit?: (index: number) => void;
  onDelete?: (index: number) => void;
  sx?: SxProps<Theme>;
};

/** The address a website link opens: `https://` added to anything without `http://` or `https://`. */
export function normalizeWebsiteUrl(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

const gridColumns = 'minmax(120px, 0.85fr) minmax(160px, 1.15fr) 32px';

export default function RelevantWebsitesList({
  items,
  nameHeader: nameHeaderProp,
  urlHeader = 'URL',
  emptyLabel: emptyLabelProp,
  deleteLabel: deleteLabelProp,
  canEdit = false,
  canDelete = false,
  onEdit,
  onDelete,
  sx,
}: RelevantWebsitesListProps) {
  const { t } = useTranslation('common');
  const nameHeader = nameHeaderProp ?? t('relevantWebsites.name');
  const emptyLabel = emptyLabelProp ?? t('relevantWebsites.empty');
  const deleteLabel = deleteLabelProp ?? t('relevantWebsites.delete');
  return (
    <Box sx={sx}>
      <Box
        sx={(theme) => ({
          display: 'grid',
          gridTemplateColumns: gridColumns,
          columnGap: 1,
          alignItems: 'center',
          minHeight: 26,
          px: 1,
          borderBottom: `1px solid ${theme.palette.kanap.border.soft}`,
        })}
      >
        <Typography
          component="div"
          sx={(theme) => ({
            fontSize: 11,
            fontWeight: 500,
            lineHeight: 1.4,
            color: theme.palette.kanap.text.secondary,
          })}
        >
          {nameHeader}
        </Typography>
        <Typography
          component="div"
          sx={(theme) => ({
            fontSize: 11,
            fontWeight: 500,
            lineHeight: 1.4,
            color: theme.palette.kanap.text.secondary,
          })}
        >
          {urlHeader}
        </Typography>
        <Box aria-hidden="true" />
      </Box>

      {items.length === 0 ? (
        <Typography
          variant="body2"
          sx={(theme) => ({
            px: 1,
            py: 0.75,
            fontSize: 13,
            color: theme.palette.kanap.text.secondary,
          })}
        >
          {emptyLabel}
        </Typography>
      ) : (
        items.map((item, index) => {
          const href = normalizeWebsiteUrl(item.url);
          const name = String(item.name || '').trim() || item.url;
          return (
            <Box
              key={item.id || `${item.url}:${index}`}
              sx={(theme) => ({
                display: 'grid',
                gridTemplateColumns: gridColumns,
                columnGap: 1,
                alignItems: 'center',
                minHeight: 30,
                px: 1,
                borderBottom: `1px solid ${theme.palette.kanap.border.soft}`,
                '&:hover': { bgcolor: theme.palette.kanap.bg.hover },
              })}
            >
              <Box
                component="button"
                type="button"
                disabled={!canEdit || !onEdit}
                onClick={() => onEdit?.(index)}
                title={name}
                sx={(theme) => ({
                  all: 'unset',
                  display: 'block',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 13,
                  lineHeight: 1.4,
                  color: theme.palette.kanap.text.primary,
                  cursor: canEdit && onEdit ? 'pointer' : 'default',
                  ...(canEdit && onEdit ? {
                    '&:hover': {
                      color: theme.palette.kanap.teal,
                      textDecoration: 'underline',
                    },
                    '&:focus-visible': {
                      borderRadius: '2px',
                      outline: `2px solid ${theme.palette.kanap.teal}`,
                      outlineOffset: 2,
                    },
                  } : {}),
                })}
              >
                {name}
              </Box>
              {href ? (
                <Typography
                  component="a"
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={item.url}
                  sx={(theme) => ({
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 13,
                    lineHeight: 1.4,
                    color: theme.palette.kanap.text.primary,
                    textDecoration: 'none',
                    '&:hover': {
                      color: theme.palette.kanap.teal,
                      textDecoration: 'underline',
                    },
                    '&:focus-visible': {
                      borderRadius: '2px',
                      outline: `2px solid ${theme.palette.kanap.teal}`,
                      outlineOffset: 2,
                    },
                  })}
                >
                  {item.url}
                </Typography>
              ) : (
                <Typography
                  component="span"
                  title={item.url}
                  sx={(theme) => ({
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 13,
                    lineHeight: 1.4,
                    color: theme.palette.kanap.text.secondary,
                  })}
                >
                  {item.url}
                </Typography>
              )}
              <Box sx={{ width: 32, display: 'flex', justifyContent: 'center' }}>
                {canDelete && onDelete && (
                  <IconButton
                    size="small"
                    aria-label={deleteLabel}
                    onClick={() => onDelete(index)}
                    sx={{ width: 28, height: 28 }}
                  >
                    <DeleteIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                )}
              </Box>
            </Box>
          );
        })
      )}
    </Box>
  );
}
