# Portfolio-Projekte

Portfolio-Projekte sind die Ausführungs-Arbeitsbereiche für genehmigte Initiativen. Hier wird die Lieferung geplant, der Fortschritt verfolgt, die Arbeitslast gemessen, Aufgaben koordiniert und projektspezifisches Wissen mit dem Rest von KANAP verbunden.

Projekte stammen normalerweise aus genehmigten Anfragen, können aber auch direkt als **Schnellstart**- oder **Legacy**-Projekte erstellt werden, wenn die Anfragephase nicht Teil des Prozesses ist.

Für portfolio-weite Sequenzierung und Roadmap-Arbeit verwenden Sie [Portfolio-Planung](portfolio-planning.md). Der Projekte-Bereich ist für die Durchführung der Arbeit, sobald ein Projekt existiert.

## Wo Sie es finden

- Arbeitsbereich: **Portfolio**
- Pfad: **Portfolio > Projekte**

## Berechtigungen

- `portfolio_projects:reader`: die Liste öffnen und Projekt-Arbeitsbereiche anzeigen
- `portfolio_projects:contributor`: das verwaltete Dokument **Zweck** aktualisieren und Projekt-Overhead-Zeiteinträge pflegen
- `portfolio_projects:manager`: Projekte erstellen und Projektdaten, Status, Team, Beziehungen, Zeitleiste, Fortschritt, Aufgaben, Bewertung, Kommentare und Entscheidungen verwalten
- `portfolio_projects:admin`: enthält Manager-Funktionen und kann auch CSV importieren/exportieren und Projekt-Overhead-Zeiteinträge anderer Benutzer pflegen
- Die Anzeige der Wissensdatenbank erfordert auch Wissensdatenbank-Zugriff
- Das Erstellen oder Verknüpfen von eigenständigem Wissen erfordert auch eine Wissens-Erstellungsrolle

Wenn Projekte nicht in der Navigation erscheint, fragen Sie einen Administrator nach Zugriff.

## Arbeiten mit der Liste

Die Projektliste ist darauf ausgelegt, zwei Fragen schnell zu beantworten: „Worauf sollte ich achten?" und „Was bewegt sich?"

**Bereichsauswahl**

- **Meine Projekte** zeigt Projekte, in denen Sie ausdrücklich als Sponsor, Leiter oder Mitwirkender beteiligt sind
- **Projekte meines Teams** erweitert diese Ansicht auf Projekte, die Mitglieder Ihres Portfolio-Teams einbeziehen
- **Alle Projekte** entfernt den Beteiligungsfilter
- Wenn Sie keinem Portfolio-Team zugewiesen sind, ist der Team-Bereich nicht verfügbar
- Die Liste öffnet sich mit **Alle Projekte**. Ihre Bereichswahl wird gespeichert, sodass die Liste so zurückkommt, wie Sie sie verlassen haben

**Standardspalten**

| Spalte | Was sie zeigt |
|--------|---------------|
| **#** | Referenznummer (z. B. PRJ-42). Klicken zum Öffnen des Arbeitsbereichs |
| **Projektname** | Der Projektname |
| **Priorität** | Berechneter Prioritätswert |
| **Status** | Aktueller Ausführungszustand mit einem farbigen Punkt |
| **Herkunft** | Anfrage, Schnellstart oder Legacy |
| **Fortschritt** | Ausführungsfortschritt als Balken |
| **Quelle** | Portfolio-Quellklassifizierung |
| **Kategorie** | Portfolio-Kategorie |
| **Stream** | Portfolio-Stream |
| **Unternehmen** | Unternehmensklassifizierung |
| **Start** | Geplantes Startdatum |
| **Ende** | Geplantes Enddatum |
| **Erstellt** | Erstellungsdatum |

**Zusätzliche Spalten** (standardmäßig ausgeblendet):

- **Zuletzt geändert**: Wann das Projekt zuletzt aktualisiert wurde

**Standardverhalten**

