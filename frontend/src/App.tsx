import React, { Suspense } from 'react';
import { Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from './auth/AuthContext';
const DashboardPage = React.lazy(() => import('./pages/DashboardPage'));
const ForbiddenPage = React.lazy(() => import('./pages/ForbiddenPage'));
const LoginPage = React.lazy(() => import('./pages/LoginPage'));
const ForgotPasswordPage = React.lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = React.lazy(() => import('./pages/ResetPasswordPage'));
const AcceptInvitePage = React.lazy(() => import('./pages/AcceptInvitePage'));
const OpexListPage = React.lazy(() => import('./pages/OpexListPage'));
const SpendItemPage = React.lazy(() => import('./pages/opex/SpendItemPage'));
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
const CompaniesPage = React.lazy(() => import('./pages/CompaniesPage'));
const CompanyWorkspacePage = React.lazy(() => import('./pages/companies/CompanyWorkspacePage'));
const DepartmentsPage = React.lazy(() => import('./pages/DepartmentsPage'));
const DepartmentWorkspacePage = React.lazy(() => import('./pages/departments/DepartmentWorkspacePage'));
const SuppliersPage = React.lazy(() => import('./pages/SuppliersPage'));
const SupplierWorkspacePage = React.lazy(() => import('./pages/suppliers/SupplierWorkspacePage'));
const AccountWorkspacePage = React.lazy(() => import('./pages/accounts/AccountWorkspacePage'));
const UsersPage = React.lazy(() => import('./pages/UsersPage'));
const CapexPage = React.lazy(() => import('./pages/CapexPage'));
const ProjectsPage = React.lazy(() => import('./pages/ProjectsPage'));
const CapexItemPage = React.lazy(() => import('./pages/capex/CapexItemPage'));
const AnalyticsCategoriesPage = React.lazy(() => import('./pages/AnalyticsCategoriesPage'));
const AnalyticsWorkspacePage = React.lazy(() => import('./pages/analytics/AnalyticsWorkspacePage'));
const ReportsLandingPage = React.lazy(() => import('./pages/reports/ReportsLandingPage'));
const TopOpexReport = React.lazy(() => import('./pages/reports/TopOpexReport'));
const OpexDeltaReport = React.lazy(() => import('./pages/reports/OpexDeltaReport'));
const ComparisonReport = React.lazy(() => import('./pages/reports/ComparisonReport'));
const CapexBudgetTrendReport = React.lazy(() => import('./pages/reports/CapexBudgetTrendReport'));
const BudgetColumnsCompareReport = React.lazy(() => import('./pages/reports/BudgetColumnsCompareReport'));
const ConsolidationReport = React.lazy(() => import('./pages/reports/ConsolidationReport'));
const AnalyticsCategoryReport = React.lazy(() => import('./pages/reports/AnalyticsCategoryReport'));
const GlobalChargebackReport = React.lazy(() => import('./pages/reports/GlobalChargebackReport'));
const CompanyChargebackReport = React.lazy(() => import('./pages/reports/CompanyChargebackReport'));
const ContractsPage = React.lazy(() => import('./pages/ContractsPage'));
const ContractWorkspacePage = React.lazy(() => import('./pages/contracts/ContractWorkspacePage'));
const BudgetOperationsLandingPage = React.lazy(() => import('./pages/operations/BudgetOperationsLandingPage'));
const CopyBudgetColumnsPage = React.lazy(() => import('./pages/operations/CopyBudgetColumnsPage'));
const BudgetColumnResetPage = React.lazy(() => import('./pages/operations/BudgetColumnResetPage'));
const BudgetFreezePage = React.lazy(() => import('./pages/operations/BudgetFreezePage'));
const CopyAllocationsPage = React.lazy(() => import('./pages/operations/CopyAllocationsPage'));
const AllocationDefaultPage = React.lazy(() => import('./pages/operations/AllocationDefaultPage'));
const CurrencySettingsPage = React.lazy(() => import('./pages/operations/CurrencySettingsPage'));
const BudgetRowsPage = React.lazy(() => import('./pages/operations/BudgetRowsPage'));
const BudgetColumnsSettingsPage = React.lazy(() => import('./pages/operations/BudgetColumnsSettingsPage'));
const TasksPage = React.lazy(() => import('./pages/TasksPage'));
const TaskWorkspacePage = React.lazy(() => import('./pages/tasks/TaskWorkspacePage'));
const ContactsPage = React.lazy(() => import('./pages/ContactsPage'));
const ContactWorkspacePage = React.lazy(() => import('./pages/contacts/ContactWorkspacePage'));
const BillingCenter = React.lazy(() => import('./pages/admin/BillingCenter'));
const AdminLanding = React.lazy(() => import('./pages/admin/AdminLanding'));
const RolesPage = React.lazy(() => import('./pages/admin/RolesPage'));
const AuditLogsPage = React.lazy(() => import('./pages/admin/AuditLogsPage'));
const AdminTenantsPage = React.lazy(() => import('./pages/admin/AdminTenantsPage'));
const AdminCoaTemplatesPage = React.lazy(() => import('./pages/admin/AdminCoaTemplatesPage'));
const AdminStandardAccountsPage = React.lazy(() => import('./pages/admin/AdminStandardAccountsPage'));
const AdminStandardAccountWorkspacePage = React.lazy(() => import('./pages/admin/AdminStandardAccountWorkspacePage'));
const MasterDataOperationsPage = React.lazy(() => import('./pages/admin/MasterDataOperationsPage'));
const MasterDataFreezePage = React.lazy(() => import('./pages/admin/master-data/MasterDataFreezePage'));
const MasterDataCopyPage = React.lazy(() => import('./pages/admin/master-data/MasterDataCopyPage'));
const MasterDataHomePage = React.lazy(() => import('./pages/admin/MasterDataHomePage'));
import { useTenant } from './tenant/TenantContext';
import { FeaturesProvider, useFeatures } from './config/FeaturesContext';
const CoaPage = React.lazy(() => import('./pages/coa/CoaPage'));
const ApplicationsPage = React.lazy(() => import('./pages/it/ApplicationsPage'));
const ApplicationWorkspacePage = React.lazy(() => import('./pages/it/ApplicationWorkspacePage'));
const InterfacesPage = React.lazy(() => import('./pages/it/InterfacesPage'));
const InterfaceWorkspacePage = React.lazy(() => import('./pages/it/InterfaceWorkspacePage'));
const InterfaceMapPage = React.lazy(() => import('./pages/it/InterfaceMapPage'));
const ConnectionMapPage = React.lazy(() => import('./pages/it/ConnectionMapPage'));
const ItOperationsSettingsPage = React.lazy(() => import('./pages/it/ItOperationsSettingsPage'));
const ConnectionsPage = React.lazy(() => import('./pages/it/ConnectionsPage'));
const ConnectionWorkspacePage = React.lazy(() => import('./pages/it/ConnectionWorkspacePage'));
const LocationsPage = React.lazy(() => import('./pages/it/LocationsPage'));
const LocationWorkspacePage = React.lazy(() => import('./pages/it/LocationWorkspacePage'));
const AssetsPage = React.lazy(() => import('./pages/it/AssetsPage'));
const AssetWorkspacePage = React.lazy(() => import('./pages/it/AssetWorkspacePage'));
const IncidentsPage = React.lazy(() => import('./pages/it/IncidentsPage'));
const NetboxSyncPage = React.lazy(() => import('./pages/it/NetboxSyncPage'));
const IncidentWorkspacePage = React.lazy(() => import('./pages/it/IncidentWorkspacePage'));
const BusinessProcessesPage = React.lazy(() => import('./pages/BusinessProcessesPage'));
const BusinessProcessWorkspacePage = React.lazy(() => import('./pages/business-processes/BusinessProcessWorkspacePage'));
const LoginCallbackPage = React.lazy(() => import('./pages/LoginCallbackPage'));
const AdminAuthPage = React.lazy(() => import('./pages/admin/AdminAuthPage'));
const OpsDashboardPage = React.lazy(() => import('./pages/admin/OpsDashboardPage'));
const PortfolioRequestsPage = React.lazy(() => import('./pages/portfolio/RequestsPage'));
const PortfolioRequestWorkspacePage = React.lazy(() => import('./pages/portfolio/RequestWorkspacePage'));
const PortfolioProjectsPage = React.lazy(() => import('./pages/portfolio/ProjectsPage'));
const PortfolioProjectWorkspacePage = React.lazy(() => import('./pages/portfolio/ProjectWorkspacePage'));
const PortfolioPlanningPage = React.lazy(() => import('./pages/portfolio/PlanningPage'));
const PortfolioReportsPage = React.lazy(() => import('./pages/portfolio/ReportsPage'));
const CapacityHeatmapReport = React.lazy(() => import('./pages/portfolio/CapacityHeatmapReport'));
const WeeklyReport = React.lazy(() => import('./pages/portfolio/WeeklyReport'));
const FlowReport = React.lazy(() => import('./pages/portfolio/FlowReport'));
const ByAssigneeReport = React.lazy(() => import('./pages/portfolio/ByAssigneeReport'));
const UpcomingReport = React.lazy(() => import('./pages/portfolio/UpcomingReport'));
const TimeLoggedReport = React.lazy(() => import('./pages/portfolio/TimeLoggedReport'));
const PortfolioSettingsPage = React.lazy(() => import('./pages/portfolio/SettingsPage'));
const PortfolioContributorsPage = React.lazy(() => import('./pages/portfolio/ContributorsPage'));
const PortfolioContributorWorkspacePage = React.lazy(() => import('./pages/portfolio/ContributorWorkspacePage'));
const WorkspaceDashboardPage = React.lazy(() =>
  import('./pages/workspace').then((m) => ({ default: m.WorkspaceDashboardPage })),
);
const SettingsPage = React.lazy(() => import('./pages/settings/SettingsPage'));
const AdminBrandingPage = React.lazy(() => import('./pages/admin/AdminBrandingPage'));
const KnowledgePage = React.lazy(() => import('./pages/knowledge/KnowledgePage'));
const KnowledgeWorkspacePage = React.lazy(() => import('./pages/knowledge/KnowledgeWorkspacePage'));
const AiWorkspacePage = React.lazy(() => import('./pages/ai/AiWorkspacePage'));
const AgentsOverviewPage = React.lazy(() => import('./pages/agents/AgentsOverviewPage'));
const AgentsApprovalsPage = React.lazy(() => import('./pages/agents/AgentsApprovalsPage'));
const AgentsActivityPage = React.lazy(() => import('./pages/agents/AgentsActivityPage'));
const AgentWorkspacePage = React.lazy(() => import('./pages/agents/AgentWorkspacePage'));
const SharedContextProfilesPage = React.lazy(() => import('./pages/agents/SharedContextProfilesPage'));
const AdminAiPage = React.lazy(() => import('./pages/admin/AdminAiPage'));
const AdminAiModelsPage = React.lazy(() => import('./pages/admin/AdminAiModelsPage'));
const AdminAiUsagePage = React.lazy(() => import('./pages/admin/AdminAiUsagePage'));
const AdminIntegrationsPage = React.lazy(() => import('./pages/admin/AdminIntegrationsPage'));
const AdminPlatformAiPage = React.lazy(() => import('./pages/admin/AdminPlatformAiPage'));
const ScheduledTasksPage = React.lazy(() => import('./pages/admin/ScheduledTasksPage'));
import { useAiCapabilities } from './ai/useAiCapabilities';
import { useBusinessContributorApplicationVisibility } from './hooks/useBusinessContributorApplicationVisibility';

function HomeRoute() {
  const { isPlatformHost } = useTenant();
  if (isPlatformHost) return <Navigate to="/admin/tenants" replace />;
  return <WorkspaceDashboardPage />;
}

function AdminDefaultRedirect() {
  const { hasLevel } = useAuth();
  const { config } = useFeatures();
  const { isPlatformHost } = useTenant();
  const aiCapabilities = useAiCapabilities();

  if (isPlatformHost) return <Navigate to="/admin/tenants" replace />;
  if (hasLevel('users', 'admin')) return <Navigate to="/admin/users" replace />;
  if (config.features.aiSettings && hasLevel('ai_settings', 'admin') && !aiCapabilities.data && aiCapabilities.isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <CircularProgress />
      </Box>
    );
  }
  if (config.features.aiSettings && aiCapabilities.data?.surfaces.settings.available === true) {
    return <Navigate to="/admin/ai" replace />;
  }
  if (config.features.billing && hasLevel('billing', 'reader')) return <Navigate to="/admin/billing" replace />;
  return <Navigate to="/403" replace />;
}

