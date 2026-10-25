import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] DataAccessContractPolicies:';
const LIMITED_ROLE = 'kanap_data_limited';

/*
 * The TS builders below are a full copy of the ones of migration 1854500000000 (lot 2), as that
 * migration's header requires: a migration never imports another one (TypeORM instantiates every
 * export of a migration file). `data_access_expected_policies()` and `data_access_sync_policies()`
 * are complete lists, so this migration redefines both with every lot 2 row plus the contract rows
 * of lot 5 (spec §6.4).
 */

/*
 * The settings of data_access_apply() (spec §6.3), each read once per statement through an
 * uncorrelated scalar subquery (an InitPlan). The arrays are cast inside the subquery, then cast
 * again outside it: the outer cast (same type, no node) keeps `= ANY (...)` an array comparison
 * instead of a subquery comparison, and the inner one parses the literal once. The form of the
 * spec, `(SELECT NULLIF(...))::uuid[]` with the cast outside only, parses the array literal on
 * every row: measured 3 080 ms against 28 ms over 300 000 rows with a 40-uuid list.
 */
const setting = (name: string) => `NULLIF(current_setting('app.da_${name}', true), '')`;
/*
 * The guard of every policy, true in mode limited, never NULL. PostgreSQL never turns a Var-free
 * policy qual into a one-time filter: it stays a filter of the scan, with its own selectivity
 * estimate. The form `(SELECT mode) IS NOT DISTINCT FROM 'limited'` is estimated at 0.5 % of the
 * rows (an equality without statistics), on every scoped table of a statement: the planner then
 * expected about 50 lines instead of 10 000 and chose nested loops (list first page at 10 000
 * lines, person reading everything: 2 300 ms, 52 ms with this form; lot 2, run 2C). `IS NOT NULL`
 * on a subquery is estimated at 99.5 %.
 */
const MODE_LIMITED = `(SELECT 1 WHERE current_setting('app.da_mode', true) = 'limited') IS NOT NULL`;
/**
 * The limited role taken without data_access_apply() (mode not limited): the policies refuse
 * everything through their guard, and the SECURITY DEFINER access functions refuse the same way.
 * Inside such a function current_user is its owner, while the `role` setting still names the role
 * the transaction took.
 */
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

/** lisible_ligne (spec §6.4) on the line `p` (a column prefix: `spend_items.` or `i.`). */
const readableLine = (p: string) => `(${READ_ALL}
      OR ${p}paying_company_id = ANY (${READ_COMPANIES})
      OR ${p}cost_center_id = ANY (${READ_NODES})
      OR ${p}owner_it_id = ${USER}
      OR ${p}owner_business_id = ${USER})`;

/**
 * placable_ligne (spec §6.4). data_access_placable_line() is its single definition; it holds
 * subqueries, so PostgreSQL never inlines it and runs it per row. The policies therefore test the
 * cheap necessary conditions first, with the settings read once per statement, and call the
 * function only for a centre in the edit nodes, where it decides (the company of that centre).
 */
const placableLine = (company: string, centre: string) => `(${EDIT_ALL}
      OR ${company} = ANY (${EDIT_COMPANIES})
      OR (${centre} = ANY (${EDIT_NODES}) AND data_access_placable_line(${company}, ${centre})))`;

/** modifiable_ligne (spec §6.4): placement allowed by an edit node, or a responsible person. */
const modifiableLine = (p: string) => `(${EDIT_ALL}
      OR ${p}paying_company_id = ANY (${EDIT_COMPANIES})
      OR ${p}owner_it_id = ${USER}
      OR ${p}owner_business_id = ${USER}
      OR (${p}cost_center_id = ANY (${EDIT_NODES})
          AND data_access_placable_line(${p}paying_company_id, ${p}cost_center_id)))`;

/**
 * How a table that follows a line reaches its line id. A child names it in a column; a grandchild
 * names its version (or its round input), and a SECURITY DEFINER helper returns the line of that
 * version without reading `spend_versions` under its policy: the policy subquery then cites one
 * table with a policy, `spend_items`, whose policy cites none (spec §6.4, "profondeur").
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
const parentLineModifiable = (ref: string) => `(${EDIT_ALL}
      OR EXISTS (SELECT 1 FROM public.spend_items i WHERE i.id = ${ref} AND ${modifiableLine('i.')}))`;

type Command = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
type PolicyRow = { table: string; command: Command; using: string | null; check: string | null };

/** Every policy starts with the refusal of the role taken without context (spec §6.4). */
const guarded = (expr: string) => `${MODE_LIMITED} AND ${expr}`;

/**
 * The tables that follow a line (data-access-tables.inventory.ts, class follows_line), with how
 * each reaches its line. Run 2B adds its tables in other lists below, not here.
 */
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

function linePolicies(): PolicyRow[] {
  const t = 'spend_items';
  return [
    { table: t, command: 'SELECT', using: guarded(readableLine(`${t}.`)), check: null },
    {
      table: t,
      command: 'INSERT',
      using: null,
      check: guarded(placableLine(`${t}.paying_company_id`, `${t}.cost_center_id`)),
    },
    { table: t, command: 'UPDATE', using: guarded(modifiableLine(`${t}.`)), check: guarded(modifiableLine(`${t}.`)) },
    // Deleting a line is reserved to unscoped persons (spec §2.7, §4.1).
    { table: t, command: 'DELETE', using: 'false', check: null },
  ];
}

function followsLinePolicies(): PolicyRow[] {
  const rows: PolicyRow[] = [];
  for (const { table, reach } of FOLLOWS_LINE) {
    const ref = lineRef(table, reach);
    const readable = guarded(parentLineReadable(ref));
    const modifiable = guarded(parentLineModifiable(ref));
    rows.push(
      { table, command: 'SELECT', using: readable, check: null },
      { table, command: 'INSERT', using: null, check: modifiable },
      { table, command: 'UPDATE', using: modifiable, check: modifiable },
      { table, command: 'DELETE', using: modifiable, check: null },
    );
  }
  return rows;
}

/**
 * Run 2B. Links from other objects to a line (data-access-tables.inventory.ts, class
 * link_to_line), with the column naming the line: every command needs the line readable (spec
 * §5.4, §6.4). The link belongs to the object that carries it, so a read-only line can be linked,
 * and a bulk replacement (DELETE then INSERT) never reaches a link to an invisible line.
 */
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
 * Tasks (spec §4.4, §6.4). Only the tasks whose object is a line (`spend_item`, `capex_item`: both
 * name a row of spend_items) or a contract are scoped; every other task passes. The predicates
 * below are written once and used in two places: inline in the policies of `tasks`, where
 * spend_items is read under its own SELECT policy (`filtered`), and in the SECURITY DEFINER depth
 * functions, which read without policies and so apply lisible_ligne themselves (`definer`).
 */
