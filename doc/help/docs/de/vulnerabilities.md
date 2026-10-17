# Schwachstellen

Die Seite Schwachstellen listet die veröffentlichten Schwachstellen (CVE), die die Versionen Ihrer Technologien im Einsatz betreffen, und was jede erreicht: die Server, die eine betroffene Version tragen, und die Anwendungen, die sie nutzen. Sie prüfen jede Schwachstelle und halten fest, was Sie dagegen unternommen haben.

Öffnen Sie sie über **IT-Landschaft > Schwachstellen**, in der Gruppe **Betrieb**. Sie benötigen `infrastructure:reader` zum Ansehen und `infrastructure:member` zum Ändern eines Status. Die Anzahlen und Listen der Anwendungen erscheinen nur, wenn Sie auch Anwendungen lesen dürfen.

## Verfügbarkeit

In der Cloud werden Schwachstellen standardmäßig verfolgt. Bei einer On-Premise-Installation sind sie aus, bis Ihr Administrator sie einschaltet; der Server muss dann die NVD (die US-amerikanische National Vulnerability Database) oder einen Spiegel davon erreichen. Solange sie aus sind, zeigt KANAP nichts davon: keine Seite, keine Spalte in der Technologieliste, keinen Abschnitt bei einer Technologie, keine Benachrichtigungseinstellung und keine E-Mail.

## Wie KANAP sie findet

KANAP liest alle 6 Stunden die von der NVD veröffentlichten Schwachstellen und vergleicht sie mit Ihren Technologien:

