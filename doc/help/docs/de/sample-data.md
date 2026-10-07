# Beispieldaten

Auf der Seite Beispieldaten lernen Sie KANAP mit einem fertigen Datensatz kennen. Sie füllt einen leeren Arbeitsbereich mit Fromage & Co, einem fiktiven Käsehersteller, sodass Sie sehen, wie Budgets, Anwendungen, Verträge und Projekte zusammenspielen, bevor Sie Ihre eigenen Daten erfassen. Wenn Sie genug erkundet haben, löscht eine einzige Aktion alles und versetzt den Arbeitsbereich in seinen Ausgangszustand zurück.

## Wo Sie die Seite finden

- Arbeitsbereich: Menü **Administration** → **Beispieldaten**
- Route: `/admin/sample-data`
- Wer sie nutzen kann: Benutzer mit der Rolle **Administrator**. Eine Berechtigungsstufe eines Moduls, auch `admin`, gewährt keinen Zugriff.
- Nur in Cloud-Arbeitsbereichen verfügbar. Installationen auf Ihren eigenen Servern haben diese Seite nicht.

Die Seite ist auf dem Plattform-Host nicht verfügbar. Sie wirkt immer auf den Arbeitsbereich, in dem Sie angemeldet sind.

## Was der Beispieldatensatz enthält

Der Datensatz beschreibt Fromage & Co, einen fiktiven Käsehersteller:

- **4 Unternehmen** in Frankreich, den Niederlanden, Italien und den Vereinigten Staaten
- **18 fiktive Benutzer**, die sich nicht anmelden können und keine E-Mails erhalten
- **Anwendungen und ihre Landschaft**: Instanzen, Schnittstellen und Verbindungen
- **Verträge, das Budget des laufenden Jahres, Projekte und Aufgaben**

Die Daten richten sich nach dem laufenden Jahr, sodass das Budget immer aktuell wirkt. Das Laden dauert weniger als eine Minute.

Die fiktiven Benutzer haben weder ein Passwort noch Zugriff. Sie sorgen dafür, dass Verantwortliche, Zuständige und Projektteams realistisch aussehen. KANAP sendet ihnen keine E-Mails, und das Löschen entfernt sie.

## Beispieldaten laden

Beispieldaten werden nur in einen leeren Arbeitsbereich geladen. Ein Arbeitsbereich gilt als leer, wenn er nichts von Folgendem enthält:

- Geschäftsdaten wie Anwendungen, Assets, Verträge, Budgetzeilen, Projekte, Anfragen oder Aufgaben
- Stammdaten über das hinaus, womit ein neuer Arbeitsbereich startet: zusätzliche Unternehmen, Lieferanten, Kontakte, Abteilungen, Kostenstellen oder Standorte
- Konfiguration, die Sie hinzugefügt haben: ein eigener Kontenplan, Analysekategorien, Portfolio-Klassifizierung, zusätzliche Arbeitstagekalender, Integrationen oder KI-Agenten
- Dokumente außerhalb der Vorlagenbibliothek

Was ein neuer Arbeitsbereich selbst anlegt (sein erstes Unternehmen, der Standard-Kontenplan und der Kalender seines Landes), zählt nicht mit.

**So laden Sie den Datensatz**:

1. Öffnen Sie **Administration** → **Beispieldaten**.
2. Klicken Sie auf **Beispieldaten laden**.
3. Lesen Sie die Zusammenfassung im Dialog und bestätigen Sie mit **Beispieldaten laden**.

Die Seite zeigt den Ladevorgang Schritt für Schritt (zum Beispiel „Schritt 4 von 19: Kontenpläne“), und der Status wechselt am Ende zu **Geladen**. Alles, was Sie in KANAP sehen, wird dann mit den neuen Daten aktualisiert.

**Wenn der Arbeitsbereich bereits Daten enthält**, weist die Seite darauf hin und zeigt die Schaltfläche **Beispieldaten laden** nicht an.

**Wenn das Abonnement eingefroren oder die Testphase abgelaufen ist**, wird das Laden abgelehnt, und der Dialog nennt den Grund. Das Löschen bleibt möglich (siehe unten).

**Wenn das Laden fehlschlägt**, versetzt KANAP den Arbeitsbereich selbstständig in seinen Ausgangszustand zurück. Der Status zeigt **Laden fehlgeschlagen** mit Grund und Uhrzeit. Klicken Sie auf **Erneut versuchen**, um einen neuen Ladevorgang zu starten.

!!! warning "Warten Sie, bis das Laden abgeschlossen ist"
    Während eines Ladevorgangs wird alles, was im Arbeitsbereich erstellt wird, gelöscht, falls das Laden fehlschlägt. Beginnen Sie mit echter Arbeit erst, wenn der Status **Geladen** anzeigt.

