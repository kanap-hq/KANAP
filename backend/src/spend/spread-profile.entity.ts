import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('spread_profiles')
export class SpreadProfile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('text', { unique: true })
  name!: string; // flat, 4-4-5, custom

  @Column('text', { default: 'system' })
  type!: string;

  @Column('jsonb')
  weights_json!: number[]; // 12 weights, none negative; a spread divides by their sum (flat: twelve 1s, 4-4-5: 4, 4, 5 per quarter)
}

