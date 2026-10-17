import { MigrationInterface, QueryRunner } from 'typeorm';
import { ensureReferenceKey } from '../common/migration-reference-keys';

const LOG_PREFIX = '[Migration] Vulnerabilities:';

/** The states a user gives a vulnerability of a technology (`vulnerabilities/vulnerability-rules.ts`), copied. */
const STATES = ['to_review', 'handled', 'not_affected'];
/** Why a row matches (`vulnerabilities/vulnerability-rules.ts`), copied: a migration never imports application code. */
const MATCH_BASES = ['version_in_range', 'version_not_comparable', 'version_unknown'];

const list = (values: string[]) => values.map((v) => `'${v}'`).join(', ');

/**
 * The platform cache of the NVD feed: no `tenant_id`, shared by the whole installation, as the
 * exchange rates. Nothing in them names a tenant.
 */
const PLATFORM_TABLES: Array<{ name: string; ddl: string; indexes: string[] }> = [
  {
    name: 'vulnerability_cves',
    ddl: `
      CREATE TABLE IF NOT EXISTS vulnerability_cves (
        cve_id text PRIMARY KEY,
        summary text NULL,
        cvss_score numeric(3,1) NULL,
        severity text NULL,
        cvss_version text NULL,
        cvss_vector text NULL,
        published_at timestamptz NULL,
        last_modified_at timestamptz NULL,
        nvd_status text NULL,
        reference_urls text[] NOT NULL DEFAULT '{}',
        fetched_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT vulnerability_cves_id_check CHECK (cve_id ~ '^CVE-[0-9]{4}-[0-9]{4,}$'),
        CONSTRAINT vulnerability_cves_severity_check CHECK (severity IS NULL OR severity IN ('none', 'low', 'medium', 'high', 'critical')),
        CONSTRAINT vulnerability_cves_cvss_version_check CHECK (cvss_version IS NULL OR cvss_version IN ('3.1', '3.0', '4.0', '2.0'))
      )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_vulnerability_cves_published ON vulnerability_cves (published_at)`,
    ],
  },
  {
    name: 'vulnerability_cve_matches',
    ddl: `
      CREATE TABLE IF NOT EXISTS vulnerability_cve_matches (
        id bigserial PRIMARY KEY,
        cve_id text NOT NULL REFERENCES vulnerability_cves (cve_id) ON DELETE CASCADE,
        product text NOT NULL,
        criteria text NOT NULL,
        version_exact text NULL,
        version_start text NULL,
        start_including boolean NULL,
        version_end text NULL,
        end_including boolean NULL,
        vulnerable boolean NOT NULL
      )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_vulnerability_cve_matches_product ON vulnerability_cve_matches (product) WHERE vulnerable`,
      `CREATE INDEX IF NOT EXISTS idx_vulnerability_cve_matches_cve ON vulnerability_cve_matches (cve_id)`,
    ],
  },
  {
    name: 'vulnerability_feed_products',
    ddl: `
      CREATE TABLE IF NOT EXISTS vulnerability_feed_products (
        product text PRIMARY KEY,
        last_success_at timestamptz NULL,
        last_attempt_at timestamptz NULL,
        last_error text NULL
      )`,
    indexes: [],
  },
];

const TENANT_TABLE = 'technology_vulnerabilities';

/**
 * Vulnerabilities (lot T6a of planning/cartographie-technologies.md).
 *
 * Three platform tables, without `tenant_id` and without row level security (the NVD cache and the
 * feed's progress per CPE product), and one tenant table, `technology_vulnerabilities`: a CVE that
 * concerns a technology of the tenant, for one version or for the unknown version (`NULL`), with the
 * state the users give it. Its `cve_id` names a row of the cache without a foreign key, so the
 * tenant export and the tenant purge stay within the tenant's tables. RLS ENABLE + FORCE and the
 * canonical policy `<table>_tenant_isolation` (USING and WITH CHECK); unique NULLS NOT DISTINCT on
 * (tenant, technology, version, CVE); the version is a composite key ON DELETE CASCADE (a version
 * deleted takes its rows with it: setting it to NULL could collide with the unknown-version row).
 * `state_changed_by` names a user ON DELETE SET NULL (`common/migration-reference-keys.ts`).
 *
 * The tables are new and hold nothing: no backfill, row level security never disabled. Every step
 * uses IF NOT EXISTS or drops before creating: a second run changes nothing.
 */
export class Vulnerabilities1854260000000 implements MigrationInterface {
  name = 'Vulnerabilities1854260000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of PLATFORM_TABLES) {
      await queryRunner.query(table.ddl);
      for (const index of table.indexes) await queryRunner.query(index);
    }

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${TENANT_TABLE} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants(id) ON DELETE CASCADE,
        technology_id uuid NOT NULL,
        technology_version_id uuid NULL,
        cve_id text NOT NULL,
        state text NOT NULL DEFAULT 'to_review',
        note text NULL,
        state_changed_by uuid NULL,
        state_changed_at timestamptz NULL,
        match_basis text NOT NULL,
        matching boolean NOT NULL DEFAULT true,
        detected_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ${TENANT_TABLE}_state_check CHECK (state IN (${list(STATES)})),
        CONSTRAINT ${TENANT_TABLE}_match_basis_check CHECK (match_basis IN (${list(MATCH_BASES)})),
        CONSTRAINT ${TENANT_TABLE}_note_check CHECK (note IS NULL OR char_length(note) <= 4000),
        CONSTRAINT ${TENANT_TABLE}_cve_check CHECK (cve_id ~ '^CVE-[0-9]{4}-[0-9]{4,}$'),
        CONSTRAINT ${TENANT_TABLE}_key UNIQUE NULLS NOT DISTINCT (tenant_id, technology_id, technology_version_id, cve_id),
        CONSTRAINT ${TENANT_TABLE}_technology_fk
          FOREIGN KEY (tenant_id, technology_id) REFERENCES technologies (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT ${TENANT_TABLE}_version_fk
          FOREIGN KEY (tenant_id, technology_id, technology_version_id)
          REFERENCES technology_versions (tenant_id, technology_id, id) ON DELETE CASCADE
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_${TENANT_TABLE}_cve ON ${TENANT_TABLE} (tenant_id, cve_id)`);
    // Who last set the state: cleared when that user is deleted, as every other `*_by` column.
    await ensureReferenceKey(
      queryRunner,
      {
        table: TENANT_TABLE,
        column: 'state_changed_by',
        refTable: 'users',
        name: `fk_${TENANT_TABLE}_state_changed_by`,
        onDelete: 'SET NULL',
        orphans: 'clear',
      },
      (line) => console.log(`${LOG_PREFIX} ${line}`),
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_${TENANT_TABLE}_state_changed_by ON ${TENANT_TABLE} (state_changed_by)`,
    );
    await queryRunner.query(`ALTER TABLE ${TENANT_TABLE} ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE ${TENANT_TABLE} FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP POLICY IF EXISTS ${TENANT_TABLE}_tenant_isolation ON ${TENANT_TABLE}`);
    await queryRunner.query(`
      CREATE POLICY ${TENANT_TABLE}_tenant_isolation ON ${TENANT_TABLE}
        USING (tenant_id = app_current_tenant())
        WITH CHECK (tenant_id = app_current_tenant())
    `);

    console.log(`${LOG_PREFIX} ${PLATFORM_TABLES.length} platform tables and ${TENANT_TABLE} ready`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS ${TENANT_TABLE}`);
    for (const table of [...PLATFORM_TABLES].reverse()) await queryRunner.query(`DROP TABLE IF EXISTS ${table.name}`);
  }
}
