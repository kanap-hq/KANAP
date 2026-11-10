import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Kad, AI assistant for IT governance',
    description:
      'Ask Kad about your IT data. Create documents, update tasks, add Kadratis to Claude in one click. Usage included on hosted cloud. Open source.',
  },
  header: {
    eyebrow: 'Kad · AI assistant',
    title: 'Ask Kadratis anything about your IT.',
    lead: 'Kad answers across your budget, applications, projects and documentation, and makes changes when you ask. Every write is shown to you before it runs. Use it inside Kadratis, or add Kadratis to Claude with its address and one click.',
  },
  sections: [
    {
      title: 'Search & query everything',
      body: 'Ask Kad about your applications, servers, contracts, budget items, projects, tasks or documents. Get instant answers with structured data, not vague summaries.',
      bullets: [
        'Cross-entity search across all modules',
        'Structured queries with filters and sorting',
        'Aggregations and statistics',
        'Knowledge base full-text search',
      ],
      shotAlt: 'Kad answers with a table: the contracts to decide within 90 days and the applications they cover',
    },
    {
      title: 'Take action with preview',
      body: 'Kad writes as well as reads. It can create and update content for you, and every write operation is previewed before it applies.',
      bullets: [
        'Create and edit documents with markdown',
        'Write project briefs and summaries',
        'Update tasks: status, assignees, comments',
        'Preview changes before applying',
      ],
      shotAlt: 'Kad prepares two changes to a task as previews, with Approve and Reject',
    },
    {
      title: 'Add Kadratis to Claude in one click',
      body: 'Paste your Kadratis address into Claude as a custom connector, sign in, click Allow. Claude then answers from your budget, applications, projects and documents. There is no key to create or copy. It works in Claude, Claude Desktop and Claude Code.',
      bullets: [
        'Each person signs in with their own Kadratis account',
        'Read-only, within that person\'s access rights',
        'Every user sees their connected apps and disconnects them in one click',
        'API keys remain available for scripts and other MCP clients',
      ],
      shotAlt: 'Claude builds a PowerPoint slide from Kadratis data: the 2026 budget for external FTEs and the average cost per day, by supplier',
    },
    {
      title: 'Full control & compliance',
      body: 'Kad respects your organisation\'s rules. Every action is governed by user permissions. Administrators have complete control over what Kad can and cannot do.',
      bullets: [
        'Full respect of user permissions on every query',
        'MCP connections and keys follow each user\'s permissions and can be cut at any time',
        'Web search can be enabled or disabled independently',
        'Preview and confirmation for all write operations',
        'Read-only access through roles for cautious rollouts',
      ],
      shotAlt: 'Kad settings: chat and MCP on, included model and its processing location confirmed, usage this month',
    },
  ],
  more: {
    title: 'What you can ask Kad',
    items: [
      { title: '"What\'s the status of Project Atlas?"', body: 'Kad pulls the project, its tasks, timeline, team, and gives you a concise status brief with blockers and upcoming milestones.' },
      { title: '"List applications on AWS with no owner"', body: 'Structured query across your IT landscape. Filtered, sorted results from live data.' },
      { title: '"Draft a remote-access security policy"', body: 'Kad creates a new document in your knowledge base, with proper metadata and markdown content.' },
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
    body: 'Kad is included in every Kadratis workspace, with generous usage on hosted cloud. Self-host free, or try the hosted cloud.',
    primary: 'Deploy free',
    secondary: 'Try hosted cloud',
  },
};

export default content;
