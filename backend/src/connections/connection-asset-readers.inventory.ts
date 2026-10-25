/**
 * Every source file that reads the assets a connection carries, naming the stored server or hop
 * tables, the hop equipment column or reading through the effective definition (Nest modules that
 * only register the entities, tests, migrations and fixtures aside), and how it reads them
 * (clusters pass, lot C1x: a row written on a cluster counts for its members). The spec
 * `__tests__/connection-asset-readers.inventory.spec.ts` fails on such a file without an entry
 * here, and on an entry that no longer reads them.
 *
 * - `effective`: reads through the effective definition (`effective-connection-assets.ts`), a
 *   member seeing what its clusters carry.
 * - `direct`: reads or writes the stored rows on purpose; the reason says why.
 *
 * A new reader goes through the effective definition unless it has a reason to see the stored rows
 * only.
 */
export type ConnectionAssetReaderStatus = 'effective' | 'direct';

export type ConnectionAssetReader = { status: ConnectionAssetReaderStatus; reason: string };

/** Paths relative to `backend/`. */
export const CONNECTION_ASSET_READERS: Readonly<Record<string, ConnectionAssetReader>> = {
  'src/connections/effective-connection-assets.ts': { status: 'effective', reason: 'The definition itself.' },
  'src/connections/services/connections-list.service.ts': {
    status: 'effective',
    reason: 'The Network tab of an asset reads the effective lines; the connection map reads the stored lines and draws the members of the clusters (lot C1y).',
  },
  'src/interfaces/services/interface-bindings.service.ts': { status: 'effective', reason: 'The servers of a connection linked to an interface.' },

  'src/connections/services/connections-crud.service.ts': { status: 'direct', reason: 'Writes the stored endpoints and servers.' },
  'src/connections/services/connections-legs.service.ts': { status: 'direct', reason: 'Writes the stored hops and their equipment.' },
  'src/connections/services/connections-base.service.ts': { status: 'direct', reason: 'Normalises the stored endpoints and the equipment of a hop before a write.' },
  'src/connections/connection-server.entity.ts': { status: 'direct', reason: 'The entity of the stored servers.' },
  'src/connections/connection-leg.entity.ts': { status: 'direct', reason: 'The entity of the stored hops.' },
  'src/assets/assets-delete.service.ts': {
    status: 'direct',
    reason: 'Deletion guard: a stored row naming the asset keeps it, inherited rows do not.',
  },
  'src/it-ops-settings/catalog-usage.ts': { status: 'direct', reason: 'Usage of a catalog code: the stored rows name it.' },
  'src/common/tenant-isolation.inventory.ts': { status: 'direct', reason: 'Tenant isolation inventory.' },
  'src/admin/tenants/tenant-purge.inventory.ts': { status: 'direct', reason: 'Tenant purge inventory.' },
};
