---
title: "Der erwartete Endwert des IT-Budgets, Zeile für Zeile"
description: "Den erwarteten Endwert des laufenden IT-Budgets Zeile für Zeile absichern, damit er eine solide Grundlage für das Budget des nächsten Jahres wird."
date: 2026-08-29
topic: cost
author: Friedrich
authorRole: Gründer, CIO
draft: false
updated: 2026-10-10
translationKey: opex-expected-landing
series:
  key: opex-budget
  part: 1
  title: "Das IT-Budget aufbauen"
---

September. Das Controlling verlangt eine erste Fassung des Budgets 2027, und die Excel-Datei vom letzten Jahr kommt aus der Schublade: zweihundert Zeilen, acht Reiter, drei Versionen, die nicht mehr übereinstimmen. Alles wieder von vorn?

Diese Serie zeigt Schritt für Schritt, wie Sie in KANAP ein vollständiges OPEX-Budget vorbereiten. Teil 1: den Endwert des laufenden Jahres absichern. Teil 2: die Zahlen auf 2027 übertragen. Teil 3: präsentieren, verteidigen, festschreiben. Das Prinzip gilt von Anfang bis Ende: Sie ändern nur, was sich bewegt, KANAP erledigt den Rest, die Präsentation eingeschlossen.

Ihre Zeilen liegen noch in Excel? „CSV importieren“ lädt sie in einem Durchgang, und die Durchsicht beginnt noch am selben Tag. KANAP prüft die ganze Datei, bevor es etwas schreibt, und schreibt dann nur die Zellen, die sich geändert haben. Der Austausch mit der Tabelle bleibt während der ganzen Durchsicht möglich.

## Der erwartete Endwert, die Spalte, auf die es ankommt

Jede Budgetzeile (`BL-12`, `BL-47`...) hat pro Jahr fünf Budgetspalten: **Budget**, **Revision**, **Prognose**, **Ist-Werte** und **Erwarteter Endwert**, für das Vorjahr, das laufende Jahr und die zwei folgenden. Ihre Budgetrunden heißen anders, A0, A1 oder „Juni-Prognose“? Benennen Sie die Spalten um, blenden Sie die ungenutzten aus und wählen Sie die Standardspalte: Sie sortiert die Listen, und die Berichte wählen sie vorab aus. In dieser Phase geht es darum, wo und wie das laufende Jahr endet. Tragen Sie Ihre beste Schätzung dessen ein, was jede Zeile bis zum 31. Dezember tatsächlich gekostet haben wird.

Er ist auch die Grundlage für das Budget des nächsten Jahres: Ein sorgfältiger Endwert verhindert, dass Beträge ins neue Jahr wandern, die sich im Lauf des Jahres schon geändert haben.

## Filtern wie in Excel

Niemand prüft zweihundert Zeilen in einem Zug. Die Liste der Budgetzeilen bedient sich wie eine Tabellenkalkulation: oben ein Schnellfilter, an jeder Spalte Filter mit Kontrollkästchen. Typ, Zahlendes Unternehmen, Konto, Kostenstelle, Zuordnung, Währung, IT-Verantwortlicher, Fachbereichsverantwortlicher, Analysedimensionen: ein paar Häkchen setzen, die Liste wird kürzer, und die Summenzeile rechnet über die Auswahl neu.

![Die Liste der Budgetzeilen, gefiltert auf zwei Softwarekonten. Die Summenzeile folgt der Auswahl: 21 Zeilen.](/screenshots/blog/budget-lines-filters-2026-10-13.png)

Die Durchsicht teilt sich dann von selbst auf: an einem Vormittag die Dienstleistungen, am nächsten Tag die Lizenzen, danach die Zeilen einer Tochtergesellschaft. Die Filter stehen in der URL. Sie öffnen eine Zeile, kehren zurück, und die Auswahl ist unverändert.

Wenig Zeit? Sortieren Sie nach Betrag und arbeiten Sie die 20 größten Zeilen ab. Sie tragen meist den Großteil des Budgets.

## Die Auswahl Zeile für Zeile durchgehen

Öffnen Sie die erste Zeile der Auswahl, Reiter **Budget**. Die Pfeile für vorherige und nächste Zeile zeigen „3 von 21“ und folgen Ihrer gefilterten Liste in deren Sortierung. Sie gehen Zeile für Zeile weiter und korrigieren den Endwert nur dort, wo die Wirklichkeit abgewichen ist: ein neu verhandelter Vertrag, ein verschobenes Projekt, Cloud-Verbrauch über Plan.

![Der Reiter Budget einer Budgetzeile: eine Karte pro Spalte, der Betragseditor und das Monatsergebnis, mit „3 von 21“, um durch die Auswahl zu blättern.](/screenshots/blog/budget-tab-2026-10-13.png)

