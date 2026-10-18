# IT-Landschaft Einstellungen

Auf der Seite **IT-Landschaft Einstellungen** passen Sie die Dropdown-Werte an, die in der gesamten IT-Landschaft verwendet werden. Diese Listen steuern, welche Optionen erscheinen, wenn Benutzer Anwendungen, Schnittstellen, Assets, Verbindungen und Standorte erstellen oder bearbeiten. Änderungen hier gelten für alle Benutzer in Ihrem Arbeitsbereich.

Für eine bessere Lesbarkeit der Karte enthalten **Entitäten** und **Serverrollen** zusätzlich ein Feld **Graph-Ebene**, das die rollenbasierte Platzierung der Verbindungskarte verwendet.

## Wo Sie es finden

- Arbeitsbereich: **IT-Landschaft**
- Pfad: **IT-Landschaft → Einstellungen**
- Berechtigungen:
  - Sie benötigen mindestens `settings:reader`, um die Seite anzuzeigen.
  - Sie benötigen `settings:admin`, um Werte zu ändern.

Wenn Sie den Eintrag **Einstellungen** im Menü der IT-Landschaft nicht sehen, bitten Sie Ihren Administrator, Ihnen die passenden Berechtigungen zu erteilen.

## Wie die Seite organisiert ist

Der Editor **Einstufungen und Kontinuität** steht oben auf der Seite. Darunter sind die Listen in vier zusammenklappbare Abschnitte gruppiert:

1. **Standorte** - Listen für die Erstellung oder Bearbeitung von Standorten.
2. **Server und Verbindungen** - Listen für Server, Verbindungen und zugehörige Risiko-/Endpoint-Daten.
3. **Anwendungen, Services und Schnittstellen** - Listen für Anwendungen, Anwendungsinstanzen, Schnittstellen und Bindungen.
4. **Vorfälle** - Listen für das Vorfallsregister.

Die Listen der Technologien stehen in zwei Abschnitten: **Technologiefamilien** und **Administrationszonen** unter **Server und Verbindungen**, **Hosting-Typen** unter **Standorte**. Andere Seiten nennen diese Seite die IT-Einstellungen.

Innerhalb eines Abschnitts sind die Listen nach Namen sortiert. Jede Liste erscheint als aufklappbares Panel mit einem kurzen Hinweis, wo ihre Werte verwendet werden (zum Beispiel *Anwendungen / Kategorieauswahl*). Klicken Sie auf die Kopfzeile eines Panels, um es aufzuklappen und die Werte zu sehen. Ein Abschnitt lädt seinen Inhalt erst beim ersten Aufklappen. So bleibt die Seite auch bei vielen Listen schnell.

### Editor-Steuerungen

Jede Liste hat oben eigene Steuerungen:

- **Element hinzufügen** - Fügt oben in der Liste eine neue Zeile ein, fokussiert und bereit zur Eingabe.
- Bearbeitungen werden etwa eineinhalb Sekunden nach Ihrer letzten Änderung automatisch gespeichert, sobald alle Zeilen gültig sind. Neben der Liste erscheint eine Speicheranzeige.

Bei langen Listen (mehr als 25 Zeilen) virtualisiert die Tabelle die Zeilen: Sie zeigt etwa 20 Zeilen gleichzeitig, mit flüssigem Scrollen und fixierten Spaltenköpfen.

### Namen sind die Identität eines Werts

Sie sehen und tippen ausschließlich **Namen**. KANAP erzeugt beim ersten Speichern eines Werts einen stabilen internen Code aus dem Namen und behält ihn dauerhaft bei, sodass das Umbenennen eines Werts nie die Datensätze beschädigt, die ihn verwenden. Der Code ist für Integratoren in der API sichtbar und kann in CSV-Dateien verwendet werden; der CSV-Export schreibt jedoch Namen, und der Import akzeptiert beides.

Weil Namen die Werte identifizieren, gelten innerhalb einer Liste einige Regeln:

