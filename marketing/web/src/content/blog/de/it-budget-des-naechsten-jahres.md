---
title: "Das IT-Budget des nächsten Jahres aufbauen"
description: "Das Budget des nächsten Jahres aus dem erwarteten Endwert: übernehmen, was sich nicht ändert, die Kopie in der Vorschau prüfen und nur die Zeilen nacharbeiten, auf die es ankommt."
date: 2026-08-30
topic: cost
author: Friedrich
authorRole: Gründer, CIO
draft: false
updated: 2026-10-10
translationKey: opex-copy-budget-columns
series:
  key: opex-budget
  part: 2
  title: "Das IT-Budget aufbauen"
---

Teil 1 war eine gezielte Durchsicht: Der Endwert 2026 bildet jetzt die wichtigsten Bewegungen ab, und die großen Änderungen für 2027 sind bereits erfasst. Übrig bleiben alle Zeilen, bei denen sich nichts geändert hat. Sie einzeln zu suchen und abzutippen ist die undankbarste Arbeit der Budgetsaison. In KANAP ist es ein Werkzeug und ein paar Klicks.

## Die zwei Durchgänge

Öffnen Sie unter Budgetverwaltung > Administration „Budgetspalten kopieren“. Der Reiter Alle, die Voreinstellung, kopiert OPEX- und CAPEX-Zeilen zusammen. OPEX oder CAPEX beschränkt auf einen Typ. Das Werkzeug kopiert eine Budgetspalte in eine andere, von einem Jahr in ein anderes, auf Wunsch mit einer prozentualen Anpassung.

Erster Durchgang: den Endwert 2026 vervollständigen. Quelle: Budget 2026 (oder Revision, oder Ist-Werte, je nach Ihrer Praxis; Kopien lassen sich verketten, zum Beispiel zuerst Ist-Werte, dann Revision). Ziel: Erwarteter Endwert 2026. Die in Teil 1 geprüften Zeilen haben bereits einen Wert. Das Werkzeug lässt sie aus und füllt nur die leeren Zellen.

Zweiter Durchgang: das Budget 2027 aufbauen. Quelle: Erwarteter Endwert 2026. Ziel: Budget 2027, mit einer „Prozentualen Erhöhung“ in der Höhe, die Ihre Preissteigerungen auffängt. Ihre manuellen Einträge aus Teil 1 bleiben unberührt.

## Zuerst die Vorschau

Ihre Arbeit ist wertvoll. Deshalb bleibt **Kopieren** deaktiviert, bis eine Vorschau gelaufen ist. Die Vorschau listet jede Zeile mit ihrem Quellwert, ihrem aktuellen Zielwert und dem Wert nach der Kopie. Bereits gefüllte Zeilen sind mit „Übersprungen: das Ziel enthält Beträge“ markiert: Sie werden nicht verändert. Der Schalter „Vorhandene Daten überschreiben“ ist für die bewussten Fälle da. Lassen Sie ihn aus, solange Sie es nicht genau so wollen.

![Die Vorschau einer Kopie vom erwarteten Endwert 2026 ins Budget 2027, +3 %: Quellwerte, Werte nach der Kopie, eine anteilige Zeile und Zeilen, die 2027 nicht gültig sind.](/screenshots/blog/copy-budget-columns-2026-10-13.png)

Ein Banner fasst die Vorschau zusammen, und die Summen unter der Tabelle zeigen die Quelle, das aktuelle Ziel und die Summe nach der Kopie. Eine Zahl überrascht Sie? Es wurde noch nichts geschrieben. Anpassen, erneut Vorschau, kopieren.

Die Kopie berücksichtigt auch die Gültigkeit jeder Zeile. Eine Zeile, die im Juni 2027 endet, erhält nur sechs Monate und ist in der Vorschau als „Anteilig“ markiert. Eine Zeile, die 2027 nicht gültig ist, bleibt außen vor („In 2027 nicht gültig“).

## Zeilen nach Menge × Preis

Bei einer Zeile, die aus ihren Mengen- und Preiszeilen berechnet wird (siehe Teil 1), gilt der Prozentsatz für den Stückpreis jeder Zeile, und der Betrag ergibt sich daraus. Die Mengen bleiben, die Zeiträume rücken um ein Jahr vor, und jeder Monat wird mit den Arbeitstagen 2027 neu berechnet. Aus zwei Beratern zu 650 € pro Tag mit +3 % werden 2027 zwei Berater zu 669,50 € pro Tag, auf einem Kalender mit den eigenen Feiertagen dieses Jahres.

Die Summe kann deshalb leicht von „Quelle + 3 %“ abweichen. Das ist gewollt: Das nächste Jahr hat nicht dieselbe Zahl an Arbeitstagen. Die VZÄ werden dabei mit neu berechnet.

## Die Zuordnungen ziehen mit

Wenn Sie eine interne IT-Leistungsverrechnung betreiben, trägt jede Zeile ihre Zuordnungsregel: Mitarbeiterzahl, IT-Nutzer, Umsatz oder eine manuelle Aufteilung. Genau die Art von Dingen, die in Excel unbeherrschbar wird. Dieselbe Kopie überträgt sie: Unter **Zu kopieren** ist **Zuordnungen** neben **Beträge** angehakt, wenn die Jahre verschieden sind. Der zweite Durchgang überträgt die Regeln also mit den Zahlen auf 2027, Vorschau inklusive. Das „wer zahlt was“ folgt den Zahlen, ohne Abtippen.

## Und CAPEX?

Budgetspalten funktionieren bei Investitionen genauso, die Kopie ebenfalls: dasselbe Werkzeug, dieselbe Vorschau. Im Reiter Alle wandern die Investitionen im selben Lauf mit dem Betrieb ins neue Jahr. Ein Investitionsplan wird oft Projekt für Projekt beschlossen, aber wiederkehrende Investitionen (Hardware-Erneuerung, Aktualisierung der Systeme) übertragen Sie so in einem Durchgang.

## Wie es weitergeht

Das Budget 2027 ist vollständig: Die bekannten Änderungen wurden von Hand erfasst, alles Übrige wurde mit eingerechneter Inflation übertragen. Teil 3 widmet sich der Präsentation: den Berichten für die Budgetsitzung, der Leistungsverrechnung pro Unternehmen und dem Einfrieren der genehmigten Zahlen.
