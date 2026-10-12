# Portfolio-Berichte

Portfolio-Berichte bieten Analysen mit Fokus auf Arbeitslast, Kapazität und Umsetzungssignale.

## Erste Schritte

Navigieren Sie zu **Portfolio > Berichte**, um den Berichtshub zu öffnen.

**Berechtigungen**:
- Sie benötigen mindestens `portfolio_reports:reader`, um auf Portfolio-Berichte zuzugreifen.

Wenn Sie Berichte nicht im Menü sehen, bitten Sie Ihren Administrator, Ihnen Zugriff zu gewähren.

---

## Berichts-Startseite

Die Startseite der Portfolio-Berichte listet verfügbare Portfolio-Berichte als Karten auf, in drei Reihen, die nach Zeithorizont gelesen werden. Klicken Sie auf eine Karte, um den Bericht zu öffnen.

**Was passiert ist**
- **Periodenrückblick**: Anfragen, Projekte und Aufgaben, die in einem Zeitraum erstellt, geändert und geschlossen wurden.
- **Aktivität nach Person**: dieselbe Seite, geöffnet auf ihrer Sicht der Aufgaben nach Person.
- **Erfasste Zeit**: wohin die erfassten Tage gehen, Monat für Monat: Projekte oder andere Arbeit, Team für Team.

**Was gerade läuft**
- **Fluss und Alter**: was Woche für Woche hinzukommt und abgeschlossen wird, wie alt die offene Arbeit ist und wie lange ein Abschluss dauert.
- **Handlungsbedarf nach Mitwirkenden**: offene, überfällige und liegengebliebene Aufgaben, Team für Team und Person für Person.

**Was als Nächstes kommt**
- **Demnächst**: fällig werdende Aufgaben, geplante Projektenden und -starts, zu lange wartende Anfragen und gewünschte Liefertermine.
- **Kapazitäts-Heatmap**: erwarteter Aufwand im Vergleich zur Kapazität, für Mitwirkende und Teams.

---

## Steuerung

Der erste Streifen über den Berichtskarten ist die tägliche Steuerungsansicht. Er beantwortet zwei Fragen: Was hat sich zuletzt bewegt, und was wartet auf jemanden.

### Der Zeitraum

Die Kopfzeile zeigt den verwendeten Zeitraum und erlaubt den Wechsel zwischen den letzten 7, 30 und 90 Tagen. Der Zeitraum endet immer heute und wird in Ihrer eigenen Zeitzone gelesen. Ihre Wahl wird in diesem Browser gemerkt.

### Fluss

Eine Zeile je Entität liest sich so: **14 erstellt · 9 abgeschlossen · 52 offen (+5)**.

- **Erstellt**: Elemente, die im Zeitraum angelegt wurden und heute noch vorhanden sind.
- **Abgeschlossen**: Elemente, die der letzte Statuswechsel des Zeitraums geschlossen hinterlassen hat. Die Anlage zählt als Statuswechsel: Ein bereits erledigt angelegtes Element zählt als abgeschlossen. Geschlossen heißt Erledigt oder Abgebrochen bei Aufgaben und Projekten, Abgelehnt oder Umgewandelt bei Anfragen.
- **Offen**: Elemente, die gerade offen sind, unabhängig davon, was im Zeitraum geschah. Diese Zahl ist ein Link auf die passende Liste.
- **(+5)**: die Nettoveränderung, nur sichtbar, wenn sie nicht null ist. Sie ist erstellt, plus wieder geöffnet, minus abgeschlossen. Wieder geöffnet sind Elemente, die aus einem geschlossenen Status zurück in einen offenen gewechselt sind. Fahren Sie über die Zahl, um die Formel zu sehen.

Erstellt und abgeschlossen stammen aus der Änderungshistorie. Sie erfassen damit jeden Schreibweg: die Anwendung, einen CSV-Import und die Agenten. Kein Listenfilter bildet diese Historie nach, deshalb öffnen diese beiden Zahlen den **Periodenrückblick** für dieselben Tage. Seine Listen der erstellten und abgeschlossenen Elemente zeigen genau die hier gezählten Elemente. Eine Null ist kein Link.

