import type { OfferContent } from './types';

const content: OfferContent = {
  meta: {
    title: 'Pricing',
    description:
      'Free and open source. Self-host without limits, add support when you need it, or choose hosted KANAP. Every feature on every plan, agents included. AGPL v3.',
  },

  header: {
    eyebrow: 'Simple, transparent pricing',
    title: 'Free and open source.\nSelf-host, or let us run it.',
    lead: 'All features on every plan. No feature gates, no seat tax, no lock-in. Pay only for the operations and support you don\'t want to run yourself.',
  },

  /* -------------------- Self-hosted (primary) -------------------- */
  selfHosted: {
    eyebrow: 'Choose your path',
    title: 'Same product.\nThree ways to run it.',
    intro:
      'Start with the full open source platform. Add production support when sovereignty matters, or choose hosted KANAP when you want us to run the operations.',
    plans: [
      {
        name: 'Self-host',
        badge: 'Open source · Free forever',
        target: 'Unlimited users · unlimited workspaces',
        price: '€0',
        period: '',
        features: [
          'Full feature set, no caps',
          'Plaid and agents included, no AI feature gate',
          'Bring your own LLM key for Plaid and agents',
          'Your data stays on your infrastructure',
          'Deploy with Docker Compose in minutes',
          'Open source under AGPL v3',
          'Community support via GitHub issues',
        ],
        ctaLabel: 'Deploy from GitHub',
        ctaHref: 'https://github.com/kanap-hq/kanap',
        ctaVariant: 'primary',
        note: 'Plaid and agents use an LLM, so you bring your own key and pay your provider for usage. Cap per-agent spend to keep running cost predictable.',
      },
      {
        name: 'Self-hosted support',
        badge: 'On-prem with production support',
        target: 'Unlimited users · unlimited workspaces',
        price: '€2,490',
        period: '/yr',
        subPrice: 'Annual billing',
        features: [
          'Everything in self-host',
          'Your data stays on your infrastructure',
          'Priority email support',
          'Installation and upgrade assistance',
          'Direct line to the team for production issues',
          '60-min kickoff call with a KANAP expert',
          'Consulting at €900 a day instead of €1,150',
        ],
        ctaLabel: 'Subscribe',
        ctaHref: '#support-invoice',
        ctaVariant: 'primary',
      },
    ],
  },

  openSourceBanner: {
    title: 'Truly open source, AGPL v3',
    body:
      'KANAP\'s full source code is on GitHub. Read it, audit it, extend it, contribute back. AGPL v3 ensures the code stays open, for everyone. No proprietary forks, no lock-in.',
    linkLabel: 'Read the license',
    linkHref: 'https://www.gnu.org/licenses/agpl-3.0.html',
  },

  /* -------------------- Cloud hosted (secondary) -------------------- */
  cloud: {
    eyebrow: 'Cloud hosted · if you\'d rather we run it',
    title: 'Same platform, operated by us.',
    intro:
      'Hosted KANAP is the same open source platform, operated by us: hosting, updates, backups, priority support, and a 60-minute kickoff call. 14-day trial, no credit card.',
    plans: [
      {
        name: 'Hosted KANAP',
        badge: 'Fully managed',
        target: 'Unlimited users · unlimited workspaces',
        price: '€249',
        period: '/mo',
        subPrice: 'or €2,490/yr (2 months free)',
        features: [
          'Everything in self-host',
          'We host, update, and back up KANAP for you',
          'EU hosting for European teams',
          '2,500 Plaid messages/mo included, or bring your own key, unlimited',
          'Agents included, on the included messages or with your own LLM key',
          '60-min kickoff call with a KANAP expert',
          'Priority email support',
          'Consulting at €900 a day instead of €1,150',
        ],
        ctaLabel: 'Start free trial',
        ctaHref: '/trial/start',
        ctaVariant: 'primary',
      },
    ],
  },

  howToChoose: {
    title: 'How to choose',
    intro: 'Choose based on who runs the operations. All plans include every product feature.',
    items: [
      {
        title: 'Self-host · free',
        body: 'You have IT capacity and want full control. The best value, no strings attached. Community support.',
      },
      {
        title: 'Self-host · with support',
        body: 'You need the self-hosted deployment model for sovereignty, compliance, or privacy, but want production support and a direct line for issues.',
      },
      {
        title: 'Cloud hosted',
        body: 'You want the fastest path to value without running infrastructure. Same product, operated by KANAP.',
      },
    ],
  },

  services: {
    title: 'Expert help, when you want it',
    intro: 'KANAP is built for self-service adoption. If you want to go faster, paid plans include priority support and a reduced consulting rate.',
    support: {
      title: 'Priority support',
      subtitle: 'Included with any paid plan',
      body: 'Keep it running smoothly. Real humans, reasonable response times, no SLA theatre.',
      items: [
        'Bugs, errors, outages, access issues',
        'On-prem installation troubleshooting',
        '"Is this expected behaviour?" questions',
        'Quick clarifications',
      ],
    },
    consulting: {
      title: 'Consulting',
      subtitle: 'Paid · billed by the day',
      body: 'Optional help to get more value from KANAP: scheduled calls, deeper work, advisory. Rate: €1,150 a day, €900 for customers with a support or hosting plan, VAT excluded.',
      items: [
        'Setup, configuration, onboarding, training',
        'Workflow design and best practices',
        'CIO advisory on your IT governance model',
        'Anything that needs a scheduled call',
      ],
    },
  },

  pilot: {
    title: 'Guided pilot',
    subtitle: '€2,900 fixed · VAT excluded',
    body: 'One engagement that launches your team on KANAP: we set it up with you, bring your data in, train your people, and leave your first agent at work.',
    items: [
      'Installation on your servers, or hosted setup',
      'We help you import your first key data',
      'Team training and onboarding',
      'Your first agent configured',
    ],
    ctaLabel: 'Talk to us',
    ctaHref: '/contact',
    note: 'We scope it together on a 30-minute call first.',
  },

  supportInvoice: {
    title: 'Request your invoice',
    eyebrow: 'Self-hosted support',
    body:
      'We will create your annual Self-Hosted Support invoice and send it to your billing email. Upon payment, you get access to professional support services.',
    companyLabel: 'Company name',
    contactLabel: 'Contact name',
    billingEmailLabel: 'Billing email',
    countryLabel: 'Country',
    optionalSummary: 'Optional billing details',
    vatLabel: 'VAT ID',
    address1Label: 'Address line 1',
    address2Label: 'Address line 2',
    cityLabel: 'City',
    postalCodeLabel: 'Postal code',
    captchaLabel: 'Security check',
    submitLabel: 'Request invoice',
    submittingLabel: 'Preparing invoice request...',
    successWithLink: 'Invoice request submitted. We sent it to your billing email.',
    successLinkLabel: 'Open invoice',
    successNoLink: 'Invoice request submitted. Please check your billing email for invoice details.',
    errorGeneric: 'We could not submit your invoice request. Please try again or contact support@kanap.net.',
    errorRequired: 'Please fill in all required fields.',
    closeLabel: 'Close form',
  },

  faqTeaser: {
    title: 'Common questions',
    body: 'Licensing, self-hosting, cloud, Plaid, support and billing. All answered.',
    ctaLabel: 'Read the FAQ',
  },

  cta: {
    title: 'Ready to get started?',
    body:
      'Deploy KANAP yourself for free, or try the hosted version if you want us to operate it.',
    primary: 'Deploy free',
    secondary: 'Try hosted cloud',
  },
};

export default content;
