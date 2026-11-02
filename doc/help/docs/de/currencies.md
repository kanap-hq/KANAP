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

### Erlaubte Währungen (optional)
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

Klicken Sie auf **Speichern**, um Ihre Änderungen zu übernehmen. Das System:
  1. Prüft alle Währungscodes (3-stellige ISO-Codes)
  2. Aktualisiert die Einstellungen Ihres Arbeitsbereichs
  3. Aktualisiert die Kurse des laufenden Jahres. Ein Wechsel der Berichtswährung aktualisiert stattdessen jedes verwendete Jahr (siehe [Berichtswährung wechseln](#berichtswahrung-wechseln))
  4. Zeigt eine Erfolgsmeldung an

Klicken Sie auf **Zurücksetzen**, um nicht gespeicherte Änderungen zu verwerfen und zu den zuletzt gespeicherten Werten zurückzukehren.

**Wichtig**: Ein Wechsel der Berichtswährung wirkt sich sofort auf die Anzeige aller Listen und Berichte aus. Planen Sie ihn für einen Zeitpunkt, an dem keine Berichtsperiode läuft.

### Berichtswährung wechseln

Wenn Sie eine neue Berichtswährung speichern, öffnet sich zuerst ein Bestätigungsdialog, zum Beispiel **Reporting-Währung in USD ändern?**. Er zeigt, was der Wechsel bewirkt:

  - Jeder Betrag wird zum Kurs seines Jahres in die neue Währung umgerechnet. Die Kurse werden für die verwendeten Jahre abgerufen.
  - Die manuellen Kurse, die für die aktuelle Berichtswährung erfasst wurden, gelten nicht mehr. Der Dialog listet sie mit Währung, Jahr und Kurs auf. Sie gelten wieder, wenn Sie später die aktuelle Währung erneut wählen.
  - Für jedes Jahr mit eingefrorenen Budgetversionen: Diese Versionen behalten die Kurse ihres Einfrierens, zum Kurs des Jahres in die neue Währung umgerechnet (siehe [Eingefrorene Jahre](#eingefrorene-jahre)).
  - Die neue Währung wird zu den erlaubten Währungen hinzugefügt, wenn die Liste sie noch nicht enthält.

Die letzten drei Punkte erscheinen nur, wenn sie zutreffen. Klicken Sie auf **Währung ändern**, um zu speichern, oder auf **Abbrechen**, um die aktuellen Einstellungen beizubehalten.

KANAP ruft dann die Kurse der neuen Währung für jedes verwendete Jahr ab: die Budgetjahre (eingefrorene eingeschlossen), die Jahre mit einem Unternehmensumsatz, die Jahre, die die Vertragsseite zeigt, sowie das laufende Kalenderjahr mit dem Vorjahr und dem Folgejahr. Die Seite wartet auf das Ergebnis und meldet es wie bei einer [erzwungenen Synchronisierung](#wechselkurssynchronisierung-erzwingen).

## Wechselkurssynchronisierung erzwingen

Die Schaltfläche **Wechselkurssynchronisierung erzwingen** ruft die Kurse sofort ab: für das vorherige, das laufende und das nächste Kalenderjahr, für jedes Jahr im Block der fehlenden Kurse und für jedes Jahr, das bereits Budgetbeträge hat.

**Wann verwenden**:
  - Nach dem Hinzufügen neuer erlaubter Währungen
  - Wenn Sie aktuelle Tageskurse für das laufende Jahr benötigen
  - Wenn Sie veraltete oder fehlende Kurse vermuten
  - Vor der Erstellung von Berichten für die Geschäftsleitung

**Was passiert**:
  - Die Schaltfläche bleibt beschäftigt, während KANAP die Kurse abruft, höchstens 20 Sekunden
  - Eine Meldung über der Tabelle nennt dann das Ergebnis: die Zahl der abgerufenen Kurse, zum Beispiel **12 Kurse abgerufen.**, gefolgt von den Paaren, die noch keinen Kurs haben, zum Beispiel **Weiterhin fehlend: BRL 2026.**, oder von **Jede verwendete Währung hat einen Kurs.**
  - Wenn der Abruf keinen neuen Kurs bringt und jede verwendete Währung bereits einen Kurs hat, lautet die Meldung **Die Wechselkurse sind aktuell.** Wenn noch Paare fehlen, lautet sie **Es wurde kein neuer Kurs abgerufen.** und nennt sie.
  - Wenn die Quellen nicht geantwortet haben, sagt die Meldung das, und die bereits gespeicherten Kurse bleiben bestehen
  - Dauert der Abruf länger, lautet die Meldung **Die Synchronisierung läuft im Hintergrund weiter.** Die Tabelle und der Block der fehlenden Kurse aktualisieren sich, sobald er endet
  - Läuft bereits eine Aktualisierung, fügt KANAP ihr Ihre Jahre hinzu, sodass keine Anfrage verloren geht

**Automatische Aktualisierung**: Das System aktualisiert die Kurse außerdem alle 30 Tage automatisch, wenn sich ein Benutzer anmeldet (J-1, J, J+1). Braucht eine Liste, ein Bericht oder die Vertragsseite einen Kurs, den der Snapshot seines Jahres nicht hat (eine seither verwendete Währung oder ein Jahr ohne Snapshot), ruft das System dieses Jahr im Hintergrund ab, sobald es gelesen wird, und die nächste Anzeige verwendet den neuen Kurs. Die erzwungene Synchronisierung dient dazu, das Ergebnis sofort zu erhalten.

**Welche Währungen abgerufen werden**: die Währungen der Budgetzeilen, Unternehmen und Verträge sowie die Berichts-, Standard- und erlaubten Währungen.

**Bereits bekannte Kurse bleiben erhalten**: Liefert eine Quelle eine Währung bei einer späteren Aktualisierung nicht mehr, bleibt der für dieses Jahr gespeicherte Kurs bestehen.

**Noch nicht veröffentlichte Jahre**: Die Weltbank veröffentlicht den Durchschnitt eines Jahres einige Monate nach dessen Ende (das gerade abgelaufene Jahr meist um die Jahresmitte). Bis dahin verwendet ein vergangenes Jahr das nächstgelegene veröffentlichte Jahr, und die Tabelle kennzeichnet diesen Kurs als **Schätzung**. Der echte Wert ersetzt ihn bei der ersten Aktualisierung nach der Veröffentlichung. Das laufende Jahr verwendet den Tageskurs. Ist er nicht verfügbar, verwendet es das zuletzt veröffentlichte Jahr, ebenfalls als Schätzung gekennzeichnet.

**Tipp**: Wenn Sie eine neue Währung zu den erlaubten Währungen hinzufügen, führen Sie sofort **Wechselkurssynchronisierung erzwingen** aus, damit Kurse vorliegen, bevor Benutzer Budgetzeilen in dieser Währung anlegen.

## FX-Kurs-Snapshot-Tabelle

Unter dem Einstellungsformular zeigt die Tabelle **Neueste Wechselkurs-Snapshots** die zuletzt erfassten Wechselkurse jedes Geschäftsjahres in der aktuellen Berichtswährung. Die Berichtswährung steht zuerst, danach die übrigen Währungen in alphabetischer Reihenfolge. Eine Zeile ist eine verwendete Währung: eine Standardwährung, eine erlaubte Währung oder die Währung einer Budgetzeile, eines Unternehmens oder eines Vertrags. Eine Währung mit manuellem Kurs bleibt in der Tabelle, auch wenn sie nicht mehr verwendet wird. Nach einem Wechsel der Berichtswährung erscheint die frühere auch für die Jahre eingefrorener Versionen, da deren Umrechnung über sie läuft. Kurse, die für eine frühere Berichtswährung gespeichert wurden, werden nicht angezeigt.

**Spalten**:
  - **Währung**: Der 3-stellige ISO-Code
  - **Geschäftsjahresspalten**: Eine Spalte pro Jahr mit Daten (z. B. 2023, 2024, 2025)
  - **Kurswerte**: Wechselkurs zu Ihrer Berichtswährung, im Zahlenformat Ihrer Sprache, mit höchstens 6 Dezimalstellen und ohne überflüssige Nullen
  - **Quellenbezeichnung**: Zeigt die Datenquelle für jedes Jahr:
      - **Jahresdurchschnitt**: Jahresdurchschnitt der Weltbank (vergangene Jahre)
      - **Quartalsdurchschnitt**: Quartalsdurchschnitt der Weltbank (falls verfügbar)
      - **Live-Spot**: Aktueller Tageskurs von ExchangeRate-API (laufendes Jahr)
      - **Terminschätzung**: Kurs des laufenden Jahres, für künftige Jahre übernommen
  - **Markierungen in den Zellen**: ein Sternchen (*) nach einem von Hand erfassten Kurs, erklärt durch den Hinweis **Manuell erfasster Kurs** unter der Tabelle (nur sichtbar, wenn die Tabelle einen solchen Kurs enthält); **Schätzung** neben einem Kurs aus dem nächstgelegenen veröffentlichten Jahr (Maus über die Markierung für den Grund)
  - **Fehlender Kurs**: Ein Paar ohne Kurs zeigt `—` in der Warnfarbe

**Beispiel**:
Wenn Ihre Berichtswährung EUR ist:

| Währung | 2024 (Jahresdurchschnitt) | 2025 (Live-Spot) | 2026 (Terminschätzung) |
|---------|---------------------------|------------------|------------------------|
| EUR     | 1                         | 1                | 1                      |
| CHF     | 0,9621                    | 0,9655           | 0,9655                 |
| GBP     | 1,1753                    | 1,182            | 1,182                  |
| USD     | 0,92582                   | 0,9312           | 0,9312                 |

**Die Tabelle lesen**:
  - Kurse zeigen, wie viele Einheiten Ihrer Berichtswährung 1 Einheit der aufgeführten Währung entsprechen
  - Zeigt ein Kurs `—`, liegen keine Daten vor. Budgetzeilenbeträge in dieser Währung sind für dieses Jahr in keiner Summe enthalten (siehe [Umrechnungsmechanismen](#umrechnungsmechanismen-kurzreferenz))
  - Kurse werden zum Zeitpunkt der Synchronisierung erfasst und bleiben bis zur nächsten Aktualisierung stabil

**Tipp**: Wenn Sie fehlende Kurse (`—`) sehen, prüfen Sie, ob der Währungscode gültig ist und üblicherweise veröffentlicht wird. Erwägen Sie, die erlaubten Währungen zu beschränken, um seltene Codes ohne Daten zu vermeiden. Sie können den Kurs auch selbst eingeben (siehe [Manuelle Kurse](#manuelle-kurse)).

### Fehlende Kurse

Über der Tabelle listet ein Block jede verwendete Währung und jedes Jahr ohne Kurs auf, unter einem Titel wie **2 Wechselkurse fehlen**. Jede Zeile erklärt, dass noch keine Quelle diesen Kurs veröffentlicht und Beträge in dieser Währung daher nicht in den Summen enthalten sind, bis sie einen Kurs hat. Fehlt nichts, lautet der Block **Jede verwendete Währung hat einen Kurs.**

Ein Paar gilt als verwendet, wenn eine Budgetzeile, die Zahlen eines Unternehmens oder ein Vertrag es benötigen. Für einen Vertrag sind das die Jahre, die die Vertragsseite zeigt (das laufende Jahr, die beiden folgenden und das Vorjahr, wenn das Budget Zeilen dafür hat), in denen der Vertrag läuft. Die Vertragsseite und dieser Block nennen daher dieselben fehlenden Jahre. Beim Öffnen der Seite fragt KANAP außerdem die Quellen für die Jahre der Liste erneut ab.

### Manuelle Kurse

Wenn keine Quelle einen Kurs veröffentlicht oder Ihre Finanzabteilung eigene Kurse verwendet, können Sie einen Kurs für eine Währung und ein Jahr eingeben.

  1. Klicken Sie in der Tabelle auf die Zelle der Währung und des Jahres oder auf **Kurs eingeben** neben einer Zeile des Blocks der fehlenden Kurse. Der Link **Kurs eingeben** eines Hinweises an anderer Stelle in KANAP führt ebenfalls hierher: Er öffnet den Dialog direkt, wenn der Hinweis nur eine Währung und ein Jahr nennt, und hebt sonst den Block der fehlenden Kurse einige Sekunden hervor.
  2. Geben Sie im Dialog **Manueller Wechselkurs** den Kurs in Ihrer Berichtswährung für 1 Einheit der gewählten Währung ein (zum Beispiel **Kurs in EUR für 1 USD**), mit dem Dezimaltrennzeichen Ihrer Sprache. Hat das Vor- oder Folgejahr einen automatischen Kurs, zeigt das Feld ihn als Anhaltspunkt, zum Beispiel **Automatischer Kurs 2025: 0,9312**. Sonst empfiehlt es den Jahresdurchschnittskurs Ihrer Zentralbank oder Ihres Treasury.
  3. Klicken Sie auf **Speichern**. Die Zelle zeigt dann den Kurs, gefolgt von einem Sternchen (*).

Der Dialog prüft den Wert vor dem Speichern: Ein Kurs ist erforderlich, muss eine Zahl größer als 0 sein, darf 1.000.000.000 nicht überschreiten und darf auf 6 Dezimalstellen gerundet nicht 0 ergeben. Die Meldung unter dem Feld nennt die betroffene Regel.

Ein manueller Kurs ersetzt den automatischen Kurs für dieses Jahr, bis Sie ihn entfernen. Spätere Aktualisierungen überschreiben ihn nicht. Um zum automatischen Kurs zurückzukehren, öffnen Sie die Zelle und klicken Sie auf **Manuellen Kurs entfernen**: Der automatische Kurs wird erneut abgerufen.

Hat das Jahr eingefrorene Budgetversionen, erreicht ein neuer oder entfernter manueller Kurs sie nicht, und die Seite weist darauf hin, zum Beispiel **Die 2 eingefrorenen Versionen von 2026 behalten den Kurs ihres Einfrierens.**

Gut zu wissen:
  - Nur Benutzer der Budgetadministration auf Administratorebene können einen manuellen Kurs eingeben, ändern oder entfernen.
  - Jede Eingabe, Änderung und Entfernung wird im Audit-Protokoll festgehalten.
  - Ein eingefrorenes Jahr behält die beim Einfrieren erfassten Kurse, manuelle und geschätzte eingeschlossen (siehe [Eingefrorene Jahre](#eingefrorene-jahre)).
  - Ein manueller Kurs wird gegenüber der aktuellen Berichtswährung erfasst. Nach einem Wechsel der Berichtswährung gelten die für die frühere erfassten manuellen Kurse nicht mehr. Sie gelten wieder, wenn Sie zu dieser Berichtswährung zurückkehren.
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
  - Wenn **erlaubte Währungen** konfiguriert sind, werden Importe mit nicht gelisteten Codes abgelehnt
  - Die Fehlerantwort enthält die Liste der `allowedCurrencies` zur Klarstellung
  - Berichtswährung und Standardwährungen werden immer akzeptiert

**Beispiel**:
Wenn erlaubte Währungen = `EUR, USD, GBP` und Sie eine Budgetzeile mit `Currency=CHF` importieren, schlägt der Import fehl mit:
```
Currency "CHF" is not allowed. Allowed currencies: EUR, USD, GBP
```

**Tipp**: Exportieren Sie eine Vorlage, prüfen Sie die Liste der erlaubten Währungen und stellen Sie sicher, dass Ihre Importdatei nur diese Codes verwendet.

## Status und historische Daten

Wenn Sie Einstellungen ändern:
  - **Berichtswährung**: Wirkt sich sofort auf die Anzeige aus; gespeicherte Beträge ändern sich nicht, und jedes Jahr wird mit den unter [Umrechnungsmechanismen](#umrechnungsmechanismen-kurzreferenz) beschriebenen Kursen in die neue Währung umgerechnet
  - **Standardwährungen**: Betreffen nur neue Budgetzeilen; bestehende Budgetzeilen behalten ihre Währungen
  - **Erlaubte Währungen**: Bestehende Budgetzeilen werden nicht rückwirkend validiert. Einschränkungen gelten nur für neue oder bearbeitete Budgetzeilen

## Umrechnungsmechanismen (Kurzreferenz)

Beträge werden in ihrer eigenen Währung gespeichert und bei der Anzeige umgerechnet. Jedes Jahr verwendet die zuletzt für dieses Jahr erfassten Kurse, unabhängig davon, wann die Beträge eingegeben wurden. Erfasst eine Synchronisation neue Kurse für ein Jahr, werden die Beträge dieses Jahres ab dann damit umgerechnet, außer das Jahr ist eingefroren (siehe [Eingefrorene Jahre](#eingefrorene-jahre)).

### Vergangene Jahre
Es werden Weltbank-Jahresdurchschnittskurse verwendet. Diese sind stabil und ändern sich nach Veröffentlichung nicht mehr. Solange die Weltbank ein Jahr noch nicht veröffentlicht hat, tritt das nächstgelegene veröffentlichte Jahr an seine Stelle, als Schätzung gekennzeichnet.

### Aktuelles Jahr
Es wird der Live-Kassakurs von ExchangeRate-API verwendet (Fallback auf den neuesten Jahreskurs, als Schätzung gekennzeichnet, falls nicht verfügbar). Aktualisiert sich, wenn Sie **Wechselkurssynchronisierung erzwingen** ausführen, oder bei der automatischen 30-Tage-Aktualisierung.

### Zukünftige Jahre
Der Kurs des aktuellen Jahres wird als Forward-Schätzung wiederverwendet. Dies bietet Orientierung für die Budgetplanung, sollte aber überprüft werden, wenn diese Jahre näher rücken.

### Eingefrorene Jahre
Das Einfrieren der Standard-Budgetspalte eines Jahres schreibt die Kurse dieses Jahres für den eingefrorenen Typ (OPEX oder CAPEX) fest: KANAP aktualisiert die Kurse des Jahres und behält diesen Satz dann für alle Beträge des Jahres, auch wenn neuere Kurse eintreffen. Wechselt die Berichtswährung später, behalten diese Beträge die eingefrorenen Kurse und werden dann zum Kurs der früheren Berichtswährung im selben Jahr in die neue umgerechnet. Fehlt dieser Kurs, sind sie in keiner Summe enthalten und werden wie jeder fehlende Kurs genannt: Die frühere Berichtswährung erscheint dann für dieses Jahr im Block der fehlenden Kurse, und ein manueller Kurs schließt die Lücke. Das Auftauen der Standardspalte gibt sie wieder frei. Siehe [Das Einfrieren der Standardspalte schreibt die Wechselkurse fest](budget-operations.md#das-einfrieren-der-standardspalte-schreibt-die-wechselkurse-fest).

**Fehlender Kurs**: Hat ein Jahr keinen Kurs für eine verwendete Währung, sind die Beträge der Budgetzeilen in dieser Währung für dieses Jahr in keiner Summe in der Berichtswährung enthalten. Das betrifft die Liste der Budgetzeilen, den Bereich Budgetverwaltung der Startseite, die Budget- und Leistungsverrechnungsberichte, die Verträge und die Reiter Beziehungen der Anwendungen und Technologien. Der Bildschirm weist dort darauf hin, wo es zählt:

- Ein einzeiliger Hinweis nennt, was ausgeschlossen ist, zum Beispiel „3 Zeilen ohne Wechselkurs ausgeschlossen: USD 2026.“ Er erscheint unter den Summen der Liste der Budgetzeilen, auf den Kacheln der Übersicht, oben in jedem Budget- und Leistungsverrechnungsbericht und unter den Budgetzahlen von Verträgen, Anwendungen und Technologien. Benutzer der Budgetadministration auf Administratorebene sehen außerdem **Kurs eingeben**, das diese Seite beim fehlenden Kurs öffnet.
- In der Zeile selbst erscheint der Betrag in seiner eigenen Währung mit einer kleinen orangefarbenen Markierung. Fahren Sie mit der Maus über die Markierung, um zum Beispiel „Kein Wechselkurs für USD im Jahr 2026: nicht in den Summen enthalten.“ zu lesen.

KANAP ruft die Kurse dieses Jahres im Hintergrund ab (höchstens einmal alle sechs Stunden je Jahr), sodass die nächste Anzeige den neuen Kurs verwendet, sobald die Quelle ihn veröffentlicht. Um fehlende Kurse zu erkennen, prüfen Sie den Block der fehlenden Kurse über der FX-Kurs-Snapshot-Tabelle und führen Sie **Wechselkurssynchronisierung erzwingen** aus, um die Kurse sofort abzurufen. Ein [manueller Kurs](#manuelle-kurse) behebt das Problem umgehend.

## Den Assistenten fragen

[Plaid](ai-assistant.md#tool-calls) liest die Währungen und Kurse dieser Seite für alle mit Leserecht auf das Budget. Fragen Sie zum Beispiel: „Wie hoch ist der USD-Kurs für 2026?“

## Tipps

  - **Berichtswährung einmal festlegen**: Eine Änderung mitten im Jahr betrifft alle Berichte. Wenn Sie sie ändern müssen, tun Sie dies am Jahresende.
  - **Standardwährungen sparen Zeit**: Setzen Sie sie auf die Währungen, die Ihre Teams am häufigsten verwenden.
  - **Währungen bewusst einschränken**: Verwenden Sie erlaubte Währungen nur, wenn Sie einen klaren Grund haben (z. B. FX-Datenabdeckung, Compliance, Standardisierung).
  - **Wechselkurssynchronisierung vorausschauend erzwingen**: Nach dem Hinzufügen von Währungen, vor der Berichtserstellung oder wenn Kurse veraltet erscheinen.
  - **FX-Snapshot-Tabelle prüfen**: Verwenden Sie sie, um zu überprüfen, ob Kurse plausibel und vollständig sind, bevor Sie Berichte finalisieren.
  - **Konsistente ISO-Codes verwenden**: Verwenden Sie immer 3-stellige Codes (EUR, USD, GBP), niemals Symbole (€, $, £) oder numerische Codes.

## Häufige Szenarien

### Szenario 1: Berichtswährung ändern
Ihr Konzern wechselt von EUR-basierter zu USD-basierter Berichterstattung.

**Schritte**:
  1. Gehen Sie zu **Budgetverwaltung > Administration > Währungen**
  2. Ändern Sie die Berichtswährung von `EUR` auf `USD`
  3. Klicken Sie auf **Speichern**, lesen Sie den Bestätigungsdialog (manuelle Kurse, die nicht mehr gelten, eingefrorene Versionen) und klicken Sie dann auf **Währung ändern**
  4. Lesen Sie das Ergebnis des Kursabrufs. Geben Sie für jedes noch fehlende Paar einen manuellen Kurs ein oder führen Sie später **Wechselkurssynchronisierung erzwingen** aus
  5. Prüfen Sie, dass die FX-Kurs-Snapshot-Tabelle jetzt Kurse in USD zeigt (jeder Kurs ist relativ zu USD)
  6. Prüfen Sie OPEX- und CAPEX-Listen: Summen und Jahresspalten zeigen nun USD

**Ergebnis**: Alle Berichte, Dashboards und Listen zeigen USD. Ihre gespeicherten Zeilendaten (eigene Währung jeder Budgetzeile) bleiben unverändert.

### Szenario 2: Währungen aus Compliance-Gründen einschränken
Ihre Finanzabteilung verlangt, dass alle Ausgaben nur in EUR, USD oder GBP erfasst werden.

**Schritte**:
  1. Gehen Sie zu **Budgetverwaltung > Administration > Währungen**
  2. Setzen Sie erlaubte Währungen auf `EUR, USD, GBP`
  3. Klicken Sie auf **Speichern**
  4. Führen Sie **Wechselkurssynchronisierung erzwingen** durch, um sicherzustellen, dass Kurse für alle drei Währungen verfügbar sind

**Ergebnis**: Benutzer können beim Erstellen oder Bearbeiten von Budgetzeilen nur EUR, USD oder GBP auswählen. Versuche, andere Währungen zu importieren, schlagen mit einer klaren Fehlermeldung fehl.

### Szenario 3: Neue Währung mitten im Jahr hinzufügen
Ihr Unternehmen beginnt Geschäftstätigkeit in der Schweiz und muss CHF-Ausgaben erfassen.

**Schritte**:
  1. Gehen Sie zu **Budgetverwaltung > Administration > Währungen**
  2. Fügen Sie `CHF` zu den erlaubten Währungen hinzu (z. B. `EUR, USD, GBP, CHF`)
  3. Klicken Sie auf **Speichern**
  4. Klicken Sie auf **Wechselkurssynchronisierung erzwingen**, um CHF-Kurse sofort abzurufen
  5. Überprüfen Sie, dass CHF in der FX-Kurs-Snapshot-Tabelle mit gültigen Kursen erscheint

**Ergebnis**: Benutzer können jetzt CHF für neue Budgetzeilen auswählen. Die FX-Kurs-Tabelle enthält CHF mit aktuellen und historischen Kursen für genaue Umrechnungen.

### Szenario 4: Vorbereitung auf jährliche Budgetzyklen
Es ist Dezember, und Sie bereiten die Budgetplanung für das nächste Jahr vor.

**Schritte**:
  1. Gehen Sie zu **Budgetverwaltung > Administration > Währungen**
  2. Klicken Sie auf **Wechselkurssynchronisierung erzwingen**, um die Kurse für das kommende Jahr zu aktualisieren
  3. Prüfen Sie die FX-Kurs-Snapshot-Tabelle, um die Forward-Schätzungen für das nächste Jahr zu sehen
  4. Beachten Sie, dass Kurse für zukünftige Jahre Forward-Schätzungen sind (Wiederverwendung des Kurses des aktuellen Jahres). Überprüfen Sie sie, wenn das Jahr näher rückt

**Ergebnis**: Ihre Budgetprognosen für das nächste Jahr verwenden die aktuellsten verfügbaren Kurse. Teams können CAPEX und OPEX mit vernünftigen Währungsannahmen planen.

## Häufig gestellte Fragen

**F: Was passiert, wenn ich die Berichtswährung mitten im Jahr ändere?**
A: Alle Berichte und Listen werden sofort in die neue Währung umgerechnet. Historische Daten bleiben erhalten: nur die Anzeigewährung ändert sich. Eingefrorene Budgetversionen behalten ihre eingefrorenen Kurse, zum Kurs des jeweiligen Jahres umgerechnet, und für die frühere Währung erfasste manuelle Kurse gelten nicht mehr, bis Sie diese Währung erneut wählen. Planen Sie diese Änderung sorgfältig, um Verwirrung während aktiver Berichtszeiträume zu vermeiden.

**F: Kann ich verschiedene Berichtswährungen für verschiedene Unternehmen festlegen?**
A: Nein. Die Berichtswährung ist mandantenweit. Alle Unternehmen, Berichte und Summen verwenden dieselbe Berichtswährung. Einzelne Budgetzeilen speichern ihre eigene Währung, aber Umrechnungen zielen immer auf die Berichtswährung des Mandanten.

**F: Warum sehe ich keine Kurse für eine bestimmte Währung?**
A: Die Datenquelle (Weltbank oder ExchangeRate-API) veröffentlicht diese Währung möglicherweise nicht. Prüfen Sie, ob der ISO-Code korrekt und allgemein veröffentlicht ist. Erwägen Sie bei Bedarf, erlaubte Währungen auf Codes mit zuverlässiger Datenabdeckung zu beschränken.

**F: Wie oft werden FX-Kurse automatisch aktualisiert?**
A: Alle 30 Tage, wenn sich ein Benutzer anmeldet, aktualisiert das System die Kurse für J-1, J und J+1. Ein Jahr, dem der Kurs einer verwendeten Währung fehlt, wird außerdem abgerufen, sobald eine Liste, ein Bericht oder die Vertragsseite ihn braucht, und wenn Sie diese Seite öffnen. Sie können auch jederzeit mit **Wechselkurssynchronisierung erzwingen** eine Aktualisierung auslösen.

**F: Beeinflussen FX-Kursänderungen meine gespeicherten Daten?**
A: Nein. Wechselkurse beeinflussen nur **Umrechnung und Anzeige**. Jede OPEX- und CAPEX-Zeile speichert ihre eigene Währung und Beträge, die sich bei Kursaktualisierungen nie ändern. Nur die angezeigten umgerechneten Werte in Berichten und Listen ändern sich.

**F: Kann ich historische Kurse manuell importieren?**
A: Ein Import von Kursen aus einer Datei ist nicht verfügbar. Sie können auf dieser Seite für jede Währung und jedes Jahr einen manuellen Kurs eingeben (siehe [Manuelle Kurse](#manuelle-kurse)). Ein manueller Kurs ersetzt den automatischen Kurs, bis Sie ihn entfernen.

**F: Was, wenn ich eine Währung verwenden muss, die nicht in der erlaubten Liste steht?**
A: Fügen Sie sie entweder zu den erlaubten Währungen hinzu oder lassen Sie die Liste leer (was alle Währungen zulässt). Denken Sie daran, nach dem Hinzufügen neuer Währungen **Wechselkurssynchronisierung erzwingen** auszuführen, um Kurse zu befüllen.

**F: Sind Forward-Schätzungen für zukünftige Jahre genau?**
A: Forward-Schätzungen verwenden den Kurs des aktuellen Jahres wieder und sollten als **Planungsannahmen** behandelt werden, nicht als Prognosen. Überprüfen Sie sie, wenn zukünftige Jahre näher rücken und Kurse aus offiziellen Quellen verfügbar werden.