- Projekte werden nach Prioritätswert sortiert, es sei denn, Sie ändern die Sortierung
- Projekte im Status **Erledigt** sind standardmäßig ausgeblendet
- Die Suche funktioniert über Textinhalt
- Filter für Status, Herkunft, Quelle, Kategorie, Stream und Unternehmen sind direkt im Raster verfügbar

**Massenverwaltung**

- **Neues Projekt** ist für Manager verfügbar
- **CSV importieren** und **CSV exportieren** sind für Administratoren verfügbar

Das Öffnen eines Projekts aus der Liste bewahrt den aktuellen Listenkontext. Der Projekt-Arbeitsbereich verwendet denselben Kontext für die **Vorherige**- und **Nächste**-Navigation, sodass Sie einen gefilterten Satz überprüfen können, ohne Ihren Platz zu verlieren.

## Ein Projekt erstellen

Die direkte Projekterstellung ist für Arbeit gedacht, die ohne separate Anfragenaufzeichnung in die Ausführung gehen soll.

- Neue Projekte öffnen sich nur auf **Zusammenfassung**
- Bis das Projekt zum ersten Mal gespeichert wird, sind die anderen Reiter nicht verfügbar
- Direkt erstellte Projekte verwenden die Herkunft **Schnellstart** oder **Legacy**
- Projekte mit Anfragenherkunft behalten ihre Anfragenherkunft und Quellverknüpfung

Verwenden Sie **Schnellstart** für Arbeit, die wirklich direkt in die Lieferung eingeführt wird. Verwenden Sie **Legacy** für Arbeit, die bereits außerhalb der normalen Erfassungshistorie existiert. Diese Unterscheidung wirkt sich auf die Berichterstattung aus und macht spätere Portfolio-Analysen weitaus weniger verwirrend.

## Mentales Modell des Arbeitsbereichs

Der Projekt-Arbeitsbereich hat zwei Schichten:

- Den **Hauptinhaltsbereich** für die operativen Reiter: **Zusammenfassung**, **Aufgaben**, **Zeitleiste**, **Fortschritt**, **Bewertung**, **Verknüpfungen** und **Wissensdatenbank**
- Eine persistente **Eigenschaftsleiste** am rechten Rand für Kerneigenschaften, Teamzuweisung und Quell-Anfragen

Öffnen oder schließen Sie die Eigenschaftsleiste mit der vertikalen Registerkarte am rechten Rand.

Bei vorhandenen Projekten verhält sich die Eigenschaftsleiste wie ein Live-Eigenschafts-Panel: Änderungen dort werden sofort gespeichert. Der Hauptreiterinhalt folgt dem üblichen **Speichern**- / **Zurücksetzen**-Workflow, wenn dieser Reiter Entwurfsänderungen enthält. Wenn Sie Reiter wechseln oder zum vorherigen oder nächsten Projekt mit ungespeicherten Arbeitsbereichsänderungen wechseln, fragt KANAP, ob zuerst gespeichert werden soll.

## Kopfzeile und Metadaten

Die Arbeitsbereichs-Kopfzeile ist eine Steuerungsleiste, keine Dekoration.

- Ein kopierbarer **PRJ-...**-Referenz-Chip
- Der Projekttitel (klicken zum Bearbeiten, wenn Sie Verwaltungsrechte haben)
- Eine kompakte Metadatenzeile: **Status**, **Bewertung**, **Fortschritt**, **IT-Leiter**, **Geplantes Ende** und **Herkunft** (oder die Quell-Anfragen-Referenz für Projekte mit Anfragenherkunft)
- **Vorherige** und **Nächste** bewegen sich durch das aktuelle Listenergebnis, nicht durch jedes Projekt im System
- **Link senden** sendet die aktuelle Projekt-URL per E-Mail mit einer optionalen Nachricht

Das Senden eines Links gewährt keinen Zugriff. Es teilt nur den Standort. Berechtigungen bleiben genau so, wie sie vor dem Versenden der E-Mail waren.

