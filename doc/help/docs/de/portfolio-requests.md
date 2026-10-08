# Portfolio-Anfragen

Portfolio-Anfragen sind die Erfassungsebene für vorgeschlagene Arbeit. Eine Anfrage ermöglicht es Ihnen, den geschäftlichen Bedarf zu erfassen, die Machbarkeit zu bewerten, die Priorität zu bewerten, unterstützendes Wissen zu sammeln und zu entscheiden, ob die Initiative als Projekt vorangetrieben werden soll. In der Praxis ist dies der Ort, an dem Ideen zu gesteuerter Arbeit werden, anstatt Flurfolklore zu bleiben.

## Wo Sie es finden

- Arbeitsbereich: **Portfolio**
- Pfad: **Portfolio > Anfragen**

### Berechtigungen

| Berechtigung | Was sie erlaubt |
| --- | --- |
| `portfolio_requests:reader` | Die Anfragenliste öffnen und Anfragen-Arbeitsbereiche anzeigen |
| `portfolio_requests:member` | Die im Arbeitsbereich eingebetteten verwalteten Anfragendokumente bearbeiten, auch ohne breitere Anfragen-Verwaltungsrechte |
| `portfolio_requests:manager` | Anfragen erstellen, Anfragendaten aktualisieren, Team und Beziehungen pflegen, Kommentare und Entscheidungen hinzufügen, Status ändern, Analyseempfehlungen einreichen und Bewertung bearbeiten |
| `portfolio_requests:admin` | Anfragen löschen und CSV-Import/-Export verwenden |

Der Reiter **Wissensdatenbank** folgt den Wissens-Berechtigungen für Erstellungs- und Verknüpfungsaktionen. Ein Benutzer kann erlaubt sein, an Anfrageninhalten zu arbeiten, ohne erlaubt zu sein, eigenständige Wissensdokumente zu erstellen oder erneut zu verknüpfen.

## Arbeiten mit der Liste

Die Liste ist für Triage und nicht für Archivbrowsing ausgelegt. Standardmäßig sortiert sie Anfragen nach Priorität, sodass die dringendsten oder strategisch wichtigsten Arbeiten zuerst aufsteigen.

### Bereichsfilter

Verwenden Sie die Bereichsauswahl über dem Raster, um zu steuern, wessen Pipeline Sie sich ansehen:

- **Meine Anfragen** zeigt Anfragen, in denen Sie ausdrücklich beteiligt sind, wie Anforderer, Sponsor, Leiter oder Mitwirkender.
- **Anfragen meines Teams** erweitert diese Ansicht auf Anfragen, die Mitglieder Ihres Portfolio-Teams einbeziehen. Diese Option ist nicht verfügbar, wenn Sie keinem Team zugewiesen sind.
- **Alle Anfragen** entfernt den Beteiligungsfilter und zeigt die vollständige Anfragen-Pipeline an.

Die Liste öffnet sich mit **Alle Anfragen** und speichert Ihre Bereichswahl. Wenn Sie eine Anfrage aus der Liste öffnen und später zurückkommen, behält KANAP den Listenkontext bei, sodass Sie nicht jedes Mal Ihren Filterstapel neu aufbauen müssen.

### Standardspalten

Das Standardraster hebt die Felder hervor, die während der Erfassung und Überprüfung wichtig sind:

| Spalte | Was sie zeigt |
|--------|---------------|
| **#** | Referenznummer (z. B. REQ-42). Klicken zum Öffnen des Arbeitsbereichs |
| **Anfragenname** | Der Anfragenname |
| **Priorität** | Berechneter Prioritätswert |
| **Status** | Aktueller Erfassungszustand |
| **Quelle** | Portfolio-Quellklassifizierung |
| **Kategorie** | Portfolio-Kategorie |
| **Stream** | Portfolio-Stream |
| **Unternehmen** | Unternehmensklassifizierung |
| **Anforderer** | Person, die die Anfrage gestellt hat |
| **Zieldatum** | Angefordertes Ziel-Lieferdatum |
| **Erstellt** | Wann die Anfrage erstellt wurde |

