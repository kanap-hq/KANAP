# Integrationen

Verwenden Sie die Integrationsseite, um KANAP mit Drittanbieter-Tools zu verbinden, die die in der Plattform bereits verwalteten Daten ergänzen. Die wichtigste Verbindung ist Ihr **GLPI**-Service-Desk. Diese eine Verbindung erfüllt zwei Zwecke gleichzeitig: Sie ermöglicht **Plaid** (dem interaktiven Chat), Tickets zu finden und als Aufgaben in KANAP zu importieren, und sie versorgt die **KI-Agenten**, die Ihren Service-Desk überwachen und Ticketarbeit vorschlagen oder ausführen. Die Seite beherbergt außerdem die Verbindung **Netbox-Inventar**, die nichts mit KI zu tun hat. Weitere Integrationen werden hier im Laufe der Zeit hinzugefügt.

## Wo Sie es finden

- Arbeitsbereich: **Administration**
- Pfad: **Administration → Integrationen**
- Route: `/admin/integrations`
- Berechtigung: `ai_settings:admin` oder `infrastructure:admin`. Jede Karte hat ihre eigene Anforderung: Die GLPI- und die Monitoring-Verbindung benötigen `ai_settings:admin`, die Netbox-Verbindung benötigt `infrastructure:admin`. Sie sehen nur die Karten, die Sie konfigurieren dürfen.
- Feature-Flag: Die GLPI- und die Monitoring-Karte teilen sich dieselbe `ai_settings`-Oberfläche wie die Plaid-Einstellungsseite. Ist diese Oberfläche deaktiviert, werden sie ausgeblendet. Die Netbox-Karte hat kein Feature-Flag und ist sowohl in der Cloud als auch in der On-Premise-Edition verfügbar.

Die Anmeldedaten, die Sie hier eingeben, verwenden sowohl Plaid als auch jeder KI-Agent, um GLPI zu erreichen. Sie konfigurieren die Verbindung einmal, an einem Ort.

---

## GLPI-Integration

