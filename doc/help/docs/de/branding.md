# Branding

Verwenden Sie die Branding-Seite, um Ihre Unternehmensidentität in Kadratis anzuwenden. Sie legen hier den Namen des Arbeitsbereichs, das Logo und die Primärfarben fest, und die Änderung ist für jeden Benutzer auf Ihrem Mandanten beim nächsten Neuladen der Seite sichtbar.

## Wo Sie es finden

- Arbeitsbereich: **Administration**-Menü → **Branding**
- Route: `/admin/branding`
- Berechtigung: `users:admin`
- Nur auf Mandanten-Hosts verfügbar (nicht auf dem Plattform-Admin-Host)

Änderungen gelten nur für Ihren aktuellen Mandanten.

## Was Sie anpassen können

Die Seite hat drei Karten: **Name des Arbeitsbereichs**, **Logo** und **Primärfarben**. Logo und Farben sind optional. Ohne Logo zeigt die Kopfzeile den Namen des Arbeitsbereichs. Ohne eigene Farben verwendet Kadratis die Standard-Themenfarben.

- **Name des Arbeitsbereichs**
  - Kennzeichnet Ihren Arbeitsbereich in der Kopfzeile, im Browser-Tab, in E-Mails und in KI-Werkzeugen (siehe [Wo der Name des Arbeitsbereichs erscheint](#wo-der-name-des-arbeitsbereichs-erscheint))
  - 1 bis 120 Zeichen
  - Die Adresse des Arbeitsbereichs bleibt unverändert
- **Logo**
  - Erscheint in der oberen App-Leiste (wenn angemeldet)
  - Erscheint in der Kopfzeile der Anmeldeseite
  - Ein optionales zweites Logo für den Dunkelmodus
- **Primärfarben**
  - Eine Primärfarbe für den **Light-Modus**
  - Eine Primärfarbe für den **Dark-Modus**
  - Wird von der App-Leiste, primären Schaltflächen und Links verwendet

## Name des Arbeitsbereichs

1. Geben Sie den Namen ein.
2. Klicken Sie auf **Änderungen speichern**.

**Auf Standard zurücksetzen** lässt den Namen unverändert. Die Aktion entfernt die Logos und die benutzerdefinierten Farben.

## Wo der Name des Arbeitsbereichs erscheint

- **Kopfzeile der App und Anmeldeseite**: Ohne Logo erscheint der Name.
- **Browser-Tab**: Der Titel des Tabs ist der Name. Eine Projekt-, Anfrage-, Aufgaben- oder Budgetzeilenseite zeigt zuerst den Datensatz, zum Beispiel `PRJ-3 Neues ERP | Acme`.
- **Installierte App**: Wenn jemand Kadratis auf einem Telefon oder einem Computer installiert, trägt die App den Namen.
- **E-Mails**: Ohne Logo zeigt die Kopfzeile den Namen. Die Betreffzeilen der E-Mails zum Zurücksetzen des Passworts, zur Einladung, zum wöchentlichen Rückblick und zum Zurücksetzen des Arbeitsbereichs tragen den Namen, zum Beispiel „Passwort für Acme zurücksetzen“. Die Schaltfläche des wöchentlichen Rückblicks lautet „Acme öffnen“. In der Cloud lautet der Absendername „Acme via Kadratis“. On-Premise ist der Absender der in der Installation festgelegte (`SMTP_FROM`).
- **KI-Werkzeuge**: Wenn sich ein KI-Werkzeug (Claude, ChatGPT und andere) über den MCP-Server verbindet, zeigt die Autorisierungsseite den Namen, und das Werkzeug zeigt ihn als Servernamen.

Ohne Namen oder mit dem On-Premise-Standardnamen „My Organization“ zeigen diese Stellen „Kadratis“.

## Logo-Einrichtung

### Unterstützte Dateien

- Formate: `PNG`, `JPG/JPEG`, `GIF`, `WEBP`
- Maximale Größe: `20 MB`

### Empfohlenes Logo-Format

- Verwenden Sie ein breites, horizontales Logo (transparenter Hintergrund bevorzugt).
- Halten Sie wichtige Inhalte zentriert: der Kopfzeilenbereich ist kompakt.
- Für eine scharfe Darstellung verwenden Sie mindestens etwa die 2-fache Anzeigegröße (z. B. `280x72` oder höher).

### So legen Sie es fest

Die Karte zeigt eine helle und eine dunkle Kopfzeilenvorschau, jede mit eigenen Schaltflächen **Logo hochladen** und **Logo entfernen**.

1. Klicken Sie unter der hellen Vorschau auf **Logo hochladen** und wählen Sie Ihre Datei aus.
2. Wenn Ihr Logo auf dunklem Hintergrund schlecht lesbar ist (zum Beispiel dunkler Text), laden Sie unter der dunklen Vorschau eine zweite Version hoch.
3. Ohne Logo für den Dunkelmodus bestimmt **Logo des Hellmodus verwenden**, was der Dunkelmodus zeigt: das Logo des Hellmodus, wenn es aktiviert ist, den Namen des Arbeitsbereichs als Text, wenn es deaktiviert ist.
4. Prüfen Sie beide Vorschauen und klicken Sie dann auf **Änderungen speichern**, um zu veröffentlichen.

Um ein Logo zu entfernen, klicken Sie unter seiner Vorschau auf **Logo entfernen**. Das andere Logo bleibt.

Der Dunkelmodus zeigt das Logo für den Dunkelmodus, wenn es eines gibt. Der Hellmodus zeigt immer das Logo des Hellmodus oder, wenn keines vorhanden ist, den Namen des Arbeitsbereichs als Text. E-Mails verwenden immer das Logo des Hellmodus, da ihr Hintergrund hell ist.

## Einrichtung der Primärfarbe

Sie können Farben für **Primär Light-Modus** und **Primär Dark-Modus** unabhängig festlegen. Jede Farbauswahl bietet vier Möglichkeiten, einen Wert einzugeben:

- Hex-Eingabe (`#RRGGBB`)
- Ein Farbauswahldialog (Palettensymbol)
- Voreingestellte Paletten-Chips (eine kuratierte Reihe pro Modus)
- Eine Aktion **Löschen**, um den benutzerdefinierten Wert zu entfernen

### Light/Dark-Verhalten

- **Primär Light-Modus** wird im Light-Modus verwendet.
- **Primär Dark-Modus** wird im Dark-Modus verwendet.
- Wenn nur ein Modus eine Farbe hat, verwendet Kadratis diese Farbe im anderen Modus als Fallback.
- Wenn beide Felder leer sind, verwendet Kadratis seine Standard-Themenfarben.

### Kontrastwarnung

Nachdem Sie Farben ausgewählt haben, bewertet die Seite, wie lesbar Text vor dem gewählten Hintergrund ist. Wenn der Kontrast für einen der Modi unter den lesbaren Schwellenwert fällt, erscheint eine beratende Warnung mit dem Kontrastverhältnis.

Die Warnung ist informativ (Sie können trotzdem speichern), aber niedriger Kontrast bedeutet normalerweise weißen Text auf einer hellen Farbe oder dunklen Text auf einer gesättigten Farbe, was beides in echten Oberflächen ermüdend zu lesen wird.

## Speichern und Zurücksetzen

Drei Aktionen am unteren Rand der Seite steuern die Persistenz:

- **Änderungen speichern**: Speichert den Namen des Arbeitsbereichs, die ausgewählten Logos und die Farbwerte. Deaktiviert, wenn keine ausstehenden Änderungen vorliegen, der Name leer ist oder länger als 120 Zeichen ist, oder eine Hex-Eingabe ungültig ist.
- **Verwerfen**: Setzt nicht gespeicherte Bearbeitungen auf der Seite zurück (betrifft nicht das, was bereits gespeichert ist).
- **Auf Standard zurücksetzen**: Entfernt beide gespeicherten Logos und löscht alle benutzerdefinierten Farben. Der Name des Arbeitsbereichs bleibt. Fragt vor der Ausführung um Bestätigung.

Eine kleine Beschriftung unter den Aktionen zeigt den Zähler **Logo-Version** an, der bei jedem Hochladen oder Entfernen eines Logos erhöht wird. Dies ist hauptsächlich ein Hinweis darauf, dass Browser-Caches aktualisiert werden.

## Tipps

- **In beiden Themes testen**: Wechseln Sie vor dem Speichern zwischen Light- und Dark-Theme. Die gleiche Markenfarbe funktioniert selten in beiden Modi.
- **Transparenten Hintergrund bevorzugen**: Einfache Logos mit transparentem Hintergrund ergeben die sauberste Kopfzeilen-Darstellung, besonders im Dark-Modus.
- **Verwenden Sie Zurücksetzen bewusst**: Es entfernt sowohl die Logos als auch alle benutzerdefinierten Farben in einem Schritt. Verwenden Sie es, wenn Sie neu beginnen, nicht als „Rückgängig" für eine einzelne Änderung. Dafür ist **Verwerfen**.
- **Markenfarben sind für Akzente**: Kadratis verwendet die Primärfarbe in App-Leisten, primären Schaltflächen und Links. Wählen Sie etwas, das in Schaltflächengröße sauber lesbar ist, nicht nur auf einer Marketing-Website.
