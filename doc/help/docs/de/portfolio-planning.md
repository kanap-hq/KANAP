# Portfolio-Planung

Die Portfolio-Planung hilft Ihnen, Projekttermine auf Portfolio-Ebene zu planen und zu aktualisieren. Sie kombiniert eine manuelle Zeitplanansicht mit einem automatischen Roadmap-Generator, der Projekte basierend auf verbleibendem Aufwand, Abhängigkeiten und Mitwirkenden-Kapazität einplant.

## Erste Schritte

Navigieren Sie zu **Portfolio > Planung**.

**Berechtigungen**:
- Sie benötigen `portfolio_projects:reader`, um auf die Planungsseite und Zeitplandaten zuzugreifen.
- Sie benötigen `portfolio_reports:reader`, um Roadmap-Szenarien zu generieren.
- Sie benötigen `portfolio_projects:contributor`, um Projektbalken zu ziehen, den Planungsmodus eines Projekts zu ändern und generierte Termine anzuwenden.

Wenn Sie Planung nicht im Menü sehen, bitten Sie Ihren Administrator, den erforderlichen Zugriff zu gewähren.

---

## Planungsmodi

Verwenden Sie den Modus-Umschalter oben auf der Seite:
- **Zeitplan**: Manuelle Terminbearbeitung im Gantt-Diagramm
- **Roadmap-Generator**: Automatische Zeitplansimulation und selektive Anwendung

---

## Zeitplan-Modus

Verwenden Sie den Zeitplan-Modus für direkte Planungsbearbeitungen.

### Was Sie tun können
- Projekte, Abhängigkeiten und optionale Meilensteine anzeigen
- Nach Kategorie und Status filtern
- Zeitfenster wählen: 1 Monat, 3 Monate, 6 Monate oder 1 Jahr
- Zeitlich vor-/zurücknavigieren oder auf **Heute** zurücksetzen
- Projektbalken ziehen, um geplante Start- und Endtermine zu aktualisieren. Dafür ist `portfolio_projects:contributor` erforderlich. Mit `portfolio_projects:reader` bleiben die Balken an ihrem Platz und ein Doppelklick öffnet das Projekt.

### Anzeigeverhalten
- Das Diagramm zentriert sich um heute mit etwa **25 % Vergangenheit / 75 % Zukunft**, wenn es auf den aktuellen Zeitraum zurückgesetzt wird.
- Meilensteine werden angezeigt, sind aber nicht ziehbar.

---

## Roadmap-Generator-Modus

Der Roadmap-Generator berechnet vorgeschlagene Projekttermine aus dem ausgewählten Umfang und den Planungsparametern.

### Szenario-Steuerungen
- **Startdatum**
- **Status** (Standard: Warteliste, Geplant, In Bearbeitung, Im Test)
- **Kapazitätsmodus**: Theoretisch oder Historisch
- **Parallellimit**: Maximale gleichzeitige Projekte pro Mitwirkendem
- **Optimierungsmodus**: Prioritätsfokussiert oder Abschlussfokussiert
- **Bereits geplante Projekte neu berechnen** (standardmäßig aktiviert)
- **Kollaborative Planung** (standardmäßig deaktiviert)
- **Kontextwechsel-Abzug** und **Kontextwechsel-Toleranz**

**Wichtig**: Wenn **Bereits geplante Projekte neu berechnen** aktiviert ist, können Projekte, die bereits geplante Termine haben, im generierten Szenario verschoben werden.

### Reiter Zeitplan

Nach der Generierung zeigt der Reiter Zeitplan die vorgeschlagenen Projekttermine.

- Projekttitel sind klickbar und öffnen den Reiter **Fortschritt** des Projekts.
- Kontrollkästchen definieren den Szenarioumfang.
- Ein Filter **Kategorie (Vorschau)** ermöglicht es, die Roadmap-Gantt-Anzeige zu filtern, ohne den generierten Zeitplan selbst zu ändern.
- Das Abwählen eines Projekts generiert das Szenario sofort neu:
  - das abgewählte Projekt wird vollständig ausgeschlossen,
  - es verbraucht keine Kapazität mehr in Engpässen/Auslastung/Zeitplan.
- **Sichtbare auswählen** / **Sichtbare Auswahl aufheben** wirken nur auf Projekte, die aktuell in der gefilterten Gantt-Vorschau sichtbar sind.
- Nicht planbare Projekte werden mit einem Grund aufgelistet.

### Reiter Engpässe

