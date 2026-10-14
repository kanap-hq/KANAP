import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Plaid, AI assistant for IT governance',
    description:
      'Ask Plaid about your IT data. Create documents, update tasks, connect your AI tools via MCP. Usage included on hosted cloud. Open source.',
  },
  header: {
    eyebrow: 'Plaid · AI assistant',
    title: 'Ask KANAP anything about your IT.',
    lead: 'Plaid answers across your budget, applications, projects and documentation, and makes changes when you ask. Every write is shown to you before it runs. Use it inside KANAP, or connect it to your own AI tools over MCP.',
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
      shotAlt: 'Plaid answering a cross-module query',
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
      shotAlt: 'Plaid showing a preview of task updates',
    },
    {
      title: 'MCP, use KANAP from your AI tools',
      body: 'Query your IT governance data without leaving your workflow. KANAP runs a read-only MCP (Model Context Protocol) server. Claude Code, Cursor and any client that sends an API key header connect to it directly.',
      bullets: [
        'Standard MCP over HTTP, authenticated with an API key',
        'Each key reads only what its creator is allowed to see',
        'The same read queries as the built-in chat (MCP is read-only)',
        'Keep your existing AI workflows, add KANAP context',
      ],
      shotAlt: 'MCP API key settings',
    },
    {
      title: 'Full control & compliance',
      body: 'Plaid respects your organisation\'s rules. Every action is governed by user permissions. Administrators have complete control over what Plaid can and cannot do.',
      bullets: [
        'Full respect of user permissions on every query',
        'MCP keys that expire, can be revoked and follow their creator\'s permissions',
        'Web search can be enabled or disabled independently',
        'Preview and confirmation for all write operations',
        'Read-only access through roles for cautious rollouts',
      ],
      shotAlt: 'Plaid admin controls with permission matrix',
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
