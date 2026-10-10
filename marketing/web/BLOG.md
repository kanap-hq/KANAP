# Publishing a blog article

The blog lives at `kanap.net/blog` (`/fr/blog`, `/de/blog`, `/es/blog`). Articles are
Markdown files in this folder; the site is rebuilt and redeployed to publish. No CMS,
no database, nothing to log into.

Until the first article is published, the Blog link is hidden from the nav, the footer
and the homepage. It appears on its own with the first post.

## 1. Write the article

Copy the template and name the file after the URL you want:

```
src/content/blog/_template.md   →   src/content/blog/en/my-article.md
```

The filename is the slug: `en/my-article.md` becomes `kanap.net/blog/my-article`.
Use lowercase words separated by hyphens, no dates in the slug (`four-weeks-calibrating-an-agent-on-glpi`, not `2026-09-post-1`).

Fill in the frontmatter (the block between the `---` lines):

| Field | Required | What to put |
|---|---|---|
| `title` | yes | Sentence case, no trailing period. Around 60 characters reads well in the list and in search results. |
| `description` | yes | One or two sentences. This is the excerpt on the index, the meta description for search, and the RSS summary. |
| `date` | yes | `YYYY-MM-DD`. A future date keeps the article out of the build until that day (useful to prepare a post ahead of a deploy). |
| `topic` | yes | One of `agents`, `self-hosting`, `cost`, `glpi`, `product`, `portfolio`, `compliance`. Shown as the chip next to the article. |
| `author` | no | Defaults to `KANAP`. |
| `authorRole` | no | Short line after the name, e.g. `Founder, CIO`. |
| `draft` | no | `true` while writing: the file is ignored by the build. Set to `false` (or remove the line) to publish. |
| `updated` | no | Revision date, shown as "Updated …" when set. |
| `translationKey` | no | Only when the FR and EN filenames differ (see §3). |
| `ogImage` | no | Override the social card (see §4). |

Then write the body in plain Markdown. What renders well:

- `##` and `###` headings (the title is already the `h1`, do not repeat it).
- Paragraphs, **bold**, links, bulleted and numbered lists, tables.
- `> quote` becomes a pull quote (large, teal opening mark). Use it once or twice, for a sentence that stands alone.
- Fenced code blocks with a language: ` ```bash `, ` ```yaml `, ` ```env `.
- Images: `![What the reader sees](/screenshots/agent-proposal.png)`. The image gets the same frame as product screenshots on the feature pages. Put new images in `public/screenshots/` (or `public/blog/`), 1920 × 1080 PNG with the English UI (`scripts/shoot-app.mjs --width 1920 --height 1080 --scale 1 --lang en`), under a new file name when an image changes (the CDN and browsers cache images for a week), and write the alt text as a full sentence.
- A stat callout, the one HTML block worth using:

  ```html
  <figure class="stat">
    <b>4 in 5</b>
    <span>drafts approved without edits by the end of week four.</span>
  </figure>
  ```

- A tip callout, for a short aside the reader should not miss:

  ```html
  <aside class="tip">
    <b>Tip</b>
    <p>Reports use the reporting currency set in the currency settings.</p>
  </aside>
  ```

  Use `Astuce` as the label in French articles.

Reading time is computed from the text; you do not write it.

### Multi-part series

To group related articles, add a `series` block to each part's frontmatter:

```yaml
series:
  key: opex-budget          # same key on every part, in every locale
  part: 1                   # 1-based order within the series
  title: "Preparing the OPEX budget with KANAP"   # in the article's language
```

Once two or more parts are published, every part shows a series strip under
the header listing all published parts, and "Continue reading" prefers the
other parts of the series. With a single part published, nothing is shown —
so Part 1 can ship alone.

## 2. Preview it locally

```bash
cd marketing/web
npm install        # first time only
npm run dev        # http://localhost:4321/blog
```

The dev server rebuilds on save. Check the index (`/blog`), the article, and the
dark theme (toggle in the nav). A `draft: true` article does not show up at all;
flip it to `false` to preview (there is no preview-by-URL for drafts).

If a deleted or renamed article keeps showing up locally, clear Astro's content
cache: `rm -rf node_modules/.astro` and build again. (Only happens on your machine;
the server build starts from a clean install.)

## 3. Translate it (optional)

Write French first if that is the natural language, English second. Every article does
not need every language.

- Same slug in another locale folder = translation:

  ```
  src/content/blog/en/my-article.md
  src/content/blog/fr/my-article.md
  ```

  The two pages link to each other ("Also available in …"), the language switcher moves
  between them, and search engines get the `hreflang` pair.

- Different filenames (a French title that deserves its own slug): give both files the
  same `translationKey`.

- German and Spanish do not need their own articles. `/de/blog` and `/es/blog` list the
  English posts with a small "English" chip, so those pages are never empty.

## 4. Social card (LinkedIn, Slack, X previews)

Each article gets a 1200×630 card generated from its title and description. The build
does not make it (no browser in the Docker image), so generate it once on your machine
and commit the PNG with the article:

```bash
cd marketing/web
npm run og -- blog                 # every published article
npm run og -- blog my-article      # one article
```

Output: `public/og/blog/<slug>.png`. Requires Chromium at `/usr/bin/chromium`
(`CHROMIUM_PATH=… npm run og -- blog` to point elsewhere). If the file is missing the
page falls back to the site-wide card, so a forgotten card is never a broken share.

## 5. Publish

Publishing is a normal marketing deploy: the article, its images and its OG card are
committed, merged to `main`, then built on the servers.

```bash
git add marketing/web/src/content/blog marketing/web/public
git commit -m "blog: <title>"
# open a PR to main, or push if working on main
```

On the server (`/opt/kanap`): `git pull`, then `docker compose build marketing` and
`docker compose up -d marketing` (QA first, then prod; same steps as any marketing change).

Then share the article. Its URL is `https://kanap.net/blog/<slug>` (`/fr/blog/<slug>`
for the French version). LinkedIn picks up the title, description and card automatically.

## Before you hit publish

- [ ] `draft: false`, `date` is today or earlier
- [ ] Title in sentence case, description is one or two full sentences
- [ ] Every image has a sentence of alt text and is under `public/`
- [ ] Links to the product point at the feature pages (`/features/agents`, `/on-premise`, `/offer`), not at the app
- [ ] Previewed in light and dark
- [ ] `npm run og -- blog <slug>` run and the PNG committed
- [ ] `npm run build` passes (the frontmatter is validated at build time; a typo in `topic` or a bad date fails the build with the file name)

## Where things are

| | |
|---|---|
| Articles | `src/content/blog/<locale>/<slug>.md` |
| Template | `src/content/blog/_template.md` (ignored by the build) |
| Frontmatter schema and topic list | `src/content.config.ts` |
| Index page | `src/components/BlogIndexPage.astro` |
| Article page | `src/components/BlogPostPage.astro` |
| Routes (4 locales) | `src/pages/blog/`, `src/pages/{fr,de,es}/blog/` |
| Chrome strings (nav label, chips, CTA, topic names) | `src/i18n/{en,fr,de,es}.json`, keys `blog.*` |
| Feeds | `/blog/rss.xml`, `/fr/blog/rss.xml`, … |
| Social cards | `public/og/blog/<slug>.png`, generated by `scripts/og.mjs` |

To add a topic: extend `BLOG_TOPICS` in `src/content.config.ts`, then add
`blog.topic.<key>` to the four locale files.
