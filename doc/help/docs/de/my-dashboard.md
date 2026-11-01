# Mein Dashboard

Das Dashboard ist Ihre persönliche Startseite in KANAP. Es bietet Ihnen einen schnellen Überblick über Ihre Aufgaben, Projekte, erfasste Zeiten und aktuelle Aktivitäten: alles an einem Ort. Sie können anpassen, welche Kacheln angezeigt werden, und das Dashboard blendet alle Kacheln aus, für die Sie keine Berechtigung haben.

## Wo Sie es finden

- Klicken Sie auf das **KANAP**-Logo oder navigieren Sie zu `/`
- Dies ist die Standardseite nach der Anmeldung für Nicht-Admin-Benutzer.
- Es sind keine besonderen Berechtigungen erforderlich, um das Dashboard selbst anzuzeigen, aber einzelne Kacheln hängen von Ihren Zugriffsrechten ab.

## Schnellaktionen

Der Kopfbereich oben im Dashboard bietet Schnellzugriffsschaltflächen für gewöhnliche tägliche Arbeit. Jede Schaltfläche wird nur angezeigt, wenn Sie die entsprechende Berechtigung haben.

- **Aufgabe erstellen**: öffnet den Erstellungsfluss für eigenständige Aufgaben. Erfordert `tasks:member` oder höher.
- **Zeit erfassen**: öffnet den Dialog **Schnelle Zeiterfassung** (siehe unten). Erfordert `portfolio_projects:contributor` oder `tasks:member`.
- **Neue Anfrage**: öffnet den Erstellungsfluss für Anfragen. Erfordert `portfolio_requests:member` oder höher.
- **Neue Anwendung**: öffnet den Erstellungsfluss für Anwendungen. Erfordert `applications:member` oder höher.
- **Neues Asset**: öffnet den Erstellungsfluss für Assets. Erfordert `infrastructure:member` oder höher.
- **Neues Dokument** (Split-Schaltfläche): erstellt ein leeres Wissensdokument oder öffnet den Vorlagen-Picker, um aus einer veröffentlichten Vorlage zu beginnen. Erfordert `knowledge:member` oder höher.
- **Einstellungen** (Zahnrad-Symbol): öffnet den Dashboard-Einstellungs-Dialog, um auszuwählen, welche Kacheln angezeigt werden sollen.

### Schnelle Zeiterfassung

Die Aktion **Zeit erfassen** öffnet einen fokussierten Dialog, sodass Sie Stunden erfassen können, ohne das Dashboard zu verlassen.

- Wählen Sie das Ziel: **Projekt** oder **Aufgabe**. Diese Auswahl erscheint nur, wenn Sie auf beiden Zeit erfassen dürfen.
  - Projekt-Einträge erfassen Zeit direkt gegen ein Portfolio-Projekt. Die Liste enthält nur die Projekte, auf denen Sie Zeit erfassen dürfen.
  - Aufgaben-Einträge erfassen Zeit gegen eine Ihrer aktiven Aufgaben: Aufgaben dieser Projekte und eigenständige Aufgaben, wenn Sie `tasks:member` haben. OPEX-, CAPEX- und Vertragsaufgaben sind vom Picker ausgeschlossen.
- Wählen Sie das Projekt oder die Aufgabe aus dem Dropdown.
- Geben Sie die **Stunden** ein (ganze Stunden).
- Wählen Sie eine **Kategorie**: **IT** oder **Business**.
- Fügen Sie **Notizen** hinzu, wenn Sie Kontext zu Ihrer Arbeit angeben möchten.

Beim Speichern wird die Berechtigung für das Ziel geprüft: Ein Eintrag auf einem Projekt oder einer Projektaufgabe erfordert `portfolio_projects:contributor`, ein Eintrag auf einer eigenständigen Aufgabe erfordert `tasks:member`.

Nach dem Speichern wird die Zeitzusammenfassungs-Kachel des Dashboards automatisch aktualisiert.

## Zeile zu den Beispieldaten

In einem leeren Cloud-Arbeitsbereich, in den noch nie Beispieldaten geladen wurden, sehen Administratoren über den Kacheln eine Zeile: „Entdecken Sie KANAP mit Beispieldaten.“ **Laden** öffnet den Dialog für Beispieldaten, und **Ausblenden** entfernt die Zeile dauerhaft. Die Zeile verschwindet, sobald der Arbeitsbereich Daten enthält, und kehrt nach dem Löschen nicht zurück. Siehe [Beispieldaten](sample-data.md).

