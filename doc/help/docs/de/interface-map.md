# Schnittstellenkarte

Die Schnittstellenkarte ist eine interaktive Visualisierung Ihrer Anwendungsintegrationslandschaft. Anwendungen erscheinen als Knoten und Schnittstellen als verbindende Kanten und geben Ihnen einen Überblick darüber, wie Daten für eine bestimmte Umgebung über Ihre Systeme fließen.

## Wo Sie es finden

Navigieren Sie zu **IT-Landschaft > Schnittstellenkarte**, um die Visualisierung zu öffnen.

**Berechtigungen**: Sie benötigen mindestens `applications:reader`, um die Karte anzuzeigen.

---

## Die Visualisierung verstehen

Die Karte verwendet ein kraftgerichtetes Graph-Layout, in dem:

- **Knoten** Anwendungen darstellen
- **Kanten** Schnittstellen zwischen Anwendungen darstellen
- **Kantenbeschriftungen** die Schnittstellen-ID auf jeder Verbindung anzeigen
- **Knotengröße** widerspiegelt, wie viele Schnittstellen die Anwendung berühren

### Geschäftliche vs. technische Ansicht

Wechseln Sie zwischen den beiden Ansichtsmodi mit dem Schalter **Middleware anzeigen** in der Symbolleiste.

**Geschäftliche Ansicht** (Standard, Schalter aus):

- Blendet Middleware-Anwendungen aus
- Zeigt direkte Quell-zu-Ziel-Beziehungen
- Am besten geeignet, um geschäftliche Datenflüsse zu verstehen

**Technische Ansicht** (Schalter ein):

- Zeigt Middleware-Plattformen als Zwischenknoten (als Rauten gerendert)
- Erweitert jede Schnittstelle in ihren tatsächlichen Datenpfad (Quelle -> Middleware -> Ziel)
- Am besten geeignet, um die technische Architektur zu verstehen

Eine kurze Beschriftung unter der Seitenkopfzeile erinnert Sie daran, welche Ansicht aktiv ist.

---

## Filter

Alle Filter befinden sich in der Symbolleiste über der Karte.

### Umgebung

Filtern Sie Schnittstellen nach Bereitstellungsumgebung:

- Production, Pre-Prod, QA, Test, Development, Sandbox

Der Standard ist **Production**. Bindungen, die im Seitenpanel angezeigt werden, und die verknüpften Infrastrukturverbindungen spiegeln immer die ausgewählte Umgebung wider.

### Lebenszyklus

Mehrfachauswahl-Filter für den Schnittstellen-Lebenszyklus-Status (Aktiv, Geplant, Veraltet usw.). Standardmäßig auf **Aktiv** eingestellt.

### Anwendungen

Konzentrieren Sie die Karte auf bestimmte Anwendungen oder Dienste:

1. Klicken Sie auf das Dropdown **Anwendungen**
2. Wählen Sie eine oder mehrere Optionen aus (gruppiert unter **Anwendungen** und **Infrastrukturdienste**)
3. Die Karte filtert, um nur Schnittstellen anzuzeigen, die mit Ihrer Auswahl verbunden sind

Wenn Sie hier mindestens eine Anwendung auswählen, wechselt der Filter **Tiefe** automatisch von **Alle** zu **1**, sodass Sie nur die unmittelbare Nachbarschaft sehen.

### Tiefe

Begrenzen Sie, wie viele Hops von den ausgewählten Anwendungen angezeigt werden sollen:

- **Alle**: Jeden verbundenen Knoten anzeigen (kein Limit)
- **1-5**: Nur Knoten innerhalb von N Hops der ausgewählten Anwendungen anzeigen

Middleware-Knoten zählen nicht als Hop. Der Tiefenzähler wird nur erhöht, wenn ein primärer Anwendungsknoten durchlaufen wird.

Dieser Filter wird nur wirksam, wenn Sie mindestens eine Anwendung ausgewählt haben; ohne Auswahl ist der Wert auf **Alle** gesperrt.

---

## Graph-Steuerelemente

Das Steuerpanel auf der linken Seite der Karte bietet diese Werkzeuge:

| Symbol | Aktion | Beschreibung |
|------|--------|-------------|
| Pause / Wiedergabe | **Einfrieren / Auftauen** | Force-Simulation pausieren, damit Sie Knoten manuell positionieren können |
| Fadenkreuz | **Auto-Zentrieren** | Automatisches Zentrieren beim Auswählen von Knoten umschalten (hervorgehoben, wenn aktiviert) |
| Zoom + | **Vergrößern** | Zoom-Stufe erhöhen |
| Zoom - | **Verkleinern** | Zoom-Stufe verringern |
| Raster | **Am Raster ausrichten** | Alle Knoten an einem Raster ausrichten für sauberere Layouts |
| SVG | **SVG exportieren** | Aktuelle Ansicht als Vektorbild herunterladen |
| PNG | **PNG exportieren** | Aktuelle Ansicht als Rasterbild herunterladen |

Die Schaltflächen Einfrieren und Auto-Zentrieren ändern ihre Farbe, wenn sie aktiv sind, sodass Sie auf einen Blick erkennen können, ob sie ein- oder ausgeschaltet sind. Sie können auch mit dem Mausrad zoomen und durch Klicken und Ziehen des Hintergrunds verschieben.

