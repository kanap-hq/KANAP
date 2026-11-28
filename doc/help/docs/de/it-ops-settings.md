# IT-Landschaft Einstellungen

Auf der Seite **IT-Landschaft Einstellungen** passen Sie die Dropdown-Werte an, die in der gesamten IT-Landschaft verwendet werden. Diese Listen steuern, welche Optionen erscheinen, wenn Benutzer Anwendungen, Schnittstellen, Assets, Verbindungen und Standorte erstellen oder bearbeiten. Änderungen hier gelten für alle Benutzer in Ihrem Arbeitsbereich.

Für eine bessere Lesbarkeit der Karte enthalten **Entitäten** und **Serverrollen** zusätzlich ein Feld **Graph-Ebene**, das die rollenbasierte Platzierung der Verbindungskarte verwendet.

## Wo Sie es finden

- Modul: **IT-Landschaft**
- Pfad: **IT-Landschaft → Einstellungen**, der letzte Eintrag des Menüs
- Berechtigungen:
  - Sie benötigen mindestens `settings:reader`, um den Tab **Listen** anzuzeigen.
  - Sie benötigen `settings:admin`, um Werte zu ändern.
  - Sie benötigen `infrastructure:admin`, um den Tab **Netbox** zu sehen.

Sie sehen nur die Tabs, die Ihre Berechtigungen erlauben. Wenn Sie den Eintrag **Einstellungen** im Menü der IT-Landschaft nicht sehen, bitten Sie Ihren Administrator, Ihnen die passenden Berechtigungen zu erteilen. Andere Bildschirme nennen diese Seite die IT-Einstellungen.

## Wie die Seite organisiert ist

Die Seite hat zwei Tabs. Jeder hat seine eigene Adresse, sodass ein Link oder ein Lesezeichen den richtigen Tab öffnet:

- **Listen** (`/it/settings/lists`) enthält die Dropdown-Werte, die auf dieser Seite beschrieben sind.
- **Netbox** (`/it/settings/netbox`) enthält die Synchronisierung mit Ihrem Netbox-Inventar. Siehe [Netbox-Synchronisierung](netbox.md).

`/it/settings` öffnet den ersten Tab, den Sie sehen dürfen. Die früheren Adressen `/it/settings?tab=netbox` und `/it/netbox` öffnen den Tab **Netbox**.

Änderungen werden von selbst gespeichert. Eine einzige Anzeige in der Kopfzeile der Seite zeigt, ob sie gerade gespeichert werden, gespeichert oder nicht gespeichert sind. Wird eine Liste abgelehnt, erscheint der Grund unter dieser Liste, und die Liste kehrt zu ihren gespeicherten Werten zurück.

Im Tab **Listen** steht der Editor **Einstufungen und Kontinuität** oben. Darunter sind die Listen in vier zusammenklappbare Abschnitte gruppiert:

1. **Standorte**
2. **Server und Verbindungen**
3. **Anwendungen, Services und Schnittstellen**
4. **Vorfälle**

Die Listen der Technologien stehen in zwei Abschnitten: **Technologiefamilien** und **Administrationszonen** unter **Server und Verbindungen**, **Hosting-Typen** unter **Standorte**. Andere Seiten nennen diese Seite die IT-Einstellungen.

Innerhalb eines Abschnitts sind die Listen nach Namen sortiert. Jede Liste erscheint als aufklappbares Panel mit einem kurzen Hinweis, wo ihre Werte verwendet werden (zum Beispiel *Anwendungen / Kategorieauswahl*). Wenn die Werte allein nicht zeigen, wofür eine Liste dient, sagt es ein Informationssymbol neben ihrem Namen beim Überfahren mit der Maus. Klicken Sie auf die Kopfzeile eines Panels, um es aufzuklappen und die Werte zu sehen. Ein Abschnitt lädt seinen Inhalt erst beim ersten Aufklappen. So bleibt die Seite auch bei vielen Listen schnell.

