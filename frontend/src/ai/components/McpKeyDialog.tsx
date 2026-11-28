import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Alert, IconButton, Stack, TextField, Tooltip } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import KanapDialog from '../../components/design/KanapDialog';
import { PropertyRow } from '../../components/design';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { drawerFieldValueSx } from '../../theme/formSx';
import { aiKeysApi } from '../aiApi';
import type { AiApiKeyRecord } from '../aiTypes';

const MONO_FONT = "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace";

/** The address of the MCP server of this workspace. */
export function mcpEndpointUrl(origin: string): string {
  return `${origin}/api/ai/mcp`;
}

/** The command that connects Claude Code to the MCP server with a key. */
export function claudeCodeCommand(endpoint: string, key: string): string {
  return `claude mcp add --transport http kanap ${endpoint} --header "Authorization: Bearer ${key}"`;
}

/** A read-only value with a button that copies it. */
export function CopyValue({ value, copyLabel, copiedLabel, multiline = false }: {
  value: string;
  copyLabel: string;
  copiedLabel: string;
  multiline?: boolean;
}) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Stack direction="row" spacing={1} alignItems="flex-start">
      <TextField
        variant="standard"
        fullWidth
        value={value}
        multiline={multiline}
        InputProps={{ readOnly: true, sx: { fontFamily: MONO_FONT, fontSize: '0.8125rem' } }}
      />
      <Tooltip title={copied ? copiedLabel : copyLabel}>
        <IconButton
          size="small"
          aria-label={copyLabel}
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => setCopied(true), () => undefined);
          }}
          onMouseLeave={() => setCopied(false)}
        >
          <ContentCopyIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

export type McpKeyDialogProps = {
  open: boolean;
  onClose: () => void;
  /** The key exists: the caller refreshes its own list. The record carries the prefix, never the key. */
  onCreated: (record: AiApiKeyRecord) => void;
};

/**
 * Creates an MCP key for the person signed in: a label, then the key shown once with the
 * Claude Code command. Shared by the pages that offer « Create key »; each refreshes its own
 * list from `onCreated`. Closing drops the key: the dialog opens empty again.
 */
export function McpKeyDialog({ open, onClose, onCreated }: McpKeyDialogProps) {
  // The content lives only while the dialog is open, so the key leaves memory on close.
  return open ? <McpKeyDialogContent onClose={onClose} onCreated={onCreated} /> : null;
}

function McpKeyDialogContent({ onClose, onCreated }: Omit<McpKeyDialogProps, 'open'>) {
  const { t } = useTranslation(['admin', 'common']);
  const labelRef = React.useRef<HTMLInputElement>(null);
  const [label, setLabel] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [createdKey, setCreatedKey] = React.useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (keyLabel: string) => aiKeysApi.create({ label: keyLabel }),
    // The answer holds the key: it is not kept in the mutation cache once read.
    gcTime: 0,
    onMutate: () => setError(null),
    // Runs even when the dialog closed meanwhile: the key exists and the list must show it.
    onSuccess: (data) => onCreated(data.record),
    onError: (err) => setError(getApiErrorMessage(err, t, t('aiAdmin.messages.createMcpKeyFailed'))),
  });

  const create = () => {
    const keyLabel = label.trim();
    if (!keyLabel || createMutation.isPending) return;
    createMutation.mutate(keyLabel, {
      onSuccess: (data) => {
        setCreatedKey(data.key);
        createMutation.reset();
      },
    });
  };

  if (createdKey) {
    const endpoint = mcpEndpointUrl(window.location.origin);
    return (
      <KanapDialog
        open
        title={t('aiAdmin.dialogs.keyCreatedTitle')}
        onClose={onClose}
        onSave={onClose}
        saveLabel={t('aiAdmin.actions.done')}
        showCancel={false}
        sx={{ maxWidth: 600 }}
      >
        <Stack spacing={2}>
          <Alert severity="warning">{t('aiAdmin.dialogs.copyKeyWarning')}</Alert>
          <PropertyRow label={t('aiAdmin.dialogs.keyLabel')}>
            <CopyValue
              value={createdKey}
              copyLabel={t('aiAdmin.dialogs.copyKey')}
              copiedLabel={t('aiAdmin.keys.copied')}
            />
          </PropertyRow>
          <PropertyRow
            label={t('aiAdmin.dialogs.claudeCodeLabel')}
            helperText={t('aiAdmin.dialogs.claudeCodeHelper')}
          >
            <CopyValue
              value={claudeCodeCommand(endpoint, createdKey)}
              copyLabel={t('aiAdmin.dialogs.copyCommand')}
              copiedLabel={t('aiAdmin.keys.copied')}
              multiline
            />
          </PropertyRow>
        </Stack>
      </KanapDialog>
    );
  }

  return (
    <KanapDialog
      open
      title={t('aiAdmin.dialogs.createKeyTitle')}
      onClose={onClose}
      onSave={create}
      saveLabel={t('common:buttons.create')}
      saveDisabled={!label.trim()}
      saveLoading={createMutation.isPending}
      initialFocusRef={labelRef}
      sx={{ maxWidth: 600 }}
    >
      <Stack spacing={1.5}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <PropertyRow label={t('aiAdmin.fields.label')}>
          <TextField
            variant="standard"
            size="small"
            fullWidth
            inputRef={labelRef}
            value={label}
            placeholder={t('aiAdmin.fields.labelPlaceholder')}
            inputProps={{ 'aria-label': t('aiAdmin.fields.label') }}
            sx={drawerFieldValueSx}
            onChange={(event) => setLabel(event.target.value)}
          />
        </PropertyRow>
      </Stack>
    </KanapDialog>
  );
}