**Zusätzliche Spalten** (standardmäßig ausgeblendet):

- **Zuletzt geändert**: Wann die Anfrage zuletzt aktualisiert wurde

### Filterverhalten

- Die globale Suche funktioniert über Anfrageninhalte und sichtbare Geschäftsmetadaten hinweg.
- Spaltenfilter sind für die wichtigsten Klassifizierungs- und Verantwortlichkeitsfelder verfügbar.
- Anfragen mit Status **Konvertiert** sind standardmäßig ausgeblendet, sodass die Liste auf aktive Erfassung fokussiert bleibt. Wenn Sie historische Erfassungsentscheidungen überprüfen müssen, schließen Sie **Konvertiert** in den Status-Filter ein.

### Listenaktionen

- **Neue Anfrage** ist für Anfragenmanager verfügbar.
- **CSV importieren** und **CSV exportieren** sind für Anfragenadministratoren verfügbar.

## Der Anfragen-Arbeitsbereich

Der Arbeitsbereich verwendet ein Split-Modell:

- Der Hauptbereich enthält die operativen Reiter: **Zusammenfassung**, **Analyse**, **Bewertung**, **Verknüpfungen** und **Wissensdatenbank**.
- Eine persistente **Eigenschaftsleiste** am rechten Rand enthält stabile Anfragen-Metadaten, Teamzuweisung und resultierende Projekte. Öffnen oder schließen Sie sie mit der vertikalen Registerkarte am rechten Rand.

Dies ist wichtig, weil nicht alles auf die gleiche Weise gespeichert wird:

- Änderungen in der **Eigenschaftsleiste** werden sofort angewendet.
- Änderungen in **Zusammenfassung**, **Analyse** und **Bewertung** sind Arbeitsbereich-Bearbeitungen und verwenden **Speichern** / **Zurücksetzen**.
- Die verwalteten Dokumente **Zweck** und **Risiken & Mitigationen** verwenden ebenfalls den Arbeitsbereich-Speicher-Fluss.

Wenn Sie eine neue Anfrage erstellen, beginnt KANAP mit **Zusammenfassung**. Die anderen Reiter werden nützlich, nachdem die Anfrage als echter Datensatz statt als sehr aufrichtige Idee existiert.

Die Arbeitsbereichs-Kopfzeile gibt Ihnen operativen Kontext, ohne die Seite zu verlassen:

- eine kopierbare Anfragenreferenz wie `REQ-42`
- eine Metadatenleiste mit **Status**, **Bewertung**, **Anforderer**, **IT-Verantwortlicher**, **Ziel-Lieferdatum** und (falls zutreffend) der **Quell-Aufgabe**, aus der die Anfrage erstellt wurde
- **Link senden** zum Teilen
- **In Projekt umwandeln**, wenn die Anfrage **Genehmigt** oder **Konvertiert** ist
- **Löschen** für Administratoren (wenn die Anfrage noch nicht konvertiert ist)
- Vorherige/Nächste-Navigation basierend auf dem genauen Listenkontext, aus dem Sie kamen

### Eigenschaftsleiste

Behandeln Sie die Leiste als das strukturelle Rückgrat der Anfrage. Sie enthält drei Gruppen.

#### Kerneigenschaften

- Anfragenname
- Status
- Quelle, Kategorie, Stream
- Anforderer
- Unternehmen, Abteilung
- Ziel-Lieferdatum

Diese Felder prägen, wie die Anfrage geleitet, gefiltert und an anderer Stelle im Arbeitsbereich überprüft wird. Zum Beispiel:

- Das Ändern des **Status** beeinflusst, welche Entscheidungen folgen können und ob die Konvertierung verfügbar ist
- Das Ändern von **Kategorie** oder **Stream** ändert den analytischen Kontext für Machbarkeit und Bewertung
- Das Ändern von **Unternehmen** oder **Anforderer** ändert die Berichts- und Verantwortlichkeitssichtbarkeit über das Portfolio hinweg

