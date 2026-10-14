import type { FeaturesHubContent } from '../features/types';

const content: FeaturesHubContent = {
  meta: {
    title: 'Wie IT-Teams KANAP wirklich nutzen',
    description:
      'Sechs Szenarien von den Menschen, die IT täglich am Laufen halten, vom CIO über den Support bis zur IT-Betriebsleitung. Sehen Sie, wie die Module sich kombinieren und wie Agenten jetzt die wiederkehrende Last übernehmen.',
  },
  header: {
    eyebrow: 'Nach Rolle',
    title: 'Wie IT-Teams KANAP wirklich nutzen.',
    lead: 'Sechs Szenarien von Menschen, die IT täglich am Laufen halten. Sie greifen auf einen zentralen Datenbestand zu, bearbeiten ihn über Plaid in Alltagssprache und übergeben die wiederkehrenden Teile jetzt einem Agenten. Sehen Sie, wie die Module sich kombinieren, nicht nur, was jedes für sich tut.',
  },
  modulesUsedLabel: 'Module kombiniert',
  personas: [
    {
      role: 'CIO / IT-Leitung',
      headline: 'Verteidigen Sie das IT-Budget im Vorstand.',
      body:
        'Ihr CFO fragt, warum die IT-Kosten um 12 % gestiegen sind. Sie kommen mit den Zahlen: ein Chargeback-Bericht nach Gesellschaft und Abteilung, OPEX und CAPEX nebeneinander, nach Analysedimension, der Mehrjahrestrend. Jede Zeile lässt sich auf einen Vertrag oder ein Projekt zurückführen. Keine Excel-Akrobatik, kein „Ich melde mich".',
      outcome: 'Gehen Sie mit den Antworten ins Budget-Review.',
      modules: [
        { slug: 'budget', label: 'Budget' },
        { slug: 'it-landscape', label: 'IT-Landschaft' },
      ],
      shotAlt: 'Die 10 größten OPEX-Zeilen des Budgets 2026 als Kreisdiagramm',
    },
    {
      role: 'Unternehmensarchitekt',
      headline: 'Planen Sie eine Migration ohne Überraschungen.',
      body:
        'Sie schalten das alte CRM ab. Bevor Sie Termine zusagen, müssen Sie wissen, was davon abhängt: welche Schnittstellen, welche nachgelagerten Apps, welche Projekte es bereits berühren. Die Schnittstellenkarte zeigt den Abhängigkeitsgraph auf einen Blick. Ihr Migrationsplan listet jeden Schnittstellen-Eigentümer, jedes betroffene Projekt. Wissen verknüpft die Entscheidungen mit den Anwendungen, die sie beschreiben. Ihre Nachfolgerin wird wissen, warum.',
      outcome: 'Migrieren Sie mit offenen Augen statt mit gekreuzten Fingern.',
      modules: [
        { slug: 'it-landscape', label: 'IT-Landschaft' },
        { slug: 'knowledge', label: 'Wissen' },
        { slug: 'portfolio', label: 'Portfolio' },
      ],
      shotAlt: 'Schnittstellenkarte mit den Abhängigkeiten des abzuschaltenden CRM',
    },
    {
      role: 'PMO-Leitung / IT-Projektmanager',
      headline: 'Planen Sie das Quartal mit Kapazitätszahlen.',
      body:
        'Zwanzig eingehende Anfragen, acht Teams, ein Quartal. Bewerten Sie jede Anfrage anhand gewichteter Kriterien und erstellen Sie eine kapazitätsbewusste Roadmap. Engpässe sind sichtbar, bevor Sie zusagen. Termine sind kein Wunschdenken. Sie sind Mathematik. Im Steering Committee erklären Sie, warum dieses Projekt in Q3 statt Q1 liegt: Kapazität im Plattform-Team.',
      outcome: 'Sagen Sie Termine zu, die Sie wirklich verteidigen können.',
      modules: [
        { slug: 'portfolio', label: 'Portfolio' },
        { slug: 'budget', label: 'Budget' },
      ],
      shotAlt: 'Kapazitätsbewusste Roadmap mit Engpass-Heatmap',
    },
    {
      role: 'IT-Operations / Support',
      headline: 'Die Ursache in Sekunden finden, nicht in Stunden.',
      body:
        'Die Auftragsverwaltung in der Produktion ist langsam. Sie fragen Plaid: „Welche Apps nutzen die order-management-API?" Fünf Sekunden später, eine Liste. „Welche davon wurden diese Woche aktualisiert?" Eine. „Wer ist verantwortlich?" E-Mail und Teams. Vom Symptom zur Verantwortlichkeit, ohne fünf Tools zu öffnen. Die First-Line-Tickets, die sich jede Woche wiederholen, gehen jetzt an einen Agenten, sodass Ihr Team nur das übernimmt, was einen Menschen braucht.',
      outcome: 'Lösen Sie Vorfälle von einem Ort aus, während ein Agent die wiederkehrenden Tickets abarbeitet.',
      modules: [
        { slug: 'it-landscape', label: 'IT-Landschaft' },
        { slug: 'knowledge', label: 'Wissen' },
        { slug: 'ai', label: 'Plaid' },
        { slug: 'agents', label: 'Agenten' },
      ],
      shotAlt: 'Plaid beantwortet eine Ursachenforschung mit strukturierten Ergebnissen',
    },
    {
      role: 'IT-Lead / Infrastruktur-Leitung',
      headline: 'Finden Sie, was abzuschalten, zu verlängern und zusammenzuführen ist.',
      body:
        'Wie viele SaaS-Anwendungen bezahlen wir? Welche überlappen? Wer ist Eigentümer, wenn es um Verhandlungen geht? Jede Anwendung trägt ihre OPEX-Zeile, ihren Vertrag, ihr Verlängerungsdatum, ihre Datenklassifizierung. Sortieren nach Kosten, Überlappung, Nutzung. Führen Sie das Gespräch mit der Finanzabteilung mit Fakten vor sich.',
      outcome: 'Verlängern Sie nicht mehr, was niemand nutzt.',
      modules: [
        { slug: 'it-landscape', label: 'IT-Landschaft' },
        { slug: 'budget', label: 'Budget' },
        { slug: 'knowledge', label: 'Wissen' },
      ],
      shotAlt: 'Anwendungsportfolio nach OPEX sortiert mit Verlängerungsdaten',
    },
    {
      role: 'IT-Betriebsleitung',
      headline: 'Übergeben Sie die wiederkehrenden Tickets einem Agenten.',
      body:
        'Ihre First-Line-Queue ist jede Woche voll mit denselben Anfragen: Zugangs-Resets, wiederkehrende Vorfälle, Routine-Triage. Ein Agent übernimmt jede einzelne, liest sie gegen Ihre IT-Daten und schlägt die Lösung vor oder führt sie aus, unter der Autonomie, die Sie festlegen. Er arbeitet zunächst beaufsichtigt und gewinnt mehr Eigenständigkeit, solange seine Bilanz hält. Ihre Leute verbringen ihren Tag nicht mehr mit der wiederkehrenden Last.',
      outcome: 'Ihr Team verbringt seine Zeit mit den schwierigen Problemen, während der Agent die Routine abarbeitet.',
      modules: [
        { slug: 'agents', label: 'Agenten' },
        { slug: 'it-landscape', label: 'IT-Landschaft' },
        { slug: 'knowledge', label: 'Wissen' },
      ],
      shotAlt: 'Ein Agent, der eine Queue von First-Line-Tickets bearbeitet',
    },
  ],
  cta: {
    title: 'Bereit, Ihre Rolle auf der Plattform zu sehen?',
    body:
      'Starten Sie kostenlos mit Self-Hosting oder testen Sie die Hosted Cloud.\nAlle Funktionen in jedem Plan, Cloud wie Self-Hosting.',
    primary: 'Kostenlos bereitstellen',
    secondary: 'Hosted Cloud testen',
  },
};

export default content;
