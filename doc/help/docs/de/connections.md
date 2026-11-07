# Verbindungen

Verbindungen dokumentieren die Netzwerkpfade auf Infrastrukturebene zwischen Servern und Entitäten. Während Schnittstellen logische Datenflüsse zwischen Anwendungen beschreiben, beschreiben Verbindungen die physischen Netzwerkrouten: welche Server kommunizieren, über welche Protokolle und Ports.

## Erste Schritte

Navigieren Sie zu **IT-Landschaft > Verbindungen**, um Ihr Verbindungsverzeichnis zu sehen. So erstellen Sie eine Verbindung:

1. Klicken Sie auf **Verbindung hinzufügen**. Die Seite der Verbindung öffnet sich mit einem leeren Titel in der Kopfzeile. Der Rest der Seite ist abgeblendet.
2. Geben Sie einen beschreibenden Namen ein.
3. Drücken Sie die Eingabetaste oder klicken Sie außerhalb des Titels. KANAP erstellt die Verbindung sofort, als Server zu Server, ohne Protokolle und Endpunkte. Ihre Referenz (`CONN-12`) erscheint und alle Reiter öffnen sich.

Danach speichert jedes Feld für sich. Eine Verbindung braucht:
  - **Topologie**: Server zu Server oder Multi-Server
  - **Endpunkte**: Eine Quelle und ein Ziel für Server zu Server (jeweils ein Server, ein Cluster oder eine Entität) oder mindestens zwei Server für Multi-Server
  - **Protokolle**: Mindestens ein Netzwerkprotokoll

Drücken Sie Escape im leeren Titel, um die Seite zu verlassen, ohne etwas zu erstellen.

**Tipp**: Verbindungen können mit Schnittstellen-Bindungen verknüpft werden, um zu zeigen, welche Infrastruktur jede Anwendungsintegration unterstützt.

### Erstellen oder abbrechen { #cancelling-a-creation }

Solange die Verbindung erstellt wird, zeigt ihre Kopfzeile **Erstellen** und **Abbrechen**. Beide bleiben, bis Sie die Verbindung verlassen.

- **Erstellen** prüft, ob die Verbindung mindestens ein Protokoll und beide Endpunkte hat, oder zwei Server bei einer Multi-Server-Verbindung. Eine Meldung nennt, was fehlt, und das erste fehlende Feld erhält den Fokus. Fehlt nichts, behält KANAP die Verbindung und schließt sie. Sie kehren dorthin zurück, wo Sie begonnen haben
- **Abbrechen** löscht die Verbindung. Wenn Sie mehr als den Namen eingegeben haben, nennt eine Bestätigung, was gelöscht wird. Sie können Ihre eigene Erstellung auch ohne das Recht zum Löschen von Verbindungen abbrechen

Verlassen Sie die Verbindung auf andere Weise, solange etwas fehlt, fragt KANAP nach. **Vervollständigen** lässt Sie auf der Verbindung, im ersten fehlenden Feld. **Löschen** löscht die Verbindung.

---

## Arbeiten mit der Liste

Die Liste gibt Ihnen einen filterbaren Überblick über jede Verbindung in Ihrem Verzeichnis.

**Standardspalten**:
  - **Referenz**: Die Referenz der Verbindung, zum Beispiel `CONN-12` (klicken, um Arbeitsbereich zu öffnen)
  - **Name**: Verbindungsname (klicken, um Arbeitsbereich zu öffnen)
  - **Topologie**: Server zu Server oder Multi-Server
  - **Quelle** / **Ziel**: Die verbundenen Endpunkte
  - **Protokolle**: Netzwerkprotokolle als Chips angezeigt
  - **Kritikalität**: Geschäftliche Bedeutung; kann von verknüpften Schnittstellen abgeleitet sein
  - **Datenklasse**: Datensensibilitätsstufe
  - **PII**: Ob personenbezogene Daten über diese Verbindung übertragen werden
  - **Risiko**: Manuell oder Abgeleitet (zeigt die Anzahl verknüpfter Schnittstellen)
  - **Lebenszyklus**: Aktueller Status
  - **Erstellt am**: Wann der Datensatz erstellt wurde

