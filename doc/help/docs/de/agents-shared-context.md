# KI-Agenten: Gemeinsamer Kontext

Gemeinsamer Kontext ist eine kleine Sammlung wiederverwendbarer Hintergrundhinweise, die Sie einmal schreiben und Ihren Agenten mitgeben. Ein Profil ist ein benannter Satz weniger, in einfacher Sprache formulierter Zeilen zu Ihrer IT-Umgebung: wie Ihre Flotte verwaltet wird, was Ihre Agenten sagen sollen und was nicht, welche Konventionen Ihr Service-Desk befolgt. Dasselbe Profil kann jedem Agenten zugeordnet werden und prägt dort, wie dieser Agent eingehende Tickets interpretiert und wie er seine Antworten formuliert.

Es geht um Konsistenz ohne Wiederholung. Anstatt jedem Agenten dieselben Hausregeln erneut beizubringen, halten Sie sie in einem Profil fest und verweisen jeden Agenten darauf. Ändern Sie das Profil einmal, und jeder Agent, der es verwendet, übernimmt die neuen Hinweise.

Eines sollte von Anfang an klar sein, denn davon hängt jede sinnvolle Nutzung dieser Funktion ab: Gemeinsamer Kontext ist **keine Berechtigungserteilung und keine zitierbare Quelle**. Er steuert Ton und Interpretation, aber seine Zeilen werden niemals gegenüber einem Anfragenden zitiert und gewähren keinen neuen Datenzugriff. Fakten, die ein Agent zitieren soll, gehören in eine [Wissensbibliothek](knowledge.md), nicht hierher.

---

## Wo Sie es finden

- Arbeitsbereich: **KI-Agenten > Gemeinsamer Kontext**
- Route: `/agents/shared-context`
- Berechtigungen:
  - `ai_agents:reader` ermöglicht das Öffnen der Seite und das Lesen der Profilliste
  - `ai_agents:admin` (oder `ai_settings:admin`) ist erforderlich, um Profile zu erstellen, zu bearbeiten, zu archivieren und wiederherzustellen
- Verfügbarkeit: Der gesamte Bereich KI-Agenten erscheint nur, wenn KI auf der Instanz aktiviert ist und Sie `ai_agents:reader` besitzen

Ohne Administratorrechte sehen Sie zwar weiterhin die vollständige Profilliste, aber die Schaltfläche **Neues Profil** und die Steuerelemente zum Bearbeiten, Archivieren und Wiederherstellen je Zeile sind ausgeblendet: die Seite ist für Sie schreibgeschützt.

---

## Was ein Profil ist

Ein Profil bündelt drei Dinge:

- Einen **Namen**, der es identifiziert, zum Beispiel `Default IT environment`.
- Eine optionale **Beschreibung** für Ihre eigenen Zwecke, zum Beispiel „Unternehmensweiter IT-Kontext für Helpdesk-Agenten".
- Einen Satz **Kontextzeilen**: eine kurze Hintergrundzeile pro Zeile. Jede Zeile ist eine einzelne Anweisung oder ein Fakt zu Ihrer Umgebung. Typische Zeilen lauten „Die meisten Benutzer verwenden verwaltete Laptops." oder „Niemals nach Passwörtern fragen."

Betrachten Sie die Zeilen als dauerhafte Hinweise und nicht als Wissensdatenbank. Gute Zeilen sind die Art von Dingen, die Sie einem neuen Techniker am ersten Tag mitgeben würden: wie die Umgebung aufgesetzt ist, welchen Ton man anschlagen sollte und harte „Niemals tun"-Regeln. Sie beeinflussen die Phasen, in denen der Agent entscheidet, was zu tun ist, und in denen er die Antwort entwirft, ohne dass Sie sie für jeden Agenten wiederholen müssen.

---

## Die Profilliste

Der Abschnitt **Profile** listet jedes Profil auf der Instanz auf. Jede Zeile zeigt:

