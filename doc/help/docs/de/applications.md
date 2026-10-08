# Anwendungen

Anwendungen ist Ihr zentrales Verzeichnis zur Dokumentation der IT-Anwendungslandschaft. Es umfasst Geschäftsanwendungen, Produktivitätswerkzeuge, Infrastrukturdienste und alles dazwischen. Verwenden Sie es, um Verantwortlichkeit, Bereitstellungen, Integrationen, finanzielle Beziehungen und Compliance-Informationen über Ihr gesamtes Portfolio hinweg zu verfolgen.

## Anwendungskategorien

Jede Anwendung oder jeder Dienst gehört zu einer **Kategorie**, die ihren Hauptzweck beschreibt. Diese Klassifizierung hilft verschiedenen Stakeholdern, zu filtern und sich auf das Wesentliche zu konzentrieren.

| Kategorie | Beschreibung | Beispiele |
|----------|-------------|----------|
| **Line-of-Business** | Kern-Geschäftsanwendungen, die spezifische Geschäftsprozesse unterstützen | SAP, Salesforce, Workday, benutzerdefiniertes ERP |
| **Produktivität** | Endanwenderwerkzeuge für die tägliche Arbeit, einschließlich Dienstprogramme und Zusammenarbeit | Office 365, Acrobat Reader, Teams, Slack, Chrome |
| **Sicherheit** | Werkzeuge zum Schutz von Systemen, Daten und Zugriff | CrowdStrike, Okta, SIEM-Plattformen, Firewalls |
| **Analytik** | Berichterstellung, Business Intelligence und Data-Warehouse-Werkzeuge | Power BI, Tableau, Snowflake |
| **Entwicklung** | Werkzeuge für Entwickler und DevOps-Teams | Python, Git, Jenkins, VS Code, Docker |
| **Integration** | Plattformen, die Systeme verbinden und Daten bewegen | MuleSoft, Kafka, API-Gateways, ETL-Werkzeuge |
| **Infrastruktur** | Grundlegende Dienste, von denen andere Systeme abhängen | PostgreSQL, Redis, Kubernetes, Speichersysteme |

**Tipps zur Klassifizierung**:
- Wählen Sie basierend auf dem **Hauptzweck** der Anwendung, nicht wer sie verwaltet
- Im Zweifelsfall fragen Sie: „Wofür wird dieses Werkzeug hauptsächlich verwendet?"
- Kategorien können in **IT-Landschaft > Einstellungen** angepasst werden, um der Terminologie Ihrer Organisation zu entsprechen

### Filterung nach Stakeholder

Verschiedene Teams können Kategorien verwenden, um sich auf ihren Verantwortungsbereich zu konzentrieren:

| Stakeholder | Empfohlener Filter |
|-------------|-----------------|
| Cybersecurity | Kategorie Sicherheit oder hohe Kritikalität über alle Kategorien |
| Service Desk | Produktivität + Line-of-Business (benutzernahe Anwendungen) |
| Infrastruktur | Infrastruktur + Integration |
| Enterprise Architecture | Alle Kategorien |

---

## Erste Schritte

Navigieren Sie zu **IT-Landschaft > Anwendungen**, um Ihre Liste zu sehen. Klicken Sie auf **Neue App / Dienst**, um Ihren ersten Eintrag zu erstellen.

**Pflichtfelder**:
- **Name**: Ein wiedererkennbarer Name für die Anwendung oder den Dienst
- **Kategorie**: Der Hauptzweck dieser Anwendung (siehe Kategorien oben)
- **Lebenszyklus**: Aktueller Status (Aktiv, Vorgeschlagen, Veraltet, Außer Betrieb oder ein in den Einstellungen definierter benutzerdefinierter Code)

**Dringend empfohlen**:
- **Lieferant**: Der Lieferant, der die Software bereitstellt (verknüpft mit Ihren Lieferanten-Stammdaten)
- **Herausgeber**: Der Software-Herausgeber (z. B. Microsoft, SAP, Oracle)
- **Beschreibung**: Was diese Anwendung tut

Klassifizierungsfelder sind beim Anlegen optional. **Geschäftskritikalität**, Cyberkritikalität, Datenvertraulichkeit und Wiederanlaufwelle werden aus den Stufen gewählt, die Ihre Organisation unter **IT-Landschaft > Einstellungen** definiert hat; jede Option zeigt die Definition der Stufe. Die Werte bleiben offen, bis Sie sie auswählen.

