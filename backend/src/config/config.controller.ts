import { Controller, Get } from '@nestjs/common';
import { Features } from './features';
const SUPPORTED_LOCALES = ['en', 'fr', 'de', 'es'] as const;

@Controller('config')
export class ConfigController {
  @Get('public')
  getPublicConfig() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { version } = require('../../package.json');
    return {
      deploymentMode: Features.DEPLOYMENT_MODE,
      features: {
        billing: Features.STRIPE_BILLING,
        sso: Features.ENTRA_SSO,
        email: Features.EMAIL_ENABLED,
        aiChat: Features.AI_CHAT_ENABLED,
        aiMcp: Features.AI_MCP_ENABLED,
        aiSettings: Features.AI_SETTINGS_ENABLED,
        aiWebSearch: Features.AI_WEB_SEARCH_READY,
        builtinAiProvider: !Features.SINGLE_TENANT,
        // Sample data (Administration > Sample data, home banner): cloud workspaces only.
        sampleData: !Features.SINGLE_TENANT,
      },
      version,
      supportedLocales: [...SUPPORTED_LOCALES],
      tenantSlug: Features.SINGLE_TENANT
        ? (process.env.DEFAULT_TENANT_SLUG || 'default').trim()
        : undefined,
    };
  }
}
