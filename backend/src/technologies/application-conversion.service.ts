import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import * as path from 'path';
import { ApplicationsDeleteService } from '../applications/applications-delete.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../common/storage/storage.service';
import { BUDGET_NATURES, naturesAnd } from '../spend/budget-nature';
import { TechnologiesService } from './technologies.service';
import { UUID_RE } from './technology-rows';

type ConversionOpts = { manager: EntityManager; tenantId: string; userId?: string | null };

/** Why an application cannot become a technology: other records need it as an application. */
export type ConversionRefusalReason =
  | 'interfaces'
  | 'middleware'
  | 'integration_tool'
  | 'suite_components'
  | 'interface_bindings'
  | 'name_taken';

/** What moves to the technology, counted. */
export type ConversionMoves = {
  owners: number;
  contracts: number;
  budget_lines: number;
  projects: number;
  links: number;
  attachments: number;
  incidents: number;
  servers: number;
};

/** What the conversion drops with the application, counted where it is a set of rows. */
export type ConversionLosses = {
  instances: number;
  suites: number;
  predecessor: number;
  successors: number;
  data_residency: number;
  support_contacts: number;
  knowledge_links: number;
  managed_documents: number;
  tasks: number;
  requests: number;
  business_processes: number;
  technologies: number;
};

export type ConversionPreview = {
  application: { id: string; name: string; reference: string | null };
  mode: 'installed' | 'subscribed';
  refusals: Array<{ reason: ConversionRefusalReason; count: number }>;
  moves: ConversionMoves;
  losses: ConversionLosses;
};

/**
 * The storage keys of a conversion: the copies made under the technology, and the originals of
 * the application. Once the transaction has committed the originals go; otherwise the copies do.
 */
export type ConversionFiles = { copies: string[]; originals: string[] };

type CountRow = ConversionMoves & ConversionLosses & {
  interfaces: number; middleware: number; integration_tool: number; suite_components: number;
  interface_bindings: number; name_taken: number;
};

const REFUSAL_ORDER: ConversionRefusalReason[] = ['interfaces', 'middleware', 'integration_tool', 'suite_components', 'interface_bindings', 'name_taken'];

/**
 * Turns an application registered by mistake (vSphere, SQL Server, Active Directory) into a
 * technology (lot C1). The preview counts what moves and what is lost, and lists the refusals:
 * interfaces, middleware or integration tool of a binding, a suite with components, bindings on
 * its instances, a technology of the same name. The conversion runs in the caller's transaction:
 * the technology is created, the governance links are copied to it, the server assignments of its
 * instances become installation links, and the application is deleted by its own delete service.
 * Files are copied before; the caller settles them after the transaction (`settleFiles`).
 */
@Injectable()
export class ApplicationConversionService {
  private readonly logger = new Logger(ApplicationConversionService.name);

