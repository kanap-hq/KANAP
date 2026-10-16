import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import en from '../../locales/en/admin.json';
import fr from '../../locales/fr/admin.json';
import de from '../../locales/de/admin.json';
import es from '../../locales/es/admin.json';
import AUDIT_TABLES from './__fixtures__/audit-tables.json';
import { auditTableFilterLabel } from './auditLogLabels';

// Every table the audit log may name has a label in the four languages. The names come from two
// places: the fixture (every `table_name` the log holds, including the names the backend builds at
// run time, such as the CAPEX labels of budget rows and the AI run records), and the backend
// sources, read at run time: each literal `table: '<name>'` of an audit entry (an object that also
// has an `action`), and the CAPEX audit labels of `spend/budget-nature.ts`. A new audited table
// without a label fails here. The frontend image holds no backend file: a checkout without the
// backend checks the fixture only.

type NodeFs = {
  existsSync(path: URL): boolean;
  readFileSync(path: URL, encoding: 'utf8'): string;
  readdirSync(path: URL, options: { recursive: true }): string[];
};

const fs = (globalThis as unknown as { process: { getBuiltinModule(id: 'node:fs'): NodeFs } }).process.getBuiltinModule('node:fs');
// Through a variable: Vite rewrites `new URL('…', import.meta.url)` into an asset URL.
const TEST_FILE = import.meta.url;
const BACKEND_SRC = new URL('../../../../backend/src/', TEST_FILE);
const hasBackend = fs.existsSync(new URL('audit/audit.service.ts', BACKEND_SRC));

/** The table names the backend sources write to the audit log as literals. */
function backendAuditTables(): Set<string> {
  const names = new Set<string>();
  const files = fs.readdirSync(BACKEND_SRC, { recursive: true })
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts') && !/(^|\/)(__tests__|migrations)\//.test(file));
  for (const file of files) {
    const source = fs.readFileSync(new URL(file, BACKEND_SRC), 'utf8');
    for (const match of source.matchAll(/\btable:\s*'([a-z_]+)'\s*,[^{}]{0,400}?\baction\s*[:,}]/g)) names.add(match[1]);
  }
  const nature = fs.readFileSync(new URL('spend/budget-nature.ts', BACKEND_SRC), 'utf8');
  const capex = nature.slice(nature.indexOf('CAPEX_AUDIT_LABELS'), nature.indexOf('};', nature.indexOf('CAPEX_AUDIT_LABELS')));
  for (const match of capex.matchAll(/^\s*([a-z_]+):\s*'([a-z_]+)'/gm)) {
    names.add(match[1]);
    names.add(match[2]);
  }
  return names;
}

describe('audit log table names', () => {
  it.skipIf(!hasBackend)('finds the audited tables in the backend sources', () => {
    const fromBackend = backendAuditTables();
    // The scan sees the literal names and the CAPEX labels; a sample proves both are read.
    for (const name of ['suppliers', 'notification_preferences', 'tenants_plan', 'coa_template_accounts', 'capex_items', 'spend_items']) {
      expect(fromBackend.has(name), name).toBe(true);
    }
  });

  it('has a label for every audited table in the four languages', () => {
    const names = new Set<string>([...AUDIT_TABLES, ...(hasBackend ? backendAuditTables() : [])]);
    const locales = { en, fr, de, es } as Record<string, any>;
    for (const name of names) {
      for (const [language, locale] of Object.entries(locales)) {
        const label = locale.auditLogs?.tableNames?.[name];
        expect(typeof label === 'string' && label.trim().length > 0, `${language} auditLogs.tableNames.${name}`).toBe(true);
        // A label, not the stored name.
        expect(label, `${language} auditLogs.tableNames.${name}`).not.toBe(name);
      }
    }
  });

  it('names a table in the reader language, and an unknown one as stored', () => {
    const t = (language: string) => i18n.getFixedT(language, 'admin') as unknown as (key: string, options?: Record<string, unknown>) => string;
    expect(auditTableFilterLabel('suppliers', t('fr'))).toBe('Fournisseurs');
    expect(auditTableFilterLabel('contract_links', t('fr'))).toBe('Liens de contrat');
    expect(auditTableFilterLabel('spend_items', t('en'))).toBe('OPEX lines');
    expect(auditTableFilterLabel('some_new_table', t('en'))).toBe('some_new_table');
    expect(auditTableFilterLabel(null, t('en'))).toBe('-');
  });
});
