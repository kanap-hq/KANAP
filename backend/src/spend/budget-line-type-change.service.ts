import { BadRequestException, ConflictException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { ItemNumberService } from '../common/item-number.service';
import { EDIT_CONFLICT_CODE } from '../common/edit-conflicts';
import { deriveStatusFromDisabledAt, isActiveAt, parseEndOfValidityInput } from '../common/status';
import { budgetColumnName, readBudgetColumns } from '../budget-columns/budget-columns.util';
import { ANALYTICS_LINK_TABLES, AnalyticsAxisInfo, axisAppliesTo, axisRequiredFor, loadAnalyticsAxes } from '../analytics/analytics-axes.util';
import { MEASURE_FREEZE_COLUMN } from './amounts-write.util';
import { lockBudgetLine, lockBudgetVersions } from './budget-locks';
import {
  auditTableOf,
  BUDGET_NATURES,
  budgetLineReference,
  LEGACY_PREFIX,
  legacyNumberOf,
  natureAnd,
  type BudgetNature,
} from './budget-nature';
import { auditLine, findBudgetLine } from './budget-line-presentation';
import { findFrozenAmounts } from './item-delete-cleanup';
import {
  ItemAnalyticsValue,
  isValueActive,
  itemAnalyticsAuditFields,
  loadItemAnalyticsValues,
  valueAppliesTo,
  writeItemAnalyticsValues,
} from './item-analytics.util';
import { resolveItemWrite } from './item-write.util';
import { readSuccessor, type LineSuccessor } from './budget-line-lineage';
import { SpendItem } from './spend-item.entity';
import { CapexItemsService, SpendItemsService } from './spend-items.service';

/**
 * "Change the type" of a budget line, OPEX to CAPEX or back (plan planning/budget-unifie.md,
 * decision U4, lot M; brief planning/budget-unifie/lot-m-brief.md). The routes
 * `GET|POST /spend-items/:id/change-type…` and `/capex-items/:id/change-type…` start from a line of
 * their own nature; `budget:member`, like the creation and the update of a line.
 *
 * Two forms, chosen by the year the change starts from (`from_year`):
 * - the line's first year (the smallest budget year of its versions), or none: the change is made
 *   **in place**. One UPDATE of `spend_items.nature` under the line's lock (`budget-nature.ts`):
 *   the line keeps its id, its BL number, its history, versions, months, allocations, links,
 *   contacts, attachments and tasks. Reaching CAPEX, a line without a CPX number gets the next one
 *   (`capex` sequence, as a CAPEX creation): the CAPEX routes and screens name a line by it. Its
 *   tasks change type (`spend_item` ↔ `capex_item`), the search trigger moves its entry.
 * - a later year N: the line ends on 31 December N-1 and keeps its years before N; a new line of
 *   the other type, created through the creation of that type (`create`, the write gate of a new
 *   line), carries the versions of N and after (one UPDATE of `spend_versions.spend_item_id`: their
 *   months, totals, round inputs and allocations follow by `version_id`). It gets the old line's
 *   contacts and its links to applications, assets, contracts, projects and requests; tasks,
 *   attachments and web links stay with the old line. The new line names the old one
 *   (`predecessor_id`, migration 1854000000000); one successor per line.
 *
 * Rules (U4): an account kept for the other type is kept in place (a soft rule: an account chosen
 * in the dialog must fit the new type); the required dimensions of the new type are asked, and
 * missing ones are tolerated in place as on any existing line (D2), required on the new line of a
 * dated change (the creation refuses a line without them); a frozen column of either type holding
 * an amount in the years that change refuses the change (409). The dialog sends the line's
 * `row_version` it read: a line changed since is refused (409 `edit_conflict`). Optional reason,
 * kept in the audit row.
 *
 * Locks (`budget-locks.ts`): the line FOR NO KEY UPDATE, then the versions that move; no tenant lock
 * (as a line delete). A writer waiting for the line finds it of the other nature, or its version on
 * a line of the other nature, and answers 404: the nature gate of every writer.
 */

export type ChangeTypeMode = 'in_place' | 'dated';

/** A frozen (year, column) of a nature where the line holds an amount: it refuses the change. */
export type ChangeTypeBlocker = { year: number; column: string; column_name: string; nature: BudgetNature };

/** A dimension the dialog asks for: required by the new type and empty, or holding a value of the old type only. */
export type ChangeTypeDimension = {
  axis_id: string;
  axis_name: string | null;
  reason: 'required' | 'value_other_type';
  /** The new line cannot do without a value (a dated change of a required dimension). */
  required: boolean;
  current: { id: string; name: string } | null;
};

export type ChangeTypeCheck = {
  id: string;
  reference: string | null;
  row_version: number;
  from_nature: BudgetNature;
  to_nature: BudgetNature;
  /** The first budget year of the line, null without a version. */
  first_year: number | null;
  last_year: number | null;
  /** The years the change may start from: the first one (in place), then the later ones (a new line). */
  years: number[];
  from_year: number | null;
  mode: ChangeTypeMode;
  /** Why no later year is offered, when none is (`successor`, `no_later_year`, `ends`, `starts`). */
  dated_refusal: string | null;
  blockers: ChangeTypeBlocker[];
  account: {
    id: string;
    account_number: number;
    account_name: string;
    /** The account suits the new type (no nature, or that one). */
    fits: boolean;
    /** A dated change copies it to the new line (fits, enabled, on the company's chart). */
    carried: boolean;
  } | null;
  dimensions: ChangeTypeDimension[];
  /** What the change carries: in place, everything; dated, the versions from the year, the links and contacts. */
  carried: {
    versions: number;
    tasks: number;
    attachments: number;
    links: number;
    contacts: number;
    applications: number;
    assets: number;
    contracts: number;
    projects: number;
    requests: number;
  };
  successor: LineSuccessor | null;
};

export type ChangeTypeResult = { id: string; reference: string | null; nature: BudgetNature; predecessor_id?: string };

/** The line read for the change: the entity (what its nature's audit shows) and its hidden columns. */
type Line = SpendItem & { legacy_number: string | null; predecessor_id: string | null };

type CurrentValue = {
  axis_id: string;
  category_id: string;
  name: string;
  applies_to: string | null;
  status: string;
  disabled_at: Date | string | null;
};

type Plan = {
  mode: ChangeTypeMode;
  fromYear: number | null;
  firstYear: number | null;
  lastYear: number | null;
  years: number[];
  datedRefusal: string | null;
  versions: Array<{ id: string; budget_year: number }>;
  blockers: ChangeTypeBlocker[];
  account: ChangeTypeCheck['account'];
  accountCarried: boolean;
  costCenterCarried: boolean;
  axes: AnalyticsAxisInfo[];
  values: CurrentValue[];
  dimensions: ChangeTypeDimension[];
  successor: ChangeTypeCheck['successor'];
};

/** The task type of each nature's lines (`tasks.related_object_type`). */
const TASK_TYPE: Record<BudgetNature, string> = { opex: 'spend_item', capex: 'capex_item' };

/** The 404 of each nature's routes, as their other routes answer it. */
const NOT_FOUND: Record<BudgetNature, string> = { opex: 'Spend item not found', capex: 'CAPEX item not found' };

/**
 * The tables a dated change copies to the new line, with the column naming the line: the links to
 * other objects and the contacts. Names come only from here.
 */
const COPIED_LINKS: ReadonlyArray<{ table: string; key: string; owner: string; columns: string[] }> = [
  { table: 'spend_item_contacts', key: 'contacts', owner: 'spend_item_id', columns: ['contact_id', 'role', 'origin'] },
  { table: 'application_spend_items', key: 'applications', owner: 'spend_item_id', columns: ['application_id'] },
  { table: 'asset_spend_items', key: 'assets', owner: 'spend_item_id', columns: ['asset_id'] },
  { table: 'contract_spend_items', key: 'contracts', owner: 'spend_item_id', columns: ['contract_id'] },
  { table: 'portfolio_project_opex', key: 'projects', owner: 'opex_id', columns: ['project_id'] },
  { table: 'portfolio_request_opex', key: 'requests', owner: 'opex_id', columns: ['request_id'] },
];

const REASON_MAX = 1000;

export function otherNature(nature: BudgetNature): BudgetNature {
  return nature === 'opex' ? 'capex' : 'opex';
}

/** The reference the screens of a nature give a line: OPX-<BL number>, or CPX-<its CPX number> (its BL number without one). */
export function natureReference(nature: BudgetNature, line: { item_number: number; legacy_number?: string | null }): string {
  return nature === 'opex'
    ? `${LEGACY_PREFIX.opex}-${line.item_number}`
    : `${LEGACY_PREFIX.capex}-${legacyNumberOf('capex', line.legacy_number) ?? line.item_number}`;
}

const natureLabel = (nature: BudgetNature) => nature.toUpperCase();

/** A whole year given as a number or a text; null for none; a 400 otherwise. */
function parseYear(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const year = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(year) || year < 1900 || year > 9999) throw new BadRequestException('from_year must be a year.');
  return year;
}

