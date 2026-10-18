---
title: "OPEX und CAPEX: das IT-Budget, bereit für die Abstimmung mit dem Controlling"
description: "Betriebs- und Investitionsausgaben an einem Ort: Die IT baut ihr Budget einfach auf und geht gut vorbereitet in die Abstimmung mit dem Controlling."
date: 2026-10-17
topic: cost
author: Friedrich
authorRole: Gründer, CIO
draft: false
translationKey: opex-capex-it-budget
series:
  key: opex-budget
  part: 4
  title: "Das IT-Budget aufbauen"
---

Das IT-Budget besteht aus zwei Töpfen: Betriebs- und Investitionsausgaben. Oft lebt jeder in seiner eigenen Datei, mit eigenem Kalender und der Person, die ihn pflegt. Dann kommt die Abstimmung mit dem Controlling und seinen Fragen: Wie viel ist Betrieb, wie viel Investition, wofür ist es, was kostet dieses Programm wirklich?

Jede Antwort erfordert dann eine Konsolidierung von Hand. KANAP ist der Ort, an dem die IT ihr Budget vorbereitet, OPEX und CAPEX zusammen, ganz einfach. Und weil jede Zeile bei der Eingabe klassifiziert wird, kommt die IT mit sauberen, stimmigen und leicht zu begründenden Zahlen in die Abstimmung.

## OPEX oder CAPEX, die Regel in einfachen Worten

**OPEX** hält das Informationssystem im Lauf des Jahres am Laufen: Abonnements, Wartung, wiederkehrende Dienstleistungen. **CAPEX** schafft oder verbessert ein Wirtschaftsgut, das über mehrere Jahre genutzt wird: Server, Arbeitsplatzrechner, aktivierte Entwicklung. Was aktiviert wird, folgt den Bilanzierungsregeln des Unternehmens, die das Controlling mit der IT festlegt.

Eine zweite Frage wird oft mit der ersten vermischt: Run oder Build? Run hält bestehende Dienste am Laufen, Build schafft oder verändert sie. Ein Build-Projekt trägt oft beide Ausgabenarten: aktivierte Entwicklung in CAPEX, Schulung und Change Management in OPEX. KANAP hält beide Antworten auf jeder Zeile fest, in zwei getrennten Feldern, und lässt sie trotzdem konsolidieren.

## Eine Liste, ein Arbeitsbereich

In KANAP sind OPEX und CAPEX ein einfaches Feld der Budgetzeile. Zeilen beider Typen teilen sich pro Jahr dieselben Budgetspalten (Szenarien), dieselben Zuordnungen auf Unternehmen und Abteilungen, dieselben Verknüpfungen zu Anwendungen, Projekten, Verträgen und Lieferanten. Der Filter der Spalte **Typ** trennt das eine vom anderen mit einem Klick.

![Die Budgetzeilen von Fromage & Co: OPEX- und CAPEX-Zeilen zusammen, mit der Spalte Typ](/screenshots/blog/opex-capex-list-2026-10-17.png)

Der Typ OPEX oder CAPEX steuert einige Felder der Zeile:

- **Konten**: Jedes Konto des Kontenplans dient OPEX, CAPEX oder beiden. Eine CAPEX-Zeile sieht nur Investitionskonten.
- **Analysedimensionen**: Eine Dimension oder ein Wert kann einem Typ vorbehalten werden (siehe unten).
- **Leistungsverrechnung**: Die Berichte zur Leistungsverrechnung und Analyse bieten OPEX, CAPEX oder beide.
- **Einfrieren**: Eine Budgetspalte wird pro Jahr und pro Typ eingefroren. Ein genehmigtes Investitionsbudget lässt sich sperren, während das Betriebsbudget noch in Vorbereitung ist.

## Dimensionen, die gemeinsame Sprache von IT und Controlling

Analysedimensionen klassifizieren Zeilen für das Reporting, neben der Kontenstruktur (Einzelheiten in [Analysedimensionen: was Sicherheit die IT wirklich kostet](/de/blog/analysedimensionen-im-it-budget)). Jede Dimension beantwortet eine Frage. Welche Dimensionen passen, hängt von jeder Organisation ab. Hier ein Beispiel aus der guten Praxis, das jeder anpassen kann.

