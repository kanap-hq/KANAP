import React from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { fieldResetSx } from '../theme/formSx';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import api from '../api';
import { narrowToText, useLookupSearch } from '../hooks/useLookupPicker';
import LookupListPaper, { type LookupListPaperProps } from './fields/LookupListPaper';
import { formatUserOption, USERS_LOOKUP_ENDPOINT, type UserOption } from './fields/userLookup';
import { useTranslation } from 'react-i18next';
import { MONO_FONT_FAMILY } from '../config/ThemeContext';
import { formatItemRef } from '../utils/item-ref';

export type ShareItemType = 'task' | 'project' | 'request' | 'opex' | 'capex' | 'asset' | 'application' | 'location' | 'connection' | 'interface' | 'document';

/** A person as the user lookup returns it (the email only for a person without a name). */
type User = UserOption;

/** A selected recipient: either a database user or a raw email address. */
type RecipientValue = User | string;

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  itemType: ShareItemType;
  itemId: string;
  itemName: string;
  itemNumber?: number | null;
  itemRef?: string | null;
}

function buildItemPath(itemType: ShareItemType, itemId: string): string {
  switch (itemType) {
    case 'task':
      return `/portfolio/tasks/${itemId}`;
    case 'project':
      return `/portfolio/projects/${itemId}`;
    case 'request':
      return `/portfolio/requests/${itemId}`;
    case 'opex':
      return `/ops/opex/${itemId}`;
    case 'capex':
      return `/ops/capex/${itemId}`;
    case 'asset':
      return `/it/assets/${itemId}/overview`;
    case 'application':
      return `/it/applications/${itemId}/overview`;
    case 'location':
      return `/it/locations/${itemId}/overview`;
    case 'connection':
      return `/it/connections/${itemId}/overview`;
    case 'interface':
      return `/it/interfaces/${itemId}/overview`;
    case 'document':
      return `/knowledge/${itemId}`;
  }
}

