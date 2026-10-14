import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** An API key the user created, or the grant an MCP client received through OAuth (ai/oauth). */
export type AiCredentialKind = 'api_key' | 'oauth';

@Entity('ai_api_keys')
@Index(['tenant_id', 'user_id'])
@Index(['tenant_id', 'key_prefix'], { unique: true })
@Index(['key_prefix'])
export class AiApiKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  @Column('uuid')
  user_id!: string;

  @Column('text', { select: false })
  key_hash!: string;

  @Column('varchar', { length: 16 })
  key_prefix!: string;

  @Column('varchar', { length: 100 })
  label!: string;

  @Column('timestamptz', { nullable: true })
  expires_at!: Date | null;

  @Column('timestamptz', { nullable: true })
  last_used_at!: Date | null;

  @Column('timestamptz', { nullable: true })
  revoked_at!: Date | null;

  @Column('uuid', { nullable: true })
  revoked_by_user_id!: string | null;

  @Column('text', { nullable: true })
  revocation_reason!: string | null;

  @Column('jsonb', { default: () => `'["mcp:tools:list","mcp:tools:execute"]'::jsonb` })
  mcp_scopes_json!: string[];

  @Column('jsonb', { default: () => `'["kanap.read.core"]'::jsonb` })
  mcp_capability_allowlist_json!: string[];

  @Column('jsonb', { default: () => `'[]'::jsonb` })
  mcp_capability_denylist_json!: string[];

  @Column('text', { default: 'read' })
  mcp_max_effect!: string;

  @Column('integer', { default: 60 })
  mcp_rate_limit_per_minute!: number;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  @Column('uuid')
  created_by_user_id!: string;

  @Column('text', { default: 'api_key' })
  credential_kind!: AiCredentialKind;

  /** OAuth: the client's metadata document URL (CIMD), which is its `client_id`. */
  @Column('text', { nullable: true })
  oauth_client_id!: string | null;

  @Column('text', { nullable: true })
  oauth_client_name!: string | null;

  @Column('text', { nullable: true })
  oauth_redirect_uri!: string | null;

  /** OAuth: the `jti` of the authorization code that created the grant (unique per tenant). */
  @Column('uuid', { nullable: true })
  oauth_code_jti!: string | null;

  @Column('timestamptz', { nullable: true })
  refresh_rotated_at!: Date | null;

  /** OAuth: the user asked to skip the consent screen next time for this client. */
  @Column('boolean', { default: false })
  oauth_remember!: boolean;
}
