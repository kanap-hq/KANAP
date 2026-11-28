import { AI_INSTALLATION_DOMAIN } from './ai-installation-settings.domain';
import { installationSettingsSnapshot } from './installation-settings.snapshot';
import { parsePositiveInteger } from './installation-settings';

// The reading sites of the AI installation settings: the file, else the database, else the
// default (installation-settings.ts), resolved at each call against this process's snapshot.

/** The Brave Search key of the web search, or null when none is set. */
export function aiWebSearchApiKey(): string | null {
  const value = installationSettingsSnapshot.value(AI_INSTALLATION_DOMAIN, 'web_search_api_key');
  return typeof value === 'string' ? value : null;
}

/** The longest answer of Kad, in tokens. */
export function aiChatMaxTokens(): number {
  return installationSettingsSnapshot.value(AI_INSTALLATION_DOMAIN, 'chat_max_tokens') as number;
}

/**
 * The output ceiling of OpenAI's reasoning models: AI_CHAT_REASONING_MAX_TOKENS when the file
 * gives a positive integer (file only), otherwise the longest answer, at least 16 384.
 */
export function aiReasoningMaxTokens(env: NodeJS.ProcessEnv = process.env): number {
  return parsePositiveInteger(env.AI_CHAT_REASONING_MAX_TOKENS ?? '') ?? Math.max(aiChatMaxTokens(), 16384);
}

/** The screenshots of a ticket an agent reads, 1 to 10. */
export function aiTicketMaxImages(): number {
  return installationSettingsSnapshot.value(AI_INSTALLATION_DOMAIN, 'ticket_max_images') as number;
}

/** The size above which a screenshot of a ticket is skipped, in bytes. */
export function aiTicketMaxImageBytes(): number {
  return installationSettingsSnapshot.value(AI_INSTALLATION_DOMAIN, 'ticket_max_image_bytes') as number;
}
