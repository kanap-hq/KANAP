---
title: "IT-Vertragsmanagement in KANAP"
description: "Berechnete Fristen, dokumentierte Verlängerungsentscheidungen, Verpflichtungen im Abgleich mit dem Budget: IT-Verträge unter Kontrolle in KANAP."
date: 2026-10-17
topic: cost
author: Friedrich
authorRole: Gründer, CIO
draft: false
translationKey: it-contract-management
series:
  key: opex-budget
  part: 6
  title: "Das IT-Budget aufbauen"
---

Wer hat noch nie die Kündigungsfrist eines Vertrags verpasst? Die anschließende Verhandlung ist selten angenehm. Und tatsächlich ist es nicht leicht, Dutzende Vertragsfristen, stillschweigend verlängerte Verträge oder schlicht Abonnements im Blick zu behalten. Diese Daten stehen oft in unterschriebenen PDFs, in einer Tabelle oder beim Einkauf.

In KANAP wird jedes Datum aus dem Vertrag berechnet. Jede Frist erreicht den richtigen Verantwortlichen, mit Zeit zum Entscheiden. Und jeder Vertrag lässt sich leicht mit dem Budget abgleichen, was Unstimmigkeiten schnell sichtbar macht.

## Die Eingabe: nur wenige Felder

Ein Vertrag wird in einem einzigen Formular angelegt. Fünf Felder sind Pflicht: der Lieferant, das unterzeichnende Unternehmen, das Startdatum, die Dauer einer Laufzeit und die Währung. Danach ergänzen Sie den Verantwortlichen, die stillschweigende Verlängerung, die Kündigungsfrist, den Jahresbetrag und die Abrechnungshäufigkeit.

KANAP berechnet den Rest: die aufeinanderfolgenden Laufzeiten, die Kündigungsfrist jeder einzelnen und den Stand des Vertrags. Ändern Sie die Dauer oder die Kündigungsfrist, und alle Daten ziehen mit.

Bei Fromage & Co, unserem Beispielunternehmen, kostet die SAP-Wartung 350.000 € pro Jahr. Sie läuft vom 1. Juli bis zum 30. Juni, mit sechs Monaten Kündigungsfrist und stillschweigender Verlängerung. KANAP errechnet, dass sie bis zum 30. Dezember 2026 gekündigt werden kann. Nach diesem Tag verlängert sie sich bis Juni 2028.

Die Vertragsübersicht sagt es in einem Satz: „Kündigung möglich bis 30. Dez. 2026 · in 74 Tagen“. Eine Zeitleiste zeigt die vergangenen Laufzeiten, die aktuelle Laufzeit und die nächste Frist. Die folgende Laufzeit bleibt gestrichelt, solange sie sich noch vermeiden lässt. Eine Zeile mit Fakten erinnert daran, seit wann sich der Vertrag verlängert.

![Der SAP-Wartungsvertrag von Fromage & Co: die nächste Kündigungsfrist, die Zeitleiste der Laufzeiten und das Entscheidungsfeld](/screenshots/blog/contracts-sap-overview-2026-10-17.png)

Ein in einer Tabelle geführtes Register lässt sich als CSV-Datei laden oder exportieren. Die Vorabprüfung validiert die Datei, bevor etwas gespeichert wird.

## Die Liste: was als Nächstes kommt, der Reihe nach

Die Vertragsliste sortiert nach **Nächste Frist**, die früheste zuerst. Bei einem Vertrag mit stillschweigender Verlängerung ist das seine nächste Kündigungsfrist, bei den anderen sein Ende. Jedem Datum folgt „in n Tagen“.

Die Spalte **Stand** sagt, wo jeder Vertrag steht:

- **Zu entscheiden**: Vor der Frist ist eine Entscheidung fällig.
- **Endet ohne Verlängerung**: Der Vertrag ist in seiner letzten Laufzeit.
- **Verlängert zum** Datum: Die Kündigungsfrist ist verstrichen, die nächste Laufzeit steht fest.
- **Laufend**: Noch ist nichts fällig.
- **Abgelaufen**: Der Vertrag ist beendet.

