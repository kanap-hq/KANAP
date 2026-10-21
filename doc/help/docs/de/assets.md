# Assets

Assets dokumentieren Ihr Infrastrukturinventar: physische Server, virtuelle Maschinen, Container, Cloud-Instanzen und Netzwerkgeräte. Verknüpfen Sie Assets mit Standorten, Anwendungen, Verbindungen, Verträgen, Projekten und Aufgaben, um ein vollständiges Bild Ihrer IT-Infrastruktur aufzubauen.

## Erste Schritte

Navigieren Sie zu **IT-Landschaft > Assets**, um Ihr Asset-Inventar zu sehen. Klicken Sie auf **Asset hinzufügen**, um Ihren ersten Eintrag zu erstellen.

**Pflichtfelder**:
- **Name**: Ein eindeutiger Asset-Name oder Hostname
- **Asset-Typ**: Webserver, virtuelle Maschine, physischer Server, Container usw. (konfigurierbar in **IT-Landschaft > Einstellungen**)
- **Standort**: Wo das Asset gehostet wird (bestimmt Anbieter, Hosting-Typ und Land)

**Dringend empfohlen**:
- **Lebenszyklus**: Aktueller Status (Aktiv, Veraltet, Außer Betrieb usw.)
- **Umgebung**: Zu welcher Umgebung dieses Asset gehört (Prod, Pre-prod, QA, Test, Dev, Sandbox)

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
| **#** | Asset-Referenz (z. B. `AST-123`), in Festbreitenschrift |
| **Name** | Asset-Name (klicken, um den Arbeitsbereich zu öffnen) |
| **Zu prüfende Schwachstellen** | Die noch zu prüfenden Schwachstellen der auf dem Asset erfassten Technologien, dann in Orange die Zahl der kritischen oder hohen (`5 · 2`). Leer für ein außer Betrieb genommenes Asset oder wenn keine mehr offen ist. Ein Klick öffnet die Seite [Schwachstellen](vulnerabilities.md), gefiltert auf das Asset. Vorhanden, wenn Schwachstellen verfolgt werden |
| **Asset-Typ** | Der Typ des Assets (z. B. Virtuelle Maschine, Physischer Server) |
| **Cluster** | Cluster-Mitgliedschaft oder ein „Cluster"-Badge, wenn dieses Asset selbst ein Cluster ist |
| **Umgebung** | Prod, Pre-prod, QA, Test, Dev, Sandbox, mit einem farbigen Punkt |
| **Standort** | Wo das Asset gehostet wird |
| **Hosting** | Hosting-Typ (vom Standort abgeleitet) |
| **OS** | Betriebssystem: die als Betriebssystem des Servers markierte Technologie, mit ihrer Version |
| **Netzwerkzone** | Netzwerksegment (vom Subnetz abgeleitet) |
| **Lebenszyklus** | Aktueller Lebenszyklus-Status |
| **Zuweisungen** | Anzahl der Anwendungszuweisungen |
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
| Cluster | Enthält „(Kein Cluster)" für eigenständige Assets |
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

**Tipp**: Kombinieren Sie Filter über Spalten hinweg, um die Ergebnisse einzugrenzen. Filtern Sie zum Beispiel nach Umgebung = „Prod" und Lebenszyklus = „Aktiv", um nur aktive Produktions-Assets zu sehen.

**Aktionen**:
- **Asset hinzufügen**: Ein neues Asset erstellen (`infrastructure:member`)
- **CSV importieren** / **CSV exportieren**: Massenoperationen (`infrastructure:admin`)
- **Asset löschen** (ausgewählte Zeilen): Ausgewählte Assets entfernen (`infrastructure:admin`). Ein Asset, das noch Anwendungen zugeordnet oder mit Verbindungen verknüpft ist, kann nicht gelöscht werden: Entfernen Sie es zuerst daraus. Vor dem Löschen nennt die Bestätigung die behaltenen Assets mit dem Grund

---

## Cluster

Assets können in Cluster organisiert werden:

- **Reguläres Asset**: Eine einzelne Infrastruktur-Instanz
- **Cluster**: Eine Gruppe von Assets, die als eine einzige logische Einheit fungiert