Für Zeilen, die mehr als einen Jahresbetrag verdienen, wählen Sie die Karte der Spalte und legen fest, wie sie sich zusammensetzt: **Betrag** (ganzes Jahr, ein Zeitraum oder zu einem Datum, linear oder 4-4-5), **Menge und Preis** oder **Pro Monat**.

Eine leere Spalte kann **Ausgehend von** einer anderen starten, angepasst um einen Prozentsatz. Sie haben es sich anders überlegt? **Zurück zu den Werten beim Öffnen** stellt die bearbeiteten Spalten wieder her.

> Zeilen, bei denen sich nichts bewegt hat, bleiben leer. Teil 2 füllt sie alle auf einmal.

## Dienstleistungen nach Aufwand: Menge × Preis

Für externe Dienstleister, eine monatliche Pauschale oder Lizenzen pro Einheit sagt ein Jahresbetrag wenig aus. Im Reiter Budget zerlegt „Menge und Preis“ den Betrag in Zeilen: eine Menge, eine Einheit (Personen, Tage oder Stück), ein Stückpreis und ein Zeitraum.

![Eine Dienstleisterzeile aus Menge × Preis: 2 Personen in Vollzeit zu 470 € pro Tag über 218 Arbeitstage, 2 VZÄ über das Jahr.](/screenshots/blog/budget-quantity-price-2026-10-13.png)

Zwei Berater zu 650 € pro Tag, Vollzeit von März bis Dezember: KANAP berechnet jeden Monat aus den Arbeitstagen im Kalender des Landes des zahlenden Unternehmens, ohne Feiertage. Endet der Einsatz im Oktober oder wurde der Tagessatz neu verhandelt, ändern Sie das Datum oder den Preis, und der Endwert wird neu berechnet. Kein Nachrechnen von Hand mehr.

Die Kalender liegen unter Stammdaten > Arbeitstagekalender. Der Standardkalender eines Landes wird mit dem Unternehmen angelegt. Ein eigener Kalender deckt ein Werk ab, das im August drei Wochen schließt.

Nebenbei gibt jede Zeile in Personen oder Tagen ihre VZÄ an (Vollzeitäquivalente). Teil 3 beantwortet damit die Frage „wie viele Personen, zu welchen Kosten?“.

## Wo Sie schon dabei sind: notieren Sie, was Sie über 2027 bereits wissen

Der Reiter für das Jahr 2027 liegt direkt daneben. Nutzen Sie die Durchsicht, um bereits beschlossene Änderungen einzutragen: eine Erweiterung des Umfangs, eine Neuverhandlung, eine Kündigung... Für Vertragsenden müssen Sie nichts im Kopf behalten: Jede Zeile zeigt ihren Vertrag, und jeder Vertrag trägt seine Kündigungsfrist. Die Fristen 2027 stehen in der Vertragsliste.

Nutzen Sie auch die Notizen: eine kurze Zeile („+10 % im Q3, Neuverhandlung läuft“), und in sechs Monaten danken Sie es sich selbst.

Diese von Hand eingetragenen Beträge sind sicher: Die automatische Kopie aus Teil 2 füllt nur leere Zellen.

## Profi-Tipp: zuerst die Währungen

KANAP verwaltet Budgets in mehreren Währungen, aber richten Sie diese vorher ein. Unter Budgetverwaltung → Administration → **Währungen** legen Sie die Berichtswährung, die Standardwährungen für OPEX und CAPEX und die Liste der zulässigen Währungen fest. Die Wechselkurse werden pro Geschäftsjahr automatisch abgeglichen und eingefroren, wenn Sie die Standard-Budgetspalte einfrieren. Jede Zeile behält ihre Währung. Summen und Berichte rechnen in die Berichtswährung um.

![Die Währungseinstellungen: Berichtswährung, Standardwährungen, zulässige Währungen und die Wechselkurse für 2025 bis 2027.](/screenshots/budget-currency-2026-10-13.png)

## Und CAPEX?

Alles oben Gesagte gilt auch für Investitionen: CAPEX-Zeilen stehen in derselben Liste, mit denselben Spalten, Filtern und derselben Navigation. Setzen Sie im Typfilter das Häkchen bei CAPEX oder prüfen Sie beide zusammen. Teil 3 zeigt beide Budgets nebeneinander.

## Wie es weitergeht

Am Ende dieser Durchsicht ist der Endwert 2026 auf den Zeilen, die sich bewegt haben, verlässlich, und die großen Änderungen für 2027 sind bereits notiert. In Teil 2 füllen wir alles Übrige mit drei Klicks.