## Testphase: Ihr Pfad und Ihre ersten Schritte { #trial-first-steps }

In einem Arbeitsbereich in der Testphase öffnet sich beim ersten Öffnen von KANAP ein Dialog. Er stellt eine Frage pro Bildschirm:

1. **Was führt Sie zu KANAP?** **Das IT-Budget**, **Die IT-Landkarte**, **Projekte und Anfragen** oder **Ich schaue mich um**.
2. **Wie möchten Sie beginnen?** **Mit dem vollständigen Beispiel entdecken** oder **Mit meinen eigenen Daten beginnen**.

Wer mit den eigenen Daten beginnt, löscht das Beispiel. Wurden seit dem Laden des Beispiels Elemente angelegt, nennt eine Bestätigung deren Anzahl, bevor etwas gelöscht wird. Solange der Arbeitsbereich das Beispiel enthält, kann nur ein Administrator die eigenen Daten wählen.

Während das Beispiel geladen oder der Arbeitsbereich gelöscht wird, weist eine Zeile auf der Startseite darauf hin.

Wenn Sie den Dialog schließen, wartet die Wahl unter **Über KANAP**. Die Zeile **Pfad: … · Ändern** zeigt den gewählten Pfad (**Wählen**, solange nichts gewählt ist). Solange eine Antwort fehlt, kann jede Person ihn ändern. Danach können es nur Administratoren.

### Ihre ersten fünf Schritte

Sobald ein Pfad gewählt ist, steht die Kachel **Ihre ersten fünf Schritte** an erster Stelle der Startseite. Sie listet die fünf Schritte des Pfads und Ihren Fortschritt, zum Beispiel **2/5**. Jeder Schritt öffnet seinen Bildschirm, auf dem der Seitentitel hervorgehoben ist, mit einem erklärenden Satz.

- Mit dem Beispiel gilt ein Schritt als erledigt, sobald Sie ihn öffnen.
- Mit Ihren eigenen Daten klicken Sie auf **Erledigt** in der Erklärung oder auf die Markierung neben dem Schritt in der Kachel. Die Markierung macht einen Schritt auch wieder rückgängig.

Wenn die fünf Schritte erledigt sind, bietet die Kachel die beiden anderen Pfade an. Die Schaltfläche zum Schließen (**×**) blendet die Kachel aus. Um sie wieder anzuzeigen, verwenden Sie **Erste Schritte anzeigen** unter **Über KANAP**.

| Pfad | Mit dem Beispiel | Mit Ihren eigenen Daten |
|---|---|---|
| IT-Budget | Die Übersicht, Eine Budgetzeile, Ein Bericht, Eine Frage an Plaid, Ihre Daten | Ihr Unternehmen, Ihre Budgetzeilen, Ein verknüpfter Vertrag, Ihr erster Bericht, Eine Kollegin, ein Kollege |
| IT-Landkarte | Die Anwendungsliste, Ein Anwendungsdatensatz, Die Server, Technologien, Supportende und Schwachstellen, Ihre Daten | Ihre Anwendungen, Ihre Technologien, Ihre Server, Was KANAP gefunden hat, Eine Kollegin, ein Kollege |
| Projekte und Anfragen | Eine Anfrage und ihre Bewertung, Das daraus entstandene Projekt, Die Aufgaben, Zeit und Aufwand, Ihre Daten | Ihre erste Anfrage, Ihr Projekt, Die ersten Aufgaben, Das Budget des Projekts, Eine Kollegin, ein Kollege |

## Zeile zum Einschalten von Plaid

Während einer Cloud-Testphase sehen Administratoren der Plaid-Einstellungen unter der Zeile zu den Beispieldaten eine Zeile, solange Plaid ausgeschaltet ist und das inklusive KANAP-Modell angeboten wird: „Plaid, der KANAP-Assistent, ist ausgeschaltet.“ **Einschalten** öffnet die übliche Bestätigung des inklusiven Modells. Mit der Bestätigung wird Plaid eingeschaltet. Die Schaltfläche zum Schließen (**×**) blendet die Zeile in diesem Browser aus. Nach dem Wechsel zu einem kostenpflichtigen Tarif erscheint die Zeile nicht mehr, On-Premise ebenfalls nicht. Siehe [Plaid-Einstellungen](ai-settings.md).

