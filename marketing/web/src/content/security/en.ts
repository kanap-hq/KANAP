import type { SecurityContent } from './types';

const content: SecurityContent = {
  meta: {
    title: 'Security',
    description:
      'How KANAP protects your data: row-level security, hashed passwords, encrypted secrets, RBAC, audit trail, agent governance, SSO, and open source transparency. Self-host or cloud.',
  },
  header: {
    eyebrow: 'Security',
    title: 'Security that respects your data.',
    lead: 'Governance-grade controls from day one. The same platform runs on our cloud and on your own servers, with the same isolation, access control, auditability, and governance over what agents may do.',
  },
  overview: {
    title: 'Principles',
    intro:
      'KANAP is designed for IT departments that handle sensitive data. We treat your data the way we want IT vendors to treat ours, transparent, isolated, and within reach when you need it.',
    pillars: [
      {
        title: 'Transparent by default',
        body: 'The full source is on GitHub under AGPL v3. Your security team reads it, audits it, or forks it. Nothing is hidden behind proprietary binaries.',
      },
      {
        title: 'Isolated by design',
        body: 'Row-level security in the database itself enforces tenant isolation on every query the application runs.',
      },
      {
        title: 'Exportable, always',
        body: 'Your data is yours. CSV export on the main lists, document export to PDF, DOCX and ODT. No extraction tax.',
      },
    ],
  },
  tenancy: {
    title: 'Tenant isolation',
    body:
      'KANAP is multi-tenant at the database level. Every row in every shared table carries a `tenant_id`, and PostgreSQL Row-Level Security policies enforce the filter on every read and write. The policy is part of the database schema, so it applies to every query the application runs.',
    bullets: [
      'PostgreSQL RLS policies on every table that holds tenant data, all forced',
      '`tenant_id` filtering enforced at the database level, not just in the app',
      'The current tenant is set at the start of every database transaction, and the policies read it',
      'The application database role has no superuser or bypass rights, and the application refuses to start otherwise',
      'A table that holds tenant data without its isolation policy fails the CI tests',
      'Tenant isolation tests on every CI run',
    ],
  },
  dataProtection: {
    title: 'Data protection',
    body:
      'Standard practices, applied rigorously. Strong password hashing, encrypted secrets, hashed tokens, and HTTPS on every cloud connection.',
    bullets: [
      'Cloud: HTTPS for every connection between users and the platform, with HTTP redirected to HTTPS and Cloudflare terminating TLS in front of our servers. Self-hosted: you terminate TLS with your own certificates',
      'Argon2id password hashing (64 MiB memory cost) with per-user salts',
      'Secrets stored via environment, not checked into source',
      'Your own AI provider keys and integration credentials (GLPI, Netbox) encrypted at rest with AES-256-GCM',
      'MCP tokens and session refresh tokens stored hashed, and revocable',
      'Access tokens held in memory in the browser, refresh tokens in an HttpOnly cookie',
    ],
  },
  access: {
    title: 'Access control',
    body:
      'Fine-grained permissions per module, per role. Every feature gate and every entity query honours the same RBAC matrix, including Plaid and MCP.',
    bullets: [
      'Reader, contributor, member and admin levels per module',
      'Workspace-level admin role separate from module admins',
      'SSO via Microsoft Entra ID (OIDC) on both cloud and self-hosted',
      'Local password authentication with Argon2 + optional password reset flows',
      'Plaid and MCP enforce the same RBAC as the UI, no privilege escalation',
      'API tokens scoped to individual users, revocable at any time',
    ],
  },
  audit: {
    title: 'Audit trail',
    body:
      'Every meaningful change is recorded. Who changed what, when, with before and after snapshots. Activity is visible in the app.',
    bullets: [
      'Per-entity activity timeline (tasks, projects, documents, etc.)',
      'Create, update and disable actions logged with the user, the timestamp, and before and after values',
      'Administrators browse and filter the audit log in the app',
      'Changes made through Plaid are logged in the same trail, with their source. Agents keep their own activity history, with the sources each agent used',
    ],
  },
  agentGovernance: {
    title: 'Agent governance',
    body:
      'Agents act under the same controls as everything else, plus limits specific to autonomous work. Every agent action is recorded and scoped to what you allowed, and you can stop an agent at any moment. Every agent starts with each type of action waiting for your approval. You choose when a type runs automatically, with the agent\'s track record (reviewed proposals, acceptance rate, days of activity) shown beside the choice.',
    bullets: [
      'Agents act only through defined operations, with no raw database or shell access',
      'Each agent scoped to the operations you allow. Who can configure agents or review their work follows the same roles as the rest of the application',
      'Every agent action recorded in the agent\'s activity history, kept 30 days by default and configurable from 7 to 90 days',
      'Answers carry the sources the agent used, so a decision can be checked',
      'Pause any agent immediately, one at a time or across the board',
      'Per-agent spend caps keep running cost bounded',
      'AI features are off by default. On the cloud, the built-in model receives no data until the workspace has accepted its provider and processing location, both named in the application. An administrator confirms them, and a new confirmation is asked if either changes. You can use your own model provider instead',
    ],
  },
  deployment: {
    title: 'Deployment & operations',
    body:
      'Cloud deployments run on Linux hosts in Germany, in the European Union, with Cloudflare in front. Self-hosted deployments run wherever you choose. Both ship with the same security model.',
    bullets: [
      'Cloud hosting by Hetzner Online GmbH in Nuremberg, Germany (EU), with Cloudflare as CDN, TLS termination and protection in front',
      'Self-hosted: the full source is public, and you build and run it yourself with Docker Compose',
      'Self-hosted: no mandatory outbound calls for core functions, so KANAP can run without internet access',
      'Self-hosted: you choose where it runs and how it is backed up',
      'Self-hosted: AI features use only the model provider your administrator configures',
    ],
  },
  disclosure: {
    title: 'Responsible disclosure',
    body:
      'If you find a security issue, we want to know. Report it privately, preferably through GitHub private vulnerability reporting, or by email. Give us a reasonable window to fix, and we\'ll credit you in the advisory unless you prefer to stay anonymous.',
    emailLabel: 'security@kanap.net',
    email: 'security@kanap.net',
  },
  cta: {
    title: 'Questions about security?',
    body: 'We\'re happy to share architecture details and walk through a threat model with your security team.',
    primary: 'Talk to us',
    secondary: 'Self-host and audit the code',
  },
};

export default content;
