# Wissensdatenbank

Die Wissensdatenbank ist KANAPs Dokumenten-Arbeitsbereich für Richtlinien, Verfahren, technische Notizen, Referenzmaterial und die Dokumentation, die mit der tatsächlichen Arbeit verbunden bleiben muss. Sie kombiniert freies Schreiben mit Governance-Funktionen wie Vorlagen, Verantwortlichkeit, Review, Versionshistorie und Verknüpfungen zu Anwendungen, Assets, Projekten, Anfragen und Aufgaben.

Anders als ein Dateifreigabesystem ist die Wissensdatenbank nicht nur ein Ort zum Speichern von Dokumenten. Die wichtige Designentscheidung ist, dass jeder Artikel klassifiziert, geprüft, versioniert, exportiert und mit operativen Objekten auf der gesamten Plattform verknüpft werden kann. Das macht den Artikel leichter auffindbar und gibt ihm Kontext, wenn Personen ihn aus einem anderen Arbeitsbereich öffnen.

## Wo Sie es finden

- Arbeitsbereich: **Wissensdatenbank**
- Berechtigungen:
  - `knowledge:reader` ermöglicht das Öffnen und Lesen von Dokumenten
  - `knowledge:member` ermöglicht das Erstellen, Bearbeiten, Kommentieren, Organisieren von Ordnern und Verwalten von Dokumentmetadaten
  - `knowledge:admin` fügt die Bibliotheksverwaltung und bibliotheksübergreifende Verschiebungen hinzu

Wenn Sie ein Dokument lesen, aber nicht bearbeiten können, bleibt der Arbeitsbereich im schreibgeschützten Modus verfügbar.

## Wie die Wissensdatenbank organisiert ist

Die Wissensdatenbank ist um vier Organisationsschichten herum aufgebaut: Bibliotheken, Ordner, Dokumenttypen und Beziehungen.

### Bibliotheken

Bibliotheken sind die Container der höchsten Ebene. Sie trennen Dokumentpopulationen, die unterschiedlich verwaltet werden sollen.

Typische Muster:
- Verwenden Sie eine reguläre Bibliothek für die Arbeitsdokumentation Ihres Teams.
- Verwenden Sie die Bibliothek **Vorlagen** für wiederverwendbare Dokumentvorlagen.
- Verwenden Sie die Bibliothek **Verwaltete Dokumente** für Dokumente, die aus einem anderen Arbeitsbereich stammen und teilweise dort gesteuert werden.

Konsequenzen der Bibliothekswahl:
- Die aktive Bibliothek bestimmt, welchen Ordnerbaum Sie sehen und wo neue leere Dokumente erstellt werden.
- In einer normalen Bibliothek verhalten sich Dokumente wie Standard-Wissensartikel.
- In **Vorlagen** werden veröffentlichte Dokumente zu wiederverwendbaren Ausgangspunkten für neue Artikel und werden im Vorlagen-Picker nach Dokumenttyp gruppiert.
- In **Verwaltete Dokumente** sind Artikel möglicherweise immer noch lesbar und bearbeitbar, aber einige Metadaten werden vom Quell-Arbeitsbereich gesteuert anstatt von der Wissensdatenbank selbst.

Die Bibliotheksverwaltung ist absichtlich strenger als die Dokumentbearbeitung. Das Erstellen, Umbenennen, Löschen oder Reorganisieren von Bibliotheken ist eine Admin-Verantwortung, weil diese Änderungen die Navigation und Verantwortlichkeit für alle beeinflussen.

### Eingeschränkte Bibliotheken

Standardmäßig ist jede Bibliothek für jeden mit der `knowledge`-Berechtigung offen. Ein Bibliotheks-Administrator kann eine Bibliothek im Einstellungs-Dialog der Bibliothek auf **Eingeschränkten** Zugriff umschalten. Eingeschränkte Bibliotheken sind mit einem kleinen Schloss-Symbol auf der Bibliotheksregisterkarte gekennzeichnet.

In einer eingeschränkten Bibliothek:

