import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { linkProvenance } from '../../../common/link-provenance';
import { TechnologyLinksService } from '../../../technologies/technology-links.service';
import type { LinkWriteOptions } from '../../../technologies/technology-links.service';
import { AiMutationPreview } from '../../ai-mutation-preview.entity';
import {
  AiWriteLanguage,
  previewSummaryText,
  quoted,
  technologyLinkCardText,
  technologyKeptVersionCardText,
  technologyVersionCardText,
  writeActionText,
} from '../../ai-write-texts';
import { AiExecutionContextWithManager } from '../../ai.types';
import { buildAiMutationAudit } from '../ai-mutation-audit.util';
import {
  AiApplicationTarget,
  AiServerTarget,
  AiTechnologyMutationSupportService,
  AiTechnologyTarget,
  AiTechnologyVersion,
  AiTechnologyWriteOptions,
} from '../ai-technology-mutation-support.service';
import { AiMutationOperation, AiMutationPreviewPresentation, AiPreparedMutationPreview } from '../ai-mutation-operation.types';

const OPERATING_SYSTEM_MESSAGE =
  "An operating system is recorded from the server's page, in its operating system field, not as a technology link.";

const APPLICATION_ADD = z.object({
  application: z.string().trim().min(1)
    .describe('Application to declare the technology on: an APP-n reference or its exact name.'),
  version: z.string().trim().min(1).max(100).optional()
    .describe('Version label, as the screen writes it; created when the technology does not have it. Omitted: version unknown.'),
  servers: z.array(z.string().trim().min(1)).max(200).optional()
    .describe('Deployment servers of the application to install the technology on, by AST-n reference, exact name, hostname or fqdn. A server that already has the technology is left as it is.'),
});

const APPLICATION_REMOVE = z.object({
  application: z.string().trim().min(1)
    .describe('Application to remove the technology from: an APP-n reference or its exact name.'),
  version: z.string().trim().min(1).max(100).optional()
    .describe('Version label of the one declaration to remove. Omitted: every declaration of the technology by the application, as the screen removes them.'),
});

const SERVER_LINK = z.object({
  server: z.string().trim().min(1)
    .describe('Server: an AST-n reference, its exact name, hostname or fqdn.'),
  version: z.string().trim().min(1).max(100).optional()
    .describe('Version label, as the screen writes it; created when the technology does not have it. Omitted: version unknown.'),
});

export const UpdateTechnologyLinksInputSchema = z.object({
  technology: z.string().trim().min(1)
    .describe('Technology to link: a TEC-n reference, its UUID or its exact name.'),
  applications: z.object({
    add: z.array(APPLICATION_ADD).optional()
      .describe('Applications to declare the technology on, each with its version and optional deployment servers.'),
    remove: z.array(APPLICATION_REMOVE).optional()
      .describe('Applications to remove the technology from, with the version to remove or every version.'),
  }).optional(),
  servers: z.object({
    add: z.array(SERVER_LINK).optional()
      .describe('Servers to install the technology on directly, each with its version.'),
    remove: z.array(SERVER_LINK).optional()
      .describe('Servers to remove the technology from, on the exact version (omitted: the version-unknown link).'),
  }).optional(),
}).refine((value) => (value.applications?.add?.length ?? 0) > 0
  || (value.applications?.remove?.length ?? 0) > 0
  || (value.servers?.add?.length ?? 0) > 0
  || (value.servers?.remove?.length ?? 0) > 0, {
  message: 'At least one link to add or remove is required.',
});

type UpdateTechnologyLinksInput = z.infer<typeof UpdateTechnologyLinksInputSchema>;

type Declaration = { link_id: string; version: AiTechnologyVersion | null; notes: string | null };
type ApplicationAdd = {
  application: AiApplicationTarget;
  version: AiTechnologyVersion | null;
  notes?: string | null;
  servers: Array<{ server: AiServerTarget; install: boolean }>;
};
type ApplicationRemove = {
  application: AiApplicationTarget;
  version: AiTechnologyVersion | null;
  allVersions: boolean;
  declarations: Declaration[];
};
type ApplicationAlready = { application: AiApplicationTarget; version: AiTechnologyVersion | null; servers: Array<{ server: AiServerTarget; install: boolean }> };
type ApplicationAbsent = { application: AiApplicationTarget; version: AiTechnologyVersion | null; allVersions: boolean };
type ServerVersioned = { server: AiServerTarget; version: AiTechnologyVersion | null; notes?: string | null };
type ServerRemove = { server: AiServerTarget; version: AiTechnologyVersion | null; link: { id: string; notes: string | null } };
type StoredChanges = {
  applications: {
    add: ApplicationAdd[];
    remove: ApplicationRemove[];
    already: ApplicationAlready[];
    absent: ApplicationAbsent[];
  };
  servers: {
    add: ServerVersioned[];
    remove: ServerRemove[];
    already: ServerVersioned[];
    absent: ServerVersioned[];
  };
};
type Applied = {
  applications: {
    /** The row added, with the provenance and notes the undo requires back. */
    added: Array<{ application: AiApplicationTarget; version: AiTechnologyVersion | null; link_id: string; notes: string | null; source_ref: string | null }>;
    removed: Array<{ application: AiApplicationTarget; declarations: Declaration[] }>;
  };
  servers: {
    added: Array<{ server: AiServerTarget; version: AiTechnologyVersion | null; link_id: string; notes: string | null; source_ref: string | null }>;
    removed: Array<{ server: AiServerTarget; version: AiTechnologyVersion | null; notes: string | null }>;
  };
  versions_created: Array<{ id: string; label: string }>;
};

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function versionKey(version: AiTechnologyVersion | null): string {
  if (!version) return 'unknown';
  return version.id ?? `new:${version.label.toLowerCase()}`;
}

