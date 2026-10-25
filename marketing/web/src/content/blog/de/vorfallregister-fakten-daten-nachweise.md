---
title: "Das Vorfallsregister"
description: "Ein Jahr nach einem Ausfall fragt der Auditor oder der Versicherer nach Details. Wann er begann, wer was entschieden hat, wer was getan hat, ob die richtigen Stellen benachrichtigt wurden. Ein Vorfallsregister muss diese Fragen beantworten können, und es bereitet Sie zugleich auf NIS2 vor."
date: 2026-10-26
topic: compliance
features: [it-landscape, incidents]
author: Friedrich
authorRole: Gründer, CIO
draft: false
translationKey: incident-register-facts-dates-evidence
---

Im März steht die Rechnungsstellung drei Stunden lang still. Eine erste Wiederherstellung schlägt fehl, der Tag endet spät, dann geht das Leben weiter.

Im Oktober verlangt der Auditor die Unterlagen. Wann hat der Vorfall begonnen, wann wurde er bemerkt, wer hat ihn übernommen? Doch das Ticket ist geschlossen, der Austausch ist in den Postfächern verloren, und die Person, die den Vorfall bearbeitet hat, hat die Stelle gewechselt.

So deckt KANAP diesen Bedarf.

## Was ins Register gehört

Das Register bewahrt die Ereignisse, auf die Geschäftsleitung, Auditoren oder Versicherer zurückkommen werden:

- Ausfälle, die Benutzer, Kunden oder einen Geschäftsprozess getroffen haben;
- Sicherheitsereignisse: Einbruchsversuch, Schadsoftware, Datenabfluss, verlorenes Gerät;
- Datenverluste, fehlgeschlagene Wiederherstellungen, Lücken in den Sicherungen;
- schwerwiegende Ausfälle eines Lieferanten oder eines Hosting-Anbieters;
- alles, was später erklärt oder einer Behörde gemeldet werden muss.

Das alltägliche Ticket bleibt im Ticketsystem: Das Vorfallsregister von KANAP ersetzt keinen Service Desk. Die Ticketnummer wird in die externe Referenz des Vorfalls übernommen, damit sich die operative Spur wiederfinden lässt. Ein gutes Register zählt einige Einträge pro Monat, und ein Ausfall, der vierzig Tickets erzeugt hat, ist ein einziger Vorfall.

Für den Anfang genügen drei Felder: ein Titel, ein Schweregrad und der Zeitpunkt der Erkennung. Der Rest wird nach und nach ergänzt. Ein bisher in einer Tabelle geführtes Register lässt sich per CSV-Datei importieren.

## Eine belastbare Chronologie

![Der Verlauf eines schweren Vorfalls, mit datierten Notizen und Änderungen von Status und Schweregrad.](/screenshots/incidents-journal-2026-10-25.png)

Erst der Verlauf macht aus einem Formular ein Register. Er hält alles fest, was mit dem Vorfall geschieht: die Notizen des Teams, jede Änderung von Status und Schweregrad, jedes verknüpfte oder gelöste Asset und jede verknüpfte oder gelöste Anwendung, jede Wiederöffnung mit ihrer Begründung. Nichts davon lässt sich bearbeiten oder löschen, von niemandem.

Die Notizen tragen den Zeitpunkt der Ereignisse. Eine am Dienstag erfasste Notiz kann auf Samstag, 23:40 Uhr datiert werden und reiht sich an dieser Stelle in die Chronologie ein. Daneben bewahrt KANAP den tatsächlichen Zeitpunkt der Erfassung, den niemand ändern kann: Die Rückdatierung bleibt ehrlich.

Zwei Daten eröffnen die Chronologie: der Beginn des Vorfalls und der Moment, in dem er bemerkt wurde. Der Abstand zwischen beiden ist oft die erste Frage des Auditors. Sobald der Vorfall behoben ist, wird seine Dauer von selbst angezeigt.

Der Status bewegt sich nur vorwärts: offen, in Bearbeitung, behoben, geschlossen. Ein Schritt zurück erfordert einen Registeradministrator und eine Begründung, die ebenfalls im Verlauf festgehalten wird.

Die Nummerierung bleibt lückenlos. Ein Duplikat wird mit einer Begründung abgebrochen, und INC-13 verschwindet nie zwischen INC-12 und INC-14: Eine Lücke in der Nummerierung wäre das Erste, worauf ein Auditor zurückkäme. Ein Vorfall mit Meldedaten lässt sich nicht löschen.

## Den Vorfall mit dem verknüpfen, was er getroffen hat

![Der Reiter Beziehungen eines Vorfalls: seine Assets, seine Anwendungen, seine Technologien und ein Vorschlag.](/screenshots/incidents-relations-2026-10-25.png)

Ein isolierter Vorfall in einem Register hat wenig Gewicht. In KANAP wird er mit der IT-Landschaft verknüpft: den betroffenen Servern, den Fachanwendungen mit ihrer Kritikalität, den beteiligten Technologien. KANAP schlägt die Technologien der bereits verknüpften Server und Anwendungen vor, mit ihrer Herkunft, zum Beispiel „Technologie des Assets AST-12“. Ein Klick genügt, um sie hinzuzufügen.

Die Verknüpfung gilt in beide Richtungen. Der Datensatz eines Servers, einer Anwendung oder einer Technologie listet ihre Vorfälle auf: Wer einen Server öffnet, sieht seine Historie. Und eine Suche nach einem Hostnamen wie PAR-ESX-01 findet alle Vorfälle, die ihn getroffen haben.

