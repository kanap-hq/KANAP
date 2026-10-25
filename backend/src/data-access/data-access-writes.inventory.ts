/**
 * Data-scoped access, lots 3 and 5: the writes on budget lines, contracts, their children, their
 * tasks and the links between them (planning/data-scoped-access/spec.md §6.7 "succès silencieux",
 * §6.8). A limited person's
 * write the policies refuse either fails (INSERT, 42501) or touches no row (UPDATE, DELETE), which
 * would look saved. Every write site is classified here with how a refusal surfaces, so it is a
 * clear 403 `DATA_ACCESS_LIMITED` (or the 404 of a row the person cannot read), never a 200 that
 * wrote nothing.
 *
 * A site is a TypeORM `save()`, `update()`, `delete()`, `remove()`, `insert()`, `upsert()`,
 * `softDelete()` call, or a raw `INSERT INTO`, `UPDATE ... SET` or `DELETE FROM`, counted per member
 * (method or function around it). `data-access/__tests__/data-access-writes-inventory.spec.ts`
 * scans the files:
 * - under `spend/`, `tasks/` and `contracts/` (`DATA_ACCESS_WRITE_ROOTS`), every site is listed: a
 *   new site, a new member or a count that changed fails until it is looked at;
 * - elsewhere, the members that write a link to a line from the other object's side are listed
 *   (`DATA_ACCESS_LINK_WRITES`): their count is checked; other members of those files write
 *   objects that are not scoped.
 *
 * Handling:
 * - `pre_check`: a check runs before the write (`data-access/line-write-checks.ts`,
 *   `data-access/contract-write-checks.ts`, `tasks/task-data-access.ts`), with the SQL functions of
 *   lots 2, 3 and 5;
 * - `lock`: the write runs after `lockBudgetLine`, `lockBudgetLines`, `lockBudgetVersions` or a
 *   line lock of its own (FOR NO KEY UPDATE passes the UPDATE policy only): a readable line the
 *   person may not modify gets the clear 403, an unreadable one the 404 of a missing line;
 * - `row_count`: the write counts its rows, and none touched in a limited transaction is a 403;
 * - `delegates`: the member calls a member listed here, which checks;
 * - `visible_links`: a link to a line or a contract written from the other object's side (spec
 *   §5.4, §6.4): the ids named are read under the policies first (an unreadable line or contract is
 *   refused as missing), and a replacement reads and deletes only the links to readable rows
 *   (`DELETE ... USING` the scoped table), so the hidden links stay;
 * - `reserved`: reachable only from a route reserved to unscoped persons (spec §2.7,
 *   `data-access-reserved.inventory.ts`) or from a delete of an object that is not scoped;
 * - `not_scoped`: writes a table without data-access policies (the reason says which).
 *
 * The budget file load (`spend/budget-file/import-file.ts`) plans every row with the line rules
 * first (`budget-file/access.ts`, spec §4.2) and rolls the whole load back with the stale
 * preflight's 409 when a write is refused anyway.
 */

export type DataAccessWriteHandling =
  | 'pre_check'
  | 'lock'
  | 'row_count'
  | 'delegates'
  | 'visible_links'
  | 'reserved'
  | 'not_scoped';

export type DataAccessWriteEntry = {
  /** Relative to `backend/src`. */
  file: string;
  member: string;
  /** Write sites in the member. */
  count: number;
  handling: DataAccessWriteHandling;
  reason: string;
};

/** The folders whose every write site is listed. */
export const DATA_ACCESS_WRITE_ROOTS = ['spend', 'tasks', 'contracts'];

