import { BadRequestException, ForbiddenException } from '@nestjs/common';

export const MCP_SCOPE_TOOLS_LIST = 'mcp:tools:list';
export const MCP_SCOPE_TOOLS_EXECUTE = 'mcp:tools:execute';
export const MCP_SCOPE_AUDIT_READ = 'mcp:audit:read';

export const MCP_SCOPES = [
  MCP_SCOPE_TOOLS_LIST,
  MCP_SCOPE_TOOLS_EXECUTE,
  MCP_SCOPE_AUDIT_READ,
] as const;

export type AiMcpScope = typeof MCP_SCOPES[number];

export const MCP_CAPABILITY_GROUP_KANAP_READ_CORE = 'kanap.read.core';

export const MCP_DEFAULT_SCOPES: AiMcpScope[] = [
  MCP_SCOPE_TOOLS_LIST,
  MCP_SCOPE_TOOLS_EXECUTE,
];

export const MCP_DEFAULT_ALLOWED_CAPABILITIES = [
  MCP_CAPABILITY_GROUP_KANAP_READ_CORE,
] as const;

export const MCP_DEFAULT_RATE_LIMIT_PER_MINUTE = 60;
export const MCP_MAX_RATE_LIMIT_PER_MINUTE = 1000;

// A key stores the group name, not this list: a tool added here reaches every key that holds the
// group at its next request, with no migration.
const MCP_CORE_READ_CAPABILITIES = [
  'search_all',
  'describe_entity_filters',
  'query_entities',
  'aggregate_entities',
  'get_filter_values',
  'get_application_classification_catalog',
  'get_entity_detail',
  'get_entity_context',
  'get_entity_comments',
  'get_record_history',
  'search_knowledge',
  'get_document',
  'web_search',
] as const;

const MCP_CAPABILITY_GROUPS: Record<string, readonly string[]> = {
  [MCP_CAPABILITY_GROUP_KANAP_READ_CORE]: MCP_CORE_READ_CAPABILITIES,
};

export type AiMcpApiKeyPolicyInput = {
  scopes?: unknown;
  allowedCapabilities?: unknown;
  deniedCapabilities?: unknown;
  maxEffect?: unknown;
  rateLimitPerMinute?: unknown;
};

export type AiMcpApiKeyPolicyRecord = {
  mcp_scopes_json?: unknown;
  mcp_capability_allowlist_json?: unknown;
  mcp_capability_denylist_json?: unknown;
  mcp_max_effect?: unknown;
  mcp_rate_limit_per_minute?: unknown;
};

export type AiMcpApiKeyPolicy = {
  valid: boolean;
  reason: string | null;
  scopes: Set<AiMcpScope>;
  allowedCapabilityNames: Set<string>;
  deniedCapabilityNames: Set<string>;
  maxEffect: 'read' | null;
  rateLimitPerMinute: number;
};

function isAiMcpScope(value: string): value is AiMcpScope {
  return (MCP_SCOPES as readonly string[]).includes(value);
}

function normalizeStringArray(
  value: unknown,
  field: string,
  opts?: { defaultValue?: readonly string[]; maxItems?: number },
): string[] {
  const source = value === undefined ? opts?.defaultValue : value;
  if (!Array.isArray(source)) {
    throw new BadRequestException(`${field} must be an array of strings.`);
  }
  const maxItems = opts?.maxItems ?? 100;
  if (source.length > maxItems) {
    throw new BadRequestException(`${field} cannot contain more than ${maxItems} entries.`);
  }
  const normalized = source.map((entry) => {
    if (typeof entry !== 'string') {
      throw new BadRequestException(`${field} must be an array of strings.`);
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      throw new BadRequestException(`${field} cannot contain empty entries.`);
    }
    return trimmed;
  });
  return Array.from(new Set(normalized));
}

function expandCapabilityEntries(entries: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const entry of entries) {
    const group = MCP_CAPABILITY_GROUPS[entry];
    if (group) {
      for (const capabilityName of group) {
        names.add(capabilityName);
      }
      continue;
    }
    names.add(entry);
  }
  return names;
}

