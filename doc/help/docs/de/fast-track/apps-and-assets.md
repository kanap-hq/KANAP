---
title: "IT Ops Schnelleinstieg: Von der Anwendung zum Server"
description: Dokumentieren Sie Ihre Anwendungslandschaft in Minuten. Ein praktischer Leitfaden von der App-Erstellung bis zur Server-Zuordnung.
---

# IT Ops Schnelleinstieg: Von der Anwendung zum Server

Dieser Leitfaden führt Sie durch die Dokumentation einer Anwendung und ihrer unterstützenden Infrastruktur: von der Erstellung des App-Eintrags bis zur Verknüpfung mit dem Server, auf dem sie gehostet wird. Er ist darauf ausgelegt, Sie schnell produktiv zu machen und deckt die wesentlichen Schritte ab, ohne Sie in Optionen zu ertränken.

!!! tip "Bevorzugen Sie eine einseitige Zusammenfassung? :material-file-pdf-box:"
    Alle wichtigen Schritte auf einer einzigen A4-Seite: ausdrucken, aufhängen, mit dem Team teilen.

    [:material-download: Spickzettel herunterladen (PDF)](downloads/kanap-itops-fast-track.pdf){ .md-button .md-button--primary }

Für vollständige Details siehe die Referenzdokumentation zu [Anwendungen](../applications.md) und [Assets](../assets.md).

---

## Das Gesamtbild

![Übersicht Anwendung zu Server](images/app-to-server-overview.png)

Alles in KANAPs IT-Landschaft-Modul ist verbunden, um ein vollständiges Bild Ihrer Landschaft zu zeichnen:

| Objekt | Was es repräsentiert |
|--------|---------------------|
| **Anwendung** | Eine Geschäftsanwendung oder ein IT-Dienst, den Sie dokumentieren möchten |
| **Umgebung** | Wo sie läuft: Prod, QA, Dev usw. (in KANAP „Bereitstellungen" genannt) |
| **Server (Asset)** | Die Infrastruktur, die sie hostet: VMs, physische Server, Container |

Die Kette ist einfach: **Anwendung → Umgebung → Server**. Am Ende dieses Leitfadens haben Sie diese Kette vollständig dokumentiert.

![Anwendungs-Beziehungsmodell](images/app-relationship-model.png)

!!! info "Warum das wichtig ist"
    Wenn jemand fragt „Wo läuft diese App?", „Wer ist verantwortlich?" oder „Ist sie compliant?", haben Sie die Antwort in Sekunden, anstatt Tabellenkalkulationen zu durchsuchen.

---

## Schritt 1: Ihre Anwendung erstellen

Gehen Sie zu **IT-Landschaft > Anwendungen** und klicken Sie auf **Neue Anwendung / Service**.

Geben Sie den Namen in den Titel ein, zum Beispiel `Salesforce CRM`, und drücken Sie die Eingabetaste. Ihre Anwendung ist jetzt im Register, und ihre sechs Tabs öffnen sich für die detaillierte Dokumentation: **Übersicht**, **Bereitstellungen**, **Schnittstellen**, **Betrieb**, **Compliance** und **Beziehungen**.

Füllen Sie dann das Wesentliche in der Kopfzeile und der Eigenschaftsleiste aus:

| Feld | Was eingeben | Beispiel |
|------|-------------|---------|
| **Kategorie** | Der primäre Zweck | `Fachbereichsanwendung` |
| **Lieferant** | Der Lieferant (aus Ihren Stammdaten) | `Salesforce Inc` |
| **Geschäftskritikalität** | Geschäftliche Bedeutung | `Geschäftskritisch` |
| **Lebenszyklus** | Aktueller Status (bei der Erstellung Aktiv) | `Aktiv` |

Solange Sie auf ihrer Seite sind, löscht **Erstellung abbrechen** in der Kopfzeile die neue Anwendung.

!!! tip "Beginnen Sie mit dem, was Sie wissen"
    Beschreibung, Herausgeber, Version, Lizenzierung: alles nützlich, aber in diesem Stadium optional. Sie können später anreichern. Das Ziel ist, die App ins System zu bekommen.

---

## Schritt 2: Eine Umgebung hinzufügen (Bereitstellung)

Jede Anwendung läuft irgendwo. Der Tab **Bereitstellungen** dokumentiert Ihre Umgebungen.

Öffnen Sie Ihre Anwendung und gehen Sie zum Tab **Bereitstellungen**. Klicken Sie auf **Bereitstellung hinzufügen** und wählen Sie die Umgebung (PROD, PRE-PROD, QA, TEST, DEV oder SANDBOX).

Für jede Bereitstellung können Sie erfassen:

| Feld | Was es bewirkt | Beispiel |
|-------|-------------|---------|
| **Umgebung** | Der Umgebungstyp | `PROD` |
| **Lebenszyklus** | Status dieser Bereitstellung | `Aktiv` |
| **Basis-URL** | Die Zugriffs-URL | `https://mycompany.salesforce.com` |
| **SSO aktiviert** | Ist Single Sign-On aktiv? | `Ja` |
| **MFA unterstützt** | Wird Multi-Faktor-Authentifizierung unterstützt? | `Ja` |
| **Notizen** | Zusätzlicher Kontext | `Primäre EU-Instanz` |

Jede Bereitstellung erscheint als Karte, darunter ihre Server (siehe Schritt 8). Mit dem Stiftsymbol bearbeiten Sie eine Bereitstellung, mit dem Löschsymbol entfernen Sie sie.

Änderungen an einer Bereitstellung werden gespeichert, sobald Sie den Dialog bestätigen.

---

## Schritt 3: Verantwortliche zuweisen

Die Verantwortlichen befinden sich im Bereich **Eigenschaften** rechts im Anwendungs-Arbeitsbereich.

### Fachbereichsverantwortliche

Die fachlichen Stakeholder, die für die Anwendung verantwortlich sind. Fügen Sie eine oder mehrere Personen hinzu.

### IT-Verantwortliche

Die Mitglieder des IT-Teams, die für den technischen Betrieb und den Support zuständig sind. Gleicher Mechanismus: Fügen Sie die Personen hinzu.

### Zielgruppe (Optional)

Wählen Sie unter **Zielgruppe** das **Unternehmen** und die **Abteilungen**, die diese Anwendung nutzen. KANAP berechnet die Anzahl der Benutzer aus Ihren Stammdaten, oder Sie stellen die Berechnung auf manuell um und geben die Zahl selbst ein.

!!! warning "Warum Verantwortliche wichtig sind"
    Verantwortlichkeit macht es einfach, **die richtigen Personen zu erreichen**, wenn es darauf ankommt: geplante Wartung, Serviceunterbrechungen, Upgrade-Entscheidungen, Lizenzverlängerungen. Sie steuert auch die Filter **Meine Apps** und **Apps meines Teams** in der Hauptliste. Ohne Verantwortliche ist die App nur in der Ansicht „Alle Apps" sichtbar. Das heißt, niemand fühlt sich zuständig und niemand wird benachrichtigt.

---

## Schritt 4: Zugriffsmethoden festlegen

Gehen Sie zum Tab **Betrieb**. Wählen Sie unter **Zugriffsmethoden**, wie Benutzer diese Anwendung erreichen:

- **Web**: Zugriff über den Browser
- **Lokal installierte Anwendung**: Desktop-Client
- **Mobile Anwendung**: App für Telefon/Tablet
- **VDI / Remote Desktop**: virtueller Desktop
- **Terminal / CLI**: Befehlszeilenschnittstelle
- **Proprietäre HMI**: industrielle Schnittstelle
- **Kiosk**: dediziertes Terminal

Zugriffsmethoden sind in den [IT-Landschaft-Einstellungen](../it-ops-settings.md#zugriffsmethoden) konfigurierbar, Ihre Liste kann also weitere Optionen enthalten.

Legen Sie außerdem fest:

| Feld | Bedeutung |
|-------|--------------|
| **Extern zugänglich** | Ist diese App aus dem Internet erreichbar? |
| **Datenintegration / ETL** | Ist diese App an Datenpipelines beteiligt? |

Derselbe Tab enthält die **Support**-Kontakte (über **Kontakt hinzufügen**, jeweils mit einer Rolle) und freie **Support-Notizen**.

---

## Schritt 5: Mit anderen Objekten verknüpfen (Beziehungen)

Gehen Sie zum Tab **Beziehungen**, um Ihre Anwendung mit Ihren übrigen IT-Managementdaten zu verbinden.

| Verknüpfungstyp | Was Sie verbinden | Warum |
|-----------|----------------------|-----|
| **OPEX-Zeilen** | Wiederkehrende Kosten (Lizenzen, SaaS-Gebühren) | Das vollständige Kostenbild sehen |
| **CAPEX-Zeilen** | Investitionsprojekte | Investitionen verfolgen |
| **Verträge** | Lieferantenverträge | Wissen, wann Verlängerungen fällig sind |
| **Projekte** | Portfolio-Projekte | Mit Ihrem Projektportfolio verbinden |
| **Relevante Websites** | Dokumentation, Wikis, Runbooks | Schneller Zugriff auf externe Ressourcen |
| **Anhänge** | Dateien (Drag-and-drop oder Dateiauswahl) | Spezifikationen und Dokumente bei der App halten |

Der Tab verknüpft auch **Aufgaben**, und Suiten listen dort ihre **Komponenten**.

!!! tip "Das geht auch später"
    Verknüpfungen sind nützlich, aber nicht blockierend. Legen Sie sie an, wenn Sie die Daten haben. Die App funktioniert auch ohne sie vollständig.

---

## Schritt 6: Compliance-Informationen hinzufügen

Gehen Sie zum Tab **Compliance**. Das wird für Audits und regulatorische Anforderungen immer wichtiger.

| Feld | Was eingeben | Beispiel |
|-------|--------------|---------|
| **Geschäftskritikalität** / **Cyberkritikalität** | Wie kritisch die App ist | `Geschäftskritisch` |
| **Datenvertraulichkeit** | Sensibilitätsstufe | `Vertraulich` |
| **Enthält personenbezogene Daten** | Speichert personenbezogene Daten? | `Ja` |
| **Datenresidenz** | Länder, in denen die Daten gespeichert sind | `Frankreich, Deutschland` |
| **Letzter Wiederanlauftest** | Datum des letzten Notfallwiederherstellungstests | `2025-11-15` |

Der Tab enthält außerdem die **Wiederanlaufwelle**, die Wiederherstellungsziele (RTO und RPO) und eine **Begründung**. Wenn Sie fertig sind, markieren Sie die Klassifizierung als geprüft.

!!! info "Klassifizierungsstufen sind konfigurierbar"
    Die Standard-Datenklassen (Öffentlich, Intern, Vertraulich, Eingeschränkt) und die Kritikalitätsstufen können unter **IT-Landschaft > Einstellungen** an die Klassifizierungsrichtlinie Ihrer Organisation angepasst werden.
---

## Schritt 7: Ihren Server erstellen (Asset)

Gehen Sie zu **IT-Landschaft > Assets** und klicken Sie auf **Asset hinzufügen**.

### Übersichts-Tab

Füllen Sie die Kernfelder aus:

| Feld | Was eingeben | Beispiel |
|-------|--------------|---------|
| **Name** | Hostname oder Kennung | `PROD-WEB-01` |
| **Asset-Typ** | Der Servertyp (Auswahlliste) | `Virtuelle Maschine` |
| **Standort** | Wo er gehostet wird (Pflichtfeld) | `Rechenzentrum Paris` |
| **Umgebung** | Welche Umgebung er bedient | `Prod` |
| **Beschreibung** | Zusätzlicher Kontext |  |

Der Bereich **Eigenschaften** rechts enthält den Rest: den Schalter **Cluster**, **Administrationszone**, **Unterstandort**, **Lebenszyklus**, **Inbetriebnahmedatum** und **Datum Lebensende**. Sobald ein Standort ausgewählt ist, werden mehrere **schreibgeschützte Felder** automatisch abgeleitet:

- **Hosting-Typ** (On-Premises, Cloud, Colocation usw.)
- **Cloud-Anbieter / Betreiberunternehmen** (z. B. AWS, Azure oder das Unternehmen, das die Einrichtung betreibt)
- **Land**
- **Stadt**

!!! info "Der Standort ist der Schlüssel"
    Der Standort bestimmt viele Attribute Ihres Assets automatisch. Standorte werden unter **IT-Landschaft > Standorte** verwaltet. Richten Sie sie einmal ein, und jedes zugeordnete Asset erbt Hosting-Typ, Anbieter, Land und Stadt. Sie müssen diese nicht manuell ausfüllen.

### Netzwerk-Tab

Der Tab **Netzwerk** ist geöffnet, während Sie das Asset erstellen. Füllen Sie aus:

| Abschnitt | Felder | Details |
|---------|--------|---------|
| **Identität** | Hostname, Domäne, FQDN, Aliase | Der FQDN wird automatisch aus Hostname und Domäne berechnet |
| **IP-Adressen** | Typ, IP-Adresse, Subnetz | Netzwerkzone und VLAN werden aus dem Subnetz abgeleitet |

!!! info "Mehrere IP-Adressen"
    Ein Server kann mehrere IP-Adressen haben. Fügen Sie so viele wie nötig hinzu (z. B. Management-Schnittstelle, Produktions-VLAN, Backup-Netz). Jeder Eintrag kann seinen eigenen Typ und sein eigenes Subnetz haben, Netzwerkzone und VLAN werden automatisch abgeleitet.

Klicken Sie auf **Erstellen**, um den vollständigen Arbeitsbereich freizuschalten. Der Tab **Übersicht** erhält dann einen Abschnitt **Support** für den Support-Vertrag des Lieferanten und die Kontakte. Für physische Asset-Typen erfasst ein Tab **Hardware** Seriennummern und Herstellerdetails.

### Betriebs-Tab

Gehen Sie zum Tab **Betrieb**, um die **Technologien** hinzuzufügen, die der Server trägt, mit ihren Versionen. Fügen Sie Windows Server, Ubuntu oder eine andere Technologie der Familie **Betriebssystem** hinzu: Sie wird zum Betriebssystem des Servers.

Wenn dieses Asset ein Cluster ist, schalten Sie im Bereich **Eigenschaften** den Schalter **Cluster** ein und fügen Sie dann seine Mitgliedsserver mit **Mitglieder hinzufügen** oben im Tab **Betrieb** hinzu. Eine Anwendung, die auf jedem Mitglied läuft, wird dem Cluster zugeordnet: siehe [Anwendungen auf einem Cluster](../assets.md#applications-on-a-cluster).

---

## Schritt 8: Den Server mit Ihrer Anwendung verknüpfen

Das ist die letzte Verbindung: Ihr Server wird mit der Anwendungsumgebung verknüpft, die er unterstützt.

Es gibt **zwei Wege**, diese Zuordnung zu erstellen:

### Von der Anwendungsseite

1. Öffnen Sie Ihre Anwendung
2. Gehen Sie zum Tab **Bereitstellungen**
3. Klicken Sie auf der Karte der Bereitstellung **PROD** auf **Server hinzufügen**
4. Wählen Sie Ihr Asset (`PROD-WEB-01`)
5. Legen Sie die **Rolle** fest (Web, Datenbank, Anwendung usw.) und optional das Datum **Seit** und **Notizen**

### Von der Asset-Seite

1. Öffnen Sie Ihr Asset
2. Suchen Sie im Tab **Betrieb** den Abschnitt **Gehostete Anwendungen**
3. Klicken Sie auf **Zuordnung hinzufügen**
4. Füllen Sie die Felder der Zuordnung aus:

| Feld | Was eingeben | Beispiel |
|-------|--------------|---------|
| **Anwendung** | Die zu verknüpfende Anwendung | `Salesforce CRM` |
| **Umgebung** | Welche Bereitstellung | `PROD` |
| **Rolle** | Serverrolle für diese App | `Web` |
| **Seit** | Wann die Zuordnung begann | `2025-01-15` |
| **Notizen** | Kontext |  |

!!! success "Die Kette ist vollständig"
    Sie haben jetzt den vollständigen Pfad dokumentiert:

    **Salesforce CRM** → **Bereitstellung PROD** → **PROD-WEB-01**

    Jeder kann in Sekunden von „welche App?" über „welcher Server?" zu „wo steht er?" gelangen.
---

## Wie alles zusammenhängt

Jede Information, die Sie eingeben, fließt in etwas Größeres ein:

### Anwendungslandschaft-Ansicht

Ihre Anwendungsliste wird zu einem Live-Register, das jede Anwendung mit ihren Umgebungen, Kritikalität, Hosting-Typ und Verantwortlichkeit zeigt, filterbar nach jedem Attribut.

### Infrastruktur-Mapping

Assets, die mit Anwendungsbereitstellungen verknüpft sind, ermöglichen es Ihnen, Fragen zu beantworten wie:

- „Welche Server unterstützen diese geschäftskritische App?"
- „Welche Anwendungen sind betroffen, wenn dieser Server ausfällt?"
- „Wie viele Apps werden in diesem Rechenzentrum gehostet?"

### Compliance-Berichterstattung

Datenklassifizierung, PII-Kennzeichnungen und Datenresidenz fließen in Compliance-Ansichten ein. Wenn der Auditor fragt „Wo werden Kundendaten gespeichert?", haben Sie eine dokumentierte, nachvollziehbare Antwort.

### Wissensdatenbank

Sowohl Anwendungen als auch Assets haben im Tab **Übersicht** einen Abschnitt **Wissensdatenbank**, in dem Sie Runbooks, Architekturentscheidungen, Betriebsverfahren und interne Dokumentation verknüpfen können. Diese Referenzen an den richtigen Datensätzen zu haben bedeutet, dass Ihr Team bei Vorfällen findet, was es braucht, ohne Wikis zu durchsuchen.

### Verbindungskarte

Sobald Assets dokumentiert sind, können Sie **Verbindungen** (Server-zu-Server oder Multi-Server) zwischen ihnen erstellen, um Netzwerkflüsse und Abhängigkeiten zu visualisieren. Die [Verbindungskarte](../connection-map.md) rendert diese als interaktiven Graphen mit rollenbasierten vertikalen Ebenen für eine Architektur-Ansicht.

### Schnittstellen & Schnittstellenkarte

Gehen Sie einen Schritt weiter: Dokumentieren Sie **Schnittstellen** zwischen Anwendungen, um Datenflüsse, Integrationspunkte und Geschäftskontext zu erfassen. Jede Schnittstelle hat fünf Tabs für gründliche Dokumentation: Übersicht, Fluss, Umgebungen, Datenzuordnung und Beziehungen.

Verwenden Sie dann die [Schnittstellenkarte](../interface-map.md), um den vollständigen Anwendungsfluss zu visualisieren. In der Standard-Geschäftsansicht sehen Sie saubere Quelle-zu-Ziel-Beziehungen. Wechseln Sie zur technischen Ansicht, um Middleware-Plattformen als rautenförmige Knoten anzuzeigen, die den tatsächlichen Datenpfad zeigen. Der Tiefenfilter zählt nur primäre Anwendungsknoten: Middleware ist transparent, sodass die Auswahl einer App mit Tiefe 2 Ihnen zwei echte Sprünge zeigt, unabhängig davon, wie viele Middleware-Plattformen dazwischenliegen.

---

## Kurzreferenz

| Ich möchte... | Gehe zu... |
|---------------|------------|
| Eine Anwendung erstellen | IT-Landschaft > Anwendungen > Neue Anwendung / Service |
| Umgebungen hinzufügen | App öffnen > Tab Bereitstellungen > Bereitstellung hinzufügen |
| Verantwortliche zuweisen | App öffnen > Bereich Eigenschaften |
| Zugriffsmethoden festlegen | App öffnen > Tab Betrieb |
| Budgets/Verträge verknüpfen | App öffnen > Tab Beziehungen |
| Wissensdatenbank-Dokumente anhängen | App öffnen > Tab Übersicht > Wissensdatenbank |
| Compliance-Infos hinzufügen | App öffnen > Compliance-Tab |
| Einen Server erstellen | IT-Landschaft > Assets > Asset hinzufügen |
| Server mit App verknüpfen (von App) | App öffnen > Tab Bereitstellungen > Server hinzufügen |
| Server mit App verknüpfen (von Asset) | Asset öffnen > Tab Betrieb > Gehostete Anwendungen > Zuordnung hinzufügen |
| Server-Verbindungen anzeigen | Asset öffnen > Tab Netzwerk > Verbindungen |
| Verbindungskarte anzeigen | IT-Landschaft > Verbindungskarte |
| Schnittstellenkarte anzeigen | IT-Landschaft > Schnittstellenkarte |
| Dropdowns konfigurieren | IT-Landschaft > Einstellungen |

---

!!! success "Sie sind startklar"
    Sie wissen jetzt, wie Sie die vollständige Kette von der Anwendung zum Server dokumentieren. Beginnen Sie mit Ihren kritischsten Apps, fügen Sie deren Produktionsumgebungen hinzu, verknüpfen Sie die Server, und Sie haben in kürzester Zeit eine lebende, abfragbare IT-Landschaft. Für detaillierte Dokumentation zu jeder Funktion erkunden Sie die Referenzbereiche [Anwendungen](../applications.md) und [Assets](../assets.md).
