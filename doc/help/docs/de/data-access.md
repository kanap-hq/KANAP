# Datenzugriff

Rollen legen fest, was eine Person in jedem Modul tun kann. Der Datenzugriff legt fest, auf welchem Teil des Budgets sie es tun kann. Damit verwaltet der IT-Verantwortliche einer Tochtergesellschaft deren Budget, ohne die anderen zu sehen, und ein Bereichsleiter liest die Zeilen seiner eigenen Kostenstellen.

Der Datenzugriff gilt für Budgetzeilen (OPEX und CAPEX) und für Verträge sowie für alles, was sie zeigt: Listen, Summen, Berichte, Suche, Plaid, Exporte. Die anderen Module funktionieren für alle wie bisher.

Jede Person beginnt mit **Alle Daten**. Nichts ändert sich, solange kein Administrator jemanden begrenzt.

## Wo Sie ihn finden

- **Das Benutzerfenster**: Öffnen Sie einen Benutzer unter **Administration > Benutzer** und wählen Sie den Reiter **Datenzugriff** neben **Identität**. Der Eintrag **Datenzugriff** im Menü einer Zeile öffnet das Fenster auf diesem Reiter.
- **Administration > Datenzugriff**: die Liste der Personen, deren Zugriff begrenzt ist, mit Import und Export.
- **Der Reiter Zugriff** eines Unternehmens und einer Kostenstelle oder Gruppe: wer sie sieht, und über welchen Knoten.

Berechtigungen: Diese Bildschirme erfordern die Stufe Admin für Benutzer (`users:admin`) und für Sie selbst alle Daten. Ihren eigenen Zugriff können Sie nicht ändern.

## Alle Daten oder begrenzt auf

Eine Person befindet sich in einem von zwei Modi:

- **Alle Daten**: Die Person sieht das ganze Budget und alle Verträge, so wie ihre Rollen es erlauben. Das ist die Voreinstellung.
- **Begrenzt auf**: Die Person sieht, was eine Liste von Knoten abdeckt. Jeder Knoten hat einen Zugriff, **Lesen** oder **Bearbeiten**.

Ein Knoten ist einer der folgenden:

| Knoten | Was er abdeckt |
|---|---|
| Ein Unternehmen | Die Zeilen, die das Unternehmen bezahlt, die Zeilen auf seinen Kostenstellen und seine Verträge |
| Eine Kostenstellengruppe | Ihre Untergruppen und deren Kostenstellen, unabhängig vom Unternehmen |
| Eine Kostenstelle | Die Zeilen, die ihr zugeordnet sind |
| **Alles** | Alle Zeilen und alle Verträge |

Eine Zeile ist sichtbar, wenn ein Unternehmen der Liste sie bezahlt oder wenn sie einer Kostenstelle unter einem Knoten der Liste zugeordnet ist. Ein Vertrag ist sichtbar, wenn sein Unternehmen in der Liste steht oder wenn sein Feld **Kostenstelle oder Gruppe** unter einen Knoten der Liste zeigt. Dieses Feld ist optional, und die Vertragsliste hat eine Spalte und einen Filter **Ohne Kostenstelle**, um es zu ergänzen.

Ein Beispiel. Der Arbeitsbereich hat zwei Unternehmen, Alpha France und Alpha Spain, und eine Gruppe Infrastruktur mit INF-FR (Frankreich) und INF-ES (Spanien).

- Marta, begrenzt auf **Alpha Spain (Bearbeiten)**, sieht und bearbeitet die Zeilen, die Alpha Spain bezahlt.
- Paul, begrenzt auf **Infrastruktur (Lesen)**, liest die Zeilen auf INF-FR und INF-ES. Eine spanische Zeile ohne Kostenstelle bleibt ihm verborgen.
- Claire, mit **Alle Daten**, sieht alles.

**Alles** dient Personen, die das ganze Budget lesen und einen Teil davon bearbeiten: Geben Sie ihnen **Alles (Lesen)** und die Knoten, die sie bearbeiten.

