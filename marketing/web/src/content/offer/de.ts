import type { OfferContent } from './types';

const content: OfferContent = {
  meta: {
    title: 'Angebot',
    description:
      'Kostenlos und Open Source. Selbsthosting ohne Limits, Support bei Bedarf oder Kadratis Cloud. Alle Funktionen in jedem Plan, Agenten inklusive. AGPL v3.',
  },

  header: {
    eyebrow: 'Ein einfaches, transparentes Angebot',
    title: 'Kostenlos und Open Source.\nSelbst hosten oder von uns betreiben lassen.',
    lead: 'Alle Funktionen in jedem Plan. Keine Feature-Gates, keine Sitzplatzsteuer, kein Lock-in. Sie zahlen nur für Betrieb und Support, die Sie nicht selbst übernehmen möchten.',
  },

  selfHosted: {
    eyebrow: 'Wählen Sie Ihren Weg',
    title: 'Drei Wege, Kadratis zu nutzen',
    intro:
      'Starten Sie mit der vollständigen, selbst gehosteten Open-Source-Plattform. Ergänzen Sie Support, wenn Sie möchten, sobald Sie in Produktion gehen, oder wählen Sie die gehostete Version, wenn Sie uns den Betrieb lieber anvertrauen.',
    plans: [
      {
        name: 'Self-Hosted',
        badge: 'Open Source',
        target: 'Unbegrenzte Nutzer · unbegrenzte Arbeitsbereiche',
        price: '0 €',
        period: '',
        subPrice: 'Für immer kostenlos',
        features: [
          'Voller Funktionsumfang, keine Limits',
          'Kad und Agenten enthalten, kein KI-Feature-Gate',
          'Ihr eigener LLM-Schlüssel für Kad und Agenten',
          'Ihre Daten bleiben auf Ihrer Infrastruktur',
          'Docker-Compose-Deployment in Minuten',
          'Open Source unter AGPL v3',
          'Community-Support über GitHub Issues',
        ],
        ctaLabel: 'Von GitHub bereitstellen',
        ctaHref: 'https://github.com/kanap-hq/kanap',
        ctaVariant: 'primary',
      },
      {
        name: 'Self-Hosted Support',
        badge: 'On-Prem mit Produktionssupport',
        target: 'Unbegrenzte Nutzer · unbegrenzte Arbeitsbereiche',
        price: '2.490 €',
        period: '/Jahr',
        subPrice: 'Jährliche Abrechnung',
        features: [
          'Alles aus Self-Hosted',
          'Prioritärer E-Mail-Support',
          'Unterstützung bei Installation und Upgrades',
          'Direkte Linie zum Team für Produktionsprobleme',
          'Über 20 % Rabatt auf Beratung',
          'Unterstützt das Open-Source-Projekt',
        ],
        ctaLabel: 'Abonnieren',
        ctaHref: '#support-invoice',
        ctaVariant: 'primary',
      },
    ],
  },

  openSourceBanner: {
    title: 'Wirklich Open Source, AGPL v3',
    body:
      'Der komplette Quellcode von Kadratis liegt auf GitHub. Lesen, prüfen, erweitern, beitragen. Die AGPL v3 sorgt dafür, dass der Code offen bleibt, für alle. Keine proprietären Forks, kein Lock-in.',
    linkLabel: 'Lizenz lesen',
    linkHref: 'https://www.gnu.org/licenses/agpl-3.0.html',
  },

  cloud: {
    eyebrow: 'Cloud · wenn wir es für Sie betreiben sollen',
    title: 'Dieselbe Plattform, von uns betrieben.',
    intro:
      'Kadratis Cloud ist dieselbe Open-Source-Plattform, von uns betrieben: Hosting, Updates, Backups und prioritärer Support. 14 Tage Test, keine Kreditkarte, auf Wunsch mit einem Kennenlerngespräch von 30 Minuten.',
    plans: [
      {
        name: 'Kadratis Cloud',
        badge: 'Fully managed',
        target: 'Unbegrenzte Nutzer · unbegrenzte Arbeitsbereiche',
        price: '249 €',
        period: '/Mon',
        subPrice: 'oder 2.490 €/Jahr (2 Monate gratis)',
        features: [
          'Alles aus Self-Hosted',
          'Wir hosten, aktualisieren und sichern Kadratis für Sie',
          'EU-Hosting für europäische Teams',
          '1.500 Kad-Nachrichten/Mon enthalten oder eigener Schlüssel ohne Limit',
          'Prioritärer E-Mail-Support',
          'Über 20 % Rabatt auf Beratung',
          'Unterstützt das Open-Source-Projekt',
        ],
        ctaLabel: 'Testversion starten',
        ctaHref: '/trial/start',
        ctaVariant: 'primary',
      },
    ],
  },

  howToChoose: {
    title: 'Wie Sie wählen',
    intro: 'Wählen Sie danach, wer den Betrieb führt. Jeder Plan enthält alle Produktfunktionen.',
    items: [
      {
        title: 'Self-Hosted · kostenlos',
        body: 'Sie haben IT-Kapazität und wollen volle Kontrolle. Installieren Sie Kadratis in Ihrer Infrastruktur und nutzen Sie alle Funktionen. Community-Support.',
      },
      {
        title: 'Self-Hosted · mit Support',
        body: 'Sie brauchen das Selbsthosting-Modell wegen Souveränität, Compliance oder Datenschutz, möchten aber Produktionssupport und eine direkte Linie bei Problemen.',
      },
      {
        title: 'Cloud-Hosting',
        body: 'Sie wollen den schnellsten Weg zum Ergebnis, ohne Infrastruktur zu betreiben. Dasselbe Produkt, von KANAP betrieben.',
      },
    ],
  },

  services: {
    title: 'Expertise und Beratung in Ihrem Tempo',
    intro: 'Kadratis ist für selbstständige Einführung gebaut. Wenn Sie schneller vorankommen möchten, enthalten bezahlte Angebote prioritären Support und einen reduzierten Beratungstarif.',
    support: {
      title: 'Prioritärer Support',
      subtitle: 'In jedem kostenpflichtigen Plan enthalten',
      body: 'Wir sichern Ihnen einen hochwertigen Betriebssupport zu, ohne Chatbot, endlose Formulare oder Callcenter im Ausland.',
      items: [
        'Bugs, Fehler, Ausfälle, Zugriffsprobleme',
        'Hilfe bei On-Premise-Installation',
        'Fragen zu erwartetem Verhalten',
        'Schnelle Klarstellungen',
      ],
    },
    consulting: {
      title: 'Beratung',
      subtitle: 'Kostenpflichtig · Abrechnung pro Tag',
      body: 'Durchgeführt von einem erfahrenen CIO, der Ihre Herausforderungen aus eigener Praxis kennt. Optionale Hilfe, um mehr Wert aus Kadratis zu ziehen: geplante Calls, tiefergehende Arbeit, Advisory, Funktionen nach Maß. Tarif: 1.150 € pro Tag, 900 € für Kunden mit Support- oder Hosting-Vertrag.',
      items: [
        'Einrichtung, Konfiguration, Onboarding, Schulung',
        'Workflow-Design und Best Practices',
        'CIO-Advisory zu Ihrem IT-Governance-Modell',
        'Entwicklung spezifischer Funktionen für Ihren Bedarf',
        'Alles, was einen geplanten Call erfordert',
      ],
    },
  },

  pilot: {
    title: 'Begleiteter Pilot',
    subtitle: '2.900 € Festpreis',
    body: 'Ein Engagement, das Ihr Team auf Kadratis startet: Wir richten die Plattform mit Ihnen ein, importieren Ihre Daten, schulen Ihr Team, und am Ende arbeitet Ihr erster Agent.',
    items: [
      'Installation auf Ihren Servern oder Einrichtung in Kadratis Cloud',
      'Wir helfen beim Import Ihrer ersten Schlüsseldaten',
      'Schulung und Onboarding Ihres Teams',
      'Konfiguration von Kad und Agenten',
      'Einrichtung der Integrationen (Entra ID, Claude oder ChatGPT, NetBox…)',
    ],
    ctaLabel: 'Kontaktieren Sie uns',
    ctaHref: '/contact',
    note: 'Den Rahmen stecken wir vorab gemeinsam in einem 30-minütigen Gespräch ab.',
  },

  supportInvoice: {
    title: 'Rechnung anfordern',
    eyebrow: 'Self-Hosted Support',
    body:
      'Wir erstellen Ihre jährliche Self-Hosted-Support-Rechnung und senden sie an Ihre Rechnungs-E-Mail. Nach Zahlung erhalten Sie Zugriff auf professionelle Supportleistungen.',
    companyLabel: 'Firmenname',
    contactLabel: 'Kontaktperson',
    billingEmailLabel: 'Rechnungs-E-Mail',
    countryLabel: 'Land',
    vatLabel: 'USt-IdNr.',
    vatHelpEu: 'Pflichtangabe für Unternehmen in der Europäischen Union.',
    address1Label: 'Adresszeile 1',
    address2Label: 'Adresszeile 2 (optional)',
    cityLabel: 'Stadt',
    postalCodeLabel: 'Postleitzahl',
    termsAccept: 'Ich akzeptiere die',
    termsLink: 'Allgemeinen Geschäftsbedingungen',
    captchaLabel: 'Sicherheitsprüfung',
    submitLabel: 'Rechnung anfordern',
    submittingLabel: 'Rechnungsanfrage wird vorbereitet...',
    requiredHint: 'Mit * markierte Felder sind Pflichtfelder.',
    doneTitle: 'Rechnung angefordert',
    doneSent: 'Wir haben die Rechnung {number} an {email} gesendet.',
    doneSentNoNumber: 'Wir haben die Rechnung an {email} gesendet.',
    doneOpen: 'Sie können sie auch jetzt öffnen.',
    successLinkLabel: 'Rechnung öffnen',
    doneClose: 'Schließen',
    errorGeneric: 'Die Rechnungsanfrage konnte nicht gesendet werden. Bitte erneut versuchen oder contact@kadratis.com kontaktieren.',
    errorRequired: 'Bitte füllen Sie alle Pflichtfelder aus.',
    errorVatRequired: 'Geben Sie Ihre USt-IdNr. ein. Sie ist für Unternehmen in der Europäischen Union erforderlich.',
    errorVatInvalid: 'Diese USt-IdNr. entspricht nicht dem Format des gewählten Landes.',
    errorTerms: 'Akzeptieren Sie die Allgemeinen Geschäftsbedingungen, um die Rechnung anzufordern.',
    closeLabel: 'Formular schließen',
  },

  faqTeaser: {
    title: 'Häufige Fragen',
    body: 'Lizenz, Self-Hosting, Cloud, Kad, Support und Abrechnung. Hier sind alle Antworten.',
    ctaLabel: 'FAQ lesen',
  },

  cta: {
    title: 'Bereit loszulegen?',
    body:
      'Stellen Sie Kadratis kostenlos selbst bereit oder testen Sie die gehostete Version, wenn wir den Betrieb übernehmen sollen.',
    primary: 'Kostenlos bereitstellen',
    secondary: 'Kadratis Cloud testen',
  },
};

export default content;
