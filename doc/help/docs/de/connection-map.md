# Verbindungskarte

Die Verbindungskarte ist eine interaktive Visualisierung Ihrer Infrastruktur-Netzwerktopologie. Server, Cluster und externe Entitäten erscheinen als Knoten; die Verbindungen zwischen ihnen sind Kanten. Verwenden Sie sie, um Abhängigkeiten zu erkunden, Verbindungspfade nachzuverfolgen und Diagramme für die Architekturdokumentation oder Sicherheitsprüfungen zu exportieren.

## Wo Sie es finden

Navigieren Sie zu **IT-Landschaft > Verbindungskarte**, um die Visualisierung zu öffnen.

**Berechtigungen**: Sie benötigen mindestens `applications:reader`, um die Karte anzuzeigen.

---

## Die Visualisierung verstehen

Die Karte verwendet ein kraftgerichtetes Graph-Layout, in dem:

- **Knoten** Server, Cluster oder externe Entitäten darstellen
- **Kanten** Verbindungen zwischen Infrastrukturkomponenten darstellen
- **Farben** den Hosting-Typ (On-Premises, Cloud) oder die Knotenart anzeigen
- **Rollenbasierte Platzierung** (standardmäßig aktiviert) das Force-Layout beibehält, aber Knoten in Top-down-Tier-Bänder schiebt

### Knotentypen

| Typ | Form | Randfarbe | Beschreibung |
|------|-------|---------------|-------------|
| **Server** | Abgerundetes Rechteck | Grün (On-Prem) oder blau (Cloud) | Einzelne Infrastruktur-Instanzen (VMs, Container usw.) |
| **Cluster** | Abgerundetes Rechteck, gestrichelter Rand | Cyan | Gruppen von Servern, die als eine einzige logische Einheit fungieren |
| **Entitäten** | Pillen- / Stadionform | Orange | Logische Endpunkte (externe Systeme, SaaS-Dienste) |

Cluster-Mitglieder erscheinen als separate Server-Knoten mit gestrichelten Indikatorlinien, die sie mit ihrem übergeordneten Cluster-Knoten verbinden.

---

## Filter

### Lebenszyklus

Mehrfachauswahl-Filter für den Verbindungs-Lebenszyklus-Status (Aktiv, Geplant, Veraltet usw.). Standardmäßig auf **Aktiv** eingestellt.

### Anwendungen und App-Umgebung

Finden Sie Server über die Anwendungen, die auf ihnen laufen:

1. Wählen Sie eine oder mehrere Anwendungen aus dem Dropdown **Anwendungen**
2. Wählen Sie Umgebungen im Dropdown **App-Umgebung** (es erscheinen nur Umgebungen, in denen die ausgewählten Apps zugewiesene Server haben)
3. Die übereinstimmenden Server werden automatisch zum Filter **Server** hinzugefügt

Dies ist nützlich, wenn Sie die Infrastrukturverbindungen für eine Anwendung sehen möchten, ohne zu wissen, auf welchen Servern sie läuft.

### Server

Wählen Sie direkt Server, Cluster oder Entitäten aus, auf die Sie sich konzentrieren möchten:

1. Klicken Sie auf das Dropdown **Server**
2. Wählen Sie Elemente aus (gruppiert nach **Entitäten**, **Cluster**, **Server**)
3. Verwenden Sie den Filter **Tiefe**, um zu steuern, wie viele Hops angezeigt werden sollen

Wenn viele Elemente ausgewählt sind, wird nur der erste Chip zusammen mit einem Chip **+N weitere** angezeigt. Klicken Sie auf **+N weitere**, um ein Popover zu öffnen, das jedes ausgewählte Element mit einem Entfernen-Symbol daneben auflistet.

### Tiefe

Begrenzen Sie, wie viele Hops von den ausgewählten Elementen angezeigt werden sollen:

- **Alle**: Jede Verbindung anzeigen (keine Tiefenfilterung)
- **0**: Nur die ausgewählten Elemente, ihre übergeordneten Cluster und direkt benachbarten Entitäten anzeigen
- **1-5**: Elemente innerhalb von N Hops der ausgewählten Wurzeln anzeigen

Die Tiefe wechselt automatisch zu **0**, wenn Sie Wurzeln über die Filter Anwendungen oder Server auswählen.

