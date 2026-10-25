import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Incident register: reviews, journal, audit evidence',
    description:
      'Open source incident register for IT departments: numbered incidents, a written review, a journal nobody can edit, GDPR and NIS2 notification facts, links to applications and servers.',
  },
  header: {
    eyebrow: 'Incidents',
    title: 'Keep a detailed record of your major incidents.',
    lead: 'KANAP keeps the memory of the incidents that matter: what happened, what it hit, why, and what you changed. Each one gets a number, a review and a journal, and stays linked to the applications and servers it touched.',
  },
  sections: [
    {
      title: 'The incident register',
      body: 'Every incident gets a permanent reference, INC-12, and the numbers never have gaps: a cancelled incident keeps its number. Severity, category, owner and dates are all you need to start; the rest comes when you know more. Past incidents can be entered with their real dates.',
      bullets: [
        'Four severity levels, configurable categories',
        'Open, in progress, resolved, closed: the status only moves forward',
        'Reopen or cancel an incident with a mandatory reason, register administrators only',
        'Search across titles, descriptions and the linked applications and servers',
        'Duration computed once the incident is resolved',
      ],
      shotAlt: 'Incident register with severity, status, detection and resolution dates',
    },
    {
      title: 'The review, written where the incident lives',
      body: 'Each incident has a review: a rich document started from a five-part template (detailed description, impact, root cause, corrective actions, lessons learned) in the language of the person who writes it. Every save creates a version, and the review is frozen when the incident closes.',
      bullets: [
        'Template editable by your documentation administrators',
        'Headings, lists, tables and pasted images',
        'Versioned, filed in the documentation library with its own reference',
        'Incident rights are enough to write it',
        'The journal records each change, and no entry can be edited or deleted',
      ],
      shotAlt: 'Closed incident with its description and its review: summary, impact, root cause, actions',
    },
    {
      title: 'Evidence for the auditor',
      body: 'Was personal data affected? Did the authority need to be notified, and when was it? Who was informed? The incident records these facts with their dates, and keeps them: an incident with regulatory facts cannot be deleted.',
      bullets: [
        'Personal data affected, authority notification required, notified on, parties informed',
        'PDF report of an incident, in the language of the screen',
        'Closing locks everything: fields, review, journal, links and files',
        'Confidential incidents visible only to register administrators, the reporter and the owner',
        'The facts that GDPR article 33(5) and NIS2 ask you to document',
      ],
      shotAlt: 'Incident with personal data affected and the authority notified on 11 July',
    },
    {
      title: 'Linked to your landscape',
      body: 'Link an incident to the servers, applications and technologies it hit. Each of them then shows its incidents, read-only, on its own page. Follow-up actions become tasks that carry the incident reference, and documents and attached files stay with the incident.',
      bullets: [
        'Assets, applications and technologies, with suggestions from what is already linked',
        'Incidents shown on each application, server and technology page',
        'Follow-up tasks created from the incident',
        'Documents from the knowledge base and attached files',
        'Links follow each person\'s read rights',
      ],
      shotAlt: 'Relations of an incident: three servers, two SAP applications and VMware ESXi',
    },
  ],
  more: {
    title: 'And more',
    items: [
      { title: 'CSV import and export', body: 'Bring your past incidents in from a spreadsheet, reviews included, and export the whole register.' },
      { title: 'Plaid and MCP', body: 'Ask Plaid how many major incidents were opened this year, or for the full record of one, journal and review included. Confidential incidents stay out. The same data is open to your AI clients through the read-only MCP server.' },
      { title: 'Antedated notes', body: 'Notes in the journal carry the time the event happened. The time they were saved is kept apart and cannot be changed.' },
      { title: 'Rights', body: 'Readers see, contributors create and write, register administrators reopen, cancel, delete and lift a restriction.' },
    ],
  },
  crossLinks: {
    label: 'Explore the platform',
    links: [
      { label: 'IT landscape', href: '/features/it-landscape' },
      { label: 'Contracts', href: '/features/contracts' },
      { label: 'Documentation', href: '/features/knowledge' },
      { label: 'Plaid, the built-in AI agent', href: '/features/ai' },
      { label: 'Helpdesk agent', href: '/features/agents' },
    ],
  },
  cta: {
    title: 'Ready to deploy a rich, auditable incident register?',
    body: 'Self-host for free, or try hosted cloud. All features on every plan.',
    primary: 'Deploy free',
    secondary: 'Try hosted cloud',
  },
};

export default content;
