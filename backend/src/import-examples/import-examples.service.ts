import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import type { CsvLanguage } from '../common/csv-sheet';
import { ItOpsSettingsService } from '../it-ops-settings/it-ops-settings.service';
import { loadAnalyticsAxes } from '../analytics/analytics-axes.util';
import { loadColumnLabels } from '../spend/budget-file/load';
import { buildImportExample, ImportExampleFile } from './import-example';
import { ImportExampleKey } from './import-example-definitions';

/** The example workbook of an import, written for the workspace that downloads it. */
@Injectable()
export class ImportExamplesService {
  constructor(private readonly itOpsSettings: ItOpsSettingsService) {}

  async build(key: ImportExampleKey, language: CsvLanguage, ctx: { manager: EntityManager; tenantId: string }): Promise<ImportExampleFile> {
    const settings = await this.itOpsSettings.getSettings(ctx.tenantId, { manager: ctx.manager });
    const budget = key === 'budget-lines';
    const axes = budget ? await loadAnalyticsAxes(ctx.manager, ctx.tenantId) : [];
    return buildImportExample(key, language, {
      catalogs: settings,
      dimensions: axes.filter((axis) => axis.status === 'enabled').map((axis) => ({ code: axis.code, name: axis.name })),
      amountLabels: budget ? await loadColumnLabels(ctx.manager, ctx.tenantId) : {},
      year: new Date().getFullYear(),
    });
  }
}
