import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../../data-source';
import { AuditLog } from '../../../audit/audit.entity';
import { AuditService } from '../../../audit/audit.service';
import { CompaniesService } from '../../../companies/companies.service';
import { Company } from '../../../companies/company.entity';
import { CompanyMetric } from '../../../companies/company-metric.entity';
import { CompanyMetricsService } from '../../../companies/company-metrics.service';
import { SuppliersService } from '../../../suppliers/suppliers.service';
import { realFreeze } from '../../../spend/__tests__/round-inputs.fixtures';
import type { MasterDataImportResult } from '../master-data';
import { si, workbookParts, zipOf } from '../../xlsx/__tests__/fixtures/handmade';

// Lot I4 of 26.11.9 (D21): an export re-imported as it is changes nothing. A stored "-" is exported
// as `'-` (the formula guard), in CSV and in .xlsx; the import reads that cell as the text "-",
// where a typed `-` clears the value.

const upload = (content: string | Buffer, name: string) =>
  ({ buffer: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'), originalname: name }) as any;

function assertNothingChanges(result: MasterDataImportResult, label: string) {
  assert.deepEqual(result.errors, [], `${label}: no error`);
  assert.equal(result.ok, true, label);
  assert.equal(result.cleared ?? 0, 0, `${label}: nothing cleared`);
  assert.equal(result.updated, 0, `${label}: no row changed`);
  assert.equal(result.inserted, 0, `${label}: no row created`);
}

async function main() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Dash round trip', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `dash-rt-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const manager = runner.manager;
    const audit = new AuditService(manager.getRepository(AuditLog));

    // Suppliers: "-" stored in the ERP id and the notes.
    const suppliers = new SuppliersService(undefined as any, audit);
    await runner.query(`INSERT INTO suppliers (tenant_id, name, item_number, erp_supplier_id, notes) VALUES ($1, 'Acme', 1, '-', '-')`, [tenantId]);
    const supplierCsv = await suppliers.exportCsv('data', { manager, language: 'en' });
    assert.match(String(supplierCsv.content), /'-/, 'the export guards the stored dash');
    const supplierXlsx = await suppliers.exportCsv('data', { manager, language: 'en', format: 'xlsx' });
    for (const [label, content, name] of [['suppliers csv', supplierCsv.content, 'f.csv'], ['suppliers xlsx', supplierXlsx.content, 'f.xlsx']] as const) {
      const result = await suppliers.importCsv({ file: upload(content, name), dryRun: false, userId: null, language: 'en', mode: 'enrich' }, { manager });
      assertNothingChanges(result, label);
    }
    assert.deepEqual(
      await runner.query(`SELECT erp_supplier_id, notes FROM suppliers WHERE tenant_id = $1`, [tenantId]),
      [{ erp_supplier_id: '-', notes: '-' }],
    );

    // Companies: "-" stored as the city, a value that cannot be cleared.
    const metrics = new CompanyMetricsService(manager.getRepository(CompanyMetric), audit, realFreeze());
    const companies = new CompaniesService(manager.getRepository(Company), audit, metrics);
    const year = new Date().getFullYear();
    const created = await companies.importCsv(
      { file: upload('name;city;country_iso;base_currency\nAcme SA;-;FR;EUR\n', 'c.csv'), dryRun: false, userId: null, year, language: 'en', mode: 'replace' },
      { manager },
    );
    assert.equal(created.inserted, 1);
    const companyCsv = await companies.exportCsv('data', { manager, language: 'en', year });
    const companyXlsx = await companies.exportCsv('data', { manager, language: 'en', year, format: 'xlsx' });
    for (const [label, content, name] of [['companies csv', companyCsv.content, 'c.csv'], ['companies xlsx', companyXlsx.content, 'c.xlsx']] as const) {
      const result = await companies.importCsv({ file: upload(content, name), dryRun: false, userId: null, year, language: 'en', mode: 'enrich' }, { manager });
      assertNothingChanges(result, label);
    }
    assert.deepEqual(await runner.query(`SELECT city FROM companies WHERE tenant_id = $1`, [tenantId]), [{ city: '-' }]);

    // A typed `-` still clears, and `'-` written by hand keeps a dash.
    const typed = await suppliers.importCsv(
      { file: upload('name;erp_supplier_id;notes\nAcme;-;\'-\n', 's.csv'), dryRun: false, userId: null, language: 'en', mode: 'enrich' },
      { manager },
    );
    assert.equal(typed.cleared, 1, 'the typed dash clears the ERP id');
    assert.deepEqual(
      await runner.query(`SELECT erp_supplier_id, notes FROM suppliers WHERE tenant_id = $1`, [tenantId]),
      [{ erp_supplier_id: null, notes: '-' }],
    );

    // `'-` typed in Excel: the cell holds "-" and its style the apostrophe (`quotePrefix`). It keeps a
    // dash, where "-" typed alone clears.
    const parts = workbookParts({
      sharedStrings: [si('name'), si('erp_supplier_id'), si('notes'), si('Acme'), si('-')],
      cellXfs: [0, 0],
      sheetData: '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>'
        + '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s" s="1"><v>4</v></c><c r="C2" t="s"><v>4</v></c></row>',
    });
    parts['xl/styles.xml'] = String(parts['xl/styles.xml']).replace(/(<cellXfs><xf [^>]*)\/>(<xf [^>]*)\/>/, '$1/>$2 quotePrefix="1"/>');
    const excel = await suppliers.importCsv(
      { file: upload(zipOf(parts), 's.xlsx'), dryRun: false, userId: null, language: 'en', mode: 'enrich' },
      { manager },
    );
    assert.deepEqual(excel.errors, []);
    assert.equal(excel.cleared, 1, 'the dash typed alone clears the notes');
    assert.deepEqual(
      await runner.query(`SELECT erp_supplier_id, notes FROM suppliers WHERE tenant_id = $1`, [tenantId]),
      [{ erp_supplier_id: '-', notes: null }],
    );
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
  console.log('guarded-dash-round-trip.integration.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
