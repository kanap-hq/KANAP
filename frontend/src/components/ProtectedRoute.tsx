import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { useTenant } from '../tenant/TenantContext';
import { useFeatures } from '../config/FeaturesContext';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useAiCapabilities } from '../ai/useAiCapabilities';
import PendingAccessPage from '../pages/PendingAccessPage';
import { canUseAnyOperation, canUseOperation } from '../pages/operations/operationAccess';

type RouteRequirement = {
  resource: string;
  level: 'reader' | 'contributor' | 'member' | 'manager' | 'admin';
};

export default function ProtectedRoute() {
  const { t } = useTranslation('auth');
  const {
    token,
    isAuthenticating,
    serverUnavailable,
    sessionExpired,
    profile,
    claims,
    hasLevel,
    hasAnyAccess,
    subscription,
  } = useAuth();
  const location = useLocation();
  const { isPlatformHost } = useTenant();
  const { config } = useFeatures();
  const aiCapabilities = useAiCapabilities();

  // Show loading spinner while authenticating; one line while the server cannot be reached.
  if (isAuthenticating) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
        px={2}
      >
        {serverUnavailable ? (
          <Typography role="status" sx={{ fontSize: 13, color: 'kanap.text.secondary', textAlign: 'center' }}>
            {t('session.serverUnavailable')}
          </Typography>
        ) : (
          <CircularProgress />
        )}
      </Box>
    );
  }

  // Redirect to login if no token after authentication check
  if (!token) {
    return <Navigate to={sessionExpired ? '/login?sessionExpired=true' : '/login'} replace />;
  }

  // If authenticated but the identity payload is not yet loaded, show spinner briefly
  if (token && (!claims || !profile)) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
      >
        <CircularProgress />
      </Box>
    );
  }

  // An authenticated account without a single granted permission gets a
  // dedicated pending-access page instead of an empty app shell.
  if (token && claims && profile && !hasAnyAccess) {
    return <PendingAccessPage />;
  }

  // Minimal per-route gating based on path prefix and resource name
  if (token && claims && profile) {
    const path = location.pathname;
    const isAiWorkspaceRoute = path === '/ai' || path.startsWith('/ai/');
    const isAgentsRoute = path === '/agents' || path.startsWith('/agents/');
    const isAdminAiRoute = path === '/admin/ai' || path.startsWith('/admin/ai/')
      || path === '/admin/ai-models' || path.startsWith('/admin/ai-models/')
      || path === '/admin/ai-usage' || path.startsWith('/admin/ai-usage/');
    const isAdminIntegrationsRoute = path === '/admin/integrations' || path.startsWith('/admin/integrations/');
    const roleNames = [
      profile.role,
      ...(profile.roles || []).map((role) => role.name),
    ];
    const isBusinessContributor = roleNames.some((name) => String(name || '').trim().toLowerCase() === 'business contributor');
    const hasScopedApplicationOnlyAccess = isBusinessContributor
      && hasLevel('applications', 'reader')
      && !hasLevel('applications', 'member')
      && !hasLevel('infrastructure', 'reader')
      && !hasLevel('locations', 'reader')
      && !hasLevel('settings', 'reader');
    if (isPlatformHost && !path.startsWith('/admin')) {
      return <Navigate to="/admin/tenants" replace />;
    }
    if (
      hasScopedApplicationOnlyAccess
      && (path === '/it/interfaces' || path.startsWith('/it/interfaces/') || path === '/it/interface-map')
    ) {
      return <Navigate to="/403" replace />;
    }
    if (isAiWorkspaceRoute) {
      if (!config.features.aiChat) {
        return <Navigate to="/403" replace />;
      }
      if (aiCapabilities.isLoading || (!aiCapabilities.data && aiCapabilities.isFetching)) {
        return (
          <Box
            display="flex"
            justifyContent="center"
            alignItems="center"
            minHeight="100vh"
          >
            <CircularProgress />
          </Box>
        );
      }
      if (aiCapabilities.isError || aiCapabilities.data?.surfaces.chat.available !== true) {
        return <Navigate to="/403" replace />;
      }
    }
    if (isAgentsRoute) {
      if (!config.features.aiSettings) {
        return <Navigate to="/403" replace />;
      }
      if (aiCapabilities.isLoading || (!aiCapabilities.data && aiCapabilities.isFetching)) {
        return (
          <Box
            display="flex"
            justifyContent="center"
            alignItems="center"
            minHeight="100vh"
          >
            <CircularProgress />
          </Box>
        );
      }
      if (aiCapabilities.isError || aiCapabilities.data?.instance_features.ai_settings !== true) {
        return <Navigate to="/403" replace />;
      }
    }
    // The integrations page also hosts non-AI connectors (Netbox), so an infrastructure
    // admin reaches it even when the AI settings surface is unavailable.
    const integrationsViaInfrastructure = isAdminIntegrationsRoute && hasLevel('infrastructure', 'admin');
    if ((isAdminAiRoute || isAdminIntegrationsRoute) && !integrationsViaInfrastructure) {
      if (!config.features.aiSettings) {
        return <Navigate to="/403" replace />;
      }
      if (aiCapabilities.isLoading || (!aiCapabilities.data && aiCapabilities.isFetching)) {
        return (
          <Box
            display="flex"
            justifyContent="center"
            alignItems="center"
            minHeight="100vh"
          >
            <CircularProgress />
          </Box>
        );
      }
      if (aiCapabilities.isError || aiCapabilities.data?.surfaces.settings.available !== true) {
        return <Navigate to="/403" replace />;
      }
    }

    let requirement: RouteRequirement | null = null;
    const adminAliases: Record<string, RouteRequirement> = {
      users: { resource: 'users', level: 'admin' },
      roles: { resource: 'users', level: 'admin' },
      auth: { resource: 'users', level: 'admin' },
      branding: { resource: 'users', level: 'admin' },
      integrations: { resource: 'ai_settings', level: 'admin' },
      'audit-logs': { resource: 'users', level: 'admin' },
      billing: { resource: 'billing', level: 'reader' },
      'choose-plan': { resource: 'billing', level: 'reader' },
      ai: { resource: 'ai_settings', level: 'admin' },
      'ai-models': { resource: 'ai_settings', level: 'admin' },
      'ai-usage': { resource: 'ai_settings', level: 'admin' },
      'agent-control': { resource: 'ai_agents', level: 'reader' },
      'scheduled-tasks': { resource: 'users', level: 'admin' },
    };
    const opsAliases: Record<string, string> = { reports: 'reporting', servers: 'infrastructure' };
    const itAliases: Record<string, string> = {
      locations: 'locations',
      assets: 'infrastructure',
      connections: 'infrastructure',
      'connection-map': 'infrastructure',
      applications: 'applications',
      interfaces: 'applications',
      'interface-map': 'applications',
      netbox: 'infrastructure',
      settings: 'settings',
    };
    const masterDataAliases: Record<string, string> = {
      companies: 'companies',
      departments: 'departments',
      'cost-centers': 'cost_centers',
      suppliers: 'suppliers',
      contacts: 'contacts',
      accounts: 'accounts',
      coa: 'accounts',
      'working-day-calendars': 'working_day_profiles',
      'business-processes': 'business_processes',
      analytics: 'analytics',
    };
    const portfolioAliases: Record<string, string> = {
      requests: 'portfolio_requests',
      projects: 'portfolio_projects',
      planning: 'portfolio_planning',
      reports: 'portfolio_reports',
      contributors: 'portfolio_settings',
      'team-members': 'portfolio_settings',
      settings: 'portfolio_settings',
    };
    const knowledgeAliases: Record<string, string> = {
      settings: 'knowledge',
    };

    if (path === '/master-data') {
      const hasMasterDataAccess = [
        'companies',
        'departments',
        'cost_centers',
        'working_day_profiles',
        'suppliers',
        'contacts',
        'accounts',
        'business_processes',
        'analytics',
      ].some((resource) => hasLevel(resource, 'reader'));
      if (!hasMasterDataAccess) {
        return <Navigate to="/403" replace />;
      }
      requirement = null;
    } else if (path.startsWith('/admin/')) {
      const seg = path.split('/')[2] || null;
      requirement = seg ? (adminAliases[seg] || { resource: seg, level: 'reader' }) : null;
    } else if (path === '/ai' || path.startsWith('/ai/')) {
      requirement = { resource: 'ai_chat', level: 'reader' };
    } else if (path === '/agents' || path.startsWith('/agents/')) {
      requirement = { resource: 'ai_agents', level: 'reader' };
    } else if (path === '/ops/operations' || path === '/ops/operations/') {
      // The administration landing opens when at least one of its pages can be used.
      if (!canUseAnyOperation(hasLevel)) {
        return <Navigate to="/403" replace />;
      }
      requirement = null;
    } else if (path.startsWith('/ops/operations/')) {
      // Each administration page opens only to the users who can act on it.
      if (!canUseOperation(path.split('/')[3] ?? '', hasLevel)) {
        return <Navigate to="/403" replace />;
      }
      requirement = null;
    } else if (path.startsWith('/ops/')) {
      const seg = path.split('/')[2] || null;
      requirement = seg ? { resource: opsAliases[seg] || seg, level: 'reader' } : null;
    } else if (path.startsWith('/it/')) {
      const seg = path.split('/')[2] || null;
      requirement = seg ? { resource: itAliases[seg] || seg, level: 'reader' } : null;
    } else if (path.startsWith('/master-data/')) {
      const seg = path.split('/')[2] || null;
      requirement = seg ? { resource: masterDataAliases[seg] || seg, level: 'reader' } : null;
    } else if (path.startsWith('/portfolio/')) {
      const seg = path.split('/')[2] || null;
      requirement = seg ? { resource: portfolioAliases[seg] || seg, level: 'reader' } : null;
    } else if (path === '/knowledge' || path.startsWith('/knowledge/')) {
      const seg = path.split('/')[2] || null;
      requirement = { resource: seg ? (knowledgeAliases[seg] || 'knowledge') : 'knowledge', level: 'reader' };
    } else {
      requirement = null; // dashboard and other root pages allowed
    }
    if (isAdminAiRoute) {
      if (!hasLevel('ai_settings', 'admin')) {
        return <Navigate to="/403" replace />;
      }
    } else if (isAdminIntegrationsRoute) {
      if (!hasLevel('ai_settings', 'admin') && !hasLevel('infrastructure', 'admin')) {
        return <Navigate to="/403" replace />;
      }
    } else if (requirement && !hasLevel(requirement.resource, requirement.level)) {
      return <Navigate to="/403" replace />;
    }

    // Redirect billing admins to billing page when subscription is unhealthy (only when billing is enabled)
    if (
      config.features.billing &&
      subscription?.is_subscription_healthy === false &&
      claims.isBillingAdmin &&
      !path.startsWith('/admin/billing') &&
      !claims.isPlatformAdmin
    ) {
      return <Navigate to="/admin/billing" replace />;
    }
  }

  return <Outlet />;
}
