const PREFIXES = { task: 'T', project: 'PRJ', request: 'REQ', document: 'DOC', asset: 'AST', application: 'APP', location: 'LOC', connection: 'CONN', interface: 'INT', opex: 'OPX', capex: 'CPX', budget: 'BL', incident: 'INC', contributor: 'MEM', technology: 'TEC', supplier: 'SUP', company: 'COMP', contact: 'CTCT', department: 'DEPT', contract: 'CTR' } as const;
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
    // These pages open by the uuid until their reference address ships (lots R2 to R4): pass the id.
    supplier: '/master-data/suppliers',
    company: '/master-data/companies',
    contact: '/master-data/contacts',
    department: '/master-data/departments',
    contract: '/ops/contracts',
  };
  return `${paths[type]}/${idOrRef}`;
}
