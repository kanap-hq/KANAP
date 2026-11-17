import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Application } from '../application.entity';
import { ApplicationDataResidency } from '../application-data-residency.entity';
import { AuditService } from '../../audit/audit.service';
import { lockApplicationRow } from '../application-rules';
import { ApplicationsBaseService, ServiceOpts } from './applications-base.service';

/**
 * Service for managing application data residency.
 */
@Injectable()
export class ApplicationsResidencyService extends ApplicationsBaseService {
  constructor(
    @InjectRepository(Application) appRepo: Repository<Application>,
    private readonly audit: AuditService,
  ) {
    super(appRepo);
  }

  async listDataResidency(appId: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const app = await this.ensureApp(appId, mg, opts?.accessScope);
    return mg.getRepository(ApplicationDataResidency).find({ where: { application_id: app.id } as any });
  }

  async bulkReplaceDataResidency(appId: string, countryCodes: string[], userId?: string | null, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const resolvedAppId = await this.resolveApplicationIdentifier(appId, mg);
    const app = await mg.getRepository(Application).findOne({ where: { id: resolvedAppId } });
    if (!app) throw new NotFoundException('Application not found');
    // The application, then its residency (`lockApplicationRow`), as the writers of its owners: the state
    // an import compares covers the residency, and its trigger writes the application (review 4 of I3, C3).
    if (!(await lockApplicationRow(mg, app.tenant_id, resolvedAppId))) throw new NotFoundException('Application not found');
    const repo = mg.getRepository(ApplicationDataResidency);
    const existing = await repo.find({ where: { application_id: resolvedAppId } as any });
    const beforeState = existing.map((r) => r.country_iso).sort();

    const clean = (countryCodes || []).map((c) => String(c || '').trim().toUpperCase()).filter((c) => !!c && c.length === 2);
    const unique = Array.from(new Set(clean));
    if (JSON.stringify(beforeState) === JSON.stringify([...unique].sort())) return existing;
    if (existing.length) await repo.delete({ id: In(existing.map((x) => x.id)) as any });
    let afterRows: ApplicationDataResidency[] = [];
    if (unique.length) {
      const rows = unique.map((iso) => repo.create({ application_id: resolvedAppId, country_iso: iso }));
      afterRows = await repo.save(rows);
    }
    const afterState = afterRows.map((r) => r.country_iso).sort();
    if (JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
      await this.audit.log(
        {
          table: 'application_data_residency',
          recordId: resolvedAppId,
          action: 'update',
          before: beforeState,
          after: afterState,
          userId: userId ?? null,
        },
        { manager: mg },
      );
    }
    return this.listDataResidency(resolvedAppId, { manager: mg });
  }
}
