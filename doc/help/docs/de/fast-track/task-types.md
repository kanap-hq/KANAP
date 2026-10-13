---
title: "Aufgabentypen-Schnelleinstieg: Run, Build & Aufgaben"
description: Verstehen Sie die verschiedenen Arbeitstypen in KANAP -- Incidents, Problems, Anfragen, Projekte, Bugs und Aufgaben -- und wie Sie im Alltag mit Aufgaben arbeiten.
---

# Aufgabentypen-Schnelleinstieg: Run, Build & Aufgaben

Dieser Leitfaden erklärt die verschiedenen Typen von Arbeitselementen in KANAP und wie man sie unterscheidet. Er behandelt den Run (den Betrieb am Laufen halten), den Build (Dinge verbessern) und die bereichsübergreifende Aufgabe, die beides verbindet. Die zweite Hälfte ist ein praktischer Spickzettel für die tägliche Arbeit mit Aufgaben.

!!! tip "Bevorzugen Sie eine einseitige Zusammenfassung? :material-file-pdf-box:"
    Alle wichtigen Definitionen auf einer einzigen A4-Seite -- ausdrucken, aufhängen, mit dem Team teilen.

    [:material-download: Spickzettel herunterladen (PDF)](downloads/kanap-task-types-fast-track.pdf){ .md-button .md-button--primary }

---

## Das Gesamtbild

Alles, was Ihre IT-Abteilung tut, fällt in eine von zwei Kategorien -- plus eine universelle Arbeitseinheit, die beide übergreift:

| Kategorie | Zweck | Arbeitselemente |
|-----------|-------|-----------------|
| **Run** | Bestehende Systeme betriebsfähig und sicher halten | Incident, Problem |
| **Build** | Die IT-Landschaft weiterentwickeln und aufbauen | Anfrage, Projekt, Bug |
| **Bereichsübergreifend** | Atomare Arbeitseinheit über Run und Build | Aufgabe |

---

## Run -- Den Betrieb am Laufen halten

Jeder beteiligt sich am Run. Er stellt die **betriebliche Kontinuität** (MCO) und die **Sicherheitswartung** (MCS) bestehender Systeme sicher.

### Incident

Eine **ungeplante Unterbrechung oder Beeinträchtigung** eines Produktionsdienstes.

- Hat einen erheblichen Einfluss auf das Funktionieren des Informationssystems
- Das Ziel ist die **Wiederherstellung des Dienstes** -- schnellstmöglich wieder funktionsfähig machen
- Reaktiver Natur: Etwas ist kaputtgegangen und Benutzer sind betroffen

!!! example "Beispiele"
    - MES-Systemausfall
    - Unerwarteter VM-Neustart
    - Unternehmensweiter VPN-Zugangsausfall

### Problem

Eine **Ursachenuntersuchung**, ausgelöst durch wiederkehrende Incidents.

- Typischerweise von der IT identifiziert, nachdem ein **Muster ähnlicher Incidents** erkannt wurde
- Das Ziel ist eine **dauerhafte Lösung** -- die zugrunde liegende Ursache beheben, nicht nur die Symptome
- Proaktiv: Die IT eröffnet ein Problem, um zukünftige Incidents zu verhindern

!!! example "Beispiele"
    - Wiederkehrende Leistungsverschlechterung beim Internetzugang
    - Wiederholte Fehler auf einer Datenschnittstelle

---

## Build -- Die Landschaft weiterentwickeln

Der Build umfasst alle **Weiterentwicklungen und den Aufbau** des Informationssystems. Jeder beteiligt sich.

### Anfrage (Change Request)

Eine **geplante Anforderung zur Änderung** des Informationssystems.

- Kann technischer, funktionaler, fachlicher oder IT-seitiger Natur sein
- Selten dringend
- Löst einen **Validierungs-Workflow** aus und wird bei Genehmigung zu einer Aufgabe oder einem Projekt
- Erfüllt mindestens eines dieser Kriterien:
    - Erheblicher Arbeitsaufwand (>3 Tage)
    - Umfasst mehrere IT- oder Fachbereichsteams
    - Erfordert erheblichen Change-Management-Aufwand

