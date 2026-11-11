---
title: "Server-Cluster in der Kadratis-Kartografie"
description: "Ein SQL Server Always On, eine vSphere-Farm: Beschreiben Sie den Cluster einmal. Wohin Ihre Anwendungen je nach Clusterart gehören, was die Mitglieder erben, und Impact-Ansichten, die richtig zählen."
date: 2026-11-02
topic: mapping
features: [it-landscape]
author: Friedrich
authorRole: Gründer, CIO
draft: false
translationKey: server-clusters-kanap-mapping
---

Ein SQL Server Always On mit zwei Knoten, eine vSphere-Farm mit sechs Hosts. In einer Tabelle oder einer von Hand gepflegten CMDB wird jede Anwendung und jeder Netzwerkfluss auf jeden Knoten kopiert. Der siebte Host, letztes Jahr hinzugekommen, hat nichts bekommen.

Am Tag eines Ausfalls bekommt die Frage „Was fällt mit diesem Host aus?" dann eine falsche Antwort, und die Schwachstellen des vergessenen Knotens tauchen nirgends auf.

In Kadratis beschreiben Sie den Cluster einmal. Seine Mitglieder erben, was er trägt, und jede Ansicht, die Server zählt, zählt richtig. Bleibt die Frage, wohin jede Anwendung gehört: Die Antwort hängt von der Art des Clusters ab.

## Zwei Arten von Clustern, zwei Regeln

Ein Cluster entsteht über **Cluster hinzufügen** oder mit dem Schalter **Cluster** an einem bestehenden Asset. Seine Mitglieder werden oben im Reiter **Betrieb** verwaltet.

Dann kommt die Frage, an der alles Weitere hängt: Wohin gehören die Anwendungen?

- **Ein Failover-Cluster** wie SQL Server Always On führt die Anwendung auf jedem Knoten aus. Ordnen Sie die Anwendung dem Cluster zu: Jedes Mitglied in Betrieb hostet sie, mit der Rolle der Zuordnung.
- **Ein Virtualisierungscluster** wie vSphere führt virtuelle Maschinen aus, die von einem Host zum anderen wandern. Legen Sie die Maschinen im Abschnitt **Enthält** des Clusters ab, im Reiter **Abhängigkeiten**, und ordnen Sie jede Anwendung ihrer virtuellen Maschine zu. Nur die Plattform selbst, vSphere mit der Rolle Virtualisierung, wird dem Cluster zugeordnet.

Einige Regeln verhindern Widersprüche. Ein Cluster mit Mitgliedern hat kein Betriebssystem: Jedes Mitglied hat sein eigenes. Ein Mitglied wird kein Cluster, und ein Cluster ist kein Mitglied eines anderen.

![Der Reiter Betrieb eines SQL-Server-Clusters: seine zwei Mitgliedsserver und die dem Cluster zugeordneten Anwendungen.](/screenshots/clusters-operations-2026-11-02.png)

## Einmal erfasst, überall geerbt

Was der Cluster trägt, geht auf seine Mitglieder über. Ein Knoten, der nächstes Jahr hinzukommt, hostet sofort die Anwendungen des Clusters; ein entfernter Knoten hostet sie nicht mehr. Ein ausgemusterter Server erbt nichts.

Der häufigste Fehler bleibt, die Anwendung einem einzelnen Knoten zuzuordnen. Wenn Sie ein Mitglied wählen, fragt Kadratis **Dem Cluster zuordnen?**. Die Frage nennt die Mitglieder, deren eigene Zuordnung durch die des Clusters ersetzt wird, und die Zuordnung des Clusters übernimmt das früheste Inbetriebnahmedatum und ihre Notizen. **Nur diesem Server** bleibt möglich, für die echte Ausnahme.

Netzwerkflüsse folgen derselben Logik. Eine Verbindung kann von einem Cluster ausgehen, bei ihm ankommen oder durch ihn hindurchführen: Sie gilt für jedes Mitglied in Betrieb. Der Reiter **Netzwerk** eines Mitglieds listet die Verbindungen seines Clusters, und die Verbindungskarte zeichnet die Mitglieder.