### Welche Aufgaben zählen

Jede Aufgabenzahl zählt nur eigenständige Aufgaben und Projektaufgaben. Aufgaben an einem Vertrag, einer Ausgabenzeile, einer CAPEX-Zeile oder einem Vorfall gehören zu jenen Abläufen und bleiben in diesem Streifen überall außen vor.

### Handlungsbedarf

Die letzte Zeile erscheint nur, wenn etwas eine Entscheidung braucht:
- **Überfällige Aufgaben**: offene Aufgaben, deren Fälligkeitsdatum vor heute liegt. Die Zahl öffnet die Aufgabenliste, gefiltert auf dieselben Elemente.
- **Aufgaben ohne zuständige Person**: offene Aufgaben, die niemand trägt. Die Aufgabenliste kennt keinen Filter auf eine leere Zuständigkeit, deshalb ist diese Zahl kein Link.
- **Projekte seit 30 Tagen ohne Aktivität**: Projekte in Arbeit oder im Test, bei denen seit einem Monat nichts geschehen ist. Ein Klick öffnet eine kurze Liste dieser Projekte mit dem Datum ihrer letzten Aktivität, und jeder Name öffnet das Projekt.

Aktivität wird weit gefasst. Ein Projekt gilt als aktiv, sobald sich etwas an ihm oder an einer seiner Aufgaben geändert hat, sobald jemand in sein Journal geschrieben hat, oder sobald Zeit auf das Projekt oder auf eine seiner Aufgaben gebucht wurde. Ein Projekt erscheint hier nur, wenn all das älter als 30 Tage ist.

---

## Zu klassifizieren

Über den Berichtskarten zeigt ein kompakter Streifen, wie viel Ihrer offenen Arbeit noch keinen Klassifizierungswert hat. Nutzen Sie ihn als tägliche Steuerungshilfe: Lücke sehen, anklicken, schließen.

### Was gezählt wird

Eine Zeile je Entität, nur für offene Elemente:
- **Aufgaben**: Status außer Erledigt und Abgebrochen.
- **Anfragen**: Status außer Abgelehnt und Umgewandelt.
- **Projekte**: Status außer Erledigt und Abgebrochen.

Jede Zeile nennt, wie viele dieser Elemente keine Quelle, keine Kategorie und keinen Stream haben. Bei Aufgaben kommt hinzu, wie viele keinen Aufgabentyp haben.

### Welche Aufgaben ausgeschlossen sind

Gezählt werden nur eigenständige Aufgaben und Projektaufgaben. Aufgaben an einem Vertrag, einer Ausgabenzeile, einer CAPEX-Zeile oder einem Vorfall tragen nie eine Klassifizierung. Sie zu zählen würde eine Lücke melden, die niemand schließen kann.

Eine Projektaufgabe ohne eigene Klassifizierung erbt die ihres Projekts, und die Aufgabenliste zeigt diesen geerbten Wert. Die Zähler folgen derselben Regel. Eine Zahl führt Sie daher nie zu einer Liste, in der die Spalte bereits gefüllt ist.

### Streams

Ein fehlender Stream wird nur gezählt, wenn das Element bereits eine Kategorie hat und diese Kategorie mindestens einen aktiven Stream anbietet. Viele Kategorien bieten gar keinen Stream. Ein Element ganz ohne Kategorie ist bereits unter Kategorie gezählt.

### Die Liste öffnen

Jede Zahl über null ist ein Link. Ein Klick öffnet die passende Liste, bereits auf genau die Elemente hinter der Zahl gefiltert, über den gesamten Mandanten. Die Gesamtzahl der Liste entspricht der angeklickten Zahl. Nullen werden zur Einordnung angezeigt, sind aber nicht anklickbar.

Fehlt nichts, zeigt der Streifen eine einzige Zeile, die bestätigt, dass alles Offene klassifiziert ist.

---

## Demnächst

Mit diesem Bericht sehen Sie, was bald fällig ist und was schon zu lange wartet. Es ist der einzige Bericht, der nach vorne blickt: Der Periodenrückblick liest die Vergangenheit, der Flussbericht und die Handlungsbedarf-Blöcke lesen die Gegenwart.