Das Ändern des Status aus der Metadatenleiste öffnet einen Statusänderungs-Dialog, sodass der Übergang ordnungsgemäß aufgezeichnet werden kann. Hier können Sie die Änderung als formale Entscheidung protokollieren, Kontext erfassen und die Begründung mit dem Übergang speichern, anstatt sie im Flurgespräch verschwinden zu lassen.

Der Workflow ist absichtlich kontrolliert:

- **Warteliste** kann zu **Geplant**, **Pausiert** oder **Storniert** wechseln
- **Geplant** kann zu **In Bearbeitung**, **Pausiert** oder **Storniert** wechseln
- **In Bearbeitung** kann zu **In Test**, **Erledigt**, **Pausiert** oder **Storniert** wechseln
- **In Test** kann zurück zu **In Bearbeitung** oder vorwärts zu **Erledigt**, **Pausiert** oder **Storniert** wechseln
- **Pausiert** kann zu **Warteliste**, **Geplant** oder **In Bearbeitung** zurückkehren oder **Storniert** werden
- **Erledigt** und **Storniert** sind Endzustände

## Eigenschaftsleiste

Behandeln Sie die Eigenschaftsleiste als die persistente Identitätskarte des Projekts. Sie ist in drei Bereiche gruppiert.

### Kerneigenschaften

- Projektname
- Status
- Herkunft (nur während der initialen Erstellung; danach gesperrt)
- Quelle, Kategorie, Stream
- Unternehmen, Abteilung
- Geplanter Start, Geplantes Ende

Diese Felder treiben Berichterstattung, Planung, Filterung und den standardmäßigen Portfolio-Kontext an. Klassifizierungswahlen sind besonders wichtig, weil sie beeinflussen, wo das Projekt in der portfolio-übergreifenden Analyse erscheint.

### Team

Die Teamzuweisung lebt in der Leiste, sodass sie verfügbar bleibt, während Sie an Zeitplan, Aufwand oder Aufgaben arbeiten.

- **Fachbereichssponsor** / **IT-Sponsor** erfassen die Verantwortlichkeit auf Führungsebene
- **Fachbereichsleiter** / **IT-Leiter** identifizieren die tägliche Führung
- **Fachbereichs-Mitwirkende** / **IT-Mitwirkende** definieren das breitere Arbeitsteam

Diese Zuweisungen tun mehr, als Felder auszufüllen:

- sie bestimmen, was in **Meine Projekte** und **Projekte meines Teams** erscheint
- sie speisen den Projektkontext in Zusammenfassung und Berichterstattung ein
- sie definieren, wer für die Aufwandszuweisung im Reiter **Fortschritt** verfügbar ist

Wenn Leiter und Mitwirkende falsch sind, ist auch Ihre Aufwandsplanung falsch.

### Quell-Anfragen

Eine schreibgeschützte Liste der Anfragenaufzeichnungen, die das Projekt erzeugt haben. Klicken Sie auf einen Eintrag, um zum Quell-Anfragen-Arbeitsbereich zu navigieren.

Für Abhängigkeiten, verwandte Projekte und verwandte geschäftliche/technische Objekte siehe den Reiter **Verknüpfungen**.

## Zusammenfassung

Der Reiter **Zusammenfassung** ist das Cockpit des Projekts. Er soll den aktuellen Zustand des Projekts in einem Durchgang beantworten, nicht jedes Feld in der Leiste duplizieren.

### Zweck

Der Bereich **Zweck** ist ein verwaltetes Projektdokument, kein einfaches Notizfeld.

- Verwenden Sie ihn für die narrative Kurzbeschreibung des Projekts: Absicht, erwartetes Ergebnis, Umfangsgrenzen und jeden Rahmen, der mit dem Projekt reisen sollte
- Zweck-Änderungen folgen dem **Speichern**- / **Zurücksetzen**-Fluss des Arbeitsbereichs
- Mitwirkende können den Zweck aktualisieren, auch wenn sie den Rest des Projekts nicht verwalten können

Diese Aufteilung ist absichtlich. Sie erlaubt die narrative Verantwortlichkeit breiter zu sein als die strukturelle Projektverwaltung.

Der Zweck-Editor enthält Dokumentimport und -export:

- **Importieren** akzeptiert eine `.docx`-Datei und konvertiert sie in das interne Markdown-Format. Wenn der Zweck bereits Inhalt hat, fragt KANAP vor dem Ersetzen um Bestätigung.
- **Exportieren** ermöglicht es Ihnen, den aktuellen Zweck als PDF, DOCX oder ODT herunterzuladen.

Diese Werkzeuge sind nützlich, wenn ein Projekt-Brief in Word entsteht oder wenn Stakeholder eine formatierte Kopie außerhalb von KANAP benötigen.

Das verwaltete Zweck-Dokument unterscheidet sich vom Reiter **Wissensdatenbank**:

- **Zweck** ist der eingebettete, projektgesteuerte Brief
- **Wissensdatenbank** ist für eigenständige Dokumente, die möglicherweise ihren eigenen Lebenszyklus, ihre eigene Wiederverwendung oder Beziehungen benötigen

### Aktivität

Unter Zweck enthält der Reiter Zusammenfassung den Projektaktivitäts-Stream:

- **Kommentare** für Diskussion, kontextbezogene Notizen und formale Entscheidungen
- **Historie** für das Audit-Protokoll von Feld- und Statusänderungen

**Historie** listet die erfassten Änderungen auf — Statuswechsel, Feldänderungen, Team- und Beziehungsänderungen, Änderungen am Dokument Zweck — und endet mit dem Erstellungseintrag: wer das Projekt erstellt hat und wann.

Manager können Projektkommentare hinzufügen und bearbeiten. Kommentare können auch als formale Entscheidungen aufgezeichnet werden, mit einem Ergebnis und einer optionalen Statusänderung. Verwenden Sie das, wenn die Diskussion selbst den Verlauf des Projekts ändert.

Bilder können in Aktivitätskommentaren enthalten sein, wenn visuelle Beweise nützlich sind — Architekturskizzen, Screenshots oder Review-Beweise.

Verwenden Sie **Historie**, wenn Sie wissen müssen, was sich geändert hat. Verwenden Sie **Kommentare**, wenn Sie wissen müssen, warum.

## Aufgaben

Der Reiter **Aufgaben** ist die Ausführungswarteschlange des Projekts. Das Reiter-Badge zeigt die Anzahl der Projektaufgaben.

- hier erstellte Aufgaben werden automatisch mit dem Projekt verknüpft
- Aufgaben können auch aus einer Zeitleisten-Phase erstellt werden, was sie sowohl mit dem Projekt als auch mit der ausgewählten Phase verknüpft
- der Reiter unterstützt Statusfilterung und Phasenfilterung
- die standardmäßige Aufgabenansicht konzentriert sich auf aktive Arbeit, indem erledigte und stornierte Elemente ausgeblendet werden

Dieser Reiter ist für die Verwaltung von projektbezogenen Aufgaben im Kontext, nicht für den Ersatz des vollständigen Aufgaben-Arbeitsbereichs. Das Öffnen einer Aufgabe führt Sie zu ihrem eigenen Arbeitsbereich, wo aufgabenspezifische Details und Zeiterfassung fortgesetzt werden.

Aus Projektsicht ist die wichtige Konsequenz folgende: Aufgabenstatus und Aufgabenzeit sind nicht isoliert. Sie fließen zurück in Zusammenfassung und Fortschritt, sodass vernachlässigte Aufgaben das gesamte Projektbild weniger vertrauenswürdig machen.

## Zeitleiste

Der Reiter **Zeitleiste** ist der Ort, an dem die Lieferstruktur explizit wird.

### Projektdaten

Der untere Teil des Reiters zeigt drei Zeilen:

- **Tatsächlich**: Daten, die durch Ausführungsereignisse erfasst werden (wann das Projekt zu In Bearbeitung wechselte und wann es Erledigt erreichte). Schreibgeschützt im Arbeitsbereich.
- **Geplant**: Das beabsichtigte Lieferzeitfenster. Bearbeiten Sie diese in der Eigenschaftsleiste.
- **Baseline**: Ein Snapshot der geplanten Daten, der erfasst wurde, als das Projekt zu **In Bearbeitung** wechselte. Abweichungen gegenüber der Baseline werden als `N Tage spät` oder `N Tage früh` angezeigt.

