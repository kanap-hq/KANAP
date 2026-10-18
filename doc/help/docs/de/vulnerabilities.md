# Schwachstellen

Die Seite Schwachstellen listet die veröffentlichten Schwachstellen (CVE), die die Versionen Ihrer Technologien im Einsatz betreffen, und was jede erreicht: die Server, die eine betroffene Version tragen, und die Anwendungen, die sie nutzen. Sie prüfen jede Schwachstelle und halten fest, was Sie dagegen unternommen haben.

Öffnen Sie sie über **IT-Landschaft > Schwachstellen**, in der Gruppe **Betrieb**. Sie benötigen `infrastructure:reader` zum Ansehen und `infrastructure:member` zum Ändern eines Status. Die Anzahlen und Listen der Anwendungen erscheinen nur, wenn Sie auch Anwendungen lesen dürfen.

## Verfügbarkeit

In der Cloud werden Schwachstellen standardmäßig verfolgt. Bei einer On-Premise-Installation sind sie aus, bis Ihr Administrator [sie einschaltet](on-premise/configuration.md#optional-vulnerabilities); der Server muss dann die NVD (die US-amerikanische National Vulnerability Database) oder einen Spiegel davon erreichen. Solange sie aus sind, zeigt KANAP nichts davon: keine Seite, keine Spalte in der Technologieliste, keinen Abschnitt bei einer Technologie, keine Benachrichtigungseinstellung und keine E-Mail.

## Wie KANAP sie findet

KANAP liest alle 6 Stunden die von der NVD veröffentlichten Schwachstellen und vergleicht sie mit Ihren Technologien:

- **Produkte**: Eine Technologie wird über ihre CPE-Produktkennungen verglichen (siehe [Technologien](technologies.md#ubersicht)). Eine Technologie ohne Kennung erhält keine Schwachstelle. Die Betriebssysteme des Katalogs haben noch keine, daher werden sie nicht abgeglichen. Außer Betrieb genommene Technologien bleiben außen vor.
- **Versionen**: Nur die Versionen im Einsatz zählen: installiert auf einem Server in Betrieb oder genutzt von einer Anwendung in Betrieb.
- **Versionsnummern**: Versionen werden über ihre Zahlen verglichen, Teil für Teil. `2016 SP3` zählt als 2016 und `19c` als 19. Eine Version mit weniger als drei Zahlen steht für ihren ganzen Zweig: `9.0` umfasst alle `9.0.x`. Eine Version, die KANAP nicht vergleichen kann, etwa eine Bezeichnung ohne Zahl, gilt als betroffen.
- **Unbekannte Version**: Ein Server oder eine Anwendung ohne Version ist potenziell von jeder Schwachstelle des Produkts betroffen. Die Zeile zeigt in der Spalte **Version** **Nicht erfasst**.

Manche Schwachstellen gelten nur, wenn zwei Produkte zusammen laufen, zum Beispiel Tomcat unter Windows. KANAP zeigt sie für das verwundbare Produkt allein, sodass eine Schwachstelle bei einer Installation erscheinen kann, die sie nicht betrifft. Markieren Sie sie als **Nicht betroffen**.

Eine Schwachstelle, die die NVD noch nicht analysiert hat, erscheint, sobald sie analysiert ist.

Änderungen zählen sofort. Wenn Sie eine Technologie oder eine CPE-Produktkennung hinzufügen, sucht KANAP dieses Produkt sofort in der NVD; der Abschnitt **Schwachstellen** der Technologie zeigt „Suche nach Schwachstellen läuft…“, bis die Suche endet. Wenn sich eine Version, ein Server oder eine Anwendung einer Technologie ändert, gleicht KANAP die Technologie erneut ab, sobald die Änderung gespeichert ist. **Erneut abgleichen** bei der Technologie tut dasselbe von Hand.

## Die Liste

Die Liste nutzt das Standardraster: eine Zeile pro Technologie, Version und Schwachstelle, die schwerste zuerst. Eine Schwachstelle, die drei Versionen von SQL Server betrifft, ergibt drei Zeilen, jede mit ihrem eigenen Status. Sie öffnet sich mit den Zeilen **Zu prüfen**: Leeren Sie den Filter der Spalte **Status**, um die anderen zu sehen.

**Spalten**:

| Spalte | Was sie zeigt |
|---|---|
| **CVE** | Die Kennung der Schwachstelle, zum Beispiel `CVE-2024-1234` |
| **Schweregrad** | **Kritisch**, **Hoch**, **Mittel**, **Niedrig**, **Keine** oder **Nicht bewertet** |
| **Score** | Der CVSS-Wert. Standardmäßig ausgeblendet |
| **Zusammenfassung** | Die Beschreibung der NVD |
| **Technologie** | Die betroffene Technologie |
| **Version** | Die betroffene Version. **Nicht erfasst**, wenn ein Server oder eine Anwendung die Technologie ohne Angabe der Version nutzt: Die Zeile ist dann möglicherweise betroffen |
| **Hersteller** | Der Hersteller der Technologie. Standardmäßig ausgeblendet |
| **Server** | Wie viele Server diese Version tragen, direkt oder über den Server, in dem sie laufen |
| **Anwendungen** | Wie viele Anwendungen diese Version nutzen, gehostet oder deklariert |
| **Status** | **Zu prüfen**, **Behandelt** oder **Nicht betroffen** |
| **Notiz** | Die Notiz der Zeile. Standardmäßig ausgeblendet |
| **Veröffentlicht** | Das Veröffentlichungsdatum |

**Filter**: Jede Spalte hat ihren eigenen Filter unter ihrer Überschrift. **Schweregrad**, **Technologie**, **Version**, **Hersteller** und **Status** bieten Kontrollkästchen (**Version** bietet auch **Nicht erfasst**), **Score** eine Zahl, **Veröffentlicht** ein Datum, **CVE** und **Zusammenfassung** einen Text. Das Suchfeld über dem Raster durchsucht die CVE-Kennung, die Zusammenfassung und den Technologienamen.

**Sortieren** nach **Schweregrad**, **Score**, **Veröffentlicht**, **CVE** oder **Technologie**. Die Spaltenauswahl blendet Spalten ein oder aus, und das Raster merkt sich Ihre Wahl.

**Links**: Die Seite liest ihre Filter aus ihrer Adresse, sodass Sie eine gefilterte Liste teilen können. `?technology=TEC-4` behält eine Technologie, `?version=none` die Zeilen ohne erfasste Version, `?state=all` alle Status, `?period=30` die in den letzten 30 Tagen veröffentlichten Schwachstellen. Der Link der E-Mails nutzt `period`.

## Den Status mehrerer Zeilen ändern

Mit `infrastructure:member` kreuzen Sie die zu ändernden Zeilen an. Das Kästchen in der Überschrift wählt alle Zeilen des Filters aus, auch die noch nicht geladenen; danach können Sie einzelne abwählen. Ein Hinweis über dem Raster zeigt, wie viele Zeilen ausgewählt sind, und **Auswahl aufheben** leert sie.

**Status ändern (n)** fragt dann nach:

- Dem zu setzenden **Status**.
- Einer **Gemeinsamen Notiz**, optional. Ohne Notiz behält jede Zeile ihre eigene.

Bevor Sie bestätigen, sagt das Fenster, wie viele Zeilen die Änderung betrifft, bei wie vielen Schwachstellen. Eine Zeile, die nach dieser Zählung gefunden wird, bleibt unverändert. Über 5.000 Zeilen grenzen Sie die Filter ein oder wählen weniger Zeilen aus.

Zum Beispiel, um alle nicht erfassten Versionen von PostgreSQL als nicht betroffen zu markieren: Filtern Sie **Technologie** auf PostgreSQL und **Version** auf **Nicht erfasst**, kreuzen Sie das Kästchen in der Überschrift an, klicken Sie auf **Status ändern**, wählen Sie **Nicht betroffen** und schreiben Sie den Grund in die Notiz.

## Eine Schwachstelle prüfen

Ein Klick auf eine Zeile öffnet ihre Schwachstelle in einem Seitenbereich. Der Bereich umfasst alle Technologien und Versionen, die die Schwachstelle betrifft. Sie sehen:

- Die Zusammenfassung, den CVSS-Vektor und die Referenzlinks (Herstellerhinweise, Patches).
- **Technologien und Versionen**: jede betroffene Version mit ihrem **Status** und einer Notiz.
- **Server**: jeder Server, der eine betroffene Version trägt, mit Technologie, Version und dem Server, in dem er läuft.
- **Anwendungen**: jede Anwendung, die eine betroffene Version nutzt, mit ihrem Server.

Legen Sie den Status jeder Version fest:

| Status | Bedeutung |
|---|---|
| **Zu prüfen** | Niemand hat sie bisher angesehen |
| **Behandelt** | Die Version ist gepatcht, oder ein Workaround ist eingerichtet |
| **Nicht betroffen** | Die Schwachstelle gilt nicht für Ihre Installation |

Die Notiz hält fest, wie, zum Beispiel „am 12. März gepatcht, Change CHG-123“. Sie wird gespeichert, wenn Sie das Feld verlassen. Das Audit-Log hält fest, wer einen Status geändert hat und wann.

KANAP ändert nie einen Status, den Sie gewählt haben. Wenn eine Version nicht mehr passt (Sie haben sie aktualisiert, die Technologie wurde außer Betrieb genommen, die NVD hat ihre Daten geändert), verschwindet eine Zeile, die noch **Zu prüfen** ist. Eine geprüfte Zeile bleibt, ausgegraut, mit ihrem Status; sie kehrt unverändert zurück, wenn die Version wieder passt.

## Export

**CSV exportieren** lädt die Schwachstellen herunter, die den Filtern entsprechen, eine Zeile pro Zeile des Rasters, in seiner Reihenfolge, in der Sprache Ihres Bildschirms. Ab 10.000 Schwachstellen grenzen Sie die Filter zuerst ein.

## E-Mail-Benachrichtigungen

Nach jeder Prüfung erhalten die IT-Verantwortlichen einer Technologie eine E-Mail über ihre neuen kritischen oder hohen Schwachstellen, die noch zu prüfen sind:

- **Was gemeldet wird**: eine Schwachstelle, die in den letzten 30 Tagen veröffentlicht wurde, zu einem Produkt, mit dem die Technologie bereits verglichen wurde, oder eine bekannte Schwachstelle, die gerade kritisch oder hoch geworden ist.
- **Was nicht**: Der erste Vergleich einer Technologie, oder einer gerade hinzugefügten CPE-Kennung, bleibt still. Seine Ergebnisse warten auf dieser Seite.
- **Wie viel**: höchstens 25 Zeilen, eine pro Technologie und Schwachstelle, dann ein Link zur Seite, gefiltert auf die in den letzten 30 Tagen veröffentlichten Schwachstellen.
- **Wie oft**: Jede Person erfährt von einer Schwachstelle einer Technologie einmal. Eine Schwachstelle, die bei ihrer Prüfung nicht gemeldet wurde, wird auch später nicht gemeldet.

Empfänger sind die IT-Verantwortlichen der Technologie, deren Konto aktiv ist und die die Infrastruktur lesen dürfen. Jeder kann diese E-Mails unter **Technologie-Benachrichtigungen** in seinen Benachrichtigungseinstellungen abschalten. Siehe [Einstellungen](admin.md#benachrichtigungen). Solange der E-Mail-Versand auf Ihrer Installation nicht eingerichtet ist, geht keine E-Mail hinaus.

## Wo Schwachstellen außerdem erscheinen

- **Technologieliste**: die Spalte **Zu prüfende Schwachstellen**, orange, wenn kritische oder hohe darunter sind. Siehe [Technologien](technologies.md#mit-der-liste-arbeiten).
- **Technologie-Arbeitsbereich**: der Abschnitt **Schwachstellen** im Reiter Beziehungen. Siehe [Technologien](technologies.md#schwachstellen).

## Tipps

- **CPE-Kennungen ausfüllen**: Technologien aus dem Katalog bringen sie mit, außer den Betriebssystemen. Für die anderen suchen Sie das Produkt im CPE-Wörterbuch des NIST.
- **Versionen erfassen**: Ein Server oder eine Anwendung ohne Version ist potenziell von allem betroffen, was die tatsächliche Gefährdung verdeckt.
- **Die Notiz schreiben**: Wer die Schwachstelle als Nächstes liest, sieht, was getan wurde.
