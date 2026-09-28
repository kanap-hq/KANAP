import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, EntityManager } from 'typeorm';
import { SpendAmount } from './spend-amount.entity';
import { SpreadProfile } from './spread-profile.entity';
import { SpendVersion } from './spend-version.entity';
import { AuditService } from '../audit/audit.service';
import { FreezeService } from '../freeze/freeze.service';
import { addCents, formatCents } from '../common/amount';
import { writeAmountsPayload } from './amounts-write.util';
import { resolveItemYear } from './budget-column-operations';
import {
  ComputedAmountsPayload,
  isComputedPayload,
  previewComputedRound,
  recordPayloadRoundInputs,
  versionRoundInputs,
  writeComputedPayload,
} from './round-inputs.util';

type AnnualPayload = {
  kind: 'annual';
  year: number;
  totals: Partial<Record<'planned' | 'forecast' | 'committed' | 'actual' | 'expected_landing', number>>;
  spread_profile_name?: string; // default 'flat' (equal twelfths); a named SpreadProfile applies its 12 weights
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
    payload: AnnualPayload | QuarterlyPayload | MonthlyPayload | ComputedAmountsPayload,
    userId?: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const version = await mg.getRepository(SpendVersion).findOne({ where: { id: versionId } });
    if (!version) throw new NotFoundException('Version not found');

    // Spread profiles (flat, or a named SpreadProfile) are resolved by the writer; an unknown one is a 400.
    const ctx = { manager: mg, freeze: this.freeze, scope: 'opex' as const, version };
    // A computed round resolves its calendar under the tenant and replaces that one column.
    const result = isComputedPayload(payload) ? await writeComputedPayload(ctx, payload) : await writeAmountsPayload(ctx, payload);
    const { before, after } = result;

    await this.audit.log({ table: 'spend_amounts', recordId: null, action: 'update', before, after, userId }, { manager: mg });
    await recordPayloadRoundInputs({ manager: mg, scope: 'opex', version, userId: userId ?? null, audit: this.audit }, result);

    return { updated: after.length, round_inputs: await versionRoundInputs(mg, 'opex', version) };
  }

  /**
   * What a computed round of an item's year would write, compared with what is
   * stored: the year's newest version when there is one, else nothing stored.
   * Writes nothing (no version either), checks no freeze.
   */
  async computePreview(payload: unknown, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
    const { tenantId, year, version } = await resolveItemYear(mg, 'opex', body.item_id, body.year);
    return previewComputedRound({ manager: mg, scope: 'opex', version: version ?? { id: null, tenant_id: tenantId, budget_year: year } }, body);
  }

  async listByYear(versionId: string, year?: number, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const versions = mg.getRepository(SpendVersion);
    const repo = mg.getRepository(SpendAmount);
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
