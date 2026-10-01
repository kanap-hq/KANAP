import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('application_capex_items')
@Unique('uq_app_capex', ['tenant_id', 'application_id', 'capex_item_id'])
export class ApplicationCapexItemLink {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  @Column('uuid')
  application_id!: string;

  @Column('uuid')
  capex_item_id!: string;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;
}

