import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { escapeMarkdownLabel, previewSummaryText, quoted, technologyContactCardText, technologyContactLine, technologyOwnerCardText, technologyOwnerLine, technologyPeopleRestoreCardText, writeActionText, type AiWriteLanguage } from '../../ai-write-texts';
import { AiMutationPreview } from '../../ai-mutation-preview.entity';
import { AiExecutionContextWithManager } from '../../ai.types';
import { buildAiMutationAudit } from '../ai-mutation-audit.util';
import { AiMutationOperation, AiMutationPreviewPresentation, AiPreparedMutationPreview } from '../ai-mutation-operation.types';
import { AiTechnologyMutationSupportService } from '../ai-technology-mutation-support.service';
import { TechnologiesService } from '../../../technologies/technologies.service';

const OWNER_TYPE = z.enum(['it', 'business']);

const OWNER_ADD = z.object({
  user: z.string().trim().min(1)
    .describe('Active user by their exact displayed name, without case.'),
  owner_type: OWNER_TYPE.describe('it or business.'),
}).strict();

const OWNER_REMOVE = z.object({
  user: z.string().trim().min(1)
    .describe('Active user by their exact displayed name, without case.'),
  owner_type: OWNER_TYPE.optional()
    .describe('The owner type to remove; omitted removes the person from both types.'),
}).strict();

const CONTACT_ADD = z.object({
  contact: z.string().trim().min(1)
    .describe('Contact by their exact displayed name, without case.'),
  role: z.string().max(200).nullable().optional()
    .describe('Role on the technology, up to 200 characters; omitted for none.'),
}).strict();

const CONTACT_REMOVE = z.object({
  contact: z.string().trim().min(1)
    .describe('Contact by their exact displayed name, without case.'),
}).strict();

export const UpdateTechnologyPeopleInputSchema = z.object({
  technology: z.string().trim().min(1)
    .describe('Technology whose people change: a TEC-n reference, its UUID or its exact name.'),
  owners: z.object({
    add: z.array(OWNER_ADD).optional()
      .describe('Owners to add, each with an active user and it or business.'),
    remove: z.array(OWNER_REMOVE).optional()
      .describe('Owners to remove, each by name; without owner_type the person leaves both types.'),
  }).strict().optional(),
  support_contacts: z.object({
    add: z.array(CONTACT_ADD).optional()
      .describe('Support contacts to add, each with a contact and an optional role; a contact is appended to the list.'),
    remove: z.array(CONTACT_REMOVE).optional()
      .describe('Support contacts to remove, by name; the other contacts keep their order.'),
  }).strict().optional(),
}).strict().refine((value) => (value.owners?.add?.length ?? 0) > 0
  || (value.owners?.remove?.length ?? 0) > 0
  || (value.support_contacts?.add?.length ?? 0) > 0
  || (value.support_contacts?.remove?.length ?? 0) > 0, {
  message: 'At least one owner or support contact to add or remove is required.',
});

type UpdateTechnologyPeopleInput = z.infer<typeof UpdateTechnologyPeopleInputSchema>;
type OwnerType = 'it' | 'business';
type OwnerSnapshot = { user_id: string; owner_type: OwnerType; name: string };
type ContactSnapshot = { contact_id: string; role: string | null; name: string };
type OwnerChange = { name: string; owner_type: OwnerType | null };
type ContactChange = { name: string; role: string | null };
type OwnerGroup = { add: OwnerChange[]; remove: OwnerChange[]; already: OwnerChange[]; absent: OwnerChange[] };
type ContactGroup = { add: ContactChange[]; remove: ContactChange[]; already: ContactChange[]; absent: ContactChange[] };
type Stored = {
  owners: OwnerGroup | null;
  support_contacts: ContactGroup | null;
  owners_before: OwnerSnapshot[];
  owners_after: OwnerSnapshot[];
  contacts_before: ContactSnapshot[];
  contacts_after: ContactSnapshot[];
  owners_changed: boolean;
  contacts_changed: boolean;
  touches_contacts: boolean;
};
type Applied = {
  owners: { touched: boolean; before: OwnerSnapshot[]; after: OwnerSnapshot[] };
  contacts: { touched: boolean; before: ContactSnapshot[]; after: ContactSnapshot[] };
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function ownerKey(owner: OwnerSnapshot): string {
  return `${owner.owner_type}:${owner.user_id}:${owner.name.toLowerCase()}`;
}

function sameOwners(a: readonly OwnerSnapshot[], b: readonly OwnerSnapshot[]): boolean {
  const left = a.map(ownerKey).sort();
  const right = b.map(ownerKey).sort();
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function sameContacts(a: readonly ContactSnapshot[], b: readonly ContactSnapshot[]): boolean {
  return a.length === b.length && a.every((row, index) => row.contact_id === b[index].contact_id
    && (row.role ?? null) === (b[index].role ?? null)
    && row.name.toLowerCase() === b[index].name.toLowerCase());
}

function contactName(row: { first_name?: string | null; last_name?: string | null; email?: string | null }): string {
  return [row.first_name, row.last_name].map((part) => text(part)).filter(Boolean).join(' ') || text(row.email);
}

/** A plan step reaches `prepareCreatePreview` without the Zod schema: the keys are checked here too. */
function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], toolName: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    throw new BadRequestException(`Unknown field "${unknown[0]}" for ${toolName}. Allowed: ${allowed.join(', ')}.`);
  }
}

