import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://kanap.net',
  trailingSlash: 'ignore',
  // Keep HTML-aware whitespace collapsing (one space kept between inline
  // elements). Astro 7 otherwise defaults to JSX rules ('jsx'), which drops
  // the spaces between links, icons and words across the site.
  compressHTML: true,
  build: {
    format: 'directory',
  },
  markdown: {
    // Blog code blocks: one theme per site theme. The switch itself is CSS in
    // BlogPostPage.astro (`--shiki-light` / `--shiki-dark` variables).
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark-default' },
      defaultColor: false,
    },
  },
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'fr', 'de', 'es'],
    routing: {
      prefixDefaultLocale: false,
      redirectToDefaultLocale: false,
    },
  },
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: 'en',
        locales: {
          en: 'en',
          fr: 'fr',
          de: 'de',
          es: 'es',
        },
      },
      // Exclude the trial funnel from the sitemap — it's behind robots noindex
      filter: (page) => !page.includes('/trial/') && !page.includes('/404'),
    }),
  ],
  server: {
    port: 4321,
    host: true,
  },
});
