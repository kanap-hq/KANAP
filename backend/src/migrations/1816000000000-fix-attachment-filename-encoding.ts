import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Fix garbled attachment filenames caused by multer latin1 encoding bug.
 *
 * Multer v1.4.5 decodes multipart filenames as latin1 instead of UTF-8,
 * so filenames with accented characters (e.g. "rapport-été.pdf") were stored
 * as garbled latin1 (e.g. "rapport-Ã©tÃ©.pdf") in the original_filename column.
 *
 * This migration re-encodes those values back to proper UTF-8 using PostgreSQL's
 * convert_from/convert_to functions.
 */
export class FixAttachmentFilenameEncoding1816000000000 implements MigrationInterface {
  name = 'FixAttachmentFilenameEncoding1816000000000'

  private readonly tables = [
    'task_attachments',
    'portfolio_project_attachments',
    'portfolio_request_attachments',
    'asset_attachments',
    'contract_attachments',
    'spend_attachments',
    'capex_attachments',
    'application_attachments',
    'interface_attachments',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tenants: { id: string }[] = await queryRunner.query(`SELECT id FROM tenants`);

    for (const { id: tenantId } of tenants) {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

      for (const table of this.tables) {
        const result = await queryRunner.query(`
          UPDATE ${table}
          SET original_filename = convert_from(convert_to(original_filename, 'LATIN1'), 'UTF8')
          WHERE original_filename ~ '[\\xC0-\\xDF][\\x80-\\xBF]'
        `);
        // An UPDATE answers [rows, rowCount]: the length is always 2.
        const count = Array.isArray(result) ? Number(result[1] ?? 0) : 0;
        if (count > 0) {
          console.log(`[Migration] Fixed ${count} garbled filename(s) in ${table} for tenant ${tenantId}`);
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tenants: { id: string }[] = await queryRunner.query(`SELECT id FROM tenants`);

    for (const { id: tenantId } of tenants) {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

      for (const table of this.tables) {
        await queryRunner.query(`
          UPDATE ${table}
          SET original_filename = convert_from(convert_to(original_filename, 'UTF8'), 'LATIN1')
          WHERE original_filename ~ '[\\x80-\\xFF]'
        `);
      }
    }
  }
}
