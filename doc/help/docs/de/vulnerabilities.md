# Schwachstellen

Die Seite Schwachstellen listet die veröffentlichten Schwachstellen (CVE), die die Versionen Ihrer Technologien im Einsatz betreffen, und was jede erreicht: die Server, die eine betroffene Version tragen, und die Anwendungen, die sie nutzen. Sie prüfen jede Schwachstelle und halten fest, was Sie dagegen unternommen haben.

Öffnen Sie sie über **IT-Landschaft > Schwachstellen**, in der Gruppe **Betrieb**. Sie benötigen `infrastructure:reader` zum Ansehen und `infrastructure:member` zum Ändern eines Status. Die Anzahlen und Listen der Anwendungen erscheinen nur, wenn Sie auch Anwendungen lesen dürfen.

## Verfügbarkeit

In der Cloud werden Schwachstellen standardmäßig verfolgt. Bei einer On-Premise-Installation sind sie aus, bis Ihr Administrator [sie einschaltet](on-premise/configuration.md#optional-vulnerabilities); der Server muss dann die NVD (die US-amerikanische National Vulnerability Database) und die CVE.org-Liste erreichen, oder jeweils einen Spiegel. Derselbe Schalter liest auch drei Quellen zur Ausnutzung, oder jeweils einen Spiegel: den Katalog der CISA, die europäische Schwachstellendatenbank der ENISA und die täglichen EPSS-Werte. Solange sie aus sind, zeigt KANAP nichts davon: keine Seite, keine Spalte in den Listen der Technologien, Assets und Anwendungen, keinen Abschnitt und kein Badge auf einem Datensatz, keine Dashboard-Kachel, keine Benachrichtigungseinstellung und keine E-Mail. Auch Plaid antwortet nicht zu Schwachstellen.

## Wie KANAP sie findet

KANAP liest alle 6 Stunden zwei Quellen und vergleicht sie mit Ihren Technologien:

- **Die NVD**: die Schwachstellen, die die US-amerikanische National Vulnerability Database analysiert hat. Die NVD analysiert nicht jede Schwachstelle. Viele bleiben lange ohne Produktkennung, und manche erhalten nie eine.
- **Die CVE.org-Liste**: die Einträge, die Hersteller selbst für ihre eigenen Produkte schreiben. Eine Schwachstelle, die ihr Hersteller veröffentlicht hat, erscheint auch dann, wenn die NVD sie nicht analysiert hat.

Diese Einträge stammen aus der CVE-Liste (CVE.org), gemäß den [Nutzungsbedingungen des CVE-Programms](https://www.cve.org/Legal/TermsOfUse).

Jede Technologie wird so verglichen:

- **Produkte**: Eine Technologie wird über ihre CPE-Produktkennungen und ihre CVE.org-Namen verglichen (siehe [Technologien](technologies.md#schwachstellenkennungen)). Die CPE-Kennungen gelten auch für die CVE.org-Einträge, die solche tragen, wie die von Red Hat. Eine Technologie ohne beides erhält keine Schwachstelle. Die Betriebssysteme des Katalogs haben ebenfalls CPE-Kennungen. Red Hat Enterprise Linux erhält auch die Schwachstellen, die Red Hat unter seinen Application Streams (AppStream) führt. Außer Betrieb genommene Technologien bleiben außen vor.
- **CVE.org-Namen**: die Hersteller- und Produktnamen, so wie der Hersteller sie in seinen Einträgen schreibt, zum Beispiel Hersteller `SAP_SE` und Produkt `SAP HANA Database`. Der Vergleich ignoriert Groß- und Kleinschreibung sowie Satzzeichen und verlangt ansonsten den genauen Namen. Ein ähnlicher Name passt nicht, daher wird jede Variante eines Produkts einzeln erfasst. Ein Name kann eine Version tragen: Er gilt dann nur für die Versionen der Technologie, deren Bezeichnung mit dieser Version beginnt, zum Beispiel `2019` für `Windows Server 2019`. Beginnt eine Bezeichnung mit mehreren davon, zählt nur die längste: `2012 R2` trägt `2012` und `2012 R2` und erhält nur den Namen von `2012 R2`.
- **Versionen**: Nur die Versionen im Einsatz zählen: installiert auf einem Server in Betrieb oder genutzt von einer Anwendung in Betrieb.
- **Versionsnummern**: Versionen werden über ihre Zahlen verglichen, Teil für Teil. `2016 SP3` zählt als 2016 und `19c` als 19. Eine Version mit weniger als drei Zahlen steht für ihren ganzen Zweig: `9.0` umfasst alle `9.0.x`. Eine Version, die KANAP nicht vergleichen kann, etwa eine Bezeichnung ohne Zahl, gilt als betroffen.
- **Versionen in Herstellereinträgen**: Dieselben Regeln gelten für die Versionen, die ein CVE.org-Eintrag nennt. Eine Version, die KANAP nicht mit denen des Herstellers vergleichen kann, gilt als betroffen, und die Spalte **Match** des Exports zeigt „Version not comparable“. Das geschieht, wenn Ihre Version nach einem Jahr benannt ist und der Hersteller seine Komponenten nummeriert, zum Beispiel `2021` gegenüber `106`. Prüfen Sie dann im Eintrag des Herstellers, ob Ihre Version betroffen ist.
- **Betriebssysteme**: Red Hat Enterprise Linux, Debian, Oracle Linux, AlmaLinux, Rocky Linux, SUSE Linux Enterprise Server und CentOS werden über ihre Hauptversion verglichen, Ubuntu über Jahr und Monat, so wie die NVD sie veröffentlicht: `9.4` erhält die Schwachstellen von `9`, und `22.04.3 LTS` die von `22.04`. IBM AIX, IBM i und Oracle Solaris werden über ihre ersten beiden Zahlen verglichen: `7.3.2` erhält die Schwachstellen von `7.3`. Windows Server wird nur über sein Jahr verglichen, da KANAP nicht weiß, welche Updates ein Server hat: Eine Version `2019` ist von jeder Schwachstelle von Windows Server 2019 betroffen, auch von denen, die ein Update bereits behoben hat. 2012 und 2012 R2 werden über ihre Bezeichnung unterschieden, ebenso 2008 und 2008 R2.
- **Unbekannte Version**: Ein Server oder eine Anwendung ohne Version ist potenziell von jeder Schwachstelle des Produkts betroffen. Die Zeile zeigt in der Spalte **Version** **Nicht erfasst**.
- **Linux-Distributionen**: Eine Distribution veröffentlicht ihre Schwachstellen pro Paket. KANAP sieht die Schwachstellen, die der Hersteller einer Version der Distribution zuordnet. KANAP sieht weder die auf einem Server installierten Pakete noch ihren Updatestand. Ob ein Server betroffen ist, prüfen Sie am Paket im Sicherheitstracker des Anbieters: Die Technologie führt dorthin, unter ihrer Versionstabelle (siehe [Technologien](technologies.md#versionen-aus-dem-katalog)).

Manche Schwachstellen gelten nur, wenn zwei Produkte zusammen laufen, zum Beispiel Tomcat unter Windows. KANAP zeigt sie für das verwundbare Produkt allein, sodass eine Schwachstelle bei einer Installation erscheinen kann, die sie nicht betrifft. Markieren Sie sie als **Nicht betroffen**.

Eine Zeile entsteht, sobald eine der beiden Quellen sie abgleicht. Wenn die NVD und der Hersteller Unterschiedliches angeben, bleibt die Zeile bestehen. Die Spalte **Quelle** der Liste zeigt, welche Quellen sie abgeglichen haben. Hat die NVD eine Schwachstelle noch nicht bewertet, zeigt KANAP den Score und den Schweregrad aus dem Eintrag des Herstellers. Eine Schwachstelle, die CVE.org oder die NVD zurückweist, wird nicht mehr abgeglichen.

Änderungen zählen sofort. Wenn Sie eine Technologie oder eine CPE-Produktkennung hinzufügen, sucht KANAP dieses Produkt sofort in der NVD; der Abschnitt **Schwachstellen** der Technologie zeigt „Suche nach Schwachstellen läuft…“, bis die Suche endet. Wenn die Suche nicht abgeschlossen werden kann, sagt der Abschnitt das. Wenn sich ein CVE.org-Name, eine Version, ein Server oder eine Anwendung einer Technologie ändert, gleicht KANAP die Technologie erneut ab, sobald die Änderung gespeichert ist. **Aktualisieren** im Abschnitt **Schwachstellen** der Technologie tut dasselbe von Hand.

## Warnungen

Jede Technologie und jede Version ist in den Warnungen zu Schwachstellen oder außerhalb davon. Sie wählen das bei der Technologie, in ihrer Versionstabelle: Der Schalter **In Schwachstellenwarnungen aufnehmen** stellt die Technologie ein, und die Spalte **Warnungen** enthält einen Schalter pro Version. Siehe [Warnungen zu Schwachstellen](technologies.md#warnungen-zu-schwachstellen). Eine Version folgt der Einstellung ihrer Technologie, außer sie hat eine eigene. Ein Server oder eine Anwendung ohne Version folgt der Technologie.

Zwei Arten von Technologien sind standardmäßig außerhalb der Warnungen:

- **Betriebssysteme**: KANAP kennt den Patchstand eines Servers nicht, daher würde ein Betriebssystem sehr viele Schwachstellen melden. Die CVE.org-Liste fügt viele weitere hinzu: Die Hersteller von Betriebssystemen führen die ganze Version als betroffen.
- **Von einem Anbieter betriebene Cloud-Dienste**: eine Technologie in der Public Cloud oder als SaaS, oder ein Katalogeintrag, den der Anbieter betreibt. Der Anbieter patcht einen Online-Dienst, daher verlangen seine Schwachstellen keine Maßnahme von Ihnen. Eine Technologie in einer Private Cloud bleibt in den Warnungen.

Sie können sie bei der Technologie wieder aufnehmen. Um eine einzelne Version eines Betriebssystems zu verfolgen, etwa die Ihrer am stärksten exponierten Server, schalten Sie ihren Schalter in der Spalte **Warnungen** der Versionstabelle ein. Die anderen Versionen bleiben außerhalb der Warnungen.

Bei SUSE Linux Enterprise Server schaltet der Schalter einer Basisversion auch die Schalter ihrer Service Packs auf dieselbe Weise, und ein Service Pack kann danach einzeln geändert werden.

Eine Version außerhalb der Warnungen wird weiter mit den Schwachstellen abgeglichen. Sie bleibt im Abschnitt **Schwachstellen** der Technologie, und ihre Zeilen bleiben auf dieser Seite über den Filter **Warnungen**. Überall sonst fehlen sie:

- Diese Seite zeigt standardmäßig nur die Zeilen in den Warnungen.
- Die E-Mails melden nur die Zeilen in den Warnungen.
- Die Spalten **Zu prüfende Schwachstellen** der Listen der Technologien, Assets und Anwendungen zählen nur die Zeilen in den Warnungen, ebenso die Datensätze, die Badges und die Dashboard-Kachel.

## Was KANAP zählt { #what-kanap-counts }

Eine Schwachstelle erreicht einen Server oder eine Anwendung nur über direkte Verknüpfungen, überall: auf dieser Seite, in den Listen, auf den Datensätzen, im Dashboard und in Plaid.

- **Server**: Technologie und Version sind auf dem Server selbst erfasst. Ein außer Betrieb genommener Server wird nicht gezählt.
- **Cluster**: was auf dem Cluster selbst erfasst ist, plus was auf seinen Mitgliedern in Betrieb erfasst ist. Ein Cluster zählt die Schwachstellen seiner Mitglieder, in seiner Listenspalte, seinem Badge und seinem Datensatz. Wenn Sie diese Seite auf einen Cluster filtern, erscheinen auch die Zeilen seiner Mitglieder.
- **Anwendung**: Die Anwendung deklariert Technologie und Version, oder einer ihrer Bereitstellungsserver hat sie selbst erfasst. Eine einem Cluster zugeordnete Anwendung zählt den Cluster und seine Mitglieder in Betrieb. Eine Technologie, die zugleich deklariert und gehostet ist, zählt einmal. Eine deaktivierte Anwendung, oder eine, deren Deaktivierungsdatum vergangen ist, wird nicht gezählt.

Die Zählungen pro Server und pro Anwendung, in den Listen, auf den Datensätzen, im Dashboard und in Plaid, folgen denselben Regeln:

- **Welche Schwachstellen**: die noch im Status **Zu prüfen**, deren Technologie oder Version in den Warnungen ist. Jede Schwachstelle zählt einmal, auch wenn sie mehrere Versionen betrifft.
- **Schweregrad**: der der NVD, oder der des Herstellers (CVE.org), wenn die NVD die Schwachstelle noch nicht bewertet hat. **Schwerwiegend** heißt kritisch oder hoch.
- **Außer Betrieb**: Ein außer Betrieb genommener Server oder eine deaktivierte Anwendung zählt nichts. Die Zelle bleibt leer.

Eine virtuelle Maschine oder ein Gast zählt die Schwachstellen seines Hosts nicht. Eine Schwachstelle von VMware ESXi zählt nur auf den ESXi-Hosts. Über die Hosts zu zählen, würde eine einzige Schwachstelle eines Hypervisors auf fast alle Server und Anwendungen eines virtualisierten Bestands legen.

Die Reichweite über ein anderes Asset bleibt sichtbar, ohne gezählt zu werden: im Seitenbereich einer Schwachstelle, unter **Über ein anderes Asset**, und auf dem Datensatz eines Assets, unter einer geschlossenen Zeile **Zugrunde liegende Plattform (n)** seines Abschnitts **Schwachstellen**. Diese Zeile enthält, was nur von einem Host kommt, etwa das ESXi des Hosts, auf dem eine virtuelle Maschine läuft. Siehe [Assets](assets.md#operations).

## Die Liste

Die Liste nutzt das Standardraster: eine Zeile pro Technologie, Version und Schwachstelle. Aktiv ausgenutzte Schwachstellen kommen zuerst, danach die schwersten. Eine Schwachstelle, die drei Versionen von SQL Server betrifft, ergibt drei Zeilen, jede mit ihrem eigenen Status. Sie öffnet sich mit den Zeilen **Zu prüfen**, die in den Warnungen sind: Leeren Sie den Filter der Spalte **Status**, um die anderen Status zu sehen.

Eine Zeile über dem Raster zeigt, wann KANAP jede Quelle zuletzt gelesen hat: **Gelesene Daten**, dann die NVD, die Hersteller (CVE.org) und die Ausnutzungskataloge (CISA KEV, EU KEV, EPSS und EUVD). Die NVD, die Hersteller, CISA KEV, EU KEV und EUVD zeigen Tag und Uhrzeit des letzten Lesens. EPSS zeigt den Tag seiner Scores. Eine abgeschaltete Quelle fehlt dort. Ein Warnhinweis folgt in derselben Zeile, wenn das letzte Lesen einer Quelle fehlgeschlagen ist oder eine Quelle seit mehr als 3 Tagen nicht gelesen wurde. Die Daten dieser Quelle können dann veraltet sein.

**Warnungen**, **Veröffentlicht** und **Nur ausgenutzte** stehen über dem Raster. **Warnungen** wählt die Zeilen nach ihrer Warnungseinstellung: **Eingeschlossen** (Standard), **Ausgeschlossen** oder **Alle**. Unter **Alle** sind die Zeilen außerhalb der Warnungen ausgegraut. Ist keine Zeile in den Warnungen und sind einige ausgeschlossen, bietet die leere Liste **Ausgeschlossene anzeigen** an. **Veröffentlicht** behält die Schwachstellen nach ihrem Veröffentlichungsdatum: **Alle** (Standard), **Weniger als 7 Tage**, **Weniger als 30 Tage**, **Weniger als 90 Tage**, **Weniger als ein Jahr** oder **Mehr als ein Jahr**. Der Zeitraum zählt ab heute, daher zeigt ein gespeicherter oder geteilter Link weiterhin die neuesten. **Nur ausgenutzte** behält die als aktiv ausgenutzt geführten Schwachstellen. Die Adresse trägt `exploited=1`. **Filter zurücksetzen** bringt die Seite in den Zustand beim Öffnen zurück: die Zeilen **Zu prüfen**, aktiv ausgenutzte Schwachstellen zuerst, **Warnungen** auf **Eingeschlossen**, **Veröffentlicht** auf alle Daten und **Nur ausgenutzte** ausgeschaltet. Der Export und eine Statusänderung für mehrere Zeilen folgen diesen drei Einstellungen.

**Spalten**:

| Spalte | Was sie zeigt |
|---|---|
| **CVE** | Die Kennung der Schwachstelle, zum Beispiel `CVE-2024-1234` |
| **Schweregrad** | **Kritisch**, **Hoch**, **Mittel**, **Niedrig**, **Keine** oder **Nicht bewertet**. Ein Warnsymbol folgt dem Namen, wenn die CISA oder die Europäische Union die Schwachstelle führt. Sein Tooltip nennt die Kataloge und den Einsatz durch Ransomware, wenn die CISA ihn verzeichnet. Ein Informationssymbol kennzeichnet einen vom Hersteller veröffentlichten Score: Die NVD hat die Schwachstelle noch nicht bewertet |
| **Ausgenutzt** | **Ja** oder **Nein**. Standardmäßig ausgeblendet: das Symbol in **Schweregrad** zeigt denselben Sachverhalt |
| **Score** | Der CVSS-Wert. Standardmäßig ausgeblendet |
| **EPSS (%)** | Die Wahrscheinlichkeit einer Ausnutzung innerhalb der nächsten 30 Tage, als Prozentsatz in der Sprache Ihres Bildschirms. Zum Beispiel 15,3 %. Der Seitenbereich ergänzt das Perzentil |
| **Zusammenfassung** | Die Beschreibung der Schwachstelle |
| **Technologie** | Die betroffene Technologie |
| **Version** | Die betroffene Version. **Nicht erfasst**, wenn ein Server oder eine Anwendung die Technologie ohne Angabe der Version nutzt: Die Zeile ist dann möglicherweise betroffen |
| **Hersteller** | Der Hersteller der Technologie. Standardmäßig ausgeblendet |
| **Server** | Wie viele Server in Betrieb diese Version selbst erfasst haben, so wie die [Technologieliste](technologies.md) sie zählt. Cluster und Server, die in einem anderen laufen, werden nicht gezählt. Siehe [Was KANAP zählt](#what-kanap-counts) |
| **Anwendungen** | Wie viele Anwendungen diese Version deklarieren oder auf einem Server laufen, der sie erfasst hat |
| **Quelle** | Die Quellen, die die Zeile abgeglichen haben: **NVD**, **Hersteller** (der Eintrag, den der Hersteller auf CVE.org veröffentlicht hat) oder beide |
| **Status** | **Zu prüfen**, **Behandelt** oder **Nicht betroffen** |
| **Notiz** | Die Notiz der Zeile. Standardmäßig ausgeblendet |
| **Veröffentlicht** | Das Veröffentlichungsdatum |

**Filter**: Jede Spalte hat ihren eigenen Filter unter ihrer Überschrift. **Server** und **Anwendungen** listen die Server und Anwendungen, die eine Schwachstelle über direkte Verknüpfungen erreicht: Suchen Sie einen Eintrag nach Name oder Referenz und haken Sie einen oder mehrere an. Mehrere Werte behalten die Zeilen jedes von ihnen, und ein Filter in beiden Spalten behält die Zeilen, die beide erfüllen. Der Filter **Anwendungen** erfordert das Recht, Anwendungen zu lesen. **Schweregrad**, **Technologie**, **Version**, **Hersteller**, **Quelle**, **Status** und **Ausgenutzt** bieten Kontrollkästchen (**Version** bietet auch **Nicht erfasst**, **Ausgenutzt** bietet **Ja** und **Nein**), **Score** eine Zahl, **EPSS (%)** einen Mindestprozentsatz von 0 bis 100, **Veröffentlicht** ein Datum, **CVE** und **Zusammenfassung** einen Text. **Quelle** bietet **NVD**, **Hersteller** und **Beide**: Eine Zeile, die beide Quellen abgeglichen haben, bleibt unter **NVD** und unter **Hersteller**, und **Beide** behält nur diese Zeilen. Der Export und die Statusänderung in Masse folgen ihm wie den anderen Spaltenfiltern. Das Suchfeld über dem Raster durchsucht die CVE-Kennung, die Zusammenfassung und den Technologienamen.

**Sortieren** nach **Ausgenutzt**, **Schweregrad**, **Score**, **EPSS (%)**, **Veröffentlicht**, **CVE** oder **Technologie**. Die Liste öffnet sich mit den aktiv ausgenutzten Schwachstellen, danach den schwersten. Die Spaltenauswahl blendet Spalten ein oder aus, und das Raster merkt sich Ihre Wahl.

**Links**: Die Seite liest ihre Filter aus ihrer Adresse, sodass Sie eine gefilterte Liste teilen können. `?technology=TEC-4` behält eine Technologie, `?version=none` die Zeilen ohne erfasste Version, `?state=all` alle Status, `?published=30d` die in den letzten 30 Tagen veröffentlichten Schwachstellen (`7d`, `30d`, `90d`, `1y` oder `older1y`, wie der Filter **Veröffentlicht**), `?period=30` dasselbe über den Filter der Spalte **Veröffentlicht**, `?alerts=excluded` oder `?alerts=all` die Zeilen außerhalb der Warnungen, `?exploited=1` die aktiv ausgenutzten Schwachstellen. Der Link der E-Mails nutzt `period`.

**Asset und Anwendung**: `?asset=AST-12` öffnet die Seite mit dem Filter der Spalte **Server** auf ein Asset gesetzt, `?application=APP-4` mit dem Filter der Spalte **Anwendungen** auf eine Anwendung gesetzt, über direkte Verknüpfungen (siehe [Was KANAP zählt](#what-kanap-counts)). Die Listen der Assets und Anwendungen und ihre Datensätze öffnen die Seite so. Leeren Sie den Spaltenfilter, um die übrigen Zeilen zu sehen. Um nach einer Anwendung zu filtern, müssen Sie sie lesen dürfen.

**Im Bestand im Einsatz**: `?estate=1` behält die Schwachstellen der Technologien, die auf einem Asset in Betrieb installiert oder von einer Anwendung in Betrieb deklariert sind. Die Links der Dashboard-Kachel **Schwachstellen im Bestand** zu CVEs öffnen die Seite damit. Eine Zeile über dem Raster zeigt **Im Bestand im Einsatz · entfernen**. **entfernen** hebt den Filter auf.

**Filter zurücksetzen** hebt auch diese beiden Filter auf. Der Export und die Massenänderung des Status folgen ihnen.

## Den Status mehrerer Zeilen ändern

Mit `infrastructure:member` kreuzen Sie die zu ändernden Zeilen an. Das Kästchen in der Überschrift wählt alle Zeilen des Filters aus, auch die noch nicht geladenen; danach können Sie einzelne abwählen. Ein Hinweis über dem Raster zeigt, wie viele Zeilen ausgewählt sind, und **Auswahl aufheben** leert sie.

**Status ändern (n)** fragt dann nach:

- Dem zu setzenden **Status**.
- Einer **Gemeinsamen Notiz**, optional. Ohne Notiz behält jede Zeile ihre eigene.

Bevor Sie bestätigen, sagt das Fenster, wie viele Zeilen die Änderung betrifft, bei wie vielen Schwachstellen. Eine Zeile, die nach dieser Zählung gefunden wird, bleibt unverändert. Über 5.000 Zeilen grenzen Sie die Filter ein oder wählen weniger Zeilen aus.

Zum Beispiel, um alle nicht erfassten Versionen von PostgreSQL als nicht betroffen zu markieren: Filtern Sie **Technologie** auf PostgreSQL und **Version** auf **Nicht erfasst**, kreuzen Sie das Kästchen in der Überschrift an, klicken Sie auf **Status ändern**, wählen Sie **Nicht betroffen** und schreiben Sie den Grund in die Notiz.

## Eine Schwachstelle prüfen

Ein Klick auf eine Zeile öffnet ihre Schwachstelle in einem Seitenbereich. Sein Kopf bleibt sichtbar, mit der CVE-Kennung, dem Schweregrad, dem Informationssymbol, wenn der Score vom Hersteller stammt, und dem Warnsymbol, wenn die Schwachstelle aktiv ausgenutzt wird. **Schließen** (das Kreuz) oder Esc schließt den Bereich. Der Bereich umfasst alle Technologien und Versionen, die die Schwachstelle betrifft. Sie sehen, in dieser Reihenfolge:

- **Technologien und Versionen**: jede betroffene Version mit ihrem **Status** und einer Notiz. Unter jeder Version die Abzeichen der Quellen, die sie abgeglichen haben. **Warum diese Zeile** öffnet die Kriterien jeder Quelle im Klartext, zum Beispiel „CPE-Kennung a:apache:tomcat: Versionen vor 9.0.99“ für die NVD oder „Apache Software Foundation · Apache Tomcat: Versionen 9.0.0 bis 9.0.98 betroffen“ für den Hersteller.
- Die Beschreibung, auf drei Zeilen gekürzt (**Mehr anzeigen** zeigt den Rest), den CVSS-Vektor und die Referenzlinks (Herstellerhinweise, Patches).
- **Quellen**: der Stand der Schwachstelle bei der NVD (**analysiert**, **Analyse ausstehend**, **nicht analysiert**, **abgelehnt** oder **noch nicht diesem Produkt zugeordnet**), mit einem Link zu ihrer NVD-Seite. Hat KANAP den Eintrag des Herstellers gelesen, nennt eine zweite Zeile, wer ihn wann veröffentlicht hat, seine letzte Aktualisierung und **Auf CVE.org ansehen**.
- **Ausnutzung**, wenn ein Katalog, ein EPSS-Wert oder eine europäische Kennung bekannt ist. Siehe [Ausnutzung](#exploitation).
- **Server**: jeder Server, der eine betroffene Version selbst erfasst hat, mit Technologie und Version. Die über ein anderes Asset erreichten Server, etwa eine virtuelle Maschine auf einem Host oder ein Cluster über seine Mitglieder, verbirgt eine Schaltfläche, zum Beispiel **Auch die 4 über ein anderes Asset erreichten Server anzeigen**. Sie erscheinen unter einer eigenen Überschrift, **Über ein anderes Asset**, mit dem Asset, über das sie erreicht werden. Sie werden nicht gezählt.
- **Anwendungen**: jede Anwendung, die eine betroffene Version nutzt, einmal pro Version aufgeführt, mit ihren Servern (höchstens drei, dann „und 2 weitere“). Eine Anwendung, die die Technologie deklariert oder auf einem Server läuft, der sie erfasst hat, steht zuerst. Die anderen liegen hinter der gleichen Art von Schaltfläche und werden nicht gezählt.

Ist kein Server oder keine Anwendung direkt betroffen, sagt der Bereich das, und die Schaltfläche zeigt weiterhin die anderen.

Eine Version außerhalb der Warnungen ist ausgegraut, mit ihren Servern und Anwendungen. Ist nur ein Teil davon in den Warnungen, nennt eine Zeile über der Liste die Anzahl, zum Beispiel „3 Server, davon 1 in den Warnungen“.

Legen Sie den Status jeder Version fest:

| Status | Bedeutung |
|---|---|
| **Zu prüfen** | Niemand hat sie bisher angesehen |
| **Behandelt** | Die Version ist gepatcht, oder ein Workaround ist eingerichtet |
| **Nicht betroffen** | Die Schwachstelle gilt nicht für Ihre Installation |

Die Notiz hält fest, wie, zum Beispiel „am 12. März gepatcht, Change CHG-123“. Sie wird gespeichert, wenn Sie das Feld verlassen. Das Audit-Log hält fest, wer einen Status geändert hat und wann. Sie können auch [Plaid](#den-assistenten-fragen) bitten, einen Status zu ändern.

KANAP ändert nie einen Status, den Sie gewählt haben. Wenn eine Version nicht mehr passt (Sie haben sie aktualisiert, die Technologie wurde außer Betrieb genommen, eine Quelle hat ihre Daten geändert), verschwindet eine Zeile, die noch **Zu prüfen** ist. Eine geprüfte Zeile bleibt, ausgegraut, mit ihrem Status; sie kehrt unverändert zurück, wenn die Version wieder passt.

## Ausnutzung { #exploitation }

Eine Schwachstelle ist **aktiv ausgenutzt**, wenn der Katalog der CISA (Vereinigte Staaten) oder der Katalog der Europäischen Union sie führt, oder beide. Ein Warnsymbol steht neben dem Schweregrad, in der Liste und im Seitenbereich. Sein Tooltip nennt die Kataloge, die die Schwachstelle führen. Wenn die CISA einen Einsatz in Ransomware-Kampagnen verzeichnet, sagt der Tooltip das.

**EPSS** ist die Wahrscheinlichkeit, dass die Schwachstelle innerhalb der nächsten 30 Tage ausgenutzt wird. [FIRST](https://www.first.org/epss) berechnet sie jeden Tag. Die Spalte **EPSS (%)** zeigt sie als Prozentsatz. Der Seitenbereich ergänzt das Perzentil dieses Tages, wenn FIRST eines veröffentlicht, und den Tag des Werts. Der Bereich nennt das Verfahren: EPSS: FIRST.

Der Seitenbereich zeigt auch die Kennung **EUVD**, wenn die europäische Zuordnung eine nennt, mit dem Link **In der europäischen Schwachstellendatenbank (ENISA) ansehen**. Die europäische Schwachstellendatenbank der ENISA ist der europäische Katalog für die Prüfung von Schwachstellen im Rahmen von NIS2. Der Bereich nennt die Quelle: ENISA, europäische Schwachstellendatenbank.

Die Liste öffnet sich mit den aktiv ausgenutzten Schwachstellen, danach den schwersten. **Nur ausgenutzte** über dem Raster behält diese Zeilen (`?exploited=1`). **Filter zurücksetzen** schaltet es aus. Der Export und eine Statusänderung für mehrere Zeilen folgen ihm.

Die E-Mail an die IT-Verantwortlichen meldet eine ausgenutzte Schwachstelle jeden Schweregrads, auf den Versionen in den Warnungen, nach denselben Regeln wie eine kritische oder hohe: in den letzten 30 Tagen veröffentlicht, zu einem Produkt, mit dem die Technologie bereits verglichen wurde, noch zu prüfen. Eine bereits erkannte Schwachstelle, die später in einen Katalog aufgenommen wird, wird einmal als jetzt bekannt ausgenutzt gemeldet, wenn sie in den Warnungen ist.

## Export

**Exportieren** lädt die Schwachstellen, die den Filtern entsprechen, als CSV- oder Excel-Datei herunter, eine Zeile pro Zeile des Rasters, in seiner Reihenfolge, in der Sprache Ihres Bildschirms. In der Excel-Datei sind Scores, EPSS und Datumsangaben Werte, die Excel sortieren und filtern kann. Ihre Spalte **Source** nach **Match** enthält `NVD`, `CVE.org` oder `NVD, CVE.org`. Ab 10.000 Schwachstellen grenzen Sie die Filter zuerst ein.

## E-Mail-Benachrichtigungen

Nach jeder Prüfung erhalten die IT-Verantwortlichen einer Technologie eine E-Mail über ihre neuen Schwachstellen, die noch zu prüfen sind, auf den Versionen in den Warnungen. Die E-Mail umfasst eine kritische oder hohe Schwachstelle, oder eine bekanntermaßen ausgenutzte Schwachstelle jeden Schweregrads:

- **Was gemeldet wird**: eine Schwachstelle, die in den letzten 30 Tagen veröffentlicht wurde, zu einem Produkt, mit dem die Technologie bereits verglichen wurde, wenn sie kritisch, hoch oder als ausgenutzt geführt ist, oder eine bekannte Schwachstelle, die gerade kritisch oder hoch geworden ist.
- **Was nicht**: Der erste Vergleich einer Technologie, oder einer gerade hinzugefügten CPE-Kennung oder eines gerade hinzugefügten CVE.org-Namens, bleibt still. Ebenso der erste Vergleich einer Technologie mit der CVE.org-Liste. Ihre Ergebnisse warten auf dieser Seite.
- **Wie viel**: höchstens 25 Zeilen, eine pro Technologie und Schwachstelle, dann ein Link zur Seite, gefiltert auf die in den letzten 30 Tagen veröffentlichten Schwachstellen.
- **Wie oft**: Jede Person erfährt von einer Schwachstelle einer Technologie einmal. Eine Schwachstelle, die bei ihrer Prüfung nicht gemeldet wurde, wird auch später nicht gemeldet.

Empfänger sind die IT-Verantwortlichen der Technologie, deren Konto aktiv ist und die die Infrastruktur lesen dürfen. Jeder kann diese E-Mails unter **Technologie-Benachrichtigungen** in seinen Benachrichtigungseinstellungen abschalten. Siehe [Einstellungen](admin.md#benachrichtigungen). Solange der E-Mail-Versand auf Ihrer Installation nicht eingerichtet ist, geht keine E-Mail hinaus.

## Wo Schwachstellen außerdem erscheinen

- **Technologieliste**: die Spalte **Zu prüfende Schwachstellen**, orange, wenn kritische oder hohe darunter sind. Siehe [Technologien](technologies.md#mit-der-liste-arbeiten).
- **Technologie-Arbeitsbereich**: der Abschnitt **Schwachstellen** im Reiter Compliance. Siehe [Technologien](technologies.md#schwachstellen).
- **Listen der Assets und Anwendungen**: die Spalte **Zu prüfende Schwachstellen**. Siehe [Assets](assets.md#working-with-the-list) und [Anwendungen](applications.md#working-with-the-list).
- **Datensätze von Assets und Anwendungen**: der Abschnitt **Schwachstellen** und das Badge der schwerwiegenden Schwachstellen in der Kopfzeile. Siehe [Assets](assets.md#operations) und [Anwendungen](applications.md#operations).
- **Dashboard**: die Kachel **Schwachstellen im Bestand**. Siehe [Mein Dashboard](my-dashboard.md#vulnerabilities).
- **Plaid**: Der Assistent beantwortet Fragen zu Schwachstellen und ändert ihren Status. Siehe [Den Assistenten fragen](#den-assistenten-fragen).

## Den Assistenten fragen

[Plaid](ai-assistant.md) liest die Schwachstellen mit denselben Rechten wie diese Seite. Es zählt die Zeilen und die eindeutigen CVE, wie die Seite, behält auf Wunsch die im Bestand eingesetzten Technologien und sagt, wann KANAP jede Quelle zuletzt gelesen hat. Fragen Sie zum Beispiel: „Wie viele kritische Schwachstellen sind bei PostgreSQL zu prüfen, nach Version?“ oder „Welche ausgenutzten CVE betreffen APP-4?“

Mit `infrastructure:member` ändert Plaid auch den Status von Zeilen, und jede Änderung kommt als Vorschau, die Sie genehmigen:

- Nennen Sie eine CVE, um alle ihre Zeilen zu ändern, oder fügen Sie eine Technologie oder eine Technologie und eine Version hinzu.
- Oder beschreiben Sie die Zeilen mit den Filtern der Seite, zum Beispiel die kritischen Zeilen einer Technologie.
- Geben Sie eine Notiz an, um sie in jede Zeile zu schreiben. Ohne Notiz behält jede Zeile ihre eigene.

Eine Änderung umfasst höchstens 5.000 Zeilen, wie **Status ändern**. Die Vorschau sagt, wie viele Zeilen und CVE sich ändern und wie viele außerhalb der Warnungen liegen. Wenn Zeilen, die nicht mehr passen, auf **Zu prüfen** zurückgehen, zählt sie diese: Sie verschwinden beim nächsten Abgleich. **Akzeptiert** ist kein Status: Plaid bietet **Behandelt** mit einer Notiz wie „Risiko akzeptiert“ an, oder **Nicht betroffen**, und wartet auf Ihre Wahl. Bitten Sie Plaid, eine Änderung aus der Konversation rückgängig zu machen. Es lehnt ab, wenn sich eine Zeile seitdem geändert hat.

Fragen Sie zum Beispiel: „Setze CVE-2024-3094 auf TEC-3 Version 5.6 auf nicht betroffen, das Paket ist nicht installiert“ oder „Setze die kritischen Zeilen von PostgreSQL 14 auf behandelt mit der Notiz ‚im März gepatcht‘“.

Der erneute Abgleich (**Aktualisieren**) bleibt im Abschnitt **Schwachstellen** der Technologie. Siehe [Technologien](technologies.md#schwachstellen).

## Tipps

- **CPE-Kennungen ausfüllen**: Die meisten Technologien aus dem Katalog bringen sie mit, die Betriebssysteme eingeschlossen. Für die anderen suchen Sie das Produkt im CPE-Wörterbuch des NIST.
- **CVE.org-Namen hinzufügen**: Sie bringen Schwachstellen, die die NVD nicht analysiert hat. Viele Technologien aus dem Katalog bringen sie mit.
- **Versionen erfassen**: Ein Server oder eine Anwendung ohne Version ist potenziell von allem betroffen, was die tatsächliche Gefährdung verdeckt.
- **Die Notiz schreiben**: Wer die Schwachstelle als Nächstes liest, sieht, was getan wurde.
