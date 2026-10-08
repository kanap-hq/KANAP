# CaveGuard Alert Runbook — Cheese Cave Sensors

CaveGuard IoT monitors temperature and humidity in the aging caves (Paris: 8 caves, Parma: 3 rooms). Alerts appear in the **Cave Monitoring Dashboard** and are relayed to Datadog.

## Alert severities

| Color | Meaning | Response |
|---|---|---|
| **Green** | Values within the profile for the cheese family | Nothing to do |
| **Orange** | Drift outside the profile for **less than 6 hours** | Check within 4 hours during staffed shifts; no call-out needed |
| **Red** | Drift for more than 6 hours, or outside safety bounds | Call the **on-call affineur** immediately (rota in the dashboard header) |

## Reference profiles

- **Comté / hard cheeses**: 8–12 °C, 85–92% RH. Humidity up to 92% is normal — an orange alert at 91% RH simply means the value drifted from the *configured* profile and will clear on its own if the cellar door was recently opened.
- **Soft cheeses (Brie, Camembert)**: 10–12 °C, 90–95% RH. These are the sensitive ones.
- **Blue cheeses**: 9–11 °C, 92–95% RH.

## Handling an orange humidity alert

1. Open the Cave Monitoring Dashboard and check the trend — a spike after a door opening flattens within the hour.
2. If the value trends back toward the profile, **acknowledge** the alert in the dashboard (button top-right of the alert card). It does not need a ticket.
3. If it keeps drifting after 2 hours, create a ticket for Production IT and mention the cave number and sensor ID.

## What is actually critical

Red alerts, any **temperature** alert in a soft-cheese cave, and a sensor that stops reporting entirely (flat line). Those justify waking someone up. A slightly humid Comté cave does not — the Comté has seen worse.
