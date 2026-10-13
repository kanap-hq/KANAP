import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, EntityManager } from 'typeorm';
import { SpendAmount } from './spend-amount.entity';
import { SpreadProfile } from './spread-profile.entity';
import { SpendVersion } from './spend-version.entity';
import { AuditService } from '../audit/audit.service';
import { FreezeService } from '../freeze/freeze.service';
import { addCents, formatCents } from '../common/amount';
import { readVersionBudgetRev, readYearAmounts, writeAmountsPayload } from './amounts-write.util';
import { budgetBaseCheck } from './budget-edit-conflicts';
import { budgetLineOfChild, lockVersionWithLine } from './budget-locks';
import { auditTableOf, type BudgetNature } from './budget-nature';
import { currentTenantId } from './budget-column-operations';
import {
  isLinesPayload,
  isLinesResult,
  LinesAmountsPayload,
  recordPayloadRoundInputs,
  RoundInputsContext,
  versionRoundInputs,
  writeLinesPayload,
} from './round-inputs.util';
import { isRestorePayload, isRestoreResult, recordRestore, RestoreAmountsPayload, writeRestorePayload } from './budget-column-restore';
import { CopyAmountsPayload, isCopyPayload, isCopyResult, recordColumnCopy, writeCopyPayload } from './budget-line-copy';

type AnnualPayload = {
  kind: 'annual';
  year: number;
  totals: Partial<Record<'planned' | 'forecast' | 'committed' | 'actual' | 'expected_landing', number>>;
  spread_profile_name?: string; // default 'flat' (equal twelfths); a named SpreadProfile applies its 12 weights
  also_measures?: Array<'planned' | 'forecast' | 'committed' | 'actual' | 'expected_landing'>; // spread the same way from their stored totals
  period_start?: string; // with period_end, 'YYYY-MM-DD' in the year; both omitted = the whole year
  period_end?: string;
};

type QuarterlyPayload = {
  kind: 'quarterly';
  year: number;
  measure: 'planned' | 'forecast' | 'committed' | 'actual' | 'expected_landing';
  Q1?: number; Q2?: number; Q3?: number; Q4?: number;
  spread_profile_name?: string; // '4-4-5' => 445 distribution; unset, 'equal' or 'flat' => equal thirds
  period_start?: string;
  period_end?: string;
};

type MonthlyPayload = {
  kind: 'monthly';
  year: number;
  months: Array<{
    period: string; // 'YYYY-MM-01'
    planned?: number;
    forecast?: number;
    committed?: number;
    actual?: number;
    expected_landing?: number;
  }>;
};

/** The months of the versions of the lines of one nature (`SpendAmountsService`, `CapexAmountsService`). */
@Injectable()
export class SpendAmountsService {
  /** The nature of the lines whose versions this service writes. */
  protected readonly nature: BudgetNature = 'opex';

  constructor(
    @InjectRepository(SpendAmount) private readonly repo: Repository<SpendAmount>,
    @InjectRepository(SpreadProfile) private readonly profiles: Repository<SpreadProfile>,
    @InjectRepository(SpendVersion) private readonly versions: Repository<SpendVersion>,
    private readonly audit: AuditService,
    private readonly freeze: FreezeService,
  ) {}

