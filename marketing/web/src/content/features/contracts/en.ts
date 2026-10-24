import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'IT contract management: deadlines, renewals, budget',
    description:
      'Open source IT contract management: computed notice deadlines, a renewal decision before each one, commitment checked against the budget, and a compliance register.',
  },
  header: {
    eyebrow: 'Contracts',
    title: 'Never miss a cancellation deadline again.',
    lead: 'Enter the start date, the duration and the notice period: KANAP works out every term and the last day to cancel. The owner gets a decision to make before that day, and the contract stays linked to its budget lines, applications and assets.',
  },
  sections: [
    {
      title: 'The contracts to decide, first',
      body: 'The list opens on the next deadline. One quick filter shows the contracts whose cancellation window closes within the decision period, ninety days by default. Each row says where the contract stands: to decide, renewed until a date, ending without renewal, or expired.',
      bullets: [
        'Sorted by next deadline, with the number of days left',
        'Quick filters: to decide, without a budget line, under-budgeted',
        'Committed, budget and gap for the year, in your reporting currency',
        'Supplier, contracting company, owner, billing frequency',
        'CSV import and export',
      ],
      shotAlt: "Contracts list sorted by next deadline, with the state, the commitment, the budget and the gap",
    },
    {
      title: 'Deadlines worked out for you',
      body: 'Nothing is typed twice. From the start date, the duration and the notice period, the contract page draws every past term, the current one and the next, with today and the cancellation deadline on the same line.',
      bullets: [
        'Terms, renewals and cancellation deadline computed, never stored',
        'Tacit renewal on or off, with its own confirmation',
        'End of validity for a contract that stops for good',
        'Notes and follow-up tasks on the contract',
        'Email reminders to the owner 30, 14, 7 and 1 days before the deadline',
      ],
      shotAlt: 'SAP maintenance contract with its terms on a timeline and the cancellation deadline',
    },
    {
      title: 'A decision before the deadline',
      body: 'When the decision window opens, KANAP creates a task for the contract owner. On the contract, three answers: renew, renegotiate or terminate. Before you confirm a termination, KANAP shows what it changes: the end date allowed by the notice period, the commitment of this year and the next, the applications and assets that lose the contract.',
      bullets: [
        'Decision window set per tenant, 90 days by default',
        'A task for the owner, with the usual assignment email',
        'Renew, renegotiate or terminate, with a free-text reason',
        'Consequences shown before you confirm',
        'A decision can be undone until the deadline',
      ],
      shotAlt: 'Termination of a contract with its consequences on the commitment and the applications',
    },
    {
      title: 'Commitment against budget',
      body: 'A contract commits money; the budget plans it. The Budget tab lists the OPEX and CAPEX lines linked to the contract and compares them, year by year, with what the contract commits. You see at once whether the contract is covered, under-budgeted or not budgeted at all.',
      bullets: [
        'Linked budget lines, amounts by year and column',
        'Commitment prorated on the months each term covers',
        'Coverage year by year: covered, under-budgeted, no budget line, budget above the contract',
        'Contracts in other currencies converted at your rates',
        'Visible only to people who can read the budget',
      ],
      shotAlt: 'Budget tab of the SAP contract: linked lines, commitment and coverage year by year',
    },
  ],
  more: {
    title: 'More in Contracts',
    items: [
      { title: 'Compliance register', body: 'Five clauses to track (GDPR data processing agreement, data location, reversibility, exit plan, audit right), expected from the applications the contract covers. A register you keep, not a certification.' },
      { title: 'Relations and contacts', body: 'Applications, assets and technologies covered by the contract, supplier contacts with their role, links and attached files.' },
      { title: 'Plaid and MCP', body: 'Ask Plaid which contracts must be decided in the next 90 days. The same data is open to your own AI clients through the read-only MCP server.' },
      { title: 'Rights', body: 'Readers see, members create and decide, administrators import, export and delete. The budget figures follow the budget rights.' },
    ],
  },
  crossLinks: {
    label: 'Explore the platform',
    links: [
      { label: 'IT budget', href: '/features/budget' },
      { label: 'IT landscape', href: '/features/it-landscape' },
      { label: 'Incidents', href: '/features/incidents' },
      { label: 'Plaid, the built-in AI agent', href: '/features/ai' },
      { label: 'Project portfolio', href: '/features/portfolio' },
    ],
  },
  cta: {
    title: 'Ready to take your contracts out of the spreadsheet?',
    body: 'Self-host for free, or try hosted cloud. All features on every plan.',
    primary: 'Deploy free',
    secondary: 'Try hosted cloud',
  },
};

export default content;