### Editor-Steuerungen

Jede Liste ist eine Tabelle: der Name, die eigenen Spalten der Liste, **Nicht mehr anbieten**, dann zwei Symbole pro Zeile, **Übersetzen** und **Löschen**.

- **Element hinzufügen** unter der Tabelle fügt am Ende der Liste eine Zeile hinzu, mit dem Cursor in ihrem Namen. Ihr Namensfeld zeigt ein Beispiel für diese Liste. Eine leer gelassene Zeile wird nie gespeichert.
- Die Werte behalten die angezeigte Reihenfolge. Kadratis sortiert sie nicht.
- Ein eingegebener Name wird kurz nach Ihrem letzten Tastenanschlag gespeichert, oder wenn Sie das Feld verlassen. Ein gesetztes Häkchen oder eine Auswahl wird sofort gespeichert. Nichts wird gespeichert, solange eine Zeile der Liste gegen eine der folgenden Regeln verstößt.

Administrationszonen, Verbindungstypen, Domänen und Subnetze haben ein eigenes Layout: Ihre Schaltfläche **Element hinzufügen** steht über der Tabelle. Sie fügt die Zeile am Ende der Liste ein, mit dem Cursor darin. Ausnahme sind die Administrationszonen: Dort beginnt eine neue Zone oben.

Bei langen Listen (mehr als 25 Zeilen) virtualisiert die Tabelle die Zeilen: Sie zeigt etwa 20 Zeilen gleichzeitig, mit flüssigem Scrollen und fixierten Spaltenköpfen.

### Namen sind die Identität eines Werts

Sie sehen und tippen ausschließlich **Namen**. Kadratis erzeugt beim ersten Speichern eines Werts einen stabilen internen Code aus dem Namen und behält ihn dauerhaft bei, sodass das Umbenennen eines Werts nie die Datensätze beschädigt, die ihn verwenden. Der Code ist für Integratoren in der API sichtbar und kann in importierten Dateien verwendet werden; der Export schreibt jedoch Namen, und der Import akzeptiert beides.

Weil Namen die Werte identifizieren, gelten innerhalb einer Liste einige Regeln:

- jeder Wert braucht einen Namen (ein Sternchen kennzeichnet die Spalte **Name**), und zwei Werte dürfen nicht denselben Namen tragen (Groß- und Kleinschreibung spielt keine Rolle), in der Liste oder so, wie sie in Ihrer Sprache angezeigt werden;
- ein Name darf nicht mit dem internen Code eines anderen Werts derselben Liste identisch sein;
- Namen von **Zugriffsmethoden** dürfen weder Komma noch Semikolon enthalten, da der Export sie in einer einzigen, durch Kommas getrennten Zelle auflistet.

Eine Liste, die gegen eine dieser Regeln verstößt, wird erst gespeichert, wenn Sie den Fehler behoben haben; die Zeile zeigt an, was nicht stimmt.

### Einen Wert entfernen

**Löschen** (das Papierkorbsymbol) löscht ohne Rückfrage einen Wert, den nichts verwendet. Wenn noch Datensätze auf den Wert verweisen, zeigt Kadratis an, wie viele (Anwendungen, Assets, Schnittstellen, Verbindungen, Standorte, Vorfälle, Subnetze…), mit einem Link zur gefilterten Liste, sofern sich eine Liste nach diesem Feld filtern lässt, und bietet stattdessen **Nicht mehr anbieten** an: Der Wert bleibt bei den Datensätzen sichtbar, die ihn bereits verwenden, und wird für neue nicht mehr vorgeschlagen. Die Schaltfläche **Nicht mehr anbieten** des Dialogs setzt das Häkchen für Sie. Ein verwendeter Wert wird nie entfernt, auch nicht über die API.

