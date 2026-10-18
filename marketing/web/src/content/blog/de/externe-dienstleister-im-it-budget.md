---
title: "VZÄ und Tagessätze: externe Dienstleister im IT-Budget"
description: "Budgetieren Sie eine Dienstleistung so, wie Sie sie einkaufen, in Personen, Tagen und Preisen: KANAP leitet daraus die VZÄ, die Kosten pro VZÄ und den Tagessatz ab, bereit für das Gremium."
date: 2026-10-17
topic: cost
author: Friedrich
authorRole: Gründer, CIO
draft: false
translationKey: it-contractors-fte-daily-rate
series:
  key: opex-budget
  part: 5
  title: "Das IT-Budget aufbauen"
---

In der Budgetsaison kommt die Frage immer: Wie viele externe Dienstleister bezahlt die IT, zu welchen Kosten, und was ändert sich im nächsten Jahr? Oft steht die Antwort in einer Tabelle, manchmal nur in den unterschriebenen Verträgen oder in einer parallelen Liste des Einkaufs. Und sie passt nie ganz zum Budget.

In KANAP genügt eine Eingabe. Sie budgetieren eine Dienstleistung so, wie Sie sie einkaufen: Personen oder Tage, ein Preis, ein Zeitraum. KANAP leitet daraus den Betrag jedes Monats, die VZÄ, die Kosten pro VZÄ und den Tagessatz ab.

## VZÄ, Kosten pro VZÄ, Tagessatz

- **VZÄ** (Vollzeitäquivalente) sagen, wie viele Personen das Budget bezahlt. Ein Berater in Vollzeit über das ganze Jahr zählt als 1 VZÄ. Von Februar bis Oktober zählt er über das Jahr als 0,75.
- **Kosten pro VZÄ** sind die durchschnittlichen Jahreskosten einer Vollzeitperson.
- **Der durchschnittliche Tagessatz** sind die Kosten der nach Tagen bepreisten Leistungen geteilt durch die eingekauften Tage.

KANAP bietet zwei Lesarten der VZÄ. Der **Jahresdurchschnitt** speist die Berichte und die Vergleiche von einem Jahr zum nächsten. Die **VZÄ im Zeitraum** sagen, wie viele Personen während des Einsatzes arbeiten: Unser Berater von Februar bis Oktober zählt als 1.

Dieser Artikel behandelt externe Ressourcen: Arbeitnehmerüberlassung, technische Unterstützung, Tagespakete. Dort wird das IT-Budget in Personen und Tagen aufgebaut, und dort bündeln sich die Fragen des Gremiums.

## Die Eingabe: Jede Zeile liest sich wie ein Satz

Im Reiter Budget einer Budgetzeile lässt sich jede Spalte (Budget, Erwarteter Endwert, Revision…) mit **Menge und Preis** aufbauen. Eine Zeile liest sich wie ein Satz: eine Menge, eine Einheit (Personen, Tage oder Stück), ein Preis, eine Häufigkeit, ein Zeitraum und ein Kalender. Die Beträge jedes Monats sind die Summe der Zeilen. Einige typische Fälle:

**Personalverstärkung in Vollzeit.** Zwei SAP-Entwickler zu 480 € pro Tag, Vollzeit das ganze Jahr. Jeder Monat zählt seine Arbeitstage: Auf einem Kalender mit 218 Tagen kostet die Zeile 209.280 € und zählt als 2 VZÄ.

**Teilzeit.** Ein Projektleiter 5 Tage pro Monat zu 1.200 € pro Tag, von Februar bis Juli: 6.000 € pro Monat. KANAP setzt diese 5 Tage ins Verhältnis zu den Arbeitstagen jedes Monats, etwas mehr als ein Viertel einer Vollzeitstelle während des Einsatzes und die Hälfte davon über das Jahr.

**Ein Tagespaket.** 30 Expertentage für denselben Zeitraum, zu 1.200 € pro Tag: 36.000 €, verteilt auf die Monate des Zeitraums und auf dieselbe Weise in VZÄ umgerechnet.

**Zugänge und Abgänge.** Jede Zeile hat ihren eigenen Zeitraum. Bei Fromage & Co, unserem Beispielunternehmen, war der Integrationsarchitekt zu 950 € pro Tag im Budget für Februar geplant. Er kommt im April: Sie verschieben das Startdatum im erwarteten Endwert, und KANAP berechnet den Betrag und die VZÄ des Jahres neu, 0,92 im Budget und 0,75 im Endwert.