/** Midnight UTC of 1 January of the year: the instant an end of validity must reach for the line to be valid in that year. */
const yearStart = (year: number) => Date.parse(`${year}-01-01T00:00:00Z`);

@Injectable()
export class BudgetLineTypeChangeService {
  constructor(
    private readonly opexItems: SpendItemsService,
    private readonly capexItems: CapexItemsService,
    private readonly audit: AuditService,
    private readonly itemNumbers: ItemNumberService,
  ) {}

  /** What the dialog shows for a change from `from_year` (none: the first year). A read, no lock. */
  async check(nature: BudgetNature, itemId: string, query: { from_year?: unknown }, opts: { manager: EntityManager; tenantId: string }): Promise<ChangeTypeCheck> {
    const { manager, tenantId } = opts;
    const line = await readLine(manager, nature, tenantId, itemId);
    if (!line) throw new NotFoundException(NOT_FOUND[nature]);
    const plan = await this.plan(manager, nature, tenantId, line, parseYear(query?.from_year));
    const carried = await countCarried(manager, nature, tenantId, line.id, plan.mode === 'dated' ? plan.fromYear : null);
    return {
      id: line.id,
      reference: budgetLineReference(line.item_number),
      row_version: Number(line.row_version),
      from_nature: nature,
      to_nature: otherNature(nature),
      first_year: plan.firstYear,
      last_year: plan.lastYear,
      years: plan.years,
      from_year: plan.fromYear,
      mode: plan.mode,
      dated_refusal: plan.datedRefusal,
      blockers: plan.blockers,
      account: plan.account,
      dimensions: plan.dimensions,
      carried,
      successor: plan.successor,
    };
  }

