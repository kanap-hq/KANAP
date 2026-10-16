# Kontakte

Kontakte dokumentieren die Personen, mit denen Sie zusammenarbeiten -- Key Account Manager, Support-Ingenieure, Berater und andere externe Stakeholder. Verknüpfen Sie Kontakte mit Lieferanten, um ein Lieferanten-Kontaktverzeichnis aufzubauen, und referenzieren Sie sie von Anwendungen und Standorten für Support-Informationen.

## Erste Schritte

Navigieren Sie zu **Stammdaten > Kontakte**, um Ihr Kontaktverzeichnis zu sehen. Klicken Sie auf **Neu**, um Ihren ersten Eintrag zu erstellen.

**Pflichtfelder**:
- **E-Mail**: Die E-Mail-Adresse des Kontakts (wird als eindeutige Kennung verwendet)

**Dringend empfohlen**:
- **Vorname** / **Nachname**: Der Name des Kontakts
- **Lieferant**: Für welchen Anbieter dieser Kontakt arbeitet
- **Kontakttyp**: Die Rolle des Kontakts beim Lieferanten (Vertrieb, Technik, Support oder Sonstige). Die Wahl eines Lieferanten setzt ihn auf Vertrieb; ändern Sie ihn bei Bedarf.

**Optional aber nützlich**:
- **Berufsbezeichnung**: Rolle oder Position
- **Telefon** / **Mobil**: Telefonnummern, mit Landesvorwahl eingegeben
- **Land**: Standort (ISO-Ländercode)

**Tipp**: Verknüpfen Sie Kontakte zuerst mit Lieferanten und referenzieren Sie sie dann von Anwendungen und Standorten für konsistente Support-Informationen.

---

## Mit der Liste arbeiten

Das Kontakte-Grid bietet ein durchsuchbares Verzeichnis aller externen Kontakte. Jede Zelle in einer Zeile ist ein anklickbarer Link, der die Kontaktseite öffnet.

**Standardspalten**:
- **Nachname** / **Vorname**: Kontaktname
- **Lieferant**: Der Anbieter, für den sie arbeiten
- **E-Mail**: E-Mail-Adresse
- **Aktiv**: Ob der Kontakt derzeit aktiv ist (Ja / Nein)

**Zusätzliche Spalten** (über Spaltenauswahl):
- **Berufsbezeichnung**: Rolle
- **Telefon** / **Mobil**: Telefonnummern
- **Land**: Standort
- **Erstellt**: Wann der Datensatz erstellt wurde

**Standardsortierung**: Nach Nachname, alphabetisch.

**Aktionen**:
- **Neu**: Neuen Kontakt erstellen (erfordert `contacts:manager`)
- **CSV importieren**: Massenimport von Kontakten (erfordert `contacts:admin`)
- **CSV exportieren**: Als CSV exportieren (erfordert `contacts:admin`)
- **Ausgewählte löschen**: Ausgewählte Kontakte entfernen (erfordert `contacts:admin`)

---

## Die Kontaktseite

Klicken Sie auf eine Zeile, um die Seite des Kontakts zu öffnen. Jede Änderung wird von selbst gespeichert: Es gibt keine Schaltfläche zum Speichern.

**Titel**: Der Name des Kontakts. Klicken Sie darauf, um Vorname und Nachname nebeneinander zu bearbeiten; die Änderung wird gespeichert, wenn Sie die beiden Felder verlassen oder Enter drücken, Escape verwirft sie. Ein Kontakt ohne Namen zeigt stattdessen seine E-Mail.

**Kopfzeile**, unter dem Namen:
- **Lieferant**: Der Lieferant, für den dieser Kontakt arbeitet, als Link zu seiner Seite. Ein Kontakt ohne Lieferant zeigt **Kein Lieferant**: Klicken Sie darauf, um die Eigenschaften zu öffnen und einen auszuwählen.
- **Kontakttyp**: Die Rolle des Kontakts beim Lieferanten: Vertrieb, Technik, Support oder Sonstige. Klicken Sie darauf, um einen anderen zu wählen. Er erscheint, sobald der Kontakt einen Lieferanten hat.
- **Status**: **Aktiv** oder **Inaktiv**. Klicken Sie darauf, um ihn zu ändern.
- **Verwendet in**: Die Anzahl der Lieferanten, Budgetzeilen, Verträge und anderen Einträge, mit denen der Kontakt verknüpft ist. Klicken Sie darauf, um zum Abschnitt **Verwendet in** zu springen.

**Eigenschaften** (das Feld rechts, geöffnet über seinen Reiter oder die Taste `P`):
- **Lieferant**: Wählen Sie den Lieferanten aus der Liste. Ein Kontakt mit Lieferant hat immer einen Kontakttyp: Die Wahl eines Lieferanten für einen Kontakt ohne Typ gibt ihm **Vertrieb**, den Sie sofort ändern können. Wird der Lieferant entfernt, wird auch der Kontakttyp entfernt.
- **Kontakttyp**: Dieselbe Auswahl wie in der Kopfzeile.
- **E-Mail**: Pflichtfeld, eindeutig unter Ihren Kontakten.
- **Funktion**: Die Rolle oder Position des Kontakts.
- **Telefon** / **Mobil**: Eine Vorwahl und eine Nummer. Wählen Sie die Vorwahl aus der Liste oder tippen Sie sie ein. Hat der Kontakt noch kein Land, setzt die Vorwahl es.
- **Land**: Durchsuchbare Länderliste.

