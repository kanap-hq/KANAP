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

- **Entra ID**: eine abonnierte Technologie der Familie **Verzeichnis und Identität**, Hersteller Microsoft. Sie läuft auf keinem Ihrer Server. Die Anwendungen, deren Benutzer sich darüber anmelden, deklarieren sie.
- **Active Directory**: eine installierte Technologie derselben Familie, getragen von Ihren Domänencontrollern. Die Anwendungen, die sie nutzen, deklarieren sie.
- **vSphere**: eine installierte Technologie, getragen von der vCenter-VM und von den Hosts.
- **SQL Server**: eine Technologie mit einer Zeile pro Version im Einsatz (2016, 2019, 2022). Jeder Server trägt seine eigene Version, sodass der Supportende-Bericht die Server nennen kann, die noch auf einer alten laufen.
- **Eine SaaS-Anwendung**: keine Technologie zu erfassen. Der Anbieter pflegt, worauf sie läuft.

Eine Technologie umfasst ein Produkt als Ganzes. „SQL Server" steht für alle SQL Server, die Sie betreiben; die Versionen tragen die Details.

## Erste Schritte

Navigieren Sie zu **IT-Landschaft > Technologien** und klicken Sie auf **Neue Technologie**.

Das Fenster öffnet sich auf dem **Katalog**: einer Liste gängiger Produkte mit Hersteller, Familie und Versionen. Suchen Sie nach dem Namen und klicken Sie auf einen Eintrag. KANAP legt die Technologie sofort mit Hersteller, Familie, Modus, CPE-Produktkennungen und ihren Versionen samt Supportende-Daten an und öffnet sie. Der Katalog bietet nur Produkte an, die Sie noch nicht hinzugefügt haben.

Für ein Produkt, das der Katalog nicht kennt, klicken Sie auf **Eine Technologie erfassen, die nicht im Katalog steht**. Füllen Sie aus:

- **Name** (Pflichtfeld): eindeutig unter Ihren Technologien.
- **Familie**: die Art der Technologie (Datenbank, Hypervisor, Verzeichnis und Identität usw.).
- **Hersteller**: Die Vorschläge stammen aus Ihren anderen Technologien und aus dem Katalog, sodass derselbe Hersteller eine einzige Schreibweise behält.
- **Modus**: **Installiert**, wenn sie auf Ihren Servern läuft, **Abonniert** für einen bei einem Anbieter gekauften Dienst.

**Berechtigungen**:

- Anzeigen: `infrastructure:reader`
- Anlegen und bearbeiten: `infrastructure:member`
- Löschen: `infrastructure:admin`

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

**Weitere Spalten** (über die Spaltenauswahl): **Lebenszyklus**, **Versionen im Einsatz**, **IT-Verantwortlicher**.

**Filter**: **Familie**, **Hersteller** und **Lebenszyklus** bieten Kontrollkästchen-Filter. Das Suchfeld durchsucht Name, Hersteller und Referenz.

**Aktionen**:

- **Neue Technologie** (`infrastructure:member`).
- **Löschen** der ausgewählten Zeilen (`infrastructure:admin`). Die Bestätigung zählt, was mitgelöscht wird: Verknüpfungen zu Servern und Anwendungen, Verträge, Budgetzeilen, Projekte, Vorfälle und Dokumente.

---

## Der Technologie-Arbeitsbereich

Der Arbeitsbereich hat eine Kopfzeile, ein Eigenschaftenfeld rechts und den Reiter **Übersicht**.

### Kopfzeile

- **Name**: direkt bearbeitbar.
- **Referenz**: zum Kopieren anklicken.
- **Lebenszyklus**: zum Ändern anklicken. Eine ausgemusterte Technologie wird beim Suchen nach einer zu verknüpfenden Technologie nicht mehr angeboten.
- **Familie**.
- **Löschen** (`infrastructure:admin`): Die Bestätigung nennt, was mit der Technologie gelöscht wird.

### Eigenschaftenfeld

- **Hersteller**, **Familie** und **Modus**.
- **Ersetzt durch**: die Technologie, die diese ablöst, zum Beispiel ein neueres Produkt, zu dem Ihre Teams wechseln.
- **IT-Verantwortliche**: die für die Technologie zuständigen Personen.

Änderungen werden sofort gespeichert.

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

**CPE-Produktkennungen**: die Namen, die Sicherheitsdatenbanken diesem Produkt geben, in der Form `part:vendor:product` (zum Beispiel `a:microsoft:sql_server`). Ein Produkt kann mehrere haben (vSphere umfasst vCenter und ESXi). Wo Sie diesen Wert finden: Suchen Sie das Produkt im [CPE-Wörterbuch des NIST](https://nvd.nist.gov/products/cpe/search) und übernehmen Sie Teil, Hersteller und Produkt. Katalogeinträge bringen ihre Kennungen mit.

**Notizen**: Freitext, etwa Lizenzbedingungen oder Verlängerungstermine.

---

## Wo Technologien erscheinen

- **Anwendungen**: Der Abschnitt **Technologien** im Reiter Beziehungen listet, wovon eine Anwendung abhängt. Siehe [Anwendungen](applications.md#verknupfungen).
- **Assets**: Der Abschnitt **Wenn dieser Server ausfällt** im Reiter Beziehungen eines Assets listet die Technologien, die mit ihm ausfallen. Siehe [Assets](assets.md#verknupfungen).
- **Verträge**, **Budgetzeilen** und **Vorfälle**: ein Feld **Technologien** in ihrem Reiter Verknüpfungen bzw. Beziehungen, für Benutzer, die die Infrastruktur lesen dürfen.
- Bericht **Supportende**: die Versionen, die ihr Supportende erreichen, und was sie betreffen. Siehe [Supportende](end-of-support.md).
- **Suche**: Die globale Suche und die `@`-Erwähnungen des Assistenten finden Technologien über Name und Referenz (`@TEC-4`).

## Eine Anwendung umwandeln

Ein als Anwendung angelegter Eintrag kann in Wirklichkeit eine Technologie sein, etwa eine Datenbank-Engine oder ein Verzeichnisdienst. Öffnen Sie die Anwendung und verwenden Sie **In Technologie umwandeln**. Siehe [Anwendungen](applications.md#eine-anwendung-in-eine-technologie-umwandeln).

## Tipps

- **Vom Katalog ausgehen**: Sie erhalten die Versionen und ihre Supportende-Daten, ohne sie einzutippen.
- **Hauptversionen verfolgen**: Eine Zeile pro Hauptversion (2019, 2022) genügt, um den Support zu verfolgen.
- **Verantwortliche benennen**: Die IT-Verantwortlichen sind die Ansprechpartner, wenn eine Version ihr Supportende erreicht.
