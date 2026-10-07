import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Divider,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import { KanapDialog, useKanapDialogs } from '../../components/design';
import { useAuth } from '../../auth/AuthContext';
import api from '../../api';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { drawerMenuItemSx } from '../../theme/formSx';
import CreateCoADialog from './CreateCoADialog';
import { coaCoverage, coaRoleLabels, useCountryName } from './coaRoles';
import { CoaListItem, useCoaList } from './useCoaList';

type ConsolidationImpact = { matched: number; outside: number; unmapped: number };

const MONO = "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace";

const tableSx = (theme: Theme) => ({
  width: '100%',
  borderCollapse: 'collapse' as const,
  '& th': {
    fontSize: 12,
    fontWeight: 500,
    color: theme.palette.kanap.text.tertiary,
    textAlign: 'left' as const,
    py: '6px',
    px: '8px',
    borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
    whiteSpace: 'nowrap' as const,
  },
  '& td': {
    fontSize: 13,
    fontWeight: 400,
    color: theme.palette.kanap.text.primary,
    py: '8px',
    px: '8px',
    verticalAlign: 'top' as const,
    borderBottom: `1px solid ${theme.palette.kanap.border.soft}`,
    lineHeight: 1.45,
  },
  '& tbody tr:hover td': { bgcolor: theme.palette.kanap.bg.hover },
  '& tbody tr:last-of-type td': { borderBottom: 'none' },
  '& th:first-of-type, & td:first-of-type': { pl: 0 },
  '& .r': { textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' },
  '& td.menu': { py: '4px', pr: 0, width: 36 },
});

const menuSecondarySx = { fontSize: 12, color: 'kanap.text.tertiary', mt: '2px', whiteSpace: 'normal' } as const;

/** Lines of a confirmation body, each its own paragraph. */
function Paragraphs({ lines }: { lines: string[] }) {
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      {lines.map((line) => (
        <Box component="p" key={line} sx={{ m: 0, lineHeight: 1.5 }}>{line}</Box>
      ))}
    </Box>
  );
}