### Was der Bericht zeigt

Die Seite hat fünf Abschnitte. Jeder zeigt, wie viele Elemente er enthält, eine nach Datum sortierte Tabelle und einen Zeitraum, den Sie rechts neben dem Titel ändern können.

- **Geplante Projektenden**: offene Projekte, deren geplantes Ende zwischen heute und dem Ende des Zeitraums liegt. Zeitraum: 30 (Standard), 60 oder 90 Tage. Projekte, deren geplantes Ende bereits überschritten ist, bleiben im Flussbericht; eine Zeile nennt ihre Anzahl und öffnet ihn.
- **Geplante Projektstarts**: Projekte, die noch auf Warteliste oder Geplant stehen und deren geplanter Start in denselben Zeitraum fällt.
- **Anträge in Prüfung**: Anfragen, die noch im Status Prüfung ausstehend sind und vor mindestens 14, 30 (Standard) oder 60 Tagen erstellt wurden. Anfragen im Status Kandidat, Genehmigt und Pausiert wurden bereits entschieden und erscheinen daher hier nicht.
- **Gewünschte Liefertermine**: offene Anfragen (Prüfung ausstehend, Kandidat, Genehmigt, Pausiert), deren gewünschtes Lieferdatum in den Projektzeitraum fällt.
- **Fällige Aufgaben**: offene Aufgaben (Offen, In Bearbeitung, Ausstehend, Im Test), die zwischen heute und dem Ende des Zeitraums fällig sind, beide Tage eingeschlossen. Zeitraum: 7, 14 (Standard) oder 30 Tage. Wie in den anderen Berichten zählen nur eigenständige Aufgaben und Projektaufgaben. Eine Zeile unter dem Titel nennt die Anzahl der bereits überfälligen Aufgaben, mit einem Link dorthin.

Der Projektzeitraum wird gemeinsam genutzt: Wenn Sie ihn in einem der drei Abschnitte ändern, die ihn verwenden, ändert er sich in allen dreien. Die Seite merkt sich Ihre Zeiträume und die eingeklappten Abschnitte.

### Filter

- **Projekt**: die Aufgaben dieser Projekte, die Projekte selbst und die mit ihnen verknüpften Anfragen.
- **Team**: Aufgaben, die einem Mitglied des Teams zugewiesen sind, sowie Projekte und Anfragen, an denen ein Mitglied beteiligt ist.

### Die Liste öffnen

Jede Zahl über null ist ein Link. Sie öffnet die Aufgaben-, Projekt- oder Anfragenliste, gefiltert auf genau die Elemente des Abschnitts und mit denselben Projekt- und Teamfiltern, sodass die Summe der Liste der Zahl entspricht. Der Bericht hat keinen Export: Die Listen lassen sich bereits exportieren.

---

## Kapazitäts-Heatmap-Bericht

Verwenden Sie diesen Bericht, um aktuelle Arbeitslast, Kapazitätsdruck und nicht zugewiesene Arbeit zu verstehen.

### Was er zeigt
- **Verbleibender Aufwand** (IT + Business), angepasst nach Ausführungsfortschritt.
- **Kapazität** pro Mitwirkendem (historisch oder theoretisch).
- **Arbeitsmonate** (verbleibende Tage / Kapazitätstage pro Monat).
- **Nicht zugewiesene Arbeit**, wenn Aufwand nicht vollständig zugeordnet ist.
- **Personen ohne Mitwirkendenprofil**, die in einem Projekt eingeplant sind. Sie erscheinen am Ende der Liste mit ihren verbleibenden Tagen und ohne Kapazität, damit ihre Last sichtbar bleibt. Legen Sie ihr Mitwirkendenprofil an, um ihnen eine Kapazität zu geben.

### Filter
- **Teams** (Mehrfachauswahl, einschließlich **Kein Team**)
- **Status** (Standard: Warteliste, Geplant, In Bearbeitung, Im Test, Zurückgestellt)
- **Kapazitätsmodus**: Historisch (Standard) oder Theoretisch
- **Gruppieren nach**: Mitwirkende (Standard) oder Teams

