import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import * as path from 'path';
import { ApplicationsDeleteService } from '../applications/applications-delete.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../common/storage/storage.service';
import { incidentVisibilitySql, type IncidentViewer } from '../incidents/incident-visibility';
import { IncidentRelationsService } from '../incidents/services/incident-relations.service';
import { ItOpsSettingsService } from '../it-ops-settings/it-ops-settings.service';
import { releaseOrphanedManagedDocuments } from '../knowledge/integrated-document-orphans';
import { BUDGET_NATURES, naturesAnd } from '../spend/budget-nature';
import { TechnologiesService } from './technologies.service';
import { UUID_RE } from './technology-rows';

/** The modules whose counts the caller may read in the preview (`null` otherwise, as the Relations tab). */
export type ConversionAccess = { contracts: boolean; budget_lines: boolean; projects: boolean; incidents: boolean };

type ConversionOpts = {
  manager: EntityManager;
  tenantId: string;
  userId?: string | null;
  access?: ConversionAccess;
  incidentViewer?: IncidentViewer;
};

/** Why an application cannot become a technology, or what the technology could not take. */
export type ConversionRefusalReason =
  | 'interfaces'
  | 'middleware'
  | 'integration_tool'
  | 'suite_components'
  | 'interface_bindings'
  | 'name_taken'
  | 'invalid_fields'
  | 'missing_files';

export type ConversionRefusal = { reason: ConversionRefusalReason; count: number; fields?: string[]; files?: string[] };

/** What moves to the technology, counted; `null` for a module the caller cannot read. */
export type ConversionMoves = {
  owners: number;
  /** Once each, the first role kept (a technology lists a contact once). */
  support_contacts: number;
  contracts: number | null;
  budget_lines: number | null;
  projects: number | null;
  links: number;
  attachments: number;
  incidents: number | null;
  servers: number;
};

/** What the conversion drops with the application. */
export type ConversionLosses = {
  instances: number;
  disabled_instance_servers: number;
  suites: number;
  predecessor: number;
  successors: number;
  data_residency: number;
  audience: number;
  links_without_url: number;
  knowledge_links: number;
  tasks: number;
  requests: number;
  business_processes: number;
  technologies: number;
};

/** What stays but loses its link to the application: its managed documents, released unfiled. */
export type ConversionUnlinked = { managed_documents: number };

export type ConversionPreview = {
  application: { id: string; name: string; reference: string | null };
  mode: 'installed' | 'subscribed';
  refusals: ConversionRefusal[];
  moves: ConversionMoves;
  unlinked: ConversionUnlinked;
  losses: ConversionLosses;
};

/**
 * The storage keys of a conversion: the copies made under the technology, and the originals of
 * the application. Once the transaction has committed the originals go; otherwise the copies do.
 */
export type ConversionFiles = { copies: string[]; originals: string[] };

type ApplicationRow = {
  id: string; name: string; sequential_id: string | null; editor: string | null; description: string | null; notes: string | null;
  lifecycle: string | null; cyber_criticality: string | null; recovery_wave: string | null; rto_minutes: number | null;
  rpo_minutes: number | null; predecessor_id: string | null; support_notes: string | null;
};

type CountRow = Omit<ConversionMoves, 'contracts' | 'budget_lines' | 'projects' | 'incidents'> & ConversionLosses & ConversionUnlinked & {
  contracts: number; budget_lines: number; projects: number; incidents: number;
  interfaces: number; middleware: number; integration_tool: number; suite_components: number;
  interface_bindings: number; name_taken: number;
};

const COUNTED_REFUSALS: ConversionRefusalReason[] = ['interfaces', 'middleware', 'integration_tool', 'suite_components', 'interface_bindings', 'name_taken'];

/** A server assignment that becomes an installation: its instance is enabled (as the deductions of `technology-reach.service.ts`). */
const ACTIVE_INSTANCE = `i.status = 'enabled' AND (i.disabled_at IS NULL OR i.disabled_at > now())`;

/**
 * The support contacts the technology takes: one row per contact of the tenant (the composite key
 * of `technology_support_contacts` refuses another tenant's), the first role given kept, trimmed.
 * Parameters `$1` tenant, `$2` application.
 */
const SUPPORT_CONTACTS_KEPT = `SELECT DISTINCT ON (l.contact_id) l.contact_id, NULLIF(btrim(coalesce(l.role, '')), '') AS role, l.created_at
    FROM application_support_contacts l
    JOIN contacts c ON c.tenant_id = l.tenant_id AND c.id = l.contact_id
   WHERE l.tenant_id = $1 AND l.application_id = $2
   ORDER BY l.contact_id, l.created_at, l.id`;