type Reach = 'filtered' | 'definer';
/**
 * How a predicate tests a contract: `id`, the per-id depth function, called per row (the policies
 * of `tasks`, the per-id functions); `set`, membership of the set of visible contracts, computed
 * once per statement (the set function of the visible tasks, see the search index below).
 */
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
 * modifiable_contrat (spec §6.4): placable_contrat or owner. The cheap tests first, then
 * data_access_placable_contract(), the single definition of placable_contrat, for an edit place.
 */
const modifiableContract = (p: string) => `(${EDIT_ALL}
      OR ${p}company_id = ANY (${EDIT_COMPANIES})
      OR ${p}owner_user_id = ${USER}
      OR (${p}cost_center_id = ANY (${EDIT_NODES})
          AND data_access_placable_contract(${p}company_id, ${p}cost_center_id)))`;

/**
 * placable_contrat (spec §6.4, §2.3), the same cheap tests as modifiable_contrat without the owner
 * exception: an owner may modify a contract but never move it (the placement trigger).
 */
const placableContract = (company: string, place: string) => `(${EDIT_ALL}
      OR ${company} = ANY (${EDIT_COMPANIES})
      OR (${place} = ANY (${EDIT_NODES}) AND data_access_placable_contract(${company}, ${place})))`;

/**
 * lisible_contrat (spec §6.4) on the contract `p`: direct, or through a readable line that names it
 * (contract_spend_items, or the line's own contract_id). In the filtered form the line is filtered
 * by the SELECT policy of `spend_items`; in the definer form the predicate applies lisible_ligne
 * itself (the SECURITY DEFINER functions read without the data-access policies).
 */
const readableContract = (p: string, reach: Reach) => `(${readableContractDirect(p)}
      OR EXISTS (SELECT 1 FROM public.contract_spend_items l JOIN public.spend_items i ON i.id = l.spend_item_id
                 WHERE l.contract_id = ${p}id${reach === 'definer' ? ` AND ${IN_TENANT('l.')} AND ${IN_TENANT('i.')} AND ${readableLine('i.')}` : ''})
      OR EXISTS (SELECT 1 FROM public.spend_items i
                 WHERE i.contract_id = ${p}id${reach === 'definer' ? ` AND ${IN_TENANT('i.')} AND ${readableLine('i.')}` : ''}))`;

/** A line, named by `ref`, readable. */
/**
 * `data_access_can_read(p_user, p_type, p_id)` (lot 4, spec §5.6, §6.6) tests another person's
 * access without changing role. Its predicates take that person's values instead of the settings
 * (`Who`); they are copied from the builders above, as migration 1855100000000 did. Lot 5 replaces
 * the placeholder `CONTRACT_READABLE = 'true'` by lisible_contrat with the person's values.
 */
type Who = { readAll: string; readCompanies: string; readNodes: string; user: string; userText: string };

/** The caller, from the settings of the transaction (as the policies read them). */
const CALLER: Who = {
  readAll: READ_ALL,
  readCompanies: READ_COMPANIES,
  readNodes: READ_NODES,
  user: USER,
  userText: USER_TEXT,
};

/** The person asked about, from the variables the function computes. */
const PERSON: Who = {
  readAll: 'v_read_all',
  readCompanies: 'v_read_companies',
  readNodes: 'v_read_nodes',
  user: 'p_user',
  userText: 'p_user::text',
};

/** lisible_ligne (spec §6.4) on the line `p`, with the values of `w`. */
const readableLineFor = (p: string, w: Who) => `(${w.readAll}
        OR ${p}paying_company_id = ANY (${w.readCompanies})
        OR ${p}cost_center_id = ANY (${w.readNodes})
        OR ${p}owner_it_id = ${w.user}
        OR ${p}owner_business_id = ${w.user})`;

/** lisible_contrat (spec §6.4) on the contract `p`, with the values of `w` (SECURITY DEFINER: tenant filtered). */
const readableContractFor = (p: string, w: Who) => `(${w.readAll}
        OR ${p}company_id = ANY (${w.readCompanies})
        OR ${p}cost_center_id = ANY (${w.readNodes})
        OR ${p}owner_user_id = ${w.user}
        OR EXISTS (SELECT 1 FROM public.contract_spend_items l JOIN public.spend_items i ON i.id = l.spend_item_id
                   WHERE l.contract_id = ${p}id AND ${IN_TENANT('l.')} AND ${IN_TENANT('i.')} AND ${readableLineFor('i.', w)})
        OR EXISTS (SELECT 1 FROM public.spend_items i
                   WHERE i.contract_id = ${p}id AND ${IN_TENANT('i.')} AND ${readableLineFor('i.', w)}))`;

/** Participant of the task `p` (spec §2.5, §4.4), with the values of `w`. */
const taskParticipantFor = (p: string, w: Who) => `(${p}assignee_user_id = ${w.user}
        OR ${p}owner_ids ? ${w.userText}
        OR ${p}viewer_ids ? ${w.userText})`;

/** Task visible (spec §4.4), with the values of `w`. */
const readableTaskFor = (p: string, w: Who) => `(${w.readAll}
        OR ${p}related_object_type IS NULL OR ${p}related_object_type NOT IN ${SCOPED_TASK_TYPES}
        OR ${taskParticipantFor(p, w)}
        OR (${p}related_object_type IN ${LINE_TASK_TYPES} AND EXISTS (
              SELECT 1 FROM public.spend_items i
              WHERE i.id = ${p}related_object_id AND ${IN_TENANT('i.')} AND ${readableLineFor('i.', w)}))
        OR (${p}related_object_type = 'contract' AND EXISTS (
              SELECT 1 FROM public.contracts c
              WHERE c.id = ${p}related_object_id AND ${IN_TENANT('c.')} AND ${readableContractFor('c.', w)})))`;

/**
 * Step 5 of data_access_apply (1854400000000): the person's nodes, the tree unfolded, kept to the
 * read lists (every edit node is also a read node). A company node brings the company and the
 * centres whose company it is; a group brings itself, its subgroups and their centres; a centre
 * brings itself; disabled nodes count.
 */