#### Team

Die Teamzuweisung benennt Verantwortlichkeit, anstatt nur eine Kontaktliste zu führen:

- **Fachbereichssponsor**
- **Fachbereichsleiter**
- **IT-Sponsor**
- **IT-Leiter**
- **Fachbereichs-Mitwirkende**
- **IT-Mitwirkende**

Diese Zuweisungen treiben die geteilte Sichtbarkeit an und machen klar, wer voraussichtlich die Anfrage sponsert, gestaltet und liefert. Die Zusammenfassung verwendet diese Daten, um zu zeigen, ob die Anfrage genug benannte Verantwortlichkeit hat, um sinnvoll voranzukommen.

#### Resultierende Projekte

Eine schreibgeschützte Liste der Projekte, die nach der Konvertierung aus dieser Anfrage erstellt wurden. Klicken Sie auf einen Eintrag, um zum Projekt-Arbeitsbereich zu navigieren.

Für Abhängigkeiten und andere Beziehungstypen siehe den Reiter **Verknüpfungen**.

Ältere Lesezeichen können noch auf `overview`, `team` oder `relations` verweisen. Der aktuelle Arbeitsbereich platziert diesen Inhalt unter **Zusammenfassung**, der Eigenschaftsleiste und dem Reiter **Verknüpfungen**.

## Zusammenfassung

**Zusammenfassung** ist das Anfragen-Cockpit. Es ist kein einfacher Übersichtsreiter; es ist der Ort, an dem KANAP den Zustand der Anfrage in einen operativen Snapshot komprimiert.

### Zweck als verwaltetes Dokument

Der Bereich **Zweck** ist ein verwaltetes Markdown-Dokument, das direkt in die Anfrage eingebettet ist. Es ist mehr als ein langes Beschreibungsfeld:

- es gibt Prüfern eine stabile Absichtserklärung
- es ist während der Konvertierung von Anfrage zu Projekt verfügbar
- es kann von Benutzern mit `portfolio_requests:member` bearbeitet werden, auch wenn sie den Rest der Anfrage nicht verwalten
- es unterstützt **DOCX-Import**, sodass Sie vorhandene Word-Dokumente direkt einbringen können, und **Export**, um den aktuellen Inhalt als PDF, DOCX oder ODT herunterzuladen

Diese Aufteilung ist absichtlich. Sie erlaubt fachkundigen Mitwirkenden, die Anfragen-Erzählung zu verbessern, ohne die volle Kontrolle über Status, Bewertung und Portfolio-Struktur zu öffnen.

### Aktivität

Unter Zweck enthält der Reiter Zusammenfassung den Anfragenaktivitäts-Stream:

- **Kommentare** für Diskussion, kontextbezogene Notizen und formale Entscheidungen
- **Historie** für das Audit-Protokoll von Feld- und Statusänderungen

Dies platziert die neueste Aktivität direkt vor Prüfern, ohne dass sie zu einem separaten Reiter navigieren müssen.

#### Kommentare

Kommentare unterstützen normale Diskussionen, aber sie unterstützen auch **formale Entscheidungen**. Eine formale Entscheidung kann erfassen:

- den Sitzungs- oder Entscheidungskontext
- das Entscheidungsergebnis
- die Begründung
- eine optionale Statusänderung in derselben Aktion

Diese Kombination hält Governance nachvollziehbar: Die Aufzeichnung des *Warum* etwas geändert wurde, bleibt mit der Änderung verbunden, anstatt später aus Erinnerung und Optimismus rekonstruiert zu werden.

Kommentare unterstützen Markdown und Inline-Bilder, was nützlich für Designnotizen, Beweise, Screenshots und Review-Material ist.

#### Historie

Die Historie ist die Audit-Ansicht. Verwenden Sie sie, wenn Sie Fragen beantworten müssen wie:

- wer den Status geändert hat
- wann sich Teamzuweisungen geändert haben
- ob eine Bewertungs- oder Analyseänderung vor oder nach einer Entscheidung stattgefunden hat

