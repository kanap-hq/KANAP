---
title: "IT-Leistungsverrechnung: wer zahlt was, und warum"
description: "IT-Kosten mit klaren, überprüfbaren Regeln auf Unternehmen und Abteilungen verteilen und daraus Berichte zur Leistungsverrechnung machen."
date: 2026-09-12
topic: cost
author: Friedrich
authorRole: Gründer, CIO
draft: false
updated: 2026-10-10
translationKey: it-cost-chargeback-made-simple
---

„Was kostet uns die IT?“ Eine einfache Frage. „Was kostet die IT die Abteilung X?“ Schon viel weniger einfach. Und wenn die Geschäftsleitung fragt, wer die Rechnung tragen soll, stößt die Tabelle des CIO schnell an ihre Grenzen.

Die IT-Leistungsverrechnung beantwortet diese Frage. Jeder IT-Kostenpunkt wird nach einer ausdrücklichen, überprüfbaren Regel auf die Einheiten verteilt, die davon profitieren. Diese Einheiten sind Unternehmen oder Abteilungen, und der Schlüssel kann die Mitarbeiterzahl, die IT-Benutzer, der Umsatz oder ein eingegebener Prozentsatz sein. Oder Kombinationen dieser Kriterien.

Die Kosten lassen sich sogar bis auf den einzelnen Nutzer herunterbrechen, für aufschlussreiche Vergleiche zwischen Ländern, Abteilungen und Unternehmen.

## Warum verrechnen, auch ohne interne Rechnung

Verrechnen heißt nicht unbedingt, eine Rechnung zu stellen. Das erste Ziel ist, die Kosten sichtbar zu machen. Ein CIO, der zeigen kann, dass die IT-Kosten einer Tochtergesellschaft zwei- oder dreimal so hoch sind wie die einer anderen, ist besser gerüstet, um einen Strategiewechsel zu begründen.

Drei Anwendungen kehren immer wieder:

- **Verantwortung**: Jede Einheit sieht, was ihre Entscheidungen kosten.
- **Begründung**: Ein Budget, das mit Zahlen pro Einheit verteidigt wird, schafft viel mehr Transparenz als ein einziger konsolidierter Betrag.
- **Abwägung**: Der Vergleich der IT-Kosten pro Nutzer zwischen Unternehmen macht die Unterschiede sichtbar.

## Die Zuordnungsregeln festlegen

### Die Standardregel

Standardmäßig verwendet KANAP die Mitarbeiterzahl der in den Stammdaten angelegten Unternehmen: Alle Kosten werden nach Mitarbeiterzahl auf alle Unternehmen verteilt.

Sie können diese Standardregel unter Administration, Standard-Zuordnungsmethode ändern. Die festgelegte Regel gilt Jahr für Jahr für die Zeilen, die noch nicht angepasst wurden (bereits geleistete Arbeit geht nicht verloren).

![Die Standard-Zuordnungsmethode für 2026: Geschäftsjahr, Unternehmen und Schlüssel, hier alle aktiven Unternehmen nach Mitarbeiterzahl.](/screenshots/blog/chargeback-default-method-2026-10-13.png)

### Regeln pro Zeile verwalten

Jede Budgetzeile trägt für jedes Jahr ihre eigene Zuordnungsregel. Wenn die Standardeinstellung verfeinert werden muss, lässt sie sich für jede OPEX- und CAPEX-Zeile anpassen. So lenken Sie die Kosten bestimmter Anwendungen richtig (zum Beispiel ein Buchhaltungspaket, das der Finanzabteilung belastet wird).

Der Reiter **Zuordnungen** einer Zeile zeigt das Ergebnis in Echtzeit. Hier wird die SAP-Wartung über 280.000 EUR nach Mitarbeiterzahl aufgeteilt: 58,54 % für Fromage & Co SA, 19,51 % für Kaasmeester BV und so weiter bis 100 %.

![Der Reiter Zuordnungen der SAP S/4HANA Maintenance für 2026: Methode, Schlüssel, Prozentsatz und Betrag für jedes der vier Unternehmen.](/screenshots/budget-allocations-2026-10-13.png)

Alle Zuordnungsgrundlagen stehen zur Verfügung:

- **Mitarbeiterzahl** (Standard): die gängigste Grundlage, gespeist aus der jährlichen Mitarbeiterzahl der Unternehmen.
- **IT-Benutzer**: für Kosten, die der Zahl der ausgestatteten Arbeitsplätze pro Unternehmen folgen (nützlich für Gruppen, in denen viele Beschäftigte die IT nicht oder kaum nutzen).
- **Umsatz**: wenn der Beitrag der wirtschaftlichen Größe der Einheit folgt.
- **Manuell nach Unternehmen**: um Kosten einem oder mehreren bestimmten Unternehmen zuzuordnen (weiterhin nach Mitarbeiterzahl, IT-Benutzern oder Umsatz).
- **Manuell nach Abteilung**: um Kosten einer oder mehreren bestimmten Abteilungen zuzuordnen, nur nach Mitarbeiterzahl.
- **Manuelle Prozentsätze**: für völlige Freiheit bei der Zuordnung. Sie geben die Prozentsätze ein, die 100 % ergeben müssen, oder teilen sie mit einem Klick gleichmäßig auf.