### Farbskala
Zellen in der Spalte **Arbeitsmonate** sind farbcodiert:

| Bereich | Farbe |
|-------|-------|
| <= 1 Monat | Grün |
| 1-3 Monate | Gelb |
| 3-6 Monate | Orange |
| 6-12 Monate | Rot |
| > 12 Monate | Violett |
| Keine Daten | Grau (k. A.) |

### Zusammenfassungskarten
Die Zusammenfassungszeile umfasst:
- **Gesamtanzahl Mitwirkende**
- **Durchschnittliche Arbeitsmonate** (nur Mitwirkende mit Kapazität)
- **Nicht zugewiesene Arbeit** (gesamte nicht zugeordnete Tage und Projektanzahl)

Klicken Sie auf **Nicht zugewiesene Arbeit**, um Details aufzuklappen.

### Detailansicht
Klicken Sie auf eine Mitwirkenden-Zeile, um eine Projektaufschlüsselung zu öffnen:
- Jede Zeile zeigt verbleibenden Aufwand, Zuordnung % und Ihre Tage.
- Projektnamen sind klickbar und öffnen den Reiter **Fortschritt** des Projekts.

### Exporte
- **CSV**: Die Heatmap-Tabelle exportieren
- **PNG**: Momentaufnahme des Berichts
- **Drucken**: Drucken oder als PDF speichern

---

## Periodenrückblick

Mit diesem Bericht sehen Sie, was in einem Zeitraum mit Anfragen, Projekten und Aufgaben geschehen ist. Der Bericht folgt dem Portfolio-Trichter: zuerst die Anfragen, dann die Projekte, dann die Aufgaben.

### Was der Bericht zeigt

Jeder der drei Abschnitte enthält dieselben drei Listen.

- **Erstellt**: im Zeitraum erstellte Elemente.
- **Geändert**: Elemente, die im Zeitraum geändert, aber weder erstellt noch geschlossen wurden.
- **Geschlossen**: Elemente, die der letzte Statuswechsel des Zeitraums in einem Abschlussstatus zurücklässt.

Ein Element, das im selben Zeitraum erstellt und geschlossen wurde, erscheint in beiden Listen, jeweils mit seinem eigenen Datum. Unter Geändert erscheint es nie: Geändert ist das, was nach Erstellungen und Abschlüssen übrig bleibt.

Die Erstellung zählt als Statuswechsel. Ein CSV-Import oder ein Agent kann eine Aufgabe bereits erledigt oder eine Anfrage bereits abgelehnt anlegen. Ein solches Element steht am selben Tag unter Erstellt und unter Geschlossen, obwohl danach niemand seinen Status geändert hat.

Geschlossen bedeutet je nach Typ andere Status:

- **Anfragen**: umgewandelt oder abgelehnt. Eine Anfrage hat keinen Status "storniert".
- **Projekte**: erledigt oder storniert.
- **Aufgaben**: erledigt oder storniert.

Jede Liste zeigt ihre Anzahl in der Überschrift. Eine leere Liste bleibt einzeilig, damit ein Bericht mit wenig Aktivität kurz bleibt.

### Welche Aufgaben zählen

Der Abschnitt Aufgaben umfasst nur Portfolio-Aufgaben: eigenständige Aufgaben und Aufgaben an einem Projekt. Aufgaben an einem Vertrag, einer Ausgabenzeile, einer CAPEX-Zeile oder einem Vorfall bleiben außen vor. Das ist enger gefasst als in früheren Fassungen des Berichts, die jede Aufgabe gezählt haben.

### Woher ein Projekt stammt

Die Liste der erstellten Projekte enthält eine Spalte **Herkunft**.

- Ein aus einer Anfrage umgewandeltes Projekt zeigt diese Anfrage, zum Beispiel `REQ-12 Cave climate digital twin`. Ein Klick öffnet die Anfrage.
- Ein Projekt ohne Anfrage zeigt, wie es ins Portfolio gekommen ist, in den Worten, die KANAP überall sonst verwendet: **Fast-track**, **Altbestand** oder **Anfrage**.

