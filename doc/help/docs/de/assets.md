# Assets

Assets dokumentieren Ihr Infrastrukturinventar: physische Server, virtuelle Maschinen, Container, Cloud-Instanzen und Netzwerkgeräte. Verknüpfen Sie Assets mit Standorten, Anwendungen, Verbindungen, Verträgen, Projekten und Aufgaben, um ein vollständiges Bild Ihrer IT-Infrastruktur aufzubauen.

## Erste Schritte

Navigieren Sie zu **IT-Landschaft > Assets**, um Ihr Asset-Inventar zu sehen. Klicken Sie auf **Asset hinzufügen**, um Ihren ersten Eintrag zu erstellen.

**Pflichtfelder**:
- **Name**: Der Asset-Name oder Hostname, höchstens 200 Zeichen
- **Asset-Typ**: Webserver, virtuelle Maschine, physischer Server, Container usw. (konfigurierbar in **IT-Landschaft > Einstellungen**). Kein Typ ist vorausgewählt: **Erstellen** bleibt nicht verfügbar, bis Sie einen wählen
- **Standort**: Wo das Asset gehostet wird (bestimmt Anbieter, Hosting-Typ und Land)

**Dringend empfohlen**:
- **Lebenszyklus**: Aktueller Status (Aktiv, Veraltet, Außer Betrieb usw.)
- **Umgebung**: Zu welcher Umgebung dieses Asset gehört (Prod, Pre-prod, QA, Test, Dev, Sandbox)

**Eindeutige Namen**: Zwei Assets können weder denselben Namen noch denselben FQDN haben. Groß- und Kleinschreibung sowie Leerzeichen am Anfang oder Ende zählen nicht. KANAP lehnt das Duplikat ab und nennt das Asset, das den Wert bereits hat (`AST-12`). Früher erfasste Duplikate bleiben bearbeitbar, solange Sie diesen Wert nicht ändern.

**Tipp**: Verwenden Sie konsistente Namenskonventionen, die Umgebungs- und Rolleninformationen enthalten (z. B. `prod-web-01`, `dev-db-master`). Beim Erstellen eines neuen Assets wird der Hostname automatisch aus dem eingegebenen Namen abgeleitet.

**Berechtigungen**:
- Anzeigen: `infrastructure:reader`
- Erstellen / Bearbeiten: `infrastructure:member`
- Importieren / Exportieren / Löschen: `infrastructure:admin`

---

## Arbeiten mit der Liste { #working-with-the-list }

Die Asset-Liste bietet Ihnen eine filter- und sortierbare Übersicht über jedes Asset in Ihrem Inventar.

**Standardspalten**:

| Spalte | Was sie zeigt |
|--------|---------------|
| **#** | Asset-Referenz (z. B. `AST-123`), in Festbreitenschrift. Wird nach Nummer sortiert |
| **Name** | Asset-Name (klicken, um den Arbeitsbereich zu öffnen) |
| **Zu prüfende Schwachstellen** | Die noch zu prüfenden Schwachstellen der auf dem Asset erfassten Technologien, dann in Orange die Zahl der kritischen oder hohen (`5 · 2`). Leer für ein außer Betrieb genommenes Asset oder wenn keine mehr offen ist. Ein Klick öffnet die Seite [Schwachstellen](vulnerabilities.md), gefiltert auf das Asset. Vorhanden, wenn Schwachstellen verfolgt werden |
| **Asset-Typ** | Der Typ des Assets (z. B. Virtuelle Maschine, Physischer Server) |
| **Cluster** | Die Cluster, in denen das Asset Mitglied ist. Ein Cluster zeigt stattdessen ein Symbol (Tooltip „Cluster“). Leer für ein Asset in keinem Cluster |
| **Umgebung** | Prod, Pre-prod, QA, Test, Dev, Sandbox, mit einem farbigen Punkt |
| **Standort** | Wo das Asset gehostet wird |
| **Hosting** | Hosting-Typ (vom Standort abgeleitet) |
| **OS** | Betriebssystem: die als Betriebssystem des Servers markierte Technologie, mit ihrer Version |
| **Netzwerkzone** | Die Netzwerkzone des Subnetzes der ersten IP-Adresse. Ein Subnetz, das dem Standort des Assets zugeordnet ist, hat Vorrang vor einem Subnetz desselben Bereichs ohne Standort |
| **Lebenszyklus** | Aktueller Lebenszyklus-Status |
| **Zuweisungen** | Anzahl der Anwendungszuweisungen, einschließlich der von seinen Clustern geerbten |
| **Erstellt** | Wann der Datensatz erstellt wurde |

**Standardsortierung**: **Erstellt** absteigend (neueste zuerst).

**Zusätzliche Spalten** (standardmäßig ausgeblendet, über die Spaltenauswahl verfügbar):
- **Unter-Standort**: Spezifischer Bereich innerhalb des Standorts (Gebäude, Raum, Rack)
- **Go-Live**: Datum, an dem das Asset in Produktion ging
- **End-of-Life**: Geplantes oder tatsächliches Stilllegungsdatum
- **Administrationszone**: Die Zone Ihres Administrationsmodells, zu der das Asset gehört

**Filterung**:

Die meisten Spalten unterstützen Kontrollkästchen-Set-Filter für die schnelle Mehrfachauswahl. Filteroptionen werden dynamisch basierend auf anderen aktiven Filtern und der Suchanfrage aktualisiert, sodass Sie nur Werte sehen, die im aktuellen Ergebnissatz vorhanden sind.

| Spalte | Hinweise |
|--------|-------|
| Asset-Typ | Nach einem oder mehreren Asset-Typen filtern |
| Cluster | Die Clusternamen, dann **(Ist ein Cluster)** für die Cluster selbst und **(Kein Cluster)** für die Assets in keinem Cluster |
| Umgebung | Prod, Pre-prod, QA, Test, Dev, Sandbox |
| Standort | Enthält „(Kein Standort)" für nicht zugewiesene Assets |
| Unter-Standort | Enthält „(Kein Unter-Standort)" für Assets ohne |
| Hosting | Nach Hosting-Typ filtern |
| OS | Nach Betriebssystem filtern |
| Netzwerkzone | Nach Netzwerksegment filtern |
| Lebenszyklus | Nach Lebenszyklus-Status filtern |
| Administrationszone | Enthält „(Leer)“ für Assets ohne Zone |
| Zu prüfende Schwachstellen | **Mit schwerwiegenden Schwachstellen**, **Mit Schwachstellen** oder **Ohne**. Ein außer Betrieb genommenes Asset fällt unter keinen dieser Werte |