  /**
   * Changes the type of the line (see the file header). `body`: `row_version` (required, the one
   * the dialog read), `from_year`, `account_id`, `analytics_values`, `reason`.
   */
  async change(
    nature: BudgetNature,
    itemId: string,
    body: unknown,
    userId: string | null,
    opts: { manager: EntityManager; tenantId: string },
  ): Promise<ChangeTypeResult> {
    const { manager, tenantId } = opts;
    const input = parseChangeBody(body);
    // Lock order (`budget-locks.ts`): the line first. A line of the other nature is not locked: 404.
    if (!(await lockBudgetLine(manager, nature, tenantId, itemId))) throw new NotFoundException(NOT_FOUND[nature]);
    const line = await readLine(manager, nature, tenantId, itemId);
    if (!line) throw new NotFoundException(NOT_FOUND[nature]);
    if (Number(line.row_version) !== input.rowVersion) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        code: EDIT_CONFLICT_CODE,
        message: 'Someone changed this line since the dialog opened. Close the dialog and try again.',
        conflicts: [],
        row_version: Number(line.row_version),
      });
    }
    const plan = await this.plan(manager, nature, tenantId, line, input.fromYear);
    if (plan.blockers.length > 0) {
      const [first] = plan.blockers;
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        code: 'budget_frozen',
        message: `This line has amounts in ${first.column_name} ${first.year}, a frozen ${natureLabel(first.nature)} column. `
          + 'Unfreeze the column first, or change the type from a later year.',
        blockers: plan.blockers,
      });
    }
    return plan.mode === 'in_place'
      ? this.changeInPlace(manager, nature, tenantId, line, plan, input, userId)
      : this.changeFromYear(manager, nature, tenantId, line, plan, input, userId);
  }

  /** The analysis shared by the check and the change: years, mode, freezes, account, dimensions, successor. */
  private async plan(manager: EntityManager, nature: BudgetNature, tenantId: string, line: Line, requested: number | null): Promise<Plan> {
    const target = otherNature(nature);
    // The line was found with its nature: its children are read by its id (`budget-nature.ts`).
    const versions: Array<{ id: string; budget_year: number }> = (await manager.query(
      `SELECT id, budget_year FROM spend_versions WHERE tenant_id = $1 AND spend_item_id = $2 ORDER BY budget_year`,
      [tenantId, line.id],
    )).map((row: { id: string; budget_year: number | string }) => ({ id: row.id, budget_year: Number(row.budget_year) }));
    const firstYear = versions[0]?.budget_year ?? null;
    const lastYear = versions[versions.length - 1]?.budget_year ?? null;
    const successor = await readSuccessor(manager, tenantId, line.id);

    // A later year needs a year before it to keep (the line starts before), and something to carry
    // (a version from it, the line still valid on 1 January); one successor per line.
    const effectiveStart = String(line.effective_start ?? '').slice(0, 10);
    const endsAt = line.disabled_at ? new Date(line.disabled_at).getTime() : null;
    const refusal = (year: number): string | null => {
      if (successor) return `This line is already replaced by ${successor.reference}. Change the type of ${successor.reference} instead.`;
      if (lastYear === null || year > lastYear) return `This line has no budget from ${year}: there is nothing to carry.`;
      if (endsAt !== null && endsAt < yearStart(year)) return `This line ends before ${year}: there is nothing to carry.`;
      if (effectiveStart >= `${year}-01-01`) return `This line starts in ${effectiveStart.slice(0, 4)}: change its type from its first year.`;
      return null;
    };
    const later: number[] = [];
    if (firstYear !== null && lastYear !== null) {
      for (let year = firstYear + 1; year <= lastYear; year += 1) if (!refusal(year)) later.push(year);
    }
    const years = firstYear === null ? [] : [firstYear, ...later];
    // Why the dialog offers no later year (the first one that fails says it).
    const datedRefusal = later.length > 0 || firstYear === null ? null
      : successor ? 'successor'
        : lastYear === firstYear ? 'no_later_year'
          : endsAt !== null && endsAt < yearStart(firstYear + 1) ? 'ends'
            : effectiveStart >= `${firstYear + 1}-01-01` ? 'starts'
              : 'no_later_year';

    let mode: ChangeTypeMode = 'in_place';
    let fromYear: number | null = firstYear;
    if (requested !== null && requested !== firstYear) {
      if (firstYear === null) throw new BadRequestException('This line has no budget yet: its type changes in place. Leave the year empty.');
      if (requested < firstYear) throw new BadRequestException(`The first year of this line is ${firstYear}. Choose ${years.join(', ')}.`);
      const why = refusal(requested);
      if (why) throw new BadRequestException(why);
      mode = 'dated';
      fromYear = requested;
    }

    const columns = await readBudgetColumns(manager, tenantId);
    const blockers = (await findFrozenAmounts(manager, tenantId, line.id, { scopes: BUDGET_NATURES, fromYear: mode === 'dated' ? fromYear : null }))
      .map((hit) => ({ year: hit.budget_year, column: MEASURE_FREEZE_COLUMN[hit.measure], column_name: budgetColumnName(columns, hit.measure), nature: hit.scope }));

    const { account, accountCarried, costCenterCarried } = await readAccountAndCostCenter(manager, tenantId, line, target);

    const axes = await loadAnalyticsAxes(manager, tenantId);
    const values: CurrentValue[] = await manager.query(
      `SELECT v.axis_id::text AS axis_id, v.category_id::text AS category_id, c.name, c.applies_to, c.status::text AS status, c.disabled_at
         FROM ${ANALYTICS_LINK_TABLES[nature]} v
         JOIN analytics_categories c ON c.tenant_id = v.tenant_id AND c.id = v.category_id
        WHERE v.tenant_id = $1 AND v.item_id = $2`,
      [tenantId, line.id],
    );
    const byAxis = new Map(values.map((value) => [value.axis_id, value]));
    const dimensions: ChangeTypeDimension[] = [];
    for (const axis of axes) {
      if (axis.status !== 'enabled' || !axisAppliesTo(axis, target)) continue;
      const current = byAxis.get(axis.id) ?? null;
      const required = axisRequiredFor(axis, target);
      const kept = !!current && copiedValue(axis, current, target);
      if (current && !valueAppliesTo(current, target)) {
        dimensions.push({ axis_id: axis.id, axis_name: axis.name, reason: 'value_other_type', required: required && mode === 'dated', current: { id: current.category_id, name: current.name } });
      } else if (required && (mode === 'dated' ? !kept : !current)) {
        dimensions.push({ axis_id: axis.id, axis_name: axis.name, reason: 'required', required: mode === 'dated', current: null });
      }
    }

    return {
      mode, fromYear, firstYear, lastYear, years, datedRefusal, versions, blockers,
      account, accountCarried, costCenterCarried, axes, values, dimensions, successor,
    };
  }

  /** The change in place (see the file header). */
  private async changeInPlace(
    manager: EntityManager,
    nature: BudgetNature,
    tenantId: string,
    line: Line,
    plan: Plan,
    input: ChangeInput,
    userId: string | null,
  ): Promise<ChangeTypeResult> {
    const target = otherNature(nature);
    const analyticsBefore = (await loadItemAnalyticsValues(manager, nature, tenantId, [line.id])).get(line.id) ?? [];
    // An account or values given in the dialog pass the write gate of the new type, against the
    // line as it is (`item-write.util.ts`): an account must suit it, a value must apply to it. Nothing
    // given, nothing checked: the line keeps its account and values (the screens flag what is off).
    const changes: Record<string, unknown> = {};
    if (input.accountId !== undefined && input.accountId !== (line.account_id ?? null)) changes.account_id = input.accountId;
    if (input.analyticsValues !== undefined) changes.analytics_values = input.analyticsValues;
    const write = Object.keys(changes).length > 0
      ? await resolveItemWrite(manager, target, changes, line, 'columns')
      : { values: {} as Record<string, unknown>, analytics: [] };
    if ('account_id' in write.values && !write.values.account_id) throw new BadRequestException('Choose an account, or leave the field as it is.');

    // Reaching CAPEX, the line takes a CPX number unless it holds one (a line that was CAPEX before).
    const legacy = target === 'capex' && legacyNumberOf('capex', line.legacy_number) === null
      ? `${LEGACY_PREFIX.capex}-${await this.itemNumbers.nextItemNumber('capex', tenantId, manager)}`
      : line.legacy_number;
    const params: unknown[] = [tenantId, line.id, target, legacy, new Date()];
    const account = 'account_id' in write.values ? `, account_id = $${params.push(write.values.account_id)}` : '';
    await manager.query(
      `UPDATE spend_items SET nature = $3, legacy_number = $4, updated_at = $5${account}
        WHERE tenant_id = $1 AND id = $2${natureAnd(null, nature)}`,
      params,
    );
    await writeItemAnalyticsValues(manager, target, tenantId, line.id, write.analytics);
    // The tasks follow their line (every reader joins their type with the line's nature). No
    // activity entry: the task itself did not change.
    await manager.query(
      `UPDATE tasks SET related_object_type = $4 WHERE tenant_id = $1 AND related_object_type = $3 AND related_object_id = $2`,
      [tenantId, line.id, TASK_TYPE[nature], TASK_TYPE[target]],
    );

    const after = (await readLine(manager, target, tenantId, line.id))!;
    const analyticsAfter = (await loadItemAnalyticsValues(manager, target, tenantId, [line.id])).get(line.id) ?? [];
    // One row under the label of the new type, both sides in its shape: the readers of that label
    // (who changed the line, edit conflicts) compare its fields; `row_version` differs on each side.
    await this.audit.log({
      table: auditTableOf(target, 'spend_items'),
      recordId: line.id,
      action: 'update',
      before: auditSnapshot(target, line, analyticsBefore),
      after: {
        ...auditSnapshot(target, after, analyticsAfter),
        ...changeFields(nature, target, plan.fromYear, input.reason, natureReference(nature, line), natureReference(target, after)),
      },
      userId,
    }, { manager });
    return { id: line.id, reference: budgetLineReference(after.item_number), nature: target };
  }

  /** The change from a later year (see the file header). */
  private async changeFromYear(
    manager: EntityManager,
    nature: BudgetNature,
    tenantId: string,
    line: Line,
    plan: Plan,
    input: ChangeInput,
    userId: string | null,
  ): Promise<ChangeTypeResult> {
    const target = otherNature(nature);
    const year = plan.fromYear!;
    // The versions that move, locked after the line (lock order); every writer of a version takes
    // its line first, so they are the versions read above.
    const moving = plan.versions.filter((version) => version.budget_year >= year).map((version) => version.id);
    await lockBudgetVersions(manager, nature, tenantId, moving);
    const analyticsBefore = (await loadItemAnalyticsValues(manager, nature, tenantId, [line.id])).get(line.id) ?? [];

    // The new line, through the creation of its type: its write gate checks what is copied and what
    // the dialog gave (a required dimension missing, an account of the other type: 400).
    const values: Record<string, string> = {};
    const axisById = new Map(plan.axes.map((axis) => [axis.id, axis]));
    for (const value of plan.values) {
      const axis = axisById.get(value.axis_id);
      if (axis && copiedValue(axis, value, target)) values[value.axis_id] = value.category_id;
    }
    for (const [axisId, valueId] of Object.entries(input.analyticsValues ?? {})) {
      if (valueId) values[axisId] = valueId;
      else delete values[axisId];
    }
    const created = await this.items(target).create({
      product_name: line.product_name,
      ...(target === 'opex' ? { description: line.description } : {}),
      paying_company_id: line.paying_company_id,
      supplier_id: line.supplier_id,
      account_id: input.accountId !== undefined ? input.accountId : plan.accountCarried ? line.account_id : null,
      cost_center_id: plan.costCenterCarried ? line.cost_center_id : null,
      currency: line.currency,
      effective_start: `${year}-01-01`,
      // The new line ends when the old one did (it is valid on 1 January of the year, see `plan`).
      ...(line.disabled_at ? { disabled_at: new Date(line.disabled_at).toISOString() } : {}),
      owner_it_id: line.owner_it_id,
      owner_business_id: line.owner_business_id,
      project_id: line.project_id,
      run_build: line.run_build,
      notes: line.notes,
      analytics_values: values,
    }, userId ?? undefined, { manager, fields: 'columns', source: 'change_type' });
    const newId = String(created.id);

    // The versions of the year and after, with everything under them (by `version_id`).
    await manager.query(
      `UPDATE spend_versions SET spend_item_id = $3 WHERE tenant_id = $1 AND spend_item_id = $2 AND budget_year >= $4`,
      [tenantId, line.id, newId, year],
    );
    // The old line ends on 31 December of the year before (a bare day is noon UTC, `common/status.ts`).
    const now = new Date();
    const end = parseEndOfValidityInput(`${year - 1}-12-31`)!;
    await manager.query(
      `UPDATE spend_items SET disabled_at = $3, status = $4, updated_at = $5 WHERE tenant_id = $1 AND id = $2${natureAnd(null, nature)}`,
      [tenantId, line.id, end, deriveStatusFromDisabledAt(end, now), now],
    );
    // Its contacts and links to other objects; tasks, attachments and web links stay with it.
    const copied: Record<string, number> = {};
    for (const link of COPIED_LINKS) {
      const columns = link.columns.join(', ');
      const [{ n }]: Array<{ n: number }> = await manager.query(
        `WITH copied AS (
           INSERT INTO ${link.table} (tenant_id, ${link.owner}, ${columns})
           SELECT tenant_id, $3, ${columns} FROM ${link.table} WHERE tenant_id = $1 AND ${link.owner} = $2
           ON CONFLICT DO NOTHING
           RETURNING 1
         ) SELECT count(*)::int AS n FROM copied`,
        [tenantId, line.id, newId],
      );
      copied[link.key] = n;
    }

    // The new line names the one it continues; a CAPEX line's description is not written by its
    // creation (the CAPEX API names its title so): it is kept here for the unified screens (lot U).
    const createdLine = (await readLine(manager, target, tenantId, newId))!;
    const analyticsNew = (await loadItemAnalyticsValues(manager, target, tenantId, [newId])).get(newId) ?? [];
    await manager.query(
      `UPDATE spend_items SET predecessor_id = $3${target === 'capex' ? ', description = $4' : ''}
        WHERE tenant_id = $1 AND id = $2${natureAnd(null, target)}`,
      target === 'capex' ? [tenantId, newId, line.id, line.description] : [tenantId, newId, line.id],
    );
    const newLine = (await readLine(manager, target, tenantId, newId))!;
    const oldLine = (await readLine(manager, nature, tenantId, line.id))!;

    const fromReference = natureReference(nature, line);
    const toReference = natureReference(target, newLine);
    await this.audit.log({
      table: auditTableOf(nature, 'spend_items'),
      recordId: line.id,
      action: 'update',
      before: auditSnapshot(nature, line, analyticsBefore),
      after: {
        ...auditSnapshot(nature, oldLine, analyticsBefore),
        ...changeFields(nature, target, year, input.reason, fromReference, toReference),
        successor_id: newId,
      },
      userId,
    }, { manager });
    await this.audit.log({
      table: auditTableOf(target, 'spend_items'),
      recordId: newId,
      action: 'update',
      before: auditSnapshot(target, createdLine, analyticsNew),
      after: {
        ...auditSnapshot(target, newLine, analyticsNew),
        ...changeFields(nature, target, year, input.reason, fromReference, toReference),
        predecessor_id: line.id,
        copied,
      },
      userId,
    }, { manager });
    return { id: newId, reference: budgetLineReference(newLine.item_number), nature: target, predecessor_id: line.id };
  }

  private items(nature: BudgetNature): SpendItemsService {
    return nature === 'opex' ? this.opexItems : this.capexItems;
  }
}

