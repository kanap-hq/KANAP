import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Kad, KI-Assistent für IT-Governance',
    description:
      'Fragen Sie Kad zu Ihren IT-Daten. Dokumente erstellen, Aufgaben aktualisieren, Kadratis mit einem Klick zu Claude hinzufügen. Nutzung in Kadratis Cloud enthalten. Open Source.',
  },
  header: {
    eyebrow: 'Kad · KI-Assistent',
    title: 'Fragen Sie Kadratis alles über Ihre IT.',
    lead: 'Kad antwortet über Ihr Budget, Ihre Anwendungen, Projekte und Dokumentation hinweg und nimmt Änderungen vor, wenn Sie darum bitten. Jeder Schreibvorgang wird Ihnen gezeigt, bevor er ausgeführt wird. Nutzen Sie ihn in Kadratis, oder fügen Sie Kadratis mit seiner Adresse und einem Klick zu Claude hinzu.',
  },
  sections: [
    {
      title: 'Alles suchen & abfragen',
      body: 'Fragen Sie Kad zu Ihren Anwendungen, Servern, Verträgen, Budgetposten, Projekten, Aufgaben oder Dokumenten. Sofortige Antworten mit strukturierten Daten, statt vager Zusammenfassungen.',
      bullets: [
        'Modulübergreifende Suche über alle Bereiche',
        'Strukturierte Abfragen mit Filtern und Sortierung',
        'Aggregationen und Statistiken',
        'Volltextsuche in der Wissensdatenbank',
      ],
      shotAlt: 'Kad antwortet mit einer Tabelle: die Verträge, über die in 90 Tagen zu entscheiden ist, und die Anwendungen, die sie abdecken',
    },
    {
      title: 'Aktionen mit Vorschau',
      body: 'Kad liest nicht nur, er schreibt auch. Er kann Inhalte für Sie erstellen und aktualisieren, und jede Schreiboperation wird vor der Anwendung in der Vorschau gezeigt.',
      bullets: [
        'Dokumente mit Markdown erstellen und bearbeiten',
        'Projekt-Briefings und Zusammenfassungen verfassen',
        'Aufgaben aktualisieren: Status, Zuweisungen, Kommentare',
        'Änderungen vor der Anwendung in der Vorschau sehen',
      ],
      shotAlt: 'Kad bereitet zwei Änderungen an einer Aufgabe als Vorschau vor, mit Genehmigen und Ablehnen',
    },
    {
      title: 'Kadratis mit einem Klick zu Claude hinzufügen',
      body: 'Fügen Sie Ihre Kadratis-Adresse in Claude als benutzerdefinierten Konnektor ein, melden Sie sich an, klicken Sie auf Zulassen. Claude antwortet dann aus Ihrem Budget, Ihren Anwendungen, Projekten und Dokumenten. Es gibt keinen Schlüssel zu erstellen oder zu kopieren. Das funktioniert in Claude, Claude Desktop und Claude Code.',
      bullets: [
        'Jede Person meldet sich mit ihrem eigenen Kadratis-Konto an',
        'Schreibgeschützt, im Rahmen der Rechte dieser Person',
        'Jeder Benutzer sieht seine verbundenen Apps und trennt sie mit einem Klick',
        'API-Schlüssel bleiben für Skripte und andere MCP-Clients verfügbar',
      ],
      shotAlt: 'Claude erstellt aus den Kadratis-Daten eine PowerPoint-Folie: Budget 2026 für externe FTE und durchschnittliche Kosten pro Tag, je Lieferant',
    },
    {
      title: 'Volle Kontrolle & Compliance',
      body: 'Kad respektiert die Regeln Ihrer Organisation. Jede Aktion unterliegt den Berechtigungen des Nutzers. Administratoren haben vollständige Kontrolle darüber, was Kad darf und was nicht.',
      bullets: [
        'Vollständige Einhaltung der Nutzerrechte bei jeder Abfrage',
        'MCP-Verbindungen und -Schlüssel folgen den Rechten jedes Benutzers und lassen sich jederzeit trennen',
        'Websuche kann unabhängig aktiviert oder deaktiviert werden',
        'Vorschau und Bestätigung für alle Schreiboperationen',
        'Nur-Lese-Zugriff über Rollen für vorsichtige Rollouts',
      ],
      shotAlt: 'Kad-Einstellungen: Chat und MCP aktiv, enthaltenes Modell und Verarbeitungsort bestätigt, Nutzung des Monats',
    },
  ],
  more: {
    title: 'Was Sie Kad fragen können',
    items: [
      { title: '„Wie steht es um Projekt Atlas?"', body: 'Kad zieht das Projekt, seine Aufgaben, den Zeitplan, das Team und liefert ein prägnantes Status-Briefing mit Blockern und bevorstehenden Meilensteinen.' },
      { title: '„Liste Anwendungen auf AWS ohne Owner"', body: 'Strukturierte Abfrage über Ihre IT-Landschaft. Gefilterte, sortierte Ergebnisse aus Live-Daten.' },
      { title: '„Entwirf eine Security-Policy für Fernzugriff"', body: 'Kad erstellt ein neues Dokument in Ihrer Wissensdatenbank, mit korrekten Metadaten und Markdown-Inhalt.' },
      { title: '„Welche Verträge laufen in 90 Tagen aus?"', body: 'Sofortige Antwort mit Lieferantennamen, Beträgen und Verlängerungsdaten. Kein Navigieren durch Dashboards nötig.' },
    ],
  },
  crossLinks: {
    label: 'Andere Module entdecken',
    links: [
      { label: 'Agenten, für Arbeit, die von selbst läuft', href: '/features/agents' },
      { label: 'Sicherheit', href: '/security' },
      { label: 'Budget-Management', href: '/features/budget' },
      { label: 'IT-Landschaft', href: '/features/it-landscape' },
      { label: 'Portfolio-Management', href: '/features/portfolio' },
      { label: 'Wissen', href: '/features/knowledge' },
    ],
  },
  cta: {
    title: 'KI-gestützte IT-Governance beginnt hier.',
    body: 'Kad ist in jedem Kadratis-Arbeitsbereich enthalten, mit großzügiger Nutzung in Kadratis Cloud. Kostenlos selbst hosten oder Kadratis Cloud testen.',
    primary: 'Kostenlos bereitstellen',
    secondary: 'Kadratis Cloud testen',
  },
};

export default content;
