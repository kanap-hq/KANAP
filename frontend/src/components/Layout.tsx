import React from 'react';
import { AppBar, Box, CircularProgress, Divider, Drawer, IconButton, LinearProgress, List, ListItemButton, ListItemIcon, ListItemText, ListSubheader, Toolbar, Typography, Tooltip, Tabs, Tab, Menu, MenuItem } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { keyframes } from '@emotion/react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import WorkOutlineIcon from '@mui/icons-material/WorkOutline';
import HubIcon from '@mui/icons-material/Hub';
import DnsIcon from '@mui/icons-material/Dns';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import GppMaybeOutlinedIcon from '@mui/icons-material/GppMaybeOutlined';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import BusinessIcon from '@mui/icons-material/Business';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import SchemaIcon from '@mui/icons-material/Schema';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import PeopleIcon from '@mui/icons-material/People';
import MenuIcon from '@mui/icons-material/Menu';
import BarChartIcon from '@mui/icons-material/BarChart';
import DescriptionIcon from '@mui/icons-material/Description';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import ApartmentIcon from '@mui/icons-material/Apartment';
import SecurityIcon from '@mui/icons-material/Security';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import LanIcon from '@mui/icons-material/Lan';
import InsightsIcon from '@mui/icons-material/Insights';
import SettingsIcon from '@mui/icons-material/Settings';
import AssignmentIcon from '@mui/icons-material/Assignment';
import StorageIcon from '@mui/icons-material/Storage';
import LocationCityIcon from '@mui/icons-material/LocationCity';
import InboxIcon from '@mui/icons-material/Inbox';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import DateRangeIcon from '@mui/icons-material/DateRange';
import AssessmentIcon from '@mui/icons-material/Assessment';
import HistoryIcon from '@mui/icons-material/History';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import ScheduleIcon from '@mui/icons-material/Schedule';
import BrushIcon from '@mui/icons-material/Brush';
import DatasetIcon from '@mui/icons-material/Dataset';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ExtensionIcon from '@mui/icons-material/Extension';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import { useAuth } from '../auth/AuthContext';
import { useDataAccessLimited } from '../auth/dataAccess';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import BrightnessAutoIcon from '@mui/icons-material/BrightnessAuto';
import { useTenant } from '../tenant/TenantContext';
import { useFeatures } from '../config/FeaturesContext';
import { useThemeMode } from '../config/ThemeContext';
import { getDocUrl } from '../utils/docUrls';
import AboutDialog from './about/AboutDialog';
import { formatUserName } from '../utils/userDisplay';
import SubscriptionBanner from './SubscriptionBanner';
import TrialChip, { TrialMenuLine } from './TrialChip';
import NamePromptDialog from './NamePromptDialog';
import FirstOpenDialog from './onboarding/FirstOpenDialog';
import NavigationTracker from './navigation/NavigationTracker';
import StepHint from './onboarding/StepHint';
import { focusPageScroller } from './appScroll';
import { useAiCapabilities } from '../ai/useAiCapabilities';
import { chatAwaitsIncludedModelConfirmation, chatTurnedOffByAdmin } from '../ai/includedModel';
import { aiAgentControlApi } from '../ai/aiApi';
import { useTranslation } from 'react-i18next';
import { PagePendingContext } from '../lib/deferredPage';
import { useLocale } from '../i18n/useLocale';
import { useBusinessContributorApplicationVisibility } from '../hooks/useBusinessContributorApplicationVisibility';
import { useGuardedLeave, useInAppLinkGuard } from '../hooks/leaveGuard';
import { canUseAnyOperation } from '../pages/operations/operationAccess';

/** The pending page bar appears only once a move to another page has lasted a moment. */
const appearLater = keyframes({ to: { opacity: 1 } });

const drawerWidth = 220;

type NavLevel = 'reader' | 'contributor' | 'member' | 'manager' | 'admin';
type NavGrant = { resource: string; level?: NavLevel };
type NavItem = {
  to: string;
  label: string;
  icon: React.ReactNode;
  resource?: string;
  /** Visible when the user has any one of these resources (instead of `resource`). */
  anyResource?: string[];
  level?: NavLevel;
  /** Visible when any one of these holds. Each names its own level. */
  anyOf?: NavGrant[];
};
type NavDivider = { divider: string };
type NavEntry = NavItem | NavDivider;
type WorkspaceKey = 'ops' | 'it' | 'master-data' | 'portfolio' | 'ai' | 'agents' | 'knowledge' | 'admin';

const workspaceRoutes: Record<WorkspaceKey, string> = {
  ai: '/ai',
  agents: '/agents',
  portfolio: '/portfolio',
  knowledge: '/knowledge',
  it: '/it',
  ops: '/ops',
  'master-data': '/master-data',
  admin: '/admin',
};

function isNavItem(entry: NavEntry): entry is NavItem {
  return 'to' in entry;
}

