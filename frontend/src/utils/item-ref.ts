const PREFIXES = { task: 'T', project: 'PRJ', request: 'REQ', document: 'DOC', asset: 'AST', application: 'APP', location: 'LOC', connection: 'CONN', interface: 'INT', opex: 'OPX', capex: 'CPX', budget: 'BL', incident: 'INC', contributor: 'CTR', technology: 'TEC' } as const;
type ItemType = keyof typeof PREFIXES;

export function formatItemRef(type: ItemType, itemNumber: number): string {
  return `${PREFIXES[type]}-${itemNumber}`;
}

export function buildItemPath(type: ItemType, idOrRef: string): string {
  const paths = {
    task: '/portfolio/tasks',
    project: '/portfolio/projects',
    request: '/portfolio/requests',
    document: '/knowledge',
    asset: '/it/assets',
    application: '/it/applications',
    location: '/it/locations',
    connection: '/it/connections',
    interface: '/it/interfaces',
    budget: '/ops/budget',
    opex: '/ops/budget',
    capex: '/ops/budget',
    incident: '/it/incidents',
    contributor: '/portfolio/contributors',
    technology: '/it/technologies',
  };
  return `${paths[type]}/${idOrRef}`;
}