Das Ergebnis erscheint während der Eingabe: der Betrag jedes Monats und die VZÄ unter den Zeilen. Im Beispiel unten kommen die zwei Entwickler, der Projektleiter und das Tagespaket auf 281.280 € und 2,28 VZÄ, und die Karte der Spalte fasst zusammen: „Menge und Preis · 3 Zeilen · 2,28 VZÄ“. **Auch für andere Spalten verwenden** überträgt dieselben Zeilen auf den Endwert oder die Revision, die dann nur noch angepasst werden müssen.

![Der Reiter Menge und Preis einer Budgetzeile: Personalverstärkung in Vollzeit, eine Teilzeitrolle in Tagen pro Monat und ein Tagespaket, mit den VZÄ unter den Zeilen](/screenshots/blog/fte-quantity-price-2026-10-18.png)

## Kalender: auf den Tag genau

Eine nach Tagen bepreiste Leistung kostet die Zahl der tatsächlich bezahlten Tage. Der Arbeitstagekalender sagt, wie viele, Monat für Monat.

Der Standardkalender eines Landes wird mit dem Unternehmen angelegt: Wochentage ohne Feiertage. Es gibt nichts einzugeben. Eine neue Zeile übernimmt den Kalender des Landes des zahlenden Unternehmens.

Ein eigener Kalender deckt die Sonderfälle ab. Fromage & Co hat zwei. **218 working days** folgt dem Rhythmus eines Beraters mit Tagesvertrag, mit über das Jahr verteiltem Urlaub. **No leave** zählt jeden Arbeitstag, für eine Leistung, die pro tatsächlich gearbeitetem Tag abgerechnet wird. Und natürlich können Sie eigene Kalender anlegen, Urlaub darin eintragen und so weiter.

![Die Arbeitstagekalender von Fromage & Co: die Standardkalender von vier Ländern und zwei eigene Kalender](/screenshots/blog/fte-calendars-2026-10-18.png)

## Das Budget in VZÄ, in der Liste

Die Liste der Budgetzeilen zeigt für jede Budgetspalte und jedes Jahr eine VZÄ-Spalte, direkt nach den Beträgen. Sie sortiert und filtert wie die anderen. Die Fußzeile der Spalte gibt die Summe an und markiert die Zeilen ohne VZÄ: „3,50 · 12 unbekannt“.

Die Spalte **VZÄ gemeldet** trennt die Dienstleistungszeilen mit einem Klick ab. Sie sehen dann nebeneinander, was jede Dienstleistung kostet und wie viele Personen sie bezahlt, im Budget und im Endwert.

Für das Folgejahr erledigt das Kopieren der Budgetspalten die Arbeit: Die Mengen bleiben, die Preise steigen um den gewählten Prozentsatz, die Zeiträume rücken um ein Jahr vor, und jeder Monat wird mit den Arbeitstagen des neuen Jahres neu berechnet. Die VZÄ ziehen mit (Einzelheiten in [Das IT-Budget des nächsten Jahres aufbauen](/de/blog/it-budget-des-naechsten-jahres)).

![Die Budgetzeilen von Fromage & Co, gefiltert auf die Zeilen mit VZÄ, mit den VZÄ-Spalten von Budget und Endwert 2026](/screenshots/blog/fte-budget-lines-2026-10-18.png)

## Berichte: wie viele Personen, zu welchen Kosten

Alles oben Beschriebene speist die Berichte direkt. Nichts vorzubereiten.

**Personal nach Monat** zeigt die VZÄ Monat für Monat, gruppiert nach Kostenstelle, Lieferant, Zeile oder Analysedimension. Die Tabelle gibt den Jahresdurchschnitt und den Spitzenwert an. Sie sehen den Hochlauf eines Projekts, den Monat, in dem das externe Team am größten ist, und das Gewicht jedes Lieferanten.

![Der Bericht Personal nach Monat zum Budget 2026 von Fromage & Co, gruppiert nach Lieferant](/screenshots/blog/fte-staffing-by-month-2026-10-18.png)

Bei Fromage & Co umfasst das externe Team im Budget 2026 durchschnittlich 46 VZÄ, mit einer Spitze von 48 im Mai und Juni.

