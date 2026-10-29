---
title: "Technologien: die Verbindung zwischen Servern und Anwendungen"
description: "SQL Server, vSphere, Active Directory, Entra ID: Was zwischen Ihren Anwendungen und Ihren Servern läuft, fehlt in den meisten IT-Registern. Mit einem vorbefüllten Katalog macht KANAP daraus das Bindeglied, das Supportenden, Schwachstellen, privilegierte Zugänge und Kosten verbindet."
date: 2026-10-30
topic: compliance
features: [it-landscape]
author: Friedrich
authorRole: Gründer, CIO
draft: false
translationKey: technologies-link-servers-applications
---

Wir beschließen, SQL Server 2016 abzulösen. Erste Frage: Wer hängt davon ab? Die Liste der Anwendungen sagt es nicht. Die Liste der Server nennt das Betriebssystem und hört dort auf. Bleibt nur, die Teams einzeln zu fragen und zu hoffen, dass niemand eine vor sechs Jahren installierte Datenbank vergisst.

Dieselbe Frage kehrt in anderer Form wieder. Entra ID fällt aus: Bei welchen Anwendungen können sich die Benutzer nicht mehr anmelden? Der vSphere-Vertrag steht zur Verlängerung an: Was kostet er uns, und für welche Server?

Was zwischen Servern und Anwendungen läuft, ist das Bindeglied, das in den meisten IT-Registern fehlt. So pflegt KANAP es, ohne mühsame Erfassung, und diesen Nutzen können Sie daraus ziehen.

## Die Einordnungslogik

KANAP beschreibt das Informationssystem mit drei Arten von Objekten:

- **Die Anwendungen**: das, worin die Fachbereiche arbeiten. Das ERP, das CRM, die Lohnabrechnung, das Intranet.
- **Die Technologien**: das, was die IT betreibt oder abonniert, damit diese Anwendungen funktionieren. SQL Server, vSphere, Active Directory, Entra ID, Tomcat.
- **Die Assets**: wo das alles läuft. Server, virtuelle Maschinen, Cluster, Cloud-Datenbanken.

Das Kriterium ist also einfach: Eine Technologie ist ein Produkt, in dem niemand arbeitet, dessen Ausfall aber andere Anwendungen lahmlegt oder angreifbar macht. Entra ID läuft auf keinem Ihrer Server, Active Directory läuft auf Ihren Domänencontrollern, SQL Server hat eine Zeile pro eingesetzter Version: Alle drei sind Technologien.

## Ein Katalog mit 192 Produkten, stets aktuell

![Das Fenster des Technologiekatalogs mit einer laufenden Suche.](/screenshots/technologies-catalog-2026-10-29.png)

Eine Technologie anzulegen beginnt im Katalog. Sie suchen das Produkt und klicken: KANAP legt die Technologie mit Hersteller, Familie, Hosting-Typ, Versionen und deren Supportende an und ergänzt ihre bekannten Schwachstellen sowie eine kurze Beschreibung in Ihrer Sprache.

Die Daten stammen von endoflife.date, der offenen Referenz für Produktlebenszyklen. Für die dort nicht abgedeckten Produkte wie Cisco NX-OS, Juniper Junos, Dell PowerStore oder WebLogic übernimmt KANAP die Daten von den offiziellen Seiten der Hersteller. Jede Version zeigt dann ihre Quelle und den Tag, an dem das Datum geprüft wurde.

Eine übernommene Technologie bleibt aktuell. Jeden Tag prüft KANAP den Katalog: Eine neu veröffentlichte Version kommt hinzu, ein vom Hersteller verschobenes Datum zieht nach. Was Sie von Hand eingegeben haben, bleibt erhalten, und eine Version, die Sie gelöscht haben, wird nicht neu angelegt. Bei einer On-Premise-Installation bringt jede KANAP-Version die Aktualisierungen des Katalogs mit; die tägliche Aktualisierung aus dem Internet können Sie trotzdem aktivieren.

Ein Produkt, das im Katalog fehlt, lässt sich von Hand anlegen; vier Felder genügen.

## Die Versionen und ihr Status

![Die Übersicht einer Technologie: ihre Versionen, deren Supportende und ihr Status.](/screenshots/technologies-versions-2026-10-29.png)

Eine Technologie trägt eine Zeile pro Version, mit dem Ende des Standardsupports und dem Ende des erweiterten Supports. KANAP leitet daraus einen Status ab: „Unterstützt“, „Endet bald“, wenn der Standardsupport innerhalb von 12 Monaten endet, „Erweiterter Support“, „Kein Support“ oder „Datum unbekannt“.

Eine Zeile pro Hauptversion genügt: 2019 und 2022 für SQL Server, 8.0 für vSphere. Auf diesen Zeilen beruhen die Server, die Anwendungen und alles Weitere. Der Bericht zum Supportende, den wir in einem der nächsten Artikel vorstellen, setzt hier an.

## Die Verknüpfungen anlegen

![Der Reiter Anwendungen einer Technologie, mit auf Servern gehosteten Zeilen und einer deklarierten Zeile.](/screenshots/technologies-applications-2026-10-29.png)

