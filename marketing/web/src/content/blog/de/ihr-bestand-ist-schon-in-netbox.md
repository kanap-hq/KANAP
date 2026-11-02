---
title: "Ihr Hardware-Bestand existiert bereits, und zwar in Netbox"
description: "Das Infrastrukturteam hält Netbox aktuell. KANAP liest es, hält seine Asset-Datensätze ohne Abtippen auf demselben Stand und ergänzt, was Netbox nicht weiß: Anwendungen, Verträge, Kosten."
date: 2026-09-23
topic: mapping
author: Friedrich
authorRole: Gründer, CIO
draft: false
translationKey: netbox-inventory-single-source
---

Dienstag, 2:40 Uhr. Das Monitoring meldet, dass PAR-ESX-04R nicht mehr antwortet. Der Bereitschaftsingenieur öffnet die Asset-Datei und sucht den Server: keine Zeile mit diesem Namen. Die Maschine wurde letzten Monat umbenannt, und in der Datei steht noch PAR-ESX-04.

Es dauert zwanzig Minuten und zwei Telefonate, um herauszufinden, welche Anwendungen darauf liefen, unter welchem Wartungsvertrag, und welche Nummer beim Hersteller anzurufen ist.

Der richtige Name stand irgendwo. Das Infrastrukturteam hat ihn am Tag der Umbenennung in Netbox geändert, so wie es dort jedes Rack, jede Adresse und jede Seriennummer erfasst.

![Der Netbox-Datensatz des Servers PAR-ESX-01: Standort, Rack, Seriennummer, Adresse und Plattform](/screenshots/blog/netbox-device.png)

## Das Inventar und die fachliche Ebene

Netbox sagt, wo eine Maschine steht und wie sie verkabelt ist: Standort, Rack, Höheneinheit, Seriennummer, Adresse, Plattform. Das kann es sehr gut, und diese Informationen verdienen es, nur einmal eingegeben zu werden.

Die IT-Leitung braucht andere Antworten. Welche Anwendungen laufen auf diesem Server? Welcher Vertrag deckt ihn ab, und bis wann? Was kostet er, und auf welchem Budget? Welcher Vorfall hat ihn letzten Monat getroffen? Diese Fragen liegen außerhalb dessen, was Netbox abdeckt.

In KANAP vereint der Asset-Datensatz diese Antworten: gehostete Anwendungen, Verträge, OPEX- und CAPEX-Zeilen, Vorfälle, Aufgaben. Die Netbox-Synchronisierung gibt ihm eine verlässliche Identität. Sie legt Asset-Datensätze aus Netbox an und hält sie aktuell, und das Inventar wird nicht mehr abgetippt.

## Jedes Feld hat genau einen Eigentümer

Zwei Register driften immer auseinander, wenn dieselbe Information auf beiden Seiten bearbeitet werden kann. Deshalb ist die Regel streng: Die Felder, die Netbox füllt, werden von Netbox verwaltet und sind in KANAP gesperrt. Der Rest des Datensatzes gehört Ihnen.

![Die Identitätsfelder eines verknüpften Assets: Netbox füllt die Felder, die es liefert, die anderen ergänzen Sie](/screenshots/blog/netbox-managed-fields.png)

| Von Netbox verwaltet | Bleibt bei Ihnen in KANAP |
|-------------------|----------------------|
| Name | Umgebung |
| Hostname und Domäne | Notizen und Beschreibung |
| Seriennummer | Daten, Support und Garantie |
| Hersteller und Modell | Verträge und Kosten |
| Rack und Höheneinheit | Auf dem Asset gehostete Anwendungen |
| Primäre IP-Adresse | Verbindungen und andere Beziehungen |
| Betriebssystem | Anhänge, Aufgaben, Vorfälle |
| Lebenszyklusstatus | Alles andere am Asset |
| Standort und Unterstandort | |

Die Sperre betrifft nur die Felder, die Netbox für dieses Objekt füllt. Ein Gerät ohne Plattform in Netbox behält ein offenes Feld für das Betriebssystem. Sie ergänzen es in KANAP, und Ihr Wert bleibt: Eine Synchronisierung schreibt nur die Werte, die Netbox liefert.

KANAP liest Netbox mit einem API-Token, das nur Leserechte hat. Das Infrastrukturteam behält sein Werkzeug, wie es ist.

Ihr Asset-Register umfasst auch, was Netbox nicht beschreibt, etwa eine EC2-Instanz oder eine verwaltete Datenbank. Diese Assets leben in KANAP neben den anderen, ohne Warnung.

## Auswählen, was hereinkommt

Der Reiter **Zuordnungen** legt den Umfang fest, in drei Tabellen.

- **Rollen.** Jede Netbox-Rolle erhält einen KANAP-Asset-Typ oder **Nicht importieren**. Die Server kommen herein, die PDUs und Patchfelder im selben Rack bleiben draußen. Alle virtuellen Maschinen laufen über eine einzige Zeile.
- **Standorte.** Jeder Netbox-Site wird einer Ihrer Standorte zugeordnet. Ihre Netbox-Locations der obersten Ebene werden automatisch zu Unterstandorten.
- **Betriebssysteme.** Jede Netbox-Plattform wird einem Betriebssystem aus Ihrem Katalog zugeordnet: Aus „Debian 12“ in Netbox wird „Debian 12 (bookworm)“ in KANAP.

Jede Zeile zeigt, wie viele Objekte sie abdeckt. So sehen Sie die Reichweite einer Entscheidung, bevor Sie sie treffen. KANAP füllt vor, was es erkennt, und Ihre Auswahl gilt, sobald sie mit **Zuordnungen speichern** gespeichert ist.

