# Integrationen

Verwenden Sie die Integrationsseite, um Kadratis mit Drittanbieter-Tools zu verbinden, die die in der Plattform bereits verwalteten Daten ergänzen. Die wichtigste Verbindung ist Ihr **GLPI**-Service-Desk. Diese eine Verbindung erfüllt zwei Zwecke gleichzeitig: Sie ermöglicht **Kad** (dem interaktiven Chat), Tickets zu finden und als Aufgaben in Kadratis zu importieren, und sie versorgt die **KI-Agenten**, die Ihren Service-Desk überwachen und Ticketarbeit vorschlagen oder ausführen. Die Seite beherbergt außerdem die Verbindung **Netbox-Inventar**, die nichts mit KI zu tun hat. Weitere Integrationen werden hier im Laufe der Zeit hinzugefügt.

## Wo Sie es finden

- Arbeitsbereich: **Administration**
- Pfad: **Administration → Integrationen**
- Route: `/admin/integrations`
- Berechtigung: `ai_settings:admin` oder `infrastructure:admin`. Jede Karte hat ihre eigene Anforderung: Die GLPI- und die Monitoring-Verbindung benötigen `ai_settings:admin`, die Netbox-Verbindung benötigt `infrastructure:admin`. Sie sehen nur die Karten, die Sie konfigurieren dürfen.
- Feature-Flag: Die GLPI- und die Monitoring-Karte teilen sich dieselbe `ai_settings`-Oberfläche wie die Kad-Einstellungsseite. Ist diese Oberfläche deaktiviert, werden sie ausgeblendet. Die Netbox-Karte hat kein Feature-Flag und ist sowohl in der Cloud als auch in der On-Premise-Edition verfügbar.

Die Anmeldedaten, die Sie hier eingeben, verwenden sowohl Kad als auch jeder KI-Agent, um GLPI zu erreichen. Sie konfigurieren die Verbindung einmal, an einem Ort.

---

## GLPI-Integration