/** The workspace of an address, which the top bar highlights. */
function workspaceOfPath(p: string): WorkspaceKey | 'home' {
  // A refusal of a section the person does not see belongs to none, as the home page.
  if (p === '/' || p === '/403') return 'home';
  if (p.startsWith('/admin')) return 'admin';
  if (p.startsWith('/ai')) return 'ai';
  if (p.startsWith('/agents')) return 'agents';
  if (p.startsWith('/master-data')) return 'master-data';
  if (p.startsWith('/portfolio')) return 'portfolio';
  if (p.startsWith('/knowledge')) return 'knowledge';
  if (p.startsWith('/it')) return 'it';
  if (p.startsWith('/settings')) return 'home';
  return 'ops';
}

/** The resources that grant an item: any one suffices. Empty for an item open to everyone. */
const itemResources = (item: NavItem): string[] => item.anyResource ?? (item.resource ? [item.resource] : []);

/** One grant per way in. `anyOf` carries a level per resource; the other forms share `item.level`. */
const itemGrants = (item: NavItem): NavGrant[] => {
  if (item.anyOf && item.anyOf.length > 0) return item.anyOf;
  return itemResources(item).map((resource) => ({ resource, level: item.level }));
};

// One requirement per granting resource; callers check `some`, so an item with
// several alternatives grants its workspace through any of them.
const getNavRequirements = (entries: NavEntry[]): Array<{ resource: string; level: NavLevel }> =>
  entries
    .filter(isNavItem)
    .flatMap((item) => itemGrants(item).map((grant) => ({ resource: grant.resource, level: grant.level ?? 'reader' })));

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  // A page with edits it could not save yet asks before a link of the app takes the user away.
  useInAppLinkGuard(navigate);
  const guardedLeave = useGuardedLeave();
  const { logout, token, hasLevel, claims, profile } = useAuth();
  // Same fallback as the users list: an account with no name is shown by its email.
  // That email is the display name, so the line under it stays hidden.
  const accountLabel = formatUserName(profile);
  const accountEmail = String(profile?.email ?? '').trim();
  const dataAccessLimited = useDataAccessLimited();
  const { isPlatformHost, tenantName, logoUrl, useLogoInDark } = useTenant();
  const { config } = useFeatures();
  const { mode, resolvedMode, setMode } = useThemeMode();
  const aiCapabilities = useAiCapabilities();
  const canShowAgents = config.features.aiSettings
    && hasLevel('ai_agents', 'reader')
    && aiCapabilities.data?.instance_features.ai_settings === true;
  // The integrations page also hosts non-AI connectors (Netbox), so an infrastructure
  // admin reaches it even when the AI settings surface is unavailable.
  const aiSettingsAvailable = config.features.aiSettings
    && aiCapabilities.data?.surfaces.settings.available === true;
  const canShowIntegrations = aiSettingsAvailable || hasLevel('infrastructure', 'admin');
  const agentBadgesQuery = useQuery({
    queryKey: ['ai-agent-control-badges'],
    queryFn: () => aiAgentControlApi.getBadges(),
    enabled: canShowAgents,
    refetchInterval: 60_000,
  });
  const applicationVisibility = useBusinessContributorApplicationVisibility();
  const { t } = useTranslation(['nav', 'settings']);
  const pagePending = React.useContext(PagePendingContext);
  const locale = useLocale();
  const isSingleTenant = config.deploymentMode === 'single-tenant';
  const {
    hasScopedApplicationReaderAccess,
    shouldHideApplications,
  } = applicationVisibility;

  const operations: NavEntry[] = [
    { to: '/ops/budget', label: t('nav:sidebar.ops.budgetLines'), icon: <AccountBalanceWalletIcon />, resource: 'budget' },
    { to: '/ops/contracts', label: t('nav:sidebar.ops.contracts'), icon: <DescriptionIcon />, resource: 'contracts' },
    { to: '/ops/reports', label: t('nav:sidebar.ops.reporting'), icon: <BarChartIcon />, resource: 'reporting' },
    { to: '/ops/operations', label: t('nav:sidebar.ops.administration'), icon: <SettingsIcon />, anyResource: ['budget', 'budget_ops'] },
  ];

  const masterData: NavEntry[] = [
    { divider: t('nav:sidebar.masterData.sections.organization') },
    { to: '/master-data/companies', label: t('nav:sidebar.masterData.companies'), icon: <BusinessIcon />, resource: 'companies' },
    { to: '/master-data/departments', label: t('nav:sidebar.masterData.departments'), icon: <AccountTreeIcon />, resource: 'departments' },
    { to: '/master-data/cost-centers', label: t('nav:sidebar.masterData.costCenters'), icon: <SchemaIcon />, resource: 'cost_centers' },
    { divider: t('nav:sidebar.masterData.sections.externalParties') },
    { to: '/master-data/suppliers', label: t('nav:sidebar.masterData.suppliers'), icon: <LocalShippingIcon />, resource: 'suppliers' },
    { to: '/master-data/contacts', label: t('nav:sidebar.masterData.contacts'), icon: <PeopleIcon />, resource: 'contacts' },
    { divider: t('nav:sidebar.masterData.sections.finance') },
    { to: '/master-data/coa', label: t('nav:sidebar.masterData.chartsOfAccounts'), icon: <StorageIcon />, resource: 'accounts' },
    { to: '/master-data/analytics', label: t('nav:sidebar.masterData.analyticsDimensions'), icon: <InsightsIcon />, resource: 'analytics' },
    { to: '/master-data/working-day-calendars', label: t('nav:sidebar.masterData.workingDayCalendars'), icon: <DateRangeIcon />, resource: 'working_day_profiles' },
    { divider: t('nav:sidebar.masterData.sections.classification') },
    { to: '/master-data/business-processes', label: t('nav:sidebar.masterData.businessProcesses'), icon: <WorkOutlineIcon />, resource: 'business_processes' },
  ];

  const itMenu: NavEntry[] = [
    { divider: t('nav:sidebar.it.sections.applications') },
    { to: '/it/applications', label: t('nav:sidebar.it.applications'), icon: <WorkOutlineIcon />, resource: 'applications' },
    { to: '/it/interfaces', label: t('nav:sidebar.it.interfaces'), icon: <HubIcon />, resource: 'applications' },
    { to: '/it/interface-map', label: t('nav:sidebar.it.interfaceMap'), icon: <AccountTreeIcon />, resource: 'applications' },
    { divider: t('nav:sidebar.it.sections.infrastructure') },
    { to: '/it/assets', label: t('nav:sidebar.it.assets'), icon: <DnsIcon />, resource: 'infrastructure' },
    { to: '/it/connections', label: t('nav:sidebar.it.connections'), icon: <LanIcon />, resource: 'infrastructure' },
    { to: '/it/connection-map', label: t('nav:sidebar.it.connectionMap'), icon: <LanIcon />, resource: 'infrastructure' },
    { to: '/it/administration-view', label: t('nav:sidebar.it.administrationView'), icon: <AdminPanelSettingsIcon />, resource: 'infrastructure' },
    { divider: t('nav:sidebar.it.sections.referenceData') },
    { to: '/it/locations', label: t('nav:sidebar.it.locations'), icon: <LocationCityIcon />, resource: 'locations' },
    { to: '/it/technologies', label: t('nav:sidebar.it.technologies'), icon: <LayersOutlinedIcon />, resource: 'infrastructure' },
    { divider: t('nav:sidebar.it.sections.operations') },
    { to: '/it/incidents', label: t('nav:sidebar.it.incidents'), icon: <ReportProblemOutlinedIcon />, resource: 'incidents' },
    { to: '/it/technologies/end-of-support', label: t('nav:sidebar.it.endOfSupport'), icon: <EventBusyIcon />, resource: 'infrastructure' },
    ...(config.features.vulnerabilityFeed
      ? [{ to: '/it/vulnerabilities', label: t('nav:sidebar.it.vulnerabilities'), icon: <GppMaybeOutlinedIcon />, resource: 'infrastructure' }]
      : []),
    { divider: '' },
    // Lists need settings; Netbox, now a tab of this page, needs infrastructure admin.
    {
      to: '/it/settings',
      label: t('nav:sidebar.it.settings'),
      icon: <SettingsIcon />,
      anyOf: [{ resource: 'settings' }, { resource: 'infrastructure', level: 'admin' }],
    },
  ];

  const itOperations = itMenu.filter((entry) => (
    !hasScopedApplicationReaderAccess
    || !isNavItem(entry)
    || (
      entry.to !== '/it/interfaces'
      && entry.to !== '/it/interface-map'
      && (!shouldHideApplications || entry.to !== '/it/applications')
    )
  ));

  const portfolioNav: NavEntry[] = [
    { to: '/portfolio/tasks', label: t('nav:sidebar.portfolio.tasks'), icon: <AssignmentIcon />, resource: 'tasks' },
    { to: '/portfolio/requests', label: t('nav:sidebar.portfolio.requests'), icon: <InboxIcon />, resource: 'portfolio_requests' },
    { to: '/portfolio/projects', label: t('nav:sidebar.portfolio.projects'), icon: <AccountTreeIcon />, resource: 'portfolio_projects' },
    { to: '/portfolio/planning', label: t('nav:sidebar.portfolio.planning'), icon: <CalendarMonthIcon />, resource: 'portfolio_planning' },
    { to: '/portfolio/reports', label: t('nav:sidebar.portfolio.reporting'), icon: <AssessmentIcon />, resource: 'portfolio_reports' },
    { to: '/portfolio/contributors', label: t('nav:sidebar.portfolio.contributors'), icon: <PeopleIcon />, resource: 'portfolio_settings' },
    { to: '/portfolio/settings', label: t('nav:sidebar.portfolio.settings'), icon: <SettingsIcon />, resource: 'portfolio_settings' },
  ];

  const knowledgeNav: NavEntry[] = [];

  const agentsNav: NavEntry[] = [
    { to: '/agents', label: t('nav:sidebar.agents.overview'), icon: <AutoAwesomeIcon />, resource: 'ai_agents' },
    {
      to: '/agents/approvals',
      label: agentBadgesQuery.data?.pendingApprovals
        ? t('nav:sidebar.agents.approvalsWithCount', { count: agentBadgesQuery.data.pendingApprovals })
        : t('nav:sidebar.agents.approvals'),
      icon: <InboxIcon />,
      resource: 'ai_agents',
      level: 'reader',
    },
    { to: '/agents/activity', label: t('nav:sidebar.agents.activity'), icon: <HistoryIcon />, resource: 'ai_agents' },
    { to: '/agents/shared-context', label: t('nav:sidebar.agents.sharedContext'), icon: <MenuBookIcon />, resource: 'ai_agents', level: 'admin' },
  ];

  const tenantAdminNav: NavEntry[] = [
    { to: '/admin/users', label: t('nav:sidebar.admin.users'), icon: <PeopleIcon />, resource: 'users', level: 'admin' },
    { to: '/admin/roles', label: t('nav:sidebar.admin.roles'), icon: <SecurityIcon />, resource: 'users', level: 'admin' },
    { to: '/admin/data-access', label: t('nav:sidebar.admin.dataAccess'), icon: <LockOutlinedIcon />, resource: 'users', level: 'admin' },
    { to: '/admin/audit-logs', label: t('nav:sidebar.admin.auditLog'), icon: <HistoryIcon />, resource: 'users', level: 'admin' },
    { to: '/admin/billing', label: t('nav:sidebar.admin.billing'), icon: <CreditCardIcon />, resource: 'billing' },
    { to: '/admin/auth', label: t('nav:sidebar.admin.authentication'), icon: <AdminPanelSettingsIcon />, resource: 'users', level: 'admin' },
    { to: '/admin/branding', label: t('nav:sidebar.admin.branding'), icon: <BrushIcon />, resource: 'users', level: 'admin' },
    { divider: t('nav:sidebar.admin.sections.ai') },
    { to: '/admin/ai-models', label: t('nav:sidebar.admin.aiModels'), icon: <StorageIcon />, resource: 'ai_settings', level: 'admin' },
    { to: '/admin/ai', label: t('nav:sidebar.admin.ai'), icon: <AutoAwesomeIcon />, resource: 'ai_settings', level: 'admin' },
    { to: '/admin/ai-usage', label: t('nav:sidebar.admin.aiUsage'), icon: <MonitorHeartIcon />, resource: 'ai_settings', level: 'admin' },
    { divider: t('nav:sidebar.admin.sections.integrations') },
    { to: '/admin/integrations', label: t('nav:sidebar.admin.integrations'), icon: <ExtensionIcon />, resource: 'ai_settings', level: 'admin' },
  ];

  const platformAdminNav: NavEntry[] = [
    { to: '/admin/tenants', label: t('nav:sidebar.platform.tenants'), icon: <ApartmentIcon /> },
    { to: '/admin/coa-templates', label: t('nav:sidebar.platform.coaTemplates'), icon: <StorageIcon /> },
    { to: '/admin/standard-accounts', label: t('nav:sidebar.platform.standardAccounts'), icon: <AccountBalanceIcon /> },
    { divider: '' },
    { to: '/admin/platform-ai', label: t('nav:sidebar.platform.platformAi'), icon: <AutoAwesomeIcon /> },
    { to: '/admin/ops-dashboard', label: t('nav:sidebar.platform.opsDashboard'), icon: <MonitorHeartIcon /> },
    { to: '/admin/scheduled-tasks', label: t('nav:sidebar.platform.scheduledTasks'), icon: <ScheduleIcon /> },
  ];

  const [menuAnchor, setMenuAnchor] = React.useState<null | HTMLElement>(null);
  const openMenu = (e: React.MouseEvent<HTMLElement>) => setMenuAnchor(e.currentTarget);
  const closeMenu = () => setMenuAnchor(null);
  const [aboutOpen, setAboutOpen] = React.useState(false);

  // Check if user has access to any resource in a workspace
  const hasWorkspaceAccess = React.useCallback((ws: string): boolean => {
    if (ws === 'ai') {
      if (!config.features.aiChat) return false;
      // Still listed while the page can say why: the included model waits for a confirmation,
      // or an administrator turned chat off.
      return aiCapabilities.data?.surfaces.chat.available === true
        || chatAwaitsIncludedModelConfirmation(aiCapabilities.data)
        || chatTurnedOffByAdmin(aiCapabilities.data);
    }
    if (ws === 'agents') {
      return canShowAgents;
    }
    if (ws === 'knowledge') {
      return hasLevel('knowledge', 'reader');
    }
    if (claims?.isGlobalAdmin || claims?.isPlatformAdmin) return true;
    if (ws === 'admin' && !isPlatformHost) {
      // The integrations page alone is enough to justify the admin workspace.
      if (canShowIntegrations) return true;
      const requirements = getNavRequirements(tenantAdminNav).filter((entry) => {
        if (entry.resource === 'ai_settings') {
          return aiCapabilities.data?.surfaces.settings.available === true;
        }
        return true;
      });
      if (!config.features.aiSettings) {
        return requirements
          .filter((entry) => entry.resource !== 'ai_settings')
          .some((entry) => hasLevel(entry.resource, entry.level));
      }
      return requirements.some((entry) => hasLevel(entry.resource, entry.level));
    }
    const resources = getNavRequirements(
      ws === 'ops' ? operations
        : ws === 'master-data' ? masterData
          : ws === 'it' ? itOperations
            : ws === 'portfolio' ? portfolioNav
              : ws === 'knowledge' ? knowledgeNav
                : [],
    );
    return resources.some(r => hasLevel(r.resource, r.level));
  }, [hasLevel, claims, config.features.aiChat, config.features.aiSettings, isPlatformHost, aiCapabilities.data, canShowAgents, canShowIntegrations, hasScopedApplicationReaderAccess, shouldHideApplications]);

  // Determine which workspaces are visible
  const visibleWorkspaces = React.useMemo(() => {
    if (isPlatformHost) return ['admin'];
    const all = ['ai', 'agents', 'portfolio', 'knowledge', 'it', 'ops', 'master-data', 'admin'] as const;
    return all.filter(ws => hasWorkspaceAccess(ws));
  }, [isPlatformHost, hasWorkspaceAccess]);

  // The refusal page shows in the section of the address it refused, when the person sees that section.
  const refusedFrom = location.pathname === '/403' ? (location.state as { from?: unknown } | null)?.from : undefined;
  const shownPath = typeof refusedFrom === 'string' && refusedFrom.startsWith('/') && !refusedFrom.startsWith('//')
    && (visibleWorkspaces as readonly string[]).includes(workspaceOfPath(refusedFrom))
    ? refusedFrom
    : location.pathname;

  // Derive active workspace from the current route to keep the top bar highlight in sync
  const workspace: WorkspaceKey | 'home' = React.useMemo(
    () => (isPlatformHost ? 'admin' : workspaceOfPath(shownPath)),
    [shownPath, isPlatformHost],
  );
  const [navOpen, setNavOpen] = React.useState<boolean>(() => {
    // Default to open unless explicitly stored as 'false'
    try {
      return window.localStorage.getItem('navOpen') !== 'false';
    } catch {
      return true;
    }
  });

  React.useEffect(() => {
    try {
      window.localStorage.setItem('navOpen', String(navOpen));
    } catch {}
  }, [navOpen]);

  const themeModeLabel = mode === 'system' ? t('settings:appearance.system') : mode === 'dark' ? t('settings:appearance.dark') : t('settings:appearance.light');
  const themeModeIcon = mode === 'dark'
    ? <DarkModeOutlinedIcon />
    : mode === 'light'
      ? <LightModeOutlinedIcon />
      : <BrightnessAutoIcon />;
  const showHeaderLogo = !!logoUrl && (resolvedMode !== 'dark' || useLogoInDark);

  // Block initial render until AI capabilities resolve, so workspace/admin
  // gating doesn't decide on `undefined` data and hide Plaid tabs. Placed
  // after all hooks to satisfy Rules of Hooks (early return must not skip
  // useState/useCallback/useMemo/useEffect calls above).
  const aiGatingNeeded = config.features.aiChat || config.features.aiSettings;
  const waitingForAiGating = aiGatingNeeded
    && (aiCapabilities.isLoading || (!aiCapabilities.data && aiCapabilities.isFetching));
  const shellReady = !waitingForAiGating && !applicationVisibility.isLoading;

  // Each navigation starts at the top of the page and hands keyboard focus to the page's
  // scroller (see appScroll.ts), so PageDown / Space / arrows work without a click first.
  const pageScrollerRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const scroller = pageScrollerRef.current;
    if (!shellReady || !scroller) return undefined;
    scroller.scrollTop = 0;
    return focusPageScroller(scroller);
  }, [location.pathname, shellReady]);

  if (waitingForAiGating) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    );
  }
  if (applicationVisibility.isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    );
  }

  // workspace is derived from route; no sync to localStorage required

  return (
    <Box sx={{ display: 'flex' }}>
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
        <Toolbar>
          <IconButton
            edge="start"
            onClick={() => setNavOpen((v) => !v)}
            sx={{ mr: 1.5, color: 'text.secondary' }}
            title={navOpen ? t('nav:topBar.collapseNav') : t('nav:topBar.expandNav')}
            aria-label={navOpen ? t('nav:topBar.collapseNav') : t('nav:topBar.expandNav')}
          >
            <MenuIcon />
          </IconButton>
          {showHeaderLogo ? (
            <Box
              component={Link}
              to="/"
              sx={{ display: 'flex', alignItems: 'center', mr: { xs: 1, sm: 3 }, flexShrink: 0, textDecoration: 'none' }}
            >
              <Box
                component="img"
                src={logoUrl || undefined}
                alt={tenantName || 'Logo'}
                sx={{ height: 36, maxWidth: 140, objectFit: 'contain' }}
              />
            </Box>
          ) : (
            <Typography
              variant="h6"
              component={Link}
              to="/"
              sx={{ mr: { xs: 1, sm: 3 }, flexShrink: 0, textDecoration: 'none', color: 'text.primary' }}
            >
              KANAP
            </Typography>
          )}
          {!isPlatformHost && visibleWorkspaces.length > 0 && (
            <Tabs
              // MUI watches the first and last tabs once, on mount, to show each scroll arrow only
              // while that end is out of view. Workspaces that appear later (AI, once its
              // capabilities load) would leave it watching stale tabs: remount on a new set.
              key={visibleWorkspaces.join(',')}
              value={workspace === 'home' ? false : (visibleWorkspaces.includes(workspace) ? workspace : visibleWorkspaces[0])}
              onChange={(_, val) => {
                void guardedLeave(() => navigate(workspaceRoutes[val as WorkspaceKey] ?? workspaceRoutes.admin));
              }}
              // Scrollable rather than centered: on a narrow window centered tabs overflow on
              // both sides and cut the first and last labels. The auto margins centre them
              // while they fit; once they do not, the row scrolls and arrows appear.
              variant="scrollable"
              scrollButtons="auto"
              allowScrollButtonsMobile
              sx={{
                flex: 1,
                minWidth: 0,
                '& .MuiTabs-flexContainer > :first-of-type': { ml: 'auto' },
                '& .MuiTabs-flexContainer > :last-of-type': { mr: 'auto' },
                '& .MuiTabs-scrollButtons': { width: 28, flexShrink: 0, color: 'text.secondary' },
                '& .MuiTab-root': {
                  // Narrower tabs below xl: at 1280 px every section, Plaid included, fits without scrolling.
                  px: { xs: 1.25, xl: 2 },
                  minWidth: { xs: 0, xl: 90 },
                  color: 'text.secondary',
                  minHeight: 48,
                  whiteSpace: 'nowrap',
                  textDecoration: 'none',
                  '&:visited, &:hover, &:active': {
                    textDecoration: 'none',
                  },
                },
                '& .MuiTab-root.Mui-selected': {
                  color: 'text.primary',
                  fontWeight: 500,
                },
                '& .MuiTabs-indicator': {
                  backgroundColor: 'primary.main',
                  height: 2,
                },
              }}
              aria-label={t('nav:topBar.sectionNav')}
            >
              {visibleWorkspaces.includes('ai') && <Tab component={Link} to={workspaceRoutes.ai} value="ai" label={t('nav:workspaces.ai')} />}
              {visibleWorkspaces.includes('agents') && <Tab component={Link} to={workspaceRoutes.agents} value="agents" label={t('nav:workspaces.agents')} />}
              {visibleWorkspaces.includes('portfolio') && <Tab component={Link} to={workspaceRoutes.portfolio} value="portfolio" label={t('nav:workspaces.portfolio')} />}
              {visibleWorkspaces.includes('it') && <Tab component={Link} to={workspaceRoutes.it} value="it" label={t('nav:workspaces.itOperations')} />}
              {visibleWorkspaces.includes('knowledge') && <Tab component={Link} to={workspaceRoutes.knowledge} value="knowledge" label={t('nav:workspaces.knowledge')} />}
              {visibleWorkspaces.includes('ops') && <Tab component={Link} to={workspaceRoutes.ops} value="ops" label={t('nav:workspaces.budgetManagement')} />}
              {visibleWorkspaces.includes('master-data') && <Tab component={Link} to={workspaceRoutes['master-data']} value="master-data" label={t('nav:workspaces.masterData')} />}
              {visibleWorkspaces.includes('admin') && <Tab component={Link} to={workspaceRoutes.admin} value="admin" label={t('nav:workspaces.admin')} />}
            </Tabs>
          )}
          {isPlatformHost && <Box sx={{ flex: 1 }} />}
          {token && (
            <>
              <TrialChip />
              <IconButton
                size="small"
                sx={{ color: 'text.secondary' }}
                onClick={() => window.open(getDocUrl(location.pathname, locale, location.search), '_blank', 'noopener,noreferrer')}
                title={t('nav:topBar.help')}
                aria-label={t('nav:topBar.openDocs')}
              >
                <HelpOutlineIcon />
              </IconButton>
              <Tooltip title={t('nav:topBar.themeTooltip', { mode: themeModeLabel })}>
                <IconButton
                  size="small"
                  sx={{ color: 'text.secondary' }}
                  onClick={() => setMode(mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light')}
                  aria-label={t('nav:topBar.themeLabel', { mode: themeModeLabel })}
                >
                  {themeModeIcon}
                </IconButton>
              </Tooltip>
              <IconButton onClick={openMenu} size="small" sx={{ color: 'text.secondary' }} title={t('nav:topBar.account')}>
                <AccountCircleIcon />
              </IconButton>
              <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={closeMenu} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
                <Box sx={{ px: 2, py: 1, minWidth: 200 }}>
                  {accountLabel ? (
                    <Typography variant="subtitle2" fontWeight={500}>
                      {accountLabel}
                    </Typography>
                  ) : null}
                  {accountEmail && accountEmail !== accountLabel ? (
                    <Typography variant="caption" color="text.secondary">
                      {accountEmail}
                    </Typography>
                  ) : null}
                  <TrialMenuLine onNavigate={closeMenu} />
                </Box>
                <Divider sx={{ my: 0.5 }} />
                <MenuItem onClick={() => { closeMenu(); void guardedLeave(() => navigate('/settings')); }}>{t('nav:userMenu.myProfile')}</MenuItem>
                <MenuItem onClick={() => { closeMenu(); void guardedLeave(logout); }}>{t('nav:userMenu.logout')}</MenuItem>
                <Divider sx={{ my: 0.5 }} />
                <MenuItem onClick={() => { closeMenu(); setAboutOpen(true); }} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                  {t('settings:about.title')}
                  {config.version !== 'unknown' && (
                    <Typography component="span" variant="caption" color="text.secondary">{config.version}</Typography>
                  )}
                </MenuItem>
              </Menu>
              <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
            </>
          )}
        </Toolbar>
      </AppBar>

      {workspace !== 'home' && workspace !== 'knowledge' && workspace !== 'ai' && <Drawer
        variant="permanent"
        sx={{
          width: (theme) => (navOpen ? drawerWidth : `calc(${theme.spacing(7)} + 1px)`),
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: (theme) => ({
            width: navOpen ? drawerWidth : `calc(${theme.spacing(7)} + 1px)`,
            boxSizing: 'border-box',
            overflowX: 'hidden',
            transition: theme.transitions.create('width', {
              easing: theme.transitions.easing.sharp,
              duration: navOpen ? theme.transitions.duration.enteringScreen : theme.transitions.duration.leavingScreen,
            }),
          }),
        }}
      >
        <Toolbar />
        <Box sx={{ overflowY: 'auto', overflowX: 'hidden' }}>
          {(() => {
            // Determine which nav entries to render
            let entries: NavEntry[];
            if (workspace === 'admin') {
              const base = isPlatformHost && !isSingleTenant ? platformAdminNav : tenantAdminNav;
              const aiAdminRoutes = ['/admin/ai', '/admin/ai-models', '/admin/ai-usage'];
              entries = base.filter((entry) => {
                if (!isNavItem(entry)) return true;
                if (entry.to === '/admin/billing' && !config.features.billing) return false;
                if (entry.to === '/admin/auth' && !config.features.sso) return false;
                if (entry.to === '/admin/integrations') return canShowIntegrations;
              // Administration shows only when one of its pages can be used.
              if (entry.to === '/ops/operations') return canUseAnyOperation(hasLevel, dataAccessLimited);
                if (aiAdminRoutes.includes(entry.to) && !aiSettingsAvailable) return false;
                return true;
              });
              // Sample data (cloud workspaces): the Administrator role, after Branding.
              if (!isPlatformHost && !isSingleTenant && config.features.sampleData && claims?.isGlobalAdmin) {
                const at = entries.findIndex((entry) => isNavItem(entry) && entry.to === '/admin/branding');
                const item: NavEntry = { to: '/admin/sample-data', label: t('nav:sidebar.admin.sampleData'), icon: <DatasetIcon /> };
                entries = at >= 0 ? [...entries.slice(0, at + 1), item, ...entries.slice(at + 1)] : [...entries, item];
              }
              // In single-tenant mode, append Scheduled Tasks for admin users
              if (isSingleTenant && claims?.isGlobalAdmin) {
                entries = [...entries, { to: '/admin/scheduled-tasks', label: t('nav:sidebar.platform.scheduledTasks'), icon: <ScheduleIcon /> }];
              }
            } else if (isPlatformHost) {
              entries = [];
            } else {
              const navMap: Record<string, NavEntry[]> = {
                ops: operations,
                'master-data': masterData,
                it: itOperations,
                agents: agentsNav,
                portfolio: portfolioNav,
                knowledge: knowledgeNav,
              };
              entries = navMap[workspace] || [];
            }

            // Filter items by permission (dividers pass through)
            const permitted = entries.filter((entry) => {
              if (!isNavItem(entry)) return true;
              if (entry.to === '/admin/integrations') return canShowIntegrations;
              // Administration shows only when one of its pages can be used.
              if (entry.to === '/ops/operations') return canUseAnyOperation(hasLevel, dataAccessLimited);
              if (['/admin/ai', '/admin/ai-models', '/admin/ai-usage'].includes(entry.to)) {
                return aiCapabilities.data?.surfaces.settings.available === true;
              }
              // A limited person sees none of the data-access administration, even a global admin.
              if (entry.to === '/admin/data-access' && dataAccessLimited) return false;
              const grants = itemGrants(entry);
              return grants.length === 0 || grants.some((grant) => hasLevel(grant.resource, grant.level ?? 'reader'));
            });
            // Drop group headers whose items were all filtered out.
            const visible = permitted.filter((entry, idx) => {
              if (isNavItem(entry)) return true;
              const next = permitted[idx + 1];
              return next !== undefined && isNavItem(next);
            });
            // One item selected: the one whose path matches the page most closely, so a section's
            // home (`/ops`) is not selected on every page under it (`/ops/budget`).
            // A form opened from another page of the app (`returnTo`, a contact created from a
            // supplier) keeps that page's entry selected.
            const returnTo = new URLSearchParams(location.search).get('returnTo');
            const navPath = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')
              ? returnTo.split(/[?#]/)[0]
              : shownPath;
            const matches = (to: string) => navPath === to || navPath.startsWith(to + '/')
              || (to === '/ops/budget' && /^\/ops\/(opex|capex)(\/|$)/.test(navPath));
            const selectedTo = visible.filter(isNavItem).map((entry) => entry.to).filter(matches)
              .reduce<string | null>((best, to) => (best == null || to.length > best.length ? to : best), null);

            return (
              <List>
                {visible.map((entry, idx) => {
                  // Render dividers
                  if (!isNavItem(entry)) {
                    if (!navOpen) return null;
                    if (entry.divider) {
                      return (
                        <ListSubheader
                          key={`divider-${idx}`}
                          sx={{
                            lineHeight: '16px',
                            fontSize: '0.6875rem',
                            fontWeight: 500,
                            color: 'text.secondary',
                            textTransform: 'none',
                            letterSpacing: 0,
                            pt: idx === 0 ? 1 : '18px',
                            pb: '10px',
                            px: '18px',
                          }}
                        >
                          {entry.divider}
                        </ListSubheader>
                      );
                    }
                    return <Divider key={`divider-${idx}`} sx={{ my: '8px', mx: 1 }} />;
                  }

                  // Render nav items
                  const button = (
                    <ListItemButton
                      key={entry.to}
                      component={Link}
                      to={entry.to}
                      selected={entry.to === selectedTo}
                      sx={{
                        justifyContent: navOpen ? 'initial' : 'center',
                        px: navOpen ? 1.5 : 2.5,
                      }}
                    >
                      <ListItemIcon sx={{
                        minWidth: 0,
                        mr: navOpen ? 1.5 : 'auto',
                        justifyContent: 'center',
                        '& .MuiSvgIcon-root': { fontSize: '1.3rem' },
                      }}>
                        {entry.icon}
                      </ListItemIcon>
                      {navOpen && <ListItemText primary={entry.label} primaryTypographyProps={{ variant: 'body1' }} />}
                    </ListItemButton>
                  );
                  return navOpen ? (
                    button
                  ) : (
                    <Tooltip key={entry.to} title={entry.label} placement="right">
                      <Box>{button}</Box>
                    </Tooltip>
                  );
                })}
              </List>
            );
          })()}
        </Box>
      </Drawer>}

      {/* The shell is exactly one viewport tall and the page scrolls inside `kanap-app-scroll`,
          not the window. That bounded height is what lets a workspace root (`height: 100%`)
          keep its topbar and title in place while its content column scrolls. Ordinary pages
          are flex items that never shrink, so they keep their natural height and scroll in
          the same container. print.css unbinds both boxes so a report prints in full. */}
      <Box
        component="main"
        className="kanap-app-main"
        sx={{ flexGrow: 1, height: '100dvh', display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}
      >
        <Toolbar sx={{ flexShrink: 0 }} />
        {/* Another page is loading behind this one: a thin bar under the top bar, shown only
            when the wait lasts, so a quick move shows nothing. */}
        {pagePending && (
          <Box sx={{ position: 'relative', height: 0, flexShrink: 0, zIndex: 1 }}>
            <LinearProgress
              aria-label={t('common:status.loading')}
              sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, opacity: 0, animation: `${appearLater} 0s 300ms forwards` }}
            />
          </Box>
        )}
        {config.features.billing && <SubscriptionBanner />}
        <Box
          ref={pageScrollerRef}
          className="kanap-app-scroll"
          tabIndex={-1}
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            outline: 'none',
            p: 2,
            display: 'flex',
            flexDirection: 'column',
            // Zero specificity (`:where`), so a page root that sets its own `flex` (the map
            // pages' `flex: 1, minHeight: 0`) always wins, whatever the order in which emotion
            // inserted the two rules.
            ':where(&) > *': { flexShrink: 0 },
          }}
        >
          {/* Pages are code-split: this keeps the nav shell on screen while a route chunk
              loads, instead of unmounting to the full-page spinner in App. */}
          <React.Suspense
            fallback={
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
                <CircularProgress size={28} />
              </Box>
            }
          >
            <Outlet />
          </React.Suspense>
        </Box>
      </Box>
      {/* The previous in-app address, where a cancelled creation returns. */}
      <NavigationTracker />
      {/* The name prompt is mounted last, so it comes first when both are open. */}
      <FirstOpenDialog />
      <StepHint />
      <NamePromptDialog />
    </Box>
  );
}
