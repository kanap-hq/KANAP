# Prozess für SAP-Zugriffsanfragen

Der Zugriff auf SAP S/4HANA ist rollenbasiert. Jede Anfrage läuft über ServiceNow unter **IT > Access > SAP** — E-Mail-Anfragen an einzelne IT-Mitarbeitende werden freundlich dorthin umgeleitet.

## Standardrollen

| Rolle | Umfang | Genehmiger |
|---|---|---|
| SAP FI (Finanzen) | Buchungen, Abschluss, Reporting | Maria Casanova (Finanzen und Controlling) |
| SAP MM (Einkauf) | Bestellungen, Wareneingang | Leitung Einkauf |
| SAP SD (Vertrieb) | Aufträge, Lieferungen, Fakturierung | Leitung Vertrieb und Marketing |
| SAP PP (Produktion) | Fertigungsaufträge, Chargenprotokolle | Jacques Dubois (Produktion) |
| Nur Anzeige | Lesezugriff auf alle Module | Direkte Führungskraft |

## Zeitlicher Ablauf

- Standardanfragen: **2 Arbeitstage** nach Genehmigung.
- **Beschleunigtes Verfahren**: Für einen Monatsabschluss oder ein Audit kann der Genehmiger die Anfrage als *Dringend — Finanzabschluss* markieren. Dringende Anfragen werden **am selben Arbeitstag** bereitgestellt, wenn sie vor 15:00 CET eingereicht werden.

## Neueinstellungen

Reichen Sie die Anfrage **vor dem Eintrittsdatum** ein — das HR-Onboarding in Workday legt das Okta-Konto automatisch an, aber SAP-Rollen brauchen weiterhin die ServiceNow-Anfrage und die Genehmigung. Für einen neuen Controller, der am ersten Tag buchen muss, sollte die Anfrage in der Woche davor eingereicht werden, mit der Markierung *Dringend — Finanzabschluss*, wenn das Eintrittsdatum in eine Abschlusswoche fällt.

## Funktionstrennung

Das System blockiert Kombinationen, die gegen SoD-Regeln verstoßen (z. B. Lieferanten anlegen *und* Zahlungen genehmigen). Wird Ihre Anfrage wegen SoD abgelehnt, entscheidet Finanzen und Controlling, welche Rolle Sie behalten. Keine Ausnahmen — auch nicht bei Käse-Notfällen.