Knoten addieren sich. Decken zwei Knoten dieselbe Zeile ab, gilt der weitere Zugriff: Mit Netzwerke auf Lesen und NET-01 auf Bearbeiten sind die Zeilen von NET-01 bearbeitbar und der Rest von Netzwerke schreibgeschützt. Ein Knoten kann keinen seiner Unterknoten ausschließen.

### Eine Zeile oder einen Vertrag anlegen und verschieben

Um eine Zeile anzulegen oder ihr Unternehmen oder ihre Kostenstelle zu ändern, muss das Unternehmen zu einem Knoten mit Bearbeiten passen:

- Das zahlende Unternehmen ist ein Unternehmen mit Bearbeiten, oder
- die Kostenstelle der Zeile ist mit Bearbeiten abgedeckt, und die Zeile wird vom Unternehmen dieser Kostenstelle bezahlt.

Ein Kostenstellenknoten erlaubt also, die Zeilen dieser Kostenstelle anzulegen, bezahlt von ihrem Unternehmen. Er erlaubt nicht, ein anderes Unternehmen zahlen zu lassen. Eine Zeile, die ein anderes Unternehmen als das ihrer Kostenstelle bezahlt, wird über die Kostenstelle gelesen und nur über ihr zahlendes Unternehmen bearbeitet.

Verträge folgen derselben Regel mit ihrem Unternehmen und ihrem Feld **Kostenstelle oder Gruppe**. Die Auswahlen für Unternehmen und Kostenstelle bieten nur die Werte an, die die Person verwenden darf. Ein anderer Wert wird mit „Dieses Unternehmen oder diese Kostenstelle gehört nicht zu Ihrem Zugriff.“ abgelehnt.

### Zeilen ohne Unternehmen

Ältere Zeilen können ohne Unternehmen sein. Sie sind nur für Personen mit allen Daten, für Personen mit einem Knoten **Alles** und für die darauf benannten Personen sichtbar. **Administration > Datenzugriff** zählt sie, mit einem Link zur Liste.

## Die Rolle sagt was, die Knoten sagen wo

Beide wirken zusammen:

- **Bearbeiten** gibt, was die Rollen der Person erlauben. Ein Budget-Leser mit einem Knoten auf Bearbeiten liest weiterhin nur.
- **Lesen** begrenzt den Zugriff auf das Lesen, unabhängig von den Rollen.
- Der Datenzugriff gehört der Person. Er gilt für Budget und Verträge mit der Stufe, die jede Rolle in jedem Modul gibt.

Ein Budget-Mitglied, begrenzt auf **Alpha Spain (Bearbeiten)**, legt zum Beispiel spanische Zeilen an und bearbeitet sie. Ein Budget-Leser mit demselben Knoten liest sie.

## Was eine Person immer sieht

Eine begrenzte Person sieht immer, wo sie benannt ist, auch außerhalb ihrer Knoten:

| Benannt als | Zugriff, im Rahmen der Rolle |
|---|---|
| IT-Verantwortlicher oder Fachbereichsverantwortlicher einer Zeile | Bearbeiten |
| Verantwortlicher eines Vertrags | Bearbeiten |
| Zugewiesene Person oder Verantwortlicher einer Aufgabe | Bearbeiten |
| Person, die einer Aufgabe folgt | Lesen |

Eine Aufgabe anzulegen zählt nicht. Die Benennung öffnet das Element. Sie erlaubt nicht, es einem Unternehmen oder einer Kostenstelle außerhalb der Knoten mit Bearbeiten zuzuordnen oder es zu löschen. Eine Änderung, die eine Zeile aus dem Zugriff der Person nehmen würde, wird mit „Diese Änderung würde die Zeile aus Ihrem Zugriff nehmen. Bleiben Sie einer ihrer Verantwortlichen, oder fragen Sie jemanden mit Zugriff auf ihr Unternehmen.“ abgelehnt.

Eine begrenzte Person ohne Knoten sieht nur, wo sie benannt ist. Eine leere Liste wird nie wieder zu allen Daten.