Der Schnellfilter **Innerhalb von 90 Tagen zu entscheiden** trennt die Verträge ab, die eine Entscheidung brauchen. Bei Fromage & Co sind es heute vier: die Managed IT Services in den USA (Frist 31. Oktober), Salesforce (28. November), SAP (30. Dezember) und Okta (31. Dezember). Das 90-Tage-Fenster lässt sich zwischen 0 und 365 Tagen einstellen.

„Verlängert zum“ zeigt, was schon entschieden ist. Der Microsoft-Vertrag, die VMware-Lizenz und das Orange-Netz haben ihre Kündigungsfrist überschritten: Sie beginnen am 1. Januar eine neue Laufzeit. Besser, man weiß das bei der Budgetvorbereitung.

![Die Vertragsliste von Fromage & Co, gefiltert auf die Verträge, die innerhalb von 90 Tagen zu entscheiden sind](/screenshots/blog/contracts-to-decide-2026-10-17.png)

## Die Entscheidung: verlängern, neu verhandeln, kündigen

Über die Liste hinaus fordert KANAP den Verantwortlichen zur Entscheidung auf und dokumentiert sie.

90 Tage vor der Kündigungsfrist (ein einstellbares Fenster) legt KANAP deshalb für jeden Vertrag, der auf eine Entscheidung wartet, eine Aufgabe an. Sie ist dem Verantwortlichen des Vertrags zugewiesen und zur Kündigungsfrist fällig. Daher die Bedeutung eines Verantwortlichen für jeden Vertrag.

Auf der Vertragsseite sagt ein Feld, was passiert, wenn niemand handelt: „Ohne Entscheidung verlängert sich der Vertrag am 1. Juli 2027 um 12 Monate.“ Der Verantwortliche wählt dann:

- **Verlängern**: Die Verlängerung ist für diese Laufzeit bestätigt, und die Aufgabe wird geschlossen.
- **Neu verhandeln**: Die Aufgabe bleibt bis zur endgültigen Entscheidung offen, und das Feld zeigt „Neuverhandlung läuft“.
- **Kündigen**: KANAP schlägt das früheste Ende vor, das die Kündigungsfrist erlaubt. Bei der SAP-Wartung ist das der 30. Juni 2027. Ein früheres Datum bleibt möglich, mit einer Warnung: Der Lieferant muss zustimmen.

Bevor eine Kündigung bestätigt wird, listet das Feld ihre Folgen auf: die Verpflichtung des laufenden und des nächsten Jahres, die Anwendungen, die diesen Vertrag verlieren, die Assets, die ihren Supportvertrag verlieren. Im SAP-Beispiel sinkt die Verpflichtung 2027 von 350.000 € auf 175.000 €, und die Verpflichtung 2028 fällt auf null.

![Das Feld Kündigen des SAP-Vertrags: das früheste Ende, das die Kündigungsfrist erlaubt, und die Folgen der Kündigung](/screenshots/blog/contracts-cancel-2026-10-17.png)

Jede Entscheidung wird festgehalten: wer, wann, mit welcher Begründung. Zum Beispiel „Verlängerung am 2. Okt. 2026 von Sophie Laurent bestätigt“. Eine zu schnell getroffene Entscheidung lässt sich zurücknehmen, solange die Frist nicht verstrichen ist. Nach einer Kündigung erinnert KANAP Sie daran, das Schreiben vor der Frist zu versenden und dem Vertrag beizufügen.

## Der Vertrag im Abgleich mit dem Budget

Der Vertrag sagt, was die IT zu zahlen zugesagt hat. Das Budget sagt, was sie geplant hat. KANAP vergleicht beides, Jahr für Jahr.

**Verpflichtet** ist der Jahresbetrag des Vertrags, verteilt auf die Monate, die eine Laufzeit abdeckt, tagesgenau anteilig. Für die Folgejahre wird angenommen, dass sich der Vertrag verlängert, bis er beendet wird. Nach dem Ende des Vertrags ist nichts mehr verpflichtet.

