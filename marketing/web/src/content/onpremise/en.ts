import type { OnPremContent } from './types';

const content: OnPremContent = {
  meta: {
    title: 'Self-host KANAP, the first-class citizen',
    description:
      'Run KANAP on your own infrastructure, under AGPL v3. Full platform including AI agents, unlimited users, and you decide where your data goes. Deploy in minutes with Docker Compose.',
  },

  header: {
    eyebrow: 'Self-hosting · first-class citizen',
    title: 'Run KANAP yourself.\nOwn every layer.',
    lead: 'Open source under AGPL v3. Deploy to your infrastructure, own your data, update on your cadence. The full platform, unlimited users, every feature, on your terms.',
    primaryCta: 'Deploy from GitHub',
    primaryHref: 'https://github.com/kanap-hq/kanap',
    secondaryCta: 'Read install docs',
    secondaryHref: 'https://doc.kanap.net/on-premise/',
  },

  why: {
    eyebrow: 'Why self-host',
    title: 'Control, compliance, and no strings attached.',
    intro:
      'Self-hosting KANAP is not a stripped-down tier. It\'s the full platform, with the full feature set, free of charge. These are the reasons teams pick it first.',
    pillars: [
      {
        title: 'Your data stays put',
        body: 'Budget figures, supplier contracts, IT landscape, everything. On your servers, in your network. No third-party data processor to trust with your governance data, except the services you choose to connect, such as an AI model provider or an email relay. The agent runtime and its actions run there too, which matters when an auditor asks.',
      },
      {
        title: 'Compliance-ready',
        body: 'Row-level security isolates tenants. Argon2 password hashing. An audit log of sign-ins and exports that your log collector reads as CSV. HTTPS with certificates you control. Your VPC, your backups, your SOC.',
      },
      {
        title: 'Air-gap friendly',
        body: 'Docker Compose deployment runs in restricted networks. You build the images from the public source, and once built they make no mandatory outbound calls for core functions.',
      },
      {
        title: 'Your cadence',
        body: 'Pin the version you run, test an update, migrate on your change-window schedule. No forced updates, no surprise downtime.',
      },
    ],
  },

  license: {
    title: 'AGPL v3: openness without compromise',
    body:
      'KANAP is released under the GNU Affero General Public License v3. You get every classic open source freedom: use it, read it, modify it, distribute it. The copyleft provision means anyone who runs a modified version as a service must share their changes, which is how the project stays genuinely open.',
    bullets: [
      'Use it commercially, internally, or externally, no royalty, no seat count',
      'Read and audit the full source, nothing hidden',
      'Modify and extend, the code is yours to shape',
      'Contribute back, your improvements benefit the whole community',
    ],
    linkLabel: 'Read the AGPL v3 license',
    linkHref: 'https://www.gnu.org/licenses/agpl-3.0.html',
  },

  deploy: {
    eyebrow: 'Install in minutes',
    title: 'One prompt.\nFifteen minutes.',
    intro:
      'A coding AI agent reads our documentation, installs every dependency, and configures the whole stack (Docker, PostgreSQL 16, MinIO, nginx, Let\'s Encrypt) on a clean Ubuntu server. You paste one prompt, confirm the steps, and log in.',
    steps: [
      {
        title: 'Prepare a clean server',
        body: 'A freshly provisioned Ubuntu 24.04 LTS host with sudo access, a DNS A record pointing your hostname at it, and outbound internet for packages and Let\'s Encrypt. Install your AI coding agent on the server (Claude Code, Codex, anything similar).',
      },
      {
        title: 'Grant temporary passwordless sudo',
        body: 'So the agent isn\'t prompted for your password on every step. You\'ll revert this at the end.',
        code: 'echo "$USER ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/90-install-nopasswd',
      },
      {
        title: 'Paste the install prompt',
        body: 'Open your agent and paste the prompt template from our docs, then fill in your hostname, admin email and (optionally) your email transport (Resend or SMTP). The agent reads the linked install pages, installs Docker, PostgreSQL 16 with the required extensions, MinIO, nginx and certbot, clones KANAP into /opt/kanap, generates strong credentials, builds the images and starts the containers. It also wires up TLS and auto-renewal. The agent asks for confirmation before running each command.',
      },
      {
        title: 'Sign in and harden',
        body: 'Log in at your hostname with the generated admin credentials, change the password, then remove the temporary passwordless sudo entry. Done. The full install log is saved at ~/kanap-install.md.',
      },
    ],
    docsCtaLabel: 'AI-assisted install guide',
    docsHref: 'https://doc.kanap.net/on-premise/installation-ai/',
    manualOption: {
      label: 'Prefer full control?',
      title: 'Manual install: your stack, your way.',
      body: 'Bring your own PostgreSQL, S3-compatible storage and reverse proxy. Run on any Docker-capable Linux. Slot KANAP into the architecture you already operate, with the configuration that fits your environment. Same platform, same code, every decision in your hands.',
      ctaLabel: 'Manual install guide',
      ctaHref: 'https://doc.kanap.net/on-premise/installation/',
    },
  },

  requirements: {
    title: 'What you\'ll need',
    intro: 'Modest requirements for a platform that runs the whole IT department.',
    items: [
      { label: 'OS', value: 'Any Linux with Docker (Ubuntu 22+, Debian 12+, RHEL 9+ recommended)' },
      { label: 'CPU', value: '2 vCPU minimum · 4+ recommended for 50+ users' },
      { label: 'RAM', value: '6 GB minimum · 8 GB recommended' },
      { label: 'Storage', value: '20 GB for the platform + whatever your data grows to, plus S3-compatible object storage' },
      { label: 'Database', value: 'PostgreSQL 16+ with citext, pgcrypto and uuid-ossp (you provide it)' },
      { label: 'Network', value: 'HTTPS terminator (your choice, nginx, Traefik, cloud LB)' },
      { label: 'Outbound (optional)', value: 'FX rate APIs (World Bank, exchangerate-api.com) · LLM provider for Plaid and agents · Microsoft Entra for SSO · Resend or your SMTP relay for email · Web search provider, if enabled' },
    ],
  },

  operations: {
    title: 'Operating KANAP',
    intro: 'Built to run like any other internal service.',
    items: [
      {
        title: 'Updates on your schedule',
        body: 'Pin the version you run, test an update in pre-prod, apply it in your change window. Migrations run on boot, idempotent by design.',
      },
      {
        title: 'Backups with your own tools',
        body: 'Standard PostgreSQL and file storage. Back them up with the pipeline you already run.',
      },
      {
        title: 'Observability you already have',
        body: 'Containers write logs to stdout (capped at about 50 MB each) and show their health in docker ps. The API exposes a health endpoint. Point your existing stack at them (Prometheus, Loki, Datadog, whatever you already run).',
      },
      {
        title: 'Branding included',
        body: 'Upload your logo, set your primary color. The admin branding page works the same in self-hosted as in cloud.',
      },
      {
        title: 'SSO via Entra ID',
        body: 'Enterprise SSO is part of the core platform. Add your Entra app registration to the configuration, then connect it from the admin console.',
      },
      {
        title: 'Plaid and agents, your way',
        body: 'Bring your own LLM key for both Plaid and your agents, OpenAI, Anthropic, Ollama, or any OpenAI-compatible endpoint. The agent runtime and its actions run inside your own deployment. The only content that leaves is what you send to the provider you chose, plus short web search queries if you turn web search on.',
      },
    ],
  },

  support: {
    title: 'Need priority help?',
    body:
      'The Self-Hosted Support plan adds priority email support, install troubleshooting, and 20% off consulting, without changing the deployment model.',
    bullets: [
      'Priority email support (real humans, best-effort response)',
      'Installation and upgrade troubleshooting',
      '20% discount on all consulting services',
      '€2,490/yr, annual billing',
    ],
    ctaLabel: 'See pricing',
    ctaHref: '/offer',
  },

  cta: {
    title: 'Ready to self-host?',
    body: 'Clone the repo and bring up the stack in under ten minutes. No account required, no trial countdown, just open source.',
    primary: 'Deploy from GitHub',
    secondary: 'Talk to us',
  },
};

export default content;