- Den **Namen** des Profils, mit einer daneben stehenden Markierung **Archiviert**, wenn das Profil nicht mehr aktiv ist (archivierte Zeilen werden abgedunkelt dargestellt).
- Die **Beschreibung**, sofern eine angegeben wurde.
- Eine Zusammenfassungszeile: **{n} Zeilen** und, sofern verfügbar, **Aktualisiert am {time}**, damit Sie sehen, wie viele Hinweiszeilen das Profil enthält und wann es zuletzt geändert wurde.

Administratoren erhalten im Seitenkopf eine Schaltfläche **Neues Profil**, Steuerelemente zum Bearbeiten und Archivieren in jeder aktiven Zeile und ein Steuerelement zum Wiederherstellen in jeder archivierten Zeile. Ein archiviertes Profil bleibt schreibgeschützt, bis Sie es wiederherstellen: es besitzt kein Steuerelement zum Bearbeiten.

---

## Ein Profil erstellen und bearbeiten

**Neues Profil** (nur für Administratoren) öffnet den Editor-Dialog. Das Bearbeiten eines aktiven Profils öffnet denselben Dialog vorausgefüllt.

Sie füllen aus:

- **Name**: erforderlich.
- **Beschreibung**: optional, für Ihre eigenen Zwecke.
- **Kontextzeilen**: eine Hintergrundzeile pro Zeile. Leere Zeilen werden ignoriert.

**Speichern** bleibt deaktiviert, bis ein Name und mindestens eine Kontextzeile vorhanden sind. Wenn Sie ein bestehendes Profil bearbeiten, wird es beim Speichern direkt aktualisiert: jeder Agent, der bereits auf dieses Profil verweist, arbeitet sofort mit den neuen Zeilen. Behandeln Sie Änderungen an einem viel genutzten Profil daher als Eingriff, der sich über Ihre gesamte Flotte auswirkt.

---

## Ein Profil archivieren

Das Archivieren dient dazu, ein Profil außer Dienst zu stellen, das Agenten nicht mehr verwenden sollen. Bevor es wirksam wird, warnt KANAP Sie unmissverständlich:

> „{name}" steht den Agenten nicht mehr zur Verfügung. Jeder Agent, der es derzeit verwendet, läuft ohne gemeinsamen Kontext, bis Sie ihn auf ein anderes Profil verweisen.

Das ist die wichtige Konsequenz, die Sie verinnerlichen sollten: Das Archivieren verschiebt betroffene Agenten nicht automatisch auf ein Ersatzprofil. Jeder Agent, der auf das archivierte Profil verwiesen hat, läuft weiter, jedoch **ohne** gemeinsamen Kontext, bis Sie in die Einstellungen dieses Agenten gehen und ein anderes Profil auswählen. Wenn mehrere Agenten das Profil, das Sie archivieren, gemeinsam nutzen, planen Sie den Wechsel vorab.

Archivierte Profile bleiben in der Liste, abgedunkelt und mit **Archiviert** markiert. Sie können nicht mehr bearbeitet oder einem Agenten zugeordnet werden, bis Sie sie wiederherstellen.

---

## Ein Profil wiederherstellen

**Wiederherstellen** steht in jeder archivierten Zeile, an derselben Stelle wie Archivieren in einer aktiven Zeile. Es setzt das Profil wieder auf aktiv und zeichnet die Änderung auf. Agenten, die noch auf das Profil verweisen, übernehmen seine Zeilen wieder, und Sie können es wie zuvor bearbeiten oder zuordnen. Das Profil behält seinen Schlüssel, solange es archiviert ist, daher wird ein neues Profil mit demselben Schlüssel abgelehnt. Stellen Sie das bestehende Profil wieder her, um diesen Schlüssel erneut zu verwenden.

---

## Wie ein Profil mit einem Agenten verbunden wird

Profile befinden sich hier, werden aber pro Agent über die Registerkarte **Einstellungen** dieses Agenten aktiviert, im Abschnitt **Ziel** (siehe [Agent-Arbeitsbereich](agents-workspace.md)). Solange Sie **Gemeinsamen Kontext verwenden** nicht einschalten, ist das auch alles, was Sie dort sehen: der Schalter und eine einzeilige Beschreibung. Schalten Sie ihn ein, erscheinen die Profilauswahl, eine Verknüpfung **+ Neues Profil**, um direkt eines anzulegen, und eine Vorschau der Zeilen des ausgewählten Profils. Wählen Sie ein Profil, und der Agent arbeitet damit; belassen Sie es bei **Kein Profil ausgewählt**, läuft der Agent ohne jeglichen gemeinsamen Kontext.

