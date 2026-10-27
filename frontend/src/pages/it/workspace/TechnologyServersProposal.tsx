import React from 'react';
import { Box, Button, Checkbox, CircularProgress, MenuItem, MenuList, Popover, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import type { DeploymentServer } from './ApplicationRelationsTab';

type Props = {
  anchorEl: HTMLElement;
  /**
   * Which edge of the anchor the panel shares. An Add button is `'left'` (the panel grows into
   * the content). A row button is `'right'`, so the panel stays over the table.
   */
  align?: 'left' | 'right';
  /** The technology and its version as the line reads them (`version` null: version unknown). */
  technology: string;
  version: string | null;
  servers: DeploymentServer[];
  /** Servers that already carry the technology: shown, not offered. */
  carrying: ReadonlySet<string>;
  /**
   * `add`: the last step of an add, saved with or without servers.
   * `record`: servers only, saved once at least one is ticked.
   */
  mode: 'add' | 'record';
  /** Saves the ticked servers; resolves once saved (the caller closes the popover). */
  onConfirm: (assetIds: string[]) => Promise<void>;
  onClose: () => void;
};

const itemSx = { minHeight: 32, py: 0.5, fontSize: 13, color: 'kanap.text.primary' } as const;
const camel = (value: string) => value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * The deployment servers of an application, offered to record a technology on at the version just
 * chosen: "Also record PHP 8.2 on", one checkbox per server with its environments and roles.
 * Nothing is ticked at first. Closing the popover saves nothing.
 */
export default function TechnologyServersProposal({ anchorEl, align = 'left', technology, version, servers, carrying, mode, onConfirm, onClose }: Props) {
  const { t } = useTranslation(['it', 'common']);
  const { labelFor } = useItOpsEnumOptions();
  const [ticked, setTicked] = React.useState<Set<string>>(() => new Set());
  const [saving, setSaving] = React.useState(false);
  const title = version
    ? t('workspace.application.relations.technologyServers.proposal', { technology, version })
    : t('workspace.application.relations.technologyServers.proposalUnknown', { technology });

  const toggle = (id: string) => setTicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const confirm = async () => {
    setSaving(true);
    await onConfirm([...ticked]);
    setSaving(false);
  };
  const details = (server: DeploymentServer) => [
    ...server.environments.map((env) => t(`enums.environment.${camel(env)}`, { defaultValue: env })),
    ...server.roles.map((role) => labelFor('serverRole', role) || role),
  ].join(', ');

  return (
    <Popover
      open
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: align }}
      transformOrigin={{ vertical: 'top', horizontal: align }}
      slotProps={{ paper: { sx: { p: 1, width: 340, mt: 0.5 } } }}
    >
      <Typography id="technology-servers-title" sx={{ px: 1, pt: 0.25, pb: 0.75, fontSize: 13, color: 'kanap.text.secondary' }}>{title}</Typography>
      <MenuList aria-labelledby="technology-servers-title" dense disablePadding sx={{ py: 0.25, maxHeight: 280, overflowY: 'auto' }}>
        {servers.map((server) => {
          const already = carrying.has(server.asset_id);
          const extra = details(server);
          return (
            <MenuItem
              key={server.asset_id}
              role="menuitemcheckbox"
              aria-checked={ticked.has(server.asset_id)}
              disabled={already}
              onClick={() => toggle(server.asset_id)}
              sx={itemSx}
            >
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, width: '100%', minWidth: 0 }}>
                <Checkbox size="small" checked={ticked.has(server.asset_id)} disabled={already} tabIndex={-1} disableRipple sx={{ p: 0, alignSelf: 'center' }} inputProps={{ 'aria-hidden': true }} />
                <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {server.name}
                  {extra && <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{` (${extra})`}</Box>}
                </Box>
                {already && (
                  <Box component="span" sx={{ fontSize: 12, color: 'kanap.text.tertiary', flexShrink: 0 }}>
                    {t('workspace.application.relations.technologyServers.already')}
                  </Box>
                )}
              </Box>
            </MenuItem>
          );
        })}
      </MenuList>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1, pt: 0.75 }}>
        {saving && <CircularProgress size={14} />}
        <Button
          variant="action-primary"
          size="small"
          disabled={saving || (mode === 'record' && ticked.size === 0)}
          onClick={() => { void confirm(); }}
        >
          {mode === 'add'
            ? t('workspace.application.relations.technologyServers.add')
            : t('workspace.application.relations.technologyServers.recordOn', { count: ticked.size })}
        </Button>
      </Box>
    </Popover>
  );
}
