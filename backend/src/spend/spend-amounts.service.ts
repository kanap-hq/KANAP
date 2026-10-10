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
import { currentTenantId } from './budget-column-operations';
import {
  isLinesPayload,
  isLinesResult,
  LinesAmountsPayload,
  recordPayloadRoundInputs,
  versionRoundInputs,
  writeLinesPayload,
} from './round-inputs.util';

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

@Injectable()
export class SpendAmountsService {
  constructor(
    @InjectRepository(SpendAmount) private readonly repo: Repository<SpendAmount>,
    @InjectRepository(SpreadProfile) private readonly profiles: Repository<SpreadProfile>,
    @InjectRepository(SpendVersion) private readonly versions: Repository<SpendVersion>,
    private readonly audit: AuditService,
    private readonly freeze: FreezeService,
  ) {}

  async bulkUpsert(
    versionId: string,
    payload: AnnualPayload | QuarterlyPayload | MonthlyPayload | LinesAmountsPayload,
    userId?: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    // Lock order (`budget-locks.ts`): the line, then the version, before any month; read again under the locks.
    const tenantId = await currentTenantId(mg);
    if (!(await lockVersionWithLine(mg, 'opex', tenantId, versionId))) throw new NotFoundException('Version not found');
    const version = await mg.getRepository(SpendVersion).findOne({ where: { id: versionId, tenant_id: tenantId } });
    if (!version) throw new NotFoundException('Version not found');

    // Spread profiles (flat, or a named SpreadProfile) are resolved by the writer; an unknown one is a 400.
    // With a base (the budget tab), a cell or column someone else changed since the screen read it
    // refuses the request with 409 edit_conflict before anything is written (`budget-edit-conflicts.ts`).
    const beforeWrite = budgetBaseCheck(mg, 'opex', version, (payload as { base?: unknown } | null)?.base);
    const ctx = { manager: mg, freeze: this.freeze, scope: 'opex' as const, version, beforeWrite };
    // Lines resolve their calendars under the tenant and replace the months of the columns they name.
    const result = isLinesPayload(payload) ? await writeLinesPayload(ctx, payload) : await writeAmountsPayload(ctx, payload);
    const { before, after } = result;

    // Removing the lines writes no amount: nothing to audit here.
    if (after.length > 0) {
      // Keyed by the version: the budget tab's conflicts read who changed a column from here.
      await this.audit.log({ table: 'spend_amounts', recordId: version.id, action: 'update', before, after, userId }, { manager: mg });
    }
    await recordPayloadRoundInputs({ manager: mg, scope: 'opex', version, userId: userId ?? null, audit: this.audit }, result);

    const round_inputs = await versionRoundInputs(mg, 'opex', version);
    // A lines write also says when a disabled calendar was kept.
    // The year's months as stored now: the budget tab's base for the user's next edit of the columns written.
    const items = await readYearAmounts(mg, 'opex', version);
    // The version's counter after this write: the tab's own save is not "changed elsewhere" (lot 3G).
    const budget_rev = await readVersionBudgetRev(mg, 'opex', version);
    return isLinesResult(result)
      ? { updated: after.length, round_inputs, items, budget_rev, warnings: result.lines.warnings }
      : { updated: after.length, round_inputs, items, budget_rev };
  }

  async listByYear(versionId: string, year?: number, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const versions = mg.getRepository(SpendVersion);
    const repo = mg.getRepository(SpendAmount);
    // A version of a line of another nature is not found (`budget-nature.ts`); a missing one reads as before.
    await budgetLineOfChild(mg, 'opex', 'version', await currentTenantId(mg), versionId, 'Version not found');
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

    const round_inputs = version ? await versionRoundInputs(mg, 'opex', version) : [];
    return { items, totals: roundedTotals, year: targetYear, round_inputs };
  }
}