- Nur der Bibliotheks-Verantwortliche, die als **Leser** aufgeführten Personen und die als **Schreiber** aufgeführten Personen können die Bibliothek und ihre Dokumente sehen.
- Leser können Artikel in der Bibliothek öffnen und lesen, aber nicht bearbeiten.
- Schreiber können Artikel lesen und bearbeiten. Schreiber benötigen außerdem die Standardberechtigung `knowledge:member`, um tatsächlich Dokumente zu erstellen oder zu ändern.
- Der Verantwortliche kann die Bibliothek immer lesen und verwalten.
- Der Wechsel von **Eingeschränkt** zurück zu **Standard** löscht die Leser- und Schreiberlisten. Der Dialog fragt vor dem Verwerfen der Mitgliedschaft um Bestätigung.

Verwenden Sie eingeschränkte Bibliotheken für sensible Inhalte (Sicherheitsverfahren, HR-Dokumente, Führungskräftematerial), bei denen Sie eine feinkörnige Zugriffskontrolle innerhalb der Wissensdatenbank wünschen, anstatt sich nur auf globale Rollen zu verlassen.

Eingeschränkte Bibliotheken begrenzen auch, was ein KI-Agent lesen kann. Wenn ein Administrator einen Agenten in dessen Einstellungen **Wissens- und Webquellen** auf eine ausgewählte Gruppe von Bibliotheken beschränkt, wird diese Auswahl mit den Bibliotheken kombiniert, die der konfigurierende Administrator bereits lesen kann – ein Agent sieht nie mehr als die Person, die ihn eingerichtet hat. Eine eingeschränkte Bibliothek, auf die der Administrator keinen Zugriff hat, bleibt auch für den Agenten unsichtbar.

### Ordner

Ordner organisieren Dokumente innerhalb einer Bibliothek. Sie sind nicht kosmetisch: Sie prägen, wie Benutzer die Bibliothek durchsuchen und wie Teams im Laufe der Zeit eine gemeinsame Struktur pflegen.

Wichtiges Verhalten:
- Ordner existieren innerhalb einer Bibliothek. Sie werden nicht zwischen Bibliotheken geteilt.
- In einer Einzelbibliotheks-Ansicht können Dokumente per Drag-and-Drop in Ordner gezogen werden, um sie schnell zu reorganisieren.
- Ordner können verschachtelt werden, um eine Browsing-Struktur zu erstellen.
- Das Löschen eines Ordners löscht nicht seine Dokumente. Dokumente werden stattdessen zurück nach **Nicht eingeordnet** verschoben.
- Ein Ordner mit Unterordnern kann nicht gelöscht werden, bis die Hierarchie aufgeräumt ist.

Verwenden Sie Ordner für stabile Themenbereiche, nicht für temporäre Workflow-Status. Status und Workflow existieren bereits dafür.

### Bereichsfilter

Der Bereichsfilter der obersten Ebene ändert, welche Dokumente aufgelistet werden:

- **Meine Dokumente** konzentriert sich auf Dokumente, die Ihnen gehören.
- **Dokumente meines Teams** konzentriert sich auf Dokumente, die Ihrem Team gehören.
- **Alle Dokumente** entfernt den Verantwortlichkeits-Bereich und zeigt die vollständige Population an, die Sie sehen dürfen.

Wenn Sie keinem Team zugewiesen sind, ist der Team-Bereich nicht verfügbar. Die Seite öffnet sich mit **Alle Dokumente**, und Ihre letzte Bereichswahl wird gespeichert, was bequem ist, wenn sie zu Ihrem normalen Arbeitsmodus passt, und etwas verwirrend, wenn Sie vergessen, dass Sie sie gestern geändert haben.

### Vorlagen und Dokumenttypen

Vorlagen sind gewöhnliche Wissensdokumente, die in der Bibliothek **Vorlagen** gespeichert und zur Wiederverwendung veröffentlicht werden. Das Erstellen eines Dokuments aus einer Vorlage kopiert den Vorlageninhalt in einen neuen Artikel und behält die Vorlagenreferenz bei.

Dokumenttypen sind wichtig, weil sie:
- den Artikel für Filterung und Berichterstattung klassifizieren
- Vorlagen im Erstellungs-Picker gruppieren
- Lesern helfen zu verstehen, welche Art von Dokument sie öffnen

