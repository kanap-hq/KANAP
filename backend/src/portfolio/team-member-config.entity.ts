import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// Proficiency levels:
// 1 = Basic / Theoretical
// 2 = Can execute with support
// 3 = Autonomous
// 4 = Expert
export interface SkillProficiency {
  skill_id: string;
  proficiency: number; // 1-4
}

@Entity('portfolio_team_member_configs')
@Index(['tenant_id', 'user_id'], { unique: true })
export class TeamMemberConfig {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  @Column('uuid')
  user_id!: string;

  @Column('jsonb', { default: '[]' })
  areas_of_expertise!: string[];

  @Column('jsonb', { default: '[]' })
  skills!: SkillProficiency[];

  @Column('numeric', { precision: 3, scale: 1, default: 5 })
  project_availability!: number;

  @Column('text', { nullable: true })
  notes?: string | null;

  @Column('uuid', { nullable: true })
  team_id?: string | null;

  // Reporting line. A *user* reference, not a contributor one: an Entra manager
  // resolves to a user even before that person becomes a contributor.
  @Column('uuid', { nullable: true })
  manager_user_id?: string | null;

  // 'entra' | 'manual'. Derived by the service, never taken from a request body.
  @Column('text', { nullable: true })
  manager_source?: string | null;

  @Column('uuid', { nullable: true })
  employment_type_id?: string | null;

  @Column('uuid', { nullable: true })
  default_source_id?: string | null;

  @Column('uuid', { nullable: true })
  default_category_id?: string | null;

  @Column('uuid', { nullable: true })
  default_stream_id?: string | null;

  @Column('uuid', { nullable: true })
  default_company_id?: string | null;

  // Per-tenant sequential business reference (rendered as MEM-N). Assigned on create.
  @Column('int')
  item_number!: number;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  @Column('timestamptz', { default: () => 'now()' })
  updated_at!: Date;
}

export const PROFICIENCY_LABELS: Record<number, string> = {
  1: 'Basic / Theoretical',
  2: 'Can execute with support',
  3: 'Autonomous',
  4: 'Expert',
};