const UNFOLD_NODES = `
      WITH RECURSIVE seeds AS (
        SELECT n.node_type, n.company_id, n.cost_center_id, n.access
        FROM public.user_data_access_nodes n
        WHERE n.tenant_id = v_tenant AND n.user_id = p_user
      ),
      subtree (id, company_id, access) AS (
        SELECT c.id, c.company_id, s.access
        FROM seeds s
        JOIN public.cost_centers c ON c.tenant_id = v_tenant AND c.id = s.cost_center_id
        WHERE s.node_type = 'cost_center'
        UNION
        SELECT ch.id, ch.company_id, t.access
        FROM subtree t
        JOIN public.cost_centers ch ON ch.tenant_id = v_tenant AND ch.parent_id = t.id
      ),
      tree (id, company_id, access) AS (
        SELECT id, company_id, access FROM subtree
        UNION
        SELECT c.id, c.company_id, s.access
        FROM seeds s
        JOIN public.cost_centers c ON c.tenant_id = v_tenant AND c.company_id = s.company_id
        WHERE s.node_type = 'company'
      )
      SELECT
        EXISTS (SELECT 1 FROM seeds WHERE node_type = 'all'),
        coalesce((SELECT array_agg(DISTINCT company_id ORDER BY company_id) FROM seeds
                  WHERE node_type = 'company'), '{}'::uuid[]),
        coalesce((SELECT array_agg(DISTINCT id ORDER BY id) FROM tree), '{}'::uuid[])
      INTO v_read_all, v_read_companies, v_read_nodes`;

const lineReadableById = (ref: string, reach: Reach) => reach === 'filtered'
  ? `EXISTS (SELECT 1 FROM public.spend_items i WHERE i.id = ${ref})`
  : `EXISTS (SELECT 1 FROM public.spend_items i WHERE i.id = ${ref} AND ${IN_TENANT('i.')} AND ${readableLine('i.')})`;

/** A line, named by `ref`, modifiable (and so readable). */
const lineModifiableById = (ref: string, reach: Reach) => reach === 'filtered'
  ? `EXISTS (SELECT 1 FROM public.spend_items i WHERE i.id = ${ref} AND ${modifiableLine('i.')})`
  : `EXISTS (SELECT 1 FROM public.spend_items i WHERE i.id = ${ref} AND ${IN_TENANT('i.')} AND ${readableLine('i.')} AND ${modifiableLine('i.')})`;

/**
 * A contract, named by `ref`, modifiable: through the depth function, like its visibility, so a
 * policy of `tasks` never cites `contracts` (which has its own policy from lot 5) nor depends on
 * its columns.
 */
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

/**
 * Task visible: object readable, or participant. Without `participants`, the object alone: the
 * tasks the search index shows (see searchIndexPolicies).
 */
const taskReadable = (p: string, reach: Reach, form: ContractForm = 'id', participants = true) => `(${READ_ALL}
      OR ${taskNotScoped(p)}${participants ? `
      OR ${taskParticipant(p)}` : ''}
      OR (${p}related_object_type IN ${LINE_TASK_TYPES} AND ${lineReadableById(`${p}related_object_id`, reach)})
      OR (${p}related_object_type = 'contract' AND ${contractVisible(`${p}related_object_id`, form)}))`;

/** The task's object modifiable (creation and deletion of a task). */
const taskObjectModifiable = (p: string, reach: Reach) => `(${EDIT_ALL}
      OR ${taskNotScoped(p)}
      OR (${p}related_object_type IN ${LINE_TASK_TYPES} AND ${lineModifiableById(`${p}related_object_id`, reach)})
      OR (${p}related_object_type = 'contract' AND ${contractModifiableById(`${p}related_object_id`)}))`;

/** Task modifiable: object modifiable, or responsible (assignee or owner). */
const taskModifiable = (p: string, reach: Reach) =>
  `(${taskObjectModifiable(p, reach)} OR ${taskResponsible(p)})`;

function taskPolicies(): PolicyRow[] {
  const t = 'tasks';
  const p = `${t}.`;
  return [
    { table: t, command: 'SELECT', using: guarded(taskReadable(p, 'filtered')), check: null },
    { table: t, command: 'INSERT', using: null, check: guarded(taskObjectModifiable(p, 'filtered')) },
    // WITH CHECK: the old row passed USING (object modifiable, or responsible), and a new object
    // that is a line or a contract is checked by the placement trigger of the tasks; nothing
    // requires the person to stay a participant, so a responsible person may hand the task over
    // (spec §4.4). The guard still refuses the role taken without context.
    { table: t, command: 'UPDATE', using: guarded(taskModifiable(p, 'filtered')), check: guarded('true') },
    // Today's deletion rule stays in the service (route permission); the database adds the object.
    { table: t, command: 'DELETE', using: guarded(taskObjectModifiable(p, 'filtered')), check: null },
  ];
}

/**
 * Elements of a task (class task_element): the parent task visible to read, modifiable to write.
 * Citing `tasks` here would reach spend_items through its policy, one level too deep (spec §6.4,
 * "profondeur"): the depth functions read the task without policies instead.
 */
const TASK_ELEMENTS = ['task_attachments', 'task_time_entries', 'task_applications', 'task_assets'];

/**
 * Links from other objects to a task (class link_to_task): `document_tasks`, a relation of a
 * knowledge document. Like the links to a line, the link belongs to the document: the task must be
 * visible for every command, and the right on the document applies as today.
 */
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

/**
 * The search index (spec §6.4): the entries of lines (`spend_items`, `capex_items`, both rows of
 * spend_items), of contracts and of tasks are visible when their object is. A task entry also
 * needs the task's own object readable when it is a line or a contract: its search vector carries
 * the name of that line or contract (search_index_refresh_tasks), so a participant who sees the
 * task on the tasks page never finds it in global search while its line or contract is hidden
 * (spec §5.4: neither mention nor reference). Every other entry passes. Same predicate for every
 * command: the application writes the index only through its SECURITY DEFINER triggers and the
 * reindex job.
 *
 * Contracts and tasks go through the set functions `data_access_visible_contract_ids()` and
 * `data_access_searchable_task_ids()`, in an uncorrelated `IN (SELECT ...)`: PostgreSQL builds its
 * hash table once per statement (a hashed SubPlan), and the depth rule holds (the functions read
 * without policies).
 */
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

/*
 * Contracts, lot 5 (spec §4.3, §5.4, §6.4). The contract policy reads `spend_items` under its own
 * SELECT policy, which respects the depth rule (its policy cites no table with a policy). The
 * tables that follow a contract cite `contracts` in a correlated EXISTS; its policy cites only
 * `spend_items`, as the depth rule allows. Attachments and document links are narrower on SELECT:
 * the parent must be readable directly (company, node or owner), never through a line (spec §4.3,
 * §5.4: the documents of a contract opened by one of its lines stay closed).
 */
