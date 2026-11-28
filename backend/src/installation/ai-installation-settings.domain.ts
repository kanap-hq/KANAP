import { InstallationDomain } from './installation-settings';

/** The largest value an `integer` column holds: the only bound of a positive integer setting until the page sets its own. */
export const INTEGER_COLUMN_MAX = 2_147_483_647;

/**
 * The AI settings of the installation (table `installation_ai_settings`): the web search key and
 * three limits. The other AI variables stay in the configuration file. In the cloud they hold for
 * every workspace.
 */
export const AI_INSTALLATION_DOMAIN: InstallationDomain = {
  name: 'ai',
  table: 'installation_ai_settings',
  settings: [
    // The Brave Search key of the web search (Kad's tool and the agents' capability).
    { key: 'web_search_api_key', column: 'web_search_api_key_encrypted', env: 'BRAVE_SEARCH_API_KEY', type: 'secret', auditKey: 'web_search_key_set' },
    // The longest answer of Kad, in tokens. The reasoning ceiling of OpenAI's reasoning models
    // (AI_CHAT_REASONING_MAX_TOKENS, file only) follows it when the file does not set it.
    { key: 'chat_max_tokens', column: 'chat_max_tokens', env: 'AI_CHAT_MAX_TOKENS', type: 'integer', min: 1, max: INTEGER_COLUMN_MAX, file: { min: 1 }, default: 16384 },
    // The screenshots of a ticket an agent reads: 5 by default, 10 at most (a file value above is read as 10).
    { key: 'ticket_max_images', column: 'ticket_max_images', env: 'AI_AGENT_VISION_MAX_IMAGES', type: 'integer', min: 1, max: 10, file: { min: 1, ceiling: 10 }, default: 5 },
    // The size above which a screenshot of a ticket is skipped, in bytes.
    { key: 'ticket_max_image_bytes', column: 'ticket_max_image_bytes', env: 'AI_AGENT_VISION_MAX_IMAGE_BYTES', type: 'integer', min: 1, max: INTEGER_COLUMN_MAX, file: { min: 1 }, default: 20 * 1024 * 1024 },
  ],
  features: (value) => ({ AI_WEB_SEARCH_READY: value('web_search_api_key') !== null }),
};
