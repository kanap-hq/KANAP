/**
 * /llms.txt: a plain-text map of the site for AI assistants and answer
 * engines (llmstxt.org format). Built from the same sources as the pages:
 * the blog list comes from the content collection, so new articles appear
 * without touching this file.
 */

import type { APIContext } from 'astro';
import { getPostsFor } from '../lib/blog';

const PRODUCT: [string, string, string][] = [
  ['/features/budget', 'IT budget', 'OPEX and CAPEX, landing and next-year budget, version freeze, chargeback, consolidation, cost per FTE, multi-currency'],
  ['/features/contracts', 'Contracts', 'licenses, subscriptions and maintenance, with notice periods and computed cancellation deadlines'],
  ['/features/it-landscape', 'IT landscape', 'applications, interfaces, infrastructure, architecture maps, published CVEs and end-of-support dates'],
  ['/features/incidents', 'Incidents', 'a logged register of significant incidents, with their impact and what they touched'],
  ['/features/portfolio', 'Project portfolio', 'requests, scoring, roadmap, capacity, projects and tasks'],
  ['/features/knowledge', 'Documentation', 'libraries, reviews, versions, export to PDF, DOCX and ODT'],
  ['/features/ai', 'Kad, the built-in AI agent', 'answers questions across the record and prepares changes applied after approval'],
  ['/features/agents', 'AI agents and MCP server', 'helpdesk agent for GLPI under approval, MCP server for external AI clients'],
];

const COMPANY: [string, string, string][] = [
  ['/offer', 'Offer and prices', 'self-hosting is free; Kadratis Cloud is 249 EUR per month or 2,490 EUR per year; support for self-hosted installations is 2,490 EUR per year; prices exclude VAT'],
  ['/on-premise', 'Self-hosting', 'Docker, PostgreSQL, Linux; every feature included'],
  ['/security', 'Security', 'tenant isolation, access control, audit trail, hosting in Germany'],
  ['/faq', 'FAQ', 'common questions on licensing, hosting, data and AI'],
  ['/about', 'About', 'who builds Kadratis and why it is open source'],
  ['/changelog', 'Changelog', 'what each version brings'],
];

export async function GET(ctx: APIContext): Promise<Response> {
  const site = (ctx.site ?? new URL('https://kadratis.com')).href.replace(/\/$/, '');
  const posts = await getPostsFor('en');
  const line = ([path, label, note]: [string, string, string]) => `- [${label}](${site}${path}): ${note}`;

  const body = `# Kadratis

> Kadratis is an open source IT governance platform for IT departments of mid-sized companies and multi-entity groups. It brings the IT budget, contracts, the map of applications and infrastructure, vulnerabilities and end-of-support dates, the incident register, the project portfolio and IT documentation into one governed record. Kad, its built-in AI agent, answers questions on that record and prepares changes that users approve before they apply.

- License: AGPL v3, open source, every feature included.
- Self-hosting: free, with Docker, PostgreSQL and Linux.
- Kadratis Cloud: hosted in Germany, 249 EUR per month or 2,490 EUR per year, excluding VAT. Free trial.
- Support for self-hosted installations: 2,490 EUR per year, excluding VAT.
- Interface and user manual in English, French, German and Spanish. Web application.
- Publisher: KANAP SARL, France.

## Product

${PRODUCT.map(line).join('\n')}

## Offer and company

${COMPANY.map(line).join('\n')}

## Documentation and source code

- [User manual](https://doc.kadratis.com/): how each screen works, installation and operations
- [Source code](https://github.com/kanap-hq/kanap): repository, releases and issues

## Blog

${posts.map((i) => `- [${i.post.data.title}](${site}${i.href}): ${i.post.data.description}`).join('\n')}

## Other languages

- [Français](${site}/fr)
- [Deutsch](${site}/de)
- [Español](${site}/es)
`;

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
