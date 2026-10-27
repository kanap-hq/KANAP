import { RELEASES_URL } from '../../utils/docUrls';

export const SITE_URL = 'https://kanap.net';
export const REPOSITORY_URL = 'https://github.com/kanap-hq/KANAP';
export const DISCUSSIONS_URL = `${REPOSITORY_URL}/discussions`;
export const ISSUES_URL = `${REPOSITORY_URL}/issues`;
// Names of places, the same in every language.
export const SITE_LABEL = 'kanap.net';
export const DISCUSSIONS_LABEL = 'GitHub Discussions';
export const ISSUES_LABEL = 'GitHub Issues';
export const SUPPORT_EMAIL = 'support@kanap.net';

const VERSION_PATTERN = /^\d{2}\.\d{1,2}\.\d+$/;

/** Release notes of one version (its tag on the public repository); the list of releases for any other value. */
export function releaseNotesUrl(version: string): string {
  return VERSION_PATTERN.test(version) ? `${RELEASES_URL}/tag/v${version}` : RELEASES_URL;
}

/** Support offer page of the marketing site, in the user's language. */
export function supportOfferUrl(locale?: string): string {
  return locale && ['fr', 'de', 'es'].includes(locale) ? `${SITE_URL}/${locale}/offer` : `${SITE_URL}/offer`;
}

export type SupportInfo = {
  version: string;
  workspace: string;
  deploymentMode: 'single-tenant' | 'multi-tenant';
  userAgent: string;
};

/** The facts a support agent asks for first. Not translated: support reads English. */
export function buildSupportInfo(info: SupportInfo): string {
  return [
    `KANAP version: ${info.version}`,
    `Workspace: ${info.workspace || 'unknown'}`,
    `Deployment: ${info.deploymentMode === 'single-tenant' ? 'on-premise' : 'cloud'}`,
    `Browser: ${info.userAgent || 'unknown'}`,
  ].join('\n');
}

export function buildSupportMailto(info: SupportInfo): string {
  const subject = info.workspace ? `KANAP support: ${info.workspace}` : 'KANAP support';
  const body = `\n\n---\n${buildSupportInfo(info)}`;
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
