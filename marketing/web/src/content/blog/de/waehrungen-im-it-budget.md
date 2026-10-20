---
title: "Währungen im IT-Budget verwalten"
description: "Jeder erfasst in seiner Währung, KANAP konsolidiert in der Währung der Gruppe: automatische Wechselkurse, auf Ihre Budgetkurse abstimmbar, und Summen, die stimmen."
date: 2026-10-20
topic: cost
author: Friedrich
authorRole: Gründer, CIO
draft: false
translationKey: managing-currencies-it-budget
series:
  key: opex-budget
  part: 7
  title: "Das IT-Budget aufbauen"
---

Eine US-Tochter bezahlt ihre Lizenzen in Dollar. Die Zentrale schließt ein SaaS-Abonnement ab, das in Dollar abgerechnet wird, und einen Herstellersupport in Schweizer Franken. Das IT-Budget der Gruppe dagegen wird in Euro vorgestellt.

In einer Tabellenkalkulation heißt das: ein Kursblatt in einer Ecke der Arbeitsmappe, Umrechnungsformeln, Zeile für Zeile kopiert, und eine Frage, die bei jeder Präsentation wiederkommt: Mit welchem Kurs haben wir gerechnet?

In KANAP erfasst jeder das Budget in der Währung seiner Rechnung. Alles wird automatisch und sauber in der Referenzwährung der Gruppe konsolidiert. Die Kurse pflegen sich von selbst und lassen sich auf die Kurse des Controllings abstimmen, wann immer Sie möchten.

## Alle Einstellungen auf einer Seite

Alles geschieht unter **Budgetverwaltung › Administration › Währungen**.

- **Die Berichtswährung**: die Währung, in der die Gruppe konsolidiert. Listen, Summen und Berichte werden in dieser Währung angezeigt.
- **Die Standardwährungen**, eine für OPEX und eine für CAPEX: Sie werden beim Anlegen einer Zeile vorgeschlagen, ohne die Auswahl einzuschränken.
- **Die erlaubten Währungen**, falls Sie die Liste einschränken möchten. Lassen Sie sie ohne besonderen Grund leer: Dann ist jeder gültige ISO-Code zulässig.

Die Berichtswährung wird einmal festgelegt. Sie kann sich später ändern: Ein Dialog erklärt dann vor dem Anwenden, was die Änderung bewirkt, und die erfassten Beträge bleiben unverändert.

![Die Seite Währungen von Fromage & Co: Berichtswährung, Standardwährungen und erlaubte Währungen, darunter die Kurstabelle nach Jahr mit ihrer Quelle](/screenshots/blog/currency-settings-2026-10-20.png)

## Jeder erfasst in seiner Währung

Wer eine Budgetzeile vorbereitet, erfasst sie in der Währung der Rechnung, die er erhalten wird. Keine Umrechnung, kein Kurs, den man suchen müsste: Er wählt die Währung im Formular, das ist alles.

Das gilt für die gesamte Budgetverwaltung:

- **Die Budgetzeilen**: Jede hat ihre eigene Währung. Bei Fromage & Co, unserem Beispielunternehmen, budgetiert die US-Tochter ihr IT-Outsourcing, ihre E-Commerce-Plattform und ihre Dienstleister in Dollar, neben den Euro-Zeilen der Zentrale.
- **Die Verträge**: Ein in Fremdwährung unterschriebener Vertrag behält seine Währung. Ein SaaS-Abonnement, das der französischen Gesellschaft in Dollar berechnet wird, ein Support in Schweizer Franken: Der Vertragsbetrag bleibt der bei Unterzeichnung, und seine Verpflichtung wird in der Berichtswährung mit dem Budget verglichen.
- **Die Gesellschaften**: Jede hat ihre Basiswährung, und ihr Umsatz wird in Millionen dieser Währung erfasst, zum Beispiel 35 Mio. USD für Fromage & Co Inc.

Die Beträge werden so gespeichert, wie sie erfasst wurden. CSV-Exporte behalten die Währung jeder Zeile: Die Datei lässt sich ohne rückgängig zu machende Umrechnung wieder importieren oder auswerten.

![Die Budgetzeilen gefiltert auf Fromage & Co Inc.: jede Zeile in Dollar erfasst, Beträge und Summe in Euro angezeigt](/screenshots/blog/currency-us-lines-2026-10-20.png)

## Alles wird in der Währung der Gruppe konsolidiert

KANAP rechnet bei der Anzeige um, jedes Jahr zum Kurs dieses Jahres. Niemand muss eine Formel schreiben oder eine Spalte „Gegenwert“ pflegen.

- **Die Liste der Budgetzeilen**: Die Spalte Währung behält die Währung jeder Zeile, Beträge und Summenzeile werden in der Berichtswährung angezeigt, und die Summen rechnen bei jedem Filter neu.
- **Die Übersicht und die zehn Budgetberichte** werden in der Berichtswährung angezeigt.
- **Die Verträge**: Verpflichtung, verknüpftes Budget und Abweichung werden in derselben Währung verglichen.
- **Die Leistungsverrechnung**: Der Umsatz jeder Gesellschaft wird umgerechnet, bevor er als Schlüssel dient. Eine Verteilung zwischen Frankreich und den USA vergleicht endlich Euro mit Euro. Siehe [den Artikel zur Leistungsverrechnung](/de/blog/it-leistungsverrechnung-einfach-gemacht).

