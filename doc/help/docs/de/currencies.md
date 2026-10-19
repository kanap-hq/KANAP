# Währungseinstellungen

Die Seite Währungseinstellungen (**Budgetverwaltung > Administration > Währungen**) ist der Ort, an dem Sie konfigurieren, wie Währungen in Ihrem Arbeitsbereich gespeichert, angezeigt und umgerechnet werden. Sie steuert die mandantenweite Berichtswährung, Standardwährungen für neue Budgetzeilen und optionale Einschränkungen, welche Währungen verwendet werden können.

Für Hintergrundinformationen zu Währungskonzepten und Umrechnungsmechanismen siehe den Leitfaden zur Währungsverwaltung.

## Wer sie sehen und ändern kann

Währungen sind eine Budgeteinstellung. Die Seite steht bei den anderen Budgeteinstellungen in der [Budgetadministration](budget-operations.md).

- **Die Seite öffnen, Einstellungen ändern, die Wechselkurssynchronisierung starten und manuelle Kurse eingeben**: Budgetadministration auf Administratorebene. Die Karte ist für andere Benutzer ausgeblendet.
- **Währungen bei Zeilen verwenden**: OPEX- und CAPEX-Benutzer wählen in ihren Zeilenformularen aus den erlaubten Währungen, ohne diese Seite zu öffnen.

Das Recht **Einstellungen** der IT-Landschaft gibt keinen Zugriff auf Währungen. Es umfasst nur die Einstellungen der IT-Landschaft.

## Das Formular für Währungseinstellungen

### Berichtswährung
Die **mandantenweite Währung**, die für alle Berichte, Summen und Listenanzeigen verwendet wird. Wenn Sie diese Währung ändern:
  - Werden alle OPEX- und CAPEX-Jahresspalten in die neue Berichtswährung umgerechnet
  - Berechnen sich Summen in Berichten mit der neuen Basis neu
  - **Ihre gespeicherten Zeilendaten bleiben unverändert**: nur Anzeige und Umrechnung sind betroffen

**Beispiel**: Wenn Sie von EUR auf USD wechseln, werden Ihre OPEX-Listensummen in USD angezeigt, aber die gespeicherte Währung jeder Budgetzeile (EUR, GBP usw.) bleibt gleich.

**Tipp**: Wählen Sie eine Berichtswährung, die dem Finanzberichtsstandard Ihres Konzerns entspricht (z. B. EUR für europäische Hauptsitze, USD für US-basierte Gruppen).

### Standard-OPEX-Währung
Die Währung, die beim Erstellen einer neuen OPEX-Zeile (Ausgabenzeile) **vorausgefüllt** wird. Dies schränkt nicht ein, welche Währungen Sie auswählen können. Es spart nur Zeit, indem ein sinnvoller Standard angeboten wird.

**Beispiel**: Wenn der Großteil Ihrer wiederkehrenden Ausgaben in EUR anfällt, setzen Sie dies auf EUR. Benutzer können weiterhin manuell GBP, USD oder jede andere zugelassene Währung auswählen.

### Standard-CAPEX-Währung
Die Währung, die beim Erstellen einer neuen CAPEX-Zeile **vorausgefüllt** wird. Funktioniert genauso wie die Standard-OPEX-Währung, aber für Investitionsausgaben.

**Tipp**: Wenn Ihre CAPEX überwiegend in einer anderen Währung als der täglichen OPEX beschafft wird (z. B. USD für Hardwarekäufe), setzen Sie hier eine andere Standardwährung.

### Zugelassene Währungen (optional)
Eine **kommagetrennte Liste** von ISO-Codes, die einschränkt, welche Währungen Benutzer beim Erstellen oder Bearbeiten von OPEX- und CAPEX-Zeilen auswählen können.

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
  3. Wenn sich die Berichtswährung ändert, die Kurse jedes verwendeten Jahres für die neue Währung aktualisieren: Budgetjahre, Jahre mit Unternehmenszahlen, die Jahre der Vertragsseite, das Vorjahr und das Folgejahr sowie eingefrorene Jahre. Das Speichern wartet auf diese Aktualisierung. Läuft sie am Ende der Wartezeit noch, geht sie von allein weiter. Jede andere Änderung aktualisiert das laufende Jahr
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

