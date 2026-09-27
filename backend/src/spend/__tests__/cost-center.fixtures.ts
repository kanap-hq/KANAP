import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { SpendItemsService } from '../spend-items.service';
import { SpendItemsCsvService } from '../spend-items-csv.service';
import { CapexItemsService } from '../../capex/capex-items.service';
import { ItemNumberService } from '../../common/item-number.service';
import { captureAudit, Kind, noFreeze } from './round-inputs.fixtures';

// Shared fixtures of the item cost center specs (not a spec itself): master
// data seeded by SQL in the caller's transaction, and the item services built
// with the dependencies their create, update and CSV paths use.

const identityFx = {
  resolveRates: async () => ({ map: new Map(), settings: { reportingCurrency: 'EUR', allowedCurrencies: null } }),
  convertValue: (amount: number, rate: number) => amount * rate,
};
const noAllocations = { computeForVersions: async () => new Map() };
const noContacts = { syncFromSupplier: async () => undefined };
const noNotifications = { notifyStatusChange: () => undefined, notifyShare: () => undefined };

/** The item service of a type: create, update, summary and (CAPEX) CSV. */
export function itemService(kind: Kind): any {
  if (kind === 'opex') {
    const args: any[] = Array.from({ length: 13 }, () => undefined);
    args[4] = captureAudit();
    args[5] = noAllocations;
    args[8] = identityFx;
    args[10] = noContacts;
    args[11] = noNotifications;
    args[12] = new ItemNumberService();
    return new (SpendItemsService as any)(...args);
  }
  const args: any[] = Array.from({ length: 12 }, () => undefined);
  args[4] = noAllocations;
  args[5] = captureAudit();
  args[6] = noFreeze;
  args[7] = identityFx;
  args[9] = noContacts;
  args[10] = new ItemNumberService();
  args[11] = noNotifications;
  return new (CapexItemsService as any)(...args);
}

/** The CSV importer and exporter of a type. */
export function csvService(kind: Kind): any {
  if (kind === 'capex') return itemService('capex');
  const args: any[] = Array.from({ length: 11 }, () => undefined);
  args[7] = captureAudit();
  args[8] = noFreeze;
  args[9] = { getSettings: async () => ({ allowedCurrencies: null }) };
  args[10] = new ItemNumberService();
  return new (SpendItemsCsvService as any)(...args);
}

/** A company with its own chart of accounts and one account in it. */
export async function seedCompany(runner: QueryRunner, tenantId: string, name: string, accountNumber = 6000) {
  const [chart] = await runner.query(
    `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, $2, $3, 'FR') RETURNING id`,
    [tenantId, `C${randomUUID().slice(0, 8)}`, `${name} chart`],
  );
  const [company] = await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city, coa_id) VALUES ($1, $2, 'FR', 'Lyon', $3) RETURNING id`,
    [tenantId, name, chart.id],
  );
  const [account] = await runner.query(
    `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, chart.id, accountNumber, `${name} account`],
  );
  return { companyId: company.id as string, chartId: chart.id as string, accountId: account.id as string };
}

export async function seedUser(runner: QueryRunner, tenantId: string, email: string, status = 'enabled'): Promise<string> {
  const [role] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, 'Cost center test role', false, false, now(), now()) RETURNING id`,
    [tenantId, `Cost center test role ${email}`],
  );
  const [user] = await runner.query(
    `INSERT INTO users (tenant_id, role_id, email, first_name, last_name, status) VALUES ($1, $2, $3, 'Cost', 'Owner', $4) RETURNING id`,
    [tenantId, role.id, email, status],
  );
  return user.id;
}

export async function seedCostCenter(
  runner: QueryRunner,
  tenantId: string,
  node: { code: string; name: string; kind?: 'group' | 'cost_center'; parentId?: string | null; companyId?: string | null; disabled?: boolean },
): Promise<string> {
  const kind = node.kind ?? 'cost_center';
  const [row] = await runner.query(
    `INSERT INTO cost_centers (tenant_id, code, kind, name, parent_id, company_id, status, disabled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      tenantId, node.code, kind, node.name, node.parentId ?? null, kind === 'group' ? null : node.companyId ?? null,
      node.disabled ? 'disabled' : 'enabled', node.disabled ? new Date(Date.now() - 86_400_000) : null,
    ],
  );
  return row.id;
}

/** Disable a node now (its end of validity yesterday). */
export async function disableCostCenter(runner: QueryRunner, id: string) {
  await runner.query(`UPDATE cost_centers SET status = 'disabled', disabled_at = now() - interval '1 day' WHERE id = $1`, [id]);
}

/** The body of a valid new line of each type, without company. */
export function lineBody(kind: Kind, name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const base = kind === 'opex'
    ? { product_name: name, currency: 'EUR', effective_start: '2026-01-01' }
    : { description: name, ppe_type: 'hardware', investment_type: 'replacement', priority: 'medium', currency: 'EUR', effective_start: '2026-01-01' };
  return { ...base, ...extra };
}

export const ITEM_TABLE: Record<Kind, string> = { opex: 'spend_items', capex: 'capex_items' };

/** Run `fn` in a savepoint that is always rolled back; returns the error it threw (or fails). */
export async function refusal(runner: QueryRunner, fn: () => Promise<unknown>): Promise<Error> {
  await runner.query('SAVEPOINT item_write_refusal');
  let error: Error | null = null;
  try {
    await fn();
  } catch (err) {
    error = err as Error;
  }
  await runner.query('ROLLBACK TO SAVEPOINT item_write_refusal');
  if (!error) throw new Error('expected a refusal, the write succeeded');
  return error;
}
