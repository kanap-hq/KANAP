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

  // Per-tenant sequential business reference of every line, both natures (rendered as BL-N; an
  // OPEX line's number is its former OPX number). Assigned on create.
  @Column('int')
  item_number!: number;

  /**
   * OPEX or CAPEX (migration 1853950000000, plan planning/budget-unifie.md). The table holds both
   * natures since lot Z1: every read and write names the nature (doc/architecture.md, "Budget
   * line nature"). Written on create by the service of the nature; never by a request body.
   */
  @Column('text', { default: 'opex' })
  nature!: BudgetNature;

  /**
   * The reference the line had before the single BL numbering (`OPX-42`, `CPX-7`), unique per
   * tenant when set; still accepted where a reference is typed (`common/resolve-item-id.ts`). A
   * CAPEX line created through the CAPEX API gets the next CPX number. Not part of the line as the
   * API returns it: never selected unless asked for (`budget-line-presentation.ts`).
   */
  @Column('text', { nullable: true, select: false })
  legacy_number!: string | null;

  /**
   * The CAPEX classification (lot Z1, until lot C1 turns it into dimensions): set on CAPEX lines,
   * empty on OPEX lines. Never selected unless asked for, so an OPEX line reads as before.
   */
  @Column({ type: 'enum', enum: ['hardware', 'software'], enumName: 'ppe_type', nullable: true, select: false })
  ppe_type!: 'hardware' | 'software' | null;

  @Column({
    type: 'enum',
    enum: ['replacement', 'capacity', 'productivity', 'security', 'conformity', 'business_growth', 'other'],
    enumName: 'capex_investment_type',
    nullable: true,
    select: false,
  })
  investment_type!: 'replacement' | 'capacity' | 'productivity' | 'security' | 'conformity' | 'business_growth' | 'other' | null;

  @Column({ type: 'enum', enum: ['mandatory', 'high', 'medium', 'low'], enumName: 'priority_level', nullable: true, select: false })
  priority!: 'mandatory' | 'high' | 'medium' | 'low' | null;

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