type ChangeInput = {
  rowVersion: number;
  fromYear: number | null;
  /** Undefined: not given (the line keeps its account); null is refused in place, empty on a new line. */
  accountId: string | null | undefined;
  analyticsValues: Record<string, string | null> | undefined;
  reason: string | null;
};

function parseChangeBody(body: unknown): ChangeInput {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const rowVersion = Number(input.row_version);
  if (input.row_version === undefined || input.row_version === null || input.row_version === '' || !Number.isInteger(rowVersion)) {
    throw new BadRequestException('row_version is required: the version of the line the dialog read.');
  }
  let accountId: string | null | undefined;
  if (input.account_id !== undefined) {
    if (input.account_id !== null && typeof input.account_id !== 'string') throw new BadRequestException('Account not found.');
    accountId = input.account_id ? String(input.account_id) : null;
  }
  let analyticsValues: Record<string, string | null> | undefined;
  if (input.analytics_values !== undefined && input.analytics_values !== null) {
    const raw = input.analytics_values;
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('Analytics values must map each dimension to a value or null.');
    analyticsValues = {};
    for (const [axisId, valueId] of Object.entries(raw as Record<string, unknown>)) {
      if (valueId === undefined) continue;
      if (valueId !== null && typeof valueId !== 'string') throw new BadRequestException('Analytics value not found.');
      analyticsValues[axisId] = valueId ? String(valueId) : null;
    }
  }
  let reason: string | null = null;
  if (input.reason !== undefined && input.reason !== null) {
    if (typeof input.reason !== 'string') throw new BadRequestException('The reason must be a text.');
    reason = input.reason.trim() || null;
    if (reason && reason.length > REASON_MAX) throw new BadRequestException(`The reason is too long: ${REASON_MAX} characters at most.`);
  }
  return { rowVersion, fromYear: parseYear(input.from_year), accountId, analyticsValues, reason };
}

