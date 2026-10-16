# Mitwirkende

Mitwirkende ermöglicht es Ihnen, Fähigkeiten, Teamzuweisungen, Projektverfügbarkeit und Klassifizierungsstandards für Personen zu definieren, die an Portfolio-Projekten arbeiten. Diese Informationen helfen bei der Ressourcenplanung und stellen sicher, dass Sie die richtige Expertise für anstehende Arbeit haben.

## Erste Schritte

Navigieren Sie zu **Portfolio > Mitwirkende**, um konfigurierte Mitwirkende gruppiert nach Team zu sehen. Klicken Sie auf **Mitwirkenden hinzufügen**, um jemanden aus Ihrer Benutzerliste hinzuzufügen.

**Um einen Mitwirkenden hinzuzufügen**:
1. Klicken Sie auf **Mitwirkenden hinzufügen**
2. Suchen Sie nach einem Benutzer im Dropdown und wählen Sie ihn aus
3. Klicken Sie auf **Hinzufügen**, um sein Profil zu erstellen
4. Konfigurieren Sie Team, Verfügbarkeit, Fähigkeiten und Standards im Arbeitsbereich

**Tipp**: Mitwirkende sind unabhängig von Benutzerkonten. Jemanden als Mitwirkenden hinzuzufügen ändert nicht seinen Login-Zugang. Es ermöglicht Ihnen lediglich, seine Teammitgliedschaft, Fähigkeiten, Verfügbarkeit und Klassifizierungsstandards für die Projektplanung zu verfolgen.

---

## Wo Sie es finden

- Arbeitsbereich: **Portfolio**
- Pfad: **Portfolio > Mitwirkende**
- Self-Service-Pfad: **Einstellungen > Profil > Mitwirkenden-Einstellungen** (öffnet Ihr eigenes Mitwirkenden-Profil)
- Berechtigungen:
  - Anzeigen: `portfolio_settings:reader`
  - Mitwirkende hinzufügen oder bearbeiten: `portfolio_settings:member`
  - Mitwirkende entfernen: `portfolio_settings:admin`
  - Eigenes Profil bearbeiten: jede Portfolio-Reader-Berechtigung (z. B. `tasks:reader`, `portfolio_projects:reader`, `portfolio_settings:reader`)

Wenn Sie Mitwirkende nicht im Menü sehen, bitten Sie Ihren Administrator, Ihnen die entsprechenden Berechtigungen zu erteilen.

---

## Arbeiten mit der Liste

Mitwirkende werden als Karten angezeigt, gruppiert nach Team.

