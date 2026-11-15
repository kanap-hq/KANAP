import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { StatusState } from '../common/status';

@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  /**
   * Business reference in the tenant, shown as COMP-n. Set by the database at insertion
   * (trigger assign_item_number, migration 1856240000000), never written by the application;
   * `default` only makes TypeORM read it back (RETURNING) after an insert.
   */
  @Column({ type: 'int', insert: false, update: false, default: () => 'NULL' })
  item_number!: number;

  @Column('uuid', { nullable: true })
  coa_id!: string | null;

  @Column('text')
  name!: string;

  @Column('char', { length: 2 })
  country_iso!: string;

  @Column('text')
  city!: string;

  @Column('text', { nullable: true })
  address1!: string | null;

  @Column('text', { nullable: true })
  address2!: string | null;

  @Column('text', { nullable: true })
  postal_code!: string | null;

  @Column('text', { nullable: true })
  reg_number!: string | null;

  @Column('text', { nullable: true })
  vat_number!: string | null;

  @Column('text', { nullable: true })
  state!: string | null;

  @Column('char', { length: 3, nullable: true })
  base_currency!: string | null;

  @Column('text', { nullable: true })
  notes!: string | null;

  // Note: per-year metrics (headcount, it_users, turnover) live in company_metrics

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
