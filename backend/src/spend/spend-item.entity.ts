import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { StatusState } from '../common/status';
import type { BudgetNature } from './budget-nature';

@Entity('spend_items')
@Index(['tenant_id', 'item_number'], { unique: true })
export class SpendItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  // Per-tenant sequential business reference (rendered as OPX-N). Assigned on create.
  @Column('int')
  item_number!: number;

  /**
   * OPEX or CAPEX (migration 1853950000000, plan planning/budget-unifie.md). Every line of this
   * table is OPEX until lot Z1 moves the CAPEX lines in: the OPEX code writes `opex` and reads
   * only lines of that nature (doc/architecture.md, "Budget line nature"). Read-only for the API.
   */
  @Column('text', { default: 'opex' })
  nature!: BudgetNature;

  /**
   * The reference the line had before the single BL numbering (`OPX-42`), unique per tenant when
   * set; still accepted where a reference is typed (`common/resolve-item-id.ts`). Not part of the
   * line as the API returns it: never selected unless asked for.
   */
  @Column('text', { nullable: true, select: false })
  legacy_number!: string | null;

  @Column('uuid', { nullable: true })
  paying_company_id!: string | null;

  @Column('text')
  product_name!: string;

  @Column('text', { nullable: true })
  description!: string | null;

  @Column('uuid', { nullable: true })
  supplier_id!: string | null;

  @Column('uuid', { nullable: true })
  account_id!: string | null;

  @Column('char', { length: 3 })
  currency!: string;

  @Column('date')
  effective_start!: string; // YYYY-MM-DD

  @Column({
    type: 'enum',
    enum: StatusState,
    enumName: 'status_state',
    default: StatusState.ENABLED,
  })
  status!: StatusState;

  @Column('timestamptz', { nullable: true })
  disabled_at!: Date | null;

  @Column('uuid', { nullable: true })
  owner_it_id!: string | null;

  @Column('uuid', { nullable: true })
  owner_business_id!: string | null;

  // The legacy analytics category column stays in the database for one release, unread and
  // unwritten: analytics values live in the item analytics links (`item-analytics.util.ts`).

  @Column('uuid', { nullable: true })
  project_id!: string | null;

  @Column('uuid', { nullable: true })
  contract_id!: string | null;

  // A cost center of this tenant (never a group); the database enforces the tenant match.
  @Column('uuid', { nullable: true })
  cost_center_id!: string | null;

  @Column({ type: 'enum', enum: ['run', 'build'], enumName: 'run_build', nullable: true })
  run_build!: 'run' | 'build' | null;

  @Column('text', { nullable: true })
  notes!: string | null;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  @Column('timestamptz', { default: () => 'now()' })
  updated_at!: Date;

  /**
   * Freshness counter of the line, kept by the database (migration
   * 1853740000000): one more on each change of a column other than updated_at
   * and status, or of its analytics values. Read-only here.
   */
  @Column({ type: 'int', default: 1, insert: false, update: false })
  row_version!: number;
}
