import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, EntityManager } from 'typeorm';
import { CapexAmount } from './capex-amount.entity';
import { CapexVersion } from './capex-version.entity';
import { AuditService } from '../audit/audit.service';
import { FreezeService } from '../freeze/freeze.service';
import { addCents, formatCents } from '../common/amount';
import { writeAmountsPayload } from '../spend/amounts-write.util';
import { recordPayloadRoundInputs, versionRoundInputs } from '../spend/round-inputs.util';

type AnnualPayload = {
  kind: 'annual';
  year: number;
  totals: Partial<Record<'planned' | 'forecast' | 'committed' | 'actual' | 'expected_landing', number>>;
  spread_profile_name?: string; // default 'flat'; a named SpreadProfile applies its 12 weights
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
export class CapexAmountsService {
  constructor(
    @InjectRepository(CapexAmount) private readonly repo: Repository<CapexAmount>,
    @InjectRepository(CapexVersion) private readonly versions: Repository<CapexVersion>,
    private readonly audit: AuditService,
    private readonly freeze: FreezeService,
  ) {}

  async bulkUpsert(versionId: string, payload: AnnualPayload | QuarterlyPayload | MonthlyPayload, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const version = await mg.getRepository(CapexVersion).findOne({ where: { id: versionId } });
    if (!version) throw new NotFoundException('Version not found');

    // Spread profiles resolve as on OPEX (flat, or a named SpreadProfile); an unknown one is a 400.
    const result = await writeAmountsPayload({ manager: mg, freeze: this.freeze, scope: 'capex', version }, payload);
    const { before, after } = result;

    await this.audit.log({ table: 'capex_amounts', recordId: null, action: 'update', before, after, userId }, { manager: mg });
    await recordPayloadRoundInputs({ manager: mg, scope: 'capex', version, userId: userId ?? null, audit: this.audit }, result);
    return { updated: after.length, round_inputs: await versionRoundInputs(mg, 'capex', version) };
  }

  async listByYear(versionId: string, year?: number, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const version = await mg.getRepository(CapexVersion).findOne({ where: { id: versionId } });
    let targetYear = year;
    if (!targetYear) {
      if (!version) throw new NotFoundException('Version not found');
      targetYear = (version as any).budget_year as number;
    }
    const start = `${targetYear}-01-01`;
    const end = `${targetYear}-12-31`;
    const items = await mg.getRepository(CapexAmount).find({
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
    const round_inputs = version ? await versionRoundInputs(mg, 'capex', version) : [];
    return { items, totals: roundedTotals, year: targetYear, round_inputs };
  }
}
