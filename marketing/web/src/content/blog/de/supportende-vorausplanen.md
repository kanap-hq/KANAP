---
title: "Supportende vorausplanen"
description: "Windows Server 2012, SQL Server 2016, Ubuntu 20.04: Das Supportende ist bekannt, was davon abhängt, selten. Der Supportende-Bericht von KANAP nennt die betroffenen Server und Anwendungen, früh genug, um die Migration einzuplanen."
date: 2026-11-07
topic: mapping
features: [it-landscape]
author: Friedrich
authorRole: Gründer, CIO
draft: false
translationKey: anticipate-end-of-support
---

Oktober 2023: Windows Server 2012 fällt aus dem erweiterten Support. Viele CIOs haben es durch ein Audit erfahren, oder durch das Angebot für den kostenpflichtigen erweiterten Support. Das Datum war seit Jahren bekannt. Was fehlte, war die Liste der Anwendungen, die noch darauf liefen, und damit die Kosten ihrer Migration.

Das gilt für jede Version eines Betriebssystems, einer Datenbank, eines Hypervisors oder einer Hardware. Zu wissen, dass eine Version ihr Supportende erreicht, genügt nicht. Man muss wissen, was sie trägt und wer dafür verantwortlich ist, und das früh genug, damit die Migration ins Budget des Jahres passt.

So geht KANAP damit um: eine Ansicht aller Fristen, was jede davon betrifft, und die Liste der Daten, die zu ergänzen sind, damit die Antwort stimmt.

## Eine Ansicht, vier Arten von Fristen

![Die Ansicht Fristen des Supportende-Berichts, auf 24 Monate: Betriebssysteme, Datenbanken, Anwendungen und Hardware.](/screenshots/end-of-support-deadlines-2026-11-07.png)

Der Bericht öffnet sich über **IT-Landschaft > Supportende**. Seine Ansicht Fristen vereint vier Arten von Fristen:

- **Technologien**: eine Version, die auf einem Server im Einsatz ist oder von einer Anwendung deklariert wird. SQL Server 2016, vSphere 7, Tomcat 9.
- **Betriebssysteme**: Windows Server, die Linux-Distributionen, AIX, im Einsatz auf Ihren Servern.
- **Anwendungen**: ihr eigenes Supportende, das der Hersteller für Ihre Version ankündigt.
- **Hardware**: das Lebensende eines physischen Geräts oder das Ende seines Supportvertrags.

Sie wählen den Zeitraum: 6, 12, 24 oder 36 Monate. Jede Zeile hat einen Status: ohne Support, erweiterter Support, endet bald. Was ausgemustert ist oder von nichts mehr genutzt wird, erscheint nicht.

Die Daten haben zwei Quellen. Die der Technologien und Betriebssysteme stammen aus dem Katalog, gespeist von endoflife.date und von den Herstellerseiten, die KANAP auswertet: Niemand erfasst sie, und sie ziehen nach, wenn ein Hersteller sie verschiebt. Die der Anwendungen und der Hardware stammen aus Ihren Datensätzen: das Supportende, das in der Anwendung erfasst ist, das Lebensende oder das Ende des Supportvertrags, das im Asset erfasst ist. Der Artikel [Technologien: die Verbindung zwischen Servern und Anwendungen](/de/blog/technologien-die-verbindung-zwischen-servern-und-anwendungen) erklärt, wie dieser Katalog gepflegt wird.

## Was jede Frist betrifft

![Eine aufgeklappte Zeile: die Server, die die Version tragen, und die Anwendungen, die davon abhängen.](/screenshots/end-of-support-impact-2026-11-07.png)

Jede Zeile zeigt zwei Zähler, Server und Anwendungen. Ein Klick klappt sie auf: Die Namen erscheinen, und jeder öffnet seinen Datensatz.

KANAP folgt dafür den Verknüpfungen der IT-Landschaft:

- **Eine Technologieversion** betrifft die Server, auf denen sie installiert ist, und die Anwendungen, die sie deklarieren oder auf diesen Servern laufen, virtuelle Maschinen eingeschlossen.
- **Ein physischer Server** am Lebensende betrifft die Maschinen, die er hostet, und die Anwendungen, die auf all diesen bereitgestellt sind.
- **Ein Cluster** zählt seine Mitglieder: Ein auf dem Cluster installierter SQL Server betrifft jeden seiner Knoten. Der Artikel [Server-Cluster in der KANAP-Kartografie](/de/blog/server-cluster-in-der-kanap-kartografie) beschreibt diese Regeln.

Die Antwort endet also nicht bei „Ubuntu 20.04 ist ohne Support“. Sie nennt die Server und Anwendungen, die davon abhängen, und jeder Anwendungsdatensatz nennt den Verantwortlichen und die Kritikalität. Die Diskussion über die Migration beginnt mit den richtigen Leuten.

## Mit dem anfangen, was fehlt

![Die Ansicht Fehlende Daten: die Datensätze, die zu ergänzen sind, damit die Fristen stimmen.](/screenshots/end-of-support-missing-data-2026-11-07.png)

Ein Bericht ist nur so richtig wie seine Daten. Ein Server ohne seine Technologien taucht nie in den Fristen auf, eine Version ohne Datum ebenso wenig. Deshalb hat der Bericht eine zweite Ansicht, Fehlende Daten, die auflistet, was ihn an einer Antwort hindert:

- ein Datenbankserver, der keine Datenbanktechnologie trägt;
- eine Anwendung, die SSO nutzt, ohne Identitätstechnologie;
- ein Server oder eine Anwendung, die eine Technologie nutzt, ohne die Version anzugeben;
- eine virtuelle Maschine ohne Host.

Jede Zeile öffnet den zu ergänzenden Datensatz. Für den Einstieg ist das der nützlichste Teil: Er zeigt, wo die Kartografie noch Lücken hat.

KANAP scannt Ihre Server nicht. Es kennt, was Sie dort deklariert haben, von Hand, per CSV-Datei oder über Netbox.

## Vom Bericht zum Budget

Eine Migration für das nächste Jahr braucht ihr Budget in diesem Jahr. Stellen Sie die Ansicht bei der Budgetplanung auf 24 Monate: Was in diesem Zeitraum endet, muss jetzt beziffert werden.

Der Export als CSV oder Excel liefert die Liste für die Budgetentscheidung. Plaid, der in KANAP integrierte Assistent, antwortet auch direkt: „Welche Anwendungen erreichen in den nächsten sechs Monaten ihr Supportende?“

Ist die Migration beschlossen, findet sie im selben Werkzeug ihren Platz: eine [Budgetzeile](/de/features/budget) oder ein Projekt, verknüpft mit der Technologie, dem Server oder den betroffenen Anwendungen. Diese Verknüpfung wird von Hand angelegt; danach lässt sich im Datensatz der Technologie ablesen, was ihre Migration kostet.

## Wo Sie anfangen

1. **Öffnen Sie Fehlende Daten** und ergänzen Sie die gemeldeten Datensätze.
2. **Stellen Sie die Ansicht Fristen auf 24 Monate.**
3. **Klappen Sie die ersten drei Zeilen auf** und benennen Sie für jede Migration einen Verantwortlichen.

Um den Bericht mit realistischen Daten zu sehen, bietet eine kostenlose 14-tägige Testphase unserer gehosteten Version Zugang zu den Beispieldaten der fiktiven Gruppe Fromage & Co, in einer Minute geladen. KANAP ist vollständig Open Source: Sie können es auch kostenlos auf Ihren eigenen Servern installieren.
