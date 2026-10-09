import type { HomeContent } from './types';

const content: HomeContent = {
  meta: {
    title: 'IT-Budget, IT-Landschaft und Projekte, Open Source',
    description:
      'IT-Budget, Anwendungslandschaft, Projektportfolio und Dokumentation in einem Datenbestand, mit integriertem KI-Agenten. Open Source.',
  },

  hero: {
    eyebrow: 'Open Source · von einem CIO für CIOs entwickelt',
    title: 'IT-Budget, IT-Landschaft und Projekte in einem einzigen Datenbestand.',
    lead: 'Das IT-Budget verlässt die Tabellenkalkulation und wird mit dem verknüpft, was es begründet: Anwendungen, Verträge, Projekte. Landschaft, Portfolio und Dokumentation teilen dieselben Daten, und Plaid, der integrierte KI-Agent, antwortet über alles hinweg. Open Source, kostenlos selbst zu hosten.',
    primaryCta: 'Mit Beispieldaten testen',
    secondaryCta: 'Kostenlos bereitstellen',
    trialNote: 'Test der gehosteten Version · Beispieldaten in einer Minute geladen · AGPL v3, vollständiger Quellcode auf GitHub.',
  },

  layers: {
    eyebrow: 'IT-Budget',
    title: 'Das IT-Budget, raus aus Excel.',
    intro:
      'OPEX und CAPEX über mehrere Jahre, in Spalten, die Sie selbst benennen: Budget, Revision, erwartetes Jahresergebnis. Jede Version lässt sich kopieren, vergleichen und einfrieren. Schluss mit kopierten Reitern und kaputten Formeln.',
    items: [
      {
        title: 'Hochrechnung und Budget des Folgejahres',
        body: 'Festigen Sie die Hochrechnung Zeile für Zeile, kopieren Sie sie in das Budget des Folgejahres, passen Sie über Menge × Preis an und frieren Sie die genehmigte Version ein. Die Wechselkurse werden mit ihr festgeschrieben.',
      },
      {
        title: 'Leistungsverrechnung und Analyse',
        body: 'Verteilen Sie jede Zeile auf Gesellschaften, Abteilungen und Kostenstellen, verrechnen Sie mit klaren Regeln, analysieren Sie nach Analysedimension und konsolidieren Sie auf Ihrem Kontenplan.',
      },
      {
        title: 'Personal und Kosten pro FTE',
        body: 'Erfassen Sie FTE auf den betroffenen Zeilen: KANAP leitet daraus den monatlichen Personalbestand und die Kosten pro FTE ab, als Betrag oder als Tagessatz, direkt neben den Beträgen.',
      },
    ],
    outro: 'Und weil jede Zeile mit dem restlichen Datenbestand verknüpft ist, ist das Budget keine Liste von Beträgen mehr: Es ist die Landkarte dessen, was die IT betreibt.',
  },

  pillars: {
    eyebrow: 'Alles ist verknüpft',
    title: 'Ein Datenbestand statt Tabellenkalkulation, Wiki und Projekttool.',
    items: [
      {
        title: 'Eine Budgetzeile führt zu dem, was sie begründet.',
        body: 'Jede OPEX- oder CAPEX-Position ist mit ihren Anwendungen, Verträgen, Lieferanten und Projekten verknüpft. Sie wissen, wofür Sie zahlen, und warum.',
      },
      {
        title: 'Eine Anwendung zeigt, was sie kostet.',
        body: 'Ihr Datensatz vereint Umgebungen, Schnittstellen, Server, Verträge und Ausgaben: genug, um über eine Bereinigung auf Basis von Fakten zu entscheiden.',
      },
      {
        title: 'Ein Vertrag zeigt, wozu er verpflichtet.',
        body: 'Jahresbetrag, automatische Verlängerung, Kündigungsfrist, berechneter Kündigungstermin und verknüpfte Budgetzeilen: Verlängerungen werden vor der Frist vorbereitet, nicht danach.',
      },
    ],
  },

  modules: {
    eyebrow: 'Die gesamte IT-Governance',
    title: 'Vier Säulen, ein KI-Agent, dieselben Daten.',
    intro:
      'Jedes Modul funktioniert für sich: Beginnen Sie mit dem Budget und ergänzen Sie Landschaft, Portfolio oder Dokumentation, wenn Sie so weit sind. Alle arbeiten auf demselben Datenbestand.',
    items: [
      {
        slug: '/features/budget',
        title: 'IT-Budget',
        blurb:
          'Für den CIO und seine Partner im Finanzbereich. Mehrjahresbudget, Hochrechnung und Folgejahresbudget, Leistungsverrechnung, Konsolidierung, Personal. Zahlen, die Ihr CFO prüfen kann.',
        bullets: [
          'OPEX und CAPEX, Spalten für Budget, Revision und Hochrechnung',
          'Versionen kopieren und einfrieren',
          'Leistungsverrechnung, Analysedimensionen, Konsolidierung',
          'Monatlicher Personalbestand und Kosten pro FTE',
        ],
        ctaLabel: 'Budget entdecken',
      },
      {
        slug: '/features/it-landscape',
        title: 'IT-Landschaft',
        blurb:
          'Für Architekten, Anwendungsverantwortliche und Infrastrukturteams. Anwendungen, Schnittstellen und Server dokumentiert, und Karten, die die Landschaft auf einen Blick zeigen.',
        bullets: [
          'Anwendungen und Instanzen pro Umgebung',
          'Schnittstellen, Datenflüsse und Middleware',
          'Server und Infrastruktur, Import aus NetBox',
          'Interaktive Schnittstellen- und Verbindungskarten',
        ],
        ctaLabel: 'Landschaft entdecken',
      },
      {
        slug: '/features/portfolio',
        title: 'Projektportfolio',
        blurb:
          'Für Projektleiter und IT-Verantwortliche. Bewerten Sie Anfragen, planen Sie eine Roadmap, die die Kapazität berücksichtigt, und verfolgen Sie Projekte bis zur Lieferung.',
        bullets: [
          'Bewertung von Anfragen mit gewichteten Kriterien',
          'Kapazitätsbasierte Roadmap-Planung',
          'Engpass- und Auslastungsanalyse',
          'Projekte, Meilensteine und Aufgaben',
        ],
        ctaLabel: 'Portfolio entdecken',
      },
      {
        slug: '/features/knowledge',
        title: 'Dokumentation',
        blurb:
          'Für das ganze Team, zuerst für Support und Betrieb. Betriebshandbücher, Entscheidungen und Architekturnotizen, geprüft, versioniert und mit den beschriebenen Anwendungen und Projekten verknüpft.',
        bullets: [
          'Markdown-Editor mit Prüfablauf',
          'Bibliotheken, Ordner, Dokumenttypen',
          'Versionen und Export als PDF, DOCX, ODT',
          'Links zu Anwendungen, Projekten, Assets, Aufgaben',
        ],
        ctaLabel: 'Dokumentation entdecken',
      },
      {
        slug: '/features/ai',
        title: 'Plaid, der integrierte KI-Agent',
        blurb:
          'Für jede Rolle. Stellen Sie eine Frage in natürlicher Sprache zum Budget, zur Landschaft oder zu den Projekten: Plaid antwortet aus dem gesamten Datenbestand und bereitet Änderungen vor, die Sie freigeben.',
        bullets: [
          'Fragen in natürlicher Sprache über alle Module',
          'Änderungen als Vorschau, angewendet nach Freigabe',
          'Schreibgeschützter MCP-Server für Ihre KI-Clients',
          'Nutzung in der gehosteten Version inklusive, oder eigener Schlüssel',
        ],
        ctaLabel: 'Plaid entdecken',
      },
      {
        slug: '/features/agents',
        title: 'Helpdesk-Agent',
        blurb:
          'Für Support-Teams. Der Agent liest jedes Ticket Ihres Service Desks (heute GLPI) im Licht Ihrer Anwendungen und Dokumentation und schlägt eine Antwort, eine interne Notiz oder eine Ticketänderung vor.',
        bullets: [
          'Arbeitet mit Ihrem echten Datenbestand',
          'Jede Aktionsart beginnt mit Freigabe',
          'Automatisch, sobald die Erfahrung es rechtfertigt',
          'Jede Aktion protokolliert, Autonomie widerrufbar',
        ],
        ctaLabel: 'Agent entdecken',
      },
    ],
  },

  crossCutting: {
    eyebrow: 'Für Unternehmen gemacht',
    title: 'Ein System, unter Ihrer Kontrolle.',
    intro:
      'Die Module teilen dieselben Daten: Das gibt der IT echte Governance und erlaubt der KI zu helfen, ohne Ihre Umgebung zu gefährden.',
    items: [
      {
        title: 'Umfassende Beziehungen',
        body: 'Kosten verknüpft mit Anwendungen, Anwendungen mit Verträgen, Projekten und Servern, Dokumentation mit allem.',
      },
      {
        title: 'Berichte und Dashboards',
        body: 'Fertige Budgetberichte, Trends, Versionsvergleiche, Export als CSV und PNG.',
      },
      {
        title: 'Mehrere Gesellschaften und Währungen',
        body: 'Mehrere Gesellschaften, mehrere Währungen, beim Einfrieren festgeschriebene Kurse und Konsolidierung auf Ihrem Kontenplan.',
      },
      {
        title: 'Rollenbasierte Zugriffskontrolle',
        body: 'Feingranulare Berechtigungen pro Modul: Leser, Mitwirkender, Mitglied, Administrator.',
      },
      {
        title: 'Vollständiges Audit-Protokoll',
        body: 'Jede Änderung protokolliert, auch die über Plaid, mit Vorher und Nachher. Aktionen des Agenten haben einen eigenen Verlauf.',
      },
      {
        title: 'SSO mit Microsoft Entra ID',
        body: 'Single Sign-on für Unternehmen: eine Identität für die ganze Organisation.',
      },
    ],
  },

  vision: {
    eyebrow: 'KI auf einem vollständigen Datenbestand',
    title: 'KI, die hilft, weil alles an einem Ort ist.',
    body: 'Ein KI-Assistent ist nur so gut wie die Daten, die er sieht. In KANAP sieht er Budget, Anwendungen, Verträge, Projekte und Dokumentation zugleich und kann daher beantworten: „Warum läuft die Hochrechnung bei der Infrastruktur aus dem Ruder?“ oder „Welche Anwendungen hängen von diesem Vertrag ab?“.\nEr bereitet die Änderungen vor, Sie geben sie frei. Nichts ändert sich ohne Sie, und alles wird protokolliert.',
  },

  cta: {
    title: 'Führen Sie Ihre IT auf einem System, das Ihnen gehört.',
    body: 'Testen Sie die gehostete Version mit Beispieldaten oder stellen Sie KANAP kostenlos auf Ihren eigenen Servern bereit. Dasselbe Produkt, ohne eingeschränkte Funktionen.',
    primary: 'Mit Beispieldaten testen',
    secondary: 'Kostenlos bereitstellen',
  },
};

export default content;