Sie müssen nicht bei null anfangen! Ein neuer KANAP-Arbeitsbereich startet mit vier empfohlenen Dimensionen und ihren Werten (Kostenart, IT-Bereich, Zweck und Priorität). Jede lässt sich danach umbenennen, erweitern und nach Bedarf einrichten.

**„Wofür ist diese Investition?“** Die Dimension **Zweck**: Ersatz, Kapazität, Produktivität, Sicherheit, Compliance, Wachstum. Ist sie den CAPEX-Zeilen vorbehalten und als Pflichtfeld gesetzt, kommt jede neue Investition klassifiziert an, ob sie am Bildschirm angelegt, aus einer Datei geladen, von Plaid vorbereitet oder über die API gesendet wird. Kein Nachlaufen hinter einer vergessenen Spalte mehr.

**„Was können wir nicht kürzen?“** Die Dimension **Priorität**: zwingend, hoch, mittel, niedrig. Sie strukturiert die Abwägungen im Gremium. Bei Fromage & Co, unserem Beispielunternehmen, machen die zwingenden Investitionen 2026 1,13 Mio. € von 2,34 Mio. € aus: die Migration auf S/4HANA, die Erneuerung des Rechenzentrums und die Netzsegmentierung der Werke.

**„Was kostet dieses Programm insgesamt?“** Eine Dimension **Programm**, in Sekunden angelegt, von OPEX und CAPEX gleichermaßen genutzt, mit einem Wert pro Programm. Das S/4HANA-Programm von Fromage & Co vereint 984.000 € an Wartung, externen Dienstleistern und Support in den Betriebsausgaben und 757.000 € an Investitionen (Integration, aktivierte Entwicklung, HANA-Server): 1,74 Mio. € für das Jahr, in einem einzigen Bericht. Endet das Programm, wird der Wert deaktiviert: Er bleibt auf den Zeilen und in vergangenen Berichten und wird nicht mehr angeboten.

**„Welche Art von Ausgabe ist das?“** **Kostenart** und **IT-Bereich**, aus dem TBM-Modell (Technology Business Management), von beiden Typen gemeinsam genutzt. Ein Wert kann einem Typ vorbehalten werden: internes Personal zum Beispiel nur für OPEX.

![Das Eigenschaften-Panel einer CAPEX-Zeile: Investitionskonto, Zweck, Priorität und Programm ausgefüllt](/screenshots/blog/opex-capex-line-properties-2026-10-17.png)

Die Verbindung zur Buchhaltung läuft über die Konten, pro Typ festgelegt, und die Konsolidierungskonten des Konzerns. Dimensionen bleiben ein Werkzeug zum Lesen und Analysieren: Konten und Zuordnungen lassen sie unberührt.

Die IT gewinnt eine Klassifizierung, die bei der Eingabe der Zeilen geschieht, und das Controlling Regeln, die sich selbst durchsetzen. Eine Dimension lässt sich umbenennen, neu ordnen oder mit einem Ende der Gültigkeit versehen, ohne die Historie zu verlieren, und das Audit-Protokoll hält die Änderungen fest.

## Berichte: Alle, OPEX oder CAPEX

Acht Berichte öffnen mit drei Reitern, **Alle**, **OPEX** und **CAPEX**: Top-Zeilen, Top Anstieg und Rückgang, Budgetvergleich, Budgetspaltenvergleich, Konsolidierungskonten, Analysedimensionen, Personal nach Monat und Kosten pro VZÄ.

Die Filter lassen sich kombinieren: Kostenstelle, Run oder Build und ein Wert pro Dimension. Das CAPEX 2026 nach Zweck gruppiert, die Kosten eines Programms im Reiter **Alle**, nur die zwingenden Investitionen einer Tochtergesellschaft: Jede Sicht braucht ein paar Klicks.

