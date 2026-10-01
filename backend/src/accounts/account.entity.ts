import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { StatusState } from '../common/status';

@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  @Column('uuid', { nullable: true })
  coa_id!: string | null;

  // The DB column is integer (pg returns a number). Writes and the DTO still pass strings,
  // so the property stays typed string; raw SQL must cast it (`account_number::text = $n::text`).
  @Column('integer')
  account_number!: string;

  @Column('text')
  account_name!: string;

  @Column('text', { nullable: true })
  native_name!: string | null;

  @Column('text', { nullable: true })
  description!: string | null;

  @Column('integer', { nullable: true })
  consolidation_account_number!: number | null;

  @Column('text', { nullable: true })
  consolidation_account_name!: string | null;

  @Column('text', { nullable: true })
  consolidation_account_description!: string | null;

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