function contractPolicies(): PolicyRow[] {
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
      using: guarded(modifiableContract(`${t}.`)),
      check: guarded(modifiableContract(`${t}.`)),
    },
    // Deleting a contract is reserved to unscoped persons (spec §2.7, §4.3).
    { table: t, command: 'DELETE', using: guarded('false'), check: null },
  ];
}

/** Contacts, compliance items and legacy tasks: the parent contract readable to read, modifiable to write. */
const FOLLOWS_CONTRACT = ['contract_contacts', 'contract_compliance_items', 'contract_tasks'];

function followsContractPolicies(): PolicyRow[] {
  const rows: PolicyRow[] = [];
  for (const table of FOLLOWS_CONTRACT) {
    const ref = `${table}.contract_id`;
    const readable = guarded(`(${READ_ALL}
      OR EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = ${ref}))`);
    const modifiable = guarded(`(${EDIT_ALL}
      OR EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = ${ref} AND ${modifiableContract('c.')}))`);
    rows.push(
      { table, command: 'SELECT', using: readable, check: null },
      { table, command: 'INSERT', using: null, check: modifiable },
      { table, command: 'UPDATE', using: modifiable, check: modifiable },
      { table, command: 'DELETE', using: modifiable, check: null },
    );
  }
  return rows;
}

/**
 * Attachments and document links: read only when the parent contract is directly readable (company,
 * node or owner); written when it is modifiable. A contract opened through one of its lines shows
 * neither, only the count of `data_access_hidden_count('contract_document', id)`.
 */
const CONTRACT_DOCUMENTS = ['contract_attachments', 'contract_links'];

function contractDocumentPolicies(): PolicyRow[] {
  const rows: PolicyRow[] = [];
  for (const table of CONTRACT_DOCUMENTS) {
    const ref = `${table}.contract_id`;
    const readable = guarded(`(${READ_ALL}
      OR EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = ${ref} AND ${readableContractDirect('c.')}))`);
    const modifiable = guarded(`(${EDIT_ALL}
      OR EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = ${ref} AND ${modifiableContract('c.')}))`);
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

/** The whole expected set. Not exported: TypeORM instantiates every export of a migration file. */
function dataAccessPolicyRows(): PolicyRow[] {
  return [
    ...linePolicies(),
    ...followsLinePolicies(),
    ...linkToLinePolicies(),
    ...taskPolicies(),
    ...taskElementPolicies(),
    ...searchIndexPolicies(),
    ...contractPolicies(),
    ...followsContractPolicies(),
    ...contractDocumentPolicies(),
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

/*
 * Data-scoped access, lot 5, run 5A (planning/data-scoped-access/spec.md §4.3, §5.4, §6.4, §9.1):
 * the policies of the contracts and of their tables. `data_access_expected_policies()` and
 * `data_access_sync_policies()` are redefined with the complete list: the lot 2 rows plus the
 * contract rows (contracts, the tables that follow a contract, the links to a contract). The sync
 * then drops the stray policies and recreates each expected one, as lot 2 does.
 *
 * Idempotent (CREATE OR REPLACE, DROP ... IF EXISTS, catalog checks). down() restores the lot 2
 * bodies of both functions and calls the sync: the contract policies are not expected any more and
 * go; the lot 2 policies are recreated.
 */
export class DataAccessContractPolicies1855300000000 implements MigrationInterface {
  name = 'DataAccessContractPolicies1855300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await createPolicyDeparsedFunction(queryRunner);
    await createLineVisibleFunction(queryRunner);
    await createPolicyFunctions(queryRunner);
    await createContractPlacementTrigger(queryRunner);
    await createContractLinkTriggers(queryRunner);
    await createCanReadFunction(queryRunner);
    await createHiddenCountFunction(queryRunner);

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`SELECT data_access_sync_policies()`);
    const [role] = await queryRunner.query(
      `SELECT to_regrole($1) IS NOT NULL AS present,
              (SELECT count(*)::int FROM pg_policy p WHERE to_regrole($1) = ANY (p.polroles)) AS policies`,
      [LIMITED_ROLE],
    );
    await queryRunner.query(`SET LOCAL lock_timeout = DEFAULT`);

    const outcome = !role?.present ? 'absent, no policy created' : `present, ${role.policies} policies in place`;
    console.log(`${LOG_PREFIX} ${dataAccessPolicyRows().length} expected policies; limited role ${outcome}`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await restoreLotFourCanRead(queryRunner);
    await restoreLotTwoHiddenCount(queryRunner);
    await restoreLotTwoFunctions(queryRunner);
    // The expected list is the lot 2 one again: the sync drops the contract policies and recreates
    // the lot 2 ones.
    await queryRunner.query(`SELECT data_access_sync_policies()`);
    await queryRunner.query(`SET LOCAL lock_timeout = DEFAULT`);

    await queryRunner.query(`DROP TRIGGER IF EXISTS contracts_data_access_placement ON contracts`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS data_access_contracts_placement()`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS contract_spend_items_data_access_link ON contract_spend_items`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS data_access_contract_spend_items_link()`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS spend_items_data_access_contract_link ON spend_items`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS data_access_spend_items_contract_link()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS data_access_line_visible(uuid)`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS data_access_policy_deparsed_md5(oid)`);
  }
}

/**
 * The md5 of a policy's deparsed expressions (USING, then WITH CHECK). `pg_get_expr` qualifies the
 * names outside the `search_path`: the search path is pinned so the sync and the availability check
 * read the same text whatever the connection's own (review note M3). Called by the application role
 * only (EXECUTE revoked from PUBLIC).
 */
async function createPolicyDeparsedFunction(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_policy_deparsed_md5(p_policy oid)
    RETURNS text
    LANGUAGE sql
    STABLE
    SET search_path = public, pg_temp
    AS $fn$
      SELECT md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '') || '|' ||
                 coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''))
      FROM pg_catalog.pg_policy p
      WHERE p.oid = p_policy
    $fn$
  `);
  await queryRunner.query(`REVOKE EXECUTE ON FUNCTION data_access_policy_deparsed_md5(oid) FROM PUBLIC`);
  await queryRunner.query(`GRANT EXECUTE ON FUNCTION data_access_policy_deparsed_md5(oid) TO CURRENT_USER`);
}

async function createPolicyFunctions(queryRunner: QueryRunner): Promise<void> {
  const rows = dataAccessPolicyRows();
  const expectedValues = rows
    .map((r) => `('${dataAccessPolicyName(r)}', '${r.table}', '${r.command}', ${literal(r.using)}, ${literal(r.check)})`)
    .join(',\n        ');
  const definitionValues = rows
    .map((r) => `('${r.table}', '${r.command}', ${literal(r.using)}, ${literal(r.check)})`)
    .join(',\n          ');

  // The single source of the policies the database must hold (policy, table, command, fingerprint).
  // The fingerprint is the md5 of the command and of the two policy texts; a change of either
  // changes it. The return type changes from lot 2 (three columns to four): DROP first.
  await queryRunner.query(`DROP FUNCTION IF EXISTS data_access_expected_policies()`);
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
  // recreated from the definitions below (one row per policy: table, command, USING, WITH CHECK).
  // A policy carries its source fingerprint and the md5 of its deparsed expressions in
  // `COMMENT ON POLICY`: a missing comment, a changed source fingerprint or an altered body makes
  // it different (spec §6.2, review notes M4 and M5). It is the only policy recreated; the others
  // keep their oid. Policy DDL takes an exclusive lock on its table: callers set lock_timeout, the
  // function does not.
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

/**
 * A budget line readable by the person of the transaction, read without the data-access policies
 * (SECURITY DEFINER, tenant filtered): the link triggers of a contract use it to tell a hidden line
 * from a visible one. Outside mode limited it answers true; under the limited role taken without
 * context it answers false, like the other access functions.
 */
async function createLineVisibleFunction(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_line_visible(p_line uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $fn$
      SELECT CASE WHEN NOT (${MODE_LIMITED}) THEN NOT (${ROLE_TAKEN}) ELSE coalesce((
        SELECT ${readableLine('i.')}
        FROM public.spend_items i WHERE i.id = p_line AND ${IN_TENANT('i.')}), false) END
    $fn$
  `);
  await queryRunner.query(`REVOKE EXECUTE ON FUNCTION data_access_line_visible(uuid) FROM PUBLIC`);
  await queryRunner.query(`GRANT EXECUTE ON FUNCTION data_access_line_visible(uuid) TO CURRENT_USER`);
}

