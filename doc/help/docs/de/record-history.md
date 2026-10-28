# Verlauf der Datensätze

Der Tab **Verlauf** eines Datensatzes listet die Änderungen daran auf: wer was wann geändert hat. Er beantwortet alltägliche Fragen wie „Wer hat diesen Betrag erhöht?“ oder „Wann wurde die Verknüpfung mit diesem Vertrag entfernt?“, ohne Umweg über das Audit-Protokoll.

!!! note "Wo er verfügbar ist"
    Heute gibt es den Tab **Verlauf** bei Budgetzeilen (siehe [Budgetzeilen](budget-lines.md#verlauf)). Andere Datensätze erhalten ihn später.

## Wer ihn sehen kann

- Wer den Datensatz öffnen kann, kann auch seinen Verlauf lesen. Es ist keine zusätzliche Berechtigung nötig.
- Ist der Datenzugriff einer Person auf bestimmte Unternehmen oder Kostenstellen begrenzt, sieht sie nur den Verlauf der Datensätze innerhalb ihres Zugriffs. Siehe [Datenzugriff](data-access.md).

## Was ein Eintrag zeigt

Der Tab listet einen Eintrag pro Änderung, den neuesten oben. Jeder Eintrag zeigt:

- Datum und Uhrzeit der Änderung;
- ihren Urheber: eine Person, **System** für Änderungen, die KANAP selbst vornimmt, **Import** für Änderungen, die aus einer Datei geladen wurden, oder **Plaid für** eine Person, wenn der Assistent die Änderung in ihrem Auftrag vorgenommen hat;
- für den Datensatz selbst das Ereignis: **Erstellt**, **Aktualisiert** oder **Gelöscht**; für seine Teile der Titel oder das Ereignis des Teils;
- jedes geänderte Feld mit seinem Wert vorher und nachher (`vorher → nachher`).

Eine Betragsänderung nennt das Jahr, die Spalte und die Werte vorher und nachher.

Lange Verläufe werden seitenweise geladen: Klicken Sie unten in der Liste auf **Mehr laden**, um ältere Änderungen zu sehen.

## Änderungen an den Bestandteilen eines Datensatzes

Der Verlauf einer Budgetzeile listet auch die Änderungen an ihren Bestandteilen auf:

- Beträge, nach Jahr und Budgetspalte;
- Analysedimensionen;
- Zuordnungen;
- Links und Anhänge;
- Kontakte;
- verknüpfte Anwendungen, Technologien und Assets;
- Aufgaben.

## Datensätze, die Sie nicht lesen können

Ein Eintrag kann einen Datensatz aus einem anderen Modul nennen, zum Beispiel einen mit der Zeile verknüpften Vertrag. Wenn Sie dieses Modul nicht lesen können oder der Datensatz inzwischen gelöscht wurde, nennt der Eintrag nur seine Art, zum Beispiel „ein Vertrag“.

## Das vollständige Audit-Protokoll

Der Verlauf beschränkt sich auf das, was ein Leser braucht. Die vollständige technische Aufzeichnung jeder Änderung im gesamten Arbeitsbereich bleibt unter **Administration > Audit-Protokoll**. Siehe [Audit-Protokoll](admin.md#audit-protokoll).
