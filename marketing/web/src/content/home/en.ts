import type { HomeContent } from './types';

const content: HomeContent = {
  meta: {
    title: 'IT budget, landscape and projects, open source',
    description:
      'IT budget, application landscape, project portfolio and documentation in one record, with a built-in AI agent. Open source.',
  },

  hero: {
    eyebrow: 'Open source · built by a CIO, for CIOs',
    title: 'IT budget, applications and projects in one governed record.',
    lead: 'An application carries its budget, its documentation, its projects and its compliance data. Ask Plaid, the built-in AI agent, about all of it. Open source, free to self-host.',
    primaryCta: 'Try it with sample data',
    secondaryCta: 'Deploy for free',
    trialNote: 'Hosted trial · sample data loaded in a minute · AGPL v3, full source on GitHub.',
  },

  layers: {
    eyebrow: 'IT budget',
    title: 'Your IT budget, without the spreadsheet.',
    intro:
      'Multi-year OPEX and CAPEX, in columns you name: budget, revision, expected landing. Copy a version to next year, compare it with the previous one, freeze it once approved.',
    items: [
      {
        title: 'Landing and next-year budget',
        body: "Firm up the expected landing line by line, copy it into next year's budget, adjust in quantity × price, then freeze the approved version. Exchange rates are fixed with it.",
      },
      {
        title: 'Chargeback and analysis',
        body: 'Allocate every line across companies, departments and cost centers, charge back with clear rules, analyze by analytics dimension and consolidate on your chart of accounts.',
      },
      {
        title: 'Staffing and cost per FTE',
        body: 'Declare FTE on the lines that carry people: KANAP derives monthly staffing and cost per FTE, as an amount or a daily rate, next to the amounts.',
      },
    ],
    outro: 'Every line is attached to its application, contract or project: from the budget, you find what IT runs and what each piece costs.',
  },

  pillars: {
    eyebrow: 'Everything links',
    title: 'One record instead of a spreadsheet, a wiki and a project tool.',
    items: [
      {
        title: 'A budget line leads to what justifies it.',
        body: 'Every OPEX or CAPEX item links to its applications, contracts, suppliers and projects. You know what you pay for, and why.',
      },
      {
        title: 'An application shows what it costs.',
        body: 'Its record gathers its environments, interfaces, servers, contracts and spend: enough to decide on rationalization from facts.',
      },
      {
        title: 'A contract shows what it commits.',
        body: 'Yearly amount, auto-renewal, notice period, a computed cancellation deadline and the linked budget lines: renewals are prepared before the deadline, not after.',
      },
    ],
  },

  modules: {
    eyebrow: 'The whole of IT governance',
    title: 'Four pillars, one AI agent, the same data.',
    intro:
      'Every module works on its own: start with the budget, add the landscape, the portfolio or the documentation when you are ready. They all work on the same record.',
    items: [
      {
        slug: '/features/budget',
        title: 'IT budget',
        blurb:
          'For the CIO and finance partners. Multi-year budget, landing and next-year budget, chargeback, consolidation, staffing. Numbers your CFO can check.',
        bullets: [
          'OPEX and CAPEX, budget, revision and landing columns',
          'Version copy and freeze',
          'Chargeback, analytics dimensions, consolidation',
          'Monthly staffing and cost per FTE',
        ],
        ctaLabel: 'Explore the budget',
      },
      {
        slug: '/features/it-landscape',
        title: 'Landscape',
        blurb:
          'For architects, application owners and infrastructure teams. Applications, interfaces and servers documented, and maps that show the landscape at a glance.',
        bullets: [
          'Applications and instances per environment',
          'Interfaces, flows and middleware',
          'Servers and infrastructure, NetBox import',
          'Interactive interface and connection maps',
        ],
        ctaLabel: 'Explore the landscape',
      },
      {
        slug: '/features/portfolio',
        title: 'Project portfolio',
        blurb:
          'For project managers and IT leads. Score demand, build a roadmap that respects capacity, follow projects through delivery.',
        bullets: [
          'Request scoring with weighted criteria',
          'Capacity-aware roadmap planning',
          'Bottleneck and workload analysis',
          'Projects, milestones and tasks',
        ],
        ctaLabel: 'Explore the portfolio',
      },
      {
        slug: '/features/knowledge',
        title: 'Documentation',
        blurb:
          'For the whole team, support and operations first. Runbooks, decisions and architecture notes, reviewed, versioned and linked to the applications and projects they describe.',
        bullets: [
          'Markdown editor with review workflow',
          'Libraries, folders, document types',
          'Versions and PDF, DOCX, ODT export',
          'Links to applications, projects, assets, tasks',
        ],
        ctaLabel: 'Explore the documentation',
      },
      {
        slug: '/features/ai',
        title: 'Plaid, the built-in AI agent',
        blurb:
          'For every role. Ask a question in plain language about the budget, the landscape or the projects: Plaid answers from the whole record and prepares changes, which you approve.',
        bullets: [
          'Natural-language questions across all modules',
          'Changes prepared as previews, applied after approval',
          'Read-only MCP server for your AI clients',
          'Usage included on hosted KANAP, or bring your own key',
        ],
        ctaLabel: 'Explore Plaid',
      },
      {
        slug: '/features/agents',
        title: 'Helpdesk agent',
        blurb:
          'For support teams. The agent reads each ticket of your service desk (GLPI today) against your applications and documentation, and proposes a reply, an internal note or a ticket update.',
        bullets: [
          'Reasons on your real record',
          'Every action type starts under approval',
          'Switched to automatic once its track record justifies it',
          'Every action logged, autonomy you can withdraw',
        ],
        ctaLabel: 'Explore the agent',
      },
    ],
  },

  crossCutting: {
    eyebrow: 'Built for the enterprise',
    title: 'One system, under your control.',
    intro:
      'The modules share the same data, the same permissions and the same audit log: a change prepared by Plaid is recorded like any other.',
    items: [
      {
        title: 'Rich relationships',
        body: 'Costs linked to applications, applications to contracts, projects and servers, documentation to everything.',
      },
      {
        title: 'Reports and dashboards',
        body: 'Ready-made budget reports, trends, version comparisons, CSV and PNG exports.',
      },
      {
        title: 'Multi-company and multi-currency',
        body: 'Several companies, several currencies, rates fixed when the budget is frozen, and consolidation on your chart of accounts.',
      },
      {
        title: 'Role-based access control',
        body: 'Fine-grained permissions per module: reader, contributor, member, administrator.',
      },
      {
        title: 'Complete audit trail',
        body: 'Every change logged, including those made through Plaid, with before and after. Agent actions have their own activity history.',
      },
      {
        title: 'SSO with Microsoft Entra ID',
        body: 'Enterprise single sign-on: one identity across the organization.',
      },
    ],
  },

  vision: {
    eyebrow: 'AI on a complete record',
    title: 'AI that helps, because everything is in one place.',
    body: "An AI assistant is only as good as the data it sees. In KANAP it sees the budget, applications, contracts, projects and documentation at once, so it can answer \"why is the landing drifting on infrastructure?\" or \"which applications depend on this contract?\".\nIt prepares the changes, you approve them. Nothing changes without you, and everything is logged.",
  },

  cta: {
    title: 'Run your IT on a system you own.',
    body: 'Try hosted KANAP with sample data, or deploy it for free on your own servers. Same product, no feature paywall.',
    primary: 'Try it with sample data',
    secondary: 'Deploy for free',
  },
};

export default content;
