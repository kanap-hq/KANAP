# Leitfaden VPN und Fernzugriff

Der gesamte Fernzugriff auf das Netzwerk von Fromage & Co läuft über **FortiClient VPN** mit **Okta MFA**. Das VPN-Gateway läuft auf dem FortiGate-Cluster im Pariser Rechenzentrum (PAR-DC1).

## VPN-Zugang beantragen

1. Eröffnen Sie in ServiceNow eine Anfrage unter **IT > Access > VPN**.
2. Ihre Führungskraft genehmigt die Anfrage; IT & Digital richtet das Profil ein.
3. Sie erhalten eine E-Mail mit dem Installationslink für FortiClient und der Gateway-Adresse (`vpn.fromage-co.example`).

Die Standardbearbeitungszeit beträgt **1 Arbeitstag**. Mitarbeitende aus Produktion und Qualität erhalten automatisch Zugriff auf das Werksnetzsegment.

## Verbindung herstellen

1. Starten Sie FortiClient und wählen Sie das Profil **Fromage & Co**.
2. Geben Sie Ihre geschäftliche E-Mail-Adresse und Ihr Passwort ein.
3. Bestätigen Sie die Okta-Push-Benachrichtigung auf Ihrem Telefon.

## Häufige Probleme

- **„Anmeldedaten abgelehnt“ nach einer Passwortänderung** — FortiClient speichert Ihr altes Passwort. Klicken Sie auf *Disconnect*, löschen Sie dann in den Profileinstellungen das gespeicherte Passwort und geben Sie das neue ein. Das ist das häufigste VPN-Ticket bei uns.
- **Keine Okta-Push-Benachrichtigung erhalten** — öffnen Sie die App Okta Verify manuell; wurde das Telefon ersetzt, bitten Sie den Service-Desk, Ihren MFA-Faktor zurückzusetzen.
- **Verbunden, aber SAP nicht erreichbar** — das Werkssegment erfordert die VPN-Gruppe *Production*. Klären Sie mit dem Service-Desk, ob Ihr Profil sie enthält.

## Arbeiten von zu Hause

VPN ist für SAP, die Dateifreigaben und das Cave Monitoring Dashboard erforderlich. Microsoft 365 (Teams, Exchange, SharePoint) funktioniert ohne VPN. Trennen Sie bitte das VPN, wenn Sie nur Teams nutzen — die Tunnelkapazität wird geteilt, und freitagmorgens ist in den Kellern schon genug los.