Ein subtiles, aber wichtiges Verhalten: Wenn ein Dokument aus einer Vorlage erstellt wurde und Sie später seinen Dokumenttyp in einen anderen Typ ändern, wird die Vorlagenverknüpfung gelöscht. Das verhindert, dass der Artikel vorgibt, einer Vorlage zu folgen, der er nicht mehr entspricht.

Beim Durchsuchen der Bibliothek **Vorlagen** können Administratoren das Panel **Typen verwalten** öffnen, um Dokumenttypen zu erstellen, umzubenennen, zu deaktivieren oder neu zu sortieren.

### Verwaltete Dokumente

Einige Wissensartikel werden aus Anfragen, Projekten, Anwendungen, Assets, Aufgaben oder Vorfällen erstellt. Diese erscheinen als **Integrierte** Dokumente, in der Bibliothek **Verwaltete Dokumente** nach dem Arbeitsbereich gruppiert, aus dem sie stammen.

Verwaltete Dokumente halten das Schreiberlebnis innerhalb der Wissensdatenbank, aber der Quell-Arbeitsbereich kontrolliert weiterhin einen Teil ihrer Metadaten. In der Praxis bedeutet das:
- Status kann vom Quellobjekt gesteuert werden
- Ordnerplatzierung kann vom Quell-Arbeitsbereich festgelegt werden
- Dokumenttyp oder Vorlage kann fixiert sein
- Direkte Beziehungen können in der Wissensdatenbank schreibgeschützt sein
- Der Wissens-Review-Workflow ist für diese Dokumente nicht verfügbar
- Verwaltete Dokumente können nicht aus der Wissensdatenbank verschoben oder aus der Wissensliste gelöscht werden

Dies schützt die Verknüpfung zwischen dem Dokument und dem operativen Datensatz, dem es gehört.

Auch der Zugriff folgt dem Quellobjekt. Der deutlichste Fall ist der Ordner **Vorfälle**: Eine Vorfallanalyse kann nur öffnen, wer den zugehörigen Vorfall sehen darf, unabhängig von seinen Berechtigungen in der Wissensdatenbank. Sie wird schreibgeschützt, sobald der Vorfall geschlossen oder abgebrochen ist, und sie verschwindet aus Listen, Suche, Exporten und dem Assistenten für alle, die von einem eingeschränkten Vorfall ausgeschlossen sind. Siehe [Vorfälle](incidents.md).

## Arbeiten mit der Wissensliste

Die Hauptseite der Wissensdatenbank ist ein Dokumentenregister mit Navigations- und Organisationswerkzeugen drumherum.

### Was die Liste zeigt

Das Standardraster konzentriert sich auf Dokumentidentität und Governance:

- **Ref**: die permanente `DOC-{Nummer}`-Referenz
- **Titel**
- **Status**
- **Typ**
- **Version**
- **Verantwortlicher**
- **Ordner**
- **Aktualisiert**

**Zusätzliche Spalten** (standardmäßig ausgeblendet, über die Spaltenauswahl verfügbar):
- **Vorlage**: zeigt die Vorlage, aus der das Dokument erstellt wurde, falls vorhanden
- **Bibliothek**: erscheint automatisch, wenn **Alle Bibliotheken** aktiviert ist, und kann ansonsten manuell angezeigt werden

### Suche, Filter und Browsing

Die Wissensdatenbank unterstützt zwei Navigationsstile:

- Eine Bibliothek mit ihrem Ordnerbaum durchsuchen, wenn Sie den Themenbereich bereits kennen.
- Über alle Bibliotheken hinweg suchen, wenn Ihnen der Artikel mehr am Herzen liegt als sein Speicherort.

Der Schalter **Alle Bibliotheken** ändert das Erlebnis erheblich:
- der Ordnerbaum ist nicht mehr der Haupttreiber
- die Suche wird breiter
- die Liste kann Inhalte über Bibliotheken hinweg vergleichen
- die Bibliothek-Spalte wird Teil des Ergebnis-Kontextes

Das Durchsuchen einer einzelnen Bibliothek ist besser für die Kuration. Die Suche über alle Bibliotheken ist besser für das Auffinden.