function PortfolioDefaultRedirect() {
  const { hasLevel } = useAuth();
  if (hasLevel('tasks', 'reader')) return <Navigate to="/portfolio/tasks" replace />;
  if (hasLevel('portfolio_requests', 'reader')) return <Navigate to="/portfolio/requests" replace />;
  if (hasLevel('portfolio_projects', 'reader')) return <Navigate to="/portfolio/projects" replace />;
  if (hasLevel('portfolio_planning', 'reader')) return <Navigate to="/portfolio/planning" replace />;
  if (hasLevel('portfolio_reports', 'reader')) return <Navigate to="/portfolio/reports" replace />;
  if (hasLevel('portfolio_settings', 'reader')) return <Navigate to="/portfolio/settings" replace />;
  return <Navigate to="/portfolio/tasks" replace />;
}

function ItDefaultRedirect() {
  const { hasLevel } = useAuth();
  const applicationVisibility = useBusinessContributorApplicationVisibility();
  if (hasLevel('locations', 'reader')) return <Navigate to="/it/locations" replace />;
  if (hasLevel('infrastructure', 'reader')) return <Navigate to="/it/assets" replace />;
  if (hasLevel('applications', 'reader')) {
    if (applicationVisibility.hasScopedApplicationReaderAccess) {
      if (applicationVisibility.isLoading) {
        return (
          <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
            <CircularProgress />
          </Box>
        );
      }
      if (!applicationVisibility.shouldHideApplications) {
        return <Navigate to="/it/applications" replace />;
      }
    } else {
      return <Navigate to="/it/applications" replace />;
    }
  }
  if (hasLevel('settings', 'reader')) return <Navigate to="/it/settings" replace />;
  return <Navigate to="/403" replace />;
}