**Budget** summiert die mit dem Vertrag verknüpften Budgetzeilen für das gewählte Jahr und die gewählte Spalte: das Budget, den erwarteten Endwert oder das Budget des nächsten Jahres mitten in seiner Vorbereitung. **Abweichung** ist die Differenz, orange markiert, wenn Budget fehlt.

Jeder Vertrag erhält einen Deckungsstand: gedeckt, unterbudgetiert, Budget über dem Vertrag, keine Budgetzeile, keine Verpflichtung oder Budget noch nicht begonnen. Zwei Schnellfilter trennen ab, was Handeln erfordert: **Ohne Budgetzeile** und **Unterbudgetiert**.

Im Budget 2026 von Fromage & Co verpflichten die Verträge 3,73 Mio. €. Drei davon sind mit keiner Zeile verknüpft: das Nearshore-Team in Lissabon, das E-Commerce-Team von Fromatech und das Orange-Netz, also 1,58 Mio. € an Verpflichtungen, die mit dem Budget zu verbinden sind. Im erwarteten Endwert sind vier Verträge unterbudgetiert, darunter die SAP-Wartung. Umgekehrt endete der OVHcloud-Vertrag im Mai, und seine Zeile enthält noch Budget.

![Die Vertragsliste von Fromage & Co mit den Spalten Verpflichtet, Budget und Abweichung des Budgets 2026](/screenshots/blog/contracts-budget-coverage-2026-10-17.png)

Die Verknüpfung funktioniert in beide Richtungen. Der Reiter Budget des Vertrags zeigt seine Zeilen und deren Deckung über drei Jahre. Eine Budgetzeile führt zu ihrem Vertrag. Ein einfacher Weg, Versäumnisse zu vermeiden!

## Die Klauseln, die ein Vertrag enthalten muss

Ein Vertrag deckt Anwendungen ab, und diese Anwendungen verweisen auf Klauseln, die er enthalten muss. Personenbezogene Daten verlangen eine Auftragsverarbeitungsvereinbarung nach DSGVO und den Speicherort der Daten. Eine kritische Anwendung verlangt eine Reversibilitätsklausel, einen Exit-Plan und ein Auditrecht. Der Reiter Konformität des Vertrags listet diese Punkte auf Basis der Klassifizierung der Anwendung auf. Jeder wird als vorhanden, fehlend oder nicht zutreffend erfasst, und das Konformitätsregister lässt sich als CSV exportieren. Wir kommen in einem der nächsten Artikel ausführlicher darauf zurück.

## Was KANAP nicht tut

KANAP entwirft und unterzeichnet keine Verträge und führt keine Verhandlungen: Das ist Aufgabe von Einkauf und Rechtsabteilung. Der Betrag bei Unterzeichnung gilt für jede Laufzeit: Eine Indexierung oder Preiserhöhung wird auf den verknüpften Zeilen budgetiert. KANAP führt das Register, die Fristen, die Entscheidungen und die Verbindung zum Budget.

## Wo Sie anfangen

1. **Laden Sie das bestehende Register** aus einer CSV-Datei, nach der Vorabprüfung, oder legen Sie Ihre Verträge von Hand an.
2. **Benennen Sie für jeden Vertrag einen Verantwortlichen**: Er erhält die Entscheidungsaufgaben.
3. **Verknüpfen Sie die Budgetzeilen**, beginnend mit den größten Verträgen. Prüfen Sie dann Ohne Budgetzeile und Unterbudgetiert für das Jahr, das Sie vorbereiten.
4. **Beginnen Sie die Woche mit Zu entscheiden**: So verstreicht keine Frist ohne Entscheidung.

Um all das an bereits erfassten Verträgen zu sehen, bietet eine kostenlose 14-tägige Testphase unserer gehosteten Version Zugang zu den Beispieldaten der fiktiven Gruppe Fromage & Co, in einer Minute geladen. KANAP ist vollständig Open Source: Sie können es auch kostenlos auf Ihren eigenen Servern installieren.