function groupEntries(value: unknown, allowed: readonly string[], toolName: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(`${toolName} must be an object with add or remove lists.`);
  }
  const group = value as Record<string, unknown>;
  assertKnownKeys(group, allowed, toolName);
  for (const key of allowed) {
    if (group[key] !== undefined && !Array.isArray(group[key])) {
      throw new BadRequestException(`${key} must be a list.`);
    }
  }
  return group;
}

@Injectable()
export class UpdateTechnologyPeopleAiMutationOperation implements AiMutationOperation<UpdateTechnologyPeopleInput> {
  readonly toolName = 'update_technology_people' as const;
  readonly description = 'Create a preview to add or remove the owners (IT or business) and the support contacts of a technology. Requires explicit user approval before execution.';
  readonly inputSchema = UpdateTechnologyPeopleInputSchema;
  readonly inputSummary = {
    technology: 'Technology whose people change: TEC-n, the UUID, or its exact name.',
    owners: 'Owners to add (`user` by exact displayed name, `owner_type` it or business) or remove (`user`, optional `owner_type`; omitted removes both types).',
    support_contacts: 'Support contacts to add (`contact` by exact name, optional `role`) or remove (`contact`).',
  };
  readonly businessResource = 'infrastructure';
  readonly writePreview = {
    entity_type: 'technologies',
    fields: ['technology_owners', 'technology_support_contacts'],
    reversible: true,
    prompt_hint: 'Use `update_technology_people` for a technology\'s owners and support contacts: name the technology (TEC-n, UUID or exact name), add or remove owners by their exact active display name with `owner_type`, contacts by their exact name with an optional role. A person already there or absent changes nothing. Undo puts the previous owners and contacts back, in their order. The card never mentions the vulnerability digests an IT owner receives.',
  };

  constructor(
    private readonly support: AiTechnologyMutationSupportService,
    private readonly technologies: TechnologiesService,
  ) {}

