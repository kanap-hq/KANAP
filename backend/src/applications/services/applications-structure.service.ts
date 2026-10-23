import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Application } from '../application.entity';
import { ApplicationSuiteLink } from '../application-suite.entity';
import { AuditService } from '../../audit/audit.service';
import { ApplicationsBaseService, ServiceOpts } from './applications-base.service';
import { applicationParticipantCondition } from '../../auth/business-contributor-scope';
import { assertNoSuiteCycle } from '../application-rules';

/**
 * Service for managing application hierarchy (suites and components).
 */
@Injectable()
export class ApplicationsStructureService extends ApplicationsBaseService {
  constructor(
    @InjectRepository(Application) appRepo: Repository<Application>,
    private readonly audit: AuditService,
  ) {
    super(appRepo);
  }

  // Structure: Suites an app belongs to
  async listSuites(appId: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const app = await this.ensureApp(appId, mg, opts?.accessScope);
    const params: unknown[] = [app.id];
    const relatedScopeSql = opts?.accessScope
      ? (() => {
        params.push(opts.accessScope.userId);
        return `AND ${applicationParticipantCondition('a', `$${params.length}`)}`;
      })()
      : '';
    const rows: Array<{ id: string; name: string; lifecycle: string; criticality: string }> = await mg.query(
      `SELECT a.id, a.name, a.lifecycle, a.criticality
       FROM application_suites l
       JOIN applications a ON a.id = l.suite_id
       WHERE l.application_id = $1
         ${relatedScopeSql}
       ORDER BY a.name ASC`,
      params,
    );
    return { items: rows };
  }

  async bulkReplaceSuites(appId: string, suiteIds: string[], userId?: string | null, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const resolvedAppId = await this.resolveApplicationIdentifier(appId, mg);
    const repo = mg.getRepository(ApplicationSuiteLink);
    const unique = Array.from(new Set((suiteIds || []).filter((id) => !!id)));
    if (unique.length > 0) {
      const apps = await mg.getRepository(Application).find({ where: { id: In(unique) } as any });
      if (apps.length !== unique.length) {
        throw new BadRequestException('One or more selected suites do not exist.');
      }
      // A suite may belong to another suite, never to itself nor to one of its own members.
      await assertNoSuiteCycle(mg, await this.getCurrentTenantId(mg), resolvedAppId, unique);
      const invalid = apps.filter((a) => !a.is_suite).map((a) => a.name);
      if (invalid.length > 0) {
        throw new BadRequestException('Only applications marked as suites can be selected as parents.');
      }
    }
    const existing = await repo.find({ where: { application_id: resolvedAppId } as any });
    const beforeState = existing.map((e: any) => e.suite_id).sort();
    const toDelete = existing.filter((e: any) => !unique.includes(e.suite_id));
    const existingSet = new Set(existing.map((e: any) => e.suite_id));
    const toInsert = unique.filter((id) => !existingSet.has(id)).map((id) => repo.create({ application_id: resolvedAppId, suite_id: id } as any));
    if (toDelete.length > 0) await repo.remove(toDelete as any);
    if (toInsert.length > 0) await repo.save(toInsert as any);
    const afterState = [...unique].sort();
    if (JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
      await this.audit.log(
        {
          table: 'application_suites',
          recordId: resolvedAppId,
          action: 'update',
          before: beforeState,
          after: afterState,
          userId: userId ?? null,
        },
        { manager: mg },
      );
    }
    return { ok: true, added: toInsert.length, removed: toDelete.length };
  }

  // Structure: Components (children) of a suite
  async listComponents(suiteId: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const suite = await this.ensureApp(suiteId, mg, opts?.accessScope);
    const params: unknown[] = [suite.id];
    const relatedScopeSql = opts?.accessScope
      ? (() => {
        params.push(opts.accessScope.userId);
        return `AND ${applicationParticipantCondition('a', `$${params.length}`)}`;
      })()
      : '';
    const rows: Array<{ id: string; name: string; lifecycle: string; criticality: string }> = await mg.query(
      `SELECT a.id, a.name, a.lifecycle, a.criticality
       FROM application_suites l
       JOIN applications a ON a.id = l.application_id
       WHERE l.suite_id = $1
         ${relatedScopeSql}
       ORDER BY a.name ASC`,
      params,
    );
    return { items: rows };
  }
}
