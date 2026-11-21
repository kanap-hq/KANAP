import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] DataAccessEditByCentre:';
const LIMITED_ROLE = 'kanap_data_limited';

/*
 * Data-scoped access, amendment of 2026-11-21 (planning/data-scoped-access/spec.md §2.3, §4.1,
 * §4.3, §6.4): modifying a line or a contract already placed no longer needs its placement. An
 * edit node that covers it is enough, through its company or through its cost center (for a
 * contract, its place in the tree), whatever the paying company:
 *
 *   modifiable_ligne(i)   := edit_all OR i.paying_company_id IN edit_companies
 *                            OR i.cost_center_id IN edit_nodes OR i.owner_it_id = user
 *                            OR i.owner_business_id = user
 *   modifiable_contrat(c) := edit_all OR c.company_id IN edit_companies
 *                            OR c.cost_center_id IN edit_nodes OR c.owner_user_id = user
 *
 * Placing stays as it was: the INSERT policies, the placement triggers of the lines and contracts,
 * `data_access_placable_line` and `data_access_placable_contract` are untouched, so creating a line
 * or a contract, or changing its company or its place, still needs the new values placable.
 *
 * The TS builders below are a copy of those of migration 1855400000000 (a migration never imports
 * another one, and exports nothing but its class). Only `modifiableLine` and `modifiableContract`
 * change; every row and function built from them follows. Both forms are kept, by `Rule`: `centre`
 * is the rule of this migration, `placement` the rule of 1855400000000 that down() restores.
 */

/*
 * The settings of data_access_apply() (spec §6.3), each read once per statement through an
 * uncorrelated scalar subquery (an InitPlan); the forms are the measured ones of 1854500000000.
 */
const setting = (name: string) => `NULLIF(current_setting('app.da_${name}', true), '')`;
/** The guard of every policy, true in mode limited, never NULL (estimated at 99.5 %, see 1855400000000). */
const MODE_LIMITED = `(SELECT 1 WHERE current_setting('app.da_mode', true) = 'limited') IS NOT NULL`;
/** The limited role taken without data_access_apply() (mode not limited): the access functions refuse. */
const ROLE_TAKEN = `coalesce(current_setting('role', true), '') = '${LIMITED_ROLE}'`;
const USER = `(SELECT ${setting('user')}::uuid)`;
const READ_ALL = `coalesce((SELECT ${setting('read_all')}::boolean), false)`;
const EDIT_ALL = `coalesce((SELECT ${setting('edit_all')}::boolean), false)`;
const uuidList = (name: string) => `(SELECT ${setting(name)}::uuid[])::uuid[]`;
const READ_COMPANIES = uuidList('read_companies');
const EDIT_COMPANIES = uuidList('edit_companies');
const READ_NODES = uuidList('read_nodes');
const EDIT_NODES = uuidList('edit_nodes');

/** The tenant of the transaction, on a table read by a SECURITY DEFINER function (`p`: its alias with the dot). */
const IN_TENANT = (p: string) => `${p}tenant_id = app_current_tenant()`;

/** `centre`: the rule of this migration. `placement`: the rule of 1855400000000, restored by down(). */
type Rule = 'centre' | 'placement';

/** lisible_ligne (spec §6.4) on the line `p` (a column prefix: `spend_items.` or `i.`). */
const readableLine = (p: string) => `(${READ_ALL}
      OR ${p}paying_company_id = ANY (${READ_COMPANIES})
      OR ${p}cost_center_id = ANY (${READ_NODES})
      OR ${p}owner_it_id = ${USER}
      OR ${p}owner_business_id = ${USER})`;

/**
 * placable_ligne (spec §6.4), unchanged. data_access_placable_line() is its single definition; the
 * policies test the cheap necessary conditions first and call it only for a centre in the edit nodes.
 */
const placableLine = (company: string, centre: string) => `(${EDIT_ALL}
      OR ${company} = ANY (${EDIT_COMPANIES})
      OR (${centre} = ANY (${EDIT_NODES}) AND data_access_placable_line(${company}, ${centre})))`;

/**
 * modifiable_ligne (spec §6.4). `centre`: an edit node covers the line by its company or by its
 * cost center, or the person is responsible; no table read, no function call per row. `placement`:
 * the text of 1855400000000, where the cost center counted only with the centre's own company.
 */
const modifiableLine = (p: string, rule: Rule) => (rule === 'centre'
  ? `(${EDIT_ALL}
      OR ${p}paying_company_id = ANY (${EDIT_COMPANIES})
      OR ${p}cost_center_id = ANY (${EDIT_NODES})
      OR ${p}owner_it_id = ${USER}
      OR ${p}owner_business_id = ${USER})`
  : `(${EDIT_ALL}
      OR ${p}paying_company_id = ANY (${EDIT_COMPANIES})
      OR ${p}owner_it_id = ${USER}
      OR ${p}owner_business_id = ${USER}
      OR (${p}cost_center_id = ANY (${EDIT_NODES})
          AND data_access_placable_line(${p}paying_company_id, ${p}cost_center_id)))`);