/**
 * Links to a contract (spec §5.4, §6.4): a link may only be created, changed or removed by a person
 * who reads the contract and may modify the line. In mode limited the trigger raises 23503 with the
 * same message for an invisible and for a nonexistent object, so the foreign key never answers for
 * the limited person (it would be an existence oracle); a visible but read-only line gets 42501.
 * The checks run BEFORE INSERT OR UPDATE OF contract_id on spend_items, and on every write of
 * contract_spend_items. Outside mode limited both triggers return immediately, except under the
 * limited role taken without context, where they raise 42501.
 */
async function createContractLinkTriggers(queryRunner: QueryRunner): Promise<void> {
  // The contract first, then the line: with a hidden contract the answer never depends on the line.
  const contractError = `RAISE EXCEPTION 'data access: this contract is outside your access or does not exist'
          USING ERRCODE = '23503';`;
  const lineMissingError = `RAISE EXCEPTION 'data access: this budget line is outside your access or does not exist'
          USING ERRCODE = '23503';`;
  const lineReadOnlyError = `RAISE EXCEPTION 'permission denied: this budget line is outside your data access'
          USING ERRCODE = '42501';`;
  // The limited role taken without context (spec §6.4): everything is refused.
  const noContextError = `RAISE EXCEPTION 'permission denied: no data access context'
          USING ERRCODE = '42501';`;

  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_spend_items_contract_link()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = public, pg_temp
    AS $fn$
    BEGIN
      IF NULLIF(current_setting('app.da_mode', true), '') IS DISTINCT FROM 'limited' THEN
        IF ${ROLE_TAKEN} THEN
          ${noContextError}
        END IF;
        RETURN NEW;
      END IF;
      IF NEW.contract_id IS NULL THEN
        RETURN NEW;
      END IF;
      IF TG_OP = 'UPDATE' AND NEW.contract_id IS NOT DISTINCT FROM OLD.contract_id THEN
        RETURN NEW;
      END IF;
      IF NOT coalesce(data_access_contract_visible(NEW.contract_id), false) THEN
        ${contractError}
      END IF;
      IF NOT data_access_line_editable(
        NEW.paying_company_id, NEW.cost_center_id, NEW.owner_it_id, NEW.owner_business_id) THEN
        ${lineReadOnlyError}
      END IF;
      RETURN NEW;
    END
    $fn$
  `);
  await queryRunner.query(`DROP TRIGGER IF EXISTS spend_items_data_access_contract_link ON spend_items`);
  await queryRunner.query(`
    CREATE TRIGGER spend_items_data_access_contract_link
    BEFORE INSERT OR UPDATE OF contract_id ON spend_items
    FOR EACH ROW EXECUTE FUNCTION data_access_spend_items_contract_link()
  `);

  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_contract_spend_items_link()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = public, pg_temp
    AS $fn$
    DECLARE
      v_editable boolean;
    BEGIN
      IF NULLIF(current_setting('app.da_mode', true), '') IS DISTINCT FROM 'limited' THEN
        IF ${ROLE_TAKEN} THEN
          ${noContextError}
        END IF;
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
      END IF;

      IF TG_OP = 'DELETE' THEN
        SELECT data_access_line_editable(
                 i.paying_company_id, i.cost_center_id, i.owner_it_id, i.owner_business_id)
        INTO v_editable
        FROM public.spend_items i
        WHERE i.id = OLD.spend_item_id AND ${IN_TENANT('i.')};
        IF NOT FOUND OR NOT v_editable THEN
          ${lineReadOnlyError}
        END IF;
        RETURN OLD;
      END IF;

      IF TG_OP = 'UPDATE' THEN
        -- The old link stays where it is: a person who does not modify its line never rewrites it.
        SELECT data_access_line_editable(
                 i.paying_company_id, i.cost_center_id, i.owner_it_id, i.owner_business_id)
        INTO v_editable
        FROM public.spend_items i
        WHERE i.id = OLD.spend_item_id AND ${IN_TENANT('i.')};
        IF NOT FOUND OR NOT v_editable THEN
          ${lineReadOnlyError}
        END IF;
      END IF;

      IF NOT coalesce(data_access_contract_visible(NEW.contract_id), false) THEN
        ${contractError}
      END IF;
      IF NOT coalesce(data_access_line_visible(NEW.spend_item_id), false) THEN
        ${lineMissingError}
      END IF;
      SELECT data_access_line_editable(
               i.paying_company_id, i.cost_center_id, i.owner_it_id, i.owner_business_id)
      INTO v_editable
      FROM public.spend_items i
      WHERE i.id = NEW.spend_item_id AND ${IN_TENANT('i.')};
      IF NOT FOUND OR NOT v_editable THEN
        ${lineReadOnlyError}
      END IF;
      RETURN NEW;
    END
    $fn$
  `);
  await queryRunner.query(`DROP TRIGGER IF EXISTS contract_spend_items_data_access_link ON contract_spend_items`);
  await queryRunner.query(`
    CREATE TRIGGER contract_spend_items_data_access_link
    BEFORE INSERT OR UPDATE OR DELETE ON contract_spend_items
    FOR EACH ROW EXECUTE FUNCTION data_access_contract_spend_items_link()
  `);
}

