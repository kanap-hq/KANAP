import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Plaid, AI assistant for IT governance',
    description:
      'Ask Plaid about your IT data. Create documents, update tasks, add KANAP to Claude in one click. Usage included on hosted cloud. Open source.',
  },
  header: {
    eyebrow: 'Plaid · AI assistant',
    title: 'Ask KANAP anything about your IT.',
    lead: 'Plaid answers across your budget, applications, projects and documentation, and makes changes when you ask. Every write is shown to you before it runs. Use it inside KANAP, or add KANAP to Claude with its address and one click.',
  },
  sections: [
    {
      title: 'Search & query everything',
      body: 'Ask Plaid about your applications, servers, contracts, budget items, projects, tasks or documents. Get instant answers with structured data, not vague summaries.',
      bullets: [
        'Cross-entity search across all modules',
        'Structured queries with filters and sorting',
        'Aggregations and statistics',
        'Knowledge base full-text search',
      ],
      shotAlt: 'Plaid answers with a table: the contracts to decide within 90 days and the applications they cover',
    },
    {
      title: 'Take action with preview',
      body: 'Plaid writes as well as reads. It can create and update content for you, and every write operation is previewed before it applies.',
      bullets: [
        'Create and edit documents with markdown',
        'Write project briefs and summaries',
        'Update tasks: status, assignees, comments',
        'Preview changes before applying',
      ],
      shotAlt: 'Plaid prepares two changes to a task as previews, with Approve and Reject',
    },
    {
      title: 'Add KANAP to Claude in one click',
      body: 'Paste your KANAP address into Claude as a custom connector, sign in, click Allow. Claude then answers from your budget, applications, projects and documents. There is no key to create or copy. It works in Claude, Claude Desktop and Claude Code.',
      bullets: [
        'Each person signs in with their own KANAP account',
        'Read-only, within that person\'s access rights',
        'Every user sees their connected apps and disconnects them in one click',
        'API keys remain available for scripts and other MCP clients',
      ],
      shotAlt: 'Claude answers from KANAP data: external FTEs and average day rate by supplier, as charts',
    },
    {
      title: 'Full control & compliance',
      body: 'Plaid respects your organisation\'s rules. Every action is governed by user permissions. Administrators have complete control over what Plaid can and cannot do.',
      bullets: [
        'Full respect of user permissions on every query',
        'MCP connections and keys follow each user\'s permissions and can be cut at any time',
        'Web search can be enabled or disabled independently',
        'Preview and confirmation for all write operations',
        'Read-only access through roles for cautious rollouts',
      ],
      shotAlt: 'Plaid settings: chat and MCP on, included model and its processing location confirmed, usage this month',
    },
  ],
  more: {
    title: 'What you can ask Plaid',
    items: [
      { title: '"What\'s the status of Project Atlas?"', body: 'Plaid pulls the project, its tasks, timeline, team, and gives you a concise status brief with blockers and upcoming milestones.' },
      { title: '"List applications on AWS with no owner"', body: 'Structured query across your IT landscape. Filtered, sorted results from live data.' },
      { title: '"Draft a remote-access security policy"', body: 'Plaid creates a new document in your knowledge base, with proper metadata and markdown content.' },
      { title: '"Which contracts expire in 90 days?"', body: 'Instant answer with supplier names, amounts and renewal dates. No clicking through dashboards.' },
    ],
  },
  crossLinks: {
    label: 'Explore the platform',
    links: [
      { label: 'Agents, for work that runs on its own', href: '/features/agents' },
      { label: 'Security', href: '/security' },
      { label: 'Budget management', href: '/features/budget' },
      { label: 'IT landscape', href: '/features/it-landscape' },
      { label: 'Portfolio management', href: '/features/portfolio' },
      { label: 'Knowledge', href: '/features/knowledge' },
    ],
  },
  cta: {
    title: 'AI-powered IT governance starts here.',
    body: 'Plaid is included in every KANAP workspace, with generous usage on hosted cloud. Self-host free, or try the hosted cloud.',
    primary: 'Deploy free',
    secondary: 'Try hosted cloud',
  },
};

export default content;
