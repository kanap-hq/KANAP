# Lieferanten

Lieferanten (auch als Anbieter bezeichnet) repräsentieren die Unternehmen, bei denen Sie Software, Dienstleistungen und Support einkaufen. Verknüpfen Sie Lieferanten mit Anwendungen, Verträgen und OPEX-Positionen, um Lieferantenbeziehungen und Ausgaben in Ihrem gesamten IT-Portfolio zu verfolgen.

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
- **Name**: Lieferantenname (zum Öffnen des Arbeitsbereichs anklicken)
- **ERP-Lieferanten-ID**: Referenz-ID aus externen Systemen

**Zusätzliche Spalten** (über Spaltenauswahl):
- **Status**: Aktiviert oder Deaktiviert
- **Notizen**: Zusätzliche Informationen
- **Erstellt**: Wann der Datensatz erstellt wurde

Jede Zelle in einer Zeile ist anklickbar und navigiert zum Arbeitsbereich dieses Lieferanten.

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

## Der Lieferanten-Arbeitsbereich

Klicken Sie auf eine beliebige Zeile, um den Arbeitsbereich zu öffnen. Verwenden Sie **Zurück** und **Weiter**, um zwischen Lieferanten zu wechseln, ohne zur Liste zurückzukehren. Bei nicht gespeicherten Änderungen fordert KANAP Sie vor dem Navigieren auf.

Der Arbeitsbereich hat zwei Tabs: **Übersicht** und **Kontakte**.

### Übersicht

Der Übersichts-Tab erfasst die Identität und den Status des Lieferanten.

**Was Sie bearbeiten können**:
- **Name**: Lieferanten- oder Anbietername (Pflicht)
- **ERP-Lieferanten-ID**: Referenz-ID aus Ihrem Beschaffungs- oder ERP-System
- **Lebenszyklus**: der Statusschalter, dessen Beschriftung den aktuellen Zustand zeigt (**Aktiviert** oder **Deaktiviert**), und das Datum **Ende der Gültigkeit**. Lassen Sie das Datum leer, damit der Lieferant unbegrenzt aktiv bleibt, oder setzen Sie ein zukünftiges Datum, um sein Ende zu planen. Wenn Sie den Lieferanten ohne Datum auf **Deaktiviert** setzen, wird das Ende der Gültigkeit auf heute gesetzt
- **Notizen**: Freitext-Notizen zum Anbieter

Zum Bearbeiten ist die Berechtigung `suppliers:manager` erforderlich. Schreibgeschützte Benutzer sehen die gleichen Felder, können aber keine Änderungen vornehmen.

---

### Kontakte

Der Kontakte-Tab organisiert die mit diesem Lieferanten verknüpften Kontakte in vier Rollenkategorien:

| Rolle | Zweck |
|-------|-------|
| **Kommerziell** | Vertriebs- und Account-Management-Kontakte |
| **Technisch** | Ingenieure und technischer Support |
| **Support** | Helpdesk und Kundensupport |
| **Sonstige** | Alle Kontakte, die nicht in die obigen Rollen passen |

**Funktionsweise**:
- Jeder Rollenabschnitt listet seine verknüpften Kontakte in einer Tabelle mit Vorname, Nachname, Berufsbezeichnung, E-Mail und Mobil
- Klicken Sie auf eine Kontaktzeile, um den Arbeitsbereich dieses Kontakts zu öffnen
- Verwenden Sie **Hinzufügen**, um einen bestehenden Kontakt zu suchen und einer Rolle zuzuordnen
- Verwenden Sie **Erstellen**, um einen neuen Kontakt zu erstellen und in einem Schritt zu verknüpfen -- KANAP kehrt anschließend zu diesem Tab zurück

**Tipp**: Halten Sie mindestens einen Kontakt pro Lieferanten bereit, damit die Anbieterkommunikation immer nur einen Klick entfernt ist.

Beim Erstellen eines neuen Lieferanten ist der Kontakte-Tab deaktiviert, bis Sie den Datensatz speichern.

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