Korrekturmaßnahmen werden zu Aufgaben, mit einem Verantwortlichen und einer Frist, die dem Vorfall zugeordnet sind. Die Analyse beschreibt die Absicht; die Aufgabe beweist, dass die Arbeit erledigt wurde.

## Die Vorfallanalyse, beim Schließen eingefroren

![Die Übersicht eines Vorfalls, mit seiner Beschreibung und seiner Vorfallanalyse.](/screenshots/incidents-review-2026-10-25.png)

Jeder Vorfall hat zwei Texte. Die Beschreibung passt in ein oder zwei Sätze: was geschehen ist, so wie es beobachtet wurde. Die Vorfallanalyse ist der vollständige Bericht, verfasst in einem echten Dokument, mit Überschriften, Tabellen und eingefügten Bildern.

Sie geht von einer fünfteiligen Vorlage aus: ausführliche Beschreibung, Auswirkungen, Grundursache, Korrekturmaßnahmen, Erkenntnisse. Bei einem kleinen Vorfall genügt die Beschreibung; bei einem schweren Vorfall ist die Analyse das Post-Mortem. Die Vorlage gehört Ihnen, und Sie können sie an Ihre Bedürfnisse anpassen.

Jedes Speichern der Analyse erzeugt eine Version, die dauerhaft aufbewahrt wird. Beim Schließen wird der Vorfall gesperrt und die Analyse auf der Version eingefroren, die der Verlauf nennt. Diese Version liest der Auditor. Stellen Sie die Analyse also vor dem Schließen fertig: Danach braucht es einen Administrator, um den Vorfall wieder zu öffnen.

## Die regulatorische Seite

Vier Felder tragen den regulatorischen Teil des Vorfalls:

- **Personenbezogene Daten betroffen**, anzukreuzen, sobald personenbezogene Daten offengelegt, verändert oder verloren wurden. Das ist der Filter Ihres Datenschutzbeauftragten.
- **Meldung an Behörde erforderlich**, wenn das Ereignis einer Datenschutzbehörde, einer Cybersicherheitsbehörde oder einer Branchenaufsicht gemeldet werden muss.
- **Gemeldet am**, das Datum der Meldung.
- **Informierte Parteien**: Aufsichtsbehörde, Versicherer, betroffene Kunden, Konzernsicherheit.

Artikel 33 der DSGVO verlangt, jede Verletzung des Schutzes personenbezogener Daten zu dokumentieren, ob gemeldet oder nicht. Das Register ist der Nachweis dafür, und ein Vorfall mit diesen Angaben lässt sich nicht löschen. Meldefristen und Meldeschwellen hängen von Ihrer Rechtsordnung und Ihrer Branche ab: KANAP hält die Fakten und die Daten fest, es entscheidet nicht, ob gemeldet werden muss.

Ein sensibler Sicherheitsvorfall kann eingeschränkt werden. Dann sehen ihn nur die Registeradministratoren, der Meldende und der Verantwortliche; für alle anderen existiert er weder in der Liste noch in der Suche, weder in den Antworten von Plaid noch im Export.

## Was der Auditor erhält

![Das Register, gefiltert auf die Schweregrade Kritisch und Hoch.](/screenshots/incidents-register-2026-10-25.png)

Das Register lässt sich nach Zeitraum, Schweregrad, Kategorie oder Compliance-Kennzeichen filtern. Die Schweregrade Kritisch und Hoch über das vergangene Jahr ergeben die kurze Liste, die die meisten Gremien und Audits verlangen, und der CSV-Export liefert sie unverändert.

Für einen bestimmten Vorfall stellt der PDF-Export einen vollständigen Bericht zusammen: Eigenschaften, Beschreibung, Vorfallanalyse, Verlauf in chronologischer Reihenfolge mit den Versionen der Analyse, verknüpfte Assets, Anwendungen und Aufgaben, Compliance-Felder und Anhänge.

Auch Plaid, der in KANAP integrierte Assistent, antwortet: „Wie viele kritische Vorfälle in diesem Quartal?“, „Liste der offenen Vorfälle auf PAR-ESX-01“, „Zusammenfassung von INC-2“. Er liest den Verlauf und die Analyse und kann daher bis hin zur Grundursache antworten.

## Wo Sie anfangen

1. **Importieren Sie Ihr bestehendes Register**, oder erfassen Sie die schweren Vorfälle des Jahres.
2. **Halten Sie die Liste der Kategorien kurz**: Sie sind es, die ein Jahr an Vorfällen gruppieren werden.
3. **Erfassen Sie früh, ergänzen Sie nach und nach, schließen Sie nach dem Verfassen der Analyse.**
4. **Prüfen Sie das Register jedes Quartal**: Wiederkehrende Kategorien und Server, die mehr als einmal auftauchen, liefern vielleicht den Stoff für den nächsten Budgetantrag oder das nächste Projekt.

Um all das live zu erleben, bietet eine kostenlose 14-tägige Testphase unserer gehosteten Version Zugang zu den Beispieldaten der fiktiven Gruppe Fromage & Co, Vorfallsregister inklusive, in einer Minute geladen. KANAP ist vollständig Open Source: Sie können es auch kostenlos auf Ihren eigenen Servern installieren.
