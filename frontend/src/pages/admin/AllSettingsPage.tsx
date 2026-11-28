import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, InputAdornment, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { useDataAccessLimited } from '../../auth/dataAccess';
import { useFeatures } from '../../config/FeaturesContext';
import { useTenant } from '../../tenant/TenantContext';
import { useAiCapabilities } from '../../ai/useAiCapabilities';
import PageHeader from '../../components/PageHeader';
import { neutralLinkSx } from '../../theme/formSx';
import { evaluateAccess, type AccessContext, type DeploymentMode } from '../../settings/accessRule';
import {
  SETTINGS_PAGES,
  isSettingsPageAvailable,
  settingsPageHref,
  settingsPageScope,
  type SettingsModule,
  type SettingsPageEntry,
} from '../../settings/pages';

/** Namespaces of the registry's labels, menu paths and settings. */
const NAMESPACES = ['admin', 'nav', 'settings', 'common', 'ops', 'master-data', 'it', 'portfolio', 'agents', 'knowledge'];

/** Module groups in the order of the top bar. */
const MODULE_ORDER: SettingsModule[] = ['agents', 'portfolio', 'it', 'knowledge', 'budget'];
const MODULE_LABEL_KEYS: Record<SettingsModule, string> = {
  agents: 'nav:workspaces.agents',
  portfolio: 'nav:workspaces.portfolio',
  it: 'nav:workspaces.itOperations',
  knowledge: 'nav:workspaces.knowledge',
  budget: 'nav:workspaces.budgetManagement',
};
const GROUP_ORDER = ['person', ...MODULE_ORDER.map((module) => `module:${module}`), 'organization', 'installation', 'platform'];

/** Lower case, without accents, single spaces: "Devise de reporting" and "devise  de REPORTING" meet. */
export function normalizeSearchText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The settings pages the person may open here, as the menu decides: no server call. */
function useOpenableSettingsPages(): { pages: SettingsPageEntry[]; mode: DeploymentMode } {
  const { hasLevel, claims } = useAuth();
  const dataAccessLimited = useDataAccessLimited();
  const { config, isSingleTenant } = useFeatures();
  const { isPlatformHost } = useTenant();
  const aiCapabilities = useAiCapabilities();
  const mode: DeploymentMode = isSingleTenant ? 'onprem' : 'cloud';
  return React.useMemo(() => {
    const features = config.features;
    const context: AccessContext = {
      mode,
      hasLevel,
      isAdministrator: !!claims?.isGlobalAdmin,
      isPlatformAdmin: !!claims?.isPlatformAdmin,
      dataAccessLimited,
      custom: {
        aiSettingsSurface: !!features.aiSettings && aiCapabilities.data?.surfaces.settings.available === true,
        aiAgentsInstance: !!features.aiSettings && aiCapabilities.data?.instance_features.ai_settings === true,
      },
    };
    const environment = {
      mode,
      host: isPlatformHost ? ('platform' as const) : ('organization' as const),
      features: {
        billing: features.billing,
        sso: features.sso,
        aiSettings: features.aiSettings,
        aiMcp: features.aiMcp,
        sampleData: features.sampleData,
      },
    };
    const pages = SETTINGS_PAGES.filter((entry) => isSettingsPageAvailable(entry, environment) && evaluateAccess(entry.open, context));
    return { pages, mode };
  }, [mode, hasLevel, claims, dataAccessLimited, config.features, isPlatformHost, aiCapabilities.data]);
}

function groupOf(entry: SettingsPageEntry, mode: DeploymentMode): string {
  const scope = settingsPageScope(entry, mode);
  return scope === 'module' ? `module:${entry.module}` : scope;
}

export default function AllSettingsPage() {
  const { t, i18n } = useTranslation(NAMESPACES);
  const { pages, mode } = useOpenableSettingsPages();
  const [query, setQuery] = React.useState('');

  const rows = React.useMemo(() => pages.map((entry) => {
    const label = t(entry.labelKey);
    return {
      entry,
      label,
      menu: entry.menuKeys.map((key) => t(key)).join(' › '),
      haystack: normalizeSearchText([label, ...entry.settingKeys.map((key) => t(key))].join(' ')),
    };
    // The language is a dependency: the labels change with it.
  }), [pages, t, i18n.language]);

  const words = normalizeSearchText(query).split(' ').filter(Boolean);
  const matching = words.length === 0 ? rows : rows.filter((row) => words.every((word) => row.haystack.includes(word)));
  const groups = GROUP_ORDER
    .map((group) => ({ group, rows: matching.filter((row) => groupOf(row.entry, mode) === group) }))
    .filter(({ rows: groupRows }) => groupRows.length > 0);

  const groupLabel = (group: string) => (group.startsWith('module:')
    ? t(MODULE_LABEL_KEYS[group.slice('module:'.length) as SettingsModule])
    : t(`admin:allSettings.groups.${group}`));

  return (
    <Box sx={{ maxWidth: 880 }}>
      <PageHeader title={t('admin:allSettings.title')} />
      <TextField
        variant="standard"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('admin:allSettings.searchPlaceholder')}
        inputProps={{ 'aria-label': t('admin:allSettings.search') }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon sx={{ fontSize: 16, color: 'kanap.text.tertiary' }} />
            </InputAdornment>
          ),
        }}
        sx={{ width: '100%', maxWidth: 480 }}
      />
      {groups.length === 0 ? (
        <Typography sx={{ mt: 3, fontSize: 13, color: 'kanap.text.tertiary' }}>
          {rows.length === 0 ? t('admin:allSettings.empty') : t('admin:allSettings.noMatch', { query: query.trim() })}
        </Typography>
      ) : groups.map(({ group, rows: groupRows }) => (
        <Box component="section" key={group} aria-labelledby={`all-settings-${group}`} sx={{ mt: 3 }}>
          <Typography
            id={`all-settings-${group}`}
            component="h2"
            sx={{ fontSize: 13, fontWeight: 500, color: 'kanap.text.primary', mb: 0.5 }}
          >
            {groupLabel(group)}
          </Typography>
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {groupRows.map(({ entry, label, menu }) => (
              <Box
                component="li"
                key={entry.id}
                sx={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 1.5,
                  py: '7px',
                  borderBottom: '1px solid',
                  borderColor: 'kanap.border.soft',
                }}
              >
                <Box component={RouterLink} to={settingsPageHref(entry)} sx={{ ...neutralLinkSx(false), fontSize: 13 }}>
                  {label}
                </Box>
                {menu && (
                  <Typography component="span" sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
                    {menu}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
