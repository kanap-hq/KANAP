import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Knowledge management',
    description:
      'Markdown editor with libraries, folders, review workflows, version history and export to PDF / DOCX / ODT. Deep links to apps, projects, assets, tasks. Open source.',
  },
  header: {
    eyebrow: 'Knowledge',
    title: 'Your IT documentation, connected to everything.',
    lead: 'Markdown-based document governance with structured libraries, review workflows and deep integration with your applications, assets, projects and tasks.',
  },
  sections: [
    {
      title: 'Markdown editor with governance',
      body: 'Write and maintain IT documentation with a rich markdown editor. Edit locks prevent concurrent modifications, autosave ensures nothing is lost. Embed inline images and format with full markdown support.',
      bullets: [
        'Rich markdown editor with live preview',
        'Edit locks to prevent concurrent modifications',
        'Autosave with manual save option',
        'Inline image support',
        'Full markdown: headings, lists, tables, code blocks',
      ],
      shotAlt: 'Markdown editor with edit lock indicator',
    },
    {
      title: 'Libraries, folders & document types',
      body: 'Organise your documentation into libraries, browse by folder, classify by type. Use templates to kickstart new documents with predefined structure and content.',
      bullets: [
        'Multiple libraries for different knowledge domains',
        'Folder hierarchy for logical organisation',
        'Document types for classification and governance',
        'Templates grouped by type',
        'Browse, search and filter across all documents',
      ],
      shotAlt: 'Library tree with folders and document types',
    },
    {
      title: 'Review & approval workflows',
      body: 'Assign owners, authors, reviewers and approvers to documents. Submit documents for review, collect decision notes and track approval status. Editing is blocked during review to maintain integrity.',
      bullets: [
        'Owner, author, reviewer, approver roles',
        'Submit for review with one click',
        'Decision notes from reviewers and approvers',
        'Editing blocked during active review',
        'Approval status tracking and history',
      ],
      shotAlt: 'Document review panel with status chips',
    },
    {
      title: 'Connected documentation',
      body: 'Link documents to applications, assets, projects, requests and tasks. Access managed documents from other workspaces and distinguish between linked and related content for full traceability. The knowledge base is also what your agents quote: the source an agent draws from, and what it points to when it answers.',
      bullets: [
        'Relations to applications, assets, projects, requests, tasks',
        'Managed documents accessible from other workspaces',
        'Linked vs related distinction',
        'Bidirectional navigation between documents and entities',
        'Full audit trail of relation changes',
      ],
      shotAlt: 'Document with linked entities sidebar',
    },
  ],
  more: {
    title: 'More in knowledge',
    items: [
      { title: 'Version history', body: 'Every save creates a version. Browse history and revert to any prior state.' },
      { title: 'Export', body: 'Export to PDF, DOCX and ODT. Share documentation outside Kadratis.' },
      { title: 'Templates', body: 'Reusable document starters grouped by type. Kickstart new docs quickly.' },
      { title: 'Import', body: 'Import from Word and PDF. Bring existing documentation into Kadratis in one click.' },
    ],
  },
  crossLinks: {
    label: 'Explore the platform',
    links: [
      { label: 'Agents', href: '/features/agents' },
      { label: 'Kad, AI assistant', href: '/features/ai' },
      { label: 'Budget management', href: '/features/budget' },
      { label: 'IT landscape', href: '/features/it-landscape' },
      { label: 'Portfolio management', href: '/features/portfolio' },
    ],
  },
  cta: {
    title: 'Ready to govern your IT documentation?',
    body: 'Self-host for free, or try hosted cloud. All features on every plan.',
    primary: 'Deploy free',
    secondary: 'Try hosted cloud',
  },
};

export default content;
