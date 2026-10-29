# Verträge

Verträge dokumentieren Ihre Vereinbarungen mit Lieferanten: Softwarelizenzen, Wartungsverträge, SaaS-Abonnements und Serviceverträge. KANAP datiert jede Periode eines Vertrags, zeigt Ihnen, wann eine Entscheidung über die Verlängerung ansteht, vergleicht die Verpflichtung des Vertrags mit den verknüpften Budgetzeilen und listet die Klauseln, die seine Anwendungen erfordern.

## Erste Schritte

Öffnen Sie **Budgetverwaltung > Verträge**, um die Liste zu sehen. Klicken Sie auf **Neu**, um einen Vertrag anzulegen (`contracts:member`).

Die Seite öffnet sich mit einem einzigen Formular. Füllen Sie es aus und klicken Sie dann auf **Erstellen**.

**Pflichtfelder**:

- **Vertragsname**: ein gut erkennbarer Name
- **Lieferant** und **Vertragsunternehmen**: wer die Leistung erbringt und welches Ihrer Unternehmen unterschrieben hat
- **Beginn**: der erste Tag des Vertrags
- **Laufzeit (Monate)**: die Länge einer Periode, mindestens ein Monat
- **Währung**: eine der Währungen Ihres Arbeitsbereichs, zu Beginn die Standardwährung

**Optionale Felder**:

- **Verantwortlicher**: die Person, die den Vertrag betreut. Der Verantwortliche erhält die Aufgaben zur Verlängerungsentscheidung. Tragen Sie ihn also ein
- **Stillschweigende Verlängerung**: standardmäßig **Ja**
- **Kündigungsfrist (Monate)**: leer bedeutet keine Kündigungsfrist
- **Jahresbetrag**: der Jahreswert bei Unterzeichnung, mit höchstens zwei Dezimalstellen. Leer bedeutet 0
- **Abrechnung**: standardmäßig **Jährlich**, oder **Vierteljährlich**, **Monatlich**, **Sonstige**

Sobald der Vertrag existiert, speichert sich jede Änderung selbst. Es gibt keine Schaltfläche **Speichern**.

---

## Perioden und Fristen

KANAP berechnet die Daten eines Vertrags aus vier Feldern: **Beginn**, **Laufzeit (Monate)**, **Kündigungsfrist (Monate)** und **Stillschweigende Verlängerung**, dazu das **Ende der Gültigkeit**, wenn es gesetzt ist. Nichts wird gespeichert: Ändern Sie ein Feld, und alle Daten folgen.

- **Perioden**: Ein Vertrag läuft in Perioden der gewählten Laufzeit, gezählt ab dem Beginndatum. Ein Vertrag, der am 1. Juli 2024 für 12 Monate beginnt, läuft jedes Jahr vom 1. Juli bis zum 30. Juni.
- **Kündigungstermin**: das Ende einer Periode minus die Kündigungsfrist. Mit 6 Monaten Kündigungsfrist kann der obige Vertrag jedes Jahr bis zum 30. Dezember gekündigt werden.
- **Stillschweigende Verlängerung**: Mit **Ja** folgen die Perioden aufeinander, bis ein Ende der Gültigkeit sie beendet. Mit **Nein** endet der Vertrag nach seiner ersten Periode. Hat er ein Ende der Gültigkeit, läuft er stattdessen Periode um Periode bis zu diesem Tag. So behält ein Vertrag, dessen Verlängerung beendet wurde, die Perioden, die er bereits durchlaufen hat.
- **Ende der Gültigkeit**: der Tag, an dem der Vertrag endet. Danach beginnt keine Periode mehr. Fällt es in eine Periode, endet der Vertrag an diesem Tag.
- **Monate am Monatsende**: Gibt es denselben Tag im Zielmonat nicht, gilt der letzte Tag dieses Monats. Der 31. März minus ein Monat ist der 28. Februar (in einem Schaltjahr der 29.).

Alle Daten sind Kalendertage in UTC.

---

## Mit der Liste arbeiten

Jede Zeile öffnet den Vertrag. Ihre Suche, Filter und Sortierung bleiben bei der Rückkehr erhalten, und **Zurück** / **Weiter** auf der Vertragsseite durchlaufen dieselbe Auswahl.

**Standardspalten**:

