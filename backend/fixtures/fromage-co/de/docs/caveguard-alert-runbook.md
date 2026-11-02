# CaveGuard-Alarm-Runbook — Sensoren der Käsekeller

CaveGuard IoT überwacht Temperatur und Feuchtigkeit in den Reifekellern (Paris: 8 Keller, Parma: 3 Räume). Alarme erscheinen im **Cave Monitoring Dashboard** und werden an Datadog weitergeleitet.

## Alarmstufen

| Farbe | Bedeutung | Reaktion |
|---|---|---|
| **Grün** | Werte innerhalb des Profils der Käsefamilie | Nichts zu tun |
| **Orange** | Abweichung vom Profil seit **weniger als 6 Stunden** | Innerhalb von 4 Stunden während besetzter Schichten prüfen; kein Notruf nötig |
| **Rot** | Abweichung seit mehr als 6 Stunden oder außerhalb der Sicherheitsgrenzen | Sofort den **Affineur in Rufbereitschaft** anrufen (Dienstplan im Kopf des Dashboards) |

## Referenzprofile

- **Comté / Hartkäse**: 8–12 °C, 85–92% RH. Eine Feuchtigkeit bis 92% ist normal — ein oranger Alarm bei 91% RH bedeutet lediglich, dass der Wert vom *konfigurierten* Profil abweicht; er erlischt von selbst, wenn die Kellertür kürzlich geöffnet wurde.
- **Weichkäse (Brie, Camembert)**: 10–12 °C, 90–95% RH. Das sind die empfindlichen.
- **Blauschimmelkäse**: 9–11 °C, 92–95% RH.

## Umgang mit einem orangen Feuchtigkeitsalarm

1. Öffnen Sie das Cave Monitoring Dashboard und prüfen Sie den Verlauf — eine Spitze nach dem Öffnen einer Tür flacht innerhalb einer Stunde ab.
2. Bewegt sich der Wert zurück zum Profil, **bestätigen** Sie den Alarm im Dashboard (Schaltfläche oben rechts auf der Alarmkarte). Ein Ticket ist nicht nötig.
3. Weicht er nach 2 Stunden weiter ab, erstellen Sie ein Ticket für Production IT und nennen Sie die Kellernummer und die Sensor-ID.

## Was wirklich kritisch ist

Rote Alarme, jeder Alarm zur **Temperatur** in einem Weichkäsekeller und ein Sensor, der gar nichts mehr meldet (flache Linie). Das rechtfertigt es, jemanden zu wecken. Ein leicht zu feuchter Comté-Keller nicht — der Comté hat schon Schlimmeres erlebt.
