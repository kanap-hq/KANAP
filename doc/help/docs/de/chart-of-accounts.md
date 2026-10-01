# Kontenpläne und Kontenverwaltung

Kontenpläne (CoA) organisieren Ihre Buchhaltungsstruktur, indem sie Konten in benannten Sets gruppieren. Jedes Unternehmen kann mit einem Kontenplan verknüpft werden, der bestimmt, welche Konten beim Erfassen von OPEX- oder CAPEX-Positionen verfügbar sind.

## Warum Kontenpläne verwenden?

Ohne Kontenpläne sind alle Konten für alle Unternehmen verfügbar, was es leicht macht, versehentlich das falsche Konto zu verwenden oder Buchhaltungsstandards über Einheiten hinweg zu vermischen. Kontenpläne lösen dies durch:

  - **Konsistenz sicherstellen**: Unternehmen sehen nur Konten aus ihrem zugewiesenen Kontenplan
  - **Mehrere Standards unterstützen**: Verschiedene Länder oder Geschäftseinheiten können unterschiedliche Kontenstrukturen verwenden
  - **Auswahl vereinfachen**: Konto-Dropdowns zeigen nur relevante Konten, nicht Ihren gesamten Katalog
  - **Vorlagen ermöglichen**: Vorkonfigurierte Kontensets aus länderspezifischen Vorlagen laden

**Beispiel**: Ihre französische Tochtergesellschaft verwendet den französischen PCG (Plan Comptable General), während Ihre britische Einheit UK GAAP verwendet. Erstellen Sie zwei Kontenpläne -- einen für jeden Standard -- und weisen Sie die Unternehmen entsprechend zu. Bei der Ausgabenerfassung sehen Benutzer automatisch die korrekten Konten.

## Die Beziehung: Kontenplan -> Unternehmen -> Konten

Die Hierarchie funktioniert so:

```
Kontenplan (FR-2024)
  -> zugewiesen an
Unternehmen (Acme Frankreich)
  -> verwendet beim Erfassen
OPEX/CAPEX-Positionen -> Kontoauswahl (gefiltert auf FR-2024-Konten)
```

**Wichtige Punkte**:
  - Ein Kontenplan kann mehreren Unternehmen zugewiesen werden
  - Jedes Unternehmen hat einen Kontenplan
  - Konten gehören zu einem Kontenplan
  - Beim Erstellen/Bearbeiten von Ausgabenpositionen wird das Konto-Dropdown nach dem Kontenplan des Unternehmens gefiltert

## Wo Sie es finden

- Pfad: **Stammdaten > Kontenpläne**
- Berechtigungen:
  - Anzeigen: `accounts:reader`
  - Konten und Kontenpläne erstellen/bearbeiten: `accounts:manager`
  - CSV importieren, CSV exportieren, Löschen: `accounts:admin`

## Mit der Liste arbeiten

Die Seite hat zwei Ebenen: einen **Kontenplan-Selektor** oben und ein **Konten-Grid** darunter.

### Kontenplan-Chip-Leiste

Eine horizontale Reihe von Chips repräsentiert jeden Kontenplan. Klicken Sie auf einen Chip, um das Konten-Grid auf diesen Kontenplan umzuschalten.

- Der ausgewählte Chip ist ausgefüllt; andere sind umrandet.
- Ein Stern-Badge (**★**) markiert den Länder-Standard für das Land dieses Kontenplans.
- Ein Kreis-Plus-Badge markiert den globalen Standard.
- Fahren Sie mit der Maus über einen Chip, um den Kontenplan-Namen und die Kontenanzahl zu sehen.

Wenn Sie die Berechtigung `accounts:manager` haben, erscheinen zwei zusätzliche Steuerelemente rechts:

- **Neu**: Öffnet den Dialog **Neuer Kontenplan**.
- **Verwalten**: Öffnet das Modal **Kontenpläne verwalten** zur Administration.

Wenn keine Kontenpläne existieren, zeigt die Chip-Leiste eine Aufforderung, Ihren ersten Kontenplan zu erstellen.

### Kontenplan-Zusammenfassung

Unterhalb der Chip-Leiste zeigt eine Zusammenfassungszeile den **Code**, die **Kontenanzahl**, den **Namen** und das **Land** des ausgewählten Kontenplans (für länderbezogene Kontenpläne).

### Konten-Grid

Das Grid zeigt nur Konten für den ausgewählten Kontenplan.

**Standardspalten**:
- **Kontonr.**: Die Kontonummer. Zum Öffnen des Konten-Arbeitsbereichs anklicken.
- **Name**: Der Kontoname. Zum Öffnen des Konten-Arbeitsbereichs anklicken.
- **Kons. Kontonr.**: Die Konsolidierungs-Kontonummer.
- **Kons. Name**: Der Konsolidierungs-Kontoname.

**Zusätzliche Spalten** (standardmäßig ausgeblendet, über Spaltenauswahl aktivierbar):
- **Lokaler Name**: Der Kontoname in der Landessprache.
- **Beschreibung**: Kontobeschreibung.
- **Kons. Beschreibung**: Konsolidierungs-Kontobeschreibung.
- **Status**: Ob das Konto aktiviert oder deaktiviert ist.
- **Erstellt**: Zeitstempel der Kontoerstellung.

**Filtern**:
- Schnellsuche: Durchsucht sichtbare Textspalten.
- Statusbereich: der Umschalter **Anzeigen: Alle / Aktiv / Deaktiviert** über dem Grid. Standard ist **Aktiv**, zeigt nur aktive Konten. Wählen Sie **Alle**, um deaktivierte Konten einzubeziehen.
- Spaltenfilter: Spaltenüberschriftsfilter verwenden (z. B. die **Status**-Spalte hat einen Set-Filter). Wenn Sie im **Status**-Filter auf **Leeren** klicken oder beide Werte abwählen, zeigt die Liste nichts mehr an, unabhängig von **Anzeigen**.

