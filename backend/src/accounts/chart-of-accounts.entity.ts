import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('chart_of_accounts')
export class ChartOfAccounts {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  @Column('text')
  code!: string;

  @Column('text')
  name!: string;

  @Column('char', { length: 2, nullable: true })
  country_iso!: string | null;

  @Column('text', { default: 'COUNTRY' })
  scope!: 'GLOBAL' | 'COUNTRY';

  @Column('boolean', { default: false })
  is_default!: boolean;

  @Column('boolean', { default: false })
  is_global_default!: boolean;

  // The tenant's consolidation chart (at most one, any scope): the group accounts every
  // local account maps to through `accounts.consolidation_account_number`.
  @Column('boolean', { default: false })
  is_consolidation!: boolean;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  @Column('timestamptz', { default: () => 'now()' })
  updated_at!: Date;
}
