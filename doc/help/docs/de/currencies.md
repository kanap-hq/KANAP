# Währungseinstellungen

Die Seite Währungseinstellungen (**Budgetverwaltung > Administration > Währungen**) ist der Ort, an dem Sie konfigurieren, wie Währungen in Ihrem Arbeitsbereich gespeichert, angezeigt und umgerechnet werden. Sie steuert die mandantenweite Berichtswährung, Standardwährungen für neue Positionen und optionale Einschränkungen, welche Währungen verwendet werden können.

Für Hintergrundinformationen zu Währungskonzepten und Umrechnungsmechanismen siehe den Leitfaden zur Währungsverwaltung.

## Wer sie sehen und ändern kann

Währungen sind eine Budgeteinstellung. Die Seite steht bei den anderen Budgeteinstellungen in der [Budgetadministration](budget-operations.md).

- **Nur Lesen**: alle mit Leserechten auf die Budgetadministration, OPEX oder CAPEX. Die Felder lassen sich nicht bearbeiten, die Schaltflächen **Speichern**, **Zurücksetzen** und **Wechselkurssynchronisierung erzwingen** sind ausgeblendet, und ein Hinweis nennt, dass nur Budgetadministratoren die Seite ändern können. Die Wechselkurstabelle bleibt sichtbar.
- **Einstellungen ändern und die Wechselkurssynchronisierung starten**: Budgetadministration auf Administratorebene.

Das Recht **Einstellungen** der IT-Landschaft gibt keinen Zugriff auf Währungen. Es umfasst nur die Einstellungen der IT-Landschaft.

## Das Formular für Währungseinstellungen

### Berichtswährung
Die **mandantenweite Währung**, die für alle Berichte, Summen und Listenanzeigen verwendet wird. Wenn Sie diese Währung ändern:
  - Werden alle OPEX- und CAPEX-Jahresspalten in die neue Berichtswährung umgerechnet
  - Berechnen sich Summen in Berichten mit der neuen Basis neu
  - **Ihre gespeicherten Positionsdaten bleiben unverändert** -- nur Anzeige und Umrechnung sind betroffen

**Beispiel**: Wenn Sie von EUR auf USD wechseln, werden Ihre OPEX-Listensummen in USD angezeigt, aber die gespeicherte Währung jeder Position (EUR, GBP usw.) bleibt gleich.

**Tipp**: Wählen Sie eine Berichtswährung, die dem Finanzberichtsstandard Ihres Konzerns entspricht (z. B. EUR für europäische Hauptsitze, USD für US-basierte Gruppen).

### Standard-OPEX-Währung
Die Währung, die beim Erstellen einer neuen OPEX-Position (Ausgabenposition) **vorausgefüllt** wird. Dies schränkt nicht ein, welche Währungen Sie auswählen können -- es spart nur Zeit, indem ein sinnvoller Standard angeboten wird.

**Beispiel**: Wenn der Großteil Ihrer wiederkehrenden Ausgaben in EUR anfällt, setzen Sie dies auf EUR. Benutzer können weiterhin manuell GBP, USD oder jede andere zugelassene Währung auswählen.

### Standard-CAPEX-Währung
Die Währung, die beim Erstellen einer neuen CAPEX-Position **vorausgefüllt** wird. Funktioniert genauso wie die Standard-OPEX-Währung, aber für Investitionsausgaben.

**Tipp**: Wenn Ihre CAPEX überwiegend in einer anderen Währung als der täglichen OPEX beschafft wird (z. B. USD für Hardwarekäufe), setzen Sie hier eine andere Standardwährung.

### Zugelassene Währungen (optional)
Eine **kommagetrennte Liste** von ISO-Codes, die einschränkt, welche Währungen Benutzer beim Erstellen oder Bearbeiten von OPEX- und CAPEX-Positionen auswählen können.

  - **Leer (Standard)**: Benutzer können jeden gültigen 3-stelligen ISO-Währungscode auswählen
  - **Angegebene Liste** (z. B. `EUR, USD, GBP`): Nur diese Währungen erscheinen in Dropdowns
  - **Berichtswährung ist immer zugelassen**: Auch wenn nicht aufgeführt, ist die Berichtswährung immer verfügbar
  - **Standardwährungen sind immer zugelassen**: Standard-OPEX- und CAPEX-Währungen sind immer verfügbar

