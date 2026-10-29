/**
 * Every source file that reads the assignments, naming the `app_asset_assignments` table, reading
 * through `effectiveAssignmentsSql` or using the entity `AppAssetAssignment` (Nest modules that only
 * register it, tests, migrations and fixtures aside), and how it reads
 * them (clusters pass, PR B: an application assigned to a cluster counts for its members). The spec
 * `__tests__/assignment-readers.inventory.spec.ts` fails on such a file without an entry here, and on
 * an entry that no longer reads them.
 *
 * - `effective`: reads through `effectiveAssignmentsSql` (`effective-assignments.ts`), a member
 *   seeing what its clusters carry.
 * - `direct`: reads or writes the stored rows on purpose; the reason says why.
 *
 * A new reader of the table goes through `effectiveAssignmentsSql` unless it has a reason to see
 * the stored rows only.
 */
export type AssignmentReaderStatus = 'effective' | 'direct';

export type AssignmentReader = { status: AssignmentReaderStatus; reason: string };

/** Paths relative to `backend/`. */
export const ASSIGNMENT_READERS: Readonly<Record<string, AssignmentReader>> = {
  'src/app-asset-assignments/effective-assignments.ts': { status: 'effective', reason: 'The definition itself.' },
  'src/app-asset-assignments/app-asset-assignments.service.ts': {
    status: 'effective',
    reason: 'The Deployments and Operations tabs and the connection map preselection read effective rows; create, update and delete write the stored rows.',
  },
  'src/assets/services/assets-list.service.ts': { status: 'effective', reason: 'The assets list count, its filter and the asset summary.' },
  'src/ai/query/registries/assets.registry.ts': { status: 'effective', reason: 'The assistant\'s assignment count of an asset.' },
  'src/ai/query/registries/applications.registry.ts': { status: 'effective', reason: 'The assistant\'s hosting types of an application.' },
  'src/applications/services/applications-relations.service.ts': { status: 'effective', reason: 'The asset count of the application relations badge.' },
  'src/connections/services/connections-list.service.ts': { status: 'effective', reason: 'The tier of a server on the connection map.' },
  'src/vulnerabilities/vulnerability-reach-counts.ts': {
    status: 'effective',
    reason: 'The vulnerabilities of an application: the links of the servers it runs on (badge, list, record, vulnerabilities page, home tile, assistant).',
  },
  'src/technologies/reports/end-of-support.service.ts': {
    status: 'effective',
    reason: 'The servers of an application deadline, the applications on a touched server, the database servers without a DBMS; "without a server" reads the stored rows, which an instance has exactly when it has an effective one.',
  },
  'src/technologies/technology-reach.service.ts': { status: 'effective', reason: 'The applications of a technology and the technologies of an application (hosted).' },
  'src/technologies/technology-links.service.ts': { status: 'effective', reason: 'The deployment servers offered when an application declares a technology.' },
  'src/applications/services/applications-list.service.ts': {
    status: 'effective',
    reason: 'The hosting types (column, filter, values, page) and the servers of the interface map; the connection map list names no server and reads the stored rows, which a deployment has exactly when it has an effective one.',
  },
  'src/technologies/reports/administration-view.service.ts': {
    status: 'effective',
    reason: 'Domain controllers by role, applications on the most sensitive zone, the zone summary and the applications of an asset row.',
  },
  'src/contracts/contract-compliance.ts': { status: 'effective', reason: 'The applications a contract on an asset covers, and the cloud hosting of an application.' },
  'src/locations/location-relations.ts': { status: 'effective', reason: 'The applications of a location\'s Relations tab and its badge.' },
  'src/locations/locations.service.ts': { status: 'effective', reason: 'The applications of a location.' },
  'src/knowledge/knowledge.service.ts': { status: 'effective', reason: 'The context sources of an application (its servers) and of an asset (its applications).' },
  'src/ai/ai-entity.service.ts': { status: 'effective', reason: 'The assistant\'s context: the servers of an application, the applications of an asset.' },
  'src/technologies/application-conversion.service.ts': {
    status: 'effective',
    reason: 'Converting an application installs the technology on its effective servers, clusters excluded (a cluster gives its members); the preview counts and the hosting type follow the same set.',
  },

  'src/app-asset-assignments/assignment-readers.inventory.ts': { status: 'direct', reason: 'This inventory.' },
  'src/app-asset-assignments/app-asset-assignment.entity.ts': { status: 'direct', reason: 'The entity of the stored rows.' },
  'src/app-asset-assignments/cluster-assignment-rules.ts': {
    status: 'direct',
    reason: 'The cluster rules of the writers: whether a cluster already carries the stored row a member would get.',
  },
  'src/ai/mutation/ai-relation-mutation-support.service.ts': { status: 'direct', reason: 'The assistant\'s writes, and the stored rows they edit.' },
  'src/assets/services/asset-impact.service.ts': { status: 'direct', reason: 'The impact already reads the applications of a fallen cluster.' },
  'src/assets/assets-delete.service.ts': {
    status: 'effective',
    reason: 'Deletion guard: a server carrying stored rows stays, a member that only inherits can be deleted; its warning names the applications a member hosts through its clusters (effective rows, inherited only).',
  },
  'src/app-instances/app-instances.service.ts': {
    status: 'direct',
    reason: 'Deletion guard of a deployment: the stored rows it holds, which an inherited row never adds.',
  },
  'src/it-ops-settings/catalog-usage.ts': { status: 'direct', reason: 'Usage of a server role: the stored rows name it.' },
  'src/common/tenant-isolation.inventory.ts': { status: 'direct', reason: 'Tenant isolation inventory.' },
  'src/admin/tenants/tenant-purge.inventory.ts': { status: 'direct', reason: 'Tenant purge inventory.' },
  'src/audit/record-history/records/applications.ts': {
    status: 'direct',
    reason: 'The application history reads the audit rows of the stored assignments (its deployments\' servers); the file reads no assignment row.',
  },
  'src/audit/record-history/records/assets.ts': {
    status: 'direct',
    reason: 'The asset history excludes the assignments from this run (the applications run reads them); the file reads no assignment row.',
  },
};
