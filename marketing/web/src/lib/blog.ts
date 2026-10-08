/**
 * Blog helpers shared by the index, article, RSS and homepage strip.
 *
 * A post's collection id is `<locale>/<slug>` (from its file path). Posts are
 * built per locale; locales without their own articles list the English ones
 * so a `/de/blog` visitor never sees an empty page.
 */

import { getCollection, type CollectionEntry } from 'astro:content';
import { publicDir } from 'astro:config/server';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LOCALE, LOCALES, localePath, type Locale } from '../i18n/ui';

export type BlogPost = CollectionEntry<'blog'>;

export interface BlogItem {
  post: BlogPost;
  /** Locale the article is written in (may differ from the page locale on fallback). */
  locale: Locale;
  slug: string;
  /** Absolute site path, locale-prefixed. */
  href: string;
  readingMinutes: number;
  translationKey: string;
}

const WORDS_PER_MINUTE = 200;

function localeOf(post: BlogPost): Locale {
  const [first] = post.id.split('/');
  return (LOCALES as readonly string[]).includes(first) ? (first as Locale) : DEFAULT_LOCALE;
}

export function slugOf(post: BlogPost): string {
  const i = post.id.indexOf('/');
  return i === -1 ? post.id : post.id.slice(i + 1);
}

export function readingMinutes(body: string | undefined): number {
  if (!body) return 1;
  const text = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`\[\]()!-]/g, ' ');
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

function toItem(post: BlogPost): BlogItem {
  const locale = localeOf(post);
  const slug = slugOf(post);
  return {
    post,
    locale,
    slug,
    href: localePath(locale, `/blog/${slug}`),
    readingMinutes: readingMinutes(post.body),
    translationKey: post.data.translationKey ?? slug,
  };
}

let cache: BlogItem[] | null = null;

/** Every publishable post, all locales, newest first. */
export async function getAllPosts(): Promise<BlogItem[]> {
  if (cache) return cache;
  const now = Date.now();
  const entries = await getCollection(
    'blog',
    (p) => !p.data.draft && p.data.date.getTime() <= now,
  );
  cache = entries
    .map(toItem)
    .sort((a, b) => b.post.data.date.getTime() - a.post.data.date.getTime());
  return cache;
}

/** Posts written in `locale`. */
export async function getPostsFor(locale: Locale): Promise<BlogItem[]> {
  return (await getAllPosts()).filter((i) => i.locale === locale);
}

/**
 * Posts to list on the `locale` index: the locale's own posts, plus English
 * posts that have no translation in that locale. Newest first.
 */
export async function getPostsWithFallback(locale: Locale): Promise<BlogItem[]> {
  const all = await getAllPosts();
  const own = all.filter((i) => i.locale === locale);
  if (locale === DEFAULT_LOCALE) return own;
  const ownKeys = new Set(own.map((i) => i.translationKey));
  const fallback = all.filter(
    (i) => i.locale === DEFAULT_LOCALE && !ownKeys.has(i.translationKey),
  );
  return [...own, ...fallback].sort(
    (a, b) => b.post.data.date.getTime() - a.post.data.date.getTime(),
  );
}

/** True when at least one post exists in any locale — gates the nav/footer/home links. */
export async function blogHasPosts(): Promise<boolean> {
  return (await getAllPosts()).length > 0;
}

/** Other-locale versions of an item, keyed by locale. */
export async function getTranslations(item: BlogItem): Promise<Partial<Record<Locale, BlogItem>>> {
  const all = await getAllPosts();
  const out: Partial<Record<Locale, BlogItem>> = {};
  for (const other of all) {
    if (other.translationKey === item.translationKey && other.locale !== item.locale) {
      out[other.locale] = other;
    }
  }
  return out;
}

/**
 * Published parts of `item`'s series as listed from `locale` (own-locale
 * version preferred, English fallback otherwise), ordered by part number.
 * Empty when the post belongs to no series.
 */
export async function getSeriesParts(item: BlogItem, locale: Locale): Promise<BlogItem[]> {
  const series = item.post.data.series;
  if (!series) return [];
  return (await getPostsWithFallback(locale))
    .filter((i) => i.post.data.series?.key === series.key)
    .sort((a, b) => a.post.data.series!.part - b.post.data.series!.part);
}

/** Up to `n` other posts to read next: same series first (in order), then same topic, then newest. */
export async function getRelated(item: BlogItem, locale: Locale, n = 2): Promise<BlogItem[]> {
  const pool = (await getPostsWithFallback(locale)).filter(
    (i) => i.translationKey !== item.translationKey,
  );
  const seriesKey = item.post.data.series?.key;
  const sameSeries = seriesKey
    ? pool
        .filter((i) => i.post.data.series?.key === seriesKey)
        .sort((a, b) => a.post.data.series!.part - b.post.data.series!.part)
    : [];
  const inSeries = new Set(sameSeries.map((i) => i.translationKey));
  const sameTopic = pool.filter(
    (i) => !inSeries.has(i.translationKey) && i.post.data.topic === item.post.data.topic,
  );
  const rest = pool.filter(
    (i) => !inSeries.has(i.translationKey) && i.post.data.topic !== item.post.data.topic,
  );
  return [...sameSeries, ...sameTopic, ...rest].slice(0, n);
}

/** Social card path for an item: explicit `ogImage`, else the generated card if present, else the site default. */
export function ogImageFor(item: BlogItem): string {
  if (item.post.data.ogImage) return item.post.data.ogImage;
  const generated = `/og/blog/${item.slug}.png`;
  // Resolved from the configured public directory: `import.meta.url` points
  // into the bundled build output, not into `src/lib/`.
  const onDisk = fileURLToPath(new URL(`.${generated}`, publicDir));
  return existsSync(onDisk) ? generated : '/og-image.png';
}

export function formatDate(d: Date, locale: Locale): string {
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}