**Zusätzliche Spalten** (über Spaltenauswahl):
  - **Server**: Anzahl der Server in einer Multi-Server-Verbindung

**Filterung**:
  - Schnellsuche: Durchsucht Verbindungsfelder
  - Spaltenfilter: **Topologie**, **Lebenszyklus**, **Kritikalität**, **Datenklasse** und **PII** verwenden Kontrollkästchenlisten, sodass Sie mehrere Werte auf einmal wählen können. **Kritikalität** und **Datenklasse** bieten außerdem **(Leer)** für Verbindungen ohne Wert
  - **Kritikalität**, **Datenklasse** und **PII** filtern und sortieren nach dem angezeigten Wert. Bei einer abgeleiteten Verbindung ist das der Wert, der von ihren Schnittstellen übernommen wird

**Sortierung**:
  - **Kritikalität** und **Datenklasse** sortieren nach Schweregrad, in der Reihenfolge der Stufen unter [Einstufungen und Kontinuität](it-ops-settings.md#einstufungen-und-kontinuitat). Verbindungen ohne Wert stehen am Ende

**Aktionen**:
  - **Verbindung hinzufügen**: Eine neue Verbindung erstellen (erfordert `infrastructure:member`)
  - **Verbindung löschen**: Ausgewählte Verbindungen entfernen (erfordert `infrastructure:admin`). Die Hops jeder gelöschten Verbindung werden mit ihr gelöscht. Ihre Server, Schnittstellen und Dokumente bleiben erhalten; nur ihre Verknüpfungen mit der Verbindung werden entfernt. Um eine einzelne Verbindung zu löschen, öffnen Sie sie und verwenden Sie **Löschen** in ihrer Kopfzeile; dafür genügt `infrastructure:member` (siehe [Der Verbindungs-Arbeitsbereich](#der-verbindungs-arbeitsbereich)).

---

## Verbindungstypen { #connection-types }

### Server zu Server

Eine direkte Verbindung zwischen zwei Endpunkten. Jede Seite ist ein Server, ein Cluster oder eine Entität:

- **Quelle**: Wo der Datenverkehr beginnt
- **Ziel**: Wo der Datenverkehr endet
- Eine Seite trägt genau einen Server, Cluster oder eine Entität
- Quelle und Ziel können nicht dasselbe Asset sein

### Multi-Server

Eine Verbindung zwischen mehreren Servern, etwa eine Replikation zwischen Knoten oder ein Mesh. Wählen Sie mindestens zwei Server oder Cluster.

### Verbindungen auf einem Cluster { #connections-on-a-cluster }

Eine Quelle, ein Ziel, ein Server einer Multi-Server-Verbindung oder das Gerät eines Hops kann ein Cluster sein. Die Verbindung gilt dann für die Mitglieder des Clusters in Betrieb. Ein später hinzugefügtes Mitglied erhält sie ebenfalls. Ein aus dem Cluster entferntes Mitglied verliert sie. Ein ausgemustertes Mitglied erhält nichts, und ein ausgemusterter Cluster gibt nichts weiter.

Die Auswahlfelder kennzeichnen einen Cluster mit einem Symbol und listen seine Mitglieder unter seinem Namen.

Wenn Sie einen Server wählen, der zu einem Cluster gehört, fragt KANAP **Mit dem Cluster verbinden?**. **Mit dem Cluster verbinden** setzt den Cluster auf die Verbindung, für alle seine Mitglieder. **Nur diesem Server** behält den Server. KANAP fragt nicht, wenn die andere Seite bereits dieser Cluster oder eines seiner Mitglieder ist: Die Verbindung bleibt auf dem Server.

Eine Multi-Server-Liste, die einen Cluster und eines seiner Mitglieder enthält, behält nur den Cluster. Eine Meldung nennt die aus der Liste entfernten Mitglieder. Eine Liste muss mindestens zwei Server behalten.

Der Reiter [Netzwerk](assets.md#network) jedes Mitglieds listet die Verbindungen seiner Cluster, und die [Verbindungskarte](connection-map.md) zeichnet die Mitglieder eines Clusters.

---

## Der Verbindungs-Arbeitsbereich

Klicken Sie auf eine Zeile, um den Arbeitsbereich zu öffnen. Er hat drei Reiter: **Übersicht**, **Pfad** und **Verlauf** (die Änderungen an der Verbindung, siehe [Verlauf der Datensätze](record-history.md)). Der Eigenschaftenbereich rechts enthält **Lebenszyklus**, **Topologie**, **Risikomodus**, **Kritikalität**, **Datenklasse**, **Enthält PII** und **Erstellt am**. Änderungen werden automatisch gespeichert.

**Löschen**, ein Papierkorbsymbol in der Kopfzeile, löscht die Verbindung nach einer Bestätigung (`infrastructure:member`). Die Bestätigung zählt die Hops, die mit ihr gelöscht werden, und die Schnittstellen-Bindungen, von denen sie gelöst wird. Die Schnittstellen selbst bleiben.

### Übersicht

- **Beschreibung**: Warum diese Verbindung existiert und was sie überträgt
- **Endpunkte**: Quelle und Ziel oder die Server einer Multi-Server-Verbindung. Siehe [Verbindungstypen](#connection-types)
- **Protokolle**: Ein oder mehrere Netzwerkprotokolle aus Ihren Verbindungstyp-Einstellungen, mit ihren typischen Ports
- **Risikoableitung**: Im abgeleiteten Risikomodus die Schnittstellen, aus denen das Risiko stammt, mit ihrer Kritikalität, Datenklasse und PII
- **Verknüpfte Schnittstellen**: Die mit dieser Verbindung verknüpften Schnittstellen-Bindungen. **Vorhandene verknüpfen** verknüpft eine weitere

### Pfad

Der Reiter Pfad dokumentiert den Netzwerkpfad der Verbindung, Hop für Hop: Reverse Proxys, Firewalls, Load Balancer.

Jeder Hop hat:

  - Eine Funktion, zum Beispiel Firewall, Reverse Proxy oder Load Balancer
  - **Gerät**: Ein Server, ein Cluster oder eine Entität, oder nichts, wenn das Gerät nicht dokumentiert ist. Ein Server, der zu einem Cluster gehört, löst dieselbe Frage aus wie ein Endpunkt. Siehe [Verbindungen auf einem Cluster](#connections-on-a-cluster)
  - **Protokolle (überschrieben)** und **Port**: Wenn sie von der Verbindung abweichen
  - **Notizen**

**Hop hinzufügen** fügt einen Hop am Ende an. Die Pfeile ordnen die Hops neu, der Papierkorb entfernt einen. Jede Änderung wird sofort gespeichert.

### Risiko

**Risikomodus**, im Eigenschaftenbereich:

  - **Manuell**: Sie legen Kritikalität, Datenklasse und PII direkt fest
  - **Abgeleitet**: Die Werte stammen aus den verknüpften Schnittstellen-Bindungen. Die Felder sind schreibgeschützt und zeigen die höchsten Werte der verknüpften Schnittstellen

**Kritikalität** verwendet die Stufen aus [Einstufungen und Kontinuität](it-ops-settings.md#einstufungen-und-kontinuitat). Die Standardstufen sind Kritisch, Hoch, Mittel und Niedrig. **Datenklasse** stammt aus Ihren Einstellungen zur Datenklassifizierung.

---

## Tipps

  - **Beginnen Sie mit kritischen Pfaden**: Dokumentieren Sie zuerst Verbindungen für Ihre wichtigsten Anwendungen, dann arbeiten Sie sich nach außen vor.
  - **Verwenden Sie den abgeleiteten Risikomodus**: Lassen Sie das System die Kritikalität aus den Schnittstellen berechnen, die jede Verbindung nutzen: das spart Aufwand und bleibt aktuell, wenn sich Schnittstellen ändern.
  - **Mit Schnittstellen verknüpfen**: Das Verbinden Ihrer Infrastruktur mit Schnittstellen-Bindungen gibt Ihnen durchgängige Nachverfolgbarkeit von Anwendungsdatenflüssen bis zu Netzwerkrouten.
  - **Protokolle genau dokumentieren**: Gute Protokolldaten machen Firewall-Regelprüfungen und Sicherheitsaudits erheblich einfacher.
