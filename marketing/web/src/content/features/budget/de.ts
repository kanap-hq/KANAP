import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'IT-Budget: Hochrechnung, Folgejahr, Verrechnung',
    description:
      "Open-Source-IT-Budget: OPEX und CAPEX, Hochrechnung und Folgejahr, Verrechnung, Konsolidierung, Kosten pro FTE, jede Zeile mit Anwendungen verknüpft.",
  },
  header: {
    eyebrow: 'IT-Budget',
    title: 'Das IT-Budget, von der Hochrechnung bis zum Folgejahr, mit Ihren Anwendungen verknüpft.',
    lead: 'OPEX und CAPEX über mehrere Jahre, Hochrechnung und Budget des Folgejahres, Verrechnung an Gesellschaften und Abteilungen, Personal und Kosten pro FTE. Jede Zeile ist mit ihren Anwendungen, Verträgen und Projekten verknüpft: Sie wissen, wofür Sie zahlen, und warum.',
  },
  sections: [
    {
      title: 'Von der Hochrechnung zum Budget des Folgejahres',
      body: 'Die Standardspalten (Budget, Revision, Ist, erwartetes Jahresergebnis) lassen sich umbenennen und ausblenden, von J-2 bis J+2, mit jährlicher oder monatlicher Erfassung. Festigen Sie die Hochrechnung Zeile für Zeile, kopieren Sie sie in das Budget des Folgejahres und frieren Sie die genehmigte Version ein.',
      bullets: [
        'OPEX und CAPEX in eigenen Listen',
        'Spalten für Budget, Revision, Ist und Hochrechnung, umbenennbar',
        'Beträge als Menge × Preis oder nach Monaten verteilt',
        'Spalten kopieren, zuerst als Probelauf',
        'Versionen einfrieren: Die genehmigte Version bleibt unverändert',
      ],
      shotAlt: 'OPEX-Budgetraster mit Spalten pro Jahr',
    },
    {
      title: 'Eine Verrechnung, die jeder versteht',
      body: 'Verteilen Sie jede Zeile auf die Gesellschaften und Abteilungen, die davon profitieren, mit sechs Verteilungsmethoden. Die Prozentsätze folgen Mitarbeiterzahl oder Umsatz, wenn diese sich ändern, und jede Verteilung bleibt Zeile für Zeile nachvollziehbar.',
      bullets: [
        'Nach Mitarbeiterzahl (Standard)',
        'Nach IT-Nutzern oder nach Umsatz',
        'Manuelle Auswahl von Gesellschaften oder Abteilungen',
        'Von Hand eingegebene Prozentsätze',
        'Eine Methode pro Jahr und pro Zeile',
      ],
      shotAlt: 'Verteilungseditor einer Budgetzeile',
    },
    {
      title: 'Mehrere Gesellschaften, mehrere Währungen, Konsolidierung',
      body: 'Jede Zeile behält ihre Währung, und alles wird in einer Berichtswährung zusammengeführt. Die Kurse stammen von der Weltbank und werden beim Einfrieren des Budgets festgeschrieben. Kontenpläne und ein Konsolidierungsplan bringen Ihre Zahlen in die Struktur des Finanzbereichs.',
      bullets: [
        'Eine Berichtswährung für alle Summen',
        'Automatische Wechselkurse, beim Einfrieren festgeschrieben',
        'Liste der zulässigen Währungen',
        'Länderkontenpläne und Konsolidierungsplan',
        'Kostenstellen und Budgetverantwortliche',
      ],
      shotAlt: 'Währungseinstellungen mit Wechselkursen',
    },
    {
      title: 'Ein Bericht für jede Frage',
      body: 'Gesamt- und gesellschaftsbezogene Verrechnung, Trends, größte Steigerungen und Rückgänge, Vergleich zweier Versionen, Analysedimensionen, Konsolidierungskonten, monatlicher Personalbestand und Kosten pro FTE. Jede Berichtszeile öffnet die passende gefilterte Liste, und Plaid beantwortet dieselben Fragen in natürlicher Sprache.',
      bullets: [
        'Gesamt- und gesellschaftsbezogene Verrechnung',
        'Spaltenvergleich und Trends für OPEX und CAPEX',
        'Analysedimensionen und Konsolidierungskonten',
        'Monatlicher Personalbestand, Kosten pro FTE und Tagessatz',
        'CSV-Export und Diagramme als Bild',
      ],
      shotAlt: 'Verrechnungsbericht nach Gesellschaft',
    },
  ],
  more: {
    title: 'Außerdem',
    items: [
      { title: 'Mit Anwendungen und Projekten verknüpft', body: 'Jede Ausgabe führt zu ihren Anwendungen, Projekten und Lieferanten. Der Datensatz einer Anwendung zeigt, was sie kostet.' },
      { title: 'Verträge und Fristen', body: 'Jahresbetrag, automatische Verlängerung, Kündigungsfrist und berechneter Kündigungstermin, mit den Budgetzeilen verknüpft.' },
      { title: 'Hin und zurück mit der Tabellenkalkulation', body: 'Exportieren Sie die Zeilen, bearbeiten Sie sie in Excel oder LibreOffice und importieren Sie die Datei zurück: KANAP schreibt nur die geänderten Zellen.' },
      { title: 'Beispieldaten', body: 'Ein Test füllt sich in einer Minute mit dem Budget von Fromage & Co, vier fiktiven Gesellschaften, damit Sie alles sehen, bevor Sie Ihr eigenes erfassen.' },
    ],
  },
  crossLinks: {
    label: 'Die Plattform entdecken',
    links: [
      { label: 'IT-Landschaft', href: '/features/it-landscape' },
      { label: 'Projektportfolio', href: '/features/portfolio' },
      { label: 'Dokumentation', href: '/features/knowledge' },
      { label: 'Plaid, der integrierte KI-Agent', href: '/features/ai' },
      { label: 'Helpdesk-Agent', href: '/features/agents' },
    ],
  },
  cta: {
    title: 'Testen Sie KANAP mit einem vollständigen IT-Budget.',
    body: 'Testen Sie die gehostete Version mit Beispieldaten oder stellen Sie KANAP kostenlos auf Ihren eigenen Servern bereit.',
    primary: 'Kostenlos bereitstellen',
    secondary: 'Mit Beispieldaten testen',
  },
};

export default content;