function asVersion(value: unknown): AiTechnologyVersion | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const label = textOrNull(raw.label);
  if (!label) return null;
  return {
    id: textOrNull(raw.id),
    label,
    created: raw.created === true,
    standard_support_end: textOrNull(raw.standard_support_end),
    extended_support_end: textOrNull(raw.extended_support_end),
  };
}

function asApplication(value: unknown): AiApplicationTarget | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = textOrNull(raw.id);
  if (!id) return null;
  const name = String(raw.name ?? '');
  const ref = textOrNull(raw.ref);
  return { id, ref: ref ?? '', name, label: String(raw.label ?? [ref, name].filter(Boolean).join(' - ')) };
}

function asServer(value: unknown): AiServerTarget | null {
  return asApplication(value) as AiServerTarget | null;
}

function asDeclaration(value: unknown): Declaration | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const linkId = textOrNull(raw.link_id);
  if (!linkId) return null;
  return { link_id: linkId, version: asVersion(raw.version), notes: textOrNull(raw.notes) };
}

function emptyChanges(): StoredChanges {
  return {
    applications: { add: [], remove: [], already: [], absent: [] },
    servers: { add: [], remove: [], already: [], absent: [] },
  };
}

function coerceChanges(value: unknown): StoredChanges {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const changes = emptyChanges();
  const appRaw = raw.applications && typeof raw.applications === 'object' ? raw.applications as Record<string, unknown> : {};
  const serverRaw = raw.servers && typeof raw.servers === 'object' ? raw.servers as Record<string, unknown> : {};
  const entries = (group: Record<string, unknown>, key: string) => (Array.isArray(group[key]) ? group[key] as Array<Record<string, unknown>> : []);
  for (const row of entries(appRaw, 'add')) {
    const application = asApplication(row.application);
    if (!application) continue;
    const servers = (Array.isArray(row.servers) ? row.servers as Array<Record<string, unknown>> : [])
      .map((entry) => {
        const server = asServer(entry.server);
        return server ? { server, install: entry.install !== false } : null;
      })
      .filter((entry): entry is { server: AiServerTarget; install: boolean } => !!entry);
    changes.applications.add.push({ application, version: asVersion(row.version), notes: textOrNull(row.notes), servers });
  }
  for (const row of entries(appRaw, 'remove')) {
    const application = asApplication(row.application);
    if (!application) continue;
    const declarations = (Array.isArray(row.declarations) ? row.declarations as unknown[] : [])
      .map(asDeclaration)
      .filter((entry): entry is Declaration => !!entry);
    changes.applications.remove.push({
      application,
      version: asVersion(row.version),
      allVersions: row.allVersions === true,
      declarations,
    });
  }
  for (const row of entries(appRaw, 'already')) {
    const application = asApplication(row.application);
    if (!application) continue;
    const servers = (Array.isArray(row.servers) ? row.servers as Array<Record<string, unknown>> : [])
      .map((entry) => {
        const server = asServer(entry.server);
        return server ? { server, install: entry.install !== false } : null;
      })
      .filter((entry): entry is { server: AiServerTarget; install: boolean } => !!entry);
    changes.applications.already.push({ application, version: asVersion(row.version), servers });
  }
  for (const row of entries(appRaw, 'absent')) {
    const application = asApplication(row.application);
    if (!application) continue;
    changes.applications.absent.push({ application, version: asVersion(row.version), allVersions: row.allVersions === true });
  }
  for (const row of entries(serverRaw, 'add')) {
    const server = asServer(row.server);
    if (server) changes.servers.add.push({ server, version: asVersion(row.version), notes: textOrNull(row.notes) });
  }
  for (const row of entries(serverRaw, 'remove')) {
    const server = asServer(row.server);
    const link = row.link && typeof row.link === 'object' ? row.link as Record<string, unknown> : {};
    const id = textOrNull(link.id);
    if (server && id) changes.servers.remove.push({ server, version: asVersion(row.version), link: { id, notes: textOrNull(link.notes) } });
  }
  for (const row of entries(serverRaw, 'already')) {
    const server = asServer(row.server);
    if (server) changes.servers.already.push({ server, version: asVersion(row.version) });
  }
  for (const row of entries(serverRaw, 'absent')) {
    const server = asServer(row.server);
    if (server) changes.servers.absent.push({ server, version: asVersion(row.version) });
  }
  return changes;
}