Zeigt Mitwirkende, gerankt nach Auswirkung auf das Roadmap-Enddatum (`impactDays`) unter Verwendung von Sensitivitätssimulationen.
- Jede Mitwirkenden-Zeile hat einen Auf-/Zuklapp-Pfeil, um eine Projektaufschlüsselungstabelle zu öffnen.
- Die Aufschlüsselung enthält nur Projekte im aktuellen generierten Szenario, bei denen der Mitwirkende eine Zuordnung hat.
- Die Aufschlüsselung ist nach Projektstartdatum sortiert und zeigt:
  - Projektname
  - Projektstartdatum
  - Projektenddatum
  - Gesamtbeitrag (Tage)
  - Bereits aufgewendete Zeit (Tage)
- `Gesamtbeitrag` und `Bereits aufgewendete Zeit` werden aus der generierten Mitwirkenden-Auslastung plus dem Projektausführungsfortschritt abgeleitet.

### Reiter Auslastung

Zeigt wöchentliche Auslastungs-Heatmaps:
- Mitwirkenden-Ansicht: Eine Zeile pro Mitwirkendem, gruppiert nach Team, mit ISO-Wochenspalten
- Team-Ansicht: Eine Zeile pro Team, mit ISO-Wochenspalten
- Team-Bezeichnungen werden als zusammengeführte mehrzeilige Zellen in der Mitwirkenden-Ansicht angezeigt, um Wiederholung zu vermeiden
- Jede Zelle zeigt die gerundete wöchentliche Auslastung (%) mit Farbintensität basierend auf der Belastung
- **Tabelle exportieren** bietet **CSV** und **Excel (.xlsx)** für das angezeigte Szenario an. Die CSV-Datei enthält die angezeigte Ansicht, Mitwirkende oder Teams. Die Excel-Datei enthält beide, je ein Blatt, mit der Auslastung in Prozent, und ein Blatt **Parameter**. **Auslastung als PNG exportieren** speichert die Heatmap als Bild

### Gantt-Vorschau-Verhalten

Das Roadmap-Gantt ist schreibgeschützt und:
- verwendet dieselbe heute-zentrierte 25/75-Anzeigelogik wie der Zeitplan-Modus,
- erweitert sich automatisch weit genug in die Zukunft, um den spätesten geplanten Abschluss zu erreichen,
- zeigt jeden Projektbalken mit seinem aktuellen Ausführungsfortschritt,
- passt die Höhe automatisch basierend auf sichtbaren Zeilen an, sodass größere Szenarien viele Projekte ohne internes vertikales Scrollen zeigen können.

---

## Generierte Termine anwenden

Klicken Sie auf **Termine anwenden**, um generierte geplante Termine zurück auf ausgewählte Projekte zu schreiben.

### Anwende-Regeln
- Nur ausgewählte Projekte, die aktuell in der Roadmap-Gantt-Vorschau sichtbar sind, werden angewendet.
- Die Anwendung ist **transaktional** (alles oder nichts):
  - Wenn ein Projekt die Validierung nicht besteht, wird kein Projekttermin aktualisiert.

---

## Verhalten bei gestarteten Projekten

Für Projekte, die bereits in der Vergangenheit gestartet wurden:
- wird das historische Startdatum beibehalten (`Tatsächlicher Start` oder geeigneter `Geplanter Start`-Fallback),
- verwendet die Planung die verbleibende Arbeit ab heute, um das voraussichtliche Enddatum zu berechnen.

Dies bewahrt den historischen Zeitplankontext, während eine realistische Fertigstellung weiterhin neu berechnet wird.

---

## Häufige Gründe für Nicht-Planbarkeit

- **Kein verbleibender Aufwand**
- **Keine Mitwirkenden**
- **Fehlende Mitwirkenden-Kapazität**
- **Fehlendes Blocker-Datum**
- **Zyklische Abhängigkeit**
- **Unzureichende Kapazität**

Wenn Projekte nicht planbar sind, überprüfen Sie Mitwirkenden-Zuweisungen, Mitwirkenden-Verfügbarkeit, Abhängigkeitsdaten und Statusumfang.

---

## Wie der Planer funktioniert

Der Roadmap-Generator simuliert die Projektausführung Woche für Woche. Jede Woche entscheidet er, welche Projekte Arbeit erhalten und wie viel Aufwand jeder Mitwirkende verbraucht. Die Simulation läuft vom **Startdatum** vorwärts, bis alle Projekte abgeschlossen sind oder das Horizontlimit erreicht ist.

### Kapazität

Jeder Mitwirkende hat eine monatliche Kapazität (konfiguriert unter **Mitwirkende**). Der Planer rechnet diese in einen Wochenwert um: `monatlich * 12 / 52`.

- **Theoretischer Modus** verwendet die konfigurierte Kapazität direkt.
- **Historischer Modus** verwendet tatsächliche Zeiterfassungsdaten der letzten Monate als Kapazitätsbasis.

### Reservierungen