- **Produkte**: Eine Technologie wird über ihre CPE-Produktkennungen verglichen (siehe [Technologien](technologies.md#ubersicht)). Eine Technologie ohne Kennung erhält keine Schwachstelle. Außer Betrieb genommene Technologien bleiben außen vor.
- **Versionen**: Nur die Versionen im Einsatz zählen: installiert auf einem Server in Betrieb oder genutzt von einer Anwendung in Betrieb.
- **Versionsnummern**: Versionen werden über ihre Zahlen verglichen, Teil für Teil. `2016 SP3` zählt als 2016 und `19c` als 19. Eine Version mit weniger als drei Zahlen steht für ihren ganzen Zweig: `9.0` umfasst alle `9.0.x`. Eine Version, die KANAP nicht vergleichen kann, etwa eine Bezeichnung ohne Zahl, gilt als betroffen.
- **Unbekannte Version**: Ein Server oder eine Anwendung ohne Version ist potenziell von jeder Schwachstelle des Produkts betroffen. Die Zeile lautet „Version nicht erfasst (möglicherweise betroffen)“.

Manche Schwachstellen gelten nur, wenn zwei Produkte zusammen laufen, zum Beispiel Tomcat unter Windows. KANAP zeigt sie für das verwundbare Produkt allein, sodass eine Schwachstelle bei einer Installation erscheinen kann, die sie nicht betrifft. Markieren Sie sie als **Nicht betroffen**.

Eine Schwachstelle, die die NVD noch nicht analysiert hat, erscheint, sobald sie analysiert ist. Eine Änderung an Kennungen, Versionen, Servern oder Anwendungen einer Technologie wird bei der nächsten Prüfung berücksichtigt, oder sofort mit **Erneut abgleichen** bei der Technologie.

## Die Liste

Eine Zeile pro Schwachstelle, die schwerste zuerst. Die Seite öffnet sich mit den Schwachstellen **Zu prüfen**.

**Filter**:

- **Schweregrad**, **Status**, **Hersteller** und **Technologie**: ein Wert oder **Alle**.
- **Veröffentlicht**: **Jederzeit** oder die letzten 30, 90 oder 365 Tage.
- **Suche**: die CVE-Kennung, die Zusammenfassung oder der Technologiename.

**Spalten**:

| Spalte | Was sie zeigt |
|---|---|
| **CVE** | Die Kennung der Schwachstelle, zum Beispiel `CVE-2024-1234` |
| **Schweregrad** | **Kritisch**, **Hoch**, **Mittel**, **Niedrig**, **Keine** oder **Nicht bewertet**, mit dem CVSS-Wert |
| **Zusammenfassung** | Die Beschreibung der NVD |
| **Technologien** | Die betroffenen Technologien und Versionen |
| **Server** | Wie viele Server eine betroffene Version tragen, direkt oder über den Server, in dem sie laufen |
| **Anwendungen** | Wie viele Anwendungen eine betroffene Version nutzen, gehostet oder deklariert |
| **Status** | **Zu prüfen**, solange eine Version noch zu prüfen ist, **Nicht betroffen**, wenn alle es sind, sonst **Behandelt** |
| **Veröffentlicht** | Das Veröffentlichungsdatum |

**Mehr anzeigen** lädt die nächsten Zeilen.

## Eine Schwachstelle prüfen

Ein Klick auf eine Zeile öffnet sie. Sie sehen:

- Die Zusammenfassung, den CVSS-Vektor und die Referenzlinks (Herstellerhinweise, Patches).
- **Technologien und Versionen**: jede betroffene Version mit ihrem **Status** und einer Notiz.
- **Server**: jeder Server, der eine betroffene Version trägt, mit Technologie, Version und dem Server, in dem er läuft.
- **Anwendungen**: jede Anwendung, die eine betroffene Version nutzt, mit ihrem Server.

Legen Sie den Status jeder Version fest:

| Status | Bedeutung |
|---|---|
| **Zu prüfen** | Niemand hat sie bisher angesehen |
| **Behandelt** | Die Version ist gepatcht, oder ein Workaround ist eingerichtet |
| **Nicht betroffen** | Die Schwachstelle gilt nicht für Ihre Installation |

Die Notiz hält fest, wie, zum Beispiel „am 12. März gepatcht, Change CHG-123“. Sie wird gespeichert, wenn Sie das Feld verlassen. Das Audit-Log hält fest, wer einen Status geändert hat und wann.

KANAP ändert nie einen Status, den Sie gewählt haben. Wenn eine Version nicht mehr passt (Sie haben sie aktualisiert, die Technologie wurde außer Betrieb genommen, die NVD hat ihre Daten geändert), verschwindet eine Zeile, die noch **Zu prüfen** ist. Eine geprüfte Zeile bleibt, ausgegraut, mit ihrem Status; sie kehrt unverändert zurück, wenn die Version wieder passt.

## Export

**Tabelle als CSV exportieren** lädt die Schwachstellen herunter, die den Filtern entsprechen, eine Zeile pro Technologieversion und Schwachstelle, in der Sprache Ihres Bildschirms. Ab 10.000 Schwachstellen grenzen Sie die Filter zuerst ein.

## E-Mail-Benachrichtigungen

Nach jeder Prüfung erhalten die IT-Verantwortlichen einer Technologie eine E-Mail über ihre neuen kritischen oder hohen Schwachstellen, die noch zu prüfen sind:

- **Was gemeldet wird**: eine Schwachstelle, die in den letzten 30 Tagen veröffentlicht wurde, zu einem Produkt, mit dem die Technologie bereits verglichen wurde, oder eine bekannte Schwachstelle, die gerade kritisch oder hoch geworden ist.
- **Was nicht**: Der erste Vergleich einer Technologie, oder einer gerade hinzugefügten CPE-Kennung, bleibt still. Seine Ergebnisse warten auf dieser Seite.
- **Wie viel**: höchstens 25 Zeilen, eine pro Technologie und Schwachstelle, dann ein Link zur Seite für den Rest.
- **Wie oft**: Jede Person erfährt von einer Schwachstelle einer Technologie einmal. Eine Schwachstelle, die bei ihrer Prüfung nicht gemeldet wurde, wird auch später nicht gemeldet.

Empfänger sind die IT-Verantwortlichen der Technologie, deren Konto aktiv ist und die die Infrastruktur lesen dürfen. Jeder kann diese E-Mails unter **Technologie-Benachrichtigungen** in seinen Benachrichtigungseinstellungen abschalten. Siehe [Einstellungen](admin.md#benachrichtigungen). Solange der E-Mail-Versand auf Ihrer Installation nicht eingerichtet ist, geht keine E-Mail hinaus.

## Wo Schwachstellen außerdem erscheinen

- **Technologieliste**: die Spalte **Zu prüfende Schwachstellen**, orange, wenn kritische oder hohe darunter sind. Siehe [Technologien](technologies.md#mit-der-liste-arbeiten).
- **Technologie-Arbeitsbereich**: der Abschnitt **Schwachstellen** im Reiter Beziehungen. Siehe [Technologien](technologies.md#schwachstellen).

## Tipps

- **CPE-Kennungen ausfüllen**: Technologien aus dem Katalog bringen sie mit. Für die anderen suchen Sie das Produkt im CPE-Wörterbuch des NIST.
- **Versionen erfassen**: Ein Server oder eine Anwendung ohne Version ist potenziell von allem betroffen, was die tatsächliche Gefährdung verdeckt.
- **Die Notiz schreiben**: Wer die Schwachstelle als Nächstes liest, sieht, was getan wurde.
