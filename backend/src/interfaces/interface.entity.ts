import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('interfaces')
@Index(['tenant_id', 'source_application_id', 'target_application_id'])
@Index(['tenant_id', 'interface_reference'], { unique: true })
@Index(['tenant_id', 'interface_id'], { unique: true })
export class InterfaceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  @Column('text')
  interface_reference!: string;

  @Column('text', { nullable: true })
  interface_id!: string | null;

  @Column('text')
  name!: string;

  @Column('uuid', { nullable: true })
  business_process_id!: string | null;

  @Column('text')
  business_purpose!: string;

  @Column('uuid')
  source_application_id!: string;

  @Column('uuid')
  target_application_id!: string;

  @Column('text')
  data_category!: string;

  @Column('text')
  integration_route_type!: 'direct' | 'via_middleware';

  @Column('text', { default: 'proposed' })
  lifecycle!: string;

  @Column('text', { nullable: true })
  overview_notes!: string | null;

  @Column('text', { nullable: true })
  criticality!: string | null;

  @Column('boolean', { default: false })
  classification_incomplete!: boolean;

  @Column('text', { nullable: true })
  impact_of_failure!: string | null;

  @Column('jsonb', { nullable: true })
  business_objects!: any | null;

  @Column('text', { nullable: true })
  main_use_cases!: string | null;

  @Column('text', { nullable: true })
  functional_rules!: string | null;

  @Column('text', { nullable: true })
  core_transformations_summary!: string | null;

  @Column('text', { nullable: true })
  error_handling_summary!: string | null;

  @Column('text', { nullable: true })
  data_class!: string | null;

  @Column('boolean', { default: false })
  contains_pii!: boolean;

  @Column('text', { nullable: true })
  pii_description!: string | null;

  @Column('text', { nullable: true })
  typical_data!: string | null;

  @Column('text', { nullable: true })
  audit_logging!: string | null;

  @Column('text', { nullable: true })
  security_controls_summary!: string | null;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  /** Kept by the database (migration 1856270000000): never written by TypeORM, see touchUpdatedAt. */
  @Column({ type: 'timestamptz', default: () => 'now()', update: false })
  updated_at!: Date;
}