**Warum dies verwenden?**
Die Einschränkung zugelassener Währungen hilft, wenn:
  - Ihre FX-Datenquelle exotische Währungen nicht abdeckt
  - Sie Standardisierung über Teams hinweg durchsetzen möchten
  - Sie Fehler durch falsch eingegebene oder veraltete Codes verhindern müssen

**Tipp**: Lassen Sie dieses Feld leer, es sei denn, Sie haben einen bestimmten Grund zur Einschränkung. Wenn Sie einschränken, schließen Sie alle Währungen ein, die Ihre Teams aktiv verwenden (z. B. `EUR, USD, GBP, CHF, PLN`).

## Änderungen speichern

Klicken Sie auf **Speichern**, um Ihre Aktualisierungen anzuwenden. Das System wird:
  1. Alle Währungscodes validieren (müssen 3-stellige ISO-Codes sein)
  2. Ihre Mandanteneinstellungen aktualisieren
  3. Automatisch eine Hintergrund-FX-Kursaktualiserung für das aktuelle Jahr und alle Jahre mit Budgetdaten auslösen
  4. Eine Erfolgsmeldung anzeigen

Klicken Sie auf **Zurücksetzen**, um nicht gespeicherte Änderungen zu verwerfen und auf die zuletzt gespeicherten Werte zurückzukehren.

**Wichtig**: Die Änderung der Berichtswährung wirkt sich sofort darauf aus, wie Listen und Berichte Werte anzeigen. Planen Sie diese Änderung während eines Wartungsfensters, wenn Sie konsistente Berichtszeiträume benötigen.

## FX-Kurse erzwingen

Die Schaltfläche **FX-Kurse erzwingen** löst manuell eine Hintergrundaktualisierung der Wechselkurse für alle relevanten Geschäftsjahre aus (aktuelles Jahr plus alle Jahre mit OPEX- oder CAPEX-Daten).

**Wann verwenden**:
  - Nach dem Hinzufügen neuer zugelassener Währungen
  - Wenn Sie aktuelle Kassakurse für das laufende Jahr benötigen
  - Wenn Sie vermuten, dass Kurse veraltet oder fehlend sind
  - Vor der Erstellung von Berichten für Stakeholder

**Was passiert**:
  - Das System reiht einen Hintergrundjob zum Abrufen der FX-Kurse ein
  - Eine Erfolgsmeldung zeigt, welche Geschäftsjahre aktualisiert werden
  - Kurse aktualisieren sich innerhalb weniger Sekunden
  - Die FX-Kurs-Snapshot-Tabelle aktualisiert sich automatisch

**Automatische Aktualisierung**: Das System aktualisiert Kurse auch automatisch alle 30 Tage, wenn sich ein Benutzer anmeldet (für J-1, J, J+1). Die manuelle Synchronisation gibt Ihnen Kontrolle, wenn Sie sofortige Aktualisierungen benötigen.

**Tipp**: Wenn Sie eine neue Währung zu den zugelassenen Währungen hinzufügen, führen Sie sofort eine FX-Synchronisation durch, um die Kurse zu befüllen, bevor Benutzer Positionen in dieser Währung erstellen.

## FX-Kurs-Snapshot-Tabelle

Unterhalb des Einstellungsformulars zeigt die Tabelle **Neueste FX-Kurs-Snapshots** die aktuellsten erfassten Wechselkurse für jedes Geschäftsjahr.

**Spalten**:
  - **Währung**: Der 3-stellige ISO-Code
  - **Geschäftsjahr-Spalten**: Eine Spalte pro Jahr mit Daten (z. B. 2023, 2024, 2025)
  - **Kurswerte**: Wechselkurs zu Ihrer Berichtswährung (6 Dezimalstellen Präzision)
  - **Quellenbezeichnung**: Zeigt die Datenquelle für jedes Jahr:
      - **Jahresdurchschnitt**: Weltbank-Jahresdurchschnitt (historische Jahre)
      - **Quartalsdurchschnitt**: Weltbank-Quartalsdurchschnitt (falls verfügbar)
      - **Live-Kassakurs**: Aktueller Kassakurs von ExchangeRate-API (aktuelles Jahr)
      - **Forward-Schätzung**: Kurs des aktuellen Jahres wird für zukünftige Jahre wiederverwendet

