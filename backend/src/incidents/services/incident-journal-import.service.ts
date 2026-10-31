import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { parseString } from '@fast-csv/parse';
import { EntityManager } from 'typeorm';
import {
  csvSeparatorOf,
  readImportText,
  instantInTimeZone,
  knownTimeZone,
  readTimeZoneHeader,
} from '../../common/csv-sheet';
import { parseItemNumber } from '../../common/parse-item-number';
import { DemoDataService } from '../../demo-data/demo-data.service';
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES } from '../incident.entity';

/**
 * The entry kinds a journal file may carry. The service-generated kinds
 * (`system`, `link_change`, `reopen`) stay out: an import narrates facts, it
 * does not replay the register's own bookkeeping.
 */
const IMPORTABLE_KINDS = new Set(['note', 'status_change', 'severity_change']);

const REQUIRED_COLUMNS = [
  'incident_ref',
  'incident_title',
  'occurred_at',
  'author_email',
  'kind',
  'content',
] as const;

type ImportableKind = 'note' | 'status_change' | 'severity_change';

type RawRow = {
  rowNumber: number;
  ref: number;
  title: string;
  occurredAt: Date;
  authorEmail: string;
  kind: ImportableKind;
  content: string;
  statusFrom: string;
  statusTo: string;
  severityFrom: string;
  severityTo: string;
};

type ParsedEntry = {
  incidentId: string;
  kind: ImportableKind;
  content: string | null;
  changedFields: Record<string, { from: string; to: string }> | null;
  occurredAt: Date;
  authorId: string;
};

export type IncidentJournalImportResult = {
  ok: true;
  imported: number;
  skipped: number;
  entries: number;
};

/**
 * Imports a journal file into the append-only timeline, with the author and
 * the event time of each row.
 *
 * The incident CSV import never carries the timeline (a customer register
 * arrives without its history), so this path exists for the sample data: the
 * fixture runner has a file whose rows name an incident, an author, a kind and
 * the time of the fact. `created_at` stays the database default, the load
 * time, which is the truth for a backdated note. A row identical to an
 * existing entry is skipped, so the runner can be re-run.
 *
 * Only `incidents:admin` reaches the route, and only while the sample data of
 * the workspace is loading: choosing the author of a journal entry is a
 * register-administrator act, and the timeline is never a user import. Outside
 * a sample-data load the route answers 409 `SAMPLE_DATA_LOAD_ONLY` and writes
 * nothing.
 */
@Injectable()
export class IncidentJournalImportService {
  constructor(private readonly demo: DemoDataService) {}

  async import(
    file: Express.Multer.File,
    opts: { manager: EntityManager; tenantId: string },
  ): Promise<IncidentJournalImportResult> {
    const state = await this.demo.getStatus(opts.tenantId);
    if (state.status !== 'loading') {
      throw new ConflictException({
        code: 'SAMPLE_DATA_LOAD_ONLY',
        message: 'The incident journal can be imported only while the sample data of this workspace is loading.',
      });
    }
    if (!file?.buffer?.length) throw new BadRequestException('A CSV file is required.');

    let text: string;
    try {
      text = (await readImportText(file.buffer)).text;
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'The journal file could not be read.');
    }
    const rows = await this.readRows(text);
    if (rows.length < 2) throw new BadRequestException('The journal file has no entry.');

    const { index, timeZone } = this.readColumns(rows[0]);
    const rawRows = this.readRawRows(rows.slice(1), index, timeZone);
    if (rawRows.length === 0) throw new BadRequestException('The journal file has no entry.');

    const incidentByNumber = await this.loadIncidents(
      opts.manager,
      opts.tenantId,
      [...new Set(rawRows.map((row) => row.ref))],
    );
    const authorByEmail = await this.loadAuthors(
      opts.manager,
      opts.tenantId,
      [...new Set(rawRows.map((row) => row.authorEmail))],
    );
    const entries = rawRows.map((row) => this.toEntry(row, incidentByNumber, authorByEmail));

    let imported = 0;
    let skipped = 0;
    for (const entry of entries) {
      const [result]: Array<{ n: number }> = await opts.manager.query(
        `WITH inserted AS (
           INSERT INTO incident_entries (tenant_id, incident_id, kind, content, changed_fields, occurred_at, author_id)
           SELECT $1, $2, $3, $4, $5::jsonb, $6, $7
           WHERE NOT EXISTS (
             SELECT 1 FROM incident_entries e
             WHERE e.tenant_id = $1
               AND e.incident_id = $2
               AND e.kind = $3
               AND e.author_id = $7
               AND e.occurred_at = $6
               AND e.content IS NOT DISTINCT FROM $4
               AND e.changed_fields IS NOT DISTINCT FROM $5::jsonb
           )
           RETURNING id
         )
         SELECT count(*)::int AS n FROM inserted`,
        [
          opts.tenantId,
          entry.incidentId,
          entry.kind,
          entry.content,
          entry.changedFields ? JSON.stringify(entry.changedFields) : null,
          entry.occurredAt,
          entry.authorId,
        ],
      );
      if (Number(result?.n) > 0) imported += 1;
      else skipped += 1;
    }

