import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Incident } from '../incident.entity';
import { parseCreateEntry } from '../dto';
import { INCIDENT_REVIEW_SLOT } from '../../knowledge/integrated-document.constants';
import { IncidentsBaseService, ServiceOpts, userNameSql } from './incidents-base.service';
import { applicationParticipantCondition, type ParticipationAccessScope } from '../../auth/business-contributor-scope';
import { partlyCountedSide, type LinkedActivitySide } from '../../common/relations/linked-activity';

const ENTRY_COLUMNS = `
  e.id, e.incident_id, e.kind, e.content, e.changed_fields, e.occurred_at,
  e.author_id, ${userNameSql('u')} AS author_name, e.created_at`;

const ENTRY_FROM = `
  FROM incident_entries e
  LEFT JOIN users u ON u.id = e.author_id AND u.tenant_id = e.tenant_id`;

/** The module flag that reads each family a link change names (`ServiceOpts`). */
const LINK_CHANGE_READS: Record<string, 'technologies' | 'applications'> = {
  assets: 'technologies',
  technologies: 'technologies',
  applications: 'applications',
};

/** The families whose link changes the reader does not see: `counts.entries` leaves them out too. */
export function unreadableLinkChangeFamilies(opts?: ServiceOpts): string[] {
  return Object.keys(LINK_CHANGE_READS).filter((family) => opts?.[LINK_CHANGE_READS[family]] !== true);
}

/**
 * Whether the reader may see a journal entry. A link change names linked records (`Assets linked:
 * AST-50`): it shows only to a reader of their module, as the Relations tab. Notes and the other
 * entries keep their text.
 */
function readableLinkChange(
  row: { kind?: string; changed_fields?: Record<string, unknown> | null },
  opts?: ServiceOpts,
): boolean {
  if (row.kind !== 'link_change') return true;
  return Object.keys(row.changed_fields ?? {}).every((family) => {
    const read = LINK_CHANGE_READS[family];
    return !read || opts?.[read] === true;
  });
}

/** The families of a link change, in the order the sentence names them, with their label. */
const LINK_CHANGE_LABELS: Array<[string, string]> = [['assets', 'Assets'], ['applications', 'Applications'], ['technologies', 'Technologies']];

type JournalRow = { kind?: string; content?: string | null; changed_fields?: Record<string, any> | null };

const refList = (value: unknown): string[] | null =>
  (Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value as string[] : null);

const hiddenOf = (side: LinkedActivitySide): number => (Array.isArray(side) ? 0 : side.hidden);

/**
 * The English sentence of a link change, from its snapshots: what each family gained and lost,
 * with the number of the records the reader does not see (`hidden`).
 */
function linkChangeSentence(changed: Record<string, any>): string {
  const parts: string[] = [];
  for (const [family, label] of LINK_CHANGE_LABELS) {
    const change = changed[family];
    const from = refList(change?.from);
    const to = refList(change?.to);
    if (!from || !to) continue;
    const refs = (shown: string[], hidden: number) => [...shown, ...(hidden > 0 ? [`${hidden} not shown`] : [])];
    const linked = refs(to.filter((ref) => !from.includes(ref)), Number(change.hidden?.linked) || 0);
    const unlinked = refs(from.filter((ref) => !to.includes(ref)), Number(change.hidden?.unlinked) || 0);
    if (linked.length) parts.push(`${label} linked: ${linked.join(', ')}`);
    if (unlinked.length) parts.push(`${label} unlinked: ${unlinked.join(', ')}`);
  }
  return parts.length ? `${parts.join('. ')}.` : '';
}

/**
 * The application link changes of a Business Contributor's journal: the references of the
 * applications of their participation, the others counted per direction (`hidden: { linked,
 * unlinked }`), and the entry's sentence rebuilt the same way. A reference is the application's
 * (`sequential_id`, unique in the tenant); a name stored for an application without one, or a
 * reference that no longer resolves, counts as not shown. One query for the whole journal.
 */
