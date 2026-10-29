# Technologien

Technologien erfassen, was die IT betreibt oder abonniert, damit Anwendungen funktionieren: SQL Server, vSphere, Active Directory, Entra ID, Tomcat. Jede Technologie listet ihre Versionen und deren Supportende-Daten, damit Sie wissen, welche Aufmerksamkeit brauchen, bevor sie zum Risiko werden.

## Was eine Technologie ist

KANAP beschreibt Ihre Landschaft in drei Bereichen:

| Bereich | Was er enthält | Beispiele |
|---|---|---|
| **Anwendungen** | Womit die Fachbereiche arbeiten | ERP, CRM, Lohnabrechnung, Intranet |
| **Technologien** | Was die IT für diese Anwendungen betreibt oder abonniert | SQL Server, vSphere, Active Directory, Entra ID, Tomcat |
| **Assets** | Wo es läuft | Server, virtuelle Maschinen, Cluster, Cloud-Datenbanken |

Ein Server trägt Technologien. Eine Anwendung wird auf Servern gehostet und hängt von Technologien ab.

Erfassen Sie als Anwendung, was Sie als Service verwalten, mit Verantwortlichen, Kritikalität, Verträgen und Kosten. Erfassen Sie als Technologie ein Produkt, das auf Ihren Servern installiert ist und über seine Versionen, Supportende-Daten und Schwachstellen verfolgt wird. In einer Technologie selbst arbeitet selten jemand, doch andere Anwendungen fallen aus oder werden angreifbar, wenn sie ausfällt. Ein Produkt kann beides sein: siehe VMware vSphere unten.

Einige Beispiele:

- **Entra ID**: eine **SaaS**-Technologie der Familie **Verzeichnis und Identität**, Hersteller Microsoft. Sie läuft auf keinem Ihrer Server. Die Anwendungen, deren Benutzer sich darüber anmelden, deklarieren sie.
- **Active Directory**: eine **On-Premise**-Technologie derselben Familie, getragen von Ihren Domänencontrollern. Die Anwendungen, die sie nutzen, deklarieren sie.
- **VMware vSphere**: eine **On-Premise**-Technologie, installiert auf dem vCenter-Server, während die Hosts ESXi tragen und der Virtualisierungsdienst als Anwendung geführt wird.
- **SQL Server**: eine Technologie mit einer Zeile pro Version im Einsatz (2016, 2019, 2022). Jeder Server trägt seine eigene Version, sodass der Supportende-Bericht die Server nennen kann, die noch auf einer alten laufen.
- **Windows Server**: eine Technologie der Familie **Betriebssystem**. Jeder Server erfasst seine Version, und diese Technologie ist das Betriebssystem des Servers. Siehe [Betriebssysteme](#betriebssysteme).
- **Eine SaaS-Anwendung**: keine Technologie zu erfassen. Der Anbieter pflegt, worauf sie läuft.

Eine Technologie umfasst ein Produkt als Ganzes. „SQL Server" steht für alle SQL Server, die Sie betreiben; die Versionen tragen die Details.

## Erste Schritte

Navigieren Sie zu **IT-Landschaft > Technologien** und klicken Sie auf **Neue Technologie**.

Das Fenster öffnet sich auf dem **Katalog**: einer Liste gängiger Produkte mit einer kurzen Beschreibung, Hersteller, Familie und Hosting-Typ. Suchen Sie nach dem Namen und klicken Sie auf einen Eintrag. KANAP legt die Technologie sofort mit Hersteller, Familie, Hosting-Typ, CPE-Produktkennungen, CVE.org-Namen, ihren Versionen samt Supportende-Daten und der kurzen Beschreibung in Ihrer Sprache an und öffnet sie. Ein Eintrag bleibt angeboten, wenn eine Technologie desselben Namens von Hand erfasst wurde. Das Hinzufügen ergänzt diese Technologie, und der Eintrag weist darauf hin (Ergänzt TEC-10).

Eine aus dem Katalog übernommene Technologie bleibt aktuell: Wenn der Hersteller eine neue Version veröffentlicht oder ein Datum ändert, fügt KANAP die Version hinzu und verschiebt das Datum (siehe [Versionen aus dem Katalog](#versionen-aus-dem-katalog)).

Für ein Produkt, das der Katalog nicht kennt, klicken Sie auf **Eine Technologie erfassen, die nicht im Katalog steht**. Füllen Sie aus:

- **Name** (Pflichtfeld): eindeutig unter Ihren Technologien.
- **Familie**: die Art der Technologie (Datenbank, Hypervisor, Verzeichnis und Identität usw.).
- **Hersteller**: Die Vorschläge stammen aus Ihren anderen Technologien und aus dem Katalog, sodass derselbe Hersteller eine einzige Schreibweise behält.
- **Hosting-Typ**: wo die Technologie läuft. Standardmäßig **On-Premise**. Siehe [Hosting-Typ](#hosting-typ).

**Berechtigungen**:

- Anzeigen: `infrastructure:reader`
- Anlegen und bearbeiten: `infrastructure:member`
- Löschen: `infrastructure:admin`

## Betriebssysteme

Das Betriebssystem eines Servers ist eine Technologie der Familie **Betriebssystem**. Fügen Sie sie dem Server wie jede andere Technologie hinzu, mit ihrer Version: Hat der Server noch keines, wird sie zu seinem Betriebssystem. Die Serverseite zeigt sie an erster Stelle ihres Abschnitts **Technologien**, mit dem Vermerk „Betriebssystem“. Siehe [Assets](assets.md#betriebssystem).

Der Katalog bietet Windows Server, Ubuntu, Red Hat Enterprise Linux, Debian, SUSE Linux Enterprise Server, Rocky Linux, AlmaLinux, Oracle Linux, Amazon Linux, Alpine Linux, CentOS, IBM AIX, IBM i und Oracle Solaris. Er führt die Versionen, deren Support 2010 oder später endete, und für Windows Server nur die Versionen mit langem Support.

Was die beiden Supportdaten bedeuten, hängt vom Hersteller ab:

| Betriebssystem | Ende des Standardsupports | Ende des erweiterten Supports |
|---|---|---|
| **Ubuntu**, **Red Hat Enterprise Linux**, **SUSE Linux Enterprise Server** | Ende der Sicherheitsupdates | Ende der kostenpflichtigen Verlängerung |
| **Windows Server** | Ende des grundlegenden Supports | Ende des erweiterten Supports |
| **Debian** | Ende des regulären Supports | Ende von Debian LTS |

Jede Technologie kann ein Betriebssystem sein: Ordnen Sie VMware ESXi oder FortiOS der Familie **Betriebssystem** zu, dann kann sie das Betriebssystem eines Hosts oder einer Firewall sein.

Die Betriebssysteme des Katalogs haben CPE-Produktkennungen, und KANAP gleicht sie mit veröffentlichten Schwachstellen ab.

Linux-Distributionen veröffentlichen ihre Schwachstellen pro Paket. KANAP verfolgt den Support jeder Version und gleicht die Schwachstellen ab, die der Hersteller der Version zuordnet. KANAP weiß nicht, welche Pakete ein Server installiert hat und auf welchem Stand. Für die Linux-Distributionen des Katalogs führt die Versionstabelle zum Sicherheitstracker des Anbieters, in dem Sie jedes Paket prüfen können. Siehe [Versionen aus dem Katalog](#versionen-aus-dem-katalog).

Betriebssysteme sind standardmäßig von den Warnungen zu Schwachstellen ausgeschlossen. KANAP kennt den Patchstand eines Servers nicht, daher würde ein Betriebssystem sehr viele Schwachstellen melden, die meisten davon bereits gepatcht. Das gilt für eine Technologie der Familie **Betriebssystem** und für ein aus dem Katalog übernommenes Betriebssystem, unabhängig von seiner Familie. Eine bestehende Technologie, die Sie als Betriebssystem aus dem Katalog übernehmen, wird ebenfalls ausgeschlossen. Sie können sie wieder einschließen: siehe [Warnungen zu Schwachstellen](#warnungen-zu-schwachstellen).

Installationen, die von einer früheren Version aktualisiert wurden, behalten ihre Daten: Die von den Servern genutzten Betriebssysteme und die Einträge, die der früheren Betriebssystemliste der Einstellungen hinzugefügt wurden, sind zu Technologien geworden, mit ihren Versionen und Daten.

---

## Mit der Liste arbeiten

Jede Zeile ist eine Technologie. Klicken Sie auf eine Zeile, um sie zu öffnen.

**Standardspalten**:

| Spalte | Was sie zeigt |
|---|---|
| **Referenz** | Die Referenz der Technologie (`TEC-4`) |
| **Name** | Der Name der Technologie |
| **Familie** | Die Art der Technologie |
| **Hersteller** | Wer sie herausgibt |
| **Server** | Assets in Betrieb, auf denen sie installiert ist. Cluster werden nicht gezählt, ebenso wenig die virtuellen Maschinen eines Hosts, der sie trägt. Das Badge **Server** des Datensatzes und der Bericht [Supportende](end-of-support.md) zeigen dieselbe Zahl |
| **Anwendungen** | Anwendungen, die sie deklarieren oder auf einem Server gehostet werden, der sie trägt |
| **Nächstes Supportende** | Das früheste kommende Ende des Standardsupports unter den Versionen im Einsatz. Orange, wenn es in die nächsten 12 Monate fällt |
| **Zu prüfende Schwachstellen** | Die bekannten Schwachstellen, die auf den Versionen im Einsatz in den Warnungen noch zu prüfen sind. Orange mit der Anzahl der kritischen oder hohen (`3 · 1 kritisch oder hoch`). Ein Klick öffnet die Seite [Schwachstellen](vulnerabilities.md) für diese Technologie. Vorhanden, wenn Schwachstellen verfolgt werden |

**Weitere Spalten** (über die Spaltenauswahl): **Lebenszyklus**, **Versionen im Einsatz**, **IT-Verantwortlicher**.

Wenn Schwachstellen verfolgt werden, öffnet die Spalte **Hersteller** auch die Seite Schwachstellen für die Produkte dieses Herstellers. Wann sie verfolgt werden, steht unter [Schwachstellen](vulnerabilities.md).

**Filter**: **Familie**, **Hersteller** und **Lebenszyklus** bieten Kontrollkästchen-Filter. Das Suchfeld durchsucht Name, Hersteller und Referenz.

**Aktionen**:

- **Neue Technologie** (`infrastructure:member`).
- **Verknüpfungen importieren** (`infrastructure:member`) und **Verknüpfungen exportieren**: Laden Sie die Verknüpfungen zwischen Technologien und Servern oder Anwendungen als CSV-Datei oder Excel-Arbeitsmappe hoch oder herunter. Siehe [Verknüpfungen importieren und exportieren](#verknupfungen-importieren-und-exportieren).
- **Löschen** der ausgewählten Zeilen (`infrastructure:admin`). Die Bestätigung zählt, was mitgelöscht wird: Verknüpfungen zu Servern und Anwendungen, Verträge, Budgetzeilen, Projekte, Vorfälle und Dokumente.

---

## Der Technologie-Arbeitsbereich

Der Arbeitsbereich hat eine Kopfzeile, ein Eigenschaftenfeld rechts und sieben Reiter: **Übersicht**, **Server**, **Anwendungen**, **Betrieb**, **Compliance**, **Beziehungen** und **Verlauf** (die Änderungen an der Technologie, siehe [Verlauf der Datensätze](record-history.md)). Die Reiter **Server**, **Anwendungen** und **Beziehungen** zeigen ihre Anzahl als Badge.

### Kopfzeile

- **Name**: direkt bearbeitbar.
- **Referenz**: zum Kopieren anklicken.
- **Lebenszyklus**: zum Ändern anklicken. Eine ausgemusterte Technologie wird beim Suchen nach einer zu verknüpfenden Technologie nicht mehr angeboten.
- **Familie**.
- **Löschen**, ein Papierkorbsymbol (`infrastructure:admin`): Die Bestätigung nennt, was mit der Technologie gelöscht wird.

### Eigenschaftenfeld

- **Hersteller**, **Familie** und **Hosting-Typ**.
- **Administrationszone**: nur für die Technologien der Familie **Verzeichnis und Identität** angezeigt. Sie ordnet einen Verzeichnisdienst einer Zone Ihres Administrationsmodells zu, zum Beispiel Tier 0 für Entra ID, das auf keinem Ihrer Server läuft. Die Zonen stammen aus **IT-Landschaft > Einstellungen**, und die Seite [Administrationszonen](administration-view.md) listet die Verzeichnisdienste mit ihrer Zone. Die übrigen Technologien erhalten keine Zone: Ordnen Sie stattdessen die Server zu, die sie tragen. Eine früher bei einer Technologie einer anderen Familie gesetzte Zone bleibt sichtbar, nur lesend, mit dem Hinweis, dass der Wert nicht mehr verwendet wird.
- **Ersetzt durch**: die Technologie, die diese ablöst, zum Beispiel ein neueres Produkt, zu dem Ihre Teams wechseln.
- **IT-Verantwortliche**: die für die Technologie zuständigen Personen.

Änderungen werden sofort gespeichert.

#### Hosting-Typ

Der Hosting-Typ sagt, wo die Technologie läuft. Die Liste ist die der **Hosting-Typen** unter **IT-Landschaft > Einstellungen**, gemeinsam mit den Standorten: standardmäßig **On-Premise**, **Colocation**, **Public Cloud**, **Private Cloud** und **SaaS**. Jeder Typ ist entweder vor Ort oder in der Cloud:

- **Vor Ort** (On-Premise, Colocation): Die Technologie wird auf Ihren Servern erwartet. Eine, die auf keinem Server läuft, erscheint in den **Fehlenden Daten** des Berichts [Supportende](end-of-support.md#fehlende-daten).
- **In der Cloud** (Public Cloud, Private Cloud, SaaS): Der Anbieter betreibt sie, zum Beispiel Entra ID oder ein verwalteter Kubernetes-Dienst. Deklarieren Sie sie bei den Anwendungen, die sie nutzen.

Ein als **Nicht mehr anbieten** markierter Typ bleibt bei den Technologien, die ihn haben. Ein aus den Einstellungen entfernter Typ, oder eine Liste ohne Typ in Verwendung, lässt die Technologie ebenfalls in den **Fehlenden Daten** erscheinen.

### Übersicht

**Beschreibung**: wofür die Technologie dient.

**Versionen**: eine Zeile pro verfolgter Version, mit **Ende des Standardsupports**, **Ende des erweiterten Supports** und einem **Status**:

| Status | Bedeutung |
|---|---|
| **Unterstützt** | Der Standardsupport endet in mehr als 12 Monaten |
| **Endet bald** | Der Standardsupport endet innerhalb von 12 Monaten |
| **Erweiterter Support** | Der Standardsupport ist beendet; der erweiterte Support läuft noch |
| **Kein Support** | Alle Enddaten sind überschritten |
| **Datum unbekannt** | Kein Enddatum erfasst |

Der Support läuft an seinem Enddatum noch. Bei nur einem Datum ist dieses Datum das Ende. **Version hinzufügen** fügt eine Zeile hinzu; fahren Sie über eine Zeile, um sie zu bearbeiten oder zu löschen. Das Löschen einer Version, die Server oder Anwendungen nutzen, fragt zuerst nach, mit der Zahl der Server, auf denen sie installiert ist, und der Anwendungen: Diese Verknüpfungen zeigen dann eine unbekannte Version.

**Notizen**: unten im Reiter, Freitext, etwa Lizenzbedingungen oder Verlängerungstermine.

#### Warnungen zu Schwachstellen

Wenn Schwachstellen verfolgt werden, legt die Versionstabelle fest, welche Versionen in den Warnungen zu Schwachstellen zählen. Eine Version in den Warnungen erscheint standardmäßig auf der Seite [Schwachstellen](vulnerabilities.md), in den E-Mails und in den Zählern. Eine Version außerhalb der Warnungen wird weiter mit den Schwachstellen abgeglichen: Der Abschnitt [Schwachstellen](#schwachstellen) der Technologie zeigt sie weiterhin, und die Seite zeigt ihre Zeilen über ihren Filter **Warnungen**.

- **In Schwachstellenwarnungen aufnehmen**: der Schalter in der Titelzeile **Versionen**, neben **Version hinzufügen**. Er ist die Einstellung der Technologie. Fahren Sie mit der Maus darüber für einen Hinweis: Sie gilt für die Versionen ohne eigene Einstellung, für später hinzugefügte Versionen und für die Server und Anwendungen, die keine Version angeben. Eine Änderung ersetzt die eigenen Einstellungen der Versionen; haben einige eine, fragt KANAP zuerst nach und nennt ihre Anzahl. Der Schalter erscheint auch, wenn die Technologie keine Version hat.
- Spalte **Warnungen**: ein Schalter pro Version, für eine Ausnahme bei einer Version. Das Informationssymbol in ihrer Kopfzeile erklärt beim Überfahren, was sie bewirkt. Ein kleiner Punkt neben dem Schalter markiert eine Version mit eigener Einstellung. Stellen Sie den Schalter auf den Wert der Technologie zurück, dann folgt die Version wieder der Technologie.

Neue Technologien sind in den Warnungen, mit zwei Ausnahmen:

- **Betriebssysteme**: siehe [Betriebssysteme](#betriebssysteme).
- **Von einem Anbieter betriebene Cloud-Dienste**: eine Technologie, deren [Hosting-Typ](#hosting-typ) in der Cloud liegt, etwa **Public Cloud** oder **SaaS**, und ein Katalogeintrag, den der Anbieter betreibt, etwa Entra ID. Der Anbieter patcht einen Online-Dienst, daher verlangen seine Schwachstellen keine Maßnahme von Ihnen. Eine Technologie in einer **Private Cloud** bleibt in den Warnungen.

Eine spätere Änderung der Familie oder des Hosting-Typs lässt die Einstellung unverändert. Die Schalter erfordern `infrastructure:member`.

#### Versionen aus dem Katalog

Eine Version aus dem Katalog zeigt **Katalog** neben ihrer Bezeichnung, und eine aus dem Katalog übernommene Technologie zeigt unter ihren Versionen „Versionen und Daten werden aus dem Katalog aktuell gehalten“. In der Cloud prüft KANAP den Katalog täglich. Bei einer On-Premise-Installation bringt jede KANAP-Version ihren Katalog beim Start mit, sofern Ihr Administrator nicht [die tägliche Prüfung einschaltet](on-premise/configuration.md#optional-technology-catalog).

Die Daten stammen aus zwei Quellen. Die meisten Produkte beziehen sie von endoflife.date. Für die Produkte, die endoflife.date nicht abdeckt, etwa Cisco NX-OS, Juniper Junos oder Dell PowerStore, erhebt KANAP die Daten auf den offiziellen Seiten des Herstellers. Jede KANAP-Version bringt diese Daten auf den neuesten Stand.

Eine Version, deren Daten KANAP erhoben hat, zeigt ihre Quelle unter ihrer Bezeichnung: „Quelle:“, den Hersteller und den Tag, an dem die Daten geprüft wurden. Der Name des Herstellers führt zur Seite, aus der die Daten stammen. Die Zeile bleibt, solange beide Enddaten dem Katalog entsprechen. Sie verschwindet, sobald Sie eines davon ändern. Wenn der Hersteller kein Supportende plant, wie bei IBM WebSphere 8.5 und 9.0, zeigen beide Supportende-Spalten „Kein Ende vom Hersteller geplant“.

Einige Produkte haben keine öffentlichen Daten: HPE Aruba Networking AOS-CX, Pure Storage Purity//FA, HPE Alletra 5000/6000 (NimbleOS), Rubrik CDM, Cohesity DataProtect und PRTG Network Monitor. Der Katalog bringt sie ohne Versionen. Erfassen Sie Ihre Versionen und deren Daten selbst.

Eine Linux-Distribution aus dem Katalog zeigt eine Zeile unter der Tabelle: „Dieser Anbieter veröffentlicht Schwachstellen pro Paket“. Die Zeile führt zum Sicherheitstracker des Anbieters, zum Beispiel zum Debian-Sicherheitstracker oder zu den Red Hat Sicherheitsupdates. Dort sehen Sie, welche Pakete eine Schwachstelle betrifft und welche Updates sie beheben. Siehe [Betriebssysteme](#betriebssysteme).

Die Prüfung fügt die neuen Versionen, CPE-Produktkennungen und CVE.org-Namen des Produkts hinzu und aktualisiert die Supportende-Daten, Kennungen und Namen, die der Katalog geändert hat. Sie überschreibt nie einen Wert, den Sie geändert haben, und stellt nie eine Version, Kennung oder einen Namen wieder her, die Sie gelöscht haben. Eine Version, die Sie erfasst haben, bevor der Katalog sie kannte, wird ihm bei gleicher Bezeichnung zugeordnet, und ihre leeren Daten werden ergänzt.

#### Schwachstellenkennungen

Die Gruppe **Schwachstellenkennungen** unter den Versionen fasst die CPE-Produktkennungen und die CVE.org-Namen zusammen. Über sie findet KANAP die Schwachstellen einer Technologie.

- **Eingeklappt**: Hat die Technologie mindestens eine Kennung, ist die Gruppe eingeklappt, mit einer Zusammenfassung in ihrer Titelzeile, zum Beispiel `2 CPE-Kennungen · 3 CVE.org-Namen`. Klicken Sie auf den Titel, um sie zu öffnen.
- **Geöffnet**: Hat die Technologie keine, ist die Gruppe geöffnet, mit einem Warnhinweis: Für diese Technologie wird nach keiner Schwachstelle gesucht. Der Abschnitt **Versionen** weist ebenfalls darauf hin. Mit `infrastructure:member` öffnet **Kennung hinzufügen** neben diesem Hinweis die Gruppe.

Der Abgleich erfolgt auf Ebene der Technologie. Jede Version der Technologie wird mit den Schwachstellen ihrer Kennungen verglichen, und eine Version, die Sie hinzufügen, wird sofort abgeglichen. Ohne Kennung sucht KANAP für keine Version nach Schwachstellen.

**CPE-Produktkennungen**: die Namen, die Sicherheitsdatenbanken diesem Produkt geben, in der Form `part:vendor:product` (zum Beispiel `a:microsoft:sql_server`). KANAP gleicht sie mit den veröffentlichten Schwachstellen ab. Ein Produkt kann mehrere haben (vSphere umfasst vCenter und ESXi). Wo Sie diesen Wert finden: Suchen Sie das Produkt im [CPE-Wörterbuch des NIST](https://nvd.nist.gov/products/cpe/search) und übernehmen Sie Teil, Hersteller und Produkt. Übernehmen Sie sie so, wie die NVD sie schreibt, mit dem Backslash vor einem Zeichen: `a:veeam:veeam_backup_\&_replication`. Die meisten Katalogeinträge bringen ihre Kennungen mit, die Betriebssysteme eingeschlossen.

**CVE.org-Namen**: die Hersteller- und Produktnamen, so wie der Hersteller sie in seinen eigenen Schwachstelleneinträgen schreibt, zum Beispiel Hersteller `SAP_SE` und Produkt `SAP HANA Database`. KANAP gleicht sie mit der CVE.org-Liste ab, die auch Schwachstellen enthält, die die NVD nicht analysiert hat (siehe [Schwachstellen](vulnerabilities.md#wie-kanap-sie-findet)). Die Namen stehen unter den CPE-Produktkennungen und erscheinen, wenn KANAP die CVE.org-Liste liest. Jeder Name wird einzeln aufgeführt.

- **Einen Namen hinzufügen**: Geben Sie einen Teil des Produktnamens in die Suche ein. Die Liste zeigt die genauen Namen, die die Hersteller in ihren Einträgen schreiben, jeweils mit der Anzahl ihrer Schwachstellen und dem Datum der letzten. Wählen Sie einen aus, mit einer optionalen Version. Ein Name, der nicht in der Liste steht, lässt sich nicht eintippen.
- **Vorschläge**: die Namen, die auf den Schwachstellen Ihrer CPE-Kennungen vorkommen. Jeder zeigt seine Anzahl an Schwachstellen und den Anteil dieser Schwachstellen, die ihn tragen.
- **Genaue Namen**: Der Vergleich ignoriert Groß- und Kleinschreibung sowie Satzzeichen und verlangt ansonsten den genauen Namen. Ein ähnlicher Name passt nicht: Erfassen Sie jede Variante eines Produkts einzeln. Zum Beispiel findet `Microsoft SQL Server 2008` nichts: Die Einträge schreiben `Microsoft SQL Server 2008 Service Pack 4 (QFE)`. Wählen Sie diesen Namen, mit der Version `2008`.
- **Version**: Eine Version beschränkt den Namen auf die Versionen der Technologie, deren Bezeichnung mit ihr beginnt, zum Beispiel `2019` für `Windows Server 2019`. Beginnt eine Bezeichnung mit mehreren davon, zählt nur die längste: `2012 R2` erhält den Namen von `2012 R2` und nicht den von `2012`.
- **Aus dem Katalog**: Viele Katalogeinträge bringen ihre Namen mit (Microsoft, Apache, Datenbanken und andere). Die Katalogprüfung hält sie wie die CPE-Kennungen aktuell, und ein Name, den Sie entfernt haben, kommt nicht zurück.

Wo Sie diesen Wert finden: Öffnen Sie auf [cve.org](https://www.cve.org) den Eintrag einer Schwachstelle des Produkts. Der Name muss der aus seinem Abschnitt **Product status** sein. Zum Ändern der Namen brauchen Sie `infrastructure:member`, wie für die CPE-Kennungen.

### Server

Die Server, die die Technologie tragen, eine Zeile pro Server und Version:

| Spalte | Was sie zeigt |
|---|---|
| **Ref.**, **Server** | Der Server. Ein Cluster zeigt ein Symbol vor seinem Namen. Ein Klick auf die Zeile öffnet ihn |
| **Umgebung**, **Betriebssystem** | Vom Server übernommen |
| **Version** | Die installierte Version. Ein Strich bedeutet, dass die Version unbekannt ist |
| **Über** | Bei einem Server, der die Technologie über einen anderen trägt: die Assets, auf denen sie installiert ist. Die Spalte erscheint nur, wenn der Reiter eine solche Zeile hat |
| **Notizen** | Freitext zu dieser Installation, zum Beispiel „Clusterknoten“ |

Eine Technologie erreicht einen Server auf zwei Wegen:

- **Installiert**: Jemand hat die Technologie mit diesem Server verknüpft. Sie können Version und Notizen direkt ändern oder die Zeile entfernen.
- **Über einen anderen Server**: Bei einem Cluster ist die Technologie auf seinen Mitgliedern installiert. Zum Beispiel erscheint SQL Server, auf den Knoten eines Clusters installiert, auf dem Cluster in einer Zeile pro Version, mit den Knoten, die ihn tragen, unter **Über**. Sie folgt der Installation: Ändern oder entfernen Sie sie auf jenen Servern.

Die Server, die in einem Host laufen, der die Technologie trägt, etwa die virtuellen Maschinen eines ESXi-Hosts, stehen unter einer geschlossenen Zeile am Ende der Tabelle, **Gehostete Assets (n)**. Klicken Sie darauf, um sie anzuzeigen, mit ihrem Host unter **Über**.

**Hinzufügen** (`infrastructure:member`) öffnet eine Serversuche, dann die Versionsauswahl: Wählen Sie eine Version, **Version unbekannt**, oder geben Sie eine neue Bezeichnung ein und wählen Sie **Version „…“ hinzufügen**, um sie anzulegen. Jede Änderung wird sofort gespeichert.

Ein außer Betrieb genommener Server bleibt gelistet, ausgegraut und als „außer Betrieb“ markiert, damit Sie seine Verknüpfung entfernen können. Er zählt nirgends: weder im Badge noch in der Summe, den Zählern der Liste oder den Berichten. Das Badge und die Zeile **Gesamt** zählen die Server in Betrieb, auf denen die Technologie installiert ist, jeden einmal. Ein Cluster und ein gehostetes Asset werden gelistet, aber nicht gezählt.

### Anwendungen

Die Anwendungen, die die Technologie nutzen, eine Zeile pro Anwendung, Umgebung, Server und Version. Um diesen Reiter zu sehen, müssen Sie Anwendungen lesen dürfen; ohne dieses Recht sagt es eine einzelne Zeile. Ein Business Contributor sieht nur seine eigenen Anwendungen.

| Spalte | Was sie zeigt |
|---|---|
| **Ref.**, **Anwendung** | Die Anwendung. Ein Klick auf die Zeile öffnet sie |
| **Umgebung** | Die Umgebung der Bereitstellung |
| **Kritikalität** | Die geschäftliche Kritikalität der Anwendung |
| **Extern** | „Ja“, wenn die Anwendung nach außen erreichbar ist |
| **Server** | Der Server, der die Technologie für diese Bereitstellung trägt, mit seinem Host, wenn er in einem anderen Server läuft. **Deklariert** für eine von Hand hinzugefügte Zeile |
| **Version** | Die genutzte Version. Ein Strich bedeutet, dass die Version unbekannt ist |
| **IT-Verantwortlicher** | Die IT-Verantwortlichen der Anwendung |

Eine Anwendung erscheint auf zwei Wegen:

- **Gehostet**: Eine ihrer Bereitstellungen läuft auf einem Server, der die Technologie trägt. KANAP leitet die Zeile aus den Servern ab; ändern Sie den Server oder die Bereitstellung, um sie zu ändern.
- **Deklariert**: Die Anwendung hängt von der Technologie ab, ohne neben ihr zu laufen, zum Beispiel eine Anwendung, deren Benutzer sich über Entra ID anmelden. Ändern Sie die Version direkt oder entfernen Sie die Deklaration. Das Entfernen zieht alle deklarierten Versionen dieser Anwendung zurück.

**Hinzufügen** (`infrastructure:member`) öffnet eine Suche, in der Sie mehrere Anwendungen ankreuzen und in einem Schritt hinzufügen können. Sie werden mit unbekannter Version deklariert: Tragen Sie sie danach in jeder Zeile ein. Deaktivierte Anwendungen und Bereitstellungen zählen nicht.

**Exportieren** lädt die Zeilen als CSV- oder Excel-Datei herunter, in der Sprache Ihres Bildschirms.

### Betrieb

Wen Sie anrufen und wie Sie Hilfe bekommen:

- **Support**: die Support-Kontakte mit **E-Mail**, **Telefon** und **Rolle**. **Kontakt hinzufügen** öffnet ein kurzes Formular: Wählen Sie den **Kontakt** (Pflicht) und geben Sie optional eine **Rolle** an. Ein Kontakt wird einmal gelistet; ein erneutes Hinzufügen behält seine Rolle. Entfernen Sie einen Kontakt mit dem Kreuz am Ende seiner Zeile.
- **Support-Notizen**: Freitext, etwa die Nummer des Supportvertrags, die Zeiten der Hotline oder der Eskalationsweg. Sie werden gespeichert, wenn Sie das Feld verlassen.

Die Technologie erscheint dann im Abschnitt **Verwendet in** der Seite jedes Kontakts.

### Compliance

Dieselbe Einstufung wie bei Anwendungen, für die Technologien, die in Ihren Kontinuitätsplänen zählen:

- **Kritikalität**: **Cyberkritikalität**.
- **Kontinuität und Wiederanlauf**: **Wiederanlaufwelle**, **Wiederanlaufzeitziel (RTO)** und **Datenverlustziel (RPO)**.

Die Stufen und Wellen stammen aus **Einstufungen und Kontinuität** in den [IT-Landschaft-Einstellungen](it-ops-settings.md#einstufungen-und-kontinuitat). Fahren Sie über das Fragezeichen neben einem Feld, um seine Bedeutung zu sehen.

Darunter fasst der Abschnitt **Schwachstellen** die bekannten Schwachstellen jeder Version zusammen, wenn Schwachstellen verfolgt werden. Siehe [Schwachstellen](#schwachstellen).

#### Schwachstellen

Eine Zusammenfassung der Schwachstellen, eine Zeile pro installierter Version der Technologie, in der Reihenfolge der Versionstabelle. Die Zahl neben dem Titel ist die Anzahl verschiedener Schwachstellen, alle Status zusammen.

| Spalte | Was sie zeigt |
|---|---|
| **Version** | Die Version. Eine Version außerhalb der Warnungen ist ausgegraut und zeigt **Von den Warnungen ausgeschlossen**. **Version nicht erfasst (möglicherweise betroffen)** fasst die Server und Anwendungen zusammen, die keine Version angeben; diese Zeile erscheint nur, wenn es solche gibt |
| **Server** | Wie viele Server in Betrieb diese Version selbst erfasst haben. Cluster und Server, die in einem anderen laufen, werden nicht gezählt. Siehe [Was KANAP zählt](vulnerabilities.md#what-kanap-counts) |
| **Kritisch**, **Hoch**, **Mittel**, **Niedrig**, **Nicht bewertet** | Eine Spalte pro Schweregrad: die noch zu prüfenden Schwachstellen. Eine Schwachstelle mit dem Schweregrad **Keine** zählt bei **Niedrig**. Ein Punkt bedeutet, dass keine mehr übrig ist. Fahren Sie über eine Überschrift für einen Hinweis |
| **Gesamt** | Die verschiedenen Schwachstellen dieser Version, alle Status zusammen |

**Ansehen** öffnet die Seite [Schwachstellen](vulnerabilities.md), gefiltert auf die Version: auf ihre zu prüfenden Schwachstellen, wenn sie welche hat, sonst auf alle Status. **Alles auf der Seite Schwachstellen ansehen** unter der Tabelle öffnet die Seite für die ganze Technologie, alle Status zusammen.

Versionen, die kein Server und keine Anwendung nutzt, erhalten keine Zeile. Sie werden unter der Tabelle zusammen genannt, zum Beispiel „Nicht installiert: 2016, 2017“. KANAP sucht nur nach Schwachstellen von Versionen, die auf einem Server installiert oder von einer Anwendung deklariert sind.

Sind die Technologie oder einige ihrer Versionen außerhalb der Warnungen, sagt es eine Zeile oben im Abschnitt: **Von den Warnungen ausgeschlossen**, **Von den Warnungen ausgeschlossen, außer 2 Versionen** oder **3 Versionen von den Warnungen ausgeschlossen**. Mit `infrastructure:member` öffnet **Ändern** daneben die Versionstabelle im Reiter Übersicht, wo die Schalter sind. Siehe [Warnungen zu Schwachstellen](#warnungen-zu-schwachstellen).

KANAP gleicht die Technologie erneut ab, sobald sich ihre Kennungen, CVE.org-Namen, Versionen, Server oder Anwendungen ändern. Nach einer neuen CPE-Produktkennung zeigt der Abschnitt „Suche nach Schwachstellen läuft…“, während KANAP dieses Produkt aus der NVD liest. Wenn dieses Lesen nicht abgeschlossen werden kann, sagt der Abschnitt das. **Aktualisieren** (`infrastructure:member`) startet den Vergleich von Hand.

### Beziehungen

Die mit der Technologie verknüpften Datensätze, ein Abschnitt pro Art:

- **Budgetzeilen**: mit dem Betrag des laufenden Jahres in der Budgetspalte Ihres Arbeitsbereichs und einer Summe. Eine Zeile, deren Währung für das Jahr keinen Wechselkurs hat, zeigt ihren Betrag in ihrer eigenen Währung mit einer kleinen orangefarbenen Markierung, und die Summe lässt sie aus. Ein einzeiliger Hinweis unter der Tabelle nennt sie. Siehe [Manuelle Kurse](currencies.md#manuelle-kurse).
- **Verträge**: Lieferant, Enddatum und Jahresbetrag, mit einer Summe pro Währung.
- **Projekte**: Status und geplantes Ende.
- **Vorfälle**: Schweregrad, Status und Erkennungsdatum. Das Verknüpfen eines Vorfalls erfordert `incidents:contributor`. Ein geschlossener oder abgebrochener Vorfall kann weder verknüpft noch gelöst werden.
- **Links und Dateien**: die Weblinks der Technologie und ihre Dateien, je eine Zeile mit Name, der Domain des Links oder der Größe der Datei und dem Datum, an dem sie hinzugefügt wurden. Klicken Sie auf einen Link, um ihn in einem neuen Tab zu öffnen, oder auf eine Datei, um sie herunterzuladen. Mit `infrastructure:member` fügen **Link hinzufügen** und **Datei anhängen** eine Zeile hinzu, und Dateien können auch auf den Abschnitt gezogen werden. Fahren Sie über eine Zeile, um einen Link zu bearbeiten oder eine Zeile zu entfernen. Das Entfernen eines Links zeigt eine Meldung und bietet **Rückgängig** an, womit der Link wieder angelegt wird. Das Löschen einer Datei fragt nach einer Bestätigung. Eine Adresse ohne `http://` oder `https://` erhält `https://`. Jedes andere Schema wird abgelehnt.

Ein Abschnitt erscheint nur, wenn Sie sein Modul lesen dürfen. **Hinzufügen** (`infrastructure:member`) öffnet eine Suche an Ort und Stelle; das Kreuz am Ende einer Zeile entfernt die Verknüpfung.

---

## Eine Technologie mit einem Server verknüpfen

Dass ein Server eine Technologie trägt, erfassen Sie von beiden Seiten:

- Von der Technologie aus: Reiter **Server**, **Hinzufügen**, dann Server und Version wählen.
- Vom Server aus: Reiter **Betrieb** des Assets, Abschnitt **Technologien**, **Hinzufügen**, dann Technologie und Version wählen. Siehe [Assets](assets.md#operations).

Erfassen Sie die Technologie auf dem Server, auf dem sie installiert ist: dem Host für einen Hypervisor, jedem Domänencontroller für Active Directory, dem Datenbankserver für SQL Server. Die Server, die darin laufen, und der Cluster dieser Server zeigen sie dann ohne weitere Eingabe. Eine Cloud-Technologie wie Entra ID läuft auf keinem Ihrer Server: Deklarieren Sie sie stattdessen bei den Anwendungen.

---

## Verknüpfungen importieren und exportieren

Die Technologieliste lädt Verknüpfungen in großer Zahl hoch und herunter, eine Verknüpfung pro Zeile einer CSV-Datei oder Excel-Arbeitsmappe. Es gibt zwei Dateien:

- **Server und Technologien**: die auf jedem Server installierten Technologien.
- **Anwendungen und Technologien**: die Technologien, die jede Anwendung deklariert. Anwendungen, die auf einem Server laufen, der eine Technologie trägt, werden aus den Servern abgeleitet; die Datei lässt sie weg.

Klicken Sie in der Symbolleiste auf **Verknüpfungen importieren** oder **Verknüpfungen exportieren** und wählen Sie dann die Datei. Der Export bietet die Daten als CSV oder Excel oder eine leere CSV-Vorlage an. Es gelten die allgemeinen Regeln für Importdateien: Kodierung, Trennzeichen, Ja und Nein in vier Sprachen, höchstens 20.000 Zeilen. Siehe [CSV- und Excel-Dateien](csv-files.md).

**Berechtigungen**:

- Serverdatei exportieren: `infrastructure:reader`.
- Serverdatei importieren: `infrastructure:member`.
- Die Anwendungsdatei erfordert zusätzlich das Recht, Anwendungen zu lesen. Ein Business Contributor exportiert und importiert nur die Verknüpfungen seiner eigenen Anwendungen.

### Spalten

| Spalte | Bedeutung |
|---|---|
| `asset_reference`, `asset_name` | Der Server (Serverdatei). Die Referenz (`AST-12`) wird zuerst gelesen. Ohne sie findet der Name den Server, und ein Name, den zwei Server tragen, ist ein Fehler. Eine Referenz und ein Name, die auf zwei verschiedene Server zeigen, sind ebenfalls ein Fehler |
| `application_reference`, `application_name` | Die Anwendung (Anwendungsdatei), zuerst über ihre Referenz (`APP-4`), dann über ihren Namen |
| `technology_reference`, `technology_name` | Die Technologie, zuerst über ihre Referenz (`TEC-3`), dann über ihren Namen |
| `version` | Die Bezeichnung der Version. Eine leere Zelle bedeutet, dass die Version unbekannt ist |
| `operating_system` | Nur Serverdatei. Ob die Technologie das Betriebssystem des Servers ist: siehe unten |
| `notes` | Freitext zur Verknüpfung |
| `source` | Woher die Verknüpfung stammt: manuelle Eingabe, Import, Assistent, Agent oder Netbox. Der Export schreibt sie; der Import ignoriert sie |

Die Spalte `operating_system` kennt drei Werte:

- **Ja**: Die Verknüpfung wird zum Betriebssystem des Servers. Der Import lehnt die Zeile ab, wenn die Technologie nicht zur Familie **Betriebssystem** gehört, wenn der Server ein Cluster mit Mitgliedern ist oder wenn der Server bereits ein anderes Betriebssystem hat.
- **Nein**: Die Verknüpfung wird nie markiert.
- **Leer**: Eine neue Verknüpfung folgt der Regel der Serverseite. Eine Technologie der Familie **Betriebssystem** wird zum Betriebssystem des Servers, wenn dieser noch keines hat und kein Cluster ist. Die Vorschau zeigt es in der Zeile an.

Der Import entfernt die Betriebssystem-Markierung nie von einer Verknüpfung.

### Was ein Import tut

**Vorabprüfung** liest die Datei und listet auf, was das Laden tun würde, mit etwaigen Fehlern pro Zeile. Eine Datei mit einem Fehler lädt nichts.

- Eine Verknüpfung besteht aus einem Server oder einer Anwendung, einer Technologie und einer Version: Eine Zeile mit einer anderen Version fügt eine zweite Verknüpfung hinzu. Dieselbe Verknüpfung zweimal in einer Datei ist ein Fehler.
- Jede Zeile fügt eine Verknüpfung hinzu oder aktualisiert eine vorhandene. Verknüpfungen, die in der Datei fehlen, bleiben, wie sie sind: Der Import löscht nie eine Verknüpfung.
- Eine vorhandene Verknüpfung behält ihre Herkunft. Ihre Notizen ändern sich, wenn die Zelle `notes` einen anderen Text enthält; eine leere Zelle lässt sie unverändert.
- Eine neue Verknüpfung wird als aus einem Import stammend gekennzeichnet, mit dem Dateinamen.
- Die Technologie muss bereits in Ihrer Liste stehen. Übernehmen Sie sie zuerst aus dem Katalog oder legen Sie sie an.
- Eine Version, die Sie noch nicht führen, wird bei der Technologie angelegt. Die Vorschau nennt sie.

Eine große Datei braucht Zeit zum Laden und hält die Verknüpfungen ihrer Technologien bis zum Ende fest. Mehrere kleinere Dateien behindern die Personen, die zur selben Zeit arbeiten, weniger.

---

## Wo Technologien erscheinen

- **Anwendungen**: Der Abschnitt **Technologien** oben im Reiter Betrieb listet, wovon eine Anwendung abhängt. Siehe [Anwendungen](applications.md#operations).
- **Assets**: Der Abschnitt **Technologien** im Reiter Betrieb eines Assets listet, was der Server trägt, sein Betriebssystem zuerst. Siehe [Assets](assets.md#operations).
- **Verträge**, **Budgetzeilen** und **Vorfälle**: ein Feld **Technologien** im Reiter **Verknüpfungen** der Verträge und Budgetzeilen und im Reiter **Beziehungen** der Vorfälle, für Benutzer, die die Infrastruktur lesen dürfen.
- Bericht **Supportende**: die Versionen, die ihr Supportende erreichen, Betriebssysteme eingeschlossen, und was sie betreffen. Siehe [Supportende](end-of-support.md).
- **Schwachstellen**: die bekannten Schwachstellen der Versionen im Einsatz und die Server und Anwendungen, die sie erreichen. Siehe [Schwachstellen](vulnerabilities.md).
- **Administrationszonen**: die Verzeichnisdienste mit ihrer Zone und die Server, die eine Verzeichnistechnologie außerhalb der sensibelsten Zone tragen. Siehe [Administrationszonen](administration-view.md).
- **Kontakte**: Der Abschnitt **Verwendet in** eines Kontakts listet die Technologien, die er betreut. Siehe [Kontakte](contacts.md#wo-kontakte-verwendet-werden).
- **Suche**: Die globale Suche und die `@`-Erwähnungen des Assistenten finden Technologien über Name und Referenz (`@TEC-4`).

## Eine Anwendung umwandeln

Ein als Anwendung angelegter Eintrag kann in Wirklichkeit eine Technologie sein, etwa eine Datenbank-Engine oder ein Verzeichnisdienst. Öffnen Sie die Anwendung und verwenden Sie **In Technologie umwandeln**. Siehe [Anwendungen](applications.md#eine-anwendung-in-eine-technologie-umwandeln).

## Den Assistenten fragen

[Plaid](ai-assistant.md) liest die Technologien mit denselben Rechten wie diese Seite. Fragen Sie zum Beispiel: „Wer ist für TEC-3 verantwortlich?“, „Welche Weblinks hat PostgreSQL?“, „Sind die Schwachstellenwarnungen für TEC-3 eingeschaltet?“ oder „Welche Technologien haben keinen Support mehr?“

Mit der Stufe Mitglied für die Infrastruktur schreibt Plaid auch, und jede Änderung kommt als Vorschau, die Sie genehmigen:

- Einen Katalogeintrag übernehmen, eine von Hand erfasste Technologie gleichen Namens vervollständigen oder eine Technologie anlegen, die der Katalog nicht kennt.
- Die Felder der Technologie ändern.
- Versionen hinzufügen und ihre Bezeichnungen, Daten und Notizen ändern.
- IT-Verantwortliche, Business-Verantwortliche und Support-Kontakte hinzufügen oder entfernen.
- Weblinks hinzufügen, ändern oder entfernen.
- Schwachstellenwarnungen ein- oder ausschalten, für die Technologie oder für eine Version.

Plaid nennt die Familie, den Lebenszyklus und die anderen Listenwerte in Ihrer Sprache und lehnt einen Wert ab, der auf mehrere passt. Es lehnt einen Namen ab, den zwei Benutzer oder zwei Kontakte tragen, und zwei Links mit derselben Adresse. Fragen Sie zum Beispiel: „Übernimm PostgreSQL aus dem KANAP-Katalog“, „Füge TEC-3 die Version 17 hinzu“, „Füge Camille Roux als Business-Verantwortliche von PostgreSQL hinzu“, „Füge den Kontakt Oracle Support zum Support von TEC-3 hinzu“, „Füge PostgreSQL den Link zu den Versionshinweisen https://www.postgresql.org/docs/release/ hinzu“ oder „Nimm die Version 14 von TEC-3 aus den Warnungen“.

Einen Support-Kontakt hinzuzufügen erfordert zusätzlich das Recht, Kontakte zu lesen. Einen zu entfernen erfordert es nicht. Plaid fügt nur aktive Benutzer als Verantwortliche hinzu und entfernt einen Verantwortlichen auch dann, wenn sein Konto deaktiviert ist. Ein Kontakt ohne Namen kann nicht hinzugefügt werden: Geben Sie ihm zuerst unter Kontakte einen Namen. Wenn Plaid eine von Hand erfasste Technologie vervollständigt, ändert es nur die abweichenden Felder und hält an, wenn eines davon nach der Vorschau auf dem Bildschirm geändert wurde.

Das Löschen einer Technologie oder einer Version, Anhänge, CPE-Kennungen und CVE.org-Namen sowie der Abgleich der Schwachstellen bleiben auf dieser Seite.

## Tipps

- **Vom Katalog ausgehen**: Sie erhalten die Versionen und ihre Supportende-Daten, ohne sie einzutippen.
- **Hauptversionen verfolgen**: Eine Zeile pro Hauptversion (2019, 2022) genügt, um den Support zu verfolgen.
- **Verantwortliche benennen**: Die IT-Verantwortlichen sind die Ansprechpartner, wenn eine Version ihr Supportende erreicht. Sie erhalten auch die E-Mail über neue kritische Schwachstellen.
- **CPE-Produktkennungen und CVE.org-Namen ausfüllen**: Ohne beides kann KANAP die Technologie nicht mit den veröffentlichten Schwachstellen abgleichen.
- **Die Version auf jedem Server erfassen**: Eine unbekannte Version ist potenziell von jeder Schwachstelle des Produkts betroffen.
