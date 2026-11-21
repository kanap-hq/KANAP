# Kontakte

Kontakte dokumentieren die Personen, mit denen Sie zusammenarbeiten: Key Account Manager, Support-Ingenieure, Berater und andere externe Stakeholder. Verknüpfen Sie Kontakte mit Lieferanten, um ein Lieferanten-Kontaktverzeichnis aufzubauen, und referenzieren Sie sie von Anwendungen und Standorten für Support-Informationen.

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
- **Referenz**: Die von Kadratis vergebene Referenz (`CTCT-3`)
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

**Schnellsuche**: Geben Sie eine Referenz ein, etwa `CTCT-3`, um diesen Kontakt zu finden. Ziffern allein suchen im Text.

**Spaltenfilter**: Der Filter **Referenz** nimmt `CTCT-3` oder `3` an.

**Aktionen**:
- **Neu**: Neuen Kontakt erstellen (erfordert `contacts:member`)
- **Importieren**: Massenimport von Kontakten (erfordert `contacts:admin`)
- **Exportieren**: In eine CSV-Datei oder Excel-Arbeitsmappe exportieren (erfordert `contacts:admin`)
- **Ausgewählte löschen**: Ausgewählte Kontakte entfernen (erfordert `contacts:admin`). Sie werden aus den Lieferanten, Budgetzeilen, Verträgen, Anwendungen, Assets, Standorten, Projekten und Anfragen entfernt, die sie nennen; diese Einträge bleiben erhalten

---

## Die Kontaktseite

Klicken Sie auf eine Zeile, um die Seite des Kontakts zu öffnen. Jede Änderung wird von selbst gespeichert: Es gibt keine Schaltfläche zum Speichern. Die Schaltfläche **Verlauf** in der Kopfzeile öffnet den Verlauf des Kontakts in einem Seitenbereich. Siehe [Verlauf der Datensätze](record-history.md).

**Titel**: Der Name des Kontakts. Klicken Sie darauf, um Vorname und Nachname nebeneinander zu bearbeiten; die Änderung wird gespeichert, wenn Sie die beiden Felder verlassen oder Enter drücken, Escape verwirft sie. Ein Kontakt ohne Namen zeigt stattdessen seine E-Mail.

**Referenz**: Die Referenz des Kontakts (`CTCT-4`) steht vor dem Namen. Klicken Sie darauf, um sie zu kopieren.

**Seitenadresse**: Die Adresse der Seite verwendet die Referenz, zum Beispiel `/master-data/contacts/CTCT-4/overview`. Die frühere Adresse der Seite eines Kontakts öffnet sie weiterhin und wird durch die neue ersetzt.

**Kopfzeile**, unter dem Namen:
- **Lieferant**: Der Lieferant, für den dieser Kontakt arbeitet, als Link zu seiner Seite. Ein Kontakt ohne Lieferant zeigt **Kein Lieferant**: Klicken Sie darauf, um die Eigenschaften zu öffnen und einen auszuwählen.
- **Kontakttyp**: Die Rolle des Kontakts beim Lieferanten: Vertrieb, Technik, Support oder Sonstige. Klicken Sie darauf, um einen anderen zu wählen. Er erscheint, sobald der Kontakt einen Lieferanten hat.
- **Status**: **Aktiv** oder **Inaktiv**. Klicken Sie darauf, um ihn zu ändern.
- **Verwendet in**: Die Anzahl der Lieferanten, Budgetzeilen, Verträge und anderen Einträge, mit denen der Kontakt verknüpft ist. Klicken Sie darauf, um zum Abschnitt **Verwendet in** zu springen.

