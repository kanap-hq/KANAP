import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { languageOf, writeCsv } from '../common/csv-sheet';
import { linkProvenance, MANUAL_PROVENANCE, provenanceParams, type LinkProvenance } from '../common/link-provenance';
import { ItOpsSettingsService } from '../it-ops-settings/it-ops-settings.service';
import { TechnologyReachService, type ReachingTechnology } from './technology-reach.service';
import { readTechnology, technologyReference, UUID_RE, versionOfInput } from './technology-rows';

export type LinkOpts = { manager: EntityManager; tenantId: string; userId?: string | null };

/** A link written by a person, or by an import, the assistant, an agent or Netbox (`common/link-provenance.ts`). */
export type LinkInput = {
  technology_version_id?: unknown;
  version_label?: unknown;
  notes?: unknown;
  source?: unknown;
  source_ref?: unknown;
  observed_at?: unknown;
};

const NOTES_MAX = 2000;

function notesOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (text.length > NOTES_MAX) throw new BadRequestException(`Notes are longer than ${NOTES_MAX} characters.`);
  return text || null;
}

function uuidOrThrow(value: unknown, message: string): string {
  const id = String(value ?? '').trim().toLowerCase();
  if (!UUID_RE.test(id)) throw new BadRequestException(message);
  return id;
}

/** The provenance of a link from the request: manual unless the caller names another source. */
function provenanceOf(body: LinkInput | undefined): LinkProvenance {
  if (!body || body.source === undefined || body.source === null || body.source === 'manual') return { ...MANUAL_PROVENANCE };
  return linkProvenance(String(body.source), body.source_ref as string | null, body.observed_at as string | null);
}

/**
 * The links of the technology layer: technologies installed on assets (`asset_technologies`),
 * technologies an application depends on (`application_technologies`) and business processes of
 * an application (`application_business_processes`). Read from either side, with what the graph
 * deduces (`TechnologyReachService`). A write locks the technology's row first (FOR NO KEY UPDATE),
 * so two writes on one technology run one after the other; it is idempotent (ON CONFLICT DO
 * NOTHING on the NULLS NOT DISTINCT key) and audited on the link table, `recordId` the technology.
 * A manual write of an existing link resets its provenance to manual.
 */
@Injectable()
export class TechnologyLinksService {
  constructor(
    private readonly audit: AuditService,
    private readonly reach: TechnologyReachService,
    private readonly itOps: ItOpsSettingsService,
  ) {}

  // ==================== ASSETS ====================