Der Budgetverantwortliche einer Kostenstelle ist auf ihren Zeilen nicht benannt. Um Budgetverantwortlichen ihre Kostenstellen zu geben, verwenden Sie **Eigene Kostenstellen hinzufügen** im Benutzerfenster (siehe unten).

## Administratoren

Die Rolle Administrator sieht immer alle Daten. Ihr Reiter **Datenzugriff** zeigt „Administratoren sehen alle Daten.“ und hat keine Bedienelemente.

Erhält eine begrenzte Person die Rolle Administrator, bleibt ihr gespeicherter Zugriff erhalten und hat keine Wirkung. Wird ihr die Rolle später entzogen, gilt der gespeicherte Zugriff wieder.

## Den Zugriff einer Person festlegen

Der Reiter **Datenzugriff** des Benutzerfensters enthält:

- **Alle Daten** und **Begrenzt auf**.
- Unter **Begrenzt auf** die Knoten, jeder mit seinem Typ, einer Auswahl **Lesen** oder **Bearbeiten** und einer Schaltfläche zum Entfernen.
- **Hinzufügen**, das eine Auswahl in drei Abschnitten öffnet: **Unternehmen**, **Kostenstellen** (Gruppen und Kostenstellen als Baum) und **Alles**. Ohne Kostenstellen im Arbeitsbereich bietet die Auswahl Unternehmen und **Alles** an.
- **Eigene Kostenstellen hinzufügen (3)**, wenn die Person Budgetverantwortliche von Kostenstellen ist. Die Schaltfläche fügt diese Kostenstellen mit Bearbeiten hinzu.
- Zwei Hinweise: „Diese Person sieht außerdem immer, wo sie benannt ist.“ und „Gilt für Budget und Verträge.“
- Die Vorschau, zum Beispiel „Mit diesem Zugriff: 312 Budgetzeilen, davon 280 bearbeitbar; 45 Verträge.“
- Wer den Zugriff zuletzt geändert hat, und wann.

Die Vorschau folgt jeder Änderung, vor dem Speichern. Sie misst die Knoten, nicht die Rollen: **bearbeitbar** zählt die mit Bearbeiten geöffneten Zeilen, auch wenn die Rollen der Person das Bearbeiten nicht erlauben.

Die Rückkehr zu **Alle Daten** verlangt eine Bestätigung, zum Beispiel „Marta Ruiz sieht alle Budget- und Vertragsdaten.“

Ein einziges **Speichern** schreibt das ganze Fenster: den Identitätsreiter, dann den Zugriff. Wird etwas abgelehnt, erscheint die Meldung auf seinem Reiter, und das Fenster bleibt offen.

## Die Seite Datenzugriff

**Administration > Datenzugriff** listet alle begrenzten Personen auf, auch die ohne Knoten:

| Spalte | Inhalt |
|---|---|
| **Person** | Der Name. Klicken Sie darauf, um das Benutzerfenster auf dem Reiter **Datenzugriff** zu öffnen |
| **Rollen** | Die Rollen der Person |
| **Knoten** | Jeder Knoten mit seinem Zugriff, oder **Keine** |
| **Letzte Änderung** | Wer den Zugriff zuletzt geändert hat, und wann |

- **Namen suchen** filtert nach Namen.
- **Wer hat Zugriff auf…** filtert nach einem Unternehmen oder einer Kostenstelle: Die Liste behält die Personen, deren Knoten es abdecken.
- Über der Liste zwei Zähler: die begrenzten Personen und die Budgetzeilen ohne Unternehmen, mit einem Link zu diesen Zeilen.

Personen mit **Alle Daten** erscheinen hier nicht.

Unter **Administration > Benutzer** erscheint eine Spalte **Zugriff**, sobald jemand begrenzt ist. Sie zeigt **Alle Daten**, die Namen der Knoten der Person (**Alles** für diesen Knoten) oder **Keine** für eine begrenzte Person ohne Knoten.