/**
 * `data_access_can_read` with the contract branch given: the lot 5 form checks the caller's
 * visibility of the contract before answering and applies lisible_contrat with the person's values;
 * the lot 4 form (restored by down()) answered `true` for every contract and only tested that the
 * contract existed.
 */
function canReadSql(contractStart: string, contractResult: string): string {
  return `
    CREATE OR REPLACE FUNCTION data_access_can_read(p_user uuid, p_type text, p_id uuid)
    RETURNS boolean
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $fn$
    DECLARE
      v_tenant uuid := app_current_tenant();
      v_mode text;
      v_read_all boolean;
      v_read_companies uuid[];
      v_read_nodes uuid[];
    BEGIN
      IF p_type IS NULL OR p_type NOT IN ('spend_item', 'task', 'contract') THEN
        RAISE EXCEPTION 'data_access_can_read: unknown type %', p_type USING ERRCODE = '22023';
      END IF;
      IF NOT (${MODE_LIMITED}) AND ${ROLE_TAKEN} THEN
        RETURN NULL;
      END IF;

      -- The starting object: in the tenant, and visible to a limited caller.
      IF p_type = 'spend_item' THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.spend_items i
          WHERE i.id = p_id AND ${IN_TENANT('i.')}
            AND (NOT (${MODE_LIMITED}) OR ${readableLineFor('i.', CALLER)})
        ) THEN
          RETURN NULL;
        END IF;
      ELSIF p_type = 'task' THEN
        IF NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = p_id AND ${IN_TENANT('t.')})
           OR ((${MODE_LIMITED}) AND NOT data_access_task_visible(p_id)) THEN
          RETURN NULL;
        END IF;
      ELSE
        ${contractStart}
      END IF;

      -- The person: unknown, refused; all data or Administrator, everything (data_access_apply, steps 1-3).
      SELECT u.data_access_mode INTO v_mode
      FROM public.users u
      WHERE u.id = p_user AND u.tenant_id = v_tenant;
      IF NOT FOUND THEN
        RETURN false;
      END IF;
      IF v_mode = 'all' OR EXISTS (
        SELECT 1
        FROM (
          SELECT u.role_id FROM public.users u WHERE u.id = p_user AND u.tenant_id = v_tenant
          UNION
          SELECT ur.role_id FROM public.user_roles ur WHERE ur.user_id = p_user AND ur.tenant_id = v_tenant
        ) assigned
        JOIN public.roles r ON r.id = assigned.role_id AND r.tenant_id = v_tenant
        WHERE lower(trim(r.role_name)) = 'administrator'
      ) THEN
        RETURN true;
      END IF;

      -- Limited: the nodes unfolded (data_access_apply, step 5).
${UNFOLD_NODES};

      IF p_type = 'spend_item' THEN
        RETURN EXISTS (
          SELECT 1 FROM public.spend_items i
          WHERE i.id = p_id AND ${IN_TENANT('i.')} AND ${readableLineFor('i.', PERSON)});
      ELSIF p_type = 'task' THEN
        RETURN EXISTS (
          SELECT 1 FROM public.tasks t
          WHERE t.id = p_id AND ${IN_TENANT('t.')} AND ${readableTaskFor('t.', PERSON)});
      END IF;
      ${contractResult}
    END
    $fn$
  `;
}

/** The lot 5 rule: the caller must see the contract, and the answer uses the person's values. */
async function createCanReadFunction(queryRunner: QueryRunner): Promise<void> {
  await grantCanRead(queryRunner, true);
  console.log(`${LOG_PREFIX} data_access_can_read: contracts scoped`);
}

/** The lot 4 body (1855100000000), restored by down(): every contract readable, existence only. */
async function restoreLotFourCanRead(queryRunner: QueryRunner): Promise<void> {
  await grantCanRead(queryRunner, false);
}

async function grantCanRead(queryRunner: QueryRunner, scopedContracts: boolean): Promise<void> {
  const contractStart = scopedContracts
    ? `IF NOT EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = p_id AND ${IN_TENANT('c.')})
           OR ((${MODE_LIMITED}) AND NOT data_access_contract_visible(p_id)) THEN
          RETURN NULL;
        END IF;`
    : `IF NOT EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = p_id AND ${IN_TENANT('c.')}) THEN
          RETURN NULL;
        END IF;`;
  const contractResult = scopedContracts
    ? `RETURN EXISTS (
          SELECT 1 FROM public.contracts c
          WHERE c.id = p_id AND ${IN_TENANT('c.')} AND ${readableContractFor('c.', PERSON)});`
    : 'RETURN true;';
  await queryRunner.query(canReadSql(contractStart, contractResult));
  await queryRunner.query(`REVOKE EXECUTE ON FUNCTION data_access_can_read(uuid, text, uuid) FROM PUBLIC`);
  await queryRunner.query(`GRANT EXECUTE ON FUNCTION data_access_can_read(uuid, text, uuid) TO CURRENT_USER`);
  const [role] = await queryRunner.query(`SELECT to_regrole($1) IS NOT NULL AS present`, [LIMITED_ROLE]);
  if (role?.present) {
    await queryRunner.query(`GRANT EXECUTE ON FUNCTION data_access_can_read(uuid, text, uuid) TO ${LIMITED_ROLE}`);
  }
}

/**
 * Placement of a contract (spec §6.4, "Placement par participation"): a limited person may modify a
 * contract it owns, but not move it to a company or a place outside its edit access. The UPDATE
 * policy does not see the old row, so without this trigger an owner would set any company on the
 * contract while keeping the participation. SECURITY INVOKER: it reads the settings of the
 * transaction. Outside mode limited it does nothing.
 */
