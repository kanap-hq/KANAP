# Administrationszonen

Die Seite Administrationszonen zeigt, wer was verwaltet. Sie folgt dem Tier-Modell der Administration, einer anerkannten Praxis für die Verwaltung von Verzeichnisdiensten wie Active Directory: Ihre Administrationszonen, die Assets jeder Zone, die zu korrigierenden Punkte, dann Ihre Verzeichnisdienste und Domänen. Sie hilft, die Fragen einer NIS2-Prüfung zum privilegierten Zugriff zu beantworten.

Öffnen Sie sie über **IT-Landschaft > Administrationszonen**, in der Gruppe **Infrastruktur**. Zum Lesen benötigen Sie `infrastructure:reader`, zum Zuordnen von Zonen `infrastructure:member`.

## Bevor Sie beginnen

Die Seite liest, was Sie an anderer Stelle erfassen:

1. Legen Sie Ihre Administrationszonen an und ergänzen Sie Ihre Domänen in **IT-Landschaft > Einstellungen**. Bringen Sie die Zonen in eine Reihenfolge: Die erste ist die sensibelste. Siehe [Administrationszonen](it-ops-settings.md#administrationszonen) und [Domänen](it-ops-settings.md#domanen).
2. Ordnen Sie jedes Asset seiner Zone zu, hier in einem Schritt für viele Assets (siehe [Eine Zone zuordnen](#eine-zone-zuordnen)) oder mit dem Feld **Administrationszone** der Eigenschaftsleiste des Assets. Siehe [Assets](assets.md#eigenschaftsleiste-rechtes-panel).
3. Verknüpfen Sie die Verzeichnistechnologien, etwa Active Directory, mit den Servern, die sie tragen. Siehe [Eine Technologie mit einem Server verknüpfen](technologies.md#eine-technologie-mit-einem-server-verknupfen).
4. Ein Verzeichnisdienst, der auf keinem Ihrer Server läuft, etwa Entra ID, erhält seine Zone aus dem Feld **Administrationszone** seines Eigenschaftenfelds. Siehe [Technologien](technologies.md#eigenschaftenfeld).

## Warum die Zonen zählen

Im Tier-Modell der Administration gehört alles, was auf ein Element einer sensiblen Zone einwirken kann, zu dieser Zone: Der Hypervisor, auf dem ein Domänencontroller läuft, kann ihn übernehmen und ist daher ebenfalls Tier 0. Die Kontrollpunkte finden die Assets, die gegen diese Regel verstoßen.

## Reiter

Die Seite hat zwei Reiter, jeder mit seiner Anzahl:

- **Assets**: die Zonen, die Kontrollpunkte und die Tabelle der Assets. Die Anzahl ist die der Assets, die nicht ausgemustert sind.
- **Verzeichnisse und Domänen**: Ihre Verzeichnisdienste, dann Ihre Domänen nach Gesamtstruktur gruppiert. Die Anzahl zählt die Verzeichnisdienste und die Domänen zusammen.

Die Seite öffnet sich auf **Assets**. Die Adresse der Seite behält den offenen Reiter und die Filter der Tabelle, sodass ein Link dieselbe Ansicht öffnet. **Assets exportieren** und **Domänen exportieren** bleiben auf beiden Reitern oben auf der Seite. **Einer Zone zuordnen** erscheint auf dem Reiter **Assets**.

## Zonen

Das Band oben listet die Zonen in der Reihenfolge der Einstellungen, die sensibelste zuerst, danach eine Zeile **Keine Zone**. Jede Zeile zeigt:

- Den Namen der Zone, mit ihrer Beschreibung darunter.
- Ihre **Administratorgruppe**.
- Die Anzahl ihrer Assets jedes Typs, die Anzahl der auf diesen Assets gehosteten Anwendungen und die Anzahl der Verzeichnisdienste in der Zone. Fahren Sie mit der Maus über die Verzeichnisdienste, um ihre Namen zu lesen. Nur Anwendungen und Instanzen in Betrieb zählen.

Klicken Sie auf eine Zeile, um in der Tabelle darunter nur ihre Assets anzuzeigen. Ein erneuter Klick zeigt wieder alle Assets. Die Zeile **Keine Zone** nennt die Anzahl der Assets, die noch keine Zone haben.

Ausgemusterte Assets und Technologien werden ausgelassen. Eine in den Einstellungen als **Nicht mehr anbieten** markierte Zone bleibt sichtbar, solange ihr Assets oder Verzeichnisdienste zugeordnet sind. Eine aus den Einstellungen entfernte Zone, die Assets oder Verzeichnisdienste noch nennen, erscheint nach den anderen als **Unbekannte Zone**, mit ihrem Code.

Gibt es noch keine Zone, sagt die Seite das und verweist, wenn Sie die Einstellungen lesen dürfen, auf sie.

## Kontrollpunkte

Unter dem Band nennt eine Schaltfläche pro Kontrollpunkt seinen Kurznamen und seine Anzahl an Assets. Fahren Sie mit der Maus darüber, um den vollen Titel und das Vorgehen zu lesen. Ein Klick zeigt in der Tabelle nur die betroffenen Assets, ein weiterer wieder alle.

Die sensibelste Zone ist die erste Zone der Einstellungen, die nicht als **Nicht mehr anbieten** markiert ist.

| Kontrollpunkt | Gelistete Assets |
|---|---|
| **Ohne Zone** | Die Assets ohne Zone |
| **Domänencontroller außerhalb** | Die Assets, die einer Anwendung in Betrieb mit der Serverrolle **Domänencontroller** zugeordnet sind, wenn ihre Zone nicht die sensibelste ist |
| **Verzeichnisdienst außerhalb** | Die Assets, auf denen eine Verzeichnistechnologie wie Active Directory installiert ist, wenn ihre Zone nicht die sensibelste ist |
| **Weniger sensibler Host** | Die höher einzustufenden Assets: ein Host, der ein Asset einer sensibleren Zone betreibt (zum Beispiel ein Tier-1-Host mit einer virtuellen Tier-0-Maschine), oder das Mitglied eines Clusters einer sensibleren Zone (zum Beispiel ein Tier-1-ESX-Host in einem Tier-0-Cluster) |
| **Gehostete Anwendung** | Die Assets der sensibelsten Zone, die eine Anwendung in Betrieb hosten. Prüfen Sie, ob jede Anwendung dorthin gehört |

Für **Weniger sensibler Host** liest KANAP die Beziehungen **Enthält** der Assets und die Mitglieder der Cluster. Was ein Asset betreibt, muss in einer mindestens ebenso sensiblen Zone liegen. Eine Zone, die mit **Nicht mehr anbieten** markiert ist oder in den Einstellungen fehlt, wird ignoriert. Ein Asset ohne Zone unterbricht die Prüfung der Kette: KANAP vergleicht weder dieses Asset noch die mit ihm verbundenen Assets, und **Ohne Zone** listet es.

Ohne Zone in den Einstellungen erscheint nur **Ohne Zone**, und die Seite fordert Sie auf, eine Zone hinzuzufügen.

## Assets

Die Tabelle listet alle Assets, die nicht ausgemustert sind, und lädt beim Scrollen weitere nach. Klicken Sie auf eine Zeile, um das Asset zu öffnen.

| Spalte | Inhalt |
|---|---|
| **Ref.**, **Name**, **Typ** | Das Asset |
| **Zone** | Seine Administrationszone, oder **Keine Zone** |
| **Technologien** | Die auf dem Asset installierten Technologien. Die ersten zwei Namen werden angezeigt, dann die Anzahl der übrigen; fahren Sie mit der Maus über die Zelle für die vollständige Liste |
| **Anwendungen** | Die auf dem Asset gehosteten Anwendungen in Betrieb, ebenso angezeigt. Klicken Sie auf einen Namen, um die Anwendung zu öffnen |
| **Kontrollen** | Die Kontrollpunkte, die das Asset betreffen. Fahren Sie mit der Maus über **Weniger sensibler Host**, um den Grund zu sehen: **Betreibt** nennt das sensiblere Asset, das es betreibt, **Mitglied des Clusters** den sensibleren Cluster, jeweils mit Referenz und Name und mit seiner Zone |

Suchen Sie nach Name oder Referenz. Filtern Sie nach **Typ**, **Zone** (auch **Keine Zone**) und **Kontrollen**, und sortieren Sie nach **Ref.**, **Name**, **Typ** oder **Zone**. Die Sortierung nach Zone folgt der Reihenfolge der Einstellungen, die Assets ohne Zone stehen am Ende. Das Band und die Schaltflächen der Kontrollpunkte setzen dieselben Filter wie die Spalten **Zone** und **Kontrollen**.

## Eine Zone zuordnen

Mit `infrastructure:member` beginnt jede Zeile mit einem Kontrollkästchen:

- Markieren Sie Zeilen, um sie einzeln auszuwählen.
- Markieren Sie das Kästchen in der Kopfzeile, um alle Assets des aktuellen Filters auszuwählen, auch die noch nicht geladenen. Danach können Sie einzelne Zeilen wieder abwählen, um sie auszunehmen.

Eine Änderung der Suche oder der Filter hebt die Auswahl auf. **Einer Zone zuordnen** öffnet einen Dialog, in dem Sie eine Zone wählen, oder **Keine Zone**, um sie zu entfernen. Eine als **Nicht mehr anbieten** markierte Zone ist nicht wählbar. Vor Ihrer Bestätigung zählt der Dialog, bei wie vielen der ausgewählten Assets sich die Zone ändert. Eine Zuordnung umfasst bis zu 5.000 Assets: Grenzen Sie darüber hinaus die Filter ein.

Kommen zwischen der Zählung und der Bestätigung Assets in den Filter hinzu, lehnt KANAP die Änderung ab und zählt erneut: Prüfen Sie die neue Anzahl und bestätigen Sie dann. Jedes geänderte Asset erhält einen Eintrag im Audit-Protokoll, wie bei einer Bearbeitung des Assets.

## Verzeichnisdienste und Domänen

**Verzeichnisdienste** listet die Technologien der Familie **Verzeichnis und Identität**, mit ihrer Zone und ihrer Anzahl an Servern (die nicht ausgemusterten Server, die die Technologie direkt tragen). Klicken Sie auf eine Zeile, um die Technologie zu öffnen.

**Domänen** listet Ihre Domänen, außer den integrierten Einträgen **Workgroup** und **N/A**, gruppiert nach Gesamtstruktur. Domänen, deren Gesamtstruktur mit anderer Groß- und Kleinschreibung geschrieben ist, teilen sich eine Gruppe. Die Domänen ohne Gesamtstruktur kommen zuletzt, unter **Keine Gesamtstruktur**. Jede Domäne zeigt:

| Spalte | Inhalt |
|---|---|
| **Domäne** | Der Name der Domäne. Eine nicht mehr angebotene Domäne ist als solche markiert |
| **DNS-Suffix** | Das Suffix der Namen ihrer Computer |
| **Vertrauensstellungen** | Die Domänen, mit denen sie eine Vertrauensstellung hat, und die Richtung jeder einzelnen |
| **Konten**, **Computer** | Die in den Einstellungen erfassten Anzahlen. Ein Strich bedeutet, dass keine erfasst ist |
| **Domänencontroller** | Wie viele Server KANAP als Controller der Domäne ableitet, dann ihre Namen |

**Vertrauensstellungen** listet außerdem, in Grau, die Vertrauensstellungen, die bei einer anderen Domäne gegenüber dieser deklariert sind, mit der Richtung aus Sicht dieser Domäne: Eine ausgehende Vertrauensstellung von A zu B erscheint bei B als eingehend. Die Richtungen bedeuten:

- **Ausgehend**: Diese Domäne vertraut der anderen. Die Konten der anderen Domäne können auf die Ressourcen dieser Domäne zugreifen.
- **Eingehend**: Die andere Domäne vertraut dieser.
- **Bidirektional**: beides.

**Domänencontroller** werden nicht von Hand erfasst. KANAP nimmt die Server der Domäne (das Feld **Domäne** im Reiter Netzwerk des Assets), die nicht ausgemustert sind und die entweder:

- eine nicht ausgemusterte Technologie der Familie **Verzeichnis und Identität** tragen, etwa Active Directory, oder
- einer Anwendung in Betrieb mit der Serverrolle **Domänencontroller** zugeordnet sind.

Jeder Server erscheint einmal. „Keiner gefunden“ bedeutet, dass kein Server der Domäne eine der beiden Regeln erfüllt.

## Export

**Assets exportieren** lädt die Assets der Tabelle als CSV-Datei herunter, mit ihrer Suche, ihren Filtern und ihrer Sortierung. Die Spalten sind **Zone**, **Reference**, **Name**, **Type**, **Technologies**, **Applications**, **Controls** und **Dependency**. **Dependency** nennt für **Weniger sensibler Host** jedes sensiblere Asset, das das Asset betreibt, oder jeden Cluster, dem es angehört, mit seiner Zone. Ein Export umfasst bis zu 10.000 Assets: Grenzen Sie darüber hinaus die Filter ein.

**Domänen exportieren** lädt jede Domäne mit DNS-Suffix, Gesamtstruktur, Vertrauensstellungen (ihren eigenen und den von anderen Domänen deklarierten), Anzahl der Konten und Computer sowie Domänencontrollern herunter.

## Tipps

- **Mit Tier 0 beginnen**: Ordnen Sie zuerst den Verzeichnisdienst, seine Controller, die Hypervisoren, auf denen sie laufen, und die Werkzeuge zu, die sie verwalten. Sie sind am stärksten exponiert.
- **Von einem Kontrollpunkt ausgehen**: Klicken Sie auf **Ohne Zone**, markieren Sie das Kästchen der Kopfzeile und ordnen Sie die Zone in einem Schritt zu, dann verfeinern Sie Zeile für Zeile.
- **Die Administratoren benennen**: Die **Administratorgruppe** einer Zone beantwortet die erste Frage eines Audits: Wer hält die Administratorrechte?
- **Die Controller prüfen**: Eine Domäne ohne Controller, oder mit einem unerwarteten, deutet meist auf einen Server hin, dem die Domäne, die Rolle oder die Technologien fehlen.
