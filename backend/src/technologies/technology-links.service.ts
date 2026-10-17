import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { applicationParticipantCondition, type ParticipationAccessScope } from '../auth/business-contributor-scope';
import { languageOf, writeCsv } from '../common/csv-sheet';
import { MANUAL_PROVENANCE, provenanceParams, type LinkProvenance } from '../common/link-provenance';
import { withSavepoint } from '../common/savepoint.util';
import { ItOpsSettingsService } from '../it-ops-settings/it-ops-settings.service';
import { assetInServiceSql, TechnologyReachService, type ReachedAsset, type ReachingTechnology } from './technology-reach.service';
import { readTechnology, technologyReference, UUID_RE, versionOfInput } from './technology-rows';

export type LinkOpts = { manager: EntityManager; tenantId: string; userId?: string | null };

/**
 * What a caller may see of the applications: none (`null`: no `applications` read right), or all
 * of them, or, for a Business Contributor, those of its participation scope.
 */
export type ApplicationsReach = { scope?: ParticipationAccessScope } | null;

/** What a person types for a link. The provenance is not in it: the routes write manual links. */
export type LinkInput = {
  technology_version_id?: unknown;
  version_label?: unknown;
  notes?: unknown;
};

type LinkSide = 'asset' | 'application';

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

/**
 * The links of the technology layer: technologies installed on assets (`asset_technologies`),
 * technologies an application depends on (`application_technologies`) and business processes of
 * an application (`application_business_processes`). Read from either side, with what the graph
 * deduces (`TechnologyReachService`). A write locks the technology's row first (FOR NO KEY UPDATE),
 * so two writes on one technology run one after the other; it is idempotent (ON CONFLICT on the
 * NULLS NOT DISTINCT key) and audited on the link table, `recordId` the technology. The routes write
 * manual links; another provenance (`common/link-provenance.ts`) is a parameter of the services, for
 * imports, the assistant and agents. A manual write of an existing link makes it manual again.
 * Applications show only to a caller who reads them, within a Business Contributor's scope.
 */
@Injectable()
export class TechnologyLinksService {
  constructor(
    private readonly audit: AuditService,
    private readonly reach: TechnologyReachService,
    private readonly itOps: ItOpsSettingsService,
  ) {}

  // ==================== ASSETS ====================

  /**
   * The servers of a technology: installed (with the link) and carried through the graph (with
   * `via`). A link to a retired asset stays listed, to be seen and removed, with `asset_status`; it
   * takes no part in the deductions.
   */
  async assetsOfTechnology(idOrRef: string, opts: LinkOpts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef);
    const retired: ReachedAsset[] = await mg.query(
      `SELECT at.technology_id, at.asset_id, NULL::uuid AS via_asset_id, at.technology_version_id, at.id AS link_id, at.source, 0 AS depth
         FROM asset_technologies at
         JOIN assets a ON a.tenant_id = $1 AND a.id = at.asset_id AND NOT (${assetInServiceSql('a')})
        WHERE at.tenant_id = $1 AND at.technology_id = $2`,
      [tenantId, tech.id],
    );
    const reached = [...await this.reach.assetsOfTechnologies(mg, tenantId, [tech.id]), ...retired.map((r) => ({ ...r, depth: 0 }))];
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
        asset_status: asset?.status ?? null,
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

  /**
   * The technologies of an asset: installed on it (removable) and carried to it (with `via`). A
   * retired asset carries nothing: it lists its own links only, to be seen and removed.
   */
  async technologiesOfAsset(assetId: string, opts: LinkOpts) {
    const { manager: mg, tenantId } = opts;
    const asset = await this.readAsset(mg, tenantId, assetId);
    const retired: ReachingTechnology[] = await mg.query(
      `SELECT at.asset_id AS subject_id, at.technology_id, 'installed' AS kind, at.technology_version_id,
              NULL::text AS environment, NULL::uuid AS asset_id, NULL::uuid AS via_asset_id, at.id AS link_id, at.source
         FROM asset_technologies at
         JOIN assets a ON a.tenant_id = $1 AND a.id = at.asset_id AND NOT (${assetInServiceSql('a')})
        WHERE at.tenant_id = $1 AND at.asset_id = $2`,
      [tenantId, asset.id],
    );
    const rows = [...await this.reach.technologiesOfAssets(mg, tenantId, [asset.id]), ...retired];
    return { items: await this.presentReaching(mg, tenantId, rows, 'asset') };
  }

