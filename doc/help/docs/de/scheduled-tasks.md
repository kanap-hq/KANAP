# Geplante Aufgaben

Die Seite Geplante Aufgaben listet jeden wiederkehrenden Hintergrundjob auf, den KANAP nach einem Cron-Zeitplan ausführt: Bereinigungen, periodische Synchronisierungen, Zusammenfassungs-E-Mails, Aufbewahrungsdurchsetzung und so weiter. Von hier aus können Sie einen Job anhalten, den Ausführungszeitpunkt ändern, ihn auf Anforderung auslösen und den Verlauf jeder kürzlichen Ausführung einsehen.

## Wo Sie es finden

- Arbeitsbereich: **Administration** (Bereich Plattform)
- Pfad: **Administration → Geplante Aufgaben**
- Route: `/admin/scheduled-tasks`
- Zugriff: **Plattform-Admin** oder **Globaler Admin** auf einer Single-Tenant- (On-Premise-) Bereitstellung. Andere Rollen sehen eine „Verboten"-Seite.

## Die Aufgabenliste

Die Seite ist eine einzelne Tabelle, die sich alle 15 Sekunden automatisch aktualisiert, sodass Sie sie geöffnet lassen können, während Sie einen Job abwarten.

**Spalten**:

- **Name**: die interne Kennung der Aufgabe (zum Beispiel `purge-stale-conversations`)
- **Beschreibung**: eine kurze, für Menschen lesbare Zusammenfassung dessen, was die Aufgabe tut
- **Zeitplan**: der Cron-Ausdruck. Häufige Muster werden in Klartext übersetzt („Täglich um 3 Uhr", „Alle 15 Minuten", „Sonntags um 4 Uhr"); bewegen Sie den Mauszeiger über die Bezeichnung, um den Rohausdruck zu sehen. Klicken Sie auf das Stiftsymbol, um ihn inline zu bearbeiten.
- **Aktiviert**: schalten Sie die Aufgabe ein oder aus, ohne den Zeitplan zu ändern
- **Letzte Ausführung**: wann die Aufgabe zuletzt gestartet wurde
- **Dauer**: wie lange die letzte Ausführung dauerte (`ms`, `s` oder `m` je nach Länge)
- **Status**: farbiger Indikator für die letzte Ausführung: **Erfolgreich**, **Fehlgeschlagen**, **Läuft** oder **Nie ausgeführt**
- **Aktionen**: pro Zeile verfügbare Steuerelemente (siehe unten)

### Einen Zeitplan bearbeiten

Klicken Sie auf das Stiftsymbol neben einem Zeitplan, um einen Inline-Editor zu öffnen.

- Geben Sie einen Standard-Cron-Ausdruck mit 5 Feldern ein (`Minute Stunde Tag-des-Monats Monat Wochentag`).
- Drücken Sie **Enter** zum Speichern, **Escape** zum Abbrechen.
- Ungültige Ausdrücke werden mit einer Fehlermeldung am unteren Bildschirmrand abgelehnt. Die Aufgabe behält ihren vorherigen Zeitplan.

Wenn der neue Ausdruck einem bekannten Muster entspricht, zeigt die Tabelle sofort die freundliche Bezeichnung an.

### Eine Aufgabe aktivieren und deaktivieren

Schalten Sie den Schalter **Aktiviert** um, um eine Aufgabe anzuhalten oder fortzusetzen. Deaktivierte Aufgaben werden nicht mehr nach dem Cron-Zeitplan ausgeführt, können aber weiterhin manuell aus der Aktionen-Spalte ausgelöst werden.

### Eine Aufgabe auf Anforderung ausführen

Die Aktion **Jetzt ausführen** (Wiedergabesymbol) löst die Aufgabe sofort aus, unabhängig vom Zeitplan. Eine Bestätigung erscheint am unteren Bildschirmrand und die Zeile wird aktualisiert, sobald die Ausführung beginnt und abgeschlossen ist.

Dies ist das richtige Steuerelement für:

- Validierung einer gerade bereitgestellten Korrektur
- Erzwingen einer Synchronisierung nach einem Datenimport
- Smoke-Test eines Jobs vor dem erneuten Aktivieren

### Den Ausführungsverlauf anzeigen

Die Aktion **Verlauf anzeigen** (Uhrsymbol) öffnet eine Seitenleiste mit den letzten Ausführungen dieser Aufgabe.

Jede Ausführungszeile zeigt:

- **Gestartet**: wann die Ausführung begann
- **Status**: Erfolgreich, Fehlgeschlagen oder Läuft
- **Dauer**: wie lange die Ausführung dauerte
- **Details**: eine kurze strukturierte Zusammenfassung bei Erfolg oder die Fehlermeldung bei Fehler. Lange Fehlermeldungen werden in der Tabelle abgeschnitten; der vollständige Text bleibt im zugrunde liegenden Datensatz erhalten.

Eine Paginierung erscheint unter der Liste, wenn es mehr als 20 Ausführungen gibt. Die Seitenleiste kann mit dem X-Symbol in ihrer Kopfzeile oder durch Klicken außerhalb geschlossen werden.

## Tipps

- **Vor dem Debuggen anhalten**: Wenn sich eine Aufgabe falsch verhält, deaktivieren Sie sie zuerst, damit sie nicht weiter ausgeführt wird, während Sie untersuchen. Verwenden Sie **Jetzt ausführen**, um Korrekturen zu testen, ohne auf den nächsten geplanten Tick zu warten.
- **Lesen Sie die Ausführungsdetails**: Fehler enthalten oft genug Kontext (Datensatzanzahlen, Fehlermeldungen), um auf die Grundursache hinzuweisen, ohne in Server-Logs einzutauchen. Öffnen Sie den Ausführungsverlauf, bevor Sie sich per SSH auf einem Server anmelden.
- **Nutzen Sie Klartext-Prüfungen**: Wenn eine Zeitplan-Bezeichnung nicht dem entspricht, was Sie erwarten, ist der Cron-Ausdruck wahrscheinlich falsch. Die freundliche Übersetzung greift nur bei bekannten Mustern, sodass eine ungewohnte Bezeichnung eine nützliche Plausibilitätsprüfung Ihrer eigenen Eingabe ist.
