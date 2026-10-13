/**
 * Content collections (Astro content layer).
 *
 * Only the blog uses a collection: articles are Markdown files written by
 * hand, one per language, under `src/content/blog/<locale>/<slug>.md`.
 * Files starting with `_` (e.g. `_template.md`) are ignored.
 *
 * Every other marketing page keeps its typed TS content in `src/content/*`.
 *
 * How to publish an article: see `BLOG.md` at the root of `web/`.
 */

import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

/**
 * Topics are a closed list so the chip label can be translated (see
 * `blog.topic.*` in `src/i18n/*.json`) and so a topic-grouped index can be
 * switched on later without touching posts. To add one: extend this enum,
 * then add the four `blog.topic.<key>` labels.
 */
export const BLOG_TOPICS = ['agents', 'self-hosting', 'cost', 'glpi', 'product', 'portfolio', 'compliance'] as const;
export type BlogTopic = (typeof BLOG_TOPICS)[number];

const blog = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/blog' }),
  schema: z.object({
    /** Article title. Sentence case, no trailing period. */
    title: z.string().min(1),
    /** 1–2 sentences. Used as the excerpt on the index, the meta description and the RSS summary. */
    description: z.string().min(1),
    /** Publication date, ISO `YYYY-MM-DD`. Posts dated in the future are not built. */
    date: z.coerce.date(),
    /** Optional last-revision date, shown when set. */
    updated: z.coerce.date().optional(),
    topic: z.enum(BLOG_TOPICS),
    /**
     * Optional series grouping. Posts sharing `series.key` are parts of one
     * series, ordered by `part`; `title` is written in the post's own
     * language. The series strip only renders once 2+ parts are published.
     */
    series: z
      .object({
        key: z.string().min(1),
        part: z.number().int().positive(),
        title: z.string().min(1),
      })
      .optional(),
    author: z.string().default('KANAP'),
    /** Short role line shown after the author name, e.g. "Founder, CIO". */
    authorRole: z.string().optional(),
    /**
     * Posts in different locales with the same key are translations of one
     * another. Defaults to the file slug, so keeping the same filename across
     * `en/` and `fr/` is enough.
     */
    translationKey: z.string().optional(),
    /** Keep `true` while writing: the file is ignored by the build. */
    draft: z.boolean().default(false),
    /** Override the social card. Defaults to `/og/blog/<slug>.png` when it exists, else the site card. */
    ogImage: z.string().optional(),
  }),
});

export const collections = { blog };