function buildApiEndpoint(itemType: ShareItemType, itemId: string): string {
  switch (itemType) {
    case 'task':
      return `/tasks/${itemId}/share`;
    case 'project':
      return `/portfolio/projects/${itemId}/share`;
    case 'request':
      return `/portfolio/requests/${itemId}/share`;
    case 'opex':
      return `/spend-items/${itemId}/share`;
    case 'capex':
      return `/capex-items/${itemId}/share`;
    case 'asset':
      return `/assets/${itemId}/share`;
    case 'application':
      return `/applications/${itemId}/share`;
    case 'location':
      return `/locations/${itemId}/share`;
    case 'connection':
      return `/connections/${itemId}/share`;
    case 'interface':
      return `/interfaces/${itemId}/share`;
    case 'document':
      return `/knowledge/${itemId}/share`;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fieldLabelSx = { fontSize: 12, color: 'kanap.text.tertiary', lineHeight: 1.3, mb: 0.5 } as const;

export default function ShareDialog({
  open,
  onClose,
  itemType,
  itemId,
  itemName,
  itemNumber,
  itemRef,
}: ShareDialogProps) {
  const { t } = useTranslation('common');
  const [recipients, setRecipients] = React.useState<RecipientValue[]>([]);
  const [inputValue, setInputValue] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const displayRef = itemRef || (itemNumber ? formatItemRef(itemType, itemNumber) : null);
  const refOrId = displayRef || itemId;
  const itemUrl = `${window.location.origin}${buildItemPath(itemType, refOrId)}`;

  // People searched as the user types, once the recipients list opens in an open dialog (names only).
  // The field is never disabled while a search runs: a disabled field loses the focus, the list
  // closes and the text typed is lost.
  const [listOpen, setListOpen] = React.useState(false);
  const search = useLookupSearch<User>({ endpoint: USERS_LOOKUP_ENDPOINT, open: open && listOpen, text: inputValue });
  const isLoading = listOpen && search.isFetching;
  const listPaperProps = React.useMemo(
    () => ({ moreResults: listOpen && search.hasMore }) as LookupListPaperProps,
    [listOpen, search.hasMore],
  );

  React.useEffect(() => {
    if (open) {
      setRecipients([]);
      setInputValue('');
      setMessage('');
      setError(null);
      setSending(false);
      setCopied(false);
    }
  }, [open]);

  const handleSend = async () => {
    if (recipients.length === 0) return;
    setSending(true);
    setError(null);
    try {
      const userIds = recipients.filter((r): r is User => typeof r !== 'string').map((u) => u.id);
      const emails = recipients.filter((r): r is string => typeof r === 'string');
      await api.post(buildApiEndpoint(itemType, itemId), {
        recipient_user_ids: userIds.length > 0 ? userIds : undefined,
        recipient_emails: emails.length > 0 ? emails : undefined,
        message: message.trim() || undefined,
      });
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || t('messages.failedToSend'));
    } finally {
      setSending(false);
    }
  };

  const markCopied = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(itemUrl);
      markCopied();
    } catch {
      // navigator.clipboard requires a secure context; fall back for plain-http deployments
      const textarea = document.createElement('textarea');
      textarea.value = itemUrl;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        if (document.execCommand('copy')) markCopied();
      } finally {
        document.body.removeChild(textarea);
      }
    }
  };

  return (
    <Dialog open={open} onClose={sending ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle component="div" sx={{ pb: 1 }}>
        <Typography sx={{ fontSize: 16, fontWeight: 500, lineHeight: 1.3 }}>
          {t('share.sendLink')}
        </Typography>
        <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mt: 0.25, minWidth: 0 }}>
          {displayRef && (
            <Typography sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: 11, color: 'kanap.text.tertiary', flexShrink: 0 }}>
              {displayRef}
            </Typography>
          )}
          <Typography noWrap sx={{ fontSize: 12, color: 'kanap.text.secondary' }}>
            {itemName}
          </Typography>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Box
            sx={{
              bgcolor: 'kanap.bg.composer',
              border: '1px solid',
              borderColor: 'kanap.border.default',
              borderRadius: '8px',
              p: '12px 14px',
            }}
          >
            <Typography sx={{ ...fieldLabelSx, mb: 0.75 }}>{t('labels.link')}</Typography>
            <Stack direction="row" alignItems="center" spacing={1.25}>
              <Typography
                noWrap
                sx={{ flex: 1, minWidth: 0, fontFamily: MONO_FONT_FAMILY, fontSize: 12, color: 'kanap.text.primary' }}
              >
                {itemUrl}
              </Typography>
              <Button
                variant="action"
                onClick={handleCopy}
                startIcon={<ContentCopyIcon sx={{ fontSize: '13px !important' }} />}
              >
                {t('share.copy')}
              </Button>
            </Stack>
            {copied && (
              <Typography sx={{ fontSize: 11, color: 'success.main', mt: 0.75 }}>
                ✓ {t('share.copiedToClipboard')}
              </Typography>
            )}
          </Box>

          <Divider sx={{ borderColor: 'kanap.border.soft' }} />

          <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary' }}>
            {t('share.orEmailSection')}
          </Typography>

          <Box>
            <Typography sx={fieldLabelSx}>{t('labels.recipients')}</Typography>
              <Autocomplete<RecipientValue, true, false, true>
              multiple
              freeSolo
              options={search.items}
              value={recipients}
              open={listOpen}
              onOpen={() => setListOpen(true)}
              onClose={() => setListOpen(false)}
              inputValue={inputValue}
              onInputChange={(_, value, reason) => {
                if (reason !== 'reset') setInputValue(value);
              }}
              onChange={(_, newValue) => {
                setRecipients(newValue);
                setInputValue('');
              }}
              getOptionLabel={(option) =>
                typeof option === 'string' ? option : formatUserOption(option)
              }
              // The server matched the names; while the next page loads, the rows shown keep only
              // the names that still match the text typed (no stale person picked by Enter).
              filterOptions={(options) => narrowToText(options, search.pendingText, (option) => (
                typeof option === 'string' ? option : formatUserOption(option)
              ))}
              PaperComponent={LookupListPaper as React.JSXElementConstructor<React.HTMLAttributes<HTMLElement>>}
              slotProps={{ paper: listPaperProps }}
              isOptionEqualToValue={(option, value) => {
                if (typeof option === 'string' || typeof value === 'string') {
                  return option === value;
                }
                return option.id === value.id;
              }}
              renderOption={(props, option) => {
                if (typeof option === 'string') return <li {...props}>{option}</li>;
                return (
                  <li {...props} key={option.id}>
                    {formatUserOption(option)}
                  </li>
                );
              }}
              renderTags={(tagValue, getTagProps) =>
                tagValue.map((item, index) => {
                  const label = typeof item === 'string' ? item : formatUserOption(item);
                  const key = typeof item === 'string' ? item : item.id;
                  return (
                    <Chip {...getTagProps({ index })} key={key} label={label} size="small" />
                  );
                })
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  size="small"
                  placeholder={t('share.searchUsersOrEmail')}
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {isLoading ? <CircularProgress color="inherit" size={20} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
              loading={isLoading}
              noOptionsText={isLoading ? t('selects.loading') : t('share.typeEmailAddress')}
              autoHighlight
              handleHomeEndKeys
              // Only accept free-text entries that look like valid emails
              autoSelect={false}
              onBlur={() => {
                const trimmed = inputValue.trim();
                if (trimmed && EMAIL_RE.test(trimmed)) {
                  const alreadyAdded = recipients.some(
                    (r) =>
                      (typeof r === 'string' && r === trimmed) ||
                      (typeof r !== 'string' && r.email === trimmed),
                  );
                  if (!alreadyAdded) {
                    setRecipients((prev) => [...prev, trimmed]);
                  }
                }
                setInputValue('');
              }}
              fullWidth
            />
          </Box>

          <Box>
            <Typography sx={fieldLabelSx}>{t('share.messageOptional')}</Typography>
            <Box
              sx={{
                bgcolor: 'kanap.bg.composer',
                border: '1px solid',
                borderColor: 'kanap.border.default',
                borderRadius: '8px',
                p: '8px 12px',
                '&:focus-within': { borderColor: 'primary.main' },
              }}
            >
              <TextField
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                multiline
                rows={3}
                placeholder={t('share.addPersonalMessage')}
                fullWidth
                sx={fieldResetSx}
              />
            </Box>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="action" onClick={onClose} disabled={sending}>
          {t('buttons.close')}
        </Button>
        <Button
          variant="action-primary"
          onClick={handleSend}
          disabled={sending || recipients.length === 0}
        >
          {sending ? t('status.sending') : t('share.sendEmail')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
