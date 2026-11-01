import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('portfolio_streams')
@Index(['tenant_id', 'category_id', 'name'], { unique: true })
@Index(['tenant_id', 'category_id', 'display_order'])
export class PortfolioStream {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  @Column('uuid')
  category_id!: string;

  @Column('text')
  name!: string;

  @Column('text', { nullable: true })
  description!: string | null;

  @Column('boolean', { default: true })
  is_active!: boolean;

  @Column('int', { default: 0 })
  display_order!: number;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  @Column('timestamptz', { default: () => 'now()' })
  updated_at!: Date;
}