function coerceApplied(value: unknown): Applied | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const appRaw = raw.applications && typeof raw.applications === 'object' ? raw.applications as Record<string, unknown> : {};
  const serverRaw = raw.servers && typeof raw.servers === 'object' ? raw.servers as Record<string, unknown> : {};
  const applied: Applied = {
    applications: { added: [], removed: [] },
    servers: { added: [], removed: [] },
    versions_created: [],
  };
  for (const row of (Array.isArray(appRaw.added) ? appRaw.added as Array<Record<string, unknown>> : [])) {
    const application = asApplication(row.application);
    if (application) {
      applied.applications.added.push({
        application,
        version: asVersion(row.version),
        link_id: textOrNull(row.link_id) ?? '',
        notes: textOrNull(row.notes),
        source_ref: textOrNull(row.source_ref),
      });
    }
  }
  for (const row of (Array.isArray(appRaw.removed) ? appRaw.removed as Array<Record<string, unknown>> : [])) {
    const application = asApplication(row.application);
    if (!application) continue;
    const declarations = (Array.isArray(row.declarations) ? row.declarations as unknown[] : [])
      .map(asDeclaration)
      .filter((entry): entry is Declaration => !!entry);
    applied.applications.removed.push({ application, declarations });
  }
  for (const row of (Array.isArray(serverRaw.added) ? serverRaw.added as Array<Record<string, unknown>> : [])) {
    const server = asServer(row.server);
    if (server) {
      applied.servers.added.push({
        server,
        version: asVersion(row.version),
        link_id: textOrNull(row.link_id) ?? '',
        notes: textOrNull(row.notes),
        source_ref: textOrNull(row.source_ref),
      });
    }
  }
  for (const row of (Array.isArray(serverRaw.removed) ? serverRaw.removed as Array<Record<string, unknown>> : [])) {
    const server = asServer(row.server);
    if (server) applied.servers.removed.push({ server, version: asVersion(row.version), notes: textOrNull(row.notes) });
  }
  for (const row of (Array.isArray(raw.versions_created) ? raw.versions_created as Array<Record<string, unknown>> : [])) {
    const label = textOrNull(row.label);
    const id = textOrNull(row.id);
    if (label && id) applied.versions_created.push({ id, label });
  }
  return applied;
}

function buildTarget(preview: AiMutationPreview): AiMutationPreviewPresentation['target'] {
  const current = preview.current_values ?? {};
  return {
    entity_type: 'technologies',
    entity_id: preview.target_entity_id ?? null,
    ref: typeof current.target_ref === 'string' ? current.target_ref : null,
    title: typeof current.target_title === 'string' ? current.target_title : null,
  };
}

function linkedNotes(changes: StoredChanges): string[] {
  const notes: string[] = [];
  for (const entry of changes.applications.already) notes.push(`${entry.application.label} is already linked`);
  for (const entry of changes.applications.absent) notes.push(`${entry.application.label} is not linked`);
  for (const entry of changes.servers.already) notes.push(`${entry.server.label} is already linked`);
  for (const entry of changes.servers.absent) notes.push(`${entry.server.label} is not linked`);
  return notes;
}

/** One link of a technology, from either side: declare or install it, or remove it. */
@Injectable()
export class UpdateTechnologyLinksAiMutationOperation implements AiMutationOperation<UpdateTechnologyLinksInput> {
  readonly toolName = 'update_technology_links' as const;
  readonly description = 'Create a preview to declare a technology on applications (with its version and, optionally, its deployment servers) or install it on servers, and to remove those links. A request from the other side ("add PostgreSQL 16 to CheeseTrack", "install nginx 1.26 on AST-12") puts the technology in `technology` and the application or server in its list. Requires explicit user approval before execution.';
  readonly inputSchema = UpdateTechnologyLinksInputSchema;
  readonly inputSummary = {
    technology: 'Technology to link: TEC-n, the UUID, or its exact name.',
    applications: 'Applications to add (with `version` and optional `servers`) or remove (with `version`, or every version).',
    servers: 'Servers to install the technology on or remove it from, by AST-n, exact name, hostname or fqdn, with `version`.',
  };
  readonly businessResource = 'infrastructure';
  readonly writePreview = {
    entity_type: 'technologies',
    fields: ['linked_applications', 'linked_servers'],
    reversible: true,
    prompt_hint: 'For the links of a technology, use `update_technology_links` with the technology (TEC-n, UUID or exact name) and, per side, what to `add` and `remove`. A request from the other side ("add PostgreSQL 16 to CheeseTrack", "install nginx 1.26 on AST-12") keeps the technology in `technology` and puts the application or the server in its list. A version is a label; it is created when the technology does not have it. A link already present, or already absent, writes nothing. An operating system is recorded from the server\'s page, not here. Undo reverses the links that changed; a version created on the way stays.',
  };

  constructor(
    private readonly support: AiTechnologyMutationSupportService,
    private readonly links: TechnologyLinksService,
  ) {}