export default function ManageCoAsDialog({
  open,
  onClose,
  onCoaCreated,
  onCoaDeleted,
  onCoaUpdated,
}: {
  open: boolean;
  onClose: () => void;
  onCoaCreated?: (newId: string) => void;
  onCoaDeleted?: (coaId: string) => void;
  onCoaUpdated?: () => void;
}) {
  const { hasLevel } = useAuth();
  const { t } = useTranslation(['master-data', 'common']);
  const dialogs = useKanapDialogs();
  const canManage = hasLevel('accounts', 'manager');
  const canAdmin = hasLevel('accounts', 'admin');
  const { coas, isLoading, isError, refetch } = useCoaList();
  const countryName = useCountryName();

  const [createOpen, setCreateOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; coa: CoaListItem } | null>(null);

  const refresh = useCallback(async () => {
    await refetch();
    onCoaUpdated?.();
  }, [onCoaUpdated, refetch]);

  /** Runs one role change, then refetches so the row shows its new roles. */
  const run = useCallback(async (coa: CoaListItem, action: () => Promise<unknown>) => {
    setActionError(null);
    setBusyId(coa.id);
    try {
      await action();
      await refresh();
    } catch (e) {
      setActionError(getApiErrorMessage(e, t, t('coa.manageDialog.actionFailed', { code: coa.code })));
    } finally {
      setBusyId(null);
    }
  }, [refresh, t]);

  const setCountryDefault = (coa: CoaListItem, value: boolean) =>
    run(coa, () => api.patch(`/chart-of-accounts/${coa.id}`, { is_default: value }));

  const setGlobalDefault = (coa: CoaListItem, value: boolean) =>
    run(coa, () => (value
      ? api.patch(`/chart-of-accounts/${coa.id}/global-default`, {})
      : api.delete(`/chart-of-accounts/${coa.id}/global-default`)));

  const makeConsolidation = async (coa: CoaListItem) => {
    setActionError(null);
    setBusyId(coa.id);
    let impact: ConsolidationImpact;
    try {
      const res = await api.get(`/chart-of-accounts/${coa.id}/consolidation-impact`);
      impact = {
        matched: Number(res.data?.matched ?? 0),
        outside: Number(res.data?.outside ?? 0),
        unmapped: Number(res.data?.unmapped ?? 0),
      };
    } catch (e) {
      setActionError(getApiErrorMessage(e, t, t('coa.manageDialog.actionFailed', { code: coa.code })));
      setBusyId(null);
      return;
    }
    setBusyId(null);

    const previous = coas.find((item) => item.is_consolidation && item.id !== coa.id);
    if (previous || impact.outside > 0) {
      const lines: string[] = [];
      if (previous) lines.push(t('coa.manageDialog.consolidationConfirm.replaces', { code: coa.code, previous: previous.code }));
      if (impact.matched > 0) lines.push(t('coa.manageDialog.consolidationConfirm.matched', { count: impact.matched }));
      if (impact.outside > 0) lines.push(t('coa.manageDialog.consolidationConfirm.outside', { count: impact.outside, code: coa.code }));
      if (impact.unmapped > 0) lines.push(t('coa.manageDialog.consolidationConfirm.unmapped', { count: impact.unmapped }));
      const confirmed = await dialogs.confirm({
        title: t('coa.manageDialog.consolidationConfirm.title', { code: coa.code }),
        message: <Paragraphs lines={lines} />,
        confirmLabel: t('coa.manageDialog.actions.makeConsolidation'),
      });
      if (!confirmed) return;
    }
    await run(coa, () => api.patch(`/chart-of-accounts/${coa.id}/consolidation`, {}));
  };

  const stopConsolidation = async (coa: CoaListItem) => {
    const confirmed = await dialogs.confirm({
      title: t('coa.manageDialog.stopConsolidationConfirm.title', { code: coa.code }),
      message: t('coa.manageDialog.stopConsolidationConfirm.body'),
      confirmLabel: t('coa.manageDialog.actions.stopConsolidation'),
    });
    if (!confirmed) return;
    await run(coa, () => api.delete(`/chart-of-accounts/${coa.id}/consolidation`));
  };

  const deleteChart = async (coa: CoaListItem) => {
    const accounts = coa.accounts_count ?? 0;
    if (accounts > 0) {
      const lines = [t('coa.manageDialog.deleteConfirm.accounts', { count: accounts, code: coa.code })];
      if (coa.is_consolidation) lines.push(t('coa.manageDialog.deleteConfirm.consolidation', { code: coa.code }));
      const confirmed = await dialogs.confirm({
        title: t('coa.manageDialog.deleteConfirm.title', { code: coa.code }),
        message: <Paragraphs lines={lines} />,
        confirmLabel: t('coa.manageDialog.deleteConfirm.confirm'),
        intent: 'danger',
      });
      if (!confirmed) return;
    }
    setActionError(null);
    setBusyId(coa.id);
    try {
      const res = await api.delete('/chart-of-accounts/bulk', { data: { ids: [coa.id] } });
      const failed = (res.data?.failed ?? []) as Array<{ id: string; reason?: string }>;
      const refusal = failed.find((item) => item.id === coa.id) ?? failed[0];
      if (refusal) {
        setActionError(t('coa.manageDialog.deleteRefused', { code: coa.code, reason: refusal.reason || '' }).trim());
        return;
      }
      onCoaDeleted?.(coa.id);
      await refresh();
    } catch (e) {
      setActionError(getApiErrorMessage(e, t, t('coa.manageDialog.actionFailed', { code: coa.code })));
    } finally {
      setBusyId(null);
    }
  };

  const closeMenu = () => setMenu(null);
  const pick = (action: () => void) => () => {
    closeMenu();
    action();
  };

  const menuItems = (coa: CoaListItem) => {
    const items: React.ReactNode[] = [];
    if (canManage) {
      if (coa.scope === 'COUNTRY' && coa.country_iso) {
        items.push(
          <MenuItem key="country" sx={drawerMenuItemSx} onClick={pick(() => void setCountryDefault(coa, !coa.is_default))}>
            {coa.is_default
              ? t('coa.manageDialog.actions.stopCountryDefault')
              : t('coa.manageDialog.actions.makeCountryDefault')}
          </MenuItem>,
        );
      }
      if (coa.scope === 'GLOBAL') {
        items.push(
          <MenuItem key="global" sx={drawerMenuItemSx} onClick={pick(() => void setGlobalDefault(coa, !coa.is_global_default))}>
            {coa.is_global_default ? (
              t('coa.manageDialog.actions.stopGlobalDefault')
            ) : (
              <ListItemText
                primary={t('coa.manageDialog.actions.makeGlobalDefault')}
                secondary={t('coa.manageDialog.actions.makeGlobalDefaultHint')}
                primaryTypographyProps={{ fontSize: 13 }}
                secondaryTypographyProps={{ sx: menuSecondarySx }}
                sx={{ my: 0 }}
              />
            )}
          </MenuItem>,
        );
      }
      items.push(
        <MenuItem
          key="consolidation"
          sx={drawerMenuItemSx}
          onClick={pick(() => void (coa.is_consolidation ? stopConsolidation(coa) : makeConsolidation(coa)))}
        >
          {coa.is_consolidation
            ? t('coa.manageDialog.actions.stopConsolidation')
            : t('coa.manageDialog.actions.makeConsolidation')}
        </MenuItem>,
      );
    }
    if (canAdmin) {
      if (items.length > 0) items.push(<Divider key="divider" sx={{ my: '4px !important' }} />);
      items.push(
        <MenuItem key="delete" sx={{ ...drawerMenuItemSx, color: 'kanap.danger' }} onClick={pick(() => void deleteChart(coa))}>
          {t('coa.manageDialog.actions.delete')}
        </MenuItem>,
      );
    }
    return items;
  };

  const hasRowMenu = canManage || canAdmin;

  return (
    <>
      <KanapDialog
        open={open}
        title={t('coa.manageDialog.title')}
        onClose={onClose}
        onSave={onClose}
        saveLabel={t('common:buttons.close')}
        saveVariant="action"
        showCancel={false}
        footerLeft={canManage ? (
          <Button
            variant="action"
            startIcon={<AddIcon sx={{ fontSize: '16px !important' }} />}
            onClick={() => setCreateOpen(true)}
            onKeyDown={(event) => { if (event.key === 'Enter') event.stopPropagation(); }}
          >
            {t('coa.manageDialog.newChart')}
          </Button>
        ) : undefined}
        sx={{ maxWidth: 860 }}
      >
        {actionError && (
          <Alert severity="error" onClose={() => setActionError(null)} sx={{ mb: 2 }}>
            {actionError}
          </Alert>
        )}

        {isLoading && (
          <Box sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>{t('coa.manageDialog.loadingCoAs')}</Box>
        )}
        {isError && <Alert severity="error">{t('coa.manageDialog.loadError')}</Alert>}
        {!isLoading && !isError && coas.length === 0 && (
          <Box sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>{t('coa.manageDialog.noCoAs')}</Box>
        )}

        {coas.length > 0 && (
          <Box sx={{ overflowX: 'auto' }}>
            <Box component="table" sx={tableSx}>
              <thead>
                <tr>
                  <th>{t('coa.manageDialog.columns.code')}</th>
                  <th>{t('coa.manageDialog.columns.name')}</th>
                  <th>{t('coa.manageDialog.columns.coverage')}</th>
                  <th>{t('coa.manageDialog.columns.roles')}</th>
                  <th className="r">{t('coa.manageDialog.columns.companies')}</th>
                  <th className="r">{t('coa.manageDialog.columns.accounts')}</th>
                  {hasRowMenu && <th aria-label={t('coa.manageDialog.columns.actions')} />}
                </tr>
              </thead>
              <tbody>
                {coas.map((coa) => {
                  const roles = coaRoleLabels(coa, t, countryName);
                  return (
                    <tr key={coa.id} data-testid={`coa-row-${coa.code}`}>
                      <td>
                        <Box
                          component="span"
                          sx={{ fontFamily: MONO, fontSize: 12, color: 'kanap.text.secondary', whiteSpace: 'nowrap' }}
                        >
                          {coa.code}
                        </Box>
                      </td>
                      <td>{coa.name}</td>
                      <td>{coaCoverage(coa, t, countryName)}</td>
                      <td>
                        {roles.length > 0 ? (
                          roles.map((role) => <Box key={role}>{role}</Box>)
                        ) : (
                          <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>–</Box>
                        )}
                      </td>
                      <td className="r">{coa.companies_count ?? 0}</td>
                      <td className="r">{coa.accounts_count ?? 0}</td>
                      {hasRowMenu && (
                        <td className="menu">
                          <IconButton
                            size="small"
                            aria-label={t('coa.manageDialog.rowMenu', { code: coa.code })}
                            aria-haspopup="menu"
                            disabled={busyId === coa.id}
                            onClick={(event) => setMenu({ anchor: event.currentTarget, coa })}
                            // KanapDialog submits on Enter: keep Enter for the button itself.
                            onKeyDown={(event) => { if (event.key === 'Enter') event.stopPropagation(); }}
                            sx={{ color: 'kanap.text.secondary' }}
                          >
                            <MoreHorizIcon fontSize="small" />
                          </IconButton>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </Box>
          </Box>
        )}

        {coas.length > 0 && (
          <Box sx={{ mt: 2, display: 'grid', gap: '2px', fontSize: 12, lineHeight: 1.45, color: 'kanap.text.tertiary' }}>
            <Box>{t('coa.manageDialog.help.countryDefault')}</Box>
            <Box>{t('coa.manageDialog.help.globalDefault')}</Box>
            <Box>{t('coa.manageDialog.help.consolidation')}</Box>
          </Box>
        )}
      </KanapDialog>

      {/* Outside the dialog form: an Enter on a menu item must not submit (close) the dialog. */}
      <Menu
        open={!!menu}
        anchorEl={menu?.anchor ?? null}
        onClose={closeMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { minWidth: 240, maxWidth: 340 } }}
      >
        {menu ? menuItems(menu.coa) : null}
      </Menu>

      <CreateCoADialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={async (newId) => {
          setCreateOpen(false);
          await refresh();
          onCoaCreated?.(newId);
        }}
      />
    </>
  );
}