export function buildMcpApiKeyPolicyRecord(input?: AiMcpApiKeyPolicyInput): {
  mcp_scopes_json: AiMcpScope[];
  mcp_capability_allowlist_json: string[];
  mcp_capability_denylist_json: string[];
  mcp_max_effect: 'read';
  mcp_rate_limit_per_minute: number;
} {
  const scopes = normalizeStringArray(input?.scopes, 'mcp_scopes', {
    defaultValue: MCP_DEFAULT_SCOPES,
    maxItems: MCP_SCOPES.length,
  });
  for (const scope of scopes) {
    if (!isAiMcpScope(scope)) {
      throw new BadRequestException(`Unsupported MCP API key scope: ${scope}.`);
    }
  }

  const allowedCapabilities = normalizeStringArray(input?.allowedCapabilities, 'mcp_allowed_capabilities', {
    defaultValue: MCP_DEFAULT_ALLOWED_CAPABILITIES,
    maxItems: 200,
  });
  if (allowedCapabilities.includes('*') || allowedCapabilities.includes('all')) {
    throw new BadRequestException('MCP capability allowlists must not use wildcard grants.');
  }

  const deniedCapabilities = normalizeStringArray(input?.deniedCapabilities, 'mcp_denied_capabilities', {
    defaultValue: [],
    maxItems: 200,
  });

  const maxEffect = input?.maxEffect ?? 'read';
  if (maxEffect !== 'read') {
    throw new BadRequestException('MCP API keys can only grant read capabilities in this phase.');
  }

  const rawRateLimit = input?.rateLimitPerMinute ?? MCP_DEFAULT_RATE_LIMIT_PER_MINUTE;
  if (
    typeof rawRateLimit !== 'number'
    || !Number.isInteger(rawRateLimit)
    || rawRateLimit < 1
    || rawRateLimit > MCP_MAX_RATE_LIMIT_PER_MINUTE
  ) {
    throw new BadRequestException(`mcp_rate_limit_per_minute must be an integer from 1 to ${MCP_MAX_RATE_LIMIT_PER_MINUTE}.`);
  }

  return {
    mcp_scopes_json: scopes as AiMcpScope[],
    mcp_capability_allowlist_json: allowedCapabilities,
    mcp_capability_denylist_json: deniedCapabilities,
    mcp_max_effect: 'read',
    mcp_rate_limit_per_minute: rawRateLimit,
  };
}

export function parseMcpApiKeyPolicy(record: AiMcpApiKeyPolicyRecord): AiMcpApiKeyPolicy {
  try {
    const scopes = normalizeStringArray(record.mcp_scopes_json, 'mcp_scopes', { maxItems: MCP_SCOPES.length });
    for (const scope of scopes) {
      if (!isAiMcpScope(scope)) {
        return invalidPolicy(`unsupported_scope:${scope}`);
      }
    }
    const allowedCapabilities = normalizeStringArray(record.mcp_capability_allowlist_json, 'mcp_allowed_capabilities', {
      maxItems: 200,
    });
    const deniedCapabilities = normalizeStringArray(record.mcp_capability_denylist_json, 'mcp_denied_capabilities', {
      maxItems: 200,
    });
    if (allowedCapabilities.includes('*') || allowedCapabilities.includes('all')) {
      return invalidPolicy('wildcard_capability_grant');
    }
    if (record.mcp_max_effect !== 'read') {
      return invalidPolicy('unsupported_max_effect');
    }
    const rateLimit = record.mcp_rate_limit_per_minute;
    if (
      typeof rateLimit !== 'number'
      || !Number.isInteger(rateLimit)
      || rateLimit < 1
      || rateLimit > MCP_MAX_RATE_LIMIT_PER_MINUTE
    ) {
      return invalidPolicy('invalid_rate_limit');
    }

    return {
      valid: true,
      reason: null,
      scopes: new Set(scopes as AiMcpScope[]),
      allowedCapabilityNames: expandCapabilityEntries(allowedCapabilities),
      deniedCapabilityNames: expandCapabilityEntries(deniedCapabilities),
      maxEffect: 'read',
      rateLimitPerMinute: rateLimit,
    };
  } catch (error) {
    return invalidPolicy(error instanceof Error ? error.message : 'malformed_policy');
  }
}

export function assertMcpScope(policy: AiMcpApiKeyPolicy, scope: AiMcpScope): void {
  if (!policy.valid) {
    throw new ForbiddenException('MCP API key policy is invalid.');
  }
  if (!policy.scopes.has(scope)) {
    throw new ForbiddenException(`MCP API key is missing required scope ${scope}.`);
  }
}

export function isMcpCapabilityAllowedByPolicy(policy: AiMcpApiKeyPolicy, capabilityName: string): boolean {
  return policy.valid
    && policy.maxEffect === 'read'
    && policy.allowedCapabilityNames.has(capabilityName)
    && !policy.deniedCapabilityNames.has(capabilityName);
}

function invalidPolicy(reason: string): AiMcpApiKeyPolicy {
  return {
    valid: false,
    reason,
    scopes: new Set(),
    allowedCapabilityNames: new Set(),
    deniedCapabilityNames: new Set(),
    maxEffect: null,
    rateLimitPerMinute: MCP_DEFAULT_RATE_LIMIT_PER_MINUTE,
  };
}