[GLPI](https://glpi-project.org/) ist ein beliebtes Open-Source-IT-Service-Management-Tool. Diese Seite speichert die Anmeldedaten, die KANAP verwendet, um Ihre GLPI-Instanz zu erreichen. Was KANAP mit dieser Verbindung tut, hängt davon ab, welche Funktion Sie darauf ausrichten.

### Wie es funktioniert

Die Verbindung versorgt zwei Workflows, die Sie separat aktivieren und steuern.

**1. Plaid-Chat-Import (Vorschau und Genehmigung).** Ein Endbenutzer fragt Plaid etwa: „Importiere die offenen GLPI-Tickets, die meinem Team zugewiesen sind“. Plaid fragt GLPI über die hier konfigurierten Anmeldedaten ab, gibt die Kandidaten-Tickets als Vorschau im Chat zurück und erstellt erst dann eine Aufgabe pro Ticket, wenn der Benutzer die Vorschau überprüft und auf **Genehmigen** klickt. Ohne diese ausdrückliche Genehmigung wird nichts in KANAP geschrieben, sodass Administratoren dies an Endbenutzer übergeben können, ohne sich um stille Datenänderungen sorgen zu müssen.

**2. KI-Agenten, die den Service-Desk überwachen.** Sobald GLPI hier verbunden ist, kann ein Administrator einen **Helpdesk**-Agenten darauf ausrichten und ihn auf neue und aktualisierte Tickets überwachen lassen, um dann die Arbeit vorzuschlagen: Antworten an den Anfragenden, interne Notizen sowie Aktualisierungen von Klassifizierung, Status, Zuweisung, Beobachtern und Schließen/Lösen. Das Hinzufügen eines Beobachters lässt den Anfragenden unverändert. Jede Änderung des Agenten wird weiterhin zur Freigabe vorgeschlagen, bevor sie an GLPI gesendet wird, und strikte Sicherheitslimits, Budgets und Aktualitätsprüfungen gelten stets. Diese Seite konfiguriert kein Agentenverhalten; sie stellt lediglich die Verbindung bereit, die die Agenten nutzen.

### Von KI-Agenten genutzt

Nachdem Sie hier eine funktionierende Verbindung gespeichert haben, richtet ein Administrator die Agenten im Bereich KI-Agenten ein. Siehe [KI-Agenten: Übersicht](agents-overview.md). Über **Neuer Agent** oder die **Einstellungen** eines bestehenden Agenten wählt er diese GLPI-Verbindung als den Service-Desk aus, den der Agent überwacht. Der Agent liest daraus und erstellt Entwürfe, sendet aber standardmäßig niemals von sich aus etwas: Jede vorgeschlagene Antwort, Notiz oder Statusänderung landet zunächst in der Freigabe-Warteschlange.

### Voraussetzungen

- **Plaid-Chat muss aktiviert sein** auf Ihrem Mandanten für den Chat-Import-Workflow. Die Seite zeigt einen Info-Tooltip neben dem Abschnittstitel an, um Sie an diese Abhängigkeit zu erinnern.
- **KI-Agenten müssen aktiviert sein** auf der Instanz für den Agenten-Workflow, und der Agent muss von jemandem mit der Administratorebene für KI-Agenten (`ai_agents:admin`) konfiguriert werden.
- Eine GLPI-Instanz, die von KANAP über HTTPS erreichbar ist.
- Ein **Benutzer-Token** für ein GLPI-Benutzerkonto, das Lesezugriff auf die Tickets hat, die Sie offenlegen möchten.
- Ein optionales **App-Token**, falls Ihre GLPI-Instanz eine Authentifizierung auf Anwendungsebene erfordert.
- **Profilrechte für die Agentenfunktionen**: das GLPI-Profil dieses Kontos benötigt Lesezugriff auf ITIL-Kategorien und Entitäten, die Agenten für ihre Zielfilter und für die Klassifizierung verwenden, sowie Lesezugriff auf Gruppen und Benutzer, damit ein Agent ein Ticket an eine Technikergruppe oder an einen namentlich genannten Techniker weiterleiten kann. Die Weiterleitung erfordert zusätzlich das Recht, Tickets zuzuweisen. Erteilen Sie schließlich Aktualisierungsrechte auf Tickets für die Aktionen, die Sie den Agenten ausführen lassen: Folgeeinträge, Klassifizierung, Status und Zuweisung.

Die Integration wird mandantenweise konfiguriert; die unten stehenden Anmeldedaten sind auf Ihren Mandanten beschränkt und verlassen ihn niemals.

### Felder

Das Konfigurationsformular enthält:

- **GLPI-Ticketimport aktivieren**: Hauptschalter für die Verbindung. Wenn deaktiviert, wird KANAP nicht versuchen, GLPI abzufragen, selbst wenn Anmeldedaten festgelegt sind. Weder Plaid-Importe noch Agentenprüfungen erreichen Ihren Service-Desk.
- **GLPI-URL**: die Basis-URL Ihrer GLPI-Instanz, zum Beispiel `https://glpi.example.com`.
- **Benutzer-Token**: das persönliche API-Token des GLPI-Kontos, das KANAP verwenden wird. Vorhandene Token sind maskiert; lassen Sie das Feld bei einem Speicher- oder Testvorgang leer, um den gespeicherten Wert beizubehalten.
- **App-Token**: das optionale GLPI-Anwendungstoken. Gleiches „leer-lassen-um-beizubehalten“-Verhalten wie beim Benutzer-Token.

### Aktionen

- **Einstellungen speichern**: speichert das Formular. Im Formular eingegebene Token ersetzen die gespeicherten; leere Tokenfelder behalten das bereits Gespeicherte bei.
- **Verbindung testen**: führt einen authentifizierten Round-Trip gegen die GLPI-URL unter Verwendung der Werte im Formular durch (oder, wo leer, der gespeicherten Werte). Das Ergebnisbanner zeigt Erfolg oder den zugrunde liegenden Fehler zusammen mit der Latenz.

### Geheimnisspeicher

Wenn Ihre KANAP-Instanz keinen konfigurierten Geheimnisspeicher hat, erscheint unter jedem Tokenfeld ein Hilfetext, der Sie warnt, dass die Werte nicht persistiert werden können. Konfigurieren Sie den Geheimnisspeicher auf Instanzebene, bevor Sie sich in der Produktion auf diese Integration verlassen.

---

## Netbox-Inventar

[Netbox](https://netboxlabs.com/docs/netbox/) ist für viele Infrastrukturteams die maßgebliche Quelle: Geräte, virtuelle Maschinen, Racks, Standorte, Adressen. Die Karte **Netbox-Inventar** speichert die Adresse und das API-Token, mit denen KANAP dieses Inventar liest und seine Assets damit im Einklang hält. Netbox bleibt die Referenz für die dort beschriebenen Geräte, KANAP führt die fachliche Ebene darum herum.

Diese Verbindung ist von den KI-Funktionen unabhängig. Sie benötigt `infrastructure:admin`, funktioniert in der Cloud und in der On-Premise-Edition und bleibt verfügbar, wenn KI deaktiviert ist.

Konfigurieren Sie die Verbindung hier und öffnen Sie dann den Tab **Netbox** unter **IT-Landschaft > Einstellungen**, um auszuwählen, was importiert wird, und die Synchronisierung auszuführen. Das vollständige Vorgehen, die Zuordnungsregeln und die Tabelle zur Fehlerbehebung finden Sie unter [Netbox-Synchronisierung](netbox.md).

---

## Tipps

- **Verwenden Sie ein dediziertes GLPI-Konto**: Erstellen Sie ein Servicekonto in GLPI mit gerade genug Berechtigungen, um die Ticketkategorien zu lesen, die Sie offenlegen möchten. Das hält das Audit-Protokoll sauber und ermöglicht es Ihnen, den Zugriff zu widerrufen, ohne einen echten Benutzer zu beeinträchtigen. Wenn Agenten Antworten und Statusänderungen senden sollen, geben Sie demselben Konto den Schreibzugriff, den diese Aktionen benötigen.
- **Vor der Ankündigung testen**: Führen Sie nach jeder Änderung der URL oder der Token **Verbindung testen** aus. Die Fehlermeldung ist weitaus aussagekräftiger als ein Fehler, der in der Chat-Konversation einer Person oder bei einer ins Stocken geratenen Agentenprüfung auftaucht.
- **Mit den richtigen Berechtigungen koppeln**: Nur Benutzer mit `ai_chat:reader` können Plaid bitten, Tickets zu importieren. Um einen Agenten auf diese Verbindung zu richten, ist die KI-Agenten-Rolle erforderlich (`ai_agents:reader`, um einen Agenten zu überwachen, `ai_agents:admin`, um einen zu konfigurieren), sofern KI-Agenten auf der Instanz aktiviert sind. Kombinieren Sie das mit rollenbasiertem Zugriff auf Aufgaben, wenn Sie einschränken möchten, wer tatsächlich Aufgabendatensätze aus den Importen erstellt.
- **Planen Sie die Token-Rotation**: Persönliche GLPI-Token können neu generiert werden. Wenn Sie das tun, speichern Sie hier den neuen Wert und führen Sie den Verbindungstest aus, bevor Benutzer (oder Agenten) die Integration erneut nutzen.