/**
 * How a table that follows a line reaches its line id. A child names it in a column; a grandchild
 * names its version (or its round input), and a SECURITY DEFINER helper returns the line of that
 * version without reading `spend_versions` under its policy (spec §6.4, "profondeur").
 */
type LineReach =
  | { kind: 'column'; column: string }
  | { kind: 'version'; column: string }
  | { kind: 'round_input'; column: string };

function lineRef(table: string, reach: LineReach): string {
  const col = `${table}.${reach.column}`;
  if (reach.kind === 'column') return col;
  if (reach.kind === 'version') return `data_access_line_of_version(${col})`;
  return `data_access_line_of_round_input(${col})`;
}

/** Parent line readable: the subquery reads spend_items under its own SELECT policy. */
const parentLineReadable = (ref: string) => `(${READ_ALL}
      OR EXISTS (SELECT 1 FROM public.spend_items i WHERE i.id = ${ref}))`;

/** Parent line modifiable: readable by its SELECT policy, and modifiable_ligne. */
const parentLineModifiable = (ref: string, rule: Rule) => `(${EDIT_ALL}
      OR EXISTS (SELECT 1 FROM public.spend_items i WHERE i.id = ${ref} AND ${modifiableLine('i.', rule)}))`;

type Command = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
type PolicyRow = { table: string; command: Command; using: string | null; check: string | null };

/** Every policy starts with the refusal of the role taken without context (spec §6.4). */
const guarded = (expr: string) => `${MODE_LIMITED} AND ${expr}`;

/** The tables that follow a line (data-access-tables.inventory.ts, class follows_line). */
const FOLLOWS_LINE: Array<{ table: string; reach: LineReach }> = [
  { table: 'spend_versions', reach: { kind: 'column', column: 'spend_item_id' } },
  { table: 'spend_item_analytics_values', reach: { kind: 'column', column: 'item_id' } },
  { table: 'spend_item_contacts', reach: { kind: 'column', column: 'spend_item_id' } },
  { table: 'spend_links', reach: { kind: 'column', column: 'spend_item_id' } },
  { table: 'spend_attachments', reach: { kind: 'column', column: 'spend_item_id' } },
  { table: 'spend_tasks', reach: { kind: 'column', column: 'item_id' } },
  { table: 'spend_amounts', reach: { kind: 'version', column: 'version_id' } },
  { table: 'spend_allocations', reach: { kind: 'version', column: 'version_id' } },
  { table: 'spend_round_inputs', reach: { kind: 'version', column: 'version_id' } },
  { table: 'spend_version_totals', reach: { kind: 'version', column: 'version_id' } },
  { table: 'spend_round_input_lines', reach: { kind: 'round_input', column: 'round_input_id' } },
];

function linePolicies(rule: Rule): PolicyRow[] {
  const t = 'spend_items';
  return [
    { table: t, command: 'SELECT', using: guarded(readableLine(`${t}.`)), check: null },
    {
      table: t,
      command: 'INSERT',
      using: null,
      check: guarded(placableLine(`${t}.paying_company_id`, `${t}.cost_center_id`)),
    },
    {
      table: t,
      command: 'UPDATE',
      using: guarded(modifiableLine(`${t}.`, rule)),
      check: guarded(modifiableLine(`${t}.`, rule)),
    },
    // Deleting a line is reserved to unscoped persons (spec §2.7, §4.1).
    { table: t, command: 'DELETE', using: 'false', check: null },
  ];
}

function followsLinePolicies(rule: Rule): PolicyRow[] {
  const rows: PolicyRow[] = [];
  for (const { table, reach } of FOLLOWS_LINE) {
    const ref = lineRef(table, reach);
    const readable = guarded(parentLineReadable(ref));
    const modifiable = guarded(parentLineModifiable(ref, rule));
    rows.push(
      { table, command: 'SELECT', using: readable, check: null },
      { table, command: 'INSERT', using: null, check: modifiable },
      { table, command: 'UPDATE', using: modifiable, check: modifiable },
      { table, command: 'DELETE', using: modifiable, check: null },
    );
  }
  return rows;
}

/** Links from other objects to a line (class link_to_line): the line readable for every command. */
const LINKS_TO_LINE: Array<{ table: string; column: string }> = [
  { table: 'application_spend_items', column: 'spend_item_id' },
  { table: 'asset_spend_items', column: 'spend_item_id' },
  { table: 'technology_spend_items', column: 'spend_item_id' },
  { table: 'portfolio_project_opex', column: 'opex_id' },
  { table: 'portfolio_request_opex', column: 'opex_id' },
];

/** The same predicate for the four commands. */
function samePredicatePolicies(table: string, predicate: string): PolicyRow[] {
  return [
    { table, command: 'SELECT', using: predicate, check: null },
    { table, command: 'INSERT', using: null, check: predicate },
    { table, command: 'UPDATE', using: predicate, check: predicate },
    { table, command: 'DELETE', using: predicate, check: null },
  ];
}

function linkToLinePolicies(): PolicyRow[] {
  return LINKS_TO_LINE.flatMap(({ table, column }) =>
    samePredicatePolicies(table, guarded(parentLineReadable(`${table}.${column}`))));
}