const FULL_ACCESS: ConversionAccess = { contracts: true, budget_lines: true, projects: true, incidents: true };

/**
 * Turns an application registered by mistake (vSphere, SQL Server, Active Directory) into a
 * technology (lot C1). The preview counts what moves, what loses its link and what is lost, and
 * lists the refusals: interfaces, middleware or integration tool of a binding, a suite with
 * components, bindings on its instances, a technology of the same name, values the technology
 * cannot take, files missing from storage. The conversion runs in the caller's transaction: the
 * technology is created with the support notes, the governance links and support contacts are copied to it, the server assignments of its
 * enabled instances become installation links, the application is deleted by its own delete
 * service, and its managed documents are released unfiled with their files. Files are copied
 * before; the caller settles them after the transaction (`settleFiles`).
 */
@Injectable()
export class ApplicationConversionService {
  private readonly logger = new Logger(ApplicationConversionService.name);

  constructor(
    private readonly technologies: TechnologiesService,
    private readonly applicationsDelete: ApplicationsDeleteService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly itOps: ItOpsSettingsService,
    private readonly incidents: IncidentRelationsService,
  ) {}

  async preview(applicationId: string, opts: ConversionOpts): Promise<ConversionPreview> {
    const app = await this.readApplication(applicationId, opts, false);
    return this.previewOf(app, opts.access ?? FULL_ACCESS, opts.incidentViewer ?? { userId: null, isAdmin: true }, opts);
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
    // Its instances too: an assignment or a binding written meanwhile waits, then fails on its key,
    // instead of going with the cascade unseen.
    await mg.query(`SELECT id FROM app_instances WHERE tenant_id = $1 AND application_id = $2 FOR UPDATE`, [tenantId, app.id]);
    const family = String(body?.family ?? '').trim();
    if (!family) throw new BadRequestException('Family is required.');
    // Every count, whatever the caller reads: what moves is the whole set.
    const preview = await this.previewOf(app, FULL_ACCESS, { userId: null, isAdmin: true }, opts);
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
        support_notes: app.support_notes,
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

      const counts = {
        owners: await moved(
          `INSERT INTO technology_owners (tenant_id, technology_id, user_id, owner_type)
           SELECT DISTINCT $1::uuid, $3::uuid, o.user_id, o.owner_type FROM application_owners o
            WHERE o.tenant_id = $1 AND o.application_id = $2 AND o.owner_type IN ('business', 'it')
           ON CONFLICT DO NOTHING`,
        ),
        support_contacts: await moved(
          `INSERT INTO technology_support_contacts (tenant_id, technology_id, contact_id, role, created_at)
           SELECT $1::uuid, $3::uuid, k.contact_id, k.role, k.created_at FROM (${SUPPORT_CONTACTS_KEPT}) k
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
        incidents: 0,
        servers: await moved(
          `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id, notes, source)
           SELECT DISTINCT $1::uuid, aa.asset_id, $3::uuid, NULL::uuid, $4::text, 'manual'
             FROM app_asset_assignments aa
             JOIN app_instances i ON i.tenant_id = aa.tenant_id AND i.id = aa.app_instance_id
            WHERE aa.tenant_id = $1 AND i.application_id = $2 AND ${ACTIVE_INSTANCE}
           ON CONFLICT ON CONSTRAINT asset_technologies_key DO NOTHING`,
          [`Converted from ${reference ?? app.name}`],
        ),
        managed_documents: 0,
      };
      const incidentIds: Array<{ id: string }> = await mg.query(
        `INSERT INTO incident_technologies (tenant_id, incident_id, technology_id)
         SELECT DISTINCT $1::uuid, l.incident_id, $3::uuid FROM incident_applications l
          WHERE l.tenant_id = $1 AND l.application_id = $2
         ON CONFLICT DO NOTHING
         RETURNING incident_id AS id`,
        params,
      );
      counts.incidents = incidentIds.length;
      counts.attachments = await this.copyAttachments(mg, tenantId, app.id, techId, files);

      const technology = { id: techId, reference: created.reference, name: created.name };
      const label = (ref: string | null, name: string) => (ref ? `${ref} ${name}` : name);
      await this.incidents.journalApplicationConversion(
        incidentIds.map((row) => row.id), label(reference, app.name), label(technology.reference, technology.name), userId, { manager: mg, tenantId },
      );
      // Its attachment rows are gone already: the delete removes no file. Its managed documents
      // stay, released below once the application is gone.
      await this.applicationsDelete.delete(app.id, { manager: mg, userId, keepManagedDocuments: true });
      const released = await releaseOrphanedManagedDocuments(mg, tenantId, {
        only: { type: 'applications', id: app.id }, userId, sourceRef: 'application-conversion',
      });
      counts.managed_documents = released.length;
      const source = { id: app.id, reference, name: app.name };
      await this.audit.log(
        { table: 'technologies', recordId: techId, action: 'update', before: null, after: { converted_from_application: source, moved: counts }, userId },
        { manager: mg },
      );
      await this.audit.log(
        { table: 'applications', recordId: app.id, action: 'update', before: { reference, name: app.name }, after: { converted_to_technology: technology }, userId },
        { manager: mg },
      );
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

  private attachmentsOf(mg: EntityManager, tenantId: string, appId: string): Promise<Array<{
    id: string; original_filename: string; stored_filename: string; mime_type: string | null; size: number; storage_path: string; uploaded_at: Date;
  }>> {
    return mg.query(
      `SELECT id, original_filename, stored_filename, mime_type, size, storage_path, uploaded_at
         FROM application_attachments WHERE tenant_id = $1 AND application_id = $2 ORDER BY uploaded_at, id`,
      [tenantId, appId],
    );
  }

  /**
   * Copy each attachment to `files/<tenant>/technologies/<id>/<stored name>` (as an upload of the
   * technology), add its row, then remove the application's rows. Keys are recorded in `files`.
   * A file missing from storage stops the conversion with a 409 that names it.
   */
  private async copyAttachments(mg: EntityManager, tenantId: string, appId: string, techId: string, files: ConversionFiles): Promise<number> {
    const rows = await this.attachmentsOf(mg, tenantId, appId);
    for (const row of rows) {
      const stored = row.stored_filename || path.posix.basename(row.storage_path);
      const key = path.posix.join('files', tenantId, 'technologies', techId, stored);
      const obj = await this.storage.getObjectStream(row.storage_path).catch((err: any) => {
        this.logger.warn(`Conversion: attachment ${row.id} unreadable: ${err?.message || 'Unknown error'}`);
        throw new ConflictException({
          code: 'APPLICATION_CONVERSION_MISSING_FILE',
          message: `The file ${row.original_filename} is missing from storage.`,
          params: { file: row.original_filename },
        });
      });
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

  private async readApplication(applicationId: string, opts: ConversionOpts, lock: boolean): Promise<ApplicationRow> {
    const id = String(applicationId || '').trim().toLowerCase();
    if (!UUID_RE.test(id)) throw new NotFoundException('Application not found');
    const rows: ApplicationRow[] = await opts.manager.query(
      `SELECT id, name, sequential_id, editor, description, notes, lifecycle, cyber_criticality, recovery_wave,
              rto_minutes, rpo_minutes, predecessor_id, support_notes
         FROM applications WHERE tenant_id = $1 AND id = $2${lock ? ' FOR UPDATE' : ''}`,
      [opts.tenantId, id],
    );
    if (!rows[0]) throw new NotFoundException('Application not found');
    return rows[0];
  }

  /**
   * The fields the technology would refuse (`TechnologiesService.validate`): lengths, catalog
   * codes that left the catalogs, recovery times out of range.
   */
  private async invalidFields(app: ApplicationRow, opts: ConversionOpts): Promise<string[]> {
    const out: string[] = [];
    const tooLong = (value: string | null, max: number) => value != null && String(value).trim().length > max;
    if (!String(app.name ?? '').trim() || tooLong(app.name, 200)) out.push('name');
    if (tooLong(app.editor, 200)) out.push('editor');
    if (tooLong(app.description, 20000)) out.push('description');
    if (tooLong(app.notes, 20000)) out.push('notes');
    if (tooLong(app.support_notes, 20000)) out.push('support_notes');
    const [{ n: longRoles }]: Array<{ n: number }> = await opts.manager.query(
      `SELECT count(*)::int AS n FROM (${SUPPORT_CONTACTS_KEPT}) k WHERE char_length(k.role) > 200`,
      [opts.tenantId, app.id],
    );
    if (Number(longRoles) > 0) out.push('support_contact_roles');
    const settings: any = await this.itOps.getSettings(opts.tenantId, { manager: opts.manager });
    const known = (list: Array<{ code: string }> | undefined, value: string | null) =>
      value == null || value === '' || (list ?? []).some((item) => item.code === String(value).trim().toLowerCase());
    if (!known(settings.lifecycleStates, app.lifecycle)) out.push('lifecycle');
    if (!known(settings.cyberCriticalityLevels, app.cyber_criticality)) out.push('cyber_criticality');
    if (!known(settings.recoveryWaves, app.recovery_wave)) out.push('recovery_wave');
    const inRange = (value: number | null, min: number) => value == null || (Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= 5256000);
    if (!inRange(app.rto_minutes, 1)) out.push('rto_minutes');
    if (!inRange(app.rpo_minutes, 0)) out.push('rpo_minutes');
    return out;
  }

  /** The attachments whose object is missing from storage, by file name. */
  private async missingFiles(app: ApplicationRow, opts: ConversionOpts): Promise<string[]> {
    const missing: string[] = [];
    for (const row of await this.attachmentsOf(opts.manager, opts.tenantId, app.id)) {
      const head = await this.storage.headObject(row.storage_path).catch(() => null);
      if (!head) missing.push(row.original_filename);
    }
    return missing;
  }

  /** Every count in one statement, each scoped by the tenant; incidents through the visibility rule. */
  private async previewOf(app: ApplicationRow, access: ConversionAccess, viewer: IncidentViewer, opts: ConversionOpts): Promise<ConversionPreview> {
    const params: unknown[] = [opts.tenantId, app.id, app.name, app.predecessor_id];
    const visible = incidentVisibilitySql('inc', viewer, params);
    const [row]: CountRow[] = await opts.manager.query(
      `WITH inst AS (SELECT id, status, disabled_at FROM app_instances WHERE tenant_id = $1 AND application_id = $2)
       SELECT
         (SELECT count(*)::int FROM interfaces i WHERE i.tenant_id = $1 AND (i.source_application_id = $2 OR i.target_application_id = $2)) AS interfaces,
         (SELECT count(DISTINCT m.interface_id)::int FROM interface_middleware_applications m WHERE m.tenant_id = $1 AND m.application_id = $2) AS middleware,
         (SELECT count(*)::int FROM interface_bindings b WHERE b.tenant_id = $1 AND b.integration_tool_application_id = $2) AS integration_tool,
         (SELECT count(*)::int FROM application_suites s WHERE s.tenant_id = $1 AND s.suite_id = $2) AS suite_components,
         (SELECT count(*)::int FROM interface_bindings b
           WHERE b.tenant_id = $1 AND (b.source_instance_id IN (SELECT id FROM inst) OR b.target_instance_id IN (SELECT id FROM inst))) AS interface_bindings,
         (SELECT count(*)::int FROM technologies t WHERE t.tenant_id = $1 AND lower(btrim(t.name)) = lower(btrim($3))) AS name_taken,
         (SELECT count(DISTINCT (o.user_id, o.owner_type))::int FROM application_owners o
           WHERE o.tenant_id = $1 AND o.application_id = $2 AND o.owner_type IN ('business', 'it')) AS owners,
         (SELECT count(DISTINCT l.contract_id)::int FROM application_contracts l WHERE l.tenant_id = $1 AND l.application_id = $2) AS contracts,
         (SELECT count(DISTINCT l.spend_item_id)::int FROM application_spend_items l
            JOIN spend_items s ON s.tenant_id = l.tenant_id AND s.id = l.spend_item_id${naturesAnd('s', BUDGET_NATURES)}
           WHERE l.tenant_id = $1 AND l.application_id = $2) AS budget_lines,
         (SELECT count(DISTINCT l.project_id)::int FROM application_projects l WHERE l.tenant_id = $1 AND l.application_id = $2) AS projects,
         (SELECT count(*)::int FROM application_links l WHERE l.tenant_id = $1 AND l.application_id = $2 AND btrim(coalesce(l.url, '')) <> '') AS links,
         (SELECT count(*)::int FROM application_links l WHERE l.tenant_id = $1 AND l.application_id = $2 AND btrim(coalesce(l.url, '')) = '') AS links_without_url,
         (SELECT count(*)::int FROM application_attachments l WHERE l.tenant_id = $1 AND l.application_id = $2) AS attachments,
         (SELECT count(DISTINCT l.incident_id)::int FROM incident_applications l
            JOIN incidents inc ON inc.tenant_id = l.tenant_id AND inc.id = l.incident_id
           WHERE l.tenant_id = $1 AND l.application_id = $2${visible}) AS incidents,
         (SELECT count(DISTINCT aa.asset_id)::int FROM app_asset_assignments aa JOIN inst i ON i.id = aa.app_instance_id
           WHERE aa.tenant_id = $1 AND ${ACTIVE_INSTANCE}) AS servers,
         (SELECT count(DISTINCT aa.asset_id)::int FROM app_asset_assignments aa JOIN inst i ON i.id = aa.app_instance_id
           WHERE aa.tenant_id = $1 AND NOT (${ACTIVE_INSTANCE})
             AND NOT EXISTS (SELECT 1 FROM app_asset_assignments a2 JOIN inst i2 ON i2.id = a2.app_instance_id
                              WHERE a2.tenant_id = $1 AND a2.asset_id = aa.asset_id
                                AND i2.status = 'enabled' AND (i2.disabled_at IS NULL OR i2.disabled_at > now()))) AS disabled_instance_servers,
         (SELECT count(*)::int FROM inst) AS instances,
         (SELECT count(*)::int FROM application_suites s WHERE s.tenant_id = $1 AND s.application_id = $2) AS suites,
         (SELECT count(*)::int FROM applications p WHERE p.tenant_id = $1 AND p.id = $4) AS predecessor,
         (SELECT count(*)::int FROM applications p WHERE p.tenant_id = $1 AND p.predecessor_id = $2) AS successors,
         (SELECT count(*)::int FROM application_data_residency l WHERE l.tenant_id = $1 AND l.application_id = $2) AS data_residency,
         (SELECT count(DISTINCT l.contact_id)::int FROM application_support_contacts l
            JOIN contacts c ON c.tenant_id = l.tenant_id AND c.id = l.contact_id
           WHERE l.tenant_id = $1 AND l.application_id = $2) AS support_contacts,
         (SELECT count(*)::int FROM application_companies l WHERE l.tenant_id = $1 AND l.application_id = $2)
           + (SELECT count(*)::int FROM application_departments l WHERE l.tenant_id = $1 AND l.application_id = $2) AS audience,
         (SELECT count(*)::int FROM document_applications l WHERE l.tenant_id = $1 AND l.application_id = $2) AS knowledge_links,
         (SELECT count(*)::int FROM integrated_document_bindings b
           WHERE b.tenant_id = $1 AND b.source_entity_type = 'applications' AND b.source_entity_id = $2) AS managed_documents,
         (SELECT count(*)::int FROM task_applications l WHERE l.tenant_id = $1 AND l.application_id = $2) AS tasks,
         (SELECT count(*)::int FROM portfolio_request_applications l WHERE l.tenant_id = $1 AND l.application_id = $2) AS requests,
         (SELECT count(*)::int FROM application_business_processes l WHERE l.tenant_id = $1 AND l.application_id = $2) AS business_processes,
         (SELECT count(*)::int FROM application_technologies l WHERE l.tenant_id = $1 AND l.application_id = $2) AS technologies`,
      params,
    );
    const n = (key: keyof CountRow) => Number(row?.[key] ?? 0);
    const refusals: ConversionRefusal[] = COUNTED_REFUSALS.filter((reason) => n(reason as keyof CountRow) > 0)
      .map((reason) => ({ reason, count: n(reason as keyof CountRow) }));
    const fields = await this.invalidFields(app, opts);
    if (fields.length) refusals.push({ reason: 'invalid_fields', count: fields.length, fields });
    const missing = await this.missingFiles(app, opts);
    if (missing.length) refusals.push({ reason: 'missing_files', count: missing.length, files: missing });
    const readable = (allowed: boolean, key: keyof CountRow) => (allowed ? n(key) : null);
    return {
      application: { id: app.id, name: app.name, reference: app.sequential_id || null },
      mode: n('servers') > 0 ? 'installed' : 'subscribed',
      refusals,
      moves: {
        owners: n('owners'),
        support_contacts: n('support_contacts'),
        contracts: readable(access.contracts, 'contracts'),
        budget_lines: readable(access.budget_lines, 'budget_lines'),
        projects: readable(access.projects, 'projects'),
        links: n('links'),
        attachments: n('attachments'),
        incidents: readable(access.incidents, 'incidents'),
        servers: n('servers'),
      },
      unlinked: { managed_documents: n('managed_documents') },
      losses: {
        instances: n('instances'), disabled_instance_servers: n('disabled_instance_servers'), suites: n('suites'),
        predecessor: n('predecessor'), successors: n('successors'), data_residency: n('data_residency'),
        audience: n('audience'), links_without_url: n('links_without_url'),
        knowledge_links: n('knowledge_links'), tasks: n('tasks'), requests: n('requests'),
        business_processes: n('business_processes'), technologies: n('technologies'),
      },
    };
  }
}
