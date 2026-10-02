import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('scheduled_tasks')
export class ScheduledTask {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('text', { unique: true })
  name!: string;

  @Column('text', { nullable: true })
  description!: string | null;

  @Column('text')
  cron_expression!: string;

  @Column('boolean', { default: true })
  enabled!: boolean;

  @Column('timestamptz', { nullable: true })
  last_run_at!: Date | null;

  @Column('text', { nullable: true })
  last_status!: string | null;

  @Column('integer', { nullable: true })
  last_duration_ms!: number | null;

  /** Scheduled time of the last cron tick an API process claimed (see ScheduledTasksService.claimTick). */
  @Column('timestamptz', { nullable: true })
  last_tick_at!: Date | null;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  @Column('timestamptz', { default: () => 'now()' })
  updated_at!: Date;
}