### Einen Abschnitt einklappen

Jeder Abschnittstitel trägt ein Chevron. Klicken Sie auf die Titelzeile, um den Abschnitt einzuklappen, und erneut, um ihn zu öffnen. Ein eingeklappter Abschnitt behält seine Zahlen neben dem Titel, Sie sehen also weiterhin, was er enthält.

Ihre Wahl wird in diesem Browser gemerkt, Abschnitt für Abschnitt. Der Druck bleibt davon unberührt: Ein gedruckter Bericht enthält immer alle drei Abschnitte vollständig.

### Was sich geändert hat

Die Listen Geändert enthalten eine Spalte **Änderungen**. Sie liest den Audit-Trail des Zeitraums und zeigt:

- den Statuswechsel, sofern sich der Status geändert hat, als `In Bearbeitung -> Im Test`;
- danach die geänderten Felder in klarer Sprache, durch Kommas getrennt.

Die Formulierung entspricht dem Verlauf am Element selbst. Felder, die bei jedem Speichern neu geschrieben werden, etwa der technische Aktualisierungszeitstempel, bleiben unberücksichtigt.

### Filter

- **Startdatum** und **Enddatum** (Standard: die letzten 7 Tage)
- **Quelle** (Mehrfachauswahl)
- **Kategorie** (Mehrfachauswahl)
- **Stream** (Mehrfachauswahl; beschränkt auf die gewählten Kategorien)
- **Aufgabentypen** (Mehrfachauswahl; gilt für den Abschnitt Aufgaben)
- **Erreichter Status** (Mehrfachauswahl, gruppiert nach Anfragen, Projekten und Aufgaben)

Die Filter gelten für alle neun Listen und für die Sicht nach Person.

**Erreichter Status** behält die Elemente, die der letzte Statuswechsel des Zeitraums in einem der gewählten Status zurückgelassen hat. Die Erstellung zählt als Statuswechsel: Ein Element, das im Zeitraum erstellt und danach nie verschoben wurde, hat den Status erreicht, mit dem es erstellt wurde. Ein Element, dessen Status sich im Zeitraum nicht geändert hat, passt zu keinem Status und fällt heraus, sobald ein Status gewählt ist. Die Spalte Status zeigt den Status, den das Element heute hat, und der kann abweichen: Eine Aufgabe, die im Zeitraum geschlossen und seitdem wieder geöffnet wurde, hat **Erledigt** erreicht und zeigt **Offen**.

Ein Status, den mehrere Typen teilen, etwa Erledigt oder Pausiert, ist eine einzige Auswahl: Wenn Sie ihn unter Aufgaben ankreuzen, ist er auch unter Projekte angekreuzt.

### Tabellenspalten

Jede Liste beginnt mit der Geschäftsreferenz (`REQ-12`, `PRJ-3`, `T-4`) und dem Namen. Ein Klick auf den Namen öffnet das Element.

**Anfragen**: Referenz, Anfragenname, Quelle, Kategorie, Stream, Unternehmen, Status, Datum des Ereignisses.

**Projekte**: Referenz, Projektname, Herkunft (Liste der Erstellungen), Priorität, Quelle, Kategorie, Stream, Unternehmen, Aufwand, Status, Datum des Ereignisses.

**Aufgaben**: Referenz, Aufgabenname, Aufgabentyp, Priorität, Quelle, Kategorie, Stream, Unternehmen, Status, Datum des Ereignisses.

Eine Aufgabe ohne eigenes Unternehmen zeigt das Unternehmen ihres Projekts, so wie die Aufgabenliste es liest.

Die Datumsspalte trägt den Erstellungstag in den Erstellt-Listen, den Tag der letzten Änderung in den Geändert-Listen und den Abschlusstag in den Geschlossen-Listen. Die Tage werden in Ihrer eigenen Zeitzone gelesen.

Die Geschlossen-Listen tragen zwei Daten: **Erstellt am**, dann **Geschlossen am**. Der Erstellungstag wird immer gezeigt, auch wenn das Element lange vor dem Zeitraum entstanden ist. Er zeigt auf einen Blick, wie lange das Element gedauert hat.