**Beispiel**:
Wenn Ihre Berichtswährung EUR ist:

| Währung | 2024 (Jahresdurchschnitt) | 2025 (Live-Kassakurs) | 2026 (Forward-Schätzung) |
|---------|--------------------------|----------------------|--------------------------|
| USD     | 0,925820                 | 0,931200             | 0,931200                 |
| GBP     | 1,175300                 | 1,182000             | 1,182000                 |
| CHF     | 0,962100                 | 0,965500             | 0,965500                 |

**Die Tabelle lesen**:
  - Kurse zeigen, wie viele Einheiten Ihrer Berichtswährung einer Einheit der gelisteten Währung entsprechen
  - Zeigt ein Kurs `—`, sind keine Daten verfügbar (Fallback-Umrechnung von 1,00 wird verwendet)
  - Kurse werden zum Zeitpunkt der Synchronisation erfasst und bleiben bis zur nächsten Aktualisierung stabil

**Tipp**: Wenn Sie fehlende Kurse (`—`) sehen, prüfen Sie, ob der Währungscode gültig und allgemein veröffentlicht ist. Erwägen Sie, zugelassene Währungen einzuschränken, um exotische Codes ohne Daten zu vermeiden.

## CSV-Import und -Export

### Export
OPEX- und CAPEX-Exporte enthalten Positionsdaten und Jahresbeträge in der **eigenen Währung** jeder Position -- nicht in der Berichtswährung. Dies bewahrt die Originaldaten für den Reimport oder externe Analysen.

**Beispiel-CSV-Zeile** (OPEX):
```
Item Name;Company;Account;Currency;Y-1;Y;Y+1;Y+2
SaaS License;Acme UK;6200;GBP;10000;12000;12000;12000
```

### Import
Beim Import von OPEX- oder CAPEX-Positionen muss die Spalte `Currency` **Standard-3-stellige ISO-Codes** enthalten.

**Validierung**:
  - Wenn **zugelassene Währungen** konfiguriert sind, werden Importe mit nicht gelisteten Codes abgelehnt
  - Die Fehlerantwort enthält die Liste der `allowedCurrencies` zur Klarstellung
  - Berichtswährung und Standardwährungen werden immer akzeptiert

**Beispiel**:
Wenn zugelassene Währungen = `EUR, USD, GBP` und Sie eine Position mit `Currency=CHF` importieren, schlägt der Import fehl mit:
```
Currency "CHF" is not allowed. Allowed currencies: EUR, USD, GBP
```

**Tipp**: Exportieren Sie eine Vorlage, prüfen Sie die Liste der zugelassenen Währungen und stellen Sie sicher, dass Ihre Importdatei nur diese Codes verwendet.

## Status und historische Daten

Wenn Sie Einstellungen ändern:
  - **Berichtswährung**: Wirkt sich sofort auf die Anzeige aus; historische Daten bleiben erhalten und werden mit den zum Eingabezeitpunkt aktiven Kursen umgerechnet
  - **Standardwährungen**: Betreffen nur neue Positionen; bestehende Positionen behalten ihre Währungen
  - **Zugelassene Währungen**: Bestehende Positionen werden nicht rückwirkend validiert -- Einschränkungen gelten nur für neue oder bearbeitete Positionen

## Umrechnungsmechanismen (Kurzreferenz)

### Vergangene Jahre
Es werden Weltbank-Jahresdurchschnittskurse verwendet. Diese sind stabil und ändern sich nach Veröffentlichung nicht mehr.

### Aktuelles Jahr
Es wird der Live-Kassakurs von ExchangeRate-API verwendet (Fallback auf den neuesten Jahreskurs, falls nicht verfügbar). Aktualisiert sich bei FX-Synchronisation oder bei der automatischen 30-Tage-Aktualisierung.

