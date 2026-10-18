import { MigrationInterface, QueryRunner } from 'typeorm';
import { hostingCategory, resolveHostingType } from '../technologies/hosting-type';

/**
 * The hosting type of a technology (lot H1): `technologies.hosting_type`, a code of the tenant's
 * "Hosting types" catalog (`it_ops.hosting_types` in the tenant metadata, the list the locations
 * use: on premises, colocation, public cloud, private cloud, SaaS, each on premises or in the
 * cloud). It replaces `technologies.mode`, which said only installed or subscribed.
 *
 * NOT NULL DEFAULT 'on_prem', as `mode` was NOT NULL DEFAULT 'installed': every technology is on
 * premises or in the cloud, and the end-of-support report counts a technology on premises that is
 * on no server.
 *
 * Filled from `mode`: installed becomes on_prem, subscribed becomes saas; any other value (the
 * CHECK forbade it, a database that lost it may have one) becomes on_prem and is counted. The
 * code goes through the rule every writer uses (`resolveHostingType` of
 * `technologies/hosting-type.ts`): when the tenant's catalog has it retired or not at all, the
 * technology takes the first type in use of the same category, else the first type in use.
 *
 * Idempotent and self-healing: when the column is already there, its blank values are filled as
 * above and the others are trimmed and lowercased and kept, a code out of the catalog included:
 * the end-of-support report lists such a technology in its missing data. Then `mode` and its CHECK go, and the search
 * index function writes `hosting_type` in place of `mode`. The technologies carry a search index
 * trigger that writes `search_index` under its policy, so the fill runs per tenant with
 * `app.current_tenant` set.
 *
 * down() puts `mode` back, from the category of each type (cloud is subscribed, the rest
 * installed), and drops `hosting_type`.
 */

type HostingOption = { code: string; label: string; category?: string; deprecated?: boolean };

/** The hosting types served to tenants that never customised the list (`DEFAULT_HOSTING_TYPES`). */
const DEFAULT_TYPES: HostingOption[] = [
  { code: 'on_prem', label: 'On-prem', category: 'on_prem' },
  { code: 'colocation', label: 'Colocation', category: 'on_prem' },
  { code: 'public_cloud', label: 'Public Cloud', category: 'cloud' },
  { code: 'private_cloud', label: 'Private Cloud', category: 'cloud' },
  { code: 'saas', label: 'SaaS', category: 'cloud' },
];

/** The tenant's list as the settings read it: its own when it has an array, the defaults otherwise. */
function catalogOf(raw: unknown): HostingOption[] {
  if (!Array.isArray(raw)) return DEFAULT_TYPES;
  return raw
    .map((item: any) => {
      const code = String(item?.code ?? item?.value ?? '').trim().toLowerCase();
      return { code, label: code, category: item?.category, deprecated: !!item?.deprecated };
    })
    .filter((item) => item.code);
}

function tsv(weight: 'A' | 'B' | 'C', expr: string): string {
  return `search_index_tsv('${weight}', ${expr})`;
}

/** The refresh function of 1854200000000, with `extra` as the metadata it writes. */
function refreshFunction(extra: string): string {
  const vector = [
    tsv('A', `CONCAT_WS(' ', 'TEC-' || t.item_number::text, t.name, t.editor)`),
    tsv('B', `CONCAT_WS(' ', t.description, t.family)`),
    tsv('C', `CONCAT_WS(' ', t.notes, array_to_string(t.cpe_products, ' '))`),
  ].join(' || ');
  return `
  CREATE OR REPLACE FUNCTION search_index_refresh_technologies(p_tenant uuid, p_ids uuid[] DEFAULT NULL)
  RETURNS void AS $fn$
    DELETE FROM search_index si_del
    WHERE si_del.tenant_id = p_tenant
      AND si_del.entity_type = 'technologies'
      AND (p_ids IS NULL OR si_del.entity_id = ANY(p_ids))
      AND NOT EXISTS (
        SELECT 1 FROM technologies src
        WHERE src.id = si_del.entity_id AND src.tenant_id = p_tenant
      );
    INSERT INTO search_index (
      tenant_id, entity_type, entity_id, ref_prefix, ref_number,
      label, summary, status, extra_json, search_vector, source_updated_at, indexed_at
    )
    SELECT t.tenant_id,
           'technologies',
           t.id,
           'TEC',
           t.item_number,
           t.name,
           t.description,
           t.lifecycle,
           jsonb_build_object('family', t.family, 'editor', t.editor, ${extra}),
           ${vector},
           t.updated_at,
           now()
    FROM technologies t
    WHERE t.tenant_id = p_tenant
      AND (p_ids IS NULL OR t.id = ANY(p_ids))
    ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE SET
      ref_prefix = EXCLUDED.ref_prefix,
      ref_number = EXCLUDED.ref_number,
      label = EXCLUDED.label,
      summary = EXCLUDED.summary,
      status = EXCLUDED.status,
      extra_json = EXCLUDED.extra_json,
      search_vector = EXCLUDED.search_vector,
      source_updated_at = EXCLUDED.source_updated_at,
      indexed_at = EXCLUDED.indexed_at;
  $fn$ LANGUAGE sql;
`;
}