Integrierte Werte, die Kadratis selbst verwaltet (die vier Lebenszyklus-Status, die Domänen Workgroup und N/A), können weder bearbeitet noch entfernt werden: Sie sind als **Integriert** gekennzeichnet. Standard-Netzwerkzonen und -Asset-Typen sowie der Cloud-Anbieter Sonstiges können bearbeitet und zurückgezogen, aber nicht entfernt werden: Der Server würde sie wieder hinzufügen.

### Ihre Werte übersetzen

Eine Liste zeigt jeden Wert unter dem Namen, den der Rest von Kadratis in Ihrer Sprache anzeigt: die Übersetzung, die Ihr Arbeitsbereich für diese Sprache eingegeben hat, sonst die mit Kadratis gelieferte Übersetzung, solange der Wert seinen gelieferten Namen behält, sonst den Namen selbst. Ein deutschsprachiger Benutzer sieht die gelieferte Netzwerkzone Guest als „Gäste“, hier wie in den Datensätzen.

Ein neuer Name, den Sie in der Liste eingeben, wird zum Basisnamen des Werts. Die Übersetzung, die Ihr Arbeitsbereich für Ihre Sprache eingegeben hat, entfällt, damit das Feld behält, was Sie eingegeben haben; die Übersetzungen der anderen Sprachen bleiben. Geben Sie für einen gelieferten Wert den Namen ein, den Kadratis in Ihrer Sprache liefert, erhält der Wert seinen gelieferten Namen und seine gelieferten Übersetzungen zurück.

Das Symbol **Übersetzen** öffnet die Sprachen des Werts: den Basisnamen (und bei Klassifizierungsstufen die Beschreibung) sowie ein Feld pro Sprache. Ein leer gelassenes Feld zeigt, was stattdessen angezeigt wird, eine gelieferte Übersetzung eingeschlossen. Das Symbol ist hervorgehoben, wenn der Wert eine Übersetzung hat, die Ihr Arbeitsbereich eingegeben hat. Das Speichern von Übersetzungen ändert den Basistext nie, und ein übersetzter Name kann in CSV-Dateien und in der API wie der Name selbst verwendet werden; deshalb darf er keinen anderen Wert der Liste duplizieren.

### Standardlisten wiederherstellen

**Standardlisten wiederherstellen** in der Kopfzeile des Tabs **Listen** setzt die Listen nach einer Bestätigung auf die mit Kadratis gelieferten Werte zurück. Dafür ist `settings:admin` nötig. Noch nicht gespeicherte Änderungen werden zuerst gespeichert.

- Jeder gelieferte Wert kehrt mit seinem gelieferten Namen und seinen Übersetzungen zurück und wird wieder angeboten, auch wenn Sie ihn umbenannt oder zurückgezogen hatten; ein gelieferter Wert, den Sie gelöscht haben, kehrt ebenfalls zurück, außer ein Wert, den Sie behalten, trägt jetzt seinen Namen. Die Übersetzungen, die Ihr Arbeitsbereich dafür eingegeben hat, entfallen.
- Ein Wert, den Sie hinzugefügt haben, bleibt erhalten, wenn Datensätze ihn verwenden, unverändert, nach den gelieferten Werten und in seiner bisherigen Reihenfolge. Ein hinzugefügter Wert, den nichts verwendet, entfällt. Subnetze bleiben nur, wenn Assets sie verwenden, zusammen mit den Netzwerkzonen, die sie brauchen.
- Eine hinzugefügte und erhaltene Administrationszone kommt ans Ende, als die am wenigsten sensible: Verschieben Sie sie an ihren Platz. Eine erhaltene Klassifizierungsstufe wird die am wenigsten kritische, eine erhaltene Wiederherstellungswelle die letzte.
- Ein gelieferter Name, der mit einem erhaltenen Wert kollidieren würde, bleibt, wie er jetzt ist.

Datensätze ändern sich nie: Sie behalten ihre Werte.

---

## Standorte

### Cloud-Anbieter

Cloud-Anbieter, die von Servern und Standorten verwendet werden (z. B. AWS, Azure, GCP).

