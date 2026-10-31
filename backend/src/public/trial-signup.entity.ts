import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'trial_signups' })
export class TrialSignup {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  org_name!: string;

  @Index('trial_signups_slug_key', { unique: true })
  @Column({ type: 'citext' })
  slug!: string;

  @Index('trial_signups_email_idx')
  @Column({ type: 'citext' })
  email!: string;

  @Column('char', { length: 2, nullable: true })
  country_iso!: string | null;

  @Column({ type: 'text', nullable: true })
  token_hash!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  expires_at!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  activated_at!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_email_sent_at!: Date | null;

  @Column({ type: 'text', nullable: true })
  first_name!: string | null;

  @Column({ type: 'text', nullable: true })
  last_name!: string | null;

  // Consent to the included model of Plaid, given on the sign-up form (ai-signup-consent.ts):
  // version of the text of the box, moment, client address. Null when the box was not ticked.
  @Column({ type: 'text', nullable: true })
  ai_consent_version!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  ai_consent_at!: Date | null;

  @Column({ type: 'text', nullable: true })
  ai_consent_ip!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
