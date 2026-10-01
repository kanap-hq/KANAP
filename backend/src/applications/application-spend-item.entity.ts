import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('application_spend_items')
@Unique('uq_app_spend', ['tenant_id', 'application_id', 'spend_item_id'])
export class ApplicationSpendItemLink {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  @Column('uuid')
  application_id!: string;

  @Column('uuid')
  spend_item_id!: string;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;
}

