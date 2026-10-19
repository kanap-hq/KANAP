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

Legen Sie eine Technologie an, wenn niemand im Produkt selbst arbeitet, andere Anwendungen aber ausfallen oder angreifbar werden, wenn es ausfällt. Führen Sie einen Eintrag als Anwendung, wenn sich Fachanwender dort anmelden und damit arbeiten.

Einige Beispiele:

- **Entra ID**: eine **SaaS**-Technologie der Familie **Verzeichnis und Identität**, Hersteller Microsoft. Sie läuft auf keinem Ihrer Server. Die Anwendungen, deren Benutzer sich darüber anmelden, deklarieren sie.
- **Active Directory**: eine **On-Premise**-Technologie derselben Familie, getragen von Ihren Domänencontrollern. Die Anwendungen, die sie nutzen, deklarieren sie.
- **vSphere**: eine **On-Premise**-Technologie, getragen von der vCenter-VM und von den Hosts.
- **SQL Server**: eine Technologie mit einer Zeile pro Version im Einsatz (2016, 2019, 2022). Jeder Server trägt seine eigene Version, sodass der Supportende-Bericht die Server nennen kann, die noch auf einer alten laufen.
- **Windows Server**: eine Technologie der Familie **Betriebssystem**. Jeder Server erfasst seine Version, und diese Technologie ist das Betriebssystem des Servers. Siehe [Betriebssysteme](#betriebssysteme).
- **Eine SaaS-Anwendung**: keine Technologie zu erfassen. Der Anbieter pflegt, worauf sie läuft.

Eine Technologie umfasst ein Produkt als Ganzes. „SQL Server" steht für alle SQL Server, die Sie betreiben; die Versionen tragen die Details.

## Erste Schritte

Navigieren Sie zu **IT-Landschaft > Technologien** und klicken Sie auf **Neue Technologie**.

Das Fenster öffnet sich auf dem **Katalog**: einer Liste gängiger Produkte mit einer kurzen Beschreibung, Hersteller, Familie und Hosting-Typ. Suchen Sie nach dem Namen und klicken Sie auf einen Eintrag. KANAP legt die Technologie sofort mit Hersteller, Familie, Hosting-Typ, CPE-Produktkennungen, ihren Versionen samt Supportende-Daten und der kurzen Beschreibung in Ihrer Sprache an und öffnet sie. Der Katalog bietet nur Produkte an, die Sie noch nicht hinzugefügt haben.

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

Der Katalog bietet Windows Server, Ubuntu, Red Hat Enterprise Linux, Debian, SUSE Linux Enterprise Server, Rocky Linux, AlmaLinux, Oracle Linux und CentOS. Er führt die Versionen, deren Support 2010 oder später endete, und für Windows Server nur die Versionen mit langem Support.

Was die beiden Supportdaten bedeuten, hängt vom Hersteller ab:

| Betriebssystem | Ende des Standardsupports | Ende des erweiterten Supports |
|---|---|---|
| **Ubuntu**, **Red Hat Enterprise Linux**, **SUSE Linux Enterprise Server** | Ende der Sicherheitsupdates | Ende der kostenpflichtigen Verlängerung |
| **Windows Server** | Ende des grundlegenden Supports | Ende des erweiterten Supports |
| **Debian** | Ende des regulären Supports | Ende von Debian LTS |

Jede Technologie kann ein Betriebssystem sein: Ordnen Sie VMware ESXi oder FortiOS der Familie **Betriebssystem** zu, dann kann sie das Betriebssystem eines Hosts oder einer Firewall sein.

Die Betriebssysteme des Katalogs haben noch keine CPE-Produktkennungen, daher gleicht KANAP sie nicht mit Schwachstellen ab.

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
| **Server** | Assets, die sie tragen, direkt oder weil sie in einem Asset liegen, das sie trägt |
| **Anwendungen** | Anwendungen, die sie deklarieren oder auf einem Server gehostet werden, der sie trägt |
| **Nächstes Supportende** | Das früheste kommende Ende des Standardsupports unter den Versionen im Einsatz. Orange, wenn es in die nächsten 12 Monate fällt |
| **Zu prüfende Schwachstellen** | Die bekannten Schwachstellen, die auf den Versionen im Einsatz noch zu prüfen sind. Orange mit der Anzahl der kritischen oder hohen (`3 · 1 kritisch oder hoch`). Ein Klick öffnet die Seite [Schwachstellen](vulnerabilities.md) für diese Technologie. Vorhanden, wenn Schwachstellen verfolgt werden |

**Weitere Spalten** (über die Spaltenauswahl): **Lebenszyklus**, **Versionen im Einsatz**, **IT-Verantwortlicher**.

Wenn Schwachstellen verfolgt werden, öffnet die Spalte **Hersteller** auch die Seite Schwachstellen für die Produkte dieses Herstellers. Wann sie verfolgt werden, steht unter [Schwachstellen](vulnerabilities.md).

**Filter**: **Familie**, **Hersteller** und **Lebenszyklus** bieten Kontrollkästchen-Filter. Das Suchfeld durchsucht Name, Hersteller und Referenz.

**Aktionen**:

- **Neue Technologie** (`infrastructure:member`).
- **Löschen** der ausgewählten Zeilen (`infrastructure:admin`). Die Bestätigung zählt, was mitgelöscht wird: Verknüpfungen zu Servern und Anwendungen, Verträge, Budgetzeilen, Projekte, Vorfälle und Dokumente.

---

## Der Technologie-Arbeitsbereich

Der Arbeitsbereich hat eine Kopfzeile, ein Eigenschaftenfeld rechts und sechs Reiter: **Übersicht**, **Server**, **Anwendungen**, **Betrieb**, **Compliance** und **Beziehungen**. Die Reiter **Server**, **Anwendungen** und **Beziehungen** zeigen ihre Anzahl als Badge.

### Kopfzeile

- **Name**: direkt bearbeitbar.
- **Referenz**: zum Kopieren anklicken.
- **Lebenszyklus**: zum Ändern anklicken. Eine ausgemusterte Technologie wird beim Suchen nach einer zu verknüpfenden Technologie nicht mehr angeboten.
- **Familie**.
- **Löschen** (`infrastructure:admin`): Die Bestätigung nennt, was mit der Technologie gelöscht wird.

### Eigenschaftenfeld

- **Hersteller**, **Familie** und **Hosting-Typ**.
- **Administrationszone**: nur für die Technologien der Familie **Verzeichnis und Identität** angezeigt. Sie ordnet einen Verzeichnisdienst einer Zone Ihres Administrationsmodells zu, zum Beispiel Tier 0 für Entra ID, das auf keinem Ihrer Server läuft. Die Zonen stammen aus **IT-Landschaft > Einstellungen**, und die [Administrationssicht](administration-view.md) listet die Verzeichnisdienste jeder Zone. Die übrigen Technologien erhalten keine Zone: Ordnen Sie stattdessen die Server zu, die sie tragen. Eine früher bei einer Technologie einer anderen Familie gesetzte Zone bleibt sichtbar, nur lesend, mit dem Hinweis, dass der Wert nicht mehr verwendet wird.
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

Der Support läuft an seinem Enddatum noch. Bei nur einem Datum ist dieses Datum das Ende. **Version hinzufügen** fügt eine Zeile hinzu; fahren Sie über eine Zeile, um sie zu bearbeiten oder zu löschen. Das Löschen einer Version, die Server oder Anwendungen nutzen, fragt zuerst nach: Diese Verknüpfungen zeigen dann eine unbekannte Version.

#### Versionen aus dem Katalog

Eine Version aus dem Katalog zeigt **Katalog** neben ihrer Bezeichnung, und eine aus dem Katalog übernommene Technologie zeigt unter ihren Versionen „Versionen und Daten werden aus dem Katalog aktuell gehalten“. In der Cloud prüft KANAP den Katalog täglich. Bei einer On-Premise-Installation bringt jede KANAP-Version ihren Katalog beim Start mit, sofern Ihr Administrator nicht [die tägliche Prüfung einschaltet](on-premise/configuration.md#optional-technology-catalog).

Die Prüfung fügt die neuen Versionen und CPE-Produktkennungen des Produkts hinzu und aktualisiert die Supportende-Daten und Kennungen, die der Katalog geändert hat. Sie überschreibt nie einen Wert, den Sie geändert haben, und stellt nie eine Version oder Kennung wieder her, die Sie gelöscht haben. Eine Version, die Sie erfasst haben, bevor der Katalog sie kannte, wird ihm bei gleicher Bezeichnung zugeordnet, und ihre leeren Daten werden ergänzt.

**CPE-Produktkennungen**: die Namen, die Sicherheitsdatenbanken diesem Produkt geben, in der Form `part:vendor:product` (zum Beispiel `a:microsoft:sql_server`). KANAP gleicht sie mit den veröffentlichten Schwachstellen ab: Eine Technologie ohne Kennung erhält keine Schwachstelle. Ein Produkt kann mehrere haben (vSphere umfasst vCenter und ESXi). Wo Sie diesen Wert finden: Suchen Sie das Produkt im [CPE-Wörterbuch des NIST](https://nvd.nist.gov/products/cpe/search) und übernehmen Sie Teil, Hersteller und Produkt. Übernehmen Sie sie so, wie die NVD sie schreibt, mit dem Backslash vor einem Zeichen: `a:veeam:veeam_backup_\&_replication`. Katalogeinträge bringen ihre Kennungen mit, außer den Betriebssystemen.

**Notizen**: Freitext, etwa Lizenzbedingungen oder Verlängerungstermine.

### Server

Die Server, die die Technologie tragen, eine Zeile pro Server und Version:

| Spalte | Was sie zeigt |
|---|---|
| **Ref.**, **Server** | Der Server. Ein Klick auf die Zeile öffnet ihn |
| **Umgebung**, **Betriebssystem** | Vom Server übernommen |
| **Version** | Die installierte Version. Ein Strich bedeutet, dass die Version unbekannt ist |
| **Über** | Bei einem Server, der die Technologie über einen anderen trägt: der Server oder Cluster, auf dem sie installiert ist. Die Spalte erscheint nur, wenn der Reiter eine solche Zeile hat |
| **Notizen** | Freitext zu dieser Installation, zum Beispiel „Clusterknoten“ |

Eine Technologie erreicht einen Server auf zwei Wegen:

- **Installiert**: Jemand hat die Technologie mit diesem Server verknüpft. Sie können Version und Notizen direkt ändern oder die Zeile entfernen.
- **Über einen anderen Server**: Die Technologie ist auf dem Server oder Cluster installiert, in dem dieser läuft, zum Beispiel SQL Server auf einem Cluster, angezeigt auf jedem seiner Mitglieder. Die Zeile nennt diesen Server unter **Über**. Sie folgt der Installation: Ändern oder entfernen Sie sie auf jenem Server.

**Hinzufügen** (`infrastructure:member`) öffnet eine Serversuche, dann die Versionsauswahl: Wählen Sie eine Version, **Version unbekannt**, oder geben Sie eine neue Bezeichnung ein und wählen Sie **Version „…“ hinzufügen**, um sie anzulegen. Jede Änderung wird sofort gespeichert.

Ein außer Betrieb genommener Server bleibt gelistet, ausgegraut und als „außer Betrieb“ markiert, damit Sie seine Verknüpfung entfernen können. Er zählt nirgends: weder im Badge noch in der Summe, den Zählern der Liste oder den Berichten. Die Zeile **Gesamt** zählt die Server in Betrieb, jeden einmal.

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

**CSV exportieren** lädt die Zeilen in der Sprache Ihres Bildschirms herunter.

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

### Beziehungen

Die mit der Technologie verknüpften Datensätze, ein Abschnitt pro Art:

- **Budgetzeilen**: mit dem Betrag des laufenden Jahres in der Budgetspalte Ihres Arbeitsbereichs und einer Summe.
- **Verträge**: Lieferant, Enddatum und Jahresbetrag, mit einer Summe pro Währung.
- **Projekte**: Status und geplantes Ende.
- **Vorfälle**: Schweregrad, Status und Erkennungsdatum. Das Verknüpfen eines Vorfalls erfordert `incidents:contributor`. Ein geschlossener oder abgebrochener Vorfall kann weder verknüpft noch gelöst werden.
- **Dokumente**: die zur Technologie hochgeladenen Dateien mit Größe und Datum. **Hinzufügen** lädt Dateien hoch; ein Klick auf einen Namen lädt die Datei herunter.
- **Weblinks**: ein Name und eine Adresse, etwa die Release Notes des Herstellers. Ein Klick auf den Namen öffnet sie; fahren Sie über eine Zeile, um sie zu bearbeiten. Adressen beginnen mit `http://` oder `https://`; eine Adresse ohne Präfix öffnet sich als `https://`.
- **Schwachstellen**: Wenn Schwachstellen verfolgt werden, die bekannten Schwachstellen der Versionen im Einsatz. Siehe [Schwachstellen](#schwachstellen).

Ein Abschnitt erscheint nur, wenn Sie sein Modul lesen dürfen. **Hinzufügen** (`infrastructure:member`) öffnet eine Suche an Ort und Stelle; das Kreuz am Ende einer Zeile entfernt die Verknüpfung.

#### Schwachstellen

Eine Zeile pro Version und Schwachstelle, die schwerste zuerst, mit **CVE**, **Schweregrad**, **Version** und **Status**. Die Zahl neben dem Titel ist die Anzahl verschiedener Schwachstellen. Ein Klick auf eine Zeile öffnet sie auf der Seite [Schwachstellen](vulnerabilities.md), wo Sie sie prüfen.

KANAP gleicht die Technologie erneut ab, sobald sich ihre Kennungen, Versionen, Server oder Anwendungen ändern. Nach einer neuen CPE-Produktkennung zeigt der Abschnitt „Suche nach Schwachstellen läuft…“, während KANAP dieses Produkt aus der NVD liest. **Erneut abgleichen** (`infrastructure:member`) startet den Vergleich von Hand.

---

## Eine Technologie mit einem Server verknüpfen

Dass ein Server eine Technologie trägt, erfassen Sie von beiden Seiten:

- Von der Technologie aus: Reiter **Server**, **Hinzufügen**, dann Server und Version wählen.
- Vom Server aus: Reiter **Technisch** des Assets, Abschnitt **Technologien**, **Hinzufügen**, dann Technologie und Version wählen. Siehe [Assets](assets.md#technisch).

Erfassen Sie die Technologie auf dem Server, auf dem sie installiert ist: dem Host für einen Hypervisor, jedem Domänencontroller für Active Directory, dem Datenbankserver für SQL Server. Die Server, die darin laufen, oder die Mitglieder seines Clusters zeigen sie dann ohne weitere Eingabe. Eine Cloud-Technologie wie Entra ID läuft auf keinem Ihrer Server: Deklarieren Sie sie stattdessen bei den Anwendungen.

---

## Wo Technologien erscheinen

- **Anwendungen**: Der Abschnitt **Technologien** oben im Reiter Betrieb listet, wovon eine Anwendung abhängt. Siehe [Anwendungen](applications.md#betrieb).
- **Assets**: Der Abschnitt **Technologien** im Reiter Technisch eines Assets listet, was der Server trägt, sein Betriebssystem zuerst. Siehe [Assets](assets.md#technisch).
- **Verträge**, **Budgetzeilen** und **Vorfälle**: ein Feld **Technologien** in ihrem Reiter Verknüpfungen bzw. Beziehungen, für Benutzer, die die Infrastruktur lesen dürfen.
- Bericht **Supportende**: die Versionen, die ihr Supportende erreichen, Betriebssysteme eingeschlossen, und was sie betreffen. Siehe [Supportende](end-of-support.md).
- **Schwachstellen**: die bekannten Schwachstellen der Versionen im Einsatz und die Server und Anwendungen, die sie erreichen. Siehe [Schwachstellen](vulnerabilities.md).
- **Administrationssicht**: die Verzeichnisdienste jeder Administrationszone und die Server, die eine Verzeichnistechnologie außerhalb der sensibelsten Zone tragen. Siehe [Administrationssicht](administration-view.md).
- **Kontakte**: Der Abschnitt **Verwendet in** eines Kontakts listet die Technologien, die er betreut. Siehe [Kontakte](contacts.md#wo-kontakte-verwendet-werden).
- **Suche**: Die globale Suche und die `@`-Erwähnungen des Assistenten finden Technologien über Name und Referenz (`@TEC-4`).

## Eine Anwendung umwandeln

Ein als Anwendung angelegter Eintrag kann in Wirklichkeit eine Technologie sein, etwa eine Datenbank-Engine oder ein Verzeichnisdienst. Öffnen Sie die Anwendung und verwenden Sie **In Technologie umwandeln**. Siehe [Anwendungen](applications.md#eine-anwendung-in-eine-technologie-umwandeln).

## Tipps

- **Vom Katalog ausgehen**: Sie erhalten die Versionen und ihre Supportende-Daten, ohne sie einzutippen.
- **Hauptversionen verfolgen**: Eine Zeile pro Hauptversion (2019, 2022) genügt, um den Support zu verfolgen.
- **Verantwortliche benennen**: Die IT-Verantwortlichen sind die Ansprechpartner, wenn eine Version ihr Supportende erreicht. Sie erhalten auch die E-Mail über neue kritische Schwachstellen.
- **CPE-Produktkennungen ausfüllen**: Ohne sie kann KANAP die Technologie nicht mit den veröffentlichten Schwachstellen abgleichen.
- **Die Version auf jedem Server erfassen**: Eine unbekannte Version ist potenziell von jeder Schwachstelle des Produkts betroffen.
