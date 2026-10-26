import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const INCIDENT_SEVERITIES = ['critical', 'major', 'minor', 'low'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_STATUSES = ['open', 'in_progress', 'resolved', 'closed', 'cancelled'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/**
 * Forward-only lifecycle. Backward moves go through Reopen; `cancelled` only through Cancel.
 * The CSV import reserves both to `incidents:admin` (incident-csv.config.ts).
 */
export const INCIDENT_STATUS_RANK: Record<IncidentStatus, number> = {
  open: 0, in_progress: 1, resolved: 2, closed: 3, cancelled: 4,
};

/**
 * True when only Reopen or Cancel may move an incident from `previous` to `next`: a lower rank
 * (backwards) or a cancellation, whatever the previous status. The CSV import refuses these
 * moves to a contributor and journals them for an administrator.
 */
export function isReservedIncidentStatusMove(
  next: string | null | undefined,
  previous: string | null | undefined,
): boolean {
  if (!next || !previous || next === previous) return false;
  if (!(next in INCIDENT_STATUS_RANK) || !(previous in INCIDENT_STATUS_RANK)) return false;
  return next === 'cancelled'
    || INCIDENT_STATUS_RANK[next as IncidentStatus] < INCIDENT_STATUS_RANK[previous as IncidentStatus];
}

@Entity('incidents')
@Index(['tenant_id', 'item_number'], { unique: true })
export class Incident {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  // Per-tenant sequential business reference (rendered as INC-N). Assigned on create.
  @Column('int')
  item_number!: number;

  @Column('text')
  title!: string;

  // Code from the IT settings list `incidentCategories`.
  @Column('text', { nullable: true })
  category!: string | null;

  @Column('text')
  severity!: IncidentSeverity;

  @Column('text', { default: 'open' })
  status!: IncidentStatus;

  @Column('timestamptz', { nullable: true })
  started_at!: Date | null;

  @Column('timestamptz', { default: () => 'now()' })
  detected_at!: Date;

  @Column('timestamptz', { nullable: true })
  resolved_at!: Date | null;

  @Column('timestamptz', { nullable: true })
  closed_at!: Date | null;

  @Column('uuid', { nullable: true })
  reporter_user_id!: string | null;

  @Column('uuid', { nullable: true })
  owner_user_id!: string | null;

  /**
   * Short summary. The full incident review lives in the `incidents:review`
   * integrated document (planning/incident-review-document.md).
   */
  @Column('text', { nullable: true })
  description!: string | null;

  @Column('text', { nullable: true })
  source_ref!: string | null;

  @Column('boolean', { default: false })
  confidential!: boolean;

  @Column('boolean', { default: false })
  personal_data_affected!: boolean;

  @Column('boolean', { default: false })
  authority_notification_required!: boolean;

  @Column('timestamptz', { nullable: true })
  authority_notified_at!: Date | null;

  @Column('text', { nullable: true })
  notified_parties!: string | null;

  @Column('uuid', { nullable: true })
  created_by!: string | null;

  @Column('uuid', { nullable: true })
  updated_by!: string | null;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  @Column('timestamptz', { default: () => 'now()' })
  updated_at!: Date;
}
