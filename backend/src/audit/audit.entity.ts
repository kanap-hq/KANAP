import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('audit_log')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  @Column('text')
  table_name!: string;

  @Column('uuid', { nullable: true })
  record_id!: string | null;

  /** The budget line this row belongs to (NULL for the line's own rows and for other tables). */
  @Column('text', { nullable: true })
  parent_table!: string | null;

  @Column('uuid', { nullable: true })
  parent_id!: string | null;

  @Column('text')
  action!: string; // create|update|disable

  @Column('jsonb', { nullable: true })
  before_json!: any | null;

  @Column('jsonb', { nullable: true })
  after_json!: any | null;

  @Column('uuid', { nullable: true })
  user_id!: string | null;

  @Column('text', { default: 'user' })
  source!: string; // user|system|webhook

  @Column('text', { nullable: true })
  source_ref!: string | null;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;
}
