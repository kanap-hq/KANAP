import React from 'react';
import {
  Alert,
  Box,
  Checkbox,
  CircularProgress,
  List,
  ListItem,
  ListItemButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import api from '../../../api';
import KanapDialog from '../../../components/design/KanapDialog';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { legTypeLabel } from '../../../utils/interfaceLegType';

export type LinkOption = {
  binding_id: string;
  interface_id: string;
  interface_reference?: string | null;
  interface_code?: string | null;
  interface_name: string;
  environment: string;
  leg_type: string;
  source_endpoint: string | null;
  target_endpoint: string | null;
  pattern: string;
  binding_status: string;
};

type Props = {
  open: boolean;
  connectionId: string;
  onClose: () => void;
  onLinked: (count: number) => void;
};

export default function ConnectionLinkInterfacesDialog({
  open,
  connectionId,
  onClose,
  onLinked,
}: Props) {
  const { t } = useTranslation(['it', 'common']);
  const { labelFor } = useItOpsEnumOptions();
  const [search, setSearch] = React.useState('');
  const [options, setOptions] = React.useState<LinkOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setSearch('');
    setSelectedIds(new Set());
    setError(null);
  }, [open, connectionId]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get<{ items: LinkOption[] }>(
          `/connections/${connectionId}/interface-link-options`,
          { params: { q: search || undefined, limit: 100 } },
        );
        if (!cancelled) setOptions(res.data.items || []);
      } catch (e: any) {
        if (!cancelled) {
          setOptions([]);
          setError(getApiErrorMessage(e, t, t('it:workspace.connection.linkInterfaces.loadFailed')));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, search, connectionId, t]);

  const toggle = (bindingId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(bindingId)) next.delete(bindingId);
      else next.add(bindingId);
      return next;
    });
  };

  const handleSave = async () => {
    if (selectedIds.size === 0) {
      onClose();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post<{ linked: number; skipped: number }>(
        `/connections/${connectionId}/interface-links`,
        { binding_ids: Array.from(selectedIds) },
      );
      onLinked(res.data.linked || 0);
      onClose();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('it:workspace.connection.linkInterfaces.linkFailed')));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KanapDialog
      open={open}
      title={t('it:workspace.connection.linkInterfaces.title')}
      onClose={() => !submitting && onClose()}
      onSave={handleSave}
      saveLabel={selectedIds.size > 0 ? t('it:workspace.connection.linkInterfaces.linkCount', { count: selectedIds.size }) : t('common:buttons.link')}
      saveDisabled={submitting || selectedIds.size === 0}
      saveLoading={submitting}
      sx={{ maxWidth: 720 }}
    >
      <Stack spacing={1.5} sx={{ minHeight: 360 }}>
        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        <TextField
          size="small"
          variant="standard"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('it:workspace.connection.linkInterfaces.searchPlaceholder')}
          autoFocus
          sx={(theme) => ({
            '& input': { fontSize: 13, padding: '8px 12px' },
            border: `1px solid ${theme.palette.kanap.border.default}`,
            borderRadius: '6px',
          })}
        />
        <Box
          sx={(theme) => ({
            border: `1px solid ${theme.palette.kanap.border.default}`,
            borderRadius: '8px',
            maxHeight: 460,
            minHeight: 260,
            overflowY: 'auto',
            position: 'relative',
          })}
        >
          {loading && (
            <Box sx={{ position: 'absolute', top: 4, right: 8 }}>
              <CircularProgress size={14} />
            </Box>
          )}
          {!loading && options.length === 0 && (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>
                {search
                  ? t('it:workspace.connection.linkInterfaces.noMatch')
                  : t('it:workspace.connection.linkInterfaces.allLinked')}
              </Typography>
            </Box>
          )}
          {options.length > 0 && (
            <List dense disablePadding>
              {options.map((opt) => {
                const isSelected = selectedIds.has(opt.binding_id);
                const endpointLine =
                  [opt.source_endpoint, opt.target_endpoint].filter(Boolean).join(' → ');
                return (
                  <ListItem key={opt.binding_id} disablePadding>
                    <ListItemButton
                      onClick={() => toggle(opt.binding_id)}
                      sx={{ alignItems: 'flex-start', py: 0.75 }}
                    >
                      <Checkbox
                        edge="start"
                        checked={isSelected}
                        tabIndex={-1}
                        disableRipple
                        size="small"
                        sx={{ p: 0.5, mr: 1, mt: 0.25 }}
                      />
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                          <Typography
                            component="span"
                            sx={{
                              fontSize: 12,
                              fontFamily: "'JetBrains Mono Variable', monospace",
                              color: 'kanap.text.secondary',
                            }}
                          >
                            {opt.interface_reference || opt.interface_code}
                          </Typography>
                          <Typography component="span" sx={{ fontSize: 13, color: 'kanap.text.primary' }} noWrap>
                            {opt.interface_name}
                          </Typography>
                        </Stack>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.25, flexWrap: 'wrap' }}>
                          <Typography component="span" sx={{ fontSize: 11, color: 'kanap.text.tertiary' }}>
                            {opt.environment.toUpperCase()} · {legTypeLabel(t, opt.leg_type)}
                            {opt.pattern ? ` · ${labelFor('interfacePattern', opt.pattern)}` : ''}
                          </Typography>
                          {endpointLine && (
                            <Typography component="span" sx={{ fontSize: 11, color: 'kanap.text.tertiary' }}>
                              · {endpointLine}
                            </Typography>
                          )}
                        </Stack>
                      </Box>
                    </ListItemButton>
                  </ListItem>
                );
              })}
            </List>
          )}
        </Box>
        <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary' }}>
          {selectedIds.size > 0
            ? t('it:workspace.connection.linkInterfaces.selected', { count: selectedIds.size })
            : t('it:workspace.connection.linkInterfaces.selectHint')}
        </Typography>
      </Stack>
    </KanapDialog>
  );
}