**Jede Mitwirkenden-Karte zeigt**:
- **Name** (oder E-Mail, wenn kein Anzeigename gesetzt ist)
- **Fähigkeiten-Anzahl**: Anzahl konfigurierter Fähigkeiten (z. B. „3 Fähigkeiten")
- **Verfügbarkeit**: Verfügbare Tage pro Monat für Projekte (z. B. „5d/Mo")
- **Durchschnittlicher Projektaufwand**: Durchschnittliche monatliche Projektzeit aus erfassten Einträgen der letzten 6 Monate, wenn Daten verfügbar sind

**Filterung**:
- Verwenden Sie das Dropdown **Nach Team filtern**, um nur Mitwirkende eines bestimmten Teams anzuzeigen
- Wählen Sie **Nicht zugewiesen**, um Mitwirkende zu sehen, die noch keinem Team zugewiesen sind
- Wählen Sie **Alle Teams**, um alle zu sehen
- Verwenden Sie daneben das Dropdown **Nach Vertragsart filtern**, um nur internes Personal, nur Externe und so weiter anzuzeigen. Beide Filter wirken zusammen und gelten sowohl für die Liste als auch für die Kompetenzmatrix. Das Organigramm hat stattdessen eigene Bedienelemente, da eine Berichtslinie über Teams hinweg verläuft.

**Teamgruppen**:
- Jedes Team wird als zusammenklappbare Karte mit einem Mitgliederzahl-Badge angezeigt
- Klicken Sie auf die Team-Kopfzeile, um sie auf- oder zuzuklappen
- Teams werden alphabetisch sortiert; **Nicht zugewiesen** erscheint immer zuletzt

Klicken Sie auf eine Mitwirkenden-Karte, um ihren Arbeitsbereich zu öffnen.

**Ansicht wechseln**:
Über dem Team-Filter wechseln **Liste**, **Kompetenzmatrix** und **Organigramm** zwischen drei Lesarten derselben Personen. Der Team-Filter gilt für die ersten beiden. Die Adresse ändert sich zu `?view=matrix` oder `?view=org`, sodass ein Link als Lesezeichen gespeichert oder geteilt werden kann, und die zuletzt verwendete Ansicht wird in Ihrem Browser gemerkt.

---

## Die Kompetenzmatrix

Die Kompetenzmatrix beantwortet zwei Fragen auf einem Bildschirm: was jede Person kann und welche Kompetenzen niemand abdeckt. Sie ist eine reine Leseansicht. Die Niveaus werden im Reiter Kompetenzen des jeweiligen Mitwirkenden gesetzt.

**Das Raster lesen**:
- **Zeilen** sind die Kompetenzen Ihres Katalogs, nach Kategorie gruppiert. In den Portfolio-Einstellungen deaktivierte Kompetenzen erscheinen nie, und Kompetenzen, die niemand erfasst hat, sind zunächst ausgeblendet
- **Spalten** sind die Mitwirkenden, nach Team gruppiert. Ihre Namen werden von unten nach oben gelesen; ein Klick öffnet den Reiter Kompetenzen dieser Person
- **Zellen** enthalten das Niveau von 1 bis 4. Die Niveaus 3 und 4 (eigenständig und Experte) erscheinen in voller Textfarbe, die Niveaus 1 und 2 bleiben blass, und eine leere Zelle bedeutet, dass die Kompetenz für diese Person nie erfasst wurde. Fahren Sie über eine Zelle, um den Namen des Niveaus zu lesen
- Die Spalte **Eigenständig oder Experte** rechts zählt für jede Kompetenz, wie viele der angezeigten Personen auf Niveau 3 oder 4 sind. **Der Zähler wird orange, wenn er null ist**: Niemand deckt diese Kompetenz derzeit allein ab
- Die Zeile **Kompetenzen** unten fasst jede Person als „eigenständig / erfasst“ zusammen, zum Beispiel `2/5`

**Das Raster drehen**:
Kataloge sind meist länger als Teams, deshalb stehen die Mitwirkenden standardmäßig in den Spalten und die Kompetenznamen bleiben entlang der Zeilen lesbar. Mit dem Steuerelement **Spalten** über dem Raster stellen Sie stattdessen die Kompetenzen in die Spalten, was zu einem kurzen Katalog oder einem großen Team passt. Alles wechselt mit: Die beiden Zusammenfassungen tauschen die Seiten, und ein Mitwirkender wird dann über seine Zeile statt über seine Spaltenkopfzeile geöffnet. Die Wahl wird in Ihrem Browser gemerkt.

**Das Raster eingrenzen**:
- Das Raster beginnt bei den Kompetenzen, die tatsächlich vorhanden sind. **Nicht genutzte Kompetenzen anzeigen** holt den Rest des Katalogs zurück: für die Schulungsplanung statt der Bestandsaufnahme
- Jede Kompetenzkategorie hat eine Pille über dem Raster. Schalten Sie eine Kategorie aus, um sie zu entfernen
- Der Team-Filter schränkt die Personen ein, und die Abdeckungszähler folgen: Filtern Sie auf ein Team, und Sie lesen die Abdeckung dieses Teams
- Sowohl die Kategorie-Pillen als auch der Schalter für nicht genutzte Kompetenzen werden in Ihrem Browser gemerkt

**Auf das Gesehene reagieren**:
- Klicken Sie auf einen Mitwirkenden, um seinen Reiter **Kompetenzen** zu öffnen, in dem sich die Niveaus ändern lassen
- **Exportieren** neben **Mitwirkenden hinzufügen** oben auf der Seite lädt das Angezeigte als `.xlsx`-Datei herunter, in derselben Ausrichtung, die Niveaus als Zahlen. Nützlich für Kompetenzbewertungen und Schulungspläne

---

## Das Organigramm

Das Organigramm zeichnet die Berichtslinie Ihrer Mitwirkenden, aufgebaut aus dem **Vorgesetzten**, der in jedem Profil hinterlegt ist. Alle, deren Vorgesetzter kein Mitwirkender ist, stehen nebeneinander an der Spitze, sodass mehrere unabhängige Zweige gleichzeitig lesbar sind.

**Eine Karte lesen**:
- Initialen, Name, Position, Vertragsart und die Anzahl der Kompetenzen im Profil
- Klicken Sie auf eine Karte, um diesen Mitwirkenden zu öffnen
- Eine Karte mit Personen darunter trägt am unteren Rand einen kleinen Pfeil. Ein Klick klappt diesen Zweig zu, ein weiterer klappt ihn wieder auf
- Fahren Sie über eine Karte, die im Organigramm nach oben gerückt wurde, um zu sehen, welcher Vorgesetzte übersprungen wurde, zum Beispiel „Zugeordnet über Claire Meunier“

**Wer erscheint**:
- Es werden nur Mitwirkende gezeichnet. Ist der Vorgesetzte einer Person kein Mitwirkender, rückt diese Person an die Spitze des Organigramms, statt zu verschwinden
- Deaktivierte Konten bleiben außen vor. **Deaktivierte Konten einbeziehen** holt sie zurück, was während der Übergabe eines Austritts nützlich ist
- Jede Vertragsart hat eine Pille über dem Organigramm. Schalten Sie eine ab, verlassen diese Personen das Organigramm, **ihre eigenen unterstellten Personen bleiben jedoch**: Sie rücken zur nächsten noch sichtbaren Führungskraft auf. Die Externen auszublenden erhält so Ihre internen Teams als lesbaren Baum, statt ganze Zweige abzuschneiden

**Das Organigramm zuschneiden**:
- **Beginnen bei** reduziert das Organigramm auf eine Person und alles darunter. So entsteht das Organigramm einer einzelnen Abteilung
- **Ebenen** begrenzt, wie weit das Organigramm nach unten reicht, zum Beispiel die obersten zwei Ebenen für eine Führungsübersicht
- Die Zoom-Schaltflächen rechts skalieren die Zeichnung; das Organigramm scrollt innerhalb seines Rahmens in beide Richtungen
- Jede dieser Einstellungen wird in die Adresse geschrieben, sodass das Organigramm eines Zweigs genau so als Link weitergegeben werden kann, wie Sie es zugeschnitten haben

**Exportieren und drucken**:
- **Als PNG exportieren** neben **Mitwirkenden hinzufügen** oben auf der Seite speichert das gesamte Organigramm als Bild, immer auf weißem Grund, unabhängig vom Design, in dem Sie es gerade lesen. Das Exportdatum steht unten links. Zugeklappte Zweige bleiben zugeklappt, und eine zugeklappte Karte trägt die Anzahl der darunter verborgenen Personen. Der Zoom am Bildschirm verändert das Bild nicht
- Der Druckbefehl Ihres Browsers druckt das Organigramm allein, im Querformat und ohne die umgebende Anwendung

---

## Der Mitwirkenden-Arbeitsbereich

Klicken Sie auf eine Mitwirkenden-Zeile, um ihren Arbeitsbereich zu öffnen. Die Kopfzeile zeigt die Referenz des Mitwirkenden (`CTR-1`, `CTR-2`…, zum Kopieren anklicken), seinen Namen, sein Team, seine Verfügbarkeit und die Anzahl der Fähigkeiten. Diese Referenz steht auch in der Seitenadresse. Verwenden Sie die Pfeile neben dem Zurück-Link (oder die Pfeiltasten links und rechts), um in Listenreihenfolge zum vorherigen oder nächsten Mitwirkenden zu wechseln. Drücken Sie **Esc**, um zur Liste zurückzukehren.

Der Arbeitsbereich hat drei Reiter, **Allgemein**, **Fähigkeiten** und **Erfasste Zeit**, sowie ein **Eigenschaften**-Panel auf der rechten Seite, das Position, Team, Verfügbarkeit und Klassifizierungsstandards enthält. Öffnen oder schließen Sie das Panel über die Lasche an seinem Rand oder drücken Sie **P**.

Jede Änderung wird automatisch gespeichert. Ein kurzer Hinweis „Speichern… / Gespeichert“ erscheint neben den Metadaten der Kopfzeile, während eine Änderung geschrieben wird.

### Eigenschaften-Panel

**Position**
Die Position der Person, dieselbe, die überall dort erscheint, wo sie in KANAP auftaucht: im Organigramm, in ihrem Benutzerdatensatz, in ihrem Profil. Es ist keine Bezeichnung nur für das Portfolio: Wer sie hier ändert, ändert sie überall. Tippen Sie sie ein und klicken Sie daneben, um zu speichern.

Ihre eigene können Sie immer setzen. Die einer anderen Person zu setzen erfordert die Stufe **Administrator** für Benutzer; ohne dieses Recht sehen Sie den Wert weiterhin, das Feld ist aber schreibgeschützt.

Stammt das Konto aus Microsoft Entra, ist das Feld schreibgeschützt und zeigt darunter **Aus Microsoft Entra**. Ändern Sie sie in Ihrem Verzeichnis, nicht hier: Sowohl die nächtliche Synchronisierung als auch die nächste Anmeldung holen den Wert aus dem Verzeichnis zurück, sodass hier Eingetipptes überschrieben würde.

**Team**
Weisen Sie diesen Mitwirkenden einem Team zu. Teams sind Organisationsgruppen, die in den Portfolio-Einstellungen konfiguriert sind. Diese Zuweisung bestimmt, wie Mitwirkende auf der Mitwirkenden-Seite gruppiert werden. Das Team kann auch über den Eintrag **Team** in der Kopfzeile geändert werden. Dieses Feld ist nur beim Bearbeiten des Profils eines anderen Mitwirkenden sichtbar (nicht Ihres eigenen).

**Vorgesetzter**
Die Person, an die dieser Mitwirkende berichtet. Klicken Sie auf das Feld, suchen Sie nach dem Namen und wählen Sie eine beliebige Person Ihrer Organisation aus. Der Vorgesetzte muss selbst kein Mitwirkender sein. Mit **Löschen** entfernen Sie die Verknüpfung. Ein Mitwirkender kann nicht sein eigener Vorgesetzter sein, und Sie können niemanden auswählen, der bereits an ihn berichtet, weder direkt noch über eine Kette von Vorgesetzten.

Stammt der Vorgesetzte aus Microsoft Entra, ist das Feld schreibgeschützt und zeigt darunter **Aus Microsoft Entra**. Ändern Sie ihn in Ihrem Verzeichnis, nicht hier; die nächtliche Synchronisierung überträgt die Änderung. Ein Vorgesetzter ohne KANAP-Konto wird übersprungen, bis er eines hat, und das Feld behält so lange seinen aktuellen Wert.

Einmal gesetzt, erscheint der Name des Vorgesetzten auch in der Kopfzeile des Arbeitsbereichs; ein Klick öffnet dessen Mitwirkenden-Profil, sofern vorhanden. Dieses Feld ist nur beim Bearbeiten des Profils eines anderen Mitwirkenden sichtbar (nicht Ihres eigenen).

**Vertragsart**
Wie diese Person mit Ihnen zusammenarbeitet. Jeder Mitwirkende beginnt als **Intern**; wechseln Sie zu **Extern**, **Auszubildender** oder **Sonstige**, wenn das nicht zutrifft. Die Liste können Sie unter **Portfolio > Einstellungen > Vertragsarten** anpassen. Die Vertragsart wird nie aus Microsoft Entra importiert. Dieses Feld ist nur beim Bearbeiten des Profils eines anderen Mitwirkenden sichtbar (nicht Ihres eigenen).

**Projektverfügbarkeit**
Verwenden Sie den Schieberegler, um festzulegen, wie viele Tage pro Monat diese Person an Portfolio-Projekten arbeiten kann. Der Bereich ist 0 bis 20 Tage, in 0,5-Tage-Schritten. Standard ist 5 Tage. Der Wert wird gespeichert, sobald Sie den Schieberegler loslassen.

**Klassifizierungsstandards**
Legen Sie die Klassifizierungswerte fest, die bei neuen Aufgaben, Anfragen und Projekten vorausgefüllt werden, wenn Klassifizierungsfelder noch leer sind. Dies spart Zeit für Mitwirkende, die regelmäßig im selben Bereich arbeiten.

- **Quelle**: Die Standardquell-Klassifizierung
- **Kategorie**: Die Standard-Kategorie-Klassifizierung
- **Stream**: Die Standard-Stream-Klassifizierung (nur verfügbar, wenn eine **Kategorie** ausgewählt ist; gefiltert auf Streams, die zu dieser Kategorie gehören)
- **Unternehmen**: Das Standardunternehmen

Wenn ein Mitwirkender eine neue Aufgabe, Anfrage oder ein neues Projekt erstellt, werden diese Standards verwendet, um die Klassifizierungsfelder automatisch vorzubelegen. Die Änderung der **Kategorie** löscht den **Stream**, wenn der aktuelle Stream nicht zur neu ausgewählten Kategorie gehört.

**Tipp**: Sie können Ihre eigenen Standards auch über **Einstellungen > Profil** erreichen; dort öffnet sich Ihr Mitwirkenden-Profil mit sichtbarem Eigenschaften-Panel.

### Allgemein

Sehen Sie Zeitstatistiken und fügen Sie Notizen hinzu.

**Zeitstatistiken**
Schreibgeschützte Zusammenfassung der erfassten Zeit für diesen Mitwirkenden. Erfordert `portfolio_settings:reader` zur Ansicht.

- **Durchschnittlicher monatlicher Projektaufwand (letzte 6 Monate)**: Angezeigt in Personentagen (Stunden / 8)
- **Monatlicher Aufwand (12 Monate)**: Liniendiagramm mit **Gesamt**, **Projekt** und **Sonstig**
  - **Projekt** = Projekt-Overhead-Zeit + für Projektaufgaben erfasste Zeit
  - **Sonstig** = für Nicht-Projekt-Aufgaben erfasste Zeit
  - Monate ohne Daten werden als Lücken im Diagramm angezeigt

**Notizen**
Freitextfeld für zusätzliche Informationen über diesen Mitwirkenden: Zertifizierungen, Präferenzen, Einschränkungen oder andere relevante Details. Notizen werden kurz nachdem Sie mit dem Tippen aufhören gespeichert.

---

### Fähigkeiten

Verfolgen Sie, was dieser Mitwirkende kann und wie kompetent er ist.

**Fähigkeiten hinzufügen**:
1. Klicken Sie in der Kopfzeile des Arbeitsbereichs auf **Kompetenz hinzufügen** (in jedem Reiter verfügbar)
2. Suchen Sie die Fähigkeit; die Liste ist nach Kategorie gruppiert
3. Wählen Sie im selben Dialog das Niveau (Standard: 2, „Kann mit Unterstützung ausführen")
4. Klicken Sie auf **Hinzufügen**: Die Fähigkeit erscheint in ihrem Abschnitt mit dem bereits gesetzten Niveau, sodass eine lange Liste nie durchsucht werden muss, um es anzupassen

**Kompetenzgrade**:
Jede Fähigkeit hat eine Kompetenzbewertung von 1 bis 4:

| Stufe | Bezeichnung | Beschreibung |
|-------|-------|-------------|
| 1 | Grundlagen / Theoretisch | Versteht Konzepte, hat sie aber noch nicht angewendet |
| 2 | Kann mit Unterstützung ausführen | Kann die Arbeit mit Anleitung erledigen |
| 3 | Eigenständig | Kann unabhängig arbeiten |
| 4 | Experte | Tiefgreifende Expertise, kann andere anleiten |

Jede Fähigkeit zeigt vier Stufenmarken, gefolgt vom Namen der aktuellen Stufe. Klicken Sie auf eine Marke, um die Stufe festzulegen, oder fokussieren Sie die Marken und verwenden Sie die Pfeiltasten. Fahren Sie mit der Maus über eine Marke, um zu sehen, was diese Stufe bedeutet.

**Fähigkeiten entfernen**:
Fahren Sie mit der Maus über eine Fähigkeit und klicken Sie auf das **×**, das am Zeilenende erscheint, um sie aus dem Profil des Mitwirkenden zu entfernen.

**Fähigkeitskategorien**:
Fähigkeiten sind unter ihrer Kategorieüberschrift gruppiert, daneben steht die Anzahl der Fähigkeiten. Mit **Gruppieren nach** über der Liste wechseln Sie stattdessen zu einer Gruppierung nach Niveau, vom Experten abwärts: So sehen Sie auf einen Blick, was diese Person beherrscht. Die Auswahl wird gespeichert. Auf einem breiten Bildschirm fließt die Liste in zwei Spalten.

---

### Erfasste Zeit

Zeigen und verwalten Sie alle Zeiteinträge für diesen Mitwirkenden an einem Ort. Dieser Reiter ist nur sichtbar, wenn Sie `portfolio_settings:reader` oder höher haben.

Die Tabelle konsolidiert Zeit aus Projekt-Overhead-Einträgen und Aufgaben-Zeiteinträgen und gibt Ihnen ein vollständiges Bild davon, wie der Mitwirkende seine Zeit verbringt.

**Spalten**:
- **Datum**: Wann die Zeit erfasst wurde
- **Quelle**: Wo die Zeit erfasst wurde: entweder ein Aufgabenname oder Projektname
- **Kategorie**: Ob der Eintrag als **IT** oder **Business** klassifiziert ist, angezeigt als farbcodiertes Label
- **Zeit**: Dauer in Stunden oder Tagen (z. B. „4h", „1d 2h")
- **Notizen**: Alle dem Eintrag beigefügten Notizen

**Einträge bearbeiten**:
Klicken Sie auf das **Bearbeitungssymbol** neben einem Zeiteintrag, um den Bearbeitungsdialog zu öffnen. Der Dialog hängt vom Eintragstyp ab:
- **Aufgabeneinträge** öffnen den Aufgaben-Zeiterfassungsdialog, in dem Sie Stunden, Datum, Kategorie und Notizen anpassen können
- **Projekteinträge** öffnen den Projekt-Zeiterfassungsdialog, in dem Sie Stunden, Kategorie, Benutzer und Notizen anpassen können

**Einträge löschen**:
Klicken Sie auf das **Löschsymbol** neben einem Zeiteintrag, um ihn zu entfernen. Sie werden vor dem Löschen um Bestätigung gebeten. Das Löschen eines Eintrags aktualisiert auch die Zeitstatistiken des Mitwirkenden im Reiter **Allgemein**.

**Berechtigungen für Zeiteintragsaktionen**:
- Um die Spalte **Aktionen** zu sehen, benötigen Sie mindestens `tasks:member` oder `portfolio_projects:contributor`
- Nicht-Admin-Benutzer können nur Einträge bearbeiten oder löschen, die sie erstellt haben oder denen sie zugewiesen sind
- Benutzer mit `tasks:admin` können jeden eigenständigen Aufgabeneintrag bearbeiten oder löschen
- Benutzer mit `portfolio_projects:admin` können jeden Projektaufgabeneintrag oder Projekt-Overhead-Eintrag bearbeiten oder löschen

---

## Aktionen

Aus der Arbeitsbereich-Kopfzeile:
- **Löschen**: Diese Mitwirkenden-Konfiguration entfernen (betrifft nicht das Benutzerkonto). Nur beim Bearbeiten des Profils eines anderen Mitwirkenden mit `portfolio_settings:admin` verfügbar.
- **Zurück-Link**: Zur Mitwirkenden-Liste zurückkehren, oder zu **Einstellungen**, wenn Sie Ihr eigenes Profil geöffnet haben

Es gibt keine Speichern-Schaltfläche: Jede Änderung wird automatisch gespeichert.

---

## Ihr eigenes Mitwirkenden-Profil

Jeder Benutzer mit mindestens einer Portfolio-Reader-Berechtigung kann auf sein eigenes Mitwirkenden-Profil unter **Portfolio > Mitwirkende > ich** oder über **Einstellungen > Profil > Mitwirkenden-Einstellungen** zugreifen.

Beim Bearbeiten Ihres eigenen Profils:
- Können Sie Ihre **Verfügbarkeit**, **Fähigkeiten**, **Notizen** und **Klassifizierungsstandards** aktualisieren
- Können Sie nicht Ihre eigene **Teamzuweisung** ändern (das kann nur ein Portfolio-Settings-Mitglied)
- Können Sie nicht Ihren eigenen Mitwirkenden-Datensatz löschen

Wenn Sie noch keinen Mitwirkenden-Datensatz haben, wird beim Öffnen der Self-Service-Seite automatisch einer erstellt.

---

## Teams

Mitwirkende können organisatorischen Teams zugewiesen werden, um die Organisation zu verbessern. Teams werden in **Portfolio > Einstellungen > Teams** konfiguriert.

**Standardteams** (können angepasst werden):
- Infrastruktur
- Business-Anwendungen
- Engineering-Anwendungen
- Service Desk
- Stammdaten
- Cybersecurity

**Teams verwalten**:
- Gehen Sie zu **Portfolio > Einstellungen** und klicken Sie auf den Reiter **Teams**
- Teams hinzufügen, bearbeiten oder deaktivieren
- Verwenden Sie **Standardwerte laden**, um mit Standardteams zu befüllen
- Teams mit zugewiesenen Mitgliedern können nicht gelöscht werden

---

## Vertragsarten

Vertragsarten halten fest, wie jede Person mit Ihnen zusammenarbeitet: als Angestellter, als Person eines Dienstleisters, als Auszubildender und was Ihre Organisation sonst braucht. Sie werden unter **Portfolio > Einstellungen > Vertragsarten** konfiguriert. Jeder Mitwirkende beginnt als Intern.

**Standardarten** (umbenennbar):
- Intern
- Extern
- Auszubildender
- Sonstige

**Vertragsarten verwalten**:
- Gehen Sie zu **Portfolio > Einstellungen** und öffnen Sie den Tab **Vertragsarten**
- Legen Sie eigene Arten an, benennen Sie sie um, oder deaktivieren Sie eine, um sie von neuen Zuordnungen auszunehmen, ohne die bereits zugeordneten Mitwirkenden zu verlieren
- Die vier integrierten Arten können umbenannt, aber nicht gelöscht werden
- Eine Art, die mindestens einem Mitwirkenden zugeordnet ist, kann nicht gelöscht werden; der Tab zeigt, wie viele Mitwirkende jede Art verwenden

---

## Tipps

- **Mitwirkende Teams zuweisen**: Dies hilft, die Mitwirkenden-Seite zu organisieren und macht es einfacher, bestimmte Personen zu finden.
- **Realistische Verfügbarkeit festlegen**: Berücksichtigen Sie Meetings, Tagesgeschäft und Urlaub bei der Festlegung der Tage pro Monat. Die meisten Personen haben weniger Projektzeit als erwartet.
- **Kompetenz ehrlich einschätzen**: Ein Team voller „Experten" ist für die Planung nicht nützlich. Seien Sie realistisch bei Kompetenzgraden, um bessere Ressourcenentscheidungen zu treffen.
- **Fähigkeiten aktuell halten**: Überprüfen Sie die Fähigkeiten der Mitwirkenden regelmäßig, besonders nach Schulungen oder neuen Projekterfahrungen.
- **Klassifizierungsstandards früh einrichten**: Wenn Sie immer in derselben Kategorie und demselben Stream arbeiten, spart Ihnen die Konfiguration von Standards die Auswahl bei jeder Erstellung einer Aufgabe oder Anfrage.