### Zukünftige Jahre
Der Kurs des aktuellen Jahres wird als Forward-Schätzung wiederverwendet. Dies bietet Orientierung für die Budgetplanung, sollte aber überprüft werden, wenn diese Jahre näher rücken.

**Fallback**: Wird für eine Währung kein Kurs gefunden, verwendet das System **1,00**, bis Daten verfügbar sind. Dies verhindert Fehler, kann aber ungenaue Umrechnungen erzeugen -- führen Sie eine FX-Synchronisation durch, um fehlende Kurse zu befüllen.

## Tipps

  - **Berichtswährung einmal festlegen**: Eine Änderung mitten im Jahr betrifft alle Berichte. Wenn Sie sie ändern müssen, tun Sie dies am Jahresende.
  - **Standardwährungen sparen Zeit**: Setzen Sie sie auf die Währungen, die Ihre Teams am häufigsten verwenden.
  - **Währungen bewusst einschränken**: Verwenden Sie zugelassene Währungen nur, wenn Sie einen klaren Grund haben (z. B. FX-Datenabdeckung, Compliance, Standardisierung).
  - **FX-Synchronisation proaktiv durchführen**: Nach dem Hinzufügen von Währungen, vor der Berichtserstellung oder wenn Kurse veraltet erscheinen.
  - **FX-Snapshot-Tabelle prüfen**: Verwenden Sie sie, um zu überprüfen, ob Kurse plausibel und vollständig sind, bevor Sie Berichte finalisieren.
  - **Konsistente ISO-Codes verwenden**: Verwenden Sie immer 3-stellige Codes (EUR, USD, GBP) -- niemals Symbole (€, $, £) oder numerische Codes.

## Häufige Szenarien

### Szenario 1: Berichtswährung ändern
Ihr Konzern wechselt von EUR-basierter zu USD-basierter Berichterstattung.

**Schritte**:
  1. Gehen Sie zu **Budgetverwaltung > Administration > Währungen**
  2. Ändern Sie die Berichtswährung von `EUR` auf `USD`
  3. Klicken Sie auf **Speichern** (löst automatisch FX-Aktualisierung aus)
  4. Überprüfen Sie die FX-Kurs-Snapshot-Tabelle -- alle Kurse sollten jetzt relativ zu USD sein
  5. Prüfen Sie OPEX- und CAPEX-Listen -- Summen und Jahresspalten zeigen nun USD

**Ergebnis**: Alle Berichte, Dashboards und Listen zeigen USD. Ihre gespeicherten Positionsdaten (eigene Währung jeder Position) bleiben unverändert.

### Szenario 2: Währungen aus Compliance-Gründen einschränken
Ihre Finanzabteilung verlangt, dass alle Ausgaben nur in EUR, USD oder GBP erfasst werden.

**Schritte**:
  1. Gehen Sie zu **Budgetverwaltung > Administration > Währungen**
  2. Setzen Sie zugelassene Währungen auf `EUR, USD, GBP`
  3. Klicken Sie auf **Speichern**
  4. Führen Sie **FX-Kurse erzwingen** durch, um sicherzustellen, dass Kurse für alle drei Währungen verfügbar sind

**Ergebnis**: Benutzer können beim Erstellen oder Bearbeiten von Positionen nur EUR, USD oder GBP auswählen. Versuche, andere Währungen zu importieren, schlagen mit einer klaren Fehlermeldung fehl.

### Szenario 3: Neue Währung mitten im Jahr hinzufügen
Ihr Unternehmen beginnt Geschäftstätigkeit in der Schweiz und muss CHF-Ausgaben erfassen.

**Schritte**:
  1. Gehen Sie zu **Budgetverwaltung > Administration > Währungen**
  2. Fügen Sie `CHF` zu den zugelassenen Währungen hinzu (z. B. `EUR, USD, GBP, CHF`)
  3. Klicken Sie auf **Speichern**
  4. Klicken Sie auf **FX-Kurse erzwingen**, um CHF-Kurse sofort abzurufen
  5. Überprüfen Sie, dass CHF in der FX-Kurs-Snapshot-Tabelle mit gültigen Kursen erscheint

**Ergebnis**: Benutzer können jetzt CHF für neue Positionen auswählen. Die FX-Kurs-Tabelle enthält CHF mit aktuellen und historischen Kursen für genaue Umrechnungen.