async function createContractPlacementTrigger(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_contracts_placement()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = public, pg_temp
    AS $fn$
    BEGIN
      IF NULLIF(current_setting('app.da_mode', true), '') IS DISTINCT FROM 'limited' THEN
        RETURN NEW;
      END IF;
      IF NEW.company_id IS NOT DISTINCT FROM OLD.company_id
         AND NEW.cost_center_id IS NOT DISTINCT FROM OLD.cost_center_id THEN
        RETURN NEW;
      END IF;
      IF NOT data_access_placable_contract(NEW.company_id, NEW.cost_center_id) THEN
        RAISE EXCEPTION 'permission denied: this place is outside your data access'
          USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$
  `);
  await queryRunner.query(`DROP TRIGGER IF EXISTS contracts_data_access_placement ON contracts`);
  await queryRunner.query(`
    CREATE TRIGGER contracts_data_access_placement
    BEFORE UPDATE OF company_id, cost_center_id ON contracts
    FOR EACH ROW EXECUTE FUNCTION data_access_contracts_placement()
  `);
}

/**
 * The helpers of the policies and depth functions of lot 2, by signature. Their bodies stay as
 * lot 2 wrote them; the sync grants EXECUTE on them to the limited role.
 */
const LINE_HELPER_SIGNATURES = ['data_access_line_of_version(uuid)', 'data_access_line_of_round_input(uuid)'];

/** The line helper of the contract link triggers (lot 5), SECURITY DEFINER. */
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
 * data_access_hidden_count (spec §6.6, §5.4): per type of starting object, the objects the person
 * cannot read. Types of lot 5:
 * - `contract_document`: the attachments and document links of a contract the person reads without
 *   reading it directly (through one of its lines); 0 when the contract is directly readable;
 * - `application_contract`, `asset_contract`, `technology_contract`: the contracts an application,
 *   an asset or a technology is linked to that the person cannot read.
 * As in lot 2, the starting object must be visible to the person (NULL otherwise, as for an
 * unknown id); outside mode limited the answer is 0, and under the limited role taken without
 * context it is NULL.
 */
const HIDDEN_COUNT_LINKS: Array<{ type: string; object: string; link: string; objectColumn: string; lineColumn: string }> = [
  { type: 'application', object: 'applications', link: 'application_spend_items', objectColumn: 'application_id', lineColumn: 'spend_item_id' },
  { type: 'asset', object: 'assets', link: 'asset_spend_items', objectColumn: 'asset_id', lineColumn: 'spend_item_id' },
  { type: 'technology', object: 'technologies', link: 'technology_spend_items', objectColumn: 'technology_id', lineColumn: 'spend_item_id' },
  { type: 'project', object: 'portfolio_projects', link: 'portfolio_project_opex', objectColumn: 'project_id', lineColumn: 'opex_id' },
  { type: 'request', object: 'portfolio_requests', link: 'portfolio_request_opex', objectColumn: 'request_id', lineColumn: 'opex_id' },
  { type: 'contract', object: 'contracts', link: 'contract_spend_items', objectColumn: 'contract_id', lineColumn: 'spend_item_id' },
];

/** The starting objects of lot 5 that hide contracts: an application, an asset, a technology. */
const HIDDEN_CONTRACT_LINKS: Array<{ type: string; object: string; link: string; objectColumn: string }> = [
  { type: 'application_contract', object: 'applications', link: 'application_contracts', objectColumn: 'application_id' },
  { type: 'asset_contract', object: 'assets', link: 'asset_contracts', objectColumn: 'asset_id' },
  { type: 'technology_contract', object: 'technologies', link: 'technology_contracts', objectColumn: 'technology_id' },
];

const HIDDEN_COUNT_TYPES = [
  ...HIDDEN_COUNT_LINKS.map((h) => `'${h.type}'`),
  ...HIDDEN_CONTRACT_LINKS.map((h) => `'${h.type}'`),
  "'contract_document'",
];

/**
 * The number of documents (attachments and links) closed on a contract: only for a contract the
 * person reads without reading it directly.
 */
function hiddenCount(): string {
  const lineBranches = HIDDEN_COUNT_LINKS.map((h) => `
      IF p_type = '${h.type}' THEN
        IF NOT EXISTS (SELECT 1 FROM public.${h.object} o WHERE o.id = p_id AND o.tenant_id = app_current_tenant())
           ${h.type === 'contract' ? 'OR NOT data_access_contract_visible(p_id)' : ''} THEN
          RETURN NULL;
        END IF;
        SELECT count(*)::int INTO v_count
        FROM public.spend_items i
        WHERE ${IN_TENANT('i.')}
          AND i.id IN (
            SELECT l.${h.lineColumn} FROM public.${h.link} l WHERE l.${h.objectColumn} = p_id AND ${IN_TENANT('l.')}${h.type === 'contract' ? `
            UNION
            SELECT s.id FROM public.spend_items s WHERE s.contract_id = p_id AND ${IN_TENANT('s.')}` : ''})
          AND NOT coalesce(${readableLine('i.')}, false);
        RETURN v_count;
      END IF;`).join('');
  const documentBranch = `
      IF p_type = 'contract_document' THEN
        IF NOT EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = p_id AND ${IN_TENANT('c.')})
           OR NOT data_access_contract_visible(p_id) THEN
          RETURN NULL;
        END IF;
        IF EXISTS (
          SELECT 1 FROM public.contracts c
          WHERE c.id = p_id AND ${IN_TENANT('c.')} AND ${readableContractDirect('c.')}
        ) THEN
          RETURN 0;
        END IF;
        SELECT (SELECT count(*)::int FROM public.contract_attachments a
                 WHERE a.contract_id = p_id AND ${IN_TENANT('a.')})
             + (SELECT count(*)::int FROM public.contract_links l
                 WHERE l.contract_id = p_id AND ${IN_TENANT('l.')})
        INTO v_count;
        RETURN v_count;
      END IF;`;
  const contractBranches = HIDDEN_CONTRACT_LINKS.map((h) => `
      IF p_type = '${h.type}' THEN
        IF NOT EXISTS (SELECT 1 FROM public.${h.object} o WHERE o.id = p_id AND o.tenant_id = app_current_tenant()) THEN
          RETURN NULL;
        END IF;
        SELECT count(*)::int INTO v_count
        FROM public.contracts c
        WHERE ${IN_TENANT('c.')}
          AND c.id IN (
            SELECT l.contract_id FROM public.${h.link} l
            WHERE l.${h.objectColumn} = p_id AND ${IN_TENANT('l.')})
          AND NOT coalesce(${readableContract('c.', 'definer')}, false);
        RETURN v_count;
      END IF;`).join('');
  return lineBranches + documentBranch + contractBranches;
}

async function createHiddenCountFunction(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_hidden_count(p_type text, p_id uuid)
    RETURNS integer
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $fn$
    DECLARE
      v_count integer;
    BEGIN
      IF p_type IS NULL OR p_type NOT IN (${HIDDEN_COUNT_TYPES.join(', ')}) THEN
        RAISE EXCEPTION 'data_access_hidden_count: unknown type %', p_type USING ERRCODE = '22023';
      END IF;
      IF NOT (${MODE_LIMITED}) THEN
        RETURN CASE WHEN ${ROLE_TAKEN} THEN NULL ELSE 0 END;
      END IF;${hiddenCount()}
      RETURN NULL;
    END
    $fn$
  `);
  await queryRunner.query(`REVOKE EXECUTE ON FUNCTION data_access_hidden_count(text, uuid) FROM PUBLIC`);
  await queryRunner.query(`GRANT EXECUTE ON FUNCTION data_access_hidden_count(text, uuid) TO CURRENT_USER`);
  const [role] = await queryRunner.query(`SELECT to_regrole($1) IS NOT NULL AS present`, [LIMITED_ROLE]);
  if (role?.present) {
    await queryRunner.query(`GRANT EXECUTE ON FUNCTION data_access_hidden_count(text, uuid) TO ${LIMITED_ROLE}`);
  }
  console.log(`${LOG_PREFIX} data_access_hidden_count: contract_document, application_contract, asset_contract, technology_contract`);
}