## Der Reiter Zugriff von Unternehmen und Kostenstellen { #the-access-tab-of-companies-and-cost-centers }

Unternehmen und Kostenstellen haben einen Reiter **Zugriff**, für dieselben Personen, die den Datenzugriff verwalten.

Bei einem Unternehmen:

- **Sehen das ganze Unternehmen**: die Personen mit einem Knoten auf dem Unternehmen oder mit **Alles**. **Hinzufügen** gibt einer Person dieses Unternehmen mit Lesen oder Bearbeiten.
- **Sehen einen Teil davon**: die Personen, die einige seiner Zeilen über eine Gruppe oder eine Kostenstelle des Unternehmens erreichen, mit dem Knoten, der den Zugriff gibt. Zum Beispiel bei Alpha Spain: Paul, über Infrastruktur.

Bei einer Kostenstelle oder Gruppe:

- **Direkter Zugriff**: die Personen mit einem Knoten auf dieser Kostenstelle oder Gruppe. **Hinzufügen** gibt einer Person diesen Knoten mit Lesen oder Bearbeiten.
- **Geerbter Zugriff**: die Personen, die sie über eine übergeordnete Gruppe, das Unternehmen der Kostenstelle oder **Alles** erreichen. Die Spalte **Über** verlinkt auf den Knoten, der den Zugriff gibt. Ändern Sie einen geerbten Zugriff auf diesem Knoten.

Änderungen auf diesen Reitern werden sofort gespeichert. Hat die hinzugefügte Person alle Daten, weist eine Bestätigung darauf hin, dass ihr Zugriff auf diesen einen Knoten begrenzt wird. **Abbrechen** lässt ihn unverändert.

## Import und Export

**Importieren** und **Exportieren** unter **Administration > Datenzugriff** übertragen den Zugriff vieler Personen auf einmal, in einer CSV-Datei oder einer Excel-Arbeitsmappe (`.xlsx`). Siehe [CSV- und Excel-Dateien](csv-files.md). Eine Datei enthält eine Zeile pro Person und Knoten:

| Spalte | Inhalt |
|---|---|
| `email` | Die E-Mail-Adresse der Person |
| `type` | `company`, `cost_center` oder `all` |
| `node` | Ein Unternehmen mit seinem Namen, eine Kostenstelle oder Gruppe mit ihrem Code. Leer bei `all` |
| `access` | `read` oder `edit` |

Zum Beispiel:

```text
email;type;node;access
marta.ruiz@example.com;company;Alpha Spain;edit
paul.martin@example.com;cost_center;INF;read
claire.dubois@example.com;all;;read
```

- Eine Person in der Datei erhält genau die für sie aufgeführten Knoten, mit **Begrenzt auf**. Eine Person, die nicht in der Datei steht, bleibt unverändert.
- Ein Import begrenzt immer. Um jemandem wieder alle Daten zu geben, verwenden Sie das Benutzerfenster.
- Die Prüfung kommt zuerst und schreibt nichts. Sie meldet jede abgelehnte Zeile: unbekannte Person, unbekanntes Unternehmen oder unbekannte Kostenstelle, ungültiger Typ oder Zugriff, ein Knoten zweimal für dieselbe Person, ein Administrator, Ihr eigenes Konto. Eine Datei mit einem Fehler lädt nichts.
- Der Export schreibt dasselbe Format, für die begrenzten Personen. Eine begrenzte Person ohne Knoten hat keine Zeile, daher lässt ein erneuter Import der Datei sie unverändert.

Trennzeichen, Kodierung und die zwei Importschritte sind die aller CSV-Dateien: siehe [CSV- und Excel-Dateien](csv-files.md).

## Audit-Protokoll { #audit-log }