Die Geändert-Listen ergänzen am Ende die Spalte **Änderungen**.

### Exporte

- **CSV**: neun Blöcke in der Reihenfolge der Seite, jeder mit eigener Überschrift und Kopfzeile.
- **XLSX**: drei Blätter, Requests, Projects und Tasks. Die Zeilen laufen von den Erstellungen über die Änderungen zu den Abschlüssen, mit einer führenden Spalte **Event**, die angibt, aus welcher Liste eine Zeile stammt. Die Namenszelle verweist zurück auf das Element.

Beide Exporte enthalten die Referenz, das Unternehmen, die Herkunft eines Projekts, die Änderungen einer geänderten Zeile und das Datum des Ereignisses. Die geschlossenen Zeilen tragen zusätzlich den Erstellungstag.

## Erfasste Zeit

Erfasste Tage Monat für Monat, für Projekte oder andere Arbeit, Team für Team und Person für Person. Der Bericht zeigt, wie sich die Arbeitslast verteilt, nicht wer am meisten erfasst: Teams behalten ihre konfigurierte Reihenfolge, und Personen sind alphabetisch sortiert.

### Woher die Tage stammen

Der Bericht liest jeden Zeiteintrag: die auf Aufgaben erfasste Zeit und die direkt auf einem Projekt erfasste Zeit. Ein Tag entspricht 8 Stunden, die Zahlen haben eine Nachkommastelle. Jeder Eintrag fällt in den Monat seines Datums, in Ihrer eigenen Zeitzone.

- **Projekttage**: Zeit, die auf einer Aufgabe eines Projekts oder direkt auf einem Projekt erfasst wurde.
- **Andere Tage**: alle übrige Zeit, etwa auf eigenständigen Aufgaben.

Wählen Sie **6 Monate** oder **12 Monate**. Der aktuelle Monat ist immer der letzte. Die Seite merkt sich Ihre Wahl.

### Was der Bericht zeigt

- **Kacheln**: Projekttage, andere Tage, die Summe, der Projektanteil und die Anzahl der Mitwirkenden, die im Zeitraum nichts erfasst haben. Arbeit außerhalb von Projekten wird oft seltener erfasst als Projektarbeit, und diese letzte Kachel erinnert daran.
- **Diagramm**: Projekttage und andere Tage gestapelt, Monat für Monat.
- **Tabelle**: eine Zeile pro Team, eine Spalte pro Monat. Jede Zelle zeigt die erfassten Tage, darunter Projekttage / andere Tage. Klappen Sie ein Team auf, um seine Personen zu sehen. Ein Mitwirkender, der nichts erfasst hat, erscheint trotzdem, mit leeren Zellen. Personen ohne Team sind unter **Kein Team** gruppiert. Zeit ohne zugeordnete Person erscheint dort als **Unbekannter Benutzer**.

Der Bericht zeigt nur Tage. Er zeigt nie die Notizen eines Eintrags.

### Filter

- **Team**: die Personen der ausgewählten Teams.
- **Projekt**: nur die Zeit, die auf den ausgewählten Projekten erfasst wurde, auf ihren Aufgaben oder direkt. Andere Tage sind dann null.

### Exporte

- **CSV**: eine Zeile pro Person und Monat, mit dem Team, der Person, dem Monat, den Projekttagen, den anderen Tagen und der Summe.
- **PNG**: das Diagramm.

## Tipps
- **Mitwirkenden-Profile aktuell halten**: Die Kapazität basiert auf der Verfügbarkeit und den historischen Zeitstatistiken der Mitwirkenden.
- **Teamfilter verwenden**: Den Bericht auf eine Abteilung oder Funktion eingrenzen.
- **Nicht zugewiesene Arbeit überprüfen**: Hilft, Projekte mit fehlenden Zuordnungen oder fehlenden Leitern aufzudecken.
- **Periodenrückblick für Stand-ups**: Den Periodenrückblick als XLSX exportieren und mit Stakeholdern für Statusmeetings teilen.
