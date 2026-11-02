import type { EntityManager } from 'typeorm';
import { isLimitedTransaction } from '../../../data-access/line-write-checks';
import type { AuditParentRule } from '../../audit-parent-rules';
import type { RecordHistoryRecord } from '../../record-history.inventory';
import type { HistoryFields } from '../field-rules';
import { hidden, hiddenChanged, shown } from '../field-rules';

/**
 * The contract (lot 2, linked records): its page, the audit labels of its own row and of its
 * children, their allow-lists and the parent rules of the children a rule can find.
 *
 * The record entry is read by `record-history.inventory.ts`, the fields by `../fields.ts` and the
 * parent rules by `audit-parent-rules.ts`. The contacts, web links, attachments and compliance
 * items name the contract in their payload (`contract_id`), and the supplier sync of the contacts
 * names it in `record_id`; the migration `1855900000000-audit-log-parent-contracts-incidents.ts`
 * backfills their parent, with the contract's tasks (`tasks`, type `contract`, shared rule in
 * `audit-parent-rules.ts`). The links to budget lines, applications, assets and technologies are
 * written from the contract with the contract in `record_id` (`contract-relations.ts`), and read
 * by it.
 *
 * The renewal service writes the contract's own label with a marker beside the saved row
 * (`renewal_decision`, `renewal_stop`, `renewal_resume`, `renewal_task`): the presenter turns each
 * marker into a sentence, so the fields keep them hidden.
 */
export const contractsRecord = {
  table: 'contracts',
  module: 'contracts',
  level: 'reader',
  auditLabels: ['contracts'],
  family: 'contract',
  children: {
    // The payload names the contract (`contract_id`); the supplier sync names it in `record_id`.
    contract_contacts: 'contact',
    contract_links: 'link',
    contract_attachments: 'attachment',
    contract_compliance_items: 'compliance_item',
    // The contract's tasks: the saved task names it (`related_object_type` = 'contract').
    tasks: 'task',
    // `record_id` is the contract: the link sets written from its Budget and Relations tabs.
    contract_spend_items: 'budget_line',
    contract_capex_items: 'budget_line',
    application_contracts: 'application',
    asset_contracts: 'asset',
    technology_contracts: 'technology',
  },
  childReads: {
    contract_spend_items: 'record',
    contract_capex_items: 'record',
    application_contracts: 'record',
    asset_contracts: 'record',
    technology_contracts: 'record',
  },
  explicitParentLabels: [],
  exclusions: [
    {
      table: 'contract_tasks',
      reason: 'duplicate of the `tasks` row the same call writes for the contract task (`createForTarget`)',
    },
  ],
} as const satisfies RecordHistoryRecord;

