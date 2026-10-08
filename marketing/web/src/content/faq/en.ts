import type { FaqContent } from './types';

const content: FaqContent = {
  meta: {
    title: 'FAQ',
    description: 'Common questions about KANAP pricing, licensing, self-hosting, hosted cloud, Plaid, agents, support and billing.',
  },
  header: {
    eyebrow: 'FAQ',
    title: 'Common questions.',
    lead: 'Everything you need to know about KANAP, licensing, pricing, hosting, Plaid and agents. If you don\'t find your answer, write to us.',
  },
  groups: [
    {
      label: 'Licensing & open source',
      items: [
        {
          q: 'What license is KANAP under?',
          a: 'KANAP is licensed under <a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="noopener" target="_blank">AGPL v3</a>, a widely recognised open source license approved by the OSI. You can freely use, modify and distribute the software. The AGPL copyleft clause ensures that anyone running a modified version as a service must share their changes. This protects the community and keeps KANAP genuinely open.',
        },
        {
          q: 'Can I use KANAP commercially?',
          a: 'Yes. Internal use, commercial use, external SaaS, all allowed. The copyleft provision only requires you to share modifications if you run a modified version as a network service. Pure internal use does not trigger any obligation.',
        },
        {
          q: 'Can I contribute to KANAP?',
          a: 'Yes, please. The full source is on <a href="https://github.com/kanap-hq/kanap" rel="noopener" target="_blank">GitHub</a>. Issues, pull requests and discussions are all welcome. See CONTRIBUTING.md for the guidelines.',
        },
      ],
    },
    {
      label: 'Cloud & trial',
      items: [
        {
          q: 'How does the free trial work?',
          a: 'Hosted KANAP starts with a 14-day free trial. No credit card required. Full access to all features, plus one free 60-minute activation session per company if booked during the trial.',
        },
        {
          q: 'What happens after my trial?',
          a: 'After your 14-day trial you must choose a paid plan to continue. Your tenant remains available for 30 more days with limited access. After this 30-day period your tenant is deleted.',
        },
        {
          q: 'What is the free activation session?',
          a: 'Each trial includes one free 60-minute activation session per company. After subscription we email you to book the call. The session is a video call focused on first-value milestones based on your main objectives.',
        },
        {
          q: 'What is the difference between cloud and self-hosted?',
          a: 'Cloud hosting means we run everything for you: hosting, updates, backups, infrastructure and priority support. Self-hosted means you run KANAP on your own servers. The full product is free to self-host; you can purchase Self-Hosted Support if you want priority help while keeping control of your infrastructure.',
        },
      ],
    },
    {
      label: 'Self-hosting & support',
      items: [
        {
          q: 'What is Self-Hosted Support?',
          a: 'Self-Hosted Support is a professional support add-on for self-hosted installations. It includes priority email support, install and upgrade troubleshooting, and a reduced consulting rate (€900 a day instead of €1,150). Priced at €2,490/yr.',
        },
        {
          q: 'How does priority support work?',
          a: 'For paying subscribers, email us about operational issues. We aim to respond within 24h and fix your problem. It\'s best-effort, no SLA, but we\'re real humans who read and respond to every message.',
        },
      ],
    },
    {
      label: 'Billing',
      items: [
        {
          q: 'Can I pay by invoice?',
          a: 'Invoice payment (bank transfer) is available for annual subscriptions above €1,000 for EUR customers. Today that means Self-Hosted Support and Hosted KANAP annual subscriptions. Invoices are NET30.',
        },
        {
          q: 'Can I switch between self-hosted and hosted?',
          a: 'Yes. KANAP is the same product in both modes. Contact us if you want to move from self-hosted to hosted, or if you need an export to operate the platform yourself.',
        },
        {
          q: 'Can I cancel my subscription?',
          a: 'Of course. Cancel from your Billing Center at any time, your subscription stays active until the end of the current billing period, no questions asked.',
        },
      ],
    },
    {
      label: 'Plaid (AI assistant)',
      items: [
        {
          q: 'What\'s the difference between included Plaid messages and Bring Your Own Key?',
          a: 'Hosted KANAP includes a generous number of Plaid messages, powered by a mid-range model we\'ve carefully selected and tested with KANAP. For even more capable responses, the Bring Your Own Key option lets you connect state-of-the-art models from OpenAI, Anthropic, or any compatible provider. BYOK also lets you choose the provider that processes your prompts, and removes any message limit.',
        },
        {
          q: 'How can I control Plaid?',
          a: 'At workspace level, an administrator turns Plaid on or off, and web search and MCP can be enabled or disabled separately. At user level, role-based permissions decide who can use Plaid and which modules it can read. Making a change needs member level on both Plaid and the module, and every change is shown as a preview that the user confirms. MCP access is read-only. RBAC is always enforced, Plaid never sees more than the user is allowed to.',
        },
      ],
    },
    {
      label: 'Agents (AI automation)',
      items: [
        {
          q: 'Are the agents autonomous?',
          a: 'Yes, by design. An agent starts supervised: it proposes actions and you review them. As KANAP measures how often it gets things right, you grant it more autonomy, until it handles routine work on its own and only escalates what needs a person. You decide how far that goes.',
        },
        {
          q: 'How do I control what an agent can do?',
          a: 'You set each agent\'s autonomy level and scope it to the operations you allow. Agents act only through defined operations, with no raw database or shell access. Every action is recorded, you can pause any agent immediately, and you can cap what an agent spends on the LLM.',
        },
        {
          q: 'Can I trust an agent with real work?',
          a: 'That is what the controls are for. An agent reasons over your own IT data rather than guessing, cites the sources it used, and records every action in its activity history. It earns autonomy by proving itself on real tasks, and you can stop it at any time.',
        },
        {
          q: 'Which tools do agents work with today?',
          a: 'Today, a service desk. One autonomous agent works a real service desk in production, which is what proves the model. The runtime is built to drive other systems, monitoring, virtualization, directory services and more, each behind a connector.',
        },
        {
          q: 'Can I write my own agent or connector?',
          a: 'Yes. The code is open, and an agent\'s reasoning is kept separate from how it talks to any given tool. You can write a connector for the system you need, or change how an agent works, because you have the full source. If you would rather we build a connector, contact us.',
        },
        {
          q: 'Are agents included in the free open-source version?',
          a: 'Yes. Agents are part of the open-source product under AGPL v3, with no AI feature gate. You bring your own LLM key, the same model as Plaid. Self-host the full platform for free, agents included.',
        },
        {
          q: 'What does it cost to run agents?',
          a: 'Agents use an LLM, so you bring your own key and pay your provider for what they use. KANAP itself is free to self-host. You keep cost predictable with a per-agent spend cap.',
        },
        {
          q: 'Do agent actions stay on my own servers?',
          a: 'On a self-hosted deployment, yes. The agent runtime and its actions happen inside your own deployment. The only ticket and document content that leaves it is what the agent sends to the LLM provider you choose, and nothing if you run the model on your own servers. If you turn on web search, short queries go to the search provider, with item references, identifiers and email addresses removed.',
        },
      ],
    },
  ],
  cta: {
    title: 'Still have questions?',
    body: 'Write to us, we read every message.',
    primary: 'Contact us',
    secondary: 'Start free trial',
  },
};

export default content;