Beim Bearbeiten eines Assets schalten Sie **Cluster** im Reiter Technisch um, um es als Cluster zu markieren. Cluster-Assets können Endpunkte in Verbindungen sein, aber Anwendungszuweisungen müssen auf den Member-Hosts erfolgen, nicht auf dem Cluster selbst.

Cluster-Mitglieder werden im Reiter **Technisch** des Cluster-Arbeitsbereichs über **Mitglieder bearbeiten** verwaltet.

---

## Der Assets-Arbeitsbereich

Klicken Sie auf eine Zeile, um den Arbeitsbereich zu öffnen. Der Arbeitsbereich hat eine **Kopfzeile** mit schnellen Metadaten, eine **Eigenschaftsleiste** auf der rechten Seite (die Identitätskarte des Assets, immer sichtbar) und einen **Inhaltsbereich** in der Mitte, der mit jedem Reiter wechselt.

### Kopfzeile

Die Kopfzeile zeigt:
- **Asset-Name** (an Ort und Stelle bearbeitbar)
- **Asset-Referenz** (z. B. `AST-123`): kopierbare Kennung
- **Lebenszyklus**-Chip (auch über die Eigenschaftsleiste bearbeitbar)
- **Schwerwiegende Schwachstellen**, zum Beispiel „3 schwerwiegend“: die noch zu prüfenden kritischen oder hohen Schwachstellen des Assets, in der Farbe der höchsten. Ein Warnsymbol folgt, wenn einige als ausgenutzt bekannt sind. Ein Klick öffnet den Abschnitt **Schwachstellen** im Reiter **Technisch**. Nur angezeigt, wenn das Asset welche hat
- **Link senden**: Einen teilbaren Link zu diesem Arbeitsbereich kopieren
- **Löschen** (`infrastructure:admin`). Bei einem Asset, das noch verwendet wird, erscheint der Grund vor jeder Bestätigung
- **Vorherige / Nächste** (z. B. „3 von 47"): Durch die gefilterte Liste navigieren, ohne dorthin zurückzukehren

### Eigenschaftsleiste (rechtes Panel)

Die Leiste zeigt die Identitätskarte des Assets in jedem Reiter. Bearbeitungen werden automatisch gespeichert.

**Identifizierung & Standort**:
- **Asset-Typ** (erforderlich)
- **Standort** (erforderlich)
- **Unter-Standort** (wenn der Standort definierte Unter-Standorte hat)
- **Hosting-Typ**, **Cloud-Anbieter / Betreiber-Unternehmen**, **Land**, **Stadt**: schreibgeschützt, vom Standort abgeleitet

**Status**:
- **Umgebung**: Prod, Pre-prod, QA, Test, Dev, Sandbox
- **Administrationszone**: Die Zone Ihres Administrationsmodells, zu der das Asset gehört, zum Beispiel Tier 0 für einen Domänencontroller und den Hypervisor, auf dem er läuft. Wählen Sie aus den in **IT-Landschaft > Einstellungen** konfigurierten Zonen. Das Asset erscheint dann in dieser Zone auf der Seite [Administrationszonen](administration-view.md)
- **Lebenszyklus**: Aktiv, Veraltet, Außer Betrieb usw. (konfigurierbar in den Einstellungen)
- **Go-Live**: Wann das Asset in Produktion ging
- **End-of-Life**: Geplantes oder tatsächliches Stilllegungsdatum

---

### Übersicht

Der Reiter Übersicht ist die Startseite des Assets.

**Beschreibung**: Eine Rich-Text-Beschreibung des Assets. Speichert automatisch beim Bearbeiten.

**Identität**:
- **Hostname**: Der Netzwerk-Hostname des Assets. Wird bei der Erstellung automatisch aus dem Asset-Namen vorausgefüllt; Sie können ihn jederzeit überschreiben. Erforderlich, wenn eine Domäne ausgewählt ist. Erlaubt sind Buchstaben, Ziffern, Bindestriche und Punkte, wobei jeder Teil zwischen zwei Punkten höchstens 63 Zeichen lang ist. Ein Name wie `DL3.ROBOT-15MS.IE2000` ist also so gültig.
- **Domäne**: Die Active Directory- oder DNS-Domäne, zu der das Asset gehört. Wählen Sie aus den in **IT-Landschaft > Einstellungen** konfigurierten Domänen. Systemoptionen umfassen „Workgroup" (eigenständig) und „N/A" (nicht zutreffend).
- **FQDN**: Fully Qualified Domain Name, automatisch aus Hostname und DNS-Suffix der Domäne berechnet. Schreibgeschützt.
- **Aliase**: Zusätzliche DNS-Namen oder Aliase für dieses Asset. Tippen und Enter drücken zum Hinzufügen.

**Zuweisungen** (nicht für Cluster-Assets angezeigt): Listet die Anwendungen auf, die auf diesem Asset laufen. Jede Zeile zeigt:

| Spalte | Was sie zeigt |
|--------|---------------|
| **Anwendung** | Anwendungsname (anklickbar: springt zu den Bereitstellungen der Anwendung) |
| **Umgebung** | Die Bereitstellungsumgebung, zu der die Zuweisung gehört |
| **Rolle** | Server-Rolle (Web, Datenbank, Anwendung usw.) |
| **Seit** | Datum, an dem der Server zugewiesen wurde |
| **Notizen** | Freitext-Notizen |

Klicken Sie auf **Zuweisung hinzufügen**, um dieses Asset einer Anwendungs-Bereitstellung anzuhängen. Wählen Sie die Anwendung, dann die Umgebung (die Anwendung muss bereits eine Bereitstellung in dieser Umgebung haben), dann die Rolle und optionales Datum / Notizen. Verwenden Sie die Zeilensymbole zum Bearbeiten oder Entfernen.

Wenn dieses Asset ein Cluster ist, ersetzt ein Inline-Hinweis die Zuweisungstabelle und fordert Sie auf, stattdessen Member-Hosts zuzuweisen.

**Verbindungen**: Eine schreibgeschützte Ansicht aller Verbindungen, die dieses Asset betreffen. Jede Zeile zeigt die Verbindungs-ID und den Namen (anklickbar: öffnet den Verbindungs-Arbeitsbereich), die Topologie (Server zu Server oder Multi-Server), Protokolle, Quell- und Zielendpunkt-Bezeichnungen sowie den Lebenszyklus-Status. Um eine Verbindung zu erstellen oder zu bearbeiten, navigieren Sie zu **IT-Landschaft > Verbindungen**.

**Wissensdatenbank**: Verknüpfte Wissensartikel für dieses Asset. Mit `knowledge:member` können Sie neue Artikel direkt aus diesem Bereich erstellen.

---

### Technisch { #technical }

Der Reiter Technisch enthält in dieser Reihenfolge den Cluster, die IP-Adressen, die vom Server getragenen Technologien und ihre Schwachstellen.

**Cluster-Verwaltung**:
- **Cluster**-Schalter: dieses Asset als Cluster markieren.
- Wenn das Asset **ein Cluster ist**: Ein Bereich **Mitglieder** listet die Member-Assets auf (Name, Umgebung, Status, Betriebssystem). Klicken Sie auf **Mitglieder bearbeiten**, um Mitglieder über einen Suchdialog hinzuzufügen oder zu entfernen.
- Wenn das Asset **kein Cluster ist**: Ein Bereich **Cluster-Mitgliedschaft** zeigt die Cluster, zu denen dieses Asset gehört (falls vorhanden).

**IP-Adressen**:

Assets unterstützen mehrere IP-Adressen, jede mit ihrer eigenen Netzwerkkonfiguration:

- Klicken Sie auf **IP-Adresse hinzufügen**, um einen neuen Eintrag hinzuzufügen.
- **Typ**: Der Zweck der IP-Adresse (Host, IPMI, Management, iSCSI oder benutzerdefinierte Typen aus den Einstellungen)
- **IP-Adresse**: Die Adresse selbst
- **Subnetz**: Netzwerk-Subnetz aus der konfigurierten Liste (gefiltert nach Standort des Assets)
- **Netzwerkzone**: Automatisch aus dem ausgewählten Subnetz abgeleitet (schreibgeschützt)
- **VLAN**: Automatisch aus dem ausgewählten Subnetz abgeleitet (schreibgeschützt)

So können Sie mehrere Netzwerkschnittstellen pro Asset dokumentieren, zum Beispiel einen physischen Server mit sowohl einer Host-IP als auch einer IPMI-Management-Adresse in verschiedenen Subnetzen.

**Technologien**: was der Server trägt, zum Beispiel Windows Server, SQL Server, vSphere oder Active Directory. Spalten: **Ref.**, **Name**, **Familie**, **Version** und, wenn der Server eine Technologie über einen anderen trägt, **Über**.

- **Betriebssystem**: Das Betriebssystem des Servers ist eine seiner Technologien, aus der Familie **Betriebssystem**. Es steht an erster Stelle der Liste, mit dem Vermerk „Betriebssystem“ nach seinem Namen. Siehe [Betriebssystem](#betriebssystem) weiter unten.
- **Version**: orange, wenn der Support innerhalb von 12 Monaten endet oder nur noch der erweiterte Support läuft, und rot, sobald alle Enddaten verstrichen sind. Fahren Sie mit der Maus darüber, um das Ende des Standardsupports und des erweiterten Supports zu sehen.
- Eine auf diesem Server installierte Technologie entfernen Sie mit dem Kreuz am Ende ihrer Zeile.
- Eine Technologie, die auf dem Server oder Cluster installiert ist, in dem dieser läuft, nennt jenen Server unter **Über**. Sie folgt der Installation und wird dort entfernt.
- **Hinzufügen** (`infrastructure:member`) öffnet eine Technologiesuche, dann die Versionsauswahl: Wählen Sie eine Version, **Version unbekannt**, oder geben Sie eine neue Bezeichnung ein und wählen Sie **Version „…“ hinzufügen**, um sie anzulegen. Jede Änderung wird sofort gespeichert.
- **Version ändern** (`infrastructure:member`): Klicken Sie auf die Version einer installierten Technologie oder auf den Stift am Ende ihrer Zeile. Dieselbe Versionsauswahl öffnet sich.

Die Notizen einer Installation ändern Sie im Reiter **Server** der Technologie. Siehe [Technologien](technologies.md#server).

#### Betriebssystem

Ein Server hat ein Betriebssystem: eine Technologie der Familie **Betriebssystem**, mit ihrer Version.

- **Fügen Sie es hinzu** wie jede Technologie. Hat der Server noch kein Betriebssystem, wird die erste Technologie dieser Familie, die Sie hinzufügen, zu seinem Betriebssystem.
- **Entfernen Sie es** mit seinem Kreuz. Bleibt eine andere Technologie der Familie auf dem Server, wird diese zum Betriebssystem.
- **Ändern Sie die Version** per Klick darauf, wie bei jeder Technologie.
- Ein **Cluster** hat kein eigenes Betriebssystem: Jedes Mitglied hat sein eigenes.

Damit VMware ESXi oder FortiOS das Betriebssystem eines Hosts ist, ordnen Sie diese Technologie der Familie **Betriebssystem** zu (ihr Feld **Familie**, an der Technologie).

Das Betriebssystem erscheint in der Spalte **OS** der Liste, in der Mitgliedertabelle eines Clusters und in der [Verbindungskarte](connection-map.md). Seine Versionen und Support-Enddaten kommen von der Technologie: siehe [Technologien](technologies.md).

#### Schwachstellen

Wenn Schwachstellen verfolgt werden, listet der letzte Abschnitt des Reiters die noch zu prüfenden Schwachstellen der auf diesem Asset erfassten Technologien, in den Warnungen. Die Zahl neben dem Titel ist die Zahl der verschiedenen zu prüfenden Schwachstellen. Eine Zeile pro Technologie und Version:

| Spalte | Was sie zeigt |
|---|---|
| **Technologie**, **Version** | Die Technologie und ihre Version. **Version nicht erfasst (möglicherweise betroffen)**, wenn das Asset keine Version nennt |
| **Kritisch**, **Hoch**, **Mittel**, **Niedrig**, **Nicht bewertet** | Eine Spalte pro Schweregrad: die noch zu prüfenden Schwachstellen. Eine mit **Keine** bewertete Schwachstelle zählt bei **Niedrig** |
| **Gesamt** | Die verschiedenen noch zu prüfenden Schwachstellen dieser Zeile |

**Ansehen** öffnet die Seite [Schwachstellen](vulnerabilities.md), gefiltert auf das Asset und die Technologie. Wenn nichts mehr zu prüfen ist, sagt der Abschnitt es in einer Zeile. Ein außer Betrieb genommenes Asset hat keinen Abschnitt.

**Über ein anderes Asset** listet getrennt die Technologien, die das Asset von einem anderen erhält, etwa vom Host, auf dem es läuft, oder von seinem Cluster, mit diesem Asset in der Spalte **Asset**. Diese Zeilen werden nicht gezählt, weder im Badge noch anderswo: Eine Schwachstelle zählt auf dem Asset, auf dem die Technologie erfasst ist. Ihr **Ansehen** öffnet die Seite auf diesem anderen Asset. Siehe [Was KANAP zählt](vulnerabilities.md#what-kanap-counts).

---

### Hardware

*Nur sichtbar für physische Asset-Typen.*

Verfolgt physische Hardware-Details. Speichert automatisch beim Tippen.

- **Seriennummer**
- **Hersteller**
- **Modell**
- **Kaufdatum**
- **Rack-Standort** (z. B. Reihe A, Rack 12)
- **Rack-Einheit** (z. B. U1-U4)
- **Notizen**

---

### Support

*Nur sichtbar für physische Asset-Typen.*

Verfolgt Lieferantensupport und Kontaktinformationen.

- **Lieferant**: Aus dem Lieferantenverzeichnis auswählen
- **Supportvertrag**: Verknüpfung zu einem Vertragsdatensatz
- **Support-Stufe**: Freitext (z. B. Gold, Silber, 24x7)
- **Support-Ablauf**: Ablaufdatum
- **Notizen**

**Supportkontakte**: Eine Tabelle, in der Sie Kontakte aus dem Kontaktverzeichnis hinzufügen können, jeweils mit einer Freitext-Rollenbezeichnung. Die Tabelle zeigt automatisch die E-Mail, das Telefon und das Mobil jedes Kontakts an.

---

### Verknüpfungen

Der Reiter Verknüpfungen verbindet dieses Asset mit anderen Datensätzen in KANAP. Das Reiter-Badge zählt alle verknüpften Elemente. Die meisten Felder werden automatisch gespeichert.

**Wenn dieser Server ausfällt**: Der Reiter beginnt mit dem, was mit diesem Asset ausfällt. Eine Übersichtszeile zählt die betroffenen Anwendungen, Assets, Cluster und Geschäftsprozesse, danach folgt eine Tabelle pro Art:

- **Anwendungen**: solche mit einer Bereitstellung in Betrieb auf einem ausgefallenen Asset, mit ihren Umgebungen, ihrer Kritikalität und den Assets, auf denen sie laufen (**Über**).
- **Assets**: die Assets, die es enthält, bis zu drei Ebenen tief, und die Assets, die von ihm abhängen. **Über** zeigt den Pfad.
- **Cluster**: Cluster mit einem ausgefallenen Mitglied. **Ausgefallen**, wenn kein Mitglied mehr steht, sonst **Beeinträchtigt** mit der Zahl der ausgefallenen Mitglieder. Die Anwendungen eines ausgefallenen Clusters fallen mit ihm aus.
- **Geschäftsprozesse**: die Prozesse der betroffenen Anwendungen.

Ausgemusterte Assets unterbrechen die Kette: Durch sie fällt nichts aus. Jede Tabelle zeigt ihre ersten 50 Zeilen und zählt den Rest. Anwendungen und Prozesse erfordern das Recht, sie zu lesen. Der Abschnitt aktualisiert sich, sobald Sie die Asset-Beziehungen weiter unten speichern.

**Asset-Beziehungen**:
- **Hängt ab von**: Andere Assets, von denen dieses abhängt (z. B. ein Datenbankserver)
- **Enthält**: Assets, die in diesem enthalten sind (z. B. Server in einem Rack)
- **Enthalten in** / **Abhängig von**: Schreibgeschützte umgekehrte Ansichten, nur angezeigt, wenn andere Assets dieses referenzieren

**Finanzen & Projekte**:
- **Budgetzeilen**: Verknüpfung mit OPEX- und CAPEX-Zeilen in einer Liste. Suchen Sie nach Titel oder Referenz (`BL-12`); jeder Vorschlag zeigt seinen Typ
- **Verträge**: Verknüpfung mit Vertragsdatensätzen
- **Projekte**: Verknüpfung mit Portfolio-Projekten, die mit diesem Asset zusammenhängen

**Aufgaben**: Aufgaben, die mit diesem Asset verknüpft sind. Hier schreibgeschützt. Aufgaben gewinnen oder verlieren diese Verknüpfung, wenn Sie das Feld **Asset** auf einer Aufgabe in der Aufgabenseite festlegen.

**Relevante Websites**: URLs mit optionalen Namen hinzufügen, nützlich für Lieferantenportale, Monitoring-Dashboards oder Dokumentationslinks. **URL hinzufügen** öffnet einen Dialog; vorhandene Einträge können bearbeitet oder gelöscht werden.

**Anhänge**: Dateien per Drag-and-Drop ziehen oder auf **Dateien auswählen** klicken, um sie hochzuladen. Klicken Sie auf einen Anhang-Chip, um ihn herunterzuladen. Löschen erfordert `infrastructure:member`.

---

## CSV-Import/Export

Pflegen Sie Ihr Asset-Inventar im großen Maßstab mit CSV-Import und -Export. Diese Funktion unterstützt Massenoperationen für das initiale Datenladen, periodische Updates aus externen Systemen und Datenextraktion für Berichte.

### Zugriff auf CSV-Funktionen

Aus der Asset-Liste:
- **CSV exportieren**: Assets in eine CSV-Datei herunterladen
- **CSV importieren**: Eine CSV-Datei hochladen, um Assets zu erstellen oder zu aktualisieren

**Erforderliche Berechtigungen**: `infrastructure:admin` für Import-/Export-Operationen.

### Exportoptionen

| Option | Beschreibung |
|--------|-------------|
| **Vollständiger Export** | Alle exportierbaren Felder: für Berichterstellung und vollständige Datenextraktion verwenden |
| **Datenanreicherung** | Alle importierbaren Felder: entspricht dem Importvorlagenformat, ideal für Round-Trip-Bearbeitung (Export, Änderung, erneuter Import) |
| **Benutzerdefinierte Auswahl** | Bestimmte Felder auswählen, die in Ihren Export aufgenommen werden sollen |

**Vorlage herunterladen** (aus Import-Dialog): Lädt eine leere CSV mit allen importierbaren Feld-Spaltenköpfen herunter. Verwenden Sie dies, um Importdateien mit der korrekten Struktur vorzubereiten.

### Import-Workflow

1. **Datei vorbereiten**: Speichern Sie sie als UTF-8. Kommas und Semikolons funktionieren beide, ebenso eine von Excel als einfache CSV gespeicherte Datei (Windows-1252). Laden Sie eine Vorlage herunter, um korrekte Spaltenköpfe sicherzustellen. Trennzeichen, Beträge, Datumsangaben und Ja oder Nein jeder Sprache stehen unter [CSV-Dateien](csv-files.md).

2. **Importeinstellungen wählen**:
   - **Modus**:
     - `Anreichern` (Standard): Leere Zellen erhalten vorhandene Werte: nur aktualisieren, was Sie angeben
     - `Ersetzen`: Leere Zellen löschen vorhandene Werte: vollständiger Ersatz aller Felder
   - **Operation**:
     - `Upsert` (Standard): Neue Assets erstellen oder vorhandene aktualisieren
     - `Nur aktualisieren`: Nur vorhandene Assets ändern, neue überspringen
     - `Nur einfügen`: Nur neue Assets erstellen, vorhandene überspringen

3. **Zuerst validieren**: Klicken Sie auf **Preflight**, um Ihre Datei ohne Änderungen zu validieren. Überprüfen Sie Fehler und Warnungen.

4. **Änderungen anwenden**: Wenn die Validierung erfolgreich ist, klicken Sie auf **Importieren**, um Änderungen zu übernehmen.

### Feldreferenz

**Kernfelder**:

| CSV-Spalte | Beschreibung | Erforderlich | Hinweise |
|------------|-------------|----------|-------|
| `id` | Asset-UUID | Nein | Für Updates; bei neuen Assets leer lassen |
| `name` | Asset-Name | Ja | Wird als eindeutige Kennung für den Abgleich verwendet |
| `location_code` | Standortcode | Ja | Muss mit einem vorhandenen Standortcode übereinstimmen |
| `kind` | Asset-Typ | Ja | Akzeptiert Code oder Bezeichnung (z. B. `vm` oder `Virtual Machine`) |
| `environment` | Umgebung | Ja | `prod`, `pre_prod`, `qa`, `test`, `dev`, `sandbox` |
| `status` | Lebenszyklus-Status | Nein | Akzeptiert Code oder Bezeichnung (z. B. `active` oder `Active`) |
| `is_cluster` | Ist dies ein Cluster | Nein | `ja` oder `nein` |
| `hostname` | Netzwerk-Hostname | Nein | |
| `domain` | DNS-Domäne | Nein | Akzeptiert Code oder Bezeichnung aus den Einstellungen |
| `admin_zone` | Administrationszone | Nein | Akzeptiert Code oder Bezeichnung aus den Einstellungen |
| `aliases` | DNS-Aliase | Nein | Komma-getrennte Liste |
| `operating_system` | Betriebssystem | Nein | Der Name der Technologie, gefolgt von ihrer Version (`Windows Server 2019`). Siehe unten |
| `cluster` | Cluster-Mitgliedschaft | Nein | Name des übergeordneten Clusters |
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

Für Felder, die in **IT-Landschaft > Einstellungen** konfiguriert sind, können Sie entweder den internen Code oder die Anzeigebezeichnung verwenden:

| Feld | Beispiel-Codes | Beispiel-Bezeichnungen |
|-------|---------------|----------------|
| Asset-Typ (`kind`) | `vm`, `physical`, `container` | `Virtual Machine`, `Physical Server`, `Container` |
| Lebenszyklus (`status`) | `active`, `inactive`, `decommissioned` | `Active`, `Inactive`, `Decommissioned` |
| Domäne | `corp`, `dmz` | `Corporate Domain`, `DMZ` |
| Administrationszone (`admin_zone`) | `tier_0`, `tier_1` | `Tier 0 (Vertrauenskern)`, `Tier 1 (Server und Anwendungen)` |
| IP-Adresstyp | `host`, `ipmi`, `mgmt` | `Host IP`, `IPMI`, `Management` |

Das System normalisiert Werte automatisch beim Import, sodass `Virtual Machine`, `virtual machine` und `vm` alle zum gleichen Asset-Typ aufgelöst werden. Ein Wert, der auf mehrere Einträge passt, wird abgelehnt statt erraten. Der CSV-Export schreibt für diese Spalten Namen, sodass eine exportierte Datei unverändert wieder importiert werden kann.

**Betriebssystem**: Die Spalte `operating_system` enthält den Namen der Technologie, gefolgt von ihrer Version, so wie der Export sie schreibt (`Windows Server 2019`, `Ubuntu 24.04 LTS`). Beim Import sucht KANAP die Technologie unter Ihren Technologien, dann im Katalog, und erfasst die Version. Eine Technologie oder Version, die es nicht findet, wird angelegt: Prüfen Sie also vorher die Schreibweise. Der Wert wird zum Betriebssystem des Servers.

### Abgleich und Updates

Assets werden nach **Name** (Groß-/Kleinschreibung ignorierend) abgeglichen. Wenn ein Treffer gefunden wird:
- Mit `Anreichern`-Modus: Nur nicht-leere CSV-Werte aktualisieren das Asset
- Mit `Ersetzen`-Modus: Alle Felder werden aktualisiert, leere Werte löschen vorhandene Daten

Wenn Sie die Spalte `id` mit einer gültigen UUID einschließen, verwendet der Abgleich zuerst die ID und greift dann auf den Namen zurück.

### Abgeleitete Felder

Einige Felder werden berechnet und können nicht importiert werden:
- **Anbieter**: Automatisch vom Standort des Assets abgeleitet
- **FQDN**: Aus Hostname + Domäne berechnet
- **Schwachstellen**: `vulnerabilities_to_review` (die noch zu prüfenden Schwachstellen) und `severe_vulnerabilities` (die kritischen oder hohen davon), gezählt wie in der Spalte der Liste. Nur Export: Der Import ignoriert sie. Leer für ein außer Betrieb genommenes Asset. Fehlen in der Datei, wenn Schwachstellen nicht verfolgt werden

### Einschränkungen

- **Maximal 4 IP-Adressen**: Assets unterstützen bis zu 4 IP-Adresseinträge per CSV
- **Cluster-Zuweisung nach Name**: Verwenden Sie den Cluster-Namen, nicht die ID, in der Spalte `cluster`
- **Standort erforderlich**: Jedes Asset muss einen gültigen Standortcode haben
- **Verknüpfungen nicht enthalten**: Anwendungszuweisungen, Verbindungen, Finanzverknüpfungen, Projekte, Aufgaben und Anhänge müssen im Arbeitsbereich verwaltet werden

### Fehlerbehebung

**Fehler „Datei ist nicht richtig formatiert"**: Dies weist normalerweise auf ein Kodierungsproblem hin. Stellen Sie sicher, dass Ihre CSV als **UTF-8** gespeichert ist:

- **In LibreOffice**: Wählen Sie beim Öffnen einer CSV `UTF-8` im Zeichensatz-Dropdown (nicht „Japanese (Macintosh)" oder andere Kodierungen). Beim Speichern aktivieren Sie „Filtereinstellungen bearbeiten" und wählen Sie UTF-8.
- **In Excel**: Speichern unter > CSV UTF-8 (Komma-getrennt).
- **Allgemeiner Tipp**: Wenn Sie verstümmelte Zeichen am Anfang Ihrer Datei sehen, ist die Kodierung falsch.

### Beispiel-CSV

```csv
name;location_code;kind;environment;status;hostname;domain;ip_1_type;ip_1_address
PROD-WEB-01;NYC-DC1;Virtual Machine;prod;Active;prodweb01;corp;Host IP;10.0.1.10
PROD-DB-01;NYC-DC1;vm;prod;active;proddb01;corp;host;10.0.1.20
```

---

## Tipps

- **Konsistent benennen**: Schließen Sie Umgebung, Rolle und Sequenz in Asset-Namen ein, um eine einfache Identifizierung zu ermöglichen.
- **Cluster verwenden**: Gruppieren Sie verwandte Assets (z. B. Web-Cluster, Datenbank-Cluster), um die Verwaltung zu vereinfachen. Weisen Sie Anwendungen den Member-Hosts zu, nicht dem Cluster selbst.
- **Lebenszyklus verfolgen**: Markieren Sie veraltete und außer Betrieb genommene Assets, um die Inventarzählung genau zu halten.
- **Mit Standorten verknüpfen**: Weisen Sie Assets Standorten zu, sodass Hosting-Typ, Land und Stadt automatisch ausgefüllt werden.
- **Anwendungen zuweisen**: Verwenden Sie den Reiter Übersicht, um Assets mit Anwendungs-Bereitstellungen zu verknüpfen. Die gleichen Zuweisungen erscheinen unter dem Reiter Bereitstellungen der Anwendung.
- **Reiter Verknüpfungen verwenden**: Verbinden Sie Assets mit Budgetzeilen, Verträgen und Projekten für finanzielle Sichtbarkeit.
- **Aufgaben kommen von der Aufgabenseite**: Um eine Aufgabe an ein Asset anzuhängen, setzen Sie das Feld Asset auf der Aufgabe selbst; sie erscheint dann unter Verknüpfungen > Aufgaben.
- **Dokumentation anhängen**: Laden Sie Konfigurationsdateien, Architekturdiagramme oder Lieferantendokumente direkt in den Reiter Verknüpfungen hoch.
