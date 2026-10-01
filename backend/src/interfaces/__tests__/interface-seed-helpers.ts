import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';

// Shared by the interface and connection list integration specs (not a spec itself:
// the runner only picks up *.spec.ts files). Rows are written directly, in the
// transaction of the caller, which rolls everything back.

export async function setCurrentTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

/** A tenant, made the current one. */
export async function seedTenant(runner: QueryRunner, tag: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `it-list-${tag}-${tenantId.slice(0, 8)}`, `IT lists test ${tag}`],
  );
  await setCurrentTenant(runner, tenantId);
  return tenantId;
}

export type SeedApps = { source: string; target: string; sourceInstance: string; targetInstance: string };

/** Two applications with a production instance each, to put interfaces between. */
export async function seedApps(runner: QueryRunner, tenantId: string): Promise<SeedApps> {
  const ids: string[] = [];
  const instances: string[] = [];
  for (const name of ['Source app', 'Target app']) {
    const [app] = await runner.query(
      `INSERT INTO applications (tenant_id, name) VALUES ($1, $2) RETURNING id`,
      [tenantId, `${name} ${randomUUID().slice(0, 6)}`],
    );
    const [instance] = await runner.query(
      `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod') RETURNING id`,
      [tenantId, app.id],
    );
    ids.push(app.id);
    instances.push(instance.id);
  }
  return { source: ids[0], target: ids[1], sourceInstance: instances[0], targetInstance: instances[1] };
}

export type SeedInterface = {
  name: string;
  lifecycle?: string;
  criticality?: string | null;
  data_class?: string | null;
  data_category?: string;
  contains_pii?: boolean;
  business_process_id?: string | null;
};

/** An interface with one leg and a production binding; returns the interface and binding ids. */
export async function seedInterface(
  runner: QueryRunner,
  tenantId: string,
  apps: SeedApps,
  spec: SeedInterface,
): Promise<{ id: string; bindingId: string }> {
  const [row] = await runner.query(
    `INSERT INTO interfaces (tenant_id, name, business_purpose, source_application_id, target_application_id,
                             data_category, integration_route_type, lifecycle, criticality, data_class, contains_pii,
                             business_process_id)
     VALUES ($1, $2, 'Test purpose', $3, $4, $5, 'direct', $6, $7, $8, $9, $10) RETURNING id`,
    [
      tenantId,
      spec.name,
      apps.source,
      apps.target,
      spec.data_category ?? 'master_data',
      spec.lifecycle ?? 'active',
      spec.criticality ?? null,
      spec.data_class ?? null,
      spec.contains_pii ?? false,
      spec.business_process_id ?? null,
    ],
  );
  const [leg] = await runner.query(
    `INSERT INTO interface_legs (tenant_id, interface_id, leg_type, from_role, to_role, trigger_type,
                                 integration_pattern, data_format, order_index)
     VALUES ($1, $2, 'direct', 'source', 'target', 'event_based', 'rest_api_sync', 'json', 0) RETURNING id`,
    [tenantId, row.id],
  );
  const [binding] = await runner.query(
    `INSERT INTO interface_bindings (tenant_id, interface_id, interface_leg_id, environment, source_instance_id, target_instance_id)
     VALUES ($1, $2, $3, 'prod', $4, $5) RETURNING id`,
    [tenantId, row.id, leg.id, apps.sourceInstance, apps.targetInstance],
  );
  return { id: row.id, bindingId: binding.id };
}