### Szenario 4: Vorbereitung auf jährliche Budgetzyklen
Es ist Dezember, und Sie bereiten die Budgetplanung für das nächste Jahr vor.

**Schritte**:
  1. Gehen Sie zu **Budgetverwaltung > Administration > Währungen**
  2. Klicken Sie auf **FX-Kurse erzwingen**, um die Kurse für das kommende Jahr zu aktualisieren
  3. Prüfen Sie die FX-Kurs-Snapshot-Tabelle, um die Forward-Schätzungen für das nächste Jahr zu sehen
  4. Beachten Sie, dass Kurse für zukünftige Jahre Forward-Schätzungen sind (Wiederverwendung des Kurses des aktuellen Jahres) -- überprüfen Sie sie, wenn das Jahr näher rückt

**Ergebnis**: Ihre Budgetprognosen für das nächste Jahr verwenden die aktuellsten verfügbaren Kurse. Teams können CAPEX und OPEX mit vernünftigen Währungsannahmen planen.

## Häufig gestellte Fragen

**F: Was passiert, wenn ich die Berichtswährung mitten im Jahr ändere?**
A: Alle Berichte und Listen werden sofort in die neue Währung umgerechnet. Historische Daten bleiben erhalten -- nur die Anzeigewährung ändert sich. Planen Sie diese Änderung sorgfältig, um Verwirrung während aktiver Berichtszeiträume zu vermeiden.

**F: Kann ich verschiedene Berichtswährungen für verschiedene Unternehmen festlegen?**
A: Nein. Die Berichtswährung ist mandantenweit. Alle Unternehmen, Berichte und Summen verwenden dieselbe Berichtswährung. Einzelne Positionen speichern ihre eigene Währung, aber Umrechnungen zielen immer auf die Berichtswährung des Mandanten.

**F: Warum sehe ich keine Kurse für eine bestimmte Währung?**
A: Die Datenquelle (Weltbank oder ExchangeRate-API) veröffentlicht diese Währung möglicherweise nicht. Prüfen Sie, ob der ISO-Code korrekt und allgemein veröffentlicht ist. Erwägen Sie bei Bedarf, zugelassene Währungen auf Codes mit zuverlässiger Datenabdeckung zu beschränken.

**F: Wie oft werden FX-Kurse automatisch aktualisiert?**
A: Alle 30 Tage, wenn sich ein Benutzer anmeldet, aktualisiert das System die Kurse für J-1, J und J+1. Sie können auch jederzeit eine manuelle Aktualisierung über FX-Kurse erzwingen auslösen.

**F: Beeinflussen FX-Kursänderungen meine gespeicherten Daten?**
A: Nein. Wechselkurse beeinflussen nur **Umrechnung und Anzeige**. Jede OPEX- und CAPEX-Position speichert ihre eigene Währung und Beträge, die sich bei Kursaktualisierungen nie ändern. Nur die angezeigten umgerechneten Werte in Berichten und Listen ändern sich.

**F: Kann ich historische Kurse manuell importieren?**
A: Nein. Das System ruft Kurse automatisch von externen Quellen ab (Weltbank, ExchangeRate-API). Wenn Sie benutzerdefinierte Kurse benötigen, kontaktieren Sie den Support oder erwägen Sie die Verwendung einer Währung, bei der Sie die veröffentlichten Kurse akzeptieren können.

**F: Was, wenn ich eine Währung verwenden muss, die nicht in der zugelassenen Liste steht?**
A: Fügen Sie sie entweder zu den zugelassenen Währungen hinzu oder lassen Sie die Liste leer (was alle Währungen zulässt). Denken Sie daran, nach dem Hinzufügen neuer Währungen eine FX-Synchronisation durchzuführen, um Kurse zu befüllen.

**F: Sind Forward-Schätzungen für zukünftige Jahre genau?**
A: Forward-Schätzungen verwenden den Kurs des aktuellen Jahres wieder und sollten als **Planungsannahmen** behandelt werden, nicht als Prognosen. Überprüfen Sie sie, wenn zukünftige Jahre näher rücken und Kurse aus offiziellen Quellen verfügbar werden.