Da die Verknüpfung eine Referenz ist, kann ein Profil viele Agenten gleichzeitig versorgen, und das Aktualisieren des Profils aktualisiert sie alle. Das Lösen eines Agenten (oder das Archivieren seines Profils) entzieht diesem Agenten lediglich die Hinweise; an den übrigen Nutzern des Profils ändert sich nichts.

---

## Der zentrale Vorbehalt: Hinweise, keine Quelle

Gemeinsamer Kontext und [Wissensbibliotheken](knowledge.md) speisen beide einen Agenten, erfüllen aber grundlegend verschiedene Aufgaben, und sie zu verwechseln ist hier der häufigste Fehler.

- **Gemeinsamer Kontext** prägt, *wie* sich ein Agent verhält: seinen Ton, seine Annahmen über Ihre Umgebung, seine harten „Niemals tun"-Regeln. Seine Zeilen werden in einer Antwort **niemals zitiert** und gewähren dem Agenten **keinen neuen Datenzugriff**. Sie sind Steuerung, kein Beleg.
- **Wissensbibliotheken** sind das, *was* ein Agent zitieren kann. Ihre Ergebnisse WERDEN im Entwurf der Antwort zitiert, sodass der Anfragende die Quelle hinter einer Antwort sehen kann.

Die praktische Regel: Wenn der Agent einen Fakt nennen und dafür einstehen soll (eine Richtlinie, ein Verfahren, eine bestimmte Konfiguration), dann hinterlegen Sie diesen Fakt in einer Wissensbibliothek, damit er zitiert werden kann. Reservieren Sie den gemeinsamen Kontext für dauerhafte Hinweise und Leitplanken, die nicht als zitierte Quelle erscheinen sollen. Und da eine Kontextzeile keine Berechtigung ist, gewährt der Eintrag „Der Agent darf Abrechnungstickets schließen" in einem Profil nichts: echte Berechtigungen und Automatisierung werden je Aktionstyp in den eigenen Einstellungen des Agenten und über den Freigabeprozess geregelt.

---

## Tipps

- Halten Sie Zeilen kurz, im Imperativ und auf jeweils einen Gedanken beschränkt. „Niemals nach Passwörtern fragen." lässt sich zuverlässiger lesen und anwenden als ein Absatz, der mehrere Regeln zusammenfasst.
- Stellen Sie Ihre harten „Niemals"-Regeln an den Anfang: die Leitplanken, deren Einhaltung Ihnen am wichtigsten ist, sollten Sie klar und früh benennen.
- Bevorzugen Sie eine kleine Zahl breit einsetzbarer Profile (zum Beispiel eine unternehmensweite Grundlage) gegenüber vielen nahezu identischen Profilen. Wenige Profile lassen sich leichter aktuell halten, und Änderungen erreichen alle zugeordneten Agenten auf einmal.
- Schmuggeln Sie hier keine zitierbaren Fakten ein. Alles, was ein Anfragender mit einer Quelle zitiert sehen soll, gehört in eine [Wissensbibliothek](knowledge.md).
- Bevor Sie ein gemeinsam genutztes Profil archivieren, notieren Sie, welche Agenten es verwenden, und verweisen Sie diese zuerst um; sonst laufen sie nach dem Archivieren ohne gemeinsamen Kontext, bis Sie das erledigt haben.
- **Wiederherstellen** setzt ein archiviertes Profil wieder auf aktiv. Agenten, die noch darauf verweisen, verwenden seine Zeilen wieder.
- Die **Beschreibung** ist nur für Sie bestimmt und erreicht den Agenten nie; nutzen Sie sie, um festzuhalten, wer das Profil verantwortet oder wofür es dient, damit ein Kollege später nicht raten muss.
