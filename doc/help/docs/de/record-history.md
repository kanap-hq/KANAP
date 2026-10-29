# Verlauf der Datensätze

Der Verlauf eines Datensatzes listet die Änderungen daran auf: wer was wann geändert hat. Er beantwortet alltägliche Fragen wie „Wer hat diesen Betrag erhöht?“ oder „Wann wurde die Verknüpfung mit diesem Vertrag entfernt?“, ohne Umweg über das Audit-Protokoll.

## Wo Sie ihn finden

- **Tab Verlauf**, der letzte Tab des Datensatzes: Budgetzeilen (siehe [Budgetzeilen](budget-lines.md#verlauf)), Unternehmen, Abteilungen, Lieferanten, Standorte, Verbindungen, Schnittstellen, Assets und Technologien.
- **Schaltfläche Verlauf** in der Kopfzeile, die den Verlauf in einem Seitenbereich öffnet: Konten, Kostenstellen, Arbeitstagekalender, Geschäftsprozesse, Analysedimensionen und ihre Werte sowie Kontakte.
- **Tab Verlauf** im rechten Bereich eines Dokuments der Wissensdatenbank.

## Wer ihn sehen kann

- Wer den Datensatz öffnen kann, kann auch seinen Verlauf lesen. Es ist keine zusätzliche Berechtigung nötig.
- Ist der Datenzugriff einer Person auf bestimmte Unternehmen oder Kostenstellen begrenzt, sieht sie nur den Verlauf der Datensätze innerhalb ihres Zugriffs. Siehe [Datenzugriff](data-access.md).

## Was ein Eintrag zeigt

Der Verlauf listet einen Eintrag pro Änderung, den neuesten oben. Jeder Eintrag zeigt:

- Datum und Uhrzeit der Änderung;
- ihren Urheber: eine Person, **System** für Änderungen, die KANAP selbst vornimmt, **Import** für Änderungen, die aus einer Datei geladen wurden, oder **Plaid für** eine Person, wenn der Assistent die Änderung in ihrem Auftrag vorgenommen hat;
- für den Datensatz selbst das Ereignis: **Erstellt**, **Aktualisiert** oder **Gelöscht**; für seine Teile der Titel oder das Ereignis des Teils;
- jedes geänderte Feld mit seinem Wert vorher und nachher (`vorher → nachher`).

Eine Betragsänderung nennt das Jahr, die Spalte und die Werte vorher und nachher.

Lange Verläufe werden seitenweise geladen: Klicken Sie unten in der Liste auf **Mehr laden**, um ältere Änderungen zu sehen.

## Änderungen an den Bestandteilen eines Datensatzes

Der Verlauf listet auch die Änderungen an den Bestandteilen eines Datensatzes auf. Bei einer Budgetzeile zum Beispiel:

- Beträge, nach Jahr und Budgetspalte;
- Analysedimensionen;
- Zuordnungen;
- Links und Anhänge;
- Kontakte;
- verknüpfte Anwendungen, Technologien und Assets;
- Aufgaben.

## Datensätze, die Sie nicht lesen können

Ein Eintrag kann einen anderen Datensatz nennen, zum Beispiel einen mit der Zeile verknüpften Vertrag. Wenn Sie diesen Datensatz nicht öffnen können, nennt der Eintrag nur seine Art, zum Beispiel „ein Vertrag“. Ein inzwischen gelöschter Datensatz erscheint als „ein gelöschter Vertrag“.

## Werte, die der Verlauf nicht zeigt

- E-Mail-Adresse, Telefonnummern und Notizen eines Kontakts erscheinen nie.
- Bei langen Inhalten sagt der Eintrag nur, dass sie sich geändert haben: **Inhalt geändert** für den Text eines Dokuments der Wissensdatenbank, **Arbeitstage geändert** für die Tage eines Arbeitstagekalenders.

## Den Assistenten fragen

[Plaid](ai-assistant.md#tool-calls) liest den Verlauf eines Datensatzes mit denselben Rechten wie seine Seite. Fragen Sie zum Beispiel: „Wer hat die Beträge von BL-12 geändert?“ oder „Was hat sich an TEC-3 in diesem Jahr geändert?“ Plaid antwortet nur aus dem Tab Verlauf: Für einen Datensatz ohne diesen Tab sagt es, dass KANAP keinen Verlauf dafür führt.

## Das vollständige Audit-Protokoll

Der Verlauf beschränkt sich auf das, was ein Leser braucht. Die vollständige technische Aufzeichnung jeder Änderung im gesamten Arbeitsbereich bleibt unter **Administration > Audit-Protokoll**. Siehe [Audit-Protokoll](admin.md#audit-protokoll).