/*
 * Tasks (spec §4.4, §6.4). `filtered`: inline in the policies of `tasks`, spend_items read under its
 * own SELECT policy. `definer`: in the SECURITY DEFINER depth functions, which read without
 * policies and so apply lisible_ligne themselves.
 */
type Reach = 'filtered' | 'definer';
/** `id`: the per-id depth function; `set`: membership of the set of visible contracts. */
type ContractForm = 'id' | 'set';

const LINE_TASK_TYPES = `('spend_item', 'capex_item')`;
const SCOPED_TASK_TYPES = `('spend_item', 'capex_item', 'contract')`;
/** The person as text, for the jsonb arrays of user ids (`owner_ids ? ...`). */
const USER_TEXT = `(SELECT ${setting('user')})`;

/** lisible_contrat_direct (spec §6.4) on the contract `p`. */
const readableContractDirect = (p: string) => `(${READ_ALL}
      OR ${p}company_id = ANY (${READ_COMPANIES})
      OR ${p}cost_center_id = ANY (${READ_NODES})
      OR ${p}owner_user_id = ${USER})`;

/**
 * modifiable_contrat (spec §6.4). `centre`: an edit node covers the contract by its company or by
 * its place in the tree, or the person owns it; no table read, no function call per row.
 * `placement`: the text of 1855400000000, where the place counted only with a company of the edit
 * nodes (data_access_placable_contract).
 */
const modifiableContract = (p: string, rule: Rule) => (rule === 'centre'
  ? `(${EDIT_ALL}
      OR ${p}company_id = ANY (${EDIT_COMPANIES})
      OR ${p}cost_center_id = ANY (${EDIT_NODES})
      OR ${p}owner_user_id = ${USER})`
  : `(${EDIT_ALL}
      OR ${p}company_id = ANY (${EDIT_COMPANIES})
      OR ${p}owner_user_id = ${USER}
      OR (${p}cost_center_id = ANY (${EDIT_NODES})
          AND data_access_placable_contract(${p}company_id, ${p}cost_center_id)))`);

/** placable_contrat (spec §6.4, §2.3), unchanged: an owner may modify a contract but never move it. */
const placableContract = (company: string, place: string) => `(${EDIT_ALL}
      OR ${company} = ANY (${EDIT_COMPANIES})
      OR (${place} = ANY (${EDIT_NODES}) AND data_access_placable_contract(${company}, ${place})))`;

/**
 * lisible_contrat (spec §6.4) on the contract `p`: direct, or through a readable line that names it.
 * In the filtered form the line is filtered by the SELECT policy of `spend_items`; in the definer
 * form the predicate applies lisible_ligne itself.
 */
const readableContract = (p: string, reach: Reach) => `(${readableContractDirect(p)}
      OR EXISTS (SELECT 1 FROM public.contract_spend_items l JOIN public.spend_items i ON i.id = l.spend_item_id
                 WHERE l.contract_id = ${p}id${reach === 'definer' ? ` AND ${IN_TENANT('l.')} AND ${IN_TENANT('i.')} AND ${readableLine('i.')}` : ''})
      OR EXISTS (SELECT 1 FROM public.spend_items i
                 WHERE i.contract_id = ${p}id${reach === 'definer' ? ` AND ${IN_TENANT('i.')} AND ${readableLine('i.')}` : ''}))`;

/** A line, named by `ref`, readable. */
const lineReadableById = (ref: string, reach: Reach) => reach === 'filtered'
  ? `EXISTS (SELECT 1 FROM public.spend_items i WHERE i.id = ${ref})`
  : `EXISTS (SELECT 1 FROM public.spend_items i WHERE i.id = ${ref} AND ${IN_TENANT('i.')} AND ${readableLine('i.')})`;

/** A line, named by `ref`, modifiable (and so readable). */
const lineModifiableById = (ref: string, reach: Reach, rule: Rule) => reach === 'filtered'
  ? `EXISTS (SELECT 1 FROM public.spend_items i WHERE i.id = ${ref} AND ${modifiableLine('i.', rule)})`
  : `EXISTS (SELECT 1 FROM public.spend_items i WHERE i.id = ${ref} AND ${IN_TENANT('i.')} AND ${readableLine('i.')} AND ${modifiableLine('i.', rule)})`;

/** A contract, named by `ref`, modifiable: through the depth function, which follows the rule by itself. */
const contractModifiableById = (ref: string) => `data_access_contract_modifiable(${ref})`;

/** Participant of the task `p` (spec §4.4): assignee, owner or observer. The creator is not one. */
const taskParticipant = (p: string) => `(${p}assignee_user_id = ${USER}
      OR ${p}owner_ids ? ${USER_TEXT}
      OR ${p}viewer_ids ? ${USER_TEXT})`;

/** Responsible for the task `p` (spec §4.4): assignee or owner. */
const taskResponsible = (p: string) => `(${p}assignee_user_id = ${USER}
      OR ${p}owner_ids ? ${USER_TEXT})`;

/** A task whose object is neither a line nor a contract: not scoped. */
const taskNotScoped = (p: string) =>
  `(${p}related_object_type IS NULL OR ${p}related_object_type NOT IN ${SCOPED_TASK_TYPES})`;

