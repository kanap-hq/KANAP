# Verbindungen

Verbindungen dokumentieren die Netzwerkpfade auf Infrastrukturebene zwischen Servern und Entitäten. Während Schnittstellen logische Datenflüsse zwischen Anwendungen beschreiben, beschreiben Verbindungen die physischen Netzwerkrouten -- welche Server kommunizieren, über welche Protokolle und Ports.

## Erste Schritte

Navigieren Sie zu **IT-Landschaft > Verbindungen**, um Ihr Verbindungsverzeichnis zu sehen. Klicken Sie auf **Verbindung hinzufügen**, um Ihren ersten Eintrag zu erstellen.

**Pflichtfelder**:
  - **Verbindungs-ID**: Ein eindeutiger Identifikator (z. B. `CONN-WEB-DB-001`)
  - **Name**: Ein beschreibender Name
  - **Verbindungstyp**: Server zu Server oder Multi-Server
  - **Quelle** / **Ziel**: Eine Entität, ein Cluster oder ein Server an jedem Ende (für Server zu Server)
  - **Protokolle**: Mindestens ein Netzwerkprotokoll

**Dringend empfohlen**:
  - **Zweck**: Warum diese Verbindung existiert
  - **Lebenszyklus**: Aktueller Status

**Tipp**: Verbindungen können mit Schnittstellen-Bindungen verknüpft werden, um zu zeigen, welche Infrastruktur jede Anwendungsintegration unterstützt.

---

## Arbeiten mit der Liste

Die Liste gibt Ihnen einen filterbaren Überblick über jede Verbindung in Ihrem Verzeichnis.

**Standardspalten**:
  - **Verbindungs-ID**: Eindeutiger Identifikator (klicken, um Arbeitsbereich zu öffnen)
  - **Name**: Verbindungsname (klicken, um Arbeitsbereich zu öffnen)
  - **Topologie**: Server zu Server oder Multi-Server
  - **Quelle** / **Ziel**: Die verbundenen Endpunkte
  - **Protokolle**: Netzwerkprotokolle als Chips angezeigt
  - **Kritikalität**: Geschäftliche Bedeutung -- kann von verknüpften Schnittstellen abgeleitet sein
  - **Datenklasse**: Datensensibilitätsstufe
  - **PII**: Ob personenbezogene Daten über diese Verbindung übertragen werden
  - **Risiko**: Manuell oder Abgeleitet (zeigt die Anzahl verknüpfter Schnittstellen)
  - **Lebenszyklus**: Aktueller Status
  - **Erstellt**: Wann der Datensatz erstellt wurde

**Zusätzliche Spalten** (über Spaltenauswahl):
  - **Server**: Anzahl der Server in einer Multi-Server-Verbindung

**Filterung**:
  - Schnellsuche: Durchsucht Verbindungsfelder
  - Spaltenfilter: Topologie und Lebenszyklus (Kontrollkästchenlisten). Kritikalität, Datenklasse und PII haben keinen Spaltenfilter

**Aktionen**:
  - **Verbindung hinzufügen**: Eine neue Verbindung erstellen (erfordert `infrastructure:member`)
  - **Verbindung löschen**: Ausgewählte Verbindungen entfernen (erfordert `infrastructure:admin`)

---

## Verbindungstypen

### Server zu Server

Eine direkte Verbindung zwischen zwei bestimmten Endpunkten. Jede Seite kann ein Server, ein Cluster oder eine benannte Entität sein:

- **Quelle**: Wo der Datenverkehr seinen Ursprung hat -- wählen Sie einen Server, Cluster oder eine Entität
- **Ziel**: Wo der Datenverkehr endet -- gleiche Optionen
- Sie können nicht sowohl einen Server als auch eine Entität für dieselbe Seite auswählen; wählen Sie eine der beiden Optionen

Wenn ein Endpunkt ein Cluster ist, erinnert eine Notiz daran, dass Mitglieds-Hosts im Server-Arbeitsbereich verwaltet werden.

### Multi-Server

Eine Verbindung mit mehreren Servern (z. B. lastverteilte Cluster oder Mesh-Topologien):

- Wählen Sie mindestens zwei Server aus dem Picker **Verbundene Server**
- Verwenden Sie **Schichten**, um den Routing-Pfad zwischen ihnen zu definieren

---

## Der Verbindungs-Arbeitsbereich

Klicken Sie auf eine Zeile, um den Arbeitsbereich zu öffnen. Er hat vier Reiter: **Übersicht**, **Schichten**, **Kritikalität & Compliance** und **Verwandte Schnittstellen**.

### Übersicht

Der Reiter Übersicht erfasst Identität und Topologie der Verbindung.