**Filterung**:
- Schnellsuchleiste oben im Raster
- Spaltenfilter für **Status**, **Typ**, **Verantwortlicher**, **Ordner**, **Vorlage** und **Bibliothek** mit Kontrollkästchen-Set-Selektoren

### Dokumente und Ordner verschieben

In einer Einzelbibliotheks-Ansicht können Dokumente in Ordner gezogen werden. Beim Ziehen erscheint ein Ziehgriff in jeder Zeile, wenn das Ziehen verfügbar ist. Dies ist der schnellste Weg, eine Bibliothek zu organisieren, ohne jeden Artikel zu öffnen.

Bibliotheksübergreifende Verschiebungen sind kontrollierter:
- sie erfordern eine höhere Berechtigung (`knowledge:admin`)
- sie sind für verwaltete Dokumente nicht verfügbar
- Vorlagendokumente sind absichtlich eingeschränkt, weil Vorlagen im Vorlagensystem bleiben sollen, nicht in die Wildnis abwandern
- sie funktionieren nicht in oder aus einer eingeschränkten Bibliothek, wenn dem Schreiber der Zugriff fehlt

Ordner können auch zwischen Bibliotheken gezogen werden, indem sie auf die Ziel-Bibliotheksregisterkarte abgelegt werden. Ein Bestätigungsdialog wird geöffnet, damit Sie vor der Verschiebung einen Zielordner auswählen können.

Ordnerverschiebungen folgen der gleichen Idee wie Dokumentverschiebungen. Das Reorganisieren eines Ordners ändert die Browsing-Struktur für alle, die diese Bibliothek verwenden, also behandeln Sie es als Informationsarchitektur-Änderung, nicht nur als persönliche Hausarbeit.

### Listenaktionen

- **Neu** (Split-Schaltfläche): erstellt ein leeres Dokument in der aktiven Bibliothek oder öffnet den Vorlagen-Picker, um aus einer veröffentlichten Vorlage zu erstellen
- **Verschieben**: verschiebt ausgewählte Dokumente in einen anderen Ordner oder eine andere Bibliothek
- **Löschen**: entfernt ausgewählte Dokumente dauerhaft (nur Admin; nicht verfügbar für verwaltete Dokumente)
- **Typen verwalten**: nur innerhalb der Bibliothek **Vorlagen** für Administratoren sichtbar; öffnet den Dokumenttyp-Editor

## Ein Dokument erstellen und gestalten

Neue Artikel können auf zwei Arten beginnen:

- **Leeres Dokument**: am besten, wenn Sie die Struktur, die Sie benötigen, bereits kennen
- **Aus Vorlage**: am besten, wenn das Team konsistente Bereiche, Sprache oder Review-Erwartungen wünscht

Wenn Sie aus einer Vorlage erstellen, wird der Vorlageninhalt in das neue Dokument kopiert. Ab diesem Zeitpunkt ist der neue Artikel unabhängig. Eine spätere Aktualisierung der Vorlage schreibt vorhandene Dokumente nicht neu.

Der Dokumenten-Arbeitsbereich hält das Schreiben in der Mitte und die Governance in der Seitenleiste.

Kerneigenschaften umfassen:
- **Titel**: die primäre Bezeichnung, nach der Leser suchen und die sie zitieren
- **Status**: der Lebenszyklus des Artikels
- **Ordner**: wo der Artikel innerhalb seiner Bibliothek lebt
- **Typ**: welche Art von Dokument es ist
- **Basiert auf Vorlage**: die Vorlagenherkunft, falls relevant
- **Zusammenfassung**: eine kurze Beschreibung für den Kontext

Nach dem ersten Speichern wird das vollständige Dokumenten-Governance-Modell verfügbar. Dann können Sie Mitwirkende, Klassifizierungen, Beziehungen, Kommentare und Versionshistorie gegen eine stabile Dokumentreferenz verwalten.

### Status und was er bedeutet

Status ist keine Dekoration. Er sagt Lesern, wie ernst sie den Artikel nehmen sollten.

