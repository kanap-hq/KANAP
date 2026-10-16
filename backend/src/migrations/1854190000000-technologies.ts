import { MigrationInterface, QueryRunner } from 'typeorm';

/** Written as the comment of each unique key this migration adds, so down() drops only those. */
const MARK = 'Technologies1854190000000';
const LOG_PREFIX = '[Migration] Technologies:';

/**
 * The unique keys `(tenant_id, id)` the composite foreign keys below reference, added unless a
 * unique key on exactly these columns exists. `id` is the primary key of each table: no row can
 * violate them and nothing needs repairing.
 */
const TENANT_KEYS: Array<{ table: string; name: string }> = [
  { table: 'assets', name: 'assets_tenant_id_id_key' },
  { table: 'business_processes', name: 'business_processes_tenant_id_id_key' },
  { table: 'portfolio_projects', name: 'portfolio_projects_tenant_id_id_key' },
  { table: 'incidents', name: 'incidents_tenant_id_id_key' },
];

/** Every value `item_sequences.entity_type` accepts, `technology` (TEC-n) added. */
const ITEM_SEQUENCE_TYPES = [
  'task', 'request', 'project', 'document', 'application', 'asset', 'location', 'connection', 'interface',
  'spend', 'capex', 'incident', 'contributor', 'technology',
];

/** The values of `link-provenance.ts` (`LINK_SOURCES`), copied: a migration never imports application code. */
const LINK_SOURCES = ['manual', 'import', 'ai', 'agent', 'netbox'];

const TENANT_COLUMN = 'tenant_id uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants(id) ON DELETE CASCADE';

/** The three provenance columns of a link row (`common/link-provenance.ts`). */
const PROVENANCE_COLUMNS = (table: string) => `
        source text NOT NULL DEFAULT 'manual',
        source_ref text NULL,
        observed_at timestamptz NULL,
        CONSTRAINT ${table}_source_check CHECK (source IN (${LINK_SOURCES.map((s) => `'${s}'`).join(', ')})),
        CONSTRAINT ${table}_source_ref_check CHECK (source_ref IS NULL OR char_length(source_ref) <= 200),`;

