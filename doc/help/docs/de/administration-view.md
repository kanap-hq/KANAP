# Administrationssicht

Die Administrationssicht zeigt, wer was verwaltet. Sie listet Ihre Administrationszonen mit den Assets, die sie abdecken, dann Ihre Domänen mit Gesamtstruktur, Vertrauensstellungen und Domänencontrollern, dann die zu korrigierenden Punkte. Sie folgt der Administrationssicht des Leitfadens der ANSSI zur Kartierung des Informationssystems und hilft, die Fragen einer NIS2-Prüfung zum privilegierten Zugriff zu beantworten.

Öffnen Sie sie über **IT-Landschaft > Administrationssicht**, in der Gruppe **Infrastruktur**. Sie benötigen `infrastructure:reader`.

## Bevor Sie beginnen

Die Sicht liest, was Sie an anderer Stelle erfassen:

1. Legen Sie Ihre Administrationszonen an und ergänzen Sie Ihre Domänen in **IT-Landschaft > Einstellungen**. Bringen Sie die Zonen in eine Reihenfolge: Die erste ist die sensibelste. Siehe [Administrationszonen](it-ops-settings.md#administrationszonen) und [Domänen](it-ops-settings.md#domanen).
2. Ordnen Sie jedes Asset mit dem Feld **Administrationszone** seiner Eigenschaftsleiste seiner Zone zu. Siehe [Assets](assets.md#eigenschaftsleiste-rechtes-panel).
3. Verknüpfen Sie die Verzeichnistechnologien, etwa Active Directory, mit den Servern, die sie tragen. Siehe [Eine Technologie mit einem Server verknüpfen](technologies.md#eine-technologie-mit-einem-server-verknupfen).
4. Ein Verzeichnisdienst, der auf keinem Ihrer Server läuft, etwa Entra ID, erhält seine Zone über das Feld **Administrationszone** seines Eigenschaftenfelds. Siehe [Technologien](technologies.md#eigenschaftenfeld).

## Warum die Zonen zählen

Im Tier-Modell der ANSSI gehört alles, was auf ein Element einer sensiblen Zone einwirken kann, zu dieser Zone. Der Hypervisor, auf dem ein Domänencontroller läuft, kann diesen übernehmen und gehört daher ebenfalls zu Tier 0. Die Kontrollpunkte unten auf der Seite finden die Assets, die gegen diese Regel verstoßen.

## Administrationszonen

Ein Block pro Zone, in der Reihenfolge der Einstellungen, mit der Anzahl ihrer Assets. Jeder Block zeigt:

- Die **Administratorgruppe** der Zone und ihre Beschreibung.
- Ihren Umfang: die Anzahl der Assets jedes Typs und die Anzahl der Anwendungen, die auf diesen Assets gehostet werden. Nur Anwendungen und Instanzen in Betrieb zählen.
- Eine Tabelle ihrer Assets: **Ref.**, **Name** und **Typ**. Klicken Sie auf eine Zeile, um das Asset zu öffnen.
- **Verzeichnisdienste**: die Technologien der Familie **Verzeichnis und Identität**, die der Zone zugeordnet sind. Klicken Sie auf eine Zeile, um die Technologie zu öffnen.

Außer Betrieb genommene Assets und Technologien bleiben außen vor. Eine in den Einstellungen als **Nicht mehr anbieten** markierte Zone erscheint weiterhin, solange ihr Assets oder Verzeichnisdienste zugeordnet sind. Eine aus den Einstellungen entfernte Zone, die Assets oder Verzeichnisdienste noch nennen, erscheint nach den anderen als **Unbekannte Zone** mit ihrem Code.

Gibt es noch keine Zone, sagt die Seite das und verweist, wenn Sie die Einstellungen lesen dürfen, auf sie.

## Domänen

Eine Zeile pro Domäne, außer den integrierten Einträgen **Workgroup** und **N/A**:

| Spalte | Was sie zeigt |
|---|---|
| **Domäne** | Der Name der Domäne. Eine nicht mehr angebotene Domäne ist als solche markiert |
| **DNS-Suffix** | Das Suffix der Namen ihrer Computer |
| **Gesamtstruktur** | Die Active Directory-Gesamtstruktur, zu der sie gehört |
| **Vertrauensstellungen** | Die Domänen, mit denen sie eine Vertrauensstellung hat, und die Richtung jeder einzelnen |
| **Konten**, **Computer** | Die in den Einstellungen erfassten Anzahlen |
| **Domänencontroller** | Die als Controller der Domäne abgeleiteten Server |

**Vertrauensstellungen** listet außerdem, nur lesend, die in einer anderen Domäne zu dieser erfassten Vertrauensstellungen, mit der Richtung aus Sicht dieser Domäne: Eine ausgehende Vertrauensstellung von A zu B liest sich bei B als eingehend. Die Richtungen bedeuten:

- **Ausgehend**: Diese Domäne vertraut der anderen. Die Konten der anderen Domäne können auf die Ressourcen dieser Domäne zugreifen.
- **Eingehend**: Die andere Domäne vertraut dieser.
- **Bidirektional**: beides.

**Domänencontroller** werden nicht von Hand erfasst. KANAP nimmt die Server der Domäne (das Feld **Domäne** im Reiter Technisch des Assets), die nicht außer Betrieb sind und die entweder:

- eine nicht außer Betrieb genommene Technologie der Familie **Verzeichnis und Identität** tragen, etwa Active Directory, oder
- einer Anwendung in Betrieb mit der Serverrolle **Domänencontroller** zugeordnet sind.

Jeder Server erscheint einmal. „Keiner gefunden“ bedeutet, dass kein Server der Domäne eine der beiden Regeln erfüllt.

## Kontrollpunkte

Die Kontrollpunkte listen, was zu korrigieren ist. Die erste Zone der Einstellungen, die nicht als **Nicht mehr anbieten** markiert ist, ist die sensibelste Zone, und die Seite nennt sie. Jeder Kontrollpunkt zeigt seine Anzahl und eine Tabelle. Klicken Sie auf eine Zeile, um den zu korrigierenden Datensatz zu öffnen.

| Kontrollpunkt | Was er listet |
|---|---|
| **Assets ohne Administrationszone** | Die Assets, die nicht außer Betrieb sind und keine Zone haben |
| **Domänencontroller außerhalb der sensibelsten Zone** | Die Assets, die einer Anwendung in Betrieb mit der Serverrolle **Domänencontroller** zugeordnet sind, wenn ihre Zone eine andere ist |
| **Assets mit einem Verzeichnisdienst außerhalb der sensibelsten Zone** | Die Assets, auf denen eine Verzeichnistechnologie installiert ist, etwa Active Directory, wenn ihre Zone eine andere ist |
| **Assets in einer sensibleren Zone als das, was sie enthält** | Ein Asset in einer sensibleren Zone als das Asset, das es enthält (zum Beispiel eine virtuelle Maschine und ihr Host), oder ein Cluster-Mitglied in einer sensibleren Zone als sein Cluster. Die Zeile öffnet das enthaltende Asset oder den Cluster: Ordnen Sie es einer mindestens ebenso sensiblen Zone zu |
| **In der sensibelsten Zone gehostete Anwendungen** | Jede Anwendung, die auf einem Asset dieser Zone gehostet wird, mit dem Asset. Prüfen Sie, ob sie dorthin gehört |

Für diese Vertrauensprüfung liest KANAP die Beziehungen **Enthält** der Assets und die Mitglieder der Cluster. Ein Paar, bei dem eines der beiden Assets keine Zone hat, bleibt außen vor: Der erste Kontrollpunkt meldet es bereits.

Ohne Zone in den Einstellungen läuft nur der erste Kontrollpunkt, und die Seite bittet Sie, eine Zone hinzuzufügen.

## Export

**Zonen exportieren** und **Domänen exportieren** laden jede Liste als CSV-Datei herunter.

Die Datei der Zonen hat eine Spalte **Record**, die angibt, was jede Zeile ist:

- **zone**: eine Zeile pro Zone, mit Administratorgruppe, Beschreibung, Anzahl der gehosteten Anwendungen und, in **Note**, der Anzahl ihrer Assets jedes Typs.
- **asset** und **directory**: die Assets und die Verzeichnisdienste der in **Zone** genannten Zone.
- **control**: eine Zeile pro Befund der Kontrollpunkte, mit dem Titel des Kontrollpunkts in **Zone**. **Note** nennt die Zone des Assets, das enthaltene Asset bei der Vertrauensprüfung oder das hostende Asset bei einer Anwendung. Ein Kontrollpunkt ohne Befund hat keine Zeile.

## Tipps

- **Mit Tier 0 beginnen**: Ordnen Sie zuerst den Verzeichnisdienst, seine Controller, die Hypervisoren, auf denen sie laufen, und die Werkzeuge zu, die sie verwalten. Sie sind am stärksten exponiert.
- **Die Administratoren benennen**: Die **Administratorgruppe** einer Zone beantwortet die erste Frage eines Audits: Wer hält die Administratorrechte?
- **Die Controller prüfen**: Eine Domäne ohne Controller, oder mit einem unerwarteten, deutet meist auf einen Server hin, dem die Domäne, die Rolle oder die Technologien fehlen.
