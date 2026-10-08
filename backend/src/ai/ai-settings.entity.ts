import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('ai_settings')
@Index(['tenant_id'], { unique: true })
export class AiSettings {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  @Column('boolean', { default: false })
  chat_enabled!: boolean;

  @Column('boolean', { default: false })
  mcp_enabled!: boolean;

  @Column('varchar', { length: 50, nullable: true })
  llm_provider!: string | null;

  @Column('text', { nullable: true, select: false })
  llm_api_key_encrypted!: string | null;

  @Column('text', { nullable: true })
  llm_endpoint_url!: string | null;

  @Column('varchar', { length: 100, nullable: true })
  llm_model!: string | null;

  // Deprecated: superseded by chat_model_config_id (null = builtin). Kept until the
  // legacy-column cleanup migration; no runtime resolution reads it anymore.
  @Column('varchar', { length: 10, default: 'builtin' })
  provider_source!: 'builtin' | 'custom';

  // Registry model assigned to Plaid chat; null resolves to the tenant default
  // entry, then the platform builtin model.
  @Column('uuid', { nullable: true })
  chat_model_config_id!: string | null;

  @Column('integer', { nullable: true })
  mcp_key_max_lifetime_days!: number | null;

  @Column('integer', { nullable: true })
  conversation_retention_days!: number | null;

  @Column('boolean', { default: false })
  web_search_enabled!: boolean;

  // Whether the tenant's default LLM (shared with Plaid chat) can analyze images. Drives
  // best-effort screenshot evidence extraction for agents. Default TRUE ("multimodal by
  // default"); turn off in the admin GUI for a known text-only model to skip the wasted call.
  @Column('boolean', { default: true })
  llm_supports_vision!: boolean;

  @Column('boolean', { default: false })
  glpi_enabled!: boolean;

  @Column('text', { nullable: true })
  glpi_url!: string | null;

  @Column('text', { nullable: true, select: false })
  glpi_user_token_encrypted!: string | null;

  @Column('text', { nullable: true, select: false })
  glpi_app_token_encrypted!: string | null;

  // Confirmation of the included model's provider identity (builtinProviderKey) by an
  // administrator of the workspace: valid while it equals the platform's current key.
  @Column('text', { nullable: true })
  builtin_accepted_key!: string | null;

  @Column('timestamptz', { nullable: true })
  builtin_accepted_at!: Date | null;

  @Column('uuid', { nullable: true })
  builtin_accepted_by!: string | null;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  @Column('timestamptz', { default: () => 'now()' })
  updated_at!: Date;
}
