# Schnittstellen

Schnittstellen dokumentieren die logischen Datenflüsse zwischen Ihren Anwendungen. Jede Schnittstelle repräsentiert eine Geschäftsintegration (das „Warum" und „Was" des Datenaustauschs), unabhängig davon, wie sie technisch implementiert ist. Der Arbeitsbereich ermöglicht es Ihnen, die Schnittstelle zu beschreiben, die Legs zu definieren, die Daten durch Ihre Landschaft bewegen, umgebungsspezifische Bindungen zu konfigurieren, die feldgenauen Mapping-Regeln zu erfassen und verwandte Schnittstellen, Dokumente und Anhänge zu verknüpfen.

## Erste Schritte

Navigieren Sie zu **IT-Landschaft > Schnittstellen**, um Ihr Integrationsverzeichnis zu sehen. Klicken Sie auf **Schnittstelle hinzufügen**, um einen neuen Eintrag zu erstellen, oder öffnen Sie einen vorhandenen, um ihn zu bearbeiten.

**Schnittstelle hinzufügen** öffnet die Seite der Schnittstelle im Reiter **Fluss**, wo ihre Pflichtfelder stehen:

- Der Titel: ein beschreibender Name für die Integration
- **Quellanwendung** und **Zielanwendung**, im Reiter **Fluss**
- **Datenkategorie**, im Seitenpanel: der Datentyp, der übertragen wird

Sie können sie in beliebiger Reihenfolge ausfüllen. Nichts wird gespeichert, solange nicht alle vier ausgefüllt sind. Sobald sie es sind, erstellt KANAP die Schnittstelle mit allem, was der Entwurf enthält, und vergibt ihre Referenz (`INT-4`). Die Seite wechselt zur Schnittstelle, und **Umgebungen**, **Datenzuordnung**, **Beziehungen** und **Verlauf** öffnen sich.

**Tipp**: Legen Sie den **Routentyp** frühzeitig fest. Er steuert, welche Legs automatisch generiert werden und was im Reiter Fluss und in der Umgebungsmatrix angezeigt wird.

### Erstellen oder abbrechen { #cancelling-a-creation }

Solange die Schnittstelle erstellt wird, zeigt ihre Kopfzeile **Erstellen** und **Abbrechen**. Beide bleiben, bis Sie die Schnittstelle verlassen.

- **Erstellen** behält die Schnittstelle und bringt Sie dorthin zurück, wo Sie begonnen haben. Fehlt noch etwas, nennt eine Meldung es, und der Titel oder das erste fehlende Feld erhält den Fokus. Ist der Entwurf vollständig, erstellt KANAP die Schnittstelle und bringt Sie sofort zurück
- **Abbrechen** löscht die Schnittstelle. Wenn Sie nach ihrer Erstellung etwas hinzugefügt haben, nennt eine Bestätigung, was gelöscht wird. Sie können Ihre eigene Erstellung auch ohne das Recht zum Löschen von Schnittstellen abbrechen

Verlassen Sie die Schnittstelle auf andere Weise (über das Menü oder den Zurück-Pfeil), bleibt sie erhalten: Sie ist vollständig.

Bevor die Schnittstelle erstellt ist, verlassen **Abbrechen**, der Zurück-Pfeil oder Escape im Titel die Seite, ohne zu speichern. Enthält der Entwurf etwas, fragt eine Bestätigung, bevor er verworfen wird. Ein Link im Menü fragt ebenso.

---

## Arbeiten mit der Liste

Das Schnittstellenraster zeigt Ihr Integrationsverzeichnis auf einen Blick.

**Standardspalten**:

- **Referenz**: Die Referenz, die KANAP vergibt (`INT-4`)
- **Schnittstellencode**: Ihr eigener Kurzcode, sofern festgelegt
- **Name**: Schnittstellenname
- **Umgebungen**: Farbige Punkte, die zeigen, welche Umgebungen bereits Bindungen konfiguriert haben (z. B. PROD, QA, DEV)
- **Quellanwendung** und **Zielanwendung**: Die verbundenen Anwendungen
- **Lebenszyklus**: Aktueller Status
- **Kritikalität**: Geschäftliche Bedeutung
- **Erstellt am**: Wann der Datensatz erstellt wurde