/** The lot 2 body of data_access_hidden_count (1854500000000), restored by down(): line links only. */
async function restoreLotTwoHiddenCount(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_hidden_count(p_type text, p_id uuid)
    RETURNS integer
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $fn$
    DECLARE
      v_count integer;
    BEGIN
      IF p_type IS NULL OR p_type NOT IN (${HIDDEN_COUNT_LINKS.map((h) => `'${h.type}'`).join(', ')}) THEN
        RAISE EXCEPTION 'data_access_hidden_count: unknown type %', p_type USING ERRCODE = '22023';
      END IF;
      IF NOT (${MODE_LIMITED}) THEN
        RETURN CASE WHEN ${ROLE_TAKEN} THEN NULL ELSE 0 END;
      END IF;${HIDDEN_COUNT_LINKS.map((h) => `
      IF p_type = '${h.type}' THEN
        IF NOT EXISTS (SELECT 1 FROM public.${h.object} o WHERE o.id = p_id AND o.tenant_id = app_current_tenant())
           ${h.type === 'contract' ? 'OR NOT data_access_contract_visible(p_id)' : ''} THEN
          RETURN NULL;
        END IF;
        SELECT count(*)::int INTO v_count
        FROM public.spend_items i
        WHERE ${IN_TENANT('i.')}
          AND i.id IN (
            SELECT l.${h.lineColumn} FROM public.${h.link} l WHERE l.${h.objectColumn} = p_id AND ${IN_TENANT('l.')}${h.type === 'contract' ? `
            UNION
            SELECT s.id FROM public.spend_items s WHERE s.contract_id = p_id AND ${IN_TENANT('s.')}` : ''})
          AND NOT coalesce(${readableLine('i.')}, false);
        RETURN v_count;
      END IF;`).join('')}
      RETURN NULL;
    END
    $fn$
  `);
  await queryRunner.query(`REVOKE EXECUTE ON FUNCTION data_access_hidden_count(text, uuid) FROM PUBLIC`);
  await queryRunner.query(`GRANT EXECUTE ON FUNCTION data_access_hidden_count(text, uuid) TO CURRENT_USER`);
  const [role] = await queryRunner.query(`SELECT to_regrole($1) IS NOT NULL AS present`, [LIMITED_ROLE]);
  if (role?.present) {
    await queryRunner.query(`GRANT EXECUTE ON FUNCTION data_access_hidden_count(text, uuid) TO ${LIMITED_ROLE}`);
  }
}

/** The lot 2 bodies of the two functions this migration replaces (1854500000000). */
async function restoreLotTwoFunctions(queryRunner: QueryRunner): Promise<void> {
  // The lot 5 function has a fourth column: the lot 2 return type needs a DROP.
  await queryRunner.query(`DROP FUNCTION IF EXISTS data_access_expected_policies()`);
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_expected_policies()
    RETURNS TABLE (policy_name text, table_name text, command text)
    LANGUAGE sql
    STABLE
    SET search_path = public, pg_temp
    AS $fn$
      SELECT v.policy_name, v.table_name, v.command
      FROM (VALUES
${lotTwoPolicyRows().map((r) => `        ('${dataAccessPolicyName(r)}', '${r.table}', '${r.command}')`).join(',\n')}
      ) AS v(policy_name, table_name, command)
    $fn$
  `);

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
      v_expected int;
      v_created int := 0;
      v_inherits boolean;
      v_dropped int := 0;
    BEGIN
      IF v_role IS NULL THEN
        RETURN;
      END IF;
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
${[...LINE_HELPER_SIGNATURES, ...ACCESS_DEFINER_SIGNATURES].map((sig) => `      GRANT EXECUTE ON FUNCTION ${sig} TO ${LIMITED_ROLE};`).join('\n')}

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

      SELECT count(*) INTO v_expected FROM data_access_expected_policies();
      FOR r IN
        SELECT d.table_name, d.command, d.using_expr, d.check_expr
        FROM (VALUES
${lotTwoPolicyRows().map((r) => `          ('${r.table}', '${r.command}', ${literal(r.using)}, ${literal(r.check)})`).join(',\n')}
        ) AS d(table_name, command, using_expr, check_expr)
      LOOP
        v_name := r.table_name || '_data_access_' || lower(r.command);
        IF NOT EXISTS (
          SELECT 1 FROM data_access_expected_policies() e
          WHERE e.policy_name = v_name AND e.table_name = r.table_name AND e.command = r.command
        ) THEN
          RAISE EXCEPTION 'data access: policy % is defined but not expected', v_name;
        END IF;
        v_created := v_created + 1;
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_name, r.table_name);
        EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR %s TO ${LIMITED_ROLE}%s%s',
                       v_name, r.table_name, r.command,
                       CASE WHEN r.using_expr IS NULL THEN '' ELSE ' USING (' || r.using_expr || ')' END,
                       CASE WHEN r.check_expr IS NULL THEN '' ELSE ' WITH CHECK (' || r.check_expr || ')' END);
      END LOOP;
      IF v_created <> v_expected THEN
        RAISE EXCEPTION 'data access: % policies expected, % defined', v_expected, v_created;
      END IF;

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

/** The lot 2 rows only: the expected list a down() restores. */
function lotTwoPolicyRows(): PolicyRow[] {
  return [
    ...linePolicies(),
    ...followsLinePolicies(),
    ...linkToLinePolicies(),
    ...taskPolicies(),
    ...taskElementPolicies(),
    ...searchIndexPolicies(),
  ];
}