/** A contract, named by `ref`, visible: through a depth function, never by reading `contracts`. */
const contractVisible = (ref: string, form: ContractForm) => form === 'set'
  ? `${ref} IN (SELECT data_access_visible_contract_ids())`
  : `data_access_contract_visible(${ref})`;

/** Task visible: object readable, or participant. Without `participants`, the object alone. */
const taskReadable = (p: string, reach: Reach, form: ContractForm = 'id', participants = true) => `(${READ_ALL}
      OR ${taskNotScoped(p)}${participants ? `
      OR ${taskParticipant(p)}` : ''}
      OR (${p}related_object_type IN ${LINE_TASK_TYPES} AND ${lineReadableById(`${p}related_object_id`, reach)})
      OR (${p}related_object_type = 'contract' AND ${contractVisible(`${p}related_object_id`, form)}))`;

/** The task's object modifiable (creation and deletion of a task). */
const taskObjectModifiable = (p: string, reach: Reach, rule: Rule) => `(${EDIT_ALL}
      OR ${taskNotScoped(p)}
      OR (${p}related_object_type IN ${LINE_TASK_TYPES} AND ${lineModifiableById(`${p}related_object_id`, reach, rule)})
      OR (${p}related_object_type = 'contract' AND ${contractModifiableById(`${p}related_object_id`)}))`;

/** Task modifiable: object modifiable, or responsible (assignee or owner). */
const taskModifiable = (p: string, reach: Reach, rule: Rule) =>
  `(${taskObjectModifiable(p, reach, rule)} OR ${taskResponsible(p)})`;

function taskPolicies(rule: Rule): PolicyRow[] {
  const t = 'tasks';
  const p = `${t}.`;
  return [
    { table: t, command: 'SELECT', using: guarded(taskReadable(p, 'filtered')), check: null },
    { table: t, command: 'INSERT', using: null, check: guarded(taskObjectModifiable(p, 'filtered', rule)) },
    // WITH CHECK: the old row passed USING, and a new object that is a line or a contract is
    // checked by the placement trigger of the tasks (spec §4.4).
    { table: t, command: 'UPDATE', using: guarded(taskModifiable(p, 'filtered', rule)), check: guarded('true') },
    // Today's deletion rule stays in the service (route permission); the database adds the object.
    { table: t, command: 'DELETE', using: guarded(taskObjectModifiable(p, 'filtered', rule)), check: null },
  ];
}

/** Elements of a task (class task_element): through the depth functions, which follow the rule by themselves. */
const TASK_ELEMENTS = ['task_attachments', 'task_time_entries', 'task_applications', 'task_assets'];

/** Links from other objects to a task (class link_to_task). */
const LINKS_TO_TASK = ['document_tasks'];

function taskElementPolicies(): PolicyRow[] {
  const rows: PolicyRow[] = [];
  for (const table of TASK_ELEMENTS) {
    const visible = guarded(`(${READ_ALL} OR data_access_task_visible(${table}.task_id))`);
    const modifiable = guarded(`(${EDIT_ALL} OR data_access_task_modifiable(${table}.task_id))`);
    rows.push(
      { table, command: 'SELECT', using: visible, check: null },
      { table, command: 'INSERT', using: null, check: modifiable },
      { table, command: 'UPDATE', using: modifiable, check: modifiable },
      { table, command: 'DELETE', using: modifiable, check: null },
    );
  }
  for (const table of LINKS_TO_TASK) {
    rows.push(...samePredicatePolicies(table, guarded(`(${READ_ALL} OR data_access_task_visible(${table}.task_id))`)));
  }
  return rows;
}

/** The search index (spec §6.4): unchanged, it reads only. */
const SEARCH_LINE_TYPES = `('spend_items', 'capex_items')`;
const SEARCH_SCOPED_TYPES = `('spend_items', 'capex_items', 'contracts', 'tasks')`;

function searchIndexPolicies(): PolicyRow[] {
  const s = 'search_index.';
  const predicate = guarded(`(${READ_ALL}
      OR ${s}entity_type NOT IN ${SEARCH_SCOPED_TYPES}
      OR (${s}entity_type IN ${SEARCH_LINE_TYPES} AND ${lineReadableById(`${s}entity_id`, 'filtered')})
      OR (${s}entity_type = 'contracts' AND ${contractVisible(`${s}entity_id`, 'set')})
      OR (${s}entity_type = 'tasks' AND ${s}entity_id IN (SELECT data_access_searchable_task_ids())))`);
  return samePredicatePolicies('search_index', predicate);
}

/** Contracts (spec §4.3, §5.4, §6.4). */
function contractPolicies(rule: Rule): PolicyRow[] {
  const t = 'contracts';
  return [
    { table: t, command: 'SELECT', using: guarded(readableContract(`${t}.`, 'filtered')), check: null },
    {
      table: t,
      command: 'INSERT',
      using: null,
      check: guarded(placableContract(`${t}.company_id`, `${t}.cost_center_id`)),
    },
    {
      table: t,
      command: 'UPDATE',
      using: guarded(modifiableContract(`${t}.`, rule)),
      check: guarded(modifiableContract(`${t}.`, rule)),
    },
    // Deleting a contract is reserved to unscoped persons (spec §2.7, §4.3).
    { table: t, command: 'DELETE', using: guarded('false'), check: null },
  ];
}