Sonstiges ist ein integrierter Wert. Er kann zurückgezogen, aber nicht entfernt werden, und eine gespeicherte Liste, die ihn auslässt, erhält ihn zurück. AWS, Azure und GCP können entfernt werden.

**Spalten**: Name, Nicht mehr anbieten

**Verwendung**:
- Assets-Arbeitsbereich → Eigenschaftenbereich → **Cloud-Anbieter** (schreibgeschützt, vom Standort abgeleitet)
- Standorte-Arbeitsbereich → Reiter Übersicht → **Cloud-Anbieter** (wenn der Hosting-Typ Cloud ist)

### Hosting-Typen

Wo Standorte und Technologien gehostet werden. Standardwerte: On-Premise, Colocation, Public Cloud, Private Cloud, SaaS.

**Spalten**: Name, Kategorie (**Vor Ort / Colocation** oder **Cloud / SaaS**), Nicht mehr anbieten

**Verwendung**:
- Standorte-Arbeitsbereich → Reiter Übersicht → Feld **Hosting-Typ**
- Technologie-Arbeitsbereich → Eigenschaftenbereich → **Hosting-Typ**, und das Fenster für neue Technologien. Siehe [Technologien](technologies.md#hosting-typ).

Ein Typ, den eine Technologie nutzt, kann nicht entfernt werden: Setzen Sie stattdessen das Häkchen bei **Nicht mehr anbieten**.

Die Kategorie bestimmt, welche Felder beim Bearbeiten eines Standorts erscheinen:
- **Vor Ort / Colocation** zeigt die Felder Betreiberunternehmen und Rechenzentrum
- **Cloud / SaaS** zeigt die Felder Cloud-Anbieter, Region und Zusätzliche Informationen

---

## Server und Verbindungen

### Administrationszonen

Die Zonen Ihres Administrationsmodells. Kadratis liefert die drei Tiers des Tier-Modells der Administration mit, einer anerkannten Praxis:

- **Tier 0 (Vertrauenskern)**: Verzeichnisdienste wie Active Directory oder Entra ID, PKI, Werkzeuge zur Identitätsverwaltung und die Systeme, auf denen sie laufen.
- **Tier 1 (Server und Anwendungen)**: Geschäftsserver, Anwendungen, Datenbanken und Middleware.
- **Tier 2 (Arbeitsplätze)**: Arbeitsplätze und Geräte der Benutzer.

Benennen Sie sie um, ergänzen Sie eigene oder markieren Sie sie als **Nicht mehr anbieten**, passend zu Ihrer Administrationsrichtlinie oder Ihrem Modell für privilegierten Zugriff. Die drei Tiers erscheinen, solange die Liste nie gespeichert wurde. Sobald sie gespeichert wurde, auch leer, fügt Kadratis sie nicht mehr hinzu: Legen Sie sie bei Bedarf selbst an.

Die Reihenfolge der Liste zählt: Die erste Zone ist die sensibelste. Ziehen Sie eine Zeile an ihrem Griff, um sie zu verschieben. Eine neue Zone wird oben eingefügt: Verschieben Sie sie danach an ihren Platz. Die Seite [Administrationszonen](administration-view.md) zeigt die Zonen in dieser Reihenfolge und prüft die Assets gegen die erste Zone, die noch angeboten wird.

**Spalten**: Name, Administratorgruppe, Beschreibung, Nicht mehr anbieten

- **Administratorgruppe**: die Verzeichnisgruppe oder das Team, das die Zone verwaltet, zum Beispiel „Domänen-Admins“.

**Verwendung**:
- Assets-Arbeitsbereich → Eigenschaftenbereich → **Administrationszone**
- Technologie-Arbeitsbereich → Eigenschaftenbereich → **Administrationszone**, für die Technologien der Familie **Verzeichnis und Identität**
- **IT-Landschaft > Administrationszonen**, die die Assets und Verzeichnisdienste jeder Zone zählt, die Kontrollpunkte ausführt und Zonen für viele Assets in einem Schritt zuordnet. Siehe [Administrationszonen](administration-view.md).

Eine nicht mehr angebotene Zone bleibt bei den Technologien und Assets, die ihr bereits zugeordnet sind.

### Technologiefamilien

Die Art jeder Technologie: Datenbank, Hypervisor, Verzeichnis und Identität usw. Die Technologieliste und die Berichte gruppieren Technologien nach Familie, und die Seite [Administrationszonen](administration-view.md) findet die Verzeichnisdienste über die Familie **Verzeichnis und Identität**.

**Spalten**: Name, Nicht mehr anbieten

**Verwendung**:
- Technologie-Arbeitsbereich → Kopfzeile und Eigenschaftenbereich → **Familie**, und das Fenster für neue Technologien

Die Familie **Betriebssystem** kennzeichnet die Betriebssysteme: Eine Technologie dieser Familie, die einem Server ohne Betriebssystem hinzugefügt wird, wird zu seinem Betriebssystem. Siehe [Technologien](technologies.md#betriebssysteme).

Die Standardliste hat eine Familie **Netzwerk** für Switches, Router und Load Balancer und eine Familie **Sicherheit** für Firewalls und VPN-Gateways. **Sicherheit** hieß früher **Netzwerk und Sicherheit**. Eine Liste, die Sie bereits geändert haben, behält ihre Familien und deren Namen. Ein aus dem Katalog übernommenes Netzwerkprodukt kommt dann in die frühere Familie **Netzwerk und Sicherheit**.

### Verbindungstypen

Ein zweistufiger Katalog (Kategorie und Eintrag) von Verbindungsprotokollen, mit typischen Ports.

**Spalten**: Kategorie (z. B. Datenbank, Fernzugriff), Name, Typische Ports, Nicht mehr anbieten

**Verwendung**:
- Verbindungen-Arbeitsbereich → Auswahl **Verbindungstyp**

Das Feld **Typische Ports** ist Freitext: Sie können einzelne Ports (`443`), Listen (`80, 443`), Bereiche (`9101-9103`) oder Platzhalter wie `multiple` oder `specify` eingeben.

Zu den Standardkategorien gehören: Anwendung, Authentifizierung, Backup, Datenbank, E-Mail, Dateifreigabe, Dateiübertragung, Messaging, Monitoring, Netzwerkdienste, Fernzugriff, Replikation, Speicher, VPN / Tunnel, Generisch.

### Domänen

Active-Directory- oder DNS-Domänen für Assets. Integrierte Einträge können nicht geändert werden. Das DNS-Suffix dient zur Berechnung des vollqualifizierten Domänennamens (FQDN) jedes Assets.

**Spalten**: Name, DNS-Suffix, Gesamtstruktur, Anzahl der Konten, Anzahl der Computer, Vertrauensstellungen, Nicht mehr anbieten

- **Gesamtstruktur**: die Active Directory-Gesamtstruktur der Domäne, wie in „Active Directory-Domänen und -Vertrauensstellungen“ angezeigt.
- **Anzahl der Konten** und **Anzahl der Computer**: die Anzahl der Benutzerkonten und Computer der Domäne, wie in „Active Directory-Benutzer und -Computer“ oder durch eine Zählung der Benutzer- und Computerobjekte der Domäne ermittelt. Nur ganze Zahlen.

Fahren Sie mit der Maus über die Spaltenköpfe **Gesamtstruktur**, **Anzahl der Konten** und **Anzahl der Computer**, um zu sehen, wo Sie jeden Wert finden.
- **Vertrauensstellungen**: Die Schaltfläche zeigt, wie viele Vertrauensstellungen die Domäne hat. Ein Klick listet die anderen Domänen, mit denen sie eine Vertrauensstellung hat, wie in „Active Directory-Domänen und -Vertrauensstellungen“ angezeigt. **Vertrauenswürdige Domäne hinzufügen** fügt eine hinzu; wählen Sie ihre **Richtung**: **ausgehend** (diese Domäne vertraut der anderen, deren Konten auf ihre Ressourcen zugreifen können), **eingehend** (die andere Domäne vertraut dieser) oder **bidirektional** (beides). Der Dialog zeigt außerdem, nur lesend, die Vertrauensstellungen, die in anderen Domänen zu dieser erfasst sind. Die Schaltfläche erscheint, sobald die Domäne gespeichert ist, und braucht mindestens eine weitere Domäne in der Liste.

**Verwendung**:
- Assets-Arbeitsbereich → Reiter Netzwerk → Auswahl **Domäne**
- Assets-Arbeitsbereich → Reiter Netzwerk → **FQDN** (automatisch aus Hostname + DNS-Suffix berechnet)
- **IT-Landschaft > Administrationszonen**: Domänen nach Gesamtstruktur gruppiert, mit ihren Vertrauensstellungen, Anzahlen und Domänencontrollern. Siehe [Administrationszonen](administration-view.md#verzeichnisdienste-und-domanen).

**Systemeinträge** (können weder geändert noch gelöscht werden):
- **Workgroup**: Für eigenständige Assets, die keiner Domäne beigetreten sind
- **N/A**: Für Asset-Typen, bei denen eine Domänenmitgliedschaft nicht zutrifft (z. B. Netzwerkgeräte, Racks)

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
- Assets-Arbeitsbereich → Reiter Netzwerk → Bereich **IP-Adressen** → Dropdown **Typ**

Assets können mehrere IP-Adressen mit jeweils eigenem Typ haben. Ein physischer Server kann zum Beispiel haben:
- Eine **Host**-IP für den Anwendungsverkehr
- Eine **IPMI**-IP für die Out-of-Band-Verwaltung
- Eine **iSCSI**-IP für die Anbindung an das Speichernetzwerk

### Netzwerkzonen

Netzwerkzonen zur Einordnung von Subnetzen und zur Beschreibung der Konnektivität (z. B. LAN, DMZ, Industrie-LAN, WLAN, Public Cloud, Gast, Management, Speicher, VPN).

**Spalten**: Name, Nicht mehr anbieten

**Verwendung**:
- Subnetzliste → Auswahl **Netzwerkzone**
- Assets-Arbeitsbereich → Reiter Netzwerk → **Netzwerkzone** (automatisch ausgefüllt, wenn ein Subnetz ausgewählt wird)

### Subnetze

Definieren Sie Subnetze in CIDR-Notation, mit optionaler VLAN-Zuordnung. Jedes Subnetz gehört zu einer Netzwerkzone und zu einem Standort.

**Spalten**: Standort, CIDR, VLAN (1-4094), Netzwerkzone, Beschreibung, Nicht mehr anbieten

**Verwendung**:
- Assets-Arbeitsbereich → Reiter Netzwerk → Auswahl **Subnetz**

**Validierungsregeln**:
- CIDR muss eine gültige IPv4-Notation sein (z. B. `192.168.1.0/24`)
- VLAN-Nummern müssen zwischen 1 und 4094 liegen
- CIDR und VLAN-Nummern sind pro Standort eindeutig (dieselben Werte können an verschiedenen Standorten vorkommen)

**Automatisches Ausfüllen**: Wenn Sie bei einem Asset ein Subnetz auswählen, wird die Netzwerkzone automatisch aus der Konfiguration des Subnetzes übernommen.

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
- Assets-Arbeitsbereich → Eigenschaftenbereich → Feld **Asset-Typ**

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

**Integrierte Status**: Vorgeschlagen, Aktiv, Veraltet und Außer Betrieb sind Texte in Ihrer Sprache, als **Integriert** gekennzeichnet. Sie können weder umbenannt noch zurückgezogen noch gelöscht werden. Die Status, die Sie hinzufügen, werden wie jeder andere Wert bearbeitet.

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

- **Bestehende Datensätze behalten ihren Wert**: Ein Umbenennen ändert nur die Anzeige, nicht die zugrunde liegenden Daten.
- **Nicht mehr angebotene Werte** (Häkchen bei **Nicht mehr anbieten**):
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
| **Administrationszonen** | Assets (Eigenschaftenbereich → Administrationszone), Technologien der Familie Verzeichnis und Identität (Eigenschaftenbereich → Administrationszone), Seite Administrationszonen |
| **Cloud-Anbieter** | Assets (Anbieter), Standorte (Cloud-Anbieter) |
| **Verbindungstypen** | Verbindungen (Verbindungstyp) |
| **Domänen** | Assets (Reiter Netzwerk → Domäne, FQDN), Seite Administrationszonen |
| **Entitäten** | Verbindungen (Quell-/Zielentität), Verbindungskarte (Platzierung nach Graph-Ebene) |
| **Hosting-Typen** | Standorte (Übersicht), Technologien (Hosting-Typ) |
| **Integrationsmuster** | Schnittstellenabschnitte (Muster) |
| **Authentifizierungsmodi für Schnittstellen** | Schnittstellenbindungen (Authentifizierungsmodus) |
| **Datenkategorien für Schnittstellen** | Schnittstellen (Datenkategorie) |
| **Datenformate für Schnittstellen** | Schnittstellenabschnitte (Format) |
| **Schnittstellenprotokolle** | Schnittstellenbindungen (Protokoll) |
| **Auslösertypen für Schnittstellen** | Schnittstellenabschnitte (Auslöser) |
| **Vorfallkategorien** | Vorfälle (Kategorie) |
| **IP-Adresstypen** | Assets (Reiter Netzwerk → IP-Adressen → Typ) |
| **Lebenszyklus-Status** | Anwendungen, App-Instanzen, Schnittstellen, Bindungen, Assets |
| **Netzwerkzonen** | Subnetze (Netzwerkzone), Assets (automatisch aus dem Subnetz) |
| **Subnetze** | Assets (Reiter Netzwerk → IP-Adressen → Subnetzauswahl) |
| **Serverrollen** | Anwendungen → Reiter Server (Rolle beim Verknüpfen eines Assets mit der Anwendung), Verbindungskarte (Platzierung nach Graph-Ebene) |
| **Asset-Typen** | Assets (Eigenschaftenbereich → Asset-Typ) |
| **Technologiefamilien** | Technologien (Familie), Seite Administrationszonen (Verzeichnisdienste) |

---

## Tipps

- **Namen an Ihre Terminologie anpassen**: Prüfen Sie die Standardwerte und benennen Sie sie so um, wie Ihre Organisation über diese Begriffe spricht. Datensätze behalten ihre Verknüpfung mit dem Wert; nur der Name ändert sich.
- **Schrittweise auslaufen lassen**: Wenn Sie sich von einem Wert verabschieden, setzen Sie das Häkchen bei **Nicht mehr anbieten**, statt ihn zu entfernen. So bleiben historische Daten intakt, und Benutzer werden zu den neuen Optionen gelenkt.
- **Datenklassen mit der Sicherheitsabteilung abstimmen**: Änderungen an Datenklassen sollten mit Ihren Richtlinien zur Informationssicherheit übereinstimmen. Sprechen Sie mit der Compliance, bevor Sie Klassifizierungsstufen hinzufügen oder umbenennen.
- **Typische Ports als Dokumentation nutzen**: Das Feld **Typische Ports** bei den Verbindungstypen dient der Information. Füllen Sie es aus, damit Benutzer wissen, welche Ports ein Verbindungstyp üblicherweise verwendet.
- **Kartenlesbarkeit mit Ebenen optimieren**: Richten Sie die Graph-Ebenen von Entitäten und Serverrollen an Ihren Architekturschichten aus (Edge, Anwendung, Daten), um übersichtlichere Layouts in der Verbindungskarte zu erhalten.
