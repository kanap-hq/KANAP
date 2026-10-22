import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  applicationParticipantCondition,
  type ParticipationAccessScope,
} from '../auth/business-contributor-scope';
import { binder, type RelatedAsset } from '../common/relations/related-objects';

/**
 * The Relations tab of a location (lot R2g). One round trip lists the assets placed at the
 * location and the applications whose instances run on them. Both are read only: an asset's
 * location is chosen on the asset. A section the caller cannot read is null. Web links stay on
 * their own routes (`/locations/:id/links`).
 */

/** The module a section reads. Assets are the infrastructure. */
export const LOCATION_RELATION_READS = {
  assets: 'infrastructure',
  applications: 'applications',
} as const;

export type LocationRelationsAccess = Record<keyof typeof LOCATION_RELATION_READS, boolean>;

export type LocationRelationsContext = {
  access: LocationRelationsAccess;
  /** A Business Contributor's application scope. Absent for everyone else. */
  applicationScope?: ParticipationAccessScope;
};

/** An asset at the location, the shared asset fields plus its provider and sub-location. */
export type LocationRelatedAsset = RelatedAsset & {
  provider: string | null;
  sub_location_id: string | null;
  sub_location_name: string | null;
};

/** An application with an instance on an asset of the location, and the environments it runs there. */
export type LocationRelatedApplication = {
  id: string;
  reference: string;
  name: string;
  lifecycle: string;
  status: string;
  environments: string[];
};

export type LocationRelations = {
  assets: LocationRelatedAsset[] | null;
  applications: LocationRelatedApplication[] | null;
};

const LOCATION_NOT_FOUND = 'Location not found';

type LocationRow = { id: string; tenant_id: string };

/** The location in the current tenant. `id` is already resolved from a uuid or a `LOC-n` reference. */
async function loadLocation(manager: EntityManager, id: string): Promise<LocationRow> {
  const [row]: LocationRow[] = await manager.query(
    `SELECT id, tenant_id FROM locations WHERE tenant_id = app_current_tenant() AND id = $1`,
    [id],
  );
  if (!row) throw new NotFoundException(LOCATION_NOT_FOUND);
  return row;
}

function scopeSql(params: unknown[], scope: ParticipationAccessScope | undefined): string {
  if (!scope) return '';
  return `AND ${applicationParticipantCondition('a', binder(params)(scope.userId))}`;
}

async function listAssets(manager: EntityManager, location: LocationRow): Promise<LocationRelatedAsset[]> {
  const rows: LocationRelatedAsset[] = await manager.query(
    `SELECT a.id, a.asset_reference AS reference, a.name, a.kind, a.environment, a.status, a.provider,
            a.sub_location_id, sl.name AS sub_location_name
       FROM assets a
       LEFT JOIN location_sub_items sl ON sl.id = a.sub_location_id AND sl.tenant_id = a.tenant_id
      WHERE a.tenant_id = $1 AND a.location_id = $2
      ORDER BY lower(a.name), a.id`,
    [location.tenant_id, location.id],
  );
  return rows.map((row) => ({
    ...row,
    provider: row.provider ?? null,
    sub_location_id: row.sub_location_id ?? null,
    sub_location_name: row.sub_location_name ?? null,
  }));
}

async function listApplications(
  manager: EntityManager,
  location: LocationRow,
  scope: ParticipationAccessScope | undefined,
): Promise<LocationRelatedApplication[]> {
  const params: unknown[] = [location.tenant_id, location.id];
  const scoped = scopeSql(params, scope);
  const rows: Array<Omit<LocationRelatedApplication, 'environments'> & { environments: Array<string | null> | null }> = await manager.query(
    `SELECT a.id, a.sequential_id AS reference, a.name, a.lifecycle, a.status::text AS status,
            ARRAY_AGG(DISTINCT ai.environment ORDER BY ai.environment) AS environments
       FROM assets s
       JOIN app_asset_assignments asa ON asa.asset_id = s.id AND asa.tenant_id = s.tenant_id
       JOIN app_instances ai ON ai.id = asa.app_instance_id AND ai.tenant_id = asa.tenant_id
       JOIN applications a ON a.id = ai.application_id AND a.tenant_id = ai.tenant_id
      WHERE s.tenant_id = $1 AND s.location_id = $2 ${scoped}
      GROUP BY a.id
      ORDER BY lower(a.name), a.id`,
    params,
  );
  return rows.map((row) => ({
    ...row,
    environments: (row.environments ?? []).filter((env): env is string => !!env),
  }));
}

/**
 * The tab in one round trip. The location must exist in the tenant (404 otherwise). Applications
 * follow a Business Contributor's participation.
 */
export async function readLocationRelations(
  manager: EntityManager,
  id: string,
  ctx: LocationRelationsContext,
): Promise<LocationRelations> {
  const location = await loadLocation(manager, id);
  // One query after the other: the request's connection runs them in turn.
  const assets = ctx.access.assets ? await listAssets(manager, location) : null;
  const applications = ctx.access.applications
    ? await listApplications(manager, location, ctx.applicationScope)
    : null;
  return { assets, applications };
}

/**
 * The tab badge: what the tab shows. Assets for a reader of the infrastructure, applications for
 * a reader of the applications (inside a Business Contributor's participation), and web links.
 */
export async function readLocationRelationCounts(
  manager: EntityManager,
  id: string,
  ctx: LocationRelationsContext,
): Promise<{ relations: number }> {
  const location = await loadLocation(manager, id);
  const params: unknown[] = [location.tenant_id, location.id];
  const assets = ctx.access.assets
    ? `(SELECT count(*) FROM assets a WHERE a.tenant_id = $1 AND a.location_id = $2)`
    : '0';
  const applications = ctx.access.applications
    ? `(SELECT count(DISTINCT a.id)
          FROM assets s
          JOIN app_asset_assignments asa ON asa.asset_id = s.id AND asa.tenant_id = s.tenant_id
          JOIN app_instances ai ON ai.id = asa.app_instance_id AND ai.tenant_id = asa.tenant_id
          JOIN applications a ON a.id = ai.application_id AND a.tenant_id = ai.tenant_id
         WHERE s.tenant_id = $1 AND s.location_id = $2 ${scopeSql(params, ctx.applicationScope)})`
    : '0';
  const [row]: Array<{ n: number }> = await manager.query(
    `SELECT (${assets} + ${applications}
             + (SELECT count(*) FROM location_links l WHERE l.tenant_id = $1 AND l.location_id = $2))::int AS n`,
    params,
  );
  return { relations: Number(row?.n ?? 0) };
}
