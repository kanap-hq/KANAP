import { Entity, PrimaryGeneratedColumn, Column, Index, OneToMany } from 'typeorm';
import { TaskApplication } from './task-application.entity';
import { TaskAsset } from './task-asset.entity';

export type TaskRelatedObjectType = 'spend_item' | 'contract' | 'capex_item' | 'project' | 'incident' | null;
export type TaskPriorityLevel = 'blocker' | 'high' | 'normal' | 'low' | 'optional';
export type TaskStatus = 'open' | 'in_progress' | 'pending' | 'in_testing' | 'done' | 'cancelled';
export const TASK_STATUSES: TaskStatus[] = ['open', 'in_progress', 'pending', 'in_testing', 'done', 'cancelled'];
export const ACTIVE_TASK_STATUSES: TaskStatus[] = ['open', 'in_progress', 'pending', 'in_testing'];

export const PRIORITY_LEVELS: Record<TaskPriorityLevel, { label: string; adjustment: number }> = {
  blocker:  { label: 'Blocker',  adjustment: 10 },
  high:     { label: 'High',     adjustment: 5  },
  normal:   { label: 'Normal',   adjustment: 0  },
  low:      { label: 'Low',      adjustment: -5  },
  optional: { label: 'Optional', adjustment: -10 },
};

@Entity('tasks')
// Note: Partial indexes for related object queries are managed via migration
@Index(['tenant_id', 'status'])
@Index(['tenant_id', 'assignee_user_id'])
@Index(['tenant_id', 'due_date'])
@Index(['tenant_id', 'item_number'], { unique: true })
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  @Column('int')
  item_number!: number;

  @Column('text')
  title!: string;

  @Column('text', { nullable: true })
  description!: string | null;

  @Column('text', { default: 'open' })
  status!: TaskStatus;

  @Column('date', { nullable: true })
  due_date!: string | null;

  @Column('uuid', { nullable: true })
  assignee_user_id!: string | null;

  @Column('text', { nullable: true })
  related_object_type!: TaskRelatedObjectType;

  @Column('uuid', { nullable: true })
  related_object_id!: string | null;

  // Task type (FK to portfolio_task_types)
  @Column('uuid', { nullable: true })
  task_type_id!: string | null;

  // Classification fields
  @Column('uuid', { nullable: true })
  source_id!: string | null;

  @Column('uuid', { nullable: true })
  company_id!: string | null;

  // Fields for project tasks
  @Column('uuid', { nullable: true })
  phase_id!: string | null;

  @Column('text', { default: 'normal' })
  priority_level!: TaskPriorityLevel;

  @Column('date', { nullable: true })
  start_date!: string | null;

  @Column('jsonb', { default: '[]' })
  labels!: string[];

  @Column('uuid', { nullable: true })
  category_id!: string | null;

  @Column('uuid', { nullable: true })
  stream_id!: string | null;

  @Column('uuid', { nullable: true })
  creator_id!: string | null;

  @Column('jsonb', { default: '[]' })
  owner_ids!: string[];

  @Column('jsonb', { default: '[]' })
  viewer_ids!: string[];

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  /** Kept by the database (migration 1856270000000): never written by TypeORM, see touchUpdatedAt. */
  @Column({ type: 'timestamptz', default: () => 'now()', update: false })
  updated_at!: Date;

  @OneToMany(() => TaskApplication, (link) => link.task)
  application_links!: TaskApplication[];

  @OneToMany(() => TaskAsset, (link) => link.task)
  asset_links!: TaskAsset[];
}