## Dashboard-Kacheln

Das Dashboard zeigt ein Raster von Kacheln, die jeweils einen anderen Aspekt Ihrer Arbeit zeigen. Kacheln sind in einem responsiven Raster angeordnet (drei Spalten auf großen Bildschirmen, zwei auf mittleren, eine auf kleinen). Kacheln, für die Sie keine Anzeigeberechtigung haben, werden überhaupt nicht geladen.

### Meine Aufgaben

Zeigt Ihre aktiven Aufgaben gruppiert nach Dringlichkeit:

- **Überfällig**: Aufgaben, deren Fälligkeitsdatum überschritten ist (rot hervorgehoben)
- **Diese Woche fällig**: Aufgaben, die in den nächsten 7 Tagen fällig sind
- **Später**: alles andere

Jede Aufgabe zeigt ihren Titel, das verknüpfte Projekt (falls vorhanden), das Fälligkeitsdatum und ein Prioritäts-Badge, wenn die Priorität über normal liegt. Klicken Sie auf eine Aufgabe, um ihren Arbeitsbereich zu öffnen.

Zeigt insgesamt bis zu 5 Elemente an, verteilt auf die drei Gruppen.

**Einstellungen**: maximale Elemente, Bereich Überfällig ausblenden.

**Erfordert**: `tasks:reader`

---

### Projekte, die ich leite

Listet Projekte auf, in denen Sie eine Führungsrolle innehaben (IT-Leiter, Fachbereichsleiter, IT-Sponsor oder Fachbereichssponsor). Jedes Projekt zeigt:

- Ihre Rolle
- Aktueller Projektstatus (farbcodierte Pille)
- Nächster Meilenstein und sein Zieldatum, falls festgelegt

Das Klicken auf ein Projekt öffnet den Projekt-Arbeitsbereich.

Zeigt bis zu 5 Elemente an.

**Erfordert**: `portfolio_projects:reader`

---

### Projekte, an denen ich mitarbeite

Listet Projekte auf, in denen Sie ein Teammitglied sind. Jedes Projekt zeigt:

- Ihr Team (IT-Team oder Business-Team)
- Aktueller Projektstatus
- Anzahl der Ihnen in diesem Projekt zugewiesenen Aufgaben

Das Klicken auf ein Projekt öffnet den Projekt-Arbeitsbereich.

Zeigt bis zu 5 Elemente an.

**Erfordert**: `portfolio_projects:reader` und `tasks:reader`

---

### Kürzlich angesehen

Zeigt Elemente an, die Sie in der gesamten Anwendung kürzlich geöffnet haben: Projekte, Anfragen, Anwendungen, Assets, Schnittstellen, Verbindungen, Verträge, Aufgaben, OPEX- und CAPEX-Zeilen, Unternehmen sowie Wissensdokumente. Jeder Eintrag zeigt den Elementnamen, seinen Typ und wann Sie ihn zuletzt angesehen haben.

Kürzlich angesehene Elemente werden lokal in Ihrem Browser gespeichert und sind auf den aktuellen Mandanten und Benutzer beschränkt. Klicken Sie auf **Löschen**, um die Liste zurückzusetzen. Elemente, für die Sie keine Zugriffsberechtigung mehr haben, werden automatisch herausgefiltert. Seitdem gelöschte Elemente, allein oder mit einem anderen Element (etwa die Aufgaben eines gelöschten Vertrags), verschwinden aus der Liste.

Zeigt bis zu 5 Elemente an.

**Erfordert**: Keine besonderen Berechtigungen.

---

### Meine Zeit letzte Woche

Zeigt eine Zusammenfassung der Zeit an, die Sie über einen kürzlichen Zeitraum erfasst haben:

- **Gesamtstunden** erfasst (prominent angezeigt)
- **Aufschlüsselung nach Kategorie**: IT, Business und Andere Aufgaben (Nicht-Projekt)
- **Top-Projekte**: ein kleines Balkendiagramm der Projekte, für die Sie die meiste Zeit aufgewendet haben

**Einstellungen**: Zeitraum in Tagen (7 bis 30).