---

## Anzeigeoptionen

### Multi-Server-Verbindungen anzeigen

Schalten Sie die Sichtbarkeit von Multi-Server-Verbindungen um (Verbindungen, die mehr als zwei Server in einer Mesh-Topologie umfassen). Standardmäßig aktiviert.

### Verbindungsschichten anzeigen

Wenn aktiviert (Standard), wird jeder Leg einer mehrteiligen Verbindung als eigene Kante gerendert, sodass Sie sehen können, wie er durch Zwischenpunkte geleitet wird. Wenn deaktiviert, werden Verbindungen als einfache Quell-zu-Ziel-Kanten gerendert.

### Rollenbasierte Platzierung

Wenn aktiviert (Standard), behält die Karte ihr Force-Layout, fügt aber vertikale Tier-Führung hinzu:

- Bänder **Oben / Höher / Mitte / Unten / Ganz unten**
- **Server** verwenden die in den IT-Landschaft-Einstellungen konfigurierten Rollenzuweisungen
- **Entitäten** verwenden ihre konfigurierte **Graph-Tier** (Standard Oben)
- **Nicht zugewiesene Server** fallen auf Mitte zurück
- **Cluster** erben das Tier mit der höchsten Priorität von ihren Mitgliedern

Verwenden Sie diesen Schalter, wenn Sie eine Topologieansicht wünschen, die wie Architektur-Tiers gelesen wird (Edge-Komponenten oben, Datenspeicher unten). Die Einstellung gilt nur für die Sitzung und wird beim Neuladen der Seite zurückgesetzt.

---

## Graph-Steuerelemente

Das Steuerpanel auf der linken Seite der Karte bietet diese Werkzeuge:

| Steuerelement | Aktion | Beschreibung |
|---------|--------|-------------|
| Pause / Wiedergabe | **Einfrieren / Auftauen** | Force-Simulation pausieren, um Knoten manuell zu positionieren |
| Fadenkreuz | **Auto-Zentrieren** | Automatisches Zentrieren beim Auswählen von Knoten umschalten (hervorgehoben, wenn aktiviert) |
| Zoom + | **Vergrößern** | Zoom-Stufe erhöhen |
| Zoom - | **Verkleinern** | Zoom-Stufe verringern |
| Raster | **Am Raster ausrichten** | Alle Knoten an einem Raster ausrichten für sauberere Layouts |
| SVG | **SVG exportieren** | Aktuelle Ansicht als Vektorbild herunterladen |
| PNG | **PNG exportieren** | Aktuelle Ansicht als Rasterbild herunterladen |

Sie können auch mit dem Mausrad zoomen und durch Klicken und Ziehen des Hintergrunds verschieben.

---

## Mit der Karte interagieren

### Knoten auswählen

Klicken Sie auf einen Server- oder Cluster-Knoten, um seine Verbindungen hervorzuheben und ein Detail-Panel zu öffnen, das Folgendes zeigt:

- **Server-Typ**, **Server-Standort**, **Betriebssystem**, **Netzwerksegment**, **IP-Adresse**
- **Zugewiesene Anwendungen**: Apps, die auf diesem Server laufen, gruppiert nach Umgebung. Klicken Sie auf einen App-Namen, um sie zu öffnen.
- Schaltfläche **Server bearbeiten** oder **Cluster anzeigen**, um den Arbeitsbereich zu öffnen. **Cluster anzeigen** öffnet den Cluster auf seinem Reiter **Abhängigkeiten**, wo seine Mitglieder verwaltet werden

Klicken Sie auf einen Entitätsknoten, um seinen Typ und seine Umgebung zu sehen.

### Kanten auswählen

Klicken Sie auf eine Verbindungskante, um Folgendes zu sehen:

- **Zweck**, **Protokolle**, **Typische Ports**, **Kritikalität**
- **Topologie**: Server zu Server oder Multi-Server
- Schaltfläche **Verbindung bearbeiten**, um den Verbindungs-Arbeitsbereich zu öffnen
- Bereich **Verknüpfte Schnittstellen**, der zeigt, welche Anwendungsschnittstellen diese Verbindung verwenden. Jede verknüpfte Schnittstellen-Karte zeigt den Leg-Typ, die Umgebung, das Muster sowie Quell-/Zielendpunkte. Von dort aus können Sie:
  - Auf **Schnittstelle öffnen** klicken, um die Schnittstelle anzuzeigen
  - Auf **In Schnittstellenkarte anzeigen** klicken, um zur Schnittstelle im Kontext zu springen