async function withApplicationRefsForReader<T extends JournalRow>(
  manager: EntityManager,
  tenantId: string,
  rows: T[],
  scope: ParticipationAccessScope | undefined,
): Promise<T[]> {
  if (!scope) return rows;
  const snapshots = (row: T) => {
    const change = row.kind === 'link_change' ? row.changed_fields?.applications : null;
    const from = refList(change?.from);
    const to = refList(change?.to);
    return from && to ? { from, to } : null;
  };
  const refs = new Set<string>();
  for (const row of rows) {
    const change = snapshots(row);
    for (const ref of [...(change?.from ?? []), ...(change?.to ?? [])]) refs.add(ref);
  }
  if (refs.size === 0) return rows;
  const visibleRows: Array<{ ref: string }> = await manager.query(
    `SELECT a.sequential_id AS ref
     FROM applications a
     WHERE a.tenant_id = $1
       AND a.sequential_id = ANY($2::text[])
       AND ${applicationParticipantCondition('a', '$3')}`,
    [tenantId, Array.from(refs), scope.userId],
  );
  const visible = new Set(visibleRows.map((row) => String(row.ref)));
  const shown = (ref: string) => visible.has(ref);
  return rows.map((row) => {
    const change = snapshots(row);
    if (!change || [...change.from, ...change.to].every(shown)) return row;
    const linked = partlyCountedSide(change.to.filter((ref) => !change.from.includes(ref)), shown);
    const unlinked = partlyCountedSide(change.from.filter((ref) => !change.to.includes(ref)), shown);
    const changed = {
      ...row.changed_fields,
      applications: {
        from: change.from.filter(shown),
        to: change.to.filter(shown),
        hidden: { linked: hiddenOf(linked), unlinked: hiddenOf(unlinked) },
      },
    };
    return { ...row, changed_fields: changed, content: linkChangeSentence(changed) };
  });
}

/**
 * Append-only journal: list + notes. Change entries are written by the other services.
 */
@Injectable()
export class IncidentEntriesService extends IncidentsBaseService {
  constructor(@InjectRepository(Incident) incidentRepo: Repository<Incident>) {
    super(incidentRepo);
  }

  async list(incidentId: string, opts?: ServiceOpts & { order?: 'asc' | 'desc' }) {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    await this.ensureIncident(incidentId, mg, tenantId, opts?.viewer);
    const direction = opts?.order === 'asc' ? 'ASC' : 'DESC';
    const rows = await mg.query(
      `SELECT ${ENTRY_COLUMNS} ${ENTRY_FROM}
       WHERE e.incident_id = $1 AND e.tenant_id = $2
       ORDER BY e.occurred_at ${direction}, e.created_at ${direction}`,
      [incidentId, tenantId],
    );
    await this.decorateReviewVersions(rows, incidentId, mg, tenantId);
    const readable = rows.filter((row: JournalRow) => readableLinkChange(row, opts));
    // A Business Contributor's journal names only the applications of their participation.
    return withApplicationRefsForReader(mg, tenantId, readable, opts?.applications ? opts.applicationScope : undefined);
  }

  /**
   * `changed_fields.review_version` stores `{ document_id, version_number, revision }`
   * (§3.3). Only the document id is persisted, so the readable DOC-N reference
   * is resolved here, for this incident's own review binding only, in one
   * batched tenant-scoped query. Nothing is written back to the journal.
   */
  private async decorateReviewVersions(
    rows: Array<{ changed_fields?: Record<string, any> | null }>,
    incidentId: string,
    manager: EntityManager,
    tenantId: string,
  ): Promise<void> {
    const targets = rows
      .map((row) => row?.changed_fields?.review_version?.to)
      .filter((value): value is Record<string, unknown> => !!value && typeof value === 'object');
    if (targets.length === 0) return;

    const bound: Array<{ document_id: string; item_number: number | null }> = await manager.query(
      `SELECT d.id::text AS document_id, d.item_number
       FROM integrated_document_bindings b
       JOIN documents d ON d.id = b.document_id AND d.tenant_id = b.tenant_id
       WHERE b.tenant_id = $1
         AND b.source_entity_type = '${INCIDENT_REVIEW_SLOT.sourceEntityType}'
         AND b.source_entity_id = $2
         AND b.slot_key = '${INCIDENT_REVIEW_SLOT.slotKey}'
       LIMIT 1`,
      [tenantId, incidentId],
    );
    const review = bound[0];
    if (!review || review.item_number == null) return;

    for (const target of targets) {
      if (String(target.document_id ?? '') !== review.document_id) continue;
      target.item_number = Number(review.item_number);
      target.item_ref = `DOC-${Number(review.item_number)}`;
    }
  }

  /**
   * Add a note. `occurred_at` defaults to now; refused when the incident is closed.
   */
  async createNote(incidentId: string, body: unknown, userId: string | null, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    const dto = parseCreateEntry(body);
    const incident = await this.ensureIncident(incidentId, mg, tenantId, opts?.viewer);
    this.assertEditable(incident);

    const entry = await this.addEntry(mg, incident, {
      kind: 'note',
      content: dto.content,
      occurred_at: dto.occurred_at ? new Date(dto.occurred_at) : undefined,
      author_id: userId,
    });
    return this.getEntry(entry.id, mg, tenantId);
  }

  private async getEntry(entryId: string, manager: EntityManager, tenantId: string) {
    const [row] = await manager.query(
      `SELECT ${ENTRY_COLUMNS} ${ENTRY_FROM} WHERE e.id = $1 AND e.tenant_id = $2`,
      [entryId, tenantId],
    );
    return row;
  }
}