**Eigenschaften** (das Feld rechts, geöffnet über seinen Reiter oder die Taste `P`):
- **Lieferant**: Wählen Sie den Lieferanten aus der Liste, oder geben Sie seinen Namen oder seine Referenz (`SUP-12`) ein. Ein Kontakt mit Lieferant hat immer einen Kontakttyp: Die Wahl eines Lieferanten für einen Kontakt ohne Typ gibt ihm **Vertrieb**, den Sie sofort ändern können. Wird der Lieferant entfernt, wird auch der Kontakttyp entfernt.
- **Kontakttyp**: Dieselbe Auswahl wie in der Kopfzeile.
- **E-Mail**: Pflichtfeld, eindeutig unter Ihren Kontakten.
- **Funktion**: Die Rolle oder Position des Kontakts.
- **Telefon** / **Mobil**: Eine Vorwahl und eine Nummer. Wählen Sie die Vorwahl aus der Liste oder tippen Sie sie ein. Hat der Kontakt noch kein Land, setzt die Vorwahl es.
- **Land**: Durchsuchbare Länderliste.

Textfelder werden gespeichert, wenn Sie sie verlassen oder Enter drücken, Listen sofort bei der Auswahl. Ein Wert, den Kadratis nicht annehmen kann (eine ungültige oder bereits von einem anderen Kontakt verwendete E-Mail, eine Telefonnummer, die nicht aus einer Vorwahl und einer Nummer mit insgesamt 7 bis 15 Ziffern besteht), zeigt seine Meldung unter dem Feld und wird nicht gespeichert.

**Notizen**: Freie Notizen (bis zu 2.000 Zeichen) unter der Kopfzeile. Sie werden kurz nach dem Ende der Eingabe gespeichert und wenn Sie das Feld verlassen.

Drücken Sie **Escape** oder klicken Sie auf die Schließen-Schaltfläche, um zur Liste zurückzukehren.

**Löschen**, ein Papierkorb-Symbol oben rechts, wird Kontakt-Administratoren (`contacts:admin`) angezeigt. Nach einer Bestätigung wird der Kontakt gelöscht und aus den Lieferanten, Budgetzeilen, Verträgen, Anwendungen, Assets, Standorten, Projekten und Anfragen entfernt, die ihn nennen; diese Einträge bleiben erhalten. Sie kehren zur Liste zurück.

### Verwendet in

Der Abschnitt **Verwendet in**, unter den Notizen, listet alles auf, womit der Kontakt verknüpft ist, eine Liste pro Typ, jede mit ihrer Anzahl: Lieferanten, Budgetzeilen (OPEX und CAPEX, mit ihrer Referenz `BL-`), Verträge (`CTR-`), Anwendungen, Assets, Standorte, Projekte (`PRJ-`) und Anfragen (`REQ-`). Jede Zeile zeigt die Rolle des Kontakts dort: den Kontakttyp bei Lieferanten, Budgetzeilen und Verträgen, die bei der Anwendung, dem Asset oder dem Standort eingetragene Rolle.

Klicken Sie auf eine Zeile, um die zugehörige Seite zu öffnen. Eine Liste zeigt bis zu 50 Einträge und nennt ihre Gesamtzahl. Sie sehen nur die Listen, die Sie lesen dürfen. Ein Kontakt, der mit nichts verknüpft ist, zeigt eine Zeile, die das sagt.

### Einen Kontakt erstellen

Klicken Sie in der Liste auf **Neu**. Die Seite des neuen Kontakts öffnet sich. Geben Sie Vor- und Nachnamen nebeneinander in der Kopfzeile ein, dann die E-Mail. Der Kontakt wird erstellt, wenn Sie das E-Mail-Feld mit einer gültigen E-Mail verlassen. Auch die Telefonnummern müssen gültig sein. Die Wahl eines Lieferanten setzt den Kontakttyp auf **Vertrieb**, den Sie ändern können. Ein Kontakt mit Lieferant braucht einen Typ. Dann werden alle Reiter verfügbar, und die übrigen Felder werden automatisch gespeichert. Drücken Sie Escape im Namen, um die Seite zu verlassen, ohne etwas zu erstellen, auch wenn Sie schon einen Namen eingegeben haben.