### Knoten ziehen

Ziehen Sie einen beliebigen Knoten, um ihn neu zu positionieren. Während die Simulation läuft, passt sich das Layout um den verschobenen Knoten an. Wenn die Simulation eingefroren ist, bewegt das Ziehen den Knoten frei, ohne andere zu beeinflussen.

---

## Deep Linking

Die Karte unterstützt URL-Parameter für die gemeinsame Nutzung bestimmter Ansichten:

| Parameter | Beschreibung | Beispiel |
|-----------|-------------|---------|
| `lifecycles` | Lebenszyklus-Filter vorab auswählen (komma-getrennt) | `active,planned` |
| `focusConnectionId` | Eine bestimmte Verbindung hervorheben | UUID |
| `rootIds` | Server/Cluster/Entitäten zur Fokussierung vorab auswählen (komma-getrennt) | UUIDs |
| `depth` | Das Tiefenlimit festlegen | `0`, `1`, `all` |

**Beispiel**: `/it/connection-map?lifecycles=active&rootIds=abc123&depth=1`

---

## Cluster-Visualisierung

Cluster erscheinen als unterscheidbare Knoten mit einem gestrichelten cyanfarbenen Rand:

- Cluster-Mitglieder erscheinen als separate Knoten, die mit ihrem übergeordneten Cluster durch gestrichelte Indikatorlinien verbunden sind
- Bei der Filterung mit Tiefe=0 werden sowohl die ausgewählten Member-Server als auch ihre übergeordneten Cluster angezeigt
- Member-Server behalten ihre individuellen Server-zu-Server-Verbindungen zusätzlich zu den eigenen Verbindungen des Clusters

---

## Graph-Tiers konfigurieren

Sie können steuern, wo Knoten vertikal erscheinen, indem Sie Tiers in **IT-Landschaft > Einstellungen** bearbeiten:

- Liste **Server-Rollen**: Graph-Tier für jede Rolle festlegen (z. B. Web = Oben, DB = Unten)
- Liste **Entitäten**: Graph-Tier für jeden Entitätstyp festlegen (Entitäten standardmäßig auf Oben)

Tier-Änderungen werden beim nächsten Laden der Kartendaten wirksam.

---

## Tipps

- **Beginnen Sie mit Anwendungen**: Verwenden Sie die Filter Anwendungen + App-Umgebung, um Server für eine bestimmte Anwendung zu finden, ohne die Servernamen zu kennen.
- **Verwenden Sie Tiefe=0 für fokussierte Ansichten**: Wenn Sie nur die Verbindungen sehen möchten, die direkt mit bestimmten Servern verbunden sind, wählen Sie diese aus und setzen Sie die Tiefe auf 0.
- **Für Architekturdokumente exportieren**: SVG erzeugt vektorisierte Netzwerkdiagramme, die für die Dokumentation geeignet sind; PNG erzeugt ein hochauflösendes Rasterbild.
- **Schichten zur Fehlerbehebung aktivieren**: Schalten Sie **Verbindungsschichten anzeigen** ein, um genau zu sehen, wie mehrteilige Verbindungen durch Ihre Infrastruktur geleitet werden.
- **Verwenden Sie Rollen-Tiers für Architekturansichten**: Lassen Sie **Rollenbasierte Platzierung** eingeschaltet, wenn Sie geschichtete Architekturdiagramme präsentieren.
- **Querverweis mit der Schnittstellenkarte**: Verwenden Sie **In Schnittstellenkarte anzeigen** im Bereich verknüpfte Schnittstellen, um zu sehen, welche Geschäftsschnittstellen von einer bestimmten Infrastrukturverbindung abhängen.
- **Vor dem Export ausrichten und einfrieren**: Frieren Sie nach dem Positionieren der Knoten das Layout ein und verwenden Sie **Am Raster ausrichten**, um die sauberste Ausgabe zu erzielen.