**Erfordert**: `portfolio_projects:reader`

---

### Neue Anfragen

Zeigt Portfolio-Anfragen an, die innerhalb eines kürzlichen Zeitraums erstellt wurden. Jede Anfrage zeigt den Namen, den Anforderer, das Erstellungsdatum und ein Badge **Hoch**, wenn der Prioritätswert über 80 liegt.

Das Klicken auf eine Anfrage öffnet den Anfragen-Arbeitsbereich.

Zeigt bis zu 5 Elemente an.

**Einstellungen**: maximale Elemente, Tage zum Zurückblicken.

**Erfordert**: `portfolio_requests:reader`

---

### Wissensdatenbank

Zeigt zwei Wissens-fokussierte Bereiche in derselben Kachel:

- **Zu prüfen**: Dokumente, in denen Sie der aktive Prüfer oder Genehmiger sind, einschließlich wie lange das Review angefordert wurde und von wem. Die Badge-Farbe gibt an, ob Sie sich in der Review- oder Genehmigungsstufe befinden.
- **Letzte 5 zugegriffen**: die letzten fünf Wissensdokumente, die Sie in diesem Browser für den aktuellen Mandanten geöffnet haben.

Eingeschränkte Bibliotheken respektieren ihre Zugriffsregeln: Sie sehen nur Review-Elemente und kürzliche Dokumente aus Bibliotheken, die Sie lesen können. Wenn Sie den Zugriff auf ein zuvor angesehenes Dokument verloren haben, hört es auf, hier zu erscheinen.

**Erfordert**: `knowledge:reader`

---

### Compliance

Zeigt den Stand der Klassifizierungskampagne für die Anwendungen, die Sie sehen können (stillgelegte Anwendungen ausgenommen):

- **Fortschritt**: ein Balken und drei Zähler: geprüft, zu prüfen (die Klassifizierung hat sich seit der letzten Prüfung geändert oder wurde nie geprüft) und zu vervollständigen (ein Klassifizierungsfeld ist noch leer). Jeder Zähler öffnet die auf diesen Zustand gefilterte Anwendungsliste.
- **Handlungspunkte**: Anwendungen der kritischsten Geschäftsstufe ohne Wiederherstellungstest in den letzten zwölf Monaten, Anwendungen der kritischsten Stufe ohne Wiederherstellungswelle sowie Anwendungen mit den vertraulichsten Daten und der niedrigsten Cyber-Kritikalität. Es werden nur Punkte mit mindestens einer Anwendung aufgeführt; jeder öffnet die passende gefilterte Liste. Wenn nichts zu tun ist, sagt die Kachel das.

Die Stufen sind die in den Einstellungen der IT-Landschaft definierten; eine nicht mehr angebotene Stufe zählt nie als höchste oder niedrigste.

**Erfordert**: `applications:reader`

---

### Schwachstellen im Bestand { #vulnerabilities }