const LINE_LOCK = 'under the line lock (lockBudgetLine): 403 when the line is read only';
const VERSION_LOCK = 'under the version lock (lockBudgetVersions, through lockVersion or lockVersionWithLine): 403 when the line is read only';
const OWN_LINE_LOCK = 'the line locked FOR NO KEY UPDATE first; no row: assertLinesEditable gives the 403 of a read-only line, else 404';
const LINE_DELETE = 'delete of a line: reserved (spec §2.7)';
const BUDGET_FILE = 'budget file load: rows planned with the line rules (budget-file/access.ts); a refused write rolls the load back (409)';
const ACTIVITIES = 'portfolio_activities has no data-access policy (data-access-tables.inventory.ts); the task is read first under the policies (404 when hidden)';
const TASK_ELEMENT = 'assertTaskModifiable (data_access_task_modifiable, the policy of the task elements) before the write';

export const DATA_ACCESS_WRITES: DataAccessWriteEntry[] = [
  // spend/
  { file: 'spend/allocation-rules.service.ts', member: 'clearTenantMethod', count: 1, handling: 'reserved', reason: 'default allocation rule of the tenant (allocation-rules.controller, reserved)' },
  { file: 'spend/allocation-rules.service.ts', member: 'setTenantMethod', count: 1, handling: 'reserved', reason: 'default allocation rule of the tenant (allocation-rules.controller, reserved)' },
  { file: 'spend/allocation-save.ts', member: 'storeRows', count: 3, handling: 'lock', reason: VERSION_LOCK },
  { file: 'spend/amounts-write.util.ts', member: 'createMissingMonths', count: 1, handling: 'lock', reason: VERSION_LOCK },
  { file: 'spend/amounts-write.util.ts', member: 'upsertColumns', count: 1, handling: 'lock', reason: VERSION_LOCK },
  { file: 'spend/budget-allocation-operations.ts', member: 'runAllocationCopy', count: 3, handling: 'reserved', reason: 'allocation copy over a set of lines (copyAllocations, reserved)' },
  { file: 'spend/budget-file/import-file.ts', member: 'applyLine', count: 1, handling: 'delegates', reason: `${BUDGET_FILE}; the item services (resolveItemWrite) and lockBudgetLine` },
  { file: 'spend/budget-file/import-file.ts', member: 'createDimensionValues', count: 1, handling: 'not_scoped', reason: `analytics_categories; ${BUDGET_FILE}: a limited person's plan creates values of open dimensions only` },
  { file: 'spend/budget-file/import-file.ts', member: 'createSuppliers', count: 1, handling: 'not_scoped', reason: 'suppliers, created as before (canCreateSuppliers)' },
  { file: 'spend/budget-file/import-file.ts', member: 'insertAmountRows', count: 1, handling: 'lock', reason: `writeFlatSpreads: ${VERSION_LOCK}; ${BUDGET_FILE}` },
  { file: 'spend/budget-file/import-file.ts', member: 'insertAudits', count: 1, handling: 'not_scoped', reason: 'audit_log' },
  { file: 'spend/budget-file/import-file.ts', member: 'insertRoundRows', count: 1, handling: 'lock', reason: `writeFlatSpreads: ${VERSION_LOCK}; ${BUDGET_FILE}` },
  { file: 'spend/budget-line-relations.ts', member: 'setAssetLink', count: 2, handling: 'lock', reason: OWN_LINE_LOCK },
  { file: 'spend/budget-line-type-change.service.ts', member: 'changeFromYear', count: 4, handling: 'lock', reason: `${LINE_LOCK}; the versions, links and tasks of a line the person may modify are all visible and modifiable` },
  { file: 'spend/budget-line-type-change.service.ts', member: 'changeInPlace', count: 2, handling: 'lock', reason: `${LINE_LOCK}; the tasks of a line the person may modify are modifiable` },
  { file: 'spend/budget-lines.controller.ts', member: 'update', count: 1, handling: 'delegates', reason: 'BudgetLinesService.update' },
  { file: 'spend/budget-lines.service.ts', member: 'update', count: 1, handling: 'delegates', reason: 'SpendItemsService.update: resolveItemWrite (editable, placement, contract) and the line lock' },
  { file: 'spend/budget-version-ensure.ts', member: 'ensureBudgetVersion', count: 1, handling: 'lock', reason: LINE_LOCK },
  { file: 'spend/capex-items.controller.ts', member: 'delete', count: 1, handling: 'reserved', reason: LINE_DELETE },
  { file: 'spend/capex-items.controller.ts', member: 'update', count: 1, handling: 'delegates', reason: 'SpendItemsService.update' },
  { file: 'spend/item-analytics.util.ts', member: 'writeItemAnalyticsValues', count: 2, handling: 'pre_check', reason: 'after resolveItemWrite (create: placement) or under the line lock (update, type change)' },
  { file: 'spend/item-applications.ts', member: 'replaceItemApplications', count: 2, handling: 'lock', reason: OWN_LINE_LOCK },
  { file: 'spend/item-delete-cleanup.ts', member: 'deleteItemDependents', count: 3, handling: 'reserved', reason: LINE_DELETE },
  { file: 'spend/item-delete-cleanup.ts', member: 'deleteItemTasks', count: 3, handling: 'reserved', reason: 'delete of a line or a contract: reserved (spec §2.7); the tasks of an incident are not scoped' },
  { file: 'spend/item-technologies.ts', member: 'replaceItemTechnologies', count: 2, handling: 'lock', reason: OWN_LINE_LOCK },
  // The scan names the member by the last function head above the site.
  { file: 'spend/round-inputs.util.ts', member: 'assertPeriodInVersionYear', count: 1, handling: 'lock', reason: `saveRoundInput: ${VERSION_LOCK}` },
  { file: 'spend/round-inputs.util.ts', member: 'assertTenant', count: 1, handling: 'lock', reason: `deleteRoundInput: ${VERSION_LOCK}` },
  { file: 'spend/round-inputs.util.ts', member: 'replaceLines', count: 2, handling: 'lock', reason: VERSION_LOCK },
  { file: 'spend/spend-item-contacts.service.ts', member: 'detach', count: 1, handling: 'lock', reason: LINE_LOCK },
  { file: 'spend/spend-item-contacts.service.ts', member: 'syncFromSupplier', count: 2, handling: 'lock', reason: LINE_LOCK },
  { file: 'spend/spend-items-delete.service.ts', member: 'deleteRows', count: 4, handling: 'reserved', reason: LINE_DELETE },
  { file: 'spend/spend-items.controller.ts', member: 'delete', count: 1, handling: 'reserved', reason: LINE_DELETE },
  { file: 'spend/spend-items.controller.ts', member: 'update', count: 1, handling: 'delegates', reason: 'SpendItemsService.update' },
  { file: 'spend/spend-items.service.ts', member: 'bulkReplaceProjects', count: 1, handling: 'lock', reason: LINE_LOCK },
  { file: 'spend/spend-items.service.ts', member: 'create', count: 1, handling: 'pre_check', reason: 'resolveItemWrite: placement and contract readable' },
  { file: 'spend/spend-items.service.ts', member: 'createLink', count: 1, handling: 'pre_check', reason: 'assertLinesEditable' },
  { file: 'spend/spend-items.service.ts', member: 'deleteAttachment', count: 1, handling: 'pre_check', reason: 'assertLinesEditable, before the stored file is deleted' },
  { file: 'spend/spend-items.service.ts', member: 'deleteLink', count: 1, handling: 'pre_check', reason: 'assertLinesEditable' },
  { file: 'spend/spend-items.service.ts', member: 'updateLink', count: 1, handling: 'lock', reason: LINE_LOCK },
  { file: 'spend/spend-items.service.ts', member: 'uploadAttachment', count: 1, handling: 'pre_check', reason: 'assertLinesEditable, before the file is stored' },
  { file: 'spend/tasks.controller.ts', member: 'deleteTimeEntry', count: 1, handling: 'delegates', reason: 'TaskTimeEntriesService.delete' },
  { file: 'spend/tasks.controller.ts', member: 'updateTimeEntry', count: 1, handling: 'delegates', reason: 'TaskTimeEntriesService.update' },

  // contracts/
  { file: 'contracts/contract-compliance.ts', member: 'updateContractComplianceItem', count: 3, handling: 'pre_check', reason: 'ContractsService.updateCompliance checks assertContractsEditable; the contract row is locked FOR NO KEY UPDATE' },
  { file: 'contracts/contract-contacts.service.ts', member: 'detach', count: 1, handling: 'pre_check', reason: 'assertContractsEditable before the link is deleted' },
  { file: 'contracts/contract-contacts.service.ts', member: 'syncFromSupplier', count: 2, handling: 'pre_check', reason: 'assertContractsEditable before the supplier contacts are replaced; the update path checks the contract first' },
  { file: 'contracts/contract-relations.ts', member: 'replaceContractRelations', count: 3, handling: 'visible_links', reason: 'contract to lines (Budget tab): ids read under the policies (a hidden line is not found), the stored set read through spend_items under the policies, DELETE ... USING spend_items so the hidden links stay; the contract is checked modifiable first' },
  { file: 'contracts/contract-renewal.service.ts', member: 'writeRenewal', count: 1, handling: 'pre_check', reason: 'the renewal actions check assertContractsEditable before this UPDATE' },
  { file: 'contracts/contract-settings.controller.ts', member: 'update', count: 1, handling: 'reserved', reason: 'contract settings (contract-settings.controller, reserved)' },
  { file: 'contracts/contract-settings.service.ts', member: 'update', count: 1, handling: 'reserved', reason: 'contract settings are tenant settings (spec §2.7)' },
  { file: 'contracts/contracts-delete.service.ts', member: 'deleteOne', count: 4, handling: 'reserved', reason: 'delete of a contract: reserved (spec §2.7)' },
  { file: 'contracts/contracts.controller.ts', member: 'delete', count: 1, handling: 'reserved', reason: 'delete of a contract: reserved (spec §2.7)' },
  { file: 'contracts/contracts.controller.ts', member: 'update', count: 1, handling: 'delegates', reason: 'ContractsService.update (editable, placement)' },
  { file: 'contracts/contracts.service.ts', member: 'bulkReplaceContractsForCapexItem', count: 2, handling: 'visible_links', reason: 'line to contracts: the line is checked editable, the contract ids read under the policies (a hidden one is not found), the stored links read through contracts, DELETE ... USING contracts so the hidden links stay' },
  { file: 'contracts/contracts.service.ts', member: 'bulkReplaceContractsForSpendItem', count: 2, handling: 'visible_links', reason: 'line to contracts: the line is checked editable, the contract ids read under the policies (a hidden one is not found), the stored links read through contracts, DELETE ... USING contracts so the hidden links stay' },
  { file: 'contracts/contracts.service.ts', member: 'bulkReplaceLinkedCapexItems', count: 2, handling: 'visible_links', reason: 'contract to CAPEX lines: the contract is checked editable, the ids read under the line policies (a hidden line is not found), DELETE ... USING spend_items so the hidden links stay' },
  { file: 'contracts/contracts.service.ts', member: 'bulkReplaceLinkedSpendItems', count: 2, handling: 'visible_links', reason: 'contract to OPEX lines: the contract is checked editable, the ids read under the line policies (a hidden line is not found), DELETE ... USING spend_items so the hidden links stay' },
  { file: 'contracts/contracts.service.ts', member: 'create', count: 1, handling: 'pre_check', reason: 'assertContractPlacement on the new values' },
  { file: 'contracts/contracts.service.ts', member: 'createUrl', count: 1, handling: 'pre_check', reason: 'assertContractsEditable before the link is written' },
  { file: 'contracts/contracts.service.ts', member: 'deleteAttachment', count: 1, handling: 'pre_check', reason: 'assertContractsEditable before the stored file is deleted' },
  { file: 'contracts/contracts.service.ts', member: 'deleteUrl', count: 1, handling: 'pre_check', reason: 'assertContractsEditable before the link is deleted' },
  { file: 'contracts/contracts.service.ts', member: 'importCsv', count: 1, handling: 'reserved', reason: 'contract import: reserved to unscoped persons (spec §2.7, 5B); its rows go through create/update' },
  { file: 'contracts/contracts.service.ts', member: 'update', count: 1, handling: 'pre_check', reason: 'assertContractsEditable and the placement check on a change of company or place' },
  { file: 'contracts/contracts.service.ts', member: 'updateUrl', count: 1, handling: 'pre_check', reason: 'assertContractsEditable before the link is written' },
  { file: 'contracts/contracts.service.ts', member: 'uploadAttachment', count: 1, handling: 'pre_check', reason: 'assertContractsEditable before the file is stored' },

  // tasks/
  { file: 'tasks/task-activities.service.ts', member: 'create', count: 1, handling: 'not_scoped', reason: ACTIVITIES },
  { file: 'tasks/task-activities.service.ts', member: 'createImportedComment', count: 1, handling: 'not_scoped', reason: ACTIVITIES },
  { file: 'tasks/task-activities.service.ts', member: 'createUnified', count: 3, handling: 'not_scoped', reason: `${ACTIVITIES}; the status goes through writeTaskColumns (row count) and the time entry through TaskTimeEntriesService.create (pre-check), both before the activities` },
  { file: 'tasks/task-activities.service.ts', member: 'updateComment', count: 1, handling: 'not_scoped', reason: ACTIVITIES },
  { file: 'tasks/task-attachments.service.ts', member: 'cleanupOrphanedImages', count: 1, handling: 'pre_check', reason: `${TASK_ELEMENT}, before a stored file is deleted` },
  { file: 'tasks/task-attachments.service.ts', member: 'deleteAttachment', count: 1, handling: 'pre_check', reason: `${TASK_ELEMENT}, before the stored file is deleted` },
  { file: 'tasks/task-attachments.service.ts', member: 'uploadAttachment', count: 1, handling: 'pre_check', reason: `${TASK_ELEMENT}, before the file is stored` },
  { file: 'tasks/task-column-write.ts', member: 'writeTaskColumns', count: 1, handling: 'row_count', reason: 'assertTaskWritten; the services check with prepareTaskWrite first (read only, handover)' },
  { file: 'tasks/task-delete-cleanup.ts', member: 'deleteTaskActivities', count: 1, handling: 'pre_check', reason: 'TasksDeleteService.delete checks assertTaskDeletable first; deleteItemTasks is reserved' },
  { file: 'tasks/task-time-entries.service.ts', member: 'create', count: 1, handling: 'pre_check', reason: TASK_ELEMENT },
  { file: 'tasks/task-time-entries.service.ts', member: 'delete', count: 1, handling: 'pre_check', reason: TASK_ELEMENT },
  { file: 'tasks/task-time-entries.service.ts', member: 'update', count: 1, handling: 'pre_check', reason: TASK_ELEMENT },
  { file: 'tasks/tasks-csv.service.ts', member: 'handleViewerOwnerImport', count: 1, handling: 'row_count', reason: 'assertTaskWritten on the rows the UPDATE returns' },
  { file: 'tasks/tasks-delete.service.ts', member: 'bulkDelete', count: 1, handling: 'delegates', reason: 'TasksDeleteService.delete, per task (a refusal is reported as failed)' },
  { file: 'tasks/tasks-delete.service.ts', member: 'delete', count: 1, handling: 'pre_check', reason: 'assertTaskDeletable: the DELETE policy asks for the line or contract modifiable' },
  { file: 'tasks/tasks-delete.service.ts', member: 'deleteTask', count: 1, handling: 'delegates', reason: 'TasksDeleteService.delete' },
  { file: 'tasks/tasks-unified.service.ts', member: 'createForTarget', count: 2, handling: 'pre_check', reason: 'a task of a line: assertLinesEditable (placement trigger of the tasks); the project activity is not scoped' },
  { file: 'tasks/tasks-unified.service.ts', member: 'syncTaskLinks', count: 2, handling: 'pre_check', reason: TASK_ELEMENT },
];

