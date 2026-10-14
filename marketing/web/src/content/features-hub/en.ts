import type { FeaturesHubContent } from '../features/types';

const content: FeaturesHubContent = {
  meta: {
    title: 'How IT teams actually use KANAP',
    description:
      'Six scenarios from the people who run IT every day, from the CIO to support to the IT operations lead. See how the modules combine, and how agents now take on the repetitive load.',
  },
  header: {
    eyebrow: 'By role',
    title: 'How IT teams actually use KANAP.',
    lead: 'Six scenarios from people who run IT every day. They draw on one record, work it through Plaid in plain language, and now hand the repetitive parts to an agent. See how the modules combine, not just what each does separately.',
  },
  modulesUsedLabel: 'Modules combined',
  personas: [
    {
      role: 'CIO / IT director',
      headline: 'Defend the IT budget at the board meeting.',
      body:
        "Your CFO asks why IT costs went up 12%. You walk in with the numbers: a chargeback report by company and department, OPEX and CAPEX side by side, by analytics dimension, the multi-year trend. Every line traces back to a contract or a project. No spreadsheet gymnastics, no \"I'll get back to you\".",
      outcome: 'Walk into the budget review with the answers.',
      modules: [
        { slug: 'budget', label: 'Budget' },
        { slug: 'it-landscape', label: 'IT landscape' },
      ],
      shotAlt: 'Top 10 OPEX lines of the 2026 budget, as a pie chart',
    },
    {
      role: 'Enterprise architect',
      headline: 'Plan a migration without surprises.',
      body:
        "You're retiring the legacy CRM. Before you commit dates, you need to know what depends on it: which interfaces, which downstream apps, which projects already touch it. The interface map shows the dependency graph at a glance. Your migration plan lists every interface owner to call, every project that needs to be aware. Knowledge ties the decisions to the apps they describe. Your future self will know why.",
      outcome: 'Migrate with eyes open instead of crossed fingers.',
      modules: [
        { slug: 'it-landscape', label: 'IT landscape' },
        { slug: 'knowledge', label: 'Knowledge' },
        { slug: 'portfolio', label: 'Portfolio' },
      ],
      shotAlt: 'Interface map showing the dependency graph for the retiring CRM',
    },
    {
      role: 'PMO lead / IT project manager',
      headline: 'Run quarterly planning with capacity numbers.',
      body:
        "Twenty incoming requests, eight teams, one quarter. Score each request against weighted criteria, then generate a capacity-aware roadmap. Bottlenecks are visible before you commit. Dates aren't wishful thinking. They're math. When the steering committee reviews, you can explain why this project lands in Q3, not Q1: capacity on the platform team.",
      outcome: 'Commit to dates you can actually defend.',
      modules: [
        { slug: 'portfolio', label: 'Portfolio' },
        { slug: 'budget', label: 'Budget' },
      ],
      shotAlt: 'Capacity-aware roadmap with bottleneck heatmap',
    },
    {
      role: 'IT operations / support',
      headline: 'Find the root cause in seconds, not hours.',
      body:
        "Production order management is slow. You ask Plaid: \"Which apps consume the order-management API?\" Five seconds later, a list. \"Which of those have been updated this week?\" One match. \"Who owns it?\" Email and Teams handle. From symptom to ownership without opening five tools. The first-line tickets that repeat every week go to an agent now, so your team only picks up what needs a person.",
      outcome: 'Resolve incidents from one place, while an agent clears the repetitive tickets.',
      modules: [
        { slug: 'it-landscape', label: 'IT landscape' },
        { slug: 'knowledge', label: 'Knowledge' },
        { slug: 'ai', label: 'Plaid' },
        { slug: 'agents', label: 'Agents' },
      ],
      shotAlt: 'Plaid answering an incident-investigation query with structured results',
    },
    {
      role: 'IT lead / infrastructure manager',
      headline: 'Find what to retire, what to renew, what to consolidate.',
      body:
        "How many SaaS apps are we paying for? Which ones overlap? Who's the owner when it's time to renegotiate? Every application carries its OPEX line, its contract, its renewal date, its data classification. Sort by cost, by overlap, by usage. Have the conversation with finance with facts in front of you.",
      outcome: 'Stop renewing what nobody uses.',
      modules: [
        { slug: 'it-landscape', label: 'IT landscape' },
        { slug: 'budget', label: 'Budget' },
        { slug: 'knowledge', label: 'Knowledge' },
      ],
      shotAlt: 'Application portfolio sorted by OPEX cost with renewal dates',
    },
    {
      role: 'IT operations lead',
      headline: 'Hand the repetitive tickets to an agent.',
      body:
        'Your first-line queue is full of the same requests every week: access resets, recurring incidents, routine triage. An agent picks each one up, reads it against your IT data, and proposes or carries out the fix under the autonomy you set. It works supervised at first and earns more independence as its track record holds. Your people stop spending their day on the repetitive load.',
      outcome: 'Your team spends its time on the hard problems while the agent clears the routine ones.',
      modules: [
        { slug: 'agents', label: 'Agents' },
        { slug: 'it-landscape', label: 'IT landscape' },
        { slug: 'knowledge', label: 'Knowledge' },
      ],
      shotAlt: 'An agent working a queue of first-line tickets',
    },
  ],
  cta: {
    title: 'Ready to see your role on the platform?',
    body:
      'Start free with self-hosting, or try the hosted cloud.\nAll features on every plan, cloud or self-hosted.',
    primary: 'Deploy free',
    secondary: 'Try hosted cloud',
  },
};

export default content;
