import { IsBoolean, IsIn, IsInt, IsString, IsUrl, IsUUID, MaxLength, Min, ValidateIf } from 'class-validator';

export class UpdateAiSettingsDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  chat_enabled?: boolean;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  mcp_enabled?: boolean;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsIn(['anthropic', 'openai', 'ollama', 'custom'])
  llm_provider?: 'anthropic' | 'openai' | 'ollama' | 'custom' | null;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['builtin', 'custom'])
  provider_source?: 'builtin' | 'custom';

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsUUID()
  chat_model_config_id?: string | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(4096)
  llm_api_key?: string | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2048)
  @IsUrl({ require_protocol: true, require_tld: false })
  llm_endpoint_url?: string | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(100)
  llm_model?: string | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(1)
  mcp_key_max_lifetime_days?: number | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(1)
  conversation_retention_days?: number | null;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  web_search_enabled?: boolean;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  llm_supports_vision?: boolean;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  glpi_enabled?: boolean;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2048)
  @IsUrl({ require_protocol: true, require_tld: false })
  glpi_url?: string | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(4096)
  glpi_user_token?: string | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(255)
  glpi_app_token?: string | null;

  // Confirms the included model's provider identity (the key shown in the settings
  // view); null withdraws the confirmation. The key holds the provider, the endpoint
  // host (up to 253 characters) and the name shown (up to 80).
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(512)
  accept_builtin_provider_key?: string | null;
}
