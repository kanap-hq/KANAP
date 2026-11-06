type HeaderLogoSource = {
  logoUrl: string | null;
  darkLogoUrl?: string | null;
  useLogoInDark: boolean;
};

/**
 * The logo the header shows, or null for the text fallback. Dark mode takes the dark logo,
 * else the light one when the tenant allows it. Light mode never shows the dark logo: it is
 * drawn for a dark background.
 */
export function headerLogoUrl(source: HeaderLogoSource, mode: 'light' | 'dark'): string | null {
  if (mode !== 'dark') return source.logoUrl;
  if (source.darkLogoUrl) return source.darkLogoUrl;
  return source.useLogoInDark ? source.logoUrl : null;
}
