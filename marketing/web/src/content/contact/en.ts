import type { ContactContent } from './types';

const content: ContactContent = {
  meta: {
    title: 'Contact',
    description:
      'Get in touch. Product demos, deployment questions, procurement coordination, partnerships. We respond within one business day.',
  },
  header: {
    eyebrow: 'Contact',
    title: 'We\'d love to hear from you.',
    lead: 'Demo, deployment question, procurement or partnership, whatever brings you here, we read every message.',
  },
  responsePromise: 'Reply within one business day',
  highlightsLabel: 'What we can help with',
  highlights: [
    'Product demos and onboarding guidance',
    'Connector and agent requests (tell us which system you need an agent to work)',
    'Procurement and billing coordination',
    'Self-hosting install and upgrade advice',
    'Partnership and integration inquiries',
  ],
  form: {
    nameLabel: 'Full name',
    emailLabel: 'Work email',
    companyLabel: 'Company',
    messageLabel: 'How can we help?',
    messagePlaceholder: 'Tell us a bit about what you\'re looking for.',
    captchaLabel: 'Security check',
    submitLabel: 'Send message',
    submitting: 'Sending…',
    successTitle: 'Message sent.',
    successBody: 'We\'ll get back to you within one business day.',
    errorGeneric: 'Something went wrong. Please try again or email support@kanap.net directly.',
  },
  alternate: {
    label: 'Prefer plain email?',
    email: 'admin@kanap.net',
  },
};

export default content;