/** Links to a line written from the other object's side, outside `spend/` and `tasks/`. */
export const DATA_ACCESS_LINK_WRITES: DataAccessWriteEntry[] = [
  { file: 'ai/mutation/ai-relation-mutation-support.service.ts', member: 'replaceSimpleRelation', count: 5, handling: 'visible_links', reason: 'Plaid relation writes (update_entity_relations): a line named is resolved under the policies (an unreadable one matches nothing, as a missing one), the links read and compared are the visible ones, the DELETE reaches the visible links only (link policies, or the EXISTS on spend_items for contract_spend_items), so the hidden links stay; from the line side the preview refuses a read-only line (assertLinesEditable) and the execution locks it (lockBudgetLine)' },
  { file: 'applications/services/applications-instances.service.ts', member: 'replaceLinkedItems', count: 2, handling: 'visible_links', reason: 'application to lines: ids read under the policies (400 when one is missing), DELETE of the visible links only' },
  { file: 'assets/services/assets-relations.service.ts', member: 'bulkReplaceLinkedCapexItems', count: 2, handling: 'visible_links', reason: 'asset to CAPEX lines: ids read under the policies, DELETE of the visible links only' },
  { file: 'assets/services/assets-relations.service.ts', member: 'bulkReplaceLinkedSpendItems', count: 2, handling: 'visible_links', reason: 'asset to OPEX lines: ids read under the policies, DELETE of the visible links only' },
  { file: 'common/relations/owned-link.ts', member: 'setOwnedLink', count: 2, handling: 'visible_links', reason: 'one link or unlink of a line from a technology (Relations tab): the line read under the policies first (400 when missing), the count of rows written decides the audit' },
  { file: 'portfolio/portfolio-requests.service.ts', member: 'bulkReplaceCapex', count: 2, handling: 'visible_links', reason: 'request to CAPEX lines: budgetLineIdsOfKind under the policies, removes only the links it read' },
  { file: 'portfolio/portfolio-requests.service.ts', member: 'bulkReplaceOpex', count: 2, handling: 'visible_links', reason: 'request to OPEX lines: budgetLineIdsOfKind under the policies, removes only the links it read' },
  { file: 'portfolio/project-budget-links.util.ts', member: 'insertProjectBudgetLinks', count: 1, handling: 'visible_links', reason: 'inserts the ids its callers read under the policies' },
  { file: 'portfolio/services/portfolio-projects-crud.service.ts', member: 'bulkReplaceCapex', count: 1, handling: 'visible_links', reason: 'project to CAPEX lines: budgetLineIdsOfKind under the policies, removes only the links it read' },
  { file: 'portfolio/services/portfolio-projects-crud.service.ts', member: 'bulkReplaceOpex', count: 1, handling: 'visible_links', reason: 'project to OPEX lines: budgetLineIdsOfKind under the policies, removes only the links it read' },
  { file: 'portfolio/services/portfolio-projects-crud.service.ts', member: 'copyCapexFromRequest', count: 1, handling: 'visible_links', reason: 'copies the request links the person reads' },
  { file: 'portfolio/services/portfolio-projects-crud.service.ts', member: 'copyOpexFromRequest', count: 1, handling: 'visible_links', reason: 'copies the request links the person reads' },
  { file: 'contacts/contact-link-attach.util.ts', member: 'attachManualContactLink', count: 1, handling: 'pre_check', reason: 'a manual contact link of a line or a contract: the caller checks the line or contract modifiable first (assertLinesEditable, assertContractsEditable)' },
  { file: 'technologies/application-conversion.service.ts', member: 'convert', count: 9, handling: 'pre_check', reason: 'the application is deleted after its links are copied: refused (403) when it has links to lines the person cannot read (data_access_hidden_count)' },
];