Projekte, die **nicht neu berechnet** werden (wenn **Bereits geplante Projekte neu berechnen** deaktiviert ist oder Projekte mit externen Blockern), behalten ihre bestehenden geplanten Termine. Ihre Mitwirkenden-Auslastung wird im Kapazitätsbuch vorab festgeschrieben, bevor die Kandidatenplanung beginnt. Das bedeutet, reservierte Projekte verbrauchen Mitwirkenden-Zeit in den Wochen, die sie umfassen, und reduzieren die Verfügbarkeit für andere Projekte.

### Abhängigkeiten

Ein Projekt kann nicht beginnen, bevor alle seine Abhängigkeits-Vorgänger abgeschlossen sind. Wenn ein Vorgänger ein Kandidat im aktuellen Lauf ist, wartet das abhängige Projekt, bis das berechnete Enddatum des Vorgängers vergangen ist. Wenn ein Vorgänger außerhalb des Kandidatensatzes liegt (z. B. ausgeschlossen oder in einem anderen Status), wird sein bekanntes geplantes/tatsächliches Enddatum verwendet.

### Projektrangfolge

Jede Woche werden bereite Projekte (nicht blockiert, nicht erledigt) sortiert, um die Planungspriorität zu bestimmen. Die Rangfolge hängt vom **Optimierungsmodus** ab.

**Prioritätsfokussierter** Modus ordnet nach **effektiver Priorität** (höchste zuerst):

- **Gestartete Projekte** (haben bereits in einer früheren Woche Arbeit erhalten): effektive Priorität = `min(100, priorityScore + 5 * weeksSinceStart)`. Ein gestartetes Projekt gewinnt 5 Prioritätspunkte pro Woche aktiver Arbeit, bis maximal 100. Dies stellt sicher, dass laufende Projekte stetig in der Priorität steigen, damit sie abgeschlossen werden.
- **Wartende Projekte** (bereit, aber noch nicht gestartet): effektive Priorität = `min(90, priorityScore + weeksWaiting)`. Jede Woche, die ein bereites Projekt wartet, ohne Arbeit zu erhalten, gewinnt es 1 Prioritätspunkt, bis maximal 90. Dies verhindert endlose Blockierung, aber ein wartendes Projekt kann nie ein mäßig priorisiertes gestartetes Projekt übertrumpfen.
- **Andere Projekte** (noch nicht bereit): verwenden ihren rohen `priorityScore` unverändert.

**Abschlussfokussierter** Modus ordnet nach **Engpasswochen** (niedrigste zuerst), dann roher `priorityScore` (höchster zuerst). Engpasswochen schätzen, wie viele Wochen ein Projekt dauern würde, wenn es das einzige geplante Projekt wäre, basierend auf seinem am stärksten eingeschränkten Mitwirkenden. Dieser Modus priorisiert schnell abschließbare Projekte.

**Tiebreaker** (beide Modi): Abhängigkeitstiefe absteigend (Projekte, die die meiste nachgelagerte Arbeit blockieren, kommen zuerst), dann Projekt-ID lexikografisch für Determinismus.

### Kontinuitätsregel

Bevor neue Projektstarts jede Woche in Betracht gezogen werden, weist der Planer Mitwirkende vorab ihren **laufenden Projekten** zu. Ein Mitwirkender „fährt fort" mit einem Projekt, wenn:

- Das Projekt bereits gestartet ist (in einer früheren Woche Arbeit erhalten hat).
- Das Projekt bereit ist (nicht durch eine Abhängigkeit blockiert).
- Der Mitwirkende noch verbleibenden Aufwand dafür hat.
- Der Mitwirkende bereits zuvor daran gearbeitet hat.

Laufende Projekte werden in Rangfolge verarbeitet (höchste Priorität zuerst). Jede Vorab-Fortsetzung verbraucht einen Parallelisierungsslot für diesen Mitwirkenden.

**Effekt**: Bei **Parallellimit = 1** muss ein Mitwirkender, der an einem Projekt arbeitet, es abschließen (oder warten, bis es wieder freigegeben wird), bevor er etwas Neues beginnt. Bei höheren Limits füllt laufende Arbeit zuerst Slots, und verbleibende Slots werden für neue Projekte verfügbar.

Die Kontinuitätsregel gilt in kollaborativen und nicht-kollaborativen Modi, aber die Machbarkeitsprüfung unterscheidet sich:

- **Kollaborativ**: Alle fortsetzenden Mitwirkenden an einem Projekt müssen freie Slots haben, damit das Projekt als Ganzes vorausgewählt wird.
- **Nicht-kollaborativ**: Jeder fortsetzende Mitwirkende wird einzeln vorausgewählt, wenn er einen freien Slot hat.

### Kollaborative Planung

Der Schalter **Kollaborative Planung** steuert, wie der Planer Projekte auswählt und Arbeit jede Woche verteilt.

#### Kollaborativ (Schalter AN)