  constructor(
    private readonly technologies: TechnologiesService,
    private readonly applicationsDelete: ApplicationsDeleteService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async preview(applicationId: string, opts: ConversionOpts): Promise<ConversionPreview> {
    const app = await this.readApplication(applicationId, opts, false);
    return this.previewOf(app, opts);
  }

  /**
   * Convert the application. Refused (409, `APPLICATION_CONVERSION_REFUSED`, with the refusals)
   * when the preview lists any. Returns the new technology and the files the caller settles.
   */
  async convert(
    applicationId: string,
    body: { family?: unknown },
    opts: ConversionOpts,
  ): Promise<{ technology: { id: string; reference: string | null; name: string }; files: ConversionFiles }> {
    const { manager: mg, tenantId } = opts;
    const userId = opts.userId ?? null;
    const app = await this.readApplication(applicationId, opts, true);
    const family = String(body?.family ?? '').trim();
    if (!family) throw new BadRequestException('Family is required.');
    const preview = await this.previewOf(app, opts);
    if (preview.refusals.length) {
      throw new ConflictException({
        code: 'APPLICATION_CONVERSION_REFUSED',
        message: 'This application cannot be converted to a technology.',
        refusals: preview.refusals,
      });
    }
    const reference = app.sequential_id || null;
    const files: ConversionFiles = { copies: [], originals: [] };
    try {
      const created = await this.technologies.create({
        name: app.name,
        editor: app.editor,
        description: app.description,
        notes: app.notes,
        lifecycle: app.lifecycle || undefined,
        cyber_criticality: app.cyber_criticality,
        recovery_wave: app.recovery_wave,
        rto_minutes: app.rto_minutes,
        rpo_minutes: app.rpo_minutes,
        family,
        mode: preview.mode,
      }, opts);
      const techId = created.id;
      const params = [tenantId, app.id, techId];
      const moved = async (sql: string, extra: unknown[] = []) => {
        const [{ n }]: Array<{ n: number }> = await mg.query(`WITH c AS (${sql} RETURNING 1) SELECT count(*)::int AS n FROM c`, [...params, ...extra]);
        return Number(n) || 0;
      };

      const counts: ConversionMoves = {
        owners: await moved(
          `INSERT INTO technology_owners (tenant_id, technology_id, user_id, owner_type)
           SELECT DISTINCT $1::uuid, $3::uuid, o.user_id, o.owner_type FROM application_owners o
            WHERE o.tenant_id = $1 AND o.application_id = $2 AND o.owner_type IN ('business', 'it')
           ON CONFLICT DO NOTHING`,
        ),
        contracts: await moved(
          `INSERT INTO technology_contracts (tenant_id, technology_id, contract_id)
           SELECT DISTINCT $1::uuid, $3::uuid, l.contract_id FROM application_contracts l
            WHERE l.tenant_id = $1 AND l.application_id = $2
           ON CONFLICT DO NOTHING`,
        ),
        // Both natures, as the technology's own links (`technologies-relations.service.ts`).
        budget_lines: await moved(
          `INSERT INTO technology_spend_items (tenant_id, technology_id, spend_item_id)
           SELECT DISTINCT $1::uuid, $3::uuid, l.spend_item_id FROM application_spend_items l
             JOIN spend_items s ON s.tenant_id = l.tenant_id AND s.id = l.spend_item_id${naturesAnd('s', BUDGET_NATURES)}
            WHERE l.tenant_id = $1 AND l.application_id = $2
           ON CONFLICT DO NOTHING`,
        ),
        projects: await moved(
          `INSERT INTO technology_projects (tenant_id, technology_id, project_id)
           SELECT DISTINCT $1::uuid, $3::uuid, l.project_id FROM application_projects l
            WHERE l.tenant_id = $1 AND l.application_id = $2
           ON CONFLICT DO NOTHING`,
        ),
        links: await moved(
          `INSERT INTO technology_links (tenant_id, technology_id, description, url, created_at)
           SELECT $1::uuid, $3::uuid, l.description, l.url, l.created_at FROM application_links l
            WHERE l.tenant_id = $1 AND l.application_id = $2 AND btrim(coalesce(l.url, '')) <> ''`,
        ),
        attachments: 0,
        incidents: await moved(
          `INSERT INTO incident_technologies (tenant_id, incident_id, technology_id)
           SELECT DISTINCT $1::uuid, l.incident_id, $3::uuid FROM incident_applications l
            WHERE l.tenant_id = $1 AND l.application_id = $2
           ON CONFLICT DO NOTHING`,
        ),
        servers: await moved(
          `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id, notes, source)
           SELECT DISTINCT $1::uuid, aa.asset_id, $3::uuid, NULL::uuid, $4::text, 'manual'
             FROM app_asset_assignments aa
             JOIN app_instances i ON i.tenant_id = aa.tenant_id AND i.id = aa.app_instance_id
            WHERE aa.tenant_id = $1 AND i.application_id = $2
           ON CONFLICT ON CONSTRAINT asset_technologies_key DO NOTHING`,
          [`Converted from ${reference ?? app.name}`],
        ),
      };
      counts.attachments = await this.copyAttachments(mg, tenantId, app.id, techId, files);

      const technology = { id: techId, reference: created.reference, name: created.name };
      const source = { id: app.id, reference, name: app.name };
      await this.audit.log(
        { table: 'technologies', recordId: techId, action: 'update', before: null, after: { converted_from_application: source, moved: counts }, userId },
        { manager: mg },
      );
      await this.audit.log(
        { table: 'applications', recordId: app.id, action: 'update', before: { reference, name: app.name }, after: { converted_to_technology: technology }, userId },
        { manager: mg },
      );
      // Its attachment rows are gone already: the delete removes no file.
      await this.applicationsDelete.delete(app.id, { manager: mg, userId });
      return { technology, files };
    } catch (err) {
      // The transaction rolls back: the copies are unreferenced, the originals untouched.
      await this.removeKeys(files.copies);
      throw err;
    }
  }

  /**
   * After the transaction: the originals go once it has committed, the copies once it has not.
   * Best effort; whatever is left unreferenced is swept by the storage cleanup.
   */
  async settleFiles(files: ConversionFiles, committed: boolean): Promise<void> {
    await this.removeKeys(committed ? files.originals : files.copies);
  }

  private async removeKeys(keys: string[]) {
    for (const key of keys) {
      try {
        await this.storage.deleteObject(key);
      } catch (err: any) {
        this.logger.warn(`Failed to delete storage object after a conversion: ${err?.message || 'Unknown error'}`);
      }
    }
  }

  /**
   * Copy each attachment to `files/<tenant>/technologies/<id>/<stored name>` (as an upload of the
   * technology), add its row, then remove the application's rows. Keys are recorded in `files`.
   */
  private async copyAttachments(mg: EntityManager, tenantId: string, appId: string, techId: string, files: ConversionFiles): Promise<number> {
    const rows: Array<{ id: string; original_filename: string; stored_filename: string; mime_type: string | null; size: number; storage_path: string; uploaded_at: Date }> = await mg.query(
      `SELECT id, original_filename, stored_filename, mime_type, size, storage_path, uploaded_at
         FROM application_attachments WHERE tenant_id = $1 AND application_id = $2 ORDER BY uploaded_at, id`,
      [tenantId, appId],
    );
    for (const row of rows) {
      const stored = row.stored_filename || path.posix.basename(row.storage_path);
      const key = path.posix.join('files', tenantId, 'technologies', techId, stored);
      const obj = await this.storage.getObjectStream(row.storage_path);
      files.copies.push(key);
      await this.storage.putObject({
        key,
        body: obj.stream,
        contentType: obj.contentType || row.mime_type,
        contentLength: obj.contentLength ?? row.size,
        sse: 'AES256',
      });
      await mg.query(
        `INSERT INTO technology_attachments (tenant_id, technology_id, original_filename, stored_filename, mime_type, size, storage_path, uploaded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tenantId, techId, row.original_filename, stored, row.mime_type, row.size ?? 0, key, row.uploaded_at],
      );
      files.originals.push(row.storage_path);
    }
    if (rows.length) {
      await mg.query(`DELETE FROM application_attachments WHERE tenant_id = $1 AND application_id = $2`, [tenantId, appId]);
    }
    return rows.length;
  }

  private async readApplication(applicationId: string, opts: ConversionOpts, lock: boolean) {
    const id = String(applicationId || '').trim().toLowerCase();
    if (!UUID_RE.test(id)) throw new NotFoundException('Application not found');
    const rows: Array<{
      id: string; name: string; sequential_id: string | null; editor: string | null; description: string | null; notes: string | null;
      lifecycle: string | null; cyber_criticality: string | null; recovery_wave: string | null; rto_minutes: number | null;
      rpo_minutes: number | null; predecessor_id: string | null;
    }> = await opts.manager.query(
      `SELECT id, name, sequential_id, editor, description, notes, lifecycle, cyber_criticality, recovery_wave,
              rto_minutes, rpo_minutes, predecessor_id
         FROM applications WHERE tenant_id = $1 AND id = $2${lock ? ' FOR UPDATE' : ''}`,
      [opts.tenantId, id],
    );
    if (!rows[0]) throw new NotFoundException('Application not found');
    return rows[0];
  }

  /** Every count in one statement, each scoped by the tenant. */
  private async previewOf(app: { id: string; name: string; sequential_id: string | null; predecessor_id: string | null }, opts: ConversionOpts): Promise<ConversionPreview> {
    const [row]: CountRow[] = await opts.manager.query(
      `WITH inst AS (SELECT id FROM app_instances WHERE tenant_id = $1 AND application_id = $2)
       SELECT
         (SELECT count(*)::int FROM interfaces i WHERE i.tenant_id = $1 AND (i.source_application_id = $2 OR i.target_application_id = $2)) AS interfaces,
         (SELECT count(DISTINCT m.interface_id)::int FROM interface_middleware_applications m WHERE m.tenant_id = $1 AND m.application_id = $2) AS middleware,
         (SELECT count(*)::int FROM interface_bindings b WHERE b.tenant_id = $1 AND b.integration_tool_application_id = $2) AS integration_tool,
         (SELECT count(*)::int FROM application_suites s WHERE s.tenant_id = $1 AND s.suite_id = $2) AS suite_components,
         (SELECT count(*)::int FROM interface_bindings b
           WHERE b.tenant_id = $1 AND (b.source_instance_id IN (SELECT id FROM inst) OR b.target_instance_id IN (SELECT id FROM inst))) AS interface_bindings,
         (SELECT count(*)::int FROM technologies t WHERE t.tenant_id = $1 AND lower(t.name) = lower($3)) AS name_taken,
         (SELECT count(DISTINCT (o.user_id, o.owner_type))::int FROM application_owners o
           WHERE o.tenant_id = $1 AND o.application_id = $2 AND o.owner_type IN ('business', 'it')) AS owners,
         (SELECT count(DISTINCT l.contract_id)::int FROM application_contracts l WHERE l.tenant_id = $1 AND l.application_id = $2) AS contracts,
         (SELECT count(DISTINCT l.spend_item_id)::int FROM application_spend_items l
            JOIN spend_items s ON s.tenant_id = l.tenant_id AND s.id = l.spend_item_id${naturesAnd('s', BUDGET_NATURES)}
           WHERE l.tenant_id = $1 AND l.application_id = $2) AS budget_lines,
         (SELECT count(DISTINCT l.project_id)::int FROM application_projects l WHERE l.tenant_id = $1 AND l.application_id = $2) AS projects,
         (SELECT count(*)::int FROM application_links l WHERE l.tenant_id = $1 AND l.application_id = $2 AND btrim(coalesce(l.url, '')) <> '') AS links,
         (SELECT count(*)::int FROM application_attachments l WHERE l.tenant_id = $1 AND l.application_id = $2) AS attachments,
         (SELECT count(DISTINCT l.incident_id)::int FROM incident_applications l WHERE l.tenant_id = $1 AND l.application_id = $2) AS incidents,
         (SELECT count(DISTINCT aa.asset_id)::int FROM app_asset_assignments aa
           WHERE aa.tenant_id = $1 AND aa.app_instance_id IN (SELECT id FROM inst)) AS servers,
         (SELECT count(*)::int FROM inst) AS instances,
         (SELECT count(*)::int FROM application_suites s WHERE s.tenant_id = $1 AND s.application_id = $2) AS suites,
         (SELECT count(*)::int FROM applications p WHERE p.tenant_id = $1 AND p.id = $4) AS predecessor,
         (SELECT count(*)::int FROM applications p WHERE p.tenant_id = $1 AND p.predecessor_id = $2) AS successors,
         (SELECT count(*)::int FROM application_data_residency l WHERE l.tenant_id = $1 AND l.application_id = $2) AS data_residency,
         (SELECT count(*)::int FROM application_support_contacts l WHERE l.tenant_id = $1 AND l.application_id = $2) AS support_contacts,
         (SELECT count(*)::int FROM document_applications l WHERE l.tenant_id = $1 AND l.application_id = $2) AS knowledge_links,
         (SELECT count(*)::int FROM integrated_document_bindings b
           WHERE b.tenant_id = $1 AND b.source_entity_type = 'applications' AND b.source_entity_id = $2) AS managed_documents,
         (SELECT count(*)::int FROM task_applications l WHERE l.tenant_id = $1 AND l.application_id = $2) AS tasks,
         (SELECT count(*)::int FROM portfolio_request_applications l WHERE l.tenant_id = $1 AND l.application_id = $2) AS requests,
         (SELECT count(*)::int FROM application_business_processes l WHERE l.tenant_id = $1 AND l.application_id = $2) AS business_processes,
         (SELECT count(*)::int FROM application_technologies l WHERE l.tenant_id = $1 AND l.application_id = $2) AS technologies`,
      [opts.tenantId, app.id, app.name, app.predecessor_id],
    );
    const n = (key: keyof CountRow) => Number(row?.[key] ?? 0);
    return {
      application: { id: app.id, name: app.name, reference: app.sequential_id || null },
      mode: n('servers') > 0 ? 'installed' : 'subscribed',
      refusals: REFUSAL_ORDER.filter((reason) => n(reason) > 0).map((reason) => ({ reason, count: n(reason) })),
      moves: {
        owners: n('owners'), contracts: n('contracts'), budget_lines: n('budget_lines'), projects: n('projects'),
        links: n('links'), attachments: n('attachments'), incidents: n('incidents'), servers: n('servers'),
      },
      losses: {
        instances: n('instances'), suites: n('suites'), predecessor: n('predecessor'), successors: n('successors'),
        data_residency: n('data_residency'), support_contacts: n('support_contacts'), knowledge_links: n('knowledge_links'),
        managed_documents: n('managed_documents'), tasks: n('tasks'), requests: n('requests'),
        business_processes: n('business_processes'), technologies: n('technologies'),
      },
    };
  }
}
