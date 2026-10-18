---
title: "Analysedimensionen: was Sicherheit die IT wirklich kostet"
description: "Die Leistungsverrechnung sagt, wer zahlt. Eine Analysedimension sagt, wofür die Ausgabe ist: Sicherheit, Cloud, Lizenzen. So nutzen Sie sie im IT-Budget."
date: 2026-09-13
topic: cost
author: Friedrich
authorRole: Gründer, CIO
draft: false
translationKey: analytics-dimensions-for-your-it-budget
---

Auf die Frage „Wer zahlt diese Lizenz?“ antworten Werkzeuge zur Leistungsverrechnung ohne Zögern. Auf die Frage „Was kostet uns Cybersicherheit, über alle Lieferanten hinweg?“ haben wir dagegen oft keine Antwort.

Analysedimensionen liefern diese zweite Lesart. Jede Dimension ist eine Art, Zeilen zu klassifizieren, mit eigenen Werten: wofür das Geld ausgegeben wird, welchem Teil der IT es dient, warum es ausgegeben wird. Ein neuer Arbeitsbereich startet mit vier davon, alle optional.

## Die Mechanik in KANAP

### Dimensionen und ihre Werte

Gehen Sie zu **Stammdaten > Analysedimensionen**. Eine Leiste oben listet die Dimensionen auf. Klicken Sie auf eine, um ihre Werte zu sehen. Ein neuer Arbeitsbereich bringt vier empfohlene Dimensionen mit, jede mit Werten und einer Beschreibung in einem Satz:

- **Kostenart**, die Standarddimension: wofür das Geld ausgegeben wird (Hardware, Software, Externes Personal, Externe Dienstleistungen...).
- **IT-Bereich**: der Teil der IT, dem die Ausgabe dient (Rechenleistung, Netzwerk, Arbeitsplatz, Anwendung, Sicherheit und Compliance...).
- **Zweck**: warum das Geld ausgegeben wird (Ersatz, Kapazität, Produktivität, Sicherheit, Compliance, Wachstum).
- **Priorität**: Zwingend, Hoch, Mittel oder Niedrig.

![Die Seite Analysedimensionen: die Leiste der Dimensionen mit ausgewählter Kostenart und ihren acht Werten mit Beschreibungen](/screenshots/blog/analytics-dimensions-2026-10-13.png)

Kostenarten und IT-Bereiche folgen dem Modell TBM (Technology Business Management). Benennen Sie um, ordnen Sie neu oder deaktivieren Sie, was nicht passt. Ein früher angelegter Arbeitsbereich fügt sie mit **Empfohlene Dimensionen** hinzu. **Neue Dimension** legt eine eigene Dimension an, und **Neuer Wert** ergänzt einen Wert in der ausgewählten.

Fünf bis zehn breite Werte pro Dimension reichen meistens. Ab zwanzig versucht die Dimension, zu viele Fragen zu beantworten: Teilen Sie sie in zwei. Die Beschreibung ist vor allem für Ihre Kollegen da: „Externe Dienstleister und Berater, nach Zeit abgerechnet“ liest sich besser als „Ext.“

### Eine Zeile klassifizieren

Im Panel **Eigenschaften** einer Budgetzeile hat jede Dimension ihr eigenes Feld, zum Beispiel **Kostenart** oder **IT-Bereich**. Wählen Sie einen Wert, oder lassen Sie das Feld leer für „Nicht zugeordnet“. Der Wert gilt für die ganze Zeile, über alle Geschäftsjahre.

![Das Panel Eigenschaften einer Budgetzeile: Hardware bei Kostenart, Rechenleistung bei IT-Bereich, Ersatz bei Zweck und Zwingend bei Priorität](/screenshots/blog/analytics-line-properties-2026-10-13.png)

Eine Zeile hat einen Wert pro Dimension: gleichzeitig **Software** bei Kostenart und **Anwendung** bei IT-Bereich. Jede Dimension beantwortet eine Frage, und der Bericht kreuzt sie.

Zwei Punkte sollten Sie im Kopf behalten:

- **Keine Auswirkung auf die Zuordnungen** und keine auf die Finanzbuchhaltung. Das zahlende Unternehmen, das Konto und die Zuordnungsschlüssel bleiben unverändert. Analysedimensionen dienen nur dem Reporting.
- **Abteilungen und Dimensionen spielen in verschiedenen Ligen.** Abteilungen sind formale Organisationseinheiten mit genauen Zuordnungsschlüsseln. Analysedimensionen sind informelle, optionale Klassifizierungen ohne Aufwand für die Zuordnung.

Um einen Wert oder eine Dimension auszumustern, deaktivieren Sie sie: Die Zeilen behalten ihren Wert, und vergangene Berichte bleiben korrekt. Löschen ist möglich, nach einer Bestätigung, die die Zeilen zählt, die ihren Wert verlieren.

