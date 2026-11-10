---
title: "Aus KANAP wird Kadratis"
description: "KANAP heißt ab sofort Kadratis™. Die Software, ihre Open-Source-Lizenz sowie das Hosting- und Support-Angebot bleiben unverändert."
date: 2026-11-11
topic: release
author: Friedrich
authorRole: Gründer, CIO
draft: false
translationKey: kanap-devient-kadratis
---

![Die Startseite von Kadratis, mit Kad in der oberen Leiste](/screenshots/kadratis-home-2026-11-09.png)

## Warum ein neuer Name

Von einem Governance-Werkzeug erwartet man Seriosität und Sorgfalt; im Französischen hört man bei KANAP aber vor allem „canap'“, kurz für Sofa. Die Assoziation mag ein Lächeln hervorrufen, sie kann aber auch kontraproduktiv sein.

Außerdem brauchten wir einen Namen, den man schützen kann. „Kanap“ ist bereits vergeben, in der Möbelbranche und anderswo. Kadratis ist ein erfundener Name, eigens für das Produkt, und als Marke angemeldet. Bei Open-Source-Software schränkt die Marke den Code nicht ein: Sie zeigt lediglich, welche Distribution die offizielle ist.

Die [Richtlinie zur Markennutzung](https://github.com/kanap-hq/KANAP/blob/main/TRADEMARKS.md) legt fest, was jeder mit Kadratis tun darf, also fast alles: darüber sprechen, es integrieren, es hosten, Dienstleistungen darum herum verkaufen …

## Was sich für Sie ändert

**Für alle**: Der KI-Assistent heißt jetzt Kad. Es ist derselbe Agent, mit seinen Einstellungen und Ihren Unterhaltungen.

**In Kadratis Cloud** (der neue Name des gehosteten Angebots):

- Ihr Arbeitsbereich ist jetzt unter `<ihr-arbeitsbereich>.kadratis.com` erreichbar. Die alte Adresse unter `kanap.net` funktioniert weiter, ebenso bereits versendete Links und MCP-Verbindungen;
- beim ersten Besuch der neuen Adresse melden Sie sich einmal neu an. Ihr Browser bietet das für die alte Adresse gespeicherte Passwort nicht immer von selbst an: Geben Sie es einfach ein. Mit der Microsoft-Anmeldung genügt wie bisher ein Klick;
- die E-Mails der Anwendung tragen den neuen Namen und kommen weiterhin von derselben Adresse.

**Wenn Sie Kadratis selbst hosten**, läuft das Update wie gewohnt, ohne zusätzlichen Schritt. Ab Version 26.11.4 heißen die Images `kadratis-*` statt `kanap-*`; die Datei `compose.onprem.yml` der Version nennt sie bereits, und das Update-Verfahren lädt sie herunter. Die Variablen `KANAP_*`, die Datenbankrollen und die MCP-Token behalten ihren Namen. Frühere Versionen bleiben unter ihren alten Namen veröffentlicht.

**Website und Dokumentation** ziehen nach [kadratis.com](https://kadratis.com) und [doc.kadratis.com](https://doc.kadratis.com) um. Die alten Adressen leiten Seite für Seite weiter.

## Was sich nicht ändert

- **Die Software**: dieselben Funktionen, dieselben Daten, dieselbe Roadmap.
- **Die Lizenz**: AGPL v3; der Code bleibt öffentlich, Self-Hosting bleibt kostenlos und ohne eingeschränkte Funktionen.
- **Der Herausgeber**: die Firma KANAP in Frankreich. Ihre Verträge, Ihre Rechnungen und der Support laufen weiterhin auf ihren Namen.
- **Das Hosting**: Kadratis Cloud läuft auf denselben dedizierten Servern bei Hetzner in Deutschland.
- **Das GitHub-Repository**: dasselbe Repository; es wird in den kommenden Wochen umbenannt, und GitHub wird die alte Adresse weiterleiten.

Fragen zu dieser Änderung: Schreiben Sie an [contact@kadratis.com](mailto:contact@kadratis.com).