Die Liste endet mit dem Erstellungseintrag — wer die Anfrage erstellt hat und wann — unterhalb der erfassten Änderungen, einschließlich Änderungen an den Dokumenten Zweck und Risiken.

Wenn Sie Erzählung benötigen, verwenden Sie Kommentare. Wenn Sie Beweise benötigen, verwenden Sie die Historie.

## Analyse

**Analyse** ist der Ort, an dem die Anfrage von „klingt vernünftig" zu „gut genug verstanden, um zu entscheiden" übergeht.

Sie bringt vier verschiedene Elemente zusammen:

- betroffene Geschäftsprozesse
- strukturierte Machbarkeitsprüfung
- verwaltete **Risiken & Mitigationen**
- die formale **Analyseempfehlung**

### Betroffene Geschäftsprozesse

Verknüpfen Sie die von der Anfrage berührten Geschäftsprozesse. Dies ändert die Bedeutung der Anfrage in Portfolio-Begriffen: Eine Anfrage, die zentrale operative Prozesse betrifft, sollte nicht auf die gleiche Weise bewertet werden wie eine lokale Komfortverbesserung.

### Machbarkeitsprüfung

Die Machbarkeitsprüfung ist eine strukturierte Bewertung über sieben Dimensionen:

- Technische Machbarkeit
- Integrationskompatibilität
- Infrastrukturbedarf
- Sicherheit & Compliance
- Ressourcen-Skills
- Lieferbeschränkungen
- Change-Management

Jede Dimension kann mit einer Bedenkenstufe (**Nicht bewertet**, **Keine Bedenken**, **Geringe Bedenken**, **Schwerwiegende Bedenken**, **Blocker**) und unterstützenden Notizen bewertet werden.

Verwenden Sie diesen Bereich, um Lieferreibung früh aufzudecken:

- nicht jede Anfrage scheitert, weil die Idee schlecht ist
- viele scheitern, weil Integrations-, Infrastruktur-, Sicherheits-, Timing- oder Change-Management-Beschränkungen ignoriert wurden, bis es zu spät war

Der Reiter Zusammenfassung zeigt die stärkste Bedenkenstufe aus dieser Prüfung an, sodass größere Probleme sichtbar bleiben, auch wenn niemand die Analyse öffnet.

### Risiken & Mitigationen

**Risiken & Mitigationen** ist ein weiteres verwaltetes Markdown-Dokument. Verwenden Sie es, um Restrisiko, Mitigationsmaßnahmen und Verantwortlichkeit zu dokumentieren. Wie der Zweck kann es von Benutzern mit `portfolio_requests:member` bearbeitet werden und unterstützt **DOCX-Import** zum Einbringen vorhandener Word-Dokumente sowie Export.

Dies ist nützlich, wenn die Personen, die am besten geeignet sind, die Risiken zu beschreiben, nicht dieselben Personen sind, die den Anfragen-Status oder die Portfolio-Struktur ändern sollten.

### Analyseempfehlung

Der Empfehlungsfluss veröffentlicht eine formale Entscheidung in der Aktivität mit dem festen Kontext **Analyseempfehlung**. Sie kann gleichzeitig auch den Anfrage-Status ändern.

Das bedeutet, die Analyse ist kein isolierter Notizen-Bereich. Sie ist Teil der Governance-Spur:

- Prüfer können die neueste Empfehlung direkt in der Analyse sehen
- dieselbe Empfehlung erscheint in der Aktivität als Entscheidungsdatensatz
- optionale Statusänderungen bleiben mit der Empfehlung verbunden, die sie gerechtfertigt hat
- eine Verknüpfung **In Aktivität anzeigen** springt direkt zur Empfehlung im Zusammenfassungs-Aktivitäts-Feed

Ältere Anfragen können auch einen Bereich **Vorherige Analyse (Legacy)** anzeigen. Dieser Inhalt wird zur Kontinuität beibehalten, aber das aktuelle Anfrage-Modell stützt sich auf Machbarkeitsprüfung, verwaltete Risiken und formale Empfehlungen.