- jeder Wert braucht einen Namen, und zwei Werte dürfen nicht denselben Namen tragen (Groß- und Kleinschreibung spielt keine Rolle);
- ein Name darf nicht mit dem internen Code eines anderen Werts derselben Liste identisch sein;
- Namen von **Zugriffsmethoden** dürfen weder Komma noch Semikolon enthalten, da der CSV-Export sie in einer einzigen, durch Kommas getrennten Zelle auflistet.

Eine Liste, die gegen eine dieser Regeln verstößt, wird erst gespeichert, wenn Sie den Fehler behoben haben; die Zeile zeigt an, was nicht stimmt.

### Einen Wert entfernen

**Entfernen** löscht einen Wert, den nichts verwendet. Wenn noch Datensätze auf den Wert verweisen, zeigt KANAP an, wie viele (Anwendungen, Assets, Schnittstellen, Verbindungen, Standorte, Vorfälle, Subnetze…), mit einem Link zur gefilterten Liste, sofern sich eine Liste nach diesem Feld filtern lässt, und bietet stattdessen **Nicht mehr anbieten** an: Der Wert bleibt bei den Datensätzen sichtbar, die ihn bereits verwenden, und wird für neue nicht mehr vorgeschlagen. Ein verwendeter Wert wird nie entfernt, auch nicht über die API.

Integrierte Werte, die KANAP selbst verwaltet (die vier Lebenszyklus-Status, die Domänen Workgroup und N/A), können weder bearbeitet noch entfernt werden. Standard-Netzwerkzonen und -Asset-Typen können bearbeitet und zurückgezogen, aber nicht entfernt werden: Der Server würde sie wieder hinzufügen.

### Ihre Werte übersetzen

Die Werte, die Sie eingeben, werden in allen Sprachen unverändert angezeigt. Um sie in der Sprache des jeweiligen Benutzers anzuzeigen, verwenden Sie die Aktion **Übersetzen** in einer Zeile: Der Dialog zeigt den Basisnamen (und bei Klassifizierungsstufen die Beschreibung) sowie ein Feld pro Sprache. Ein leer gelassenes Feld verwendet die automatische Übersetzung, solange der Wert noch ein KANAP-Standardwert ist, andernfalls den Basistext. Das Speichern von Übersetzungen ändert den Basistext nie, und ein übersetzter Name kann in CSV-Dateien und in der API wie der Name selbst verwendet werden; deshalb darf er keinen anderen Wert der Liste duplizieren.

Editoren zeigen und bearbeiten immer den Basistext; wenn der angezeigte Name in Ihrer Sprache abweicht, weist die Zeile darauf hin („Angezeigt: …“).

---

## Standorte

### Cloud-Anbieter

Cloud-Anbieter, die von Servern und Standorten verwendet werden (z. B. AWS, Azure, GCP).

**Spalten**: Name, Nicht mehr anbieten

**Verwendung**:
- Assets-Arbeitsbereich → Reiter Übersicht → Feld **Anbieter**
- Standorte-Arbeitsbereich → Reiter Übersicht → **Cloud-Anbieter** (wenn der Hosting-Typ Cloud ist)

### Hosting-Typen

Wo Standorte und Technologien gehostet werden. Standardwerte: On-Premise, Colocation, Public Cloud, Private Cloud, SaaS.

**Spalten**: Name, Kategorie (**Vor Ort / Colocation** oder **Cloud / SaaS**), Nicht mehr anbieten

