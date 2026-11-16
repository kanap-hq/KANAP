const PREFIXES = { task: 'T', project: 'PRJ', request: 'REQ', document: 'DOC', asset: 'AST', application: 'APP', location: 'LOC', connection: 'CONN', interface: 'INT', opex: 'OPX', capex: 'CPX', budget: 'BL', incident: 'INC', contributor: 'MEM', technology: 'TEC', supplier: 'SUP', company: 'COMP', contact: 'CTCT', department: 'DEPT', contract: 'CTR' } as const;
type ItemType = keyof typeof PREFIXES;

export function formatItemRef(type: ItemType, itemNumber: number): string {
  return `${PREFIXES[type]}-${itemNumber}`;
}

/** A record's page address segment: its reference (`COMP-12`) when it has a number, else its uuid. */
export function itemAddress(type: ItemType, record: { id: string; item_number?: number | null }): string {
  return record.item_number ? formatItemRef(type, record.item_number) : record.id;
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
    company: '/master-data/companies',
    department: '/master-data/departments',
    supplier: '/master-data/suppliers',
    contact: '/master-data/contacts',
    // This page opens by the uuid until its reference address ships (lot R4): pass the id.
    contract: '/ops/contracts',
  };
  return `${paths[type]}/${idOrRef}`;
}