Zeigt die Schwachstellen, die in Ihrem Bestand Aufmerksamkeit brauchen, unter dem Untertitel „Zu prüfende CVEs in eingesetzten Technologien“. Die Zählungen folgen [Was KANAP zählt](vulnerabilities.md#what-kanap-counts): noch zu prüfende Schwachstellen in den Warnungen. Jede Zeile öffnet die passende Liste:

- **Anwendungen der höchsten Kritikalität mit einer kritischen oder hohen CVE**, zum Beispiel „2 Anwendungen der Kritikalität Kritisch mit einer kritischen oder hohen CVE“: die Anwendungen auf der höchsten Stufe der Geschäftskritikalität Ihres Katalogs, die eine kritische oder hohe Schwachstelle erreicht. Öffnet die Anwendungsliste, gefiltert auf diese Stufe und auf **Mit schwerwiegenden Schwachstellen**. Erfordert `applications:reader` und zählt die Anwendungen, die Sie lesen dürfen.
- **Kritische CVEs in den letzten 7 Tagen** und **in den letzten 30 Tagen veröffentlicht**, auf Technologien im Bestand: installiert auf einem Asset in Betrieb oder deklariert von einer Anwendung in Betrieb. Öffnet die Seite [Schwachstellen](vulnerabilities.md) auf diesen Schwachstellen, mit dem Filter **Im Bestand im Einsatz**.
- **Bekanntermaßen ausgenutzte CVEs**, auf Technologien im Bestand. Öffnet die Seite Schwachstellen auf den ausgenutzten, mit demselben Filter.
- **Assets mit einer kritischen oder hohen CVE**. Öffnet die Asset-Liste, gefiltert auf **Mit schwerwiegenden Schwachstellen**.

Eine Zeile mit null ist ausgeblendet. Stehen alle Zeilen auf null, zeigt die Kachel „Keine kritische Schwachstelle zu prüfen.“. Eine Warnung folgt, wenn eine Quelle seit mehr als 3 Tagen nicht gelesen wurde, zum Beispiel „Die NVD wurde seit 4 Tagen nicht gelesen“: Die Zahlen können dann veraltet sein. **Alle anzeigen** öffnet die Seite Schwachstellen.

Die Kachel ist standardmäßig eingeschaltet. Sie existiert nur, wenn Schwachstellen verfolgt werden. Siehe [Schwachstellen](vulnerabilities.md#verfugbarkeit).

**Erfordert**: `infrastructure:reader`

---

### Team-Aktivität

Zeigt aktuelle Projektaktivität in Projekten an, in denen Sie beteiligt sind (Änderungen, Kommentare, Entscheidungen). Jede Zeile zeigt das Projekt, den Aktivitätstyp, den Autor und eine kurze Zusammenfassung. Klicken Sie auf ein Element, um zum Aktivitäts-Reiter des Projekts zu springen.

**Einstellungen**: maximale Elemente.

**Erfordert**: `portfolio_projects:reader`

---

### Projektstatusänderungen

Zeigt aktuelle Projektstatus-Übergänge (von → zu) über Projekte hinweg an, sodass Sie sehen können, welche Initiativen in den letzten Tagen vorangekommen sind, pausiert wurden oder abgeschlossen sind.

**Einstellungen**: Tage zum Zurückblicken (1 bis 14).

**Erfordert**: `portfolio_projects:reader`

---

### Veraltete Aufgaben

Zeigt Aufgaben an, die seit langem nicht aktualisiert wurden. Jedes Element zeigt die Pille mit Tagen-veraltet (Warnung, dann Fehler nach dem Doppelten des Schwellenwerts) und das verknüpfte Objekt, falls vorhanden.

**Einstellungen**: Bereich (`my`, `team`, `all`) und Schwellenwert in Tagen (30 bis 365).

**Erfordert**: `tasks:reader`

## Ihr Dashboard anpassen

Klicken Sie auf das Symbol **Einstellungen** (Zahnrad) im Dashboard-Header, um den Dashboard-Einstellungs-Dialog zu öffnen.

Von hier aus können Sie:

- **Kacheln aktivieren oder deaktivieren**: markieren oder demarkieren Sie jede Kachel, um zu steuern, was auf Ihrem Dashboard erscheint.
- **Auf Standardeinstellungen zurücksetzen**: die ursprüngliche Kachelauswahl wiederherstellen.

Nur Kacheln, für die Sie eine Anzeigeberechtigung haben, erscheinen in der Einstellungsliste. Änderungen werden in Ihrem Konto gespeichert und bleiben über Sitzungen und Geräte hinweg bestehen.

Wenn alle Kacheln deaktiviert sind, zeigt das Dashboard eine Meldung an, die Sie auffordert, einige zu aktivieren.

## Tipps

- **Beginnen Sie mit den Standardeinstellungen**: Das Dashboard wird mit einem nützlichen Satz von Kacheln bereits aktiviert ausgeliefert. Probieren Sie es einige Tage aus, bevor Sie es anpassen.
- **Verwenden Sie die Schnellaktionen**: Eine Aufgabe, Anfrage oder ein Dokument zu erstellen (oder Zeit zu erfassen) direkt vom Dashboard aus erspart Ihnen das Navigieren.
- **Überprüfen Sie überfällige Aufgaben täglich**: Die Kachel Meine Aufgaben hebt überfällige Elemente in Rot hervor, damit nichts durch die Maschen fällt.
- **Verwenden Sie veraltete Aufgaben im Team-Bereich**: Mit `tasks:admin` schalten Sie die Kachel Veraltete Aufgaben auf den Bereich `team` oder `all` um, um Arbeit zu finden, die in der gesamten Organisation niemand aktualisiert.
