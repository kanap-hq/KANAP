# Mein Dashboard

Das Dashboard ist Ihre persönliche Startseite in KANAP. Es bietet Ihnen einen schnellen Überblick über Ihre Aufgaben, Projekte, Anwendungen und Ihr Budget. Sie wählen seine Kacheln und ihre Reihenfolge. Kacheln, für die Sie keine Berechtigung haben, sind ausgeblendet.

## Wo Sie es finden

- Klicken Sie auf das **KANAP**-Logo oder navigieren Sie zu `/`
- Dies ist die Standardseite nach der Anmeldung für Nicht-Admin-Benutzer.
- Es sind keine besonderen Berechtigungen erforderlich, um das Dashboard selbst anzuzeigen, aber einzelne Kacheln hängen von Ihren Zugriffsrechten ab.

## Schnellaktionen

Der Kopfbereich oben im Dashboard bietet Schnellzugriffsschaltflächen für gewöhnliche tägliche Arbeit. Jede Schaltfläche wird nur angezeigt, wenn Sie die entsprechende Berechtigung haben.

- **Aufgabe erstellen**: öffnet den Erstellungsfluss für eigenständige Aufgaben. Erfordert `tasks:member` oder höher.
- **Zeit erfassen**: öffnet den Dialog **Schnelle Zeiterfassung** (siehe unten). Erfordert `portfolio_projects:contributor` oder `tasks:member`.
- **Neue Budgetzeile**: öffnet eine neue Budgetzeile. Sie beginnt als OPEX, und die Zeile **Typ** in ihrem Bereich Eigenschaften stellt sie auf CAPEX um (siehe [Budgetzeilen](budget-lines.md#der-arbeitsbereich)). Erfordert `budget:member` oder höher.
- **Neue Anwendung**: öffnet den Erstellungsfluss für Anwendungen. Erfordert `applications:member` oder höher.
- **Neues Asset**: öffnet den Erstellungsfluss für Assets. Erfordert `infrastructure:member` oder höher.
- **Neues Dokument** (Split-Schaltfläche): erstellt ein leeres Wissensdokument oder öffnet den Vorlagen-Picker, um aus einer veröffentlichten Vorlage zu beginnen. Erfordert `knowledge:member` oder höher.
- **Startseite anpassen** (Schieberegler-Symbol, rechts): schaltet die Seite in den Anpassungsmodus. Siehe [Ihr Dashboard anpassen](#customizing-the-budget-section).

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

Wenn die fünf Schritte erledigt sind, bietet die Kachel die beiden anderen Pfade an. Sie bietet auch **Diesen Pfad neu beginnen** an, womit die fünf Schritte dieses Pfads wieder als offen gelten. Die Schaltfläche zum Schließen (**×**) blendet die Kachel aus. Um sie wieder anzuzeigen, verwenden Sie **Erste Schritte anzeigen** unter **Über KANAP**.

| Pfad | Mit dem Beispiel | Mit Ihren eigenen Daten |
|---|---|---|
| IT-Budget | Die Übersicht, Eine Budgetzeile, Ein Bericht, Eine Frage an Plaid, Ihre Daten | Ihr Unternehmen, Ihre Budgetzeilen, Ein verknüpfter Vertrag, Ihr erster Bericht, Eine Kollegin, ein Kollege |
| IT-Landkarte | Die Anwendungsliste, Ein Anwendungsdatensatz, Die Server, Technologien, Supportende und Schwachstellen, Ihre Daten | Ihre Anwendungen, Ihre Technologien, Ihre Server, Was KANAP gefunden hat, Eine Kollegin, ein Kollege |
| Projekte und Anfragen | Eine Anfrage und ihre Bewertung, Das aus der Anfrage entstandene Projekt, Die Aufgaben, Die Berichte, Ihre Daten | Ihre erste Anfrage, Ihr Projekt, Die ersten Aufgaben, Das Budget des Projekts, Eine Kollegin, ein Kollege |

### Die Startseite folgt Ihrem Pfad

Während einer Testphase steht der Bereich Ihres Pfads an erster Stelle, angeführt von der Kachel der ersten Schritte:

- **IT-Budget**: **Budgetverwaltung**.
- **IT-Landkarte**: **IT-Landschaft**.
- **Projekte und Anfragen**: **Portfolio**.

Ohne Pfad behalten die Bereiche ihre Standardreihenfolge. Sobald Sie die Bereiche selbst ordnen, gilt Ihre Reihenfolge.

## Zeile zum Einschalten von Plaid

Während einer Cloud-Testphase sehen Administratoren der Plaid-Einstellungen unter der Zeile zu den Beispieldaten eine Zeile, solange Plaid ausgeschaltet ist und das inklusive KANAP-Modell angeboten wird: „Plaid, der KANAP-Assistent, ist ausgeschaltet.“ **Einschalten** öffnet die übliche Bestätigung des inklusiven Modells. Mit der Bestätigung wird Plaid eingeschaltet. Die Schaltfläche zum Schließen (**×**) blendet die Zeile in diesem Browser aus. Nach dem Wechsel zu einem kostenpflichtigen Tarif erscheint die Zeile nicht mehr, On-Premise ebenfalls nicht. Siehe [Plaid-Einstellungen](ai-settings.md).

## Dashboard-Kacheln

Die Startseite gruppiert ihre Kacheln in vier Bereiche, jeder mit seinem Titel. Standardmäßig kommen sie in dieser Reihenfolge:

- **Meine Arbeit**: **Meine Aufgaben**, **Kürzlich angesehen**, **Meine Zeit letzte Woche**, **Wissensdatenbank**, **Veraltete Aufgaben**.
- **Portfolio**: **Projekte, die ich leite**, **Projekte, an denen ich mitarbeite**, **Neue Anfragen**, **Team-Aktivität**, **Projektstatusänderungen**.
- **IT-Landschaft**: **Compliance**, **Schwachstellen im Bestand**, **Netbox-Synchronisierung**.
- **Budgetverwaltung**: die [Budgetkacheln](#budget-management-section).

Ein Bereich erscheint, wenn Sie eine seiner Kacheln lesen können. Kacheln, für die Sie keine Anzeigeberechtigung haben, werden überhaupt nicht geladen.

### Layout

Die Kacheln teilen sich ein Raster: vier Spalten auf einem sehr breiten Bildschirm, drei auf einem großen, zwei auf einem mittleren, eine auf Mobilgeräten. Ein Bereich belegt so viele Spalten, wie er Kacheln zeigt, höchstens eine ganze Reihe. Kurze Bereiche teilen sich so eine Reihe. Ein längerer Bereich erstreckt sich über mehrere Reihen.

### Standardkacheln

Solange Sie die Seite nicht angepasst haben, zeigt sie **Meine Aufgaben**, **Projekte, die ich leite**, **Compliance** und **Schwachstellen im Bestand**, dann **Budget**, **Top-Zeilen** und **Aktuelle Änderungen**. Die anderen Kacheln sind ausgeschaltet: Schalten Sie sie im [Anpassungsmodus](#customizing-the-budget-section) ein. Bereits gespeicherte Einstellungen bleiben erhalten.

### Kacheln ohne Inhalt

Mit **Kacheln ohne Inhalt ausblenden** (standardmäßig eingeschaltet) wird eine Kachel, die nichts anzuzeigen hat, von der Seite weggelassen. Das gilt für eine leere Liste, für Zähler, die alle bei null stehen (zum Beispiel **Datenqualität** mit allen Prüfungen bei null oder **Schwachstellen im Bestand** mit allen Zeilen bei null), für **Compliance** ohne Anwendung und für **Netbox-Synchronisierung**, wenn Netbox nicht verbunden ist oder nichts zu entscheiden ist. Eine Kachel kommt zurück, sobald sie etwas anzuzeigen hat. Eine Kachel, die noch lädt oder deren Laden fehlgeschlagen ist, bleibt sichtbar. Ein Bereich ohne verbleibende Kachel verschwindet.

Wenn alle Bereiche leer sind, zeigt die Startseite eine einzige Zeile: „Ihre Kacheln haben noch nichts anzuzeigen.“ Schalten Sie die Option aus, um die leeren Kacheln mit ihrer üblichen Meldung zu sehen.

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

## Bereich Budgetverwaltung { #budget-management-section }

Der Bereich **Budgetverwaltung** zeigt, wo Ihre IT-Ausgaben stehen: das Budget nach Art und Jahr, Ihre eigenen Budgetzeilen, die nächsten Verlängerungen, die Datenqualität und die Zeilen, die Ihre Aufmerksamkeit verdienen. Er erscheint, wenn Sie Budgetzeilen oder Verträge lesen können. **Nächste Verlängerungen** erfordert Lesezugriff auf Verträge, die anderen Budgetkacheln erfordern `budget:reader`.

Die Kachel **Budget** belegt zwei Spalten, wenn sie drei Betragsspalten oder mehr zeigt, sonst eine Spalte. Jede Kachel hat ein Symbol, einen Titel und meist eine Schaltfläche, die Sie zur vollständigen Seite hinter den Daten bringt.

Mehrere Kacheln haben in ihrem Kopf die Tabs **Alle**, **OPEX** und **CAPEX**, mit denen Sie den Typ der Zeilen wählen, die sie abdecken. Jede Kachel merkt sich Ihre Wahl in Ihrem Browser.

Die Kacheln sind unten in ihrer Standardreihenfolge aufgeführt.

### Budget

Eine Tabelle, die drei Geschäftsjahre abdeckt: Vorjahr (J-1), aktuelles Jahr (J) und nächstes Jahr (J+1). Jedes Jahr hat drei Zeilen: **OPEX**, **CAPEX** und **Gesamt**. Die Wertspalten sind die Budgetspalten, die Ihre Organisation anzeigt, unter ihren Namen (**Budget**, **Revision**, **Ist-Werte** und **Erwarteter Endwert** mit den Standardeinstellungen, dazu **Prognose**, wenn sie angezeigt wird). In den Optionen der Kachel können Sie weniger davon behalten (siehe [Ihr Dashboard anpassen](#customizing-the-budget-section)). Eine Spalte erscheint, sobald sie für mindestens eine Zeile einen Betrag enthält. Ausgeblendete Spalten erscheinen nie. Alle Beträge sind auf den nächsten Tausender gerundet und mit dem Suffix „k“ angezeigt (z. B. `7.846 k`). Die Trennzeichen folgen der Sprache der Oberfläche.

Klicken Sie auf einen Betrag, um die [Liste der Budgetzeilen](budget-lines.md) auf diesem Typ zu öffnen. Ein Betrag in **Gesamt** öffnet die Liste auf beiden Typen. Klicken Sie auf **Ansehen**, um die Liste zu öffnen.

### Top-Zeilen

Die fünf Zeilen, die in der Standardspalte herausragen. Zwei kleine Tabs oben in der Kachel wählen die Rangfolge, die sich Ihr Browser merkt:

- **Betrag**: die fünf größten Zeilen des aktuellen Jahres. Der Untertitel nennt die Spalte, zum Beispiel **Budget, J**. Beträge sind auf Tausender gerundet mit dem Suffix „k“, mit den Trennzeichen der Sprache der Oberfläche.
- **Anstieg**: die fünf Zeilen mit dem größten Anstieg gegenüber dem Vorjahr. Der Untertitel lautet zum Beispiel **Budget, J vs J-1**. Zeilen, deren Betrag gleich geblieben oder gesunken ist, erscheinen nicht. Ein kleiner Anstieg erscheint in voller Höhe. Ein größerer wird verkürzt, zum Beispiel `340,1 k`.

Wählen Sie den Typ mit den Tabs **Alle** / **OPEX** / **CAPEX**. **Öffnen** öffnet den vollständigen Bericht **Top-Zeilen** für denselben Typ, bei der Rangfolge nach Anstieg den Bericht **Top Anstieg / Rückgang**.

### Aktuelle Änderungen

Die fünf zuletzt bearbeiteten Budgetzeilen, OPEX und CAPEX zusammen. Jede Zeile zeigt das Datum der letzten Bearbeitung, die Referenz der Zeile, ihren Namen und ihren Typ. Klicken Sie auf eine Zeile, um die Budgetzeile zu öffnen.

### Datenqualität

Prüfungen, die Ihnen helfen, unvollständige Zeilen auf einen Blick zu erkennen. Die Kachel zeigt eine Spalte mit Zählern pro Typ: **OPEX** und **CAPEX** nebeneinander. Die Zähler umfassen die Zeilen, die die Liste standardmäßig zeigt (**Anzeigen: Aktiv**).

- **Ohne IT-Verantwortlichen**: Zeilen ohne IT-Verantwortlichen
- **Ohne Fachbereichsverantwortlichen**: Zeilen ohne Fachbereichsverantwortlichen
- **Ohne zahlendes Unternehmen**: Zeilen ohne zahlendes Unternehmen
- **Ohne Kostenstelle**: Zeilen ohne Kostenstelle
- **Ohne Budget im nächsten Jahr**: Zeilen, deren Standardspalte für das nächste Jahr null oder leer ist. Die Prüfung nennt Ihre Standardspalte
- **Konto nicht im Kontenplan des Unternehmens**: Zeilen, deren Konto nicht zum Kontenplan des zahlenden Unternehmens gehört

Ein Zähler wird orange (rot bei der Kontenplan-Prüfung), wenn er über null liegt. Klicken Sie auf einen Zähler, um die Liste genau mit den Zeilen zu öffnen, die er zählt.

### Mein Budget

Die Zeilen auf Ihren Namen, in der Standardspalte des aktuellen Jahres (der Untertitel nennt sie, zum Beispiel **Budget, J**). Wählen Sie den Typ mit den Tabs **Alle** / **OPEX** / **CAPEX**.

- **Als IT-Verantwortlicher**, **Als Fachbereichsverantwortlicher** und **Als Budgetverantwortlicher**: wie viele Zeilen Sie in jeder Rolle halten, und ihre Summe. Klicken Sie auf eine Zeile, um die Liste mit diesen Zeilen zu öffnen
- **Meine Zeilen**: Ihre drei größten Zeilen, unabhängig von der Rolle, mit ihrer Referenz. Klicken Sie auf eine, um sie zu öffnen

Halten Sie keine Zeile, zeigt die Kachel „Keine Budgetzeilen auf Ihren Namen“.

### Nächste Verlängerungen

Listet die fünf Verträge, die als Nächstes fällig sind, heute eingeschlossen, in der Reihenfolge der Spalte **Nächste Frist** der Vertragsliste: Ein Vertrag mit stillschweigender Verlängerung erscheint mit seinem nächsten Kündigungstermin, jeder andere Vertrag mit seinem Ende. Abgelaufene Verträge erscheinen nicht.

Klicken Sie auf **Alle anzeigen**, um die Verträge-Seite zu öffnen.

### Nach Kostenstelle

Die fünf Kostenstellen mit der größten Summe in der Standardspalte des aktuellen Jahres, mit einem Balken für jede. Zeilen ohne Kostenstelle zählen zusammen als **Ohne Kostenstelle**. Wählen Sie den Typ mit den Tabs **Alle** / **OPEX** / **CAPEX**. Klicken Sie auf eine Zeile, um die Liste mit den Zeilen dieser Kostenstelle zu öffnen.

### Beträge ohne Wechselkurs

Hat die Währung einer Zeile für ein Jahr keinen Wechselkurs, ist ihr Betrag nicht in den Summen dieses Jahres enthalten. Die Kacheln **Budget**, **Mein Budget** und **Nach Kostenstelle** sowie **Top-Zeilen** in der Rangfolge nach Anstieg zeigen dann einen einzeiligen Hinweis, zum Beispiel „3 Zeilen ohne Wechselkurs ausgeschlossen: USD 2026.“ Benutzer der Budgetadministration auf Administratorebene sehen außerdem **Kurs eingeben**, das die Währungseinstellungen beim fehlenden Kurs öffnet. Nennt der Hinweis nur eine Währung und ein Jahr, öffnet sich direkt der Dialog für den manuellen Kurs. In **Top-Zeilen** in der Rangfolge nach Betrag zeigt eine solche Zeile ihren Betrag in ihrer eigenen Währung mit einer kleinen orangefarbenen Markierung. Siehe [Manuelle Kurse](currencies.md#manuelle-kurse).

## Ihr Dashboard anpassen { #customizing-the-budget-section }

Klicken Sie auf **Startseite anpassen** (Schieberegler-Symbol, rechts neben den Schnellaktionen). Die Seite wechselt in den Anpassungsmodus. Ihre Wahl gilt nur für Ihre eigene Startseite.

- Die Schnellaktionen weichen einer Leiste: **Kacheln ohne Inhalt ausblenden** (siehe [Kacheln ohne Inhalt](#kacheln-ohne-inhalt)), **Auf Standardwerte zurücksetzen**, **Abbrechen** und **Fertig**.
- Jede eingeschaltete Kachel erscheint, auch leere. Ziehen Sie eine Kachel an ihrem Griff, um sie innerhalb ihres Bereichs zu verschieben. Ihre Einstellungsschaltfläche öffnet ihre Optionen (max. Einträge, Tage, Bereich). Ihre Ausblenden-Schaltfläche schaltet sie aus.
- Bei der Kachel **Budget** enthalten die Optionen **Betragsspalten**. **Spalten des Arbeitsbereichs**, standardmäßig angehakt, folgt den Spalten, die Ihre Organisation anzeigt. Haken Sie es ab, um die Spalten selbst zu wählen. Mindestens eine Spalte bleibt.
- Ziehen Sie einen Bereich an seinem Griff, um ihn zwischen den Bereichen zu verschieben. **Kachel hinzufügen** (+) listet die ausgeschalteten Kacheln des Bereichs. Die Augen-Schaltfläche blendet den Bereich aus oder ein. Ein ausgeblendeter Bereich bleibt abgeblendet sichtbar, bis Sie fertig sind.
- Während der Anpassung öffnet ein Klick auf eine Kachel nicht, was sie zeigt.

**Fertig** speichert alles in Ihrem Konto, über Sitzungen und Geräte hinweg. **Abbrechen** verwirft die Änderungen. **Auf Standardwerte zurücksetzen** stellt die Standardkacheln, die Standardreihenfolge der Bereiche und die Spalten der Organisation wieder her, schaltet **Kacheln ohne Inhalt ausblenden** wieder ein und beendet den Anpassungsmodus.

Ein Budgetadministrator wählt die Standardspalte und die Spaltennamen unter [Budgetspalten](budget-operations.md#budgetspalten). Die Budgetkacheln und die Berichte, die sie öffnen, folgen dieser Wahl.

Wenn alle Kacheln ausgeschaltet sind, zeigt die Seite: „Keine Kacheln aktiviert. Wählen Sie Ihre Kacheln über ‚Startseite anpassen‘.“

## Tipps

- **Beginnen Sie mit den Standardeinstellungen**: Das Dashboard wird mit einem nützlichen Satz von Kacheln bereits aktiviert ausgeliefert. Probieren Sie es einige Tage aus, bevor Sie es anpassen.
- **Verwenden Sie die Schnellaktionen**: Eine Aufgabe, eine Budgetzeile oder ein Dokument zu erstellen (oder Zeit zu erfassen) direkt vom Dashboard aus erspart Ihnen das Navigieren.
- **Überprüfen Sie überfällige Aufgaben täglich**: Die Kachel Meine Aufgaben hebt überfällige Elemente in Rot hervor, damit nichts durch die Maschen fällt.
- **Verwenden Sie veraltete Aufgaben im Team-Bereich**: Mit `tasks:admin` schalten Sie die Kachel Veraltete Aufgaben auf den Bereich `team` oder `all` um, um Arbeit zu finden, die in der gesamten Organisation niemand aktualisiert.
