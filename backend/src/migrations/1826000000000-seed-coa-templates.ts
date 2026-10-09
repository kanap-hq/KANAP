import { MigrationInterface, QueryRunner } from 'typeorm';
import { TEMPLATES } from '../seed/coa-templates';

/**
 * Seeds the coa_templates table with default CoA templates for IFRS + 9 country standards.
 *
 * DESTRUCTIVE: Deletes ALL existing coa_templates rows before inserting.
 * This is intentional — previously these templates were created manually via the
 * platform admin UI. Codifying them here makes every environment reproducible.
 * Tenant CoAs copied from previous templates are unaffected (no FK dependency).
 */
export class SeedCoaTemplates1826000000000 implements MigrationInterface {
  name = 'SeedCoaTemplates1826000000000';

  private readonly EXPECTED_HEADERS = [
    'account_number',
    'account_name',
    'native_name',
    'description',
    'consolidation_account_number',
    'consolidation_account_name',
    'consolidation_account_description',
    'status',
  ];

  /** Optional 9th column: the OPEX/CAPEX nature of the account (`opex`, `capex` or empty). */
  private readonly OPTIONAL_LAST_HEADER = 'nature';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Step 1: Validate all CSV payloads before any DB writes ──
    for (const t of TEMPLATES) {
      this.validateCsv(t.template_code, t.version, t.csv);
    }

    // ── Step 2: Clean slate — delete all existing templates ──
    await queryRunner.query(`DELETE FROM coa_templates`);

    // ── Step 3: Insert all templates and collect their IDs ──
    const insertedIds: string[] = [];
    for (const t of TEMPLATES) {
      const [{ id }] = await queryRunner.query(
        `INSERT INTO coa_templates (country_iso, template_code, template_name, version, is_global, loaded_by_default, csv_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [t.country_iso, t.template_code, t.template_name, t.version, t.is_global, t.loaded_by_default, t.csv],
      );
      insertedIds.push(id);
    }

    // ── Step 4: Assert exactly one global default template ──
    const [{ count }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS count FROM coa_templates WHERE is_global = true AND loaded_by_default = true`,
    );
    if (count !== 1) {
      throw new Error(
        `Expected exactly 1 global default template, found ${count}`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only delete rows that were seeded by this migration.
    // Uses csv_payload IS NOT NULL as a distinguishing marker (manually created
    // templates via the admin UI also have csv_payload, but after reverting this
    // migration we expect no rows to remain from the seed).
    // Scoped to exact (template_code, version, is_global) tuples from TEMPLATES
    // to avoid removing templates created later with the same code but different
    // is_global flag or other metadata.
    for (const t of TEMPLATES) {
      await queryRunner.query(
        `DELETE FROM coa_templates
          WHERE template_code = $1
            AND version = $2
            AND is_global = $3
            AND COALESCE(country_iso, '') = COALESCE($4, '')`,
        [t.template_code, t.version, t.is_global, t.country_iso],
      );
    }
  }

  /**
   * Validates a CSV payload string:
   * - Headers match the expected 8-column schema, optionally followed by `nature`
   *   (the template files carry it since migration 1853890000000, and this migration
   *   inserts the current files)
   * - Every account_number parses as integer
   * - Every non-empty consolidation_account_number parses as integer
   * - status is 'enabled' or 'disabled'
   *
   * NOTE: This uses simple line-based split(';') parsing, NOT the fast-csv
   * library used by the runtime importer (admin-coa-templates.service.ts).
   * This is intentional — seed data is fully controlled and never contains
   * quoted semicolons or other edge cases that require a streaming CSV parser.
   * If future seed data needs quoted fields, switch to fast-csv here too.
   */
  private validateCsv(code: string, version: string, raw: string): void {
    const label = `${code} v${version}`;
    // Strip BOM
    const clean = raw.replace(/^\ufeff/, '');
    const lines = clean.split('\n').filter((l) => l.trim().length > 0);

    if (lines.length < 2) {
      throw new Error(`${label}: CSV must have a header + at least one data row`);
    }

    // Validate headers
    const headers = lines[0].split(';').map((h) => h.trim());
    const withNature = headers.length === this.EXPECTED_HEADERS.length + 1;
    const expected = withNature ? [...this.EXPECTED_HEADERS, this.OPTIONAL_LAST_HEADER] : this.EXPECTED_HEADERS;
    if (headers.length !== expected.length) {
      throw new Error(
        `${label}: Expected ${this.EXPECTED_HEADERS.length} or ${this.EXPECTED_HEADERS.length + 1} columns, got ${headers.length}`,
      );
    }
    for (let i = 0; i < expected.length; i++) {
      if (headers[i] !== expected[i]) {
        throw new Error(
          `${label}: Header[${i}] expected "${expected[i]}", got "${headers[i]}"`,
        );
      }
    }

    // Validate data rows
    for (let r = 1; r < lines.length; r++) {
      const cols = lines[r].split(';');
      if (cols.length !== expected.length) {
        throw new Error(
          `${label} row ${r}: Expected ${expected.length} columns, got ${cols.length}`,
        );
      }

      const accountNumber = cols[0].trim();
      if (!accountNumber || !Number.isInteger(Number(accountNumber))) {
        throw new Error(
          `${label} row ${r}: account_number "${accountNumber}" is not a valid integer`,
        );
      }

      const consolNumber = cols[4].trim();
      if (consolNumber && !Number.isInteger(Number(consolNumber))) {
        throw new Error(
          `${label} row ${r}: consolidation_account_number "${consolNumber}" is not a valid integer`,
        );
      }

      const status = cols[7].trim().toLowerCase();
      if (status !== 'enabled' && status !== 'disabled') {
        throw new Error(
          `${label} row ${r}: status "${status}" must be "enabled" or "disabled"`,
        );
      }

      if (withNature) {
        const nature = cols[8].trim();
        if (nature !== '' && nature !== 'opex' && nature !== 'capex') {
          throw new Error(
            `${label} row ${r}: nature "${nature}" must be "opex", "capex" or empty`,
          );
        }
      }
    }
  }
}