Die Sortierung nach **Zu prüfende Schwachstellen** ordnet die Assets nach ihren kritischen oder hohen Schwachstellen, dann nach ihrer Gesamtzahl. Außer Betrieb genommene Assets stehen zuletzt. Die Spalte zählt nur direkte Verknüpfungen: Eine virtuelle Maschine zählt die Schwachstellen ihres Hosts nicht. Siehe [Was KANAP zählt](vulnerabilities.md#what-kanap-counts).

**Die Schnellsuche** durchsucht Name, Referenz, Hostname, FQDN, IP-Adressen, Cluster, Standort, Unterstandort und Betriebssystem.

**Tipp**: Kombinieren Sie Filter über Spalten hinweg, um die Ergebnisse einzugrenzen. Filtern Sie zum Beispiel nach Umgebung = „Prod" und Lebenszyklus = „Aktiv", um nur aktive Produktions-Assets zu sehen.

**Aktionen**:
- **Asset hinzufügen**: öffnet ein Menü (`infrastructure:member`). **Asset hinzufügen** legt ein Asset an; **Cluster hinzufügen** legt eines mit bereits eingeschaltetem Schalter **Cluster** an
- **Importieren** / **Exportieren**: Massenoperationen als CSV oder Excel (`infrastructure:admin`). Der Export enthält die Assets, die die Liste zeigt. Siehe [Exportoptionen](#export-options)
- **Asset löschen** (ausgewählte Zeilen): Ausgewählte Assets entfernen (`infrastructure:admin`). Ein Asset, das noch Anwendungen zugeordnet oder mit Verbindungen verknüpft ist, kann nicht gelöscht werden. Die Ablehnung nennt die Anwendungen und bis zu fünf Verbindungen mit Referenz und Name. Entfernen Sie das Asset zuerst daraus. Eine Zuordnung, die das Asset nur von seinem Cluster erbt, hindert nicht daran. Vor dem Löschen nennt die Bestätigung die behaltenen Assets mit dem Grund, und was die anderen mitnehmen (siehe [Einen Cluster oder ein Mitglied löschen](#deleting-a-cluster-or-a-member))

---

## Cluster

Assets können in Cluster organisiert werden:

- **Reguläres Asset**: Eine einzelne Infrastruktur-Instanz
- **Cluster**: Eine Gruppe von Assets, die als eine einzige logische Einheit fungiert

Um einen Cluster anzulegen, wählen Sie **Cluster hinzufügen** im Menü **Asset hinzufügen**, oder schalten Sie den Schalter **Cluster** in der Eigenschaftsleiste eines Assets ein. Eine Verbindung auf einem Cluster gilt für seine Mitglieder: siehe [Verbindungen auf einem Cluster](connections.md#connections-on-a-cluster).

### Anwendungen auf einem Cluster { #applications-on-a-cluster }

Eine Anwendung kann einem Cluster zugeordnet werden, im Reiter **Bereitstellungen** der Anwendung oder im Reiter **Betrieb** des Clusters. Seine Mitglieder in Betrieb hosten die Anwendung dann mit der Rolle der Zuordnung des Clusters. Ein später hinzugefügtes Mitglied hostet sie ebenfalls. Ein aus dem Cluster entferntes Mitglied hostet sie nicht mehr. Ein ausgemustertes Mitglied erbt nichts, und ein ausgemusterter Cluster gibt nichts weiter.

Wo zugeordnet wird, hängt vom Cluster ab:

- **Failover-Cluster** (zum Beispiel SQL Server Always On): Die Anwendung läuft auf jedem Knoten. Ordnen Sie sie dem Cluster zu.
- **Virtualisierungscluster** (zum Beispiel vSphere): Die Anwendungen laufen in den virtuellen Maschinen, die der Cluster enthält. Ordnen Sie jede Anwendung ihrer virtuellen Maschine zu. Nur die Plattform selbst, etwa vSphere mit der Rolle Virtualisierung, wird dem Cluster zugeordnet.

Ein Mitglied führt aus, was seinem Cluster zugeordnet ist. Ein Asset, das der Cluster enthält, läuft darin und erbt nichts.

Wenn Sie eine Anwendung einem Mitglied eines Clusters zuordnen, fragt KANAP **Dem Cluster zuordnen?**: **Dem Cluster zuordnen** legt die Zuordnung für alle Mitglieder auf den Cluster, **Nur diesem Server** behält sie auf diesem Server. Die Frage nennt die Mitglieder, deren eigene Zuordnung mit derselben Umgebung und Rolle durch die des Clusters ersetzt wird. Die Zuordnung des Clusters übernimmt dann das früheste Datum **Seit** und ihre Notizen. Hostet das Mitglied die Anwendung in dieser Rolle bereits über seinen Cluster, wird nichts angelegt und eine Meldung sagt es. Eine Zuordnung über den Assistenten folgt denselben Regeln, ohne die Frage.

Überall, wo KANAP liest, wo eine Anwendung läuft, zählt es die Mitglieder des Clusters: die Schwachstellen und das Support-Ende der Anwendung, ihren Hosting-Typ (ein Cluster ohne Standort übernimmt den Hosting-Typ seiner Mitglieder), die Administrationszonen, die Anwendungen eines Standorts oder eines Vertrags auf einem Server, den Assistenten und die Wissensdatenbank. In der Auswirkung eines ausgefallenen Mitglieds ist der Cluster beeinträchtigt, und seine Anwendungen laufen weiter. Siehe [Abhängigkeiten](#dependencies).

Die Mitglieder werden oben im Reiter **Betrieb** des Clusters verwaltet. Siehe [Betrieb](#operations). Die Regeln:

- Ein Mitglied ist ein einfaches Asset. Ein Cluster kann kein Mitglied sein, und ein Asset kann nicht Mitglied seiner selbst sein.
- Ein Cluster mit Mitgliedern kann nicht wieder zu einem einfachen Asset werden: Entfernen Sie zuerst seine Mitglieder.
- Ein Mitglied eines Clusters kann kein Cluster werden: Nehmen Sie es zuerst aus seinen Clustern heraus.
- Ein Cluster mit Mitgliedern hat kein Betriebssystem: Jedes Mitglied hat sein eigenes. Ein Cluster ohne Mitglieder kann eines behalten, etwa eine Gruppe von Cloud-Instanzen, deren Server Sie nicht erfassen. Siehe [Betriebssystem](#betriebssystem).

Installationen, die von einer früheren Version aktualisiert wurden, behalten ihre Cluster. Mitgliedschaften, die gegen diese Regeln verstoßen, wurden bei der Aktualisierung entfernt. Ein Clustername im früheren Textfeld wurde zu einer echten Mitgliedschaft, wenn er genau einen Cluster bezeichnete.

### Virtuelle Maschinen auf einem Cluster { #virtual-machines-on-a-cluster }

Ein Virtualisierungscluster enthält seine virtuellen Maschinen: Fügen Sie sie im Abschnitt **Enthält** des Clusters hinzu, im Reiter **Abhängigkeiten**. Eine Maschine im Cluster kann auf jedem seiner Hosts laufen.

Wenn Sie eine Beziehung **Enthält** von einem Host aus hinzufügen, der zu einem Cluster gehört, fragt KANAP **Im Cluster platzieren?**. **Im Cluster platzieren** legt die Beziehung auf den Cluster. **Nur dieser Host** behält sie auf dem Host. Dieselbe Frage kommt, wenn Sie einen solchen Host unter **Enthalten in** hinzufügen. Ein ausgemusterter Host oder Cluster löst keine Frage aus.

- Ein Asset im Cluster zu platzieren ersetzt die Verknüpfungen, die die Mitglieds-Hosts zu ihm hatten. Eine Meldung nennt die Hosts.
- Ein Host kann kein Asset enthalten, das sein Cluster bereits enthält. Die Meldung nennt den Cluster.
- Ein Asset mit zwei Containern in Betrieb, etwa einem Host und einem Cluster, trägt ein Warnsymbol neben seinem Namen in **Enthält** und **Enthalten in**. Der Tooltip nennt die anderen Container. Entfernen Sie die Verknüpfung, die nicht mehr stimmt.

Der Assistent und die [Netbox-Synchronisation](netbox.md#clusters) folgen denselben Regeln, ohne die Frage.

### Einen Cluster oder ein Mitglied löschen { #deleting-a-cluster-or-a-member }

Bevor Sie ein Asset löschen, sagt die Bestätigung, was mit ihm verschwindet: die Cluster, die es verlässt, die Mitglieder, die ihren Cluster verlieren, und die Beziehungen zu anderen Assets, die entfernt werden. Bestätigen Sie mit **Trotzdem löschen**. Das [Audit-Protokoll](admin.md#audit-protokoll) erfasst diese Verluste: bei jedem Cluster, den es verlässt, und bei jedem Asset, das eine Beziehung zu ihm hatte, und für seine eigenen Mitglieder und Beziehungen im Eintrag seiner Löschung.

---

## Der Assets-Arbeitsbereich

Klicken Sie auf eine Zeile, um den Arbeitsbereich zu öffnen. Der Arbeitsbereich hat eine **Kopfzeile** mit schnellen Metadaten, eine **Eigenschaftsleiste** auf der rechten Seite (die Identitätskarte des Assets, immer sichtbar) und einen **Inhaltsbereich** in der Mitte, der mit jedem Reiter wechselt.

Eine Adresse, die kein Asset bezeichnet, öffnet eine Seite **Asset nicht gefunden** mit einem Link zurück zur Liste.

Die Reiter sind **Übersicht**, **Betrieb**, **Netzwerk**, **Hardware** (nur physische Asset-Typen), **Abhängigkeiten**, **Beziehungen** und **Verlauf** (die Änderungen am Asset, siehe [Verlauf der Datensätze](record-history.md)). Wenn Sie ein Asset erstellen, sind **Übersicht** und **Netzwerk** geöffnet. Die anderen Reiter öffnen sich, sobald Sie auf **Erstellen** klicken.

### Kopfzeile

Die Kopfzeile zeigt:
- **Asset-Name** (an Ort und Stelle bearbeitbar)
- **Asset-Referenz** (z. B. `AST-123`): kopierbare Kennung
- **Lebenszyklus**-Chip (auch über die Eigenschaftsleiste bearbeitbar)
- **Schwerwiegende Schwachstellen**, zum Beispiel „3 schwerwiegend“: die noch zu prüfenden kritischen oder hohen Schwachstellen des Assets, in der Farbe der höchsten. Ein Warnsymbol folgt, wenn einige als ausgenutzt bekannt sind. Ein Klick öffnet die Seite [Schwachstellen](vulnerabilities.md), gefiltert auf das Asset. Nur angezeigt, wenn das Asset welche hat
- **Teilen**: Einen teilbaren Link zu diesem Arbeitsbereich kopieren
- **Löschen**, ein Papierkorbsymbol mit seinem Namen im Tooltip (`infrastructure:admin`). Bei einem Asset, das noch verwendet wird, erscheint der Grund vor jeder Bestätigung
- **Vorherige / Nächste** (z. B. „3 von 47"): Durch die gefilterte Liste navigieren, ohne dorthin zurückzukehren

### Eigenschaftsleiste (rechtes Panel)

Die Leiste zeigt die Identitätskarte des Assets in jedem Reiter. Bearbeitungen werden automatisch gespeichert. Die Felder bilden drei Gruppen.

**Typ und Zone**:
- **Asset-Typ** (erforderlich)
- **Cluster**: Schalten Sie ihn ein, um das Asset als Cluster zu markieren. Die Änderung wird sofort gespeichert und entfernt nichts. Sie wird für einen Cluster mit Mitgliedern und für ein Mitglied eines Clusters abgelehnt. Siehe [Cluster](#cluster)
- **Umgebung**: Prod, Pre-prod, QA, Test, Dev, Sandbox
- **Administrationszone**: Die Zone Ihres Administrationsmodells, zu der das Asset gehört, zum Beispiel Tier 0 für einen Domänencontroller und den Hypervisor, auf dem er läuft. Wählen Sie aus den in **IT-Landschaft > Einstellungen** konfigurierten Zonen oder **Keine Zone**. Das Asset erscheint dann in dieser Zone auf der Seite [Administrationszonen](administration-view.md)

**Standort**:
- **Standort** (erforderlich): Jedes Asset hat einen, ob es über den Bildschirm, einen Import oder den Assistenten angelegt wird. Gibt es den Standort noch nicht, geben Sie seinen Namen ein und wählen Sie **+ Standort „…“ anlegen**: Geben Sie die Hosting-Art an, und der neue Standort wird ins Feld übernommen. Dafür ist `locations:member` nötig
- **Unterstandort** (wenn der Standort definierte Unterstandorte hat)
- **Hosting-Typ**, **Betreiberunternehmen** oder **Cloud-Anbieter**, **Land**, **Stadt**: schreibgeschützt, vom Standort abgeleitet. Sie folgen, wenn Sie den Standort ändern

**Lebenszyklus**:
- **Lebenszyklus**: Aktiv, Veraltet, Außer Betrieb usw. (konfigurierbar in den Einstellungen)
- **Inbetriebnahmedatum**: Wann das Asset in Produktion ging
- **Datum Lebensende**: Geplantes oder tatsächliches Stilllegungsdatum

---

### Übersicht

Der Reiter Übersicht ist die Startseite des Assets.

**Netbox**: Bei einem mit Netbox verknüpften Asset zeigt eine Zeile oben, wann es zuletzt synchronisiert wurde, mit **In Netbox öffnen**. Sie meldet auch, wenn das Objekt nicht mehr in Netbox ist, wenn sein Netbox-Status Aufmerksamkeit verlangt und wenn das Asset den Vermerk **Wird von Netbox verwaltet** trägt. Siehe [Netbox-Synchronisierung](netbox.md).

**Grunddaten** (wenn Sie ein Asset erstellen): **Name**, **Asset-Typ**, **Standort** und **Umgebung**.

**Beschreibung**: Eine Rich-Text-Beschreibung des Assets. Speichert automatisch beim Bearbeiten.

**Support**: der Lieferantensupport des Assets, für jeden Asset-Typ. Er erscheint, sobald das Asset erstellt ist, und speichert sich beim Tippen von selbst.

- **Lieferant**: Aus dem Lieferantenverzeichnis auswählen
- **Support-Vertrag**: Verknüpfung zu einem Vertragsdatensatz
- **Support-Stufe**: Freitext (z. B. Gold, Silber, 24x7)
- **Ablauf des Supports**: Ablaufdatum
- **Notizen**

**Support-Kontakte**: Eine Tabelle, in der Sie Kontakte aus dem Kontaktverzeichnis hinzufügen können, jeweils mit einer Freitext-Rollenbezeichnung. Die Tabelle zeigt automatisch die E-Mail, das Telefon und das Mobil jedes Kontakts an.

**Wissensdatenbank**: Verknüpfte Wissensartikel für dieses Asset. Mit `knowledge:member` können Sie neue Artikel direkt aus diesem Bereich erstellen. Der Bereich erscheint, sobald das Asset erstellt ist.

---

### Betrieb { #operations }

Der Reiter Betrieb zeigt den Cluster des Assets und was darauf läuft: die Anwendungen, die es hostet, die Technologien, die es trägt, und ihre Schwachstellen. Er öffnet sich, sobald das Asset erstellt ist.

**Cluster**, oben im Reiter:

- Bei einem **Cluster** listet der Abschnitt **Mitglieder** die Mitglieds-Assets auf (Name, Umgebung, Status, Betriebssystem). Klicken Sie auf einen Namen, um dieses Asset zu öffnen. **Mitglieder hinzufügen** (bei einem Cluster ohne Mitglieder) oder **Mitglieder bearbeiten** öffnet einen Suchdialog. Er bietet nur einfache Assets an, nie einen Cluster oder den Cluster selbst. Ein Warnsymbol kennzeichnet ein Mitglied, dessen Umgebung von der des Clusters abweicht. Wenn Sie Mitglieder eines Clusters entfernen, der Anwendungen trägt, nennt **Mitglieder entfernen?** die Anwendungen, die jedes nicht mehr hosten wird. **Trotzdem entfernen** speichert.
- Bei einem Server, der zu einem Cluster gehört, zeigt der Abschnitt **Cluster-Mitgliedschaft** seine Cluster mit ihrer Umgebung und ihrem Status. Klicken Sie auf einen Namen, um den Cluster zu öffnen. Ein Server ohne Cluster hat diesen Abschnitt nicht.

**Gehostete Anwendungen**: die Anwendungen, die auf diesem Asset laufen. Jede Zeile zeigt:

| Spalte | Was sie zeigt |
|--------|---------------|
| **Anwendung** | Anwendungsname. Klicken Sie darauf, um die Anwendung auf ihrem Reiter **Bereitstellungen** zu öffnen |
| **Bereitstellung** | Die Bereitstellung der Anwendung, der das Asset dient, benannt nach ihrer Umgebung |
| **Rolle** | Server-Rolle (Web, Datenbank, Anwendung usw.) |
| **Seit** | Datum, an dem der Server zugeordnet wurde |
| **Notizen** | Freitext-Notizen |

Klicken Sie auf **Zuordnung hinzufügen**, um dieses Asset einer Anwendungs-Bereitstellung zuzuordnen. Wählen Sie die Anwendung, dann ihre Bereitstellung. Hat die Anwendung in einer Umgebung noch keine Bereitstellung, legt **+ Bereitstellung … anlegen** sie zusammen mit der Zuordnung an. Wählen Sie dann die Rolle und optional Datum und Notizen. Bei einem Mitglied eines Clusters fragt KANAP zuerst, ob dem Cluster oder nur diesem Server zugeordnet wird. Siehe [Anwendungen auf einem Cluster](#applications-on-a-cluster). Der Stift am Ende einer Zeile öffnet die Anwendung: Die Zuordnung wird in ihrem Reiter **Bereitstellungen** bearbeitet. Das Papierkorbsymbol entfernt die Zuordnung nach einer Bestätigung. **Zuordnung hinzufügen** ist nicht verfügbar, solange in **IT-Landschaft > Einstellungen** keine Serverrolle eingerichtet ist. Diese Befehle erfordern `infrastructure:member` und `applications:member`. Ohne beide ist die Tabelle schreibgeschützt.

Bei einem Mitglied zeigt eine dem Cluster zugeordnete Anwendung „über“ und den Namen des Clusters, ohne Stift und Papierkorb: Ändern Sie sie am Cluster.

Ist eine Anwendung jedem Mitglied in Betrieb eines Clusters direkt zugeordnet, nennt eine Zeile unter der Tabelle des Clusters diese Mitglieder, mit **Dem Cluster zuordnen**. Nach einer Bestätigung übernimmt der Cluster die Zuordnung, und die eigenen Zuordnungen der Mitglieder werden entfernt. Die Anwendung bleibt dann verfügbar, solange ein Mitglied läuft.

**Technologien**: was der Server trägt, zum Beispiel Windows Server, SQL Server, vSphere oder Active Directory. Spalten: **Ref.**, **Name**, **Familie**, **Version** und, wenn der Server eine Technologie über einen anderen trägt, **Über**.

- **Betriebssystem**: Das Betriebssystem des Servers ist eine seiner Technologien, aus der Familie **Betriebssystem**. Es steht an erster Stelle der Liste, mit dem Vermerk „Betriebssystem“ nach seinem Namen. Siehe [Betriebssystem](#betriebssystem) weiter unten.
- **Version**: orange, wenn der Support innerhalb von 12 Monaten endet oder nur noch der erweiterte Support läuft, und rot, sobald alle Enddaten verstrichen sind. Fahren Sie mit der Maus darüber, um das Ende des Standardsupports und des erweiterten Supports zu sehen.
- Eine auf diesem Server installierte Technologie entfernen Sie mit dem Kreuz am Ende ihrer Zeile.
- Bei einem Cluster erscheint eine auf seinen Mitgliedern installierte Technologie einmal pro Version, mit den Mitgliedern, die sie tragen, unter **Über**. Eine solche Zeile folgt der Installation und wird dort entfernt.
- Eine Technologie, die nur vom Host kommt, in dem dieser Server läuft, etwa das ESXi seines Hosts, ist die zugrunde liegende Plattform. Sie steht unter einer geschlossenen Zeile am Ende der Tabelle, **Zugrunde liegende Plattform (n)**, mit dem Host unter **Über**. Klicken Sie auf die Zeile, um sie anzuzeigen. Diese Zeilen werden im Abschnitt nicht gezählt.
- **Hinzufügen** (`infrastructure:member`) öffnet eine Technologiesuche, dann die Versionsauswahl: Wählen Sie eine Version, **Version unbekannt**, oder geben Sie eine neue Bezeichnung ein und wählen Sie **Version „…“ hinzufügen**, um sie anzulegen. Jede Änderung wird sofort gespeichert.
- **Version ändern** (`infrastructure:member`): Klicken Sie auf die Version einer installierten Technologie oder auf den Stift am Ende ihrer Zeile. Dieselbe Versionsauswahl öffnet sich.

Die Notizen einer Installation ändern Sie im Reiter **Server** der Technologie. Siehe [Technologien](technologies.md#server).

#### Betriebssystem

Ein Server hat ein Betriebssystem: eine Technologie der Familie **Betriebssystem**, mit ihrer Version.

- **Fügen Sie es hinzu** wie jede Technologie. Hat der Server noch kein Betriebssystem, wird die erste Technologie dieser Familie, die Sie hinzufügen, zu seinem Betriebssystem.
- **Entfernen Sie es** mit seinem Kreuz. Bleibt eine andere Technologie der Familie auf dem Server, wird diese zum Betriebssystem.
- **Ändern Sie die Version** per Klick darauf, wie bei jeder Technologie.
- Ein **Cluster** mit Mitgliedern hat kein Betriebssystem: Jedes Mitglied hat sein eigenes. Ein Cluster ohne Mitglieder kann eines tragen, gesetzt durch einen Import oder den Assistenten. Auf dem Bildschirm bleibt eine Technologie dieser Familie, die einem Cluster hinzugefügt wird, eine gewöhnliche Technologie.
- Wenn Sie einem Cluster mit Betriebssystem die ersten Mitglieder hinzufügen, erscheint die Frage **Betriebssystem entfernen?**. **Entfernen und speichern** entfernt es und speichert die Mitglieder. Wenn Sie abbrechen, wird nichts gespeichert.

Damit VMware ESXi oder FortiOS das Betriebssystem eines Hosts ist, ordnen Sie diese Technologie der Familie **Betriebssystem** zu (ihr Feld **Familie**, an der Technologie).

Das Betriebssystem erscheint in der Spalte **OS** der Liste, in der Mitgliedertabelle eines Clusters und in der [Verbindungskarte](connection-map.md). Seine Versionen und Support-Enddaten kommen von der Technologie: siehe [Technologien](technologies.md).

#### Schwachstellen

Wenn Schwachstellen verfolgt werden, listet der letzte Abschnitt des Reiters die noch zu prüfenden Schwachstellen der auf diesem Asset erfassten Technologien, in den Warnungen. Die Zahl neben dem Titel ist die Zahl der verschiedenen zu prüfenden Schwachstellen: Ein Klick darauf öffnet die Seite [Schwachstellen](vulnerabilities.md), gefiltert auf das Asset. Eine Zeile pro Technologie und Version:

| Spalte | Was sie zeigt |
|---|---|
| **Technologie**, **Version** | Die Technologie und ihre Version. **Version nicht erfasst (möglicherweise betroffen)**, wenn das Asset keine Version nennt |
| **Krit.**, **Hoch**, **Mittel**, **Niedrig**, **N. bew.** | Eine Spalte pro Schweregrad (Kritisch, Hoch, Mittel, Niedrig, Nicht bewertet, der volle Name im Tooltip der Überschrift): die noch zu prüfenden Schwachstellen. Eine mit **Keine** bewertete Schwachstelle zählt bei **Niedrig** |
| **Gesamt** | Die verschiedenen noch zu prüfenden Schwachstellen dieser Zeile |

**Ansehen** öffnet die Seite [Schwachstellen](vulnerabilities.md), gefiltert auf das Asset und die Technologie. Wenn nichts mehr zu prüfen ist, sagt der Abschnitt es in einer Zeile. Solange KANAP ein Produkt zum ersten Mal aus der NVD liest oder den Abgleich einer Technologie ausführt, die gerade auf diesem Asset erfasst wurde, zeigt der Abschnitt „Suche nach Schwachstellen läuft…“ und füllt sich von selbst. Wenn die Suche nicht abgeschlossen werden kann, sagt der Abschnitt das. Ein außer Betrieb genommenes Asset hat keinen Abschnitt.

Bei einem **Cluster** listet **Auf seinen Mitgliedern** getrennt die Technologien seiner Mitglieder, eine Zeile pro Technologie und Version, mit den Mitgliedern, die sie tragen, in der Spalte **Asset**. Ein Cluster zählt die Schwachstellen seiner Mitglieder in Betrieb mit seinen eigenen: die Zahl des Abschnitts, das Badge der Kopfzeile (sein Tooltip sagt „Mitglieder eingeschlossen“) und die Spalte der Liste. **Ansehen** einer Zeile öffnet die Seite auf dem Mitglied, das sie trägt.

Was nur vom Host kommt, in dem das Asset oder seine Mitglieder laufen, etwa das ESXi des Hosts einer virtuellen Maschine, ist die zugrunde liegende Plattform. Es steht unter einer geschlossenen Zeile **Zugrunde liegende Plattform (n)**, die sich per Klick öffnet. Es wird weder im Abschnitt noch im Badge noch in der Spalte der Liste gezählt: Eine Schwachstelle zählt auf dem Asset, auf dem die Technologie erfasst ist. Sein **Ansehen** öffnet die Seite auf diesem Host. Siehe [Was KANAP zählt](vulnerabilities.md#what-kanap-counts).

---

### Netzwerk { #network }

Der Reiter Netzwerk enthält die Netzwerkidentität des Assets, seine IP-Adressen und seine Verbindungen. Er ist geöffnet, wenn Sie ein Asset erstellen. Ist der Hostname beim Klick auf **Erstellen** fehlerhaft, öffnet sich der Reiter auf dem Fehler.

Bei einem von Netbox verwalteten Asset sagt eine Zeile oben, dass Netbox die Felder füllt, die es liefert, und dass Sie die übrigen selbst ausfüllen.

**Identität**:
- **Hostname**: Der Netzwerk-Hostname des Assets. Wird bei der Erstellung automatisch aus dem Asset-Namen vorausgefüllt; Sie können ihn jederzeit überschreiben. Erforderlich, wenn eine Domäne ausgewählt ist. Erlaubt sind Buchstaben, Ziffern, Bindestriche und Punkte, wobei jeder Teil zwischen zwei Punkten höchstens 63 Zeichen lang ist. Ein Name wie `DL3.ROBOT-15MS.IE2000` ist also so gültig.
- **Domäne**: Die Active Directory- oder DNS-Domäne, zu der das Asset gehört. Wählen Sie aus den in **IT-Landschaft > Einstellungen** konfigurierten Domänen. Systemoptionen umfassen „Workgroup“ (eigenständig) und „N/A“ (nicht zutreffend).
- **FQDN**: Fully Qualified Domain Name, automatisch aus Hostname und DNS-Suffix der Domäne berechnet. Schreibgeschützt.
- **Aliase**: Zusätzliche DNS-Namen oder Aliase für dieses Asset. Tippen und Enter drücken zum Hinzufügen.

**IP-Adressen**:

Assets unterstützen mehrere IP-Adressen, jede mit ihrer eigenen Netzwerkkonfiguration:

- Klicken Sie auf **IP-Adresse hinzufügen**, um einen neuen Eintrag hinzuzufügen.
- **Typ**: Der Zweck der IP-Adresse (Host, IPMI, Management, iSCSI oder benutzerdefinierte Typen aus den Einstellungen)
- **IP-Adresse**: Die Adresse selbst. Eine fehlerhafte Adresse wird abgelehnt, mit der Meldung unter dem Feld
- **Subnetz**: Netzwerk-Subnetz aus der konfigurierten Liste (gefiltert nach Standort des Assets)
- **Netzwerkzone**: Automatisch aus dem ausgewählten Subnetz abgeleitet (schreibgeschützt)
- **VLAN**: Automatisch aus dem ausgewählten Subnetz abgeleitet (schreibgeschützt)

So können Sie mehrere Netzwerkschnittstellen pro Asset dokumentieren, zum Beispiel einen physischen Server mit sowohl einer Host-IP als auch einer IPMI-Management-Adresse in verschiedenen Subnetzen.

**Verbindungen**: Eine schreibgeschützte Ansicht der Verbindungen dieses Assets, sobald es erstellt ist: jene, in denen es Endpunkt, Server oder Gerät eines Hops ist, und jene seiner Cluster. Jede Zeile zeigt die Referenz und den Namen (klicken, um die Verbindung zu öffnen), die Topologie, die Protokolle, Quelle und Ziel sowie den Lebenszyklus-Status. Unter dem Namen bedeutet **Hop 2**, dass das Asset das Gerät dieses Hops ist, und **über** nennt den Cluster, wenn die Verbindung das Asset über ihn erreicht. Eine Multi-Server-Verbindung nennt ihre Server anstelle von Quelle und Ziel. Um eine Verbindung zu erstellen oder zu bearbeiten, navigieren Sie zu **IT-Landschaft > Verbindungen**.

---

### Hardware

*Nur sichtbar für physische Asset-Typen. Der Reiter öffnet sich, sobald das Asset erstellt ist.*

Verfolgt physische Hardware-Details. Speichert automatisch beim Tippen.

- **Seriennummer**
- **Hersteller**
- **Modell**
- **Kaufdatum**
- **Rack-Standort** (z. B. Reihe A, Rack 12)
- **Rack-Einheit** (z. B. U1-U4)
- **Notizen**

---

### Abhängigkeiten { #dependencies }

Der Reiter Abhängigkeiten zeigt, wie das Asset zu den anderen Assets steht: was mit ihm ausfällt und seine Beziehungen zu anderen Assets. Er öffnet sich, sobald das Asset erstellt ist. Das Reiter-Badge zählt die Beziehungen zwischen Assets. Die Mitglieder eines Clusters stehen im Reiter [Betrieb](#operations).

**Wenn dieser Server ausfällt**: Der Reiter beginnt mit dem, was mit diesem Asset ausfällt. Eine Übersichtszeile zählt die betroffenen Anwendungen, Assets, Cluster und Geschäftsprozesse, danach folgt eine Tabelle pro Art:

- **Anwendungen**: solche mit einer Bereitstellung in Betrieb auf einem ausgefallenen Asset, mit ihren Umgebungen, ihrer Kritikalität und den Assets, auf denen sie laufen (**Über**).
- **Assets**: die Assets, die es enthält, bis zu drei Ebenen tief, und die Assets, die von ihm abhängen. Ein Cluster, der ausfällt, nimmt alle seine Mitglieder in Betrieb mit, und was von ihnen abhängt. **Über** zeigt den Pfad.
- **Cluster**: Cluster mit einem ausgefallenen Mitglied. **Beeinträchtigt**, solange ein Mitglied steht, mit der Zahl der ausgefallenen Mitglieder: Seine Anwendungen laufen weiter. **Ausgefallen**, wenn kein Mitglied mehr steht: Seine Anwendungen und die Assets, die er enthält, etwa seine virtuellen Maschinen, fallen mit ihm aus.
- **Geschäftsprozesse**: die Prozesse der betroffenen Anwendungen.

Ausgemusterte Assets unterbrechen die Kette: Durch sie fällt nichts aus. Jede Tabelle zeigt ihre ersten 50 Zeilen und zählt den Rest. Anwendungen und Prozesse erfordern das Recht, sie zu lesen. Der Abschnitt aktualisiert sich, sobald Sie eine Beziehung zwischen Assets hinzufügen oder entfernen, die Mitglieder eines Clusters ändern oder den Schalter **Cluster** ein- oder ausschalten.

**Beziehungen zwischen Assets**, eine Tabelle pro Richtung:

| Abschnitt | Bedeutung |
|---|---|
| **Enthält** | Die Assets in diesem, zum Beispiel die Server in einem Rack |
| **Enthalten in** | Die Assets, in denen sich dieses befindet |
| **Hängt ab von** | Die Assets, die dieses zum Betrieb braucht, zum Beispiel ein Datenbankserver |
| **Benötigt von** | Die Assets, die dieses brauchen |

Jede Tabelle zeigt Referenz (`AST-12`), Name, Typ, Umgebung und Status. Ein ausgemustertes oder deaktiviertes Asset bleibt mit ausgegrautem Namen aufgeführt. Klicken Sie auf eine Zeile, um das Asset zu öffnen.

Bei einem Cluster endet **Hängt ab von** mit einer eingeklappten Zeile, **Durch Mitglieder (n)**. Sie listet die Assets auf, von denen die Mitglieder des Clusters in Betrieb abhängen, mit diesen Mitgliedern in der Spalte **Über**. Diese Zeilen sind schreibgeschützt und zählen nicht im Badge des Reiters.

Mit `infrastructure:member` öffnet **Hinzufügen** rechts neben einem Abschnitt eine Suche nach einem Asset. Wählen Sie ein Ergebnis: Die Beziehung wird sofort gespeichert. Um eine Beziehung zu entfernen, fahren Sie mit der Maus über die Zeile und klicken Sie auf das Kreuz am Zeilenende. Eine Meldung bestätigt es und bietet **Rückgängig** an. Leser sehen die Tabellen schreibgeschützt. Eine Beziehung **Enthält** von einem Mitglied eines Clusters fragt zuerst, wo das Asset platziert wird: siehe [Virtuelle Maschinen auf einem Cluster](#virtual-machines-on-a-cluster).

---

### Beziehungen

Der Reiter Beziehungen zeigt, womit das Asset verknüpft ist: Budgetzeilen, Verträge, Projekte, Aufgaben und Vorfälle, jeweils in einer eigenen Tabelle, danach seine Links und Dateien. Die Beziehungen zwischen Assets stehen im Reiter [Abhängigkeiten](#dependencies), die Technologien des Assets im Reiter [Betrieb](#operations). Der Reiter öffnet sich, sobald das Asset erstellt ist. Klicken Sie auf eine Zeile, um den Datensatz zu öffnen. Das Reiter-Badge zählt die verknüpften Datensätze, die Sie sehen dürfen, sowie die Links und Dateien.

**Verknüpfte Datensätze**, jeweils eine Tabelle:

| Abschnitt | Spalten |
|---|---|
| **Budgetzeilen** | Referenz (`BL-12`), Name, Typ (OPEX oder CAPEX), Lieferant und der Betrag des laufenden Jahres in Ihrer Standard-Budgetspalte, in der Berichtswährung. Ein Strich bedeutet, dass die Zeile für das Jahr kein Budget hat |
| **Verträge** | Name, Lieferant, Ende der laufenden Laufzeit, Jahresbetrag in der Vertragswährung, Verlängerung (stillschweigend oder manuell) |
| **Projekte** | Referenz (`PRJ-7`), Name, Status, geplantes Ende |
| **Aufgaben** | Referenz (`T-118`), Titel, Status, zugewiesene Person, Fälligkeit. Offene Aufgaben stehen zuerst |
| **Vorfälle** | Referenz (`INC-14`), Titel, Schweregrad, Status, Erkennungsdatum |

Sie sehen nur die Abschnitte der Module, die Sie lesen dürfen: Budget, Verträge, Portfolio-Projekte, Aufgaben und Vorfälle. Ein Fachbereichs-Mitwirkender sieht nur die Projekte und Aufgaben, an denen er beteiligt ist. Ein vertraulicher Vorfall erscheint nur für die Personen, die ihn im Vorfallregister sehen dürfen, und ohne seinen Titel.

Orange Daten verlangen Aufmerksamkeit: ein Vertrag, dessen Verlängerungsentscheidung in Ihr Entscheidungsfenster für Verträge fällt, oder eine offene Aufgabe nach ihrer Fälligkeit. Eine deaktivierte Budgetzeile oder ein deaktivierter Vertrag bleibt mit ausgegrautem Namen aufgeführt. Ab zwei Zeilen enden Budgetzeilen und Verträge mit einer Summenzeile. Die Summe der Budgetzeilen steht in der Berichtswährung und lässt eine Zeile aus, deren Währung für das Jahr keinen Wechselkurs hat: Ein einzeiliger Hinweis unter der Tabelle nennt sie. Verträge erhalten eine Summe je Währung, ohne die deaktivierten Verträge.

**Verknüpfungen hinzufügen und entfernen** (`infrastructure:member`): **Hinzufügen** rechts neben einem Abschnitt öffnet eine Suche. Geben Sie einen Namen oder eine Referenz ein und wählen Sie ein Ergebnis: Die Verknüpfung wird sofort gespeichert. Das Verknüpfen erfordert auch Leserechte auf das Zielmodul, daher fehlt **Hinzufügen** in einem Abschnitt, den Sie nicht lesen dürfen. Um eine Verknüpfung zu entfernen, fahren Sie mit der Maus über die Zeile und klicken Sie auf das Kreuz am Zeilenende. Eine Meldung bestätigt es und bietet **Rückgängig** an. Das Entfernen einer Verknüpfung löscht nichts anderes. Leser sehen die Tabellen schreibgeschützt.

- Eine Aufgabe, die Sie hier verknüpfen oder lösen, erscheint auch in der Aktivität der Aufgabe.
- Das Verknüpfen oder Lösen eines Vorfalls erfordert zusätzlich `incidents:contributor` und wird im Journal des Vorfalls festgehalten. Ein geschlossener oder abgebrochener Vorfall kann weder verknüpft noch gelöst werden: Öffnen Sie ihn zuerst wieder.

**Links und Dateien**: die Weblinks des Assets (Lieferantenportale, Monitoring-Dashboards, Dokumentation) und seine Dateien (Konfigurationsdateien, Diagramme, Lieferantendokumente), je eine Zeile mit Name, der Domain des Links oder der Größe der Datei und dem Datum, an dem sie hinzugefügt wurden. Klicken Sie auf einen Link, um ihn in einem neuen Tab zu öffnen, oder auf eine Datei, um sie herunterzuladen. Mit `infrastructure:member`:

- **Link hinzufügen** öffnet einen Dialog für eine URL und einen optionalen Namen; der Link wird sofort gespeichert. Eine Adresse ohne `http://` oder `https://` erhält `https://`. Jedes andere Schema wird abgelehnt. Um einen Link zu ändern, fahren Sie mit der Maus über seine Zeile und klicken Sie auf den Stift.
- **Datei anhängen** öffnet die Dateiauswahl. Sie können Dateien auch auf den Abschnitt ziehen.
- Um einen Link oder eine Datei zu entfernen, fahren Sie mit der Maus über die Zeile und klicken Sie auf das Kreuz. Das Entfernen eines Links zeigt eine Meldung und bietet **Rückgängig** an, womit der Link wieder angelegt wird. Das Löschen einer Datei fragt zuerst nach einer Bestätigung.

---

## CSV-Import/Export

Pflegen Sie Ihr Asset-Inventar im großen Maßstab mit Import und Export. Diese Funktion unterstützt Massenoperationen für das initiale Datenladen, periodische Updates aus externen Systemen und Datenextraktion für Berichte.

### Zugriff auf CSV-Funktionen

Aus der Asset-Liste:
- **Exportieren**: Assets in eine CSV-Datei oder Excel-Arbeitsmappe herunterladen
- **Importieren**: Eine CSV-Datei oder Excel-Arbeitsmappe hochladen, um Assets zu erstellen oder zu aktualisieren

**Erforderliche Berechtigungen**: `infrastructure:admin` für Import-/Export-Operationen.

### Exportoptionen { #export-options }

**Inhalt der Datei**: die Assets, die die Liste zeigt. Der Export folgt den Spaltenfiltern und der Schnellsuche. Der Dialog nennt die Zahl der Assets in der Datei. Sie können auch das ganze Verzeichnis exportieren. Die Zeilen behalten die Reihenfolge der Liste.

**Format**: **CSV** oder **Excel (.xlsx)**, im Dialog gewählt und von Ihrem Browser gespeichert. Die Arbeitsmappe enthält dieselben Spalten wie die CSV-Datei auf einem Blatt, mit Zahlen und Datumsangaben als Werte, die Excel sortieren und filtern kann. Der Import liest beides; in einer Arbeitsmappe liest er das erste Blatt. Siehe [CSV- und Excel-Dateien](csv-files.md).

**Spalten**: Die Datei beginnt mit `id` und `reference` (`AST-12`), dann folgen die Spalten dem Arbeitsbereich, Registerkarte für Registerkarte. Der Import ignoriert `reference`.

Die Spalten für Asset-Typ, Lebenszyklus, Domäne, Administrationszone und IP-Adresstyp enthalten die Bezeichnungen des Bildschirms, in der Sprache des Bildschirms.

| Option | Beschreibung |
|--------|-------------|
| **Vollständiger Export** | Alle exportierbaren Felder: für Berichterstellung und vollständige Datenextraktion verwenden |
| **Datenanreicherung** | Alle importierbaren Felder: entspricht dem Importvorlagenformat, ideal für Round-Trip-Bearbeitung (Export, Änderung, erneuter Import) |
| **Benutzerdefinierte Auswahl** | Bestimmte Felder auswählen, die in Ihren Export aufgenommen werden sollen |

**Vorlage herunterladen** (aus Import-Dialog): Lädt eine leere CSV mit allen importierbaren Feld-Spaltenköpfen herunter. Verwenden Sie dies, um Importdateien mit der korrekten Struktur vorzubereiten.

### Import-Workflow

1. **Datei vorbereiten**: eine CSV-Datei oder eine Excel-Arbeitsmappe (`.xlsx`). Speichern Sie eine CSV-Datei als UTF-8. Kommas und Semikolons funktionieren beide, ebenso eine von Excel als einfache CSV gespeicherte Datei (Windows-1252). Laden Sie eine Vorlage herunter, um korrekte Spaltenköpfe sicherzustellen. Trennzeichen, Beträge, Datumsangaben und Ja oder Nein jeder Sprache stehen unter [CSV- und Excel-Dateien](csv-files.md).

2. **Importeinstellungen wählen**:
   - **Modus**:
     - `Anreichern` (Standard): Leere Zellen erhalten vorhandene Werte: nur aktualisieren, was Sie angeben
     - `Ersetzen`: Ersetzt die Werte der Spalten in der Datei. Eine leere Zelle löscht den gespeicherten Wert. Eine Spalte, die in der Datei fehlt, behält ihre Werte. Manche Felder können nicht geleert werden: **Preflight** zeigt sie an.
   - **Operation**:
     - `Upsert` (Standard): Neue Assets erstellen oder vorhandene aktualisieren
     - `Nur aktualisieren`: Nur vorhandene Assets ändern, neue überspringen
     - `Nur einfügen`: Nur neue Assets erstellen, vorhandene überspringen

3. **Zuerst validieren**: Klicken Sie auf **Preflight**, um Ihre Datei ohne Änderungen zu validieren. Überprüfen Sie Fehler und Warnungen.

4. **Änderungen anwenden**: Wenn die Validierung erfolgreich ist, klicken Sie auf **Importieren**, um Änderungen zu übernehmen.

### Was Preflight ablehnt

Preflight meldet einen Fehler in der Zeile, und nichts wird geladen, bei:

- einem Hostnamen, der die Regel des Reiters Netzwerk verletzt;
- einer fehlerhaften IP-Adresse;
- einem Asset-Typ, einer Domäne, einem Lebenszyklus, einer Administrationszone oder einem IP-Adresstyp, der zu nichts in **IT-Landschaft > Einstellungen** passt;
- einem Datum, das es im Kalender nicht gibt, etwa `31/02/2025`, oder einem in Worten geschriebenen Datum. Die zulässigen Datumsformen stehen unter [CSV- und Excel-Dateien](csv-files.md);
- einem belegten IP-Adressplatz, während ein früherer leer ist, zum Beispiel `ip_2_address` ohne `ip_1_address`;
- einem Namen oder FQDN, den bereits ein anderes Asset hat.

Bei einem bestehenden Asset werden Hostname und IP-Adressen nur erneut geprüft, wenn die Datei sie ändert.

### Feldreferenz

**Kernfelder**:

| CSV-Spalte | Beschreibung | Erforderlich | Hinweise |
|------------|-------------|----------|-------|
| `id` | Asset-UUID | Nein | Für Updates; bei neuen Assets leer lassen |
| `name` | Asset-Name | Ja | Wird als eindeutige Kennung für den Abgleich verwendet |
| `location_reference` | Standortcode | Ja | Der **Code** eines vorhandenen Standorts |
| `kind` | Asset-Typ | Ja | Akzeptiert Code oder Bezeichnung (z. B. `vm` oder `Virtual Machine`) |
| `environment` | Umgebung | Ja | `prod`, `pre_prod`, `qa`, `test`, `dev`, `sandbox` |
| `status` | Lebenszyklus-Status | Nein | Akzeptiert Code oder Bezeichnung (z. B. `active` oder `Active`) |
| `is_cluster` | Ist dies ein Cluster | Nein | `ja` oder `nein` |
| `hostname` | Netzwerk-Hostname | Nein | |
| `domain` | DNS-Domäne | Nein | Akzeptiert Code oder Bezeichnung aus den Einstellungen |
| `admin_zone` | Administrationszone | Nein | Akzeptiert Code oder Bezeichnung aus den Einstellungen |
| `aliases` | DNS-Aliase | Nein | Komma-getrennte Liste |
| `operating_system` | Betriebssystem | Nein | Der Name der Technologie, gefolgt von ihrer Version (`Windows Server 2019`). Siehe unten |
| `cluster` | Cluster-Mitgliedschaft | Nein | Die Namen der Cluster, in denen das Asset Mitglied ist, durch Kommas getrennt. Siehe unten |
| `notes` | Freitext-Notizen | Nein | |

**IP-Adressfelder** (bis zu 4 Adressen pro Asset):

| CSV-Spalte | Beschreibung | Hinweise |
|------------|-------------|-------|
| `ip_1_type` | IP-Adresstyp | Akzeptiert Code oder Bezeichnung (z. B. `host` oder `Host IP`) |
| `ip_1_address` | IP-Adresse | |
| `ip_1_subnet_cidr` | Subnetz in CIDR-Notation | |
| `ip_2_type` bis `ip_4_type` | Zusätzliche IP-Typen | Gleiches Muster für die Slots 2-4 |
| `ip_2_address` bis `ip_4_address` | Zusätzliche Adressen | |
| `ip_2_subnet_cidr` bis `ip_4_subnet_cidr` | Zusätzliche Subnetze | |

### Akzeptanz von Bezeichnungen und Codes

Für Felder, die in **IT-Landschaft > Einstellungen** konfiguriert sind, können Sie entweder den internen Code oder die auf dem Bildschirm angezeigte Bezeichnung verwenden, auf Englisch, Französisch, Deutsch oder Spanisch:

| Feld | Beispiel-Codes | Beispiel-Bezeichnungen |
|-------|---------------|----------------|
| Asset-Typ (`kind`) | `vm`, `physical`, `container` | `Virtual Machine`, `Physical Server`, `Container` |
| Lebenszyklus (`status`) | `active`, `inactive`, `decommissioned` | `Active`, `Inactive`, `Decommissioned` |
| Domäne | `corp`, `dmz` | `Corporate Domain`, `DMZ` |
| Administrationszone (`admin_zone`) | `tier_0`, `tier_1` | `Tier 0 (Vertrauenskern)`, `Tier 1 (Server und Anwendungen)` |
| IP-Adresstyp | `host`, `ipmi`, `mgmt` | `Host IP`, `IPMI`, `Management` |

Das System normalisiert Werte automatisch beim Import, sodass `Virtual Machine`, `virtual machine` und `vm` alle zum gleichen Asset-Typ aufgelöst werden. Ein Wert, der auf mehrere Einträge passt, wird abgelehnt statt erraten. Der Export schreibt für diese Spalten Namen, in der Sprache des Bildschirms, sodass eine exportierte Datei unverändert wieder importiert werden kann.

**Betriebssystem**: Die Spalte `operating_system` enthält den Namen der Technologie, gefolgt von ihrer Version, so wie der Export sie schreibt (`Windows Server 2019`, `Ubuntu 24.04 LTS`). Beim Import sucht KANAP die Technologie unter Ihren Technologien, dann im Katalog, und erfasst die Version. Eine Technologie oder Version, die es nicht findet, wird angelegt: Prüfen Sie also vorher die Schreibweise. Der Wert wird zum Betriebssystem des Servers.

**Cluster-Mitgliedschaft**: Die Spalte `cluster` nennt die Cluster des Assets, durch Kommas getrennt (`ESX-PROD, SQL-CLUSTER`). Groß- und Kleinschreibung spielen keine Rolle. Der Export schreibt die Cluster, in denen das Asset Mitglied ist. Beim Import:

- Im Modus `Anreichern` tritt das Asset den in der Zelle genannten Clustern bei und bleibt in seinen anderen Clustern.
- Im Modus `Ersetzen` verlässt das Asset außerdem die Cluster, die seine Zelle nicht nennt.
- Eine leere Zelle ändert nichts, in beiden Modi.

**Preflight** meldet einen Fehler in der Zeile, wenn ein Name zu keinem Asset passt, zu mehreren Clustern passt oder ein Asset nennt, das kein Cluster ist. Abgelehnt wird auch eine Zeile, die sich selbst nennt, eine Zeile, die ein Cluster ist oder wird, und ein Cluster mit Betriebssystem: Der Import entfernt nie eines. Die Spalten `is_cluster` und `operating_system` folgen den Regeln unter [Cluster](#cluster).

### Abgleich und Updates

Assets werden nach **Name** (Groß-/Kleinschreibung ignorierend) abgeglichen. Wenn ein Treffer gefunden wird:
- Mit `Anreichern`-Modus: Nur nicht-leere CSV-Werte aktualisieren das Asset
- Mit `Ersetzen`-Modus: Die Spalten in der Datei werden aktualisiert, und eine leere Zelle löscht den gespeicherten Wert. Spalten, die in der Datei fehlen, behalten ihre Werte. Name, `id`, Status und Pflichtfelder können nicht geleert werden: **Preflight** meldet einen Fehler in der Zeile. Bei den IP-Adressspalten werden nur die Unterspalten in der Datei übernommen. Ein neues Asset erhält die Standardwerte.

Wenn Sie die Spalte `id` mit einer gültigen UUID einschließen, verwendet der Abgleich zuerst die ID und greift dann auf den Namen zurück.

### Abgeleitete Felder

Einige Felder werden berechnet und können nicht importiert werden:
- **Anbieter**: Automatisch vom Standort des Assets abgeleitet und aktualisiert, wenn sich der Standort ändert
- **FQDN**: Aus Hostname + Domäne berechnet
- **Schwachstellen**: `vulnerabilities_to_review` (die noch zu prüfenden Schwachstellen) und `severe_vulnerabilities` (die kritischen oder hohen davon), gezählt wie in der Spalte der Liste. Nur Export: Der Import ignoriert sie. Leer für ein außer Betrieb genommenes Asset. Fehlen in der Datei, wenn Schwachstellen nicht verfolgt werden

### Einschränkungen

- **Maximal 4 IP-Adressen**: Assets unterstützen bis zu 4 IP-Adresseinträge in einer Datei
- **Standort erforderlich**: Jedes Asset muss den Code eines vorhandenen Standorts haben. **Preflight** meldet einen Fehler in einer Zeile mit leerer `location_reference`-Zelle und lehnt eine Datei ohne diese Spalte ab
- **Verknüpfungen nicht enthalten**: Anwendungszuweisungen, Verbindungen, Finanzverknüpfungen, Projekte, Aufgaben und Anhänge müssen im Arbeitsbereich verwaltet werden

### Fehlerbehebung

**Fehler „Datei ist nicht richtig formatiert"**: Dies weist normalerweise auf ein Kodierungsproblem hin. Stellen Sie sicher, dass Ihre CSV als **UTF-8** gespeichert ist:

- **In LibreOffice**: Wählen Sie beim Öffnen einer CSV `UTF-8` im Zeichensatz-Dropdown (nicht „Japanese (Macintosh)" oder andere Kodierungen). Beim Speichern aktivieren Sie „Filtereinstellungen bearbeiten" und wählen Sie UTF-8.
- **In Excel**: Speichern unter > CSV UTF-8 (Komma-getrennt).
- **Allgemeiner Tipp**: Wenn Sie verstümmelte Zeichen am Anfang Ihrer Datei sehen, ist die Kodierung falsch.

### Beispiel-CSV

```csv
name;location_reference;kind;environment;status;hostname;domain;ip_1_type;ip_1_address
PROD-WEB-01;NYC-DC1;Virtual Machine;prod;Active;prodweb01;corp;Host IP;10.0.1.10
PROD-DB-01;NYC-DC1;vm;prod;active;proddb01;corp;host;10.0.1.20
```

---

## Tipps

- **Konsistent benennen**: Schließen Sie Umgebung, Rolle und Sequenz in Asset-Namen ein, um eine einfache Identifizierung zu ermöglichen.
- **Cluster verwenden**: Gruppieren Sie verwandte Assets (z. B. Web-Cluster, Datenbank-Cluster), um die Verwaltung zu vereinfachen. Ordnen Sie eine Anwendung, die auf jedem Knoten läuft, dem Cluster zu, und die Anwendung einer virtuellen Maschine dieser Maschine.
- **Lebenszyklus verfolgen**: Markieren Sie veraltete und außer Betrieb genommene Assets, um die Inventarzählung genau zu halten.
- **Mit Standorten verknüpfen**: Weisen Sie Assets Standorten zu, sodass Hosting-Typ, Land und Stadt automatisch ausgefüllt werden.
- **Anwendungen zuweisen**: Verwenden Sie den Abschnitt **Gehostete Anwendungen** des Reiters Betrieb, um Assets mit Anwendungs-Bereitstellungen zu verknüpfen. Die gleichen Zuweisungen erscheinen unter dem Reiter Bereitstellungen der Anwendung.
- **Reiter Beziehungen verwenden**: Verbinden Sie Assets mit Budgetzeilen, Verträgen und Projekten für finanzielle Sichtbarkeit.
- **Aufgaben hier verknüpfen**: Fügen Sie eine Aufgabe unter Beziehungen > Aufgaben hinzu. Die Verknüpfung erscheint auch in der Aktivität der Aufgabe.
- **Dokumentation anhängen**: Laden Sie Konfigurationsdateien, Architekturdiagramme oder Lieferantendokumente direkt in den Reiter Beziehungen hoch.