!!! example "Beispiele"
    - Neues Feld zur Synchronisation zwischen SAP und PLM
    - Neue Fachbereichsanwendung
    - Integration eines Remote-Standorts

### Projekt

Ein **koordinierter Satz von Aufgaben**, organisiert um ein definiertes Ziel, mit Umfang, Zeitplan, Budget und identifizierten Ergebnissen.

- Gleiche Kriterien wie eine Anfrage -- entsteht normalerweise aus einer genehmigten Anfrage
- **Schnellverfahren**: Einige Projekte werden ohne den Anfrageprozess aufgesetzt (Vorstandsentscheidung, dringende regulatorische Änderung...). Sie gehen direkt als Projekt ein.

!!! example "Beispiele"
    - S4/HANA-Upgrade
    - Firewall-Migration

### Bug

Ein **Defekt in einem System in der Entwicklung**.

- Zu komplex, um in einem einfachen Ticket behandelt zu werden -- erfordert eingehende Analyse
- Rein ein Build-Konzept: Das System ist noch nicht in Produktion (oder der Defekt betrifft eine Komponente, die noch gebaut wird)

!!! example "Beispiele"
    - Unzureichende Zugriffsrechte auf einer neuen SAP-Kachel
    - Fehlerhafte Firewall-Regel bei einem neuen Server-Deployment

!!! warning "Incident vs. Bug"
    Dies ist die häufigste Verwechslung. Die Regel ist einfach:

    - **Es läuft in Produktion und geht kaputt?** → **Incident** (Run)
    - **Es ist in der Entwicklung und funktioniert nicht?** → **Bug** (Build)

    Die Unterscheidung ist wichtig, weil Incidents die **Dienstwiederherstellung** priorisieren, während Bugs die **Ursachenbehebung im Entwicklungszyklus** priorisieren.

---

## Bereichsübergreifend -- Die Aufgabe

Aufgaben sind die **atomare Arbeitseinheit** in KANAP. Sie übergreifen die Run/Build-Grenze.

### Aufgabe

Eine **klar umrissene Aktion** mit einem definierten Verantwortlichen, Status und Termin.

- Kann **eigenständig** sein oder mit einem **Projekt**, einer **OPEX-Zeile**, einem **Vertrag** oder einer **CAPEX-Zeile** verknüpft werden
- Trägt einen konkreten Aufwand
- Der Einfluss auf Benutzer oder Dienste ist begrenzt und gut verstanden
- Erfordert keine Koordination über mehrere Teams -- auch wenn es lange dauert, wird es von einer einzelnen Person getragen, ohne bereichsübergreifende Analyse zu erfordern

!!! example "Beispiele"
    - Neuen Domänencontroller installieren
    - Die neue Notilus-zu-S4/HANA-Schnittstelle dokumentieren
    - SSL-Zertifikat auf dem Intranet-Portal erneuern

!!! info "Aufgabe vs. Anfrage/Projekt"
    Wenn die Arbeit **eines** dieser Kriterien erfüllt, ist es eine Anfrage (und potenziell ein Projekt), keine Aufgabe:

    - Erheblicher Arbeitsaufwand (>3 Tage) **UND** erfordert bereichsübergreifende Analyse
    - Erfordert Koordination über mehrere Teams
    - Erfordert erhebliches Change Management

    Eine Aufgabe kann 10 Tage dauern, wenn sie von einer Person getragen wird, ohne besondere bereichsübergreifende Komplexität.

---

## Zusammenfassungstabelle

| Typ | Kategorie | Hauptkriterium | Beispiel |
|-----|-----------|----------------|---------|
| **Incident** | Run | Ungeplante Unterbrechung/Beeinträchtigung in Produktion | MES-Ausfall |
| **Problem** | Run | Ursache wiederkehrender Incidents | Wiederkehrende Internet-Leistungsprobleme |
| **Anfrage** | Build | Geplante SI-Änderung (>3T / Multi-Team / Change Mgmt) | Neues SAP-zu-PLM-Feld |
| **Projekt** | Build | Koordinierter Aufgabensatz mit Umfang, Zeitplan, Budget | S4/HANA-Upgrade |
| **Bug** | Build | Defekt in einem System in der Entwicklung | Fehlerhafte Firewall-Regel auf neuem Server |
| **Aufgabe** | Bereichsübergreifend | Umrissene Aktion, ein Verantwortlicher, keine Multi-Team-Koordination | SSL-Zertifikat erneuern |

