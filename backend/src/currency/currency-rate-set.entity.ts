import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('currency_rate_sets')
export class CurrencyRateSet {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  @Column('integer')
  fiscal_year!: number;

  @Column('char', { length: 3 })
  base_currency!: string;

  @Column('jsonb')
  rates!: Record<string, number | null>;

  /**
   * Source of each currency's value in `rates` (`world-bank-annual`,
   * `exchangerateapi-spot`, `world-bank-forward`, `estimate`, `identity`,
   * `manual`). Null on a set captured before provenance was stored: those
   * values take the set's `source`. A `manual` value wins over every fetch
   * while it is present.
   */
  @Column('jsonb', { nullable: true })
  rate_sources!: Record<string, string> | null;

  @Column('text', { default: 'annual_avg' })
  rate_basis!: string;

  @Column('text', { default: 'world-bank' })
  source!: string;

  @Column('timestamptz', { default: () => 'now()' })
  captured_at!: Date;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  @Column('timestamptz', { default: () => 'now()' })
  updated_at!: Date;
}