- **Vertrag**, **Lieferant**, **Unternehmen**
- **Nächste Frist**: der nächste Kündigungstermin eines Vertrags mit stillschweigender Verlängerung, oder das Ende jedes anderen Vertrags. Auf das Datum folgt „in n Tagen“. Ein abgelaufener Vertrag zeigt ausgegraut den Tag, an dem er endete
- **Stand**: siehe unten
- **Jahresbetrag**: der Betrag bei Unterzeichnung, gefolgt von seiner Währung
- **Verpflichtet**, **Budget** und **Abweichung** für das gewählte Budgetjahr. Siehe [Budgetspalten](#budgetspalten)
- **Konformität**: die Zusammenfassung des Reiters [Konformität](#konformitat): „2 fehlen · 1 zu prüfen“ in Orange, **Vollständig** oder **Keine Erwartung**
- **Verknüpfte Zeilen**: die Anzahl der verknüpften Budgetzeilen, OPEX und CAPEX zusammen
- **Status**: **Aktiviert** oder **Deaktiviert**, abgeleitet aus dem Ende der Gültigkeit

**Weitere Spalten** (Spaltenauswahl): **Währ.**, **Budgetdeckung**, **Beginn**, **Laufzeit (M)**, **Auto-Verlängerung**, **Kündigungsfrist (M)**, **Laufzeitende** (Ende der laufenden Periode), **Kündigung bis** (nächster Kündigungstermin), **Abrechnung** und **Aufgabe** (die letzte Aufgabe des Vertrags).

**Standardsortierung**: nach **Nächste Frist**, die nächste zuerst. Abgelaufene Verträge bleiben in beiden Richtungen unten.

### Stand

Jeder Vertrag hat einen Stand, den ersten, der zutrifft:

- **Zu entscheiden** (orange): Eine Entscheidung steht an. Bei einem Vertrag mit stillschweigender Verlängerung fällt sein nächster Kündigungstermin in den Entscheidungszeitraum, und seine Verlängerung wurde für diese Periode nicht bestätigt. Bei einem Vertrag ohne Verlängerung fällt sein Ende in den Zeitraum, und niemand hat bestätigt, dass er auslaufen soll. Siehe [Verlängerungsentscheidungen](#verlangerungsentscheidungen)
- **Endet ohne Verlängerung**: Der Vertrag ist in seiner letzten Periode und endet mit ihr
- **Verlängert zum** einem Datum: Der Kündigungstermin der laufenden Periode ist verstrichen. Der Vertrag geht also in die nächste Periode über, die an diesem Datum beginnt
- **Laufend**: Der Vertrag läuft, und noch steht nichts an
- **Abgelaufen**: Der Vertrag ist beendet

### Schnellfilter

Die Links über der Tabelle filtern die Liste mit einem Klick. Ein erneuter Klick entfernt den Filter.

- **Innerhalb von n Tagen zu entscheiden (n)**: die Verträge im Stand **Zu entscheiden**. Die Anzahl der Tage ist der Entscheidungszeitraum Ihres Arbeitsbereichs
- **Ohne Budgetzeile (n)** und **Unterbudgetiert (n)**: die Verträge, deren Budgetdeckung im gewählten Jahr diesen Stand hat
- **Ohne Kostenstelle**: Verträge ohne **Kostenstelle oder Gruppe**. Die Spalte **Kostenstelle** (Spaltenauswahl) zeigt das Feld

Ein orangefarbener Punkt markiert einen Link, dessen Zähler nicht null ist.

### Budgetspalten

Mit Lesezugriff auf Budgetzeilen (`budget:reader`) zeigt die rechte Seite der Symbolleiste **Budget** mit einem Jahr und einer Budgetspalte (die Spaltennamen Ihres Arbeitsbereichs). Diese Auswahl gilt nur für Sie. Sie wird mit dem Reiter **Budget** jedes Vertrags geteilt und für Ihren nächsten Besuch gespeichert. Sie beginnt mit dem nächsten Jahr und der Standardspalte Ihres Arbeitsbereichs.

- **Verpflichtet** (Jahr): was der Vertrag für dieses Jahr verpflichtet, in Ihrer Berichtswährung. Siehe [Verpflichtung](#verpflichtung-und-deckung)
- **Budget** (Jahr): die Summe der Beträge der verknüpften Zeilen in diesem Jahr und dieser Spalte
- **Abweichung**: Budget minus Verpflichtung. Ein Fehlbetrag erscheint in Orange. **Keine Zeile** bedeutet, dass auf keiner verknüpften Zeile etwas budgetiert ist, und **Vertrag abgelaufen**, dass auf einem beendeten Vertrag noch Budget liegt
- **Budgetdeckung** (standardmäßig ausgeblendet): einer der sechs Deckungsstände

Ein Vertrag in einer Währung ohne Wechselkurs für das Jahr zeigt „Kein Kurs für USD“ statt eines Betrags.

Hat eine verknüpfte Budgetzeile für das Jahr keinen Wechselkurs, lässt der Betrag **Budget** sie aus und zeigt eine kleine orangefarbene Markierung. **Abweichung** und **Budgetdeckung** bleiben leer, da die Deckung unbekannt ist. Ein einzeiliger Hinweis unter der Liste nennt die ausgelassenen Zeilen, zum Beispiel „1 Zeile ohne Wechselkurs ausgeschlossen: USD 2026.“ Siehe [Manuelle Kurse](currencies.md#manuelle-kurse). Ohne das Budgetrecht sind diese Spalten, die Auswahl und die beiden Budget-Schnellfilter ausgeblendet.

### Summenzeile

Die unten angeheftete Zeile lautet **Gesamt (n Verträge)**. Sie summiert die Jahresbeträge der angezeigten Verträge, umgerechnet in Ihre Berichtswährung mit den letzten Kursen des Jahres, sowie die drei Budgetspalten. Eine Währung ohne Kurs bleibt außerhalb der Summe und wird genannt, zum Beispiel „ohne 2 Verträge in GBP (kein Kurs)“.

### Suche, Filter und Bereich

- **Schnellsuche**: Vertragsname, Lieferant und Unternehmen
- **Spaltenfilter**: in jeder Spaltenüberschrift. **Stand**, **Konformität** und **Budgetdeckung** bieten ihre Werte als Kontrollkästchen an. Der Filter **Status** zeigt die Auswahl von **Anzeigen** (**Alle**, **Aktiv** oder **Deaktiviert**): Eine Änderung an einem ändert auch das andere
- **Anzeigen: Alle / Aktiv / Deaktiviert**: der Umschalter über der Liste. Standardmäßig zeigt die Liste aktivierte Verträge. Wählen Sie **Alle** oder **Deaktiviert**, um Verträge zu finden, deren Ende der Gültigkeit überschritten ist

### Aktionen

- **Neu**: einen Vertrag anlegen (`contracts:member`)
- **Importieren** und **Exportieren**: siehe [CSV-Import und -Export](#csv-import-und-export) (`contracts:admin`)
- **Register exportieren**: das Konformitätsregister der Verträge, die die Liste zeigt (`contracts:admin`). Siehe [Konformität](#konformitat)
- **Einstellungen**: der Entscheidungszeitraum des Arbeitsbereichs (`contracts:admin`). Siehe [Entscheidungszeitraum](#entscheidungszeitraum)
- **Löschen**: die angehakten Verträge löschen (`contracts:admin`). Siehe [Einen Vertrag löschen](#einen-vertrag-loschen)

---

## Die Vertragsseite

### Kopfzeile und Eigenschaften

Die Kopfzeile zeigt den Vertragsnamen (zum Umbenennen anklicken), **Zurück** / **Weiter** mit der Position in der Liste und eine Leiste mit **Lieferant**, **Vertragsunternehmen**, **Verantwortlicher** und **Status**. Verantwortlicher und Status ändern Sie direkt dort. Lieferant und Unternehmen öffnen den Bereich **Eigenschaften**.

Der Bereich **Eigenschaften** rechts enthält alle Felder des Vertrags: die Parteien, **Beginn**, **Laufzeit (Monate)**, **Kündigungsfrist (Monate)**, **Stillschweigende Verlängerung**, **Jahresbetrag**, **Währung**, **Abrechnung**, dann **Lebenszyklus** (**Status** und **Ende der Gültigkeit**), **Erstellt** und **Aktualisiert**. Öffnen oder schließen Sie ihn mit seiner Schaltfläche; KANAP merkt sich Ihre Wahl.

**Kostenstelle oder Gruppe** ist optional. Das Feld ordnet den Vertrag für den [Datenzugriff](data-access.md) einer Kostenstelle oder Gruppe zu: Die auf diesen Knoten oder auf eine Gruppe darüber begrenzten Personen sehen den Vertrag, ebenso wie die auf sein Unternehmen begrenzten.

Jede Änderung speichert sich selbst: Auswahllisten und Daten sofort, eingetippte Werte und Notizen nach einer kurzen Pause, der Name beim Verlassen des Felds. „Wird gespeichert...“ und dann „Gespeichert“ erscheint in der Kopfzeile. Zwei Personen, die denselben Vertrag bearbeiten, werden nicht gewarnt: Die letzte Änderung gilt.

**Lebenszyklus**:

- Ein Wechsel auf **Deaktiviert** setzt das Ende der Gültigkeit auf jetzt: Die Deaktivierung gilt sofort. Solange ein zukünftiges Datum gesetzt ist, zeigt der Schalter **Aktiv bis** und dieses Datum. Zurück auf **Aktiviert** entfernt das Ende der Gültigkeit
- **Ende der Gültigkeit**: Geben Sie ein Datum ein (TT.MM.JJJJ) oder nutzen Sie den Kalender. Leer lassen, damit der Vertrag aktiv bleibt
- **Stillschweigende Verlängerung** folgt eigenen Regeln, wenn der Vertrag bereits verlängert wurde oder auf eine Entscheidung wartet. Siehe [Stillschweigende Verlängerung beenden oder wieder aktivieren](#stillschweigende-verlangerung-beenden-oder-wieder-aktivieren)

Zum Bearbeiten benötigen Sie `contracts:member`. Leser sehen dieselbe Seite mit gesperrten Feldern.

**Teilen** in der Kopfzeile schickt Kollegen Ihres Arbeitsbereichs einen Link zum Vertrag per E-Mail.

Die Seite hat vier Reiter: **Übersicht**, **Budget**, **Konformität** und **Verknüpfungen**. Die Adressen der früheren Reiter **Details** und **Aufgaben** öffnen die Übersicht.

### Übersicht

**Fristen** fasst zusammen, wo der Vertrag steht:

- Ein Satz zum nächsten Schritt: „Kündigung möglich bis 30. Dez. 2026 · in 78 Tagen“, „Kündigungstermin verstrichen, verlängert bis 30. Juni 2027“, „Endet am 31. März 2027 ohne Verlängerung“ oder „Abgelaufen am 31. Dez. 2025“. Steht eine Entscheidung über das Ende eines Vertrags ohne Verlängerung an, ergänzt der Satz „Entscheidung ausstehend“ mit einem orangefarbenen Punkt
- Eine Zeitleiste der Perioden: vergangene Perioden, die laufende Periode, heute, der nächste Kündigungstermin und der Entscheidungszeitraum davor. Die nächste Periode ist gestrichelt, solange sie noch gekündigt werden kann, und durchgezogen, sobald der Kündigungstermin verstrichen ist
- Eine Zeile mit Fakten: die laufende Periode mit ihren Daten, wie oft der Vertrag seit wann verlängert wurde, und die Kündigungsfrist

Ist eine Verlängerung bestätigt, lautet der Satz „Verlängerung bestätigt · nächste Periode vom 1. Juli 2027 bis 30. Juni 2028“, und die Zeitleiste zeigt diesen Kündigungstermin nicht mehr.

Die Seite berechnet diese Daten neu, während Sie Beginn, Laufzeit, Kündigungsfrist oder Verlängerung ändern.

**Verlängerungsentscheidung**: Steht eine Entscheidung an, erscheint unter den Fristen ein orange umrandeter Kasten. Siehe [Verlängerungsentscheidungen](#verlangerungsentscheidungen).

**Aufgaben**: die offenen Aufgaben des Vertrags mit Referenz, Zuständigem, Fälligkeitsdatum und Status. **Abgeschlossene Aufgaben anzeigen (n)** blendet die erledigten ein. **Neue Aufgabe** legt eine mit dem Vertrag verknüpfte Aufgabe an. Öffnen Sie eine Aufgabe, um sie zu ändern oder zu löschen.

**Notizen**: freier Text mit Markdown-Formatierung. Die Werkzeugleiste erscheint, wenn Sie in den Editor klicken.

### Budget

Der Reiter listet die verknüpften Budgetzeilen, OPEX und CAPEX zusammen, mit Referenz (`BL-12`), Name, Typ und Unternehmen. Mit der Auswahl unter der Tabelle verknüpfen oder entfernen Sie Zeilen. Eine Zeile, deren zahlendes Unternehmen, Kostenstelle, Lieferant oder Währung vom Vertrag abweicht, zeigt eine kleine orangefarbene Markierung. Fahren Sie mit der Maus über die Markierung, um jeden Unterschied zu sehen, mit dem Wert auf der Zeile und dem Wert auf dem Vertrag. Die Auswahl zeigt dieselbe Markierung an einer Zeile, bevor Sie sie verknüpfen. Die Verknüpfung bleibt möglich. Die Markierung erscheint für eine Zeile, die Sie lesen dürfen.

Mit Lesezugriff auf Budgetzeilen (`budget:reader`) zeigt der Reiter auch Zahlen:

- Jahresreiter und eine Auswahl **Spalte**, dieselbe Wahl wie bei den Budgetspalten der Liste
- Der Betrag jeder Zeile in diesem Jahr und dieser Spalte, mit einer Zeile **Gesamt (n Zeilen)**
- **Verpflichtung und Deckung**: eine Zeile pro angebotenem Jahr, das gewählte Jahr hervorgehoben. Klicken Sie auf eine Zeile, um ihr Jahr zu wählen

Angeboten werden das laufende Jahr und die zwei folgenden, dazu das Vorjahr, wenn das Budget Zeilen dafür enthält.

#### Verpflichtung und Deckung

**Durch den Vertrag verpflichtet** ist der Jahresbetrag bei Unterzeichnung, verteilt auf die Monate des Jahres, die eine Periode abdeckt. Ein teilweise abgedeckter Monat zählt nach seinen Tagen. Die Folgejahre gehen davon aus, dass die Verlängerung weiterläuft, bis sie beendet wird, und nach dem Ende der Gültigkeit oder dem Vertragsende ist nichts verpflichtet. Der Betrag bei Unterzeichnung gilt für jede Periode. Die Verpflichtung wird mit den Kursen des Jahres in Ihre Berichtswährung umgerechnet.

Ein Vertrag über 350 000 pro Jahr, der sich jeden 1. Juli verlängert, verpflichtet zum Beispiel 350 000 in jedem Jahr. Endet er am 30. Juni 2027, verpflichtet er 175 000 im Jahr 2027 und nichts im Jahr 2028.

**Verknüpfte Zeilen** summiert die Beträge der verknüpften Zeilen in diesem Jahr und dieser Spalte. **Abweichung** ist die Differenz. Der Stand ist der erste, der zutrifft:

- **Keine Verpflichtung**: Der Vertrag verpflichtet in diesem Jahr nichts, und keine verknüpfte Zeile hat einen Betrag
- **Budget noch nicht begonnen**: Keine Budgetzeile Ihres Arbeitsbereichs hat einen Betrag in diesem Jahr und dieser Spalte
- **Keine Budgetzeile**: Keine verknüpfte Zeile hat einen Betrag
- **Unterbudgetiert**: Die verknüpften Zeilen enthalten weniger als die Verpflichtung
- **Budget über dem Vertrag**: Die verknüpften Zeilen enthalten mehr als die Verpflichtung plus 10 %
- **Gedeckt**: alle anderen Fälle

Für eine Person mit begrenztem Datenzugriff listet der Tab die verknüpften Zeilen, die sie sieht, und dann die Anzahl der anderen. Die Deckung zählt weiterhin alle verknüpften Zeilen, damit der Verantwortliche des Vertrags die tatsächliche Deckung sieht. In der Liste zeigt jede Zeile ebenfalls diese vollständige Deckung, während die Summenzeile die sichtbaren Verträge und **Verknüpfte Zeilen** die sichtbaren Zeilen zählt. Siehe [Datenzugriff](data-access.md#what-a-limited-person-sees).

Hat eine verknüpfte Zeile für ein Jahr keinen Wechselkurs, erscheint ihr Betrag in ihrer eigenen Währung mit einer kleinen orangefarbenen Markierung, und die Summe sowie **Verknüpfte Zeilen** lassen sie aus. Der Stand dieses Jahres lautet **Unbekannt: eine verknüpfte Zeile hat keinen Wechselkurs**. Ein einzeiliger Hinweis unter der Deckungstabelle nennt die ausgelassenen Zeilen, zum Beispiel „1 Zeile ohne Wechselkurs ausgeschlossen: USD 2026.“ Siehe [Fehlender Kurs](currencies.md#umrechnungsmechanismen-kurzreferenz) und [Manuelle Kurse](currencies.md#manuelle-kurse).

### Konformität

Der Reiter listet die Klauseln, die ein Vertrag angesichts der abgedeckten Anwendungen enthalten sollte, und lässt Sie festhalten, ob der Vertrag sie enthält. Er hilft Ihnen, ein Register zu führen. Er bescheinigt keine Konformität mit einer Vorschrift.

**Anforderungen**: **Auftragsverarbeitungsvertrag nach DSGVO (Art. 28)**, **Speicherort der Daten**, **Reversibilitätsklausel**, **Exit-Plan**, **Auditrecht und Sicherheitsklauseln**.

**Warum eine Anforderung erwartet wird**: Der Vertrag deckt die mit ihm verknüpften Anwendungen ab, außerdem die Anwendungen mit einer Instanz auf einem Asset, das mit ihm verknüpft ist oder dessen Supportvertrag er ist. Eine Anwendung, deren Ende der Gültigkeit verstrichen ist, zählt nicht mehr.

- Eine Anwendung mit personenbezogenen Daten macht den Auftragsverarbeitungsvertrag und den Speicherort der Daten erwartet
- Eine hohe geschäftliche oder Cyber-Kritikalität macht die Reversibilitätsklausel, den Exit-Plan und das Auditrecht erwartet. Hoch bedeutet die zwei strengsten Stufen Ihres Katalogs (nur die strengste, wenn der Katalog weniger als drei Stufen hat)
- Eine in der Cloud gehostete Instanz macht den Speicherort der Daten erwartet. Die Kategorie des Hosting-Typs unter **IT-Landschaft > Einstellungen** entscheidet, was als Cloud gilt

Die Spalte **Erwartet wegen** nennt den ersten Grund, zum Beispiel „SAP S/4HANA enthält personenbezogene Daten“, dann „und n weitere“. Fahren Sie mit der Maus darüber, um alle zu lesen. Ein Grund, der über ein Asset kommt, nennt es, wenn Sie die Infrastruktur lesen können. Eine Anwendung, die Sie nicht lesen können (oder, für einen Business Contributor, eine, an der Sie nicht beteiligt sind), erscheint als „Eine Anwendung, die Sie nicht sehen“: Die Anforderung bleibt erwartet.

**Erfassen**: Wählen Sie für jede Anforderung einen Stand: **Vorhanden**, **Fehlt** oder **Nicht zutreffend**. Er wird sofort gespeichert. Eine erwartete Anforderung ohne Stand zeigt **Zu prüfen**. Geben Sie eine **Referenz** ein (zum Beispiel „Artikel 18.3“); sie wird gespeichert, wenn Sie das Feld verlassen oder die Eingabetaste drücken. Fahren Sie mit der Maus über eine Zeile, um zu sehen, wann und von wem sie zuletzt aktualisiert wurde.

**Weitere Anforderungen anzeigen (n)** blendet die Anforderungen ein, die nichts erfordert, damit Sie auch diese erfassen können. Wird nichts erwartet, sagt der Reiter das in einer Zeile.

Das Abzeichen des Reiters zählt die erwarteten Anforderungen, die als fehlend erfasst sind. In der Liste zeigt die Spalte **Konformität**:

- **n fehlen** (und „· n zu prüfen“), in Orange
- **n zu prüfen**
- **Vollständig**: Jede erwartete Anforderung ist vorhanden oder nicht zutreffend
- **Keine Erwartung**

Das Verknüpfen oder Entfernen einer Anwendung oder eines Assets unter **Verknüpfungen** aktualisiert den Reiter sofort. Zum Erfassen benötigen Sie `contracts:member`; Leser sehen den Reiter schreibgeschützt.

**Register exportieren** (Liste, `contracts:admin`) lädt eine CSV- oder Excel-Datei der Verträge herunter, die die Liste mit ihrer Suche, ihren Filtern, ihrem Bereich und ihrer Reihenfolge zeigt: eine Zeile pro Vertrag und Anforderung, mit der Angabe, ob sie erwartet wird, dem Grund, dem Stand, der Referenz und der letzten Aktualisierung. Überschriften und Begriffe folgen der Sprache Ihres Bildschirms.

### Verknüpfungen

Der Reiter Verknüpfungen zeigt, was dieser Vertrag abdeckt: seine Anwendungen, Assets und Technologien, jeweils in einer eigenen Tabelle, danach Vorschläge, die Kontakte sowie Links und Dateien. Klicken Sie auf eine Zeile, um den Datensatz zu öffnen. Budgetzeilen werden im Reiter [Budget](#budget) verknüpft.

**Verknüpfte Datensätze**, jeweils eine Tabelle:

| Abschnitt | Spalten |
|---|---|
| **Anwendungen** | Referenz (`APP-3`), Name, Lebenszyklus, Geschäftskritikalität. Nur sichtbar, wenn Sie die Anwendungen lesen dürfen. Ein Business Contributor sieht die Anwendungen, an denen er beteiligt ist |
| **Assets** | Referenz (`AST-12`), Name, Typ, Umgebung, Status. Nur sichtbar, wenn Sie die Infrastruktur lesen dürfen |
| **Technologien** | Referenz (`TEC-5`), Name, Familie, Hersteller. Nur sichtbar, wenn Sie die Infrastruktur lesen dürfen |

Eine deaktivierte oder ausgemusterte Anwendung oder ein solches Asset bleibt mit ausgegrautem Namen aufgeführt. Die Anwendungen und Assets speisen den Reiter [Konformität](#konformitat). Ein Asset, dessen Supportvertrag auf der Asset-Seite auf diesen Vertrag gesetzt ist, erscheint hier nicht. Für die Konformität zählt es trotzdem.

**Verknüpfungen hinzufügen und entfernen** (`contracts:member`): **Hinzufügen** rechts neben einem Abschnitt öffnet eine Suche. Geben Sie einen Namen oder eine Referenz ein und wählen Sie ein Ergebnis: Die Verknüpfung wird sofort gespeichert. Die Suche bietet die Anwendungen und Assets an, die Sie sehen dürfen. Ausgemusterte Technologien werden nicht angeboten. Um eine Verknüpfung zu entfernen, fahren Sie mit der Maus über die Zeile und klicken Sie auf das Kreuz am Zeilenende. Das Entfernen einer Verknüpfung löscht nichts anderes. Das Verknüpfen einer Anwendung erfordert zusätzlich Leserechte auf die Anwendungen, das Verknüpfen eines Assets oder einer Technologie Leserechte auf die Infrastruktur. Ein Business Contributor verknüpft und entfernt nur die Anwendungen, an denen er beteiligt ist; die übrigen Anwendungen des Vertrags bleiben verknüpft. Leser sehen die Tabellen schreibgeschützt.

**Verwandt**: die Anwendungen und Assets des Lieferanten des Vertrags, die noch nicht verknüpft sind, mit dem Grund „gleicher Lieferant“. Ein Asset gehört über seinen Supportlieferanten zum Lieferanten. Klicken Sie auf **Verknüpfen**, um den Vorschlag seinem Abschnitt hinzuzufügen. Die Vorschläge zeigen:

- Anwendungen in Betrieb, wenn Sie die Anwendungen lesen dürfen. Ein Fachbereichs-Mitwirkender sieht nur die Anwendungen, an denen er beteiligt ist;
- Assets, die nicht ausgemustert sind, wenn Sie die Infrastruktur lesen dürfen;
- höchstens 20 je Typ.

Der Abschnitt fehlt, wenn es nichts vorzuschlagen gibt.

**Kontakte**: Personen zu diesem Vertrag, jede mit einer Rolle (Vertrieb, Technik, Support oder Sonstige). **Kontakte des Lieferanten übernehmen** übernimmt die Kontakte des Lieferanten mit einem Klick.

**Links und Dateien**: die Weblinks des Vertrags (das unterschriebene PDF online, das Lieferantenportal) und seine Dateien, je eine Zeile mit Name, der Domain des Links oder der Größe der Datei und dem Datum, an dem sie hinzugefügt wurden. Klicken Sie auf einen Link, um ihn in einem neuen Tab zu öffnen, oder auf eine Datei, um sie herunterzuladen. Mit `contracts:member`:

- **Link hinzufügen** öffnet einen Dialog für eine URL und einen optionalen Namen; der Link wird sofort gespeichert. Um einen Link zu ändern, fahren Sie mit der Maus über seine Zeile und klicken Sie auf den Stift.
- **Datei anhängen** öffnet die Dateiauswahl. Sie können Dateien auch auf den Abschnitt ziehen.
- Um einen Link oder eine Datei zu entfernen, fahren Sie mit der Maus über die Zeile und klicken Sie auf das Kreuz. Das Entfernen eines Links zeigt eine Meldung und bietet **Rückgängig** an, womit der Link wieder angelegt wird. Das Löschen einer Datei fragt zuerst nach einer Bestätigung.

### Einen Vertrag löschen

**Löschen** (Papierkorbsymbol) in der Kopfzeile der Vertragsseite, oder in der Liste für die angehakten Verträge, löscht Verträge (`contracts:admin`). Dies kann nicht rückgängig gemacht werden.

- Die Verknüpfungen werden entfernt, die verknüpften Elemente bleiben erhalten: Budgetzeilen, Anwendungen, Assets (auch die, deren Supportvertrag er ist) und Kontakte verlieren ihre Verknüpfung mit dem Vertrag
- Was zum Vertrag gehört, wird mit ihm gelöscht: seine Aufgaben (auch die Aufgabe zur Verlängerungsentscheidung), relevanten Websites und Anhänge
- Ein Vertrag mit erfassten Konformitätsanforderungen (ein Status, auch **Nicht zutreffend**, oder eine Referenz) kann nicht gelöscht werden: KANAP nennt ihre Anzahl und schlägt vor, ihn stattdessen zu deaktivieren. In der Liste nennt die Bestätigung die erhaltenen Verträge mit ihrer Anzahl, bevor etwas gelöscht wird; die übrigen werden gelöscht
- Zuerst kommt immer eine Bestätigung. Sie zählt, was seine Verknüpfung verliert und was ebenfalls gelöscht wird, oder sagt, dass der Vertrag mit nichts verknüpft ist

Um einen Vertrag nicht mehr zu nutzen und seinen Verlauf zu behalten, deaktivieren Sie ihn stattdessen.

---

## Verlängerungsentscheidungen

KANAP bittet den Verantwortlichen, über jede Verlängerung zu entscheiden, bevor sie eintritt, und speichert die Entscheidung.

### Entscheidungszeitraum

Ein Vertrag mit stillschweigender Verlängerung wartet auf eine Entscheidung, wenn sein nächster Kündigungstermin in den Entscheidungszeitraum fällt. Ein Vertrag ohne Verlängerung wartet auf eine, wenn sein Ende in den Zeitraum fällt. Der Zeitraum beträgt standardmäßig 90 Tage. Vertragsadministratoren ändern ihn mit **Einstellungen** in der Liste, von 0 bis 365 Tagen.

Der Zeitraum steuert den Stand **Zu entscheiden**, den Schnellfilter, den Entscheidungskasten, die Zeitleiste und die Entscheidungsaufgaben.

### Die Entscheidungsaufgabe

Jeden Tag um 07:30 UTC legt KANAP für jeden Vertrag, der auf eine Entscheidung wartet, eine Aufgabe an:

- **Über die Verlängerung von** dem Vertrag **entscheiden**, fällig am Kündigungstermin, für einen Vertrag mit stillschweigender Verlängerung
- **Entscheiden, ob** der Vertrag **verlängert wird oder ausläuft**, fällig an seinem Ende, für einen Vertrag ohne Verlängerung

Die Aufgabe wird dem Verantwortlichen des Vertrags zugewiesen, mit der üblichen Zuweisungs-E-Mail. Ihr Text ist in der Sprache des Verantwortlichen, oder in der Sprache des Arbeitsbereichs, wenn der Verantwortliche keine gewählt hat. Es gibt eine Aufgabe pro Vertrag und Periode. Eine gelöschte Aufgabe wird für diese Periode nicht neu angelegt. Ein Vertrag ohne Verantwortlichen erhält keine Aufgabe, bis einer eingetragen ist.

Entscheidungskasten und Aufgabe bleiben im Gleichschritt: Eine im Kasten getroffene Entscheidung schließt die Aufgabe, mit der Begründung als Kommentar.

### Entscheiden

Der Kasten zeigt den Kündigungstermin, die verbleibenden Tage, die Aufgabe und ihren Zuständigen sowie das, was ohne Entscheidung geschieht („Ohne Entscheidung verlängert sich der Vertrag am 1. Juli 2027 um 12 Monate.“). Geben Sie optional eine **Begründung** ein und wählen Sie dann:

- **Verlängern**: Die Verlängerung ist für diese Periode bestätigt. Die Aufgabe wird geschlossen, der Vertrag verlässt **Zu entscheiden** und kommt am Kündigungstermin der nächsten Periode wieder in den Zeitraum
- **Neu verhandeln**: Der Kasten zeigt **Neuverhandlung läuft**, und die Aufgabe bleibt bis zur endgültigen Entscheidung offen. Der Vertrag bleibt **Zu entscheiden**
- **Kündigen**: Der Kasten zeigt das zu bestätigende Enddatum. KANAP schlägt das früheste Ende vor, das die Kündigungsfrist zulässt („Kündigungsfrist von 6 Monaten: Das frühestmögliche Ende ist der 30. Juni 2027.“). Sie können einen anderen Tag wählen, ab heute und ab Vertragsbeginn. Ein Tag vor dem vorgeschlagenen zeigt eine orangefarbene Warnung: Der Lieferant muss zustimmen. Der Kasten listet die Folgen für diesen Tag: die Verpflichtung des Jahres und des folgenden, die Anwendungen, die diesen Vertrag verlieren, und die Assets, die ihren Supportvertrag verlieren, jeweils wenn Sie das zugehörige Modul lesen dürfen. **Kündigung bestätigen** beendet die stillschweigende Verlängerung, setzt das Ende der Gültigkeit auf diesen Tag und schließt die Aufgabe. Der Vertrag zeigt dann **Endet ohne Verlängerung**, und seine Verpflichtung endet an diesem Tag

Bei einem Vertrag ohne Verlängerung zeigt der Kasten „Ende am 31. März 2027 · Entscheidung ausstehend“ und bietet zwei Aktionen:

- **Verlängern**: aktiviert die stillschweigende Verlängerung wieder und entfernt das Ende der Gültigkeit
- **Auslaufen lassen**: bestätigt das Ende. Sonst ändert sich nichts

Nach der Entscheidung schrumpft der Kasten auf eine Zeile, zum Beispiel „Verlängerung am 2. Okt. 2026 von Sophie Laurent bestätigt. Der Vertrag verlängert sich am 1. Juli 2027.“, mit der Aufgabe und der Begründung. Nach einer Kündigung erinnert er daran, das Kündigungsschreiben vor dem Kündigungstermin zu senden und unter **Verknüpfungen** anzuhängen.

**Entscheidung zurücknehmen** stellt den vorherigen Zustand von Vertrag und Aufgabe wieder her: vor dem Kündigungstermin, oder vor dem Ende bei einem Vertrag ohne Verlängerung.

Zum Entscheiden benötigen Sie `contracts:member`. Leser sehen den Kasten ohne seine Aktionen.

### Stillschweigende Verlängerung beenden oder wieder aktivieren

**Stillschweigende Verlängerung** im Bereich **Eigenschaften** folgt denselben Regeln.

**Nein** bei einem bereits verlängerten Vertrag, oder bei einem, der auf eine Verlängerungsentscheidung wartet, öffnet **Stillschweigende Verlängerung beenden**. Das Fenster schlägt ein Enddatum wie bei einer Kündigung vor (frühestes Ende laut Kündigungsfrist, jeder Tag ab heute, orangefarbene Warnung vor dem vorgeschlagenen Tag, Folgen für den gewählten Tag) und sagt „Der Vertrag endet am 30. Juni 2027, sofern er nicht verlängert wird.“ Bei einem bereits verlängerten Vertrag ergänzt es, dass seine bisherigen Perioden erhalten bleiben. **Verlängerung beenden** setzt dieses Ende der Gültigkeit, und das Feld zeigt **Nein**. **Abbrechen** ändert nichts.

Dabei wird keine Entscheidung gespeichert. Der Vertrag wartet nun auf eine Entscheidung über sein Ende: Eine offene Entscheidungsaufgabe wird zu „Entscheiden, ob“ der Vertrag „verlängert wird oder ausläuft“, fällig am neuen Ende, mit einem Kommentar, der den Grund nennt. Ohne offene Aufgabe wird eine angelegt, wenn das Ende in den Zeitraum fällt.

Bei einem Vertrag in seiner ersten Periode, für den keine Entscheidung ansteht, wirkt **Nein** sofort: Der Vertrag endet mit seiner ersten Periode.

**Ja** bei einem Vertrag ohne Verlängerung, der ein Ende der Gültigkeit hat, öffnet **Stillschweigende Verlängerung wieder aktivieren**: „Der Vertrag verlängert sich stillschweigend und das Ende am 31. März 2027 entfällt.“ **Verlängerung wieder aktivieren** wendet das an, gleich woher dieses Ende stammt. Stand eine Entscheidung über das Ende an, zählt das als **Verlängern** und lässt sich zurücknehmen. Andernfalls wird die offene Aufgabe zum Ende zur Aufgabe der Verlängerungsentscheidung, wenn diese Entscheidung ansteht, oder sie wird geschlossen. Ohne Ende der Gültigkeit wirkt **Ja** sofort.

---

## CSV-Import und -Export

Der Export schreibt eine CSV-Datei oder eine Excel-Arbeitsmappe (`.xlsx`): Wählen Sie unter **Format** im Dialog. Der Import liest beides. Siehe [CSV- und Excel-Dateien](csv-files.md).

Halten Sie Ihre Vertragsliste mit CSV-Dateien oder Excel-Arbeitsmappen mit anderen Werkzeugen synchron (`contracts:admin`).

**Export**: lädt die Verträge der Liste (oder, auf Wunsch im Dialog, alle Verträge) mit diesen Spalten herunter: `name`, `company_name`, `supplier_name`, `start_date`, `duration_months`, `auto_renewal`, `notice_period_months`, `yearly_amount_at_signature`, `currency`, `billing_frequency`, `status`, `owner_email`, `notes`. Die berechneten Daten (Laufzeitende, Kündigungstermine, Stand) werden nicht exportiert.

**Import**:

- Verwenden Sie die **Vorprüfung**, um die Datei vor dem Anwenden zu prüfen
- Eine Zeile wird einem Vertrag über Vertragsnamen und Lieferant zugeordnet
- Unterstützt Neuanlage und Aktualisierungen
- Die Datei hat keine Spalte für das Ende der Gültigkeit. Bei einer Aktualisierung behält ein leeres `status`, oder eines, das dem aktuellen Status des Vertrags entspricht, sein Ende der Gültigkeit. Ein abweichender Status wird angewendet: `enabled` löscht das Ende der Gültigkeit, und `disabled` beendet den Vertrag heute, sofern sein Ende der Gültigkeit nicht bereits vergangen ist
- Ein neuer Vertrag ist aktiviert, sofern die Zeile nicht `disabled` angibt
- Eine Zeile, die `auto_renewal` bei einem bereits verlängerten Vertrag ohne Ende der Gültigkeit auf false setzt, wird abgelehnt, auch in der Vorprüfung: Sie würde die Perioden löschen, die der Vertrag durchlaufen hat. Beenden Sie die Verlängerung auf der Vertragsseite, die das Ende setzt

**Hinweise**:

- Siehe [CSV- und Excel-Dateien](csv-files.md) für die Kodierung, das Trennzeichen, die Datums- und Betragsformen und die beiden Importschritte
- Die Daten werden aus Beginn, Laufzeit, Kündigungsfrist und Verlängerung berechnet; sie werden nie importiert

---

## Tipps

- **Tragen Sie bei jedem Vertrag einen Verantwortlichen ein**: Die Aufgaben zur Verlängerungsentscheidung gehen an ihn. Ein Vertrag ohne Verantwortlichen erhält keine Aufgabe.
- **Beginnen Sie die Woche mit Zu entscheiden**: Der Schnellfilter listet die Verträge, deren Entscheidung ansteht, und der Entscheidungskasten jedes Vertrags zeigt, was ohne Entscheidung geschieht.
- **Verknüpfen Sie Budgetzeilen früh**: **Abweichung** und der Filter **Unterbudgetiert** helfen nur, wenn der Vertrag mit den Zeilen verknüpft ist, die ihn bezahlen.
- **Erfassen Sie den Jahresbetrag**: Auch bei monatlicher Abrechnung speist der Jahresbetrag die Verpflichtung und die Summen.
- **Verknüpfen Sie Anwendungen und Assets**: Sie entscheiden, welche Klauseln der Vertrag enthalten sollte.
- **Teilen Sie einen Vertrag**: Nutzen Sie **Teilen** oder kopieren Sie die Adresse der Seite. Sie öffnet denselben Reiter und behält Ihren Listenkontext.
