import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { PortfolioSettings } from './portfolio-settings.entity';
import { writeAuditLog } from '../audit/audit.service';

@Injectable()
export class PortfolioSettingsService {
  constructor(
    @InjectRepository(PortfolioSettings)
    private readonly repo: Repository<PortfolioSettings>,
  ) {}

  async get(tenantId: string, opts?: { manager?: EntityManager }): Promise<PortfolioSettings> {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioSettings);

    let settings = await repo.findOne({ where: { tenant_id: tenantId } });

    if (!settings) {
      // Create default settings
      settings = repo.create({
        tenant_id: tenantId,
        mandatory_bypass_enabled: false,
      });
      settings = await repo.save(settings);
    }

    return settings;
  }

  async update(
    tenantId: string,
    body: { mandatory_bypass_enabled?: boolean },
    opts?: { manager?: EntityManager; userId?: string | null },
  ): Promise<PortfolioSettings> {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioSettings);

    const settings = await this.get(tenantId, { manager: mg });
    const before = { ...settings };

    if (Object.prototype.hasOwnProperty.call(body, 'mandatory_bypass_enabled')) {
      settings.mandatory_bypass_enabled = body.mandatory_bypass_enabled === true;
    }

    settings.updated_at = new Date();
    const saved = await repo.save(settings);
    await writeAuditLog(mg, { table: 'portfolio_settings', recordId: saved.id, action: 'update', before, after: saved, userId: opts?.userId ?? null });
    return saved;
  }
}