Eine Technologie wird dort erfasst, wo sie installiert ist: auf dem Host bei einem Hypervisor, auf jedem Domänencontroller bei Active Directory, auf dem Datenbankserver bei SQL Server. Der Rest geschieht automatisch.

- **Die Maschinen, die sie indirekt erben**, erhalten sie ohne weitere Erfassung. Ein auf einem Cluster installierter SQL Server erscheint auf jedem seiner Mitglieder.
- **Die Anwendungen, die auf diesen Servern gehostet werden**, erhalten sie ebenfalls: KANAP leitet sie aus ihren Bereitstellungen ab.
- **Die Online-Dienste** laufen auf keinem Ihrer Server. Entra ID wird dann bei den Anwendungen deklariert, die den Dienst nutzen.

Auch das Betriebssystem eines Servers ist eine Technologie. Der Katalog bietet vierzehn an: Windows Server, die wichtigsten Linux-Distributionen, AIX, IBM i und Solaris. Es erscheint oben im Datensatz des Servers, mit seiner Version und seinen Supportdaten.

## Für den Einstieg

Ihre Technologien lassen sich nach und nach oder in großer Zahl erfassen.

**Per CSV-Datei.** Die Liste der Technologien importiert und exportiert die Verknüpfungen: Server und Technologien auf der einen Seite, Anwendungen und Technologien auf der anderen. Eine Vorabprüfung listet Zeile für Zeile, was das Laden bewirken würde, und nichts wird geladen, wenn eine Zeile fehlerhaft ist. Ein Import fügt Verknüpfungen hinzu oder aktualisiert sie, er löscht nie welche. Eine Version, die Sie noch nicht verfolgt haben, wird dabei angelegt.

**Netbox.** Ist Ihr Bestand bereits dort, ordnet KANAP jede Netbox-Plattform einem Betriebssystem zu: Aus „Debian 12“ wird Debian, Version 12. Die virtuellen Maschinen werden ihrem Cluster zugeordnet und erhalten die darauf installierten Technologien. Siehe den Artikel [Ihr Hardware-Bestand existiert bereits, und zwar in Netbox](/de/blog/ihr-bestand-ist-schon-in-netbox).

## Eine Erfassung, vier Antworten

Sobald die Technologien verknüpft sind, beantworten sich die Fragen aus der Einleitung ohne weitere Arbeit.

- **Die Supportenden**: Der Bericht nennt die Server und Anwendungen, die eine Version nutzen, deren Support im gewählten Horizont endet.
- **Die Schwachstellen**: Veröffentlichte Schwachstellen werden Version für Version abgeglichen, bis zu den Fachanwendungen. Darum geht es im Artikel [Schwachstellen: von der CVE zur Fachanwendung](/de/blog/schwachstellen-von-der-cve-zur-fachanwendung).
- **Die privilegierten Zugänge**: Ein Verzeichnisdienst wie Entra ID wird einer Administrationszone zugeordnet, zum Beispiel Tier 0. Die Zonenansicht meldet die Server, die einen Verzeichnisdienst außerhalb der sensibelsten Zone tragen.
- **Die Kosten**: Der Reiter Beziehungen einer Technologie bündelt ihre Verträge, mit Fälligkeit und Jahresbetrag, und ihre Budgetzeilen, mit ihrer Summe. Was vSphere kostet, steht in seinem Datensatz, neben den Servern, auf denen es läuft.

![Der Reiter Beziehungen von vSphere: seine Budgetzeile und sein Vertrag.](/screenshots/technologies-relations-vsphere-2026-10-29.png)

Der Datensatz nennt außerdem die IT-Verantwortlichen der Technologie und ihre Supportkontakte, mit deren Kontaktdaten. Und Plaid, der in KANAP integrierte Assistent, oder Ihr eigenes, per MCP verbundenes KI-Werkzeug antwortet direkt: „Auf welchen Servern läuft noch SQL Server 2016?“

## Wo Sie anfangen

1. **Übernehmen Sie Ihre Technologien aus dem Katalog**, beginnend mit Betriebssystemen, Datenbanken und Hypervisoren.
2. **Verknüpfen Sie sie mit den Servern**, gegebenenfalls auf dem Host oder dem Cluster, von Hand, per CSV-Datei oder über Netbox.
3. **Deklarieren Sie die Online-Dienste** bei den Anwendungen, die sie nutzen.
4. **Benennen Sie die IT-Verantwortlichen** jeder Technologie.

KANAP erkennt die auf Ihren Servern installierte Software nicht und verwaltet keine Lizenzen: Die Verknüpfungen kommen von Ihnen, aus einer Datei oder aus Netbox.

Um all das live zu erleben, bietet eine kostenlose 14-tägige Testphase unserer gehosteten Version Zugang zu den Beispieldaten der fiktiven Gruppe Fromage & Co, in einer Minute geladen. KANAP ist vollständig Open Source: Sie können es auch kostenlos auf Ihren eigenen Servern installieren.