/** Tables in creation order; down() drops them in reverse. */
const TABLES: Array<{ name: string; ddl: string; indexes: string[] }> = [
  {
    name: 'technologies',
    ddl: `
      CREATE TABLE IF NOT EXISTS technologies (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        ${TENANT_COLUMN},
        item_number int NOT NULL,
        name text NOT NULL,
        editor text NULL,
        family text NOT NULL DEFAULT 'other',
        mode text NOT NULL DEFAULT 'installed',
        lifecycle text NOT NULL DEFAULT 'active',
        description text NULL,
        notes text NULL,
        catalog_key text NULL,
        cpe_products text[] NOT NULL DEFAULT '{}',
        replaced_by_id uuid NULL,
        cyber_criticality text NULL,
        recovery_wave text NULL,
        rto_minutes int NULL,
        rpo_minutes int NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT technologies_name_check CHECK (btrim(name) <> '' AND char_length(name) <= 200),
        CONSTRAINT technologies_editor_check CHECK (editor IS NULL OR char_length(editor) <= 200),
        CONSTRAINT technologies_mode_check CHECK (mode IN ('installed', 'subscribed')),
        CONSTRAINT technologies_rto_check CHECK (rto_minutes IS NULL OR rto_minutes > 0),
        CONSTRAINT technologies_rpo_check CHECK (rpo_minutes IS NULL OR rpo_minutes >= 0),
        CONSTRAINT technologies_replaced_by_check CHECK (replaced_by_id IS NULL OR replaced_by_id <> id),
        CONSTRAINT technologies_tenant_id_id_key UNIQUE (tenant_id, id),
        CONSTRAINT technologies_tenant_item_number_key UNIQUE (tenant_id, item_number),
        CONSTRAINT technologies_replaced_by_fk
          FOREIGN KEY (tenant_id, replaced_by_id) REFERENCES technologies (tenant_id, id) ON DELETE SET NULL (replaced_by_id)
      )`,
    indexes: [
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_technologies_tenant_name ON technologies (tenant_id, lower(name))`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_technologies_tenant_catalog_key ON technologies (tenant_id, catalog_key) WHERE catalog_key IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_technologies_tenant_family ON technologies (tenant_id, family)`,
      `CREATE INDEX IF NOT EXISTS idx_technologies_tenant_editor ON technologies (tenant_id, lower(editor))`,
      `CREATE INDEX IF NOT EXISTS idx_technologies_tenant_replaced_by ON technologies (tenant_id, replaced_by_id)`,
    ],
  },
  {
    name: 'technology_versions',
    ddl: `
      CREATE TABLE IF NOT EXISTS technology_versions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        ${TENANT_COLUMN},
        technology_id uuid NOT NULL,
        label text NOT NULL,
        cpe_version text NULL,
        build_prefixes text[] NOT NULL DEFAULT '{}',
        standard_support_end date NULL,
        extended_support_end date NULL,
        notes text NULL,
        catalog_key text NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT technology_versions_label_check CHECK (btrim(label) <> '' AND char_length(label) <= 100),
        CONSTRAINT technology_versions_cpe_version_check CHECK (cpe_version IS NULL OR char_length(cpe_version) <= 100),
        CONSTRAINT technology_versions_support_check
          CHECK (extended_support_end IS NULL OR standard_support_end IS NULL OR extended_support_end >= standard_support_end),
        CONSTRAINT technology_versions_tenant_technology_id_key UNIQUE (tenant_id, technology_id, id),
        CONSTRAINT technology_versions_technology_fk
          FOREIGN KEY (tenant_id, technology_id) REFERENCES technologies (tenant_id, id) ON DELETE CASCADE
      )`,
    indexes: [
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_technology_versions_label ON technology_versions (tenant_id, technology_id, lower(label))`,
    ],
  },
  ...(['asset', 'application'] as const).map((side) => {
    const table = `${side}_technologies`;
    const target = side === 'asset' ? 'assets' : 'applications';
    return {
      name: table,
      ddl: `
      CREATE TABLE IF NOT EXISTS ${table} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        ${TENANT_COLUMN},
        ${side}_id uuid NOT NULL,
        technology_id uuid NOT NULL,
        technology_version_id uuid NULL,
        notes text NULL,${PROVENANCE_COLUMNS(table)}
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ${table}_key UNIQUE NULLS NOT DISTINCT (tenant_id, ${side}_id, technology_id, technology_version_id),
        CONSTRAINT ${table}_${side}_fk
          FOREIGN KEY (tenant_id, ${side}_id) REFERENCES ${target} (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT ${table}_technology_fk
          FOREIGN KEY (tenant_id, technology_id) REFERENCES technologies (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT ${table}_version_fk
          FOREIGN KEY (tenant_id, technology_id, technology_version_id)
          REFERENCES technology_versions (tenant_id, technology_id, id) ON DELETE SET NULL (technology_version_id)
      )`,
      indexes: [
        `CREATE INDEX IF NOT EXISTS idx_${table}_technology ON ${table} (tenant_id, technology_id, technology_version_id)`,
      ],
    };
  }),
  {
    name: 'technology_owners',
    ddl: `
      CREATE TABLE IF NOT EXISTS technology_owners (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        ${TENANT_COLUMN},
        technology_id uuid NOT NULL,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        owner_type text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT technology_owners_owner_type_check CHECK (owner_type IN ('business', 'it')),
        CONSTRAINT technology_owners_key UNIQUE (tenant_id, technology_id, user_id, owner_type),
        CONSTRAINT technology_owners_technology_fk
          FOREIGN KEY (tenant_id, technology_id) REFERENCES technologies (tenant_id, id) ON DELETE CASCADE
      )`,
    indexes: [`CREATE INDEX IF NOT EXISTS idx_technology_owners_user ON technology_owners (user_id)`],
  },
  ...([
    { table: 'technology_contracts', column: 'contract_id', target: 'contracts' },
    { table: 'technology_spend_items', column: 'spend_item_id', target: 'spend_items' },
    { table: 'technology_projects', column: 'project_id', target: 'portfolio_projects' },
  ]).map(({ table, column, target }) => ({
    name: table,
    ddl: `
      CREATE TABLE IF NOT EXISTS ${table} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        ${TENANT_COLUMN},
        technology_id uuid NOT NULL,
        ${column} uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ${table}_key UNIQUE (tenant_id, technology_id, ${column}),
        CONSTRAINT ${table}_technology_fk
          FOREIGN KEY (tenant_id, technology_id) REFERENCES technologies (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT ${table}_target_fk
          FOREIGN KEY (tenant_id, ${column}) REFERENCES ${target} (tenant_id, id) ON DELETE CASCADE
      )`,
    indexes: [`CREATE INDEX IF NOT EXISTS idx_${table}_target ON ${table} (tenant_id, ${column})`],
  })),
  {
    name: 'technology_attachments',
    ddl: `
      CREATE TABLE IF NOT EXISTS technology_attachments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        ${TENANT_COLUMN},
        technology_id uuid NOT NULL,
        original_filename text NOT NULL,
        stored_filename text NOT NULL,
        mime_type text NULL,
        size int NOT NULL DEFAULT 0,
        storage_path text NOT NULL,
        uploaded_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT technology_attachments_technology_fk
          FOREIGN KEY (tenant_id, technology_id) REFERENCES technologies (tenant_id, id) ON DELETE CASCADE
      )`,
    indexes: [`CREATE INDEX IF NOT EXISTS idx_technology_attachments_technology ON technology_attachments (tenant_id, technology_id)`],
  },
  {
    name: 'technology_links',
    ddl: `
      CREATE TABLE IF NOT EXISTS technology_links (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        ${TENANT_COLUMN},
        technology_id uuid NOT NULL,
        description text NULL,
        url text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT technology_links_url_check CHECK (btrim(url) <> '' AND char_length(url) <= 2000),
        CONSTRAINT technology_links_technology_fk
          FOREIGN KEY (tenant_id, technology_id) REFERENCES technologies (tenant_id, id) ON DELETE CASCADE
      )`,
    indexes: [`CREATE INDEX IF NOT EXISTS idx_technology_links_technology ON technology_links (tenant_id, technology_id)`],
  },
  {
    name: 'incident_technologies',
    ddl: `
      CREATE TABLE IF NOT EXISTS incident_technologies (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        ${TENANT_COLUMN},
        incident_id uuid NOT NULL,
        technology_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT incident_technologies_key UNIQUE (tenant_id, incident_id, technology_id),
        CONSTRAINT incident_technologies_incident_fk
          FOREIGN KEY (tenant_id, incident_id) REFERENCES incidents (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT incident_technologies_technology_fk
          FOREIGN KEY (tenant_id, technology_id) REFERENCES technologies (tenant_id, id) ON DELETE CASCADE
      )`,
    indexes: [`CREATE INDEX IF NOT EXISTS idx_incident_technologies_technology ON incident_technologies (tenant_id, technology_id)`],
  },
  {
    name: 'application_business_processes',
    ddl: `
      CREATE TABLE IF NOT EXISTS application_business_processes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        ${TENANT_COLUMN},
        application_id uuid NOT NULL,
        business_process_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT application_business_processes_key UNIQUE (tenant_id, application_id, business_process_id),
        CONSTRAINT application_business_processes_application_fk
          FOREIGN KEY (tenant_id, application_id) REFERENCES applications (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT application_business_processes_process_fk
          FOREIGN KEY (tenant_id, business_process_id) REFERENCES business_processes (tenant_id, id) ON DELETE CASCADE
      )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_application_business_processes_process ON application_business_processes (tenant_id, business_process_id)`,
    ],
  },
];

/**
 * The technology layer (plan planning/cartographie-technologies.md, lot S): what the IT runs or
 * subscribes to for the applications (SQL Server, Entra ID, vSphere), its versions, where it is
 * installed and what depends on it, with the governance an application has.
 *
 * 1. `assets`, `business_processes`, `portfolio_projects` and `incidents` get UNIQUE (tenant_id,
 *    id) unless an equivalent key exists: the composite keys below name a row of the same tenant
 *    (foreign-key checks bypass row level security). `applications`, `contracts` and `spend_items`
 *    already have theirs.
 * 2. `item_sequences.entity_type` accepts `technology` (references TEC-n).
 * 3. The new tables, each with RLS (ENABLE + FORCE) and the policy `<table>_tenant_isolation`
 *    (USING and WITH CHECK). The link to a version is the composite key (tenant_id, technology_id,
 *    technology_version_id) ON DELETE SET NULL (technology_version_id): the version belongs to the
 *    link's technology, and its delete makes the link "version unknown" without clearing tenant_id.
 *    `asset_technologies` and `application_technologies` are unique NULLS NOT DISTINCT, so the same
 *    technology with an unknown version cannot be named twice, and carry the provenance of the link.
 *
 * The tables are new and hold nothing: there is no backfill, and row level security is never
 * disabled. Every step looks at the catalog or uses IF NOT EXISTS: a second run changes nothing.
 * down() drops the tables and the unique keys this migration added; `item_sequences` keeps
 * accepting `technology`, which nothing writes once the tables are gone.
 */
export class Technologies1854190000000 implements MigrationInterface {
  name = 'Technologies1854190000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const added: string[] = [];
    for (const { table, name } of TENANT_KEYS) {
      if (await addUniqueIfAbsent(queryRunner, table, name, ['tenant_id', 'id'])) added.push(name);
    }

    await queryRunner.query(`ALTER TABLE item_sequences DROP CONSTRAINT IF EXISTS item_sequences_entity_type_check`);
    await queryRunner.query(
      `ALTER TABLE item_sequences ADD CONSTRAINT item_sequences_entity_type_check
         CHECK (entity_type IN (${ITEM_SEQUENCE_TYPES.map((t) => `'${t}'`).join(', ')}))`,
    );

    for (const table of TABLES) {
      await queryRunner.query(table.ddl);
      for (const index of table.indexes) await queryRunner.query(index);
      await queryRunner.query(`ALTER TABLE ${table.name} ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE ${table.name} FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`DROP POLICY IF EXISTS ${table.name}_tenant_isolation ON ${table.name}`);
      await queryRunner.query(`
        CREATE POLICY ${table.name}_tenant_isolation ON ${table.name}
          USING (tenant_id = app_current_tenant())
          WITH CHECK (tenant_id = app_current_tenant())
      `);
    }

    console.log(
      `${LOG_PREFIX} ${TABLES.length} tables ready, `
        + (added.length ? `unique keys added: ${added.join(', ')}` : 'unique keys already present'),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [...TABLES].reverse()) await queryRunner.query(`DROP TABLE IF EXISTS ${table.name}`);
    // Only the keys this migration added: an equivalent key found in place is left as it was.
    for (const { table, name } of TENANT_KEYS) {
      const marked = await queryRunner.query(
        `SELECT 1 FROM pg_constraint c
          WHERE c.conrelid = $1::regclass AND c.conname = $2
            AND obj_description(c.oid, 'pg_constraint') = $3`,
        [table, name, MARK],
      );
      if (marked.length > 0) await queryRunner.query(`ALTER TABLE ${table} DROP CONSTRAINT ${name}`);
    }
  }
}

