import { AI_INSTALLATION_DOMAIN } from './ai-installation-settings.domain';
import { InstallationDomain } from './installation-settings';

/** Every installation settings domain: a new domain is declared in its own file and listed here. */
export const INSTALLATION_DOMAINS: readonly InstallationDomain[] = [AI_INSTALLATION_DOMAIN];

export function installationDomain(name: string): InstallationDomain | null {
  return INSTALLATION_DOMAINS.find((domain) => domain.name === name) ?? null;
}
