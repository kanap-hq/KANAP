import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { StatusState } from '../common/status';

/**
 * A working-day calendar ("calendar" in the UI): for each year, the working
 * days of the twelve months, as decimal strings. A price per day multiplies
 * them. Rounds that use a calendar reference it by `(tenant_id, id)` with
 * ON DELETE RESTRICT; the shape of `days_by_year` is checked by
 * `normalizeDaysByYear` (the database only checks that it is an object). On a
 * standard calendar `days_by_year` holds the edited years only.
 */
@Entity('working_day_profiles')
export class WorkingDayProfile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid', { default: () => 'app_current_tenant()' })
  tenant_id!: string;

  @Column('text')
  code!: string;

  @Column('text')
  name!: string;

  @Column('text', { nullable: true })
  description!: string | null;

  @Column('jsonb', { default: () => "'{}'::jsonb" })
  days_by_year!: Record<string, string[]>;

  /** Set on a standard calendar (its years follow this country's public holidays), at creation only. */
  @Column('text', { nullable: true })
  country_iso!: string | null;

  /** The public holiday package's code of a region of `country_iso`, when the calendar follows one. */
  @Column('text', { nullable: true })
  region_code!: string | null;

  @Column({
    type: 'enum',
    enum: StatusState,
    enumName: 'status_state',
    default: StatusState.ENABLED,
  })
  status!: StatusState;

  @Column('timestamptz', { nullable: true })
  disabled_at!: Date | null;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  @Column('timestamptz', { default: () => 'now()' })
  updated_at!: Date;
}