**Zusätzliche Spalten** (über die Spaltenauswahl):

- **Geschäftsprozess**: Verknüpfter Geschäftsprozess
- **Datenkategorie**: Datentyp, der übertragen wird
- **Enthält PII**: Ob die Schnittstelle personenbezogene Daten verarbeitet
- **Umgebungsabdeckung**: Anzahl der Umgebungen mit mindestens einer Bindung
- **Bindungen**: Gesamtzahl der Umgebungs-Bindungen

**Filterung**:

- Schnellsuche über alle Textspalten
- Spaltenfilter auf den Textspalten
- **Lebenszyklus**, **Kritikalität**, **Geschäftsprozess**, **Datenkategorie** und **Enthält PII** verwenden Kontrollkästchen-Filter, sodass Sie mehrere Werte auf einmal wählen können. Der Filter **Kritikalität** bietet außerdem **(Leer)** für Schnittstellen ohne Kritikalität

**Sortierung**:

- **Kritikalität** sortiert nach Schweregrad, in der Reihenfolge der Stufen unter [Einstufungen und Kontinuität](it-ops-settings.md#einstufungen-und-kontinuitat). Schnittstellen ohne Wert stehen am Ende

**Aktionen**:

- **Schnittstelle hinzufügen**: Eine neue Schnittstelle erstellen (erfordert `applications:member`)
- **Schnittstelle duplizieren**: Eine Kopie einer ausgewählten Schnittstelle erstellen (erfordert `applications:member`). Wählen Sie genau eine Zeile aus, um diese Aktion zu aktivieren. Ein Dialog ermöglicht es Ihnen zu wählen, ob Umgebungs-Bindungen kopiert werden sollen. Siehe [Schnittstellen kopieren](#schnittstellen-kopieren) unten.
- **Ausgewählte löschen**: Ausgewählte Schnittstellen entfernen (erfordert `applications:admin`). Vor der Bestätigung führt das Fenster die Schnittstellen mit Bindungen als behalten auf, mit der Anzahl ihrer Bindungen. Aktivieren Sie **Zugehörige Bindungen ebenfalls löschen**, um sie mit ihren Bindungen zu löschen; ihre Verbindungen bleiben erhalten. Die Meldung nennt danach die gelöschten und die behaltenen Schnittstellen mit dem Grund.

---

## Der Schnittstellen-Arbeitsbereich

Klicken Sie auf eine Zeile, um den Arbeitsbereich zu öffnen. Der Arbeitsbereich hat sechs Reiter. Die Schnittstelleneigenschaften stehen in einem Seitenpanel auf der rechten Seite. Der Name in der Kopfzeile lässt sich direkt dort bearbeiten. Der letzte Reiter, **Verlauf**, listet die Änderungen an der Schnittstelle auf (siehe [Verlauf der Datensätze](record-history.md)).

Die Kopfzeile enthält **Löschen**, ein Papierkorbsymbol mit seinem Namen im Tooltip (`applications:admin`). Die Bestätigung verwendet dieselbe Prüfung wie **Ausgewählte löschen**. Sie sagt, dass dies nicht rückgängig gemacht werden kann. Wenn die Schnittstelle Bindungen hat, erklärt sie diese und bietet **Zugehörige Bindungen ebenfalls löschen**: das Löschen ist verfügbar, sobald diese Option aktiviert ist, die Bindungen gehen mit der Schnittstelle, und die Verbindungen bleiben erhalten. Die Liste öffnet sich danach wieder.

### Schnittstelleneigenschaften (Seitenpanel)

Das Seitenpanel bleibt in jedem Reiter sichtbar. Klicken Sie auf seinen Reiter **Eigenschaften**, um es ein- oder auszuklappen. Es enthält drei Feldgruppen:

**Identifikation**:

- **Referenz**: Von KANAP vergeben, schreibgeschützt
- **Schnittstellencode**: Ihr eigener Kurzcode
- **Geschäftsprozess**: Verknüpfung mit einem Geschäftsprozess aus den Stammdaten
- **Lebenszyklus**
- **Erstellt am** und **Aktualisiert am**: Schreibgeschützte Datumsangaben

**Team**:

- **Fachliche Verantwortliche**: Geschäftliche Stakeholder, die für die Integration rechenschaftspflichtig sind
- **IT-Verantwortliche**: Technische Teammitglieder, die für die Wartung verantwortlich sind
- **Betroffene Unternehmen**: Die Unternehmen, die von der Integration betroffen sind

**Daten und Compliance**:

- **Kritikalität**: Geschäftliche Bedeutung
- **Datenkategorie** (erforderlich): Die Art der übertragenen Daten
- **Datenklasse**: Sensibilitätsstufe
- **Enthält PII**: Wenn eingeschaltet, erscheint ein Feld **Beschreibung der PII**, in dem Sie angeben, welche PII enthalten sind
- **Datenresidenz**: Länder, durch die die Daten fließen

Feldänderungen im Seitenpanel werden automatisch gespeichert, sodass Sie Eigenschaften aus jedem Reiter aktualisieren können, ohne den Kontext zu wechseln. Quell- und Zielanwendung, Routentyp und Middleware legen Sie im Reiter Fluss fest.

---

### Übersicht

Der Reiter Übersicht enthält die **Spezifikation**, ein verwaltetes Rich-Text-Dokument, in dem Sie die Schnittstelle End-to-End beschreiben: geschäftlicher Kontext, Umfang, Vertrag, Beispiele. Es ist das primäre narrative Dokument für die Schnittstelle.

**Tipp**: Verwenden Sie diesen Reiter als Ihre einzige Quelle der Wahrheit für Prosa. Mapping-Regeln und technische Legs leben in den dedizierten Reitern unten; halten Sie dieses Dokument auf Absicht, Umfang und die für Menschen lesbare Zusammenfassung fokussiert.

---

### Fluss

Der Reiter Fluss legt die Route der Schnittstelle fest, dann die gemeinsamen **Legs**, aus denen sie besteht.

**Logischer Fluss**:

- **Quellanwendung** und **Zielanwendung** (erforderlich)
- **Routentyp**: Direkt oder Über Middleware
- **Middleware-Anwendungen**: Nur angezeigt, wenn der Routentyp Über Middleware ist. Die Liste ist auf Anwendungen beschränkt, die als ETL/Middleware gekennzeichnet sind.

**Abschnittsvorlage**: Legs beschreiben, was jeder Schritt allgemein tut (die gleiche Definition gilt für jede Umgebung). Für jeden Leg können Sie bearbeiten:

- **Leg-Typ**: Extraktion, Transformation, Laden oder Direkt (automatisch basierend auf der Integrationsroute festgelegt)
- **Von -> Zu**: Welche Rolle jeden Schritt verarbeitet (Quell-App, Ziel-App oder Middleware)
- **Auslöser-Typ**: Was diesen Leg initiiert (z. B. geplant, ereignisgesteuert, manuell)
- **Muster**: Das Integrationsmuster (z. B. Batch, Echtzeit, Pub/Sub)
- **Format**: Das Datenformat (z. B. JSON, XML, CSV, Flat-File)
- **Job-Name**: Ein optionaler Standard-Job- oder Prozessname

Wenn noch keine Legs angezeigt werden, wählen Sie Quell- und Zielanwendung aus. Legs werden aus der **Quellanwendung**, der **Zielanwendung** und dem **Routentyp** generiert.

---

### Umgebungen

Der Reiter Umgebungen verwaltet die umgebungsspezifischen Bindungen, die die Leg-Vorlagen in tatsächliche Konfigurationen umwandeln. Er zeigt eine Matrix mit einer Zeile pro Leg und einer Spalte pro Umgebung, sodass Sie jede Kombination unabhängig konfigurieren können.

**Umgebungen**:

- **Umgebung hinzufügen** (`applications:member`) bietet die Umgebungen an, in denen Quell- und Zielanwendung (bei einer Route über Middleware auch die Middleware) alle eine Bereitstellung haben. Bereitstellungen legen Sie im Arbeitsbereich Anwendungen an.
- Eine Umgebung erscheint in der Matrix, sobald Sie sie hinzufügen oder sobald sie eine Bindung hat.
- Um eine Umgebung zu löschen, klicken Sie auf das Papierkorbsymbol in ihrem Spaltenkopf. Die Bestätigung nennt die Anzahl der Bindungen, die mit ihr gelöscht werden.
- Ein Streifen über der Matrix zeigt jede Umgebung mit der Anzahl der konfigurierten Legs im Verhältnis zur Gesamtzahl, zum Beispiel `QA 2/3`. Der Punkt ist grün, wenn jeder Leg konfiguriert ist, orange, wenn einige konfiguriert sind, und grau, wenn keiner konfiguriert ist.

**Zellen**: Jede Zelle zeigt den Status der Bindung sowie ihren Quell- und Zielendpunkt. Sobald Sie eine Bindung geöffnet haben, zeigt ihre Zelle auch ihre Infrastrukturverbindung: die erste, mit der Anzahl der weiteren, wenn es mehrere gibt (`+2`). Eine Bindung im Status **Aktiv** ohne Infrastrukturverbindung zeigt dann **Verbindung fehlt** in Orange. Klicken Sie auf eine leere Zelle, um eine Bindung hinzuzufügen, oder auf eine konfigurierte Zelle, um sie zu bearbeiten. Das Papierkorbsymbol in einer Zelle löscht ihre Bindung nach einer Bestätigung.

**Bindungsbereich**: Ein Klick auf eine Zelle öffnet einen Bereich neben der Matrix.

- Für eine neue Bindung füllen Sie die Felder aus und klicken auf **Bindung hinzufügen**. Die Auswahlfelder **Quellbereitstellung** und **Zielbereitstellung** erscheinen, wenn die Anwendung in dieser Umgebung mehr als eine Bereitstellung hat. Andernfalls wird die einzige Bereitstellung verwendet. Das Auswahlfeld **Integrationswerkzeug** erscheint bei einer Route über Middleware, wenn mehr als eine Middleware-Anwendung in der Umgebung eine Bereitstellung hat. Es ist dann erforderlich.
- Bei einer vorhandenen Bindung wird jede Änderung sofort gespeichert. Die Kopfzeile des Bereichs zeigt an, wann die Änderung gespeichert ist.

**Bindungsfelder**:

- **Status**: Die [Lebenszyklus-Status](it-ops-settings.md#lebenszyklus-status): Vorgeschlagen, Aktiv, Veraltet, Außer Betrieb sowie alle, die Ihr Administrator hinzufügt
- **Authentifizierungsmodus**: Wie sich die Bindung authentifiziert
- **Infrastrukturverbindung**: Die Infrastrukturverbindung aus Ihrem Verbindungsverzeichnis. So können Sie den vollständigen Pfad von der logischen Schnittstelle bis zur physischen Netzwerkverbindung nachverfolgen. Der Bereich bearbeitet eine Verbindung. Hat die Bindung mehrere, werden die weiteren als Anzahl angezeigt und bleiben unverändert.
- **Quellendpunkt** und **Zielendpunkt**: Technische Endpunkte (URLs, Pfade, Queue-Namen usw.)
- **Auslöserdetails**: Umgebungsspezifische Auslöser-Konfiguration
- **Abweichender Jobname**: Ersetzt den Jobnamen der Leg-Vorlage in dieser Umgebung
- **Monitoring-URL**: Link zu Monitoring oder Observability für diese Bindung
- **Notizen**: Umgebungsspezifische Notizen

---

### Datenzuordnung

Der Reiter Datenzuordnung ist der Ort, an dem Sie beschreiben, wie Quellfelder zu Zielfeldern werden. Er ist um zwei Konzepte herum organisiert:

- **Mapping-Regeln** beschreiben eine einzelne Mapping-Entscheidung: ein oder mehrere Quellfelder, ein oder mehrere Zielfelder, eine Operation (direktes Kopieren, Transformieren, Lookup, Aufteilen, Zusammenführen, Filtern, Standardwert oder eine benutzerdefinierte Operation) und optionale Bedingungs- / Geschäfts- / Middleware-Notizen.
- **Mapping-Gruppen** sind Ordner, die die Regeln in thematische Bereiche organisieren (zum Beispiel „Header", „Kundenblock", „Positionen", „Footer"). Regeln können einer Gruppe zugewiesen oder ungruppiert gelassen werden. Zwei Basisgruppen, **Head** und **Item**, sind immer vorhanden; Sie können weitere hinzufügen.

Der Reiter arbeitet mit dem **Standard-Mapping-Set** der Schnittstelle. Die Kopfzeilenleiste zeigt den Namen des Sets, die aktuelle Revisionsnummer sowie die Regel- und Gruppenanzahl.

**Regeln filtern**:

Verwenden Sie das Dropdown **Gruppenansicht** über der Regeltabelle, um sich auf Folgendes zu konzentrieren:

- **Alle Regeln** (Standard)
- **Ungruppierte** Regeln (mit Anzahl)
- Eine bestimmte Gruppe (zeigt die Reihenfolge, den Titel und die Regelanzahl)

**Gruppen verwalten**:

Klicken Sie auf **Gruppen verwalten**, um den Gruppen-Manager zu öffnen. Von dort aus können Sie:

- Eine neue Gruppe hinzufügen (Titel, optionale Beschreibung, Reihenfolge)
- Eine vorhandene Gruppe bearbeiten
- Eine Nicht-Basisgruppe löschen (zugewiesene Regeln werden zu Ungruppiert verschoben)

Die Basisgruppen **Head** und **Item** können ausgewählt, aber nicht bearbeitet oder gelöscht werden.

**Eine Regel hinzufügen oder bearbeiten**:

Klicken Sie auf **Regel hinzufügen** oder klicken Sie auf eine beliebige Regelzeile, um die Regelleiste auf der rechten Seite zu öffnen. Regelfelder:

- **Regeltitel** (erforderlich) und optionaler **Regelschlüssel** (eine stabile technische Kennung für Exporte oder nachgelagerte Systeme)
- **Gruppe**: Einer Gruppe zuweisen oder Ungruppiert lassen
- **Quellfeld(er)**: Eine Zeile pro Quellbindung. Jede Zeile hat einen **Pfad** (z. B. `origin.customerId`) und einen optionalen **Typ** (string, number, date usw. oder einen beliebigen Freitext-Deskriptor). Verwenden Sie mehrere Zeilen, um 1:N- oder N:1-Mappings zu modellieren.
- **Zielfeld(er)**: Gleiche Struktur, eine Zeile pro Zielbindung
- **Operation**: Direktes Kopieren, Transformieren, Lookup, Aufteilen, Zusammenführen, Filtern, Standardwert oder **Andere** (mit einer Freitext-Bezeichnung)
- **Gilt für Leg**: Beschränken Sie die Regel auf einen bestimmten Leg (z. B. nur den EXTRACT-Leg) oder lassen Sie sie als **Alle Legs**
- **Reihenfolge**: Anzeigereihenfolge innerhalb der Gruppe
- **Bedingung**: Wann die Regel gilt
- **Geschäftsregel**: Klare Erklärung der Geschäftslogik
- **Middleware- / Transformations-Notiz**: Implementierungsnotizen für das Middleware- oder ETL-Team
- **Anmerkungen**: Alles andere, was es wert ist, festgehalten zu werden

Die Mapping-Tabelle fasst jede Regel zusammen, indem sie die Quellbindungen, einen Pfeil und die Zielbindungen sowie die Operation, die Gruppe, zu der sie gehört, und den Leg-Bereich auflistet. Klicken Sie auf eine Zeile, um sie zu bearbeiten, oder verwenden Sie die Symbole der Zeile, um sie zu bearbeiten oder zu löschen.

**Tipp**: Behalten Sie eine Regel pro logischer Entscheidung anstatt einer Regel pro Feld. Eine Regel, die drei Quellfelder nimmt und ein verkettetes Zielfeld erzeugt, ist klarer als drei nahezu identische Zeilen, und das Operationsfeld macht die Absicht explizit.

---

### Beziehungen

Der Reiter Beziehungen zeigt, wovon diese Schnittstelle abhängt und was von ihr abhängt, zusammen mit ihren Links und Dateien. Zuerst kommen die mit der Schnittstelle verknüpften Wissensdokumente, dann die vorgelagerten Schnittstellen, die nachgelagerten Schnittstellen sowie die Links und Dateien. Das Badge des Reiters zählt die vor- und nachgelagerten Schnittstellen sowie die Links und Dateien. Wissensdokumente werden nicht gezählt.

**Vorgelagerte Schnittstellen** und **Nachgelagerte Schnittstellen**: je eine Tabelle mit Referenz (`INT-4`), Name, Quellanwendung, Zielanwendung und Lebenszyklus. Klicken Sie auf eine Zeile, um die Schnittstelle zu öffnen. Eine stillgelegte Schnittstelle bleibt aufgeführt, ihre Zeile ist ausgegraut. Nutzen Sie diese Abschnitte, um eine Reihenfolge zu dokumentieren, etwa „Auftragssync muss vor Rechnungssync laufen“.

Eine Abhängigkeit gilt in eine Richtung. Wenn Sie Schnittstelle B als vorgelagert zu Schnittstelle A hinzufügen, erscheint B nur bei A als vorgelagert. A erscheint bei B nicht als nachgelagert.

**Schnittstellen hinzufügen und entfernen** (`applications:member`): **Hinzufügen** rechts in einem Abschnitt öffnet eine Suche nach Schnittstellen. Geben Sie einen Namen oder eine Referenz ein und wählen Sie ein Ergebnis: Die Verknüpfung wird sofort gespeichert. Die Suche lässt diese Schnittstelle und die bereits im Abschnitt vorhandenen Schnittstellen aus. Um eine Verknüpfung zu entfernen, fahren Sie mit der Maus über die Zeile und klicken Sie auf das Kreuz am Ende. Das Entfernen einer Verknüpfung löscht keine der beiden Schnittstellen. Leser sehen die Tabellen schreibgeschützt.

**Links und Dateien**: die Weblinks der Schnittstelle (Spezifikationen, Dokumentationsseiten, Monitoring-Dashboards) und ihre Dateien, je eine Zeile mit Name, Domain des Links oder Größe der Datei und dem Datum des Hinzufügens. Klicken Sie auf einen Link, um ihn in einem neuen Tab zu öffnen, oder auf eine Datei, um sie herunterzuladen. Mit `applications:member`:

- **Link hinzufügen** öffnet einen Dialog für eine URL und einen optionalen Namen; der Link wird sofort gespeichert. Um einen Link zu ändern, fahren Sie mit der Maus über seine Zeile und klicken Sie auf den Stift.
- **Datei anhängen** öffnet die Dateiauswahl. Sie können Dateien auch auf den Abschnitt ziehen.
- Um einen Link oder eine Datei zu entfernen, fahren Sie mit der Maus über die Zeile und klicken Sie auf das Kreuz. Das Entfernen eines Links zeigt eine Meldung und bietet **Rückgängig** an, womit der Link wieder angelegt wird. Vor dem Löschen einer Datei wird eine Bestätigung abgefragt.

**Tipp**: Hängen Sie die Spezifikation und die Mapping-Dokumente an die Schnittstelle an, damit die Personen, die sie betreiben, alles an einem Ort finden.

---

## Schnittstellen kopieren

Es gibt zwei Möglichkeiten, Schnittstellen in KANAP zu kopieren.

### Schnittstelle duplizieren (aus dem Schnittstellenraster)

Verwenden Sie dies, wenn Sie eine unabhängige Kopie einer Schnittstelle wünschen, typischerweise um eine ähnliche Integration zwischen denselben oder anderen Anwendungen zu erstellen.

1. Wählen Sie eine Schnittstelle im Raster aus
2. Klicken Sie auf **Schnittstelle duplizieren**
3. Wählen Sie, ob Umgebungs-Bindungen kopiert werden sollen:
   - **Ohne Bindungen**: Eine saubere Kopie: nur die Schnittstellendefinition, Legs, Verantwortliche und Metadaten
   - **Mit Bindungen**: Kopiert auch Umgebungs-Bindungen, löscht aber umgebungsspezifische Details (Endpunkte, Authentifizierung, Job-Namen), sodass Sie sie neu konfigurieren können

**Was kopiert wird**:

| Daten | Kopiert |
|------|--------|
| Schnittstellendefinition (Name, Apps, Routentyp) | Ja |
| Legs (Extract / Transform / Load / Direct) | Ja |
| Middleware-Anwendungen | Ja |
| Verantwortliche (Business und IT) | Ja |
| Betroffene Unternehmen | Ja |
| Abhängigkeiten | Ja |
| Schlüsselkennungen | Ja |
| Externe URL-Links | Ja |
| Datenhaltung | Ja |
| Spezifikation | Ja, mit ihren Bildern |
| Bindungen | Optional |
| Mapping-Gruppen und -Regeln | Nein |
| Anhänge | Nein |

**Benennung**: Die Kopie erhält „ - copy" sowohl an den Namen als auch an den Schnittstellencode angehängt. Ein leerer Schnittstellencode bleibt leer. Die Kopie erhält eine eigene Referenz.

### Versionsmigration (aus der Anwendungsversionierung)

Verwenden Sie dies beim Upgrade einer Anwendung auf eine neue Version, wenn Sie Schnittstellen zur neuen Version migrieren müssen. Siehe [Anwendungen > Versionsverwaltung](applications.md#versionsverwaltung) für Details.

**Wichtige Unterschiede zu Duplizieren**:

| Aspekt | Duplizieren | Versionsmigration |
|--------|-----------|-------------------|
| Zweck | Unabhängige Kopie erstellen | Zu neuer App-Version migrieren |
| App-Referenzen | Unverändert | Auf neue Version aktualisiert |
| Middleware-Referenzen | Unverändert | Aktualisiert, wenn App Middleware ist |
| Abhängigkeiten | Kopiert | Nicht kopiert |
| Bindungen | Optional (Instanzen unverändert) | Optional (Instanzen der neuen App zugeordnet) |
| Lebenszyklus | Erhalten | Auf Vorgeschlagen zurückgesetzt |
| Namenssuffix | „ - copy" | „ (new version)" |

---

## Tipps

- **Dokumentieren Sie das „Warum" zuerst**: Verwenden Sie die **Spezifikation** im Reiter Übersicht, um die Absicht zu erfassen, bevor Sie sich in Legs und Bindungen vertiefen.
- **Verwenden Sie das Seitenpanel von jedem Reiter aus**: Verantwortliche, Kritikalität, PII-Flag und der Rest werden sofort gespeichert, sodass Sie sie aktualisieren können, während Sie Regeln oder Bindungen überprüfen.
- **Eine Schnittstelle, viele Umgebungen**: Erstellen Sie keine separaten Schnittstellen für jede Umgebung. Verwenden Sie eine Schnittstelle und konfigurieren Sie jede Umgebung im Reiter Umgebungen.
- **Gruppieren Sie Ihre Mapping-Regeln**: Bei Schnittstellen mit mehr als einer Handvoll Felder organisieren Sie die Regeln in Mapping-Gruppen (Header, Positionen, Footer usw.). Es macht Überprüfung und Auswirkungsanalyse weitaus einfacher.
- **Halten Sie Middleware explizit**: Wenn Daten durch Middleware fließen, setzen Sie den Routentyp im Reiter Fluss auf **Über Middleware** und wählen Sie die Middleware-Anwendungen aus. Die Schnittstellenkarte rendert dann den echten Datenpfad.
- **Duplizieren Sie für ähnliche Schnittstellen**: Wenn Sie eine neue Schnittstelle erstellen, die einer vorhandenen ähnlich ist, verwenden Sie **Schnittstelle duplizieren**, um alle Einstellungen zu kopieren, und ändern Sie dann das, was anders ist. Schließen Sie optional Bindungen ein, um einen Vorsprung bei der Umgebungskonfiguration zu erhalten.
- **Verknüpfen Sie Bindungen mit Infra-Verbindungen**: Verknüpfen Sie im Reiter Umgebungen jede Bindung mit ihrer zugrunde liegenden Infrastrukturverbindung, sodass Sie den vollständigen Pfad von der Geschäftsschnittstelle bis zur Netzwerkverbindung nachverfolgen können.
