import React from 'react';
import { Breadcrumbs, Link as MLink, Typography, Stack, Box } from '@mui/material';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

type Crumb = { label: string; to?: string; /** Raw path segment the crumb was built from. */ segment: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function isEntitySegment(value: string): boolean {
  return value === 'me' || isUuid(value);
}

function humanizeSegment(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function useBreadcrumbs(): Crumb[] {
  const { t } = useTranslation('nav');
  const location = useLocation();
  const path = location.pathname;
  const parts = path.split('/').filter(Boolean);
  const mapLabel = (seg: string): string => {
    // Convert route segments to camelCase keys for lookup
    const keyMap: Record<string, string> = {
      'ops': 'ops',
      'admin': 'admin',
      'it': 'it',
      'master-data': 'masterData',
      'portfolio': 'portfolio',
      'ai': 'ai',
      'opex': 'opex',
      'capex': 'capex',
      'projects': 'projects',
      'contributors': 'contributors',
      'team-members': 'teamMembers',
      'companies': 'companies',
      'departments': 'departments',
      'cost-centers': 'costCenters',
      'working-day-calendars': 'workingDayCalendars',
      'suppliers': 'suppliers',
      'accounts': 'accounts',
      'coa': 'coa',
      'analytics': 'analytics',
      'dimensions': 'dimensions',
      'users': 'users',
      'roles': 'roles',
      'agent-control': 'agentControl',
      'ai-models': 'aiModels',
      'ai-usage': 'aiUsage',
      'scheduled-tasks': 'scheduledTasks',
      'billing': 'billing',
      'reports': 'reports',
      'contracts': 'contracts',
      'applications': 'applications',
      'interface-map': 'interfaceMap',
      'connection-map': 'connectionMap',
      'tasks': 'tasks',
      'operations': 'operations',
      'netbox': 'netbox',
      'settings': 'settings',
    };
    const key = keyMap[seg];
    if (key) return t(`breadcrumbs.${key}`);
    return humanizeSegment(seg);
  };

  // Determine the root based on the first part of the path
  const crumbs: Crumb[] = [];
  if (parts.length === 0) {
    crumbs.push({ label: t('breadcrumbs.dashboard'), to: '/ops', segment: '' });
    return crumbs;
  }

  // Don't add a root crumb - start directly with the section
  let acc = '';
  for (let i = 0; i < parts.length; i++) {
    acc += '/' + parts[i];
    const label = mapLabel(parts[i]);
    const to = i < parts.length - 1 ? acc : undefined;
    crumbs.push({ label, to, segment: parts[i] });
  }
  return crumbs;
}

export default function PageHeader({
  title,
  titleContent,
  actions,
  breadcrumbTitle,
}: {
  title: string;
  /** Replaces the title typography when the page needs an inline editor. */
  titleContent?: React.ReactNode;
  actions?: React.ReactNode;
  /** Override the last breadcrumb segment (e.g., show name instead of UUID) */
  breadcrumbTitle?: string;
}) {
  const { t } = useTranslation('nav');
  let crumbs = useBreadcrumbs();

  // The entity crumb is the one built from the id segment (a UUID, or `me` for
  // self-service routes). On `/…/:id/:tab` it sits before the tab crumb and
  // keeps its link back to the entity; on `/…/:id` it is the last crumb.
  // Test the raw segment: the label has already been humanized.
  if (breadcrumbTitle && crumbs.length > 0) {
    const last = crumbs.length - 1;
    const entityIndex = crumbs.length >= 2 && isEntitySegment(crumbs[last - 1].segment) ? last - 1 : last;
    crumbs = crumbs.map((crumb, idx) => (
      idx === entityIndex ? { ...crumb, label: breadcrumbTitle } : crumb
    ));
  }

  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');
  return (
    <Stack spacing={1} sx={{ mb: 2 }}>
      <Breadcrumbs aria-label="breadcrumb">
        {crumbs.map((c, idx) => (
          c.to ? (
            <MLink key={idx} component={Link} underline="hover" color="inherit" to={c.to!}>{c.label}</MLink>
          ) : (
            <Typography key={idx} color="text.primary">{c.label}</Typography>
          )
        ))}
      </Breadcrumbs>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0, flex: 1 }}>
          {titleContent ?? <Typography variant="h5">{title}</Typography>}
          {isAdmin && <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>{t('breadcrumbs.admin')}</Box>}
        </Stack>
        {actions}
      </Stack>
    </Stack>
  );
}