async function hasColumn(queryRunner: QueryRunner, column: string): Promise<boolean> {
  const rows = await queryRunner.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'technologies' AND column_name = $1`,
    [column],
  );
  return rows.length > 0;
}

async function tenantCatalogs(queryRunner: QueryRunner): Promise<Array<{ id: string; list: HostingOption[] }>> {
  const tenants: Array<{ id: string; hosting_types: unknown }> = await queryRunner.query(
    `SELECT id, metadata->'it_ops'->'hosting_types' AS hosting_types FROM tenants ORDER BY id`,
  );
  return tenants.map((tenant) => ({ id: tenant.id, list: catalogOf(tenant.hosting_types) }));
}

async function count(queryRunner: QueryRunner, sql: string, params: unknown[]): Promise<number> {
  const [row]: Array<{ count: number }> = await queryRunner.query(`WITH changed AS (${sql} RETURNING 1) SELECT count(*)::int AS count FROM changed`, params);
  return Number(row?.count ?? 0);
}

export class TechnologyHostingType1854310000000 implements MigrationInterface {
  name = 'TechnologyHostingType1854310000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('technologies'))) return;
    await queryRunner.query(`ALTER TABLE technologies ADD COLUMN IF NOT EXISTS hosting_type text NULL`);
    await queryRunner.query(`ALTER TABLE technologies ALTER COLUMN hosting_type TYPE text`);
    await queryRunner.query(`ALTER TABLE technologies ALTER COLUMN hosting_type DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE technologies ALTER COLUMN hosting_type DROP DEFAULT`);
    await queryRunner.query(refreshFunction(`'hosting_type', t.hosting_type`));

    const withMode = await hasColumn(queryRunner, 'mode');
    let filled = 0;
    let unknownModes = 0;
    let normalized = 0;
    for (const { id, list } of await tenantCatalogs(queryRunner)) {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [id]);
      const onPrem = resolveHostingType(list, 'on_prem');
      const saas = resolveHostingType(list, 'saas');
      normalized += await count(
        queryRunner,
        `UPDATE technologies SET hosting_type = lower(btrim(hosting_type))
          WHERE tenant_id = $1 AND btrim(hosting_type) <> '' AND hosting_type <> lower(btrim(hosting_type))`,
        [id],
      );
      if (withMode) {
        unknownModes += await count(
          queryRunner,
          `UPDATE technologies SET hosting_type = $2
            WHERE tenant_id = $1 AND (hosting_type IS NULL OR btrim(hosting_type) = '')
              AND mode IS DISTINCT FROM 'installed' AND mode IS DISTINCT FROM 'subscribed'`,
          [id, onPrem],
        );
        filled += await count(
          queryRunner,
          `UPDATE technologies SET hosting_type = CASE WHEN mode = 'subscribed' THEN $3 ELSE $2 END
            WHERE tenant_id = $1 AND (hosting_type IS NULL OR btrim(hosting_type) = '')`,
          [id, onPrem, saas],
        );
      } else {
        filled += await count(
          queryRunner,
          `UPDATE technologies SET hosting_type = $2 WHERE tenant_id = $1 AND (hosting_type IS NULL OR btrim(hosting_type) = '')`,
          [id, onPrem],
        );
      }
      // Rows the fill did not touch (a column already there) still carried `mode` in the index.
      await queryRunner.query(`SELECT search_index_refresh_technologies($1)`, [id]);
    }
    await queryRunner.query(`SELECT set_config('app.current_tenant', '', true)`);

    await queryRunner.query(`ALTER TABLE technologies ALTER COLUMN hosting_type SET DEFAULT 'on_prem'`);
    await queryRunner.query(`ALTER TABLE technologies ALTER COLUMN hosting_type SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE technologies DROP CONSTRAINT IF EXISTS technologies_mode_check`);
    await queryRunner.query(`ALTER TABLE technologies DROP COLUMN IF EXISTS mode`);

    if (filled || unknownModes || normalized) {
      console.log(
        `[migration 1854310000000] technologies.hosting_type: ${filled + unknownModes} filled from the mode`
        + ` (${unknownModes} with an unknown mode, set on premises), ${normalized} trimmed or lowercased`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('technologies'))) return;
    await queryRunner.query(`ALTER TABLE technologies ADD COLUMN IF NOT EXISTS mode text NULL`);
    const withHostingType = await hasColumn(queryRunner, 'hosting_type');
    await queryRunner.query(refreshFunction(`'mode', t.mode`));
    for (const { id, list } of await tenantCatalogs(queryRunner)) {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [id]);
      const cloud = list.filter((item) => hostingCategory(list, item.code) === 'cloud').map((item) => item.code);
      if (withHostingType) {
        // A code missing from the catalog takes the category the settings infer (on_prem and colocation on premises).
        await queryRunner.query(
          `UPDATE technologies
              SET mode = CASE WHEN hosting_type = ANY($2::text[])
                                OR (hosting_type NOT IN ('on_prem', 'colocation') AND NOT hosting_type = ANY($3::text[]))
                              THEN 'subscribed' ELSE 'installed' END
            WHERE tenant_id = $1 AND (mode IS NULL OR mode NOT IN ('installed', 'subscribed'))`,
          [id, cloud, list.map((item) => item.code)],
        );
      }
      await queryRunner.query(`UPDATE technologies SET mode = 'installed' WHERE tenant_id = $1 AND mode IS NULL`, [id]);
      await queryRunner.query(`SELECT search_index_refresh_technologies($1)`, [id]);
    }
    await queryRunner.query(`SELECT set_config('app.current_tenant', '', true)`);
    await queryRunner.query(`ALTER TABLE technologies ALTER COLUMN mode SET DEFAULT 'installed'`);
    await queryRunner.query(`ALTER TABLE technologies ALTER COLUMN mode SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE technologies DROP CONSTRAINT IF EXISTS technologies_mode_check`);
    await queryRunner.query(`ALTER TABLE technologies ADD CONSTRAINT technologies_mode_check CHECK (mode IN ('installed', 'subscribed'))`);
    await queryRunner.query(`ALTER TABLE technologies DROP COLUMN IF EXISTS hosting_type`);
  }
}