| Status | Bedeutung | Praktische Konsequenz |
|--------|---------|-----------------------|
| **Entwurf** | In Arbeit | Geeignet für Autorenschaft und interne Iteration |
| **In Review** | In formaler Überprüfung | Bearbeitung ist blockiert, während der Workflow aktiv ist |
| **Veröffentlicht** | Genehmigt für normale Verwendung | Beste Wahl für Inhalte, auf die sich Personen verlassen sollen |
| **Archiviert** | Für Aufzeichnungen aufbewahrt | Normalerweise immer noch nützlich für die Historie, nicht für aktive Anleitung |
| **Veraltet** | Ersetzt oder nicht mehr gültig | Leser sollten ihm nicht als aktuelle Praxis folgen |

Die Wissensdatenbank erlaubt direktes Veröffentlichen auch ohne formalen Review-Workflow. Das ist nützlich für risikoarmes Material, bedeutet aber auch, dass Teams Disziplin brauchen, wann Review optional ist und wann er zu erwarten ist.

## Schreiben, Sperren und Autosave

Die Wissensdatenbank verwendet eine Bearbeitungssperre, sodass nur eine Person ein Dokument aktiv zur gleichen Zeit bearbeitet.

So funktioniert es:
- Das Wechseln in den Bearbeitungsmodus erwirbt die Sperre
- Andere Benutzer können den Artikel weiterhin öffnen und lesen
- Sie können nicht bearbeiten, während die Sperre von jemand anderem gehalten wird
- Wenn die Sperre abläuft oder verloren geht, stoppt der Bearbeitungsmodus und muss erneut betreten werden

Dies vermeidet stille Überschreibungen, was hervorragend für die Dokumentintegrität ist und weniger hervorragend, wenn zwei Personen beide dachten, sie hätten „nur eine schnelle Anpassung."

Während Sie bearbeiten:
- Änderungen werden manuell mit **Speichern** gespeichert
- Ungespeicherte Inhalte werden auch periodisch automatisch gespeichert, während Ihre Sperre aktiv ist
- **Verwerfen** kehrt zum letzten gespeicherten Zustand zurück

Der Arbeitsbereich unterstützt auch das Inline-Hochladen von Bildern innerhalb des Markdown-Inhaltsbereichs, sodass Screenshots und Diagramme mit dem Artikel leben können, anstatt in einem mysteriösen Ordner auf dem Desktop von jemandem. Wenn Sie ein Bild von einer externen URL einfügen oder referenzieren, wird das Bild automatisch importiert und im Dokument gespeichert, sodass es verfügbar bleibt, selbst wenn die ursprüngliche URL offline geht.

## Ein Word-Dokument importieren

Sie können ein Word-Dokument (`.docx`) in einen vorhandenen Wissensartikel importieren. Die Schaltfläche **Importieren** erscheint in der Arbeitsbereichs-Symbolleiste, sobald das Dokument mindestens einmal gespeichert wurde und Sie sich im Bearbeitungsmodus befinden.

So funktioniert es:

- Klicken Sie auf **Importieren** und wählen Sie eine `.docx`-Datei von Ihrem Computer.
- Wenn der Artikel bereits Inhalt hat, fragt ein Bestätigungsdialog, ob Sie ihn ersetzen möchten. Die Auswahl von **Fortfahren** überschreibt das aktuelle Markdown mit dem importierten Inhalt.
- Der Word-Inhalt wird in Markdown konvertiert und in den Editor geladen. In der Word-Datei eingebettete Bilder werden extrahiert und als Inline-Anhänge gespeichert, sodass Sie sie nicht manuell erneut hochladen müssen.
- Nach dem Import sind Ihre Änderungen ungespeichert. Verwenden Sie **Speichern**, um den importierten Inhalt zu persistieren.

Wenn der Import auf einen Sperrkonflikt (jemand anderes hat die Sperre erworben) oder eine abgelaufene Sperre stößt, endet der Bearbeitungsmodus und eine entsprechende Meldung wird angezeigt. Wechseln Sie erneut in den Bearbeitungsmodus und versuchen Sie es erneut.

Importwarnungen — zum Beispiel nicht unterstützte Formatierung, die während der Konvertierung vereinfacht wurde — erscheinen kurz als Benachrichtigung am unteren Bildschirmrand.