  /**
   * Every write of the budget tab, the API and the AI (`annual`, `quarterly`, `monthly`, `lines`).
   * `restore` (`budget-column-restore.ts`) and `copy` (`budget-line-copy.ts`) are the budget tab's
   * own; the AI never sends them (its payloads are rebuilt from annual, quarterly and monthly).
   */
  async bulkUpsert(
    versionId: string,
    payload: AnnualPayload | QuarterlyPayload | MonthlyPayload | LinesAmountsPayload | RestoreAmountsPayload | CopyAmountsPayload,
    userId?: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    // Lock order (`budget-locks.ts`): the line, then the version, before any month; read again under the locks.
    const tenantId = await currentTenantId(mg);
    const line = await lockVersionWithLine(mg, this.nature, tenantId, versionId);
    if (!line) throw new NotFoundException('Version not found');
    const version = await mg.getRepository(SpendVersion).findOne({ where: { id: versionId, tenant_id: tenantId } });
    if (!version) throw new NotFoundException('Version not found');

    // Spread profiles (flat, or a named SpreadProfile) are resolved by the writer; an unknown one is a 400.
    // With a base (the budget tab), a cell or column someone else changed since the screen read it
    // refuses the request with 409 edit_conflict before anything is written (`budget-edit-conflicts.ts`).
    const beforeWrite = budgetBaseCheck(mg, this.nature, version, (payload as { base?: unknown } | null)?.base);
    const ctx = { manager: mg, freeze: this.freeze, scope: this.nature, version, beforeWrite };
    // Lines resolve their calendars under the tenant and replace the months of the columns they name.
    const result = isLinesPayload(payload) ? await writeLinesPayload(ctx, payload)
      : isRestorePayload(payload) ? await writeRestorePayload(ctx, payload)
        : isCopyPayload(payload) ? await writeCopyPayload(ctx, line.itemId, payload)
          : await writeAmountsPayload(ctx, payload);
    const { before, after } = result;

    // Removing the lines writes no amount: nothing to audit here.
    if (after.length > 0) {
      // Keyed by the version: the budget tab's conflicts read who changed a column from here.
      const action = isRestoreResult(result) ? 'restored' : 'update';
      await this.audit.log({ table: auditTableOf(this.nature, 'spend_amounts'), recordId: version.id, action, before, after, userId }, { manager: mg });
    }
    const rctx: RoundInputsContext = { manager: mg, scope: this.nature, version, userId: userId ?? null, audit: this.audit };
    if (isRestoreResult(result)) await recordRestore(rctx, result.restore);
    else if (isCopyResult(result)) await recordColumnCopy(rctx, result.copy);
    else await recordPayloadRoundInputs(rctx, result);

    const round_inputs = await versionRoundInputs(mg, this.nature, version);
    // A lines write also says when a disabled calendar was kept.
    // The year's months as stored now: the budget tab's base for the user's next edit of the columns written.
    const items = await readYearAmounts(mg, this.nature, version);
    // The version's counter after this write: the tab's own save is not "changed elsewhere" (lot 3G).
    const budget_rev = await readVersionBudgetRev(mg, this.nature, version);
    if (isCopyResult(result)) {
      const { prorated, fromLines, calendarIssues } = result.copy;
      // What the copy did beyond the months: source months outside the line's dates left out, the
      // lines followed, disabled calendars still used.
      return { updated: after.length, round_inputs, items, budget_rev, copy: { prorated, from_lines: fromLines, calendar_issues: calendarIssues } };
    }
    return !isRestoreResult(result) && isLinesResult(result)
      ? { updated: after.length, round_inputs, items, budget_rev, warnings: result.lines.warnings }
      : { updated: after.length, round_inputs, items, budget_rev };
  }

  async listByYear(versionId: string, year?: number, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const versions = mg.getRepository(SpendVersion);
    const repo = mg.getRepository(SpendAmount);
    // A version of a line of another nature is not found (`budget-nature.ts`); a missing one reads as before.
    await budgetLineOfChild(mg, this.nature, 'version', await currentTenantId(mg), versionId, 'Version not found');
    const version = await versions.findOne({ where: { id: versionId } });
    let targetYear = year;
    if (!targetYear) {
      if (!version) throw new NotFoundException('Version not found');
      targetYear = (version as any).budget_year as number;
    }
    const start = `${targetYear}-01-01`;
    const end = `${targetYear}-12-31`;
    const items = await repo.find({
      where: { version_id: versionId, period: Between(start, end) as any } as any,
      order: { period: 'ASC' as any },
    });

    const totals = items.reduce(
      (acc, it: any) => {
        acc.planned = addCents(acc.planned, it.planned);
        acc.actual = addCents(acc.actual, it.actual);
        acc.expected_landing = addCents(acc.expected_landing, it.expected_landing);
        acc.committed = addCents(acc.committed, it.committed);
        acc.forecast = addCents(acc.forecast, it.forecast);
        return acc;
      },
      { planned: 0n, actual: 0n, expected_landing: 0n, committed: 0n, forecast: 0n }
    );

    const roundedTotals = {
      planned: Number(formatCents(totals.planned)),
      actual: Number(formatCents(totals.actual)),
      expected_landing: Number(formatCents(totals.expected_landing)),
      committed: Number(formatCents(totals.committed)),
      forecast: Number(formatCents(totals.forecast)),
    };

    const round_inputs = version ? await versionRoundInputs(mg, this.nature, version) : [];
    return { items, totals: roundedTotals, year: targetYear, round_inputs };
  }
}

/** The months of the CAPEX lines' versions (`/capex-versions/:id/amounts*`, aliases retained until their removal in Z2). */
@Injectable()
export class CapexAmountsService extends SpendAmountsService {
  protected override readonly nature: BudgetNature = 'capex';
}