/** Contacts, compliance items and legacy tasks: the parent contract readable to read, modifiable to write. */
const FOLLOWS_CONTRACT = ['contract_contacts', 'contract_compliance_items', 'contract_tasks'];

function followsContractPolicies(rule: Rule): PolicyRow[] {
  const rows: PolicyRow[] = [];
  for (const table of FOLLOWS_CONTRACT) {
    const ref = `${table}.contract_id`;
    const readable = guarded(`(${READ_ALL}
      OR EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = ${ref}))`);
    const modifiable = guarded(`(${EDIT_ALL}
      OR EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = ${ref} AND ${modifiableContract('c.', rule)}))`);
    rows.push(
      { table, command: 'SELECT', using: readable, check: null },
      { table, command: 'INSERT', using: null, check: modifiable },
      { table, command: 'UPDATE', using: modifiable, check: modifiable },
      { table, command: 'DELETE', using: modifiable, check: null },
    );
  }
  return rows;
}

/** Attachments and document links: read when the contract is directly readable, written when it is modifiable. */
const CONTRACT_DOCUMENTS = ['contract_attachments', 'contract_links'];

function contractDocumentPolicies(rule: Rule): PolicyRow[] {
  const rows: PolicyRow[] = [];
  for (const table of CONTRACT_DOCUMENTS) {
    const ref = `${table}.contract_id`;
    const readable = guarded(`(${READ_ALL}
      OR EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = ${ref} AND ${readableContractDirect('c.')}))`);
    const modifiable = guarded(`(${EDIT_ALL}
      OR EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = ${ref} AND ${modifiableContract('c.', rule)}))`);
    rows.push(
      { table, command: 'SELECT', using: readable, check: null },
      { table, command: 'INSERT', using: null, check: modifiable },
      { table, command: 'UPDATE', using: modifiable, check: modifiable },
      { table, command: 'DELETE', using: modifiable, check: null },
    );
  }
  return rows;
}

/** Links from other objects to a contract (spec §5.4, §6.4): the contract readable for every command. */
const LINKS_TO_CONTRACT = ['application_contracts', 'asset_contracts', 'technology_contracts'];

function linkToContractPolicies(): PolicyRow[] {
  return LINKS_TO_CONTRACT.flatMap((table) => samePredicatePolicies(table, guarded(`(${READ_ALL}
      OR EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = ${table}.contract_id))`)));
}

/** The whole expected set, in the order of 1855400000000. Not exported: TypeORM instantiates every export. */
function dataAccessPolicyRows(rule: Rule): PolicyRow[] {
  return [
    ...linePolicies(rule),
    ...followsLinePolicies(rule),
    ...linkToLinePolicies(),
    ...taskPolicies(rule),
    ...taskElementPolicies(),
    ...searchIndexPolicies(),
    ...contractPolicies(rule),
    ...followsContractPolicies(rule),
    ...contractDocumentPolicies(rule),
    ...linkToContractPolicies(),
  ];
}

function dataAccessPolicyName(row: Pick<PolicyRow, 'table' | 'command'>): string {
  return `${row.table}_data_access_${row.command.toLowerCase()}`;
}

/** A dollar-quoted SQL literal whose tag cannot occur in the text. */
function literal(text: string | null): string {
  if (text === null) return 'NULL::text';
  if (text.includes('$p$')) throw new Error('policy text contains the quote tag $p$');
  return `$p$${text}$p$`;
}

/** The helpers the sync grants EXECUTE on to the limited role, as in 1855400000000. */
const LINE_HELPER_SIGNATURES = ['data_access_line_of_version(uuid)', 'data_access_line_of_round_input(uuid)'];
const CONTRACT_HELPER_SIGNATURES = ['data_access_line_visible(uuid)'];
const ACCESS_DEFINER_SIGNATURES = [
  'data_access_contract_visible(uuid)',
  'data_access_contract_modifiable(uuid)',
  'data_access_task_visible(uuid)',
  'data_access_task_modifiable(uuid)',
  'data_access_visible_contract_ids()',
  'data_access_searchable_task_ids()',
  'data_access_hidden_count(text, uuid)',
  'data_access_reference(text, uuid)',
];

/*
 * Redefined here (each with its previous definition):
 * - data_access_expected_policies(), data_access_sync_policies() (1855400000000);
 * - data_access_line_editable(uuid, uuid, uuid, uuid) (1854600000000), SECURITY INVOKER;
 * - data_access_contract_modifiable(uuid), data_access_task_modifiable(uuid) (1854500000000),
 *   SECURITY DEFINER, search_path pinned;
 * - data_access_tasks_placement() (1854500000000), the trigger function that refuses to attach a
 *   task to a line or a contract the person cannot modify, SECURITY INVOKER: its rule (the new
 *   object modifiable) is unchanged, it embeds modifiable_ligne.
 * The functions that only call data_access_line_editable, data_access_contract_modifiable or
 * data_access_task_modifiable (the link triggers of a contract, the policies of the task elements)
 * follow by themselves. `CREATE OR REPLACE` keeps the owner and the grants of each function.
 *
 * Idempotent: the functions are replaced with the same text on a second run, and the sync
 * recreates only the policies whose source fingerprint or body changed (none on a second run).
 * Without the limited role the functions are redefined and the sync does nothing. down() restores
 * the previous bodies and syncs.
 */
