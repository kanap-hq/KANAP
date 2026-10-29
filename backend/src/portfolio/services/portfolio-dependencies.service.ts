import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { webLinkUrlsOf } from '../../common/web-link-url';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { PortfolioProject } from '../portfolio-project.entity';
import { PortfolioProjectDependency } from '../portfolio-project-dependency.entity';
import { PortfolioRequestProject } from '../portfolio-request-project.entity';
import { PortfolioRequest } from '../portfolio-request.entity';
import { PortfolioProjectUrl } from '../portfolio-project-url.entity';
import { PortfolioProjectsBaseService, ServiceOpts } from './portfolio-projects-base.service';
import { AuditService } from '../../audit/audit.service';
import { singleChangedId } from '../../audit/audit-parent-rules';

/**
 * Service for managing project dependencies and source request links.
 */
@Injectable()
export class PortfolioDependenciesService extends PortfolioProjectsBaseService {
  constructor(
    @InjectRepository(PortfolioProject) projectRepo: Repository<PortfolioProject>,
    private readonly audit: AuditService,
  ) {
    super(projectRepo);
  }

  /** The projects this project depends on, sorted. */
  private async dependencyIds(mg: EntityManager, tenantId: string, projectId: string): Promise<string[]> {
    const rows: Array<{ id: string }> = await mg.query(
      `SELECT depends_on_project_id AS id FROM portfolio_project_dependencies WHERE tenant_id = $1 AND project_id = $2`,
      [tenantId, projectId],
    );
    return Array.from(new Set(rows.map((row) => String(row.id).toLowerCase()))).sort();
  }

  /** One audit row for a dependency added or removed: the set before and after, on the project. */
  private async auditDependencies(
    mg: EntityManager,
    tenantId: string,
    projectId: string,
    beforeIds: string[],
    userId: string,
  ): Promise<void> {
    const afterIds = await this.dependencyIds(mg, tenantId, projectId);
    if (JSON.stringify(beforeIds) === JSON.stringify(afterIds)) return;
    await this.audit.log({
      table: 'portfolio_project_dependencies',
      recordId: projectId,
      action: 'update',
      before: { ids: beforeIds },
      after: { ids: afterIds },
      userId,
    }, { manager: mg });
  }

  private requireActivityAuthor(userId?: string | null): string {
    if (!userId) throw new BadRequestException('userId is required for change activity logging');
    return userId;
  }

  private formatProjectLabel(target: { item_number: number | null; name: string | null }, fallbackId: string): string {
    const prefix = target.item_number ? `PRJ-${target.item_number}: ` : 'Project: ';
    return `${prefix}${target.name || fallbackId}`;
  }

  /**
   * Link a source request to a project.
   */
  async linkSourceRequest(
    projectId: string,
    requestId: string,
    tenantId: string,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const linkRepo = mg.getRepository(PortfolioRequestProject);
    const requestRepo = mg.getRepository(PortfolioRequest);

    const project = await this.ensureProject(projectId, mg);

    const request = await requestRepo.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Request not found');

    if (request.status !== 'approved' && request.status !== 'converted') {
      throw new BadRequestException('Only Approved or Converted requests can be linked');
    }

    // Check if link already exists
    const existing = await linkRepo.findOne({
      where: { project_id: projectId, request_id: requestId },
    });
    if (existing) {
      return { ok: true, message: 'Already linked' };
    }

    // Create link
    await linkRepo.save(linkRepo.create({
      tenant_id: tenantId,
      request_id: requestId,
      project_id: projectId,
    }));

    // Update request status to converted if not already
    if (request.status === 'approved') {
      const requestBefore = { ...request };
      request.status = 'converted';
      request.converted_date = new Date();
      request.updated_at = new Date();
      await requestRepo.save(request);
      await this.audit.log({
        table: 'portfolio_requests',
        recordId: request.id,
        action: 'update',
        before: requestBefore,
        after: request,
        userId: null,
      }, { manager: mg });
    }

    return { ok: true };
  }

  /**
   * Unlink a source request from a project.
   */
  async unlinkSourceRequest(
    projectId: string,
    requestId: string,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const linkRepo = mg.getRepository(PortfolioRequestProject);

    await linkRepo.delete({
      project_id: projectId,
      request_id: requestId,
    });

    return { ok: true };
  }