### Phasen

Projekte können mit einer Phasenvorlage oder einem vollständig benutzerdefinierten Phasenplan beginnen.

- wenn noch keine Phasen existieren, wählen Sie eine Vorlage und klicken Sie auf **Vorlage anwenden**, um die Anfangsstruktur zu erstellen
- sobald Phasen existieren, können sie neu sortiert werden (Griff ziehen), umbenannt, datiert und statusverwaltet werden
- jede Phasenzeile enthält ein Meilenstein-Kontrollkästchen; das Aktivieren erstellt einen Phasen-Abschluss-Meilenstein für diese Phase
- jede Phase hat eine Verknüpfung zum Erstellen einer Aufgabe, die bereits mit dieser Phase und diesem Projekt verknüpft ist
- **Phase hinzufügen** fügt eine neue leere Phase an
- **Mit Vorlage ersetzen** baut die Phasenstruktur aus einer Vorlage neu auf — verwenden Sie es nur, wenn Sie wirklich „das Phasenmodell von vorne anfangen" meinen

Das Phasenmodell beeinflusst mehr als die Zeitleiste:

- die aktive Phase erscheint zurück in der Zusammenfassung und in der Metadatenleiste
- phasenverknüpfte Aufgaben erben den Lieferkontext sofort
- Phasen-Meilensteine bieten Abschlussmarkierungen, ohne ein separates Verfolgungsschema zu erstellen

### Meilensteine

Eigenständige Meilensteine leben in ihrem eigenen Bereich unter den Phasen. Verwenden Sie **+ Meilenstein hinzufügen**, um sie zu erstellen. Jeder Meilenstein hat einen Namen, ein Zieldatum, einen Status und (wenn aus einer Phase ausgelöst) eine Verknüpfung zur Phase, die er repräsentiert.

Phasen-Abschluss-Meilensteine folgen der Phase, an die sie angehängt sind. Eigenständige Meilensteine sind für Kontrollpunkte gedacht, die außerhalb der Phasenstruktur existieren sollten.

### Tabellen- und Gantt-Ansichten

Über der Phasenliste wechseln Sie zwischen den Ansichten **Tabelle** und **Gantt**:

- verwenden Sie die **Tabellen**-Ansicht, wenn Sie die Struktur gestalten
- verwenden Sie die **Gantt**-Ansicht, wenn Sie Überlappung, Sequenzierung und Datumsverteilung sehen müssen

Nur Phasen mit verwendbaren Start- und Enddaten erscheinen sinnvoll im Gantt. Wenn die Daten vage sind, ist das Diagramm gleichermaßen vage. In der Gantt-Ansicht können Sie Phasenbalken ziehen, um Start-/Enddaten anzupassen (mit Verwaltungsberechtigung).

## Fortschritt

Der Reiter **Fortschritt** kombiniert Ausführungsfortschritt, Arbeitslastplanung und tatsächlichen Zeitverbrauch. Diese Kombination ist wichtig, weil ein Projekt, das 80 % Fortschritt mit 20 % verbrauchtem Aufwand meldet, nicht unbedingt effizient ist; es kann einfach schlecht geschätzt sein.

### Fortschritt und Arbeitslast

- **Ausführungsfortschritt** ist das Gesamtabschluss-Signal für das Projekt
- **Arbeitslastverbrauch** vergleicht den tatsächlichen Aufwand mit dem geplanten Aufwand

Halten Sie diese beiden Zahlen mit der Realität abgestimmt. Wenn der Fortschritt ohne entsprechenden Aufwand voranschreitet oder Aufwand ohne Lieferbewegung anwächst, sagt Ihnen die Diskrepanz normalerweise etwas Wichtiges über Umfang, Schätzung oder Berichtsdisziplin.

### Geschätzter Aufwand und Zuweisungen

Der Fortschritt trennt den geschätzten Aufwand in:

