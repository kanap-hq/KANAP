# On-Premise: Microsoft Entra SSO-Einrichtung

Dieser Leitfaden erklärt, wie Sie Microsoft Entra (Azure AD) SSO für eine On-Premise KANAP-Bereitstellung aktivieren.
Entra SSO ist optional; wenn Sie es nicht konfigurieren, bleibt die lokale E-Mail/Passwort-Authentifizierung verfügbar.

## Übersicht

KANAP verwendet den OAuth2/OIDC-Autorisierungscode-Flow als vertraulicher Client.
Jeder On-Premise-Kunde **muss seine eigene Entra-Anwendung registrieren** und deren Client-ID/Secret bereitstellen.

### Was der Kunde bereitstellt

- Eine Entra App-Registrierung **in seinem Mandanten**
- `ENTRA_CLIENT_ID` und `ENTRA_CLIENT_SECRET`
- `ENTRA_AUTHORITY`, die auf seinen Mandanten zeigt
- `ENTRA_REDIRECT_URI`, die mit seiner KANAP-URL übereinstimmt

## Voraussetzungen

- Eine öffentliche HTTPS-URL für KANAP (Reverse Proxy vor der API)
- Fähigkeit, eine App-Registrierung zu erstellen und Admin-Zustimmung in Entra zu erteilen
- Ausgehende Konnektivität vom KANAP-API-Container zu:
  - `login.microsoftonline.com` (OIDC-Metadaten, Token-Austausch, JWKS)
  - `graph.microsoft.com` (Profilanreicherung bei der Anmeldung und tägliche Verzeichnissynchronisierung)

## Schritt 1: App-Registrierung erstellen (Entra)

1. Öffnen Sie **Microsoft Entra ID > App-Registrierungen > Neue Registrierung**
2. Name: `KANAP (On-Prem)`
3. Unterstützte Kontotypen: **Einzelner Mandant** (empfohlen)
4. Umleitungs-URI (Web):
   `https://<ihre-kanap-domain>/api/auth/entra/callback`
5. Speichern und notieren:
   - **Anwendungs-ID (Client-ID)**
   - **Verzeichnis-ID (Mandanten-ID)**

## Schritt 2: Client-Secret erstellen

1. Gehen Sie zu **Zertifikate & Geheimnisse**
2. Erstellen Sie ein neues **Client-Secret**
3. Kopieren Sie den **Secret-Wert** (wird nur einmal angezeigt)

## Schritt 3: API-Berechtigungen

KANAP benötigt zwei Arten von Berechtigungen: delegierte Berechtigungen für die interaktive Anmeldung und eine Anwendungsberechtigung für die tägliche Verzeichnissynchronisierung.

### Delegierte Berechtigungen (Anmeldung)

Jede Anmeldeanfrage fordert bei Entra genau diese Bereiche an:

```
openid profile email offline_access User.Read
```

Fügen Sie alle fünf als **konfigurierte** Berechtigungen der App-Registrierung hinzu:

1. Öffnen Sie **App-Registrierungen > Ihre KANAP-App > API-Berechtigungen**
2. **Berechtigung hinzufügen > Microsoft Graph > Delegierte Berechtigungen**
3. Wählen Sie `openid`, `profile`, `email`, `offline_access` und `User.Read`
4. Klicken Sie auf **Berechtigungen hinzufügen**

`User.Read` erlaubt KANAP, das eigene Profil der angemeldeten Person aus Microsoft Graph zu lesen, um Name, Position, Telefonnummern, Abteilung und Unternehmen zu füllen. Behalten Sie diese Berechtigung. Sie ist eine eigenständige Berechtigung neben `User.Read.All` und keine ältere Version davon. Ohne sie werden Benutzer bei jeder Anmeldung zur Zustimmung aufgefordert oder die Anmeldung schlägt fehl.

!!! warning "Fügen Sie die OIDC-Bereiche hinzu, bevor Sie die Admin-Zustimmung erteilen"
    Eine mandantenweite Admin-Zustimmung überschreibt die Berechtigungsgewährung der App mit der Liste der **konfigurierten** Berechtigungen. `openid`, `profile`, `email` und `offline_access` stehen üblicherweise unter "Andere gewährte Berechtigungen" und sind nicht standardmäßig konfiguriert. Eine mandantenweite Zustimmung würde sie also entfernen und bestehende Anmeldungen unterbrechen. Das Azure-Portal zeigt diese Warnung selbst an. Fügen Sie zuerst die vier Bereiche als konfigurierte delegierte Berechtigungen hinzu und erteilen Sie dann die Zustimmung.

### Anwendungsberechtigung (tägliche Verzeichnissynchronisierung)

Die nächtliche Verzeichnissynchronisierung läuft ohne angemeldeten Benutzer und benötigt daher eine Anwendungsberechtigung:

1. **API-Berechtigungen > Berechtigung hinzufügen > Microsoft Graph > Anwendungsberechtigungen**
2. Wählen Sie **`User.Read.All`**
3. Klicken Sie auf **Berechtigungen hinzufügen**

