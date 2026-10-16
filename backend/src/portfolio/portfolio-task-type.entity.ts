import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('portfolio_task_types')
@Index(['tenant_id', 'name'], { unique: true })
@Index(['tenant_id', 'display_order'])
@Index('IDX_portfolio_task_types_tenant_code', ['tenant_id', 'code'], { unique: true, where: 'code IS NOT NULL' })
export class PortfolioTaskType {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  @Column('text')
  name!: string;

  /**
   * The shipped type this row started as (`task`, `bug`, `problem`, `incident`), null for a type
   * the tenant added. It survives a rename: while the name is still the shipped English one, the
   * frontend shows the type in the user's language.
   */
  @Column('text', { nullable: true })
  code!: string | null;

  @Column('text', { nullable: true })
  description!: string | null;

  @Column('boolean', { default: true })
  is_active!: boolean;

  @Column('int', { default: 0 })
  display_order!: number;

  @Column('boolean', { default: false })
  is_system!: boolean;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  @Column('timestamptz', { default: () => 'now()' })
  updated_at!: Date;
}

// Default task types to seed
// All defaults are editable/removable preload values for new tenants. The English name and
// description are the shipped text the frontend translates (`common:taskTypes.<code>`) while a
// tenant keeps them: change them together with migration 1854130000000 and the frontend copy.
export const DEFAULT_TASK_TYPES = [
  { code: 'task', name: 'Task', description: 'Standard task or work item', display_order: 0, is_system: false },
  { code: 'bug', name: 'Bug', description: 'Software defect or error', display_order: 1, is_system: false },
  { code: 'problem', name: 'Problem', description: 'Operational issue requiring investigation', display_order: 2, is_system: false },
  { code: 'incident', name: 'Incident', description: 'Service disruption or security event', display_order: 3, is_system: false },
];
