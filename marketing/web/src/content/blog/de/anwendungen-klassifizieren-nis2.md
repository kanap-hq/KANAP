---
title: "Ihre Anwendungen klassifizieren: Kritikalität, Daten, Wiederanlauf, die Grundlage für NIS2"
description: "Geschäfts- und Cyberkritikalität, Daten, Wiederanlaufplan: Die Klassifizierung jeder Anwendung ist die Arbeit, die jedem NIS2-Vorhaben vorausgeht. Eine Methode und ein Werkzeug, ohne Tabellenkalkulation."
date: 2026-10-10
topic: compliance
author: Friedrich
authorRole: Gründer, CIO
draft: false
translationKey: classifying-applications-nis2
---

Die Frage kommt immer, in einer Sitzung der Geschäftsleitung oder von einem Auditor: Welche unserer Anwendungen sind kritisch, welche Daten enthalten sie, wie schnell bringen wir sie zurück, und in welcher Reihenfolge?

In vielen IT-Abteilungen gibt es die Antwort, aber nur in Stücken. Die Business-Impact-Analyse liegt in der Tabelle vom letzten Jahr, der Wiederanlaufplan in einem PDF, die Anwendungsliste in einem anderen Werkzeug und der Rest in den Köpfen von zwei Personen. NIS2 erfindet diese Fragen nicht. Die Richtlinie macht sie für viele Unternehmen verpflichtend, die bisher ohne sie auskamen.

## Was NIS2 von der IT erwartet