  resolveWriteFamily(): string {
    return 'technologies';
  }

  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: UpdateTechnologyLinksInput,
  ): Promise<AiPreparedMutationPreview> {
    const technology = await this.support.resolveTechnology(context, input.technology);
    this.assertEditableFamily(technology);
    const options = await this.support.writeOptions(context);
    const asksApplications = (input.applications?.add?.length ?? 0) > 0 || (input.applications?.remove?.length ?? 0) > 0;
    if (asksApplications) await this.support.assertApplicationRead(context);
    const changes = await this.prepareChanges(context, technology, options, input);
    // Declaring an application whose declaration already exists still changes something when the
    // request equips servers: those installations are the change, and the card lists them.
    const equipsServers = changes.applications.already.some((entry) => entry.servers.some((server) => server.install));
    if (changes.applications.add.length === 0 && changes.applications.remove.length === 0
      && !equipsServers && changes.servers.add.length === 0 && changes.servers.remove.length === 0) {
      throw new BadRequestException(`Nothing to change: ${linkedNotes(changes).join('; ')}.`);
    }
    return {
      targetEntityType: 'technologies',
      targetEntityId: technology.id,
      mutationInput: {
        technology_ref: technology.ref,
        technology_name: technology.name,
        technology_label: technology.label,
        changes,
      },
      currentValues: {
        target_ref: technology.ref,
        target_title: technology.label,
      },
    };
  }

  presentPreview(preview: AiMutationPreview, language: AiWriteLanguage = 'en'): AiMutationPreviewPresentation {
    const current = preview.current_values ?? {};
    const mutation = preview.mutation_input ?? {};
    const ref = typeof current.target_ref === 'string' ? current.target_ref : 'TEC';
    const label = typeof current.target_title === 'string' && current.target_title.trim() ? current.target_title : ref;
    const technologyName = typeof mutation.technology_name === 'string'
      ? mutation.technology_name
      : label.replace(/^TEC-\d+\s*-\s*/, '');
    const changes = coerceChanges(mutation.changes);

    let summary = `Preview ${preview.id} ${preview.status}.`;
    switch (preview.status) {
      case 'pending':
        summary = `Update the links of ${label}.`;
        break;
      case 'executed':
        summary = `Links updated on ${label}.`;
        break;
      case 'rejected':
        summary = `Links preview for ${label} was rejected.`;
        break;
      case 'expired':
        summary = `Links preview for ${label} expired before approval.`;
        break;
      case 'failed':
        summary = preview.error_message || `Links preview for ${label} failed.`;
        break;
    }
    if (language !== 'en') {
      summary = previewSummaryText(
        language,
        preview.status,
        writeActionText.updateTechnologyLinks(language, quoted(language, label)),
        { errorMessage: preview.error_message },
      );
    }

    const applications = {
      add: changes.applications.add.map((entry) => `${entry.application.label}: ${technologyVersionCardText(language, technologyName, entry.version)}`),
      remove: changes.applications.remove.flatMap((entry) => (entry.declarations.length > 0
        ? entry.declarations.map((declaration) => `${entry.application.label}: ${technologyVersionCardText(language, technologyName, declaration.version)}`)
        : [`${entry.application.label}`])),
      already: changes.applications.already.map((entry) => `${entry.application.label}: ${technologyVersionCardText(language, technologyName, entry.version)}`),
      absent: changes.applications.absent.map((entry) => `${entry.application.label}: ${technologyVersionCardText(language, technologyName, entry.version)}`),
    };
    const servers = {
      add: [
        ...changes.applications.add.flatMap((entry) => entry.servers.filter((server) => server.install)
          .map((server) => `${server.server.label}: ${technologyVersionCardText(language, technologyName, entry.version)}`)),
        ...changes.applications.already.flatMap((entry) => entry.servers.filter((server) => server.install)
          .map((server) => `${server.server.label}: ${technologyVersionCardText(language, technologyName, entry.version)}`)),
        ...changes.servers.add.map((entry) => `${entry.server.label}: ${technologyVersionCardText(language, technologyName, entry.version)}`),
      ],
      remove: changes.servers.remove.map((entry) => `${entry.server.label}: ${technologyVersionCardText(language, technologyName, entry.version)}`),
      already: [
        ...changes.applications.add.flatMap((entry) => entry.servers.filter((server) => !server.install)
          .map((server) => `${server.server.label}`)),
        ...changes.applications.already.flatMap((entry) => entry.servers.filter((server) => !server.install)
          .map((server) => `${server.server.label}`)),
        ...changes.servers.already.map((entry) => `${entry.server.label}`),
      ],
      absent: changes.servers.absent.map((entry) => `${entry.server.label}`),
    };

    const cardChanges: Record<string, AiMutationPreviewPresentation['changes'][string]> = {};
    const applicationText = technologyLinkCardText(language, applications, 'linked', 'applications');
    if (applicationText) {
      cardChanges.technology_applications = {
        label: { en: 'Applications', fr: 'Applications', de: 'Anwendungen', es: 'Aplicaciones' }[language],
        from: null,
        to: applicationText,
        format: 'markdown',
      };
    }
    const serverText = technologyLinkCardText(language, servers, 'equipped', 'servers');
    if (serverText) {
      cardChanges.technology_servers = {
        label: { en: 'Servers', fr: 'Serveurs', de: 'Server', es: 'Servidores' }[language],
        from: null,
        to: serverText,
        format: 'markdown',
      };
    }
    const keptVersions = Array.isArray(mutation.kept_versions)
      ? mutation.kept_versions.map((label) => String(label ?? '').trim()).filter(Boolean)
      : [];
    const keptText = technologyKeptVersionCardText(language, keptVersions);
    if (keptText) {
      cardChanges.technology_versions = {
        label: { en: 'Versions', fr: 'Versions', de: 'Versionen', es: 'Versiones' }[language],
        from: null,
        to: keptText,
        format: 'markdown',
      };
    }
    return { target: buildTarget(preview), changes: cardChanges, summary };
  }

  async executePreview(context: AiExecutionContextWithManager, preview: AiMutationPreview): Promise<void> {
    if (!preview.target_entity_id) throw new BadRequestException('Preview is missing the technology.');
    const technology = await this.support.lockTechnology(context, preview.target_entity_id);
    this.assertEditableFamily(technology);
    const changes = coerceChanges(preview.mutation_input?.changes);
    await this.assertNoDrift(context, technology, changes);
    const options = await this.support.writeOptions(context);
    const linkOptions = this.support.linkOptions(context, preview);
    const provenance = linkProvenance('ai', preview.id);
    const audit = buildAiMutationAudit(preview);
    const applied: Applied = {
      applications: { added: [], removed: [] },
      servers: { added: [], removed: [] },
      versions_created: [],
    };
    const versions = new Map<string, AiTechnologyVersion>();
    const resolveVersion = async (version: AiTechnologyVersion | null): Promise<AiTechnologyVersion | null> => {
      if (!version) return null;
      const key = version.label.toLowerCase();
      const cached = versions.get(key);
      if (cached) return cached;
      const created = await this.support.createVersion(context, technology.id, version.label, { audit });
      versions.set(key, created);
      if (created.created && created.id) applied.versions_created.push({ id: created.id, label: created.label });
      return created;
    };

    for (const entry of changes.applications.add) {
      // The Business Contributor scope is checked again under the lock, as the screen resolves
      // the application with it: a participation withdrawn since the preview refuses the add.
      await this.support.assertApplicationInScope(context, options, entry.application.id);
      const version = await resolveVersion(entry.version);
      const installIds = entry.servers.filter((server) => server.install).map((server) => server.server.id);
      const result = await this.supportLinkDeclaration(context, preview, technology, entry.application, version, installIds, entry.notes);
      // The service creates the declaration: a row it did not create means someone else wrote
      // the same link since the preview, and nothing more is written.
      if (!result?.created || !result.link_id) {
        throw new ConflictException(`Links of ${technology.label} changed after the preview was created.`);
      }
      applied.applications.added.push({
        application: entry.application,
        version,
        link_id: result.link_id,
        notes: entry.notes ?? null,
        source_ref: preview.id,
      });
      await this.recordInstalledServers(context, technology, entry.servers, version, applied);
    }
    for (const entry of changes.applications.already) {
      const version = await resolveVersion(entry.version);
      const installIds = entry.servers.filter((server) => server.install).map((server) => server.server.id);
      if (installIds.length > 0) {
        await this.support.assertApplicationInScope(context, options, entry.application.id);
        // The declaration was there at the preview: it must still be the same row. The write
        // keeps its provenance (a manual declaration stays manual) and only equips the servers.
        const declarations = await this.support.applicationLinks(context, technology.id, entry.application.id);
        if (!declarations.some((link) => this.linkMatchesVersion(link, version))) {
          throw new ConflictException(`Links of ${technology.label} changed after the preview was created.`);
        }
        const result = await this.supportLinkDeclaration(
          context, preview, technology, entry.application, version, installIds, undefined, { keepExistingProvenance: true },
        );
        if (!result || result.servers_added !== installIds.length) {
          throw new ConflictException(`Links of ${technology.label} changed after the preview was created.`);
        }
        await this.recordInstalledServers(context, technology, entry.servers, version, applied);
      }
    }
    for (const entry of changes.applications.remove) {
      const selection = entry.allVersions
        ? { all: true as const }
        : { version_id: entry.version?.id ?? null };
      const removed = await this.links.removeApplicationDeclaration(
        technology.id,
        entry.application.id,
        selection,
        linkOptions,
        { scope: options.applicationScope },
      );
      if (removed.removed.length === 0) throw new ConflictException(`Links of ${technology.label} changed after the preview was created.`);
      applied.applications.removed.push({ application: entry.application, declarations: entry.declarations });
    }
    for (const entry of changes.servers.add) {
      const version = await resolveVersion(entry.version);
      const result = await this.links.addAssetLink(
        technology.id,
        entry.server.id,
        { technology_version_id: version?.id ?? null, notes: entry.notes ?? undefined },
        linkOptions,
        provenance,
        {},
      );
      // Only a row this execution created is undone: an existing one belongs to whoever wrote it.
      if (!result.created || !result.link_id) {
        throw new ConflictException(`Links of ${technology.label} changed after the preview was created.`);
      }
      applied.servers.added.push({
        server: entry.server,
        version,
        link_id: result.link_id,
        notes: entry.notes ?? null,
        source_ref: preview.id,
      });
    }
    for (const entry of changes.servers.remove) {
      const result = await this.links.removeAssetLink(technology.id, entry.link.id, linkOptions);
      if (!result.changed) throw new ConflictException(`Links of ${technology.label} changed after the preview was created.`);
      applied.servers.removed.push({ server: entry.server, version: entry.version, notes: entry.link.notes });
    }

    preview.current_values = {
      ...(preview.current_values ?? {}),
      applied,
    };
  }

  async prepareReversePreview(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
  ): Promise<AiPreparedMutationPreview> {
    const applied = coerceApplied(preview.current_values?.applied);
    if (!applied) throw new BadRequestException('This preview changed no link.');
    if (!preview.target_entity_id) throw new BadRequestException('Original preview is missing the technology.');
    const technology = await this.support.lockTechnology(context, preview.target_entity_id);
    const changes = emptyChanges();
    const applicationLinks = await this.support.applicationLinks(context, technology.id);
    const assetLinks = await this.support.assetLinks(context, technology.id);

    for (const entry of applied.applications.added) {
      // The undo removes the exact row this preview added: another row on the same application
      // and version (the screen re-declared it, with a note) is not ours to delete.
      const current = applicationLinks.find((link) => link.link_id === entry.link_id);
      if (!current
        || !this.linkMatchesVersion(current, entry.version)
        || (current.notes ?? null) !== (entry.notes ?? null)
        || (current.source_ref ?? null) !== (entry.source_ref ?? null)) {
        throw new ConflictException(`Links of ${technology.label} changed after the preview was created.`);
      }
      changes.applications.remove.push({
        application: entry.application,
        version: entry.version,
        allVersions: false,
        declarations: [{ link_id: current.link_id, version: entry.version, notes: current.notes }],
      });
    }
    for (const entry of applied.applications.removed) {
      for (const declaration of entry.declarations) {
        const present = applicationLinks.find((link) => link.subject_id === entry.application.id
          && this.linkMatchesVersion(link, declaration.version));
        if (present) throw new ConflictException(`Links of ${technology.label} changed after the preview was created.`);
        changes.applications.add.push({
          application: entry.application,
          version: declaration.version,
          notes: declaration.notes,
          servers: [],
        });
      }
    }
    for (const entry of applied.servers.added) {
      const current = assetLinks.find((link) => link.link_id === entry.link_id);
      // The same row, with the same provenance and notes: an equipped server rewritten on the
      // screen since the preview is not the row this undo may remove.
      if (!current
        || !this.linkMatchesVersion(current, entry.version)
        || (current.notes ?? null) !== (entry.notes ?? null)
        || (current.source_ref ?? null) !== (entry.source_ref ?? null)) {
        throw new ConflictException(`Links of ${technology.label} changed after the preview was created.`);
      }
      changes.servers.remove.push({
        server: entry.server,
        version: entry.version,
        link: { id: current.link_id, notes: current.notes },
      });
    }
    for (const entry of applied.servers.removed) {
      const present = assetLinks.find((link) => link.subject_id === entry.server.id && this.linkMatchesVersion(link, entry.version));
      if (present) throw new ConflictException(`Links of ${technology.label} changed after the preview was created.`);
      changes.servers.add.push({ server: entry.server, version: entry.version, notes: entry.notes });
    }

    if (changes.applications.remove.length === 0 && changes.applications.add.length === 0
      && changes.servers.remove.length === 0 && changes.servers.add.length === 0) {
      throw new BadRequestException('This preview changed no link.');
    }
    return {
      targetEntityType: 'technologies',
      targetEntityId: technology.id,
      mutationInput: {
        technology_ref: technology.ref,
        technology_name: technology.name,
        technology_label: technology.label,
        changes,
        kept_versions: applied.versions_created.map((version) => version.label),
        reverse_of: preview.id,
      },
      currentValues: {
        target_ref: technology.ref,
        target_title: technology.label,
      },
    };
  }

  private assertEditableFamily(technology: AiTechnologyTarget): void {
    if (technology.family === 'operating_system') {
      throw new BadRequestException(OPERATING_SYSTEM_MESSAGE);
    }
  }

  /**
   * Resolve every requested link and compare it with what is linked already, before any preview.
   * A link already there (`already`) or already absent (`absent`) writes nothing; a requested
   * server that is not a deployment server of its application is refused here, as the service
   * would refuse it at execution.
   */
  private async prepareChanges(
    context: AiExecutionContextWithManager,
    technology: AiTechnologyTarget,
    options: AiTechnologyWriteOptions,
    input: UpdateTechnologyLinksInput,
  ): Promise<StoredChanges> {
    const changes = emptyChanges();
    const versions = new Map<string, AiTechnologyVersion | null>();
    const resolveVersion = async (label: string | undefined): Promise<AiTechnologyVersion | null> => {
      if (label == null) return null;
      const key = label.toLowerCase();
      if (!versions.has(key)) versions.set(key, await this.support.versionReference(context, technology.id, label));
      return versions.get(key)!;
    };
    const applicationLinks = await this.support.applicationLinks(context, technology.id);
    const assetLinks = await this.support.assetLinks(context, technology.id);
    const equipped = new Set(assetLinks.map((link) => link.subject_id));
    const plannedServerKeys = new Set<string>();
    const addKeys = new Set<string>();
    const removeKeys = new Set<string>();
    const applicationAdds = new Map<string, Set<string>>();
    const applicationRemoves = new Map<string, Set<string>>();
    const noteAdd = (applicationId: string, key: string) => {
      if (!applicationAdds.has(applicationId)) applicationAdds.set(applicationId, new Set());
      applicationAdds.get(applicationId)!.add(key);
    };
    const noteRemove = (applicationId: string, key: string) => {
      if (!applicationRemoves.has(applicationId)) applicationRemoves.set(applicationId, new Set());
      applicationRemoves.get(applicationId)!.add(key);
    };

    const appAddEntries: ApplicationAdd[] = [];
    for (const raw of input.applications?.add ?? []) {
      const application = await this.support.resolveApplication(context, options, raw.application);
      const version = await resolveVersion(raw.version);
      const key = `${application.id}|${versionKey(version)}`;
      if (removeKeys.has(key) || applicationRemoves.get(application.id)?.has('all')) {
        throw new BadRequestException(`"${application.label}" cannot be both added and removed on the same preview.`);
      }
      if (addKeys.has(key)) {
        // The same application and version twice: one entry, with the servers together.
        const existing = [...appAddEntries, ...changes.applications.already]
          .find((entry) => entry.application.id === application.id && versionKey(entry.version) === versionKey(version));
        if (existing) {
          for (const serverRef of raw.servers ?? []) {
            const server = await this.support.resolveServer(context, serverRef);
            if (!existing.servers.some((entry) => entry.server.id === server.id)) {
              existing.servers.push({ server, install: !equipped.has(server.id) });
            }
          }
          await this.support.assertDeploymentServers(context, application.id, existing.servers.map((entry) => entry.server.id));
        }
        continue;
      }
      addKeys.add(key);
      noteAdd(application.id, versionKey(version));
      const servers: Array<{ server: AiServerTarget; install: boolean }> = [];
      for (const serverRef of raw.servers ?? []) {
        const server = await this.support.resolveServer(context, serverRef);
        if (servers.some((entry) => entry.server.id === server.id)) continue;
        servers.push({ server, install: !equipped.has(server.id) });
      }
      if (servers.length > 0) {
        await this.support.assertDeploymentServers(context, application.id, servers.map((entry) => entry.server.id));
        for (const entry of servers) {
          const plannedKey = `${entry.server.id}|${versionKey(version)}`;
          if (entry.install) plannedServerKeys.add(plannedKey);
        }
      }
      const current = applicationLinks.find((link) => link.subject_id === application.id && this.linkMatchesVersion(link, version));
      const entry: ApplicationAdd = { application, version, servers };
      if (current) {
        changes.applications.already.push({ application, version, servers });
      } else {
        appAddEntries.push(entry);
        changes.applications.add.push(entry);
      }
      // A server whose installation is planned counts as equipped for the next request, as the
      // service skips a server that already has the technology at any version.
      for (const server of servers) if (server.install) equipped.add(server.server.id);
    }

    for (const raw of input.applications?.remove ?? []) {
      const application = await this.support.resolveApplication(context, options, raw.application);
      const version = await resolveVersion(raw.version);
      const key = `${application.id}|${versionKey(version)}`;
      const adds = applicationAdds.get(application.id);
      const removes = applicationRemoves.get(application.id);
      if (raw.version == null) {
        if ((adds && adds.size > 0) || (removes && removes.size > 0)) {
          throw new BadRequestException(`"${application.label}" cannot be both added and removed, or removed twice, on the same preview.`);
        }
        noteRemove(application.id, 'all');
      } else {
        if (adds?.has(versionKey(version))) {
          throw new BadRequestException(`"${application.label}" cannot be both added and removed on the same preview.`);
        }
        if (removes?.has('all')) continue;
        noteRemove(application.id, versionKey(version));
      }
      if (removeKeys.has(key)) continue;
      removeKeys.add(key);
      const declarations: Declaration[] = [];
      for (const link of applicationLinks.filter((row) => row.subject_id === application.id
        && (raw.version == null || this.linkMatchesVersion(row, version)))) {
        declarations.push({
          link_id: link.link_id,
          version: link.version_id
            ? await this.support.versionRow(context.manager, context.tenantId, technology.id, link.version_id)
            : null,
          notes: link.notes,
        });
      }
      if (declarations.length === 0) changes.applications.absent.push({ application, version, allVersions: raw.version == null });
      else changes.applications.remove.push({ application, version, allVersions: raw.version == null, declarations });
    }

    for (const raw of input.servers?.add ?? []) {
      const server = await this.support.resolveServer(context, raw.server);
      const version = await resolveVersion(raw.version);
      const key = `${server.id}|${versionKey(version)}`;
      if (removeKeys.has(key)) throw new BadRequestException(`"${server.label}" cannot be both added and removed on the same preview.`);
      if (addKeys.has(key) || plannedServerKeys.has(key)) continue;
      const current = assetLinks.find((link) => link.subject_id === server.id && this.linkMatchesVersion(link, version));
      if (current) changes.servers.already.push({ server, version });
      else {
        addKeys.add(key);
        changes.servers.add.push({ server, version });
      }
    }

    for (const raw of input.servers?.remove ?? []) {
      const server = await this.support.resolveServer(context, raw.server);
      const version = await resolveVersion(raw.version);
      const key = `${server.id}|${versionKey(version)}`;
      if (addKeys.has(key) || plannedServerKeys.has(key)) throw new BadRequestException(`"${server.label}" cannot be both added and removed on the same preview.`);
      if (removeKeys.has(key)) continue;
      removeKeys.add(key);
      const current = assetLinks.find((link) => link.subject_id === server.id && this.linkMatchesVersion(link, version));
      if (!current) changes.servers.absent.push({ server, version });
      else changes.servers.remove.push({ server, version, link: { id: current.link_id, notes: current.notes } });
    }

    return changes;
  }

  /**
   * The drift check, under the technology row lock: every link the preview promised absent is
   * still absent, every link it promised present is still the same row, with the same version and
   * notes. Any difference refuses the execution before a write.
   */
  private async assertNoDrift(
    context: AiExecutionContextWithManager,
    technology: AiTechnologyTarget,
    changes: StoredChanges,
  ): Promise<void> {
    const applicationLinks = await this.support.applicationLinks(context, technology.id);
    const assetLinks = await this.support.assetLinks(context, technology.id);
    const conflict = () => new ConflictException(`Links of ${technology.label} changed after the preview was created.`);
    const present = (links: typeof applicationLinks, subjectId: string, version: AiTechnologyVersion | null) =>
      links.find((link) => link.subject_id === subjectId && this.linkMatchesVersion(link, version));

    for (const entry of changes.applications.add) {
      if (present(applicationLinks, entry.application.id, entry.version)) throw conflict();
      for (const server of entry.servers.filter((item) => item.install)) {
        if (assetLinks.some((link) => link.subject_id === server.server.id)) throw conflict();
      }
    }
    for (const entry of changes.applications.already) {
      for (const server of entry.servers.filter((item) => item.install)) {
        if (assetLinks.some((link) => link.subject_id === server.server.id)) throw conflict();
      }
    }
    for (const entry of changes.applications.remove) {
      if (entry.allVersions) {
        const current = applicationLinks.filter((link) => link.subject_id === entry.application.id)
          .map((link) => `${link.link_id}|${link.version_id ?? 'null'}|${link.notes ?? ''}`)
          .sort();
        const expected = entry.declarations
          .map((declaration) => `${declaration.link_id}|${declaration.version?.id ?? 'null'}|${declaration.notes ?? ''}`)
          .sort();
        if (JSON.stringify(current) !== JSON.stringify(expected)) throw conflict();
      } else {
        const current = present(applicationLinks, entry.application.id, entry.version);
        const expected = entry.declarations[0];
        if (!current || !expected || current.link_id !== expected.link_id || (current.notes ?? null) !== (expected.notes ?? null)) throw conflict();
      }
    }
    for (const entry of changes.servers.add) {
      if (present(assetLinks, entry.server.id, entry.version)) throw conflict();
    }
    for (const entry of changes.servers.remove) {
      const current = assetLinks.find((link) => link.link_id === entry.link.id);
      if (!current || !this.linkMatchesVersion(current, entry.version) || (current.notes ?? null) !== (entry.link.notes ?? null)) throw conflict();
    }
  }

  /** True when `link` is the exact link the change names (version id, or the label of a new version). */
  private linkMatchesVersion(link: { version_id: string | null; version_label: string | null }, version: AiTechnologyVersion | null): boolean {
    if (!version) return link.version_id == null;
    if (version.id) return link.version_id === version.id;
    // The version did not exist at the preview: the link that appeared since carries its label.
    return (link.version_label ?? '').toLowerCase() === version.label.toLowerCase();
  }

  private async supportLinkDeclaration(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
    technology: AiTechnologyTarget,
    application: AiApplicationTarget,
    version: AiTechnologyVersion | null,
    serverIds: string[],
    notes?: string | null,
    write: LinkWriteOptions = {},
  ): Promise<{ link_id: string | null; created: boolean; servers_added: number } | null> {
    const result = await this.links.declareApplicationTechnology(
      application.id,
      technology.id,
      { technology_version_id: version?.id ?? null, asset_ids: serverIds, notes: notes ?? undefined },
      this.support.linkOptions(context, preview),
      linkProvenance('ai', preview.id),
      write,
    );
    if (!result.ok) return null;
    return { link_id: result.link_id ?? null, created: result.created === true, servers_added: result.servers?.added ?? 0 };
  }

  private async recordInstalledServers(
    context: AiExecutionContextWithManager,
    technology: AiTechnologyTarget,
    servers: Array<{ server: AiServerTarget; install: boolean }>,
    version: AiTechnologyVersion | null,
    applied: Applied,
  ): Promise<void> {
    for (const entry of servers.filter((server) => server.install)) {
      const link = await this.findAssetLink(context, technology.id, entry.server.id, version);
      if (!link) throw new ConflictException(`Links of ${technology.label} changed after the preview was created.`);
      applied.servers.added.push({
        server: entry.server,
        version,
        link_id: link.link_id,
        notes: link.notes,
        source_ref: link.source_ref,
      });
    }
  }

  private async findAssetLink(
    context: AiExecutionContextWithManager,
    technologyId: string,
    serverId: string,
    version: AiTechnologyVersion | null,
  ) {
    const links = await this.support.assetLinks(context, technologyId, serverId);
    return links.find((link) => this.linkMatchesVersion(link, version)) ?? null;
  }

}
