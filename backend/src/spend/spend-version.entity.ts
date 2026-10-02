import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

export type InputGrain = 'annual' | 'quarterly' | 'monthly';

@Entity('spend_versions')
export class SpendVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  @Column('uuid')
  spend_item_id!: string;

  @Column('text')
  version_name!: string;

  // Map to existing Postgres enum type created in migration: input_grain
  @Column({ type: 'enum', enum: ['annual', 'quarterly', 'monthly'], enumName: 'input_grain', default: 'annual' })
  input_grain!: InputGrain;

  @Column('boolean', { default: false })
  is_approved!: boolean;

  @Column('date')
  as_of_date!: string;

  @Column('integer')
  budget_year!: number;

  @Column('text')
  allocation_method!: 'default' | 'headcount' | 'it_users' | 'turnover' | 'manual_company' | 'manual_department' | 'manual_pct';

  @Column('text', { default: 'headcount' })
  allocation_driver!: 'headcount' | 'it_users' | 'turnover';

  @Column('text', { nullable: true })
  notes!: string | null;

  @Column('char', { length: 3, default: 'EUR' })
  reporting_currency!: string;

  @Column('uuid', { nullable: true })
  fx_rate_set_id!: string | null;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  @Column('timestamptz', { default: () => 'now()' })
  updated_at!: Date;

  /**
   * Freshness counter of the version's budget, kept by the database (migration
   * 1853740000000): one more on each change of its amounts, round inputs,
   * costed lines, allocations, allocation method or allocation driver (no
   * other column of the version counts, the FX pin of a freeze included).
   * Read-only here.
   */
  @Column({ type: 'int', default: 1, insert: false, update: false })
  budget_rev!: number;
}