  /** The servers of a technology: installed (with the link) and carried through the graph (with `via`). */
  async assetsOfTechnology(idOrRef: string, opts: LinkOpts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef);
    const reached = await this.reach.assetsOfTechnologies(mg, tenantId, [tech.id]);
    const assets = await this.assetLabels(mg, tenantId, reached.flatMap((r) => [r.asset_id, r.via_asset_id]));
    const versions = await this.versionLabels(mg, tenantId, reached.map((r) => r.technology_version_id));
    const notes = await this.linkNotes(mg, tenantId, 'asset', reached.map((r) => r.link_id));
    const osLabels = await this.operatingSystemLabels(mg, tenantId);
    const items = reached.map((r) => {
      const asset = assets.get(r.asset_id);
      return {
        link_id: r.link_id,
        kind: r.via_asset_id ? 'carried' as const : 'installed' as const,
        asset_id: r.asset_id,
        asset_name: asset?.name ?? null,
        asset_reference: asset?.asset_reference ?? null,
        asset_kind: asset?.kind ?? null,
        is_cluster: asset?.is_cluster ?? false,
        environment: asset?.environment ?? null,
        operating_system: asset?.operating_system ?? null,
        operating_system_label: asset?.operating_system ? osLabels.get(asset.operating_system) ?? asset.operating_system : null,
        via_asset_id: r.via_asset_id,
        via_asset_name: r.via_asset_id ? assets.get(r.via_asset_id)?.name ?? null : null,
        technology_version_id: r.technology_version_id,
        version_label: r.technology_version_id ? versions.get(r.technology_version_id) ?? null : null,
        notes: r.link_id ? notes.get(r.link_id) ?? null : null,
        source: r.source,
        depth: r.depth,
      };
    });
    items.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'installed' ? -1 : 1)
      || String(a.asset_name ?? '').localeCompare(String(b.asset_name ?? ''), 'en', { sensitivity: 'base' })
      || String(a.version_label ?? '').localeCompare(String(b.version_label ?? '')));
    return { items };
  }

  /** The technologies of an asset: installed on it (removable) and carried to it (with `via`). */
  async technologiesOfAsset(assetId: string, opts: LinkOpts) {
    const { manager: mg, tenantId } = opts;
    const asset = await this.readAsset(mg, tenantId, assetId);
    const rows = await this.reach.technologiesOfAssets(mg, tenantId, [asset.id]);
    return { items: await this.presentReaching(mg, tenantId, rows, 'asset') };
  }

  /**
   * Install the technology on an asset, with a version (id, or a label resolved and created when
   * missing) or none. Writing an existing link changes its notes and provenance only.
   */
  async addAssetLink(idOrRef: string, assetId: string, body: LinkInput, opts: LinkOpts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef, true);
    const asset = await this.readAsset(mg, tenantId, assetId);
    const versionId = await versionOfInput(mg, tenantId, tech.id, body ?? {});
    const provenance = provenanceOf(body);
    const notes = notesOf(body?.notes);
    const rows: Array<{ id: string; inserted: boolean }> = await mg.query(
      `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id, notes, source, source_ref, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT ON CONSTRAINT asset_technologies_key DO UPDATE
         SET notes = COALESCE(EXCLUDED.notes, asset_technologies.notes), source = EXCLUDED.source,
             source_ref = EXCLUDED.source_ref, observed_at = EXCLUDED.observed_at, updated_at = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [tenantId, asset.id, tech.id, versionId, notes, ...provenanceParams(provenance)],
    );
    if (rows[0]?.inserted) {
      await this.audit.log({
        table: 'asset_technologies', recordId: tech.id, action: 'create', before: null,
        after: { link_id: rows[0].id, asset_id: asset.id, technology_version_id: versionId, source: provenance.source }, userId: opts.userId ?? null,
      }, { manager: mg });
    }
    return { ok: true, link_id: rows[0]?.id ?? null, created: !!rows[0]?.inserted };
  }

  /** Change the version or the notes of an installed link: a person wrote it, it becomes manual. */
  async updateAssetLink(idOrRef: string, linkId: string, body: LinkInput, opts: LinkOpts) {
    return this.updateLink('asset', idOrRef, linkId, body, opts);
  }

  async removeAssetLink(idOrRef: string, linkId: string, opts: LinkOpts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef, true);
    return this.deleteLinkRow('asset', tech.id, linkId, opts);
  }

  /** From the asset's side: the link must be one of this asset. */
  async removeAssetLinkOfAsset(assetId: string, linkId: string, opts: LinkOpts) {
    const { manager: mg, tenantId } = opts;
    const asset = await this.readAsset(mg, tenantId, assetId);
    const id = uuidOrThrow(linkId, 'Link not found.');
    const rows: Array<{ technology_id: string }> = await mg.query(
      `SELECT technology_id FROM asset_technologies WHERE tenant_id = $1 AND asset_id = $2 AND id = $3`,
      [tenantId, asset.id, id],
    );
    if (!rows[0]) return { ok: true, changed: false };
    await readTechnology(mg, tenantId, rows[0].technology_id, true);
    return this.deleteLinkRow('asset', rows[0].technology_id, id, opts);
  }

  // ==================== APPLICATIONS ====================

  /**
   * The applications of a technology: hosted on a server that carries it (per environment, server
   * and version, with `via` when the server only carries it) and declared. With the application's
   * reference, criticality, external exposure and IT owners.
   */
  async applicationsOfTechnology(idOrRef: string, opts: LinkOpts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef);
    const rows = await this.reach.applicationsOfTechnologies(mg, tenantId, [tech.id]);
    const apps = await this.applicationLabels(mg, tenantId, rows.map((r) => r.application_id));
    const assets = await this.assetLabels(mg, tenantId, rows.flatMap((r) => [r.asset_id, r.via_asset_id]));
    const versions = await this.versionLabels(mg, tenantId, rows.map((r) => r.technology_version_id));
    const notes = await this.linkNotes(mg, tenantId, 'application', rows.map((r) => r.link_id));
    const items = rows.map((r) => {
      const app = apps.get(r.application_id);
      return {
        kind: r.kind,
        link_id: r.link_id,
        application_id: r.application_id,
        application_name: app?.name ?? null,
        application_reference: app?.sequential_id ?? null,
        criticality: app?.criticality ?? null,
        external_facing: app?.external_facing ?? false,
        lifecycle: app?.lifecycle ?? null,
        it_owner_names: app?.it_owner_names ?? [],
        environment: r.environment,
        asset_id: r.asset_id,
        asset_name: r.asset_id ? assets.get(r.asset_id)?.name ?? null : null,
        via_asset_id: r.via_asset_id,
        via_asset_name: r.via_asset_id ? assets.get(r.via_asset_id)?.name ?? null : null,
        technology_version_id: r.technology_version_id,
        version_label: r.technology_version_id ? versions.get(r.technology_version_id) ?? null : null,
        notes: r.link_id ? notes.get(r.link_id) ?? null : null,
        source: r.source,
      };
    });
    items.sort((a, b) => String(a.application_name ?? '').localeCompare(String(b.application_name ?? ''), 'en', { sensitivity: 'base' })
      || (a.kind === b.kind ? 0 : a.kind === 'declared' ? 1 : -1)
      || String(a.environment ?? '').localeCompare(String(b.environment ?? ''))
      || String(a.asset_name ?? '').localeCompare(String(b.asset_name ?? '')));
    return { technology: { id: tech.id, name: tech.name, reference: technologyReference(tech.item_number) }, items };
  }

  /** The Applications tab as a file to send to the teams: one line per row of the tab. */
  async applicationsCsv(idOrRef: string, language: unknown, opts: LinkOpts): Promise<{ filename: string; content: string }> {
    const { technology, items } = await this.applicationsOfTechnology(idOrRef, opts);
    const headers = ['Reference', 'Application', 'Link', 'Environment', 'Server', 'Installed on', 'Version', 'Criticality', 'External facing', 'IT owners', 'Notes'];
    const rows = items.map((item) => [
      item.application_reference ?? '',
      item.application_name ?? '',
      item.kind === 'declared' ? 'Declared' : 'Hosted',
      item.environment ?? '',
      item.asset_name ?? '',
      item.via_asset_name ?? '',
      item.version_label ?? 'Unknown',
      item.criticality ?? '',
      item.external_facing ? 'Yes' : 'No',
      item.it_owner_names.join(', '),
      item.notes ?? '',
    ]);
    const safeName = String(technology.reference ?? 'technology').replace(/[^A-Za-z0-9_-]/g, '_');
    return { filename: `${safeName}_applications.csv`, content: writeCsv({ language: await languageOf(opts.manager, opts.tenantId, opts.userId ?? null, language), headers, rows }) };
  }

  /** Declare the technology on several applications at once (no version, manual). Idempotent. */
  async addApplications(idOrRef: string, applicationIds: unknown, opts: LinkOpts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef, true);
    const ids = Array.from(new Set((Array.isArray(applicationIds) ? applicationIds : []).map((id) => uuidOrThrow(id, 'One or more applications not found.'))));
    if (ids.length === 0) return { ok: true, added: 0 };
    if (ids.length > 500) throw new BadRequestException('At most 500 applications at once.');
    const found = await mg.query(`SELECT id FROM applications WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, ids]);
    if (found.length !== ids.length) throw new BadRequestException('One or more applications not found.');
    const inserted: Array<{ application_id: string }> = await mg.query(
      `INSERT INTO application_technologies (tenant_id, application_id, technology_id)
       SELECT $1, a, $2 FROM unnest($3::uuid[]) AS a
       ON CONFLICT ON CONSTRAINT application_technologies_key DO NOTHING
       RETURNING application_id`,
      [tenantId, tech.id, ids],
    );
    if (inserted.length) {
      await this.audit.log({
        table: 'application_technologies', recordId: tech.id, action: 'update',
        before: null, after: { added: inserted.map((r) => r.application_id).sort() }, userId: opts.userId ?? null,
      }, { manager: mg });
    }
    return { ok: true, added: inserted.length };
  }

  /** Remove every declaration of the technology by the application (all versions). */
  async removeApplication(idOrRef: string, applicationId: string, opts: LinkOpts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef, true);
    const appId = uuidOrThrow(applicationId, 'Application not found.');
    const removed: Array<{ id: string }> = await mg.query(
      `DELETE FROM application_technologies WHERE tenant_id = $1 AND technology_id = $2 AND application_id = $3 RETURNING id`,
      [tenantId, tech.id, appId],
    );
    if (removed.length) {
      await this.audit.log({
        table: 'application_technologies', recordId: tech.id, action: 'update',
        before: { removed: [appId] }, after: null, userId: opts.userId ?? null,
      }, { manager: mg });
    }
    return { ok: true, removed: removed.length };
  }

  async updateApplicationLink(idOrRef: string, linkId: string, body: LinkInput, opts: LinkOpts) {
    return this.updateLink('application', idOrRef, linkId, body, opts);
  }

  // ==================== APPLICATION SIDE (for lot T2) ====================

  /**
   * The technologies of an application, for its Relations tab: declared (removable, with the link)
   * and hosted (through a server, "via" the asset that carries it; not removable). The application
   * must exist in the tenant; its visibility (participation scope) is the caller's check.
   */
  async technologiesOfApplication(applicationId: string, opts: LinkOpts) {
    const { manager: mg, tenantId } = opts;
    const appId = await this.readApplicationId(mg, tenantId, applicationId);
    const rows = await this.reach.technologiesOfApplications(mg, tenantId, [appId]);
    return { items: await this.presentReaching(mg, tenantId, rows, 'application') };
  }

  /**
   * Declare (`add`) or withdraw a technology for an application, from the application's side. A
   * declaration names a version or none; withdrawing removes every declaration of the technology
   * by the application. Locks the technology's row like every other write of these links.
   */
  async setApplicationTechnology(
    applicationId: string,
    technologyIdOrRef: string,
    add: boolean,
    body: LinkInput,
    opts: LinkOpts,
  ): Promise<{ ok: true; changed: boolean; link_id?: string | null }> {
    const { manager: mg, tenantId } = opts;
    const appId = await this.readApplicationId(mg, tenantId, applicationId);
    const tech = await readTechnology(mg, tenantId, technologyIdOrRef, true);
    if (!add) {
      const res = await this.removeApplication(tech.id, appId, opts);
      return { ok: true, changed: res.removed > 0 };
    }
    const versionId = await versionOfInput(mg, tenantId, tech.id, body ?? {});
    const provenance = provenanceOf(body);
    const rows: Array<{ id: string; inserted: boolean }> = await mg.query(
      `INSERT INTO application_technologies (tenant_id, application_id, technology_id, technology_version_id, notes, source, source_ref, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT ON CONSTRAINT application_technologies_key DO UPDATE
         SET notes = COALESCE(EXCLUDED.notes, application_technologies.notes), source = EXCLUDED.source,
             source_ref = EXCLUDED.source_ref, observed_at = EXCLUDED.observed_at, updated_at = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [tenantId, appId, tech.id, versionId, notesOf(body?.notes), ...provenanceParams(provenance)],
    );
    if (rows[0]?.inserted) {
      await this.audit.log({
        table: 'application_technologies', recordId: tech.id, action: 'update',
        before: null, after: { added: [appId], technology_version_id: versionId, source: provenance.source }, userId: opts.userId ?? null,
      }, { manager: mg });
    }
    return { ok: true, changed: !!rows[0]?.inserted, link_id: rows[0]?.id ?? null };
  }

  // ==================== BUSINESS PROCESSES ====================

  /** The business processes of an application (lot T2: its Relations tab). */
  async processesOfApplication(applicationId: string, opts: LinkOpts) {
    const { manager: mg, tenantId } = opts;
    const appId = await this.readApplicationId(mg, tenantId, applicationId);
    const items = await mg.query(
      `SELECT p.id, p.name, p.status::text AS status, l.created_at
         FROM application_business_processes l
         JOIN business_processes p ON p.id = l.business_process_id AND p.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.application_id = $2
        ORDER BY lower(p.name), p.id`,
      [tenantId, appId],
    );
    return { items };
  }

  /** The applications of a business process. */
  async applicationsOfProcess(processId: string, opts: LinkOpts) {
    const { manager: mg, tenantId } = opts;
    const process = await this.readProcessId(mg, tenantId, processId, false);
    const items = await mg.query(
      `SELECT a.id, a.name, a.sequential_id AS reference, a.criticality, a.lifecycle, l.created_at
         FROM application_business_processes l
         JOIN applications a ON a.id = l.application_id AND a.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.business_process_id = $2
        ORDER BY lower(a.name), a.id`,
      [tenantId, process],
    );
    return { items };
  }

  /**
   * Link (`add`) or unlink an application and a business process. The process's row is locked
   * first; idempotent; audited on the link table, `recordId` the process.
   */
  async setProcessApplication(processId: string, applicationId: string, add: boolean, opts: LinkOpts): Promise<{ ok: true; changed: boolean }> {
    const { manager: mg, tenantId } = opts;
    const process = await this.readProcessId(mg, tenantId, processId, true);
    const appId = await this.readApplicationId(mg, tenantId, applicationId, BadRequestException);
    const rows = add
      ? await mg.query(
        `INSERT INTO application_business_processes (tenant_id, application_id, business_process_id) VALUES ($1, $2, $3)
         ON CONFLICT ON CONSTRAINT application_business_processes_key DO NOTHING RETURNING id`,
        [tenantId, appId, process],
      )
      : await mg.query(
        `DELETE FROM application_business_processes WHERE tenant_id = $1 AND application_id = $2 AND business_process_id = $3 RETURNING id`,
        [tenantId, appId, process],
      );
    const changed = rows.length > 0;
    if (changed) {
      await this.audit.log({
        table: 'application_business_processes', recordId: process, action: 'update',
        before: add ? null : { application_id: appId }, after: add ? { application_id: appId } : null, userId: opts.userId ?? null,
      }, { manager: mg });
    }
    return { ok: true, changed };
  }

  // ==================== SHARED ====================

  private async updateLink(side: 'asset' | 'application', idOrRef: string, linkId: string, body: LinkInput, opts: LinkOpts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef, true);
    const id = uuidOrThrow(linkId, 'Link not found.');
    const table = `${side}_technologies`;
    const rows: Array<{ id: string; technology_version_id: string | null; notes: string | null }> = await mg.query(
      `SELECT id, technology_version_id, notes FROM ${table} WHERE tenant_id = $1 AND technology_id = $2 AND id = $3`,
      [tenantId, tech.id, id],
    );
    if (!rows[0]) throw new NotFoundException('Link not found');
    const before = rows[0];
    const versionGiven = body && ('technology_version_id' in body || 'version_label' in body);
    const versionId = versionGiven ? await versionOfInput(mg, tenantId, tech.id, body) : before.technology_version_id;
    const notes = body && 'notes' in body ? notesOf(body.notes) : before.notes;
    try {
      await mg.query('SAVEPOINT technology_link_update');
      await mg.query(
        `UPDATE ${table} SET technology_version_id = $4, notes = $5, source = 'manual', source_ref = NULL, observed_at = NULL, updated_at = now()
          WHERE tenant_id = $1 AND technology_id = $2 AND id = $3`,
        [tenantId, tech.id, id, versionId, notes],
      );
      await mg.query('RELEASE SAVEPOINT technology_link_update');
    } catch (error: any) {
      await mg.query('ROLLBACK TO SAVEPOINT technology_link_update');
      if ((error?.code ?? error?.driverError?.code) === '23505') throw new BadRequestException('This version is already linked.');
      throw error;
    }
    await this.audit.log({
      table, recordId: tech.id, action: 'update', before, after: { id, technology_version_id: versionId, notes }, userId: opts.userId ?? null,
    }, { manager: mg });
    return { ok: true };
  }

  private async deleteLinkRow(side: 'asset' | 'application', technologyId: string, linkId: string, opts: LinkOpts) {
    const { manager: mg, tenantId } = opts;
    const id = uuidOrThrow(linkId, 'Link not found.');
    const table = `${side}_technologies`;
    const removed: Array<Record<string, unknown>> = await mg.query(
      `DELETE FROM ${table} WHERE tenant_id = $1 AND technology_id = $2 AND id = $3
       RETURNING id, ${side}_id, technology_version_id, source`,
      [tenantId, technologyId, id],
    );
    if (removed.length) {
      await this.audit.log({ table, recordId: technologyId, action: 'delete', before: removed[0], after: null, userId: opts.userId ?? null }, { manager: mg });
    }
    return { ok: true, changed: removed.length > 0 };
  }

  private async presentReaching(mg: EntityManager, tenantId: string, rows: ReachingTechnology[], subject: 'asset' | 'application') {
    const techIds = Array.from(new Set(rows.map((r) => r.technology_id)));
    const techs: Array<{ id: string; name: string; item_number: number; family: string; editor: string | null; mode: string }> = techIds.length
      ? await mg.query(`SELECT id, name, item_number, family, editor, mode FROM technologies WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, techIds])
      : [];
    const byId = new Map(techs.map((t) => [t.id, t]));
    const assets = await this.assetLabels(mg, tenantId, rows.flatMap((r) => [r.asset_id, r.via_asset_id]));
    const versions = await this.versionLabels(mg, tenantId, rows.map((r) => r.technology_version_id));
    const versionDates = await this.versionDates(mg, tenantId, rows.map((r) => r.technology_version_id));
    const notes = await this.linkNotes(mg, tenantId, subject, rows.map((r) => (r.kind === 'installed' || r.kind === 'declared' ? r.link_id : null)));
    const items = rows.map((r) => {
      const tech = byId.get(r.technology_id);
      const removable = (subject === 'asset' && r.kind === 'installed') || (subject === 'application' && r.kind === 'declared');
      return {
        kind: r.kind,
        removable,
        link_id: removable ? r.link_id : null,
        technology_id: r.technology_id,
        technology_name: tech?.name ?? null,
        technology_reference: technologyReference(tech?.item_number),
        family: tech?.family ?? null,
        editor: tech?.editor ?? null,
        mode: tech?.mode ?? null,
        technology_version_id: r.technology_version_id,
        version_label: r.technology_version_id ? versions.get(r.technology_version_id) ?? null : null,
        standard_support_end: r.technology_version_id ? versionDates.get(r.technology_version_id) ?? null : null,
        environment: r.environment,
        asset_id: r.asset_id,
        asset_name: r.asset_id ? assets.get(r.asset_id)?.name ?? null : null,
        via_asset_id: r.via_asset_id,
        via_asset_name: r.via_asset_id ? assets.get(r.via_asset_id)?.name ?? null : null,
        notes: removable && r.link_id ? notes.get(r.link_id) ?? null : null,
        source: r.source,
      };
    });
    const order: Record<string, number> = { installed: 0, declared: 0, carried: 1, hosted: 1 };
    items.sort((a, b) => order[a.kind] - order[b.kind]
      || String(a.technology_name ?? '').localeCompare(String(b.technology_name ?? ''), 'en', { sensitivity: 'base' })
      || String(a.environment ?? '').localeCompare(String(b.environment ?? ''))
      || String(a.asset_name ?? '').localeCompare(String(b.asset_name ?? '')));
    return items;
  }

  private async readAsset(mg: EntityManager, tenantId: string, assetId: string) {
    const id = String(assetId || '').trim().toLowerCase();
    const rows: Array<{ id: string }> = UUID_RE.test(id)
      ? await mg.query(`SELECT id FROM assets WHERE tenant_id = $1 AND id = $2`, [tenantId, id])
      : await mg.query(`SELECT id FROM assets WHERE tenant_id = $1 AND upper(asset_reference) = upper($2)`, [tenantId, String(assetId || '').trim()]);
    if (!rows[0]) throw new NotFoundException('Asset not found');
    return rows[0];
  }

  private async readApplicationId(
    mg: EntityManager,
    tenantId: string,
    applicationId: string,
    error: new (message: string) => Error = NotFoundException,
  ): Promise<string> {
    const raw = String(applicationId || '').trim();
    const rows: Array<{ id: string }> = UUID_RE.test(raw)
      ? await mg.query(`SELECT id FROM applications WHERE tenant_id = $1 AND id = $2`, [tenantId, raw.toLowerCase()])
      : /^APP-\d+$/i.test(raw)
        ? await mg.query(`SELECT id FROM applications WHERE tenant_id = $1 AND upper(sequential_id) = upper($2)`, [tenantId, raw])
        : [];
    if (!rows[0]) throw new error('Application not found');
    return rows[0].id;
  }

  private async readProcessId(mg: EntityManager, tenantId: string, processId: string, lock: boolean): Promise<string> {
    const id = String(processId || '').trim().toLowerCase();
    if (!UUID_RE.test(id)) throw new NotFoundException('Business process not found');
    const rows = await mg.query(
      `SELECT id FROM business_processes WHERE tenant_id = $1 AND id = $2${lock ? ' FOR NO KEY UPDATE' : ''}`,
      [tenantId, id],
    );
    if (!rows[0]) throw new NotFoundException('Business process not found');
    return rows[0].id;
  }

  private async assetLabels(mg: EntityManager, tenantId: string, ids: Array<string | null>) {
    const wanted = Array.from(new Set(ids.filter((id): id is string => !!id)));
    const rows: Array<{ id: string; name: string; asset_reference: string | null; kind: string; environment: string | null; operating_system: string | null; is_cluster: boolean }> = wanted.length
      ? await mg.query(
        `SELECT id, name, asset_reference, kind, environment, operating_system, COALESCE(is_cluster, false) AS is_cluster
           FROM assets WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, wanted],
      )
      : [];
    return new Map(rows.map((row) => [row.id, row]));
  }

  private async applicationLabels(mg: EntityManager, tenantId: string, ids: string[]) {
    const wanted = Array.from(new Set(ids));
    const rows: Array<{ id: string; name: string; sequential_id: string | null; criticality: string | null; external_facing: boolean; lifecycle: string | null; it_owner_names: string[] }> = wanted.length
      ? await mg.query(
        `SELECT a.id, a.name, a.sequential_id, a.criticality, COALESCE(a.external_facing, false) AS external_facing, a.lifecycle,
                ARRAY(
                  SELECT NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '')
                    FROM application_owners o JOIN users u ON u.id = o.user_id AND u.tenant_id = o.tenant_id
                   WHERE o.tenant_id = a.tenant_id AND o.application_id = a.id AND o.owner_type = 'it'
                   ORDER BY lower(u.last_name), lower(u.first_name), u.id
                ) AS it_owner_names
           FROM applications a WHERE a.tenant_id = $1 AND a.id = ANY($2::uuid[])`,
        [tenantId, wanted],
      )
      : [];
    return new Map(rows.map((row) => [row.id, { ...row, it_owner_names: (row.it_owner_names ?? []).filter(Boolean) }]));
  }

  private async versionLabels(mg: EntityManager, tenantId: string, ids: Array<string | null>) {
    const wanted = Array.from(new Set(ids.filter((id): id is string => !!id)));
    const rows: Array<{ id: string; label: string }> = wanted.length
      ? await mg.query(`SELECT id, label FROM technology_versions WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, wanted])
      : [];
    return new Map(rows.map((row) => [row.id, row.label]));
  }

  private async versionDates(mg: EntityManager, tenantId: string, ids: Array<string | null>) {
    const wanted = Array.from(new Set(ids.filter((id): id is string => !!id)));
    const rows: Array<{ id: string; day: string | null }> = wanted.length
      ? await mg.query(
        `SELECT id, to_char(standard_support_end, 'YYYY-MM-DD') AS day FROM technology_versions WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, wanted],
      )
      : [];
    return new Map(rows.map((row) => [row.id, row.day]));
  }

  private async linkNotes(mg: EntityManager, tenantId: string, side: 'asset' | 'application', ids: Array<string | null>) {
    const wanted = Array.from(new Set(ids.filter((id): id is string => !!id)));
    const rows: Array<{ id: string; notes: string | null }> = wanted.length
      ? await mg.query(`SELECT id, notes FROM ${side}_technologies WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, wanted])
      : [];
    return new Map(rows.map((row) => [row.id, row.notes]));
  }

  private async operatingSystemLabels(mg: EntityManager, tenantId: string): Promise<Map<string, string>> {
    const settings = await this.itOps.getSettings(tenantId, { manager: mg });
    return new Map((settings.operatingSystems ?? []).map((os) => [os.code, os.label]));
  }
}