  /**
   * Add a dependency to a project.
   */
  async addDependency(
    projectId: string,
    targetType: 'request' | 'project',
    targetId: string,
    tenantId: string,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const actorId = this.requireActivityAuthor(opts?.userId);

    // Projects can only depend on other projects
    if (targetType !== 'project') {
      throw new BadRequestException('Projects can only depend on other projects');
    }

    const project = await this.ensureProject(projectId, mg);

    // Validate target exists
    const target = await mg.getRepository(PortfolioProject).findOne({ where: { id: targetId } });
    if (!target) throw new NotFoundException('Target project not found');
    if (targetId === projectId) throw new BadRequestException('Cannot add self as dependency');

    // Check for circular dependency
    await this.checkCircularDependency(projectId, targetId, mg);

    // Check if already exists
    const repo = mg.getRepository(PortfolioProjectDependency);
    const existing = await repo.findOne({
      where: { project_id: projectId, depends_on_project_id: targetId },
    });
    if (existing) return { ok: true, message: 'Already linked' };
    const beforeIds = await this.dependencyIds(mg, project.tenant_id, projectId);

    // Create dependency
    const entity = repo.create({
      tenant_id: tenantId,
      project_id: projectId,
      depends_on_project_id: targetId,
    });
    await repo.save(entity);

    await this.logActivity(mg, {
      project_id: projectId,
      tenant_id: project.tenant_id,
      author_id: actorId,
      type: 'change',
      changed_fields: {
        dependency: [null, this.formatProjectLabel(target, targetId)],
      },
    });
    await this.auditDependencies(mg, project.tenant_id, projectId, beforeIds, actorId);

    return { ok: true };
  }

  /**
   * Remove a dependency from a project.
   */
  async removeDependency(
    projectId: string,
    targetType: 'request' | 'project',
    targetId: string,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const repo = mg.getRepository(PortfolioProjectDependency);
    const actorId = this.requireActivityAuthor(opts?.userId);
    const project = await this.ensureProject(projectId, mg);

    // Projects can only depend on other projects
    if (targetType !== 'project') {
      return { ok: true };
    }

    const existing = await repo.findOne({
      where: {
        project_id: projectId,
        depends_on_project_id: targetId,
      },
    });
    if (!existing) return { ok: true };

    const target = await mg.getRepository(PortfolioProject).findOne({ where: { id: targetId } });
    const targetLabel = target ? this.formatProjectLabel(target, targetId) : targetId;
    const beforeIds = await this.dependencyIds(mg, project.tenant_id, projectId);

    await repo.delete({
      project_id: projectId,
      depends_on_project_id: targetId,
    });

    await this.logActivity(mg, {
      project_id: projectId,
      tenant_id: project.tenant_id,
      author_id: actorId,
      type: 'change',
      changed_fields: {
        dependency: [targetLabel, null],
      },
    });
    await this.auditDependencies(mg, project.tenant_id, projectId, beforeIds, actorId);

    return { ok: true };
  }

  /**
   * Replace all URLs for a project.
   */
  async replaceUrls(
    projectId: string,
    urls: Array<{ url: string; label?: string }>,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const repo = mg.getRepository(PortfolioProjectUrl);

    const project = await this.ensureProject(projectId, mg);

    // Every address is checked before the old links go: a refused one changes nothing.
    const checked = webLinkUrlsOf(urls);
    const stored = await repo.find({ where: { project_id: projectId } });
    await repo.delete({ project_id: projectId });

    const toInsert = checked
      .map((u) => repo.create({
        tenant_id: project.tenant_id,
        project_id: projectId,
        url: u.url,
        label: u.label ? String(u.label).trim() : null,
      }));

    if (toInsert.length > 0) {
      await repo.save(toInsert);
    }

    // The links are replaced as a whole and get new ids: the history compares their address and label.
    const linkState = (rows: Array<{ url: string; label: string | null }>) => rows
      .map((row) => ({ url: row.url, label: row.label ?? null }))
      .sort((a, b) => `${a.url}\u0000${a.label ?? ''}`.localeCompare(`${b.url}\u0000${b.label ?? ''}`));
    const before = linkState(stored);
    const after = linkState(toInsert);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      await this.audit.log({
        table: 'portfolio_project_urls',
        recordId: projectId,
        action: 'update',
        before,
        after,
        userId: opts?.userId ?? null,
      }, { manager: mg });
    }