export class DataAccessEditByCentre1856250000000 implements MigrationInterface {
  name = 'DataAccessEditByCentre1856250000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await applyRule(queryRunner, 'centre');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await applyRule(queryRunner, 'placement');
  }
}

async function applyRule(queryRunner: QueryRunner, rule: Rule): Promise<void> {
  await createLineEditable(queryRunner, rule);
  await createModifiableFunctions(queryRunner, rule);
  await createPolicyFunctions(queryRunner, rule);

  await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
  const before: Array<{ oid: string }> = await queryRunner.query(
    `SELECT p.oid::text AS oid FROM pg_policy p WHERE to_regrole($1) = ANY (p.polroles)`,
    [LIMITED_ROLE],
  );
  await queryRunner.query(`SELECT data_access_sync_policies()`);
  const [after] = await queryRunner.query(
    `SELECT to_regrole($1) IS NOT NULL AS present,
            count(p.oid)::int AS policies,
            (count(p.oid) FILTER (WHERE NOT (p.oid::text = ANY ($2::text[]))))::int AS recreated
       FROM (SELECT 1) one
       LEFT JOIN pg_policy p ON to_regrole($1) = ANY (p.polroles)`,
    [LIMITED_ROLE, before.map((row) => row.oid)],
  );
  await queryRunner.query(`SET LOCAL lock_timeout = DEFAULT`);

  const outcome = !after?.present
    ? 'absent, no policy created'
    : `present, ${after.policies} policies in place, ${after.recreated} recreated`;
  console.log(`${LOG_PREFIX} rule ${rule}; ${dataAccessPolicyRows(rule).length} expected policies; limited role ${outcome}`);
}

/**
 * modifiable_ligne on the values of a line, for the application's write checks and the "editable"
 * column (1854600000000). Outside the limited mode: true, unless the limited role was taken without
 * context. SECURITY INVOKER, no SET clause, no table read and no subquery: PostgreSQL may inline it
 * into a list query, and it reads the settings of the transaction. `centre` no longer needs
 * data_access_placable_line; `placement` is the body of 1854600000000.
 */
async function createLineEditable(queryRunner: QueryRunner, rule: Rule): Promise<void> {
  const limitedBranch = rule === 'centre'
    ? `coalesce(
            coalesce(NULLIF(current_setting('app.da_edit_all', true), '')::boolean, false)
            OR p_company = ANY (NULLIF(current_setting('app.da_edit_companies', true), '')::uuid[])
            OR p_cost_center = ANY (NULLIF(current_setting('app.da_edit_nodes', true), '')::uuid[])
            OR p_owner_it = NULLIF(current_setting('app.da_user', true), '')::uuid
            OR p_owner_business = NULLIF(current_setting('app.da_user', true), '')::uuid,
            false)`
    : `coalesce(
            p_owner_it = NULLIF(current_setting('app.da_user', true), '')::uuid
            OR p_owner_business = NULLIF(current_setting('app.da_user', true), '')::uuid
            OR public.data_access_placable_line(p_company, p_cost_center),
            false)`;
  await queryRunner.query(`
      CREATE OR REPLACE FUNCTION data_access_line_editable(
        p_company uuid, p_cost_center uuid, p_owner_it uuid, p_owner_business uuid)
      RETURNS boolean
      LANGUAGE sql
      STABLE
      AS $fn$
        SELECT CASE
          WHEN NULLIF(current_setting('app.da_mode', true), '') IS DISTINCT FROM 'limited'
            THEN coalesce(current_setting('role', true), '') <> '${LIMITED_ROLE}'
          ELSE ${limitedBranch}
        END
      $fn$
    `);
}

/**
 * The SECURITY DEFINER depth functions that embed modifiable_ligne or modifiable_contrat, and the
 * task placement trigger function, with the bodies of 1854500000000 built from the rule.
 */
