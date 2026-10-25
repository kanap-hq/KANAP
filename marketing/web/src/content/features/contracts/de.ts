import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'IT-Vertragsmanagement: Fristen, Verlängerungen, Budget',
    description:
      'Open-Source-IT-Vertragsmanagement: berechnete Kündigungstermine, Verlängerungsentscheidung vor jedem Termin, Verpflichtung gegen Budget, Konformitätsregister.',
  },
  header: {
    eyebrow: 'Verträge',
    title: 'Verpassen Sie nie wieder einen Kündigungstermin.',
    lead: 'Erfassen Sie Beginndatum, Laufzeit und Kündigungsfrist eines Vertrags: KANAP berechnet jede Periode und den letzten Tag für die Kündigung. Der Verantwortliche bekommt vor diesem Tag eine Entscheidung vorgelegt. Der Vertrag ist mit seinen Budgetzeilen, Anwendungen und Assets verknüpft.',
  },
  sections: [
    {
      title: 'Die Vertragsliste',
      body: 'Sie öffnet mit der nächsten Frist. Ein Schnellfilter zeigt die Verträge, deren Kündigungsfenster sich innerhalb des Entscheidungszeitraums schließt, standardmäßig neunzig Tage. Jede Zeile zeigt, wo der Vertrag steht: zu entscheiden, bis zu einem Datum verlängert, endet ohne Verlängerung oder abgelaufen.',
      bullets: [
        'Nach nächster Frist sortiert, mit der Zahl der verbleibenden Tage',
        'Schnellfilter: zu entscheiden, ohne Budgetzeile, unterbudgetiert',
        'Verpflichtet, Budget und Abweichung des Jahres, in Ihrer Berichtswährung',
        'Lieferant, Vertragsunternehmen, Verantwortlicher, Abrechnungsintervall',
        'CSV-Import und -Export',
      ],
      shotAlt: "Vertragsliste nach nächster Fälligkeit sortiert, mit Status, Verpflichtung, Budget und Abweichung",
    },
    {
      title: 'Die Berechnung der Fristen',
      body: 'Nichts wird doppelt erfasst. Aus Beginndatum, Laufzeit und Kündigungsfrist zeichnet die Vertragsseite alle vergangenen Perioden, die laufende und die nächste, mit dem heutigen Tag und dem Kündigungstermin auf derselben Linie.',
      bullets: [
        'Perioden, Verlängerungen und Kündigungstermin berechnet, nie gespeichert',
        'Stillschweigende Verlängerung an oder aus, mit eigener Bestätigung',
        'Ende der Gültigkeit für einen Vertrag, der endgültig ausläuft',
        'Notizen und Folgeaufgaben am Vertrag',
        'E-Mail-Erinnerungen an den Verantwortlichen 30, 14, 7 und 1 Tag vor der Frist',
      ],
      shotAlt: 'SAP-Wartungsvertrag mit seinen Perioden auf einer Zeitleiste und dem Kündigungstermin',
    },
    {
      title: 'Eine Entscheidung vor der Frist',
      body: 'Wenn sich das Entscheidungsfenster öffnet, legt KANAP eine Aufgabe für den Vertragsverantwortlichen an. Am Vertrag gibt es drei Antworten: verlängern, neu verhandeln oder kündigen. Bevor Sie eine Kündigung bestätigen, zeigt KANAP, was sie ändert: das durch die Kündigungsfrist mögliche Enddatum, die Verpflichtung dieses und des nächsten Jahres, die Anwendungen und Assets, die den Vertrag verlieren.',
      bullets: [
        'Entscheidungsfenster pro Tenant einstellbar, standardmäßig 90 Tage',
        'Eine Aufgabe für den Verantwortlichen, mit der üblichen Zuweisungs-E-Mail',
        'Verlängern, neu verhandeln oder kündigen, mit einer Begründung im Freitext',
        'Folgen vor der Bestätigung angezeigt',
        'Eine Entscheidung lässt sich bis zur Frist zurücknehmen',
      ],
      shotAlt: 'Kündigung eines Vertrags mit ihren Folgen für die Verpflichtung und die Anwendungen',
    },
    {
      title: 'Vertragliche Verpflichtung gegen Budget',
      body: 'Ein Vertrag verpflichtet Geld, das Budget plant es ein. Der Reiter Budget listet die mit dem Vertrag verknüpften OPEX- und CAPEX-Zeilen und vergleicht sie Jahr für Jahr mit dem, wozu der Vertrag verpflichtet. Sie sehen sofort, ob der Vertrag gedeckt, unterbudgetiert oder gar nicht budgetiert ist.',
      bullets: [
        'Verknüpfte Budgetzeilen, Beträge nach Jahr und Spalte',
        'Verpflichtung anteilig auf die Monate, die jede Periode abdeckt',
        'Deckung Jahr für Jahr: gedeckt, unterbudgetiert, keine Budgetzeile, Budget über dem Vertrag',
        'Verträge in anderen Währungen zu Ihren Kursen umgerechnet',
        'Nur für Personen sichtbar, die das Budget lesen dürfen',
      ],
      shotAlt: 'Reiter Budget des SAP-Vertrags: verknüpfte Zeilen, Verpflichtung und Deckung Jahr für Jahr',
    },
  ],
  more: {
    title: 'Und außerdem',
    items: [
      { title: 'Konformitätsregister', body: 'Fünf Klauseln zum Nachverfolgen (Auftragsverarbeitungsvertrag nach DSGVO, Speicherort der Daten, Reversibilität, Exit-Plan, Auditrecht), je nach den Anwendungen, die der Vertrag abdeckt. Eine Compliance-Hilfe, die in den nächsten Versionen ausgebaut wird.' },
      { title: 'Verknüpfungen und Kontakte', body: 'Anwendungen, Assets und Technologien, die der Vertrag abdeckt, Kontakte des Lieferanten mit ihrer Rolle, Links und angehängte Dateien.' },
      { title: 'Plaid und MCP', body: 'Fragen Sie Plaid, über welche Verträge in den nächsten 90 Tagen zu entscheiden ist. Dieselben Daten stehen Ihren eigenen KI-Clients über den schreibgeschützten MCP-Server offen.' },
      { title: 'Feingranulare Rechte', body: 'Leser sehen, Mitglieder legen an und entscheiden, Administratoren importieren, exportieren und löschen. Die Budgetbeträge folgen den Budgetrechten.' },
    ],
  },
  crossLinks: {
    label: 'Die Plattform entdecken',
    links: [
      { label: 'IT-Budget', href: '/features/budget' },
      { label: 'IT-Landschaft', href: '/features/it-landscape' },
      { label: 'Vorfälle', href: '/features/incidents' },
      { label: 'Plaid, der integrierte KI-Agent', href: '/features/ai' },
      { label: 'Projektportfolio', href: '/features/portfolio' },
    ],
  },
  cta: {
    title: 'Bereit, Ihre Verträge aus der Tabellenkalkulation zu holen?',
    body: 'Hosten Sie kostenlos selbst oder testen Sie Hosted Cloud. Alle Funktionen in jedem Plan.',
    primary: 'Kostenlos bereitstellen',
    secondary: 'Hosted Cloud testen',
  },
};

export default content;