/** The line of `nature` with its hidden columns (legacy number, predecessor); null when missing or of the other nature. */
async function readLine(manager: EntityManager, nature: BudgetNature, tenantId: string, itemId: string): Promise<Line | null> {
  const line = await findBudgetLine(manager, nature, tenantId, itemId);
  if (!line) return null;
  const [hidden]: Array<{ legacy_number: string | null; predecessor_id: string | null }> = await manager.query(
    `SELECT legacy_number, predecessor_id FROM spend_items WHERE tenant_id = $1 AND id = $2${natureAnd(null, nature)}`,
    [tenantId, itemId],
  );
  return { ...line, legacy_number: hidden?.legacy_number ?? null, predecessor_id: hidden?.predecessor_id ?? null } as Line;
}

/** The line's account as the dialog shows it, and whether a dated change copies its account and cost center. */
async function readAccountAndCostCenter(manager: EntityManager, tenantId: string, line: Line, target: BudgetNature) {
  const [row]: Array<{
    account_id: string | null; account_number: number | null; account_name: string | null; account_nature: string | null;
    account_status: string | null; account_disabled_at: Date | null; account_coa: string | null; company_coa: string | null;
    center_kind: string | null; center_status: string | null; center_disabled_at: Date | null;
  }> = await manager.query(
    `SELECT a.id AS account_id, a.account_number, a.account_name, a.nature AS account_nature, a.status::text AS account_status,
            a.disabled_at AS account_disabled_at, a.coa_id::text AS account_coa,
            (SELECT c.coa_id::text FROM companies c WHERE c.tenant_id = $1 AND c.id = $3) AS company_coa,
            cc.kind::text AS center_kind, cc.status::text AS center_status, cc.disabled_at AS center_disabled_at
       FROM (SELECT 1) one
       LEFT JOIN accounts a ON a.tenant_id = $1 AND a.id = $2
       LEFT JOIN cost_centers cc ON cc.tenant_id = $1 AND cc.id = $4`,
    [tenantId, line.account_id ?? null, line.paying_company_id ?? null, line.cost_center_id ?? null],
  );
  const fits = !!row?.account_id && (!row.account_nature || row.account_nature === target);
  const active = !!row?.account_id && row.account_status !== 'disabled' && isActiveAt(row.account_disabled_at);
  const onChart = !row?.account_coa || !row.company_coa || row.account_coa === row.company_coa;
  const accountCarried = fits && active && onChart;
  const account = row?.account_id
    ? { id: row.account_id, account_number: Number(row.account_number), account_name: String(row.account_name ?? ''), fits, carried: accountCarried }
    : null;
  const costCenterCarried = !!line.cost_center_id && row?.center_kind === 'cost_center'
    && row.center_status !== 'disabled' && isActiveAt(row.center_disabled_at);
  return { account, accountCarried, costCenterCarried };
}