async function createModifiableFunctions(queryRunner: QueryRunner, rule: Rule): Promise<void> {
  const definer = `STABLE
    SECURITY DEFINER
    SET search_path = public, pg_temp`;

  // modifiable_contrat; a modifiable contract is readable by lisible_contrat_direct, so the
  // function needs no other test.
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_contract_modifiable(p_contract uuid)
    RETURNS boolean
    LANGUAGE sql
    ${definer}
    AS $fn$
      SELECT CASE WHEN NOT (${MODE_LIMITED}) THEN NOT (${ROLE_TAKEN}) ELSE coalesce((
        SELECT ${modifiableContract('c.', rule)}
        FROM public.contracts c WHERE c.id = p_contract AND ${IN_TENANT('c.')}), false) END
    $fn$
  `);

  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_task_modifiable(p_task uuid)
    RETURNS boolean
    LANGUAGE sql
    ${definer}
    AS $fn$
      SELECT CASE WHEN NOT (${MODE_LIMITED}) THEN NOT (${ROLE_TAKEN}) ELSE coalesce((
        SELECT ${taskModifiable('t.', 'definer', rule)}
        FROM public.tasks t WHERE t.id = p_task AND ${IN_TENANT('t.')}), false) END
    $fn$
  `);

  // The task's new object must be modifiable by the person (spec §2.5, §4.4): modifiable_ligne for
  // a line (read under its SELECT policy), modifiable_contrat for a contract (the depth function).
  // The trigger itself (tasks_data_access_placement) stays bound to the function.
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_tasks_placement()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = public, pg_temp
    AS $fn$
    BEGIN
      IF NULLIF(current_setting('app.da_mode', true), '') IS DISTINCT FROM 'limited' THEN
        RETURN NEW;
      END IF;
      IF NEW.related_object_type IS NOT DISTINCT FROM OLD.related_object_type
         AND NEW.related_object_id IS NOT DISTINCT FROM OLD.related_object_id THEN
        RETURN NEW;
      END IF;
      IF NEW.related_object_type IN ${LINE_TASK_TYPES}
         AND NOT ${lineModifiableById('NEW.related_object_id', 'filtered', rule)} THEN
        RAISE EXCEPTION 'permission denied: this line is outside your data access'
          USING ERRCODE = '42501';
      END IF;
      IF NEW.related_object_type = 'contract'
         AND NOT coalesce(${contractModifiableById('NEW.related_object_id')}, false) THEN
        RAISE EXCEPTION 'permission denied: this contract is outside your data access'
          USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$
  `);
}

/**
 * data_access_expected_policies() and data_access_sync_policies(), with the complete list of rows of
 * the rule. The bodies are those of 1855400000000; the return type is unchanged, so CREATE OR
 * REPLACE keeps both functions and their grants.
 */
async function createPolicyFunctions(queryRunner: QueryRunner, rule: Rule): Promise<void> {
  const rows = dataAccessPolicyRows(rule);
  const expectedValues = rows
    .map((r) => `('${dataAccessPolicyName(r)}', '${r.table}', '${r.command}', ${literal(r.using)}, ${literal(r.check)})`)
    .join(',\n        ');
  const definitionValues = rows
    .map((r) => `('${r.table}', '${r.command}', ${literal(r.using)}, ${literal(r.check)})`)
    .join(',\n          ');

  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_expected_policies()
    RETURNS TABLE (policy_name text, table_name text, command text, fingerprint text)
    LANGUAGE sql
    STABLE
    SET search_path = public, pg_temp
    AS $fn$
      SELECT v.policy_name, v.table_name, v.command,
             md5(v.command || '|' || coalesce(v.using_expr, '') || '|' || coalesce(v.check_expr, '')) AS fingerprint
      FROM (VALUES
        ${expectedValues}
      ) AS v(policy_name, table_name, command, using_expr, check_expr)
    $fn$
  `);

  // Grants as in lot 1, the stray policies dropped, then each missing or different expected policy
  // recreated (source fingerprint and deparsed md5 in `COMMENT ON POLICY`, review notes M4 and M5).
  // The others keep their oid. Policy DDL takes an exclusive lock on its table: callers set
  // lock_timeout, the function does not.
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_sync_policies()
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $fn$
    DECLARE
      v_role oid := to_regrole('${LIMITED_ROLE}');
      r record;
      v_name text;
      v_cmd text;
      v_expected int;
      v_defined int := 0;
      v_created int := 0;
      v_inherits boolean;
      v_dropped int := 0;
      v_fingerprint text;
      v_definition_fingerprint text;
      v_comment text;
      v_deparsed text;
      v_permissive boolean;
      v_role_ok boolean;
      v_polcmd text;
    BEGIN
      IF v_role IS NULL THEN
        RETURN;
      END IF;
      -- The session role inherits the limited role (a misconfigured membership, spec §10.6): every
      -- policy on the limited role would then apply to the session role itself, without context,
      -- and refuse everything to everyone (migrations included). The policies go and none is
      -- created; data_access_apply() refuses a limited person (KDA01), unscoped persons are served.
      v_inherits := current_user <> '${LIMITED_ROLE}' AND pg_has_role(current_user, v_role, 'USAGE');

      IF NOT has_schema_privilege(v_role, 'public', 'USAGE') THEN
        GRANT USAGE ON SCHEMA public TO ${LIMITED_ROLE};
      END IF;
      FOR r IN SELECT t.relname, t.is_sequence FROM data_access_grant_targets() t LOOP
        IF r.is_sequence THEN
          EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO ${LIMITED_ROLE}', r.relname);
        ELSE
          EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO ${LIMITED_ROLE}', r.relname);
        END IF;
      END LOOP;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${LIMITED_ROLE};
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO ${LIMITED_ROLE};
      -- The SECURITY DEFINER access functions the policies and the triggers call (EXECUTE revoked
      -- from PUBLIC).
