import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Wissensmanagement',
    description:
      'Markdown-Editor mit Bibliotheken, Ordnern, Review-Workflows, Versionshistorie und Export nach PDF / DOCX / ODT. Direkte Verknüpfungen zu Apps, Projekten, Assets, Aufgaben. Open Source.',
  },
  header: {
    eyebrow: 'Wissen',
    title: 'Ihre IT-Dokumentation, mit allem verbunden.',
    lead: 'Markdown-basierte Dokumenten-Governance mit strukturierten Bibliotheken, Review-Workflows und tiefer Integration mit Ihren Anwendungen, Assets, Projekten und Aufgaben.',
  },
  sections: [
    {
      title: 'Markdown-Editor mit Governance',
      body: 'Schreiben und pflegen Sie IT-Dokumentation mit einem leistungsstarken Markdown-Editor. Edit Locks verhindern gleichzeitige Änderungen, Autosave sorgt dafür, dass nichts verloren geht. Bilder inline einbetten und mit vollem Markdown-Umfang formatieren.',
      bullets: [
        'Leistungsstarker Markdown-Editor mit Live-Vorschau',
        'Edit Locks verhindern gleichzeitige Änderungen',
        'Autosave mit manueller Speicheroption',
        'Unterstützung für Inline-Bilder',
        'Voller Markdown-Umfang: Überschriften, Listen, Tabellen, Code-Blöcke',
      ],
      shotAlt: 'Markdown-Editor mit Edit-Lock-Anzeige',
    },
    {
      title: 'Bibliotheken, Ordner & Dokumenttypen',
      body: 'Organisieren Sie Ihre Dokumentation in Bibliotheken, navigieren Sie nach Ordnern, klassifizieren Sie nach Typ. Nutzen Sie Vorlagen, um neue Dokumente mit vordefinierter Struktur und Inhalt zu starten.',
      bullets: [
        'Mehrere Bibliotheken für unterschiedliche Wissensdomänen',
        'Ordnerhierarchie für logische Ablage',
        'Dokumenttypen für Klassifizierung und Governance',
        'Vorlagen nach Typ gruppiert',
        'Durchsuchen, suchen und filtern über alle Dokumente hinweg',
      ],
      shotAlt: 'Bibliotheksbaum mit Ordnern und Dokumenttypen',
    },
    {
      title: 'Review- & Freigabe-Workflows',
      body: 'Weisen Sie Dokumenten Owner, Autoren, Reviewer und Freigeber zu. Dokumente zur Prüfung einreichen, Entscheidungsnotizen sammeln und den Freigabestatus verfolgen. Während des Reviews ist die Bearbeitung gesperrt, um die Integrität zu wahren.',
      bullets: [
        'Rollen: Owner, Autor, Reviewer, Freigeber',
        'Zur Prüfung einreichen mit einem Klick',
        'Entscheidungsnotizen von Reviewern und Freigebern',
        'Bearbeitung während laufendem Review gesperrt',
        'Freigabestatus-Tracking und Historie',
      ],
      shotAlt: 'Dokumenten-Review-Panel mit Status-Chips',
    },
    {
      title: 'Vernetzte Dokumentation',
      body: 'Verknüpfen Sie Dokumente mit Anwendungen, Assets, Projekten, Anfragen und Aufgaben. Greifen Sie auf verwaltete Dokumente aus anderen Workspaces zu und unterscheiden Sie zwischen verlinkten und verwandten Inhalten, für volle Nachvollziehbarkeit. Die Wissensdatenbank ist auch das, was Ihre Agenten zitieren: die Quelle, aus der ein Agent schöpft, und worauf er verweist, wenn er antwortet.',
      bullets: [
        'Relationen zu Anwendungen, Assets, Projekten, Anfragen, Aufgaben',
        'Verwaltete Dokumente aus anderen Workspaces zugänglich',
        'Unterscheidung zwischen verlinkt und verwandt',
        'Bidirektionale Navigation zwischen Dokumenten und Entitäten',
        'Vollständiger Audit-Trail der Relationsänderungen',
      ],
      shotAlt: 'Dokument mit Sidebar der verlinkten Entitäten',
    },
  ],
  more: {
    title: 'Mehr in Wissen',
    items: [
      { title: 'Versionshistorie', body: 'Jeder Speichervorgang erzeugt eine Version. Historie durchstöbern und zu jedem früheren Stand zurückkehren.' },
      { title: 'Export', body: 'Export nach PDF, DOCX und ODT. Dokumentation auch außerhalb von Kadratis teilen.' },
      { title: 'Vorlagen', body: 'Wiederverwendbare Dokumentvorlagen nach Typ gruppiert. Neue Dokumente schnell starten.' },
      { title: 'Import', body: 'Import aus Word und PDF. Bestehende Dokumentation mit einem Klick in Kadratis übernehmen.' },
    ],
  },
  crossLinks: {
    label: 'Andere Module entdecken',
    links: [
      { label: 'Agenten', href: '/features/agents' },
      { label: 'Kad, KI-Assistent', href: '/features/ai' },
      { label: 'Budget-Management', href: '/features/budget' },
      { label: 'IT-Landschaft', href: '/features/it-landscape' },
      { label: 'Portfolio-Management', href: '/features/portfolio' },
    ],
  },
  cta: {
    title: 'Bereit, Ihre IT-Dokumentation zu steuern?',
    body: 'Hosten Sie kostenlos selbst oder testen Sie Kadratis Cloud. Alle Funktionen in jedem Plan.',
    primary: 'Kostenlos bereitstellen',
    secondary: 'Kadratis Cloud testen',
  },
};

export default content;