- **IT-Aufwand**
- **Fachbereichs-Aufwand**

Jede Seite kann auf den entsprechenden Leiter und die Mitwirkenden verteilt werden. Zuweisungen hängen vom Team ab, das in der Eigenschaftsleiste konfiguriert ist, sodass Teamänderungen auch hier Planungskonsequenzen haben.

### Tatsächlicher Aufwand und Zeitprotokoll

Der tatsächliche Aufwand wird aus zwei Quellen berechnet:

- **Projekt-Overhead**: direkt am Projekt protokollierte Zeit
- **Aufgabenzeit**: aus den Aufgaben des Projekts protokollierte Zeit

Das Zeitprotokoll fügt beide in eine Ansicht zusammen und identifiziert die Quelle für jeden Eintrag. Dies ist absichtlich: Projektaufwand sollte als der gesamte Lieferfußabdruck verstanden werden, nicht als ein Kampf zwischen „Projektarbeit" und „Aufgabenarbeit".

Wichtige Konsequenzen:

- Aufgabenzeit trägt automatisch zum tatsächlichen Projekt-Aufwand bei
- Aufgabenzeit ist hier sichtbar, muss aber im Aufgaben-Arbeitsbereich korrigiert werden
- Projekt-Overhead-Einträge werden vom Reiter Fortschritt aus gepflegt
- Mitwirkende können ihre eigenen Projekt-Overhead-Einträge pflegen
- Administratoren können Projekt-Overhead-Einträge benutzerübergreifend pflegen

### Baseline-Aufwand

Wenn das Projekt zu **In Bearbeitung** wechselt, erfasst KANAP Baseline-Aufwandswerte. Spätere Änderungen werden als Abweichung gegenüber dieser Baseline angezeigt, was nützlich ist, um normale Lieferaktualisierungen vom stillen Scope-Creep zu unterscheiden.

## Bewertung

Der Reiter **Bewertung** hält die Lieferung an die Priorisierung gebunden.

- für Projekte mit Anfragenherkunft bleibt die Quell-Anfrage als Bewertungsreferenz sichtbar
- für Schnellstart- und Legacy-Projekte wird die Bewertung direkt am Projekt gepflegt
- Manager können die Bewertung überprüfen oder aktualisieren, einschließlich Prioritäts-Überschreibungen, wo Portfolio-Regeln dies erlauben

Der resultierende Prioritätswert ist außerhalb dieses Reiters wichtig:

- er erscheint in der Projekt-Kopfzeile
- er ist in der Liste sichtbar
- er beeinflusst, wie Projekte rangiert werden, wenn die Liste nach Priorität sortiert ist

Wenn die Bewertung von der Lieferrealität abdriftet, werden Portfolio-Diskussionen schwieriger als nötig.

## Verknüpfungen

Der Reiter **Verknüpfungen** bringt die Verknüpfungen zusammen, die erklären, wie das Projekt in den Rest des Portfolios passt. Das Reiter-Badge zeigt die Anzahl der verwandten Elemente.

### Abhängigkeiten

Verfolgen Sie Lieferabhängigkeiten von anderen Anfragen oder Projekten. Verwenden Sie das Suchfeld, um ein verwandtes Element zu finden und hinzuzufügen; entfernen Sie Verknüpfungen, die Sie nicht mehr möchten, mit dem Lösch-Symbol des Chips.

Abhängigkeiten sind operativ, nicht kosmetisch. Sie prägen, wie Verzögerungen und Sequenzierungen zu interpretieren sind.

### Andere Beziehungen

Unter Abhängigkeiten ermöglicht der Reiter Verknüpfungen Ihnen auch, Verknüpfungen zu verwandtem geschäftlichen und technischen Kontext zu pflegen (zum Beispiel verwandte Anwendungen, Geschäftsprozesse oder andere Portfolio-Elemente). Jede Beziehung wird automatisch gespeichert.

## Wissensdatenbank

Der Reiter **Wissensdatenbank** verbindet das Projekt mit eigenständigen Wissensdokumenten. Das Reiter-Badge zeigt die Anzahl der verwandten Wissensdokumente.

