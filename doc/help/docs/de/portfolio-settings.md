# Portfolio-Einstellungen

Die Portfolio-Einstellungen ermöglichen es Ihnen, das Bewertungssystem, die Teamfähigkeiten, Projektphasenvorlagen, die Klassifizierungsstruktur und die Vertragsarten zu konfigurieren, die über alle Portfolio-Anfragen und -Projekte hinweg verwendet werden. Diese Einstellungen bestimmen, wie Anfragen bewertet, wie Projekte strukturiert und wie Elemente kategorisiert werden.

## Wo Sie es finden

- Arbeitsbereich: **Portfolio**
- Pfad: **Portfolio > Einstellungen**
- Berechtigungen:
  - Sie benötigen `portfolio_settings:admin`, um Einstellungen zu ändern
  - Niedrigere Berechtigungsstufen können anzeigen, aber nicht bearbeiten

Wenn Sie Einstellungen nicht im Menü sehen, bitten Sie Ihren Administrator, Ihnen die entsprechenden Berechtigungen zu erteilen.

## Bewertungskriterien

Definieren Sie die Bewertungskriterien, die zur Berechnung der Prioritätswerte für Anfragen und Projekte verwendet werden.

### Obligatorischer Bypass-Einstellung

Oben auf dem Reiter Bewertungskriterien:
- **Obligatorische Anfragen erhalten automatisch 100 Punkte**: Wenn aktiviert, erhält jede Anfrage mit einem als „obligatorisch" gekennzeichneten Kriterienwert einen Prioritätswert von 100, unabhängig von anderen Kriterien

### Kriterien verwalten

Jedes Kriterium hat:
  - **Name**: Was Sie bewerten (z. B. „Strategische Ausrichtung", „Risikostufe")
  - **Gewichtung**: Relative Wichtigkeit (höhere Gewichtung = mehr Einfluss auf den Wert)
  - **Invertiert**: Wenn aktiviert, erster Wert = höchster Wert statt niedrigster
  - **Aktiviert/Deaktiviert**: Umschalter zum Ein-/Ausschließen in der Bewertung
  - **Werte**: Die Skalenoptionen in Reihenfolge

**Um ein Kriterium hinzuzufügen**:
1. Klicken Sie auf **Kriterium hinzufügen**
2. Geben Sie den Namen ein
3. Legen Sie die Gewichtung fest (Standard ist 1)
4. Aktivieren Sie „Invertiert", wenn eine höhere Position einen niedrigeren Wert bedeuten soll
5. Definieren Sie die Werte in Reihenfolge (mindestens 2)
6. Markieren Sie optional einen Wert als „Obligatorisch" (löst den Bypass aus)
7. Klicken Sie auf **Speichern**

**Um ein Kriterium zu bearbeiten**:
- Klicken Sie auf das Bearbeitungssymbol
- Ändern Sie Name, Gewichtung, Invertierung oder Werte
- Klicken Sie auf **Speichern**

**Um ein Kriterium zu löschen**:
- Klicken Sie auf das Löschsymbol
- Bestätigen Sie die Löschung
- Hinweis: Vorhandene Bewertungen, die dieses Kriterium verwenden, werden entfernt