**Automatische Aktualisierung**: Das System aktualisiert Kurse auch automatisch alle 30 Tage, wenn sich ein Benutzer anmeldet (für J-1, J, J+1). Braucht eine Liste, ein Bericht oder die Vertragsseite einen Kurs, der im Snapshot seines Jahres fehlt (eine seither verwendete Währung oder ein Jahr ohne Snapshot), holt das System dieses Jahr im Hintergrund nach, sobald es gelesen wird, und die nächste Anzeige verwendet den neuen Kurs. Die manuelle Synchronisation gibt Ihnen Kontrolle, wenn Sie sofortige Aktualisierungen benötigen.

**Abgerufene Währungen**: die Währungen der Budgetzeilen, Unternehmen und Verträge sowie die Berichtswährung, die Standardwährungen und die zugelassenen Währungen.

**Bekannte Kurse bleiben erhalten**: Liefert eine Quelle eine Währung bei einer späteren Aktualisierung nicht mehr, bleibt der für dieses Jahr gespeicherte Kurs bestehen.

**Noch nicht veröffentlichte Jahre**: Die Weltbank veröffentlicht den Durchschnitt eines Jahres einige Monate nach dessen Ende (das gerade abgelaufene Jahr meist um die Jahresmitte). Bis dahin verwendet ein vergangenes Jahr das nächstgelegene veröffentlichte Jahr, und die Tabelle kennzeichnet diesen Kurs als **Schätzung**. Der tatsächliche Wert ersetzt ihn bei der ersten Aktualisierung nach der Veröffentlichung. Das aktuelle Jahr verwendet den Live-Kurs. Ist dieser nicht verfügbar, verwendet es das zuletzt veröffentlichte Jahr, ebenfalls als Schätzung gekennzeichnet.

**Tipp**: Wenn Sie eine neue Währung zu den zugelassenen Währungen hinzufügen, führen Sie sofort eine FX-Synchronisation durch, um die Kurse zu befüllen, bevor Benutzer Budgetzeilen in dieser Währung erstellen.

## FX-Kurs-Snapshot-Tabelle

Unterhalb des Einstellungsformulars zeigt die Tabelle **Neueste FX-Kurs-Snapshots** die aktuellsten erfassten Wechselkurse für jedes Geschäftsjahr, in der aktuellen Berichtswährung. Eine Zeile ist die Berichtswährung, eine Standardwährung, eine zugelassene Währung oder eine Währung, die eine Budgetzeile, ein Unternehmen oder ein Vertrag verwendet. Eine Währung, für die ein manueller Kurs gespeichert ist, bleibt in der Tabelle. Kurse, die für eine frühere Berichtswährung gespeichert wurden, werden nicht angezeigt.

**Spalten**:
  - **Währung**: Der 3-stellige ISO-Code
  - **Geschäftsjahr-Spalten**: Eine Spalte pro Jahr mit Daten (z. B. 2023, 2024, 2025)
  - **Kurswerte**: Wechselkurs zu Ihrer Berichtswährung (6 Dezimalstellen Präzision)
  - **Quellenbezeichnung**: Zeigt die Datenquelle für jedes Jahr:
      - **Jahresdurchschnitt**: Weltbank-Jahresdurchschnitt (historische Jahre)
      - **Quartalsdurchschnitt**: Weltbank-Quartalsdurchschnitt (falls verfügbar)
      - **Live-Kassakurs**: Aktueller Kassakurs von ExchangeRate-API (aktuelles Jahr)
      - **Forward-Schätzung**: Kurs des aktuellen Jahres wird für zukünftige Jahre wiederverwendet
  - **Kennzeichen in den Zellen**: ein Sternchen (*) nach einem von Hand eingegebenen Kurs, erklärt durch den Hinweis **Manuell erfasster Kurs** unter der Tabelle (nur sichtbar, wenn die Tabelle einen solchen Kurs enthält); **Schätzung** neben einem Kurs aus dem nächstgelegenen veröffentlichten Jahr (zeigen Sie mit der Maus auf das Kennzeichen, um den Grund zu sehen)
  - **Fehlender Kurs**: Ein Paar ohne Kurs zeigt `—` in der Warnfarbe

