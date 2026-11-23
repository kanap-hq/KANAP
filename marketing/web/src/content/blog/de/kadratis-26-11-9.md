---
title: "Kadratis 26.11.9: die Neuerungen seit 26.11.1"
description: "Seit 26.11.1 sind acht Versionen erschienen, mit wichtigen Neuerungen: Importe führen eine erweiterte Dublettensuche durch, die Listen erlauben Änderungen in großer Zahl (auch über Kad), und eine feinere Verwaltung der Zugriffsrechte auf das Budget verbessert die Zusammenarbeit im Budgetprozess. Ein Rundgang durch die Neuerungen."
date: 2026-11-23
topic: release
features: [budget, ai]
author: Friedrich
authorRole: Gründer, CIO
draft: false
translationKey: kadratis-26-11-9
---

Dieser Artikel zeigt die wichtigsten Änderungen, bis zu 26.11.9, veröffentlicht am 22. November:

- Ein Import, über die Oberfläche oder über Kad, findet die vorhandenen Datensätze, bevor er neue anlegt.
- Ein Feld lässt sich auf einer ganzen Auswahl von Budgetzeilen oder Anwendungen ändern, aus der Liste oder auf Bitte an Kad.
- Lieferanten, Unternehmen, Kontakte, Abteilungen und Verträge haben eine Referenz, etwa `SUP-12` oder `CTR-5`.
- Zugriffsrechte lassen sich feiner verwalten.
- Support-Agenten finden das richtige Dokument, unabhängig von der Sprache des Tickets.

## Dublettensuche bei Importen

![In Kad die Vorschau des Imports einer Budget-Arbeitsmappe: Werte der Datei, die vorhandenen Werten zugeordnet sind, jeweils mit der Schaltfläche Rückgängig, und die Zeilen, die einer vorhandenen Zeile ähneln.](/screenshots/blog/kad-import-matches-2026-11-22.png)

Menschen nehmen es oft nicht so genau: „Dell“ für „Dell Technologies“, ein Lieferant ohne seinen Akzent, eine Kostenart in einer anderen Sprache. Beim Import von Daten wird dann jede Abweichung zu einem Fehler, den man erkennen und korrigieren muss, oder zu einem doppelten Datensatz.

**Zuordnen vor dem Anlegen.** Alle Importe finden jetzt einen Datensatz über seinen Namen, ohne Rücksicht auf Groß- und Kleinschreibung oder Akzente. Die Budgetdatei ordnet so ihre Lieferanten, ihre Unternehmen und ihre Dimensionswerte zu; bei den empfohlenen Dimensionen erkennt sie auch einen Wert, der in einer anderen Sprache geschrieben ist, `Matériel` für `Hardware`. Kad geht weiter: Für einen anders geschriebenen Namen, eine Übersetzung oder eine Kurzform schlägt er den vorhandenen Datensatz vor. Jede Zuordnung wird bei der Prüfung aufgeführt und lässt sich vor dem Import zurücknehmen.

**Eine bereits erfasste Zeile wird keine zweite Zeile.** Eine Budgetzeile oder eine Anwendung der Datei, die einem vorhandenen Datensatz ähnelt, wird standardmäßig zurückgestellt. Für jede entscheiden Sie, ob Sie sie trotzdem anlegen oder den Datensatz aktualisieren, dem sie ähnelt.

**Warnungen bei Ungewöhnlichem.** Die Prüfung der Budgetdatei meldet, ohne zu blockieren, einen Betrag, der zehnmal höher oder niedriger ist als der vergleichbarer Zeilen, Daten außerhalb der Jahre der Beträge und eine andere Währung als die des zahlenden Unternehmens.

**Eine einzige Regel für leere Zellen.** In allen Importen behält eine leere Zelle den gespeicherten Wert, `-` löscht ihn, und eine Spalte, die in der Datei fehlt, bleibt unberührt. Die Prüfung zählt die Werte, die gelöscht werden. Eine Datei kann also nur die Referenz der Datensätze und die zu ändernden Spalten enthalten, und eine exportierte und unverändert wieder importierte Datei ändert nichts.

