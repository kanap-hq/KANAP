/**
 * Changelog page copy. The entries themselves are the blog articles with
 * topic `release` (see `getReleasePosts` in `src/lib/blog.ts`); the technical
 * list of changes lives on the GitHub releases page.
 */
export interface ChangelogContent {
  meta: { title: string; description: string };
  header: {
    eyebrow: string;
    title: string;
    lead: string;
  };
  /** Shown in place of the list while no release article is published. */
  empty: string;
  github: {
    label: string;
    body: string;
    cta: string;
    href: string;
  };
}
