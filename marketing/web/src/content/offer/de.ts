import type { OfferContent } from './types';

const content: OfferContent = {
  meta: {
    title: 'Preise',
    description:
      'Kostenlos und Open Source. Selbsthosting ohne Limits, Support bei Bedarf oder Hosted KANAP. Alle Funktionen in jedem Plan, Agenten inklusive. AGPL v3.',
  },

  header: {
    eyebrow: 'Einfache, transparente Preise',
    title: 'Kostenlos und Open Source.\nSelbst hosten oder von uns betreiben lassen.',
    lead: 'Alle Funktionen in jedem Plan. Keine Feature-Gates, keine Sitzplatzsteuer, kein Lock-in. Sie zahlen nur für Betrieb und Support, die Sie nicht selbst übernehmen möchten.',
  },

  selfHosted: {
    eyebrow: 'Wählen Sie Ihren Weg',
    title: 'Dasselbe Produkt.\nDrei Betriebsarten.',
    intro:
      'Starten Sie mit der vollständigen Open-Source-Plattform. Ergänzen Sie Produktionssupport, wenn Souveränität zählt, oder wählen Sie Hosted KANAP, wenn wir den Betrieb übernehmen sollen.',
    plans: [
      {
        name: 'Self-Hosted',
        badge: 'Open Source',
        target: 'Unbegrenzte Nutzer · unbegrenzte Workspaces',
        price: '0 €',
        period: '',
        subPrice: 'Für immer kostenlos',
        features: [
          'Voller Funktionsumfang, keine Limits',
          'Plaid und Agenten enthalten, kein KI-Feature-Gate',
          'Ihr eigener LLM-Schlüssel für Plaid und Agenten',
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
        target: 'Unbegrenzte Nutzer · unbegrenzte Workspaces',
        price: '2.490 €',
        period: '/Jahr',
        subPrice: 'Jährliche Abrechnung',
        features: [
          'Alles aus Self-Hosted',
          'Prioritärer E-Mail-Support',
          'Unterstützung bei Installation und Upgrades',
          'Direkte Linie zum Team für Produktionsprobleme',
          '60-min Kickoff-Call mit einem KANAP-Experten',
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
      'Der komplette Quellcode von KANAP liegt auf GitHub. Lesen, prüfen, erweitern, beitragen. Die AGPL v3 sorgt dafür, dass der Code offen bleibt, für alle. Keine proprietären Forks, kein Lock-in.',
    linkLabel: 'Lizenz lesen',
    linkHref: 'https://www.gnu.org/licenses/agpl-3.0.html',
  },

  cloud: {
    eyebrow: 'Cloud · wenn wir es für Sie betreiben sollen',
    title: 'Dieselbe Plattform, von uns betrieben.',
    intro:
      'Hosted KANAP ist dieselbe Open-Source-Plattform, von uns betrieben: Hosting, Updates, Backups, prioritärer Support und ein 60-minütiger Kickoff-Call. 14 Tage Test, keine Kreditkarte.',
    plans: [
      {
        name: 'Hosted KANAP',
        badge: 'Fully managed',
        target: 'Unbegrenzte Nutzer · unbegrenzte Workspaces',
        price: '249 €',
        period: '/Mon',
        subPrice: 'oder 2.490 €/Jahr (2 Monate gratis)',
        features: [
          'Alles aus Self-Hosted',
          'Wir hosten, aktualisieren und sichern KANAP für Sie',
          'EU-Hosting für europäische Teams',
          '1.500 Plaid-Nachrichten/Mon enthalten oder eigener Schlüssel ohne Limit',
          '60-min Kickoff-Call mit einem KANAP-Experten',
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
        body: 'Sie haben IT-Kapazität und wollen volle Kontrolle. Bestes Preis-Leistungs-Verhältnis ohne Haken. Community-Support.',
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
    title: 'Expertenhilfe, wenn Sie sie wollen',
    intro: 'KANAP ist für selbstständige Einführung gebaut. Wenn Sie schneller vorankommen möchten, enthalten bezahlte Angebote prioritären Support und einen reduzierten Beratungstarif.',
    support: {
      title: 'Prioritärer Support',
      subtitle: 'In jedem kostenpflichtigen Plan enthalten',
      body: 'Wir halten alles am Laufen. Echte Menschen, faire Reaktionszeiten, kein SLA-Theater.',
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
      body: 'Durchgeführt von einem erfahrenen CIO, der Ihre Herausforderungen aus eigener Praxis kennt. Optionale Hilfe, um mehr Wert aus KANAP zu ziehen: geplante Calls, tiefergehende Arbeit, Advisory, Funktionen nach Maß. Tarif: 1.150 € pro Tag, 900 € für Kunden mit Support- oder Hosting-Vertrag.',
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
    body: 'Ein Engagement, das Ihr Team auf KANAP startet: Wir richten die Plattform mit Ihnen ein, importieren Ihre Daten, schulen Ihr Team, und am Ende arbeitet Ihr erster Agent.',
    items: [
      'Installation auf Ihren Servern oder Einrichtung in der Hosted Cloud',
      'Wir helfen beim Import Ihrer ersten Schlüsseldaten',
      'Schulung und Onboarding Ihres Teams',
      'Konfiguration von Plaid und Agenten',
      'Einrichtung der Integrationen (Entra ID, Claude oder ChatGPT, NetBox…)',
    ],
    ctaLabel: 'Sprechen Sie mit uns',
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
    errorGeneric: 'Die Rechnungsanfrage konnte nicht gesendet werden. Bitte erneut versuchen oder support@kanap.net kontaktieren.',
    errorRequired: 'Bitte füllen Sie alle Pflichtfelder aus.',
    errorVatRequired: 'Geben Sie Ihre USt-IdNr. ein. Sie ist für Unternehmen in der Europäischen Union erforderlich.',
    errorVatInvalid: 'Diese USt-IdNr. entspricht nicht dem Format des gewählten Landes.',
    errorTerms: 'Akzeptieren Sie die Allgemeinen Geschäftsbedingungen, um die Rechnung anzufordern.',
    closeLabel: 'Formular schließen',
  },

  faqTeaser: {
    title: 'Häufige Fragen',
    body: 'Lizenz, Self-Hosting, Cloud, Plaid, Support und Abrechnung. Hier sind alle Antworten.',
    ctaLabel: 'FAQ lesen',
  },

  cta: {
    title: 'Bereit loszulegen?',
    body:
      'Stellen Sie KANAP kostenlos selbst bereit oder testen Sie die gehostete Version, wenn wir den Betrieb übernehmen sollen.',
    primary: 'Kostenlos bereitstellen',
    secondary: 'Hosted Cloud testen',
  },
};

export default content;
