# Schwachstellen

Die Seite Schwachstellen listet die veröffentlichten Schwachstellen (CVE), die die Versionen Ihrer Technologien im Einsatz betreffen, und was jede erreicht: die Server, die eine betroffene Version tragen, und die Anwendungen, die sie nutzen. Sie prüfen jede Schwachstelle und halten fest, was Sie dagegen unternommen haben.

Öffnen Sie sie über **IT-Landschaft > Schwachstellen**, in der Gruppe **Betrieb**. Sie benötigen `infrastructure:reader` zum Ansehen und `infrastructure:member` zum Ändern eines Status. Die Anzahlen und Listen der Anwendungen erscheinen nur, wenn Sie auch Anwendungen lesen dürfen.

## Verfügbarkeit

In der Cloud werden Schwachstellen standardmäßig verfolgt. Bei einer On-Premise-Installation sind sie aus, bis Ihr Administrator [sie einschaltet](on-premise/configuration.md#optional-vulnerabilities); der Server muss dann die NVD (die US-amerikanische National Vulnerability Database) oder einen Spiegel davon erreichen. Derselbe Schalter liest auch drei Quellen zur Ausnutzung, oder jeweils einen Spiegel: den Katalog der CISA, die europäische Schwachstellendatenbank der ENISA und die täglichen EPSS-Werte. Solange sie aus sind, zeigt KANAP nichts davon: keine Seite, keine Spalte in der Technologieliste, keinen Abschnitt bei einer Technologie, keine Benachrichtigungseinstellung und keine E-Mail.

## Wie KANAP sie findet

KANAP liest alle 6 Stunden die von der NVD veröffentlichten Schwachstellen und vergleicht sie mit Ihren Technologien:

- **Produkte**: Eine Technologie wird über ihre CPE-Produktkennungen verglichen (siehe [Technologien](technologies.md#ubersicht)). Eine Technologie ohne Kennung erhält keine Schwachstelle. Die Betriebssysteme des Katalogs haben sie ebenfalls. SUSE Linux Enterprise Server hat keine: die NVD veröffentlicht zu wenige seiner Schwachstellen für einen verlässlichen Abgleich. Außer Betrieb genommene Technologien bleiben außen vor.
- **Versionen**: Nur die Versionen im Einsatz zählen: installiert auf einem Server in Betrieb oder genutzt von einer Anwendung in Betrieb.
- **Versionsnummern**: Versionen werden über ihre Zahlen verglichen, Teil für Teil. `2016 SP3` zählt als 2016 und `19c` als 19. Eine Version mit weniger als drei Zahlen steht für ihren ganzen Zweig: `9.0` umfasst alle `9.0.x`. Eine Version, die KANAP nicht vergleichen kann, etwa eine Bezeichnung ohne Zahl, gilt als betroffen.
- **Betriebssysteme**: Red Hat Enterprise Linux, Debian, Oracle Linux, AlmaLinux, Rocky Linux und CentOS werden über ihre Hauptversion verglichen, Ubuntu über Jahr und Monat, so wie die NVD sie veröffentlicht: `9.4` erhält die Schwachstellen von `9`, und `22.04.3 LTS` die von `22.04`. Windows Server wird nur über sein Jahr verglichen, da KANAP nicht weiß, welche Updates ein Server hat: Eine Version `2019` ist von jeder Schwachstelle von Windows Server 2019 betroffen, auch von denen, die ein Update bereits behoben hat. 2012 und 2012 R2 werden über ihre Bezeichnung unterschieden, ebenso 2008 und 2008 R2.
- **Unbekannte Version**: Ein Server oder eine Anwendung ohne Version ist potenziell von jeder Schwachstelle des Produkts betroffen. Die Zeile zeigt in der Spalte **Version** **Nicht erfasst**.

Manche Schwachstellen gelten nur, wenn zwei Produkte zusammen laufen, zum Beispiel Tomcat unter Windows. KANAP zeigt sie für das verwundbare Produkt allein, sodass eine Schwachstelle bei einer Installation erscheinen kann, die sie nicht betrifft. Markieren Sie sie als **Nicht betroffen**.

Eine Schwachstelle, die die NVD noch nicht analysiert hat, erscheint, sobald sie analysiert ist.

Änderungen zählen sofort. Wenn Sie eine Technologie oder eine CPE-Produktkennung hinzufügen, sucht KANAP dieses Produkt sofort in der NVD; der Abschnitt **Schwachstellen** der Technologie zeigt „Suche nach Schwachstellen läuft…“, bis die Suche endet. Wenn sich eine Version, ein Server oder eine Anwendung einer Technologie ändert, gleicht KANAP die Technologie erneut ab, sobald die Änderung gespeichert ist. **Aktualisieren** im Abschnitt **Schwachstellen** der Technologie tut dasselbe von Hand.

## Warnungen

Jede Technologie und jede Version ist in den Warnungen zu Schwachstellen oder außerhalb davon. Sie wählen das bei der Technologie, in ihrer Versionstabelle: Der Schalter **In Schwachstellenwarnungen aufnehmen** stellt die Technologie ein, und die Spalte **Warnungen** enthält einen Schalter pro Version. Siehe [Warnungen zu Schwachstellen](technologies.md#warnungen-zu-schwachstellen). Eine Version folgt der Einstellung ihrer Technologie, außer sie hat eine eigene. Ein Server oder eine Anwendung ohne Version folgt der Technologie.

Zwei Arten von Technologien sind standardmäßig außerhalb der Warnungen:

- **Betriebssysteme**: KANAP kennt den Patchstand eines Servers nicht, daher würde ein Betriebssystem sehr viele Schwachstellen melden.
- **Von einem Anbieter betriebene Cloud-Dienste**: eine Technologie in der Public Cloud oder als SaaS, oder ein Katalogeintrag, den der Anbieter betreibt. Der Anbieter patcht einen Online-Dienst, daher verlangen seine Schwachstellen keine Maßnahme von Ihnen. Eine Technologie in einer Private Cloud bleibt in den Warnungen.

Sie können sie bei der Technologie wieder aufnehmen.

Eine Version außerhalb der Warnungen wird weiter mit den Schwachstellen abgeglichen. Sie bleibt im Abschnitt **Schwachstellen** der Technologie, und ihre Zeilen bleiben auf dieser Seite über den Filter **Warnungen**. Überall sonst fehlen sie:

- Diese Seite zeigt standardmäßig nur die Zeilen in den Warnungen.
- Die E-Mails melden nur die Zeilen in den Warnungen.
- Die Spalte **Zu prüfende Schwachstellen** der Technologieliste zählt nur die Zeilen in den Warnungen.

## Die Liste

Die Liste nutzt das Standardraster: eine Zeile pro Technologie, Version und Schwachstelle. Aktiv ausgenutzte Schwachstellen kommen zuerst, danach die schwersten. Eine Schwachstelle, die drei Versionen von SQL Server betrifft, ergibt drei Zeilen, jede mit ihrem eigenen Status. Sie öffnet sich mit den Zeilen **Zu prüfen**, die in den Warnungen sind: Leeren Sie den Filter der Spalte **Status**, um die anderen Status zu sehen.

**Warnungen**, **Veröffentlicht** und **Nur ausgenutzte** stehen über dem Raster. **Warnungen** wählt die Zeilen nach ihrer Warnungseinstellung: **Eingeschlossen** (Standard), **Ausgeschlossen** oder **Alle**. Unter **Alle** sind die Zeilen außerhalb der Warnungen ausgegraut. Ist keine Zeile in den Warnungen und sind einige ausgeschlossen, bietet die leere Liste **Ausgeschlossene anzeigen** an. **Veröffentlicht** behält die Schwachstellen nach ihrem Veröffentlichungsdatum bei der NVD: **Alle** (Standard), **Weniger als 7 Tage**, **Weniger als 30 Tage**, **Weniger als 90 Tage**, **Weniger als ein Jahr** oder **Mehr als ein Jahr**. Der Zeitraum zählt ab heute, daher zeigt ein gespeicherter oder geteilter Link weiterhin die neuesten. **Nur ausgenutzte** behält die als aktiv ausgenutzt geführten Schwachstellen. Die Adresse trägt `exploited=1`. **Filter zurücksetzen** stellt **Warnungen** wieder auf **Eingeschlossen**, **Veröffentlicht** auf **Alle** und schaltet **Nur ausgenutzte** aus. Der Export und die Statusänderungen für den ganzen Filter folgen diesen drei Einstellungen.

**Spalten**:

| Spalte | Was sie zeigt |
|---|---|
| **CVE** | Die Kennung der Schwachstelle, zum Beispiel `CVE-2024-1234` |
| **Schweregrad** | **Kritisch**, **Hoch**, **Mittel**, **Niedrig**, **Keine** oder **Nicht bewertet**. Eine Pastille **Aktiv ausgenutzt** folgt dem Namen, wenn die CISA oder die Europäische Union die Schwachstelle führt |
| **Ausgenutzt** | **Ja** oder **Nein**. Standardmäßig ausgeblendet: die Pastille in **Schweregrad** zeigt denselben Sachverhalt |
| **Score** | Der CVSS-Wert. Standardmäßig ausgeblendet |
| **EPSS** | Die Wahrscheinlichkeit einer Ausnutzung innerhalb der nächsten 30 Tage, als Prozentsatz in der Sprache Ihres Bildschirms, mit dem Perzentil, wenn eines veröffentlicht ist. Zum Beispiel 15,3 % (92. Perzentil) |
| **Zusammenfassung** | Die Beschreibung der NVD |
| **Technologie** | Die betroffene Technologie |
| **Version** | Die betroffene Version. **Nicht erfasst**, wenn ein Server oder eine Anwendung die Technologie ohne Angabe der Version nutzt: Die Zeile ist dann möglicherweise betroffen |
| **Hersteller** | Der Hersteller der Technologie. Standardmäßig ausgeblendet |
| **Server** | Wie viele Server diese Version tragen, direkt oder über den Server, in dem sie laufen |
| **Anwendungen** | Wie viele Anwendungen diese Version nutzen, gehostet oder deklariert |
| **Status** | **Zu prüfen**, **Behandelt** oder **Nicht betroffen** |
| **Notiz** | Die Notiz der Zeile. Standardmäßig ausgeblendet |
| **Veröffentlicht** | Das Veröffentlichungsdatum |

**Filter**: Jede Spalte hat ihren eigenen Filter unter ihrer Überschrift. **Schweregrad**, **Technologie**, **Version**, **Hersteller**, **Status** und **Ausgenutzt** bieten Kontrollkästchen (**Version** bietet auch **Nicht erfasst**, **Ausgenutzt** bietet **Ja** und **Nein**), **Score** eine Zahl, **EPSS** eine Mindestwahrscheinlichkeit von 0 bis 1, **Veröffentlicht** ein Datum, **CVE** und **Zusammenfassung** einen Text. Das Suchfeld über dem Raster durchsucht die CVE-Kennung, die Zusammenfassung und den Technologienamen.

**Sortieren** nach **Ausgenutzt**, **Schweregrad**, **Score**, **EPSS**, **Veröffentlicht**, **CVE** oder **Technologie**. Die Liste öffnet sich mit den aktiv ausgenutzten Schwachstellen, danach den schwersten. Die Spaltenauswahl blendet Spalten ein oder aus, und das Raster merkt sich Ihre Wahl.

**Links**: Die Seite liest ihre Filter aus ihrer Adresse, sodass Sie eine gefilterte Liste teilen können. `?technology=TEC-4` behält eine Technologie, `?version=none` die Zeilen ohne erfasste Version, `?state=all` alle Status, `?published=30d` die in den letzten 30 Tagen veröffentlichten Schwachstellen (`7d`, `30d`, `90d`, `1y` oder `older1y`, wie der Filter **Veröffentlicht**), `?period=30` dasselbe über den Filter der Spalte **Veröffentlicht**, `?alerts=excluded` oder `?alerts=all` die Zeilen außerhalb der Warnungen, `?exploited=1` die aktiv ausgenutzten Schwachstellen. Der Link der E-Mails nutzt `period`.

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
- **Ausnutzung**, wenn ein Katalog, ein EPSS-Wert oder eine europäische Kennung bekannt ist. Siehe [Ausnutzung](#exploitation).

Eine Version außerhalb der Warnungen ist ausgegraut, mit ihren Servern und Anwendungen. Ist nur ein Teil davon in den Warnungen, nennt eine Zeile über der Liste die Anzahl, zum Beispiel „3 Server, davon 1 in den Warnungen“.

Legen Sie den Status jeder Version fest:

| Status | Bedeutung |
|---|---|
| **Zu prüfen** | Niemand hat sie bisher angesehen |
| **Behandelt** | Die Version ist gepatcht, oder ein Workaround ist eingerichtet |
| **Nicht betroffen** | Die Schwachstelle gilt nicht für Ihre Installation |

Die Notiz hält fest, wie, zum Beispiel „am 12. März gepatcht, Change CHG-123“. Sie wird gespeichert, wenn Sie das Feld verlassen. Das Audit-Log hält fest, wer einen Status geändert hat und wann.

KANAP ändert nie einen Status, den Sie gewählt haben. Wenn eine Version nicht mehr passt (Sie haben sie aktualisiert, die Technologie wurde außer Betrieb genommen, die NVD hat ihre Daten geändert), verschwindet eine Zeile, die noch **Zu prüfen** ist. Eine geprüfte Zeile bleibt, ausgegraut, mit ihrem Status; sie kehrt unverändert zurück, wenn die Version wieder passt.

## Ausnutzung { #exploitation }

Eine Schwachstelle ist **aktiv ausgenutzt**, wenn der Katalog der CISA (Vereinigte Staaten) oder der Katalog der Europäischen Union sie führt, oder beide. Die Pastille **Aktiv ausgenutzt** steht neben dem Schweregrad. Ihr Hinweis nennt die Kataloge. Wenn die CISA einen Einsatz in Ransomware-Kampagnen verzeichnet, sagt der Hinweis das.

**EPSS** ist die Wahrscheinlichkeit, dass die Schwachstelle innerhalb der nächsten 30 Tage ausgenutzt wird. [FIRST](https://www.first.org/epss) berechnet sie jeden Tag. Die Spalte und der Seitenbereich zeigen sie als Prozentsatz, mit dem Perzentil dieses Tages, wenn FIRST eines veröffentlicht, und mit dem Tag des Werts. Der Bereich nennt das Verfahren: EPSS: FIRST.

Der Seitenbereich zeigt auch die Kennung **EUVD**, wenn die europäische Zuordnung eine nennt, mit dem Link **In der europäischen Schwachstellendatenbank (ENISA) ansehen**. Die europäische Schwachstellendatenbank der ENISA ist der europäische Katalog für die Prüfung von Schwachstellen im Rahmen von NIS2. Der Bereich nennt die Quelle: ENISA, europäische Schwachstellendatenbank.

Die Liste öffnet sich mit den aktiv ausgenutzten Schwachstellen, danach den schwersten. **Nur ausgenutzte** über dem Raster behält diese Zeilen (`?exploited=1`). **Filter zurücksetzen** schaltet es aus. Der Export und eine Statusänderung für mehrere Zeilen folgen ihm.

Die E-Mail an die IT-Verantwortlichen meldet eine ausgenutzte Schwachstelle jeden Schweregrads, auf den Versionen in den Warnungen, nach denselben Regeln wie eine kritische oder hohe: in den letzten 30 Tagen veröffentlicht, zu einem Produkt, mit dem die Technologie bereits verglichen wurde, noch zu prüfen. Eine bereits erkannte Schwachstelle, die später in einen Katalog aufgenommen wird, wird einmal als jetzt bekannt ausgenutzt gemeldet, wenn sie in den Warnungen ist.

## Export

**CSV exportieren** lädt die Schwachstellen herunter, die den Filtern entsprechen, eine Zeile pro Zeile des Rasters, in seiner Reihenfolge, in der Sprache Ihres Bildschirms. Ab 10.000 Schwachstellen grenzen Sie die Filter zuerst ein.

## E-Mail-Benachrichtigungen

Nach jeder Prüfung erhalten die IT-Verantwortlichen einer Technologie eine E-Mail über ihre neuen Schwachstellen, die noch zu prüfen sind, auf den Versionen in den Warnungen. Die E-Mail umfasst eine kritische oder hohe Schwachstelle, oder eine bekanntermaßen ausgenutzte Schwachstelle jeden Schweregrads:

- **Was gemeldet wird**: eine Schwachstelle, die in den letzten 30 Tagen veröffentlicht wurde, zu einem Produkt, mit dem die Technologie bereits verglichen wurde, wenn sie kritisch, hoch oder als ausgenutzt geführt ist, oder eine bekannte Schwachstelle, die gerade kritisch oder hoch geworden ist.
- **Was nicht**: Der erste Vergleich einer Technologie, oder einer gerade hinzugefügten CPE-Kennung, bleibt still. Seine Ergebnisse warten auf dieser Seite.
- **Wie viel**: höchstens 25 Zeilen, eine pro Technologie und Schwachstelle, dann ein Link zur Seite, gefiltert auf die in den letzten 30 Tagen veröffentlichten Schwachstellen.
- **Wie oft**: Jede Person erfährt von einer Schwachstelle einer Technologie einmal. Eine Schwachstelle, die bei ihrer Prüfung nicht gemeldet wurde, wird auch später nicht gemeldet.

Empfänger sind die IT-Verantwortlichen der Technologie, deren Konto aktiv ist und die die Infrastruktur lesen dürfen. Jeder kann diese E-Mails unter **Technologie-Benachrichtigungen** in seinen Benachrichtigungseinstellungen abschalten. Siehe [Einstellungen](admin.md#benachrichtigungen). Solange der E-Mail-Versand auf Ihrer Installation nicht eingerichtet ist, geht keine E-Mail hinaus.

## Wo Schwachstellen außerdem erscheinen

- **Technologieliste**: die Spalte **Zu prüfende Schwachstellen**, orange, wenn kritische oder hohe darunter sind. Siehe [Technologien](technologies.md#mit-der-liste-arbeiten).
- **Technologie-Arbeitsbereich**: der Abschnitt **Schwachstellen** im Reiter Compliance. Siehe [Technologien](technologies.md#schwachstellen).

## Tipps

- **CPE-Kennungen ausfüllen**: Die meisten Technologien aus dem Katalog bringen sie mit, die Betriebssysteme eingeschlossen. SUSE Linux Enterprise Server hat keine. Für die anderen suchen Sie das Produkt im CPE-Wörterbuch des NIST.
- **Versionen erfassen**: Ein Server oder eine Anwendung ohne Version ist potenziell von allem betroffen, was die tatsächliche Gefährdung verdeckt.
- **Die Notiz schreiben**: Wer die Schwachstelle als Nächstes liest, sieht, was getan wurde.