**Beispiel**:
Wenn Ihre Berichtswährung EUR ist:

| Währung | 2024 (Jahresdurchschnitt) | 2025 (Live-Kassakurs) | 2026 (Forward-Schätzung) |
|---------|--------------------------|----------------------|--------------------------|
| USD     | 0,925820                 | 0,931200             | 0,931200                 |
| GBP     | 1,175300                 | 1,182000             | 1,182000                 |
| CHF     | 0,962100                 | 0,965500             | 0,965500                 |

**Die Tabelle lesen**:
  - Kurse zeigen, wie viele Einheiten Ihrer Berichtswährung einer Einheit der gelisteten Währung entsprechen
  - Zeigt ein Kurs `—`, sind keine Daten verfügbar. Beträge von Budgetzeilen in dieser Währung sind für dieses Jahr nicht in den Summen enthalten (siehe [Umrechnungsmechanismen](#umrechnungsmechanismen-kurzreferenz))
  - Kurse werden zum Zeitpunkt der Synchronisation erfasst und bleiben bis zur nächsten Aktualisierung stabil

**Tipp**: Wenn Sie fehlende Kurse (`—`) sehen, prüfen Sie, ob der Währungscode gültig und allgemein veröffentlicht ist. Erwägen Sie, zugelassene Währungen einzuschränken, um exotische Codes ohne Daten zu vermeiden. Sie können den Kurs auch selbst eingeben (siehe [Manuelle Kurse](#manuelle-kurse)).

### Fehlende Kurse

Über der Tabelle listet ein Block jede verwendete Kombination aus Währung und Jahr ohne Kurs auf, unter einem Titel wie **2 Wechselkurse fehlen**. Jede Zeile erklärt, dass noch keine Quelle diesen Kurs veröffentlicht und Beträge in dieser Währung bei den Summen außen vor bleiben, bis ein Kurs vorliegt. Fehlt nichts, zeigt der Block **Jede verwendete Währung hat einen Kurs.**

Ein Paar gilt als verwendet, wenn eine Budgetzeile, die Kennzahlen eines Unternehmens oder ein Vertrag es benötigen. Bei einem Vertrag ist das jedes Jahr, das die Vertragsseite anzeigt: das laufende Jahr, die beiden folgenden und das Vorjahr, wenn das Budget dafür Zeilen hat. Beim Öffnen der Seite werden die Quellen für die Jahre der Liste außerdem erneut abgefragt.

### Manuelle Kurse

Wenn keine Quelle einen Kurs veröffentlicht oder Ihr Finanzteam eigene Kurse verwendet, können Sie einen Kurs für eine Währung und ein Jahr eingeben.

  1. Klicken Sie in der Tabelle auf die Zelle der Währung und des Jahres, oder klicken Sie auf **Kurs eingeben** neben einer Zeile des Blocks der fehlenden Kurse.
  2. Geben Sie im Dialog **Manueller Wechselkurs** den Kurs in Ihrer Berichtswährung für 1 Einheit der gewählten Währung ein (zum Beispiel **Kurs in EUR für 1 USD**). Verwenden Sie das Dezimaltrennzeichen Ihrer Sprache. Eine gute Quelle ist der Jahresdurchschnitt, den Ihre Zentralbank oder Ihre Treasury veröffentlicht.
  3. Klicken Sie auf **Speichern**. Die Zelle zeigt den Kurs dann mit einem Sternchen (*).

Ein manueller Kurs ersetzt den automatischen Kurs für dieses Jahr, bis Sie ihn entfernen. Spätere Aktualisierungen überschreiben ihn nicht. Um zum automatischen Kurs zurückzukehren, öffnen Sie die Zelle und klicken Sie auf **Manuellen Kurs entfernen**: Der automatische Kurs wird erneut abgerufen.

Gut zu wissen:
  - Nur Benutzer der Budgetadministration auf Administratorebene können einen manuellen Kurs eingeben, ändern oder entfernen.
  - Jede Eingabe, Änderung und Entfernung wird im Audit-Protokoll erfasst.
  - Ein eingefrorenes Jahr behält die beim Einfrieren erfassten Kurse, manuelle Kurse und Schätzungen eingeschlossen (siehe [Eingefrorene Jahre](#eingefrorene-jahre)).
  - Ein manueller Kurs gilt für die aktuelle Berichtswährung. Nach einem Wechsel der Berichtswährung gelten die für die alte Währung eingegebenen manuellen Kurse nicht mehr. Sie gelten wieder, wenn Sie zu dieser Berichtswährung zurückwechseln.
  - Die Berichtswährung hat immer den Kurs 1 und nimmt keinen manuellen Kurs an.

## CSV-Import und -Export

### Export
OPEX- und CAPEX-Exporte enthalten Zeilendaten und Jahresbeträge in der **eigenen Währung** jeder Budgetzeile, nicht in der Berichtswährung. Dies bewahrt die Originaldaten für den Reimport oder externe Analysen.

**Beispiel-CSV-Zeile** (OPEX):
```
Item Name;Company;Account;Currency;Y-1;Y;Y+1;Y+2
SaaS License;Acme UK;6200;GBP;10000;12000;12000;12000
```

### Import
Beim Import von OPEX- oder CAPEX-Zeilen muss die Spalte `Currency` **Standard-3-stellige ISO-Codes** enthalten.

**Validierung**:
  - Wenn **zugelassene Währungen** konfiguriert sind, werden Importe mit nicht gelisteten Codes abgelehnt
  - Die Fehlerantwort enthält die Liste der `allowedCurrencies` zur Klarstellung
  - Berichtswährung und Standardwährungen werden immer akzeptiert

**Beispiel**:
Wenn zugelassene Währungen = `EUR, USD, GBP` und Sie eine Budgetzeile mit `Currency=CHF` importieren, schlägt der Import fehl mit:
```
Currency "CHF" is not allowed. Allowed currencies: EUR, USD, GBP
```

**Tipp**: Exportieren Sie eine Vorlage, prüfen Sie die Liste der zugelassenen Währungen und stellen Sie sicher, dass Ihre Importdatei nur diese Codes verwendet.

## Status und historische Daten

Wenn Sie Einstellungen ändern:
  - **Berichtswährung**: Wirkt sich sofort auf die Anzeige aus; gespeicherte Beträge ändern sich nicht, und jedes Jahr wird mit den unter [Umrechnungsmechanismen](#umrechnungsmechanismen-kurzreferenz) beschriebenen Kursen in die neue Währung umgerechnet
  - **Standardwährungen**: Betreffen nur neue Budgetzeilen; bestehende Budgetzeilen behalten ihre Währungen
  - **Zugelassene Währungen**: Bestehende Budgetzeilen werden nicht rückwirkend validiert. Einschränkungen gelten nur für neue oder bearbeitete Budgetzeilen

## Umrechnungsmechanismen (Kurzreferenz)

Beträge werden in ihrer eigenen Währung gespeichert und bei der Anzeige umgerechnet. Jedes Jahr verwendet die zuletzt für dieses Jahr erfassten Kurse, unabhängig davon, wann die Beträge eingegeben wurden. Erfasst eine Synchronisation neue Kurse für ein Jahr, werden die Beträge dieses Jahres ab dann damit umgerechnet, außer das Jahr ist eingefroren (siehe [Eingefrorene Jahre](#eingefrorene-jahre)).

### Vergangene Jahre
Es werden Weltbank-Jahresdurchschnittskurse verwendet. Diese sind stabil und ändern sich nach Veröffentlichung nicht mehr. Solange die Weltbank ein Jahr noch nicht veröffentlicht hat, tritt das nächstgelegene veröffentlichte Jahr an seine Stelle, als Schätzung gekennzeichnet.

### Aktuelles Jahr
Es wird der Live-Kassakurs von ExchangeRate-API verwendet (Fallback auf den neuesten Jahreskurs, als Schätzung gekennzeichnet, falls nicht verfügbar). Aktualisiert sich bei FX-Synchronisation oder bei der automatischen 30-Tage-Aktualisierung.

### Zukünftige Jahre
Der Kurs des aktuellen Jahres wird als Forward-Schätzung wiederverwendet. Dies bietet Orientierung für die Budgetplanung, sollte aber überprüft werden, wenn diese Jahre näher rücken.

### Eingefrorene Jahre
Das Einfrieren der Standard-Budgetspalte eines Jahres schreibt die Kurse dieses Jahres für den eingefrorenen Typ (OPEX oder CAPEX) fest: KANAP aktualisiert die Kurse des Jahres und behält diesen Satz dann für alle Beträge des Jahres, auch wenn neuere Kurse eintreffen. Wechselt die Berichtswährung später, bleiben diese Beträge auf den eingefrorenen Kursen und werden dann von dieser Währung in die neue Berichtswährung zum aktuellen Kurs des Jahres umgerechnet. Das Auftauen der Standardspalte gibt sie wieder frei. Siehe [Das Einfrieren der Standardspalte schreibt die Wechselkurse fest](budget-operations.md#das-einfrieren-der-standardspalte-schreibt-die-wechselkurse-fest).

**Fehlender Kurs**: Hat ein Jahr keinen Kurs für eine verwendete Währung, sind die Beträge der Budgetzeilen in dieser Währung für dieses Jahr in keiner Summe in der Berichtswährung enthalten. Das betrifft die Liste der Budgetzeilen, die Übersicht der Budgetverwaltung, die Budget- und Leistungsverrechnungsberichte, die Verträge und die Reiter Verknüpfungen der Anwendungen und Technologien. Der Bildschirm weist dort darauf hin, wo es zählt:

- Ein einzeiliger Hinweis nennt, was ausgeschlossen ist, zum Beispiel „3 Zeilen ohne Wechselkurs ausgeschlossen: USD 2026.“ Er erscheint unter den Summen der Liste der Budgetzeilen, auf den Kacheln der Übersicht, oben in jedem Budget- und Leistungsverrechnungsbericht und unter den Budgetzahlen von Verträgen, Anwendungen und Technologien. Benutzer der Budgetadministration auf Administratorebene sehen außerdem **Kurs eingeben**, das diese Seite öffnet.
- In der Zeile selbst erscheint der Betrag in seiner eigenen Währung mit einer kleinen orangefarbenen Markierung. Fahren Sie mit der Maus über die Markierung, um zum Beispiel „Kein Wechselkurs für USD im Jahr 2026: nicht in den Summen enthalten.“ zu lesen.

KANAP ruft die Kurse dieses Jahres im Hintergrund ab (höchstens einmal alle sechs Stunden je Jahr), sodass die nächste Anzeige den neuen Kurs verwendet, sobald die Quelle ihn veröffentlicht. Um fehlende Kurse zu erkennen, prüfen Sie den Block der fehlenden Kurse über der FX-Kurs-Snapshot-Tabelle und führen Sie eine FX-Synchronisation durch, um die Kurse sofort abzurufen. Ein [manueller Kurs](#manuelle-kurse) behebt das Problem umgehend.

## Tipps

  - **Berichtswährung einmal festlegen**: Eine Änderung mitten im Jahr betrifft alle Berichte. Wenn Sie sie ändern müssen, tun Sie dies am Jahresende.
  - **Standardwährungen sparen Zeit**: Setzen Sie sie auf die Währungen, die Ihre Teams am häufigsten verwenden.
  - **Währungen bewusst einschränken**: Verwenden Sie zugelassene Währungen nur, wenn Sie einen klaren Grund haben (z. B. FX-Datenabdeckung, Compliance, Standardisierung).
  - **FX-Synchronisation proaktiv durchführen**: Nach dem Hinzufügen von Währungen, vor der Berichtserstellung oder wenn Kurse veraltet erscheinen.
  - **FX-Snapshot-Tabelle prüfen**: Verwenden Sie sie, um zu überprüfen, ob Kurse plausibel und vollständig sind, bevor Sie Berichte finalisieren.
  - **Konsistente ISO-Codes verwenden**: Verwenden Sie immer 3-stellige Codes (EUR, USD, GBP), niemals Symbole (€, $, £) oder numerische Codes.

## Häufige Szenarien

### Szenario 1: Berichtswährung ändern
Ihr Konzern wechselt von EUR-basierter zu USD-basierter Berichterstattung.

**Schritte**:
  1. Gehen Sie zu **Budgetverwaltung > Administration > Währungen**
  2. Ändern Sie die Berichtswährung von `EUR` auf `USD`
  3. Klicken Sie auf **Speichern**. KANAP aktualisiert jedes verwendete Jahr für USD. Das Speichern gibt an, ob diese Aktualisierung rechtzeitig abgeschlossen wurde
  4. Überprüfen Sie die FX-Kurs-Snapshot-Tabelle: USD ist die Basis dieser Jahre (jeder Kurs ist jetzt relativ zu USD)
  5. Prüfen Sie OPEX- und CAPEX-Listen: Summen und Jahresspalten zeigen nun USD

**Ergebnis**: Alle Berichte, Dashboards und Listen zeigen USD. Ihre gespeicherten Zeilendaten (eigene Währung jeder Budgetzeile) bleiben unverändert.

### Szenario 2: Währungen aus Compliance-Gründen einschränken
Ihre Finanzabteilung verlangt, dass alle Ausgaben nur in EUR, USD oder GBP erfasst werden.

**Schritte**:
  1. Gehen Sie zu **Budgetverwaltung > Administration > Währungen**
  2. Setzen Sie zugelassene Währungen auf `EUR, USD, GBP`
  3. Klicken Sie auf **Speichern**
  4. Führen Sie **FX-Kurse erzwingen** durch, um sicherzustellen, dass Kurse für alle drei Währungen verfügbar sind

**Ergebnis**: Benutzer können beim Erstellen oder Bearbeiten von Budgetzeilen nur EUR, USD oder GBP auswählen. Versuche, andere Währungen zu importieren, schlagen mit einer klaren Fehlermeldung fehl.

### Szenario 3: Neue Währung mitten im Jahr hinzufügen
Ihr Unternehmen beginnt Geschäftstätigkeit in der Schweiz und muss CHF-Ausgaben erfassen.

**Schritte**:
  1. Gehen Sie zu **Budgetverwaltung > Administration > Währungen**
  2. Fügen Sie `CHF` zu den zugelassenen Währungen hinzu (z. B. `EUR, USD, GBP, CHF`)
  3. Klicken Sie auf **Speichern**
  4. Klicken Sie auf **FX-Kurse erzwingen**, um CHF-Kurse sofort abzurufen
  5. Überprüfen Sie, dass CHF in der FX-Kurs-Snapshot-Tabelle mit gültigen Kursen erscheint

**Ergebnis**: Benutzer können jetzt CHF für neue Budgetzeilen auswählen. Die FX-Kurs-Tabelle enthält CHF mit aktuellen und historischen Kursen für genaue Umrechnungen.

### Szenario 4: Vorbereitung auf jährliche Budgetzyklen
Es ist Dezember, und Sie bereiten die Budgetplanung für das nächste Jahr vor.

**Schritte**:
  1. Gehen Sie zu **Budgetverwaltung > Administration > Währungen**
  2. Klicken Sie auf **FX-Kurse erzwingen**, um die Kurse für das kommende Jahr zu aktualisieren
  3. Prüfen Sie die FX-Kurs-Snapshot-Tabelle, um die Forward-Schätzungen für das nächste Jahr zu sehen
  4. Beachten Sie, dass Kurse für zukünftige Jahre Forward-Schätzungen sind (Wiederverwendung des Kurses des aktuellen Jahres). Überprüfen Sie sie, wenn das Jahr näher rückt

**Ergebnis**: Ihre Budgetprognosen für das nächste Jahr verwenden die aktuellsten verfügbaren Kurse. Teams können CAPEX und OPEX mit vernünftigen Währungsannahmen planen.

## Häufig gestellte Fragen

**F: Was passiert, wenn ich die Berichtswährung mitten im Jahr ändere?**
A: Alle Berichte und Listen werden sofort in die neue Währung umgerechnet. Historische Daten bleiben erhalten: nur die Anzeigewährung ändert sich. Planen Sie diese Änderung sorgfältig, um Verwirrung während aktiver Berichtszeiträume zu vermeiden.

**F: Kann ich verschiedene Berichtswährungen für verschiedene Unternehmen festlegen?**
A: Nein. Die Berichtswährung ist mandantenweit. Alle Unternehmen, Berichte und Summen verwenden dieselbe Berichtswährung. Einzelne Budgetzeilen speichern ihre eigene Währung, aber Umrechnungen zielen immer auf die Berichtswährung des Mandanten.

**F: Warum sehe ich keine Kurse für eine bestimmte Währung?**
A: Die Datenquelle (Weltbank oder ExchangeRate-API) veröffentlicht diese Währung möglicherweise nicht. Prüfen Sie, ob der ISO-Code korrekt und allgemein veröffentlicht ist. Erwägen Sie bei Bedarf, zugelassene Währungen auf Codes mit zuverlässiger Datenabdeckung zu beschränken.

**F: Wie oft werden FX-Kurse automatisch aktualisiert?**
A: Alle 30 Tage, wenn sich ein Benutzer anmeldet, aktualisiert das System die Kurse für J-1, J und J+1. Ein Jahr, dem der Kurs einer verwendeten Währung fehlt, wird außerdem abgerufen, sobald eine Liste, ein Bericht oder die Vertragsseite ihn braucht, und wenn Sie diese Seite öffnen. Sie können auch jederzeit eine manuelle Aktualisierung über FX-Kurse erzwingen auslösen.

**F: Beeinflussen FX-Kursänderungen meine gespeicherten Daten?**
A: Nein. Wechselkurse beeinflussen nur **Umrechnung und Anzeige**. Jede OPEX- und CAPEX-Zeile speichert ihre eigene Währung und Beträge, die sich bei Kursaktualisierungen nie ändern. Nur die angezeigten umgerechneten Werte in Berichten und Listen ändern sich.

**F: Kann ich historische Kurse manuell importieren?**
A: Ein Import von Kursen aus einer Datei ist nicht verfügbar. Sie können auf dieser Seite für jede Währung und jedes Jahr einen manuellen Kurs eingeben (siehe [Manuelle Kurse](#manuelle-kurse)). Ein manueller Kurs ersetzt den automatischen Kurs, bis Sie ihn entfernen.

**F: Was, wenn ich eine Währung verwenden muss, die nicht in der zugelassenen Liste steht?**
A: Fügen Sie sie entweder zu den zugelassenen Währungen hinzu oder lassen Sie die Liste leer (was alle Währungen zulässt). Denken Sie daran, nach dem Hinzufügen neuer Währungen eine FX-Synchronisation durchzuführen, um Kurse zu befüllen.

**F: Sind Forward-Schätzungen für zukünftige Jahre genau?**
A: Forward-Schätzungen verwenden den Kurs des aktuellen Jahres wieder und sollten als **Planungsannahmen** behandelt werden, nicht als Prognosen. Überprüfen Sie sie, wenn zukünftige Jahre näher rücken und Kurse aus offiziellen Quellen verfügbar werden.
