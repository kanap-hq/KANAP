/**
 * Every source file that reads the assignments, naming the `app_asset_assignments` table or
 * reading through `effectiveAssignmentsSql` (tests, migrations and fixtures aside), and how it reads
 * them (clusters pass, PR B: an application assigned to a cluster counts for its members). The spec
 * `__tests__/assignment-readers.inventory.spec.ts` fails on such a file without an entry here, and on
 * an entry that no longer reads them.
 *
 * - `effective`: reads through `effectiveAssignmentsSql` (`effective-assignments.ts`), a member
 *   seeing what its clusters carry.
 * - `direct`: reads or writes the stored rows on purpose; the reason says why.
 * - `pending_b2`: a report read that lot B2 moves to the effective definition.
 *
 * A new reader of the table goes through `effectiveAssignmentsSql` unless it has a reason to see
 * the stored rows only.
 */
export type AssignmentReaderStatus = 'effective' | 'direct' | 'pending_b2';

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

  'src/app-asset-assignments/assignment-readers.inventory.ts': { status: 'direct', reason: 'This inventory.' },
  'src/app-asset-assignments/app-asset-assignment.entity.ts': { status: 'direct', reason: 'The entity of the stored rows.' },
  'src/ai/mutation/ai-relation-mutation-support.service.ts': { status: 'direct', reason: 'The assistant\'s writes, and the stored rows they edit.' },
  'src/assets/services/asset-impact.service.ts': { status: 'direct', reason: 'The impact already reads the applications of a fallen cluster.' },
  'src/assets/assets-delete.service.ts': {
    status: 'direct',
    reason: 'Deletion guard: a server carrying rows stays; a member that only inherits can be deleted.',
  },
  'src/it-ops-settings/catalog-usage.ts': { status: 'direct', reason: 'Usage of a server role: the stored rows name it.' },
  'src/common/tenant-isolation.inventory.ts': { status: 'direct', reason: 'Tenant isolation inventory.' },
  'src/admin/tenants/tenant-purge.inventory.ts': { status: 'direct', reason: 'Tenant purge inventory.' },

  'src/ai/ai-entity.service.ts': { status: 'pending_b2', reason: 'B2.' },
  'src/applications/services/applications-list.service.ts': { status: 'pending_b2', reason: 'B2.' },
  'src/contracts/contract-compliance.ts': { status: 'pending_b2', reason: 'B2.' },
  'src/knowledge/knowledge.service.ts': { status: 'pending_b2', reason: 'B2.' },
  'src/locations/location-relations.ts': { status: 'pending_b2', reason: 'B2.' },
  'src/locations/locations.service.ts': { status: 'pending_b2', reason: 'B2.' },
  'src/technologies/application-conversion.service.ts': { status: 'pending_b2', reason: 'B2.' },
  'src/technologies/reports/administration-view.service.ts': { status: 'pending_b2', reason: 'B2.' },
  'src/technologies/reports/end-of-support.service.ts': { status: 'pending_b2', reason: 'B2.' },
  'src/technologies/technology-links.service.ts': { status: 'pending_b2', reason: 'B2.' },
  'src/technologies/technology-reach.service.ts': { status: 'pending_b2', reason: 'B2.' },
  'src/vulnerabilities/vulnerability-reach-counts.ts': { status: 'pending_b2', reason: 'B2.' },
};
