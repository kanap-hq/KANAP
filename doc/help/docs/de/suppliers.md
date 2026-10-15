# Lieferanten

Lieferanten (auch als Anbieter bezeichnet) repräsentieren die Unternehmen, bei denen Sie Software, Dienstleistungen und Support einkaufen. Verknüpfen Sie Lieferanten mit Anwendungen, Verträgen und OPEX-Zeilen, um Lieferantenbeziehungen und Ausgaben in Ihrem gesamten IT-Portfolio zu verfolgen.

## Erste Schritte

Navigieren Sie zu **Stammdaten > Lieferanten**, um das Lieferantenverzeichnis zu öffnen. Klicken Sie auf **Neu**, um Ihren ersten Eintrag zu erstellen.

**Pflichtfelder**:
- **Name**: Der Lieferanten- oder Anbietername

**Optional aber nützlich**:
- **ERP-Lieferanten-ID**: Referenz-ID aus Ihrem ERP- oder Beschaffungssystem
- **Notizen**: Freitext-Notizen zur Anbieterbeziehung

**Tipp**: Erstellen Sie Lieferanten, bevor Sie Anwendungen oder Verträge anlegen -- Sie können sie dann bei der Erstellung verknüpfen.

---

## Mit der Liste arbeiten

Die Lieferantenliste bietet Ihnen ein durchsuchbares, sortierbares Verzeichnis aller Ihrer Anbieter.

**Standardspalten**:
- **Name**: Lieferantenname (zum Öffnen der Lieferantenseite anklicken)
- **ERP-Lieferanten-ID**: Referenz-ID aus externen Systemen

**Zusätzliche Spalten** (über Spaltenauswahl):
- **Status**: Aktiviert oder Deaktiviert
- **Notizen**: Zusätzliche Informationen
- **Erstellt**: Wann der Datensatz erstellt wurde

Jede Zelle in einer Zeile ist anklickbar und öffnet die Seite dieses Lieferanten.

**Standardsortierung**: Nach Name, alphabetisch.

**Filtern**:
- Schnellsuche: Durchsucht Lieferantenfelder
- Statusbereich: Verwenden Sie den Umschalter **Anzeigen: Alle / Aktiv / Deaktiviert** über dem Grid, um nach Status zu filtern. Standardmäßig zeigt die Liste aktivierte Lieferanten

**Aktionen**:
- **Neu**: Neuen Lieferanten erstellen (erfordert `suppliers:manager`)
- **CSV importieren**: Massenimport von Lieferanten (erfordert `suppliers:admin`)
- **CSV exportieren**: Liste als CSV exportieren (erfordert `suppliers:admin`)
- **Ausgewählte löschen**: Ausgewählte Lieferanten entfernen (erfordert `suppliers:admin`)

---

## Die Lieferantenseite

Klicken Sie auf eine Zeile, um die Seite des Lieferanten zu öffnen. Mit den Pfeilen oben oder den Pfeiltasten links und rechts wechseln Sie zwischen den Lieferanten, ohne zur Liste zurückzukehren. Jede Änderung wird von selbst gespeichert: Es gibt keine Schaltfläche zum Speichern.

Die Seite hat zwei Reiter: **Übersicht** und **Kontakte**.

**Titel**: Der Name des Lieferanten. Klicken Sie darauf, um ihn zu bearbeiten; die Änderung wird gespeichert, wenn Sie das Feld verlassen oder Enter drücken, Escape verwirft sie. Der Name ist Pflicht und muss sich von den Namen aller anderen Lieferanten unterscheiden: KANAP zeigt die Meldung unter dem Namen und behält den gespeicherten Namen.

**Referenz**: Die ERP-Lieferanten-ID steht, wenn der Lieferant eine hat, vor dem Namen. Klicken Sie darauf, um sie zu kopieren.

