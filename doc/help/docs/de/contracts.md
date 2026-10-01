# Verträge

Verträge dokumentieren Ihre Lieferantenvereinbarungen -- Softwarelizenzen, Wartungsverträge, SaaS-Abonnements und Servicevereinbarungen. Verfolgen Sie wichtige Termine, Kosten, Verlängerungsbedingungen und verknüpfen Sie Verträge mit Ihren OPEX- und CAPEX-Positionen für vollständige Kostentransparenz.

## Erste Schritte

Navigieren Sie zu **Budgetverwaltung > Verträge**, um Ihr Vertragsregister zu sehen. Klicken Sie auf **Neu**, um Ihren ersten Eintrag zu erstellen.

**Pflichtfelder**:

- **Name**: Ein wiedererkennbarer Vertragsname
- **Lieferant**: Der Anbieter, der die Dienstleistung erbringt
- **Unternehmen**: Welches Unternehmen den Vertrag unterzeichnet hat

**Dringend empfohlen** (setzen Sie diese im Details-Tab direkt nach der Erstellung):

- **Startdatum**: Wann der Vertrag beginnt
- **Laufzeit**: Vertragsdauer in Monaten
- **Jahresbetrag**: Der jährliche Vertragswert
- **Währung**: Vertragswährung
- **Automatische Verlängerung**: Ob sich der Vertrag automatisch verlängert
- **Kündigungsfrist**: Wie viele Monate Kündigungsfrist erforderlich sind

**Tipp**: Das System berechnet automatisch das Enddatum und die Kündigungsfrist basierend auf Ihrem Startdatum, der Laufzeit und der Kündigungsfrist.

---

## Mit der Liste arbeiten

Das Vertrags-Grid bietet einen Überblick über alle Ihre Lieferantenvereinbarungen. Jede Zeile ist ein anklickbarer Link, der den Vertrags-Arbeitsbereich öffnet, und Ihr Such- und Filterkontext bleibt erhalten, wenn Sie zurücknavigieren.

**Standardspalten**:

- **Vertrag**: Vertragsname (zum Öffnen des Arbeitsbereichs anklicken)
- **Lieferant**: Der Anbieter
- **Unternehmen**: Die Vertragspartei
- **Start**: Vertragsstartdatum
- **Laufzeit (M)**: Dauer in Monaten
- **Auto-Verlängerung**: Ob sich der Vertrag automatisch verlängert (Ja/Nein)
- **Kündigungsfrist (M)**: Kündigungsfrist in Monaten
- **Ende**: Berechnetes Enddatum
- **Kündigen bis**: Kündigungsstichtag (Enddatum minus Kündigungsfrist)
- **Jahresbetrag**: Jährlicher Vertragswert (mit Leerzeichen formatiert)
- **Währ.**: Währungscode
- **Abrechnung**: Abrechnungshäufigkeit (Monatlich, Vierteljährlich, Jährlich, Sonstige)
- **Verknüpfte OPEX**: Anzahl verknüpfter OPEX-Positionen (zum Öffnen des Arbeitsbereichs anklicken)
- **Status**: **Aktiviert** oder **Deaktiviert**, aus dem Ende der Gültigkeit ermittelt

**Zusätzliche Spalten** (über Spaltenauswahl):

- **Aufgabe**: Neueste Aufgabe für diesen Vertrag (Status und Beschreibungsvorschau)

**Standardsortierung**: Nach Kündigungsstichtag aufsteigend, sodass Verträge, die bald Handlung erfordern, zuerst erscheinen.

**Filtern**:

- Schnellsuche: Durchsucht Vertragsname, Lieferant und Unternehmen
- Spaltenfilter: Verfügbar in jeder Spaltenüberschrift. Der Filter **Status** bietet **Aktiviert** und **Deaktiviert**. Wenn Sie darin auf **Leeren** klicken oder beide Werte abwählen, zeigt die Liste nichts mehr an, unabhängig von **Anzeigen**
- **Statusbereich**: der Umschalter **Anzeigen: Alle / Aktiv / Deaktiviert** über der Liste. Standardmäßig zeigt die Liste aktivierte Verträge. Wählen Sie **Alle** oder **Deaktiviert**, um Verträge zu finden, deren Ende der Gültigkeit überschritten ist

**Aktionen**:

- **Neu**: Neuen Vertrag erstellen (erfordert `contracts:manager`)
- **CSV importieren**: Massenimport von Verträgen (erfordert `contracts:admin`)
- **CSV exportieren**: Als CSV exportieren (erfordert `contracts:admin`)

---

## Der Vertrags-Arbeitsbereich

