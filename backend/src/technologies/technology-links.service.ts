import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { TechnologyCpeEvents } from './technology-cpe-events';
import type { EntityManager } from 'typeorm';
import { effectiveAssignmentsSql } from '../app-asset-assignments/effective-assignments';
import { AuditService, type AuditEntry, type AuditSourceOptions } from '../audit/audit.service';
import { applicationParticipantCondition, type ParticipationAccessScope } from '../auth/business-contributor-scope';
import { languageOf, type CsvLanguage } from '../common/csv-sheet';
import { writeListExport, type ListExportFile } from '../common/csv/list-export';
import type { ExportFileFormat } from '../common/xlsx/format';
import { MANUAL_PROVENANCE, provenanceParams, type LinkProvenance } from '../common/link-provenance';
import { withSavepoint } from '../common/savepoint.util';
import { shippedLabelIn } from '../it-ops-settings/catalog-shipped-labels';
import type { CatalogTranslations } from '../it-ops-settings/catalog-codes';
import { catalogFromMetadata } from '../it-ops-settings/classification-catalog';
import { ItOpsSettingsService } from '../it-ops-settings/it-ops-settings.service';
import { operatingSystemLabelSql } from './operating-system-codes';
import { assetInServiceSql, inServiceSql, TechnologyReachService, type ReachedAsset, type ReachingTechnology } from './technology-reach.service';
import { readTechnology, resolveVersionLabel, technologyReference, UUID_RE, versionOfInput, type VersionAuditOptions } from './technology-rows';

export type LinkOpts = {
  manager: EntityManager;
  tenantId: string;
  userId?: string | null;
  /** The audit row's source: the screen leaves it out (`user`), Plaid names its preview. */
  audit?: AuditSourceOptions;
};

/**
 * `keepExistingProvenance`: an existing link keeps its source, reference and observation date.
 * The link-file import sets it. The screens omit it, so rewriting a link there still makes it manual.
 */
export type LinkWriteOptions = { keepExistingProvenance?: boolean };

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

/**
 * A server an application is deployed on (the effective assignments of its instances,
 * `effectiveAssignmentsSql`: a cluster and its members in service), in service, with the
 * environments of those instances and the roles it holds there.
 */
export type DeploymentServer = {
  asset_id: string;
  name: string;
  asset_reference: string | null;
  environments: string[];
  roles: string[];
};

/** A declaration of an application removed by a link write, with what an undo puts back. */
export type RemovedDeclaration = {
  id: string;
  application_id: string;
  technology_version_id: string | null;
  notes: string | null;
  source: string;
  source_ref: string | null;
};

/** At most this many servers in one declaration (the deployments of one application). */
const SERVERS_MAX = 200;

const NOTES_MAX = 2000;

type ApplicationsCsvCopy = {
  headers: string[];
  declared: string;
  hosted: string;
  unknown: string;
  yes: string;
  no: string;
  /** Application environments (`app_instances.environment`), as the screen writes them (`it:enums.environment`). */
  environments: Record<string, string>;
};

/** The words of the Applications export, the screen's (`workspace.technology.applications` in the `it` locale files). */
/** The sheet of the Applications tab's workbook. */
const APPLICATIONS_SHEET: Record<CsvLanguage, string> = { en: 'Applications', fr: 'Applications', de: 'Anwendungen', es: 'Aplicaciones' };