Textfelder werden gespeichert, wenn Sie sie verlassen oder Enter drücken, Listen sofort bei der Auswahl. Ein Wert, den KANAP nicht annehmen kann (eine ungültige oder bereits von einem anderen Kontakt verwendete E-Mail, eine Telefonnummer, die nicht aus einer Vorwahl und einer Nummer mit insgesamt 7 bis 15 Ziffern besteht), zeigt seine Meldung unter dem Feld und wird nicht gespeichert.

**Notizen**: Freie Notizen (bis zu 2.000 Zeichen) unter der Kopfzeile. Sie werden kurz nach dem Ende der Eingabe gespeichert und wenn Sie das Feld verlassen.

Drücken Sie **Escape** oder klicken Sie auf die Schließen-Schaltfläche, um zur Liste zurückzukehren.

### Verwendet in

Der Abschnitt **Verwendet in**, unter den Notizen, listet alles auf, womit der Kontakt verknüpft ist, eine Liste pro Typ, jede mit ihrer Anzahl: Lieferanten, Budgetzeilen (OPEX und CAPEX, mit ihrer Referenz `BL-`), Verträge, Anwendungen, Assets, Standorte, Projekte (`PRJ-`) und Anfragen (`REQ-`). Jede Zeile zeigt die Rolle des Kontakts dort: den Kontakttyp bei Lieferanten, Budgetzeilen und Verträgen, die bei der Anwendung, dem Asset oder dem Standort eingetragene Rolle.

Klicken Sie auf eine Zeile, um die zugehörige Seite zu öffnen. Eine Liste zeigt bis zu 50 Einträge und nennt ihre Gesamtzahl. Sie sehen nur die Listen, die Sie lesen dürfen. Ein Kontakt, der mit nichts verknüpft ist, zeigt eine Zeile, die das sagt.

### Einen Kontakt erstellen

Klicken Sie in der Liste auf **Neu**. Geben Sie die E-Mail (Pflichtfeld) und die weiteren Felder ein und klicken Sie dann auf **Erstellen**. Die Wahl eines Lieferanten setzt den Kontakttyp auf **Vertrieb**, den Sie vor dem Erstellen ändern können. Nach dem Erstellen kehren Sie zur Liste zurück.

---

## Wo Kontakte verwendet werden

Kontakte erscheinen an mehreren Stellen in KANAP. Der Abschnitt **Verwendet in** der Kontaktseite listet sie alle auf.

### Lieferantenkontakte

Jeder Lieferant hat einen **Kontakte**-Tab, der alle mit diesem Anbieter verknüpften Kontakte zeigt. Sie können einen neuen Kontakt direkt aus dem Lieferanten-Arbeitsbereich erstellen:

1. Öffnen Sie den Lieferanten-Arbeitsbereich und gehen Sie zum **Kontakte**-Tab.
2. Klicken Sie auf **Neuer Kontakt** neben einem Kontakttyp.
3. Füllen Sie die Kontaktdetails aus: Lieferant und Kontakttyp sind vorausgefüllt.
4. Klicken Sie auf **Erstellen**: Sie kehren zum Reiter **Kontakte** des Lieferanten zurück.

### Anwendungs-Support

Im Anwendungs-Arbeitsbereich referenziert der Tab **Technik & Support** Kontakte für die Support-Eskalation.

### Standort-Kontakte

Standorte können Support-Kontakte haben (Facility Manager, NOC-Kontakte usw.).

---

## CSV-Import/Export

Verwalten Sie Kontakte in großen Mengen per CSV.

**Export**: Lädt die Kontakte der Liste mit ihren Details herunter. Wählen Sie im Dialog **Das ganze Verzeichnis** für alle Kontakte.

**Import**:
- Verwenden Sie die **Vorprüfung** zum Validieren vor dem Anwenden
- Zuordnung über E-Mail-Adresse
- Kann neue Kontakte erstellen oder bestehende aktualisieren

**Pflichtfelder**: E-Mail

**Optionale Felder**: `first_name`, `last_name`, `job_title`, `phone`, `mobile`, `country`, `notes`, `active`

**Hinweise**:
- Siehe [CSV-Dateien](csv-files.md) für die Kodierung, das Trennzeichen und die beiden Importschritte

---

## Tipps

- **Immer einen Lieferanten zuweisen**: Das Verknüpfen von Kontakten mit Lieferanten erleichtert das Finden und Verwalten.
- **Kontakttyp festlegen**: Sobald ein Lieferant verknüpft ist, wählen Sie, ob der Kontakt Kommerziell, Technisch, Support oder Sonstige ist. Das hilft beim Durchsuchen der Kontakte aus dem Lieferanten-Arbeitsbereich.
- **Konsistente Benennung**: Geben Sie Namen in einheitlichem Format ein (z. B. immer „Vorname Nachname").
- **Inaktive Kontakte markieren**: Wenn jemand einen Anbieter verlässt, markieren Sie ihn als inaktiv statt zu löschen -- dies bewahrt den Audit-Trail.
- **Berufsbezeichnungen eintragen**: Berufsbezeichnungen helfen, den richtigen Kontakt für verschiedene Bedürfnisse zu identifizieren (Vertrieb vs. Support vs. Account Management).