[GLPI](https://glpi-project.org/) ist ein beliebtes Open-Source-IT-Service-Management-Tool. Diese Seite speichert die Anmeldedaten, die Kadratis verwendet, um Ihre GLPI-Instanz zu erreichen. Was Kadratis mit dieser Verbindung tut, hängt davon ab, welche Funktion Sie darauf ausrichten.

### Wie es funktioniert

Die Verbindung versorgt zwei Workflows, die Sie separat aktivieren und steuern.

**1. Kad-Chat-Import (Vorschau und Genehmigung).** Ein Endbenutzer fragt Kad etwa: „Importiere die offenen GLPI-Tickets, die meinem Team zugewiesen sind“. Kad fragt GLPI über die hier konfigurierten Anmeldedaten ab, gibt die Kandidaten-Tickets als Vorschau im Chat zurück und erstellt erst dann eine Aufgabe pro Ticket, wenn der Benutzer die Vorschau überprüft und auf **Genehmigen** klickt. Ohne diese ausdrückliche Genehmigung wird nichts in Kadratis geschrieben, sodass Administratoren dies an Endbenutzer übergeben können, ohne sich um stille Datenänderungen sorgen zu müssen.

**2. KI-Agenten, die den Service-Desk überwachen.** Sobald GLPI hier verbunden ist, kann ein Administrator einen **Helpdesk**-Agenten darauf ausrichten und ihn auf neue und aktualisierte Tickets überwachen lassen, um dann die Arbeit vorzuschlagen: Antworten an den Anfragenden, interne Notizen sowie Aktualisierungen von Klassifizierung, Status, Zuweisung, Beobachtern und Schließen/Lösen. Das Hinzufügen eines Beobachters lässt den Anfragenden unverändert. Jede Änderung des Agenten wird weiterhin zur Freigabe vorgeschlagen, bevor sie an GLPI gesendet wird, und strikte Sicherheitslimits, Budgets und Aktualitätsprüfungen gelten stets. Diese Seite konfiguriert kein Agentenverhalten; sie stellt lediglich die Verbindung bereit, die die Agenten nutzen.

### Von KI-Agenten genutzt

Nachdem Sie hier eine funktionierende Verbindung gespeichert haben, richtet ein Administrator die Agenten im Bereich KI-Agenten ein. Siehe [KI-Agenten: Übersicht](agents-overview.md). Über **Neuer Agent** oder die **Einstellungen** eines bestehenden Agenten wählt er diese GLPI-Verbindung als den Service-Desk aus, den der Agent überwacht. Der Agent liest daraus und erstellt Entwürfe, sendet aber standardmäßig niemals von sich aus etwas: Jede vorgeschlagene Antwort, Notiz oder Statusänderung landet zunächst in der Freigabe-Warteschlange.

### Voraussetzungen

- **Kad-Chat muss aktiviert sein** auf Ihrem Mandanten für den Chat-Import-Workflow. Die Seite zeigt einen Info-Tooltip neben dem Abschnittstitel an, um Sie an diese Abhängigkeit zu erinnern.
- **KI-Agenten müssen aktiviert sein** auf der Instanz für den Agenten-Workflow, und der Agent muss von jemandem mit der Administratorebene für KI-Agenten (`ai_agents:admin`) konfiguriert werden.
- Eine GLPI-Instanz, die von Kadratis über HTTPS erreichbar ist.
- Ein **Benutzer-Token** für ein GLPI-Benutzerkonto, das Lesezugriff auf die Tickets hat, die Sie offenlegen möchten.
- Ein optionales **App-Token**, falls Ihre GLPI-Instanz eine Authentifizierung auf Anwendungsebene erfordert.
- **Profilrechte für die Agentenfunktionen**: das GLPI-Profil dieses Kontos benötigt Lesezugriff auf ITIL-Kategorien und Entitäten, die Agenten für ihre Zielfilter und für die Klassifizierung verwenden, sowie Lesezugriff auf Gruppen und Benutzer, damit ein Agent ein Ticket an eine Technikergruppe oder an einen namentlich genannten Techniker weiterleiten kann. Die Weiterleitung erfordert zusätzlich das Recht, Tickets zuzuweisen. Erteilen Sie schließlich Aktualisierungsrechte auf Tickets für die Aktionen, die Sie den Agenten ausführen lassen: Folgeeinträge, Klassifizierung, Status und Zuweisung.

Die Integration wird mandantenweise konfiguriert; die unten stehenden Anmeldedaten sind auf Ihren Mandanten beschränkt und verlassen ihn niemals.

### Felder

- **GLPI-Ticketimport aktivieren**: Hauptschalter für die Verbindung. Wenn deaktiviert, wird Kadratis nicht versuchen, GLPI abzufragen, selbst wenn Anmeldedaten festgelegt sind. Weder Kad-Importe noch Agentenprüfungen erreichen Ihren Service-Desk.
- **GLPI-URL**: die Adresse, mit der Sie GLPI öffnen, zum Beispiel `https://glpi.example.com`. Die GLPI-API muss eingeschaltet sein: in GLPI unter **Setup > General > API** die Option **Enable Rest API**.
- **Benutzer-Token**: das persönliche API-Token des GLPI-Kontos, das Kadratis verwenden wird. Öffnen Sie in GLPI Ihre Einstellungen (Ihr Name oben rechts), dann **Remote access keys**, und kopieren Sie das **API token**. Ist es leer, aktivieren Sie **Regenerate** und speichern.
- **App-Token**: optional. Öffnen Sie in GLPI unter **Setup > General > API** den API-Client, über den sich Kadratis verbindet, und kopieren Sie sein Anwendungstoken. Lassen Sie das Feld leer, wenn der Client keines hat.

Das Info-Symbol neben jedem Feld sagt, wo Sie seinen Wert finden. Ein gespeichertes Token wird nie wieder angezeigt: Das Feld zeigt Punkte, daneben **Ersetzen**, um ein neues einzugeben. Eine neue URL leert die gespeicherten Token: Die Felder fragen sie erneut ab.

### Aktionen

- **Testen**: führt einen authentifizierten Round-Trip gegen GLPI mit den Werten auf der Karte aus, gespeichert oder nicht. Die Statuszeile oben rechts auf der Karte nennt das Ergebnis: „Letzter Test erfolgreich am …“ mit der Antwortzeit oder den Grund des Fehlschlags.
- **Speichern**: verfügbar, sobald sich etwas geändert hat. Eingegebene Token ersetzen die gespeicherten; ein als Punkte belassenes Token bleibt erhalten.

Die Statuszeile behält den letzten Test der gespeicherten Werte: Er erscheint wieder, wenn Sie zur Seite zurückkehren. Ein Test nicht gespeicherter Werte bleibt sichtbar, bis Sie die Seite verlassen. Ohne Test zeigt die Statuszeile **Gespeichert, noch nicht getestet** oder **Nie getestet**, und **Änderungen nicht gespeichert**, solange die Karte Änderungen enthält. Wenn Sie die Seite mit Änderungen auf einer Karte verlassen, fragt Kadratis zuerst nach einer Bestätigung.

### Geheimnisspeicher

Wenn Ihre Kadratis-Instanz keinen konfigurierten Geheimnisspeicher hat, sagt eine Zeile unter den Feldern, dass die Token nicht gespeichert werden können. Konfigurieren Sie den Geheimnisspeicher auf Instanzebene, bevor Sie sich in der Produktion auf diese Integration verlassen.

---

## Monitoring (PRTG)

[PRTG](https://www.paessler.com/prtg) ist ein Werkzeug zur Überwachung von Netzwerk und Infrastruktur. Die Karte **Monitoring (PRTG)** speichert die Adresse und den API-Schlüssel, mit denen die Monitoring-Agenten Alarme und den Zustand der Sensoren lesen. Wie die GLPI-Karte benötigt sie `ai_settings:admin` und die `ai_settings`-Oberfläche.

### Felder

- **PRTG-Monitoring aktivieren**: Hauptschalter für die Verbindung. Wenn deaktiviert, erreichen Agenten PRTG nicht.
- **Serveradresse**: die Adresse, unter der Sie PRTG im Browser öffnen, zum Beispiel `https://prtg.example.com`.
- **API-Schlüssel**: Legen Sie einen in PRTG unter **Setup → API keys** an. Lesezugriff genügt. Ein gespeicherter Schlüssel erscheint als Punkte, daneben **Ersetzen**. Eine neue Adresse leert den gespeicherten Schlüssel: Das Feld fragt ihn erneut ab.
- **Zeitzone des Servers**: die Zeitzone des PRTG-Core-Servers, wie in seinem Betriebssystem eingestellt. Kadratis liest die Zeiten der Alarme in dieser Zone.
- **Anfrage-Timeout (Sekunden)**: wie lange auf PRTG gewartet wird, zwischen 5 und 120. Für 30 Sekunden leer lassen.

### Aktionen

**Testen** und **Speichern** funktionieren wie auf der GLPI-Karte. Ein erfolgreicher Test zeigt die PRTG-Version und die Zahl der Sensoren, die der Schlüssel sieht. Sobald eine funktionierende Verbindung gespeichert und eingeschaltet ist, bietet die Karte einen Link zur Agents-Seite, auf der sich ein Monitoring-Agent anlegen lässt.

---

## Netbox-Inventar

[Netbox](https://netboxlabs.com/docs/netbox/) ist für viele Infrastrukturteams die maßgebliche Quelle: Geräte, virtuelle Maschinen, Racks, Standorte, Adressen. Die Karte **Netbox-Inventar** speichert die Adresse und das API-Token, mit denen Kadratis dieses Inventar liest und seine Assets damit im Einklang hält. Netbox bleibt die Referenz für die dort beschriebenen Geräte, Kadratis führt die fachliche Ebene darum herum.

Diese Verbindung ist von den KI-Funktionen unabhängig. Sie benötigt `infrastructure:admin`, funktioniert in der Cloud und in der On-Premise-Edition und bleibt verfügbar, wenn KI deaktiviert ist.

Konfigurieren Sie die Verbindung hier und öffnen Sie dann den Tab **Netbox** unter **IT-Landschaft > Einstellungen**, um auszuwählen, was importiert wird, und die Synchronisierung auszuführen. Das vollständige Vorgehen, die Zuordnungsregeln und die Tabelle zur Fehlerbehebung finden Sie unter [Netbox-Synchronisierung](netbox.md).

---

## Eine Verbindung entfernen

Alle drei Karten entfernen eine Verbindung auf dieselbe Weise: Leeren Sie ihre Adresse, speichern Sie und bestätigen Sie. Kadratis löscht die Adresse und die gespeicherten Geheimnisse, schaltet die Verbindung aus und schreibt einen Eintrag ins Audit-Protokoll. Bereits Importiertes wird nicht gelöscht. Agenten, die PRTG lesen, melden es bei ihrem nächsten Lauf als nicht verfügbar.

Das Audit-Protokoll kennzeichnet auch ein ersetztes Geheimnis: Der Eintrag einer Speicherung, die ein Token oder einen Schlüssel bei gleicher Adresse ändert, zeigt **Geheimnis ersetzt**. Das Geheimnis selbst wird nie ins Protokoll geschrieben.

---

## Tipps

- **Verwenden Sie ein dediziertes GLPI-Konto**: Erstellen Sie ein Servicekonto in GLPI mit gerade genug Berechtigungen, um die Ticketkategorien zu lesen, die Sie offenlegen möchten. Das hält das Audit-Protokoll sauber und ermöglicht es Ihnen, den Zugriff zu widerrufen, ohne einen echten Benutzer zu beeinträchtigen. Wenn Agenten Antworten und Statusänderungen senden sollen, geben Sie demselben Konto den Schreibzugriff, den diese Aktionen benötigen.
- **Vor der Ankündigung testen**: Führen Sie nach jeder Änderung der URL oder der Token **Testen** aus. Die Fehlermeldung ist weitaus aussagekräftiger als ein Fehler, der in der Chat-Konversation einer Person oder bei einer ins Stocken geratenen Agentenprüfung auftaucht.
- **Mit den richtigen Berechtigungen koppeln**: Nur Benutzer mit `ai_chat:reader` können Kad bitten, Tickets zu importieren. Um einen Agenten auf diese Verbindung zu richten, ist die KI-Agenten-Rolle erforderlich (`ai_agents:reader`, um einen Agenten zu überwachen, `ai_agents:admin`, um einen zu konfigurieren), sofern KI-Agenten auf der Instanz aktiviert sind. Kombinieren Sie das mit rollenbasiertem Zugriff auf Aufgaben, wenn Sie einschränken möchten, wer tatsächlich Aufgabendatensätze aus den Importen erstellt.
- **Planen Sie die Token-Rotation**: Persönliche GLPI-Token können neu generiert werden. Wenn Sie das tun, speichern Sie hier den neuen Wert und führen Sie den Verbindungstest aus, bevor Benutzer (oder Agenten) die Integration erneut nutzen.