const APPLICATIONS_CSV_COPY: Record<CsvLanguage, ApplicationsCsvCopy> = {
  en: {
    headers: ['Reference', 'Application', 'Link', 'Environment', 'Server', 'Installed on', 'Version', 'Criticality', 'External', 'IT owners', 'Notes'],
    declared: 'Declared', hosted: 'Hosted', unknown: 'Version unknown', yes: 'Yes', no: 'No',
    environments: { prod: 'Prod', pre_prod: 'Pre-prod', qa: 'QA', test: 'Test', dev: 'Dev', sandbox: 'Sandbox' },
  },
  fr: {
    headers: ['Référence', 'Application', 'Lien', 'Environnement', 'Serveur', 'Installée sur', 'Version', 'Criticité', 'Externe', 'Responsables IT', 'Notes'],
    declared: 'Déclarée', hosted: 'Hébergée', unknown: 'Version inconnue', yes: 'Oui', no: 'Non',
    environments: { prod: 'Prod', pre_prod: 'Pré-prod', qa: 'QA', test: 'Test', dev: 'Dev', sandbox: 'Bac à sable' },
  },
  de: {
    headers: ['Referenz', 'Anwendung', 'Verknüpfung', 'Umgebung', 'Server', 'Installiert auf', 'Version', 'Kritikalität', 'Extern', 'IT-Verantwortliche', 'Notizen'],
    declared: 'Deklariert', hosted: 'Gehostet', unknown: 'Version unbekannt', yes: 'Ja', no: 'Nein',
    environments: { prod: 'Prod', pre_prod: 'Pre-Prod', qa: 'QA', test: 'Test', dev: 'Dev', sandbox: 'Sandbox' },
  },
  es: {
    headers: ['Referencia', 'Aplicación', 'Vínculo', 'Entorno', 'Servidor', 'Instalada en', 'Versión', 'Criticidad', 'Externa', 'Responsables de TI', 'Notas'],
    declared: 'Declarada', hosted: 'Alojada', unknown: 'Versión desconocida', yes: 'Sí', no: 'No',
    environments: { prod: 'Prod', pre_prod: 'Pre-prod', qa: 'QA', test: 'Test', dev: 'Dev', sandbox: 'Sandbox' },
  },
};

/**
 * A catalog value as the screen shows it in `language`: the tenant's translation, else the shipped
 * translation while the tenant keeps the shipped label or a former shipped label, else the tenant's label.
 */
