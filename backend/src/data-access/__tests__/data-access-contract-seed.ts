import { PgClient } from './data-access-test-helpers';
import { Seed, nextItemNumber, seed as seedLines } from './data-access-line-seed';

/**
 * Contracts of the lot 5 specs, on the reference example of lot 2 (`data-access-line-seed.ts`):
 *   CF  Alpha France / INF-FR     CE  Alpha Espagne / no place
 *   CL  Alpha France / no place, read through line L1 only (contract_spend_items)
 *   CN  Alpha France / no place, Nina owner
 *   CH  Alpha France / no place, hidden from every limited person of the fixture
 *   CX  Alpha France / INF-ES (read by Marta and Paul through the node, not modifiable by Marta)
 *
 * CE is linked to L1 (contract_spend_items), L5 and L6 (contract_spend_items) and L7
 * (spend_items.contract_id): the hidden-line counts of the two forms. CL carries the documents
 * closed to a person who reads the contract through a line (three), CE two documents.
 * An application, an asset and a technology are linked to CF, CE and CH; three tasks hang on CH
 * (one with Paul as assignee) and CE.
 */
export type ContractLabel = 'CF' | 'CE' | 'CL' | 'CN' | 'CH' | 'CX';
export const CONTRACT_LABELS: ContractLabel[] = ['CF', 'CE', 'CL', 'CN', 'CH', 'CX'];

export type ContractSeed = Seed & {
  contracts: Record<ContractLabel, string>;
  supplier: string;
  application: string;
  applicationB: string;
  asset: string;
  assetB: string;
  technology: string;
  technologyB: string;
  tasks: { hidden: string; hiddenParticipant: string; visible: string };
  /** Attachments plus document links of each contract. */
  documents: Record<ContractLabel, number>;
};