## Bewertung

**Bewertung** evaluiert die Anfrage gegen das für Ihren Mandanten konfigurierte Portfolio-Bewertungsmodell.

In der Praxis:

- jedes aktive Kriterium trägt zur berechneten Priorität bei
- der resultierende Wert speist den Portfolio-Vergleich und die Listenordnung
- eine Überschreibung kann verwendet werden, wenn der berechnete Wert mathematisch korrekt, aber operativ falsch ist

Wenn die Prioritäts-Überschreibung verwendet wird, sollte sie als Ausnahme behandelt werden, nicht als Lebensstil.

Wo durch Portfolio-Einstellungen aktiviert, können verbindliche Bypass-Regeln die Top-Priorität für qualifizierende Anfragen erzwingen. Dies wird typischerweise für Arbeit verwendet, die nicht sinnvoll mit der diskretionären Nachfrage konkurrieren kann.

Sobald eine Anfrage **Konvertiert** ist, wird die Bewertung schreibgeschützt. Zu diesem Zeitpunkt hat die Anfrage ihre Aufgabe als Erfassungs- und Priorisierungsdatensatz bereits erledigt.

## Verknüpfungen

Der Reiter **Verknüpfungen** bringt die Verknüpfungen zusammen, die erklären, wie sich die Anfrage mit dem Rest des Portfolios verbindet. Das Reiter-Badge zeigt die Anzahl der verwandten Elemente.

### Abhängigkeiten

Abhängigkeiten identifizieren Arbeit, die existieren, abgeschlossen sein oder ausgerichtet bleiben muss, bevor diese Anfrage erfolgreich sein kann. Verwenden Sie das Suchfeld, um ein verwandtes Element zu finden und hinzuzufügen; entfernen Sie Verknüpfungen, die Sie nicht mehr möchten, mit dem Lösch-Symbol des Chips.

Eine Anfrage mit schwachen Abhängigkeitsdaten kann harmlos aussehen, bis sie mit vorhandener Arbeit kollidiert.

### Andere Beziehungen

Unter Abhängigkeiten ermöglicht der Reiter Verknüpfungen Ihnen auch, andere Portfolio-Verknüpfungen zu pflegen — zum Beispiel verwandte Anfragen, verwandte Projekte oder andere verbundene geschäftliche und technische Objekte. Jede Beziehung wird automatisch gespeichert.

Für die Projekte, die nach der Konvertierung aus dieser Anfrage erstellt wurden, siehe die Gruppe **Resultierende Projekte** in der Eigenschaftsleiste.

## Wissensdatenbank

Der Reiter **Wissensdatenbank** verbindet die Anfrage mit eigenständigen Wissensdokumenten. Das Reiter-Badge zeigt die Anzahl der verwandten Wissensdokumente.

Der Reiter unterscheidet zwischen zwei Arten von Wissen:

- **Verknüpfte Dokumente** sind direkt an die Anfrage angehängt.
- **Verwandte Dokumente** werden durch den breiteren Kontext der Anfrage entdeckt, wie Abhängigkeiten, verwandte Anfragen, resultierende Projekte und andere verknüpfte Objekte.

Diese Unterscheidung ist wichtig:

- direkte Dokumente sind Teil des expliziten Dokumentationssatzes der Anfrage
- verwandte Dokumente fügen Kontext hinzu, ohne zu behaupten, dass die Anfrage sie besitzt

### Was Sie tun können

Mit ausreichenden Wissens-Berechtigungen können Sie:

- ein neues leeres Wissensdokument erstellen, das bereits mit der Anfrage verknüpft ist
- ein verknüpftes Dokument aus einer Vorlage erstellen
- ein vorhandenes Wissensdokument verknüpfen
- ein direkt verknüpftes Dokument entkoppeln
- jedes verknüpfte oder verwandte Dokument im Wissens-Arbeitsbereich öffnen

