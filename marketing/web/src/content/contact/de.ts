import type { ContactContent } from './types';

const content: ContactContent = {
  meta: {
    title: 'Kontakt',
    description:
      'Melden Sie sich. Produkt-Demos, Fragen zum Deployment, Einkaufsabstimmung, Partnerschaften, Antwort innerhalb eines Werktags.',
  },
  header: {
    eyebrow: 'Kontakt',
    title: 'Wir freuen uns, von Ihnen zu hören.',
    lead: 'Demo, Deployment-Frage, Einkauf oder Partnerschaft, was immer Sie hierherführt, wir lesen jede Nachricht.',
  },
  responsePromise: 'Antwort innerhalb eines Werktags',
  highlightsLabel: 'Wobei wir helfen können',
  highlights: [
    'Produkt-Demos und Onboarding-Unterstützung',
    'Konnektor- und Agentenanfragen (sagen Sie uns, an welchem System ein Agent arbeiten soll)',
    'Einkaufs- und Abrechnungskoordination',
    'Beratung zu Self-Hosting-Installation und Upgrades',
    'Partnerschafts- und Integrationsanfragen',
  ],
  form: {
    nameLabel: 'Vollständiger Name',
    emailLabel: 'Geschäftliche E-Mail',
    companyLabel: 'Unternehmen',
    messageLabel: 'Wie können wir helfen?',
    messagePlaceholder: 'Erzählen Sie kurz, was Sie suchen.',
    captchaLabel: 'Sicherheitsprüfung',
    submitLabel: 'Nachricht senden',
    submitting: 'Wird gesendet…',
    successTitle: 'Nachricht gesendet.',
    successBody: 'Wir melden uns innerhalb eines Werktags.',
    errorGeneric: 'Etwas ist schiefgelaufen. Bitte erneut versuchen oder direkt an support@kanap.net schreiben.',
  },
  alternate: {
    label: 'Lieber direkt per E-Mail?',
    email: 'admin@kanap.net',
  },
};

export default content;