/**
 * Adds `name` UNIQUE (columns) and marks it, unless a unique key on exactly these columns already
 * exists (a constraint or a plain unique index a foreign key can reference; an index left invalid by
 * a failed concurrent build does not count). Same check as `1854040000000`. True when added.
 */
async function addUniqueIfAbsent(queryRunner: QueryRunner, table: string, name: string, columns: string[]): Promise<boolean> {
  const existing = await queryRunner.query(
    `SELECT 1
     FROM pg_index i
     WHERE i.indrelid = $1::regclass
       AND i.indisunique AND i.indimmediate AND i.indisvalid AND i.indisready
       AND i.indpred IS NULL AND i.indexprs IS NULL
       AND i.indnkeyatts = cardinality($2::text[])
       AND (
         SELECT array_agg(a.attname::text ORDER BY a.attname::text)
         FROM unnest((i.indkey::int2[])[0:i.indnkeyatts - 1]) AS k(attnum)
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
       ) = (SELECT array_agg(c ORDER BY c) FROM unnest($2::text[]) AS c)`,
    [table, columns],
  );
  if (existing.length > 0) return false;
  await queryRunner.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} UNIQUE (${columns.join(', ')})`);
  await queryRunner.query(`COMMENT ON CONSTRAINT ${name} ON ${table} IS '${MARK}'`);
  return true;
}