![Die Frage „Dem Cluster zuordnen?": PAR-SQL-01 gehört zu PAR-SQL-CL01, und seine zwei Mitglieder werden die Anwendung hosten.](/screenshots/clusters-assign-2026-11-02.png)

## Genaue Ansichten

Der Nutzen zeigt sich an dem Tag, an dem ein Server ausfällt. Auf dem Datensatz eines Mitglieds öffnet sich der Reiter **Abhängigkeiten** mit **Wenn dieser Server ausfällt** (**Wenn dieses Asset ausfällt** bei einer virtuellen Maschine). Der Cluster erscheint dort als **Beeinträchtigt**, mit der Zahl der ausgefallenen Mitglieder, und seine Anwendungen laufen auf den anderen Knoten weiter. **Ausgefallen** ist er erst, wenn kein Mitglied mehr steht: Dann fallen seine Anwendungen und seine virtuellen Maschinen mit ihm aus.

Überall, wo Kadratis nachsieht, wo eine Anwendung läuft, zählt es die Mitglieder:

- **Schwachstellen und Support-Ende** einer Anwendung berücksichtigen jeden Knoten. Ein Cluster zeigt die Schwachstellen seiner Mitglieder in Betrieb zusammen mit seinen eigenen.
- **Die Technologien** der Mitglieder erscheinen am Cluster, eine Zeile pro Version, mit den Mitgliedern, die sie tragen.
- **Administrationszonen, Standorte und Verträge** zählen die Anwendungen der Mitglieder.
- **Der Assistent Kad und die Wissensdatenbank** antworten nach denselben Regeln.

Am Cluster selbst klappt der Reiter **Abhängigkeiten** die Assets, von denen seine Mitglieder abhängen, unter einer Zeile **Durch Mitglieder** ein.

![Die Impact-Ansicht eines Mitglieds: PAR-SQL-CL01 ist beeinträchtigt, eines von zwei Mitgliedern ausgefallen.](/screenshots/clusters-impact-2026-11-02.png)

## Importieren statt eintippen

Kadratis entdeckt Ihre Cluster nicht: Es beschreibt sie. Wenn Ihr Bestand schon in Netbox liegt, ordnet die Synchronisierung jeden Netbox-Cluster einem Kadratis-Cluster zu und legt seine virtuellen Maschinen unter **Enthält** ab, nach denselben Regeln. Siehe [Ihr Hardware-Bestand existiert bereits, und zwar in Netbox](/de/blog/ihr-bestand-ist-schon-in-netbox).

Der CSV-Import der Assets hat eine Spalte `cluster`: Sie legt echte Mitgliedschaften an, die Sie im Export wiederfinden. Die Vorabprüfung lehnt einen unbekannten oder mehrdeutigen Clusternamen ab, bevor irgendetwas geschrieben wird.

Und ein Mitglied löschen Sie nicht blind: Die Bestätigung sagt, welche Cluster es verlässt und welche Beziehungen mit ihm gehen.

## Wo anfangen

1. Legen Sie Ihre Cluster an und ordnen Sie ihre Mitglieder zu, im Reiter **Betrieb**.
2. Bei einem Failover-Cluster ordnen Sie die Anwendungen dem Cluster zu. Bei einem Virtualisierungscluster legen Sie die virtuellen Maschinen in den Cluster und lassen die Anwendungen auf ihren Maschinen.
3. Öffnen Sie den Reiter **Abhängigkeiten** eines Mitglieds und prüfen Sie, ob die Antwort stimmt.

Wie Technologien diese Server mit Ihren Anwendungen verbinden, lesen Sie in [Technologien: die Verbindung zwischen Servern und Anwendungen](/de/blog/technologien-die-verbindung-zwischen-servern-und-anwendungen). Kadratis ist Open Source und kostenlos testbar, online oder auf Ihren eigenen Servern.