/** A contract, as its own audit rows record it. */
const CONTRACT_FIELDS: HistoryFields = {
  name: shown(),
  status: shown(),
  company_id: shown('company'),
  supplier_id: shown('supplier'),
  cost_center_id: shown('cost_center'),
  owner_user_id: shown('user'),
  start_date: shown(),
  duration_months: shown(),
  auto_renewal: shown(),
  notice_period_months: shown(),
  yearly_amount_at_signature: shown(),
  currency: shown(),
  billing_frequency: shown(),
  disabled_at: shown(),
  // Long free text: the entry says that the notes changed, never their content.
  notes: hiddenChanged('contract notes: long content', 'notesChanged'),
  // The renewal markers ride beside the saved row; the presenter reads each one as a sentence.
  renewal_decision: hidden('renewal marker, presented as its own sentence'),
  renewal_stop: hidden('renewal marker, presented as its own sentence'),
  renewal_resume: hidden('renewal marker, presented as its own sentence'),
  renewal_task: hidden('renewal marker, presented as its own sentence'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** A web link of a contract. */
const CONTRACT_LINK_FIELDS: HistoryFields = {
  url: shown(),
  description: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  contract_id: hidden('the contract, the record itself'),
  created_at: hidden('timestamp'),
};

/** An attachment of a contract: what it is, never where it is stored. */
const CONTRACT_ATTACHMENT_FIELDS: HistoryFields = {
  original_filename: shown(),
  mime_type: shown(),
  size: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  contract_id: hidden('the contract, the record itself'),
  stored_filename: hidden('storage detail'),
  storage_path: hidden('storage detail'),
  uploaded_at: hidden('timestamp'),
};

/** A compliance item: the presenter names the requirement and reads its state and reference. */
const CONTRACT_COMPLIANCE_ITEM_FIELDS: HistoryFields = {
  requirement: hidden('the requirement, the entry title names it'),
  state: hidden('read as the compliance state by the presenter'),
  reference: hidden('read by the presenter beside the state'),
  updated_by: hidden('write author, already the entry actor'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  contract_id: hidden('the contract, the record itself'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/**
 * The allow-lists of the contract's audit labels: the contract, then the children it owns.
 * `contract_contacts` comes from `records/contacts.ts`, and the link sets (`contract_spend_items`,
 * `application_contracts`...) are presented as references by their kind, from no field list.
 */
export const contractsFields: Readonly<Record<string, HistoryFields>> = {
  contracts: CONTRACT_FIELDS,
  contract_links: CONTRACT_LINK_FIELDS,
  contract_attachments: CONTRACT_ATTACHMENT_FIELDS,
  contract_compliance_items: CONTRACT_COMPLIANCE_ITEM_FIELDS,
};

/**
 * The contract children an audit rule finds: their payload names the contract (`contract_id`), and
 * the supplier sync of the contacts and the assistant's replacement of the web links name it in
 * `record_id` (same shape as `spend_item_contacts`).
 * The contract's tasks use the shared task rule of `audit-parent-rules.ts`.
 *
 * `1855900000000-audit-log-parent-contracts-incidents.ts` copies these rules in SQL on purpose.
 */
export const contractsParentRules: Readonly<Record<string, AuditParentRule>> = {
  contract_contacts: { parentTable: 'contracts', from: 'payload', keys: ['contract_id'], fallback: 'record_id' },
  // The assistant replaces the web links as a whole, with the contract in `record_id`.
  contract_links: { parentTable: 'contracts', from: 'payload', keys: ['contract_id'], fallback: 'record_id' },
  contract_attachments: { parentTable: 'contracts', from: 'payload', keys: ['contract_id'] },
  contract_compliance_items: { parentTable: 'contracts', from: 'payload', keys: ['contract_id'] },
};

/**
 * The contract's documents: its attachments and web links. The page reads them only when the
 * contract is directly readable (policies `CONTRACT_DOCUMENTS` of
 * `1855400000000-data-access-contract-policies.ts`); a contract opened through one of its lines
 * shows neither, only `closed_documents_count` (`contracts.service.ts`).
 */
export const CONTRACT_DOCUMENT_LABELS = ['contract_attachments', 'contract_links'] as const;

/**
 * lisible_contrat_direct (spec §6.4), the predicate of the `CONTRACT_DOCUMENTS` SELECT policies:
 * a copy of `readableContractDirect` (`1855400000000-data-access-contract-policies.ts`, l.209),
 * on the settings of `data_access_apply()`. `$1` tenant, `$2` contract.
 */
const CONTRACT_DIRECTLY_READABLE_SQL = `SELECT EXISTS (
    SELECT 1 FROM contracts c
     WHERE c.tenant_id = $1 AND c.id = $2
       AND (coalesce((SELECT NULLIF(current_setting('app.da_read_all', true), '')::boolean), false)
         OR c.company_id = ANY ((SELECT NULLIF(current_setting('app.da_read_companies', true), '')::uuid[])::uuid[])
         OR c.cost_center_id = ANY ((SELECT NULLIF(current_setting('app.da_read_nodes', true), '')::uuid[])::uuid[])
         OR c.owner_user_id = (SELECT NULLIF(current_setting('app.da_user', true), '')::uuid))
  ) AS direct`;

/**
 * The contract labels the history leaves out for this reader: the documents, when the transaction
 * is limited and the contract is read only through a line, as the page closes them. The labels
 * leave the page query itself, so the cut and the cursor stay exact. Empty otherwise.
 */
export async function contractClosedLabels(manager: EntityManager, tenantId: string, contractId: string): Promise<string[]> {
  if (!(await isLimitedTransaction(manager))) return [];
  const [row]: Array<{ direct: boolean }> = await manager.query(CONTRACT_DIRECTLY_READABLE_SQL, [tenantId, contractId]);
  return row?.direct === true ? [] : [...CONTRACT_DOCUMENT_LABELS];
}