Damit Sie nicht jedes Jahr alles neu einrichten müssen, überträgt **Budgetspalten kopieren** diese Regeln mit den Beträgen von einem Geschäftsjahr ins nächste, Vorschau inklusive. Die Zuordnung folgt also dem Budget, ohne Abtippen.

### Nicht mit Kostenstellen verwechseln

Kostenstellen sagen, wem eine Zeile gehört und wer für sie geradesteht: Jede Kostenstelle hat ihren Budgetverantwortlichen, und ihre Gruppen machen das Budget eines ganzen Bereichs lesbar. Auf die Leistungsverrechnung haben sie keinen Einfluss. Eine Lizenz der Kostenstelle „Infrastruktur“ kann durchaus nach Mitarbeiterzahl an alle Unternehmen verrechnet werden.

## Die Berichte zur Leistungsverrechnung

Sobald die Regeln stehen, lassen zwei Berichte jede Seite der Leistungsverrechnung erkunden.

### Globale Leistungsverrechnung

Der erste beantwortet die Frage „Wie verteilen sich die IT-Ausgaben auf unsere Unternehmen?“. Er zeigt die konsolidierte Summe, den Anteil jedes Unternehmens, die gezahlten und verbrauchten Beträge und dann die Ströme zwischen den Gesellschaften.

![Globale Leistungsverrechnung für das OPEX-Budget 2026: Gesamtsumme, Summen pro Unternehmen und das Diagramm der Aufteilung, mit den Reitern Alle, OPEX und CAPEX.](/screenshots/blog/chargeback-global-2026-10-13.png)

Die Kennzahlen ergänzen zwei Werte, die für jedes IT-Budget zentral sind:

- IT-Kosten im Verhältnis zum Umsatz, für die Gruppe als Ganzes und pro Unternehmen. Sie können dann belegt sagen: Bei Fromage & Co SA kostet die IT 3,94 % des Umsatzes pro Jahr.
- IT-Kosten pro Person und pro IT-Benutzer, als absoluter Wert.

### Leistungsverrechnung pro Unternehmen

Dieser Bericht geht eine Ebene tiefer und analysiert die Einzelheiten für ein einziges Unternehmen. Er zeigt die IT-Kosten pro Abteilung, die Verrechnungszeilen (um einer Tochtergesellschaft zu antworten: Genau das wird Ihnen berechnet), die Einzelheiten der eingehenden und ausgehenden Ströme und eine Wiederholung der Kennzahlen. Das ist der Bericht, den Sie den Tochtergesellschaften mit ihrer Jahresrechnung schicken.

![Leistungsverrechnung pro Unternehmen für Fromage & Co SA, OPEX-Budget 2026: Kennzahlen, Summen pro Abteilung und die Verrechnungszeilen.](/screenshots/blog/chargeback-company-2026-10-13.png)

Beide Berichte sind vollständig parametrierbar (Zeilentyp, Jahr, Spalte, Unternehmen, Abschnitte) und lassen sich als CSV, PNG oder PDF exportieren. Sie können auch direkt in einer Budgetbesprechung gezeigt werden.

<aside class="tip">
  <b>Tipp</b>
  <p>Die Berichte werden in der Berichtswährung ausgedrückt, die in den Währungseinstellungen festgelegt ist. Jede Tochtergesellschaft führt ihr Budget in ihrer eigenen Währung, aber die Konsolidierung vereinheitlicht auf eine einzige Währung, was das Lesen erleichtert.</p>
</aside>

## Versteckte Kosten

Diese Berichte bringen oft Zeilen oder Situationen ans Licht, die die großen „Top 10“ des Budgets verbergen. Das Werkzeug für 15.000 EUR, das drei Personen nutzen und die Kosten pro Nutzer einer Abteilung in die Höhe treibt. Die Anwendung, die einer Tochtergesellschaft verrechnet wird, die bereits ein gleichwertiges Paket bezahlt. Die Unterschiede in den Kosten pro Nutzer zwischen Unternehmen oder Abteilungen.

Hier liegen oft die echten Einsparmöglichkeiten, und so kann der CIO bei Geschäftsleitung und Finanzleitung punkten.

## Und CAPEX?

Investitionen nutzen denselben Reiter Zuordnungen und dieselbe Mechanik. Ein Projekt, das für eine einzige Tochtergesellschaft finanziert wird, wird dieser Tochter zugeordnet. Der Rest folgt der gewählten Methode. Beide Berichte zur Leistungsverrechnung öffnen auf OPEX, den Ausgaben, die üblicherweise Jahr für Jahr verrechnet werden, und können CAPEX-Zeilen mit ihrem Betrag des Jahres einbeziehen.

## Wo Sie anfangen

- Prüfen Sie die Kennzahlen der Unternehmen für das laufende Jahr: Mitarbeiterzahl, IT-Benutzer, Umsatz. Das sind die Stammdaten hinter der Leistungsverrechnung.
- Legen Sie die Standardmethode fest, die zu Ihrem Umfeld passt, und behandeln Sie dann nur noch die Sonderfälle.
- Wählen Sie die Granularität, die Sie bei der Prüfung der Sonderfälle wünschen, und bleiben Sie dann durchgehend dabei.
