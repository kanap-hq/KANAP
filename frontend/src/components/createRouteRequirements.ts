/** The right a creation address asks for, as its API `POST` does. */
export const CREATE_ROUTE_REQUIREMENTS: Record<string, { resource: string; level: 'contributor' | 'member' }> = {
  '/ops/budget': { resource: 'budget', level: 'member' },
  '/ops/contracts': { resource: 'contracts', level: 'member' },
  '/master-data/accounts': { resource: 'accounts', level: 'member' },
  '/master-data/analytics/dimensions': { resource: 'analytics', level: 'member' },
  '/master-data/analytics': { resource: 'analytics', level: 'member' },
  '/master-data/business-processes': { resource: 'business_processes', level: 'member' },
  '/master-data/companies': { resource: 'companies', level: 'member' },
  '/master-data/contacts': { resource: 'contacts', level: 'member' },
  '/master-data/cost-centers': { resource: 'cost_centers', level: 'member' },
  '/master-data/departments': { resource: 'departments', level: 'member' },
  '/master-data/suppliers': { resource: 'suppliers', level: 'member' },
  '/master-data/working-day-calendars': { resource: 'working_day_profiles', level: 'member' },
  '/it/applications': { resource: 'applications', level: 'member' },
  '/it/assets': { resource: 'infrastructure', level: 'member' },
  '/it/connections': { resource: 'infrastructure', level: 'member' },
  '/it/incidents': { resource: 'incidents', level: 'contributor' },
  '/it/interfaces': { resource: 'applications', level: 'member' },
  '/it/locations': { resource: 'locations', level: 'member' },
  '/portfolio/projects': { resource: 'portfolio_projects', level: 'member' },
  '/portfolio/requests': { resource: 'portfolio_requests', level: 'member' },
  '/portfolio/tasks': { resource: 'tasks', level: 'member' },
  '/knowledge': { resource: 'knowledge', level: 'member' },
};

/** The creation right when the address is `<prefix>/new` or starts with `<prefix>/new/`; `null` otherwise. */
export function createRouteRequirement(path: string) {
  for (const [prefix, requirement] of Object.entries(CREATE_ROUTE_REQUIREMENTS)) {
    if (path === `${prefix}/new` || path.startsWith(`${prefix}/new/`)) {
      return requirement;
    }
  }
  return null;
}