Und falls die Gruppe eines Tages ihre Konsolidierungswährung wechselt, genügt es, die Berichtswährung zu ändern: Alles wird neu umgerechnet, ohne eine einzige Zeile anzufassen.

## Automatisch aktualisierte Kurse

Standardmäßig müssen Sie nichts tun. KANAP holt für jede verwendete Währung einen Kurs pro Jahr und aktualisiert die Kurse alle 30 Tage.

- **Vergangene Jahre**: die Jahresdurchschnitte der Weltbank. Bis zu ihrer Veröffentlichung das nächstgelegene veröffentlichte Jahr, als Schätzung gekennzeichnet.
- **Laufendes Jahr**: der Tageskurs.
- **Künftige Jahre**: der Kurs des laufenden Jahres, als Schätzung übernommen, um das Budget vorzubereiten.

Die Kurstabelle unter den Einstellungen zeigt jeden Kurs und seine Quelle. Vor einem Gremium aktualisiert die Schaltfläche **Wechselkurssynchronisierung erzwingen** die Kurse sofort und meldet, was sie abgerufen hat.

## Ihre Budgetkurse, wenn Sie welche haben

Viele Gruppen legen eigene Kurse für das Geschäftsjahr fest: die Budgetkurse des Controllings oder des Treasury. Das IT-Budget muss dann dieselbe Sprache sprechen wie der Rest der Gruppe.

**Einen Kurs von Hand erfassen.** In der Kurstabelle öffnet ein Klick auf eine Zelle den Dialog **Manueller Wechselkurs**: Sie erfassen den Kurs Ihres Controllings für diese Währung und dieses Jahr. Er ersetzt den automatischen Kurs, bis Sie ihn entfernen, ist in der Tabelle mit einem Sternchen markiert, und jede Erfassung wird im Audit-Log protokolliert.

**Die Kurse mit dem Budget einfrieren.** Ist das Budget genehmigt, friert das Einfrieren seiner Standardspalte auch die Kurse des Jahres ein. Die Beträge bleiben zum Kurssatz des Einfrierens umgerechnet, auch wenn neuere Kurse eintreffen. Ein Budget, das mit einem Dollar zu 0,92 € beschlossen wurde, ändert sich im Juni nicht, weil sich der Dollar bewegt hat. Siehe [den Artikel zum Reporting](/de/blog/it-budget-zur-genehmigung-vorlegen).

![Der Dialog Manueller Wechselkurs: der Kurs in Euro für einen Dollar, mit dem automatischen Kurs des Nachbarjahres als Anhaltspunkt](/screenshots/blog/currency-manual-rate-2026-10-20.png)

## Fehler und Lücken sichtbar

Manchmal fehlt ein Kurs: eine seltene Währung oder ein vergangenes Jahr, das die Quellen noch nicht veröffentlicht haben. Eine Tabellenkalkulation rechnet den Betrag dann oft mit 1, und aus 100.000 Dollar werden 100.000 Euro, ohne dass es jemand merkt.

KANAP tut das nie. Der Betrag wird aus den Summen des Jahres ausgeschlossen, und der Bildschirm sagt es: „3 Zeilen ohne Wechselkurs ausgeschlossen: USD 2026“, unter den Summen der Liste, in der Übersicht, oben in den Berichten, bei den Verträgen. In der Zeile selbst erscheint der Betrag dann in seiner eigenen Währung, mit einer orangen Markierung.

KANAP holt den Kurs im Hintergrund, und die nächste Anzeige verwendet ihn, sobald eine Quelle ihn veröffentlicht. Veröffentlicht ihn keine, listet die Seite Währungen die fehlenden Kurse auf, und ein manueller Kurs löst die Frage sofort.

![Die Liste der Budgetzeilen mit einer Zeile ohne Wechselkurs: der Hinweis unter den Summen und die orange Markierung in der Zeile](/screenshots/blog/currency-missing-rate-2026-10-20.png)

## Wo anfangen

1. **Wählen Sie die Berichtswährung**: die Währung, in der die Gruppe konsolidiert.
2. **Geben Sie jeder Gesellschaft ihre Währung**, und erfassen Sie dann Zeilen und Verträge in der Währung ihrer Rechnung.
3. **Wenn Ihr Controlling Budgetkurse hat**, erfassen Sie sie für das Jahr, das Sie vorbereiten.
4. **Frieren Sie die Budgetspalte ein**, sobald das Budget genehmigt ist: Ihre Kurse werden mit ihr eingefroren.

Um all das an einem bereits erfassten Budget zu sehen, bietet eine kostenlose 14-tägige Testphase unserer gehosteten Version Zugang zu den Beispieldaten der fiktiven Gruppe Fromage & Co, in einer Minute geladen. KANAP ist vollständig Open Source: Sie können es auch kostenlos auf Ihren eigenen Servern installieren.