**Kopfzeile**, unter dem Namen:
- **Status**: **Aktiviert** oder **Deaktiviert**. Klicken Sie darauf, um ihn zu ändern. Die Wahl von **Deaktiviert** setzt das Ende der Gültigkeit auf heute.
- **Kontakte**: Die Anzahl der mit dem Lieferanten verknüpften Kontakte. Klicken Sie darauf, um den Reiter **Kontakte** zu öffnen.
- **Verwendet in**: Die Anzahl der Budgetzeilen, Verträge, Anwendungen und Assets, die den Lieferanten verwenden. Klicken Sie darauf, um zum Abschnitt **Verwendet in** im Reiter **Übersicht** zu springen.

**Eigenschaften** (das Feld rechts, geöffnet über seinen Reiter oder die Taste `P`):
- **ERP-Lieferanten-ID**: Die ID des Lieferanten in Ihrem ERP- oder Beschaffungssystem. Sie wird gespeichert, wenn Sie das Feld verlassen oder Enter drücken.
- **Lebenszyklus**: Der Statusschalter und das Datum **Ende der Gültigkeit**. Lassen Sie das Datum leer, damit der Lieferant unbegrenzt aktiv bleibt, oder legen Sie ein künftiges Datum fest, um sein Ende zu planen.

**Notizen**: Freie Notizen zum Lieferanten, im Reiter **Übersicht**. Sie werden kurz nach dem Ende der Eingabe gespeichert und wenn Sie das Feld verlassen.

Zum Bearbeiten ist die Berechtigung `suppliers:manager` erforderlich. Benutzer mit Lesezugriff sehen dieselbe Seite, können aber nichts ändern.

Drücken Sie **Escape** oder klicken Sie auf die Schaltfläche zum Schließen, um zur Liste zurückzukehren.

### Kontakte

Der Reiter **Kontakte** listet die mit diesem Lieferanten verknüpften Kontakte nach Kontakttyp:

| Kontakttyp | Zweck |
|------|---------|
| **Vertrieb** | Ansprechpartner für Vertrieb und Kundenbetreuung |
| **Technik** | Ansprechpartner für Engineering und technischen Support |
| **Support** | Ansprechpartner für Helpdesk und Kundensupport |
| **Sonstige** | Jeder Kontakt, der zu keinem der obigen Typen passt |

**So funktioniert es**:
- Jeder Abschnitt listet seine Kontakte mit Namen. Klicken Sie auf einen Namen, um die Kontaktseite zu öffnen.
- **Vorhandenen hinzufügen**: Suchen Sie einen Kontakt nach Namen und wählen Sie ihn aus. Die Verknüpfung wird sofort gespeichert.
- **Neuer Kontakt**: Öffnet das Kontaktformular mit bereits ausgefülltem Lieferanten und Kontakttyp. KANAP bringt Sie nach dem Erstellen des Kontakts zu diesem Reiter zurück.
- Die Papierkorb-Schaltfläche entfernt die Verknüpfung. Der Kontakt selbst bleibt in Ihren Kontakten.

**Tipp**: Pflegen Sie mindestens einen Kontakt pro Lieferant, damit die Kommunikation mit ihm immer nur einen Klick entfernt ist.

### Verwendet in

Der Abschnitt **Verwendet in**, unter den Notizen im Reiter **Übersicht**, listet auf, was auf diesen Lieferanten verweist, eine Liste pro Typ, jede mit ihrer Anzahl:

- **Budgetzeilen**: OPEX- und CAPEX-Zeilen mit diesem Lieferanten, mit ihrer Referenz (`BL-12`) und ihrem Typ.
- **Verträge**: Verträge mit diesem Lieferanten.
- **Anwendungen**: Anwendungen, deren Hersteller er ist.
- **Assets**: Assets, die er betreut (der Support-Lieferant des Assets).

Klicken Sie auf eine Zeile, um die zugehörige Seite zu öffnen. Deaktivierte Einträge tragen den Hinweis **Deaktiviert** und stehen nach den anderen. Eine Liste zeigt bis zu 50 Einträge und nennt ihre Gesamtzahl. Bei mehr als 50 haben Budgetzeilen, Verträge und Anwendungen einen Link wie **Alle 57 anzeigen**, der ihre Liste gefiltert auf diesen Lieferanten öffnet. Sie sehen nur die Listen, die Sie lesen dürfen: Ein Benutzer ohne Zugriff auf Verträge sieht keine Vertragsliste. Ein Lieferant, den nichts verwendet, zeigt eine Zeile, die das sagt.