---

## Mit Aufgaben arbeiten -- Spickzettel

Der Rest dieses Leitfadens behandelt die praktischen Grundlagen. Für vollständige Details siehe [Aufgaben](../tasks.md).

### Wo Aufgaben leben

| Kontext | Was es bedeutet | Wo erstellen |
|---------|-----------------|--------------|
| **Eigenständig** | Unabhängige Arbeit, mit nichts verknüpft | **Portfolio > Aufgaben > Neu** |
| **Projekt** | Ergebnis innerhalb eines Projekts | Projekt-Arbeitsbereich **Aufgaben**-Tab, oder **Zeitstrahl**-Phasen-Verknüpfung |
| **OPEX** | Aktion gebunden an eine OPEX-Zeile | Arbeitsbereich der Budgetzeile, Bereich **Aufgaben** im Tab **Übersicht** |
| **Vertrag** | Aktion gebunden an einen Vertrag | Vertrags-Arbeitsbereich **Aufgaben**-Tab |
| **CAPEX** | Aktion gebunden an eine CAPEX-Zeile | Arbeitsbereich der Budgetzeile, Bereich **Aufgaben** im Tab **Übersicht** |

Alle Aufgaben erscheinen in der zentralen **Portfolio > Aufgaben**-Liste unabhängig vom Kontext, sodass Sie immer einen Ort haben, um alles zu sehen.

### Status auf einen Blick

| Status | Farbe | Bedeutung |
|--------|-------|-----------|
| **Offen** | Grau | Noch nicht begonnen |
| **In Bearbeitung** | Orange | Jemand arbeitet daran |
| **Ausstehend** | Blau | Blockiert -- wartet auf Eingabe oder Entscheidung |
| **Im Test** | Lila | Umsetzung erledigt, wartet auf Validierung |
| **Erledigt** | Grün | Abgeschlossen (erfordert erfasste Zeit bei Projektaufgaben) |
| **Abgebrochen** | Rot | Nicht mehr benötigt |

### Prioritätsstufen

| Priorität | Wann verwenden |
|-----------|---------------|
| **Blocker** | Blockiert andere Arbeit -- sofortige Aufmerksamkeit |
| **Hoch** | Wichtig und zeitkritisch |
| **Normal** | Standardpriorität (Standard) |
| **Niedrig** | Kann aufgeschoben werden |
| **Optional** | Nice-to-have |

### Der Aufgaben-Arbeitsbereich -- Kernbereiche

Wenn Sie eine Aufgabe öffnen, haben Sie eine Seitenleiste links und einen Hauptinhaltsbereich rechts.

**Seitenleisten-Abschnitte**:

- **Kontext** -- womit die Aufgabe verknüpft ist (oder Eigenständig)
- **Aufgabendetails** -- Typ, Priorität, Status
- **Klassifizierung** -- Quelle, Kategorie, Stream, Unternehmen (nur bei eigenständigen und Projektaufgaben; Standardwerte aus Organisationseinstellungen oder übergeordnetem Projekt)
- **Zeit** -- Gesamtzeit und Schaltfläche Zeit erfassen (nur bei eigenständigen und Projektaufgaben)
- **Personen** -- Antragsteller, Beauftragter, Betrachter
- **Termine** -- Start- und Fälligkeitsdatum
- **Wissensdatenbank** -- Wissensdatenbank-Artikel mit der Aufgabe verknüpfen

**Hauptinhalt**:

- **Beschreibung** -- ein Markdown-Editor mit Unterstützung für Formatierung, Listen, Codeblöcke, Links und eingefügte Bilder
- **Import / Export** -- eine `.docx`-Datei in die Beschreibung importieren, oder als PDF, DOCX oder ODT exportieren
- **Anhänge** -- Drag-and-Drop-Dateiuploads (bis zu 20 MB pro Datei)
- **Aktivität** -- Kommentare-, Verlauf- und Zeitprotokoll-Tabs

### Schnellaktionen, die Sie kennen sollten

| Aktion | Wie |
|--------|-----|
| **Speichern** | Klicken Sie auf **Speichern** oder drücken Sie **Strg+S** (Cmd+S auf Mac) |
| **In Anfrage konvertieren** | Header-Symbolleiste -- stuft eine Aufgabe zu einer formalen Portfolio-Anfrage auf, wenn der Umfang wächst |
| **Link senden** | Header-Symbolleiste -- einen Link per E-Mail an Kollegen oder externe Kontakte senden |
| **Zeit inline erfassen** | Im Kommentare-Tab einen Kommentar + Statusänderung + Zeiteintrag in einem Schritt absenden |
| **Referenz kopieren** | Auf den Referenz-Chip klicken (z. B. T-42), um ihn in die Zwischenablage zu kopieren |

### Was je nach Kontext variiert

Nicht jede Funktion ist in jedem Kontext verfügbar. Hier ist, was sich ändert:

| Funktion | Eigenständig | Projekt | OPEX / Vertrag / CAPEX |
|----------|:------------:|:-------:|:----------------------:|
| Klassifizierungsfelder | Ja | Ja (Standardwerte aus Projekt) | Nein |
| Zeiterfassung | Ja | Ja (speist Projekt-Ist-Werte) | Nein |
| Phasenzuordnung | Nein | Ja | Nein |
| Prioritätswert-Badge | Fest nach Priorität | Berechnet aus Projekt + Priorität | Fest nach Priorität |
| Erledigt erfordert erfasste Zeit | Nein | Ja | Nein |

### Klassifizierungs-Standardwerte

Wenn Sie eine **eigenständige Aufgabe** erstellen, füllt KANAP Klassifizierungsfelder (Quelle, Kategorie, Stream, Unternehmen) aus den Standardeinstellungen Ihrer Organisation vor -- und spart Ihnen ein paar Klicks. Für **Projektaufgaben** kommen die Klassifizierungsstandards vom übergeordneten Projekt, können aber unabhängig auf jeder Aufgabe geändert werden.

---

## Aufgabentypen anpassen

Alle Arbeitselementtypen sind unter **Portfolio > Einstellungen** **konfigurierbar**. Sie können:

- Neue Typen **hinzufügen**, die zu den Prozessen Ihrer Organisation passen
- Bestehende Typen **deaktivieren**, die Sie nicht benötigen
- Typen **umbenennen**, um Ihrer Terminologie zu entsprechen

Die Liste in diesem Leitfaden ist ein Ausgangspunkt. Passen Sie sie an die tatsächliche Arbeitsweise Ihrer IT-Abteilung an.

---

## Weiterführend

- [Aufgaben](../tasks.md) -- vollständige Referenz für Status, CSV-Import/Export, Zeiterfassung und jede Arbeitsbereich-Funktion
- [Budgetzeilen](../budget-lines.md): OPEX- und CAPEX-Zeilen und ihre Aufgaben verwalten
- [Verträge](../contracts.md) -- Verträge und ihre Aufgaben verwalten
- [Portfolio-Projekte](../portfolio-projects.md) -- Projektumsetzung, Phasen, Aufwandsverfolgung und Projektaufgaben
- [Erste Schritte](getting-started.md) -- wenn Sie neu bei KANAP sind

!!! success "Sie sind startklar"
    Sie verstehen jetzt, wie KANAP Arbeit kategorisiert und wie Sie Aufgaben im Alltag nutzen. Wenn Sie sich bei der Wahl des richtigen Arbeitselementtyps unsicher sind, fragen Sie sich: **Hält es den Betrieb am Laufen (Run) oder macht es Dinge besser (Build)?** Dann wählen Sie den passenden Typ. Für alles andere gibt es eine Aufgabe.
