# Alle Einstellungen

Die Seite Alle Einstellungen listet auf einem einzigen Bildschirm jede Einstellungsseite auf, die Sie öffnen können: Ihr eigenes Konto, die Einstellungen jedes Moduls, die Administration Ihrer Organisation und, je nach Installation, die Seiten der Installation oder der Plattform. Nutzen Sie sie, wenn Sie wissen, was Sie ändern möchten, aber nicht, wo es liegt.

## Wo Sie sie finden

- Im Kontomenü (das Personensymbol oben rechts): **Alle Einstellungen**, über dem Eintrag Ihres Kontos. Jede angemeldete Person hat ihn.
- Im Menü **Administration**: **Alle Einstellungen**, der letzte Eintrag, abgesetzt unter den anderen Abschnitten. Er erscheint, wenn Sie weitere Seiten in diesem Menü sehen. Auf dem Plattform-Host steht der Eintrag nur im Kontomenü.
- Route: `/admin/all-settings`

## Aufbau der Liste

Die Seiten sind in dieser Reihenfolge gruppiert:

- **Mein Konto**: Ihr Profil, die Benachrichtigungen, die Darstellung, die verbundenen Apps und die Anordnung Ihrer Startseite.
- **Eine Gruppe pro Modul**: KI-Agenten, Portfolio, IT-Landschaft, Wissensdatenbank und Budgetverwaltung, in der Reihenfolge der oberen Leiste.
- **Administration**: Benutzer, Rollen, Datenzugriff, Audit-Protokoll, Abrechnung, Authentifizierung, Branding, KI und Integrationen.
- **Installation**: die Seiten, die die Installation selbst einrichten, zum Beispiel die geplanten Aufgaben. Bei einer Installation auf Ihren eigenen Servern erscheinen sie für die Rolle Administrator, im Cloud-Dienst für den Plattformadministrator auf dem Plattform-Host.
- **Plattform**: auf dem Plattform-Host des Cloud-Dienstes die Seiten der Plattformverwaltung.

Jede Zeile nennt den Namen der Seite und, in Grau, den Menüpfad, der zu ihr führt. Klicken Sie auf den Namen, um die Seite zu öffnen. Hat die Seite Registerkarten und gehört die Registerkarte zu ihrer Adresse, öffnet der Link direkt diese Registerkarte (zum Beispiel **Benachrichtigungen** oder **Netbox**). Eine Einstellung, die in einem Dialog liegt, etwa der Entscheidungszeitraum der Verträge oder die Dokumenttypen der Wissensdatenbank, öffnet die Seite, die den Dialog enthält.

## Suche

Geben Sie Text in das Suchfeld ein, um die Liste zu filtern. Die Suche berücksichtigt die Namen der Seiten und die Namen ihrer wichtigsten Einstellungen, in Ihrer Sprache. Groß- und Kleinschreibung sowie Akzente spielen keine Rolle.

So findet **Reporting-Währung** die Seite **Währungen** der Budgetverwaltung, weil die Reporting-Währung dort festgelegt wird. Mehrere Wörter grenzen die Liste ein: Jedes Wort muss vorkommen.

Passt nichts, sagt die Seite das in einer Zeile.

## Was die Liste Ihnen zeigt

Die Liste zeigt nur die Seiten, die Sie mit Ihren Rollen öffnen können, genau wie die Menüs:

- Eine Seite, die Sie lesen, aber nicht ändern können, steht in der Liste. Sie öffnet sich schreibgeschützt.
- Eine Seite, die Sie nicht öffnen können, erscheint nicht, ebenso wenig eine Gruppe, die leer bleibt.
- Seiten, die von einer Funktion abhängen, erscheinen nur, wenn diese Funktion aktiv ist: die Abrechnung in der Cloud, **Authentifizierung**, wenn die Microsoft-Anmeldung eingerichtet ist, die KI-Seiten, wenn die KI aktiviert ist.
- Bei eingeschränktem Datenzugriff stehen diese Seiten nicht in der Liste: die Seiten von **Budgetverwaltung > Administration**, **Vertragseinstellungen**, **Datenzugriff** und **Audit-Protokoll**.
- Bei einer Installation auf Ihren eigenen Servern stehen die Seiten, die es nur in der Cloud gibt (Abrechnung, Beispieldaten), nicht in der Liste. Die Gruppe **Installation** erscheint für die Rolle Administrator mit Zugriff auf alle Daten.
- Auf dem Plattform-Host enthält die Liste nur die Seiten der Installation und der Plattform.

Auf dieser Seite wird nichts geändert: Sie führt nur zu den Seiten, auf denen die Einstellungen vorgenommen werden.