Prüfen Sie diesen Abschnitt, bevor Sie einen Lieferanten deaktivieren oder löschen. Ein Lieferant, den noch Budgetzeilen, Verträge, Anwendungen oder Assets verwenden, kann nicht gelöscht werden. Die Meldung zählt auf, was ihn verwendet, zum Beispiel „Dieser Lieferant wird noch verwendet: 2 Verträge und 1 Anwendung“. Deaktivieren Sie ihn stattdessen.

### Einen Lieferanten erstellen

Klicken Sie in der Liste auf **Neu**. Geben Sie den Namen (Pflicht), die ERP-Lieferanten-ID und die Notizen ein und klicken Sie dann auf **Erstellen**. Der Lieferant wird aktiviert angelegt und seine Seite öffnet sich, mit verfügbarem Reiter **Kontakte**.

---

## CSV-Import/Export

**CSV exportieren** lädt alle Lieferanten mit ihren aktuellen Angaben herunter. **CSV importieren** liest eine Datei wieder ein. Der Importdialog bietet außerdem **Vorlage herunterladen**: eine Datei nur mit den Kopfzeilen.

Die Spalten:

| Spalte | Inhalt |
|---|---|
| `name` | Pflicht. Der Name des Lieferanten. Zeilen werden über diesen Namen zugeordnet |
| `erp_supplier_id` | Die ID des Lieferanten in Ihrem ERP |
| `commercial_contact` | Die E-Mail-Adresse eines Kontakts. Das Laden verknüpft den Lieferanten mit dem Kontakt dieser Adresse und legt ihn an, wenn der Arbeitsbereich keinen hat |
| `technical_contact` | Die E-Mail-Adresse eines Kontakts, wie oben |
| `support_contact` | Die E-Mail-Adresse eines Kontakts, wie oben |
| `notes` | Freier Text |
| `status` | `enabled` oder `disabled` |

**Import**:

- Verwenden Sie die **Vorabprüfung**, um die Datei vor dem Anwenden zu prüfen, und dann **Laden**
- Zeilen werden über `name` zugeordnet: Eine Zeile aktualisiert den Lieferanten, den sie nennt, jede andere Zeile legt einen an
- `name` ist Pflicht. Jede andere Zelle ist optional

**Hinweise**:
- Siehe [CSV-Dateien](csv-files.md) für die Kodierung, das Trennzeichen und die beiden Importschritte
- Importieren Sie Lieferanten, bevor Sie Anwendungen oder Verträge importieren, die sie referenzieren. Die Budgetdatei legt einen fehlenden Lieferanten ebenfalls an, wenn **Fehlende Lieferanten anlegen** angehakt ist. Siehe [Ein Budget aus einer Tabellenkalkulation laden](budget-file.md)

---

## Tipps

- **Konsistente Benennung**: Verwenden Sie offizielle Anbieternamen (z. B. „Microsoft Corporation" statt „MS" oder „MSFT"), um Duplikate zu vermeiden.
- **ERP-IDs frühzeitig hinzufügen**: Wenn Sie ein ERP-System verwenden, erleichtert die Erfassung der Lieferanten-ID den Abgleich.
- **Deaktivieren statt löschen**: Wenn Sie die Zusammenarbeit mit einem Anbieter beenden, deaktivieren Sie ihn statt zu löschen, um historische Daten in Verträgen und Anwendungen zu bewahren.
- **Kontakte nach Rollen organisieren**: Verwenden Sie die vier Rollenkategorien, damit Kollegen die richtige Ansprechperson bei jedem Anbieter leicht finden.
- **Vor dem Verknüpfen erstellen**: Fügen Sie Lieferanten den Stammdaten hinzu, bevor Sie Anwendungen oder Verträge erstellen, die sie referenzieren.