**Optional aber nützlich**:
- **Version**: Aktuelle Versionskennung (Freitext, z. B. „4.2.1", „2023", „Q1 2024")
- **Go-Live**: Wann diese Version live ging oder gehen wird
- **Support-Ende**: Wann der Herstellersupport für diese Version endet
- **Außerbetriebnahmedatum**: Wann diese Version tatsächlich außer Betrieb genommen wurde
- **Lizenzierung**: Lizenzbedingungen und Hinweise
- **Notizen**: Freitext-interne Notizen
- **Kann Unteranwendungen haben**: Aktivieren, um diese Anwendung als „Suite" zu verwenden, die andere Anwendungen gruppiert

Nach dem Speichern schaltet der Arbeitsbereich alle Reiter für die detaillierte Dokumentation frei.

**Tipp**: Beginnen Sie mit der Dokumentation Ihrer kritischsten Anwendungen. Verwenden Sie den Reiter **Bereitstellungen**, um zu erfassen, welche Umgebungen existieren (Prod, QA, Dev) und welche Server sie betreiben, und verknüpfen Sie dann Schnittstellen, Verträge und Budgetpositionen nach und nach.

**Berechtigungen**:
- Anzeigen: `applications:reader`
- Erstellen / Bearbeiten: `applications:manager` (auch `member` genannt)
- Importieren / Exportieren / Löschen: `applications:admin`

---

## Arbeiten mit der Liste

Das Anwendungsraster bietet eine umfassende Ansicht Ihres Anwendungsportfolios.

**Oberer Bereichsfilter (Anzeigen)**:
- **Meine Apps**: zeigt Apps, bei denen Sie in der Eigenschaftsleiste als **Business-Verantwortlicher** oder **IT-Verantwortlicher** gelistet sind. Mehrfach-Verantwortliche werden unterstützt.
- **Apps meines Teams**: zeigt Apps, bei denen ein Mitglied Ihres Portfolio-Teams als Business-Verantwortlicher oder IT-Verantwortlicher gelistet ist. Ihre eigene Verantwortlichkeit ist in diesem Bereich ebenfalls enthalten. Deaktiviert, wenn Sie keinem Portfolio-Team zugewiesen sind.
- **Alle Apps** (Standard): zeigt das vollständige Anwendungsraster mit dem standardmäßigen Lebenszyklus-Filterverhalten.
- Ihre Auswahl wird sitzungsübergreifend gespeichert -- bei Rückkehr zur Seite wird Ihre letzte Wahl wiederhergestellt.

**Standardspalten**:
- **Name**: Anwendungsname mit Kategorie-Beschriftung und einem Badge „Enthalten in: {Suite}" für Komponenten einer Suite
- **Kategorie**: Der Hauptzweck der Anwendung
- **Umgebungen**: Farbige Chips, die aktive Umgebungen zeigen (Prod, Pre-prod, QA, Test, Dev, Sandbox). Bewegen Sie den Mauszeiger darüber für Basis-URL und Lebenszyklus.
- **Lebenszyklus**: Aktueller Status
- **Geschäftskritikalität**: Stufe der geschäftlichen Bedeutung
- **Herausgeber**: Software-Herausgeber
- **Abgeleitete Benutzer (J)**: Berechnete Benutzeranzahl für das aktuelle Jahr (basierend auf der in der Eigenschaftsleiste festgelegten Zielgruppe)
- **Erstellt**: Wann der Datensatz erstellt wurde

**Standardsortierung**: **Name** aufsteigend (A bis Z).

**Zusätzliche Spalten** (über die Spaltenauswahl):
- **Suites**: Übergeordnete Suites, zu denen diese Anwendung gehört
- **Lieferant**: Verknüpfter Lieferantenname
- **Business-Verantwortliche** / **IT-Verantwortliche**: Zugewiesene Verantwortliche (gekürzt, Mauszeiger oder Klick zum Anzeigen aller)
- **Hosting**: Abgeleitet von Server-Standorten, die App-Bereitstellungen zugewiesen sind
- **Extern erreichbar**: Ob die App aus dem Internet zugänglich ist
- **SSO aktiviert** / **MFA aktiviert**: Authentifizierungsfunktionen
- **Datenintegration / ETL**: Ob die App an Datenintegrationen teilnimmt
- **OPEX-Positionen** / **CAPEX-Positionen** / **Verträge**: Verknüpfte Ausgaben und Verträge
- **Komponenten**: Unteranwendungen (wenn dies eine Suite ist)
- **Datenklasse** / **Enthält PII** / **Datenhaltung**: Compliance-Informationen
- **Cyberkritikalität**, **Wiederanlaufwelle**, **RTO**, **RPO**, **Prüfstatus/-datum**: Klassifizierungs- und Kontinuitätsfelder

**Fortschritt der Klassifizierung**: Die Kachel Compliance auf Ihrem Dashboard zeigt, wie viele der für Sie sichtbaren Anwendungen geprüft sind, zu prüfen sind oder noch zu vervollständigende Klassifizierungsfelder haben, sowie die Punkte, die Handlung erfordern. Jede Zahl öffnet die entsprechend gefilterte Anwendungsliste. Siehe [Mein Dashboard](my-dashboard.md#compliance).

**Filterung**:
- Schnellsuche: gleicht Name und Editor/Herausgeber ab
- Die Filter für Kritikalität, Cyberkritikalität, Datenklasse und Wiederanlaufwelle listen ihre Werte in Katalogreihenfolge (die kritischste zuerst, Wellen in Wiederherstellungsreihenfolge).
- Die meisten Spalten verwenden Kontrollkästchen-Set-Filter, die nur Werte anzeigen, die im aktuellen Ergebnissatz vorhanden sind; der schwebende Filter zeigt `Alle`, `Keine` oder `N ausgewählt` mit einem **x** zum Löschen.
- Außer Betrieb genommene Anwendungen sind standardmäßig ausgeblendet; verwenden Sie den **Lebenszyklus**-Filter, um Außer Betrieb einzuschließen.

**Aktionen**:
- **Neue App / Dienst**: Einen neuen Eintrag erstellen (`applications:manager`)
- **CSV importieren**: Massenimport aus CSV-Datei (`applications:admin`)
- **CSV exportieren**: Liste als CSV exportieren (`applications:admin`). Katalogbasierte Spalten (Kategorie, Lebenszyklus, Kritikalität, Cyberkritikalität, Wiederherstellungswelle, Datenklasse, Zugriffsmethoden) werden mit ihren Namen exportiert; der Import akzeptiert einen Namen oder den internen Code.
- **Element kopieren**: Eine ausgewählte Anwendung mit allen Kernbeziehungen duplizieren (`applications:manager`). Siehe [Anwendungen kopieren](#anwendungen-kopieren) für Details.
- **Ausgewählte löschen**: Ausgewählte Anwendungen entfernen (`applications:admin`)

---

## Der Anwendungs-Arbeitsbereich

Klicken Sie auf eine Zeile, um den Arbeitsbereich zu öffnen. Der Arbeitsbereich hat eine **Kopfzeile** mit schnellen Metadaten, eine **Eigenschaftsleiste** auf der rechten Seite (die Identitätskarte der Anwendung -- immer sichtbar) und einen **Inhaltsbereich** in der Mitte, der mit jedem Reiter wechselt.

### Kopfzeile

Die Kopfzeile zeigt:
- **Anwendungsname** (an Ort und Stelle bearbeitbar)
- **Referenz**: kurze Kennung, die Sie kopieren können
- **Lebenszyklus**-Chip: klicken zum Ändern
- **Geschäftskritikalitäts**-Chip: zeigt die Stufe und öffnet ein Menü mit den Stufen der Organisation
- **Versions**-Chip (wenn eine Version festgelegt ist): klicken zum Kopieren
- **Go-Live**-Datum
- **Link senden**: Einen teilbaren Link zu diesem Arbeitsbereich kopieren
- **Neue Version erstellen**: Den Versionsmigrations-Assistenten starten (siehe [Versionsverwaltung](#versionsverwaltung))
- **Löschen** (`applications:admin`)
- **Vorherige / Nächste**: Durch die gefilterte Liste navigieren, ohne zum Raster zurückzukehren

### Eigenschaftsleiste (rechtes Panel)

Die Leiste ist die Identitätskarte der Anwendung. Sie wird in jedem Reiter angezeigt und wird inline bearbeitet -- Änderungen werden automatisch gespeichert.

**Identität**:
- **Kategorie**, **Lieferant**, **Herausgeber**

**Lebenszyklus-Daten**:
- **Go-Live**, **Support-Ende**, **Außerbetriebnahmedatum**

**Verantwortliche**:
- **Business-Verantwortliche**: Geschäftliche Stakeholder, die für diese Anwendung rechenschaftspflichtig sind (Mehrfachauswahl)
- **IT-Verantwortliche**: IT-Teammitglieder, die für den technischen Support verantwortlich sind (Mehrfachauswahl)

**Zielgruppe**:
- Fügen Sie Zeilen für **Unternehmen / Abteilungen** hinzu, um aufzuzeichnen, wer diese Anwendung nutzt. Wählen Sie ein Unternehmen aus und schränken Sie optional auf bestimmte Abteilungen ein.
- Eine Live-Zählung der **Benutzer** wird angezeigt.
- **Berechnungsmethode**: **Abgeleitet** (aus der Zielgruppe basierend auf Stammdaten-Metriken IT-Benutzer / Mitarbeiterzahl berechnet) oder **Manuell** (eine einzelne Überschreibungszahl, die Sie eingeben).

---

### Übersicht

Der Reiter Übersicht ist die Erzählung der Anwendung. Er enthält:

**Beschreibung**: Eine Rich-Text-Beschreibung der Anwendung. Der Editor speichert automatisch beim Tippen.

**Verbindungen**: Eine schreibgeschützte Zusammenfassung, die aus den Schnittstellen der Anwendung erstellt wird. Bei Nicht-Middleware-Apps zeigt sie zwei Zeilen: **Empfängt von** und **Sendet an**. Bei ETL/Middleware-Apps zeigt sie eine einzelne Zeile **Verbunden mit**. Jeder Eintrag ist eine anklickbare Pille, die die zugehörige Anwendung öffnet; „+ N weitere in Schnittstellen" springt zum Reiter Schnittstellen.

**Wissensdatenbank**: Verknüpfte Wissensartikel. Mit `knowledge:member` können Sie neue Artikel direkt aus diesem Bereich erstellen.

---

### Bereitstellungen

Der Reiter Bereitstellungen dokumentiert, wo die Anwendung tatsächlich läuft -- ein Block pro Umgebung, mit den jeweils zugeordneten Servern.

**Umgebungen**: Production, Pre-prod, QA, Test, Dev, Sandbox.

**Für jede Bereitstellung können Sie erfassen**:
- **Lebenszyklus**: pro Umgebung Status (Aktiv, Vorgeschlagen, Veraltet, Außer Betrieb usw.)
- **Basis-URL**: die Zugriffs-URL für diese Umgebung
- **SSO aktiviert** / **MFA unterstützt**
- **Notizen**

**Bereitstellung hinzufügen** öffnet einen Dialog, in dem Sie Umgebung, Lebenszyklus, Basis-URL, SSO/MFA-Flags und Notizen festlegen. Jede Umgebung kann nur einmal hinzugefügt werden. Der Lebenszyklus-Chip auf einer Bereitstellungs-Kopfzeile kann auch inline aus einem Popup-Menü geändert werden.

**Server pro Bereitstellung**: Jeder Bereitstellungsblock zeigt eine Tabelle der zugewiesenen Server:

| Spalte | Was sie zeigt |
|--------|---------------|
| **Server** | Asset-Name (anklickbar) |
| **Rolle** | z. B. Web, Datenbank, Anwendung (aus der Server-Rollen-Liste in den Einstellungen) |
| **Hosting** | Abgeleitet vom Standort des Assets |
| **Seit** | Datum, an dem der Server dieser Bereitstellung zugewiesen wurde |

Klicken Sie in der Bereitstellungs-Kopfzeile auf **Server hinzufügen**, um ein Asset anzuhängen. Cluster-Assets sind ausgeschlossen -- weisen Sie stattdessen Cluster-Member-Hosts zu.

**Tipp**: Dokumentieren Sie Server zuerst in **IT-Landschaft > Assets** und verknüpfen Sie sie dann hier. Der Reiter Übersicht des Assets zeigt dieselben Zuordnungen umgekehrt an.

---

### Schnittstellen

Der Reiter Schnittstellen zeigt alle Integrationen, an denen diese Anwendung beteiligt ist -- als Quelle, Ziel oder Middleware. Das Reiter-Badge zeigt die Gesamtzahl an.

Schnittstellen werden **nach Umgebung gruppiert** (PROD, PRE_PROD, QA, ...). Innerhalb jeder Umgebung werden sie aufgeteilt in:

- **Eingehend** -- diese Anwendung empfängt Daten
- **Ausgehend** -- diese Anwendung sendet Daten
- **Geleitet** -- diese Anwendung ist die Middleware/ETL für einen Fluss zwischen zwei anderen Apps

Jede Zeile zeigt den Schnittstellennamen, die Gegenanwendung und einen Indikator **Via Middleware**. Klicken Sie auf die Zeile, um den Schnittstellen-Arbeitsbereich zu öffnen; klicken Sie auf die Gegenanwendung, um die andere Anwendung zu öffnen.

**Tipp**: Schnittstellen werden über die Schnittstellen-Seite verwaltet. Dieser Reiter ist eine bequeme schreibgeschützte Ansicht, aber er ist der schnellste Weg, um zwischen verbundenen Anwendungen zu navigieren.

---

### Betrieb

Der Reiter Betrieb erfasst, wie Benutzer auf die Anwendung zugreifen und wer sie unterstützt.

**Technisch**:
- **Zugriffsmethoden** (Mehrfachauswahl): Wie Benutzer auf diese Anwendung zugreifen. Optionen sind in den [IT-Landschaft-Einstellungen](it-ops-settings.md) konfigurierbar. Standards umfassen Web, Lokal installierte Anwendung, Mobile Anwendung, Proprietäre HMI (industrielle Schnittstelle), Terminal / CLI, VDI / Remote Desktop, Kiosk.
- **Extern erreichbar**: Ob die Anwendung aus dem Internet zugänglich ist
- **Datenintegration / ETL**: Ob die Anwendung an Datenintegrations-Pipelines teilnimmt (versetzt diese App auch in den „Middleware"-Modus für die Schnittstellen- und Verbindungsansichten)
- **Kann Unteranwendungen haben**: Diese Anwendung in eine Suite verwandeln, die andere Anwendungen gruppiert

**Support**:
- Eine Tabelle mit Supportkontakten, die aus Ihren Kontakte-Stammdaten gezogen werden. Jede Zeile zeigt den Kontaktnamen, die E-Mail, das Telefon und eine Freitext-Rolle (z. B. Account-Manager, L1-Support).
- **Kontakt hinzufügen** öffnet einen Dialog zur Auswahl eines Kontakts und zur Festlegung einer Rolle.
- **Support-Notizen**: Freitext für Supportvereinbarungen (SLA, Eskalationspfade, Bereitschaftsinformationen).

---

### Compliance

Der Reiter Compliance erfasst Datenschutz- und regulatorische Informationen.

**Was Sie bearbeiten können**:
- **Datenklasse**: Vertraulichkeitsstufe (Öffentlich, Intern, Vertraulich, Eingeschränkt oder ein in den Einstellungen definierter benutzerdefinierter Code)
- **Letzter DR-Test**: Datum des letzten Disaster-Recovery-Tests
- **Enthält PII**: Ob die Anwendung personenbezogene Daten speichert
- **Datenhaltung**: Länder, in denen Daten gespeichert werden (Mehrfachauswahl, ISO-Codes + Namen)

**Tipp**: Datenklassen sind in **IT-Landschaft > Einstellungen** konfigurierbar. Passen Sie sie an die Datenklassifizierungsrichtlinie Ihrer Organisation an.

---

### Klassifizierung und Kontinuität

Der Bereich Compliance erfasst auch die Entscheidungen zu Kontinuität und Klassifizierung der Anwendung. Fehlende Werte werden als **Nicht festgelegt** angezeigt; KANAP ersetzt sie nicht durch eine Standardstufe.

Der Reiter ist in vier Blöcke gegliedert, in der Reihenfolge einer Business-Impact-Analyse.

**Kritikalität**:
- Die **Geschäftskritikalität** wird aus den von Ihrer Organisation definierten Stufen gewählt. Jede Option zeigt die Definition der Stufe, in der Regel die Unterbrechung, die die Aktivität tolerieren kann. Die Stufe ist eine stabile Referenz: Das Umbenennen einer Stufe, das Ändern ihrer Definition oder das Umsortieren des Katalogs in den Einstellungen verschiebt nie eine Anwendung auf eine andere Stufe.
- Die **Cyberkritikalität** wird unabhängig gewählt. Das Auswahlmenü zeigt die Beschreibung jeder Stufe; wählen Sie die Stufe mit den höchsten plausiblen Folgen. Verwechseln Sie Cyberkritikalität nicht mit dem Risikoniveau!

**Daten**:
- **Datenvertraulichkeit** verwendet den Datenklassenkatalog der Organisation.
- **Enthält personenbezogene Daten** und **Datenresidenz** vervollständigen das Datenbild.

**Kontinuität und Wiederanlauf**:
- Die **Wiederherstellungswelle** bezeichnet die Reihenfolge der Wiederherstellung, keine Dauer und keinen Schweregrad.
- Das **RTO** ist das Ziel für die Wiederherstellungszeit. Das **RPO** ist der zulässige Datenverlust und darf null sein. Erreicht das RTO die maximal tolerierbare Ausfallzeit, die auf der gewählten Geschäftsstufe definiert ist, zeigt KANAP einen Hinweis, behält aber beide Werte.
- Unter der Welle listet KANAP die Schnittstellen auf, die diese Anwendung mit einer Anwendung in einer **späteren** Welle verbinden („Austausch mit CRM, geplant in V3"), mit einem Link zu jeder Schnittstelle. Beide Anwendungen müssen laufen, damit der Fluss funktioniert; der Verantwortliche des Wiederherstellungsplans entscheidet. Außer Betrieb genommene Schnittstellen werden ignoriert, und Benutzer mit eingeschränktem Bereich als Fachbereichs-Mitwirkender sehen diese Liste nicht.
- **Letzter Wiederherstellungstest** enthält das Datum des letzten Tests. Ein Link aus diesem Bereich verwendet die einzige **Wissensdatenbank** im Reiter Übersicht und erzeugt keinen doppelten Datensatz. Ältere URL-Links bleiben unter Verknüpfungen verfügbar.

Zwei dezente Hinweise können erscheinen: Daten auf der höchsten Vertraulichkeitsstufe in Kombination mit der niedrigsten Cyber-Kritikalität sowie eine Anwendung auf der kritischsten Geschäftsstufe ohne Wiederherstellungstest in den letzten zwölf Monaten. Sie blockieren nie etwas.

**Review**:
- Die **Begründung** dokumentiert, warum die Stufen gewählt wurden und worauf der Wiederherstellungsplan beruht.
- Das Review ist ein Zeitstempel: **Als geprüft markieren** hält fest, wer die Klassifizierung wann geprüft hat. Die Aktion steht zur Verfügung, sobald Geschäftskritikalität, Cyberkritikalität, Datenvertraulichkeit, Wiederanlaufwelle und Begründung vorhanden sind.
- Prüfdatum und Prüfer bleiben danach sichtbar. Ändert sich nach dem Review ein Klassifizierungswert, eine Wiederanlaufreferenz oder die Datenresidenz, zeigt der Reiter **Seit der Prüfung geändert** und die Liste **Erneut prüfen**. Eine Änderung von Name oder Herausgeber hat keine Auswirkung. Eine Änderung des Katalogs in den Einstellungen macht ein Review nie ungültig.

### Verknüpfungen

Der Reiter Verknüpfungen verbindet diese Anwendung mit Ihren Finanz-, Vertrags-, Projekt- und Aufgabendatensätzen. Das Reiter-Badge zählt alle verknüpften Elemente. Änderungen werden automatisch gespeichert.

**Komponenten** (nur wenn „Kann Unteranwendungen haben" aktiviert ist): eine Tabelle, die die Unteranwendungen dieser Suite mit ihrem Lebenszyklus und ihrer Kritikalität auflistet. Klicken Sie auf eine Zeile, um den Arbeitsbereich der Unteranwendung zu öffnen.

**Verknüpfungen**:
- **OPEX-Positionen**: Laufende Kosten, die mit dieser Anwendung verbunden sind
- **CAPEX-Positionen**: Investitionsausgabenprojekte
- **Verträge**: Lieferantenverträge
- **Projekte**: Portfolio-Projekte, die mit dieser Anwendung verknüpft sind
- **Aufgaben**: Aufgaben, die mit dieser Anwendung verknüpft sind. Diese Liste ist hier schreibgeschützt -- Aufgaben gewinnen oder verlieren diese Verknüpfung, wenn Sie das Feld **App / Dienst** auf einer Aufgabe in der Aufgabenseite festlegen.

**Relevante Websites**: URLs mit optionalen Namen hinzufügen -- nützlich für Lieferantenportale, Monitoring-Dashboards oder Dokumentationslinks. **URL hinzufügen** öffnet einen Dialog; vorhandene Einträge können bearbeitet oder gelöscht werden.

**Anhänge**: Dateien per Drag-and-Drop ziehen oder auf **Dateien auswählen** klicken, um sie hochzuladen. Klicken Sie auf einen Anhang-Chip, um ihn herunterzuladen. Löschen ist für Manager verfügbar.

---

## Versionsverwaltung

KANAP bietet **zwei Wege zur Verwaltung von Anwendungsversionen**, je nachdem, wie Ihre Organisation Upgrades handhabt:

| Ansatz | Am besten für | Was passiert |
|----------|----------|--------------|
| **Einfach** | Die meisten Anwendungen | Versionsfelder in der Eigenschaftsleiste oder im Erstellungsformular aktualisieren -- gleicher Datensatz, neue Versionsnummer |
| **Erweitert** | Große Migrationen | **Neue Version erstellen** verwenden, um einen neuen Anwendungsdatensatz mit Versionsnachverfolgung zu erstellen -- alte und neue Versionen parallel betreiben |

### Einfache Versionsverfolgung (In-Place-Updates)

Für die meisten Anwendungen -- bei denen Sie upgraden und die alte Version einfach verschwindet -- aktualisieren Sie **Version**, **Go-Live**, **Support-Ende** und **Außerbetriebnahmedatum** im Erstellungsformular oder in der Eigenschaftsleiste. Der Versions-Chip in der Kopfzeile und die **Go-Live**-Metadaten spiegeln Ihre Einstellungen wider.

Dieser Ansatz hält alles in einem einzigen Datensatz. Wenn Sie ein Upgrade durchführen, aktualisieren Sie die Versionsfelder und Sie sind fertig. Die Historie wird im Audit-Protokoll verfolgt.

**Verwenden Sie dies, wenn**: Upgrades vor Ort ohne Überlappung erfolgen -- eine Version ersetzt eine andere.

### Eine neue Version erstellen (Parallelmigrationen)

Für größere Anwendungsupgrades, bei denen Sie alte und neue Versionen parallel über verschiedene Umgebungen betreiben müssen (z. B. SAP S/4HANA 1909 in Prod, während 2023 in QA ist), verwenden Sie **Neue Version erstellen** in der Kopfzeile des Arbeitsbereichs.

Der Assistent hat drei Schritte:

1. **Versionsdetails** -- Neuen Anwendungsnamen, Versionsbezeichnung, **Go-Live**- und **Support-Ende**-Daten.
2. **Kopieroptionen** -- wählen, was von der Quelle kopiert wird. Standardwerte unten gezeigt.
3. **Schnittstellen** -- wählen, welche Schnittstellen zur neuen Version migriert werden sollen.

Die neue Version wird als separate Anwendung erstellt mit:
- Einem **Vorgeschlagen**-Lebenszyklus (bereit zur Konfiguration vor dem Go-Live)
- Einem Link zu seinem Vorgänger (verwendet von der Versions-Zeitleiste)
- Kopierten Daten basierend auf Ihren Auswahlen
- Duplizierten Schnittstellen, die auf die neue Version verweisen

Klassifizierungs- und Kontinuitätswerte werden kopiert, die neue Version beginnt jedoch mit einem zurückgesetzten Review und ohne kopierten letzten Wiederherstellungstest.

### Was kopiert wird

| Option | Standard |
|--------|---------|
| Verantwortliche (Business und IT) | Ein |
| Unternehmen (Zielgruppe) | Ein |
| Abteilungen | Ein |
| Datenhaltung | Ein |
| Verknüpfungen | Ein |
| Supportkontakte | Ein |
| Budgetpositionen (OPEX + CAPEX, gepaart) | Ein |
| Verträge | Ein |
| Bereitstellungen | Aus |
| Bereitstellungs-Bindungen | Aus (nur verfügbar, wenn Bereitstellungen ausgewählt ist) |

**Nicht kopiert** (muss neu eingerichtet werden): Suite-Mitgliedschaft, Anhänge, Server-Zuweisungen.

### Schnittstellenmigration

Während der Versionserstellung zeigt der Assistent alle Schnittstellen an, bei denen diese Anwendung Quelle, Ziel oder Middleware ist (wenn ETL aktiviert ist). Ausgewählte Schnittstellen werden mit auf die neue Version aktualisierten Referenzen dupliziert. Jede migrierte Schnittstelle enthält ihre Legs, Verantwortlichen, Unternehmen, Schlüsselkennungen, Verknüpfungen und Datenhaltung. Migrierte Schnittstellen starten mit einem **Vorgeschlagen**-Lebenszyklus. Die ursprünglichen Schnittstellen bleiben mit der alten Version verknüpft.

**Bindungen kopieren**: Wenn Sie sowohl **Bereitstellungen** als auch **Bereitstellungs-Bindungen** auswählen, werden auch Schnittstellen-Bindungen kopiert. Bindungen werden den Bereitstellungen der neuen Anwendung zugeordnet (nach Umgebung abgeglichen); umgebungsspezifische Details (Endpunkte, Authentifizierung, Job-Namen) werden gelöscht, und der Bindungsstatus wird auf **Vorgeschlagen** zurückgesetzt.

**ETL/Middleware-Anwendungen**: Wenn die Anwendung **Datenintegration / ETL** aktiviert hat, zeigt der Assistent auch Schnittstellen an, die *durch* diese Anwendung als Middleware fließen. Dies sind Schnittstellen, bei denen eine andere Quelle Daten an ein anderes Ziel über Ihren ETL sendet. Das Kopieren erstellt neue Schnittstellendefinitionen für den aufgerüsteten ETL mit ordnungsgemäß aktualisierten Middleware-Referenzen.

**Tipp**: Verwenden Sie dies beim Upgrade Ihres ERP oder ETL: migrieren Sie die kritischen Schnittstellen und kopieren Sie optional Bindungen, um einen Vorsprung bei der Umgebungskonfiguration zu erhalten.

---

## Anwendungen kopieren

Es gibt zwei Möglichkeiten, eine Anwendung in KANAP zu kopieren:

### Element kopieren (aus dem Anwendungsraster)

Verwenden Sie dies, wenn Sie ein unabhängiges Duplikat einer Anwendung erstellen möchten -- typischerweise um einen ähnlichen Anwendungseintrag ohne Versionsverkettung zu erstellen.

1. Wählen Sie eine Anwendung im Raster aus
2. Klicken Sie auf **Element kopieren**
3. Das System erstellt eine Kopie mit „ (Kopie)" angehängt an den Namen
4. Sie werden zur neuen Anwendung navigiert, um Änderungen vorzunehmen

**Was kopiert wird**: Alle Kernfelder (außer dem Datum des letzten DR-Tests), einschließlich Klassifizierungs- und Kontinuitätswerten, Verantwortliche, Unternehmen, Abteilungen, Suites, OPEX/CAPEX-Positionen, Verträge, Verknüpfungen, Datenhaltung und Supportkontakte. Das Review der Kopie wird zurückgesetzt.

**Was NICHT kopiert wird**: Bereitstellungen, Schnittstellen, Server-Zuweisungen, Anhänge, Versionsfelder (Version, Go-Live-Datum, Support-Ende).

### Vergleich: Element kopieren vs. Neue Version erstellen

| Aspekt | Element kopieren | Neue Version erstellen |
|--------|-----------|-------------------|
| **Zweck** | Unabhängiges Duplikat | Versionierter Nachfolger mit Verkettung |
| **Benutzeroptionen** | Keine (automatisch) | 3-Schritt-Assistent |
| **Verkettung** | Keine Vorgängerverknüpfung | Setzt Vorgänger |
| **Lebenszyklus** | Erhalten | Auf Vorgeschlagen zurückgesetzt |
| **Name** | „(Kopie)"-Suffix | Vom Benutzer angegeben |

**Verknüpfungen**:

| Verknüpfung | Element kopieren | Neue Version erstellen |
|----------|-----------|--------------------|
| Verantwortliche (Business und IT) | Ja | Optional (Standard: ja) |
| Unternehmen (Zielgruppe) | Ja | Optional (Standard: ja) |
| Abteilungen | Ja | Optional (Standard: ja) |
| Datenhaltung | Ja | Optional (Standard: ja) |
| Verknüpfungen | Ja | Optional (Standard: ja) |
| Supportkontakte | Ja | Optional (Standard: ja) |
| Suites (Mitgliedschaft) | Ja | Nein |
| OPEX-Positionen | Ja | Optional (Standard: ja) |
| CAPEX-Positionen | Ja | Optional (Standard: ja) |
| Verträge | Ja | Optional (Standard: ja) |
| Bereitstellungen | Nein | Optional (Standard: nein) |
| Bindungen | Nein | Optional (Standard: nein) |
| Schnittstellen | Nein | Vom Benutzer ausgewählt |
| Server-Zuweisungen | Nein | Nein |
| Anhänge | Nein | Nein |

**Kernfelder**:

| Feld | Element kopieren | Neue Version erstellen |
|-------|-----------|--------------------|
| Beschreibung | Ja | Ja |
| ETL aktiviert | Ja | Ja |
| Support-Notizen | Ja | Ja |
| Letzter DR-Test | Nein | Nein |
| Versionsfelder | Nein | Vom Benutzer angegeben |
| Benutzer-Überschreibung | Ja | Auf null zurückgesetzt |
| Benutzerjahr | Ja | Auf aktuelles Jahr zurückgesetzt |

---

## CSV-Import/Export

Pflegen Sie Ihr Anwendungsinventar im großen Maßstab mit CSV-Import und -Export. Diese Funktion unterstützt Massenoperationen für das initiale Datenladen, periodische Updates aus externen Systemen und Datenextraktion für Berichte.

### Zugriff auf CSV-Funktionen

Aus der Anwendungsliste:
- **CSV exportieren**: Anwendungen in eine CSV-Datei herunterladen
- **CSV importieren**: Eine CSV-Datei hochladen, um Anwendungen zu erstellen oder zu aktualisieren
- **Vorlage herunterladen** (im Import-Dialog): Eine leere CSV mit korrekten Spaltenköpfen erhalten

**Erforderliche Berechtigungen**: `applications:admin` für Import-/Export-Operationen.

### Exportoptionen

**Voreinstellungen**:

| Voreinstellung | Beschreibung |
|--------|-------------|
| **Vollständiger Export** | Alle exportierbaren Felder einschließlich berechneter/schreibgeschützter Daten (Zeitstempel, Datenhaltung, Benutzermetriken) |
| **Datenanreicherung** | Nur importierbare Felder -- ideal für Round-Trip-Bearbeitungs-Workflows |

**Vorlagen-Export**: Lädt nur Spaltenköpfe herunter -- nützlich für die Vorbereitung von Importdateien mit der korrekten Struktur. Die Vorlage enthält alle importierbaren Felder.

**Benutzerdefinierte Auswahl**: Wählen Sie bestimmte Felder, die in Ihren Export aufgenommen werden sollen.

### Import-Workflow

1. **Datei vorbereiten**: Verwenden Sie UTF-8-Kodierung mit Semikolon (`;`) als Trennzeichen. Laden Sie eine Vorlage herunter, um korrekte Spaltenköpfe sicherzustellen.

2. **Importeinstellungen wählen**:
   - **Modus**:
     - `Anreichern` (Standard): Leere Zellen erhalten vorhandene Werte -- nur aktualisieren, was Sie angeben
     - `Ersetzen`: Angegebene Felder werden aktualisiert; leere Klassifizierungszellen behalten den vorhandenen Wert, `__CLEAR__` löscht ihn ausdrücklich
   - **Operation**:
     - `Upsert` (Standard): Neue Anwendungen erstellen oder vorhandene aktualisieren
     - `Nur aktualisieren`: Nur vorhandene Anwendungen ändern, neue überspringen
     - `Nur einfügen`: Nur neue Anwendungen erstellen, vorhandene überspringen

3. **Zuerst validieren**: Klicken Sie auf **Preflight**, um Ihre Datei ohne Änderungen zu validieren. Überprüfen Sie Fehler und Warnungen.

4. **Änderungen anwenden**: Wenn die Validierung erfolgreich ist, klicken Sie auf **Importieren**, um Änderungen zu übernehmen.

### Feldreferenz

**Übersichtsfelder**:

| CSV-Spalte | Beschreibung | Erforderlich | Hinweise |
|------------|-------------|----------|-------|
| `id` | Anwendungs-UUID | Nein | Für Updates; bei neuen Anwendungen leer lassen |
| `name` | Anwendungsname | Ja | Wird als eindeutige Kennung für den Abgleich verwendet |
| `description` | Was die Anwendung tut | Nein | |
| `category` | Hauptzweck | Nein | Akzeptiert Code oder Bezeichnung aus den Einstellungen |
| `supplier_name` | Lieferantenname | Nein | Muss mit vorhandenem Lieferanten übereinstimmen |
| `editor` | Software-Herausgeber | Nein | Freitext (z. B. Microsoft, SAP) |
| `criticality` | Geschäftskritikalität | Nein | Akzeptiert Code oder Bezeichnung aus den Einstellungen; `__CLEAR__` löscht den Wert |
| `lifecycle` | Aktueller Status | Nein | Akzeptiert Code oder Bezeichnung aus den Einstellungen |
| `is_suite` | Kann Unteranwendungen haben | Nein | `true` oder `false` |
| `status` | Aktiviert/deaktiviert | Nein | `enabled` oder `disabled` |

**Versionsfelder**:

| CSV-Spalte | Beschreibung | Hinweise |
|------------|-------------|-------|
| `version` | Aktuelle Version | Freitext |
| `go_live_date` | Wann die Version live ging | Datumsformat: YYYY-MM-DD |
| `end_of_support_date` | Datum des Herstellersupportendes | Datumsformat: YYYY-MM-DD |
| `retired_date` | Außerbetriebnahmedatum | Datumsformat: YYYY-MM-DD |

**Technische Felder**:

| CSV-Spalte | Beschreibung | Hinweise |
|------------|-------------|-------|
| `access_methods` | Wie Benutzer zugreifen | Komma-getrennte Codes oder Bezeichnungen aus den Einstellungen (z. B. `web,mobile,vdi`) |
| `external_facing` | Aus dem Internet zugänglich | `true` oder `false` |
| `etl_enabled` | Datenintegration | `true` oder `false` |
| `support_notes` | Support-Informationen | Freitext |
| `licensing` | Lizenzbedingungen | Freitext |
| `notes` | Interne Notizen | Freitext |

**Compliance-Felder**:

| CSV-Spalte | Beschreibung | Hinweise |
|------------|-------------|-------|
| `data_class` | Datenklassifizierung | Akzeptiert Code oder Bezeichnung aus den Einstellungen |
| `last_dr_test` | Datum des letzten DR-Tests | Datumsformat: YYYY-MM-DD |
| `contains_pii` | Speichert personenbezogene Daten | `true` oder `false` |
| `data_residency` | Datenspeicherländer | Nur Export (ISO-Codes) |

**Klassifizierungsfelder**:

| CSV-Spalte | Beschreibung | Hinweise |
|------------|-------------|---------|
| `criticality` | Stufe der Geschäftskritikalität | Mandantencode oder eindeutige Bezeichnung |
| `cyber_criticality` | Cyber-Folgenstufe | Mandantencode oder eindeutige Bezeichnung |
| `recovery_wave` | Wiederherstellungsreihenfolge | Mandantencode oder eindeutige Bezeichnung |
| `rto_minutes` / `rpo_minutes` | Wiederherstellungsziele | Ganze Minuten; RPO darf null sein |
| `classification_justification` | Begründung | Freitext |

Eine leere Klassifizierungszelle behält im Modus Anreichern und Ersetzen den vorhandenen Wert; verwenden Sie `__CLEAR__`, um eine Klassifizierung zu löschen.

**Verantwortlichen-Felder**:

| CSV-Spalte | Beschreibung | Hinweise |
|------------|-------------|-------|
| `business_owner_email_1` bis `_4` | E-Mails der Business-Verantwortlichen | Müssen mit vorhandenen Benutzern per E-Mail übereinstimmen |
| `it_owner_email_1` bis `_4` | E-Mails der IT-Verantwortlichen | Müssen mit vorhandenen Benutzern per E-Mail übereinstimmen |

**Nur-Export-Felder** (im Vollständigen Export enthalten, aber nicht importierbar):

| CSV-Spalte | Beschreibung |
|------------|-------------|
| `data_residency` | Datenspeicherländer (ISO-Codes, komma-getrennt) |
| `users_mode` | Benutzeranzahl-Methode (`manual`, `it_users`, `headcount`) |
| `users_year` | Referenzjahr für Benutzerberechnungen |
| `users_override` | Manuelle Benutzeranzahl-Überschreibung |
| `created_at` | Zeitstempel der Datensatzerstellung |
| `updated_at` | Zeitstempel der letzten Änderung |

### Akzeptanz von Bezeichnungen und Codes

Für Felder, die in **IT-Landschaft > Einstellungen** konfiguriert sind, können Sie entweder den internen Code oder die Anzeigebezeichnung verwenden:

| Feld | Beispiel-Codes | Beispiel-Bezeichnungen |
|-------|---------------|----------------|
| Kategorie | `lob`, `productivity`, `security` | `Line-of-business`, `Productivity`, `Security` |
| Lebenszyklus | `active`, `proposed`, `deprecated` | `Active`, `Proposed`, `Deprecated` |
| Datenklasse | `public`, `internal`, `confidential` | `Public`, `Internal`, `Confidential` |

Das System normalisiert Werte automatisch beim Import, sodass `Line-of-business`, `line-of-business` und `lob` alle zur gleichen Kategorie aufgelöst werden.

### Abgleich und Updates

Anwendungen werden nach **Name** (Groß-/Kleinschreibung ignorierend) abgeglichen. Wenn ein Treffer gefunden wird:
- Mit `Anreichern`-Modus: Nur nicht-leere CSV-Werte aktualisieren die Anwendung
- Mit `Ersetzen`-Modus: Angegebene Felder werden aktualisiert; leere Klassifizierungszellen behalten den vorhandenen Wert, `__CLEAR__` löscht ihn ausdrücklich

Wenn Sie die Spalte `id` mit einer gültigen UUID einschließen, verwendet der Abgleich zuerst die ID und greift dann auf den Namen zurück.

### Einschränkungen

- **Bereitstellungen nicht enthalten**: Umgebungsbereitstellungen (Prod, QA, Dev) erfordern Arbeitsbereich-Konfiguration
- **Server-Zuweisungen ausgeschlossen**: Server-Bindungen müssen im Reiter Bereitstellungen eingerichtet werden
- **Schnittstellen ausgeschlossen**: Integrationsdefinitionen sind nicht Teil des CSV-Imports/-Exports
- **Maximal 4 Verantwortliche pro Typ**: Bis zu 4 Business-Verantwortliche und 4 IT-Verantwortliche können importiert/exportiert werden
- **Benutzermetriken nur Export**: Zielgruppen- und Benutzeranzahlfelder (`users_mode`, `users_year`, `users_override`) werden im Arbeitsbereich verwaltet
- **Datenhaltung nur Export**: Länderauswahlen müssen im Reiter Compliance verwaltet werden

### Fehlerbehebung

**Fehler „Datei ist nicht richtig formatiert"**: Dies weist normalerweise auf ein Kodierungsproblem hin. Stellen Sie sicher, dass Ihre CSV als **UTF-8** gespeichert ist:

- **In LibreOffice**: Wählen Sie beim Öffnen einer CSV `UTF-8` im Zeichensatz-Dropdown (nicht „Japanese (Macintosh)" oder andere Kodierungen). Beim Speichern aktivieren Sie „Filtereinstellungen bearbeiten" und wählen Sie UTF-8.
- **In Excel**: Speichern unter > CSV UTF-8 (Komma-getrennt), dann in einem Texteditor öffnen, um Kommas in Semikolons zu ändern.
- **Allgemeiner Tipp**: Wenn Sie verstümmelte Zeichen (`?¿`, `ï»¿`) am Anfang Ihrer Datei sehen, ist die Kodierung falsch.

### Beispiel-CSV

```csv
name;category;supplier_name;criticality;lifecycle;go_live_date;external_facing
Salesforce CRM;Line-of-business;Salesforce Inc;Critical;Active;2020-01-15;true
Microsoft 365;Productivity;Microsoft;high;active;2019-06-01;false
Custom ERP;lob;;Moderate;Active;2018-03-20;false
```

---

## Tipps

- **Beginnen Sie mit kritischen Apps**: Dokumentieren Sie zuerst Ihre geschäftskritischen Anwendungen, dann arbeiten Sie die Kritikalitätsstufen ab.
- **Suites zum Gruppieren verwenden**: Aktivieren Sie „Kann Unteranwendungen haben" im Reiter Betrieb, um eine Anwendung als Suite zu markieren, die verwandte Komponenten gruppiert (z. B. SAP-Module unter einer SAP-Suite).
- **Frühzeitig mit Ausgaben verknüpfen**: Verbinden Sie OPEX, CAPEX und Verträge im Reiter Verknüpfungen, um das vollständige Kostenbild für jede Anwendung zu sehen.
- **Bereitstellungen aktuell halten**: Der Reiter Bereitstellungen steuert die Umgebungs-Chips in der Liste -- halten Sie ihn für genaue Sichtbarkeit aktuell.
- **Dokumentieren Sie die Zielgruppe**: Legen Sie Unternehmens- und Abteilungs-Zielgruppen in der Eigenschaftsleiste fest; die Benutzeranzahl wird dann automatisch abgeleitet und in Berichten verwendet.
- **Kategorie-Filterung nutzen**: Verwenden Sie den Kategorie-Spaltenfilter, um sich auf bestimmte Anwendungstypen zu konzentrieren (z. B. nur Line-of-business-Apps anzeigen oder Produktivitätswerkzeuge ausschließen).
- **Wissensdatenbank frühzeitig anhängen**: Verknüpfen Sie Runbooks und Architekturdokumente im Reiter Übersicht, damit das Team weiß, wo es bei Vorfällen nachschlagen muss.
- **Aufgaben kommen von der Aufgabenseite**: Um eine Aufgabe an eine Anwendung anzuhängen, setzen Sie das Feld App / Dienst auf der Aufgabe selbst; sie erscheint dann unter Verknüpfungen > Aufgaben.