Alle Mitwirkenden, die einem Projekt zugewiesen sind, müssen einen freien Parallelisierungsslot **und** verfügbare Kapazität haben, damit das Projekt ausgewählt wird. Wenn auch nur ein Mitwirkender vollständig ausgelastet ist, wartet das gesamte Projekt.

Arbeit wird **proportional** verbraucht: Alle Mitwirkenden machen Fortschritt im Tempo des am stärksten eingeschränkten Mitwirkenden. Wenn Mitwirkender A 4 Tage verfügbar hat und Mitwirkender B 1 Tag, schreitet das Projekt mit einer Rate voran, die durch die Verfügbarkeit von Mitwirkendem B eingeschränkt ist. Dies hält alle Mitwirkenden synchron, bedeutet aber, dass verfügbare Kapazität von schnelleren Mitwirkenden für dieses Projekt ungenutzt bleibt.

Verwenden Sie die kollaborative Planung, wenn Projekte tatsächlich erfordern, dass alle Teammitglieder im Gleichschritt arbeiten (z. B. eng gekoppelte Entwicklungsphasen, Workshops oder gemeinsame Liefergegenstände).

#### Nicht-kollaborativ (Schalter AUS, Standard)

Ein Projekt wird ausgewählt, wenn **irgendein** Mitwirkender einen freien Parallelisierungsslot und verfügbare Kapazität hat. Mitwirkende arbeiten **unabhängig**: Jeder verbraucht Aufwand in seinem eigenen Tempo, bis zu seiner verfügbaren wöchentlichen Kapazität. Ein Projekt kann Fortschritt machen, auch wenn einige seiner Mitwirkenden mit anderer Arbeit beschäftigt sind.

Dieser Modus enthält eine **Mindeststart-Absicherung** für neue Projekte: Ein Projekt startet erst, wenn der erwartete Gesamtverbrauch aller machbaren Mitwirkenden mindestens 0,5 Tage in dieser Woche beträgt. Dies verhindert optimistisch frühe Startdaten durch winzige Tropfenverbräuche. Die Absicherung gilt nicht für Fortsetzungen (bereits gestartete Projekte laufen weiter über die Kontinuitätsregel unabhängig von der wöchentlichen Kapazität).

Verwenden Sie die nicht-kollaborative Planung (Standard), wenn Mitwirkende unabhängig an ihren Anteilen arbeiten können, was typisch für die meisten IT-Projekte ist, bei denen verschiedene Teammitglieder separate Aufgaben bearbeiten.

### Parallelisierungslimit

Das **Parallellimit** steuert, an wie vielen Kandidatenprojekten ein einzelner Mitwirkender gleichzeitig in einer bestimmten Woche arbeiten kann. Reservierungen (vorab festgeschriebene Projekte) verbrauchen ebenfalls Slots.

Bei einem Limit von 1 arbeitet jeder Mitwirkende an höchstens einem Kandidatenprojekt pro Woche. Bei einem Limit von 2 oder 3 können Mitwirkende ihre Zeit auf mehrere Projekte aufteilen.

### Kontextwechsel-Abzug

Wenn ein Mitwirkender in derselben Woche an mehr als einem Kandidatenprojekt arbeitet (Parallelität > Toleranzschwelle), wird seine effektive Kapazität um den **Kontextwechsel-Abzug**-Prozentsatz für jedes zusätzliche Projekt über der Toleranzgrenze reduziert.

- **Kontextwechsel-Abzug**: Der Prozentsatz der Kapazität, der pro zusätzlichem gleichzeitigem Projekt verloren geht (Standard 10 %).
- **Kontextwechsel-Toleranz**: Die Anzahl gleichzeitiger Projekte, bevor der Abzug greift (Standard 1).

Zum Beispiel, bei 10 % Abzug und Toleranz von 1: Die Arbeit an 2 Projekten kostet 10 % Kapazität, 3 Projekte kosten 20 %.

### Sensitivitätsanalyse (Engpässe)

Nach dem Hauptplanungslauf führt der Planer die Simulation mehrmals erneut durch, wobei jeweils einem Mitwirkenden +20 % zusätzliche monatliche Kapazität gegeben wird. Die Differenz zwischen dem Original-Roadmap-Enddatum und dem Enddatum jeder Variante misst die **Auswirkung dieses Mitwirkenden auf den Zeitplan**. Mitwirkende werden nach dieser Auswirkung im Reiter **Engpässe** gerankt.

Dies hilft zu identifizieren, welche Mitwirkenden die größten Planungseinschränkungen darstellen. Das Hinzufügen von Kapazität bei Mitwirkenden mit hoher Auswirkung (durch Einstellung, Umverteilung oder Arbeitslastreduzierung) würde den gesamten Portfolio-Zeitplan am meisten verbessern.
