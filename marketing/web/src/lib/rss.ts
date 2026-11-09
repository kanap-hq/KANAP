/**
 * RSS 2.0 feed per locale, built by hand: four fields per item, no dependency.
 * Locales without their own posts get the English ones (same rule as the index).
 */

import type { APIContext } from 'astro';
import type { Locale } from '../i18n/ui';
import { localePath, useTranslations } from '../i18n/ui';
import { getPostsWithFallback } from './blog';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function blogFeed(locale: Locale, ctx: APIContext): Promise<Response> {
  const site = (ctx.site ?? new URL('https://kadratis.com')).href.replace(/\/$/, '');
  const t = useTranslations(locale);
  const posts = await getPostsWithFallback(locale);
  const self = `${site}${localePath(locale, '/blog/rss.xml')}`;
  const home = `${site}${localePath(locale, '/blog')}`;

  const items = posts
    .map((i) => {
      const url = `${site}${i.href}`;
      return `    <item>
      <title>${esc(i.post.data.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${i.post.data.date.toUTCString()}</pubDate>
      <category>${esc(t(`blog.topic.${i.post.data.topic}`))}</category>
      <description>${esc(i.post.data.description)}</description>
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Kadratis · ${esc(t('nav.blog'))}</title>
    <link>${home}</link>
    <description>${esc(t('blog.metaDescription'))}</description>
    <language>${locale}</language>
    <atom:link href="${self}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