**Sortierung**: Standard ist **Kontonr.** aufsteigend.

**Aktionen** (im Seitenheader):
- **Neues Konto** (`accounts:manager`): Öffnet einen neuen Konten-Arbeitsbereich, vorverknüpft mit dem ausgewählten Kontenplan.
- **CSV importieren** (`accounts:admin`): Konten in den ausgewählten Kontenplan importieren.
- **CSV exportieren** (`accounts:admin`): Konten aus dem ausgewählten Kontenplan exportieren.
- **Ausgewählte löschen** (`accounts:admin`): Ausgewählte Kontenzeilen löschen. Zeilen über die Kontrollkästchen-Spalte auswählen (für Admins sichtbar).

Alle Zeilenzellen sind anklickbare Links zum Konten-Arbeitsbereich. Sie können rechtsklicken oder Strg+Klicken, um in einem neuen Tab zu öffnen.

## Der Konten-Arbeitsbereich

Klicken Sie auf eine beliebige Zeile im Konten-Grid, um den Konten-Arbeitsbereich zu öffnen.

### Übersicht

Der Arbeitsbereich hat einen einzelnen **Übersichts**-Tab mit einem Formular zum Anzeigen und Bearbeiten der Kontofelder.

**Was Sie bearbeiten können**:
- **Kontenplan**: Der Kontenplan, zu dem dieses Konto gehört (Dropdown aller Kontenpläne in Ihrem Arbeitsbereich).
- **Kontonummer** (Pflicht): Die Kontonummer.
- **Kontoname** (Pflicht): Der Kontoname auf Deutsch (oder Ihrer Hauptsprache).
- **Lokaler Name (Landessprache)**: Der Kontoname in der Landessprache.
- **Beschreibung**: Freitext-Beschreibung.
- **Konsolidierungs-Kontonummer**: Die standardisierte Konsolidierungs-Kontonummer.
- **Konsolidierungs-Kontoname**: Der standardisierte Konsolidierungsname.
- **Konsolidierungs-Kontobeschreibung**: Details zur Konsolidierungskategorie.
- **Lebenszyklus**: der Statusschalter, dessen Beschriftung den aktuellen Zustand zeigt (**Aktiviert** oder **Deaktiviert**), und das Datum **Ende der Gültigkeit**. Setzen Sie ein **Ende der Gültigkeit**, um zu planen, wann das Konto nicht mehr in Auswahl-Dropdowns erscheint. Siehe [Status und Lebenszyklus](#status-und-lebenszyklus).

**Navigation**:
- **Zurück / Weiter**: Zwischen Konten in der aktuellen Listenreihenfolge navigieren.
- **Speichern**: Änderungen speichern (aktiviert, wenn das Formular geändert wurde und Sie `accounts:manager` haben).
- **Zurücksetzen**: Nicht gespeicherte Änderungen verwerfen.
- **Schließen** (X-Schaltfläche): Zur Kontenliste zurückkehren, Ihre Kontenplan-Auswahl, Sortierung, Suche und Filter beibehalten.

Wenn Sie mit nicht gespeicherten Änderungen navigieren, fordert das System Sie zum Speichern oder Verwerfen auf.

**Tipp**: Sie benötigen `accounts:manager` zum Bearbeiten. Schreibgeschützte Benutzer sehen ein Hinweisbanner.

## Kontenpläne einrichten

### Einen Kontenplan erstellen

Sie können einen Kontenplan auf zwei Arten erstellen:

1. **Von Grund auf**: Wählen Sie einen Geltungsbereich und erstellen Sie dann einen leeren Kontenplan.
   - **Geltungsbereich**: `GLOBAL` (kein Land) oder `LAND` (erfordert eine Länderauswahl)
   - Für den Geltungsbereich `LAND` können Sie ihn als Standard für dieses Land markieren. Es existiert jeweils nur ein Standard pro Land.
   - Sie können später Konten per CSV laden.
2. **Aus einer Vorlage**: Laden Sie ein vorkonfiguriertes Kontenset, das von Plattform-Administratoren gepflegt wird.
   - Globale Vorlagen erstellen einen `GLOBAL`-Kontenplan (kein Länderfeld).
   - Ländervorlagen erstellen einen `LAND`-Kontenplan mit dem vorausgefüllten Land der Vorlage.

**Erstellungsdialog-Felder**:
- **Modus**: Wählen Sie **Von Grund auf erstellen** oder **Aus Vorlage kopieren**.
- **Vorlage** (nur Vorlagenmodus): Wählen Sie eine Vorlage aus dem Dropdown. Globale Vorlagen werden als „ALL -- ..." angezeigt; Ländervorlagen zeigen ihren 2-Buchstaben-Code.
- **Code** (Pflicht): Ein stabiler Bezeichner für CSV-Exporte/Importe und Deep-Links.
- **Name** (Pflicht): Ein beschreibender Name für den Kontenplan.
- **Geltungsbereich**: `Land` oder `Global`.
- **Land** (nur Ländergeltungsbereich): Wählen Sie ein Land aus der Liste.
- **Als Standard für dieses Land festlegen** (nur Ländergeltungsbereich): Aktivieren, um diesen Kontenplan als Standard für das ausgewählte Land festzulegen.

Im Vorlagenmodus können Sie vor der Erstellung eine **Vorprüfung** durchführen, um zu sehen, wie viele Konten eingefügt und aktualisiert werden. Klicken Sie dann auf **Erstellen** zum Abschließen.

**Standards**:
  - Pro Land: Sie können einen Kontenplan als Standard für jedes Land markieren. Neue Unternehmen aus diesem Land werden automatisch diesem Kontenplan zugewiesen (Sie können es später im Übersichts-Tab des Unternehmens ändern).
  - Globaler Fallback: Ihr Arbeitsbereich kann einen globalen Standard-Kontenplan haben, der für Länder verwendet wird, die noch keinen länderspezifischen Standard haben. Länder-Standards haben Vorrang; der globale Standard gilt überall sonst.

### Aus Vorlagen laden

Vorlagen sind Standard-Kontensets, die von Plattform-Administratoren verwaltet werden. Sie können sein:
  - Länderspezifisch (z. B. französischer PCG, UK GAAP)
  - Global (für alle Länder verfügbar)

**Funktionsweise**:
  - Gehen Sie zu **Stammdaten > Kontenpläne**
  - Klicken Sie auf **Neu** in der Chip-Leiste
  - Wählen Sie den Modus **Aus Vorlage kopieren**
  - Wählen Sie eine Vorlage; globale Vorlagen werden als „ALL -- ..." angezeigt (lädt einen `GLOBAL`-Kontenplan); Ländervorlagen zeigen ihren 2-Buchstaben-Code
  - Das System zeigt einen Vorprüfungsbericht (wie viele Konten eingefügt/aktualisiert werden)
  - Bestätigen, um Konten in Ihren Kontenplan zu kopieren

**Was kopiert wird**: Kontonummern, Namen, lokale Namen (Landessprache), Beschreibungen, Konsolidierungszuordnungen und Status. Die Konten werden zu Ihren eigenen, die Sie bearbeiten können -- Änderungen an der Plattform-Vorlage wirken sich nicht auf Ihren Kontenplan aus, es sei denn, Sie laden sie explizit neu.

**Tipp**: Nach dem Laden einer Vorlage können Sie unternehmensspezifische Konten hinzufügen, Einträge umbenennen oder ungenutzte Konten deaktivieren. Vorlagen bieten einen Ausgangspunkt, keine gesperrte Struktur.

### Verfügbare Vorlagen

KANAP wird mit **20 vorkonfigurierten Vorlagen** ausgeliefert, die 10 Buchhaltungsstandards abdecken. Jeder Standard kommt in zwei Versionen:

- **v1.0 (Einfach)**: Ein fokussiertes Set von ~20 IT-relevanten Konten -- Softwarelizenzen, Cloud-Hosting, Cybersicherheit, Telekommunikation, Beratung, Personalkosten, Schulung und mehr. Am besten für Organisationen, die einen schlanken Ausgangspunkt wünschen.
- **v2.0 (Detailliert)**: Alles aus v1.0 plus zusätzliche granulare Unterkonten (~30 Konten). Fügt Aufschlüsselungen wie Gekaufte vs. Intern Entwickelte Software, Netzwerkausrüstung, SaaS vs. Dauerlizenzen, Mobilfunkkommunikation, IT-Boni, IT-Versicherung und mehr hinzu. Am besten für Organisationen, die eine feinere Kostenverfolgung benötigen.

Beide Versionen verwenden **echte Kontonummern aus dem offiziellen Buchhaltungsstandard jedes Landes** und enthalten lokale Namen in der Landessprache.

| Vorlagencode | Land | Standard | Konten (v1 / v2) |
|--------------|------|----------|-------------------|
| **IFRS** | Global | International Financial Reporting Standards | 14 / 30 |
| **FR-PCG** | Frankreich | Plan Comptable General | 20 / 31 |
| **DE-SKR03** | Deutschland | Standardkontenrahmen 03 | 20 / 32 |
| **GB-UKGAAP** | Vereinigtes Königreich | UK GAAP | 20 / 31 |
| **ES-PGC** | Spanien | Plan General de Contabilidad | 20 / 31 |
| **IT-PDC** | Italien | Piano dei Conti | 20 / 31 |
| **NL-RGS** | Niederlande | Rekeningschema (RGS) | 20 / 31 |
| **BE-PCMN** | Belgien | Plan Comptable Minimum Normalise | 20 / 31 |
| **CH-KMU** | Schweiz | Kontenrahmen KMU | 20 / 31 |
| **US-USGAAP** | Vereinigte Staaten | US GAAP | 20 / 32 |

**Version wählen**:

  - Beginnen Sie mit **v1.0**, wenn Sie einen sauberen, minimalen Kontenplan wünschen, der die wesentlichen IT-Kostenkategorien abdeckt. Sie können später jederzeit Konten hinzufügen.
  - Wählen Sie **v2.0**, wenn Ihre Organisation IT-Ausgaben auf granularer Ebene verfolgt (z. B. SaaS-Abonnements von Dauerlizenzen unterscheiden oder IT-Gehälter von Boni trennen).

### Integrierte IFRS-Konsolidierung

Alle Vorlagen -- unabhängig vom Land -- ordnen jedes Konto einem von **14 standardisierten IFRS-Konsolidierungskonten** zu. Das bedeutet, dass Konzernberichte sofort funktionieren, auch über verschiedene lokale Standards hinweg.

| # | Konsolidierungskonto | Was es abdeckt |
|---|---------------------|----------------|
| 1000 | Sachanlagen (CAPEX) | Physische IT-Ausrüstung -- Server, Arbeitsplätze, Netzwerkgeräte |
| 1100 | Immaterielle Vermögenswerte (CAPEX) | Aktivierte Software und Entwicklungskosten |
| 1200 | Abschreibungen | Abschreibungen auf Hardware und Software |
| 1300 | Wertminderungen & Abschreibungen | Anlagen-Wertminderungen und -abschreibungen |
| 2000 | Softwarelizenzen (OPEX) | Dauerlizenzen, SaaS-Abonnements, Open-Source-Support |
| 2100 | Cloud- & Hosting-Dienste | IaaS, PaaS, Monitoring, Cybersicherheits-Tools |
| 2200 | Telekommunikation & Netzwerk | Internet, Mobilfunk, WAN/LAN |
| 2300 | Wartung & Support | Hardware- und Software-Wartungsverträge |
| 2400 | IT-Beratung & externe Dienste | Beratung, Systemintegration, Auftragnehmer |
| 2500 | IT-Personalkosten | Gehälter, Boni, Sozialabgaben, Altersvorsorge |
| 2600 | Schulung & Zertifizierung | Schulungsprogramme, Zertifizierungen, Konferenzen |
| 2700 | Arbeitsplatz-IT (Nicht aktiviert) | Endgeräte unterhalb der Aktivierungsschwelle |
| 2800 | Reisen & Mobilität (IT-Projekte) | Projektbezogene Reisen |
| 2900 | Sonstige IT-Betriebsausgaben | Verschiedene IT-Kosten, Cyber-Versicherung |

**Beispiel**: Ihre französische Tochtergesellschaft lädt **FR-PCG v1.0** und Ihre deutsche Tochtergesellschaft lädt **DE-SKR03 v1.0**. Beide verwenden unterschiedliche lokale Kontonummern und lokale Namen, aber jedes Konto wird der gleichen IFRS-Konsolidierungsstruktur zugeordnet. Konzernberichte aggregieren nahtlos ohne manuelle Zuordnungsarbeit.

### Globaler Standard-Kontenplan (Bereitstellung)

Neue Arbeitsbereiche werden automatisch mit der **IFRS v1.0**-Vorlage bereitgestellt. Dies erstellt einen `GLOBAL`-Kontenplan mit den 14 IFRS-Konsolidierungskonten und setzt ihn als globalen Standard des Mandanten, sodass Unternehmen ihn sofort ohne Einrichtung nutzen können. Sie können die vorgeladenen Konten/den Kontenplan später bei Bedarf bearbeiten oder löschen (unter Beachtung der üblichen Schutzmaßnahmen).

Globale Kontenpläne werden mit Geltungsbereich-Metadaten im **Verwalten**-Modal angezeigt, ohne Länderwert für `GLOBAL`-Einträge. Nur `GLOBAL`-Kontenpläne können als globaler Standard markiert werden, und nur `LAND`-Kontenpläne können als Länder-Standard festgelegt werden.

## Kontenpläne verwalten

### Das Verwalten-Modal

Klicken Sie auf **Verwalten** in der Chip-Leiste, um das Administrations-Modal zu öffnen. Das Modal hat zwei Bereiche:

**Linker Bereich** -- Kontenplan-Liste:
- Zeigt alle Ihre Kontenpläne mit Codes und Namen.
- Standard-Badges: **★** für Länder-Standard, Kreis-Plus für globalen Standard.
- Klicken Sie auf eine Zeile, um Details anzuzeigen.

**Rechter Bereich** -- Kontenplan-Details:
- **Code** und **Name**
- **Geltungsbereich**: `GLOBAL` oder `LAND`
- **Land** (für länderbezogene Kontenpläne)
- **Länder-Standard**: Ja/Nein
- **Globaler Standard**: Ja/Nein
- **Verknüpfte Unternehmen**: Anzahl der Unternehmen, die diesem Kontenplan zugewiesen sind
- **Konten**: Anzahl der Konten in diesem Kontenplan

**Aktionen** (in der Modal-Symbolleiste):
- **Neu** (`accounts:manager`): Öffnet den Kontenplan-Erstellungsdialog.
- **Als Länder-Standard festlegen** (`accounts:manager`): Markiert den ausgewählten länderbezogenen Kontenplan als Standard für sein Land. Deaktiviert für globale Kontenpläne.
- **Als globalen Standard festlegen** (`accounts:manager`): Markiert den ausgewählten globalen Kontenplan als globalen Standard. Deaktiviert für Länder-Kontenpläne.
- **Ausgewählte löschen** (`accounts:admin`): Ausgewählten Kontenplan löschen. Das Löschen ist gesperrt, wenn Unternehmen ihn referenzieren oder OPEX/CAPEX-Positionen seine Konten verwenden.

## Konten verwalten

### Kontonummern

Kontonummern werden als Text gespeichert, enthalten aber typischerweise numerische Werte. Beim Bearbeiten von Konten:
  - Sie können Zahlen (z. B. `6011`) oder Text (z. B. `6011-TRAVEL`) eingeben
  - Das System konvertiert numerische Eingaben automatisch in Zeichenketten
  - Innerhalb eines Kontenplans sollten Kontonummern eindeutig sein (nach Bereinigung erzwungen)

### Lokale Namen für Mehrsprachigkeit

Einige Länder verlangen, dass Konten in der Landessprache erfasst werden. Verwenden Sie das Feld **Lokaler Name**, um den Originalnamen zu speichern, während der englische Name im Hauptfeld **Kontoname** bleibt.

**Beispiel**: Französisches Konto
  - **Kontoname**: `Travel expenses` (Englisch, für Berichte)
  - **Lokaler Name**: `Frais de deplacement` (Französisch, für rechtliche Compliance)

Der lokale Name ist als ausgeblendete Spalte im Konten-Grid verfügbar. Aktivieren Sie ihn über die Spaltenauswahl, um beide Namen nebeneinander zu sehen.

## Konsolidierungskonten (Konzernberichterstattung)

Für Organisationen mit mehreren Ländern wird die tägliche Arbeit mit lokalen Kontenplänen (französischer PCG, UK GAAP, deutsches HGB usw.) erledigt, aber die Konzernberichterstattung erfordert oft eine Konsolidierung auf einen gemeinsamen Standard wie **IFRS** oder **US GAAP**.

**Konsolidierungskonten** lösen dies, indem sie lokale Konten standardisierten Konsolidierungskonten zuordnen.

### Funktionsweise

Jedes Konto kann drei Konsolidierungsfelder haben:
  - **Konsolidierungs-Kontonummer**: Die standardisierte Kontonummer (z. B. IFRS-Konto `6200`)
  - **Konsolidierungs-Kontoname**: Der standardisierte Name (z. B. `IT-Dienste und Software`)
  - **Konsolidierungs-Kontobeschreibung**: Optionale Details zur Konsolidierungskategorie

**Beispiel-Zuordnung**:

| Land | Lokaler CoA | Lokales Konto | Lokaler Name | -> | Konsolidierungskonto | Konsolidierungsname |
|------|------------|---------------|-------------|---|---------------------|---------------------|
| Frankreich | FR-PCG | 6061 | Frais postaux | -> | 6200 | IT-Dienste und Software |
| UK | UK-GAAP | 5200 | Postage and courier | -> | 6200 | IT-Dienste und Software |
| Deutschland | DE-HGB | 4920 | Portokosten | -> | 6200 | IT-Dienste und Software |

Alle drei lokalen Konten werden dem gleichen IFRS-Konsolidierungskonto `6200` zugeordnet, was eine Aggregation auf Konzernebene ermöglicht.

### Warum das wichtig ist

**Täglicher Betrieb**: Benutzer arbeiten mit ihren vertrauten lokalen Konten
  - Französische Benutzer wählen Konto `6061 - Frais postaux`
  - Britische Benutzer wählen Konto `5200 - Postage and courier`
  - Deutsche Benutzer wählen Konto `4920 - Portokosten`

**Konzernberichterstattung**: Das System kann Kosten nach Konsolidierungskonto zusammenführen
  - Alle IT-Dienstleistungskosten über Länder hinweg aggregieren zu `6200 - IT-Dienste und Software`
  - Das Management sieht eine einheitliche Ansicht unabhängig von lokalen Buchhaltungsunterschieden
  - Die gesetzliche Berichterstattung pro Land verwendet weiterhin lokale Konten

### Konsolidierungszuordnungen einrichten

**Option 1: Vorlagen (empfohlen)**
Alle integrierten Vorlagen enthalten IFRS-Konsolidierungszuordnungen für jedes Konto. Laden Sie eine beliebige Ländervorlage und die Konsolidierungsspalten sind bereits ausgefüllt -- keine manuelle Zuordnung nötig. Siehe [Verfügbare Vorlagen](#verfugbare-vorlagen) für die vollständige Liste.

**Option 2: CSV-Import**
Beim Import von Konten fügen Sie die Konsolidierungsfelder in Ihre CSV ein:

```
coa_code;account_number;account_name;consolidation_account_number;consolidation_account_name;consolidation_account_description
FR-PCG;6061;Frais postaux;6200;IT Services and Software;
UK-GAAP;5200;Postage and courier;6200;IT Services and Software;
DE-HGB;4920;Portokosten;6200;IT Services and Software;
```

**Option 3: Manuelle Eingabe**
Bearbeiten Sie Konten einzeln und füllen Sie die Konsolidierungsfelder im Konten-Arbeitsbereich aus.

### Best Practices

  - **Einen gemeinsamen Standard verwenden**: IFRS ist typisch für europäische Konzerne; US GAAP für amerikanische Unternehmen. Alle integrierten Vorlagen ordnen bereits den gleichen 14 IFRS-Konsolidierungskonten zu (siehe [Integrierte IFRS-Konsolidierung](#integrierte-ifrs-konsolidierung))
  - **Ein Konsolidierungsverzeichnis pflegen**: Führen Sie ein Referenzdokument mit Ihren Konsolidierungskonten und deren Bedeutung. Wenn Sie die integrierten Vorlagen verwenden, dienen die 14 IFRS-Konten als diese Referenz
  - **Die richtige Granularität zuordnen**: Nicht zu breit konsolidieren (verliert Einblicke) oder zu eng (zu komplex)
  - **Die Finanzabteilung einbeziehen**: Konsolidierungskonto-Zuordnungen sollten mit den Anforderungen der Konzern-Finanzberichterstattung übereinstimmen
  - **Systematisch aktualisieren**: Wenn Sie lokale Konten hinzufügen, ordnen Sie sie sofort Konsolidierungskonten zu

### Berichterstattung mit Konsolidierungskonten

Beim Erstellen von Berichten können Sie gruppieren nach:
  - **Lokalen Konten**: Zeigt länderspezifische Details (für lokales Management)
  - **Konsolidierungskonten**: Zeigt Kategorien auf Konzernebene (für Management-Berichte)

Diese duale Ansicht ermöglicht es Ihnen, sowohl lokale Compliance-Anforderungen als auch Konzernberichtsanforderungen zu erfüllen, ohne doppelte Daten zu pflegen.

## Legacy-Konten (Migrations-Support)

**Legacy-Konten** sind Konten ohne `coa_id` (erstellt, bevor Kontenpläne eingeführt wurden).

**Funktionsweise**:
  - Unternehmen OHNE Kontenplan können Legacy-Konten verwenden
  - Unternehmen MIT Kontenplan können Legacy-Konten nicht verwenden -- sie werden automatisch herausgefiltert
  - Legacy-Konten können weiterhin per CSV (`coa_code`) und Neuzuweisungs-Workflows migriert werden

**Migrationspfad**:
  1. Kontenpläne für Ihre Unternehmen erstellen oder laden
  2. Kontenpläne den Unternehmen zuweisen (im Unternehmens-Übersichts-Tab)
  3. Ihren Legacy-Konten `coa_id` zuweisen (per CSV-Import mit `coa_code` oder Massenbearbeitung)
  4. Bestehende OPEX/CAPEX-Positionen aktualisieren, die Warnungen „Veraltetes Konto" zeigen

**Tipp**: Sie müssen nicht alles auf einmal migrieren. Unternehmen ohne Kontenplan arbeiten weiterhin mit Legacy-Konten, was eine schrittweise Einführung ermöglicht.

## Warnungen bei veralteten Konten

Beim Bearbeiten von OPEX- oder CAPEX-Positionen sehen Sie möglicherweise:

```
Veraltetes Konto erkannt. Das ausgewählte Konto gehört nicht zum
Kontenplan des Unternehmens. Bitte aktualisieren Sie das Konto.
```

**Warum das passiert**:
  - Das Konto der Position gehört zum Kontenplan „A"
  - Das Unternehmen der Position gehört zum Kontenplan „B"
  - Nichtübereinstimmung erkannt

**Häufige Szenarien**:
  - Sie haben ein Unternehmen zu einem neuen Kontenplan migriert, aber alte Ausgabenpositionen noch nicht aktualisiert
  - Ein Konto wurde manuell einem anderen Kontenplan zugewiesen
  - Sie betrachten historische Daten von vor der Kontenplan-Migration

**Behebung**: Bearbeiten Sie die Position und wählen Sie ein Konto aus dem aktuellen Kontenplan des Unternehmens. Die Warnung verschwindet, sobald das Konto zum Kontenplan des Unternehmens passt.

## Status und Lebenszyklus

Konten verwenden das gleiche Lebenszyklusmanagement wie andere Stammdaten:

  - Standardmäßig **aktiviert**
  - Setzen Sie ein **Ende der Gültigkeit**, um ein Konto ab einem bestimmten Datum nicht mehr zu verwenden. Lassen Sie es leer, damit das Konto unbegrenzt aktiv bleibt
  - Wenn Sie das Konto ohne Datum auf **Deaktiviert** setzen, wird das Ende der Gültigkeit auf heute gesetzt
  - Sobald das Ende der Gültigkeit vorbei ist, wechselt der Status innerhalb einer Stunde von selbst auf **Deaktiviert**
  - Nach dem Ende der Gültigkeit:
      - Das Konto erscheint nicht mehr in Auswahl-Dropdowns für neue Positionen
      - Historische Daten bleiben erhalten; bestehende Positionen behalten ihre Kontozuweisungen
      - Berichte für Jahre, in denen das Konto aktiv war, enthalten es weiterhin
  - Das Konten-Grid zeigt standardmäßig nur **aktivierte** Konten. Wählen Sie im Umschalter **Anzeigen: Alle / Aktiv / Deaktiviert** die Option **Alle**, um deaktivierte Konten einzubeziehen.

## Mandantenlöschung und Kontenplan

Wenn ein Arbeitsbereich (Mandant) von einem Plattform-Administrator gelöscht wird, werden alle mandanteneigenen Buchhaltungsdaten im Rahmen des Löschprozesses dauerhaft entfernt:
- Kontenpläne (`chart_of_accounts`)
- Konten (`accounts`)
- Verknüpfungen von Unternehmen zu einem Kontenplan (`companies.coa_id`)

Die Löschung ist sofort und irreversibel. Der Mandantendatensatz bleibt für die Nachvollziehbarkeit erhalten, und sein Slug wird zur Wiederverwendung freigegeben.

**Tipp**: Bevorzugen Sie das Deaktivieren gegenüber dem Löschen. Das Löschen ist nur erlaubt, wenn keine OPEX/CAPEX-Positionen das Konto referenzieren.

## CSV-Import/Export

### Kontenpläne

Sie können eine Liste Ihrer Kontenpläne exportieren (mit Metadaten wie Code, Name, Land, Standard-Status), aber keine Kontenpläne direkt per CSV importieren. Erstellen Sie Kontenpläne über die Benutzeroberfläche oder laden Sie sie aus Vorlagen.

### Konten (globaler Endpunkt)

Der globale `/accounts`-CSV enthält eine `coa_code`-Spalte, um zu identifizieren, zu welchem Kontenplan jedes Konto gehört.

  - **Export**
      - **Vorlage**: Nur Kopfzeilen (verwenden Sie dies zur Importvorbereitung)
      - **Daten**: Alle Konten mit ihren Kontenplan-Codes, Kontonummern, Namen, lokalen Namen, Beschreibungen, Konsolidierungszuordnungen und Status
  - **Import**
      - Beginnen Sie mit der **Vorprüfung** (validiert Struktur, Kodierung, Pflichtfelder, Duplikate)
      - Wenn die Vorprüfung OK ist, wendet **Laden** Neuanlagen/Aktualisierungen an
      - **Zuordnung**: nach `(coa_code, account_number)` innerhalb Ihres Arbeitsbereichs
      - **Pflichtfelder**: `coa_code`, `account_number`, `account_name`
      - **Optionale Felder**: `native_name`, `description`, Konsolidierungsfelder, `status`
      - Duplikate in der Datei (gleicher coa_code + account_number) werden dedupliziert; erstes Vorkommen gewinnt

**CSV-Schema** (Semikolon `;` getrennt, UTF-8):
```
coa_code;account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status
```

### Konten (Kontenplan-bezogen)

Von der Kontenpläne-Seite aus sind **CSV importieren** und **CSV exportieren** automatisch auf den aktuell ausgewählten Kontenplan bezogen.

  - **Export**: Konten aus diesem Kontenplan (keine `coa_code`-Spalte nötig)
  - **Import**: Konten werden automatisch in diesen Kontenplan eingefügt/aktualisiert

**CSV-Schema** (Kontenplan-bezogen, Semikolon `;` getrennt, UTF-8):
```
account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status
```

**Hinweise**:
  - Verwenden Sie **UTF-8-Kodierung** und **Semikolons** als Trennzeichen
  - Der `coa_code` muss einem bestehenden Kontenplan in Ihrem Arbeitsbereich entsprechen
  - Kontonummern sollten innerhalb eines Kontenplans eindeutig sein
  - Statuswerte: `enabled` oder `disabled` (Standard ist enabled)

## Tipps

  - **Mit Vorlagen beginnen**: KANAP wird mit Vorlagen für 9 Länder plus IFRS ausgeliefert. Laden Sie eine, anstatt von Grund auf zu bauen -- Sie erhalten korrekte Kontonummern, lokale Namen und IFRS-Konsolidierungszuordnungen direkt. Beginnen Sie mit v1.0 (Einfach), wenn Sie unsicher sind; upgraden Sie auf v2.0 (Detailliert), wenn Sie mehr Granularität benötigen.
  - **Ein Standard pro Land**: Setzen Sie einen Standard-Kontenplan für jedes Land, damit neue Unternehmen automatisch der richtigen Kontenstruktur zugewiesen werden.
  - **Lokale Namen für Compliance**: Verwenden Sie das Feld Lokaler Name, wenn lokale Vorschriften Konten in der Landessprache erfordern. Aktivieren Sie die Spalte **Lokaler Name** im Grid, um beide Namen auf einen Blick zu sehen.
  - **Schrittweise migrieren**: Sie müssen nicht alles auf einmal umstellen. Unternehmen ohne Kontenpläne arbeiten weiterhin mit Legacy-Konten.
  - **Veraltete Konten beheben**: Wenn Sie Warnungen sehen, aktualisieren Sie das Konto, damit es zum aktuellen Kontenplan des Unternehmens passt. Dies hält Ihre Daten für Berichte sauber.
  - **Deaktivieren statt löschen**: Das Deaktivieren von Konten bewahrt die Historie. Löschen Sie nur Konten, die versehentlich erstellt wurden und nie verwendet wurden.
  - **CSV-Importe sind additiv**: Der Import von Konten fügt neue hinzu und aktualisiert bestehende (zugeordnet nach coa_code + account_number). Er löscht keine Konten, die nicht in der Datei enthalten sind.
  - **Konsolidierungskonten sind der Schlüssel für Konzerne**: Wenn Sie in mehreren Ländern tätig sind, richten Sie Konsolidierungszuordnungen von Anfang an ein. Dies macht die Konzernberichterstattung mühelos und lässt lokale Benutzer mit vertrauten Konten arbeiten.
  - **IFRS als Konsolidierungsstandard**: Die meisten europäischen Konzerne verwenden IFRS für die Konsolidierung. Alle integrierten Vorlagen ordnen bereits den gleichen 14 IFRS-Konsolidierungskonten zu, sodass die Konzernberichterstattung ohne zusätzlichen Aufwand länderübergreifend funktioniert.
  - **Deep Linking**: Die URL bewahrt Ihren ausgewählten Kontenplan, die Sortierreihenfolge, den Suchtext und die Filter. Teilen oder setzen Sie ein Lesezeichen auf einen Link, um genau die gleiche Ansicht wiederherzustellen.

## Häufige Szenarien

### Szenario 1: Organisation mit mehreren Ländern

Sie haben Tochtergesellschaften in Frankreich, im Vereinigten Königreich und in Deutschland, die jeweils lokale Rechnungslegungsstandards anwenden.

**Einrichtung**:
  1. Laden Sie drei Vorlagen: **FR-PCG v1.0**, **GB-UKGAAP v1.0**, **DE-SKR03 v1.0** (oder v2.0 für mehr Granularität)
  2. Legen Sie jede als Standard für ihr Land fest
  3. Weisen Sie die Unternehmen ihren jeweiligen Kontenplänen zu
  4. Neue Unternehmen erhalten automatisch den richtigen Kontenplan; die Kontoauswahl wird entsprechend gefiltert
  5. Die Konsolidierungszuordnungen sind bereits vorhanden, Konzernberichte funktionieren sofort

### Szenario 2: Migration von Legacy-Konten zu einem Kontenplan

Sie haben 50 Konten und 5 Unternehmen, die alle eingerichtet wurden, bevor es Kontenpläne gab.

**Migrationsschritte**:
  1. Erstellen Sie einen Kontenplan (z. B. `US-GAAP`)
  2. Exportieren Sie Ihre Konten als CSV
  3. Fügen Sie allen Zeilen eine Spalte `coa_code` hinzu (z. B. `US-GAAP`)
  4. Importieren Sie die aktualisierte CSV (die Konten gehören nun zum Kontenplan)
  5. Weisen Sie den Kontenplan Ihren Unternehmen zu
  6. Bearbeiten Sie alle OPEX/CAPEX-Positionen, die Warnungen zu veralteten Konten anzeigen

### Szenario 3: Ein Unternehmen auf einen neuen Kontenplan umstellen

Ihre britische Tochtergesellschaft stellt von UK GAAP auf IFRS um.

**Schritte**:
  1. Erstellen Sie einen neuen Kontenplan: `UK-IFRS` (oder laden Sie ihn aus einer Vorlage)
  2. Ändern Sie im Übersicht-Tab des Unternehmens den Kontenplan auf `UK-IFRS`
  3. Ab sofort können Benutzer nur noch Konten aus `UK-IFRS` auswählen
  4. Bestehende OPEX/CAPEX-Positionen behalten ihre alten Konten, zeigen aber Warnungen an
  5. Aktualisieren Sie die Positionen nach Bedarf (oder lassen Sie historische Daten unverändert, wenn die Berichterstattung es zulässt)

### Szenario 4: Konzernkonsolidierung einrichten (mehrere Länder)

Ihr Konzern hat Tochtergesellschaften in Frankreich, im Vereinigten Königreich und in Deutschland. Jedes Land verwendet seinen lokalen Rechnungslegungsstandard, Sie benötigen aber eine konsolidierte IFRS-Berichterstattung.

**Einrichtung**:
  1. Laden Sie Ländervorlagen mit integrierter IFRS-Konsolidierung:
      - **FR-PCG v1.0**: Französischer Plan Comptable General (20 Konten)
      - **GB-UKGAAP v1.0**: UK GAAP (20 Konten)
      - **DE-SKR03 v1.0**: Standardkontenrahmen 03 (20 Konten)

  2. Jedes Konto dieser Vorlagen ist bereits einem der 14 IFRS-Konsolidierungskonten zugeordnet. Zum Beispiel:
      - FR-PCG `205000` (Logiciels informatiques) -> IFRS `1100` (Immaterielle Vermögenswerte)
      - GB-UKGAAP `510` (Capitalized Software) -> IFRS `1100` (Immaterielle Vermögenswerte)
      - DE-SKR03 `27` (EDV-Software) -> IFRS `1100` (Immaterielle Vermögenswerte)

  3. Legen Sie jeden Kontenplan als Standard für sein Land fest und weisen Sie die Unternehmen zu

**Ergebnis**:
  - Französische Benutzer arbeiten im Alltag mit Konten des französischen PCG und französischen lokalen Namen
  - Britische Benutzer arbeiten mit UK-GAAP-Konten
  - Deutsche Benutzer arbeiten mit SKR03-Konten und deutschen lokalen Namen
  - Die Konzernfinanzabteilung erstellt Berichte nach Konsolidierungskonto und sieht die Gesamtausgaben in IFRS-Kategorien
  - Keine manuelle Zuordnungsarbeit nötig, die Vorlagen erledigen alles
  - Lokale gesetzliche Berichterstattung und IFRS-Konzernberichterstattung funktionieren nahtlos aus denselben Daten

## Häufig gestellte Fragen

**F: Können Konten zu mehreren Kontenplänen gehören?**
A: Nein. Jedes Konto gehört zu genau einem Kontenplan (oder zu keinem bei Legacy-Konten). Wenn Sie die gleiche Kontenstruktur in mehreren Kontenplänen benötigen, laden Sie die Vorlage in jeden einzelnen oder verwenden Sie CSV-Export/Import mit unterschiedlichen `coa_code`-Werten.

**F: Was passiert, wenn ich einen Kontenplan lösche?**
A: Das Löschen ist gesperrt, wenn Unternehmen ihn referenzieren oder OPEX/CAPEX-Positionen seine Konten verwenden. Weisen Sie zuerst Unternehmen neu zu und aktualisieren Sie Positionen, dann können Sie den Kontenplan löschen. Das Löschen eines Kontenplans löscht auch alle darin enthaltenen Konten, die nicht anderweitig referenziert werden.

**F: Kann ich Kontonummern umbenennen?**
A: Ja, im Konten-Arbeitsbereich. Das Ändern der Kontonummer aktualisiert automatisch alle Referenzen in OPEX/CAPEX-Positionen (die UUID des Kontos bleibt intern gleich).

**F: Wie sehe ich, welche Unternehmen einen bestimmten Kontenplan verwenden?**
A: Öffnen Sie **Verwalten** auf der Kontenpläne-Seite, wählen Sie den Kontenplan und prüfen Sie **Verknüpfte Unternehmen** im Detailbereich. Sie können auch die Unternehmensseite nach Kontenplan filtern.

**F: Was, wenn mein Land keine Vorlage hat?**
A: KANAP enthält Vorlagen für 9 Länder (FR, DE, GB, ES, IT, NL, BE, CH, US) plus IFRS als globalen Standard. Wenn Ihr Land nicht abgedeckt ist, erstellen Sie einen Kontenplan von Grund auf und fügen Sie Konten manuell oder per CSV-Import hinzu. Sie können weiterhin die IFRS-Konsolidierungs-Kontonummern (1000-2900) in Ihren Konsolidierungszuordnungen verwenden, um mit den integrierten Vorlagen kompatibel zu bleiben.

**F: Was ist der Unterschied zwischen v1.0 und v2.0 Vorlagen?**
A: **v1.0 (Einfach)** hat ~20 IT-fokussierte Konten, die wesentliche Kostenkategorien abdecken. **v2.0 (Detailliert)** fügt ~10 weitere granulare Unterkonten für feinere Verfolgung hinzu (z. B. Trennung von SaaS-Abonnements und Dauerlizenzen oder IT-Gehältern und Boni). Beide Versionen verwenden die gleichen Konsolidierungszuordnungen. Beginnen Sie mit v1.0 und wechseln Sie zu v2.0, wenn Sie mehr Detail benötigen.

**F: Kann ich Konten bearbeiten, die aus einer Vorlage stammen?**
A: Ja. Sobald Sie eine Vorlage laden, werden die Konten in Ihren Kontenplan kopiert und sind vollständig bearbeitbar. Änderungen an der Plattform-Vorlage wirken sich nicht auf Ihren Kontenplan aus, es sei denn, Sie laden sie explizit neu (was Ihre Änderungen überschreibt, wenn Sie den „Überschreiben"-Modus wählen).

**F: Sind Konsolidierungskonto-Zuordnungen erforderlich?**
A: Nein, sie sind optional. Wenn Sie nur in einem Land tätig sind oder keine Konzernkonsolidierung benötigen, können Sie diese Felder leer lassen. Konsolidierungskonten werden nur für Organisationen mit mehreren Ländern benötigt, die auf Konzernebene mit einem anderen Standard als ihrer lokalen Buchhaltung berichten.

**F: Können mehrere lokale Konten dem gleichen Konsolidierungskonto zugeordnet werden?**
A: Ja, genau das ist der Sinn! Viele lokale Konten über verschiedene Kontenpläne hinweg können dem gleichen Konsolidierungskonto zugeordnet werden. So aggregieren Sie Kosten aus verschiedenen Ländern in eine einzige konsolidierte Kategorie.

**F: Was passiert, wenn ich eine Konsolidierungszuordnung ändere?**
A: Bestehende OPEX/CAPEX-Positionen speichern Konsolidierungsdaten nicht direkt -- sie referenzieren das Konto, das die Konsolidierungszuordnung hat. Wenn Sie eine Zuordnung ändern, werden alle historischen und zukünftigen Positionen, die dieses Konto verwenden, unter dem neuen Konsolidierungskonto berichtet. Ändern Sie Zuordnungen mit Bedacht, wenn Sie historische Berichtskategorien beibehalten müssen.
