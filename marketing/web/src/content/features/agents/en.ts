import type { AgentsContent } from '../types';

const content: AgentsContent = {
  meta: {
    title: 'Autonomous AI agents for IT',
    description:
      'KANAP agents pick up repetitive IT tasks, reason over your own IT data, and act under autonomy you control and can audit. One service-desk connector live today, the runtime built to extend. Open source, self-hosted.',
  },
  header: {
    eyebrow: 'Autonomous agents for IT',
    title: 'AI agents that take work off your team.',
    lead: 'A KANAP agent picks up a task, reads it against your IT data, and either proposes an action or carries it out, depending on how much autonomy you have given it. It works the repetitive load so your people work the hard problems.',
  },
  sections: [
    {
      title: 'Agents start supervised and grow more autonomous.',
      body: 'Every agent begins under supervision. It proposes actions, you review them, and KANAP tracks how often it gets things right. As that record holds, you grant it more autonomy, until it handles routine work on its own and only brings you the cases that need a person.',
      bullets: [
        'Begins by proposing actions for your review',
        'KANAP measures how often it gets things right',
        'You grant more autonomy as the track record holds',
        'Settles into handling routine work on its own',
      ],
      shotAlt: 'The autonomy setting for an agent',
    },
    {
      title: 'It reasons over your real environment.',
      body: 'An agent does not work from the ticket alone. It reads the application a problem affects, who owns it, how critical it is, and the documentation you wrote about it. Then it lists the records and documents it used, so you can check its reasoning.',
      bullets: [
        'Reads the affected application, its owner and criticality',
        'Pulls in the related project, cost and documentation',
        'Answers from your data, not from guesses',
        'Lists the sources it drew from',
      ],
      shotAlt: 'An agent proposal showing the classification, the drafted action, and the sources it used',
    },
    {
      title: 'One runtime, any tool.',
      body: 'The decision an agent makes is kept separate from how it talks to any given tool. A service-desk connector ships first, working real tickets in production. The same runtime is built to drive other systems, and because the code is open, you can write a connector for the tool you need.',
      bullets: [
        'The reasoning is kept separate from the connector',
        'A service-desk connector runs in production today',
        'Built to drive monitoring, directory services and more',
        'Write your own connector, the code is open',
      ],
      shotAlt: 'The agent settings for persona and targeting',
    },
    {
      title: 'A record of everything it did.',
      body: 'Every agent action is recorded, scoped to what you allowed, backed by the sources it used, and stoppable at any moment. That record is what makes it defensible to hand an agent real work. The history is kept 30 days by default, and you can set it from 7 to 90 days.',
      bullets: [
        'Every action recorded in the agent\'s activity history',
        'Scoped to the operations you allow',
        'Each answer backed by its sources',
        'Pause any agent immediately',
      ],
      shotAlt: 'The agent activity and audit record',
    },
    {
      title: 'Yours to run and to change.',
      body: 'Agents are part of the open-source product. Run them inside your own deployment, where your tickets and documents stay, except the text sent to the LLM provider you choose, and change how they work because you have the full source. Bring your own LLM key, the same as Plaid.',
      bullets: [
        'Included in the open-source product',
        'Runs inside your own deployment',
        'Tickets and documents stay with you, except what goes to the LLM',
        'Bring your own LLM key',
      ],
      shotAlt: 'An agent working a queue of tasks',
    },
  ],
  more: {
    title: 'More control where you need it',
    items: [
      {
        title: 'Spend caps',
        body: 'Set a per-agent limit on what it can spend on the LLM, so running cost stays predictable.',
      },
      {
        title: 'Emergency pause',
        body: 'Stop any agent immediately, one at a time or across the board, whenever you want to step in.',
      },
      {
        title: 'Role-based access',
        body: 'Decide who can configure agents, grant autonomy, or review what an agent did.',
      },
      {
        title: 'Performance metrics',
        body: 'See how often an agent gets things right, and how much work it has taken off your team.',
      },
    ],
  },
  transparency: {
    eyebrow: 'Running today',
    title: 'One agent in production, a runtime built to extend.',
    body: 'Running today: an autonomous agent working a real service desk in production. The runtime is built to extend. Pick a tool, write a connector, and the same agent works it. If you need one built, tell us.',
    ctaLabel: 'Ask for a connector',
    ctaHref: '/contact',
  },
  crossLinks: {
    label: 'See how it fits together',
    links: [
      { label: 'IT landscape', href: '/features/it-landscape' },
      { label: 'Knowledge', href: '/features/knowledge' },
      { label: 'Self-host', href: '/on-premise' },
      { label: 'Security', href: '/security' },
      { label: 'Plaid, AI assistant', href: '/features/ai' },
    ],
  },
  cta: {
    title: 'Put an agent on the repetitive work.',
    body: 'Agents are in the free, self-hosted product, with your own LLM key. Deploy KANAP yourself, or talk to us about hosting and connectors.',
    primary: 'Deploy free',
    secondary: 'Talk to us',
  },
};

export default content;