Klicken Sie auf eine beliebige Zeile, um den Arbeitsbereich zu öffnen. Der Header zeigt den Vertragsnamen, Ihre Position in der Liste (z. B. „Vertrag 3 von 42") und Navigationssteuerungen:

- **Zurück / Weiter**: Zwischen Verträgen wechseln, ohne zur Liste zurückzukehren
- **Zurücksetzen**: Nicht gespeicherte Änderungen auf dem aktuellen Tab verwerfen
- **Speichern**: Ihre Bearbeitungen sichern
- **Schließen** (X-Symbol): Zur Liste zurückkehren, Such- und Filterkontext beibehalten

Der Arbeitsbereich hat vier vertikale Tabs: **Übersicht**, **Details**, **Verknüpfungen** und **Aufgaben**.

### Übersicht

Der Übersichts-Tab erfasst die Identität und den Lebenszyklusstatus des Vertrags.

**Was Sie bearbeiten können**:

- **Vertragsname**: Der Anzeigename, der in Listen und Berichten verwendet wird
- **Lieferant**: Verknüpfung zu einem Lieferanten aus den Stammdaten
- **Vertragsunternehmen**: Welches Unternehmen Vertragspartei ist
- **Verantwortlicher**: Die für die Verwaltung dieses Vertrags zuständige Person
- **Notizen**: Freitext-Notizen
- **Statusschalter**: Seine Beschriftung zeigt den aktuellen Zustand (**Aktiviert** oder **Deaktiviert**). Wenn Sie den Vertrag ohne Datum auf **Deaktiviert** setzen, wird das Ende der Gültigkeit auf heute gesetzt
- **Ende der Gültigkeit**: das Datum, an dem der Vertrag endet. Geben Sie ein Datum im Format tt/mm/jjjj ein oder verwenden Sie die Kalender-Schaltfläche. Lassen Sie es leer, damit der Vertrag unbegrenzt aktiv bleibt

**Funktionsweise**:

- Beim Erstellen eines neuen Vertrags ist nur der Übersichts-Tab verfügbar. Nach dem Speichern werden die übrigen Tabs zugänglich und Sie gelangen direkt zum Details-Tab, um die Konditionen einzugeben.
- Name, Lieferant und Unternehmen sind Pflicht zum Erstellen eines Vertrags.

---

### Details

Der Details-Tab erfasst Termine, Konditionen und Finanzinformationen.

**Was Sie bearbeiten können**:

- **Startdatum**: Wann der Vertrag beginnt (TT/MM/JJJJ)
- **Laufzeit (Monate)**: Vertragsdauer
- **Kündigungsfrist (Monate)**: Erforderliche Kündigungsfrist
- **Jahresbetrag**: Der jährliche Vertragswert bei Vertragsabschluss
- **Währung**: Dreistelliger Währungscode (z. B. EUR, USD)
- **Abrechnungshäufigkeit**: Monatlich, Vierteljährlich, Jährlich oder Sonstige
- **Automatische Verlängerung**: Ob sich der Vertrag automatisch verlängert

**Berechnete Felder** (schreibgeschützt):

- **Enddatum**: Startdatum plus Laufzeit
- **Kündigungsstichtag**: Enddatum minus Kündigungsfrist

---

### Verknüpfungen

Der Verknüpfungen-Tab verbindet Verträge mit anderen Objekten in Ihrem Register.

**Verfügbare Verknüpfungen**:

- **OPEX-Positionen**: Wiederkehrende Kosten, die mit diesem Vertrag verbunden sind -- verwenden Sie die durchsuchbare Mehrfachauswahl, um Positionen nach Produktname zu finden und zu verknüpfen
- **CAPEX-Positionen**: Mit diesem Vertrag verknüpfte Investitionspositionen -- gleiche durchsuchbare Mehrfachauswahl-Oberfläche
- **Kontakte**: Mit diesem Vertrag verbundene Personen, jeweils mit einer Rolle (Kommerziell, Technisch, Support oder Sonstige). Vom Lieferanten übernommene Kontakte werden mit einem ausgefüllten Badge angezeigt; manuell hinzugefügte erscheinen mit einem umrandeten Badge. Klicken Sie auf eine Kontaktzeile, um deren Profil zu öffnen.
- **Relevante Websites**: Links zu externen Dokumenten wie Vertrags-PDFs oder Lieferantenportalen. Jeder Link hat eine Beschreibung und eine URL.
- **Anhänge**: Laden Sie Dateien per Drag-and-Drop oder über die Dateiauswahl hoch. Klicken Sie auf einen Anhang-Chip zum Herunterladen; klicken Sie auf das Löschsymbol zum Entfernen.

**Tipp**: Das Verknüpfen von OPEX- und CAPEX-Positionen mit Verträgen bietet Ihnen vollständige Kostenverfolgbarkeit -- von Budgetposten bis zu Lieferantenvereinbarungen.

---

### Aufgaben

Der Aufgaben-Tab verwaltet Handlungspunkte für diesen Vertrag (z. B. Verlängerungsprüfungen, Preisverhandlungen, Compliance-Prüfungen).

**Aufgabenliste**:

- Zeigt alle mit diesem Vertrag verknüpften Aufgaben
- Spalten: Titel, Status, Priorität, Fälligkeitsdatum, Aktionen
- Klicken Sie auf einen Aufgabentitel, um den vollständigen Aufgaben-Arbeitsbereich zu öffnen

**Filtern**:

- Klicken Sie auf das Filtersymbol, um Filtersteuerungen ein- oder auszublenden
- **Statusfilter**: Alle, Aktiv (blendet erledigte/abgebrochene aus) oder ein bestimmter Status (Offen, In Bearbeitung, Ausstehend, Im Test, Erledigt, Abgebrochen)
- Klicken Sie auf die Löschen-Schaltfläche, um Filter zurückzusetzen
- Standardfilter zeigt nur aktive Aufgaben

**Aufgabe erstellen**:

- Klicken Sie auf **Aufgabe hinzufügen**, um den Aufgaben-Erstellungsarbeitsbereich zu öffnen
- Die Aufgabe wird automatisch mit diesem Vertrag verknüpft
- Füllen Sie im Aufgaben-Arbeitsbereich Titel, Beschreibung, Priorität, Beauftragten und Fälligkeitsdatum aus

**Aufgabe löschen**:

- Klicken Sie auf das Löschsymbol in der Aktionen-Spalte
- Bestätigen Sie die Löschung im Dialog

**Hinweis**: Der Aufgaben-Tab ist erst nach dem erstmaligen Speichern des Vertrags verfügbar. Wenn Sie keine `contracts:manager`-Berechtigung haben, sind die Schaltflächen Aufgabe hinzufügen und Löschen ausgeblendet.

---

## CSV-Import/Export

Halten Sie Ihr Vertragsregister mit externen Systemen per CSV synchron.

**Export**: Lädt alle Verträge mit Kernfeldern und berechneten Daten herunter. Die Spalte `status` enthält den Status, der sich aus dem Ende der Gültigkeit ergibt.

**Import**:

- Verwenden Sie die **Vorprüfung** zum Validieren vor dem Anwenden
- Eine Zeile wird einem Vertrag über Vertragsnamen und Lieferant zugeordnet
- Unterstützt Neuanlage und Aktualisierungen
- Die Datei hat keine Spalte für das Ende der Gültigkeit. Bei einer Aktualisierung behält ein leeres `status`, oder eines, das dem aktuellen Status des Vertrags entspricht, sein Ende der Gültigkeit. Ein abweichender Status wird angewendet: `enabled` löscht das Ende der Gültigkeit, und `disabled` beendet den Vertrag heute, sofern sein Ende der Gültigkeit nicht bereits vergangen ist
- Ein neuer Vertrag ist aktiviert, sofern die Zeile nicht `disabled` angibt

**Hinweise**:

- Verwenden Sie **UTF-8-Kodierung** und **Semikolons** als Trennzeichen
- Berechnete Felder (Enddatum, Kündigungsstichtag) werden nicht importiert -- sie werden aus Laufzeit und Kündigungsfrist berechnet

---

## Tipps

- **Die Spalte „Kündigen bis" beachten**: Die Liste sortiert standardmäßig nach Kündigungsstichtag, sodass handlungsbedürftige Verträge zuerst erscheinen.
- **Frühzeitig mit OPEX und CAPEX verknüpfen**: Verbinden Sie Verträge bei der Erstellung mit Kostenpositionen für vollständige Kostenverfolgung.
- **Aufgaben für Verlängerungen nutzen**: Erstellen Sie 3--6 Monate vor dem Kündigungsstichtag eine Aufgabe zur Verlängerungsprüfung.
- **Jahresbeträge verfolgen**: Auch bei monatlicher Abrechnung erfassen Sie den Jahresbetrag für einen einfacheren Jahresvergleich.
- **Deep-Link aus der Liste**: Sie können einen direkten Link zu jedem Vertrag teilen -- die Arbeitsbereich-URL enthält die Vertrags-ID und bewahrt Ihren Listenkontext (Suche, Sortierung, Filter), sodass der Zurück-Button Sie genau dorthin zurückbringt, wo Sie waren.