**Beispielkriterien**:
- Strategische Ausrichtung: Niedrig, Mittel, Hoch (Gewichtung 2)
- Geschäftswert: Niedrig, Mittel, Hoch, Sehr hoch (Gewichtung 1,5)
- Risikostufe: Niedrig, Mittel, Hoch, Kritisch (Gewichtung 1, invertiert)
- Compliance: Optional, Empfohlen, Obligatorisch (Gewichtung 1, „Obligatorisch" löst Bypass aus)

---

## Fähigkeiten

Definieren Sie Fachgebiete der Teammitglieder für die Projektbesetzung.

### Fähigkeiten verwalten

Fähigkeiten sind nach Kategorie gruppiert:
- Fähigkeiten ein-/ausschalten, um sie für Teamzuweisungen verfügbar zu machen
- Fähigkeiten nach Bedarf hinzufügen, bearbeiten oder löschen

**Standardwerte laden**:
- Wenn keine Fähigkeiten existieren, klicken Sie auf **Standardwerte laden**, um mit Standard-IT- und Business-Fähigkeiten zu befüllen
- Kategorien umfassen: Entwicklung, Infrastruktur, Business-Analyse, Projektmanagement usw.

**Um eine Fähigkeit hinzuzufügen**:
1. Klicken Sie auf **Fähigkeit hinzufügen**
2. Wählen oder tippen Sie einen Kategorienamen
3. Geben Sie den Fähigkeitsnamen ein
4. Klicken Sie auf **Speichern**

**Um eine Fähigkeit zu deaktivieren**:
- Schalten Sie den Schalter neben dem Fähigkeitsnamen um
- Deaktivierte Fähigkeiten erscheinen nicht in den Auswahllisten für Teamfähigkeiten

---

## Phasenvorlagen

Definieren Sie Standard-Phasenstrukturen zur Anwendung auf Projekte.

### Vorlagen verstehen

Phasenvorlagen bieten:
- Konsistente Projektstrukturen in der gesamten Organisation
- Schnelle Einrichtung beim Erstellen oder Planen von Projekten
- Optionale Meilensteine, die mit jeder Phase verknüpft sind

**Systemvorlagen**:
- Von KANAP bereitgestellte vordefinierte Vorlagen
- Mit einem „System"-Chip gekennzeichnet
- Können bearbeitet werden, bieten aber sinnvolle Standardwerte

**Benutzerdefinierte Vorlagen**:
- Vorlagen, die Sie für die Methodik Ihrer Organisation erstellen
- Nützlich für verschiedene Projekttypen (z. B. Agil, Wasserfall, Quick Win)

### Vorlagen verwalten

**Um eine Vorlage zu erstellen**:
1. Klicken Sie auf **Vorlage hinzufügen**
2. Geben Sie den Vorlagennamen ein
3. Fügen Sie Phasen in Reihenfolge hinzu:
   - Phasennamen eingeben
   - „Meilenstein" aktivieren, wenn ein Abschlussmeilenstein erstellt werden soll
   - Optional den Meilensteinnamen anpassen
4. Fügen Sie weitere Phasen nach Bedarf hinzu
5. Klicken Sie auf **Speichern**

**Um eine Vorlage zu bearbeiten**:
- Klicken Sie auf das Bearbeitungssymbol
- Ändern Sie Name, Phasen oder Meilensteineinstellungen
- Klicken Sie auf **Speichern**

**Um eine Vorlage zu löschen**:
- Klicken Sie auf das Löschsymbol
- Bestätigen Sie die Löschung
- Hinweis: Bestehende Projekte, die diese Vorlage verwenden, sind nicht betroffen

**Beispielvorlagen**:
- Wasserfall: Analyse, Design, Entwicklung, Test, Bereitstellung (alle mit Meilensteinen)
- Agil: Discovery, MVP, Iteration 1, Iteration 2, Release
- Quick Win: Planung, Ausführung, Abschluss

---

## Klassifizierung

Konfigurieren Sie Typen, Kategorien und Streams zur Organisation von Anfragen und Projekten.

Ein neuer Arbeitsbereich beginnt mit drei Quellen (IT, Fachbereich, Compliance) und fünf Kategorien mit je einer kurzen Beschreibung (Geschäftsanwendungen, Arbeitsplatz und Anwenderservices, Infrastruktur und Betrieb, Innovation und digitale Transformation, Cybersicherheit), ohne Stream. Ihre Namen folgen der Sprache des Arbeitsbereichs. Sie können sie wie jeden anderen Wert umbenennen, deaktivieren oder löschen.

### Typen

Typen beschreiben die Art der Arbeit:
- **Erweiterung**: Verbesserungen bestehender Fähigkeiten
- **Neuentwicklung**: Aufbau neuer Fähigkeiten
- **Wartung**: Systeme betriebsbereit halten
- **Infrastruktur**: Plattform und technische Grundlage

**Um einen Typ hinzuzufügen**:
1. Klicken Sie auf **Typ hinzufügen**
2. Geben Sie Name und optionale Beschreibung ein
3. Klicken Sie auf **Speichern**

**Um einen Typ umzuschalten**:
- Verwenden Sie den Schalter zum Aktivieren/Deaktivieren
- Deaktivierte Typen erscheinen nicht in Auswahl-Dropdowns

### Kategorien & Streams

Kategorien bieten eine übergeordnete Gruppierung, und Streams bieten eine Unterkategorisierung innerhalb jeder Kategorie.

**Struktur**:
```
Kategorie (z. B. „Digitale Transformation")
  ├── Stream (z. B. „Kundenerlebnis")
  ├── Stream (z. B. „Betriebseffizienz")
  └── Stream (z. B. „Datenanalyse")
```

**Um eine Kategorie hinzuzufügen**:
1. Klicken Sie auf **Kategorie hinzufügen**
2. Geben Sie Name und optionale Beschreibung ein
3. Klicken Sie auf **Speichern**

**Um einen Stream hinzuzufügen**:
1. Erweitern Sie die Kategorie
2. Klicken Sie auf **Stream hinzufügen**
3. Geben Sie Name und optionale Beschreibung ein
4. Klicken Sie auf **Speichern**

**Um Elemente umzuschalten**:
- Verwenden Sie Schalter zum Aktivieren/Deaktivieren von Kategorien oder Streams
- Deaktivierte Elemente erscheinen nicht in Auswahl-Dropdowns
- Das Deaktivieren einer Kategorie blendet alle ihre Streams aus

**Systemelemente**:
- Vordefinierte Kategorien und Typen mit „System"-Chip gekennzeichnet
- Können bearbeitet oder deaktiviert, aber nicht gelöscht werden
- Ein Element, das Anfragen oder Projekte noch verwenden, oder ein Aufgabentyp, den Aufgaben verwenden, kann nicht gelöscht werden. KANAP sagt es, bevor Sie bestätigen, und zählt, was es verwendet. Deaktivieren Sie es stattdessen

### Best Practices

- Halten Sie die Typenliste kurz (3-6 Einträge)
- Verwenden Sie Kategorien für wichtige Geschäftsbereiche oder strategische Themen
- Verwenden Sie Streams für spezifischere Gruppierungen innerhalb von Kategorien
- Überprüfen und bereinigen Sie ungenutzte Klassifizierungselemente regelmäßig

---

## Vertragsarten

Vertragsarten halten fest, wie jeder Mitwirkende mit Ihnen zusammenarbeitet. Sie erscheinen als Dropdown im Eigenschaften-Panel jedes Mitwirkenden und als Filter auf der Mitwirkenden-Seite. Jeder Mitwirkende beginnt als Intern.

Vier Arten werden mit jedem Arbeitsbereich angelegt:

- **Intern**: der Standard für jeden neuen Mitwirkenden
- **Extern**
- **Auszubildender**
- **Sonstige**

### Vertragsarten verwalten

**Eine Art hinzufügen**:
1. Öffnen Sie den Tab **Vertragsarten**
2. Klicken Sie auf **Vertragsart hinzufügen**
3. Geben Sie einen Namen ein und klicken Sie auf **Speichern**

**Eine Art umbenennen**: Klicken Sie auf das Bearbeiten-Symbol, ändern Sie den Namen und speichern Sie. Mitwirkende, die diese Art bereits haben, behalten sie.

**Eine Art deaktivieren**: Verwenden Sie den Schalter. Eine inaktive Art verschwindet aus dem Dropdown für neue Zuordnungen, aber Mitwirkende, die sie bereits haben, behalten und zeigen sie weiterhin.

**Eine Art löschen**: Klicken Sie auf das Löschen-Symbol. Eine integrierte Art oder eine Art, die Mitwirkende haben, wird vor der Bestätigung abgelehnt, mit dem Grund. Die Zahl neben jeder Art zeigt, wie viele Mitwirkende sie haben. Die vier integrierten Arten können umbenannt, aber nie gelöscht werden. Um eine Art außer Gebrauch zu nehmen, die Mitwirkende haben, schalten Sie sie mit dem Schalter aus.

**Standardwerte laden**: Sollte die Liste jemals leer sein, legt **Standardwerte laden** Intern, Extern, Auszubildender und Sonstige erneut an.

Vertragsarten werden nie aus Microsoft Entra importiert: Sie pflegen sie selbst.

---

## Tipps

  - **Beginnen Sie mit der Bewertung**: Definieren Sie zuerst Ihre Bewertungskriterien, damit Anfragen richtig priorisiert werden können
  - **Verwenden Sie Vorlagen**: Erstellen Sie Vorlagen, die zur Umsetzungsmethodik Ihrer Organisation passen
  - **Halten Sie die Klassifizierung einfach**: Zu viele Optionen erzeugen Verwirrung; beginnen Sie klein und erweitern Sie nach Bedarf
  - **Überprüfen Sie regelmäßig**: Wenn sich Ihre Organisation weiterentwickelt, überprüfen Sie diese Einstellungen, um sicherzustellen, dass sie weiterhin relevant sind
  - **Halten Sie die Vertragsarten übersichtlich**: Vier oder fünf Arten genügen meist für die Frage «wer ist intern und wer nicht»

