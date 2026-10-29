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
- **Name**: Ein wiedererkennbarer Name für die Anwendung oder den Dienst, höchstens 200 Zeichen. Siehe [Eindeutige Namen](#unique-names)
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

**Support-Ende** und **Außerbetriebnahmedatum** dürfen nicht vor dem **Go-Live** liegen.

Nach dem Speichern schaltet der Arbeitsbereich alle Reiter für die detaillierte Dokumentation frei.

### Eindeutige Namen { #unique-names }

Zwei Anwendungen können nicht denselben Namen tragen. Der Vergleich ignoriert Groß- und Kleinschreibung sowie Leerzeichen am Anfang und Ende des Namens: `CRM` und ` crm ` sind derselbe Name. Ist der Name vergeben, nennt die Meldung die Anwendung, die ihn trägt, mit ihrer Referenz (`APP-12`). Die Regel gilt, wenn Sie eine Anwendung erstellen, umbenennen, kopieren oder importieren, und wenn Sie eine neue Version erstellen.

Anwendungen, die schon vor dieser Regel denselben Namen trugen, bleiben bearbeitbar. Ihr Name wird erst geprüft, wenn er sich ändert.

**Tipp**: Beginnen Sie mit der Dokumentation Ihrer kritischsten Anwendungen. Verwenden Sie den Reiter **Bereitstellungen**, um zu erfassen, welche Umgebungen existieren (Prod, QA, Dev) und welche Server sie betreiben, und verknüpfen Sie dann Schnittstellen, Verträge und Budgetzeilen nach und nach.

**Berechtigungen**:
- Anzeigen: `applications:reader`
- Erstellen / Bearbeiten: `applications:member`
- Importieren / Exportieren / Löschen: `applications:admin`

---

## Arbeiten mit der Liste { #working-with-the-list }

Das Anwendungsraster bietet eine umfassende Ansicht Ihres Anwendungsportfolios.

**Oberer Bereichsfilter (Anzeigen)**:
- **Meine Anwendungen**: zeigt Apps, bei denen Sie in der Eigenschaftsleiste als **Business-Verantwortlicher** oder **IT-Verantwortlicher** gelistet sind. Mehrfach-Verantwortliche werden unterstützt.
- **Anwendungen meines Teams**: zeigt Apps, bei denen ein Mitglied Ihres Portfolio-Teams als Business-Verantwortlicher oder IT-Verantwortlicher gelistet ist. Ihre eigene Verantwortlichkeit ist in diesem Bereich ebenfalls enthalten. Deaktiviert, wenn Sie keinem Portfolio-Team zugewiesen sind.
- **Alle Anwendungen** (Standard): zeigt das vollständige Anwendungsraster mit dem standardmäßigen Lebenszyklus-Filterverhalten.
- Ihre Auswahl wird sitzungsübergreifend gespeichert: bei Rückkehr zur Seite wird Ihre letzte Wahl wiederhergestellt.

**Standardspalten**:
- **Name**: Anwendungsname, darunter eine Zeile „Enthalten in: {Suite}" für eine Anwendung, die in einer Suite enthalten ist
- **Zu prüfende Schwachstellen**: die noch zu prüfenden Schwachstellen der Technologien, die die Anwendung deklariert oder die ihre Bereitstellungsserver erfasst haben, dann in Orange die Zahl der kritischen oder hohen (`5 · 2`). Leer für eine deaktivierte Anwendung oder wenn keine mehr offen ist. Ein Klick öffnet die Seite [Schwachstellen](vulnerabilities.md), gefiltert auf die Anwendung. Vorhanden, wenn Schwachstellen verfolgt werden. Siehe [Was KANAP zählt](vulnerabilities.md#what-kanap-counts)
- **Kategorie**: Der Hauptzweck der Anwendung
- **Umgebungen**: Farbige Chips, die aktive Umgebungen zeigen (Prod, Pre-prod, QA, Test, Dev, Sandbox). Bewegen Sie den Mauszeiger darüber für Basis-URL und Lebenszyklus.
- **Lebenszyklus**: Aktueller Status
- **Geschäftskritikalität**: Stufe der geschäftlichen Bedeutung
- **Herausgeber**: Software-Herausgeber
- **Abgeleitete Benutzer {Jahr}**: die Benutzer, die für die Unternehmen und Abteilungen der Zielgruppe im laufenden Jahr gezählt werden, oder im nächstliegenden Jahr mit Daten. Eine manuell erfasste Benutzerzahl ersetzt sie. Der Tooltip der Spaltenüberschrift erklärt das
- **Erstellt**: Wann der Datensatz erstellt wurde

Eine Zelle ohne Wert zeigt einen Strich.

**Standardsortierung**: **Name** aufsteigend (A bis Z).

**Zusätzliche Spalten** (über die Spaltenauswahl):
- **Suites**: Übergeordnete Suites, zu denen diese Anwendung gehört
- **Lieferant**: Verknüpfter Lieferantenname
- **Business-Verantwortliche** / **IT-Verantwortliche**: Zugewiesene Verantwortliche (gekürzt, Mauszeiger oder Klick zum Anzeigen aller)
- **Hosting**: Abgeleitet von Server-Standorten, die App-Bereitstellungen zugewiesen sind. Eine Anwendung auf einem Cluster übernimmt auch die Standorte seiner Mitglieder
- **Extern erreichbar**: Ob die App aus dem Internet zugänglich ist
- **SSO aktiviert** / **MFA aktiviert**: Authentifizierungsfunktionen
- **Datenintegration / ETL**: Ob die App an Datenintegrationen teilnimmt
- **OPEX-Zeilen** / **CAPEX-Zeilen** / **Verträge**: Verknüpfte Ausgaben und Verträge
- **Komponenten**: Unteranwendungen (wenn dies eine Suite ist)
- **Datenklasse** / **Enthält PII** / **Datenhaltung**: Compliance-Informationen
- **Cyberkritikalität**, **Wiederanlaufwelle**, **RTO**, **RPO**, **Prüfstatus/-datum**: Klassifizierungs- und Kontinuitätsfelder

**Fortschritt der Klassifizierung**: Die Kachel Compliance auf Ihrem Dashboard zeigt, wie viele der für Sie sichtbaren Anwendungen geprüft sind, zu prüfen sind oder noch zu vervollständigende Klassifizierungsfelder haben, sowie die Punkte, die Handlung erfordern. Jede Zahl öffnet die entsprechend gefilterte Anwendungsliste. Siehe [Mein Dashboard](my-dashboard.md#compliance).

**Filterung**:
- Schnellsuche: gleicht Name und Editor/Herausgeber ab
- Die Filter für Kritikalität, Cyberkritikalität, Datenklasse und Wiederanlaufwelle listen ihre Werte in Katalogreihenfolge (die kritischste zuerst, Wellen in Wiederherstellungsreihenfolge).
- Die meisten Spalten verwenden Kontrollkästchen-Set-Filter, die nur Werte anzeigen, die im aktuellen Ergebnissatz vorhanden sind. **Alle** wählt alle Werte aus, **Keine** hebt die Auswahl aller Werte auf. Der schwebende Filter zeigt `Alle`, `Keine` oder `N ausgewählt` mit einem **x** zum Löschen.
- Außer Betrieb genommene Anwendungen sind standardmäßig ausgeblendet; verwenden Sie den **Lebenszyklus**-Filter, um Außer Betrieb einzuschließen.
- **Zu prüfende Schwachstellen** filtert nach **Mit schwerwiegenden Schwachstellen**, **Mit Schwachstellen** oder **Ohne** und sortiert nach den kritischen oder hohen Schwachstellen, dann nach der Gesamtzahl. Deaktivierte Anwendungen stehen zuletzt und fallen unter keinen Filterwert.

**Aktionen**:
- **Neue App / Dienst**: Einen neuen Eintrag erstellen (`applications:member`)
- **Importieren**: Massenimport aus einer CSV-Datei oder Excel-Arbeitsmappe (`applications:admin`)
- **Exportieren**: Die Anwendungen, die die Liste anzeigt, in eine CSV-Datei oder Excel-Arbeitsmappe exportieren (`applications:admin`). Siehe [Exportoptionen](#export-options).
- **Element kopieren**: Eine ausgewählte Anwendung mit allen Kernbeziehungen duplizieren (`applications:member`). Siehe [Anwendungen kopieren](#anwendungen-kopieren) für Details.
- **Ausgewählte löschen**: Ausgewählte Anwendungen entfernen (`applications:admin`). Eine Anwendung, die Quelle oder Ziel einer Schnittstelle ist, kann nicht gelöscht werden: Deaktivieren Sie sie stattdessen, oder löschen Sie zuerst ihre Schnittstellen. Vor der Bestätigung führt das Fenster diese Anwendungen als behalten auf, mit der Anzahl ihrer Schnittstellen. Die anderen werden mit ihren Bereitstellungen und Verknüpfungen zu anderen Einträgen gelöscht; die Bestätigung zählt die Bereitstellungen

---

## Der Anwendungs-Arbeitsbereich

Klicken Sie auf eine Zeile, um den Arbeitsbereich zu öffnen. Der Arbeitsbereich hat eine **Kopfzeile** mit schnellen Metadaten, eine **Eigenschaftsleiste** auf der rechten Seite (die Identitätskarte der Anwendung, immer sichtbar) und einen **Inhaltsbereich** in der Mitte, der mit jedem Reiter wechselt.

Die Reiter sind **Übersicht**, **Bereitstellungen**, **Schnittstellen**, **Betrieb**, **Compliance**, **Beziehungen** und **Verlauf** (die Änderungen an der Anwendung, siehe [Verlauf der Datensätze](record-history.md)).

### Kopfzeile

Die Kopfzeile zeigt:
- **Anwendungsname** (an Ort und Stelle bearbeitbar)
- **Referenz**: kurze Kennung, die Sie kopieren können
- **Lebenszyklus**-Chip: klicken zum Ändern
- **Geschäftskritikalitäts**-Chip: zeigt die Stufe und öffnet ein Menü mit den Stufen der Organisation
- **Schwerwiegende Schwachstellen**, zum Beispiel „3 schwerwiegend“: die noch zu prüfenden kritischen oder hohen Schwachstellen der Anwendung, in der Farbe der höchsten. Ein Warnsymbol folgt, wenn einige als ausgenutzt bekannt sind. Ein Klick öffnet die Seite [Schwachstellen](vulnerabilities.md), gefiltert auf die Anwendung. Nur angezeigt, wenn die Anwendung welche hat
- **Versions**-Chip (wenn eine Version festgelegt ist): klicken zum Kopieren
- **Go-Live**-Datum
- **Teilen**: Einen teilbaren Link zu diesem Arbeitsbereich kopieren
- **Neue Version**: Den Versionsmigrations-Assistenten starten (siehe [Versionsverwaltung](#versionsverwaltung))
- **In Technologie umwandeln** (`applications:admin` und `infrastructure:member`): siehe [Eine Anwendung in eine Technologie umwandeln](#eine-anwendung-in-eine-technologie-umwandeln)
- **Löschen**, ein Papierkorbsymbol mit seinem Namen im Tooltip (`applications:admin`): eine Anwendung mit Schnittstellen erhält die Ablehnung und den Grund, nur mit Schließen. Sonst nennt die Bestätigung die Anwendung und zählt die Bereitstellungen, die mit ihr gelöscht werden, zusammen mit ihren Verknüpfungen zu anderen Einträgen
- **Vorherige / Nächste**: Durch die gefilterte Liste navigieren, ohne zum Raster zurückzukehren

### Eigenschaftsleiste (rechtes Panel)

Die Leiste ist die Identitätskarte der Anwendung. Sie wird in jedem Reiter angezeigt und wird inline bearbeitet: Änderungen werden automatisch gespeichert.

**Identität**:
- **Kategorie**, **Lieferant**, **Herausgeber**
- **Enthalten in**: die Suiten, zu denen diese Anwendung gehört. Wählen Sie eine unter **Suite hinzufügen**: Die Liste bietet die Anwendungen an, bei denen **Kann untergeordnete Anwendungen haben** aktiviert ist. Jeder Name öffnet die Suite. Um eine zu entfernen, fahren Sie mit der Maus über ihren Namen und klicken Sie auf das Kreuz am Zeilenende. Eine Suite kann zu einer anderen Suite gehören, aber eine Verknüpfung, die eine Schleife bilden würde, wird abgelehnt (zum Beispiel eine Suite in einer ihrer eigenen Komponenten)

**Version und Lebenszyklus-Daten**:
- **Version**. Darunter öffnet **Vorherige Version** die Anwendung, aus der diese mit **Neue Version** erstellt wurde, und **Nächste Version** die Anwendungen, die aus ihr erstellt wurden. Diese Links erscheinen nur, wenn es solche Anwendungen gibt
- **Go-Live**, **Support-Ende**, **Außerbetriebnahmedatum**. **Support-Ende** und **Außerbetriebnahmedatum** dürfen nicht vor dem **Go-Live** liegen

**Geschäftsprozesse und Verantwortliche**:
- **Geschäftsprozesse**: die Prozesse, die die Anwendung unterstützt. Jeder Name öffnet den Prozess. Tippen Sie in das Feld, um einen Prozess zu suchen und hinzuzufügen; fahren Sie mit der Maus über einen Namen und klicken Sie auf das Kreuz, um ihn zu entfernen. Jede Änderung wird sofort gespeichert. Der Prozess zeigt dieselbe Verknüpfung in seinem eigenen Abschnitt **Anwendungen**. Ein deaktivierter Prozess bleibt ausgegraut aufgeführt. Das Ändern der Liste erfordert zusätzlich `business_processes:member`; ohne Leserecht für Geschäftsprozesse ist das Feld ausgeblendet.
- **Business-Verantwortliche**: Geschäftliche Stakeholder, die für diese Anwendung rechenschaftspflichtig sind (Mehrfachauswahl)
- **IT-Verantwortliche**: IT-Teammitglieder, die für den technischen Support verantwortlich sind (Mehrfachauswahl)

Um einen Verantwortlichen zu entfernen, fahren Sie mit der Maus über den Namen und klicken Sie auf das Kreuz am Zeilenende.

Wenn Sie einen Verantwortlichen, einen Geschäftsprozess, eine Suite oder einen Supportkontakt entfernen, erscheint eine Meldung mit **Rückgängig**, die ihn wiederherstellt.

**Zielgruppe**:
- Fügen Sie Zeilen für **Unternehmen / Abteilungen** hinzu, um aufzuzeichnen, wer diese Anwendung nutzt. Wählen Sie ein Unternehmen aus und schränken Sie optional auf bestimmte Abteilungen ein.
- Eine Zeile unter der Zielgruppe sagt, was sie abdeckt. Ohne ausgewählte Abteilung ist die Zielgruppe das ganze Unternehmen. Mit ausgewählten Abteilungen sind es nur diese Abteilungen: Entfernen Sie sie, um wieder das ganze Unternehmen einzubeziehen.
- Eine Live-Zählung der **Benutzer** wird angezeigt.
- **Berechnungsmethode**: **Abgeleitet** (aus der Zielgruppe basierend auf Stammdaten-Metriken IT-Benutzer / Mitarbeiterzahl berechnet) oder **Manuell** (eine einzelne Überschreibungszahl, die Sie eingeben).

---

### Übersicht

Der Reiter Übersicht ist die Erzählung der Anwendung. Er enthält:

**Beschreibung**: Eine Rich-Text-Beschreibung der Anwendung. Der Editor speichert automatisch beim Tippen. Wer die Anwendung bearbeiten darf, darf auch ihre Beschreibung bearbeiten, ohne Berechtigung für die Wissensdatenbank. Die Beschreibung wird als verwaltetes Dokument in der Wissensdatenbank geführt. Ihr Titel enthält die Referenz und den Namen der Anwendung, in der Sprache der Person, die sie erstellt hat. Wird die Anwendung umbenannt, im Arbeitsbereich oder per Import, folgt dieser Titel.

**Verbindungen**: Eine schreibgeschützte Zusammenfassung, die aus den Schnittstellen der Anwendung erstellt wird. Bei Nicht-Middleware-Apps zeigt sie zwei Zeilen: **Empfängt von** und **Sendet an**. Bei ETL/Middleware-Apps zeigt sie eine einzelne Zeile **Verbunden mit**. Jeder Eintrag ist eine anklickbare Pille, die die zugehörige Anwendung öffnet; „+ N weitere in Schnittstellen" springt zum Reiter Schnittstellen.

**Wissensdatenbank**: Verknüpfte Wissensartikel. Mit `knowledge:member` können Sie neue Artikel direkt aus diesem Bereich erstellen.

**Support**:
- Eine Tabelle mit Supportkontakten, die aus Ihren Kontakte-Stammdaten gezogen werden. Jede Zeile zeigt den Kontaktnamen, die E-Mail, das Telefon und eine Freitext-Rolle (z. B. Account-Manager, L1-Support).
- **Kontakt hinzufügen** öffnet einen Dialog zur Auswahl eines Kontakts und zur Festlegung einer Rolle.
- **Support-Notizen**: Freitext für Supportvereinbarungen (SLA, Eskalationspfade, Bereitschaftsinformationen).

---

### Bereitstellungen

Der Reiter Bereitstellungen dokumentiert, wo die Anwendung tatsächlich läuft: ein Block pro Umgebung, mit den jeweils zugeordneten Servern.

**Umgebungen**: Production, Pre-prod, QA, Test, Dev, Sandbox.

**Für jede Bereitstellung können Sie erfassen**:
- **Lebenszyklus**: pro Umgebung Status (Aktiv, Vorgeschlagen, Veraltet, Außer Betrieb usw.)
- **Basis-URL**: die Zugriffs-URL für diese Umgebung
- **SSO aktiviert** / **MFA unterstützt**
- **Notizen**

**Bereitstellung hinzufügen** öffnet einen Dialog, in dem Sie Umgebung, Lebenszyklus, Basis-URL, SSO/MFA-Flags und Notizen festlegen. Jede Umgebung kann nur einmal hinzugefügt werden. Der Lebenszyklus-Chip auf einer Bereitstellungs-Kopfzeile kann auch inline aus einem Popup-Menü geändert werden. Eine Bereitstellung, die noch Server oder Schnittstellenbindungen hat, kann nicht gelöscht werden: Entfernen Sie diese zuerst.

**Server pro Bereitstellung**: Jeder Bereitstellungsblock zeigt eine Tabelle der zugewiesenen Server:

| Spalte | Was sie zeigt |
|--------|---------------|
| **Server** | Asset-Name (anklickbar) |
| **Rolle** | z. B. Web, Datenbank, Anwendung (aus der Server-Rollen-Liste in den Einstellungen) |
| **Hosting** | Abgeleitet vom Standort des Assets |
| **Seit** | Datum, an dem der Server dieser Bereitstellung zugewiesen wurde |

Klicken Sie in der Bereitstellungs-Kopfzeile auf **Server hinzufügen**, um ein Asset anzuhängen. Die Auswahl listet die Cluster mit ihren Mitgliedern unter ihrem Namen. Die Zuordnung eines Clusters erreicht seine Mitglieder in Betrieb: Sie erscheinen unter der Zeile des Clusters, ohne Aktionen. Ändern Sie die Zuordnung am Cluster. Wenn Sie ein Mitglied eines Clusters wählen, fragt KANAP, ob dem Cluster oder nur diesem Server zugeordnet wird. Siehe [Anwendungen auf einem Cluster](assets.md#applications-on-a-cluster). Das Hinzufügen, Ändern oder Entfernen eines Servers erfordert `applications:member` und `infrastructure:member`.

Ist die Anwendung jedem Mitglied in Betrieb eines Clusters direkt zugeordnet, nennt eine Zeile unter der Tabelle diese Mitglieder, mit einer Schaltfläche, die die Anwendung dem Cluster zuordnet (der Name des Clusters, dann **zuordnen**). Nach einer Bestätigung übernimmt der Cluster die Zuordnung, und die eigenen Zuordnungen der Mitglieder werden entfernt. Die Anwendung bleibt dann verfügbar, solange ein Mitglied läuft.

**Tipp**: Dokumentieren Sie Server zuerst in **IT-Landschaft > Assets** und verknüpfen Sie sie dann hier. Der Reiter Betrieb des Assets zeigt dieselben Zuordnungen umgekehrt an, unter **Gehostete Anwendungen**.

---

### Schnittstellen

Der Reiter Schnittstellen zeigt alle Integrationen, an denen diese Anwendung beteiligt ist: als Quelle, Ziel oder Middleware. Das Reiter-Badge zeigt die Gesamtzahl an.

Schnittstellen werden **nach Umgebung gruppiert** (PROD, PRE_PROD, QA, ...). Innerhalb jeder Umgebung werden sie aufgeteilt in:

- **Eingehend**: diese Anwendung empfängt Daten
- **Ausgehend**: diese Anwendung sendet Daten
- **Geleitet**: diese Anwendung ist die Middleware/ETL für einen Fluss zwischen zwei anderen Apps

Jede Zeile zeigt den Schnittstellennamen, die Gegenanwendung und einen Indikator **Via Middleware**. Klicken Sie auf die Zeile, um den Schnittstellen-Arbeitsbereich zu öffnen; klicken Sie auf die Gegenanwendung, um die andere Anwendung zu öffnen.

**Tipp**: Schnittstellen werden über die Schnittstellen-Seite verwaltet. Dieser Reiter ist eine bequeme schreibgeschützte Ansicht, aber er ist der schnellste Weg, um zwischen verbundenen Anwendungen zu navigieren.

---

### Betrieb { #operations }

Der Reiter Betrieb enthält in dieser Reihenfolge, wie Benutzer auf die Anwendung zugreifen (**Technik**), die Technologien, von denen sie abhängt, und ihre Schwachstellen.

**Technik**:
- **Zugriffsmethoden** (Mehrfachauswahl): Wie Benutzer auf diese Anwendung zugreifen. Optionen sind in den [IT-Landschaft-Einstellungen](it-ops-settings.md) konfigurierbar. Standards umfassen Web, Lokal installierte Anwendung, Mobile Anwendung, Proprietäre HMI (industrielle Schnittstelle), Terminal / CLI, VDI / Remote Desktop, Kiosk.
- **Extern erreichbar**: Ob die Anwendung aus dem Internet zugänglich ist
- **Datenintegration / ETL**: Ob die Anwendung an Datenintegrations-Pipelines teilnimmt (versetzt diese App auch in den „Middleware"-Modus für die Schnittstellen- und Verbindungsansichten)
- **Kann Unteranwendungen haben**: Diese Anwendung in eine Suite verwandeln, die andere Anwendungen gruppiert. Solange Anwendungen in der Suite enthalten sind, können Sie das Kontrollkästchen nicht deaktivieren: Entfernen Sie sie zuerst aus der Suite

**Technologien** listet, wovon die Anwendung abhängt, aus zwei Quellen, die die Spalte **Verknüpfung** angibt. Spalten: Referenz (`TEC-4`), Name, Familie, Versionen, Verknüpfung, Server, über die sie kommt (**Über**), Ende des Standardsupports.

- **Deklariert**: Jemand hat die Technologie mit der Anwendung verknüpft, zum Beispiel Entra ID für eine Anwendung, deren Benutzer sich darüber anmelden.
- **Gehostet**: Ein Server einer ihrer Bereitstellungen trägt die Technologie, auch ein Mitglied eines Clusters, dem sie zugeordnet ist. **Über** nennt den Server und den Host, wenn die Technologie auf dem Host einer virtuellen Maschine läuft. Deaktivierte Bereitstellungen zählen nicht.

Eine Technologie kann beides sein. Ein Strich in der Versionsspalte bedeutet, dass die Version unbekannt ist. Das Ende des Standardsupports wird orange, sobald es überschritten ist. Der Abschnitt erfordert `infrastructure:reader`.

**Eine Technologie hinzufügen**: Klicken Sie auf **Hinzufügen**, wählen Sie die Technologie und dann ihre Version: eine vorhandene, eine neue, die Sie eingeben, oder **Version unbekannt**. Hat die Anwendung Bereitstellungsserver in Betrieb, bietet ein letzter Schritt an, die Technologie in derselben Version auf diesen Servern zu erfassen, zum Beispiel „PHP 8.2 auch erfassen auf“. Jeder Server zeigt seine Umgebungen und Rollen. Nichts ist angehakt: Haken Sie die Server an, auf denen sie läuft, und klicken Sie dann auf **Hinzufügen**. Ein Server, der die Technologie bereits trägt, zeigt **Bereits erfasst** und behält seine eigene Version. Ein Betriebssystem wird hier nicht angeboten: Erfassen Sie es auf der Seite des Servers. Das Schließen der Liste fügt nichts hinzu.

**Eine deklarierte Technologie ändern**: Klicken Sie auf ihre Version, um eine andere zu wählen. Trägt kein Server der Anwendung eine deklarierte Technologie, bietet das Serversymbol am Zeilenende (**Auf einem Server erfassen**) dieselbe Serverliste an. Eine gehostete Technologie wird am Server geändert: Klicken Sie unter **Über** auf den Server, um seine Seite zu öffnen.

Um eine deklarierte Technologie hinzuzufügen, zu ändern oder zu entfernen und sie auf Servern zu erfassen, brauchen Sie `applications:member` und `infrastructure:member`. Eine gehostete Technologie hat kein Kreuz: Entfernen Sie sie am Server.

**Schwachstellen** (wenn Schwachstellen verfolgt werden) listet die noch zu prüfenden Schwachstellen der Anwendung, in den Warnungen. Die Zahl neben dem Titel ist die Zahl der verschiedenen zu prüfenden Schwachstellen: Ein Klick darauf öffnet die Seite [Schwachstellen](vulnerabilities.md), gefiltert auf die Anwendung. Eine Zeile pro Technologie und Version:

| Spalte | Was sie zeigt |
|---|---|
| **Technologie**, **Version** | Die Technologie und ihre Version. **Version nicht erfasst (möglicherweise betroffen)**, wenn keine Version genannt ist |
| **Server** | Die Bereitstellungsserver, die diese Technologie und Version selbst erfasst haben. **Deklariert**, wenn die Anwendung sie deklariert und kein Server sie hat. **Auf einem Server erfassen** bietet dann ihre Bereitstellungsserver an, wie in **Technologien** |
| **Krit.**, **Hoch**, **Mittel**, **Niedrig**, **N. bew.** | Eine Spalte pro Schweregrad (Kritisch, Hoch, Mittel, Niedrig, Nicht bewertet, der volle Name im Tooltip der Überschrift): die noch zu prüfenden Schwachstellen. Eine mit **Keine** bewertete Schwachstelle zählt bei **Niedrig** |
| **Gesamt** | Die verschiedenen noch zu prüfenden Schwachstellen dieser Zeile |

**Ansehen** öffnet die Seite [Schwachstellen](vulnerabilities.md), gefiltert auf die Anwendung und die Technologie. Wenn nichts mehr zu prüfen ist, sagt der Abschnitt es in einer Zeile. Solange KANAP ein Produkt zum ersten Mal aus der NVD liest oder den Abgleich einer Technologie ausführt, die gerade auf dieser Anwendung oder auf einem ihrer Bereitstellungsserver erfasst wurde, zeigt der Abschnitt „Suche nach Schwachstellen läuft…“ und füllt sich von selbst. Wenn die Suche nicht abgeschlossen werden kann, sagt der Abschnitt das. Eine deaktivierte Anwendung hat keinen Abschnitt.

Der Abschnitt zählt nur direkte Verknüpfungen. Eine Technologie, die der Abschnitt **Technologien** über den Host einer virtuellen Maschine zeigt, zählt hier nicht: Sie zählt auf dem Host. Siehe [Was KANAP zählt](vulnerabilities.md#what-kanap-counts).

Wer Anwendungen lesen darf, aber nicht die Infrastruktur, sieht diesen Abschnitt, das Badge in der Kopfzeile und die Spalte der Liste trotzdem, für die Anwendungen, die er lesen darf.

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
- Personenbezogene Daten, geschäftliche und Cyber-Kritikalität sowie das Hosting der Instanzen entscheiden auch, welche Klauseln die mit der Anwendung verknüpften Verträge enthalten sollten. Siehe den Reiter **Konformität** unter [Verträge](contracts.md#konformitat).

**Kontinuität und Wiederanlauf**:
- Die **Wiederherstellungswelle** bezeichnet die Reihenfolge der Wiederherstellung, keine Dauer und keinen Schweregrad.
- Das **RTO** ist das Ziel für die Wiederherstellungszeit. Das **RPO** ist der zulässige Datenverlust und darf null sein. Erreicht das RTO die maximal tolerierbare Ausfallzeit, die auf der gewählten Geschäftsstufe definiert ist, zeigt KANAP einen Hinweis, behält aber beide Werte.
- Unter der Welle listet KANAP die Schnittstellen auf, die diese Anwendung mit einer Anwendung in einer **späteren** Welle verbinden („Austausch mit CRM, geplant in V3"), mit einem Link zu jeder Schnittstelle. Beide Anwendungen müssen laufen, damit der Fluss funktioniert; der Verantwortliche des Wiederherstellungsplans entscheidet. Außer Betrieb genommene Schnittstellen werden ignoriert, und Benutzer mit eingeschränktem Bereich als Fachbereichs-Mitwirkender sehen diese Liste nicht.
- **Letzter Wiederherstellungstest** enthält das Datum des letzten Tests. Ein Link aus diesem Bereich verwendet die einzige **Wissensdatenbank** im Reiter Übersicht und erzeugt keinen doppelten Datensatz. Ältere URL-Links bleiben unter Beziehungen verfügbar.

Zwei dezente Hinweise können erscheinen: Daten auf der höchsten Vertraulichkeitsstufe in Kombination mit der niedrigsten Cyber-Kritikalität sowie eine Anwendung auf der kritischsten Geschäftsstufe ohne Wiederherstellungstest in den letzten zwölf Monaten. Sie blockieren nie etwas.

**Review**:
- Die **Begründung** dokumentiert, warum die Stufen gewählt wurden und worauf der Wiederherstellungsplan beruht.
- Das Review ist ein Zeitstempel: **Als geprüft markieren** hält fest, wer die Klassifizierung wann geprüft hat. Die Aktion steht zur Verfügung, sobald Geschäftskritikalität, Cyberkritikalität, Datenvertraulichkeit, Wiederanlaufwelle und Begründung vorhanden sind.
- Prüfdatum und Prüfer bleiben danach sichtbar. Ändert sich nach dem Review ein Klassifizierungswert, eine Wiederanlaufreferenz oder die Datenresidenz, zeigt der Reiter **Seit der Prüfung geändert** und die Liste **Erneut prüfen**. Eine Änderung von Name oder Herausgeber hat keine Auswirkung. Eine Änderung des Katalogs in den Einstellungen macht ein Review nie ungültig.

### Beziehungen

Der Reiter Beziehungen zeigt, womit diese Anwendung verknüpft ist: ihre Budgetzeilen, Verträge, Projekte, Anfragen, Aufgaben und Vorfälle, jeweils in einer eigenen Tabelle, danach ihre Links und Dateien. Die Technologien stehen im Reiter [Betrieb](#operations), die Geschäftsprozesse in der [Eigenschaftsleiste](#eigenschaftsleiste-rechtes-panel). Klicken Sie auf eine Zeile, um den Datensatz zu öffnen. Das Reiter-Badge zählt die verknüpften Budgetzeilen, Verträge, Projekte, Anfragen und Vorfälle sowie die Links und Dateien. Aufgaben werden nicht gezählt.

**Komponenten** (nur wenn „Kann Unteranwendungen haben" aktiviert ist): eine Tabelle, die die Unteranwendungen dieser Suite mit ihrem Lebenszyklus und ihrer Kritikalität auflistet. Klicken Sie auf eine Zeile, um den Arbeitsbereich der Unteranwendung zu öffnen.

**Verknüpfte Datensätze**, jeweils eine Tabelle:

| Abschnitt | Spalten |
|---|---|
| **Budgetzeilen** | Referenz (`BL-12`), Name, Typ (OPEX oder CAPEX), Lieferant und der Betrag des laufenden Jahres in Ihrer Standard-Budgetspalte, in der Berichtswährung. Ein Strich bedeutet, dass die Zeile für das Jahr kein Budget hat |
| **Verträge** | Name, Lieferant, Ende der laufenden Laufzeit, Jahresbetrag in der Vertragswährung, Verlängerung (stillschweigend oder manuell) |
| **Projekte** | Referenz (`PRJ-7`), Name, Status, geplantes Ende |
| **Anfragen** | Referenz (`REQ-23`), Name, Status, gewünschte Lieferung |
| **Aufgaben** | Referenz (`T-118`), Titel, Status, zugewiesene Person, Fälligkeit. Es erscheinen nur die Aufgaben, die mit dieser Anwendung selbst verknüpft sind, nicht die Aufgaben ihrer Projekte |
| **Vorfälle** | Referenz (`INC-14`), Titel, Schweregrad, Status, Erkennungsdatum |

Ein vertraulicher Vorfall erscheint nur für die Personen, die ihn im Vorfallregister sehen dürfen, und ohne seinen Titel.

Orange Daten verlangen Aufmerksamkeit: ein Vertrag, dessen Verlängerungsentscheidung in Ihr Entscheidungsfenster für Verträge fällt, oder eine offene Aufgabe nach ihrer Fälligkeit. Eine deaktivierte Budgetzeile oder ein deaktivierter Vertrag bleibt mit ausgegrautem Namen aufgeführt. Sie sehen nur die Abschnitte der Module, die Sie lesen dürfen.

Ab zwei Zeilen enden Budgetzeilen und Verträge mit einer Summenzeile. Die Summe der Budgetzeilen steht in der Berichtswährung. Eine Zeile, deren Währung für das Jahr keinen Wechselkurs hat, zeigt ihren Betrag in ihrer eigenen Währung mit einer kleinen orangefarbenen Markierung, und die Summe lässt sie aus. Ein einzeiliger Hinweis unter der Tabelle nennt sie, zum Beispiel „1 Zeile ohne Wechselkurs ausgeschlossen: USD 2026.“ Siehe [Manuelle Kurse](currencies.md#manuelle-kurse). Verträge erhalten eine Summe je Währung, ohne die deaktivierten Verträge.

**Verknüpfungen hinzufügen und entfernen** (`applications:member`): **Hinzufügen** rechts neben einem Abschnitt öffnet eine Suche. Geben Sie einen Namen oder eine Referenz ein und wählen Sie ein Ergebnis: Die Verknüpfung wird sofort gespeichert. Um eine Verknüpfung zu entfernen, fahren Sie mit der Maus über die Zeile und klicken Sie auf das Kreuz am Zeilenende. Das Entfernen einer Verknüpfung löscht nichts anderes. Das Verknüpfen oder Lösen eines Vorfalls erfordert zusätzlich `incidents:contributor` und wird im Journal des Vorfalls festgehalten. Ein geschlossener oder abgebrochener Vorfall kann weder verknüpft noch gelöst werden: Öffnen Sie ihn zuerst wieder.

**Verwandt**: Vorschläge von Datensätzen, die Sie verknüpfen könnten, jeweils mit dem Grund des Vorschlags:

- Verträge und Budgetzeilen des Lieferanten der Anwendung;
- Budgetzeilen eines verknüpften Vertrags oder eines verknüpften Projekts;
- Projekte, die eine mit der Anwendung verknüpfte Aufgabe enthalten.

Klicken Sie auf **Verknüpfen**, um den Vorschlag seinem Abschnitt hinzuzufügen. Der Abschnitt fehlt, wenn es nichts vorzuschlagen gibt.

**Ebenfalls verknüpft**: Eine Zeile unter den Vorschlägen zählt die Assets der Bereitstellungen der Anwendung, ihre Schnittstellen und ihre Wissensdokumente. Jede Zahl öffnet den passenden Reiter oder Abschnitt.

**Links und Dateien**: die Weblinks der Anwendung (Lieferantenportale, Monitoring-Dashboards, Dokumentation) und ihre Dateien, je eine Zeile mit Name, der Domain des Links oder der Größe der Datei und dem Datum, an dem sie hinzugefügt wurden. Klicken Sie auf einen Link, um ihn in einem neuen Tab zu öffnen, oder auf eine Datei, um sie herunterzuladen. Mit `applications:member`:

- **Link hinzufügen** öffnet einen Dialog für eine URL und einen optionalen Namen; der Link wird sofort gespeichert. Um einen Link zu ändern, fahren Sie mit der Maus über seine Zeile und klicken Sie auf den Stift.
- **Datei anhängen** öffnet die Dateiauswahl. Sie können Dateien auch auf den Abschnitt ziehen: Er wird während des Ziehens hervorgehoben.
- Um einen Link oder eine Datei zu entfernen, fahren Sie mit der Maus über die Zeile und klicken Sie auf das Kreuz. Das Entfernen eines Links zeigt eine Meldung und bietet **Rückgängig** an, womit der Link wieder angelegt wird. Das Löschen einer Datei fragt zuerst nach einer Bestätigung.

---

## Eine Anwendung in eine Technologie umwandeln

Manche Einträge wurden als Anwendungen angelegt, obwohl sie Technologien sind: eine Datenbank-Engine, ein Verzeichnisdienst, ein Anwendungsserver. **In Technologie umwandeln** in der Kopfzeile macht aus einem solchen Eintrag eine [Technologie](technologies.md). Wandeln Sie um, wenn eine andere Anwendung ihretwegen ausfallen oder verwundbar werden kann.

Sie benötigen `applications:admin` und `infrastructure:member`.

Das Fenster prüft zuerst, was die Umwandlung ändert. Wählen Sie eine **Familie** und lesen Sie dann die drei Listen:

- **Geht an die Technologie**: Verantwortliche, Supportkontakte, Verträge, Budgetzeilen, Projekte, Weblinks, Dokumente, Vorfälle und die Server ihrer aktiven Bereitstellungen. Jeder Server wird zu einem Server, der die Technologie trägt, mit unbekannter Version. Ein Cluster gibt seine Mitglieder in Betrieb weiter. Verknüpfungen in Modulen, die Sie nicht lesen dürfen, gehen ebenfalls mit.
- **Bleibt erhalten, ohne Verknüpfung zur Anwendung**: Verwaltete Dokumente bleiben in ihrer Bibliothek, bei den nicht abgelegten Dokumenten.
- **Geht mit der Anwendung verloren**: Bereitstellungen und Umgebungen, Suite-Zugehörigkeit, Vorgänger und Nachfolger, Datenresidenz, die nutzenden Unternehmen und Abteilungen, Wissensverknüpfungen, verknüpfte Aufgaben und Anfragen, Geschäftsprozesse, die Technologien, von denen sie abhängt, und die Felder, die nur Anwendungen haben (Benutzer, Zugriffsarten, SSO, MFA, personenbezogene Daten). Auch ihre `APP`-Referenz entfällt.

Die Technologie behält Name, Hersteller, Beschreibung, Notizen, Support-Notizen, Lebenszyklus, Cyberkritikalität und die Wiederanlauffelder. Jeder Supportkontakt wird einmal gelistet, mit der ersten Rolle, die er hatte. Das Fenster nennt den Hosting-Typ, den die Technologie erhält. Mit Servern ist es der Hosting-Typ ihrer Standorte (der mit den meisten Servern), sonst **On-Premise**. Ohne Server ist es das **Hosting** der Anwendung, sonst **SaaS**. Sie können ihn danach bei der Technologie ändern. **Umwandeln** legt die Technologie an, löscht die Anwendung und öffnet den neuen Eintrag. Das Audit-Log behält die alte Referenz.

**Bei Ablehnung**: Das Fenster listet die Gründe, und **Umwandeln** bleibt gesperrt. Eine Anwendung lässt sich nicht umwandeln, solange sie Quelle, Ziel oder Middleware von Schnittstellen ist, Integrationswerkzeug von Schnittstellenbindungen, eine Suite mit Komponenten, oder Schnittstellenbindungen auf ihren Bereitstellungen trägt. Eine Technologie gleichen Namens, Werte, die eine Technologie nicht annehmen kann (auch eine Liste **Hosting-Typen** ohne Typ in Verwendung), oder im Speicher fehlende Dateien verhindern sie ebenfalls. Entfernen Sie zuerst diese Verknüpfungen, oder behalten Sie den Eintrag als Anwendung.

---

## Versionsverwaltung

KANAP bietet **zwei Wege zur Verwaltung von Anwendungsversionen**, je nachdem, wie Ihre Organisation Upgrades handhabt:

| Ansatz | Am besten für | Was passiert |
|----------|----------|--------------|
| **Einfach** | Die meisten Anwendungen | Versionsfelder in der Eigenschaftsleiste oder im Erstellungsformular aktualisieren: gleicher Datensatz, neue Versionsnummer |
| **Erweitert** | Große Migrationen | **Neue Version** verwenden, um einen neuen Anwendungsdatensatz mit Versionsnachverfolgung zu erstellen: alte und neue Versionen parallel betreiben |

### Einfache Versionsverfolgung (In-Place-Updates)

Für die meisten Anwendungen (bei denen Sie upgraden und die alte Version einfach verschwindet) aktualisieren Sie **Version**, **Go-Live**, **Support-Ende** und **Außerbetriebnahmedatum** im Erstellungsformular oder in der Eigenschaftsleiste. Der Versions-Chip in der Kopfzeile und die **Go-Live**-Metadaten spiegeln Ihre Einstellungen wider.

Dieser Ansatz hält alles in einem einzigen Datensatz. Wenn Sie ein Upgrade durchführen, aktualisieren Sie die Versionsfelder und Sie sind fertig. Der Reiter **Verlauf** bewahrt die früheren Werte.

**Verwenden Sie dies, wenn**: Upgrades vor Ort ohne Überlappung erfolgen: eine Version ersetzt eine andere.

### Eine neue Version erstellen (Parallelmigrationen)

Für größere Anwendungsupgrades, bei denen Sie alte und neue Versionen parallel über verschiedene Umgebungen betreiben müssen (z. B. SAP S/4HANA 1909 in Prod, während 2023 in QA ist), verwenden Sie **Neue Version** in der Kopfzeile des Arbeitsbereichs.

Der Assistent hat drei Schritte:

1. **Versionsdetails**: Neuen Anwendungsnamen, Versionsbezeichnung, **Go-Live**- und **Support-Ende**-Daten. Der Name muss frei sein (siehe [Eindeutige Namen](#unique-names)), und das **Support-Ende** darf nicht vor dem **Go-Live** liegen.
2. **Kopieroptionen**: wählen, was von der Quelle kopiert wird. Standardwerte unten gezeigt.
3. **Schnittstellen**: wählen, welche Schnittstellen zur neuen Version migriert werden sollen.

Die neue Version wird als separate Anwendung erstellt mit:
- Einem **Vorgeschlagen**-Lebenszyklus (bereit zur Konfiguration vor dem Go-Live)
- Einem Link zu seinem Vorgänger (verwendet von der Versions-Zeitleiste)
- Kopierten Daten basierend auf Ihren Auswahlen
- Duplizierten Schnittstellen, die auf die neue Version verweisen

Nach dem Erstellen nennt eine Meldung die Referenz der neuen Version. Die beiden Anwendungen sind dann in der Eigenschaftsleiste über **Vorherige Version** und **Nächste Version** miteinander verknüpft.

Klassifizierungs- und Kontinuitätswerte werden kopiert, die neue Version beginnt jedoch mit einem zurückgesetzten Review und ohne kopierten letzten Wiederherstellungstest.

### Was kopiert wird

| Option | Standard |
|--------|---------|
| Verantwortliche (Business und IT) | Ein |
| Unternehmen (Zielgruppe) | Ein |
| Abteilungen | Ein |
| Datenhaltung | Ein |
| Links | Ein |
| Supportkontakte | Ein |
| Budgetzeilen (OPEX + CAPEX, gepaart) | Ein |
| Verträge | Ein |
| Bereitstellungen | Aus |
| Bereitstellungs-Bindungen | Aus (nur verfügbar, wenn Bereitstellungen ausgewählt ist) |

**Immer kopiert**: die Beschreibung, die Geschäftsprozesse, die Zugriffsmethoden, die Kontrollkästchen **Extern zugänglich**, **Datenintegration / ETL** und **Kann untergeordnete Anwendungen haben** sowie die manuell erfasste Benutzerzahl.

**Nicht kopiert** (muss neu eingerichtet werden): Suite-Mitgliedschaft, Anhänge, die Daten der Quelle, der letzte Wiederherstellungstest, die Klassifizierungsprüfung und Server-Zuweisungen. Der Assistent listet sie auf.

### Schnittstellenmigration

Während der Versionserstellung zeigt der Assistent alle Schnittstellen an, bei denen diese Anwendung Quelle, Ziel oder Middleware ist (wenn ETL aktiviert ist). Ausgewählte Schnittstellen werden mit auf die neue Version aktualisierten Referenzen dupliziert. Jede migrierte Schnittstelle enthält ihre Legs, Verantwortlichen, Unternehmen, Schlüsselkennungen, Verknüpfungen, Datenhaltung und ihre Spezifikation (der Text der Quelle und ihre Bilder). Eine leere Schnittstellen-ID bleibt leer. Migrierte Schnittstellen starten mit einem **Vorgeschlagen**-Lebenszyklus. Die ursprünglichen Schnittstellen bleiben mit der alten Version verknüpft.

**Bindungen kopieren**: Wenn Sie sowohl **Bereitstellungen** als auch **Bereitstellungs-Bindungen** auswählen, werden auch Schnittstellen-Bindungen kopiert. Bindungen werden den Bereitstellungen der neuen Anwendung zugeordnet (nach Umgebung abgeglichen); umgebungsspezifische Details (Endpunkte, Authentifizierung, Job-Namen) werden gelöscht, und der Bindungsstatus wird auf **Vorgeschlagen** zurückgesetzt.

**ETL/Middleware-Anwendungen**: Wenn die Anwendung **Datenintegration / ETL** aktiviert hat, zeigt der Assistent auch Schnittstellen an, die *durch* diese Anwendung als Middleware fließen. Dies sind Schnittstellen, bei denen eine andere Quelle Daten an ein anderes Ziel über Ihren ETL sendet. Das Kopieren erstellt neue Schnittstellendefinitionen für den aufgerüsteten ETL mit ordnungsgemäß aktualisierten Middleware-Referenzen.

**Tipp**: Verwenden Sie dies beim Upgrade Ihres ERP oder ETL: migrieren Sie die kritischen Schnittstellen und kopieren Sie optional Bindungen, um einen Vorsprung bei der Umgebungskonfiguration zu erhalten.

---

## Anwendungen kopieren

Es gibt zwei Möglichkeiten, eine Anwendung in KANAP zu kopieren:

### Element kopieren (aus dem Anwendungsraster)

Verwenden Sie dies, wenn Sie ein unabhängiges Duplikat einer Anwendung erstellen möchten, typischerweise um einen ähnlichen Anwendungseintrag ohne Versionsverkettung zu erstellen.

1. Wählen Sie eine Anwendung im Raster aus
2. Klicken Sie auf **Element kopieren**
3. Das System erstellt eine Kopie mit dem Namen der Quelle und einem Suffix in der Sprache Ihres Bildschirms: „CRM (Kopie)", auf Englisch „CRM (copy)". Ist dieser Name vergeben, wird die Kopie nummeriert: „CRM (Kopie 2)", dann „CRM (Kopie 3)"
4. Sie werden zur neuen Anwendung navigiert, um Änderungen vorzunehmen

**Was kopiert wird**: Alle Kernfelder (außer dem Datum des letzten DR-Tests), einschließlich Klassifizierungs- und Kontinuitätswerten, Verantwortliche, Unternehmen, Abteilungen, Suites, OPEX/CAPEX-Zeilen, Verträge, Verknüpfungen, Datenhaltung und Supportkontakte. Das Review der Kopie wird zurückgesetzt.

**Was NICHT kopiert wird**: Bereitstellungen, Schnittstellen, Server-Zuweisungen, Anhänge, Versionsfelder (Version, Go-Live-Datum, Support-Ende).

### Vergleich: Element kopieren vs. Neue Version

| Aspekt | Element kopieren | Neue Version |
|--------|-----------|-------------------|
| **Zweck** | Unabhängiges Duplikat | Versionierter Nachfolger mit Verkettung |
| **Benutzeroptionen** | Keine (automatisch) | 3-Schritt-Assistent |
| **Verkettung** | Keine Vorgängerverknüpfung | Setzt Vorgänger |
| **Lebenszyklus** | Erhalten | Auf Vorgeschlagen zurückgesetzt |
| **Name** | „(Kopie)"-Suffix, nummeriert, wenn der Name vergeben ist | Vom Benutzer angegeben, muss frei sein |

**Beziehungen**:

| Beziehung | Element kopieren | Neue Version |
|----------|-----------|--------------------|
| Verantwortliche (Business und IT) | Ja | Optional (Standard: ja) |
| Unternehmen (Zielgruppe) | Ja | Optional (Standard: ja) |
| Abteilungen | Ja | Optional (Standard: ja) |
| Datenhaltung | Ja | Optional (Standard: ja) |
| Links | Ja | Optional (Standard: ja) |
| Supportkontakte | Ja | Optional (Standard: ja) |
| Geschäftsprozesse | Nein | Ja |
| Suites (Mitgliedschaft) | Ja | Nein |
| OPEX-Zeilen | Ja | Optional (Standard: ja) |
| CAPEX-Zeilen | Ja | Optional (Standard: ja) |
| Verträge | Ja | Optional (Standard: ja) |
| Bereitstellungen | Nein | Optional (Standard: nein) |
| Bindungen | Nein | Optional (Standard: nein) |
| Schnittstellen | Nein | Vom Benutzer ausgewählt |
| Server-Zuweisungen | Nein | Nein |
| Anhänge | Nein | Nein |

**Kernfelder**:

| Feld | Element kopieren | Neue Version |
|-------|-----------|--------------------|
| Beschreibung | Ja | Ja |
| Zugriffsmethoden | Ja | Ja |
| ETL aktiviert | Ja | Ja |
| Support-Notizen | Ja | Ja |
| Letzter DR-Test | Nein | Nein |
| Versionsfelder | Nein | Vom Benutzer angegeben |
| Benutzer-Überschreibung | Ja | Ja |
| Benutzerjahr | Ja | Auf aktuelles Jahr zurückgesetzt |

---

## CSV-Import/Export

Pflegen Sie Ihr Anwendungsinventar im großen Maßstab mit Import und Export. Diese Funktion unterstützt Massenoperationen für das initiale Datenladen, periodische Updates aus externen Systemen und Datenextraktion für Berichte.

### Zugriff auf CSV-Funktionen

Aus der Anwendungsliste:
- **Exportieren**: Anwendungen in eine CSV-Datei oder Excel-Arbeitsmappe herunterladen
- **Importieren**: Eine CSV-Datei oder Excel-Arbeitsmappe hochladen, um Anwendungen zu erstellen oder zu aktualisieren
- **Vorlage herunterladen** (im Import-Dialog): Eine leere CSV mit korrekten Spaltenköpfen erhalten

**Erforderliche Berechtigungen**: `applications:admin` für Import-/Export-Operationen.

### Exportoptionen { #export-options }

**Inhalt der Datei**: die Anwendungen, die die Liste anzeigt. Der Export folgt den Spaltenfiltern, der Schnellsuche und der Auswahl **Anzeigen** (**Meine Anwendungen**, **Anwendungen meines Teams** oder **Alle Anwendungen**). Der Dialog nennt die Zahl der Anwendungen, die die Datei enthalten wird. Ohne Filter auf **Lebenszyklus** fehlen außer Betrieb genommene Anwendungen, wie in der Liste. Die Zeilen behalten die Reihenfolge der Liste.

**Format**: **CSV** oder **Excel (.xlsx)**, im Dialog gewählt und von Ihrem Browser gespeichert. Die Arbeitsmappe enthält dieselben Spalten wie die CSV-Datei auf einem Blatt, mit Zahlen und Datumsangaben als Werte, die Excel sortieren und filtern kann. Der Import liest beides; in einer Arbeitsmappe liest er das erste Blatt. Siehe [CSV- und Excel-Dateien](csv-files.md).

**Spalten**: Die Datei beginnt mit `id` und `reference` (`APP-12`), dann folgen die Spalten dem Arbeitsbereich, Registerkarte für Registerkarte. Der Import ignoriert `reference`.

**Sprache der Werte**: Katalogwerte (Kategorie, Lebenszyklus, Kritikalität, Cyberkritikalität, Wiederherstellungswelle, Datenklasse, Zugriffsmethoden) und der Status werden so geschrieben, wie der Bildschirm sie zeigt, in der Sprache Ihres Bildschirms: `Active` auf Englisch, `Aktiv` auf Deutsch. Ein Name, den Ihre Organisation einem Wert unter **IT-Landschaft > Einstellungen** gegeben hat, bleibt unverändert.

**Voreinstellungen**:

| Voreinstellung | Beschreibung |
|--------|-------------|
| **Vollständiger Export** | Alle exportierbaren Felder einschließlich berechneter/schreibgeschützter Daten (Zeitstempel, Datenhaltung, Benutzermetriken) |
| **Datenanreicherung** | Nur importierbare Felder: ideal für Round-Trip-Bearbeitungs-Workflows |

**Vorlagen-Export**: Lädt nur Spaltenköpfe herunter: nützlich für die Vorbereitung von Importdateien mit der korrekten Struktur. Die Vorlage enthält alle importierbaren Felder.

**Benutzerdefinierte Auswahl**: Wählen Sie bestimmte Felder, die in Ihren Export aufgenommen werden sollen.

### Import-Workflow

1. **Datei vorbereiten**: eine CSV-Datei oder eine Excel-Arbeitsmappe (`.xlsx`). Speichern Sie eine CSV-Datei als UTF-8. Kommas und Semikolons funktionieren beide, ebenso eine von Excel als einfache CSV gespeicherte Datei (Windows-1252). Laden Sie eine Vorlage herunter, um korrekte Spaltenköpfe sicherzustellen. Trennzeichen, Beträge, Datumsangaben und Ja oder Nein jeder Sprache stehen unter [CSV- und Excel-Dateien](csv-files.md).

2. **Importeinstellungen wählen**:
   - **Modus**:
     - `Anreichern` (Standard): Leere Zellen erhalten vorhandene Werte: nur aktualisieren, was Sie angeben
     - `Ersetzen`: Ersetzt die Werte der Spalten in der Datei. Eine leere Zelle löscht den gespeicherten Wert, außer in den Klassifizierungsspalten (verwenden Sie dort `__CLEAR__`). Eine Spalte, die in der Datei fehlt, behält ihre Werte. Manche Felder können nicht geleert werden: **Preflight** zeigt sie an.
   - **Operation**:
     - `Upsert` (Standard): Neue Anwendungen erstellen oder vorhandene aktualisieren
     - `Nur aktualisieren`: Nur vorhandene Anwendungen ändern, neue überspringen
     - `Nur einfügen`: Nur neue Anwendungen erstellen, vorhandene überspringen

     Die Operation gilt auch für die Verantwortlichen und die Datenresidenz: Eine Zeile, die die Operation überspringt, lässt sie unverändert.

3. **Zuerst validieren**: Klicken Sie auf **Preflight**, um Ihre Datei ohne Änderungen zu validieren. Überprüfen Sie Fehler und Warnungen.

4. **Änderungen anwenden**: Wenn die Validierung erfolgreich ist, klicken Sie auf **Importieren**, um Änderungen zu übernehmen.

### Zeilenprüfungen

Der Preflight wendet dieselben Regeln an wie der Arbeitsbereich. Eine Zeile wird abgelehnt, wenn:

- ihr Name länger als 200 Zeichen ist oder bereits eine andere Anwendung ihn trägt (siehe [Eindeutige Namen](#unique-names));
- ihr Name zu zwei vorhandenen Anwendungen passt: Fügen Sie die Spalte `id` hinzu, um eine auszuwählen;
- ihre Kategorie oder ihr Lebenszyklus zu keinem Code und keinem Namen des Katalogs passt;
- eine Verantwortlichen-E-Mail zu keinem Benutzer passt;
- ihr **Support-Ende** oder ihr **Außerbetriebnahmedatum** vor ihrem **Go-Live** liegt;
- `is_suite` für eine Suite, die noch Anwendungen enthält, `no` ist.

Eine Datei mit einer einzigen abgelehnten Zeile lädt nichts. Siehe [CSV- und Excel-Dateien](csv-files.md).

### Feldreferenz

**Übersichtsfelder**:

| CSV-Spalte | Beschreibung | Erforderlich | Hinweise |
|------------|-------------|----------|-------|
| `id` | Anwendungs-UUID | Nein | Für Updates; bei neuen Anwendungen leer lassen |
| `name` | Anwendungsname | Ja | Höchstens 200 Zeichen. Dient dem Abgleich mit vorhandenen Anwendungen |
| `description` | Was die Anwendung tut | Nein | |
| `category` | Hauptzweck | Nein | Akzeptiert Code oder Bezeichnung aus den Einstellungen. Ein unbekannter Wert führt zur Ablehnung der Zeile |
| `supplier_name` | Lieferantenname | Nein | Muss mit vorhandenem Lieferanten übereinstimmen |
| `editor` | Software-Herausgeber | Nein | Freitext (z. B. Microsoft, SAP) |
| `criticality` | Geschäftskritikalität | Nein | Akzeptiert Code oder Bezeichnung aus den Einstellungen; `__CLEAR__` löscht den Wert |
| `lifecycle` | Aktueller Status | Nein | Akzeptiert Code oder Bezeichnung aus den Einstellungen. Ein unbekannter Wert führt zur Ablehnung der Zeile |
| `is_suite` | Kann Unteranwendungen haben | Nein | `ja` oder `nein` |

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
| `external_facing` | Aus dem Internet zugänglich | `ja` oder `nein` |
| `etl_enabled` | Datenintegration | `ja` oder `nein` |
| `support_notes` | Support-Informationen | Freitext |
| `licensing` | Lizenzbedingungen | Freitext |
| `notes` | Interne Notizen | Freitext |

**Compliance-Felder**:

| CSV-Spalte | Beschreibung | Hinweise |
|------------|-------------|-------|
| `data_class` | Datenklassifizierung | Akzeptiert Code oder Bezeichnung aus den Einstellungen |
| `last_dr_test` | Datum des letzten DR-Tests | Datumsformat: YYYY-MM-DD |
| `contains_pii` | Speichert personenbezogene Daten | `ja` oder `nein` |
| `data_residency` | Datenspeicherländer | ISO-Ländercodes, komma-getrennt (z. B. `FR,DE`). Im Modus `Anreichern` behält eine leere Zelle die Länder |

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
| `business_owner_email_1` bis `_4` | E-Mails der Business-Verantwortlichen | Müssen der E-Mail eines vorhandenen Benutzers entsprechen. Eine unbekannte E-Mail führt zur Ablehnung der Zeile |
| `it_owner_email_1` bis `_4` | E-Mails der IT-Verantwortlichen | Müssen der E-Mail eines vorhandenen Benutzers entsprechen. Eine unbekannte E-Mail führt zur Ablehnung der Zeile |

Im Modus `Anreichern` behält die Anwendung ihre Verantwortlichen eines Typs, wenn alle Verantwortlichen-Zellen dieses Typs leer sind.

**Nur-Export-Felder** (im Vollständigen Export enthalten, aber nicht importierbar):

| CSV-Spalte | Beschreibung |
|------------|-------------|
| `status` | Aktiviert oder deaktiviert, in der Sprache Ihres Bildschirms. Wird an der Anwendung selbst geändert |
| `users_mode` | Benutzeranzahl-Methode (`manual`, `it_users`, `headcount`) |
| `users_year` | Referenzjahr für Benutzerberechnungen |
| `users_override` | Manuelle Benutzeranzahl-Überschreibung |
| `created_at` | Zeitstempel der Datensatzerstellung |
| `updated_at` | Zeitstempel der letzten Änderung |
| `vulnerabilities_to_review` | Noch zu prüfende Schwachstellen, gezählt wie in der Spalte der Liste. Leer für eine deaktivierte Anwendung |
| `severe_vulnerabilities` | Davon die kritischen oder hohen. Leer für eine deaktivierte Anwendung |

Die beiden Schwachstellenspalten fehlen, wenn Schwachstellen nicht verfolgt werden. Der Import ignoriert sie.

### Akzeptanz von Bezeichnungen und Codes

Für Felder, die in **IT-Landschaft > Einstellungen** konfiguriert sind, können Sie entweder den internen Code oder die Anzeigebezeichnung verwenden:

| Feld | Beispiel-Codes | Beispiel-Bezeichnungen |
|-------|---------------|----------------|
| Kategorie | `lob`, `productivity`, `security` | `Line-of-business`, `Productivity`, `Security` |
| Lebenszyklus | `active`, `proposed`, `deprecated` | `Active`, `Proposed`, `Deprecated` |
| Datenklasse | `public`, `internal`, `confidential` | `Public`, `Internal`, `Confidential` |

Das System normalisiert Werte automatisch beim Import, sodass `Line-of-business`, `line-of-business` und `lob` alle zur gleichen Kategorie aufgelöst werden. Die Bezeichnungen, die der Bildschirm zeigt, werden auf Englisch, Französisch, Deutsch und Spanisch akzeptiert: `Active`, `Actif`, `Aktiv` und `Activo` bezeichnen denselben Lebenszyklus. Eine in einer Sprache exportierte Datei lässt sich daher in einer anderen importieren.

### Abgleich und Updates

Anwendungen werden nach **Name** abgeglichen, ohne Rücksicht auf Groß- und Kleinschreibung und auf Leerzeichen am Anfang und Ende. Wenn ein Treffer gefunden wird:
- Mit `Anreichern`-Modus: Nur nicht-leere CSV-Werte aktualisieren die Anwendung
- Mit `Ersetzen`-Modus: Die Spalten in der Datei werden aktualisiert, und eine leere Zelle löscht den gespeicherten Wert. Spalten, die in der Datei fehlen, behalten ihre Werte. Eine leere Klassifizierungszelle behält ihren Wert, `__CLEAR__` löscht ihn. Name, `id`, Lebenszyklus und Pflichtfelder können nicht geleert werden: **Preflight** meldet einen Fehler in der Zeile. Eine neue Anwendung erhält die Standardwerte.

Wenn Sie die Spalte `id` mit einer gültigen UUID einschließen, verwendet der Abgleich zuerst die ID und greift dann auf den Namen zurück. Tragen zwei vorhandene Anwendungen den Namen einer Zeile, wird die Zeile abgelehnt: Fügen Sie die Spalte `id` hinzu, um eine auszuwählen.

Eine über ihre `id` gefundene Zeile mit einem anderen Namen benennt die Anwendung um. Der neue Name muss frei sein. Der Titel des Beschreibungsdokuments der Anwendung folgt dem neuen Namen.

### Einschränkungen

- **Bereitstellungen nicht enthalten**: Umgebungsbereitstellungen (Prod, QA, Dev) erfordern Arbeitsbereich-Konfiguration
- **Server-Zuweisungen ausgeschlossen**: Server-Bindungen müssen im Reiter Bereitstellungen eingerichtet werden
- **Schnittstellen ausgeschlossen**: Integrationsdefinitionen sind nicht Teil des Imports und Exports
- **Maximal 4 Verantwortliche pro Typ**: Bis zu 4 Business-Verantwortliche und 4 IT-Verantwortliche können importiert/exportiert werden
- **Benutzermetriken nur Export**: Zielgruppen- und Benutzeranzahlfelder (`users_mode`, `users_year`, `users_override`) werden im Arbeitsbereich verwaltet
- **Status nur Export**: Aktivieren oder deaktivieren Sie eine Anwendung in ihrem Arbeitsbereich

### Fehlerbehebung

**Fehler „Datei ist nicht richtig formatiert"**: Dies weist normalerweise auf ein Kodierungsproblem hin. Stellen Sie sicher, dass Ihre CSV als **UTF-8** gespeichert ist:

- **In LibreOffice**: Wählen Sie beim Öffnen einer CSV `UTF-8` im Zeichensatz-Dropdown (nicht „Japanese (Macintosh)" oder andere Kodierungen). Beim Speichern aktivieren Sie „Filtereinstellungen bearbeiten" und wählen Sie UTF-8.
- **In Excel**: Speichern unter > CSV UTF-8 (Komma-getrennt).
- **Allgemeiner Tipp**: Wenn Sie verstümmelte Zeichen (`?¿`, `ï»¿`) am Anfang Ihrer Datei sehen, ist die Kodierung falsch.

### Beispiel-CSV

```csv
name;category;supplier_name;criticality;lifecycle;go_live_date;external_facing
Salesforce CRM;Line-of-business;Salesforce Inc;Critical;Active;2020-01-15;true
Microsoft 365;Productivity;Microsoft;high;active;2019-06-01;false
Custom ERP;lob;;Moderate;Active;2018-03-20;false
```

---

## Den Assistenten fragen

[Plaid](ai-assistant.md) liest die Version, das Datum der Inbetriebnahme, das Datum des Supportendes und das Datum der Außerbetriebnahme jeder Anwendung. Es filtert, sortiert und gruppiert die Anwendungen nach diesen Daten. Seine Liste behält die außer Betrieb genommenen Anwendungen, während der Bericht [Supportende](end-of-support.md) nur die Anwendungen in Betrieb behält.

Plaid deklariert auch eine Technologie für eine Anwendung oder entfernt sie, mit ihrer Version und, wenn Sie es verlangen, auf den Deployment-Servern der Anwendung. Dazu brauchen Sie das Recht, Anwendungen zu lesen, und die Stufe Mitglied für die Infrastruktur. Ein Business Contributor tut dies nur für die Anwendungen, an denen er beteiligt ist. Plaid verknüpft kein Betriebssystem: Erfassen Sie es auf der Seite des Servers. Jede Änderung kommt als Vorschau, die Sie genehmigen. Wenn Sie Plaid bitten, sie rückgängig zu machen, stellt es genau das wieder her, was es geändert hat. Eine dabei angelegte Version bleibt bei der Technologie.

Fragen Sie zum Beispiel: „Füge CheeseTrack und seinen Servern PostgreSQL 16 hinzu“, „Entferne PostgreSQL 14 von CheeseTrack“, „Welche Anwendungen erreichen in den nächsten sechs Monaten ihr Supportende?“ oder „Welche Anwendungen deklarieren PostgreSQL 14?“

---

## Tipps

- **Beginnen Sie mit kritischen Apps**: Dokumentieren Sie zuerst Ihre geschäftskritischen Anwendungen, dann arbeiten Sie die Kritikalitätsstufen ab.
- **Suites zum Gruppieren verwenden**: Aktivieren Sie „Kann Unteranwendungen haben" im Reiter Betrieb, um eine Anwendung als Suite zu markieren, die verwandte Komponenten gruppiert (z. B. SAP-Module unter einer SAP-Suite).
- **Frühzeitig mit Ausgaben verknüpfen**: Verbinden Sie OPEX, CAPEX und Verträge im Reiter Beziehungen, um das vollständige Kostenbild für jede Anwendung zu sehen.
- **Bereitstellungen aktuell halten**: Der Reiter Bereitstellungen steuert die Umgebungs-Chips in der Liste. Halten Sie ihn für genaue Sichtbarkeit aktuell.
- **Dokumentieren Sie die Zielgruppe**: Legen Sie Unternehmens- und Abteilungs-Zielgruppen in der Eigenschaftsleiste fest; die Benutzeranzahl wird dann automatisch abgeleitet und in Berichten verwendet.
- **Kategorie-Filterung nutzen**: Verwenden Sie den Kategorie-Spaltenfilter, um sich auf bestimmte Anwendungstypen zu konzentrieren (z. B. nur Line-of-business-Apps anzeigen oder Produktivitätswerkzeuge ausschließen).
- **Wissensdatenbank frühzeitig anhängen**: Verknüpfen Sie Runbooks und Architekturdokumente im Reiter Übersicht, damit das Team weiß, wo es bei Vorfällen nachschlagen muss.
- **Aufgaben von beiden Seiten verknüpfen**: Fügen Sie eine Aufgabe unter Beziehungen > Aufgaben hinzu oder setzen Sie das Feld App / Dienst auf der Aufgabe selbst; beide zeigen dieselbe Verknüpfung.