Jede Änderung des Zugriffs einer Person wird im [Audit-Protokoll](admin.md#audit-protokoll) in der Tabelle **Datenzugriff** erfasst. Der Eintrag nennt die Person und zeigt Modus, Knoten und deren Zugriff vorher und nachher. Seine Quelle ist **Bildschirm** oder **Import**. Ein Speichern ohne Änderung wird nicht erfasst.

## Den Assistenten fragen

[Plaid](ai-assistant.md#tool-calls) liest diese Seite und den Reiter Zugriff der Unternehmen für einen Benutzeradministrator mit Zugriff auf alle Daten. Fragen Sie zum Beispiel: „Wer ist auf Alpha Spain begrenzt?“, „Welche begrenzten Personen haben keinen Knoten?“ oder „Was sieht Marta Ruiz?“ Änderungen am Zugriff einer Person bleiben auf den hier beschriebenen Seiten.

## Was eine begrenzte Person sieht { #what-a-limited-person-sees }

Für eine begrenzte Person enthalten Budget und Verträge nur, was ihr Zugriff abdeckt.

**Listen, Summen und Berichte** zählen nur die sichtbaren Zeilen. Eine Zeile ist vollständig oder fehlt. Es gibt keine Gruppensumme.

**Schreibgeschützt.** Eine mit Lesen sichtbare Zeile oder ein solcher Vertrag zeigt oben „Schreibgeschützt in Ihrem Zugriff“, ohne Bearbeitungsbefehle.

**Links zu verborgenen Elementen.**

- Eine verborgene Zeile erscheint nur mit ihrer Referenz, etwa `BL-12`, ohne Link.
- Ein verborgener Vertrag erscheint als „Vertrag außerhalb Ihres Zugriffs“, ohne Link.
- Linklisten (die Zeilen eines Vertrags, einer Anwendung, eines Servers, einer Technologie, eines Projekts oder eines Antrags) zeigen die sichtbaren Links und dann eine Anzahl wie „und 3 Zeilen außerhalb Ihres Zugriffs“. Kein Name, kein Betrag.
- Der Vertrag einer sichtbaren Zeile öffnet sich schreibgeschützt. Seine Anhänge und Dokumentlinks bleiben geschlossen, mit einer Anzahl wie „2 Anhänge, nur für Personen sichtbar, die diesen Vertrag sehen“.
- Suche, Plaid, MCP und Exporte zeigen keine Spur eines verborgenen Elements.

Diese Anzahlen erscheinen für Personen, die das Budget lesen dürfen, diese Zeilen aber nicht. Eine Person ohne Budgetrecht sieht in den Bereichen von Anwendungen, Servern und Projekten keine Budgetzeilen und keine Anzahl.

**Die Zahlen eines sichtbaren Elements** beziehen sich auf alle seine Daten. Die Deckung eines Vertrags zählt alle verknüpften Zeilen, auch die verborgenen, damit sein Verantwortlicher die tatsächliche Deckung sieht. Siehe [Verträge](contracts.md#verpflichtung-und-deckung).

**Ein Element mit verborgenen Links zu löschen** (eine Anwendung, einen Server, eine Technologie, ein Projekt, einen Antrag) wird abgelehnt, zum Beispiel „Diese Anwendung ist mit 3 Zeilen außerhalb Ihres Zugriffs verknüpft.“ Eine Person, die diese Zeilen sieht, kann es löschen.

**Aufgaben** einer Zeile oder eines Vertrags folgen ihm: Die Person sieht sie, wenn sie die Zeile oder den Vertrag sieht oder wenn sie auf der Aufgabe benannt ist.

**Die Budgetdatei** folgt für eine Person, deren Rolle sie erlaubt, Zeile für Zeile denselben Regeln. Siehe [Ein Budget aus einer Tabellenkalkulation laden](budget-file.md#limited-data-access).

**Dimensionen mit offenen Werten.** Bei einer Dimension mit **Offene Werte** fügt jede Person, die eine Zeile bearbeiten kann, einen Wert über die Zeile oder die Budgetdatei hinzu. Bei den anderen Dimensionen werden Werte auf der Seite Analysedimensionen angelegt, von Personen mit allen Daten. Siehe [Analysedimensionen](analytics.md#open-values).

**Leistungsverrechnung.** Die Leistungsverrechnung pro Unternehmen öffnet sich für die Unternehmen der Unternehmensknoten der Person (alle mit **Alles**). Sie zeigt den diesen Unternehmen verrechneten Anteil, Zeile für Zeile: Referenz, Bezeichnung, zahlendes Unternehmen, Methode, Prozentsatz, Betrag und die Abteilungen, wenn die Zuordnung bis zu ihnen reicht. Eine Zeile, die die Person sonst nicht sieht, zeigt ihre Referenz und Bezeichnung ohne Link. Die Zahlen der anderen Unternehmen und die Gruppensummen entfallen. Die globale Leistungsverrechnung zeigt die sichtbaren Zeilen. Ein Kostenstellenknoten öffnet nicht die Leistungsverrechnung eines Unternehmens. Siehe [Berichte](reports.md#leistungsverrechnung-pro-unternehmen).

### Personen mit allen Daten vorbehalten

Auch wenn ihre Rollen es erlauben, kann eine begrenzte Person nicht:

- die Einstellungen des Arbeitsbereichs ändern: Einfrieren und Freigeben, die Standardregel der Zuordnung, Budgetspalten, Währungen, die jährliche Kopie der Stammdaten, die Mitarbeiterzahlen und Kennzahlen von Unternehmen und Abteilungen;
- Vorgänge auf vielen Zeilen ausführen: Budgetspalten kopieren und zurücksetzen, Zuordnungen kopieren, Massenlöschung;
- eine Zeile oder einen Vertrag löschen;
- Personen verwalten: Benutzer, Rollen, Datenzugriff, Audit-Protokoll;
- Organisationsdaten bearbeiten: Unternehmen, Abteilungen, Kostenstellen, Konten und Kontenpläne, Geschäftsprozesse, die Dimensionen selbst und die Werte von Dimensionen ohne offene Werte;
- einen Lieferanten oder einen gemeinsamen Kontakt bearbeiten oder löschen (sie kann welche anlegen, wie ihre Rolle es erlaubt);
- Lieferanten, Kontakte, Verträge oder Aufgaben importieren;
- die Bildschirme der KI-Agenten verwenden;
- die Vertragseinstellungen, das Branding und die geplanten Aufgaben ändern.

Die Prüfungen, die zu diesen Vorgängen gehören (die Vorschauen der Auswirkungen, die Prüfung vor einer Löschung), sind ebenfalls vorbehalten. Diese Befehle sind ausgeblendet. Eine Anfrage, die den Server dennoch erreicht, wird mit „Diese Aktion ist Personen mit Zugriff auf alle Daten vorbehalten.“ abgelehnt. Eine Person mit einer Rolle für die Budgetadministration behält die Budgetdatei innerhalb ihres Zugriffs.

## Wenn der Datenzugriff nicht verfügbar ist

Die Begrenzung des Datenzugriffs erfordert einen einmaligen Schritt auf dem Datenbankserver. Solange er nicht erledigt ist, ist **Begrenzt auf** im Benutzerfenster ausgegraut, mit „Die Begrenzung des Datenzugriffs erfordert einen einmaligen Schritt auf der Datenbank, den die Person ausführt, die KANAP betreibt.“ und einem Link zu dieser Seite. **Administration > Datenzugriff** zeigt dieselbe Meldung mit dem, was fehlt.

On-Premise steht der Schritt im Installationsleitfaden: [Datenzugriff nach Bereich](on-premise/installation.md#optional-data-scoped-access).

Wird der Schritt später rückgängig gemacht, zum Beispiel nach der Wiederherstellung einer Datenbank auf einem anderen Server, werden begrenzte Personen mit „Der Datenzugriff ist vorübergehend nicht verfügbar. Wenden Sie sich an die Person, die KANAP betreibt.“ abgewiesen. Personen mit allen Daten arbeiten weiter. Den Schritt erneut ausführen und die API neu starten bringt die begrenzten Personen zurück. Siehe [Sicherung und Wiederherstellung](on-premise/operations.md#wiederherstellen).