function catalogLabelIn(list: string, option: { code: string; label: string; translations?: CatalogTranslations }, language: CsvLanguage): string {
  const translated = option.translations?.[language]?.label;
  if (translated) return translated;
  return shippedLabelIn(list, option, language) ?? option.label;
}

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
    @Optional() private readonly cpeEvents?: TechnologyCpeEvents,
  ) {}

  /** A link changed: the technology is matched again with the vulnerabilities, after the commit (lot T6b). */
  private linksChanged(mg: EntityManager, tenantId: string, technologyId: string) {
    return this.cpeEvents?.emit({ manager: mg, tenantId, technologyId, products: [] });
  }

  /** The audit row of a link write, with the source Plaid names and the screen leaves out. */
  private auditEntry<T extends AuditEntry>(entry: T, opts: LinkOpts): T {
    return opts.audit
      ? { ...entry, source: opts.audit.source, sourceRef: opts.audit.sourceRef ?? null }
      : entry;
  }

  /** The audit options of a version created on the way (`resolveVersionLabel`). */
  private versionAudit(opts: LinkOpts): VersionAuditOptions {
    return { service: this.audit, userId: opts.userId ?? null, audit: opts.audit };
  }

  // ==================== ASSETS ====================

  /**
   * The servers of a technology: installed (with the link, one row per link) and carried through
   * the graph, one row per asset and version with every asset that carries it (`via_assets`, by
   * name; `via_asset_id` and `via_asset_name` the first): a cluster is one row per version, whatever
   * the number of its members that carry it (K2-1). Clusters stay listed here, with `is_cluster`;
   * the counters leave them out. `through_host`: a carried row every path of which crosses a
   * `contains` edge (the VMs of a host the technology is installed on), shown apart. A link to a
   * retired asset stays listed, to be seen and removed, with `asset_status`; it takes no part in the
   * deductions.
   */
  async assetsOfTechnology(idOrRef: string, opts: LinkOpts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef);
    const retired: ReachedAsset[] = await mg.query(
      `SELECT at.technology_id, at.asset_id, NULL::uuid AS via_asset_id, at.technology_version_id, at.id AS link_id, at.source, 0 AS depth,
              false AS through_host
         FROM asset_technologies at
         JOIN assets a ON a.tenant_id = $1 AND a.id = at.asset_id AND NOT (${assetInServiceSql('a')})
        WHERE at.tenant_id = $1 AND at.technology_id = $2`,
      [tenantId, tech.id],
    );
    const all = [...await this.reach.assetsOfTechnologies(mg, tenantId, [tech.id]), ...retired.map((r) => ({ ...r, depth: 0 }))];
    const assets = await this.assetLabels(mg, tenantId, all.flatMap((r) => [r.asset_id, r.via_asset_id]));
    const versions = await this.versionLabels(mg, tenantId, all.map((r) => r.technology_version_id));
    const notes = await this.linkNotes(mg, tenantId, 'asset', all.map((r) => r.link_id));
    // The carried rows of one asset and version become one, with their carriers by name.
    const installed = all.filter((r) => !r.via_asset_id).map((r) => ({ ...r, via: [] as ReachedAsset[] }));
    const carried = new Map<string, ReachedAsset & { via: ReachedAsset[] }>();
    for (const r of all.filter((row) => !!row.via_asset_id)) {
      const key = `${r.asset_id}|${r.technology_version_id ?? ''}`;
      const entry = carried.get(key);
      if (!entry) carried.set(key, { ...r, via: [r] });
      else {
        entry.via.push(r);
        entry.depth = Math.min(entry.depth, r.depth);
        // A path without `contains` from any carrier makes the row plain.
        entry.through_host = entry.through_host && r.through_host;
      }
    }
    const viaRef = (id: string) => ({ id, name: assets.get(id)?.name ?? null, reference: assets.get(id)?.asset_reference ?? null });
    const byName = (a: { id: string; name: string | null }, b: { id: string; name: string | null }) =>
      String(a.name ?? '').localeCompare(String(b.name ?? ''), 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id);
    const reached = [...installed, ...Array.from(carried.values())].map((r) => {
      const viaAssets = r.via.map((v) => viaRef(v.via_asset_id!)).sort(byName);
      // The first carrier names the provenance of the row, as `via`.
      const first = r.via.find((v) => v.via_asset_id === viaAssets[0]?.id);
      return { ...r, via_asset_id: viaAssets[0]?.id ?? null, via_assets: viaAssets, source: first?.source ?? r.source };
    });
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
        operating_system_label: asset?.operating_system ?? null,
        via_asset_id: r.via_asset_id,
        via_asset_name: r.via_asset_id ? assets.get(r.via_asset_id)?.name ?? null : null,
        via_assets: r.via_assets,
        technology_version_id: r.technology_version_id,
        version_label: r.technology_version_id ? versions.get(r.technology_version_id) ?? null : null,
        notes: r.link_id ? notes.get(r.link_id) ?? null : null,
        source: r.source,
        depth: r.depth,
        through_host: !!r.via_asset_id && r.through_host === true,
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
              NULL::text AS environment, NULL::uuid AS asset_id, NULL::uuid AS via_asset_id, at.id AS link_id, at.source,
              at.is_operating_system
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
   * `keepExistingProvenance` leaves that provenance: omitted or equal notes write nothing, and
   * different notes replace the notes only.
   */
  async addAssetLink(
    idOrRef: string,
    assetId: string,
    body: LinkInput,
    opts: LinkOpts,
    provenance: LinkProvenance = MANUAL_PROVENANCE,
    write: LinkWriteOptions = {},
  ) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef, true);
    const asset = await this.readAsset(mg, tenantId, assetId);
    const versionId = await versionOfInput(mg, tenantId, tech.id, body ?? {}, this.versionAudit(opts));
    return this.upsertLink('asset', tech.id, asset.id, versionId, notesOf(body?.notes), provenance, opts, write);
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

  /**
   * The Applications tab as a file to send to the teams: one line per row of the tab, in the
   * language asked (headers, words, environments, and the criticality as the tenant's catalog
   * names it in that language). CSV, or a workbook of one sheet with the same text cells.
   */
  async applicationsCsv<F extends ExportFileFormat = 'csv'>(
    idOrRef: string,
    language: unknown,
    opts: LinkOpts,
    applications: { scope?: ParticipationAccessScope },
    format?: F,
  ): Promise<ListExportFile<F>> {
    const lang = await languageOf(opts.manager, opts.tenantId, opts.userId ?? null, language);
    const { technology, items } = await this.applicationsOfTechnology(idOrRef, opts, applications);
    const copy = APPLICATIONS_CSV_COPY[lang];
    const [settings]: Array<{ it_ops: Record<string, any> | null }> = await opts.manager.query(
      `SELECT metadata->'it_ops' AS it_ops FROM tenants WHERE id = $1`,
      [opts.tenantId],
    );
    const criticality = new Map(catalogFromMetadata(settings?.it_ops ?? {}).businessCriticalityLevels
      .map((level) => [level.code, catalogLabelIn('businessCriticalityLevels', level, lang)]));
    const rows = (items ?? []).map((item) => [
      item.application_reference ?? '',
      item.application_name ?? '',
      item.kind === 'declared' ? copy.declared : copy.hosted,
      item.environment ? copy.environments[item.environment] ?? item.environment : '',
      item.asset_name ?? '',
      item.via_asset_name ?? '',
      item.version_label ?? copy.unknown,
      item.criticality ? criticality.get(item.criticality) ?? item.criticality : '',
      item.external_facing ? copy.yes : copy.no,
      item.it_owner_names.join(', '),
      item.notes ?? '',
    ]);
    const safeName = String(technology.reference ?? 'technology').replace(/[^A-Za-z0-9_-]/g, '_');
    return writeListExport({
      format: format ?? ('csv' as F),
      language: lang,
      filename: `${safeName}_applications.csv`,
      sheetNames: APPLICATIONS_SHEET,
      headers: copy.headers,
      rows,
    });
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
      // One audit row per application, the application in the payload: the technology's history
      // reads each as one link added, and the application's history finds it by its key.
      for (const applicationId of added) {
        await this.audit.log(this.auditEntry({
          table: 'application_technologies', recordId: tech.id, action: 'update',
          before: null, after: { application_id: applicationId }, userId: opts.userId ?? null,
        }, opts), { manager: mg });
      }
      await this.linksChanged(mg, tenantId, tech.id);
    }
    return { ok: true, added: added.length };
  }

  /** Remove every declaration of the technology by the application (all versions). */
  async removeApplication(idOrRef: string, applicationId: string, opts: LinkOpts, applications: { scope?: ParticipationAccessScope }) {
    const removed = await this.removeApplicationDeclaration(idOrRef, applicationId, { all: true }, opts, applications);
    return { ok: true, removed: removed.removed.length };
  }

  /**
   * Remove declarations of the technology by one application, exactly: all of them (`all`, as the
   * screen's "remove" does), the one of a version label, or the one of a version id (`null` is the
   * version-unknown row). The technology's row is locked first, as every link write; the removed
   * rows come back with their version and notes, so the assistant can put exactly them back on an
   * undo. Audited on the link table, `recordId` the technology, with the caller's source.
   */
  async removeApplicationDeclaration(
    idOrRef: string,
    applicationId: string,
    selector: { all: true } | { version_label: string } | { version_id: string | null },
    opts: LinkOpts,
    applications: { scope?: ParticipationAccessScope },
  ): Promise<{ ok: true; changed: boolean; removed: RemovedDeclaration[] }> {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef, true);
    const appId = uuidOrThrow(applicationId, 'Application not found.');
    const visible = await this.visibleApplicationIds(mg, tenantId, [appId], applications.scope);
    if (!visible.has(appId)) throw new BadRequestException('Application not found.');
    let versionId: string | null | undefined;
    if ('version_label' in selector) {
      const resolved = await resolveVersionLabel(mg, tenantId, tech.id, selector.version_label, { create: false });
      if (!resolved) return { ok: true, changed: false, removed: [] };
      versionId = resolved.id;
    } else if ('version_id' in selector) {
      versionId = selector.version_id;
    }
    const removed = await this.deleteDeclarations(mg, tenantId, tech.id, appId, versionId);
    if (removed.length) {
      // One audit row for the application that loses the technology, the application in the
      // payload, as for an addition. The caller gets the full rows (version, notes, provenance)
      // for its undo.
      await this.audit.log(this.auditEntry({
        table: 'application_technologies', recordId: tech.id, action: 'update',
        before: { application_id: appId }, after: null, userId: opts.userId ?? null,
      }, opts), { manager: mg });
      await this.linksChanged(mg, tenantId, tech.id);
    }
    return { ok: true, changed: removed.length > 0, removed };
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
   * application's visibility is the caller's check. `write` as for `addAssetLink`.
   */
  async setApplicationTechnology(
    applicationId: string,
    technologyIdOrRef: string,
    add: boolean,
    body: LinkInput,
    opts: LinkOpts,
    provenance: LinkProvenance = MANUAL_PROVENANCE,
    write: LinkWriteOptions = {},
  ): Promise<{ ok: true; changed: boolean; link_id?: string | null }> {
    const { manager: mg, tenantId } = opts;
    const appId = await this.readApplicationId(mg, tenantId, applicationId);
    const tech = await readTechnology(mg, tenantId, technologyIdOrRef, true);
    if (!add) {
      const removed = await this.deleteDeclarations(mg, tenantId, tech.id, appId);
      if (removed.length) {
        // One audit row for the application, the application in the payload.
        await this.audit.log(this.auditEntry({
          table: 'application_technologies', recordId: tech.id, action: 'update',
          before: { application_id: appId }, after: null, userId: opts.userId ?? null,
        }, opts), { manager: mg });
        await this.linksChanged(mg, tenantId, tech.id);
      }
      return { ok: true, changed: removed.length > 0 };
    }
    const versionId = await versionOfInput(mg, tenantId, tech.id, body ?? {}, this.versionAudit(opts));
    const res = await this.upsertLink('application', tech.id, appId, versionId, notesOf(body?.notes), provenance, opts, write);
    return { ok: true, changed: res.changed, link_id: res.link_id };
  }

  /**
   * Declare a technology for an application, from the application's side, and record it at the
   * same version on some of its deployment servers (`asset_ids`, optional): the declaration as
   * `setApplicationTechnology`, then one installed link per server, in the caller's transaction.
   * Every server must be a deployment server of the application in service
   * (`deploymentServersOfApplication`), else nothing is written (400). A server that already has
   * the technology installed, at any version, keeps its links and counts as `skipped`: the server's
   * page stays the place to change them. An operating system is not recorded this way (400): the
   * server's page marks it. The new links carry `provenance` (manual for the screens, `ai` for
   * Plaid) and are audited like the asset side's.
   */
  async declareApplicationTechnology(
    applicationId: string,
    technologyIdOrRef: string,
    body: LinkInput & { asset_ids?: unknown },
    opts: LinkOpts,
    provenance: LinkProvenance = MANUAL_PROVENANCE,
    write: LinkWriteOptions = {},
  ): Promise<{ ok: true; changed: boolean; created: boolean; link_id: string | null; servers?: { added: number; skipped: number } }> {
    const { manager: mg, tenantId } = opts;
    const appId = await this.readApplicationId(mg, tenantId, applicationId);
    const tech = await readTechnology(mg, tenantId, technologyIdOrRef, true);
    const serverIds = await this.deploymentServerIdsOf(mg, tenantId, appId, body?.asset_ids);
    if (serverIds.length > 0 && tech.family === 'operating_system') {
      throw new BadRequestException("An operating system is recorded from the server's page.");
    }
    const versionId = await versionOfInput(mg, tenantId, tech.id, body ?? {}, this.versionAudit(opts));
    const res = await this.upsertLink('application', tech.id, appId, versionId, notesOf(body?.notes), provenance, opts, write);
    if (serverIds.length === 0) return { ok: true, changed: res.changed, created: res.created, link_id: res.link_id };
    const servers = await this.installOnServers(tech.id, versionId, serverIds, opts, provenance);
    return { ok: true, changed: res.changed || servers.added > 0, created: res.created, link_id: res.link_id, servers };
  }

  /** The deployment servers of an application, in service, by name (`DeploymentServer`). */
  async deploymentServersOfApplication(applicationId: string, opts: LinkOpts): Promise<DeploymentServer[]> {
    const { manager: mg, tenantId } = opts;
    const appId = await this.readApplicationId(mg, tenantId, applicationId);
    return this.deploymentServers(mg, tenantId, appId);
  }

  private deploymentServers(mg: EntityManager, tenantId: string, appId: string, only?: string[]): Promise<DeploymentServer[]> {
    // The hostings the reach counts: an instance and its application in service, a server in service.
    return mg.query(
      `SELECT a.id AS asset_id, a.name, a.asset_reference,
              COALESCE(array_agg(DISTINCT i.environment) FILTER (WHERE i.environment IS NOT NULL), '{}') AS environments,
              COALESCE(array_agg(DISTINCT x.role) FILTER (WHERE x.role IS NOT NULL), '{}') AS roles
         FROM app_instances i
         JOIN applications ap ON ap.tenant_id = $1 AND ap.id = i.application_id AND ${inServiceSql('ap', 'i')}
         JOIN (${effectiveAssignmentsSql({ tenant: '$1', applications: 'ARRAY[$2::uuid]' })}) x ON x.tenant_id = $1 AND x.app_instance_id = i.id
         JOIN assets a ON a.tenant_id = $1 AND a.id = x.asset_id AND ${assetInServiceSql('a')}
        WHERE i.tenant_id = $1 AND i.application_id = $2${only ? ' AND x.asset_id = ANY($3::uuid[])' : ''}
        GROUP BY a.id, a.name, a.asset_reference
        ORDER BY lower(a.name), a.id`,
      only ? [tenantId, appId, only] : [tenantId, appId],
    );
  }

  /** The servers asked (`raw`), checked in one query: each one a deployment server of the application. */
  private async deploymentServerIdsOf(mg: EntityManager, tenantId: string, appId: string, raw: unknown): Promise<string[]> {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw new BadRequestException('asset_ids must be a list.');
    const ids = Array.from(new Set(raw.map((id) => uuidOrThrow(id, 'One or more servers are not deployment servers of this application.'))));
    if (ids.length === 0) return [];
    if (ids.length > SERVERS_MAX) throw new BadRequestException(`At most ${SERVERS_MAX} servers at once.`);
    const found = await this.deploymentServers(mg, tenantId, appId, ids);
    if (found.length !== ids.length) throw new BadRequestException('One or more servers are not deployment servers of this application.');
    return ids.sort();
  }

  /**
   * Install the technology at `versionId` on the servers that do not have it yet, in one statement;
   * the others are left as they are. One audit row per new link, as `upsertLink` writes it.
   */
  private async installOnServers(
    technologyId: string,
    versionId: string | null,
    assetIds: string[],
    opts: LinkOpts,
    provenance: LinkProvenance = MANUAL_PROVENANCE,
  ) {
    const { manager: mg, tenantId } = opts;
    const added: Array<{ id: string; asset_id: string; source: string; source_ref: string | null }> = await mg.query(
      `WITH ins AS (
         INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id, notes, source, source_ref, observed_at)
         SELECT $1, s.asset_id, $2, $3, NULL, $5, $6, $7
           FROM unnest($4::uuid[]) AS s(asset_id)
          WHERE NOT EXISTS (
            SELECT 1 FROM asset_technologies at WHERE at.tenant_id = $1 AND at.asset_id = s.asset_id AND at.technology_id = $2
          )
         ON CONFLICT ON CONSTRAINT asset_technologies_key DO NOTHING
         RETURNING id, asset_id, source, source_ref
       )
       SELECT id::text AS id, asset_id::text AS asset_id, source, source_ref FROM ins ORDER BY asset_id`,
      [tenantId, technologyId, versionId, assetIds, ...provenanceParams(provenance)],
    );
    for (const row of added) {
      await this.audit.log(this.auditEntry({
        table: 'asset_technologies', recordId: technologyId, action: 'create', before: null,
        after: { id: row.id, asset_id: row.asset_id, technology_version_id: versionId, notes: null, source: row.source, source_ref: row.source_ref },
        userId: opts.userId ?? null,
      }, opts), { manager: mg });
    }
    if (added.length > 0) await this.linksChanged(mg, tenantId, technologyId);
    return { added: added.length, skipped: assetIds.length - added.length };
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
      await this.audit.log(this.auditEntry({
        table: 'application_business_processes', recordId: process, action: 'update',
        before: add ? null : { application_id: appId }, after: add ? { application_id: appId } : null, userId: opts.userId ?? null,
      }, opts), { manager: mg });
    }
    return { ok: true, changed };
  }

  // ==================== SHARED ====================

  /**
   * Insert a link, or, when the same (subject, technology, version) is linked already, write its
   * notes (when given) and provenance. Audited: `create` for a new link, `update` when an existing
   * one changes (observation dates aside). With `keepExistingProvenance`, an existing link whose
   * notes are omitted or unchanged is left as stored (no `updated_at`, no audit), and different
   * notes replace the notes only.
   */
  private async upsertLink(
    side: LinkSide,
    technologyId: string,
    subjectId: string,
    versionId: string | null,
    notes: string | null,
    provenance: LinkProvenance,
    opts: LinkOpts,
    write: LinkWriteOptions = {},
  ): Promise<{ ok: true; link_id: string | null; created: boolean; changed: boolean }> {
    const { manager: mg, tenantId } = opts;
    const table = `${side}_technologies`;
    const [before]: Array<{ id: string; notes: string | null; source: string; source_ref: string | null }> = await mg.query(
      `SELECT id, notes, source, source_ref FROM ${table}
        WHERE tenant_id = $1 AND ${side}_id = $2 AND technology_id = $3 AND technology_version_id IS NOT DISTINCT FROM $4`,
      [tenantId, subjectId, technologyId, versionId],
    );
    const keep = write.keepExistingProvenance === true;
    if (before && keep && (notes === null || notes === before.notes)) {
      return { ok: true, link_id: before.id, created: false, changed: false };
    }
    // INSERT … ON CONFLICT returns rows directly. A bare UPDATE would come back as [rows, count].
    const assignments = keep
      ? `notes = COALESCE(EXCLUDED.notes, ${table}.notes), updated_at = now()`
      : `notes = COALESCE(EXCLUDED.notes, ${table}.notes), source = EXCLUDED.source, source_ref = EXCLUDED.source_ref, observed_at = EXCLUDED.observed_at, updated_at = now()`;
    const [row]: Array<{ id: string; notes: string | null; source: string; source_ref: string | null }> = await mg.query(
      `INSERT INTO ${table} (tenant_id, ${side}_id, technology_id, technology_version_id, notes, source, source_ref, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT ON CONSTRAINT ${table}_key DO UPDATE
         SET ${assignments}
       RETURNING id, notes, source, source_ref`,
      [tenantId, subjectId, technologyId, versionId, notes, ...provenanceParams(provenance)],
    );
    const after = { id: row.id, [`${side}_id`]: subjectId, technology_version_id: versionId, notes: row.notes, source: row.source, source_ref: row.source_ref };
    const changed = !before || before.notes !== row.notes || before.source !== row.source || before.source_ref !== row.source_ref;
    if (changed) {
      await this.audit.log(this.auditEntry({
        table, recordId: technologyId, action: before ? 'update' : 'create',
        before: before ? { ...before, [`${side}_id`]: subjectId, technology_version_id: versionId } : null, after, userId: opts.userId ?? null,
      }, opts), { manager: mg });
    }
    if (changed) await this.linksChanged(mg, tenantId, technologyId);
    return { ok: true, link_id: row.id, created: !before, changed };
  }

  private async updateLink(side: LinkSide, idOrRef: string, linkId: string, body: LinkInput, opts: LinkOpts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef, true);
    const id = uuidOrThrow(linkId, 'Link not found.');
    const table = `${side}_technologies`;
    const rows: Array<{ id: string; [key: string]: unknown }> = await mg.query(
      `SELECT id, ${side}_id, technology_version_id, notes, source FROM ${table} WHERE tenant_id = $1 AND technology_id = $2 AND id = $3`,
      [tenantId, tech.id, id],
    );
    if (!rows[0]) throw new NotFoundException('Link not found');
    const before = rows[0];
    const subjectId = before[`${side}_id`] as string;
    const versionGiven = body && ('technology_version_id' in body || 'version_label' in body);
    const versionId = versionGiven ? await versionOfInput(mg, tenantId, tech.id, body, this.versionAudit(opts)) : before.technology_version_id;
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
    await this.audit.log(this.auditEntry({
      table, recordId: tech.id, action: 'update', before,
      after: { id, [`${side}_id`]: subjectId, technology_version_id: versionId, notes, source: 'manual' },
      userId: opts.userId ?? null,
    }, opts), { manager: mg });
    if (versionId !== before.technology_version_id) await this.linksChanged(mg, tenantId, tech.id);
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
      await this.audit.log(this.auditEntry({ table, recordId: technologyId, action: 'delete', before: removed[0], after: null, userId: opts.userId ?? null }, opts), { manager: mg });
      await this.linksChanged(mg, tenantId, technologyId);
    }
    return { ok: true, changed: removed.length > 0 };
  }

  /**
   * Delete the declarations of a technology by an application; the removed rows. No version id
   * (`undefined`) removes every version; `null` removes the version-unknown row only.
   */
  private async deleteDeclarations(
    mg: EntityManager,
    tenantId: string,
    technologyId: string,
    applicationId: string,
    versionId?: string | null,
  ): Promise<RemovedDeclaration[]> {
    const params: unknown[] = [tenantId, technologyId, applicationId];
    if (versionId !== undefined) params.push(versionId);
    const rows: RemovedDeclaration[] = await mg.query(
      `WITH d AS (
         DELETE FROM application_technologies
          WHERE tenant_id = $1 AND technology_id = $2 AND application_id = $3
            ${versionId === undefined ? '' : `AND technology_version_id IS NOT DISTINCT FROM $4`}
          RETURNING id, application_id, technology_version_id, notes, source, source_ref
       )
       SELECT id::text AS id, application_id::text AS application_id,
              technology_version_id::text AS technology_version_id, notes, source, source_ref
         FROM d ORDER BY id`,
      params,
    );
    return rows;
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
    const techs: Array<{ id: string; name: string; item_number: number; family: string; editor: string | null; hosting_type: string }> = techIds.length
      ? await mg.query(`SELECT id, name, item_number, family, editor, hosting_type FROM technologies WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, techIds])
      : [];
    const byId = new Map(techs.map((t) => [t.id, t]));
    const assets = await this.assetLabels(mg, tenantId, rows.flatMap((r) => [r.asset_id, r.via_asset_id, ...(r.via_asset_ids ?? [])]));
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
        hosting_type: tech?.hosting_type ?? null,
        technology_version_id: r.technology_version_id,
        version_label: r.technology_version_id ? versions.get(r.technology_version_id) ?? null : null,
        standard_support_end: r.technology_version_id ? versionDates.get(r.technology_version_id)?.standard ?? null : null,
        extended_support_end: r.technology_version_id ? versionDates.get(r.technology_version_id)?.extended ?? null : null,
        environment: r.environment,
        asset_id: r.asset_id,
        asset_name: r.asset_id ? assets.get(r.asset_id)?.name ?? null : null,
        via_asset_id: r.via_asset_id,
        via_asset_name: r.via_asset_id ? assets.get(r.via_asset_id)?.name ?? null : null,
        // Every asset that carries it (a host, a cluster's members), by name; the one `via` otherwise.
        via_assets: (r.via_asset_ids ?? (r.via_asset_id ? [r.via_asset_id] : []))
          .map((id) => ({ id, name: assets.get(id)?.name ?? null, reference: assets.get(id)?.asset_reference ?? null })),
        notes: removable && r.link_id ? notes.get(r.link_id) ?? null : null,
        source: r.source,
        is_operating_system: subject === 'asset' && r.kind === 'installed' && r.is_operating_system === true,
        // Carried through a host only (its hypervisor): the platform underneath, shown apart.
        through_host: r.kind === 'carried' && r.through_host === true,
      };
    });
    const order: Record<string, number> = { installed: 0, declared: 0, carried: 1, hosted: 1 };
    // The marked operating system leads the installed links.
    items.sort((a, b) => Number(b.is_operating_system) - Number(a.is_operating_system)
      || order[a.kind] - order[b.kind]
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
        `SELECT a.id, a.name, a.asset_reference, a.kind, a.status, a.environment,
                ${operatingSystemLabelSql('a')} AS operating_system, COALESCE(a.is_cluster, false) AS is_cluster
           FROM assets a WHERE a.tenant_id = $1 AND a.id = ANY($2::uuid[])`,
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
    const rows: Array<{ id: string; standard: string | null; extended: string | null }> = wanted.length
      ? await mg.query(
        `SELECT id, to_char(standard_support_end, 'YYYY-MM-DD') AS standard,
                to_char(extended_support_end, 'YYYY-MM-DD') AS extended
           FROM technology_versions WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, wanted],
      )
      : [];
    return new Map(rows.map((row) => [row.id, { standard: row.standard, extended: row.extended }]));
  }

  private async linkNotes(mg: EntityManager, tenantId: string, side: LinkSide, ids: Array<string | null>) {
    const wanted = Array.from(new Set(ids.filter((id): id is string => !!id)));
    const rows: Array<{ id: string; notes: string | null }> = wanted.length
      ? await mg.query(`SELECT id, notes FROM ${side}_technologies WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, wanted])
      : [];
    return new Map(rows.map((row) => [row.id, row.notes]));
  }
}