    return { ok: true, count: toInsert.length };
  }

  /**
   * List linked applications for a project.
   */
  async listLinkedApplications(projectId: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const project = await this.ensureProject(projectId, mg);
    const rows = await mg.query(
      `SELECT ap.application_id as id, a.name, a.description, a.lifecycle, a.criticality
       FROM application_projects ap
       JOIN applications a ON a.id = ap.application_id
       WHERE ap.project_id = $1
         AND ap.tenant_id = $2
         AND a.tenant_id = $2
       ORDER BY a.name ASC`,
      [projectId, project.tenant_id],
    );
    return { items: rows };
  }

  /**
   * Replace linked applications for a project.
   */
  async bulkReplaceLinkedApplications(
    projectId: string,
    applicationIds: string[],
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const actorId = this.requireActivityAuthor(opts?.userId);
    const project = await this.ensureProject(projectId, mg);
    const unique = Array.from(new Set((applicationIds || []).map((id) => String(id || '').trim()).filter(Boolean)));

    if (unique.length > 0) {
      const rows = await mg.query<Array<{ id: string }>>(
        `SELECT id
         FROM applications
         WHERE tenant_id = $1
           AND id = ANY($2::uuid[])`,
        [project.tenant_id, unique],
      );
      if (rows.length !== unique.length) {
        throw new BadRequestException('One or more applications were not found');
      }
    }

    const existing = await mg.query<Array<{ application_id: string }>>(
      `SELECT application_id
       FROM application_projects
       WHERE project_id = $1
         AND tenant_id = $2`,
      [projectId, project.tenant_id],
    );
    const beforeIds = Array.from(new Set(existing.map((row) => row.application_id)));

    await mg.query(
      `DELETE FROM application_projects
       WHERE project_id = $1
         AND tenant_id = $2`,
      [projectId, project.tenant_id],
    );

    if (unique.length > 0) {
      await mg.query(
        `INSERT INTO application_projects (tenant_id, application_id, project_id)
         SELECT $1, application_id, $2
         FROM unnest($3::uuid[]) AS application_id`,
        [project.tenant_id, projectId, unique],
      );
    }

    const beforeSorted = [...beforeIds].sort();
    const afterSorted = [...unique].sort();
    if (JSON.stringify(beforeSorted) !== JSON.stringify(afterSorted)) {
      const [beforeLabels, afterLabels] = await Promise.all([
        this.resolveApplicationLabelsByIds(mg, beforeSorted),
        this.resolveApplicationLabelsByIds(mg, afterSorted),
      ]);
      await this.logActivity(mg, {
        project_id: projectId,
        tenant_id: project.tenant_id,
        author_id: actorId,
        type: 'change',
        changed_fields: { applications: [beforeLabels, afterLabels] },
      });
      // The project's side of the link: the application added or removed alone is the parent, so its
      // history reads the row too.
      const changedId = singleChangedId(beforeSorted, afterSorted);
      await this.audit.log({
        table: 'application_projects',
        recordId: projectId,
        action: 'update',
        before: { ids: beforeSorted.map((id) => id.toLowerCase()) },
        after: { ids: afterSorted.map((id) => id.toLowerCase()) },
        userId: actorId,
        parent: changedId ? { table: 'applications', id: changedId } : null,
      }, { manager: mg });
    }

    return this.listLinkedApplications(projectId, { manager: mg });
  }

  /**
   * List linked assets for a project.
   */
  async listLinkedAssets(projectId: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const project = await this.ensureProject(projectId, mg);
    const rows = await mg.query(
      `SELECT asp.asset_id as id, a.name, a.kind, a.environment
       FROM asset_projects asp
       JOIN assets a ON a.id = asp.asset_id
       WHERE asp.project_id = $1
         AND asp.tenant_id = $2
         AND a.tenant_id = $2
       ORDER BY a.name ASC`,
      [projectId, project.tenant_id],
    );
    return { items: rows };
  }

  /**
   * Replace linked assets for a project.
   */
  async bulkReplaceLinkedAssets(
    projectId: string,
    assetIds: string[],
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const actorId = this.requireActivityAuthor(opts?.userId);
    const project = await this.ensureProject(projectId, mg);
    const unique = Array.from(new Set((assetIds || []).map((id) => String(id || '').trim()).filter(Boolean)));

    if (unique.length > 0) {
      const rows = await mg.query<Array<{ id: string }>>(
        `SELECT id
         FROM assets
         WHERE tenant_id = $1
           AND id = ANY($2::uuid[])`,
        [project.tenant_id, unique],
      );
      if (rows.length !== unique.length) {
        throw new BadRequestException('One or more assets were not found');
      }
    }

    const existing = await mg.query<Array<{ asset_id: string }>>(
      `SELECT asset_id
       FROM asset_projects
       WHERE project_id = $1
         AND tenant_id = $2`,
      [projectId, project.tenant_id],
    );
    const beforeIds = Array.from(new Set(existing.map((row) => row.asset_id)));

    await mg.query(
      `DELETE FROM asset_projects
       WHERE project_id = $1
         AND tenant_id = $2`,
      [projectId, project.tenant_id],
    );

    if (unique.length > 0) {
      await mg.query(
        `INSERT INTO asset_projects (tenant_id, asset_id, project_id)
         SELECT $1, asset_id, $2
         FROM unnest($3::uuid[]) AS asset_id`,
        [project.tenant_id, projectId, unique],
      );
    }

    const beforeSorted = [...beforeIds].sort();
    const afterSorted = [...unique].sort();
    if (JSON.stringify(beforeSorted) !== JSON.stringify(afterSorted)) {
      const [beforeLabels, afterLabels] = await Promise.all([
        this.resolveAssetLabelsByIds(mg, beforeSorted),
        this.resolveAssetLabelsByIds(mg, afterSorted),
      ]);
      await this.logActivity(mg, {
        project_id: projectId,
        tenant_id: project.tenant_id,
        author_id: actorId,
        type: 'change',
        changed_fields: { assets: [beforeLabels, afterLabels] },
      });
      // The project's side of the link: the asset added or removed alone is the parent, so its
      // history reads the row too.
      const changedId = singleChangedId(beforeSorted, afterSorted);
      await this.audit.log({
        table: 'asset_projects',
        recordId: projectId,
        action: 'update',
        before: { ids: beforeSorted.map((id) => id.toLowerCase()) },
        after: { ids: afterSorted.map((id) => id.toLowerCase()) },
        userId: actorId,
        parent: changedId ? { table: 'assets', id: changedId } : null,
      }, { manager: mg });
    }

    return this.listLinkedAssets(projectId, { manager: mg });
  }

  private async resolveApplicationLabelsByIds(mg: EntityManager, applicationIds: string[]): Promise<string[]> {
    if (applicationIds.length === 0) return [];
    const rows = await mg.query<Array<{ id: string; name: string | null }>>(
      `SELECT id, name
       FROM applications
       WHERE id = ANY($1::uuid[])`,
      [applicationIds],
    );
    const byId = new Map<string, string>();
    for (const row of rows) {
      byId.set(row.id, row.name || row.id);
    }
    return applicationIds.map((id) => byId.get(id) ?? id).sort((a, b) => a.localeCompare(b));
  }

  private async resolveAssetLabelsByIds(mg: EntityManager, assetIds: string[]): Promise<string[]> {
    if (assetIds.length === 0) return [];
    const rows = await mg.query<Array<{ id: string; name: string | null }>>(
      `SELECT id, name
       FROM assets
       WHERE id = ANY($1::uuid[])`,
      [assetIds],
    );
    const byId = new Map<string, string>();
    for (const row of rows) {
      byId.set(row.id, row.name || row.id);
    }
    return assetIds.map((id) => byId.get(id) ?? id).sort((a, b) => a.localeCompare(b));
  }

  /**
   * Check for circular dependencies using DFS.
   */
  private async checkCircularDependency(
    sourceId: string,
    targetId: string,
    mg: EntityManager,
  ): Promise<void> {
    const visited = new Set<string>();
    const stack: string[] = [targetId];

    while (stack.length > 0) {
      const currentId = stack.pop()!;

      if (visited.has(currentId)) continue;
      visited.add(currentId);

      // If we reach the source, we have a cycle
      if (currentId === sourceId) {
        throw new BadRequestException('Cannot add dependency: would create a circular reference');
      }

      // Get dependencies of current project
      const deps = await mg.query(
        `SELECT depends_on_project_id FROM portfolio_project_dependencies WHERE project_id = $1`,
        [currentId]
      );
      for (const dep of deps) {
        if (dep.depends_on_project_id) {
          stack.push(dep.depends_on_project_id);
        }
      }
    }
  }
}