Ohne diese Berechtigungen funktioniert der Reiter weiterhin als Referenzansicht, solange Sie das zugrunde liegende Wissen sehen dürfen.

### Verwaltete Dokumente vs. Wissensdokumente

Die verwalteten Dokumente **Zweck** und **Risiken & Mitigationen** sind Teil der Anfrage selbst. Sie sind nicht dasselbe wie Wissensdokumente.

Verwenden Sie verwaltete Dokumente für die zentrale Anfragen-Erzählung, die immer mit der Anfrage reisen sollte. Verwenden Sie Wissensdatenbank für eigenständige Dokumente, die möglicherweise ihren eigenen Lebenszyklus, Beziehungen, Exporte, Vorlagen und Wiederverwendung über eine einzelne Anfrage hinaus benötigen.

## Eine Anfrage in ein Projekt umwandeln

Sobald eine Anfrage **Genehmigt** erreicht, bietet der Arbeitsbereich **In Projekt umwandeln** in der Kopfzeile an.

Der Konvertierungsfluss ermöglicht es Ihnen:

- den Projektnamen zu bestätigen oder anzupassen
- geplante Start- und Enddaten festzulegen
- den aktuellen Zweck-Text zu überprüfen
- den geschätzten IT- und Fachbereichs-Aufwand vorzutragen, der aus den Anfragen-Bewertungseingaben abgeleitet wurde

Nach der Konvertierung:

- wird die Anfrage zu einem dauerhaften Erfassungs- und Entscheidungsdatensatz
- erscheint das resultierende Projekt in der Gruppe **Resultierende Projekte** der Anfrage
- wird die Bewertung an der Anfrage eingefroren
- kann die Anfrage weiterhin für Audit, Kontext und Wissens-Nachverfolgung geöffnet werden

Mit anderen Worten, die Konvertierung löscht die Anfrage nicht. Sie befördert sie.

## CSV-Import und -Export

CSV-Import und -Export sind für `portfolio_requests:admin` verfügbar.

Verwenden Sie den Export, wenn Sie Portfolio-Berichterstattung oder Offline-Anreicherung benötigen. Verwenden Sie den Import, wenn Sie Anfragen in großen Mengen erstellen oder aktualisieren müssen. Da der Import Erfassungsdatensätze in großem Maßstab ändern kann, ist er absichtlich Administratoren vorbehalten.

## Tipps

- **Verwenden Sie DOCX-Import für vorhandenen Inhalt**: Wenn Sie bereits eine Zweck-Erklärung oder ein Risikoregister in einem Word-Dokument haben, verwenden Sie die Schaltfläche **Importieren** im Editor Zweck oder Risiken & Mitigationen, anstatt zu kopieren und einzufügen. Der Import konvertiert das Dokument in Markdown und warnt Sie, wenn Inhalte nicht übertragen werden konnten.
- **Bereichsfilter bleiben**: Die Liste öffnet sich mit **Alle Anfragen**. KANAP merkt sich Ihre letzte Bereichswahl, sodass Sie sie nicht in jeder Sitzung neu auswählen müssen.
- **Konvertierte Anfragen sind standardmäßig ausgeblendet**: Wenn Sie nach einer Anfrage suchen, die bereits in ein Projekt konvertiert wurde, fügen Sie **Konvertiert** zum Status-Filter in der Liste hinzu.
- **Member-Berechtigung für Mitwirkende**: Geben Sie Fachexperten `portfolio_requests:member`, damit sie Zweck und Risiken & Mitigationen bearbeiten können, ohne Status, Bewertung oder Portfolio-Struktur ändern zu können.
- **Von Aufgabe zu Anfrage**: Wenn eine Aufgabe eine größere Initiative offenbart, verwenden Sie **In Anfrage umwandeln** aus dem Aufgaben-Arbeitsbereich. Die neue Anfrage erbt den Titel, die Beschreibung (als Zweck), die Klassifizierung und die Anhänge der Aufgabe und zeigt die **Quell-Aufgabe** in ihrer Kopfzeile.