In der Liste der Budgetzeilen hat jede Dimension ihre eigene optionale Spalte. So überblicken Sie alle Zeilen eines Werts auf einen Blick: „Welche Zeilen sind Externes Personal?“

## Der Bericht Budget nach Analysedimension

Der Bericht liegt unter **Berichte > Analysedimensionen**.

- **Zeilentyp**: alle Zeilen, OPEX oder CAPEX.
- **Dimension**: die Dimension, nach der gruppiert wird, zu Beginn Kostenart.
- **Ein einzelnes Jahr**: Kreis- oder horizontales Balkendiagramm, nach Wahl.
- **Mehrere Jahre**: ein Liniendiagramm, eine Linie pro Wert.
- **Metrik**: jede angezeigte Budgetspalte (Budget, Revision, Ist-Werte, erwarteter Endwert).
- **Werte ausschließen**: um sich auf eine Teilmenge zu konzentrieren.
- **Ausgaben**: Übersichtstabelle, CSV-Export der Tabelle, PNG des Diagramms, vollständiges PDF.

![Der Bericht für 2026: 12,1 Mio. EUR OPEX-Budget, verteilt auf die Werte der Kostenart](/screenshots/blog/analytics-report-2026-10-13.png)

Im Geschäftsjahr 2026 beansprucht externes Personal allein 54 % des OPEX-Budgets. Es folgen Software mit 26 % und externe Dienstleistungen mit 11 %.

In der Mehrjahresansicht wird der Bericht zum Werkzeug für Entwicklungen. Eine Linie steigt steil an, eine andere verblasst, und die Entscheidung wird auf Basis von Fakten diskutiert.

![Derselbe Bericht von 2025 bis 2026: eine Linie pro Wert der Kostenart](/screenshots/blog/analytics-report-range-2026-10-13.png)

„Nicht zugeordnet“ ist ein gültiger Zustand. Werte sind optional, und eine Zeile ohne Wert erscheint einfach in dieser Zeile des Berichts.

<aside class="tip">
  <b>Tipp</b>
  <p>Der Bericht lässt sich als PDF exportieren und so, wie er ist, in einer Budgetbesprechung zeigen. Zusammen mit den Berichten zur Leistungsverrechnung haben Sie jede Seite Ihres Budgets zur Hand.</p>
</aside>

## Versteckte Kosten

Das Kreisdiagramm bringt ans Licht, was die „Top 10“ verbergen. Den Wert, der zu groß geworden ist, um noch ehrlich zu sein. Zwei Werte, die fast dasselbe beschreiben und besser zusammengelegt würden. Den Zweck Kapazität, der 2025 bei null beginnt, die Spur einer unterwegs hinzugekommenen Zeile. Oder HR in der Dimension Fachbereich, das in einem Jahr von 468.500 EUR auf 574.570 EUR steigt (+23 %), während das OPEX-Budget um 13 % wächst.

Hier kreuzen sich auch die beiden Lesarten. Sicherheit und Compliance im IT-Bereich macht 8 % des OPEX-Budgets aus. Der Bericht zur Leistungsverrechnung sagt, welche Tochtergesellschaft sie trägt. Der CIO hat dann in einer Budgetbesprechung einen kurzen, überprüfbaren Satz parat: Das geben wir aus, dafür, und so wird es bezahlt.

## Und CAPEX?

Dimensionen gelten für OPEX- und CAPEX-Zeilen gleichermaßen, es sei denn, Sie beschränken eine auf einen einzigen Typ. Ein Investitionsprojekt liest sich also mit dem Vokabular der laufenden Ausgaben, und beide Budgets bleiben vergleichbar.

Darin liegt der Sinn einer gemeinsamen Nomenklatur: Die Frage „Was kostet Sicherheit?“ wird für eine wiederkehrende Lizenz genauso gestellt wie für ein Ausrüstungsprojekt.

## Wo Sie anfangen

1. Prüfen Sie die vier empfohlenen Dimensionen und benennen Sie die Werte um, die Sie nicht brauchen, oder deaktivieren Sie sie.
2. Klassifizieren Sie zuerst die zehn schwersten Zeilen. Ab diesem Schritt wird der Bericht nützlich.
3. Lassen Sie den Rest auf „Nicht zugeordnet“ und klassifizieren Sie nach und nach.
4. Kreuzen Sie den Bericht mit den Berichten zur Leistungsverrechnung: wer zahlt auf der einen Seite, wofür auf der anderen.
5. Lassen Sie den Bericht bei jeder Budgetbesprechung erneut laufen. Teilen Sie einen zu breiten Wert, legen Sie zwei zu feine zusammen.

Analysedimensionen ergänzen die Zuordnung der IT-Kosten (siehe [IT-Leistungsverrechnung: wer zahlt was, und warum](/de/blog/it-leistungsverrechnung-einfach-gemacht)) und geben Ihnen die Transparenz, die Sie brauchen, um Ihr Budget vorzubereiten, zu analysieren und zu verteidigen.
