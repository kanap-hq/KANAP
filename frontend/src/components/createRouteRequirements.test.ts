import { describe, expect, it } from 'vitest';
import { CREATE_ROUTE_REQUIREMENTS, createRouteRequirement } from './createRouteRequirements';

const PAGE_SOURCES = import.meta.glob<string>(
  ['../pages/**/*.tsx', '!../pages/**/*.test.tsx'],
  { query: '?raw', import: 'default', eager: true },
);
const APP_SOURCES = import.meta.glob<string>(
  ['../App.tsx'],
  { query: '?raw', import: 'default', eager: true },
);

/** The page that opens a creation, and the address prefix under which it does. */
const PAGE_PREFIXES: Record<string, string> = {
  'pages/budget/BudgetLineRoute.tsx': '/ops/budget',
  'pages/contracts/ContractWorkspacePage.tsx': '/ops/contracts',
  'pages/accounts/AccountWorkspacePage.tsx': '/master-data/accounts',
  'pages/analytics/AnalyticsDimensionWorkspacePage.tsx': '/master-data/analytics/dimensions',
  'pages/analytics/AnalyticsWorkspacePage.tsx': '/master-data/analytics',
  'pages/business-processes/BusinessProcessWorkspacePage.tsx': '/master-data/business-processes',
  'pages/companies/CompanyWorkspacePage.tsx': '/master-data/companies',
  'pages/contacts/ContactWorkspacePage.tsx': '/master-data/contacts',
  'pages/cost-centers/CostCenterWorkspacePage.tsx': '/master-data/cost-centers',
  'pages/departments/DepartmentWorkspacePage.tsx': '/master-data/departments',
  'pages/suppliers/SupplierWorkspacePage.tsx': '/master-data/suppliers',
  'pages/working-day-calendars/WorkingDayCalendarWorkspacePage.tsx': '/master-data/working-day-calendars',
  'pages/it/ApplicationWorkspacePage.tsx': '/it/applications',
  'pages/it/AssetWorkspacePage.tsx': '/it/assets',
  'pages/it/ConnectionWorkspacePage.tsx': '/it/connections',
  'pages/it/IncidentWorkspacePage.tsx': '/it/incidents',
  'pages/it/InterfaceWorkspacePage.tsx': '/it/interfaces',
  'pages/it/LocationWorkspacePage.tsx': '/it/locations',
  'pages/portfolio/ProjectWorkspacePage.tsx': '/portfolio/projects',
  'pages/portfolio/RequestWorkspacePage.tsx': '/portfolio/requests',
  'pages/tasks/TaskWorkspacePage.tsx': '/portfolio/tasks',
  'pages/knowledge/KnowledgeWorkspacePage.tsx': '/knowledge',
};

/** Pages that read `new` without being a creation address of their own. */
const PAGE_EXCLUSIONS: Record<string, string> = {
  'pages/admin/AdminStandardAccountWorkspacePage.tsx': 'Platform administrator only, already guarded by the /admin prefix.',
  'pages/budget/BudgetLinePage.tsx': 'Rendered by BudgetLineRoute, which holds the /ops/budget address.',
  'pages/budget/LegacyBudgetLineRedirect.tsx': 'Redirects /ops/opex/new and /ops/capex/new to /ops/budget/new.',
  'pages/it/workspace/TechnologyOverviewTab.tsx': "`editing === 'new'` adds a version row, not a page.",
};

/** App.tsx addresses that hold `new` without being a creation screen. */
const APP_ROUTE_EXCLUSIONS = [
  '/ops/tasks/new',
  '/my/tasks/new',
  '/ops/opex/new',
  '/ops/capex/new',
  '/admin/standard-accounts',
];

function pagePath(globKey: string) {
  return globKey.replace(/^\.\.\//, '');
}

describe('CREATE_ROUTE_REQUIREMENTS', () => {
  it('lists every page that opens a creation', () => {
    const uncovered = Object.entries(PAGE_SOURCES)
      .filter(([, source]) => source.includes("=== 'new'") || source.includes('=== "new"'))
      .map(([path]) => pagePath(path))
      .filter((path) => !(path in PAGE_PREFIXES) && !(path in PAGE_EXCLUSIONS));
    expect(
      uncovered,
      `Add the creation address of these pages to CREATE_ROUTE_REQUIREMENTS: ${uncovered.join(', ')}`,
    ).toEqual([]);
  });

  it('has the same prefixes as the page inventory', () => {
    expect(Object.values(PAGE_PREFIXES).sort()).toEqual(Object.keys(CREATE_ROUTE_REQUIREMENTS).sort());
  });

  it('covers every creation route of App.tsx', () => {
    const appSource = APP_SOURCES['../App.tsx'];
    expect(appSource).toBeTruthy();
    const routePaths = [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map(([, path]) => path);
    const uncovered = routePaths
      .filter((path) => path.includes('/new'))
      .filter((path) => !createRouteRequirement(path)
        && !APP_ROUTE_EXCLUSIONS.some((excluded) => path === excluded || path.startsWith(`${excluded}/`)));
    expect(
      uncovered,
      `Add these App.tsx routes to CREATE_ROUTE_REQUIREMENTS or to its test exclusions: ${uncovered.join(', ')}`,
    ).toEqual([]);
  });
});