**Was Sie bearbeiten können**:
  - **Verbindungs-ID**: Eindeutiger Identifikator
  - **Name**: Anzeigename
  - **Zweck**: Warum diese Verbindung existiert (Freitext)
  - **Verbindungstyp**: Server zu Server oder Multi-Server
  - **Quelle** / **Ziel**: Für Server zu Server -- wählen Sie einen Server, Cluster oder eine Entität aus einem gruppierten Dropdown
  - **Verbundene Server**: Für Multi-Server -- suchen und wählen Sie zwei oder mehr Server
  - **Protokolle**: Ein oder mehrere Netzwerkprotokolle (aus Ihren Verbindungstyp-Einstellungen)
  - **Lebenszyklus**: Aktueller Status
  - **Notizen**: Zusätzlicher Kontext

Wenn Sie Protokolle auswählen, zeigt das System deren typische Ports als Referenz an.

---

### Schichten

Der Reiter Schichten ermöglicht es Ihnen, einen geordneten Netzwerkpfad von bis zu drei Sprüngen zu definieren -- nützlich für die Dokumentation von Reverse Proxies, Firewalls oder zwischengeschaltetem Routing.

**Was jede Schicht erfasst**:
  - **Reihenfolge**: Sequenznummer (1 bis 3)
  - **Name**: Eine Bezeichnung für die Schicht (z. B. `direct`, `reverse_proxy`, `firewall`)
  - **Quelle** / **Ziel**: Eine Entität, ein Cluster oder ein Server an jedem Ende des Sprungs
  - **Protokolle**: Welche Protokolle auf dieser Schicht verwendet werden
  - **Port-Override**: Benutzerdefinierter Port, wenn er vom Protokollstandard abweicht (automatisch befüllt, wenn Sie ein Protokoll auswählen)
  - **Notizen**: Schichtspezifische Notizen

Schichten werden unabhängig vom Reiter Übersicht gespeichert. Verwenden Sie die Schaltfläche **Schichten speichern**, um Ihre Änderungen zu speichern.

**Tipp**: Sie müssen die Verbindung selbst speichern, bevor Sie Schichten hinzufügen können.

---

### Kritikalität & Compliance

Dieser Reiter steuert die Risikoklassifizierung und Datenschutzeinstellungen.

**Risikomodus**:
  - **Manuell**: Sie legen Kritikalität, Datenklasse und PII direkt fest
  - **Abgeleitet**: Werte werden aus verknüpften Schnittstellen-Bindungen aggregiert -- der Reiter zeigt die effektiven Werte und wie viele Bindungen beitragen

**Felder**:
  - **Kritikalität**: Geschäftskritisch, Hoch, Mittel oder Niedrig
  - **Datenklasse**: Aus den Datenklassifizierungseinstellungen Ihrer Organisation
  - **Enthält PII**: Ob personenbezogene Daten über die Verbindung übertragen werden

Wenn der Risikomodus auf Abgeleitet steht, werden die Felder Kritikalität, Datenklasse und PII schreibgeschützt und spiegeln die höchsten Werte aller verknüpften Schnittstellen wider.

---

### Verwandte Schnittstellen

Dieser Reiter zeigt, welche Schnittstellen-Bindungen mit dieser Verbindung verknüpft sind.

**Was Sie sehen werden**:
  - **Schnittstelle**: Name und Code, mit Kritikalitäts-/Datenklasse-/PII-Chips
  - **Umgebung**: Bindungsumgebung und Schichttyp
  - **Quell-Endpunkt** / **Ziel-Endpunkt**: Die Endpunkte der Bindung
  - **Lebenszyklus**: Schnittstellen-Lebenszyklus-Status
  - **Aktionen**: Eine Schaltfläche zur Navigation zum Schnittstellen-Arbeitsbereich

Dieser Reiter ist schreibgeschützt. Um eine Schnittstellen-Bindung mit einer Verbindung zu verknüpfen, verwenden Sie den Schnittstellen-Arbeitsbereich oder die Verbindungskarte.

---

## Tipps

  - **Beginnen Sie mit kritischen Pfaden**: Dokumentieren Sie zuerst Verbindungen für Ihre wichtigsten Anwendungen, dann arbeiten Sie sich nach außen vor.
  - **Verwenden Sie den abgeleiteten Risikomodus**: Lassen Sie das System die Kritikalität aus den Schnittstellen berechnen, die jede Verbindung nutzen -- das spart Aufwand und bleibt aktuell, wenn sich Schnittstellen ändern.
  - **Mit Schnittstellen verknüpfen**: Das Verbinden Ihrer Infrastruktur mit Schnittstellen-Bindungen gibt Ihnen durchgängige Nachverfolgbarkeit von Anwendungsdatenflüssen bis zu Netzwerkrouten.
  - **Protokolle genau dokumentieren**: Gute Protokolldaten machen Firewall-Regelprüfungen und Sicherheitsaudits erheblich einfacher.
