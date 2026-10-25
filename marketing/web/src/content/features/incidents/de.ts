import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Vorfallsregister: Analysen, Verlauf, Nachweise für Audits',
    description:
      'Open-Source-Vorfallsregister für die IT: nummerierte Vorfälle, Analyse, unveränderbarer Verlauf, DSGVO- und NIS2-Meldefakten, verknüpfte Anwendungen und Server.',
  },
  header: {
    eyebrow: 'Vorfälle',
    title: 'Dokumentieren Sie Ihre schweren Vorfälle im Detail.',
    lead: 'KANAP bewahrt das Gedächtnis der Vorfälle, die zählen: was passiert ist, was betroffen war, warum, und was Sie geändert haben. Jeder bekommt eine Nummer, eine Analyse und einen Verlauf und bleibt mit den betroffenen Anwendungen und Servern verknüpft.',
  },
  sections: [
    {
      title: 'Das Vorfallsregister',
      body: 'Jeder Vorfall erhält eine dauerhafte Referenz, INC-12, und die Nummerierung hat nie Lücken: Ein abgebrochener Vorfall behält seine Nummer. Schweregrad, Kategorie, Verantwortlicher und Datumsangaben genügen für den Anfang, der Rest kommt, wenn Sie mehr wissen. Vergangene Vorfälle lassen sich mit ihren tatsächlichen Daten erfassen.',
      bullets: [
        'Vier Schweregradstufen, konfigurierbare Kategorien',
        'Offen, In Bearbeitung, Behoben, Geschlossen: Der Status bewegt sich nur vorwärts',
        'Einen Vorfall wieder öffnen oder abbrechen, mit Pflichtbegründung, nur durch Registeradministratoren',
        'Suche in Titeln, Beschreibungen und den verknüpften Anwendungen und Servern',
        'Dauer berechnet, sobald der Vorfall behoben ist',
      ],
      shotAlt: 'Vorfallsregister mit Schweregrad, Status, Erkennungs- und Behebungsdatum',
    },
    {
      title: 'Die Analyse, geschrieben, wo der Vorfall liegt',
      body: 'Jeder Vorfall hat eine Analyse: ein formatiertes Dokument aus einer fünfteiligen Vorlage (detaillierte Beschreibung, Auswirkung, Ursache, Korrekturmaßnahmen, Erkenntnisse), in der Sprache der Person, die sie schreibt. Jedes Speichern erzeugt eine Version, und die Analyse wird beim Schließen des Vorfalls eingefroren.',
      bullets: [
        'Vorlage durch Ihre Dokumentationsadministratoren anpassbar',
        'Überschriften, Listen, Tabellen und eingefügte Bilder',
        'Versioniert, in der Dokumentationsbibliothek mit eigener Referenz abgelegt',
        'Rechte auf Vorfälle genügen, um sie zu schreiben',
        'Der Verlauf hält jede Änderung fest, und kein Eintrag lässt sich bearbeiten oder löschen',
      ],
      shotAlt: 'Geschlossener Vorfall mit Beschreibung und Analyse: Zusammenfassung, Auswirkung, Ursache, Maßnahmen',
    },
    {
      title: 'Nachweise für den Prüfer',
      body: 'Waren personenbezogene Daten betroffen? Musste die Behörde benachrichtigt werden, und wann geschah das? Wer wurde informiert? Der Vorfall hält diese Fakten mit ihren Daten fest und bewahrt sie: Ein Vorfall mit regulatorischen Fakten lässt sich nicht löschen.',
      bullets: [
        'Personenbezogene Daten betroffen, Meldung an Behörde erforderlich, Gemeldet am, Informierte Parteien',
        'PDF-Bericht eines Vorfalls, in der Sprache der Oberfläche',
        'Das Schließen sperrt alles: Felder, Analyse, Verlauf, Verknüpfungen und Dateien',
        'Vertrauliche Vorfälle nur für Registeradministratoren, Melder und Verantwortlichen sichtbar',
        'Die Fakten, die Art. 33 Abs. 5 DSGVO und NIS2 zu dokumentieren verlangen',
      ],
      shotAlt: 'Vorfall mit betroffenen personenbezogenen Daten und Meldung an die Behörde am 11. Juli',
    },
    {
      title: 'Mit Ihrer IT-Landschaft verknüpft',
      body: 'Verknüpfen Sie einen Vorfall mit den Servern, Anwendungen und Technologien, die er getroffen hat. Jedes dieser Elemente zeigt dann seine Vorfälle schreibgeschützt auf seiner eigenen Seite. Folgemaßnahmen werden zu Aufgaben, die die Referenz des Vorfalls tragen, und Dokumente und angehängte Dateien bleiben beim Vorfall.',
      bullets: [
        'Assets, Anwendungen und Technologien, mit Vorschlägen aus dem bereits Verknüpften',
        'Vorfälle auf der Seite jeder Anwendung, jedes Servers und jeder Technologie',
        'Folgeaufgaben, aus dem Vorfall angelegt',
        'Dokumente aus der Wissensdatenbank und angehängte Dateien',
        'Verknüpfungen folgen den Leserechten jeder Person',
      ],
      shotAlt: 'Beziehungen eines Vorfalls: drei Server, zwei SAP-Anwendungen und VMware ESXi',
    },
  ],
  more: {
    title: 'Und außerdem',
    items: [
      { title: 'CSV-Import und -Export', body: 'Übernehmen Sie Ihre vergangenen Vorfälle aus einer Tabelle, Analysen inklusive, und exportieren Sie das ganze Register.' },
      { title: 'Plaid und MCP', body: 'Fragen Sie Plaid, wie viele schwere Vorfälle dieses Jahr eröffnet wurden, oder nach dem vollständigen Datensatz eines Vorfalls, Verlauf und Analyse inklusive. Vertrauliche Vorfälle bleiben außen vor. Dieselben Daten stehen Ihren KI-Clients über den schreibgeschützten MCP-Server offen.' },
      { title: 'Rückdatierte Notizen', body: 'Notizen im Verlauf tragen den Zeitpunkt des Ereignisses. Der Zeitpunkt des Speicherns wird getrennt aufbewahrt und lässt sich nicht ändern.' },
      { title: 'Rechte', body: 'Leser sehen, Mitwirkende legen an und schreiben, Registeradministratoren öffnen wieder, brechen ab, löschen und heben eine Einschränkung auf.' },
    ],
  },
  crossLinks: {
    label: 'Die Plattform entdecken',
    links: [
      { label: 'IT-Landschaft', href: '/features/it-landscape' },
      { label: 'Verträge', href: '/features/contracts' },
      { label: 'Dokumentation', href: '/features/knowledge' },
      { label: 'Plaid, der integrierte KI-Agent', href: '/features/ai' },
      { label: 'Helpdesk-Agent', href: '/features/agents' },
    ],
  },
  cta: {
    title: 'Bereit für ein umfassendes, prüfbares Vorfallsregister?',
    body: 'Hosten Sie kostenlos selbst oder testen Sie Hosted Cloud. Alle Funktionen in jedem Plan.',
    primary: 'Kostenlos bereitstellen',
    secondary: 'Hosted Cloud testen',
  },
};

export default content;
