import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Portfolio management',
    description:
      'Request scoring, automatic roadmap generation, capacity-aware scheduling, project lifecycle tracking. Open source. Self-host free or choose hosted cloud.',
  },
  header: {
    eyebrow: 'Portfolio management',
    title: 'From request to delivery, with automatic roadmap scheduling.',
    lead: 'Manage your project funnel with intelligent scoring, capacity-aware roadmap generation and lifecycle tracking. Simulate scenarios before you commit dates.',
  },
  sections: [
    {
      title: 'Request scoring & evaluation',
      body: 'Evaluate incoming requests with configurable scoring criteria. Weight business value, ROI, risk and urgency to calculate a priority score. Support for mandatory bypass rules and manual override with justification.',
      bullets: [
        'Configurable scoring criteria with custom weights',
        'Default criteria: value, alignment, costs, ROI, risk, urgency',
        'Inverted scales for cost/risk (higher = lower score)',
        'Mandatory bypass rules for critical requests',
        'Manual override with required justification',
      ],
      shotAlt: 'Request scoring editor with weighted criteria',
    },
    {
      title: 'Request lifecycle',
      body: 'Track requests from initial submission through approval and conversion to projects. Built-in workflow states, activity history and CAB decision recording keep everyone aligned on the status of each request.',
      bullets: [
        'Status flow: Pending review, Candidate, Approved, Converted',
        'Alternative paths: On hold, Rejected',
        'Activity history with comments and status changes',
        'CAB decision recording with formal approval tracking',
        'One-click conversion from approved request to project',
      ],
      shotAlt: 'Request workspace with activity timeline',
    },
    {
      title: 'Project lifecycle tracking',
      body: 'Manage projects from planning through execution to completion. Track planned vs actual dates, capture baselines, and monitor effort. Support for standard projects, fast-track mandates, and legacy work.',
      bullets: [
        'Status flow: Waiting list, Planned, In progress, In testing, Done',
        'Baseline capture when entering execution phase',
        'Planned vs actual dates for variance analysis',
        'Effort tracking: estimated vs actual IT and business effort',
        'Origin tracking: Standard, Fast-track, Legacy',
      ],
      shotAlt: 'Project workspace with baseline vs actual dates',
    },
    {
      title: 'Automatic roadmap scheduling',
      body: 'Generate delivery scenarios from remaining effort, dependencies and contributor capacity. See bottlenecks and occupation before applying dates to live projects. This scoring and roadmap data is part of what an agent reasons over when it picks up related work.',
      bullets: [
        'Weekly capacity-aware scheduling from real effort allocations',
        'Default scope covers Waiting List, Planned, In progress, In testing',
        'Optional recalc of scheduled projects or frozen-plan simulation',
        'Bottleneck sensitivity analysis by contributor impact',
        'Monthly occupation views by contributor and team',
        'Selective, transactional apply of generated planned dates',
      ],
      shotAlt: 'Generated roadmap with capacity heatmap',
    },
  ],
  more: {
    title: 'More in portfolio',
    items: [
      { title: 'Team management', body: 'Assign business and IT sponsors, leads and members. Track external contacts.' },
      { title: 'Budget linking', body: 'Link projects to OPEX and CAPEX items. Understand the real cost of your portfolio.' },
      { title: 'Dependencies', body: 'Track request and project dependencies. Blocking links feed roadmap sequencing.' },
      { title: 'Portfolio reports', body: 'Capacity heatmaps, bottleneck analysis, occupation analytics.' },
    ],
  },
  crossLinks: {
    label: 'Explore the platform',
    links: [
      { label: 'Agents', href: '/features/agents' },
      { label: 'Kad, AI assistant', href: '/features/ai' },
      { label: 'Budget management', href: '/features/budget' },
      { label: 'IT landscape', href: '/features/it-landscape' },
      { label: 'Knowledge', href: '/features/knowledge' },
    ],
  },
  cta: {
    title: 'Ready to take control of your project funnel?',
    body: 'Self-host for free, or try hosted cloud. All features on every plan.',
    primary: 'Deploy free',
    secondary: 'Try hosted cloud',
  },
};

export default content;