**Kosten pro VZÄ** stellt bis zu vier Spalten nebeneinander, zum Beispiel das Budget und den erwarteten Endwert oder den Endwert dieses Jahres und das Budget des nächsten. Für jede Gruppe: die VZÄ, die Kosten und die Kosten pro VZÄ. **Anzeige > Tagessatz** wechselt mit einem Klick zum durchschnittlichen Tagessatz, gewichtet nach den eingekauften Tagen. Ein Lieferant mit steigendem Tagessatz, ein Team, das wächst, während die Kosten pro VZÄ gleich bleiben: Sie sehen es sofort.

![Der Bericht Kosten pro VZÄ von Fromage & Co, Budget und erwarteter Endwert 2026 nebeneinander, nach Lieferant](/screenshots/blog/fte-cost-per-fte-2026-10-18.png)

Das Budget 2026 von Fromage & Co bezahlt also 46,17 externe VZÄ für 6,68 Mio. €, das sind 144.670 € pro VZÄ, und 145.197 € im Endwert. Die Unterschiede zwischen den Lieferanten fallen auf: 100.716 € pro VZÄ für das Nearshore-Team in Lissabon, knapp 180.000 € für die Infrastrukturexperten von Alpine Data Experts.

Die anderen Budgetberichte haben eine Auswahl **Messgröße**: Betrag oder VZÄ. Top-Anstiege, der Budgetvergleich oder die Analysedimensionen lesen sich dann in Personen. Der Filter **Zeilen mit VZÄ** vergleicht außerdem Budget und Ist-Beträge nur der Dienstleistungszeilen.

Die Reiter **Alle**, **OPEX** und **CAPEX** und die Dimensionsfilter gelten auch hier: die Kosten pro VZÄ der aktivierten Entwicklung oder die eines Programms (siehe [OPEX und CAPEX: das IT-Budget, bereit für die Abstimmung mit dem Controlling](/de/blog/opex-und-capex-im-it-budget)).

Jede Zahl lässt sich begründen. Der Name einer Gruppe öffnet die Liste ihrer Zeilen. Ein Hinweis meldet, wenn der Betrag einer Spalte nicht mehr ihren Mengen- und Preiszeilen folgt. Der Link der Seite behält alle Einstellungen, und die Tabelle lässt sich als CSV exportieren, das Diagramm als PNG, die Seite als PDF.

## Und die internen Teams?

Heute verfolgt KANAP die externen VZÄ. Eine künftige Version wird die Zeit interner Ressourcen gesondert erfassen, damit Sie internes Personal und externe Dienstleister nebeneinander lesen können.

Bis dahin lässt sich interne Zeit schon einfach bewerten: eine Zeile pro Profil, mit ihrem Tagessatz, auf der Budgetzeile des betroffenen Projekts oder Dienstes. Ein Durchschnittskostensatz pro Profil genügt zur Steuerung und vermeidet, dass einzelne Gehälter für jeden Leser des Budgets sichtbar werden.

## Was KANAP nicht tut

KANAP ist weder ein Personalinformationssystem noch ein Lohnabrechnungswerkzeug, und es erfasst keine Arbeitszeiten. Die VZÄ in KANAP sind die, die das Budget Zeile für Zeile plant und bezahlt.

## Wo Sie anfangen

1. **Prüfen Sie die Kalender**: Die Standardkalender Ihrer Länder sind bereits da. Legen Sie einen eigenen Kalender an, wenn ein Dienstleistungsvertrag die Tage anders zählt.
2. **Beginnen Sie mit den größten Dienstleistungen**: Arbeitnehmerüberlassung und technische Unterstützung, wo es am sichtbarsten um viel geht. Eine Zeile pro Profil, mit Menge, Tagessatz und Zeitraum.
3. **Übertragen Sie die Zeilen auf den Endwert** mit Auch für andere Spalten verwenden, und passen Sie im Lauf des Jahres die Zugangs- und Abgangsdaten an.
4. **Lesen Sie Personal nach Monat, dann Kosten pro VZÄ**, und exportieren Sie die Tabelle als CSV für Excel, die Seite als PDF oder nur die Diagramme, um Ihre Präsentation vorzubereiten.

Um all das an einem bereits erfassten Budget zu sehen, bietet eine kostenlose 14-tägige Testphase unserer gehosteten Version Zugang zu den Beispieldaten der fiktiven Gruppe Fromage & Co, in einer Minute geladen. KANAP ist vollständig Open Source: Sie können es auch kostenlos auf Ihren eigenen Servern installieren.
