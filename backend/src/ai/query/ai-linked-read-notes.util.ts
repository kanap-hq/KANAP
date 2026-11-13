import type { AiExecutionContextWithManager } from '../ai.types';
import type { AiQueryEntityType, AiWithheldField } from './ai-filter.types';
import type { AiReadProbe } from './registries';
import { resolveAiParticipationAccessScope } from './ai-query-scope.util';

/**
 * The fields of a list or an aggregate that name another module's records and follow a Business
 * Contributor's participation: the task's and the incident's linked applications (their column,
 * their filter, their sort and their group).
 */
const PARTICIPATION_LINKED_FIELDS: Partial<Record<AiQueryEntityType, Record<string, 'applications'>>> = {
  tasks: { application: 'applications' },
  incidents: { application: 'applications' },
};

/** The other names a call may give the linked application field (the registries' aliases). */
const FIELD_ALIASES: Record<string, string> = { application_id: 'application', app: 'application', linked_application: 'application' };

/**
 * What a list or an aggregate says of its linked applications when the person reads only part of
 * them, so that the answer never turns a missing read into "none": `fields_withheld` when the
 * module is not read, `fields_partial` for a Business Contributor, whose rows, filters and groups
 * hold the applications of their participation only. `fields`: the fields the call touches (all of
 * the family's when omitted). Nothing for a person who reads every application.
 */
export async function aiLinkedReadNotes(
  context: AiExecutionContextWithManager,
  entityType: AiQueryEntityType,
  canRead: AiReadProbe,
  fields?: Array<string | null | undefined>,
): Promise<{ fields_withheld?: AiWithheldField[]; fields_partial?: AiWithheldField[] }> {
  const linked = PARTICIPATION_LINKED_FIELDS[entityType];
  if (!linked) return {};
  const touched = fields ? new Set(fields.filter((field): field is string => !!field).map((field) => FIELD_ALIASES[field] ?? field)) : null;
  const withheld: AiWithheldField[] = [];
  const partial: AiWithheldField[] = [];
  for (const [field, family] of Object.entries(linked)) {
    if (touched && !touched.has(field)) continue;
    if (!(await canRead(family))) {
      withheld.push({
        field,
        reason: `This person does not read ${family}: the ${family} linked to each record are not read here, which does not mean there are none: a record is not "without ${family}".`,
      });
    } else if (await resolveAiParticipationAccessScope(context, family)) {
      partial.push({
        field,
        reason: `This person reads only the ${family} they take part in (Business Contributor): rows, filters and groups name those only. `
          + `A record shown without ${family}, or counted in the group without one (null key), may be linked to ${family} they do not read: it is not "without ${family}".`,
      });
    }
  }
  return { ...(withheld.length ? { fields_withheld: withheld } : {}), ...(partial.length ? { fields_partial: partial } : {}) };
}

/** Two lists of withheld or partial fields as one, each field once. */
export function mergeFieldNotes(...lists: Array<AiWithheldField[] | undefined>): AiWithheldField[] | undefined {
  const byField = new Map<string, AiWithheldField>();
  for (const list of lists) for (const entry of list ?? []) if (!byField.has(entry.field)) byField.set(entry.field, entry);
  return byField.size ? Array.from(byField.values()) : undefined;
}