${[...LINE_HELPER_SIGNATURES, ...ACCESS_DEFINER_SIGNATURES, ...CONTRACT_HELPER_SIGNATURES].map((sig) => `      GRANT EXECUTE ON FUNCTION ${sig} TO ${LIMITED_ROLE};`).join('\n')}

      -- Every policy that targets the role and is not expected goes; every one under inheritance.
      FOR r IN
        SELECT p.polname, c.relname
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND v_role = ANY (p.polroles)
          AND (v_inherits OR NOT EXISTS (
            SELECT 1 FROM data_access_expected_policies() e
            WHERE e.policy_name = p.polname AND e.table_name = c.relname
          ))
      LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', r.polname, r.relname);
        v_dropped := v_dropped + 1;
      END LOOP;
      IF v_inherits THEN
        RAISE WARNING 'data access: role % inherits ${LIMITED_ROLE}; % data-access policies dropped, none created (limited persons are refused until the membership is fixed)',
          current_user, v_dropped;
        RETURN;
      END IF;

      -- The definitions and data_access_expected_policies() are written from one list: a pair
      -- that drifted apart is refused (the whole sync rolls back) rather than leave a limited
      -- person refused or uncovered.
      SELECT count(*) INTO v_expected FROM data_access_expected_policies();
      FOR r IN
        SELECT d.table_name, d.command, d.using_expr, d.check_expr
        FROM (VALUES
          ${definitionValues}
        ) AS d(table_name, command, using_expr, check_expr)
      LOOP
        v_name := r.table_name || '_data_access_' || lower(r.command);
        -- The source fingerprint comes from data_access_expected_policies(), the single source
        -- read by the availability check; it must be the md5 of the definition this loop creates.
        SELECT e.fingerprint INTO v_fingerprint
        FROM data_access_expected_policies() e
        WHERE e.policy_name = v_name AND e.table_name = r.table_name AND e.command = r.command;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'data access: policy % is defined but not expected', v_name;
        END IF;
        v_definition_fingerprint := md5(r.command || '|' || coalesce(r.using_expr, '') || '|' || coalesce(r.check_expr, ''));
        IF v_fingerprint IS DISTINCT FROM v_definition_fingerprint THEN
          RAISE EXCEPTION 'data access: fingerprint of policy % differs between the expected list and its definition', v_name;
        END IF;
        v_defined := v_defined + 1;
        v_cmd := CASE upper(r.command)
          WHEN 'SELECT' THEN 'r' WHEN 'INSERT' THEN 'a' WHEN 'UPDATE' THEN 'w'
          WHEN 'DELETE' THEN 'd' WHEN 'ALL' THEN '*' END;
        SELECT p.polpermissive, v_role = ANY (p.polroles), p.polcmd::text,
               obj_description(p.oid, 'pg_policy'),
               data_access_policy_deparsed_md5(p.oid)
        INTO v_permissive, v_role_ok, v_polcmd, v_comment, v_deparsed
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = r.table_name AND p.polname = v_name;
        IF FOUND THEN
          -- Unchanged: restrictive, on the role, on its command, and the comment still holds the
          -- expected source fingerprint and the md5 of the deparsed expressions read now.
          IF NOT v_permissive AND v_role_ok AND v_polcmd = v_cmd
             AND v_comment = 'kda:' || v_fingerprint || ':' || v_deparsed THEN
            CONTINUE;
          END IF;
        END IF;
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_name, r.table_name);
        EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR %s TO ${LIMITED_ROLE}%s%s',
                       v_name, r.table_name, r.command,
                       CASE WHEN r.using_expr IS NULL THEN '' ELSE ' USING (' || r.using_expr || ')' END,
                       CASE WHEN r.check_expr IS NULL THEN '' ELSE ' WITH CHECK (' || r.check_expr || ')' END);
        SELECT data_access_policy_deparsed_md5(p.oid)
        INTO v_deparsed
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = r.table_name AND p.polname = v_name;
        EXECUTE format('COMMENT ON POLICY %I ON public.%I IS %L',
                       v_name, r.table_name, 'kda:' || v_fingerprint || ':' || v_deparsed);
        v_created := v_created + 1;
      END LOOP;
      IF v_defined <> v_expected THEN
        RAISE EXCEPTION 'data access: % policies expected, % defined', v_expected, v_defined;
      END IF;

      -- EXECUTE on every function the policies of the role call (their dependencies), whatever
      -- the list above: the availability check tests the same dependencies.
      FOR r IN
        SELECT DISTINCT d.refobjid::regprocedure AS fn
        FROM pg_policy p
        JOIN pg_depend d
          ON d.classid = 'pg_policy'::regclass AND d.objid = p.oid AND d.refclassid = 'pg_proc'::regclass
        WHERE v_role = ANY (p.polroles)
          AND NOT has_function_privilege(v_role, d.refobjid, 'EXECUTE')
      LOOP
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO ${LIMITED_ROLE}', r.fn);
      END LOOP;
    END
    $fn$
  `);
  await queryRunner.query(`REVOKE EXECUTE ON FUNCTION data_access_sync_policies() FROM PUBLIC`);
}