Solange der Kontakt erstellt wird, zeigt die Kopfzeile **Erstellen** und **Abbrechen**, bis Sie die Seite verlassen. **Strg+S** wirkt wie die angezeigte Schaltfläche. **Erstellen** speichert den Kontakt, sobald die Pflichtfelder angegeben sind, und lässt ihn geöffnet. Fehlt noch eines, wird seine Beschriftung rot mit einem Warnsymbol, und der Cursor springt dorthin. Sobald der Kontakt erstellt ist, wird **Erstellen** zu **Fertig**: Es speichert, was Sie gerade eingeben, und bringt Sie dorthin zurück, wo Sie begonnen haben, zur Liste, zum vorherigen Bildschirm oder zum Lieferanten, von dem aus Sie begonnen haben. **Abbrechen** verlässt die Seite, ohne etwas zu behalten. Ein bereits erstellter Kontakt wird dabei gelöscht. Wenn Sie mehr als die Angaben zur Erstellung eingegeben haben, nennt eine Bestätigung, was gelöscht wird. Sie können Ihre eigene Erstellung auch ohne das Recht zum Löschen von Kontakten abbrechen. Verlassen Sie die Seite auf andere Weise, bleibt der Kontakt bestehen.

---

## Wo Kontakte verwendet werden

Kontakte erscheinen an mehreren Stellen in Kadratis. Der Abschnitt **Verwendet in** der Kontaktseite listet sie alle auf.

### Lieferantenkontakte

Jeder Lieferant hat einen **Kontakte**-Tab, der alle mit diesem Anbieter verknüpften Kontakte zeigt. Sie können einen neuen Kontakt direkt aus dem Lieferanten-Arbeitsbereich erstellen:

1. Öffnen Sie den Lieferanten-Arbeitsbereich und gehen Sie zum **Kontakte**-Tab.
2. Klicken Sie auf **Neuer Kontakt** neben einem Kontakttyp.
3. Füllen Sie die Kontaktdetails aus: Lieferant und Kontakttyp sind vorausgefüllt.
4. Klicken Sie auf **Erstellen**, dann auf **Fertig**: Sie kehren zum Reiter **Kontakte** des Lieferanten zurück.

### Anwendungs-Support

Im Anwendungs-Arbeitsbereich referenziert der Tab **Technik & Support** Kontakte für die Support-Eskalation.

### Technologie-Support