![Der Reiter Zuordnungen: Jede Netbox-Rolle erhält einen Asset-Typ oder Nicht importieren](/screenshots/blog/netbox-mappings.png)

## Die erste Synchronisierung, Zeile für Zeile gelesen

Der erste Lauf gegen eine bereits gefüllte Datenbank ist der heikle Moment. Ihre Assets existieren in KANAP, manchmal unter anderen Namen. Das Risiko ist doppelt: Dubletten, wenn der Abgleich scheitert, und vor allem eine falsche Verknüpfung, durch die Netbox den Datensatz einer anderen Maschine überschreiben würde.

KANAP versucht vier Dinge der Reihe nach und hält beim ersten an, das etwas findet: eine bestehende Verknüpfung, die Seriennummer, den Hostnamen, den Namen. Findet ein Schritt mehrere Assets, geht das Objekt mit den Kandidaten nach **Zu entscheiden**.

Zwei Signale ergeben nur einen Vorschlag: ein Name, der gleich beginnt, und eine IP-Adresse, die ein Asset bereits hat. Adressen werden wiederverwendet, zwischen Cluster-Mitgliedern geteilt oder sind einfach veraltet. Das Objekt wartet dann unter **Zu entscheiden** mit dem vorgeschlagenen Asset, und ein Klick bestätigt es.

> Jeder unsichere Abgleich geht über Ihren Tisch.

**Jetzt synchronisieren** öffnet **Vor dem Anwenden prüfen**. Die Vorschau sortiert alles: Neuanlagen, Aktualisierungen Feld für Feld, zu treffende Entscheidungen, Objekte außerhalb des Umfangs, aus Netbox verschwundene Objekte. Sie korrigieren direkt dort: ein Objekt mit einem bestehenden Asset verknüpfen, ein neues anlegen oder es dauerhaft außen vor lassen.

![Die Vorschau vor dem Anwenden: ein umbenannter Server, ein Server in der Außerbetriebnahme, eine ersetzte Seriennummer und eine zu treffende Entscheidung](/screenshots/blog/netbox-preview.png)

Bei einem großen Bestand läuft die Prüfung in Stapeln zu 500. **Diesen Stapel anwenden** schreibt genau das, was die Vorschau zeigt. Der nächste Stapel wartet, bis Sie ihn gelesen haben.

<aside class="tip">
  <b>Tipp</b>
  <p>Tragen Sie vor dem ersten Lauf die Seriennummern in KANAP ein und hinterlegen Sie Ihre DNS-Suffixe unter IT-Landschaft > Einstellungen. Die Seriennummer ist der robusteste Abgleich überhaupt: Sie übersteht Umbenennungen auf beiden Seiten.</p>
</aside>

## Danach lebt der Bestand

Die zweite Synchronisierung zeigt, ob man dem Werkzeug vertrauen kann. Sie sollte kurz sein: Sie zeigt nur, was sich geändert hat.

- Eine in Netbox umbenannte Maschine braucht eine Zeile, mit altem und neuem Namen. PAR-ESX-04 in der Vorschau oben ist so ein Fall.
- Eine in Netbox umbenannte Location erscheint einmal, und alle Geräte darin ziehen mit.
- Ein Server auf *Decommissioning* wird **Veraltet**. Ein Status *Offline* oder *Failed* erscheint als Warnung am Asset, und der Lebenszyklus bleibt Aktiv.
- Eine aus Netbox gelöschte Maschine bleibt in KANAP, mit ihren Verträgen und ihrer Historie. Sie wechselt nach **Fehlt in Netbox**, und Sie entscheiden selbst, ob Sie sie als **Außer Betrieb** markieren.
- Ein von Hand in KANAP bearbeitetes verwaltetes Feld wird beim nächsten Lauf wieder angeglichen.

Sobald zwei manuelle Läufe in Folge sauber sind, der zweite ohne verbleibende Änderung, schalten Sie die **Automatische Synchronisierung** ein. Sie läuft stündlich und wendet Änderungen direkt an. Sie startet nach einer ersten fehlerfrei angewendeten manuellen Synchronisierung und pausiert, solange noch ein Stapel darauf wartet, gelesen zu werden. Zweifelsfälle sammeln sich unter **Zu entscheiden** und warten auf Ihre Entscheidung.

## Zurück zur Dienstagnacht

Mit der Synchronisierung existiert PAR-ESX-04R in KANAP unter seinem aktuellen Namen, seit dem Lauf nach der Umbenennung. Der Bereitschaftsingenieur findet ihn beim ersten Versuch. Sein Datensatz listet die Anwendungen, die darauf laufen, mit ihrer Umgebung. Der Reiter **Support** liefert den Wartungsvertrag, die Supportstufe, das Ablaufdatum und die Kontakte beim Hersteller mit ihren Telefonnummern.

Die Suche dauert eine Minute, und der Bereitschaftsingenieur kann sich auf den Ausfall konzentrieren.

## In der Praxis

Die Synchronisierung funktioniert in der Cloud und On-Premise. In der Cloud muss KANAP Ihr Netbox aus dem Internet erreichen. Wenn Ihr Netbox im internen Netz liegt, wird die [On-Premise-Edition](https://kanap.net/de/on-premise) daneben installiert, auf Ihrer eigenen Infrastruktur.

Netbox bleibt die Referenz für die Geräte, und KANAP hält die fachliche Ebene darum herum. Der Rest des Registers wird auf der Seite [IT-Landschaft](https://kanap.net/de/features/it-landscape) beschrieben.