Die NIS2-Richtlinie (Artikel 21) verpflichtet die betroffenen Einrichtungen zu Maßnahmen des Risikomanagements. Darunter: Aufrechterhaltung des Betriebs, mit Backup-Management und Wiederherstellung nach einem Notfall, Sicherheit der Lieferkette, Bewältigung von Sicherheitsvorfällen. Jeder Mitgliedstaat setzt die Richtlinie in nationales Recht um, und die nationalen Behörden veröffentlichen ihre eigenen Leitfäden. In Frankreich beschreibt die ANSSI diese Ziele in einem Rahmenwerk, ReCyF, das noch als Arbeitsdokument auf [MesServicesCyber](https://messervices.cyber.gouv.fr/nis2) veröffentlicht ist.

Wie auch immer der Zeitplan in Ihrem Land aussieht, eines wird sich nicht ändern: Vor jeder Risikoanalyse müssen Sie wissen, was Sie schützen. Ein Verzeichnis der Anwendungen, klassifiziert und aktuell gehalten. Das ist der längste Teil, und der, den niemand gern macht.

## Eine Anwendung in vier Blöcken klassifizieren

In KANAP folgt der Reiter **Compliance** jeder Anwendung der Reihenfolge einer Business-Impact-Analyse.

![Der Reiter Compliance von SAP S/4HANA: Kritikalität, Daten, Kontinuität und Wiederanlauf, mit dem Austausch mit einer Anwendung, die in einer späteren Welle geplant ist](/screenshots/blog/compliance-tab-2026-10.png)

**Kritikalität.** Die Geschäftskritikalität wird aus Ihren Stufen gewählt, jede mit ihrer Definition, meist die Unterbrechung, die das Geschäft verkraften kann. Die Cyberkritikalität wird getrennt gewählt: Sie misst die Folgen einer Kompromittierung, nicht deren Wahrscheinlichkeit. Ein Lohnabrechnungswerkzeug kann zwei Tage Ausfall verkraften und trotzdem hochkritisch sein, wenn seine Daten abfließen.

**Daten.** Die Vertraulichkeitsstufe aus Ihren Datenklassen, ob personenbezogene Daten enthalten sind, die Datenresidenz, Land für Land.

**Kontinuität und Wiederanlauf.** Die Wiederanlaufwelle sagt, in welcher Reihenfolge die Systeme zurückkommen, nicht wie schnell. Die RTO (Wiederanlaufzeit) und die RPO (akzeptabler Datenverlust) werden in Minuten, Stunden oder Tagen erfasst, zusammen mit dem Datum des letzten Wiederanlauftests. Erreicht die RTO die maximal tolerierbare Ausfallzeit der Geschäftsstufe, weist KANAP darauf hin.

**Prüfung.** Eine schriftliche Begründung erklärt die gewählten Stufen. Dann hält „Als geprüft markieren“ fest, wer die Klassifizierung geprüft hat, und wann.

Was leer bleibt, steht auf „Nicht festgelegt“. KANAP wählt nie eine Standardstufe für Sie: Eine nicht klassifizierte Anwendung soll als solche sichtbar sein.

## Ihre Methode, nicht unsere

Sie haben wahrscheinlich schon Stufen, in Ihrer Sicherheitsrichtlinie oder in Ihrer letzten Impact-Analyse. Behalten Sie sie. Die vier Kataloge (Geschäftskritikalität, Cyberkritikalität, Datenvertraulichkeit, Wiederanlaufwellen) sind konfigurierbar: Namen der Stufen, die bei der Auswahl angezeigte Definition, die maximal tolerierbare Ausfallzeit jeder Geschäftsstufe, Reihenfolge, Übersetzungen.

![Der Editor der Klassifizierungskataloge: Stufen, Definitionen und maximal tolerierbare Ausfallzeit](/screenshots/blog/compliance-catalog-2026-10.png)

Eine Änderung an einem Katalog verschiebt nie eine Anwendung auf eine andere Stufe und macht nie eine Prüfung ungültig. Eine Stufe, die Sie aufgeben, wird „nicht mehr angeboten“: Sie bleibt auf den Anwendungen lesbar, die sie tragen, und wird einfach nicht mehr vorgeschlagen.

## Eine Klassifizierungskampagne, die Sie steuern können

Vierzig oder zweihundert Anwendungen zu klassifizieren dauert Wochen. Die Kachel **Compliance** im Dashboard zeigt, wo die Kampagne steht: wie viele Anwendungen geprüft sind, erneut geprüft werden müssen oder noch zu vervollständigen sind. Darunter drei Punkte, die Aufmerksamkeit verlangen: die kritischsten Anwendungen ohne Wiederanlauftest in den letzten zwölf Monaten, die ohne Wiederanlaufwelle und die mit den vertraulichsten Daten bei der niedrigsten Cyberkritikalität. Jede Zahl öffnet die passende Anwendungsliste.

![Die Kachel Compliance: Fortschritt der Kampagne und Punkte, die Aufmerksamkeit verlangen](/screenshots/blog/compliance-tile-2026-10b.png)

Die Prüfung ist kein jährlicher Stempel. Sobald sich nach der Prüfung eine Kritikalität, eine Welle, ein Wiederanlaufziel oder die Datenresidenz ändert, geht die Anwendung zurück auf „Erneut prüfen“. Die Anwendungsliste zeigt dieselben Felder als Spalten, mit Filtern, und lässt sich für den Auditor als CSV exportieren.

![Die Anwendungsliste, sortiert nach Geschäftskritikalität, mit Cyberkritikalität, Welle, RTO, RPO und Prüfstatus](/screenshots/blog/compliance-applications-2026-10b.png)

## Was ein gepflegter Datensatz einer Tabelle voraushat

Eine Tabelle für die Impact-Analyse klassifiziert Zeilen. In KANAP ist die klassifizierte Anwendung außerdem mit dem Rest der IT-Landschaft verknüpft, und genau dort beginnt sich die Klassifizierung auszuzahlen.

- **Abhängigkeiten beim Wiederanlauf.** Unter der Welle listet KANAP die Schnittstellen auf, die die Anwendung mit einer Anwendung verbinden, die in einer späteren Welle geplant ist. Im Bildschirmfoto oben kommt SAP S/4HANA in V1 zurück, tauscht aber Daten mit Salesforce aus, das in V2 geplant ist. Der Wiederanlaufplan sieht seine Reihenfolgeprobleme, bevor der Ernstfall eintritt.
- **Kritikalität der Datenflüsse.** Schnittstellen und Verbindungen erben die höchste Stufe der Anwendungen, die sie verbinden.
- **Server.** Jeder Server zeigt sein Betriebssystem und die Daten des Supportendes.
- **Lieferanten und Verträge.** Die Lieferkette ist bereits da: Jede Anwendung führt zu ihrem Hersteller, ihren Verträgen und deren Fristen.
- **Dokumentation.** Wiederanlaufverfahren und Testberichte liegen in der Wissensdatenbank, mit der Anwendung verknüpft.
- **Nachvollziehbarkeit.** Jede Änderung geht ins Audit-Protokoll.

Und Plaid, der eingebaute KI-Agent, antwortet auf Basis derselben Daten: „Welche kritischen Anwendungen hatten seit einem Jahr keinen Wiederanlauftest?“, „Wo steht die Prüfung der Klassifizierung?“. Er kann auch Änderungen an der Klassifizierung vorbereiten, die Sie genehmigen. Die Prüfung selbst bleibt eine menschliche Handlung.

## Was KANAP nicht tut

KANAP führt keine Risikoanalyse durch, ersetzt kein Informationssicherheits-Managementsystem und meldet keine Sicherheitsvorfälle an die Behörden. Es liefert das klassifizierte, verknüpfte und aktuelle Verzeichnis, auf dem diese Arbeiten aufbauen. Es ist das Rohmaterial der Risikoanalyse, nicht die Analyse selbst.

## Wo Sie anfangen

1. Übertragen Sie die Stufen Ihrer Sicherheitsrichtlinie oder Ihrer letzten Impact-Analyse in die Kataloge.
2. Klassifizieren Sie zuerst die Anwendungen, die für das Geschäft am kritischsten sind.
3. Tragen Sie die Welle, die RTO, die RPO und das Datum des letzten Wiederanlauftests ein.
4. Schreiben Sie die Begründung und führen Sie dann die Prüfung durch.
5. Verfolgen Sie die Kampagne über die Kachel Compliance und arbeiten Sie die Punkte ab, die Aufmerksamkeit verlangen.
6. Verknüpfen Sie nach und nach Server, Schnittstellen und Verträge.

Die Beispieldaten einer Testphase, die fiktive Gruppe Fromage & Co, enthalten eine laufende Klassifizierungskampagne: genug, um all das zu sehen, bevor Sie Ihre eigenen Anwendungen klassifizieren.
