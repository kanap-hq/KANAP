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
  - Jedes Konto legt fest, ob es für OPEX-Zeilen, CAPEX-Zeilen oder beides dient. Siehe [OPEX- oder CAPEX-Konten](#opex-oder-capex-konten)

## Wo Sie es finden

- Pfad: **Stammdaten > Kontenpläne**
- Berechtigungen:
  - Anzeigen: `accounts:reader`
  - Konten und Kontenpläne erstellen/bearbeiten: `accounts:manager`
  - CSV importieren, CSV exportieren, Löschen: `accounts:admin`

## Mit der Liste arbeiten

Die Seite hat zwei Ebenen: einen **Kontenplan-Selektor** oben und ein **Konten-Grid** darunter.

### Kontenplan-Chip-Leiste

Eine horizontale Reihe von Chips stellt jeden Kontenplan dar. Klicken Sie auf einen Chip, um das Konten-Grid auf diesen Kontenplan umzuschalten.

- Der ausgewählte Chip ist gefüllt, die übrigen sind umrandet.
- Fahren Sie mit der Maus über einen Chip, um den Namen des Kontenplans, seine Länder, die Anzahl der Konten und seine Rollen zu sehen. Siehe [Rollen der Kontenpläne](#rollen-der-kontenplane).

Mit der Berechtigung `accounts:manager` erscheinen rechts zwei weitere Bedienelemente:

- **Neu**: Öffnet den Dialog **Neuer Kontenplan**.
- **Kontenpläne verwalten**: Öffnet den Dialog [Kontenpläne verwalten](#der-dialog-kontenplane-verwalten).

Wenn kein Kontenplan existiert, fordert die Chip-Leiste Sie auf, Ihren ersten Kontenplan zu erstellen.

### Kontenplan-Zusammenfassung

Unter der Chip-Leiste zeigt eine Zusammenfassung den **Code** und die **Anzahl der Konten** des ausgewählten Kontenplans. Eine zweite Zeile nennt seinen **Namen**, seine **Länder** und seine **Rollen** im Klartext, zum Beispiel „Französischer Kontenplan · Frankreich · Länderstandard (Frankreich)".

### Konsolidierungszeile

Wenn Ihr Arbeitsbereich einen [Konsolidierungskontenplan](#der-konsolidierungskontenplan) hat, zeigt eine dritte Zeile, wie gut der ausgewählte Kontenplan darauf abgebildet ist. Auf dem Konsolidierungskontenplan selbst erscheint sie nicht, weil seine Konten die Konzernkonten sind.

In den folgenden Beispielen steht `IFRS` für den Code Ihres Konsolidierungskontenplans.

- **Alle Konten sind dem Konsolidierungskontenplan IFRS zugeordnet.** Jedes Konto hat ein Konsolidierungskonto, das im Konsolidierungskontenplan existiert.
- **N Konten verweisen auf ein Konsolidierungskonto, das in IFRS fehlt**: Diese Konten tragen eine Nummer, die der Konsolidierungskontenplan nicht enthält.
- **N Konten haben kein Konsolidierungskonto**: Diese Konten sind noch nicht zugeordnet.

Jede Zahl ist ein Link. Klicken Sie darauf, um das Grid auf diese Konten zu filtern. Der Filter zeigt Konten aller Status, deaktivierte Konten werden also mitgezählt und aufgelistet. Klicken Sie erneut auf die Zahl oder auf **Alle Konten anzeigen**, um zur normalen Liste zurückzukehren. Der Filter wird auch entfernt, wenn Sie einen anderen Chip wählen. Wenn Sie ein Konto aus einer gefilterten Liste öffnen, durchlaufen die Pfeile für vorheriges und nächstes Konto im Arbeitsbereich dieselbe gefilterte Liste.

Im Grid markiert ein kleiner oranger Punkt neben **Konsol.-Kontonr.** ein Konto, dessen Nummer nicht im Konsolidierungskontenplan steht. Fahren Sie mit der Maus über den Punkt, um den Namen des Konsolidierungskontenplans zu sehen.

Ohne Konsolidierungskontenplan lautet die Zeile „Kein Konsolidierungskontenplan." Manager können auf **Wählen Sie einen unter Kontenpläne verwalten** klicken, um den Dialog zu öffnen.

### Konten-Grid

Das Grid zeigt nur Konten für den ausgewählten Kontenplan.

**Standardspalten**:
- **Kontonr.**: Die Kontonummer. Zum Öffnen des Konten-Arbeitsbereichs anklicken.
- **Name**: Der Kontoname. Zum Öffnen des Konten-Arbeitsbereichs anklicken.
- **Verwendet für**: **OPEX und CAPEX**, **Nur OPEX** oder **Nur CAPEX**. Siehe [OPEX- oder CAPEX-Konten](#opex-oder-capex-konten).
- **Konsol.-Kontonr.**: Die Konsolidierungs-Kontonummer.
- **Konsol.-Name**: Der Konsolidierungs-Kontoname.

**Zusätzliche Spalten** (standardmäßig ausgeblendet, über Spaltenauswahl aktivierbar):
- **Lokaler Name**: Der Kontoname in der Landessprache.
- **Beschreibung**: Kontobeschreibung.
- **Konsol.-Beschreibung**: Konsolidierungs-Kontobeschreibung.
- **Status**: Ob das Konto aktiviert oder deaktiviert ist.
- **Erstellt**: Zeitstempel der Kontoerstellung.

**Filtern**:
- Schnellsuche: Durchsucht sichtbare Textspalten.
- Statusbereich: der Umschalter **Anzeigen: Alle / Aktiv / Deaktiviert** über dem Grid. Standard ist **Aktiv**, zeigt nur aktive Konten. Wählen Sie **Alle**, um deaktivierte Konten einzubeziehen.
- Spaltenfilter: Spaltenüberschriftsfilter verwenden (z. B. haben die Spalten **Status** und **Verwendet für** einen Set-Filter). Wenn Sie im **Status**-Filter auf **Leeren** klicken oder beide Werte abwählen, zeigt die Liste nichts mehr an, unabhängig von **Anzeigen**.

**Sortierung**: Standard ist **Kontonr.** aufsteigend.

**Aktionen** (im Seitenheader):
- **Neues Konto** (`accounts:manager`): Öffnet ein neues Kontoformular, in dem der ausgewählte Kontenplan bereits gewählt ist.
- **CSV importieren** (`accounts:admin`): Konten in den ausgewählten Kontenplan importieren.
- **CSV exportieren** (`accounts:admin`): Konten aus dem ausgewählten Kontenplan exportieren.
- **Auswahl löschen** (`accounts:admin`): Ausgewählte Kontenzeilen löschen. Zeilen über die Kontrollkästchen-Spalte auswählen (für Admins sichtbar).

Alle Zeilenzellen sind anklickbare Links zum Konten-Arbeitsbereich. Sie können rechtsklicken oder Strg+Klicken, um in einem neuen Tab zu öffnen.

## Der Konten-Arbeitsbereich

Klicken Sie auf eine beliebige Zeile im Konten-Grid, um den Konten-Arbeitsbereich zu öffnen.

### Aufbau

- **Kopfbereich**: Die Kontonummer dient als Referenz (Sie können sie dort kopieren) und der Kontoname als Titel. Klicken Sie auf den Titel, um das Konto umzubenennen. Die Pfeile **Vorheriges Konto** und **Nächstes Konto** führen durch die Konten der Liste, aus der Sie kommen, in derselben Reihenfolge und mit derselben Suche und denselben Filtern. Der Link zurück führt zu **Kontenpläne** und behält Ihre Auswahl bei.
- **Eigenschaften-Bereich** rechts: **Kontenplan**, **Kontonummer**, **Verwendet für** und **Lebenszyklus** (der Statusschalter und das Datum **Ende der Gültigkeit**). Mit der Bereichsschaltfläche klappen Sie ihn ein oder wieder aus. Siehe [Status und Lebenszyklus](#status-und-lebenszyklus).
- **Hauptspalte**: **Lokaler Name (Landessprache)**, **Beschreibung** und der Abschnitt **Konsolidierung**.

**Änderungen werden automatisch gespeichert.** Jedes Feld wird gespeichert, sobald Sie es verlassen, und es gibt keine Schaltfläche „Speichern". Wird ein Wert abgelehnt, erscheint unter dem Feld eine Meldung. Die **Kontonummer** muss eine ganze Zahl größer als null sein.

Zum Bearbeiten benötigen Sie `accounts:manager`. Benutzer mit Leserechten sehen dieselbe Seite mit gesperrten Feldern.

### OPEX- oder CAPEX-Konten

Das Feld **Verwendet für** legt fest, welche Budgetpositionen das Konto verwenden dürfen:

| Wert | Bedeutung |
|------|-----------|
| **OPEX und CAPEX** | Beide Arten von Zeilen dürfen das Konto verwenden. Das ist der Standard |
| **Nur OPEX** | Nur OPEX-Zeilen dürfen das Konto verwenden |
| **Nur CAPEX** | Nur CAPEX-Zeilen dürfen das Konto verwenden |

Die Kontoauswahl einer OPEX-Zeile zeigt die Konten für OPEX und für beides. Die Auswahl einer CAPEX-Zeile verhält sich entsprechend für CAPEX. Eine Zeile, die bereits ein Konto der anderen Art hat, behält es und bleibt bearbeitbar. Ein solches Konto für eine neue Zeile oder beim Ändern des Kontos einer Zeile zu wählen, wird abgelehnt.

Wenn ein gewählter Wert mit Zeilen in Konflikt steht, die das Konto bereits verwenden, erscheint unter dem Feld ein Hinweis, zum Beispiel „12 CAPEX-Zeilen verwenden dieses Konto. Sie behalten es. Neue CAPEX-Zeilen können es nicht auswählen.“ Klicken Sie auf **Diese Zeilen anzeigen**, um diese Zeilen in der Liste in einem neuen Tab zu öffnen. Der Hinweis bleibt, solange der Konflikt besteht.

Beim Hinzufügen dieser Einstellung hat KANAP sie für Sie ausgefüllt. Ein Konto, das nur von OPEX-Zeilen verwendet wird, wurde zu **Nur OPEX**, und ein Konto, das nur von CAPEX-Zeilen verwendet wird, zu **Nur CAPEX**. Ein Konto, das von beiden verwendet wird, bleibt **OPEX und CAPEX**. Ein ungenutztes Konto folgt seinem Konsolidierungskonto: Vermögenskonten des IFRS-Konsolidierungskontenplans sind für CAPEX, Betriebsaufwandskonten für OPEX. Administratoren können jedes davon ändern.

### Konsolidierungskonto

Der Abschnitt **Konsolidierung** enthält ein einziges Feld, **Konsolidierungskonto**. Es ist eine Liste der Konten Ihres [Konsolidierungskontenplans](#der-konsolidierungskontenplan), angezeigt mit Nummer und Name. Wählen Sie eines aus, um das Konto darauf abzubilden, oder wählen Sie **Keines**, um die Zuordnung zu entfernen.

- Sie wählen die Nummer. Name und Beschreibung des Konsolidierungskontos stammen aus dem Konsolidierungskontenplan und erscheinen unter dem Feld. Sie können sie nicht eingeben.
- Deaktivierte Konten des Konsolidierungskontenplans werden nur angeboten, wenn das Konto bereits darauf abgebildet ist. Sie tragen den Hinweis **Deaktiviert**.
- Existiert die gespeicherte Nummer nicht im Konsolidierungskontenplan, bleibt sie mit einem orangen Punkt sichtbar, dazu erscheint die Meldung „Diese Nummer existiert im Konsolidierungskontenplan IFRS nicht. Wählen Sie ein Konto aus IFRS." Wählen Sie ein gültiges Konto, um das zu beheben.
- Ohne Konsolidierungskontenplan ist das Feld gesperrt und zeigt „Es ist kein Konsolidierungskontenplan festgelegt.", gefolgt vom Link **Wählen Sie einen unter Kontenpläne → Kontenpläne verwalten.**

### Ein Konto erstellen

**Neues Konto** in der Liste öffnet ein kurzes Formular, in dem der Kontenplan, den Sie gerade angesehen haben, bereits ausgewählt ist. Füllen Sie Kontenplan, Kontonummer und Name sowie die optionalen Felder aus und klicken Sie auf **Konto erstellen**. Nach dem Erstellen öffnet sich das Konto im Arbeitsbereich und wird danach automatisch gespeichert.

## Kontenpläne einrichten

### Einen Kontenplan erstellen

Klicken Sie in der Chip-Leiste auf **Neu** oder im Dialog „Kontenpläne verwalten" auf **Neuer Kontenplan**. Sie können einen Kontenplan auf zwei Arten erstellen:

1. **Ein leerer Kontenplan**: Konten fügen Sie später einzeln oder per CSV-Import hinzu.
2. **Eine Vorlage**: Laden Sie einen vorkonfigurierten Kontensatz, der von Plattform-Administratoren gepflegt wird.

**Felder des Erstellen-Dialogs**:
- **Ausgangspunkt**: **Ein leerer Kontenplan** oder **Eine Vorlage**.
- **Vorlage** (nur im Vorlagenmodus): Wählen Sie eine Vorlage aus der Liste. Jeder Eintrag zeigt Name, Länder und Version. Mit der Wahl einer Vorlage werden Name und Code ausgefüllt, die Sie ändern können.
- **Code** (Pflicht): Eine kurze, stabile Kennung für CSV-Dateien und Links.
- **Name** (Pflicht): Ein beschreibender Name für den Kontenplan.
- **Verwendet für**: **Ein Land** oder **Alle Länder**. Eine globale Vorlage erstellt immer einen Kontenplan für **Alle Länder**.
- **Land** (nur bei einem Land): Wählen Sie ein Land aus der Liste.
- **Als Länderstandard festlegen** (nur bei einem Land): Aktivieren Sie das Feld, um diesen Kontenplan zum Standard des gewählten Landes zu machen.

Klicken Sie im Vorlagenmodus vor dem Erstellen auf **Vorlage prüfen**, um zu sehen, wie viele Konten hinzugefügt und wie viele aktualisiert werden. Klicken Sie dann auf **Erstellen**.

Ein neuer Kontenplan hat keine Rolle, außer dem Länderstandard, den Sie hier ankreuzen. Für eine andere Rolle nutzen Sie [Kontenpläne verwalten](#der-dialog-kontenplane-verwalten).

### Aus Vorlagen laden

Vorlagen sind Standard-Kontensets, die von Plattform-Administratoren verwaltet werden. Sie können sein:
  - Länderspezifisch (z. B. französischer PCG, UK GAAP)
  - Global (für alle Länder verfügbar)

**Funktionsweise**:
  - Gehen Sie zu **Stammdaten > Kontenpläne**
  - Klicken Sie auf **Neu** in der Chip-Leiste
  - Wählen Sie unter **Ausgangspunkt** die Option **Eine Vorlage**
  - Wählen Sie eine Vorlage. Globale Vorlagen zeigen „Alle Länder" und erstellen einen Kontenplan für alle Länder; Ländervorlagen zeigen ihr Land
  - Klicken Sie auf **Vorlage prüfen**, um zu sehen, wie viele Konten hinzugefügt und wie viele aktualisiert werden
  - Klicken Sie auf **Erstellen**, um die Konten in Ihren Kontenplan zu kopieren

**Was kopiert wird**: Kontonummern, Namen, lokale Namen (Landessprache), Beschreibungen, Konsolidierungszuordnungen, **Verwendet für** und Status. Die Konten werden zu Ihren eigenen, die Sie bearbeiten können -- Änderungen an der Plattform-Vorlage wirken sich nicht auf Ihren Kontenplan aus, es sei denn, Sie laden sie explizit neu. Hat Ihr Arbeitsbereich einen Konsolidierungskontenplan, werden Name und Beschreibung des Konsolidierungskontos jedes Kontos aus diesem Kontenplan übernommen (siehe [Der Konsolidierungskontenplan](#der-konsolidierungskontenplan)).

**Tipp**: Nach dem Laden einer Vorlage können Sie unternehmensspezifische Konten hinzufügen, Einträge umbenennen oder ungenutzte Konten deaktivieren. Vorlagen bieten einen Ausgangspunkt, keine gesperrte Struktur.

### Verfügbare Vorlagen

KANAP wird mit **20 vorkonfigurierten Vorlagen** ausgeliefert, die 10 Buchhaltungsstandards abdecken. Jeder Standard kommt in zwei Versionen:

- **v1.0 (Einfach)**: Ein fokussiertes Set von ~20 IT-relevanten Konten -- Softwarelizenzen, Cloud-Hosting, Cybersicherheit, Telekommunikation, Beratung, Personalkosten, Schulung und mehr. Am besten für Organisationen, die einen schlanken Ausgangspunkt wünschen.
- **v2.0 (Detailliert)**: Alles aus v1.0 plus zusätzliche granulare Unterkonten (~30 Konten). Fügt Aufschlüsselungen wie Gekaufte vs. Intern Entwickelte Software, Netzwerkausrüstung, SaaS vs. Dauerlizenzen, Mobilfunkkommunikation, IT-Boni, IT-Versicherung und mehr hinzu. Am besten für Organisationen, die eine feinere Kostenverfolgung benötigen.

Beide Versionen verwenden **echte Kontonummern aus dem offiziellen Buchhaltungsstandard jedes Landes** und enthalten lokale Namen in der Landessprache. Jedes Konto trägt außerdem seine Einstellung **Verwendet für**: Vermögenskonten sind für CAPEX, Aufwandskonten für OPEX, und Abschreibungs- und Wertminderungskonten für beides.

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

### Neue Arbeitsbereiche (Bereitstellung)

Neue Arbeitsbereiche werden automatisch mit der Vorlage **IFRS v1.0** bereitgestellt. Sie erzeugt einen Kontenplan für alle Länder mit den 14 IFRS-Konsolidierungskonten. Er ist zugleich **Standard für andere Länder** und **Konsolidierungskontenplan**, sodass Unternehmen und Konzernberichte sofort ohne Einrichtung funktionieren. Sie können die vorgeladenen Konten und den Kontenplan später bearbeiten oder löschen (im Rahmen der üblichen Schutzregeln).

## Rollen der Kontenpläne

Ein Kontenplan kann bis zu drei Rollen haben. Sie sind voneinander unabhängig und werden jeweils im Klartext im Tooltip des Chips, in der Zusammenfassung und in **Kontenpläne verwalten** angezeigt.

| Rolle | Was sie bewirkt | Wie viele |
|-------|-----------------|-----------|
| **Länderstandard ({country})** | Wird vorgeschlagen, wenn Sie ein Unternehmen in diesem Land anlegen | Einer pro Land. Für Kontenpläne eines Landes |
| **Standard für andere Länder** | Gilt für Unternehmen in Ländern ohne Standardkontenplan. Wird auch Unternehmen ohne Kontenplan zugewiesen | Einer pro Arbeitsbereich. Für Kontenpläne für alle Länder |
| **Konsolidierungskontenplan** | Die Konzernkonten, auf die jedes lokale Konto für das konsolidierte Reporting abgebildet wird | Einer pro Arbeitsbereich. Jeder Kontenplan |

Der übliche Ausgangspunkt ist ein IFRS-Kontenplan, der **Standard für andere Länder** und **Konsolidierungskontenplan** zugleich ist, dazu ein lokaler Kontenplan pro Land mit **Länderstandard ({country})**. Sie können die Rollen trennen, zum Beispiel einen Konzernkontenplan als Konsolidierungskontenplan, während ein anderer Kontenplan für alle Länder die übrigen Länder bedient. Ein Kontenplan kann auch keine Rolle haben.

Jede Rolle hat genau einen Inhaber (einen pro Land beim Länderstandard). Wenn Sie eine Rolle einem anderen Kontenplan geben, verliert sie der bisherige Inhaber.

## Kontenpläne verwalten

### Der Dialog Kontenpläne verwalten

Klicken Sie in der Chip-Leiste auf **Kontenpläne verwalten**, um den Dialog zu öffnen. Eine Tabelle listet alle Kontenpläne:

- **Code** und **Name**
- **Länder**: das Land des Kontenplans oder „Alle Länder"
- **Rollen**: die Rollen des Kontenplans im Klartext oder ein Strich, wenn er keine hat
- **Gesellschaften**: die Anzahl der dem Kontenplan zugewiesenen Unternehmen
- **Konten**: die Anzahl der Konten im Kontenplan

Drei kurze Zeilen unter der Tabelle erklären die Rollen. **Neuer Kontenplan** (`accounts:manager`) unten links öffnet den Erstellen-Dialog.

Jede Zeile hat ein Menü **⋯**, das nur die Aktionen anbietet, die für diesen Kontenplan gelten. Die Beschriftung folgt dem aktuellen Zustand.

- **Als Länderstandard festlegen** / **Nicht mehr Länderstandard** (`accounts:manager`): für Kontenpläne eines Landes.
- **Als Standard für andere Länder festlegen** / **Nicht mehr Standard für andere Länder** (`accounts:manager`): für Kontenpläne für alle Länder. Wenn Sie ihn zum Standard machen, wird er auch Unternehmen ohne Kontenplan zugewiesen.
- **Als Konsolidierungskontenplan festlegen** / **Nicht mehr Konsolidierungskontenplan** (`accounts:manager`): für jeden Kontenplan. Siehe [Den Konsolidierungskontenplan wechseln](#den-konsolidierungskontenplan-wechseln).
- **Löschen** (`accounts:admin`): Löscht den Kontenplan samt seinen Konten. Enthält der Kontenplan Konten, nennt eine Bestätigung, wie viele gelöscht werden. Ist er der Konsolidierungskontenplan, weist die Bestätigung darauf hin, dass das Konzernreporting dann keinen Referenzkontenplan mehr hat. Das Löschen wird abgelehnt, solange Unternehmen den Kontenplan verwenden oder OPEX-/CAPEX-Positionen seine Konten nutzen. Der Dialog nennt den Grund.

Die Rollen ändern sich, sobald Sie eine Aktion wählen. Die Tabelle wird sofort aktualisiert.

## Konten verwalten

### Kontonummern

Eine Kontonummer ist eine ganze Zahl größer als null (zum Beispiel `6011`). Innerhalb eines Kontenplans wird jede Nummer nur einmal verwendet.

### Lokale Namen für Mehrsprachigkeit

Einige Länder verlangen, dass Konten in der Landessprache erfasst werden. Verwenden Sie das Feld **Lokaler Name (Landessprache)**, um den Originalnamen zu speichern, während der englische Name im Hauptfeld **Kontoname** bleibt.

**Beispiel**: Französisches Konto
  - **Kontoname**: `Travel expenses` (Englisch, für Berichte)
  - **Lokaler Name (Landessprache)**: `Frais de deplacement` (Französisch, für rechtliche Compliance)

Der lokale Name ist als ausgeblendete Spalte im Konten-Grid verfügbar. Aktivieren Sie ihn über die Spaltenauswahl, um beide Namen nebeneinander zu sehen.

## Konsolidierungskonten (Konzernberichterstattung)

In Organisationen mit mehreren Ländern erfolgt die tägliche Arbeit mit lokalen Kontenplänen (französischer PCG, UK GAAP, deutsches HGB usw.), die Konzernberichterstattung erfordert jedoch oft eine Konsolidierung auf einen gemeinsamen Standard wie **IFRS** oder **US GAAP**.

**Konsolidierungskonten** lösen das, indem lokale Konten auf die Konten eines Referenzkontenplans abgebildet werden.

### Der Konsolidierungskontenplan

Ihr Arbeitsbereich hat höchstens einen **Konsolidierungskontenplan**. Er enthält die Konzernkonten, auf die jedes lokale Konto abgebildet wird. Er ist unabhängig von den Standard-Rollen: Jeder Kontenplan kann der Konsolidierungskontenplan sein, auch einer, der zugleich Standard für andere Länder ist.

Bei jedem lokalen Konto wählen Sie ein **Konsolidierungskonto** aus den Konten des Konsolidierungskontenplans. Die Nummer stellt die Verbindung her. Name und Beschreibung des Konsolidierungskontos stammen automatisch aus dem Konsolidierungskontenplan, sie stimmen also immer mit dessen Konten überein.

**Beispielzuordnung**:

| Land | Lokaler Kontenplan | Lokales Konto | Lokaler Name | -> | Konsolidierungskonto | Konsolidierungsname |
|------|--------------------|---------------|--------------|----|----------------------|---------------------|
| Frankreich | FR-PCG | 6061 | Frais postaux | -> | 6200 | IT Services and Software |
| Vereinigtes Königreich | UK-GAAP | 5200 | Postage and courier | -> | 6200 | IT Services and Software |
| Deutschland | DE-HGB | 4920 | Portokosten | -> | 6200 | IT Services and Software |

Alle drei lokalen Konten werden auf dasselbe Konsolidierungskonto `6200` abgebildet, was die Aggregation auf Konzernebene ermöglicht.

**Was synchron bleibt**:

  - Wenn Sie ein Konto des Konsolidierungskontenplans umbenennen, seine Beschreibung ändern oder ihm eine neue Nummer geben, folgen alle darauf abgebildeten Konten. Nummer, Name und Beschreibung werden überall in einem Schritt aktualisiert.
  - Wenn Sie ein Konto auf eine Nummer abbilden, die im Konsolidierungskontenplan existiert, werden Name und Beschreibung des Konsolidierungskontos für Sie ausgefüllt.

### Warum das wichtig ist

**Tagesgeschäft**: Benutzer arbeiten mit ihren vertrauten lokalen Konten
  - Französische Benutzer wählen Konto `6061 - Frais postaux`
  - Britische Benutzer wählen Konto `5200 - Postage and courier`
  - Deutsche Benutzer wählen Konto `4920 - Portokosten`

**Konzernberichterstattung**: Das System kann Kosten nach Konsolidierungskonto zusammenfassen
  - Alle IT-Dienstleistungskosten über Länder hinweg werden unter `6200 - IT Services and Software` aggregiert
  - Das Management sieht eine einheitliche Ansicht unabhängig von lokalen Buchhaltungsunterschieden
  - Die gesetzliche Berichterstattung pro Land verwendet weiterhin lokale Konten

### Konsolidierungszuordnungen einrichten

**Option 1: Vorlagen (empfohlen)**
Alle integrierten Vorlagen enthalten IFRS-Konsolidierungszuordnungen für jedes Konto. Laden Sie eine beliebige Ländervorlage, und die Konsolidierungsspalten sind bereits ausgefüllt. Ein neuer Arbeitsbereich hat den IFRS-Kontenplan bereits als Konsolidierungskontenplan. Siehe [Verfügbare Vorlagen](#verfugbare-vorlagen) für die vollständige Liste.

**Option 2: CSV-Import**
Nehmen Sie beim Import von Konten die Konsolidierungsfelder in Ihre CSV auf:

```
coa_code;account_number;account_name;consolidation_account_number;consolidation_account_name;consolidation_account_description
FR-PCG;6061;Frais postaux;6200;IT Services and Software;
UK-GAAP;5200;Postage and courier;6200;IT Services and Software;
DE-HGB;4920;Portokosten;6200;IT Services and Software;
```

Nur die Konsolidierungs-Kontonummer zählt, wenn der Konsolidierungskontenplan sie enthält: Der Import ersetzt die Spalten für Name und Beschreibung durch die des Konsolidierungskontenplans. Steht die Nummer nicht im Konsolidierungskontenplan, bleiben Name und Beschreibung aus der Datei erhalten, und das Konto wird als außerhalb des Konsolidierungskontenplans markiert. Eine leere Nummer entfernt die Zuordnung, den Namen und die Beschreibung.

**Option 3: Manuelle Eingabe**
Öffnen Sie ein Konto und wählen Sie sein **Konsolidierungskonto** im Konten-Arbeitsbereich.

### Den Konsolidierungskontenplan wechseln

1. Öffnen Sie **Kontenpläne verwalten** und das Menü **⋯** des Kontenplans, den Sie verwenden möchten.
2. Klicken Sie auf **Als Konsolidierungskontenplan festlegen**.
3. Ersetzt der Kontenplan einen anderen Konsolidierungskontenplan, oder verweisen einige Konten auf Nummern, die er nicht enthält, öffnet sich eine Bestätigung. Sie nennt den ersetzten Kontenplan und gibt die Anzahlen an: wie viele Konten ihr Konsolidierungskonto behalten, wie viele auf eine Nummer verweisen, die im neuen Kontenplan fehlt, und wie viele kein Konsolidierungskonto haben.
4. Klicken Sie auf **Als Konsolidierungskontenplan festlegen**, um zu bestätigen.

**Was mit bestehenden Zuordnungen geschieht**: KANAP ordnet Konten nie automatisch neu zu. Jedes Konto behält seine Konsolidierungsnummer.

  - Konten, deren Nummer im neuen Kontenplan existiert, behalten sie und übernehmen Name und Beschreibung dieses Kontenplans.
  - Konten, deren Nummer im neuen Kontenplan nicht existiert, behalten ihre Nummer und werden markiert: Die Konsolidierungszeile zählt sie, ein Punkt kennzeichnet sie im Grid, und der Konten-Arbeitsbereich fordert Sie auf, ein gültiges Konto zu wählen. Filtern Sie sie über die Konsolidierungszeile und ordnen Sie sie einzeln neu zu, oder laden Sie eine CSV.
  - Konten ohne Nummer bleiben nicht zugeordnet.

Wenn Sie **Nicht mehr Konsolidierungskontenplan** wählen, hat das Konzernreporting keinen Referenzkontenplan mehr. Die Zuordnungen der Konten bleiben erhalten.

### Best Practices

  - **Einen gemeinsamen Standard verwenden**: IFRS ist typisch für europäische Konzerne; US GAAP für amerikanische Unternehmen. Alle integrierten Vorlagen ordnen bereits den gleichen 14 IFRS-Konsolidierungskonten zu (siehe [Integrierte IFRS-Konsolidierung](#integrierte-ifrs-konsolidierung))
  - **Einen einzigen Konsolidierungskontenplan führen**: Er ist die Liste der Reporting-Konten Ihres Konzerns. Wenn Sie die integrierten Vorlagen verwenden, dienen die 14 IFRS-Konten als Referenz
  - **Auf der richtigen Granularität zuordnen**: Nicht zu grob konsolidieren (Einblick geht verloren) und nicht zu fein (zu komplex)
  - **Das Finanzwesen einbeziehen**: Konsolidierungszuordnungen sollten den Anforderungen der Finanzberichterstattung Ihres Konzerns entsprechen
  - **Systematisch aktualisieren**: Wenn Sie lokale Konten hinzufügen, ordnen Sie sie sofort Konsolidierungskonten zu. Die Konsolidierungszeile zeigt, was noch fehlt

### Berichterstattung mit Konsolidierungskonten

Beim Erstellen von Berichten können Sie gruppieren nach:
  - **Lokalen Konten**: Zeigt länderspezifische Details (für lokales Management)
  - **Konsolidierungskonten**: Zeigt Kategorien auf Konzernebene (für Management-Berichte)

Diese duale Sicht erfüllt sowohl lokale Compliance-Anforderungen als auch Konzernberichtsbedarf, ohne doppelte Daten zu pflegen.

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

Der globale `/accounts`-CSV enthält eine `coa_code`-Spalte, um zu identifizieren, zu welchem Kontenplan jedes Konto gehört. **CSV exportieren** und **CSV importieren** nutzen sie, wenn auf der Seite kein Kontenplan ausgewählt ist.

  - **CSV exportieren**: Alle Konten mit ihren Kontenplan-Codes, Kontonummern, Namen, lokalen Namen, Beschreibungen, Konsolidierungszuordnungen, Status und **Verwendet für**
  - **CSV importieren**: **Vorlage herunterladen** im Dialog liefert eine Datei nur mit den Kopfzeilen. Beginnen Sie mit der **Vorabprüfung**, um Struktur, Kodierung, Pflichtfelder und Duplikate zu prüfen, und dann **Laden**, um die Einfügungen und Aktualisierungen anzuwenden
  - **Zuordnung**: nach `(coa_code, account_number)` innerhalb Ihres Arbeitsbereichs
  - **Pflichtzellen**: `coa_code`, `account_number`, `account_name`. Alle Zeilen einer Datei müssen denselben `coa_code` tragen
  - **Optionale Zellen**: `native_name`, `description`, Konsolidierungsfelder, `status`, `nature`
  - Duplikate in der Datei (gleicher coa_code + account_number) werden dedupliziert; erstes Vorkommen gewinnt

**CSV-Schema** (der Export schreibt das Trennzeichen der Sprache der Oberfläche; hier mit Semikolons dargestellt):
```
coa_code;account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status;nature
```

### Konten (Kontenplan-bezogen)

Von der Kontenpläne-Seite aus sind **CSV importieren** und **CSV exportieren** automatisch auf den aktuell ausgewählten Kontenplan bezogen.

  - **CSV exportieren**: Konten aus diesem Kontenplan (keine `coa_code`-Spalte nötig)
  - **CSV importieren**: Konten werden automatisch in diesen Kontenplan eingefügt oder aktualisiert

**CSV-Schema** (Kontenplan-bezogen; hier mit Semikolons dargestellt):
```
account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status;nature
```

**Hinweise**:
  - Siehe [CSV-Dateien](csv-files.md) für die Kodierung, das Trennzeichen, die Datumsformen und die beiden Importschritte
  - Der `coa_code` muss einem bestehenden Kontenplan in Ihrem Arbeitsbereich entsprechen
  - Kontonummern sollten innerhalb eines Kontenplans eindeutig sein
  - Statuswerte: `enabled` oder `disabled` (Standard ist enabled)
  - `nature` ist die Einstellung **Verwendet für**, immer die letzte Spalte. Werte: `opex`, `capex` oder leer für **OPEX und CAPEX**. Eine Datei ohne diese Spalte lässt die Einstellungen unverändert. Eine leere Zelle setzt **OPEX und CAPEX**. Jeder andere Wert wird für diese Zeile abgelehnt
  - Konsolidierungsspalten: Existiert `consolidation_account_number` in Ihrem Konsolidierungskontenplan, ersetzen dessen Name und Beschreibung die Zellen `consolidation_account_name` und `consolidation_account_description`. Eine leere Nummer löscht alle drei. Siehe [Konsolidierungszuordnungen einrichten](#konsolidierungszuordnungen-einrichten)

## Tipps

  - **Mit Vorlagen beginnen**: KANAP wird mit Vorlagen für 9 Länder plus IFRS ausgeliefert. Laden Sie eine, anstatt von Grund auf zu bauen -- Sie erhalten korrekte Kontonummern, lokale Namen und IFRS-Konsolidierungszuordnungen direkt. Beginnen Sie mit v1.0 (Einfach), wenn Sie unsicher sind; upgraden Sie auf v2.0 (Detailliert), wenn Sie mehr Granularität benötigen.
  - **Ein Standard pro Land**: Machen Sie für jedes Land einen Kontenplan zum Standard, damit neue Unternehmen mit der richtigen Kontenstruktur starten.
  - **Lokale Namen für Compliance**: Verwenden Sie das Feld **Lokaler Name (Landessprache)**, wenn lokale Vorschriften Konten in der Landessprache erfordern. Aktivieren Sie die Spalte **Lokaler Name** im Grid, um beide Namen auf einen Blick zu sehen.
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
  2. Machen Sie jeden zum Standard seines Landes (**Kontenpläne verwalten**, dann **Als Länderstandard festlegen**)
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

  3. Machen Sie jeden Kontenplan zum Standard seines Landes und weisen Sie die Unternehmen zu

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
A: Öffnen Sie **Kontenpläne verwalten** auf der Kontenpläne-Seite und lesen Sie die Spalte **Gesellschaften** in der Zeile des Kontenplans. Sie können auch die Unternehmensseite nach Kontenplan filtern.

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

**F: Muss der Konsolidierungskontenplan der Standard für andere Länder sein?**
A: Nein. Die beiden Rollen sind unabhängig. In der üblichen Einrichtung hat ein IFRS-Kontenplan beide, und Sie können sie jederzeit in **Kontenpläne verwalten** verschiedenen Kontenplänen geben.

**F: Was passiert mit den Konten, wenn ich ein Konto des Konsolidierungskontenplans umbenenne oder neu nummeriere?**
A: Alle darauf abgebildeten Konten folgen. Ihre Konsolidierungsnummer, ihr Name und ihre Beschreibung werden gemeinsam aktualisiert, die Zuordnungen bleiben also gültig.

**F: Warum zeigt das Grid neben manchen Konsolidierungsnummern einen Punkt?**
A: Der Punkt markiert ein Konto, dessen Konsolidierungsnummer im Konsolidierungskontenplan nicht existiert, typischerweise nach einem Wechsel des Konsolidierungskontenplans. Öffnen Sie das Konto und wählen Sie ein gültiges Konsolidierungskonto, oder listen Sie alle über die Konsolidierungszeile auf.
