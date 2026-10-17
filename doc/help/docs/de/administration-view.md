# Administrationssicht

Die Administrationssicht zeigt, wer was verwaltet. Sie listet Ihre Administrationszonen mit ihren Technologien und Servern, dann Ihre Domänen mit Gesamtstruktur, Vertrauensstellungen und Domänencontrollern. Sie folgt der Administrationssicht des Leitfadens der ANSSI zur Kartierung des Informationssystems und hilft, die Fragen einer NIS2-Prüfung zum privilegierten Zugriff zu beantworten.

Öffnen Sie sie über **IT-Landschaft > Administrationssicht**, in der Gruppe **Infrastruktur**. Sie benötigen `infrastructure:reader`.

## Bevor Sie beginnen

Die Sicht liest, was Sie an anderer Stelle erfassen:

1. Legen Sie Ihre Administrationszonen an und ergänzen Sie Ihre Domänen in **IT-Landschaft > Einstellungen**. Siehe [Administrationszonen](it-ops-settings.md#administrationszonen) und [Domänen](it-ops-settings.md#domanen).
2. Ordnen Sie jede Technologie mit dem Feld **Administrationszone** ihres Eigenschaftenfelds ihrer Zone zu. Siehe [Technologien](technologies.md#eigenschaftenfeld).
3. Verknüpfen Sie die Technologien mit den Servern, die sie tragen. Siehe [Eine Technologie mit einem Server verknüpfen](technologies.md#eine-technologie-mit-einem-server-verknupfen).

## Administrationszonen

Ein Block pro Zone, nach Name. Jeder Block zeigt:

- **Administratorgruppe**, **Berechtigungsstufe** und **Geheimnisse** (wo ihre Geheimnisse aufbewahrt werden) der Zone.
- **Verzeichnisdienste**: die Technologien der Familie **Verzeichnis und Identität**, die der Zone zugeordnet sind.
- Eine Tabelle ihrer Technologien: **Ref.**, **Technologie**, **Familie** und **Server**. Die Server sind die, die die Technologie tragen, direkt oder über den Server, in dem sie laufen („über“ diesen Server).

Die Technologien ohne Zone kommen zuletzt, unter **Keine Zone**. Ein Hinweis oben auf der Seite zählt sie: Öffnen Sie jede und legen Sie ihre Zone fest.

Außer Betrieb genommene Technologien und Server bleiben außen vor. Eine in den Einstellungen als **Nicht mehr anbieten** markierte Zone erscheint weiterhin, solange ihr Technologien zugeordnet sind. Eine aus den Einstellungen entfernte Zone, die Technologien noch nennen, erscheint als **Unbekannte Zone** mit ihrem Code.

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

## Export

**Zonen exportieren** und **Domänen exportieren** laden jede Liste als CSV-Datei herunter.

## Tipps

- **Mit Tier 0 beginnen**: Ordnen Sie zuerst den Verzeichnisdienst, seine Controller und die Werkzeuge zu, die sie verwalten. Sie sind am stärksten exponiert.
- **Die Geheimnisse benennen**: Der **Ablageort der Geheimnisse** einer Zone beantwortet die erste Frage eines Audits: Wo werden die Administratorpasswörter aufbewahrt?
- **Die Controller prüfen**: Eine Domäne ohne Controller, oder mit einem unerwarteten, deutet meist auf einen Server hin, dem die Domäne oder die Technologien fehlen.