export async function seedContracts(client: PgClient): Promise<ContractSeed> {
  const s = await seedLines(client);
  const tag = s.tenantId.slice(0, 8);
  const q = async (sql: string, params?: unknown[]): Promise<any[]> => (await client.query(sql, params)).rows;

  const supplier = (await q(`INSERT INTO suppliers (tenant_id, name) VALUES (app_current_tenant(), $1) RETURNING id`, [`DA supplier ${tag}`]))[0].id;
  const contract = async (label: ContractLabel, company: string, centre: string | null, owner: string | null = null) => (await q(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, cost_center_id, owner_user_id)
     VALUES (app_current_tenant(), $1, $2, $3, '2026-01-01', $4, $5) RETURNING id`,
    [`DA contract ${label} ${tag}`, company, supplier, centre, owner],
  ))[0].id as string;

  const contracts: Record<ContractLabel, string> = {
    CF: await contract('CF', s.fr, s.infFr),
    CE: await contract('CE', s.es, null),
    CL: await contract('CL', s.fr, null),
    CN: await contract('CN', s.fr, null, s.persons.nina),
    CH: await contract('CH', s.fr, null),
    CX: await contract('CX', s.fr, s.infEs),
  };

  const documents = {} as Record<ContractLabel, number>;
  for (const label of CONTRACT_LABELS) {
    const id = contracts[label];
    await q(
      `INSERT INTO contract_contacts (tenant_id, contract_id, contact_id, role, origin)
       VALUES (app_current_tenant(), $1, $2, 'other', 'manual')`, [id, s.contact2],
    );
    await q(
      `INSERT INTO contract_compliance_items (tenant_id, contract_id, requirement)
       VALUES (app_current_tenant(), $1, 'requirement_a')`, [id],
    );
    await q(
      `INSERT INTO contract_tasks (tenant_id, contract_id, description)
       VALUES (app_current_tenant(), $1, 'Legacy contract task')`, [id],
    );
    await q(
      `INSERT INTO contract_attachments (tenant_id, contract_id, original_filename, stored_filename, storage_path)
       VALUES (app_current_tenant(), $1, $2, $2, $3)`, [id, `document-${label}.pdf`, `spec/document-${label}.pdf`],
    );
    await q(
      `INSERT INTO contract_links (tenant_id, contract_id, url) VALUES (app_current_tenant(), $1, $2)`,
      [id, `https://example.invalid/${label.toLowerCase()}`],
    );
    documents[label] = 2;
  }
  // CL: a third closed document; CE keeps two.
  await q(
    `INSERT INTO contract_attachments (tenant_id, contract_id, original_filename, stored_filename, storage_path)
     VALUES (app_current_tenant(), $1, 'document-extra.pdf', 'document-extra.pdf', 'spec/document-extra.pdf')`, [contracts.CL],
  );
  documents.CL = 3;

  // CE through both forms: L1, L5, L6 by contract_spend_items, L7 by spend_items.contract_id.
  for (const line of [s.lines.L1, s.lines.L5, s.lines.L6]) {
    await q(`INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES (app_current_tenant(), $1, $2)`, [contracts.CE, line]);
  }
  await q(`UPDATE spend_items SET contract_id = $2 WHERE id = $1`, [s.lines.L7, contracts.CE]);
  // CL through L1 only; CF through L1, which Paul reads but cannot modify (a link to delete, and
  // L1 stays hidden from Marta and Nina).
  await q(`INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES (app_current_tenant(), $1, $2)`, [contracts.CL, s.lines.L1]);
  await q(`INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES (app_current_tenant(), $1, $2)`, [contracts.CF, s.lines.L1]);

  const application = (await q(`INSERT INTO applications (tenant_id, name) VALUES (app_current_tenant(), $1) RETURNING id`, [`DA contract application ${tag}`]))[0].id;
  const applicationB = (await q(`INSERT INTO applications (tenant_id, name) VALUES (app_current_tenant(), $1) RETURNING id`, [`DA contract application B ${tag}`]))[0].id;
  const asset = (await q(`INSERT INTO assets (tenant_id, name, kind, environment) VALUES (app_current_tenant(), $1, 'server', 'prod') RETURNING id`, [`DA contract asset ${tag}`]))[0].id;
  const assetB = (await q(`INSERT INTO assets (tenant_id, name, kind, environment) VALUES (app_current_tenant(), $1, 'server', 'prod') RETURNING id`, [`DA contract asset B ${tag}`]))[0].id;
  const technology = (await q(`INSERT INTO technologies (tenant_id, name, item_number) VALUES (app_current_tenant(), $1, $2) RETURNING id`, [`DA contract technology ${tag}`, nextItemNumber()]))[0].id;
  const technologyB = (await q(`INSERT INTO technologies (tenant_id, name, item_number) VALUES (app_current_tenant(), $1, $2) RETURNING id`, [`DA contract technology B ${tag}`, nextItemNumber()]))[0].id;
  for (const id of [contracts.CF, contracts.CE, contracts.CH]) {
    await q(`INSERT INTO application_contracts (tenant_id, application_id, contract_id) VALUES (app_current_tenant(), $1, $2)`, [application, id]);
    await q(`INSERT INTO asset_contracts (tenant_id, asset_id, contract_id) VALUES (app_current_tenant(), $1, $2)`, [asset, id]);
    await q(`INSERT INTO technology_contracts (tenant_id, technology_id, contract_id) VALUES (app_current_tenant(), $1, $2)`, [technology, id]);
  }

  const task = async (label: string, contractId: string, assignee: string | null = null) => (await q(
    `INSERT INTO tasks (tenant_id, title, item_number, related_object_type, related_object_id, assignee_user_id)
     VALUES (app_current_tenant(), $1, $2, 'contract', $3, $4) RETURNING id`,
    [`DA contract task ${label} ${tag}`, nextItemNumber(), contractId, assignee],
  ))[0].id as string;
  const tasks = {
    hidden: await task('hidden', contracts.CH),
    hiddenParticipant: await task('hidden participant', contracts.CH, s.persons.paul),
    visible: await task('visible', contracts.CE),
  };

  return {
    ...s, contracts, supplier, application, applicationB, asset, assetB, technology, technologyB, tasks, documents,
  };
}
