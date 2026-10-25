# Budgetverwaltung: Übersicht

Die Übersicht der Budgetverwaltung zeigt Ihnen auf einen Blick, wo Ihre IT-Ausgaben aktuell stehen: das Budget nach Typ und Jahr, Ihre eigenen Budgetzeilen, anstehende Fristen, Datenqualitätsindikatoren und die Zeilen, die Ihre Aufmerksamkeit am meisten verdienen, alles an einem Ort.

## Wo Sie es finden

- Pfad: **Budgetverwaltung > Übersicht** (`/ops`)
- Nach der Anmeldung landen Sie auf Ihrem persönlichen [Dashboard](my-dashboard.md). Diese Übersicht öffnen Sie im Arbeitsbereich **Budgetverwaltung**.

## Aktionen in der Kopfzeile

Die Kopfzeile enthält Schaltflächen für schnelle Aktionen:

- **Neue OPEX-Zeile** und **Neue CAPEX-Zeile** öffnen eine neue Budgetzeile dieses Typs. Sie erscheinen, wenn Ihre Rolle mindestens die Stufe Mitglied auf Budget hat (`budget:member`)
- **Neuer Vertrag** öffnet einen neuen Vertrag. Die Schaltfläche erscheint, wenn Ihre Rolle Verträge anlegen darf
- **Anpassen**, rechts, öffnet die Einstellungen dieser Übersicht. Siehe [Die Übersicht anpassen](#die-ubersicht-anpassen)

## Layout

Die Übersicht besteht aus Kacheln, die in einem responsiven Raster angeordnet sind: drei Spalten auf einem breiten Bildschirm, zwei auf einem Tablet und eine einzelne Spalte auf dem Mobilgerät. Die Kachel **Budget** ist breiter: zwei Spalten auf einem breiten Bildschirm, die volle Breite auf einem Tablet. Jede Kachel hat ein Symbol, einen Titel und in der Regel eine Schaltfläche, die Sie zur vollständigen Seite hinter den Daten führt.

Mehrere Kacheln haben in ihrem Kopf die Tabs **Alle**, **OPEX** und **CAPEX**, mit denen Sie den Typ der Zeilen wählen, die sie abdecken. Jede Kachel merkt sich Ihre Wahl in Ihrem Browser.

## Kacheln

Die Kacheln sind unten in ihrer Standardreihenfolge aufgeführt.

### Budget

Eine Tabelle, die drei Geschäftsjahre abdeckt: Vorjahr (J-1), aktuelles Jahr (J) und nächstes Jahr (J+1). Jedes Jahr hat drei Zeilen: **OPEX**, **CAPEX** und **Gesamt**. Die Wertspalten sind die Budgetspalten, die Ihre Organisation anzeigt, unter ihren Namen (**Budget**, **Revision**, **Ist-Werte** und **Erwarteter Endwert** mit den Standardeinstellungen, dazu **Prognose**, wenn sie angezeigt wird). Unter [Anpassen](#die-ubersicht-anpassen) können Sie weniger davon behalten. Eine Spalte erscheint, sobald sie für mindestens eine Zeile einen Betrag enthält. Ausgeblendete Spalten erscheinen nie. Alle Beträge sind auf den nächsten Tausender gerundet und mit dem Suffix „k“ angezeigt (z. B. `7.846 k`). Die Trennzeichen folgen der Sprache der Oberfläche.

Klicken Sie auf einen Betrag, um die [Liste der Budgetzeilen](budget-lines.md) auf diesem Typ zu öffnen. Ein Betrag in **Gesamt** öffnet die Liste auf beiden Typen. Klicken Sie auf **Ansehen**, um die Liste zu öffnen.

### Datenqualität

Prüfungen, die Ihnen helfen, unvollständige Zeilen auf einen Blick zu erkennen. Die Kachel zeigt eine Spalte mit Zählern pro Typ: **OPEX** und **CAPEX** nebeneinander. Die Zähler umfassen die Zeilen, die die Liste standardmäßig zeigt (**Anzeigen: Aktiv**).

- **Ohne IT-Verantwortlichen**: Zeilen ohne IT-Verantwortlichen
- **Ohne Fachbereichsverantwortlichen**: Zeilen ohne Fachbereichsverantwortlichen
- **Ohne zahlendes Unternehmen**: Zeilen ohne zahlendes Unternehmen
- **Ohne Kostenstelle**: Zeilen ohne Kostenstelle
- **Ohne Budget im nächsten Jahr**: Zeilen, deren Standardspalte für das nächste Jahr null oder leer ist. Die Prüfung nennt Ihre Standardspalte
- **Konto nicht im Kontenplan des Unternehmens**: Zeilen, deren Konto nicht zum Kontenplan des zahlenden Unternehmens gehört

Ein Zähler wird orange (rot bei der Kontenplan-Prüfung), wenn er über null liegt. Klicken Sie auf einen Zähler, um die Liste genau mit den Zeilen zu öffnen, die er zählt.

### Mein Budget

Die Zeilen auf Ihren Namen, in der Standardspalte des aktuellen Jahres (der Untertitel nennt sie, zum Beispiel **Budget, J**). Wählen Sie den Typ mit den Tabs **Alle** / **OPEX** / **CAPEX**.

- **Als IT-Verantwortlicher**, **Als Fachbereichsverantwortlicher** und **Als Budgetverantwortlicher**: wie viele Zeilen Sie in jeder Rolle halten, und ihre Summe. Klicken Sie auf eine Zeile, um die Liste mit diesen Zeilen zu öffnen
- **Meine Zeilen**: Ihre drei größten Zeilen, unabhängig von der Rolle, mit ihrer Referenz. Klicken Sie auf eine, um sie zu öffnen

Halten Sie keine Zeile, zeigt die Kachel „Keine Budgetzeilen auf Ihren Namen“.

### Meine Aufgaben

Zeigt die Gesamtzahl der Ihnen zugewiesenen offenen Aufgaben (als „erledigt“ markierte Aufgaben sind ausgeschlossen), gefolgt von den fünf Aufgaben mit den nächsten Fälligkeitsterminen. Überfällige Aufgaben sind rot hervorgehoben. Aufgaben ohne Fälligkeitsdatum erscheinen hier nicht.

Klicken Sie auf **Alle anzeigen**, um die Aufgaben-Seite zu öffnen.

### Nächste Verlängerungen

Listet die fünf Verträge, die als Nächstes fällig sind, heute eingeschlossen, in der Reihenfolge der Spalte **Nächste Frist** der Vertragsliste: Ein Vertrag mit stillschweigender Verlängerung erscheint mit seinem nächsten Kündigungstermin, jeder andere Vertrag mit seinem Ende. Abgelaufene Verträge erscheinen nicht.

Klicken Sie auf **Alle anzeigen**, um die Verträge-Seite zu öffnen.

### Top-Zeilen

Die fünf größten Zeilen für das aktuelle Jahr, nach der Standardspalte sortiert. Der Untertitel nennt die Spalte, zum Beispiel **Budget, J**. Beträge sind auf Tausender gerundet mit dem Suffix „k“, mit den Trennzeichen der Sprache der Oberfläche.

Wählen Sie den Typ mit den Tabs **Alle** / **OPEX** / **CAPEX**. Klicken Sie auf **Öffnen**, um den vollständigen Bericht **Top-Zeilen** für denselben Typ anzuzeigen.

### Stärkste Zuwächse

Die fünf Zeilen mit dem größten Anstieg in der Standardspalte im Vergleich zum Vorjahr. Der Untertitel nennt die Spalte, zum Beispiel **Budget, J vs J-1**. Zeilen, deren Betrag gleich geblieben oder gesunken ist, erscheinen nicht. Ein kleiner Anstieg erscheint in voller Höhe. Ein größerer wird verkürzt, zum Beispiel `340,1 k`.

Wählen Sie den Typ mit den Tabs **Alle** / **OPEX** / **CAPEX**. Klicken Sie auf **Öffnen**, um den vollständigen Bericht **Top Anstieg / Rückgang** für denselben Typ anzuzeigen.

### Nach Kostenstelle

Die fünf Kostenstellen mit der größten Summe in der Standardspalte des aktuellen Jahres, mit einem Balken für jede. Zeilen ohne Kostenstelle zählen zusammen als **Ohne Kostenstelle**. Wählen Sie den Typ mit den Tabs **Alle** / **OPEX** / **CAPEX**. Klicken Sie auf eine Zeile, um die Liste mit den Zeilen dieser Kostenstelle zu öffnen.

### Aktuelle Änderungen

Die fünf zuletzt bearbeiteten Budgetzeilen, OPEX und CAPEX zusammen. Jede Zeile zeigt das Datum der letzten Bearbeitung, die Referenz der Zeile, ihren Namen und ihren Typ. Klicken Sie auf eine Zeile, um die Budgetzeile zu öffnen.

Ohne Lesezugriff auf Budgetzeilen (`budget:reader`) sind die Budget-Kacheln ausgeblendet. **Meine Aufgaben** erfordert Lesezugriff auf Aufgaben, **Nächste Verlängerungen** Lesezugriff auf Verträge.

### Beträge ohne Wechselkurs

Hat die Währung einer Zeile für ein Jahr keinen Wechselkurs, ist ihr Betrag nicht in den Summen dieses Jahres enthalten. Die Kacheln **Budget**, **Stärkste Zuwächse**, **Mein Budget** und **Nach Kostenstelle** zeigen dann einen einzeiligen Hinweis, zum Beispiel „3 Zeilen ohne Wechselkurs ausgeschlossen: USD 2026.“ Benutzer der Budgetadministration auf Administratorebene sehen außerdem **Kurs eingeben**, das die Währungseinstellungen beim fehlenden Kurs öffnet. Nennt der Hinweis nur eine Währung und ein Jahr, öffnet sich direkt der Dialog für den manuellen Kurs. In **Top-Zeilen** zeigt eine solche Zeile ihren Betrag in ihrer eigenen Währung mit einer kleinen orangefarbenen Markierung. Siehe [Manuelle Kurse](currencies.md#manuelle-kurse).

## Die Übersicht anpassen

Klicken Sie auf **Anpassen**, um **Einstellungen des Budget-Dashboards** zu öffnen. Ihre Wahl gilt nur für Ihre eigene Übersicht.

- **Eine Kachel anzeigen oder ausblenden**: Haken Sie sie an oder ab. Der Dialog listet die Kacheln, die Ihre Rolle sehen darf
- **Die Reihenfolge ändern**: Ziehen Sie eine Kachel an ihrem Griff rechts
- **Betragsspalten der Kachel Budget**: **Spalten des Mandanten**, standardmäßig angehakt, folgt den Spalten, die Ihre Organisation anzeigt. Haken Sie es ab, um die Spalten selbst zu wählen. Behalten Sie mindestens eine, sonst zeigt der Dialog „Wählen Sie mindestens eine Betragsspalte.“
- **Speichern** übernimmt Ihre Wahl. **Auf Standardwerte zurücksetzen** zeigt wieder jede Kachel an, in der Standardreihenfolge und mit den Spalten der Organisation

## Tipps

- **Welche Spalte die Kacheln verwenden**: Ein Budgetadministrator wählt die Standardspalte und die Spaltennamen unter [Budgetspalten](budget-operations.md#budgetspalten). Die Kacheln und die Berichte, die sie öffnen, folgen dieser Wahl.
- **Gerundete Zahlen**: Budget, Top-Zeilen, Mein Budget und Nach Kostenstelle runden Beträge auf Tausender mit einem k, zum Beispiel `7.846 k`. Die Kachel Stärkste Zuwächse zeigt eine kleine Änderung in voller Höhe und verkürzt eine größere, zum Beispiel `340,1 k`. Öffnen Sie die Liste der Budgetzeilen oder die Berichte, wenn Sie genaue Zahlen benötigen.
- **Fehlende Schaltflächen**: Wenn Sie die Schaltflächen **Neue OPEX-Zeile** oder **Neue CAPEX-Zeile** nicht sehen, hat Ihre aktuelle Rolle nicht die Stufe Mitglied auf Budget. Bitten Sie Ihren Administrator, Ihren Zugriff zu prüfen.
- **Leere Kacheln**: Eine Kachel, die „Keine Daten“ zeigt, bedeutet einfach, dass noch keine Datensätze dieses Typs vorhanden sind. Sobald Sie oder Ihr Team mit der Dateneingabe beginnen, wird die Kachel automatisch befüllt.