**Ein Budget, von Kad in einer einzigen Karte importiert.** Sie hängen die Arbeitsmappe an die Konversation an und sagen „Importiere diese Daten“, und Kad zeigt die Zuordnung der Spalten, die Zuordnungen der Werte, die ähnlichen Zeilen und die Lieferanten, die er anlegen wird. Vor Ihrer Genehmigung wird nichts geschrieben.

**Eine Spur für jeden Import.** Das Audit-Log verzeichnet alle Importe, ob über eine Oberfläche oder über Kad. Der Reiter **Verlauf** jedes angelegten oder geänderten Datensatzes nennt die Person (oder Kad).

Siehe die Seiten [CSV- und Excel-Dateien](https://doc.kadratis.com/de/csv-files/) und [Ein Budget aus einer Tabellenkalkulation laden](https://doc.kadratis.com/de/budget-file/) im Handbuch.

## In großer Zahl ändern, aus der Liste oder über Kad

![Die sechzehn Budgetzeilen eines Lieferanten, in der Liste ausgewählt, und das Fenster Auswahl ändern: das Feld IT-Verantwortlicher, sein neuer Wert und die Zählung, 13 Zeilen, die sich ändern werden, und 3, die diesen Wert bereits haben.](/screenshots/blog/bulk-edit-budget-lines-2026-11-22.png)

Eine Umorganisation, ein Verantwortlicher, der das Team wechselt, ein übernommener Lieferant: Solche Änderungen betreffen Dutzende Datensätze auf einmal.

**Aus der Liste.** Haken Sie bei den Budgetzeilen und den Anwendungen Datensätze an oder nehmen Sie den ganzen Filter, und klicken Sie dann auf **Auswahl ändern**. Sie wählen das Feld und seinen neuen Wert. Das Fenster zählt die Datensätze, die sich ändern werden, die, die diesen Wert bereits haben, und die abgelehnten, mit dem Grund, und zeigt dann das Ergebnis.

- Bei Budgetzeilen: die Kostenstelle, das Konto, das zahlende Unternehmen, der Lieferant, die Verantwortlichen, ein Dimensionswert, Run oder Build. Beträge lassen sich so nicht ändern.
- Bei Anwendungen: die Verantwortlichen, die Kategorie, der Lebenszyklus, die Geschäftskritikalität und die Cyberkritikalität.

Dieser Umfang wird schrittweise erweitert.

![In Kad dieselbe Änderung, in einem Satz verlangt: Die Karte zeigt den Filter, das Feld, seinen neuen Wert und dieselbe Zählung der Zeilen.](/screenshots/blog/kad-bulk-change-2026-11-22.png)

**Auf Bitte an Kad.** „Mache Nadia Lemaire zur IT-Verantwortlichen der Budgetzeilen des Lieferanten Fromatech Consulting“: Kad bereitet eine einzige Karte vor, die die betroffenen Datensätze, den neuen Wert und dieselben Zählungen zeigt. Sie genehmigen, und der Verlauf jedes Datensatzes weist die Änderung als von Kad in Ihrem Auftrag vorgenommen aus. Wenn mehrere Karten warten, kommt **Alle ablehnen** zu **Alle genehmigen** hinzu.

Siehe [Zeilen in großer Zahl ändern](https://doc.kadratis.com/de/budget-lines/#zeilen-in-groer-zahl-andern) und [Datensätze in großer Zahl ändern](https://doc.kadratis.com/de/ai-assistant/#changing-records-in-bulk) mit Kad.

## Eine Referenz für jeden Datensatz

![Die Seite des Vertrags SAP Maintenance & Support: Seine Referenz, CTR-11, steht in der Kopfzeile vor seinem Namen.](/screenshots/blog/contract-reference-2026-11-22.png)

Projekte, Anwendungen und Budgetzeilen hatten bereits ihre (`PRJ-3`, `APP-7`, `BL-12`). Lieferanten, Unternehmen, Kontakte, Abteilungen und Verträge erhalten jetzt ebenfalls eine: `SUP-12`, `COMP-3`, `CTCT-8`, `DEPT-2`, `CTR-5`.

**Überall, wo der Datensatz erscheint.** Die Referenz steht auf der Seite des Datensatzes, in seiner Liste (Filter, Sortierung, Export), in seiner Adresse und in den Links, die zu ihm führen. Die globale Suche, die Auswahlfelder, die `@`-Erwähnung, Kad und der MCP-Server finden einen Datensatz über seine Referenz.

**Ein Schlüssel für Importe.** Eine Zeile der Datei, die die Referenz trägt, aktualisiert diesen Datensatz, auch wenn sich sein Name geändert hat: Einen Lieferanten per Import umzubenennen, erzeugt keine Dublette. Die Prüfung meldet jeden Datensatz, der umbenannt wird.

Die Mitwirkenden des Portfolios, die das Präfix `CTR` trugen, werden zu `MEM-n`. Adressen, die vor dieser Version gespeichert wurden, öffnen weiterhin den richtigen Mitwirkenden.

## Feinere Rechte

**Eine Kostenstelle genügt zum Bearbeiten.** Für eine Person mit eingeschränktem Datenzugriff erlaubt ein Knoten mit Bearbeiten auf einer Kostenstelle, oder auf einer Gruppe darüber, die Budgetzeilen zu bearbeiten, die dieser Kostenstelle zugeordnet sind, und die Verträge, die dort eingeordnet sind, unabhängig davon, welches Unternehmen zahlt. Eine Zeile anzulegen oder zu verschieben, erfordert weiterhin das Unternehmen der Kostenstelle. Siehe die Seite [Datenzugriff](https://doc.kadratis.com/de/data-access/) im Handbuch.

**Man vergibt nur die Rechte, die man hat.** Eine Person, die Benutzer verwaltet, ohne Administrator zu sein, vergibt nur die Rollen, die sie selbst besitzt, und sieht Personen mit mehr Rechten nur lesend. Ein Arbeitsbereich behält immer mindestens einen aktiven Administrator.

**Verknüpfungen folgen den Leserechten.** Der Verlauf eines Projekts, das Journal eines Vorfalls oder das Feld Anwendungen einer Aufgabe nennen nur die verknüpften Datensätze, die die Person lesen darf. Die anderen werden gezählt. Kad und der MCP-Server folgen derselben Regel.

**Microsoft-Anmeldung.** Eine erste Microsoft-Anmeldung verknüpft ein vorhandenes Konto nicht mehr allein über seine Adresse: Der Inhaber bestätigt die Verknüpfung über eine E-Mail, und das Konto behält sein Passwort.

## Support-Agenten finden das richtige Dokument

**In allen Sprachen.** Support-Agenten und Kad finden ein Dokument der Wissensdatenbank unabhängig von der Sprache des Tickets: Deutsch, Englisch, Französisch oder Spanisch. Ein Agent zitiert die Passage, die antwortet, wo immer sie in einem langen Dokument steht, und verfasst seine Antwort aus dem Text der ausgewählten Dokumente. Er liest nur veröffentlichte Dokumente.

**Bibliotheken je Agent.** Ein Agent sucht und zitiert nur in den Bibliotheken, die ein Administrator für ihn freigibt. Ein neuer Agent startet ohne.

**Interne Notizen bleiben intern.** Ein Support-Agent nutzt die internen Notizen eines Tickets oder ignoriert sie, nach Ihrer Wahl. Genutzt, fließen sie in die Wahl seiner Aktionen und in seine Notiz an den Techniker ein. Seine Antworten an den Anfragenden stützen sich nur auf die öffentlichen Nachrichten.

**Schließen und lösen.** Steht die Statusaktualisierung auf Automatisch, schließt und löst ein Agent auch Tickets, nachdem er seine Antwort an den Anfragenden gesendet hat.

## Weitere Verbesserungen

- **Die ersten Schritte folgen Ihren Daten.** Mit Ihren eigenen Daten wird ein Schritt abgehakt, sobald das Element im Arbeitsbereich existiert. Der Hinweis zu einem Schritt steht in einer Blase unten links im Fenster, und der Pfad lässt sich jederzeit über die Kachel wechseln. Während der Testphase kann ein Administrator wieder mit dem vollständigen Beispiel beginnen.
- **Anlegen von Datensätzen.** Ein neuer Datensatz wird erst in dem Moment gespeichert, in dem Sie ihn erstellen: Wer die Seite vorher verlässt, schreibt nichts. **Erstellen** markiert die noch leeren Pflichtfelder rot.
- **Kontakte aus der Liste anlegen.** Überall, wo Sie einen Kontakt auswählen, endet die Liste mit **+ Neuer Kontakt**; die Lieferantenliste eines Vertrags oder einer Budgetzeile mit **+ Neuer Lieferant**.
- **Leere Listen bieten das Anlegen an.** Eine leere Liste von Standorten, Assets, Unternehmen oder Kontakten zeigt in ihrer Mitte eine Schaltfläche zum Anlegen.
- **Supportende.** Die Liste der Technologien zeigt das nächste Supportende, Standard oder erweitert. Bei einer Anwendung ist das Supportende jeder Technologie das des Berichts, farbig nach seinem Status.
- **Standard-Budgetspalte.** Die Liste der Budgetzeilen folgt einer Änderung der Standardspalte, und der Reiter Budget einer Zeile öffnet sich mit ihr.
- **Eingabe.** Eine neue Budgetzeile beginnt am 1. Januar des angezeigten Jahres. Dezimalzahlen folgen der Sprache der Oberfläche. Ein ohne Trennzeichen getipptes Datum behält seinen Monat: `01012026` wird zu 01.01.2026.
- **Integrationen.** Wer die Adresse einer Integration (GLPI, PRTG, Netbox) oder den Server eines KI-Modells ändert, wird erneut nach dem Token oder Schlüssel gefragt.

## Für On-Premise-Installationen

- **Jede Nacht eine verschlüsselte Sicherung.** Ein Skript (`infra/backup/`) verschlüsselt die Datenbank, die Dateien und die Konfiguration mit `age` und legt sie in einem S3-Bucket ab, in dem der Server nur schreiben und auflisten kann. Der [Betriebsleitfaden](https://doc.kadratis.com/de/on-premise/operations/#nachtliche-verschlusselte-sicherung-in-einen-s3-bucket) erklärt Einrichtung, Kontrolle und Wiederherstellung.
- **Images `kadratis-*`.** Seit 26.11.4 heißen die veröffentlichten Images `kadratis-api`, `kadratis-web` und `kadratis-api-tools`. Die Compose-Datei der Version nennt sie ausdrücklich, und das übliche Update übernimmt sie.
- **Lange Importe kommen ans Ziel.** Der Proxy des Web-Containers wartet 300 Sekunden auf die Antworten der API: Ein langer Import oder eine lange Synchronisierung endet nicht mehr auf einer 504-Seite.
- **Integrationen ohne Weiterleitung.** Aufrufe an GLPI, PRTG, Netbox oder den Server eines KI-Modells folgen keiner Weiterleitung auf eine andere Adresse mehr, zum Beispiel von `http://` auf `https://`. Prüfen Sie, dass die gespeicherten Adressen die endgültigen Adressen sind.

## Aktualisieren

Im gehosteten Dienst ist nichts zu tun: Sie sind bereits auf 26.11.9.

Wenn Sie Kadratis selbst betreiben und dem stabilen Zweig folgen, wechseln Sie direkt auf 26.11.9. Es ist keine Aktion nötig, und die Migrationen laufen beim Start. Lesen Sie vorher den On-Premise-Abschnitt der Versionshinweise zu [26.11.5](https://github.com/kanap-hq/KANAP/releases/tag/v26.11.5), [26.11.7](https://github.com/kanap-hq/KANAP/releases/tag/v26.11.7), [26.11.8](https://github.com/kanap-hq/KANAP/releases/tag/v26.11.8) und [26.11.9](https://github.com/kanap-hq/KANAP/releases/tag/v26.11.9). Das Verfahren steht im [Betriebsleitfaden](https://doc.kadratis.com/de/on-premise/operations/#upgrade-verfahren).

## Neue Versionen verfolgen

- **Auf GitHub**: Beobachten Sie das Repository und wählen Sie „Releases“, um bei jeder Version benachrichtigt zu werden.
- **Im Blog**: Abonnieren Sie den [RSS-Feed](/de/blog/rss.xml).
- **Auf der Website**: Das [Changelog](/de/changelog) listet alle Versionsartikel.

[Technische Details und vollständige Liste der Änderungen](https://github.com/kanap-hq/KANAP/releases/tag/v26.11.9)
