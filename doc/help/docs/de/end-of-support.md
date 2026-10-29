# Supportende

Der Bericht Supportende listet, was das Ende seines Supports erreicht hat oder bald erreicht, und was jedes Element betrifft: die Server, auf denen es läuft, und die Anwendungen, die davon abhängen. Eine zweite Ansicht listet die fehlenden Daten, die den Bericht an einer Antwort hindern.

Öffnen Sie ihn über **IT-Landschaft > Supportende**, in der Gruppe **Betrieb**. Sie benötigen `infrastructure:reader`. Die Spalten und Zeilen zu Anwendungen erscheinen nur, wenn Sie auch Anwendungen lesen dürfen.

## Fristen

Die Ansicht **Fristen** zeigt eine Zeile pro Element, dessen Support beendet ist oder innerhalb des Zeitraums endet. Der Untertitel nennt den letzten Tag, den der Zeitraum abdeckt.

Was der Bericht überwacht:

| Typ | Was endet | Woher das Datum stammt |
|---|---|---|
| **Technologie** | Eine Version im Einsatz auf einem Server in Betrieb oder von einer Anwendung in Betrieb deklariert | Das Ende des Standard- und des erweiterten Supports der Version, auf der [Technologie](technologies.md#ubersicht) |
| **Betriebssystem** | Eine Version eines Betriebssystems, die auf einem Server in Betrieb läuft | Das Ende des Standard- und des erweiterten Supports der Version, an der Technologie der Familie **Betriebssystem** |
| **Anwendung** | Eine Anwendung in Betrieb | Ihr Supportende-Datum |
| **Hardware** | Ein physisches Asset in Betrieb | Sein Lebensende oder das Ende seines Supportvertrags, in der Spalte **Version** angezeigt |

Ausgemusterte Assets, deaktivierte Anwendungen und Versionen, die niemand nutzt, bleiben außen vor.

**Filter**:

- **Typ**: einer der vier Typen oder **Alle Typen**.
- **Zeitraum**: 6, 12, 24 oder 36 Monate. Standardmäßig 12 Monate.

**Spalten**: **Typ**, **Element** (öffnet den Datensatz), **Version**, **Enddatum**, **Status**, **Server** und **Anwendungen** (wie viele jedes Element betrifft).

**Status**:

- **Ohne Support**: Alle Enddaten sind überschritten.
- **Erweiterter Support**: Der Standardsupport ist beendet, der erweiterte Support läuft noch.
- **Endet bald**: Der Support endet innerhalb des Zeitraums.

**Was ein Element betrifft**: Klicken Sie auf eine Zeile, um die Server und Anwendungen hinter ihren Zählern aufzuklappen. Jeder Name öffnet seinen Datensatz.

- Eine Technologieversion betrifft die Server, auf denen sie installiert ist, und die Anwendungen, die sie deklarieren oder auf einem Server gehostet werden, der sie trägt (einschließlich der virtuellen Maschinen in einem solchen Server).
- Ein Betriebssystem betrifft die Server, die diese Version nutzen, und die Anwendungen, die auf ihnen und auf dem, was sie enthalten, bereitgestellt sind. Seine Zeile öffnet die Technologie.
- Eine Hardware betrifft ihre Server, was diese enthalten, und die Anwendungen, die auf all diesen bereitgestellt sind. Die Hardware selbst ist keiner ihrer Server.
- Eine Anwendung betrifft die Server, auf denen sie bereitgestellt ist. Bei einem Cluster sind das der Cluster und seine Mitglieder in Betrieb.

Die Server einer Technologie oder eines Betriebssystems werden wie in der Spalte **Server** der [Technologieliste](technologies.md) gezählt: die Server in Betrieb, auf denen die Version installiert ist, ohne Cluster. Die Server einer Hardware sind die Assets, die sie trägt, ohne Cluster. Die Anwendungen eines Clusters zählen weiterhin.

## Fehlende Daten

Die Ansicht **Fehlende Daten** listet die Datensätze, die zu ergänzen sind, damit die Fristen stimmen. Klicken Sie auf eine Zeile, um den Datensatz zu öffnen.

| Fehlende Daten | Was es bedeutet |
|---|---|
| **Gehostete Anwendung ohne Server** | Eine On-Premises oder in einer Private Cloud gehostete Anwendung hat keinen Server auf einer Bereitstellung in Betrieb |
| **Virtuelle Maschine ohne Host** | Kein Asset enthält diese virtuelle Maschine |
| **On-Premises-Technologie auf keinem Server** | Eine Technologie mit einem Hosting-Typ vor Ort (On-Premise, Colocation) läuft auf keinem Server |
| **Technologie ohne Hosting-Typ der IT-Einstellungen** | Der Hosting-Typ der Technologie steht nicht mehr in der Liste **Hosting-Typen** der Einstellungen. Wählen Sie bei der Technologie einen anderen |
| **Datenbankserver ohne Datenbanktechnologie** | Ein Server hat eine Datenbankrolle für eine Anwendung, trägt aber keine Technologie der Familie **Datenbank** |
| **Anwendung mit SSO ohne Identitätstechnologie** | Eine Anwendung nutzt SSO und hat keine Technologie der Familie **Verzeichnis und Identität** |
| **Technologieverknüpfung ohne Version** | Ein Server oder eine Anwendung nutzt eine Technologie, ohne die Version anzugeben |
| **Version im Einsatz ohne Supportende-Datum** | Der Bericht kann nicht sagen, wann diese Version endet |

Die Zeilen zu Anwendungen erfordern das Recht, Anwendungen zu lesen.

## Export und Druck

**Tabelle exportieren** lädt die angezeigte Liste als CSV- oder Excel-Datei herunter: die Fristen mit dem aktuellen Zeitraum und Typ oder die fehlenden Daten. Die Spaltenköpfe folgen der Sprache Ihres Bildschirms, und Datumsangaben sind in der Excel-Datei echte Datumswerte; sie fügt ein Blatt **Parameter** hinzu. Siehe [Berichte](reports.md#export-options). **Drucken / Als PDF speichern** druckt den Bericht.

## Den Assistenten fragen

[Plaid](ai-assistant.md) liest beide Ansichten, **Fristen** und **Fehlende Daten**, mit denselben Rechten wie der Bericht. Es nennt jedes Element mit seiner Referenz (`APP-4`, `AST-12`, `TEC-3`) und liest einen Zeitraum auf einmal: 6, 12, 24 oder 36 Monate. Plaid listet die Fristen 30 auf einmal und kann die folgenden Seiten lesen; seine Anzahlen und Summen decken jede Frist ab. Wenn Sie keine Anwendungen lesen dürfen, sagt Plaid, dass es die Zeilen der Anwendungen ausgelassen hat.

Plaid kann auch Versionen von Technologien hinzufügen und ihre Supportdaten korrigieren, mit Ihrer Genehmigung. Das Supportende einer Anwendung ist ein Feld der Anwendung: Plaid ändert es, wie es die Anwendung ändert, mit den Rechten der Seite [Anwendungen](applications.md).

Fragen Sie zum Beispiel: „Welche Anwendungen erreichen in den nächsten sechs Monaten ihr Supportende?“, „Fristen zum Supportende der nächsten zwölf Monate nach Typ“, „Welche Datensätze muss ich für den Bericht zum Supportende vervollständigen?“, „Die Version 16 von PostgreSQL endet im Support am 31.12.2028“ oder „Lösche das Ende des erweiterten Supports der Version 14 von TEC-3“.

## Tipps

- **Zuerst die fehlenden Daten klären**: Ein Server ohne seine Technologien oder eine Version ohne Datum erscheint nie in den Fristen.
- **Für Budgets 24 Monate vorausschauen**: Eine Migration im nächsten Jahr braucht ihr Geld im Budget dieses Jahres.
- **Den Katalog nutzen**: Aus dem Katalog hinzugefügte Technologien bringen ihre Supportende-Daten mit. Sie stammen von endoflife.date oder, für die von KANAP gepflegten Produkte, von den offiziellen Seiten des Herstellers (siehe [Versionen aus dem Katalog](technologies.md#versionen-aus-dem-katalog)).
