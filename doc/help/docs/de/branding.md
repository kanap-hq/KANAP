# Branding

Verwenden Sie die Branding-Seite, um Ihre Unternehmensidentität in KANAP anzuwenden. Sie legen hier den Namen der Organisation, das Logo und die Primärfarben fest, und die Änderung ist für jeden Benutzer auf Ihrem Mandanten beim nächsten Neuladen der Seite sichtbar.

## Wo Sie es finden

- Arbeitsbereich: **Administration**-Menü → **Branding**
- Route: `/admin/branding`
- Berechtigung: `users:admin`
- Nur auf Mandanten-Hosts verfügbar (nicht auf dem Plattform-Admin-Host)

Änderungen gelten nur für Ihren aktuellen Mandanten.

## Was Sie anpassen können

Die Seite hat drei Karten: **Name der Organisation**, **Logo** und **Primärfarben**. Logo und Farben sind optional. Ohne Festlegung zeigt KANAP seine Standard-Text-und-Symbol-Kopfzeile und die Standard-Themenfarben.

- **Name der Organisation**
  - Der Name beim Logo, im Fenster Info, auf der Einwilligungsseite und für den Assistenten
  - 1 bis 120 Zeichen
  - Die Adresse des Arbeitsbereichs bleibt unverändert
- **Logo**
  - Erscheint in der oberen App-Leiste (wenn angemeldet)
  - Erscheint in der Kopfzeile der Anmeldeseite
- **Primärfarben**
  - Eine Primärfarbe für den **Light-Modus**
  - Eine Primärfarbe für den **Dark-Modus**
  - Wird von der App-Leiste, primären Schaltflächen und Links verwendet

## Name der Organisation

1. Geben Sie den Namen ein.
2. Klicken Sie auf **Änderungen speichern**.

**Auf Standard zurücksetzen** lässt den Namen unverändert. Die Aktion entfernt das Logo und die benutzerdefinierten Farben.

## Logo-Einrichtung

### Unterstützte Dateien

- Formate: `PNG`, `JPG/JPEG`, `GIF`, `WEBP`
- Maximale Größe: `20 MB`

### Empfohlenes Logo-Format

- Verwenden Sie ein breites, horizontales Logo (transparenter Hintergrund bevorzugt).
- Halten Sie wichtige Inhalte zentriert: der Kopfzeilenbereich ist kompakt.
- Für eine scharfe Darstellung verwenden Sie mindestens etwa die 2-fache Anzeigegröße (z. B. `280x72` oder höher).

### So legen Sie es fest

1. Klicken Sie auf **Logo hochladen** und wählen Sie Ihre Datei aus.
2. Verwenden Sie die integrierten **Light**- und **Dark**-Kopfzeilenvorschauen, um das Erscheinungsbild zu validieren.
3. Schalten Sie **Logo im Dark-Modus anzeigen** um, wenn Sie im dunklen Theme auf das Standard-Text-Branding zurückgreifen möchten.
4. Klicken Sie auf **Änderungen speichern**, um zu veröffentlichen.

Um das aktuelle Logo zu entfernen, klicken Sie auf **Logo entfernen**.

Wenn kein Logo festgelegt ist oder wenn **Logo im Dark-Modus anzeigen** deaktiviert ist, greift KANAP im jeweiligen Theme auf sein Standard-Text-Branding zurück.

## Einrichtung der Primärfarbe

Sie können Farben für **Primär Light-Modus** und **Primär Dark-Modus** unabhängig festlegen. Jede Farbauswahl bietet vier Möglichkeiten, einen Wert einzugeben:

- Hex-Eingabe (`#RRGGBB`)
- Ein Farbauswahldialog (Palettensymbol)
- Voreingestellte Paletten-Chips (eine kuratierte Reihe pro Modus)
- Eine Aktion **Löschen**, um den benutzerdefinierten Wert zu entfernen

### Light/Dark-Verhalten

- **Primär Light-Modus** wird im Light-Modus verwendet.
- **Primär Dark-Modus** wird im Dark-Modus verwendet.
- Wenn nur ein Modus eine Farbe hat, verwendet KANAP diese Farbe im anderen Modus als Fallback.
- Wenn beide Felder leer sind, verwendet KANAP seine Standard-Themenfarben.

### Kontrastwarnung

Nachdem Sie Farben ausgewählt haben, bewertet die Seite, wie lesbar Text vor dem gewählten Hintergrund ist. Wenn der Kontrast für einen der Modi unter den lesbaren Schwellenwert fällt, erscheint eine beratende Warnung mit dem Kontrastverhältnis.

Die Warnung ist informativ (Sie können trotzdem speichern), aber niedriger Kontrast bedeutet normalerweise weißen Text auf einer hellen Farbe oder dunklen Text auf einer gesättigten Farbe, was beides in echten Oberflächen ermüdend zu lesen wird.

## Speichern und Zurücksetzen

Drei Aktionen am unteren Rand der Seite steuern die Persistenz:

- **Änderungen speichern**: Speichert den Namen der Organisation, den ausgewählten Logo-Upload und die Farbwerte. Deaktiviert, wenn keine ausstehenden Änderungen vorliegen, der Name leer ist oder länger als 120 Zeichen ist, oder eine Hex-Eingabe ungültig ist.
- **Verwerfen**: Setzt nicht gespeicherte Bearbeitungen auf der Seite zurück (betrifft nicht das, was bereits gespeichert ist).
- **Auf Standard zurücksetzen**: Entfernt das gespeicherte Logo und löscht alle benutzerdefinierten Farben. Der Name der Organisation bleibt. Fragt vor der Ausführung um Bestätigung.

Eine kleine Beschriftung unter den Aktionen zeigt den Zähler **Logo-Version** an, der bei jedem Hochladen des Logos erhöht wird. Dies ist hauptsächlich ein Hinweis darauf, dass Browser-Caches aktualisiert werden.

## Tipps

- **In beiden Themes testen**: Wechseln Sie vor dem Speichern zwischen Light- und Dark-Theme. Die gleiche Markenfarbe funktioniert selten in beiden Modi.
- **Transparenten Hintergrund bevorzugen**: Einfache Logos mit transparentem Hintergrund ergeben die sauberste Kopfzeilen-Darstellung, besonders im Dark-Modus.
- **Verwenden Sie Zurücksetzen bewusst**: Es entfernt sowohl das Logo als auch alle benutzerdefinierten Farben in einem Schritt. Verwenden Sie es, wenn Sie neu beginnen, nicht als „Rückgängig" für eine einzelne Änderung. Dafür ist **Verwerfen**.
- **Markenfarben sind für Akzente**: KANAP verwendet die Primärfarbe in App-Leisten, primären Schaltflächen und Links. Wählen Sie etwas, das in Schaltflächengröße sauber lesbar ist, nicht nur auf einer Marketing-Website.