Verwenden Sie die Importfunktion bei der Migration vorhandener Word-Dokumente in die Wissensdatenbank. Es ist schneller und sicherer als Kopieren-Einfügen und bewahrt eingebettete Bilder automatisch.

## Exportformate

Wissensartikel können exportiert werden als:

- **PDF**
- **DOCX**
- **ODT**

Der Export ist verfügbar, wenn der Artikel Inhalt hat. Dies ist nützlich, wenn:
- ein Dokument außerhalb von KANAP zirkulieren muss
- ein Prüfer Word-Format-Markup bevorzugt
- ein stabiler PDF-Snapshot zur Weitergabe oder zur Aufzeichnung benötigt wird

Der Export ersetzt nicht den Live-Artikel. Die Wissensdatenbank-Version bleibt die gesteuerte Quelle, während exportierte Dateien Verteilungsformate sind.

## Dokumente aus dem Chat generieren

Wenn der AI-Assistent in Ihrem KANAP aktiviert ist, können Sie ihn bitten, einen Wissensartikel für Sie aus dem Chat zu entwerfen. Der Assistent bereitet eine Vorschau vor, die Sie überprüfen, bevor etwas gespeichert wird. Die Bestätigung der Vorschau erstellt ein echtes Wissensdokument mit dem Inhalt, dem Typ, der Vorlagenherkunft und allen von Ihnen angegebenen Beziehungen — genau so, als hätten Sie es selbst geschrieben.

Generierte Dokumente folgen den gleichen Governance-Regeln wie handgeschriebene: Verantwortlichkeit, Status, Versionshistorie, Sperren und Review-Workflow gelten alle.

## Mitwirkende und Review-Workflow

Jedes Dokument kann ein strukturiertes Mitwirkenden-Modell haben:

- **Verantwortlicher**: die rechenschaftspflichtige Person für den Artikel
- **Autoren**: Personen, die helfen, den Inhalt zu pflegen
- **Prüfer**: Stufe-1-Prüfer
- **Genehmiger**: Stufe-2-Genehmiger

Der Verantwortliche ist operativ wichtig. Die Bereichsfilterung basiert auf der Verantwortlichkeit, und ein Dokument ohne klaren Verantwortlichen wird viel wahrscheinlicher zu „wichtigem Hintergrundmaterial", das niemand aktualisiert.

### Review-Workflow

Der Review-Workflow ist optional, aber gewollt:

- Prüfer arbeiten zuerst
- Genehmiger handeln nach Abschluss der Review-Stufe
- Genehmiger und Prüfer können Entscheidungs-Notizen aufzeichnen
- Das Anfordern von Änderungen sendet das Dokument zur Überarbeitung zurück
- Der Workflow verfolgt die letzte genehmigte Revision

Wichtige Konsequenzen:
- Sie können kein Review anfordern, während es ungespeicherte Änderungen gibt
- Sie benötigen zugewiesene Prüfer oder Genehmiger, bevor ein Review angefordert werden kann
- Archivierte und veraltete Dokumente sind keine Kandidaten für eine neue Review-Anfrage
- Verwaltete (integrierte) Dokumente verwenden den Wissens-Review-Workflow nicht
- Sobald der Review beginnt, ist die normale Bearbeitung deaktiviert, bis der Review genehmigt wird, Änderungen angefordert werden oder der Review abgebrochen wird

Dies macht den Review aussagekräftig. Wenn Autoren während der Genehmigung weiter am Inhalt arbeiten könnten, wäre das genehmigte Dokument ein bewegliches Ziel, was eine großartige Möglichkeit ist, Auseinandersetzungen zu schaffen, und eine schlechte Möglichkeit, Dokumentation zu erstellen.

## Die Seitenleiste des Dokumenten-Arbeitsbereichs

Die Seitenleiste hat zwei Reiter: **Eigenschaften** und **Kommentare**.

### Reiter Eigenschaften

Der Reiter Eigenschaften organisiert Governance-Daten in einklappbare Bereiche:

- **Status, Ordner, Typ, Vorlage und Zusammenfassung** sind oben immer sichtbar.
- **Mitwirkende**: Verantwortlichen, Autoren, Prüfer und Genehmiger zuweisen. Jede Rolle wird unabhängig vom Hauptdokument-Speichern gespeichert.
- **Review-Workflow**: zeigt den aktuellen Workflow-Zustand an, wenn ein Review aktiv ist, einschließlich Stufenfortschritt, Teilnehmerentscheidungen und kürzlicher Workflow-Aktivität. Wenn kein Workflow aktiv ist, können Sie von hier aus einen Review anfordern.
- **Klassifizierung**: das Dokument mit Kategorien und Streams aus dem Klassifizierungsschema Ihrer Organisation taggen. Mehrere Klassifizierungszeilen können hinzugefügt werden.
- **Beziehungen**: das Dokument mit Anwendungen, Assets, Projekten, Anfragen oder Aufgaben verknüpfen. Jeder Beziehungstyp hat sein eigenes Such- und Auswahlfeld.
- **Versionen**: listet gespeicherte Revisionen mit Zeitstempeln auf. **Zurücksetzen** ist nur verfügbar, während Sie eine aktive Bearbeitungssperre halten.

### Reiter Kommentare

Der Reiter Kommentare zeigt Aktivitäten rund um das Dokument: Kommentare, Workflow-Ereignisse und Änderungshistorie. Verwenden Sie Kommentare für Review-Kontext, redaktionelle Klärung oder Änderungs-Begründung, die mit dem Artikel verbunden bleiben sollte.

## Beziehungen und arbeitsbereichübergreifender Kontext

Wissensdokumente können direkt verknüpft werden mit:

- Anwendungen
- Assets
- Projekten
- Anfragen
- Aufgaben

Beziehungen sind nicht nur Tags. Sie steuern, wo das Dokument an anderer Stelle in KANAP erscheint und wie Benutzer es aus operativen Arbeitsbereichen entdecken.

Konsequenzen des Hinzufügens von Beziehungen:
- das Dokument wird vom verknüpften Objekt aus leichter zu finden
- Leser, die das Objekt öffnen, erhalten kontextbezogene Dokumentation, ohne manuell suchen zu müssen
- Berichterstattung und Governance rund um das Objekt werden vollständiger

Konsequenzen schlechter Beziehungen:
- nützliche Dokumente bleiben außerhalb der Wissensdatenbank unsichtbar
- Benutzer erstellen Duplikate, weil sie den vorhandenen Artikel nicht finden können
- dasselbe Thema beginnt über mehrere Dokumente zu driften

In verwandten Arbeitsbereichen unterscheiden Wissens-Panels zwischen:
- **Verknüpfte Dokumente**: direkt mit dem Objekt verbunden
- **Verwandte Dokumente**: durch Kontext und Herkunft aus verbundener Arbeit aufgetaucht

Diese Unterscheidung ist wichtig. Direkte Verknüpfungen drücken eine bewusste Beziehung aus. Verwandte Dokumente drücken nützlichen Kontext aus, aber nicht die gleiche Stufe der Verantwortlichkeit.

## Gute Betriebsgewohnheiten

- Verwenden Sie Bibliotheken für Governance-Grenzen, Ordner für Navigation und Beziehungen für geschäftlichen Kontext.
- Halten Sie die Verantwortlichkeit aktuell. Ein guter Artikel mit dem falschen Verantwortlichen lebt normalerweise auf geliehener Zeit.
- Verwenden Sie Vorlagen, wenn Konsistenz über Teams hinweg wichtig ist.
- Verwenden Sie Review für Dokumente, die Entscheidungen, Kontrollen oder wiederholbare Prozesse antreiben.
- Markieren Sie veraltete Inhalte als archiviert oder veraltet, anstatt Leser raten zu lassen.
- Importieren Sie Word-Dokumente bei der Migration vorhandener Inhalte in die Wissensdatenbank, anstatt sie zu kopieren und einzufügen, damit eingebettete Bilder automatisch erhalten bleiben.
- Greifen Sie zu eingeschränkten Bibliotheken, wenn der Zugriff auf Bibliotheksebene wichtig ist – verlassen Sie sich nicht auf das Ordnerlayout, um sensible Inhalte zu verbergen.