---

## Mit der Karte interagieren

### Knoten auswählen

Klicken Sie auf einen Anwendungsknoten, um seine Verbindungen hervorzuheben und ein Detail-Panel auf der rechten Seite zu öffnen.

### Kanten auswählen

Klicken Sie auf eine Schnittstellenkante, um Schnittstellendetails im Seitenpanel zu sehen. Kanten haben einen breiteren unsichtbaren Trefferbereich, sodass Sie die Linie nicht präzise anklicken müssen.

### Knoten ziehen

Ziehen Sie einen beliebigen Knoten, um ihn manuell neu zu positionieren. Während die Simulation läuft, passt sich das Layout weiterhin um den verschobenen Knoten an. Wenn die Simulation eingefroren ist, bleibt der Knoten genau dort, wo Sie ihn platzieren.

### Auswahl löschen

Klicken Sie auf den leeren Hintergrund der Karte (oder auf **Schließen** im Seitenpanel), um das Detail-Panel zu schließen.

### Deep Linking

Die Karte unterstützt URL-Parameter für die gemeinsame Nutzung bestimmter Ansichten:

| Parameter | Beschreibung | Beispiel |
|-----------|-------------|---------|
| `environment` | Eine Umgebung vorab auswählen | `prod`, `dev` |
| `lifecycles` | Lebenszyklus-Filter vorab auswählen (komma-getrennt) | `active,planned` |
| `focusInterfaceId` | Eine bestimmte Schnittstelle hervorheben | UUID |
| `rootIds` | Anwendungen zur Fokussierung vorab auswählen (komma-getrennt) | UUIDs |
| `depth` | Das Tiefenlimit festlegen | `1`, `2`, `all` |

**Beispiel**: `/it/interface-map?environment=prod&rootIds=abc123&depth=2`

---

## Das Detail-Panel

Wenn Sie einen Knoten oder eine Kante auswählen, öffnet sich ein Seitenpanel auf der rechten Seite mit Details.

### Anwendungs-Panel

- **Beschreibung**: Was die Anwendung tut
- **Herausgeber**: Software-Herausgeber
- **Kritikalität**: Geschäftskritisch, Hoch, Mittel oder Niedrig
- **Server**: Server, die diese App hosten, gruppiert nach Umgebung. Klicken Sie auf einen Servernamen, um seinen Arbeitsbereich zu öffnen.
- **Business-Verantwortliche** und **IT-Verantwortliche**: Verantwortliche Kontakte
- **Support-Informationen**: Support-Kontakte mit ihren Rollen. Klicken Sie auf einen Kontaktnamen, um zum Reiter Technisch der Anwendung zu navigieren.
- **Anwendung bearbeiten**: Öffnet den Anwendungs-Arbeitsbereich

### Schnittstellen-Panel

Für die ausgewählte Schnittstelle und die aktuelle Umgebung:

- **Kritikalität**, **Route**, **Anzahl der Bindungen**, **Via Middleware** (ja/nein)
- **Endpunkte**: Für jede Bindung in der aktiven Umgebung wird Quell-App -> Ziel-App, Leg-Typ, Job-Name, Quellendpunkt und Zielendpunkt angezeigt
- **Infra-Verbindungen**: Infrastrukturverbindungen, die für die aktuelle Umgebung mit dieser Schnittstelle verknüpft sind. Jede Karte zeigt Quelle, Ziel, Protokolle und die Umgebung / den Leg-Typ der Bindung. Von der Karte aus können Sie:
  - Auf **Bearbeiten** klicken, um den Verbindungs-Arbeitsbereich zu öffnen
  - Auf **In Verbindungskarte anzeigen** klicken, um zur Infrastrukturtopologie zu springen, vorab fokussiert auf die Verbindung
- **Schnittstelle bearbeiten**: Öffnet den Schnittstellen-Arbeitsbereich

---

## Tipps

- **Beginnen Sie mit Production**: Wählen Sie die Prod-Umgebung, um Ihre kritischsten Integrationen zuerst zu sehen.
- **Auf bestimmte Apps konzentrieren**: Wählen Sie einige Apps im Filter Anwendungen aus und verwenden Sie Tiefe 1 oder 2, um die Nachbarschaft einer Anwendung zu erkunden, ohne die gesamte Landschaft.
- **Wechseln Sie zur technischen Ansicht**: Aktivieren Sie bei der Fehlerbehebung **Middleware anzeigen**, um den tatsächlichen Datenpfad durch Integrationsplattformen zu sehen.
- **Für die Dokumentation exportieren**: Verwenden Sie SVG, um Vektor-Architekturdiagramme zu erstellen, oder PNG, wenn Sie ein Rasterbild benötigen.
- **Ausrichten für Klarheit**: Verwenden Sie **Am Raster ausrichten** nach dem Ziehen von Knoten in Position, um sauberere, besser ausgerichtete Layouts zu erstellen.
- **Deep Link zum Teilen**: Kopieren Sie die URL nach dem Setzen von Filtern, um bestimmte Ansichten mit Kollegen zu teilen.
- **Querverweis mit der Verbindungskarte**: Verwenden Sie **In Verbindungskarte anzeigen** im Bereich Infra-Verbindungen, um die zugrunde liegende Netzwerktopologie für eine ausgewählte Bindung zu sehen.
