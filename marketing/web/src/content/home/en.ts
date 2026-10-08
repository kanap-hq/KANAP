import type { HomeContent } from './types';

const content: HomeContent = {
  meta: {
    title: 'Open-source AI agents for your IT department',
    description:
      'AI agents grounded in the full picture of your IT: applications, infrastructure, budgets, projects and documentation. Open source under AGPL v3. Self-host free, or choose hosted KANAP.',
  },

  hero: {
    eyebrow: 'Open-source · self-hosted · built to extend',
    title: 'AI agents that take over your repetitive work.',
    lead: "KANAP holds your IT department's full picture, from applications and servers to budgets and projects. Plaid lets anyone work with it in plain language, and agents now act on it to take the repetitive load off your team.\nSelf-host it for free, or let us run it for you.",
    primaryCta: 'Deploy free',
    secondaryCta: 'Try hosted cloud',
    trialNote: 'AGPL v3 · full source on GitHub · Docker install · no feature paywall.',
  },

  pillars: {
    eyebrow: 'Why KANAP',
    title: 'What makes KANAP different.',
    items: [
      {
        title: 'The whole IT department in one system.',
        body: 'Applications, infrastructure, budgets, projects and documentation live in one record instead of ten disconnected tools.',
      },
      {
        title: 'Agents that take work off your team.',
        body: 'Autonomous agents handle the repetitive load and earn more independence as they prove themselves on real tasks.',
      },
      {
        title: 'Open source, self-hosted, yours to extend.',
        body: 'Full source under AGPL v3. Run it on your own servers, keep every feature, and write your own agents and connectors.',
      },
    ],
  },

  layers: {
    eyebrow: 'How it fits together',
    title: 'A complete platform for the IT department.',
    intro:
      'KANAP is built in three layers that work on the same information, so each one makes the others more useful.',
    items: [
      {
        title: 'The record',
        body: 'KANAP holds the full picture of your IT department: applications and infrastructure, budgets, projects and documentation. One place instead of ten tools.',
      },
      {
        title: 'The interaction',
        body: 'Plaid lets anyone on your team work with the record in plain language, asking questions and making changes without learning where everything lives.',
      },
      {
        title: 'The action',
        body: 'Agents act on the same record, picking up repetitive work and carrying it out under the autonomy you grant them.',
      },
    ],
    outro: 'Each part is useful by itself, and they get stronger together.',
  },

  modules: {
    eyebrow: 'Complete IT toolbox',
    title: 'Built for every IT role.',
    intro:
      'KANAP covers the core territory every IT department needs to run, from the first budget line to the last retired application, with Plaid to work across it in plain language and agents that take on the repetitive load. Every module is fully usable on its own, so you can start where it hurts most and add the rest when you are ready.',
    items: [
      {
        slug: '/features/budget',
        title: 'Budget management',
        blurb:
          'For CIOs and finance partners. Multi-year planning, intelligent allocations, executive-ready chargeback. Defend the IT budget with the numbers your CFO will trust.',
        bullets: [
          'Multi-year budget planning',
          'Six allocation methods',
          'Multi-currency with World Bank FX',
          'Executive chargeback reports',
        ],
        ctaLabel: 'Learn more',
      },
      {
        slug: '/features/it-landscape',
        title: 'IT landscape',
        blurb:
          'For architects, application owners and infrastructure teams. Document apps, interfaces and servers. See the system at a glance, plan changes with the dependencies in front of you.',
        bullets: [
          'Application portfolio with per-environment instances',
          'Interface documentation with 3-leg middleware',
          'Server and infrastructure registry',
          'Interactive interface and connection maps',
        ],
        ctaLabel: 'Learn more',
      },
      {
        slug: '/features/portfolio',
        title: 'Portfolio management',
        blurb:
          'For project managers and IT leads. Score the demand, simulate capacity-aware roadmaps, commit dates without crossing your fingers.',
        bullets: [
          'Request scoring with weighted criteria',
          'Automatic roadmap scheduling',
          'Bottleneck and occupation analysis',
          'Project lifecycle tracking',
        ],
        ctaLabel: 'Learn more',
      },
      {
        slug: '/features/knowledge',
        title: 'Knowledge',
        blurb:
          'For everyone, especially support and operations. Markdown editor, libraries, review workflows. Runbooks, decisions and architecture notes connected to the apps and projects they describe.',
        bullets: [
          'Markdown editor with review workflows',
          'Libraries, folders, document types',
          'Version history and export to PDF, DOCX, ODT',
          'Deep links to apps, projects, assets, tasks',
        ],
        ctaLabel: 'Learn more',
      },
      {
        slug: '/features/ai',
        title: 'Plaid, AI assistant',
        blurb:
          'For every role, not just the AI-curious. Ask in plain language, get structured answers across every module. The shortest path between an IT question and the data that answers it.',
        bullets: [
          'Natural-language queries across every module',
          'Document and task actions with preview',
          'MCP server for Claude, Cursor, Windsurf…',
          'Usage included on hosted cloud, or bring your own key',
        ],
        ctaLabel: 'Learn more',
      },
      {
        slug: '/features/agents',
        title: 'Agents',
        blurb:
          'For teams buried in repetitive tickets. An agent reads each task against your IT data and either proposes an action or carries it out, under the autonomy you set. One service-desk connector runs in production today, and the runtime is built to extend.',
        bullets: [
          'Reasons over your real IT record',
          'Starts supervised, earns more autonomy',
          'Every action recorded, autonomy you can withdraw',
          'Open runtime, write your own connector',
        ],
        ctaLabel: 'Learn more',
      },
    ],
  },

  crossCutting: {
    eyebrow: 'Enterprise ready',
    title: 'One connected system, under your control.',
    intro:
      'The modules work from the same data, which is what gives an IT department real governance. It is also what lets an agent act without putting your environment at risk.',
    items: [
      {
        title: 'Reporting & dashboards',
        body: 'Executive-ready dashboards, trend analysis, exports to CSV and PNG.',
      },
      {
        title: 'Role-based access',
        body: 'Fine-grained permissions per module. Reader, contributor, member and admin levels.',
      },
      {
        title: 'Rich relations',
        body: 'Link costs to apps, apps to projects, projects to budgets, knowledge to everything.',
      },
      {
        title: 'Complete audit trail',
        body: 'Every change tracked, including changes made through Plaid. Agent actions have their own activity history. Know who changed what, when, with full before and after history.',
      },
      {
        title: 'Unified task management',
        body: 'Assign tasks across OPEX, CAPEX, contracts, and projects. One backlog across the platform.',
      },
      {
        title: 'SSO via Microsoft Entra ID',
        body: 'Enterprise single sign-on. One login for your entire organisation.',
      },
    ],
  },

  vision: {
    eyebrow: 'Where this goes',
    title: 'Toward an AI-augmented IT department.',
    body: 'The direction is an IT department where agents quietly carry the repetitive load so your team can spend its time on the work that needs real judgment, all of it running on software you own and can read end to end.',
  },

  cta: {
    title: 'Run your IT department on a system you own.',
    body: 'Deploy KANAP yourself for free, or have us host it. The product and every feature are the same, agents included.',
    primary: 'Deploy free',
    secondary: 'Try hosted cloud',
  },
};

export default content;