/** A value a new line of `target` may receive from the old one: on an enabled dimension of that type, a value of that type, enabled. */
function copiedValue(axis: AnalyticsAxisInfo, value: CurrentValue, target: BudgetNature): boolean {
  return axis.status === 'enabled' && axisAppliesTo(axis, target) && valueAppliesTo(value, target) && isValueActive(value);
}

/** What the change moves, for the dialog: in place (`fromYear` null), everything; dated, the versions from the year. */
async function countCarried(manager: EntityManager, nature: BudgetNature, tenantId: string, itemId: string, fromYear: number | null): Promise<ChangeTypeCheck['carried']> {
  const [row] = await manager.query(
    `SELECT (SELECT count(*) FROM spend_versions WHERE tenant_id = $1 AND spend_item_id = $2 AND ($3::int IS NULL OR budget_year >= $3::int))::int AS versions,
            (SELECT count(*) FROM tasks WHERE tenant_id = $1 AND related_object_type = $4 AND related_object_id = $2)::int AS tasks,
            (SELECT count(*) FROM spend_attachments WHERE tenant_id = $1 AND spend_item_id = $2)::int AS attachments,
            (SELECT count(*) FROM spend_links WHERE tenant_id = $1 AND spend_item_id = $2)::int AS links,
            (SELECT count(*) FROM spend_item_contacts WHERE tenant_id = $1 AND spend_item_id = $2)::int AS contacts,
            (SELECT count(*) FROM application_spend_items WHERE tenant_id = $1 AND spend_item_id = $2)::int AS applications,
            (SELECT count(*) FROM asset_spend_items WHERE tenant_id = $1 AND spend_item_id = $2)::int AS assets,
            (SELECT count(*) FROM contract_spend_items WHERE tenant_id = $1 AND spend_item_id = $2)::int AS contracts,
            (SELECT count(*) FROM portfolio_project_opex WHERE tenant_id = $1 AND opex_id = $2)::int AS projects,
            (SELECT count(*) FROM portfolio_request_opex WHERE tenant_id = $1 AND opex_id = $2)::int AS requests`,
    [tenantId, itemId, fromYear, TASK_TYPE[nature]],
  );
  return row;
}

/** A line as the audit rows of `nature` record it, with its analytics values. */
function auditSnapshot(nature: BudgetNature, line: Line, analytics: ItemAnalyticsValue[]) {
  const { predecessor_id: _predecessor, ...rest } = line;
  void _predecessor;
  return { ...auditLine(nature, rest), ...itemAnalyticsAuditFields(analytics) };
}

/**
 * What the audit row of a change says beyond the line's fields. Never a key `year` or
 * `destinationYear`: the line's meta reads those as a column operation of a version's year
 * (`item-meta.ts`).
 */
function changeFields(from: BudgetNature, to: BudgetNature, fromYear: number | null, reason: string | null, fromReference: string, toReference: string) {
  return {
    operation: 'change_type',
    from_nature: from,
    to_nature: to,
    from_year: fromYear,
    from_reference: fromReference,
    to_reference: toReference,
    reason,
  };
}