**Verwendung**:
- Standorte-Arbeitsbereich → Reiter Übersicht → Feld **Hosting-Typ**
- Technologie-Arbeitsbereich → Eigenschaftenfeld → **Hosting-Typ**, und das Fenster für neue Technologien. Siehe [Technologien](technologies.md#hosting-typ).

Ein Typ, den eine Technologie nutzt, kann nicht entfernt werden: Markieren Sie ihn stattdessen als **Nicht mehr anbieten**.

Die Kategorie bestimmt, welche Felder beim Bearbeiten eines Standorts erscheinen:
- **Vor Ort / Colocation** zeigt die Felder Betreiberunternehmen und Rechenzentrum
- **Cloud / SaaS** zeigt die Felder Cloud-Anbieter, Region und Zusätzliche Informationen

---

## Server und Verbindungen

### Administrationszonen

Die Zonen Ihres Administrationsmodells, zum Beispiel Tier 0 für den Verzeichnisdienst und seine Controller, Tier 1 für die Server, Tier 2 für die Arbeitsplätze. Sie finden sie in Ihrer Administrationsrichtlinie oder Ihrem Modell für privilegierten Zugriff.

**Spalten**: Name, Administratorgruppe, Berechtigungsstufe, Ablageort der Geheimnisse, Beschreibung, Nicht mehr anbieten

- **Administratorgruppe**: wer die Zone verwaltet, zum Beispiel „Domänen-Admins“.
- **Berechtigungsstufe**: die Stufe der Zone in Ihrem Modell, zum Beispiel „Tier 0“.
- **Ablageort der Geheimnisse**: wo die Administrationsgeheimnisse der Zone aufbewahrt werden, zum Beispiel ein Passwort-Tresor.

**Verwendung**:
- Technologie-Arbeitsbereich → Eigenschaftenfeld → **Administrationszone**
- **IT-Landschaft > Administrationssicht**, die jede Zone mit ihren Technologien und Servern listet. Siehe [Administrationssicht](administration-view.md).

Eine als **Nicht mehr anbieten** markierte Zone bleibt bei den Technologien, die ihr bereits zugeordnet sind.

### Technologiefamilien

Die Art jeder Technologie: Datenbank, Hypervisor, Verzeichnis und Identität usw. Die Technologieliste und die Berichte gruppieren Technologien nach Familie, und die [Administrationssicht](administration-view.md) findet die Verzeichnisdienste über die Familie **Verzeichnis und Identität**.

**Spalten**: Name, Nicht mehr anbieten

**Verwendung**:
- Technologie-Arbeitsbereich → Kopfzeile und Eigenschaftenfeld → **Familie**, und das Fenster für neue Technologien

### Verbindungstypen

Ein zweistufiger Katalog (Kategorie und Eintrag) von Verbindungsprotokollen, mit typischen Ports.

**Spalten**: Kategorie (z. B. Datenbank, Fernzugriff), Name, Typische Ports, Nicht mehr anbieten

**Verwendung**:
- Verbindungen-Arbeitsbereich → Auswahl **Verbindungstyp**

Das Feld **Typische Ports** ist Freitext: Sie können einzelne Ports (`443`), Listen (`80, 443`), Bereiche (`9101-9103`) oder Platzhalter wie `multiple` oder `specify` eingeben.

Zu den Standardkategorien gehören: Anwendung, Authentifizierung, Backup, Datenbank, E-Mail, Dateifreigabe, Dateiübertragung, Messaging, Monitoring, Netzwerkdienste, Fernzugriff, Replikation, Speicher, VPN / Tunnel, Generisch.

### Domänen

Active-Directory- oder DNS-Domänen für Assets. Integrierte Einträge können nicht geändert werden. Das DNS-Suffix dient zur Berechnung des vollqualifizierten Domänennamens (FQDN) jedes Assets.

**Spalten**: Name, DNS-Suffix, Gesamtstruktur, Konten, Computer, Vertrauensstellungen, Nicht mehr anbieten

- **Gesamtstruktur**: die Active Directory-Gesamtstruktur der Domäne, wie in „Active Directory-Domänen und -Vertrauensstellungen“ angezeigt.
- **Konten** und **Computer**: die Anzahl der Benutzerkonten und Computer der Domäne, wie in „Active Directory-Benutzer und -Computer“ gezählt. Nur ganze Zahlen.
- **Vertrauensstellungen**: Die Schaltfläche zeigt, wie viele Vertrauensstellungen die Domäne hat. Ein Klick listet die anderen Domänen, mit denen sie eine Vertrauensstellung hat, wie in „Active Directory-Domänen und -Vertrauensstellungen“ angezeigt. **Vertrauenswürdige Domäne hinzufügen** fügt eine hinzu; wählen Sie ihre **Richtung**: **ausgehend** (diese Domäne vertraut der anderen, deren Konten auf ihre Ressourcen zugreifen können), **eingehend** (die andere Domäne vertraut dieser) oder **bidirektional** (beides). Der Dialog zeigt außerdem, nur lesend, die Vertrauensstellungen, die in anderen Domänen zu dieser erfasst sind. Die Schaltfläche erscheint, sobald die Domäne gespeichert ist, und braucht mindestens eine weitere Domäne in der Liste.

**Verwendung**:
- Assets-Arbeitsbereich → Reiter Technik → Auswahl **Domäne**
- Assets-Arbeitsbereich → Reiter Technik → **FQDN** (automatisch aus Hostname + DNS-Suffix berechnet)
- **IT-Landschaft > Administrationssicht**: Gesamtstruktur, Vertrauensstellungen, Anzahlen und Domänencontroller. Siehe [Administrationssicht](administration-view.md#domanen).

**Systemeinträge** (können weder geändert noch gelöscht werden):
- **Workgroup** - Für eigenständige Assets, die keiner Domäne beigetreten sind
- **N/A** - Für Asset-Typen, bei denen eine Domänenmitgliedschaft nicht zutrifft (z. B. Netzwerkgeräte, Racks)

**Automatisches Ausfüllen**: Wenn Sie eine neue Domäne hinzufügen, wird das DNS-Suffix aus dem eingegebenen Namen vorausgefüllt, bis Sie es selbst bearbeiten.

**Beispiel**: Eine Domäne namens „Corporate AD“ mit dem DNS-Suffix `corp.example.com` ergibt für ein Asset mit dem Hostnamen `web-server-01` den FQDN `hostname.corp.example.com`.

### Entitäten

Endpunkte in Verbindungen und Karten (z. B. Interne Benutzer, Internet, Partnernetzwerke, Externe Systeme). Die Graph-Ebene bestimmt ihre Standardposition auf der Karte.

**Spalten**: Name, Graph-Ebene, Nicht mehr anbieten

**Verwendung**:
- Verbindungen-Arbeitsbereich → Felder **Quellentität** und **Zielentität**
- Verbindungskarte → Entitäten erscheinen als Endpunkte der Flüsse und nutzen die Graph-Ebene für die vertikale Platzierung (Standardentitäten liegen auf Oben)

### Graph-Ebene-Werte

Die Graph-Ebene steuert das bevorzugte vertikale Band in der Verbindungskarte, wenn die **rollenbasierte Platzierung** aktiviert ist:

- **Oben**: Benutzernahe oder externe Endpunkte
- **Obere Mitte**: Obere Anwendungs-/Dienstschicht
- **Mitte**: Neutrale Standard-Mittelschicht
- **Untere Mitte**: Unterstützende Infrastruktur
- **Unten**: Daten- und speicherlastige Endpunkte

### IP-Adresstypen

Typen von IP-Adressen für Assets. Nützlich, um verschiedene Netzwerkschnittstellen zu unterscheiden, etwa Host-IPs, Management-Schnittstellen und Speichernetzwerke.

**Spalten**: Name, Nicht mehr anbieten

**Standardwerte**: Host, IPMI, Management, iSCSI

**Verwendung**:
- Assets-Arbeitsbereich → Reiter Technik → Bereich **IP-Adressen** → Dropdown **Typ**

Assets können mehrere IP-Adressen mit jeweils eigenem Typ haben. Ein physischer Server kann zum Beispiel haben:
- Eine **Host**-IP für den Anwendungsverkehr
- Eine **IPMI**-IP für die Out-of-Band-Verwaltung
- Eine **iSCSI**-IP für die Anbindung an das Speichernetzwerk

### Netzwerkzonen

Netzwerkzonen zur Einordnung von Subnetzen und zur Beschreibung der Konnektivität (z. B. LAN, DMZ, Industrie-LAN, WLAN, Public Cloud, Gast, Management, Speicher, VPN).

**Spalten**: Name, Nicht mehr anbieten

**Verwendung**:
- Subnetzliste → Auswahl **Netzwerkzone**
- Assets-Arbeitsbereich → Reiter Technik → **Netzwerkzone** (automatisch ausgefüllt, wenn ein Subnetz ausgewählt wird)

### Subnetze

Definieren Sie Subnetze in CIDR-Notation, mit optionaler VLAN-Zuordnung. Jedes Subnetz gehört zu einer Netzwerkzone und zu einem Standort.

**Spalten**: Standort, CIDR, VLAN (1-4094), Netzwerkzone, Beschreibung, Nicht mehr anbieten

**Verwendung**:
- Assets-Arbeitsbereich → Reiter Technik → Auswahl **Subnetz**

**Validierungsregeln**:
- CIDR muss eine gültige IPv4-Notation sein (z. B. `192.168.1.0/24`)
- VLAN-Nummern müssen zwischen 1 und 4094 liegen
- CIDR und VLAN-Nummern sind pro Standort eindeutig (dieselben Werte können an verschiedenen Standorten vorkommen)

**Automatisches Ausfüllen**: Wenn Sie bei einem Asset ein Subnetz auswählen, wird die Netzwerkzone automatisch aus der Konfiguration des Subnetzes übernommen.

### Betriebssysteme

Katalog der für Server verfügbaren Betriebssysteme mit Enddaten für Standard- und erweiterten Support.

**Spalten**: Name, Standard-Support, Erweiterter Support, Nicht mehr anbieten

**Verwendung**:
- Assets-Arbeitsbereich → Reiter Technik → Auswahl **Betriebssystem** (der Hilfetext zeigt die Support-Daten)

Daten werden als `YYYY-MM-DD` gespeichert, aber als `TT.MM.JJJJ` bearbeitet.

Die Standardeinträge umfassen Windows-Server-Versionen, Ubuntu LTS, RHEL, Debian und SLES mit den passenden Support-Daten.

### Serverrollen

Rollen, die Servern beim Verknüpfen von Anwendungsinstanzen zugewiesen werden (z. B. Webserver, Datenbankserver, Worker). Die Graph-Ebene bestimmt ihre Position auf der Verbindungskarte.

**Spalten**: Name, Graph-Ebene, Nicht mehr anbieten

**Verwendung**:
- Anwendungen-Arbeitsbereich → Reiter Server → Dropdown **Rolle** beim Verknüpfen eines Assets mit einer Instanz
- Verbindungskarte → aus der Rolle abgeleitetes Platzierungsband für Server und Cluster

Integrierte Standardbeispiele:
- `web`, `proxy` → **Oben**
- `app`, `cloud-service` → **Obere Mitte**
- `db` → **Unten**

### Asset-Typen

Logische Typen für Server und Infrastruktur-Assets (z. B. Physischer Server, Virtuelle Maschine, Container, Serverless, Appliance). Physische Assets können Hardware- und Support-Informationen erfassen.

**Spalten**: Name, Physisch, Nicht mehr anbieten

**Verwendung**:
- Assets-Arbeitsbereich → Reiter Übersicht → Feld **Typ**

---

## Anwendungen, Services und Schnittstellen

### Zugriffsmethoden

Methoden, mit denen Benutzer auf Anwendungen zugreifen (z. B. Web, mobil, VDI).

**Spalten**: Name, Nicht mehr anbieten

**Standardwerte**: Web, Lokal installierte Anwendung, Mobile Anwendung, Proprietäre HMI (industrielle Schnittstelle), Terminal / CLI, VDI / Remote Desktop, Kiosk

**Verwendung**:
- Anwendungen-Arbeitsbereich → Reiter Technik und Support → Mehrfachauswahlfeld **Zugriffsmethoden**

**Tipp**: Passen Sie die Zugriffsmethoden an die Art an, wie Ihre Organisation den Anwendungszugriff einordnet. Fügen Sie zum Beispiel „Citrix“ oder „Thin Client“ hinzu, wenn diese Zugriffswege in Ihrer Umgebung üblich sind.

### Anwendungskategorien

Kategorien, die den Hauptzweck jeder Anwendung oder jedes Service beschreiben.

**Spalten**: Name, Nicht mehr anbieten

**Standardwerte**: Line-of-Business, Produktivität, Sicherheit, Analytik, Entwicklung, Integration, Infrastruktur

**Verwendung**:
- Anwendungen-Arbeitsbereich → Reiter Übersicht → Feld **Kategorie**
- Anwendungsliste → Spalte und Filter **Kategorie**

**Tipp**: Passen Sie die Kategorien an die Terminologie Ihrer Organisation an. Benennen Sie zum Beispiel „Line-of-Business“ in „Geschäftsanwendungen“ um, wenn Ihr Team sie so nennt.

### Einstufungen und Kontinuität

Dieser Editor konfiguriert die Stufen, mit denen Anwendungen klassifiziert werden, und Technologien in ihrem Reiter Compliance. Er steht Benutzern mit `settings:admin` oben auf der Seite zur Verfügung und öffnet sich als einzelner Dialog mit einer Liste pro Katalog:

- **Geschäftskritikalität**: die Stufen, die einer Anwendung zugewiesen werden können. Jede Stufe hat einen Namen, eine Beschreibung, die bei der Auswahl unter dem Namen angezeigt wird, eine optionale **maximal tolerierbare Ausfallzeit** in Minuten und die Markierung **Nicht mehr anbieten**. Die Ausfallzeit dokumentiert die Stufe und löst bei einer Anwendung, deren RTO sie erreicht, einen Hinweis aus; sie ist ein Attribut der Stufe, kein Wert, der auf Anwendungen eingegeben wird.
- **Cyberkritikalität**: unabhängige Folgenstufen.
- **Datenvertraulichkeit**: der Datenklassenkatalog, mit Beschreibungen.
- **Wiederherstellungswellen**: geordnete Wiederherstellungsstufen. Die Reihenfolge steht weder für einen Schweregrad noch für eine Zeitangabe.

**Die Reihenfolge ist die Position in der Liste.** Schweregrad-Kataloge sind von der kritischsten Stufe oben bis zur am wenigsten kritischen unten sortiert, Wiederherstellungswellen in Wiederherstellungsreihenfolge. Verschieben Sie eine Stufe mit den Pfeilen; die Position bestimmt die Sortierung der Listen, die Regel „höchste Stufe“ für Schnittstellen und Verbindungen sowie die Reihenfolge in den Auswahlmenüs. **Stufe hinzufügen** fügt unten an.

**Änderungen am Katalog ändern nie Anwendungen.** Eine Anwendung speichert den Code ihrer Stufe. Das Umbenennen einer Stufe, das Bearbeiten ihrer Beschreibung oder Ausfallzeit und das Umsortieren des Katalogs lassen jede Anwendung auf derselben Stufe und machen Reviews nicht ungültig. Eine Stufe, die noch von einer Anwendung, Schnittstelle oder Verbindung verwendet wird, kann nicht entfernt werden; markieren Sie sie stattdessen mit **Nicht mehr anbieten**: Sie bleibt bei bestehenden Datensätzen sichtbar und wird für neue nicht mehr vorgeschlagen.

Codes werden aus den Namen erzeugt und nie angezeigt; es gelten die oben beschriebenen Namensregeln.

Die Business-Stufen liefern auch die operative Kritikalität für Schnittstellen und Verbindungen. Fehlende abgeleitete Eingaben werden als unvollständig gekennzeichnet; sie werden nicht als niedrigste Stufe behandelt.

#### Datenvertraulichkeit

Die Liste **Datenvertraulichkeit** enthält die Datenklassen, die Anwendungen und Schnittstellen verwenden. Die integrierten Stufen (Öffentlich, Intern, Vertraulich, Eingeschränkt) können weder gelöscht noch als veraltet markiert werden.

**Verwendung**:
- Anwendungen-Arbeitsbereich → Reiter Compliance → Feld **Datenklasse**
- Schnittstellen-Arbeitsbereich → Reiter Übersicht → Feld **Datenklasse**
- Anwendungsliste → Spalte **Datenklasse**

### Integrationsmuster

Integrationsmuster, die von Schnittstellenabschnitten verwendet werden (z. B. REST API, Datei-Batch, Queue, DB-Staging).

**Spalten**: Name, Nicht mehr anbieten

**Verwendung**:
- Schnittstellenabschnitte → Feld **Muster**

### Authentifizierungsmodi für Schnittstellen

Authentifizierungsmodi für Schnittstellenabschnitte und -bindungen (z. B. Dienstkonto, OAuth2, API-Schlüssel, Zertifikat).

**Spalten**: Name, Nicht mehr anbieten

**Verwendung**:
- Schnittstellenbindungen → Feld **Authentifizierungsmodus**

### Datenkategorien für Schnittstellen

Geschäftsdatenkategorien für Schnittstellen (z. B. Stammdaten, Transaktional, Berichterstellung, Steuerung).

**Spalten**: Name, Nicht mehr anbieten

**Verwendung**:
- Schnittstellen-Arbeitsbereich → Feld **Datenkategorie**

### Datenformate für Schnittstellen

Datenformate für Schnittstellenabschnitte (z. B. CSV, JSON, XML, IDoc, Binär).

**Spalten**: Name, Nicht mehr anbieten

**Verwendung**:
- Schnittstellenabschnitte → Feld **Format**

### Schnittstellenprotokolle

Unterstützte Protokolle für Schnittstellenbindungen zwischen Anwendungen (z. B. HTTP/REST, gRPC, SFTP, Kafka, Datenbank).

**Spalten**: Name, Nicht mehr anbieten

**Verwendung**:
- Schnittstellenbindungen → Feld **Protokoll** (ältere Bindungen)

### Auslösertypen für Schnittstellen

Auslösertypen für Schnittstellenabschnitte (z. B. Ereignisbasiert, Geplant, Echtzeit, Manuell).

**Spalten**: Name, Nicht mehr anbieten

**Verwendung**:
- Schnittstellenabschnitte → Feld **Auslöser**

### Lebenszyklus-Status

Gemeinsame Lebenszyklus-Optionen für Anwendungen, Anwendungsinstanzen, Schnittstellen, Schnittstellenbindungen und Server.

**Spalten**: Name, Nicht mehr anbieten

**Gesperrte Codes**: Die integrierten Status (Vorgeschlagen, Aktiv, Veraltet, Außer Betrieb) können weder gelöscht noch in ihrem Code geändert werden.

**Verwendung**:
- Anwendungen, App-Instanzen, Schnittstellen, Schnittstellenbindungen, Assets → Felder **Status**

---

## Vorfälle

### Vorfallkategorien

Kategorien zur Einordnung der Einträge im Vorfallsregister.

**Spalten**: Name, Nicht mehr anbieten

**Verwendung**:
- Vorfälle → Auswahl **Kategorie**

---

## Wie Änderungen bestehende Daten beeinflussen

- **Bestehende Datensätze behalten ihren Wert** - Ein Umbenennen ändert nur die Anzeige, nicht die zugrunde liegenden Daten.
- **Als „Nicht mehr anbieten“ markierte Werte**:
  - Bleiben für Datensätze gültig, die sie bereits verwenden.
  - Werden beim Erstellen neuer Datensätze in den Dropdowns ausgeblendet.
  - Erscheinen beim Bearbeiten weiterhin, wenn der Datensatz diesen Wert bereits verwendet.
- **Neue Werte** stehen sofort in den relevanten Dropdowns zur Verfügung und werden serverseitig validiert.

So können Sie Ihre Taxonomie im Laufe der Zeit weiterentwickeln, ohne bestehende Datensätze zu beschädigen.

---

## Schnellreferenz: Welche Liste speist welches Feld?

| Liste | Verwendung |
|------|-----------------|
| **Zugriffsmethoden** | Anwendungen (Reiter Technik und Support → Zugriffsmethoden) |
| **Anwendungskategorien** | Anwendungen (Kategorie) |
| **Administrationszonen** | Technologien (Eigenschaftenfeld → Administrationszone), Administrationssicht |
| **Cloud-Anbieter** | Assets (Anbieter), Standorte (Cloud-Anbieter) |
| **Verbindungstypen** | Verbindungen (Verbindungstyp) |
| **Domänen** | Assets (Reiter Technik → Domäne, FQDN), Administrationssicht |
| **Entitäten** | Verbindungen (Quell-/Zielentität), Verbindungskarte (Platzierung nach Graph-Ebene) |
| **Hosting-Typen** | Standorte (Übersicht), Technologien (Hosting-Typ) |
| **Integrationsmuster** | Schnittstellenabschnitte (Muster) |
| **Authentifizierungsmodi für Schnittstellen** | Schnittstellenbindungen (Authentifizierungsmodus) |
| **Datenkategorien für Schnittstellen** | Schnittstellen (Datenkategorie) |
| **Datenformate für Schnittstellen** | Schnittstellenabschnitte (Format) |
| **Schnittstellenprotokolle** | Schnittstellenbindungen (Protokoll) |
| **Auslösertypen für Schnittstellen** | Schnittstellenabschnitte (Auslöser) |
| **Vorfallkategorien** | Vorfälle (Kategorie) |
| **IP-Adresstypen** | Assets (Reiter Technik → IP-Adressen → Typ) |
| **Lebenszyklus-Status** | Anwendungen, App-Instanzen, Schnittstellen, Bindungen, Assets |
| **Netzwerkzonen** | Subnetze (Netzwerkzone), Assets (automatisch aus dem Subnetz) |
| **Betriebssysteme** | Assets (Reiter Technik) |
| **Subnetze** | Assets (Reiter Technik → IP-Adressen → Subnetzauswahl) |
| **Serverrollen** | Anwendungen → Reiter Server (Rolle beim Verknüpfen eines Assets mit der Anwendung), Verbindungskarte (Platzierung nach Graph-Ebene) |
| **Asset-Typen** | Assets (Übersicht → Typ) |
| **Technologiefamilien** | Technologien (Familie), Administrationssicht (Verzeichnisdienste) |

---

## Tipps

- **Namen an Ihre Terminologie anpassen** - Prüfen Sie die Standardwerte und benennen Sie sie so um, wie Ihre Organisation über diese Begriffe spricht. Datensätze behalten ihre Verknüpfung mit dem Wert; nur der Name ändert sich.
- **Schrittweise auslaufen lassen** - Wenn Sie sich von einem Wert verabschieden, markieren Sie ihn mit **Nicht mehr anbieten**, statt ihn zu entfernen. So bleiben historische Daten intakt, und Benutzer werden zu den neuen Optionen gelenkt.
- **Datenklassen mit der Sicherheitsabteilung abstimmen** - Änderungen an Datenklassen sollten mit Ihren Richtlinien zur Informationssicherheit übereinstimmen. Sprechen Sie mit der Compliance, bevor Sie Klassifizierungsstufen hinzufügen oder umbenennen.
- **Typische Ports als Dokumentation nutzen** - Das Feld **Typische Ports** bei den Verbindungstypen dient der Information. Füllen Sie es aus, damit Benutzer wissen, welche Ports ein Verbindungstyp üblicherweise verwendet.
- **Kartenlesbarkeit mit Ebenen optimieren** - Richten Sie die Graph-Ebenen von Entitäten und Serverrollen an Ihren Architekturschichten aus (Edge, Anwendung, Daten), um übersichtlichere Layouts in der Verbindungskarte zu erhalten.