`User.Read.All` deckt auch den Vorgesetzten jedes Kontos ab, den KANAP im Profil der Personen einträgt, die Mitwirkende sind. Dafür ist nichts weiter hinzuzufügen.

Die neue Zeile zeigt nun den Status **Nicht gewährt** mit einer orangefarbenen Warnung. Das ist zu erwarten. Die Berechtigung wird nutzbar, sobald ein Microsoft Entra-Administrator die mandantenweite Zustimmung erteilt. Das geschieht aus KANAP heraus in [Schritt 7](#schritt-7-die-tagliche-verzeichnissynchronisierung-autorisieren).

Wer macht was:

- **Gehostetes KANAP**: Der KANAP-Betreiber verwaltet die App-Registrierung und fügt die Berechtigung hinzu. Der Entra-Administrator des Kunden erteilt nur die Zustimmung.
- **On-Premise**: Die IT des Kunden verwaltet die App-Registrierung selbst, fügt also die Berechtigung hinzu und erteilt die Zustimmung.

### Wenn Sie keine Graph-Aufrufe bei der Anmeldung möchten

```
ENTRA_ENRICH_PROFILE=false
```

Damit wird nur der Microsoft Graph `/me`-Aufruf während der Anmeldung übersprungen. Namen und andere Profilfelder stammen dann allein aus dem ID-Token. Die tägliche Verzeichnissynchronisierung wird dadurch nicht deaktiviert, sie nutzt ihre eigene Anwendungsberechtigung.

## Schritt 4: KANAP-Umgebungsvariablen konfigurieren

Setzen Sie Folgendes in Ihrer On-Premise `.env`:

```bash
# Entra SSO (On-Prem)
ENTRA_CLIENT_ID=<anwendungs-client-id>
ENTRA_CLIENT_SECRET=<client-secret>
ENTRA_AUTHORITY=https://login.microsoftonline.com/<mandanten-id>
ENTRA_REDIRECT_URI=https://kanap.firma.de/api/auth/entra/callback
```

Hinweise:
- `ENTRA_AUTHORITY` sollte für On-Premise **mandantenspezifisch** sein.
- `ENTRA_REDIRECT_URI` muss **exakt** mit dem übereinstimmen, was Sie in Entra registriert haben.
- Stellen Sie sicher, dass `APP_BASE_URL` auf die genaue Adresse gesetzt ist, die Benutzer öffnen (Schema, Host und Port, wenn er nicht dem Standard entspricht). Die Post-Login-Umleitung wird daraus erstellt. Ohne sie antwortet die Microsoft-Anmeldung mit „application URL is not configured“.

## Schritt 5: KANAP neustarten

Nach der Aktualisierung von `.env` starten Sie Ihre Container neu, damit die API die neue Konfiguration übernimmt.

## Schritt 6: Entra in KANAP verbinden

1. Als Admin anmelden
2. Gehen Sie zu **Administration > Authentifizierung**
3. Klicken Sie in der Karte **Microsoft Entra ID** auf **Verbinden**
4. Zustimmung in Entra erteilen
5. Verwenden Sie **Anmeldung testen**, um die End-to-End-Anmeldung zu bestätigen

## Schritt 7: Die tägliche Verzeichnissynchronisierung autorisieren

Der Block **Tägliche Verzeichnissynchronisierung** erscheint unter **Administration > Authentifizierung**, sobald Entra verbunden ist. Bis ein Microsoft Entra-Administrator ihn genehmigt, zeigt der Block:

> Noch nicht autorisiert. Ein Microsoft Entra-Administrator muss KANAP die Berechtigung erteilen, Verzeichnisbenutzer zu lesen.

So genehmigen Sie sie:

1. Melden Sie sich bei KANAP als Admin an, der zugleich Microsoft Entra-Administrator ist
2. Gehen Sie zu **Administration > Authentifizierung > Tägliche Verzeichnissynchronisierung**
3. Klicken Sie auf **Zugriff in Microsoft Entra gewähren**
4. Genehmigen Sie die Anfrage auf der Zustimmungsseite von Microsoft

Sie kehren zu KANAP zurück und sehen die Meldung **Zugriff gewährt. Die erste Synchronisierung läuft.** Die Zeile "Noch nicht autorisiert" verschwindet.

Sie können die Zustimmung auch im Azure-Portal mit **Administratorzustimmung für &lt;Mandant&gt; erteilen** auf der Seite mit den API-Berechtigungen erteilen. KANAP bemerkt das dann erst bei der nächsten Synchronisierung. Klicken Sie auf **Jetzt synchronisieren**, um sofort zu prüfen. Da KANAP sein Microsoft-Token zwischenspeichert, kann der erste Versuch direkt nach einer Zustimmung im Portal noch "nicht autorisiert" melden. Klicken Sie erneut auf **Jetzt synchronisieren** und es funktioniert. Der nächtliche Lauf erholt sich in jedem Fall von selbst.

## Die tägliche Verzeichnissynchronisierung

Nach der Autorisierung kontaktiert KANAP jede Nacht um 03:00 Uhr Serverzeit Microsoft Graph und führt für jeden mit Entra verknüpften Benutzer Folgendes aus:

- Aktualisiert Vorname, Nachname, Position, Geschäftstelefon, Mobiltelefon
- Gleicht Abteilung und Unternehmen aus dem Verzeichnis **nach Namen** mit bestehenden KANAP-Datensätzen ab. Es wird nichts automatisch angelegt, und ein Name ohne Treffer lässt die Zuordnung unverändert.
- Setzt die Oberflächensprache nur, wenn die Person keine gewählt hat
- Deaktiviert das KANAP-Konto, wenn die Person aus dem Verzeichnis entfernt wurde oder ihr Verzeichniskonto deaktiviert wurde (`accountEnabled` ist false)

Leere Verzeichniswerte löschen niemals Daten, die bereits in KANAP vorhanden sind.

Das Deaktivieren eines Kontos meldet die Person sofort ab und verhindert jede weitere Anmeldung. Ihre Daten und ihr Verlauf bleiben erhalten.

Der Block unter **Administration > Authentifizierung** meldet das Ergebnis: **Zuletzt synchronisiert {Datum} — N Konten aktualisiert, N deaktiviert.** nach einem erfolgreichen Lauf, sonst **Die letzte Synchronisierung ist fehlgeschlagen: {Meldung}**. **Jetzt synchronisieren** startet denselben Vorgang bei Bedarf.

## Fehlerbehebung

- **SSO_NOT_CONFIGURED**: Entra-Umgebungsvariablen fehlen oder Mandant ist nicht verbunden. Benutzer sehen "Die Anmeldung mit Microsoft ist für diesen Arbeitsbereich nicht eingerichtet."
- **ENTRA_TENANT_MISMATCH**: Sie haben einen Mandanten verbunden, versuchen sich aber von einem anderen anzumelden. Benutzer sehen "Dieses Microsoft-Konto gehört zu einer anderen Organisation als der mit diesem Arbeitsbereich verbundenen."
- **ENTRA_EMAIL_UNVERIFIED**: Die E-Mail-Adresse des Microsoft-Kontos ist nicht verifiziert und kann daher nicht zur Anmeldung verwendet werden.
- **Invalid Entra state / nonce**: Der Anmeldestatus ist abgelaufen oder die Entra-Weiterleitung ist nicht zur konfigurierten Callback-URL zurückgekehrt. Versuchen Sie die Anmeldung erneut und prüfen Sie, dass `ENTRA_REDIRECT_URI` exakt mit der Entra-App-Registrierung übereinstimmt.
- **Fehlerhafte Umleitung nach Anmeldung**: Prüfen Sie, ob `APP_BASE_URL` die genaue Adresse ist, die Benutzer öffnen. Die Umleitung stammt aus `APP_BASE_URL`, und die Header `Host` und `X-Forwarded-Host` ändern sie nicht. Prüfen Sie außerdem, ob der Proxy `X-Forwarded-Proto` sendet.
- **"Noch nicht autorisiert" bei der Verzeichnissynchronisierung**: Entweder wurde die Anwendungsberechtigung `User.Read.All` nie zur App-Registrierung hinzugefügt, oder ein Microsoft Entra-Administrator hat die mandantenweite Zustimmung noch nicht erteilt. Prüfen Sie beides und klicken Sie dann auf **Jetzt synchronisieren**.
- **Anmeldungen schlagen direkt nach dem Erteilen der Admin-Zustimmung fehl**: Die Zustimmung hat die Berechtigungsgewährung der App durch die Liste der konfigurierten Berechtigungen ersetzt und dabei `openid`, `profile`, `email` und `offline_access` entfernt. Fügen Sie diese als konfigurierte delegierte Berechtigungen hinzu und erteilen Sie die Zustimmung erneut.
- **Abgelaufenes Client-Secret**: Microsoft gibt `AADSTS7000222` zurück. Benutzer sehen auf der Anmeldeseite nur die allgemeine Meldung "Die Anmeldung mit Microsoft wurde nicht abgeschlossen. Versuchen Sie es erneut oder wenden Sie sich an Ihren Administrator." Um die Ursache zu bestätigen, sehen Sie unter **Administration > Authentifizierung > Tägliche Verzeichnissynchronisierung** nach: Die Fehlerzeile nennt den Microsoft-Fehlercode. Ein erneutes **Verbinden** zeigt ihn ebenfalls. Erstellen Sie ein neues Client-Secret unter **Zertifikate & Geheimnisse**, aktualisieren Sie `ENTRA_CLIENT_SECRET` und starten Sie die API neu.

## Sicherheitshinweise

- Committen Sie `ENTRA_CLIENT_SECRET` nie in Git.
- Rotieren Sie das Secret regelmäßig.
- Verwenden Sie eine dedizierte App-Registrierung.