  resolveWriteFamily(): string {
    return 'technologies';
  }

  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: UpdateTechnologyPeopleInput,
  ): Promise<AiPreparedMutationPreview> {
    const request = this.normalizeRequest(input);
    const technology = await this.support.resolveTechnology(context, request.technology, 'link');
    const opts = { manager: context.manager, tenantId: context.tenantId };
    const currentOwners = await this.readOwners(context, technology.id);
    const currentContacts = await this.readContacts(context, technology.id);
    const stored = await this.normalizeChanges(context, request, currentOwners, currentContacts);
    if (!stored.owners_changed && !stored.contacts_changed) {
      throw new BadRequestException(`Nothing to change: ${technology.label} already has these people.`);
    }
    return {
      targetEntityType: 'technologies',
      targetEntityId: technology.id,
      mutationInput: {
        technology_ref: technology.ref,
        technology_name: technology.name,
        technology_label: technology.label,
        ...stored,
        touches_contacts: stored.touches_contacts,
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
    const reverse = typeof mutation.reverse_of === 'string';
    let summary = `Preview ${preview.id} ${preview.status}.`;
    switch (preview.status) {
      case 'pending': summary = reverse ? `Restore the people of ${label}.` : `Update the people of ${label}.`; break;
      case 'executed': summary = reverse ? `People restored on ${label}.` : `People updated on ${label}.`; break;
      case 'rejected': summary = `${reverse ? 'Restore' : 'People'} preview for ${label} was rejected.`; break;
      case 'expired': summary = `${reverse ? 'Restore' : 'People'} preview for ${label} expired before approval.`; break;
      case 'failed': summary = preview.error_message || `${reverse ? 'Restore' : 'People'} preview for ${label} failed.`; break;
    }
    if (language !== 'en') {
      summary = previewSummaryText(
        language,
        preview.status,
        writeActionText.updateTechnologyPeople(language, quoted(language, label)),
        { errorMessage: preview.error_message },
      );
    }
    const changes: Record<string, AiMutationPreviewPresentation['changes'][string]> = {};
    if (reverse) {
      const owners = this.ownerLinesFromSnapshots(language, this.coerceOwners(mutation.owners_restore));
      const contacts = this.contactLinesFromSnapshots(language, this.coerceContacts(mutation.contacts_restore));
      const restored = technologyPeopleRestoreCardText(language, owners, contacts);
      if (restored.owners) {
        changes.technology_owners = {
          label: { en: 'Owners', fr: 'Responsables', de: 'Verantwortliche', es: 'Responsables' }[language],
          from: null, to: restored.owners, format: 'markdown',
        };
      }
      if (restored.contacts) {
        changes.technology_support_contacts = {
          label: { en: 'Support contacts', fr: 'Contacts de support', de: 'Supportkontakte', es: 'Contactos de soporte' }[language],
          from: null, to: restored.contacts, format: 'markdown',
        };
      }
    } else {
      const owners = this.ownerLines(language, mutation.owners);
      const contacts = this.contactLines(language, mutation.support_contacts);
      if (owners) {
        changes.technology_owners = {
          label: { en: 'Owners', fr: 'Responsables', de: 'Verantwortliche', es: 'Responsables' }[language],
          from: null, to: owners, format: 'markdown',
        };
      }
      if (contacts) {
        changes.technology_support_contacts = {
          label: { en: 'Support contacts', fr: 'Contacts de support', de: 'Supportkontakte', es: 'Contactos de soporte' }[language],
          from: null, to: contacts, format: 'markdown',
        };
      }
    }
    return {
      target: {
        entity_type: 'technologies',
        entity_id: preview.target_entity_id ?? null,
        ref: typeof current.target_ref === 'string' ? current.target_ref : null,
        title: label,
      },
      changes,
      summary,
    };
  }

  async executePreview(context: AiExecutionContextWithManager, preview: AiMutationPreview): Promise<void> {
    if (!preview.target_entity_id) throw new BadRequestException('Preview is missing the technology.');
    const technology = await this.support.lockTechnology(context, preview.target_entity_id);
    const opts = {
      manager: context.manager,
      tenantId: context.tenantId,
      userId: context.userId ?? null,
      audit: buildAiMutationAudit(preview),
    };
    const mutation = preview.mutation_input ?? {};
    if (typeof mutation.reverse_of === 'string') {
      const expectedOwners = this.coerceOwners(mutation.expected_owners);
      const expectedContacts = this.coerceContacts(mutation.expected_contacts);
      const restoreOwners = this.coerceOwners(mutation.owners_restore);
      const restoreContacts = this.coerceContacts(mutation.contacts_restore);
      const liveOwners = await this.readOwners(context, technology.id);
      const liveContacts = await this.readContacts(context, technology.id);
      if (!sameOwners(liveOwners, expectedOwners) || !sameContacts(liveContacts, expectedContacts)) {
        throw new ConflictException(`People of ${technology.label} changed after the preview was created.`);
      }
      if (mutation.touches_owners === true) {
        await this.technologies.bulkReplaceOwners(technology.id, restoreOwners.map((owner) => ({ user_id: owner.user_id, owner_type: owner.owner_type })), opts);
      }
      if (mutation.touches_contacts === true) {
        await this.technologies.bulkReplaceSupportContacts(technology.id, restoreContacts.map((contact) => ({ contact_id: contact.contact_id, role: contact.role })), opts);
      }
      preview.current_values = {
        ...(preview.current_values ?? {}),
        applied: {
          owners: { touched: mutation.touches_owners === true, before: expectedOwners, after: restoreOwners },
          contacts: { touched: mutation.touches_contacts === true, before: expectedContacts, after: restoreContacts },
        } satisfies Applied,
      };
      return;
    }

    const beforeOwners = this.coerceOwners(mutation.owners_before);
    const afterOwners = this.coerceOwners(mutation.owners_after);
    const beforeContacts = this.coerceContacts(mutation.contacts_before);
    const afterContacts = this.coerceContacts(mutation.contacts_after);
    const touchesOwners = mutation.owners_changed === true;
    const touchesContacts = mutation.contacts_changed === true;
    const liveOwners = await this.readOwners(context, technology.id);
    const liveContacts = await this.readContacts(context, technology.id);
    if (touchesOwners && !sameOwners(liveOwners, beforeOwners)) {
      throw new ConflictException(`Owners of ${technology.label} changed after the preview was created.`);
    }
    if (touchesContacts && !sameContacts(liveContacts, beforeContacts)) {
      throw new ConflictException(`Support contacts of ${technology.label} changed after the preview was created.`);
    }
    if (touchesOwners) {
      await this.technologies.bulkReplaceOwners(technology.id, afterOwners.map((owner) => ({ user_id: owner.user_id, owner_type: owner.owner_type })), opts);
    }
    if (touchesContacts) {
      await this.technologies.bulkReplaceSupportContacts(technology.id, afterContacts.map((contact) => ({ contact_id: contact.contact_id, role: contact.role })), opts);
    }
    preview.current_values = {
      ...(preview.current_values ?? {}),
      applied: {
        owners: { touched: touchesOwners, before: beforeOwners, after: afterOwners },
        contacts: { touched: touchesContacts, before: beforeContacts, after: afterContacts },
      } satisfies Applied,
    };
  }

  async prepareReversePreview(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
  ): Promise<AiPreparedMutationPreview> {
    const applied = this.coerceApplied(preview.current_values?.applied);
    if (!applied || (!applied.owners.touched && !applied.contacts.touched)) {
      throw new BadRequestException('This preview changed no owner or support contact.');
    }
    if (!preview.target_entity_id) throw new BadRequestException('Original preview is missing the technology.');
    const technology = await this.support.lockTechnology(context, preview.target_entity_id);
    const liveOwners = await this.readOwners(context, technology.id);
    const liveContacts = await this.readContacts(context, technology.id);
    if ((applied.owners.touched && !sameOwners(liveOwners, applied.owners.after))
      || (applied.contacts.touched && !sameContacts(liveContacts, applied.contacts.after))) {
      throw new ConflictException(`People of ${technology.label} changed after the preview was created.`);
    }
    return {
      targetEntityType: 'technologies',
      targetEntityId: technology.id,
      mutationInput: {
        technology_ref: technology.ref,
        technology_name: technology.name,
        technology_label: technology.label,
        reverse_of: preview.id,
        touches_owners: applied.owners.touched,
        touches_contacts: applied.contacts.touched,
        owners_restore: applied.owners.touched ? applied.owners.before : [],
        contacts_restore: applied.contacts.touched ? applied.contacts.before : [],
        expected_owners: applied.owners.after,
        expected_contacts: applied.contacts.after,
      },
      currentValues: {
        target_ref: technology.ref,
        target_title: technology.label,
      },
    };
  }

  /** The request as the operation takes it, including from a plan step without the Zod schema. */
  private normalizeRequest(input: UpdateTechnologyPeopleInput | Record<string, unknown>): UpdateTechnologyPeopleInput {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('Nothing to change: add or remove an owner or a support contact.');
    }
    const raw = input as Record<string, unknown>;
    assertKnownKeys(raw, ['technology', 'owners', 'support_contacts'], 'update_technology_people');
    const technology = text(raw.technology);
    if (!technology) throw new BadRequestException('A technology is required.');
    const owners = groupEntries(raw.owners, ['add', 'remove'], 'owners');
    const contacts = groupEntries(raw.support_contacts, ['add', 'remove'], 'support_contacts');
    const entries = (group: Record<string, unknown>, key: string): Array<Record<string, unknown>> => {
      const value = group[key];
      if (value === undefined) return [];
      return value as Array<Record<string, unknown>>;
    };
    for (const entry of entries(owners, 'add')) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new BadRequestException('Every owner to add must be an object.');
      assertKnownKeys(entry, ['user', 'owner_type'], 'owners add');
      if (!text(entry.user)) throw new BadRequestException('Every owner to add needs a user.');
      if (entry.owner_type !== 'it' && entry.owner_type !== 'business') {
        throw new BadRequestException('owner_type must be it or business.');
      }
    }
    for (const entry of entries(owners, 'remove')) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new BadRequestException('Every owner to remove must be an object.');
      assertKnownKeys(entry, ['user', 'owner_type'], 'owners remove');
      if (!text(entry.user)) throw new BadRequestException('Every owner to remove needs a user.');
      if (entry.owner_type !== undefined && entry.owner_type !== 'it' && entry.owner_type !== 'business') {
        throw new BadRequestException('owner_type must be it or business.');
      }
    }
    for (const entry of entries(contacts, 'add')) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new BadRequestException('Every support contact to add must be an object.');
      assertKnownKeys(entry, ['contact', 'role'], 'support_contacts add');
      if (!text(entry.contact)) throw new BadRequestException('Every support contact to add needs a contact.');
      if (entry.role != null && (typeof entry.role !== 'string' || String(entry.role).length > 200)) {
        throw new BadRequestException('A contact role must be 200 characters or fewer.');
      }
    }
    for (const entry of entries(contacts, 'remove')) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new BadRequestException('Every support contact to remove must be an object.');
      assertKnownKeys(entry, ['contact'], 'support_contacts remove');
      if (!text(entry.contact)) throw new BadRequestException('Every support contact to remove needs a contact.');
    }
    const count = entries(owners, 'add').length + entries(owners, 'remove').length
      + entries(contacts, 'add').length + entries(contacts, 'remove').length;
    if (count === 0) throw new BadRequestException('Nothing to change: add or remove an owner or a support contact.');
    return raw as unknown as UpdateTechnologyPeopleInput;
  }

  private async resolveActiveUser(context: AiExecutionContextWithManager, name: string): Promise<{ id: string; name: string }> {
    const rows: Array<{ id: string; name: string | null }> = await context.manager.query(
      `SELECT id, NULLIF(btrim(concat_ws(' ', first_name, last_name)), '') AS name
         FROM users WHERE tenant_id = $1 AND status = 'enabled'`,
      [context.tenantId],
    );
    const matches = rows.filter((row) => row.name && sameName(row.name, name));
    if (matches.length > 1) {
      // The interface shows names only: the refusal does not reveal an email.
      throw new BadRequestException(`Two active users are named "${name}". Use the screen to choose the right one.`);
    }
    if (!matches[0]) throw new NotFoundException(`User "${name}" not found among the active users.`);
    return { id: matches[0].id, name: matches[0].name! };
  }

  private async resolveContact(context: AiExecutionContextWithManager, name: string): Promise<{ id: string; name: string }> {
    const rows: Array<{ id: string; first_name: string | null; last_name: string | null; email: string | null }> = await context.manager.query(
      `SELECT id, first_name, last_name, email FROM contacts WHERE tenant_id = $1`,
      [context.tenantId],
    );
    const matches = rows
      .map((row) => ({ id: row.id, name: contactName(row) }))
      .filter((row) => row.name && sameName(row.name, name));
    if (matches.length > 1) {
      throw new BadRequestException(`Two contacts are named "${name}". Use the screen to choose the right one.`);
    }
    if (!matches[0]) throw new NotFoundException(`Contact "${name}" not found.`);
    return matches[0];
  }

  private async readOwners(context: AiExecutionContextWithManager, technologyId: string): Promise<OwnerSnapshot[]> {
    const rows = await this.technologies.listOwners(technologyId, { manager: context.manager, tenantId: context.tenantId });
    return rows.map((row: any) => ({
      user_id: String(row.user_id),
      owner_type: row.owner_type === 'business' ? 'business' as const : 'it' as const,
      name: text(row.full_name),
    }));
  }

  private async readContacts(context: AiExecutionContextWithManager, technologyId: string): Promise<ContactSnapshot[]> {
    const rows = await this.technologies.listSupportContacts(technologyId, { manager: context.manager, tenantId: context.tenantId });
    return rows.map((row: any) => ({
      contact_id: String(row.contact_id),
      role: row.role == null ? null : String(row.role),
      name: contactName(row.contact ?? {}),
    }));
  }

  private async normalizeChanges(
    context: AiExecutionContextWithManager,
    input: UpdateTechnologyPeopleInput,
    currentOwners: OwnerSnapshot[],
    currentContacts: ContactSnapshot[],
  ): Promise<Stored> {
    const ownersAfter = [...currentOwners];
    const ownerGroup: OwnerGroup | null = input.owners ? { add: [], remove: [], already: [], absent: [] } : null;
    const seenOwners = new Set<string>();
    for (const entry of input.owners?.remove ?? []) {
      const key = `remove:${text(entry.user).toLowerCase()}:${entry.owner_type ?? '*'}`;
      if (seenOwners.has(key)) continue;
      seenOwners.add(key);
      const user = await this.resolveActiveUser(context, text(entry.user));
      const types: OwnerType[] = entry.owner_type ? [entry.owner_type] : ['it', 'business'];
      let removed = false;
      for (const type of types) {
        const index = ownersAfter.findIndex((owner) => owner.user_id === user.id && owner.owner_type === type);
        if (index < 0) continue;
        ownersAfter.splice(index, 1);
        ownerGroup!.remove.push({ name: user.name, owner_type: type });
        removed = true;
      }
      if (!removed) ownerGroup!.absent.push({ name: user.name, owner_type: entry.owner_type ?? null });
    }
    for (const entry of input.owners?.add ?? []) {
      const type = entry.owner_type;
      const key = `add:${text(entry.user).toLowerCase()}:${type}`;
      if (seenOwners.has(key)) continue;
      seenOwners.add(key);
      const user = await this.resolveActiveUser(context, text(entry.user));
      if (ownersAfter.some((owner) => owner.user_id === user.id && owner.owner_type === type)) {
        ownerGroup!.already.push({ name: user.name, owner_type: type });
        continue;
      }
      ownersAfter.push({ user_id: user.id, owner_type: type, name: user.name });
      ownerGroup!.add.push({ name: user.name, owner_type: type });
    }

    const contactsAfter = [...currentContacts];
    const contactGroup: ContactGroup | null = input.support_contacts ? { add: [], remove: [], already: [], absent: [] } : null;
    const seenContacts = new Set<string>();
    for (const entry of input.support_contacts?.remove ?? []) {
      const key = `remove:${text(entry.contact).toLowerCase()}`;
      if (seenContacts.has(key)) continue;
      seenContacts.add(key);
      const contact = await this.resolveContact(context, text(entry.contact));
      const index = contactsAfter.findIndex((row) => row.contact_id === contact.id);
      if (index < 0) {
        contactGroup!.absent.push({ name: contact.name, role: null });
        continue;
      }
      const [removed] = contactsAfter.splice(index, 1);
      contactGroup!.remove.push({ name: removed.name, role: removed.role });
    }
    for (const entry of input.support_contacts?.add ?? []) {
      const key = `add:${text(entry.contact).toLowerCase()}`;
      if (seenContacts.has(key)) continue;
      seenContacts.add(key);
      const contact = await this.resolveContact(context, text(entry.contact));
      const existing = contactsAfter.find((row) => row.contact_id === contact.id);
      if (existing) {
        contactGroup!.already.push({ name: existing.name, role: existing.role });
        continue;
      }
      const role = text(entry.role) || null;
      contactsAfter.push({ contact_id: contact.id, role, name: contact.name });
      contactGroup!.add.push({ name: contact.name, role });
    }

    const ownersChanged = !sameOwners(currentOwners, ownersAfter);
    const contactsChanged = !sameContacts(currentContacts, contactsAfter);
    return {
      owners: ownerGroup,
      support_contacts: contactGroup,
      owners_before: currentOwners,
      owners_after: ownersAfter,
      contacts_before: currentContacts,
      contacts_after: contactsAfter,
      owners_changed: ownersChanged,
      contacts_changed: contactsChanged,
      touches_contacts: !!input.support_contacts,
    };
  }

  private ownerLines(language: AiWriteLanguage, value: unknown): string | null {
    const group = this.coerceOwnerGroup(value);
    if (!group) return null;
    return technologyOwnerCardText(language, {
      add: group.add.map((entry) => this.ownerLine(language, entry)),
      remove: group.remove.map((entry) => this.ownerLine(language, entry)),
      already: group.already.map((entry) => this.ownerLine(language, entry)),
      absent: group.absent.map((entry) => this.ownerLine(language, entry)),
    });
  }

  private ownerLine(language: AiWriteLanguage, entry: OwnerChange): string {
    return entry.owner_type
      ? technologyOwnerLine(language, entry.name, entry.owner_type)
      : escapeMarkdownLabel(entry.name);
  }

  private contactLines(language: AiWriteLanguage, value: unknown): string | null {
    const group = this.coerceContactGroup(value);
    if (!group) return null;
    return technologyContactCardText(language, {
      add: group.add.map((entry) => technologyContactLine(language, entry.name, entry.role)),
      remove: group.remove.map((entry) => technologyContactLine(language, entry.name, entry.role)),
      already: group.already.map((entry) => technologyContactLine(language, entry.name, entry.role)),
      absent: group.absent.map((entry) => technologyContactLine(language, entry.name, entry.role)),
    });
  }

  private ownerLinesFromSnapshots(language: AiWriteLanguage, owners: OwnerSnapshot[]): string[] {
    return owners.map((owner) => technologyOwnerLine(language, owner.name, owner.owner_type));
  }

  private contactLinesFromSnapshots(language: AiWriteLanguage, contacts: ContactSnapshot[]): string[] {
    return contacts.map((contact) => technologyContactLine(language, contact.name, contact.role));
  }

  private coerceOwnerGroup(value: unknown): OwnerGroup | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    const list = (key: string): OwnerChange[] => (Array.isArray(raw[key]) ? raw[key] as Array<Record<string, unknown>> : [])
      .map((entry) => ({
        name: text(entry.name),
        owner_type: entry.owner_type === 'business' ? 'business' as const : entry.owner_type === 'it' ? 'it' as const : null,
      }))
      .filter((entry) => entry.name);
    return { add: list('add'), remove: list('remove'), already: list('already'), absent: list('absent') };
  }

  private coerceContactGroup(value: unknown): ContactGroup | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    const list = (key: string): ContactChange[] => (Array.isArray(raw[key]) ? raw[key] as Array<Record<string, unknown>> : [])
      .map((entry) => ({ name: text(entry.name), role: entry.role == null ? null : text(entry.role) || null }))
      .filter((entry) => entry.name);
    return { add: list('add'), remove: list('remove'), already: list('already'), absent: list('absent') };
  }

  private coerceOwners(value: unknown): OwnerSnapshot[] {
    return (Array.isArray(value) ? value as Array<Record<string, unknown>> : [])
      .map((row) => ({
        user_id: text(row.user_id),
        owner_type: row.owner_type === 'business' ? 'business' as const : 'it' as const,
        name: text(row.name),
      }))
      .filter((row) => row.user_id);
  }

  private coerceContacts(value: unknown): ContactSnapshot[] {
    return (Array.isArray(value) ? value as Array<Record<string, unknown>> : [])
      .map((row) => ({
        contact_id: text(row.contact_id),
        role: row.role == null ? null : text(row.role) || null,
        name: text(row.name),
      }))
      .filter((row) => row.contact_id);
  }

  private coerceApplied(value: unknown): Applied | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    const owners = raw.owners && typeof raw.owners === 'object' ? raw.owners as Record<string, unknown> : {};
    const contacts = raw.contacts && typeof raw.contacts === 'object' ? raw.contacts as Record<string, unknown> : {};
    return {
      owners: {
        touched: owners.touched === true,
        before: this.coerceOwners(owners.before),
        after: this.coerceOwners(owners.after),
      },
      contacts: {
        touched: contacts.touched === true,
        before: this.coerceContacts(contacts.before),
        after: this.coerceContacts(contacts.after),
      },
    };
  }
}