Im Technologie-Arbeitsbereich listet der Reiter **Betrieb** die Support-Kontakte einer Technologie. Siehe [Technologien](technologies.md#betrieb). Im Abschnitt **Verwendet in** des Kontakts steht eine außer Betrieb genommene Technologie am Ende, markiert als **Deaktiviert**.

### Standort-Kontakte

Standorte können Support-Kontakte haben (Facility Manager, NOC-Kontakte usw.).

---

## CSV-Import/Export

Der Export schreibt eine CSV-Datei oder eine Excel-Arbeitsmappe (`.xlsx`): Wählen Sie unter **Format** im Dialog. Der Import liest beides. Siehe [CSV- und Excel-Dateien](csv-files.md).

Verwalten Sie Kontakte in großen Mengen mit CSV-Dateien oder Excel-Arbeitsmappen.

**Export**: Lädt die Kontakte der Liste mit ihrer Referenz und ihren Details herunter. Wählen Sie im Dialog **Das ganze Verzeichnis** für alle Kontakte.

**Import**:
- Verwenden Sie die **Vorabprüfung** zum Validieren vor dem Anwenden
- Kann neue Kontakte erstellen oder bestehende aktualisieren
- **Zuordnung über die Referenz**: Eine ausgefüllte `reference` (`CTCT-4` oder `4`) bezeichnet den Kontakt, den die Zeile aktualisiert, auch wenn sich seine E-Mail geändert hat. Der Kontakt erhält den Namen und die E-Mail, die die Zeile angibt. Die Vorabprüfung meldet jeden Kontakt, der umbenannt wird oder seine E-Mail-Adresse ändert
- **Zuordnung über die E-Mail**: Ist `reference` leer oder fehlt die Spalte in der Datei, wird die Zeile über die E-Mail-Adresse zugeordnet
- **Unbekannte Referenz**: Eine Referenz, die Ihr Arbeitsbereich nicht kennt, lehnt die Zeile ab: „„CTCT-999“ ist keine Referenz in diesem Arbeitsbereich. Lassen Sie die Zelle leer, um die Zeile ohne sie zu importieren.“ Das betrifft etwa eine Datei, die aus einem anderen Arbeitsbereich exportiert wurde
- **E-Mail ändern**: Eine E-Mail, die bereits ein anderer Kontakt hat, wird abgelehnt, und die Meldung nennt dessen Referenz: „„ana@acme.example“ gehört bereits zu CTCT-7.“
- **Eine Zeile pro Kontakt**: Zwei Zeilen, die denselben Kontakt aktualisieren, werden abgelehnt: „Diese Zeile aktualisiert CTCT-7, wie Zeile 3. Verwenden Sie eine Zeile pro Datensatz.“ Zwei Zeilen, die denselben Kontakt anlegen (gleiche E-Mail, unabhängig von der Groß- und Kleinschreibung), werden ebenfalls abgelehnt: „Gleiche Werte in email wie in Zeile 3.“

- **Leere Zellen und `-`**: Bei einem Kontakt, den die Datei aktualisiert, behält eine leere Zelle den gespeicherten Wert, und `-` leert ihn. `-` leert die Namen, `job_title`, `phone`, `mobile`, `country` und `notes`. Es kann `reference`, `email` oder `active` nicht leeren: Die Zeile wird abgelehnt. Siehe [Leere Zellen und `-`](csv-files.md#empty-cells-and-clearing)

**Lieferantenspalten**:
- `supplier_name` legt den Lieferanten des Kontakts fest, über seine Referenz (`SUP-12`) oder seinen Namen. Namen werden gefunden, wie unter [Namen von Datensätzen](csv-files.md#names-of-records) beschrieben: Ein Name, der mit anderen Akzenten gefunden wird, wird bei der Prüfung aufgeführt, und Sie können die Zuordnung rückgängig machen. Ein Name, der zu keinem oder zu mehreren Lieferanten passt, lehnt die Zeile ab. Der Import legt nie einen Lieferanten an
- `supplier_role` ist der Kontakttyp für diesen Lieferanten: `commercial`, `technical`, `support` oder `other`, oder das Wort, das die Kontaktseite zeigt, in einer der vier Sprachen. Bleibt die Zelle leer, behält der Kontakt seinen Typ, und ein Kontakt ohne Typ erhält **Vertrieb**, wie auf der Kontaktseite
- Ein leerer `supplier_name` behält den Lieferanten. `-` entfernt den Lieferanten und seinen Kontakttyp. `-` nur in `supplier_role` wird abgelehnt, ebenso ein Typ bei einem Kontakt ohne Lieferanten
- Ein Wechsel des Lieferanten bewirkt dasselbe wie die Wahl des Lieferanten auf der Kontaktseite
- Der Export und die Vorlage enthalten beide Spalten

**Pflichtfelder**: `email`, bei einem neuen Kontakt

**Optionale Felder**: `reference`, `first_name`, `last_name`, `job_title`, `phone`, `mobile`, `country`, `supplier_name`, `supplier_role`, `notes`, `active`

**Hinweise**:
- Siehe [CSV- und Excel-Dateien](csv-files.md) für die Kodierung, das Trennzeichen und die beiden Importschritte

---

## Tipps

- **Immer einen Lieferanten zuweisen**: Das Verknüpfen von Kontakten mit Lieferanten erleichtert das Finden und Verwalten.
- **Kontakttyp festlegen**: Sobald ein Lieferant verknüpft ist, wählen Sie, ob der Kontakt Kommerziell, Technisch, Support oder Sonstige ist. Das hilft beim Durchsuchen der Kontakte aus dem Lieferanten-Arbeitsbereich.
- **Konsistente Benennung**: Geben Sie Namen in einheitlichem Format ein (z. B. immer „Vorname Nachname").
- **Inaktive Kontakte markieren**: Wenn jemand einen Anbieter verlässt, markieren Sie ihn als inaktiv statt zu löschen. Dies bewahrt den Audit-Trail.
- **Berufsbezeichnungen eintragen**: Berufsbezeichnungen helfen, den richtigen Kontakt für verschiedene Bedürfnisse zu identifizieren (Vertrieb vs. Support vs. Account Management).