    return { ok: true, imported, skipped, entries: entries.length };
  }

  /** Reads the file with the shared separator and encoding rules. */
  private readRows(text: string): Promise<string[][]> {
    return new Promise((resolve, reject) => {
      const rows: string[][] = [];
      parseString(text, {
        headers: false,
        delimiter: csvSeparatorOf(text) ?? ';',
        ignoreEmpty: true,
        trim: false,
      })
        .on('data', (row: string[]) => rows.push(row))
        .on('error', (error: Error) =>
          reject(new BadRequestException(`The journal file could not be read: ${error.message}`)),
        )
        .on('end', () => resolve(rows));
    });
  }

  /**
   * The column indexes, and the zone of the `occurred_at` cells when the header
   * names one (`occurred_at (Europe/Paris)`); UTC otherwise, as every CSV import.
   */
  private readColumns(header: string[]): { index: Record<string, number>; timeZone: string } {
    const index: Record<string, number> = {};
    let timeZone = 'UTC';
    header.forEach((raw, position) => {
      const label = String(raw ?? '').trim();
      if (!label) return;
      const named = readTimeZoneHeader(label);
      const column = named?.column ?? label;
      index[column] = position;
      if (column === 'occurred_at' && named) {
        const zone = knownTimeZone(named.zone);
        if (!zone) {
          throw new BadRequestException(`Unknown time zone in the occurred_at column: "${named.zone}".`);
        }
        timeZone = zone;
      }
    });
    const missing = REQUIRED_COLUMNS.filter((column) => index[column] == null);
    if (missing.length > 0) {
      throw new BadRequestException(`Missing journal column(s): ${missing.join(', ')}.`);
    }
    return { index, timeZone };
  }

  private readRawRows(
    rows: string[][],
    index: Record<string, number>,
    timeZone: string,
  ): RawRow[] {
    const rawRows: RawRow[] = [];
    rows.forEach((row, offset) => {
      if (row.every((cell) => String(cell ?? '').trim() === '')) return;
      const rowNumber = offset + 2;
      const cell = (column: string) => {
        const position = index[column];
        return position == null ? '' : String(row[position] ?? '').trim();
      };
      const kind = cell('kind').toLowerCase();
      if (!IMPORTABLE_KINDS.has(kind)) {
        throw new BadRequestException(
          `Row ${rowNumber}: unknown kind "${cell('kind')}". Use note, status_change or severity_change.`,
        );
      }
      rawRows.push({
        rowNumber,
        ref: this.parseRef(cell('incident_ref'), rowNumber),
        title: cell('incident_title'),
        occurredAt: this.parseOccurredAt(cell('occurred_at'), timeZone, rowNumber),
        authorEmail: cell('author_email').toLowerCase(),
        kind: kind as ImportableKind,
        content: cell('content'),
        statusFrom: cell('status_from').toLowerCase(),
        statusTo: cell('status_to').toLowerCase(),
        severityFrom: cell('severity_from').toLowerCase(),
        severityTo: cell('severity_to').toLowerCase(),
      });
    });
    return rawRows;
  }

  private async loadIncidents(
    manager: EntityManager,
    tenantId: string,
    refs: number[],
  ): Promise<Map<number, { id: string; title: string }>> {
    const rows: Array<{ id: string; item_number: number; title: string }> = await manager.query(
      `SELECT id, item_number, title
         FROM incidents
        WHERE tenant_id = $1 AND item_number = ANY($2::int[])`,
      [tenantId, refs],
    );
    return new Map(rows.map((row) => [Number(row.item_number), { id: row.id, title: row.title }]));
  }

  private async loadAuthors(
    manager: EntityManager,
    tenantId: string,
    emails: string[],
  ): Promise<Map<string, string>> {
    const rows: Array<{ id: string; email: string }> = await manager.query(
      `SELECT id, lower(email) AS email
         FROM users
        WHERE tenant_id = $1 AND lower(email) = ANY($2::text[])`,
      [tenantId, emails],
    );
    return new Map(rows.map((row) => [row.email, row.id]));
  }

  private toEntry(
    row: RawRow,
    incidentByNumber: Map<number, { id: string; title: string }>,
    authorByEmail: Map<string, string>,
  ): ParsedEntry {
    const incident = incidentByNumber.get(row.ref);
    if (!incident) {
      throw new BadRequestException(`Row ${row.rowNumber}: incident INC-${row.ref} not found.`);
    }
    if (!row.title || row.title !== incident.title) {
      throw new BadRequestException(
        `Row ${row.rowNumber}: INC-${row.ref} is "${incident.title}", not "${row.title}".`,
      );
    }
    const authorId = authorByEmail.get(row.authorEmail);
    if (!authorId) {
      throw new BadRequestException(
        `Row ${row.rowNumber}: author "${row.authorEmail}" is not a user of this workspace.`,
      );
    }

    if (row.kind === 'note') {
      if (!row.content) throw new BadRequestException(`Row ${row.rowNumber}: a note needs content.`);
      if (row.statusFrom || row.statusTo || row.severityFrom || row.severityTo) {
        throw new BadRequestException(
          `Row ${row.rowNumber}: a note carries no status or severity change.`,
        );
      }
      return { incidentId: incident.id, kind: row.kind, content: row.content, changedFields: null, occurredAt: row.occurredAt, authorId };
    }

    if (row.kind === 'status_change') {
      if (!row.statusFrom || !row.statusTo) {
        throw new BadRequestException(`Row ${row.rowNumber}: a status change needs both statuses.`);
      }
      if (row.severityFrom || row.severityTo) {
        throw new BadRequestException(`Row ${row.rowNumber}: a status change carries no severity change.`);
      }
      const from = this.parseStatus(row.statusFrom, row.rowNumber);
      const to = this.parseStatus(row.statusTo, row.rowNumber);
      if (from === to) throw new BadRequestException(`Row ${row.rowNumber}: the status does not change.`);
      return {
        incidentId: incident.id,
        kind: row.kind,
        content: row.content || null,
        changedFields: { status: { from, to } },
        occurredAt: row.occurredAt,
        authorId,
      };
    }

    if (!row.severityFrom || !row.severityTo) {
      throw new BadRequestException(`Row ${row.rowNumber}: a severity change needs both severities.`);
    }
    if (row.statusFrom || row.statusTo) {
      throw new BadRequestException(`Row ${row.rowNumber}: a severity change carries no status change.`);
    }
    const from = this.parseSeverity(row.severityFrom, row.rowNumber);
    const to = this.parseSeverity(row.severityTo, row.rowNumber);
    if (from === to) throw new BadRequestException(`Row ${row.rowNumber}: the severity does not change.`);
    return {
      incidentId: incident.id,
      kind: row.kind,
      content: row.content || null,
      changedFields: { severity: { from, to } },
      occurredAt: row.occurredAt,
      authorId,
    };
  }

  private parseRef(value: string, rowNumber: number): number {
    const match = /^(?:INC[-\s]?)?(\d+)$/i.exec(value);
    if (!match) {
      throw new BadRequestException(`Row ${rowNumber}: invalid incident_ref "${value}". Use INC-4.`);
    }
    const number = parseItemNumber(match[1]);
    if (number == null) {
      throw new BadRequestException(`Row ${rowNumber}: invalid incident_ref "${value}". Use INC-4.`);
    }
    return number;
  }

  private parseOccurredAt(value: string, timeZone: string, rowNumber: number): Date {
    const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
    if (match) {
      const time = match[2] ? `${match[2].padStart(2, '0')}:${match[3]}:${match[4] ?? '00'}` : null;
      const date = instantInTimeZone(match[1], time, timeZone);
      if (!isNaN(date.getTime())) return date;
    }
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) return parsed;
    throw new BadRequestException(
      `Row ${rowNumber}: invalid occurred_at "${value}". Use 2026-06-02 07:52 or an ISO instant.`,
    );
  }

  private parseStatus(value: string, rowNumber: number): string {
    const normalized = value.replace(/[\s-]+/g, '_');
    if (!(INCIDENT_STATUSES as readonly string[]).includes(normalized)) {
      throw new BadRequestException(
        `Row ${rowNumber}: invalid status "${value}". Use ${INCIDENT_STATUSES.join(', ')}.`,
      );
    }
    return normalized;
  }

  private parseSeverity(value: string, rowNumber: number): string {
    const normalized = value.replace(/[\s-]+/g, '_');
    if (!(INCIDENT_SEVERITIES as readonly string[]).includes(normalized)) {
      throw new BadRequestException(
        `Row ${rowNumber}: invalid severity "${value}". Use ${INCIDENT_SEVERITIES.join(', ')}.`,
      );
    }
    return normalized;
  }
}
