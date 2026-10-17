# Supportende

Der Bericht Supportende listet, was das Ende seines Supports erreicht hat oder bald erreicht, und was jedes Element betrifft: die Server, auf denen es läuft, und die Anwendungen, die davon abhängen. Eine zweite Ansicht listet die fehlenden Daten, die den Bericht an einer Antwort hindern.

Öffnen Sie ihn über **IT-Landschaft > Supportende**, in der Gruppe **Betrieb**. Sie benötigen `infrastructure:reader`. Die Spalten und Zeilen zu Anwendungen erscheinen nur, wenn Sie auch Anwendungen lesen dürfen.

## Fristen

Die Ansicht **Fristen** zeigt eine Zeile pro Element, dessen Support beendet ist oder innerhalb des Zeitraums endet. Der Untertitel nennt den letzten Tag, den der Zeitraum abdeckt.

Was der Bericht überwacht:

| Typ | Was endet | Woher das Datum stammt |
|---|---|---|
| **Technologie** | Eine Version im Einsatz auf einem Server in Betrieb oder von einer Anwendung in Betrieb deklariert | Das Ende des Standard- und des erweiterten Supports der Version, auf der [Technologie](technologies.md#ubersicht) |
| **Betriebssystem** | Das Betriebssystem eines Servers in Betrieb | Die Liste der Betriebssysteme unter **IT-Landschaft > Einstellungen** |
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

- Eine Technologieversion betrifft die Server, die sie tragen (einschließlich der virtuellen Maschinen in einem Host, der sie trägt), und die Anwendungen, die darauf gehostet werden oder sie deklarieren.
- Ein Betriebssystem oder eine Hardware betrifft ihre Server, was diese enthalten, und die Anwendungen, die auf all diesen bereitgestellt sind.
- Eine Anwendung betrifft die Server, auf denen sie bereitgestellt ist.

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

**Tabelle als CSV exportieren** lädt die angezeigte Liste herunter: die Fristen mit dem aktuellen Zeitraum und Typ oder die fehlenden Daten. Die Spaltenköpfe folgen der Sprache Ihres Bildschirms. **Drucken / Als PDF speichern** druckt den Bericht.

## Tipps

- **Zuerst die fehlenden Daten klären**: Ein Server ohne seine Technologien oder eine Version ohne Datum erscheint nie in den Fristen.
- **Für Budgets 24 Monate vorausschauen**: Eine Migration im nächsten Jahr braucht ihr Geld im Budget dieses Jahres.
- **Den Katalog nutzen**: Aus dem Katalog hinzugefügte Technologien bringen ihre Supportende-Daten mit.