Er unterscheidet zwischen:

- **Verknüpfte Dokumente**: Dokumente, die direkt am Projekt angehängt sind
- **Verwandte Dokumente**: Dokumente, die durch andere verknüpfte Entitäten wie Quell-Anfragen, Abhängigkeiten oder verbundene Elemente entdeckt werden

Diese Unterscheidung ist wichtig:

- direkte Verknüpfungen repräsentieren Dokumentation, die das Projekt explizit besitzt oder verwendet
- verwandte Verknüpfungen bieten Kontext, ohne vorzugeben, dass alles direkt zum Projekt gehört

Je nach Ihren Wissens-Berechtigungen können Sie:

- ein neues leeres Dokument erstellen, das bereits mit dem Projekt verknüpft ist
- ein verknüpftes Dokument aus einer Vorlage erstellen
- ein vorhandenes Dokument verknüpfen
- direkt verknüpfte Dokumente entkoppeln
- jedes verknüpfte oder verwandte Dokument in der Wissensdatenbank öffnen

Wenn Sie das Projekt öffnen können, aber keine Wissensanzeige-Rechte haben, sagt KANAP Ihnen, dass Wissen existiert, ohne den Dokumentinhalt offenzulegen. Das ist erwartetes Verhalten, kein defekter Reiter.

## CSV-Import und -Export

Projekt-CSV-Werkzeuge sind auf der Listenseite für Administratoren verfügbar.

### Export

Exporte unterstützen:

- **Vollständiger Export**
- **Datenanreicherung**
- **Benutzerdefinierte Auswahl**

Verwenden Sie **Datenanreicherung**, wenn Sie exportieren, ausgewählte Felder extern anpassen und das Ergebnis mit minimalem Drama wieder in KANAP importieren möchten.

### Import

Importe sind für kontrollierte Massenänderungen ausgelegt:

- laden Sie zuerst eine Vorlage herunter, wenn Sie die korrekte Struktur benötigen
- validieren Sie vor dem Import
- verwenden Sie erweiterte Optionen, um Anreicherungs- vs. Ersetzungsverhalten und Einfüge-/Aktualisierungsregeln zu wählen

Massenimport ist nützlich für die Pflege großer Portfolios, aber er ist keine Abkürzung um die Projekt-Governance herum. Phasenplanung, Aufgaben, Wissen und laufende Lieferkontrolle gehören weiterhin in den Arbeitsbereich.

## Einen Link senden

Verwenden Sie **Link senden** aus der Arbeitsbereichs-Kopfzeile, um einen direkten Projekt-Link an interne oder externe Empfänger zu senden.

- Sie können ihn an Plattformbenutzer oder an jede E-Mail-Adresse senden
- Sie können eine optionale Nachricht einfügen
- der kopierte oder per E-Mail gesendete Link verweist direkt auf den Projekt-Arbeitsbereich

Erneut: Das Senden eines Links gewährt keinen Zugriff. Es erspart den Leuten nur das selbständige Suchen nach dem Projekt.

## Praktische Anleitung

- Verwenden Sie die Eigenschaftsleiste für strukturelle Daten, die sichtbar bleiben sollen, während Sie arbeiten.
- Verwenden Sie **Zusammenfassung** für die Projekterzählung, die neueste Aktivität und das übergeordnete Betriebsbild.
- Verwenden Sie **Zeitleiste**, um die Lieferstruktur zu definieren, bevor das Aufgabenvolumen wächst.
- Verwenden Sie **Fortschritt** regelmäßig, sonst kommt die Aufwandsabweichung als Überraschung, obwohl die Daten Sie bereits gewarnt haben.
- Verwenden Sie **Wissensdatenbank** für wiederverwendbare oder gesteuerte Dokumentation, nicht als zweite Kopie des Zweck-Briefs.
- Verwenden Sie **Importieren** im Zweck-Editor, wenn ein Projekt-Brief bereits als Word-Dokument existiert, anstatt ihn von Hand neu zu formatieren.