function LegacyTaskRedirect() {
  const { id, tab } = useParams();
  const [sp] = useSearchParams();
  const qs = sp.toString();
  const to = id
    ? `/portfolio/tasks/${id}${tab ? `/${tab}` : ''}${qs ? `?${qs}` : ''}`
    : '/portfolio/tasks';
  return <Navigate to={to} replace />;
}

function LegacyAccountsRedirect() {
  const [sp] = useSearchParams();
  const next = new URLSearchParams(sp);
  const coaId = next.get('coaId');
  if (coaId && !next.get('selected')) {
    next.set('selected', coaId);
  }
  next.delete('coaId');
  const qs = next.toString();
  return <Navigate to={`/master-data/coa${qs ? `?${qs}` : ''}`} replace />;
}

/** Full-page fallback while a route chunk loads or the feature config is fetched. */
function RouteLoadingFallback() {
  return (
    <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
      <CircularProgress />
    </Box>
  );
}

function AppRoutes() {
  const { token } = useAuth();
  const { config, isLoading: featuresLoading } = useFeatures();
  const isSingleTenant = config.deploymentMode === 'single-tenant';
  if (featuresLoading) {
    return <RouteLoadingFallback />;
  }
  return (
    // Pages are code-split, so the public routes (which render outside Layout) need a
    // boundary. The authenticated ones get a second, inner one around Layout's <Outlet />,
    // so navigating between them keeps the shell on screen instead of flashing this.
    <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/login/callback" element={<LoginCallbackPage />} />
        <Route path="/forgot-password" element={config.features.email ? <ForgotPasswordPage /> : <Navigate to="/login" replace />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/ops" element={<DashboardPage />} />
          <Route path="/ops/opex" element={<OpexListPage />} />
          <Route path="/ops/opex/:id" element={<SpendItemPage />} />
          <Route path="/ops/opex/:id/:tab" element={<SpendItemPage />} />
          <Route path="/ops/capex" element={<CapexPage />} />
          <Route path="/ops/capex/:id" element={<CapexItemPage />} />
          <Route path="/ops/capex/:id/:tab" element={<CapexItemPage />} />
          <Route path="/ops/contracts" element={<ContractsPage />} />
          <Route path="/ops/contracts/:id" element={<ContractWorkspacePage />} />
          <Route path="/ops/contracts/:id/:tab" element={<ContractWorkspacePage />} />
          {/* Legacy ops/tasks routes - redirect to portfolio/tasks */}
          <Route path="/ops/tasks" element={<Navigate to="/portfolio/tasks" replace />} />
          <Route path="/ops/tasks/:id" element={<LegacyTaskRedirect />} />
          <Route path="/ops/tasks/:id/:tab" element={<LegacyTaskRedirect />} />
          <Route path="/it/assets" element={<AssetsPage />} />
          <Route path="/it/assets/:id" element={<AssetWorkspacePage />} />
          <Route path="/it/assets/:id/:tab" element={<AssetWorkspacePage />} />
          <Route path="/it/incidents" element={<IncidentsPage />} />
          <Route path="/it/incidents/:id" element={<IncidentWorkspacePage />} />
          <Route path="/it/incidents/:id/:tab" element={<IncidentWorkspacePage />} />
          <Route path="/ops/reports" element={<ReportsLandingPage />} />
          <Route path="/ops/reports/chargeback" element={<Navigate to="/ops/reports/chargeback/global" replace />} />
          <Route path="/ops/reports/chargeback/global" element={<GlobalChargebackReport />} />
          <Route path="/ops/reports/chargeback/company" element={<CompanyChargebackReport />} />
          <Route path="/ops/reports/top-opex" element={<TopOpexReport />} />
          <Route path="/ops/reports/opex-delta" element={<OpexDeltaReport />} />
          <Route path="/ops/reports/comparison" element={<ComparisonReport />} />
          <Route path="/ops/reports/capex/trend" element={<CapexBudgetTrendReport />} />
          <Route path="/ops/reports/budget-columns-compare" element={<BudgetColumnsCompareReport />} />
          <Route path="/ops/reports/consolidation" element={<ConsolidationReport />} />
          <Route path="/ops/reports/analytics" element={<AnalyticsCategoryReport />} />
          <Route path="/ops/operations" element={<BudgetOperationsLandingPage />} />
          <Route path="/ops/operations/copy-budget-columns" element={<CopyBudgetColumnsPage />} />
          <Route path="/ops/operations/column-init" element={<CopyBudgetColumnsPage />} />
          <Route path="/ops/operations/copy-allocations" element={<CopyAllocationsPage />} />
          <Route path="/ops/operations/column-reset" element={<BudgetColumnResetPage />} />
          <Route path="/ops/operations/freeze" element={<BudgetFreezePage />} />
          <Route path="/ops/operations/allocation-default" element={<AllocationDefaultPage />} />
          <Route path="/ops/operations/budget-rows" element={<BudgetRowsPage />} />
          <Route path="/ops/operations/columns" element={<BudgetColumnsSettingsPage />} />
          {/* Currency Settings moved under Master Data */}
          <Route path="/master-data" element={<MasterDataHomePage />} />
          <Route path="/master-data/coa" element={<CoaPage />} />
          <Route path="/master-data/companies" element={<CompaniesPage />} />
          <Route path="/master-data/companies/:id" element={<CompanyWorkspacePage />} />
          <Route path="/master-data/companies/:id/:tab" element={<CompanyWorkspacePage />} />
          <Route path="/master-data/departments" element={<DepartmentsPage />} />
          <Route path="/master-data/departments/:id" element={<DepartmentWorkspacePage />} />
          <Route path="/master-data/departments/:id/:tab" element={<DepartmentWorkspacePage />} />
          <Route path="/master-data/suppliers" element={<SuppliersPage />} />
          <Route path="/master-data/suppliers/:id" element={<SupplierWorkspacePage />} />
          <Route path="/master-data/suppliers/:id/:tab" element={<SupplierWorkspacePage />} />
          <Route path="/master-data/contacts" element={<ContactsPage />} />
          <Route path="/master-data/contacts/:id" element={<ContactWorkspacePage />} />
          <Route path="/master-data/contacts/:id/:tab" element={<ContactWorkspacePage />} />
          <Route path="/master-data/accounts" element={<LegacyAccountsRedirect />} />
          <Route path="/master-data/accounts/:id" element={<AccountWorkspacePage />} />
          <Route path="/master-data/accounts/:id/:tab" element={<AccountWorkspacePage />} />
          <Route path="/master-data/analytics" element={<AnalyticsCategoriesPage />} />
          <Route path="/master-data/analytics/:id" element={<AnalyticsWorkspacePage />} />
          <Route path="/master-data/analytics/:id/:tab" element={<AnalyticsWorkspacePage />} />
          <Route path="/master-data/currency" element={<CurrencySettingsPage />} />
          <Route path="/master-data/business-processes" element={<BusinessProcessesPage />} />
          <Route path="/master-data/business-processes/:id" element={<BusinessProcessWorkspacePage />} />
          <Route path="/master-data/business-processes/:id/:tab" element={<BusinessProcessWorkspacePage />} />
          <Route path="/master-data/operations" element={<MasterDataOperationsPage />} />
          <Route path="/master-data/operations/freeze" element={<MasterDataFreezePage />} />
          <Route path="/master-data/operations/copy" element={<MasterDataCopyPage />} />
          <Route path="/admin" element={<AdminDefaultRedirect />} />
          <Route path="/admin/users" element={<UsersPage />} />
          <Route path="/admin/roles" element={<RolesPage />} />
          <Route path="/admin/audit-logs" element={<AuditLogsPage />} />
          {config.features.billing && <Route path="/admin/billing" element={<BillingCenter />} />}
          {config.features.billing && <Route path="/admin/choose-plan" element={<Navigate to="/admin/billing" replace />} />}
          {config.features.sso && <Route path="/admin/auth" element={<AdminAuthPage />} />}
          <Route path="/admin/ai" element={<AdminAiPage />} />
          <Route path="/admin/ai-models" element={<AdminAiModelsPage />} />
          <Route path="/admin/ai-usage" element={<AdminAiUsagePage />} />
          <Route path="/admin/agent-control" element={<Navigate to="/agents" replace />} />
          <Route path="/admin/agent-control/*" element={<Navigate to="/agents" replace />} />
          <Route path="/admin/integrations" element={<AdminIntegrationsPage />} />
          {!isSingleTenant && <Route path="/admin/platform-ai" element={<AdminPlatformAiPage />} />}
          <Route path="/admin/branding" element={<AdminBrandingPage />} />
          <Route path="/admin/scheduled-tasks" element={<ScheduledTasksPage />} />
          {!isSingleTenant && <Route path="/admin/ops-dashboard" element={<OpsDashboardPage />} />}
          {!isSingleTenant && <Route path="/admin/tenants" element={<AdminTenantsPage />} />}
          {!isSingleTenant && <Route path="/admin/coa-templates" element={<AdminCoaTemplatesPage />} />}
          {!isSingleTenant && <Route path="/admin/standard-accounts" element={<AdminStandardAccountsPage />} />}
          {!isSingleTenant && <Route path="/admin/standard-accounts/:templateId/:id" element={<AdminStandardAccountWorkspacePage />} />}
          {!isSingleTenant && <Route path="/admin/standard-accounts/:templateId/:id/:tab" element={<AdminStandardAccountWorkspacePage />} />}
          {!isSingleTenant && <Route path="/admin/standard-accounts/:templateId/:id/*" element={<AdminStandardAccountWorkspacePage />} />}
          {/* IT Landscape */}
          <Route path="/it" element={<ItDefaultRedirect />} />
          <Route path="/it/locations" element={<LocationsPage />} />
          <Route path="/it/locations/:id" element={<LocationWorkspacePage />} />
          <Route path="/it/locations/:id/:tab" element={<LocationWorkspacePage />} />
          <Route path="/it/applications" element={<ApplicationsPage />} />
          <Route path="/it/applications/:id" element={<ApplicationWorkspacePage />} />
          <Route path="/it/applications/:id/:tab" element={<ApplicationWorkspacePage />} />
          <Route path="/it/connections" element={<ConnectionsPage />} />
          <Route path="/it/connections/:id" element={<ConnectionWorkspacePage />} />
          <Route path="/it/connections/:id/:tab" element={<ConnectionWorkspacePage />} />
          <Route path="/it/interfaces" element={<InterfacesPage />} />
          <Route path="/it/interfaces/:id" element={<InterfaceWorkspacePage />} />
          <Route path="/it/interfaces/:id/:tab" element={<InterfaceWorkspacePage />} />
          <Route path="/it/interface-map" element={<InterfaceMapPage />} />
          <Route path="/it/connection-map" element={<ConnectionMapPage />} />
          <Route path="/it/netbox" element={<NetboxSyncPage />} />
          <Route path="/it/settings" element={<ItOperationsSettingsPage />} />
          {/* Portfolio */}
          <Route path="/portfolio" element={<PortfolioDefaultRedirect />} />
          <Route path="/portfolio/requests" element={<PortfolioRequestsPage />} />
          <Route path="/portfolio/requests/:id" element={<PortfolioRequestWorkspacePage />} />
          <Route path="/portfolio/requests/:id/:tab" element={<PortfolioRequestWorkspacePage />} />
          <Route path="/portfolio/projects" element={<PortfolioProjectsPage />} />
          <Route path="/portfolio/projects/:id" element={<PortfolioProjectWorkspacePage />} />
          <Route path="/portfolio/projects/:id/:tab" element={<PortfolioProjectWorkspacePage />} />
          <Route path="/portfolio/planning" element={<PortfolioPlanningPage />} />
          <Route path="/portfolio/reports" element={<PortfolioReportsPage />} />
          <Route path="/portfolio/reports/capacity-heatmap" element={<CapacityHeatmapReport />} />
          <Route path="/portfolio/reports/weekly" element={<WeeklyReport />} />
          <Route path="/portfolio/reports/flow" element={<FlowReport />} />
          <Route path="/portfolio/reports/by-assignee" element={<ByAssigneeReport />} />
          <Route path="/portfolio/reports/upcoming" element={<UpcomingReport />} />
          <Route path="/portfolio/reports/time-logged" element={<TimeLoggedReport />} />
          <Route path="/portfolio/contributors" element={<PortfolioContributorsPage />} />
          <Route path="/portfolio/contributors/me" element={<PortfolioContributorWorkspacePage />} />
          <Route path="/portfolio/contributors/me/:tab" element={<PortfolioContributorWorkspacePage />} />
          <Route path="/portfolio/contributors/:id" element={<PortfolioContributorWorkspacePage />} />
          <Route path="/portfolio/contributors/:id/:tab" element={<PortfolioContributorWorkspacePage />} />
          <Route path="/portfolio/settings" element={<PortfolioSettingsPage />} />
          <Route path="/portfolio/tasks" element={<TasksPage />} />
          <Route path="/portfolio/tasks/:id" element={<TaskWorkspacePage />} />
          <Route path="/portfolio/tasks/:id/:tab" element={<TaskWorkspacePage />} />
          {/* AI */}
          <Route path="/ai" element={<AiWorkspacePage />} />
          {/* AI Agents */}
          <Route path="/agents" element={<AgentsOverviewPage />} />
          <Route path="/agents/approvals" element={<AgentsApprovalsPage />} />
          <Route path="/agents/activity" element={<AgentsActivityPage />} />
          <Route path="/agents/shared-context" element={<SharedContextProfilesPage />} />
          <Route path="/agents/:agentKey" element={<AgentWorkspacePage />} />
          {/* Knowledge Center */}
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/knowledge/new" element={<KnowledgeWorkspacePage />} />
          <Route path="/knowledge/new/:tab" element={<KnowledgeWorkspacePage />} />
          <Route path="/knowledge/settings/types" element={<Navigate to="/knowledge" replace />} />
          <Route path="/knowledge/:id" element={<KnowledgeWorkspacePage />} />
          <Route path="/knowledge/:id/:tab" element={<KnowledgeWorkspacePage />} />
          {/* Legacy My Workspace routes - redirect */}
          <Route path="/my" element={<Navigate to="/" replace />} />
          <Route path="/my/dashboard" element={<Navigate to="/" replace />} />
          <Route path="/my/tasks/:id/:tab" element={<LegacyTaskRedirect />} />
          <Route path="/my/tasks/:id" element={<LegacyTaskRedirect />} />
          <Route path="/my/tasks" element={<Navigate to="/portfolio/tasks" replace />} />
          {/* Settings */}
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/:tab" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="/403" element={<ForbiddenPage />} />
      <Route path="*" element={<Navigate to={token ? '/' : '/login'} replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <FeaturesProvider>
      <AppRoutes />
    </FeaturesProvider>
  );
}