![Der Bericht Analysedimensionen zum CAPEX 2026 von Fromage & Co, gruppiert nach Zweck](/screenshots/blog/opex-capex-report-purpose-2026-10-17.png)

Im Beispiel entfallen 59 % der Investitionen 2026 auf Ersatz, 35 % auf Wachstum und 5 % auf Sicherheit. Das ist die Art von Zahl, die echte Transparenz schafft, umso mehr, wenn sie sich von einem Jahr zum nächsten vergleichen lässt. Und hier ist sie, einen Klick entfernt.

Die Adresse der Seite enthält den Typ und die Filter. Der Link an den Controller öffnet genau dieselbe Sicht, der PDF-Export zeigt denselben Inhalt. Auch die Berichte zur Leistungsverrechnung bieten OPEX, CAPEX oder beide. CAPEX zählt dort mit seinem Betrag des Jahres.

Schließlich können alle diese Daten eigene Berichte speisen, die Ihr bevorzugtes KI-Werkzeug erstellt, direkt mit KANAP verbunden.

## Wenn eine Ausgabe den Typ wechselt

Eine Dienstleistung erweist sich als aktivierbar, eine Investition wird wieder zur Betriebsausgabe. Auf der Zeile erledigt **Typ ändern…** den Wechsel sauber:

- **Ab dem ersten Jahr der Zeile** wechselt die Zeile selbst den Typ. Sie behält ihre Referenz, Budgets, Zuordnungen und Verknüpfungen.
- **Ab einem späteren Jahr** endet die Zeile am 31. Dezember des Vorjahres und behält ihre Historie. Eine neue Zeile des anderen Typs übernimmt, mit den Verknüpfungen zu Anwendungen, Verträgen und Projekten. Die beiden Zeilen bleiben verbunden: „Ersetzt durch“ auf der einen Seite, „Folgt auf“ auf der anderen.

![Das Fenster Typ ändern einer Budgetzeile: Startjahr, Konto und Grund](/screenshots/blog/opex-capex-change-type-2026-10-17.png)

Das Fenster schlägt ein Konto vor, das zum neuen Typ passt, und fragt nach den Pflichtdimensionen dieses Typs, falls es welche gibt. Der Grund für die Änderung geht ins Audit-Protokoll. Ein eingefrorenes Budget bleibt unangetastet: Die Änderung wird abgelehnt, solange eine eingefrorene Spalte in den betroffenen Jahren Beträge enthält.

## Was KANAP nicht tut

KANAP berechnet keine Abschreibungen und führt kein Anlagenverzeichnis: Das ist Aufgabe der Buchhaltung und des ERP. KANAP bereitet das IT-Budget vor und verfolgt es, OPEX und CAPEX, so klassifiziert, wie das Controlling es verlangt.

## Wo Sie anfangen

1. **Gehen Sie von den Fragen des Controllings aus**: denen, die bei jeder Budgetabstimmung wiederkommen. Jede wird zu einer Dimension oder zu einem Filter eines bestehenden Berichts.
2. **Passen Sie die empfohlenen Dimensionen an**: Benennen Sie um, was nötig ist, ergänzen Sie fehlende (zum Beispiel ein Programm), behalten Sie CAPEX vor, was nur Investitionen betrifft, und machen Sie die wesentlichen Dimensionen zur Pflicht.
3. **Gehen Sie die bestehenden Zeilen durch**, um die noch leeren Dimensionen zu füllen. Unter jeder Pflichtdimension zählt KANAP die Zeilen ohne Wert und öffnet ihre Liste mit einem Klick.
4. **Prüfen Sie das Ergebnis vor der Abstimmung in den Berichten**: Was noch „Nicht zugeordnet“ ist, zeigt, was noch zu klassifizieren bleibt.

Um all das an einem bereits klassifizierten Budget zu sehen, bietet eine kostenlose 14-tägige Testphase unserer gehosteten Version Zugang zu den Beispieldaten der fiktiven Gruppe Fromage & Co, in einer Minute geladen. KANAP ist vollständig Open Source: Sie können es auch kostenlos auf Ihren eigenen Servern installieren.