## Das Banner auf der Startseite

Solange der Arbeitsbereich leer ist, sehen Administratoren oben auf der Startseite eine Zeile: „Entdecken Sie KANAP mit Beispieldaten.“

- **Laden** öffnet denselben Dialog wie die Seite.
- **Ausblenden** entfernt die Zeile dauerhaft, für alle Administratoren des Arbeitsbereichs. Die Seite unter **Administration** → **Beispieldaten** bleibt verfügbar.
- Während eines Ladevorgangs zeigt die Zeile den aktuellen Schritt.

Die Zeile verschwindet, sobald der Arbeitsbereich Daten enthält.

## Alles löschen und neu beginnen

Sobald Beispieldaten geladen sind, bietet die Seite **Alles löschen und neu beginnen** an. Die Aktion steht auch nach einem fehlgeschlagenen Ladevorgang zur Verfügung, der den Ausgangszustand nicht wiederherstellen konnte. Sie funktioniert auch, wenn das Abonnement eingefroren oder die Testphase abgelaufen ist.

**Diese Aktion lässt sich nicht rückgängig machen.** Der gesamte Inhalt des Arbeitsbereichs wird gelöscht, egal ob er aus dem Beispieldatensatz oder aus Ihrer eigenen Arbeit stammt, und der Arbeitsbereich kehrt in seinen Ausgangszustand zurück.

**Was gelöscht wird**:

- alle Datensätze: Anwendungen, Verträge, Budget, Projekte, Anfragen, Aufgaben, Dokumente, Stammdaten und so weiter
- hochgeladene Dateien und Anhänge
- die Beispielbenutzer

**Was erhalten bleibt**:

- echte Benutzerkonten und ihre Rollen
- das Abonnement
- Name, Adresse und Logo des Arbeitsbereichs
- die Microsoft-Anmeldung
- die KI-Einstellungen
- das Audit-Protokoll

**Was auf die Standardwerte zurückgesetzt wird**: die im Arbeitsbereich gespeicherten Einstellungen, nämlich Währungen, Budgetspalten und der Klassifizierungskatalog.

**So löschen Sie**:

1. Klicken Sie auf **Alles löschen und neu beginnen**.
2. Der Dialog listet auf, was erhalten bleibt. Wenn Sie seit dem Laden der Beispieldaten Elemente erstellt haben, nennt er auch deren Anzahl (zum Beispiel „12 Elemente, die seit dem Laden der Beispieldaten erstellt wurden, werden ebenfalls gelöscht“). Diese Elemente werden mit dem Rest gelöscht.
3. Geben Sie den Namen des Arbeitsbereichs, wie er im Dialog steht, in das Feld **Name des Arbeitsbereichs** ein. Groß- und Kleinschreibung sowie Leerzeichen um den Namen spielen keine Rolle.
4. Klicken Sie auf **Alles löschen**. Die Schaltfläche bleibt deaktiviert, bis der Name übereinstimmt.

Das Löschen dauert einige Sekunden. Der Status zeigt **Wird gelöscht** und danach **Nicht geladen**. In diesen Sekunden lehnt KANAP Änderungen aller Benutzer des Arbeitsbereichs ab, und eine Fehlermeldung rät, es gleich noch einmal zu versuchen. Lesen funktioniert weiterhin.

Sobald der Arbeitsbereich gelöscht ist, erhält jeder Administrator eine E-Mail, die angibt, wer ihn gelöscht hat und wann. Das Audit-Protokoll hält den Vorgang fest.

Nach dem Löschen ist der Arbeitsbereich wie neu: Sie können die Beispieldaten erneut laden oder mit der Erfassung Ihrer eigenen Daten beginnen.

## Tipps

- **Erst erkunden, dann aufräumen**: Laden Sie die Beispieldaten, um das Produkt kennenzulernen oder eine Demonstration vorzubereiten, und löschen Sie sie, bevor Sie echte Daten erfassen. Wer beides mischt, löscht mit dem Löschen auch die eigenen Einträge.
- **Anzahl vor dem Löschen prüfen**: Die Anzahl der seit dem Laden erstellten Elemente zeigt, ob jemand im Arbeitsbereich bereits echte Arbeit begonnen hat.
- **Eine Person nach der anderen**: In einem Arbeitsbereich kann immer nur ein Laden oder Löschen laufen. Hat ein anderer Administrator einen Vorgang gestartet, zeigt die Seite dessen Fortschritt.
- **Echte Benutzer sind geschützt**: Das Löschen behält jedes echte Konto, sodass niemand den Zugriff auf den Arbeitsbereich verliert.