  /**
   * Install the technology on an asset, with a version (id, or a label resolved and created when
   * missing) or none. Writing an existing link changes its notes and provenance only.
   */
  async addAssetLink(idOrRef: string, assetId: string, body: LinkInput, opts: LinkOpts, provenance: LinkProvenance = MANUAL_PROVENANCE) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef, true);
    const asset = await this.readAsset(mg, tenantId, assetId);
    const versionId = await versionOfInput(mg, tenantId, tech.id, body ?? {});
    return this.upsertLink('asset', tech.id, asset.id, versionId, notesOf(body?.notes), provenance, opts);
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
   * reference, criticality, external exposure and IT owners; `items` is null for a caller who
   * cannot read applications, and holds a Business Contributor's applications only.
   */
  async applicationsOfTechnology(idOrRef: string, opts: LinkOpts, applications: ApplicationsReach) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef);
    const technology = { id: tech.id, name: tech.name, reference: technologyReference(tech.item_number) };
    if (!applications) return { technology, items: null };
    const all = await this.reach.applicationsOfTechnologies(mg, tenantId, [tech.id]);
    const visible = await this.visibleApplicationIds(mg, tenantId, all.map((r) => r.application_id), applications.scope);
    const rows = all.filter((r) => visible.has(r.application_id));
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
    return { technology, items };
  }

  /** The Applications tab as a file to send to the teams: one line per row of the tab. */
  async applicationsCsv(idOrRef: string, language: unknown, opts: LinkOpts, applications: { scope?: ParticipationAccessScope }): Promise<{ filename: string; content: string }> {
    const { technology, items } = await this.applicationsOfTechnology(idOrRef, opts, applications);
    const headers = ['Reference', 'Application', 'Link', 'Environment', 'Server', 'Installed on', 'Version', 'Criticality', 'External facing', 'IT owners', 'Notes'];
    const rows = (items ?? []).map((item) => [
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

  /**
   * Declare the technology on several applications at once (no version, manual). Idempotent. Every
   * id must name an application the caller reads (400 otherwise).
   */
  async addApplications(idOrRef: string, applicationIds: unknown, opts: LinkOpts, applications: { scope?: ParticipationAccessScope }) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef, true);
    const ids = Array.from(new Set((Array.isArray(applicationIds) ? applicationIds : []).map((id) => uuidOrThrow(id, 'One or more applications not found.'))));
    if (ids.length === 0) return { ok: true, added: 0 };
    if (ids.length > 500) throw new BadRequestException('At most 500 applications at once.');
    const visible = await this.visibleApplicationIds(mg, tenantId, ids, applications.scope);
    if (visible.size !== ids.length) throw new BadRequestException('One or more applications not found.');
    const [{ added }]: Array<{ added: string[] }> = await mg.query(
      `WITH ins AS (
         INSERT INTO application_technologies (tenant_id, application_id, technology_id)
         SELECT $1, a, $2 FROM unnest($3::uuid[]) AS a
         ON CONFLICT ON CONSTRAINT application_technologies_key DO NOTHING
         RETURNING application_id
       )
       SELECT COALESCE(array_agg(application_id::text ORDER BY application_id), '{}') AS added FROM ins`,
      [tenantId, tech.id, ids],
    );
    if (added.length) {
      await this.audit.log({
        table: 'application_technologies', recordId: tech.id, action: 'update',
        before: null, after: { added }, userId: opts.userId ?? null,
      }, { manager: mg });
    }
    return { ok: true, added: added.length };
  }

  /** Remove every declaration of the technology by the application (all versions). */
  async removeApplication(idOrRef: string, applicationId: string, opts: LinkOpts, applications: { scope?: ParticipationAccessScope }) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef, true);
    const appId = uuidOrThrow(applicationId, 'Application not found.');
    const visible = await this.visibleApplicationIds(mg, tenantId, [appId], applications.scope);
    if (!visible.has(appId)) throw new BadRequestException('Application not found.');
    const removed = await this.deleteDeclarations(mg, tenantId, tech.id, appId);
    if (removed.length) {
      await this.audit.log({
        table: 'application_technologies', recordId: tech.id, action: 'update',
        before: { removed }, after: null, userId: opts.userId ?? null,
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
   * by the application. Locks the technology's row like every other write of these links. The
   * application's visibility is the caller's check.
   */
  async setApplicationTechnology(
    applicationId: string,
    technologyIdOrRef: string,
    add: boolean,
    body: LinkInput,
    opts: LinkOpts,
    provenance: LinkProvenance = MANUAL_PROVENANCE,
  ): Promise<{ ok: true; changed: boolean; link_id?: string | null }> {
    const { manager: mg, tenantId } = opts;
    const appId = await this.readApplicationId(mg, tenantId, applicationId);
    const tech = await readTechnology(mg, tenantId, technologyIdOrRef, true);
    if (!add) {
      const removed = await this.deleteDeclarations(mg, tenantId, tech.id, appId);
      if (removed.length) {
        await this.audit.log({
          table: 'application_technologies', recordId: tech.id, action: 'update',
          before: { removed }, after: null, userId: opts.userId ?? null,
        }, { manager: mg });
      }
      return { ok: true, changed: removed.length > 0 };
    }
    const versionId = await versionOfInput(mg, tenantId, tech.id, body ?? {});
    const res = await this.upsertLink('application', tech.id, appId, versionId, notesOf(body?.notes), provenance, opts);
    return { ok: true, changed: res.changed, link_id: res.link_id };
  }

  // ==================== BUSINESS PROCESSES ====================

  /** The business processes of an application, with their business owner (lot T2: its Relations tab). */
  async processesOfApplication(applicationId: string, opts: LinkOpts) {
    const { manager: mg, tenantId } = opts;
    const appId = await this.readApplicationId(mg, tenantId, applicationId);
    const items = await mg.query(
      `SELECT p.id, p.name, p.status::text AS status,
              NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '') AS owner_name, l.created_at
         FROM application_business_processes l
         JOIN business_processes p ON p.id = l.business_process_id AND p.tenant_id = l.tenant_id
         LEFT JOIN users u ON u.id = p.owner_user_id AND u.tenant_id = p.tenant_id
        WHERE l.tenant_id = $1 AND l.application_id = $2
        ORDER BY lower(p.name), p.id`,
      [tenantId, appId],
    );
    return { items };
  }

  /** The applications of a business process the caller reads, with their IT owners; `items` null without the right. */
  async applicationsOfProcess(processId: string, opts: LinkOpts, applications: ApplicationsReach) {
    const { manager: mg, tenantId } = opts;
    const process = await this.readProcessId(mg, tenantId, processId, false);
    if (!applications) return { items: null };
    const params: unknown[] = [tenantId, process];
    const scopeSql = applications.scope ? (params.push(applications.scope.userId), `AND ${applicationParticipantCondition('a', `$${params.length}`)}`) : '';
    const rows: Array<{ id: string }> = await mg.query(
      `SELECT a.id, a.name, a.sequential_id AS reference, a.criticality, a.lifecycle, l.created_at
         FROM application_business_processes l
         JOIN applications a ON a.id = l.application_id AND a.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.business_process_id = $2 ${scopeSql}
        ORDER BY lower(a.name), a.id`,
      params,
    );
    const labels = await this.applicationLabels(mg, tenantId, rows.map((row) => row.id));
    return { items: rows.map((row) => ({ ...row, it_owner_names: labels.get(row.id)?.it_owner_names ?? [] })) };
  }

  /**
   * Link (`add`) or unlink an application and a business process. The process's row is locked
   * first; idempotent; audited on the link table, `recordId` the process. The application must be
   * one the caller reads (400 otherwise).
   */
  async setProcessApplication(
    processId: string,
    applicationId: string,
    add: boolean,
    opts: LinkOpts,
    applications: { scope?: ParticipationAccessScope },
  ): Promise<{ ok: true; changed: boolean }> {
    const { manager: mg, tenantId } = opts;
    const process = await this.readProcessId(mg, tenantId, processId, true);
    const appId = uuidOrThrow(applicationId, 'Application not found.');
    const visible = await this.visibleApplicationIds(mg, tenantId, [appId], applications.scope);
    if (!visible.has(appId)) throw new BadRequestException('Application not found.');
    const [{ n }]: Array<{ n: number }> = await mg.query(
      add
        ? `WITH c AS (
             INSERT INTO application_business_processes (tenant_id, application_id, business_process_id) VALUES ($1, $2, $3)
             ON CONFLICT ON CONSTRAINT application_business_processes_key DO NOTHING RETURNING 1)
           SELECT count(*)::int AS n FROM c`
        : `WITH c AS (
             DELETE FROM application_business_processes WHERE tenant_id = $1 AND application_id = $2 AND business_process_id = $3 RETURNING 1)
           SELECT count(*)::int AS n FROM c`,
      [tenantId, appId, process],
    );
    const changed = Number(n) > 0;
    if (changed) {
      await this.audit.log({
        table: 'application_business_processes', recordId: process, action: 'update',
        before: add ? null : { application_id: appId }, after: add ? { application_id: appId } : null, userId: opts.userId ?? null,
      }, { manager: mg });
    }
    return { ok: true, changed };
  }

  // ==================== SHARED ====================

  /**
   * Insert a link, or, when the same (subject, technology, version) is linked already, write its
   * notes (when given) and provenance. Audited: `create` for a new link, `update` when an existing
   * one changes (observation dates aside).
   */
  private async upsertLink(
    side: LinkSide,
    technologyId: string,
    subjectId: string,
    versionId: string | null,
    notes: string | null,
    provenance: LinkProvenance,
    opts: LinkOpts,
  ): Promise<{ ok: true; link_id: string | null; created: boolean; changed: boolean }> {
    const { manager: mg, tenantId } = opts;
    const table = `${side}_technologies`;
    const [before]: Array<{ id: string; notes: string | null; source: string; source_ref: string | null }> = await mg.query(
      `SELECT id, notes, source, source_ref FROM ${table}
        WHERE tenant_id = $1 AND ${side}_id = $2 AND technology_id = $3 AND technology_version_id IS NOT DISTINCT FROM $4`,
      [tenantId, subjectId, technologyId, versionId],
    );
    const [row]: Array<{ id: string; notes: string | null; source: string; source_ref: string | null }> = await mg.query(
      `INSERT INTO ${table} (tenant_id, ${side}_id, technology_id, technology_version_id, notes, source, source_ref, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT ON CONSTRAINT ${table}_key DO UPDATE
         SET notes = COALESCE(EXCLUDED.notes, ${table}.notes), source = EXCLUDED.source,
             source_ref = EXCLUDED.source_ref, observed_at = EXCLUDED.observed_at, updated_at = now()
       RETURNING id, notes, source, source_ref`,
      [tenantId, subjectId, technologyId, versionId, notes, ...provenanceParams(provenance)],
    );
    const after = { id: row.id, [`${side}_id`]: subjectId, technology_version_id: versionId, notes: row.notes, source: row.source, source_ref: row.source_ref };
    const changed = !before || before.notes !== row.notes || before.source !== row.source || before.source_ref !== row.source_ref;
    if (changed) {
      await this.audit.log({
        table, recordId: technologyId, action: before ? 'update' : 'create',
        before: before ? { ...before, [`${side}_id`]: subjectId, technology_version_id: versionId } : null, after, userId: opts.userId ?? null,
      }, { manager: mg });
    }
    return { ok: true, link_id: row.id, created: !before, changed };
  }

  private async updateLink(side: LinkSide, idOrRef: string, linkId: string, body: LinkInput, opts: LinkOpts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef, true);
    const id = uuidOrThrow(linkId, 'Link not found.');
    const table = `${side}_technologies`;
    const rows: Array<{ id: string; technology_version_id: string | null; notes: string | null; source: string }> = await mg.query(
      `SELECT id, technology_version_id, notes, source FROM ${table} WHERE tenant_id = $1 AND technology_id = $2 AND id = $3`,
      [tenantId, tech.id, id],
    );
    if (!rows[0]) throw new NotFoundException('Link not found');
    const before = rows[0];
    const versionGiven = body && ('technology_version_id' in body || 'version_label' in body);
    const versionId = versionGiven ? await versionOfInput(mg, tenantId, tech.id, body) : before.technology_version_id;
    const notes = body && 'notes' in body ? notesOf(body.notes) : before.notes;
    try {
      await withSavepoint(mg, () => mg.query(
        `UPDATE ${table} SET technology_version_id = $4, notes = $5, source = 'manual', source_ref = NULL, observed_at = NULL, updated_at = now()
          WHERE tenant_id = $1 AND technology_id = $2 AND id = $3`,
        [tenantId, tech.id, id, versionId, notes],
      ));
    } catch (error: any) {
      if ((error?.code ?? error?.driverError?.code) === '23505') throw new BadRequestException('This version is already linked.');
      throw error;
    }
    await this.audit.log({
      table, recordId: tech.id, action: 'update', before, after: { id, technology_version_id: versionId, notes, source: 'manual' }, userId: opts.userId ?? null,
    }, { manager: mg });
    return { ok: true };
  }

  /** Delete one link row; `changed` false (and no audit) when it was not there. */
  private async deleteLinkRow(side: LinkSide, technologyId: string, linkId: string, opts: LinkOpts) {
    const { manager: mg, tenantId } = opts;
    const id = uuidOrThrow(linkId, 'Link not found.');
    const table = `${side}_technologies`;
    // A DELETE through the query runner returns [rows, count]: the rows come through a CTE.
    const removed: Array<Record<string, unknown>> = await mg.query(
      `WITH d AS (
         DELETE FROM ${table} WHERE tenant_id = $1 AND technology_id = $2 AND id = $3
         RETURNING id, ${side}_id, technology_version_id, notes, source, source_ref
       )
       SELECT * FROM d`,
      [tenantId, technologyId, id],
    );
    if (removed[0]) {
      await this.audit.log({ table, recordId: technologyId, action: 'delete', before: removed[0], after: null, userId: opts.userId ?? null }, { manager: mg });
    }
    return { ok: true, changed: removed.length > 0 };
  }

  /** Delete the declarations of a technology by an application; the removed link ids. */
  private async deleteDeclarations(mg: EntityManager, tenantId: string, technologyId: string, applicationId: string): Promise<string[]> {
    const rows: Array<{ id: string }> = await mg.query(
      `WITH d AS (
         DELETE FROM application_technologies WHERE tenant_id = $1 AND technology_id = $2 AND application_id = $3 RETURNING id
       )
       SELECT id::text AS id FROM d ORDER BY id`,
      [tenantId, technologyId, applicationId],
    );
    return rows.map((row) => row.id);
  }

  /** The applications of `ids` that exist in the tenant and, under a scope, that the caller takes part in. */
  private async visibleApplicationIds(mg: EntityManager, tenantId: string, ids: string[], scope?: ParticipationAccessScope): Promise<Set<string>> {
    const wanted = Array.from(new Set(ids));
    if (wanted.length === 0) return new Set();
    const params: unknown[] = [tenantId, wanted];
    const scopeSql = scope ? (params.push(scope.userId), `AND ${applicationParticipantCondition('a', `$${params.length}`)}`) : '';
    const rows: Array<{ id: string }> = await mg.query(
      `SELECT a.id::text AS id FROM applications a WHERE a.tenant_id = $1 AND a.id = ANY($2::uuid[]) ${scopeSql}`,
      params,
    );
    return new Set(rows.map((row) => row.id));
  }

  private async presentReaching(mg: EntityManager, tenantId: string, rows: ReachingTechnology[], subject: LinkSide) {
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

  private async readApplicationId(mg: EntityManager, tenantId: string, applicationId: string): Promise<string> {
    const raw = String(applicationId || '').trim();
    const rows: Array<{ id: string }> = UUID_RE.test(raw)
      ? await mg.query(`SELECT id FROM applications WHERE tenant_id = $1 AND id = $2`, [tenantId, raw.toLowerCase()])
      : /^APP-\d+$/i.test(raw)
        ? await mg.query(`SELECT id FROM applications WHERE tenant_id = $1 AND upper(sequential_id) = upper($2)`, [tenantId, raw])
        : [];
    if (!rows[0]) throw new NotFoundException('Application not found');
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
    const rows: Array<{ id: string; name: string; asset_reference: string | null; kind: string; status: string | null; environment: string | null; operating_system: string | null; is_cluster: boolean }> = wanted.length
      ? await mg.query(
        `SELECT id, name, asset_reference, kind, status, environment, operating_system, COALESCE(is_cluster, false) AS is_cluster
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

  private async linkNotes(mg: EntityManager, tenantId: string, side: LinkSide, ids: Array<string | null>) {
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
