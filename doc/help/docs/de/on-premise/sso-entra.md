# On-Premise: Einrichtung von Microsoft Entra SSO

Dieser Leitfaden erklärt, wie Sie Microsoft Entra (Azure AD) SSO für eine On-Premise-Bereitstellung von KANAP aktivieren.
Entra SSO ist optional; wenn Sie es nicht konfigurieren, bleibt die lokale Anmeldung mit E-Mail-Adresse und Passwort verfügbar.

## Übersicht

KANAP verwendet den OAuth2/OIDC-Autorisierungscode-Flow als vertraulicher Client.
Jeder On-Premise-Kunde **muss seine eigene Entra-Anwendung registrieren** und deren Client-ID und Secret bereitstellen.

### Was der Kunde bereitstellt

- Eine Entra-App-Registrierung **in seinem eigenen Mandanten**
- `ENTRA_CLIENT_ID` und `ENTRA_CLIENT_SECRET`
- `ENTRA_AUTHORITY`, das auf seinen Mandanten zeigt
- `ENTRA_REDIRECT_URI`, passend zu seiner KANAP-URL

## Voraussetzungen

- Eine HTTPS-Adresse für KANAP, die die Browser Ihrer Benutzer erreichen (Reverse Proxy vor der API). Ein interner Name funktioniert: Microsoft leitet nur den Browser des Benutzers dorthin weiter.
- Die Möglichkeit, in Entra eine App-Registrierung anzulegen und die Administratorzustimmung zu erteilen
- Ausgehende Verbindungen vom KANAP-API-Container zu:
  - `login.microsoftonline.com` (OIDC-Metadaten, Token-Austausch, JWKS)
  - `graph.microsoft.com` (Profilanreicherung bei der Anmeldung und die tägliche Verzeichnissynchronisierung)

## Schritt 1: App-Registrierung erstellen (Entra)

1. Öffnen Sie **Microsoft Entra ID → App registrations → New registration**
2. Name: `KANAP (on-prem)`
3. Unterstützte Kontotypen: **Single tenant** (empfohlen)
4. Umleitungs-URI (Web): `https://<your-kanap-domain>/api/auth/entra/callback`
5. Speichern Sie und notieren Sie:
   - **Application (client) ID**
   - **Directory (tenant) ID**

## Schritt 2: Client-Secret erstellen

1. Gehen Sie zu **Certificates & secrets**
2. Erstellen Sie ein neues **Client secret**
3. Kopieren Sie den **Wert des Secrets** (er wird nur einmal angezeigt)

## Schritt 3: API-Berechtigungen

KANAP benötigt zwei Gruppen von Berechtigungen: delegierte Berechtigungen für die interaktive Anmeldung und eine Anwendungsberechtigung für die tägliche Verzeichnissynchronisierung.

### Delegierte Berechtigungen (Anmeldung)

Jede Anmeldeanfrage fordert bei Entra genau diese Scopes an:

```
openid profile email offline_access User.Read
```

Fügen Sie alle fünf als **konfigurierte** Berechtigungen zur App-Registrierung hinzu:

1. Öffnen Sie **App registrations → Ihre KANAP-App → API permissions**
2. **Add a permission → Microsoft Graph → Delegated permissions**
3. Wählen Sie `openid`, `profile`, `email`, `offline_access` und `User.Read`
4. Klicken Sie auf **Add permissions**

`User.Read` erlaubt KANAP, das eigene Profil der angemeldeten Person aus Microsoft Graph zu lesen, um Name, Position, Telefonnummern, Abteilung und Unternehmen auszufüllen. Behalten Sie die Berechtigung. Sie ist eine eigenständige Berechtigung, unabhängig von `User.Read.All`. Ohne sie werden Benutzer bei jeder Anmeldung um Zustimmung gebeten, oder die Anmeldung schlägt fehl.

!!! warning "Fügen Sie die OIDC-Scopes hinzu, bevor Sie die Administratorzustimmung erteilen"
    Die mandantenweite Administratorzustimmung schreibt die Berechtigungen der App gemäß der Liste der **konfigurierten** Berechtigungen neu. `openid`, `profile`, `email` und `offline_access` stehen meist unter "Other permissions granted" und sind standardmäßig nicht konfiguriert. Eine mandantenweite Zustimmung würde sie daher entfernen und bestehende Anmeldungen unterbrechen. Das Azure-Portal zeigt diese Warnung selbst an. Fügen Sie die vier Scopes zuerst als konfigurierte delegierte Berechtigungen hinzu und erteilen Sie dann die Zustimmung.

### Anwendungsberechtigung (tägliche Verzeichnissynchronisierung)

Die nächtliche Verzeichnissynchronisierung läuft ohne angemeldeten Benutzer und braucht daher eine Anwendungsberechtigung:

1. **API permissions → Add a permission → Microsoft Graph → Application permissions**
2. Wählen Sie **`User.Read.All`**
3. Klicken Sie auf **Add permissions**

`User.Read.All` deckt auch den Vorgesetzten jedes Kontos ab, den KANAP in das Mitwirkendenprofil der Personen schreibt, die Mitwirkende sind. Dafür ist nichts weiter hinzuzufügen.

Die neue Zeile zeigt jetzt den Status **Not granted** mit einer orangefarbenen Warnung. Das ist erwartet. Die Berechtigung wird nutzbar, sobald ein Microsoft Entra-Administrator die mandantenweite Zustimmung erteilt, was aus KANAP heraus in [Schritt 7](#schritt-7-die-tagliche-verzeichnissynchronisierung-autorisieren) geschieht.

Wer was tut:

- **Gehostetes KANAP**: Der Betreiber von KANAP besitzt die App-Registrierung und fügt die Berechtigung hinzu. Der Entra-Administrator des Kunden erteilt nur die Zustimmung.
- **On-Premise**: Die eigene IT des Kunden besitzt die App-Registrierung, fügt also die Berechtigung hinzu und erteilt die Zustimmung.

### Wenn Sie keine Graph-Aufrufe bei der Anmeldung möchten

```
ENTRA_ENRICH_PROFILE=false
```

Damit entfällt nur der Microsoft-Graph-Aufruf `/me` während der Anmeldung. Namen und andere Profilfelder stammen dann allein aus dem ID-Token. Die tägliche Verzeichnissynchronisierung bleibt eingeschaltet, sie verwendet ihre eigene Anwendungsberechtigung.

## Schritt 4: KANAP-Umgebungsvariablen konfigurieren

Setzen Sie Folgendes in Ihrer On-Premise-`.env`:

```bash
# Entra SSO (On-Premise): alle vier sind gemeinsam erforderlich
ENTRA_CLIENT_ID=<application-client-id>
ENTRA_CLIENT_SECRET=<client-secret>
ENTRA_AUTHORITY=https://login.microsoftonline.com/<tenant-id>
ENTRA_REDIRECT_URI=https://kanap.company.com/api/auth/entra/callback
```

Hinweise:
- `ENTRA_AUTHORITY` sollte On-Premise **mandantenspezifisch** sein.
- `ENTRA_REDIRECT_URI` muss **genau** dem in Entra registrierten Wert entsprechen.
- Stellen Sie sicher, dass `APP_BASE_URL` auf die genaue Adresse gesetzt ist, die Benutzer öffnen (Schema, Host und Port, wenn er nicht dem Standard entspricht). Die Weiterleitung nach der Anmeldung wird daraus gebaut. Ohne sie antwortet die Microsoft-Anmeldung mit "application URL is not configured".

## Schritt 5: KANAP neu starten

Erstellen Sie nach der Änderung von `.env` den API-Container neu, damit er die neue Konfiguration übernimmt. Ein einfaches `restart` behält die alten Werte.

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml up -d api
```

## Schritt 6: Entra in KANAP verbinden

1. Melden Sie sich als Administrator an
2. Gehen Sie zu **Administration → Authentifizierung**
3. Klicken Sie in der Karte **Microsoft Entra ID** auf **Verbinden**
4. Genehmigen Sie die Zustimmung in Entra
5. Bestätigen Sie mit **Anmeldung testen** die Anmeldung von Anfang bis Ende

## Schritt 7: Die tägliche Verzeichnissynchronisierung autorisieren

Der Block **Tägliche Verzeichnissynchronisierung** erscheint unter **Administration → Authentifizierung**, sobald Entra verbunden ist. Bis ein Microsoft Entra-Administrator ihn genehmigt, zeigt der Block:

> Noch nicht autorisiert. Ein Microsoft Entra-Administrator muss KANAP die Berechtigung erteilen, Verzeichnisbenutzer zu lesen.

So genehmigen Sie ihn:

1. Melden Sie sich bei KANAP als Administrator an, der zugleich Microsoft Entra-Administrator ist
2. Gehen Sie zu **Administration → Authentifizierung → Tägliche Verzeichnissynchronisierung**
3. Klicken Sie auf **Zugriff in Microsoft Entra gewähren**
4. Genehmigen Sie die Anfrage auf der Zustimmungsseite von Microsoft

Sie kehren zu KANAP zurück, mit der Meldung **Zugriff gewährt. Die erste Synchronisierung läuft.** Die Zeile "Noch nicht autorisiert" verschwindet.

Sie können die Zustimmung auch im Azure-Portal erteilen, mit **Grant admin consent for &lt;tenant&gt;** auf der Seite API permissions. KANAP bemerkt das dann erst bei der nächsten Synchronisierung. Klicken Sie auf **Jetzt synchronisieren**, um sofort zu prüfen. Da KANAP sein Microsoft-Token zwischenspeichert, kann der erste Versuch direkt nach einer Zustimmung im Portal noch "nicht autorisiert" melden. Klicken Sie erneut auf **Jetzt synchronisieren**, dann gelingt es. Der nächtliche Lauf erholt sich in jedem Fall von selbst.

## Die tägliche Verzeichnissynchronisierung

Nach der Autorisierung kontaktiert KANAP Microsoft Graph jede Nacht um 03:00 UTC (die Uhr des API-Containers) und führt für jeden mit Entra verknüpften Benutzer Folgendes aus:

- Aktualisiert Vorname, Nachname, Position, geschäftliche Telefonnummer und Mobiltelefonnummer
- Ordnet die Abteilung und das Unternehmen aus dem Verzeichnis **nach Namen** bestehenden KANAP-Datensätzen zu. Es wird nichts automatisch angelegt, und ein Name ohne Treffer lässt die Zuordnung unverändert.
- Setzt die Sprache der Oberfläche nur, wenn die Person keine gewählt hat
- Deaktiviert das KANAP-Konto, wenn die Person aus dem Verzeichnis entfernt wurde oder ihr Verzeichniskonto deaktiviert ist (`accountEnabled` ist false)

Leere Werte im Verzeichnis löschen niemals Daten, die bereits in KANAP stehen.

Das Deaktivieren eines Kontos meldet die Person sofort ab und sperrt jede weitere Anmeldung. Ihre Daten und ihr Verlauf bleiben erhalten.

Der Block unter **Administration → Authentifizierung** meldet das Ergebnis: **Zuletzt synchronisiert {date}: N Konten aktualisiert, N deaktiviert.** nach einem erfolgreichen Lauf, sonst **Die letzte Synchronisierung ist fehlgeschlagen: {message}**. **Jetzt synchronisieren** führt denselben Job auf Anforderung aus.

## Fehlerbehebung

- **SSO_NOT_CONFIGURED**: Die Entra-Umgebungsvariablen fehlen oder der Mandant ist nicht verbunden. Benutzer sehen "Die Anmeldung mit Microsoft ist für diesen Arbeitsbereich nicht eingerichtet."
- **ENTRA_TENANT_MISMATCH**: Sie haben einen Mandanten verbunden, versuchen aber, sich aus einem anderen anzumelden. Benutzer sehen "Dieses Microsoft-Konto gehört zu einer anderen Organisation als der mit diesem Arbeitsbereich verbundenen."
- **ENTRA_EMAIL_UNVERIFIED**: Die E-Mail-Adresse des Microsoft-Kontos ist nicht verifiziert und kann daher nicht zur Anmeldung verwendet werden.
- **Invalid Entra state / nonce**: Der Anmeldestatus ist abgelaufen, oder die Entra-Weiterleitung ist nicht zur konfigurierten Callback-URL zurückgekehrt. Wiederholen Sie die Anmeldung und prüfen Sie, dass `ENTRA_REDIRECT_URI` genau der Entra-App-Registrierung entspricht.
- **Falsche Weiterleitung nach der Anmeldung**: Prüfen Sie, dass `APP_BASE_URL` die genaue Adresse ist, die Benutzer öffnen. Die Weiterleitung stammt aus `APP_BASE_URL`, und die Header `Host` und `X-Forwarded-Host` ändern sie nicht. Prüfen Sie außerdem, dass der Proxy `X-Forwarded-Proto` sendet.
- **"Noch nicht autorisiert" bei der Verzeichnissynchronisierung**: Entweder wurde die Anwendungsberechtigung `User.Read.All` nie zur App-Registrierung hinzugefügt, oder ein Microsoft Entra-Administrator hat die mandantenweite Zustimmung noch nicht erteilt. Prüfen Sie beides und klicken Sie dann auf **Jetzt synchronisieren**.
- **Anmeldungen schlagen direkt nach der Administratorzustimmung fehl**: Die Zustimmung hat die Berechtigungen der App durch die Liste der konfigurierten Berechtigungen ersetzt und dabei `openid`, `profile`, `email` und `offline_access` entfernt. Fügen Sie diese als konfigurierte delegierte Berechtigungen hinzu und erteilen Sie die Zustimmung erneut.
- **Abgelaufenes Client-Secret**: Microsoft liefert `AADSTS7000222`. Benutzer sehen auf der Anmeldeseite nur die allgemeine Meldung "Die Anmeldung mit Microsoft wurde nicht abgeschlossen. Versuchen Sie es erneut oder wenden Sie sich an Ihren Administrator." Um die Ursache zu bestätigen, sehen Sie unter **Administration → Authentifizierung → Tägliche Verzeichnissynchronisierung** nach: Die Fehlerzeile nennt den Fehlercode von Microsoft. Auch ein erneutes **Verbinden** zeigt ihn. Erstellen Sie unter **Certificates & secrets** ein neues Client-Secret, aktualisieren Sie `ENTRA_CLIENT_SECRET` und erstellen Sie die API neu (`docker compose -f infra/compose.onprem.yml up -d api`).

## Sicherheitshinweise

- Committen Sie `ENTRA_CLIENT_SECRET` nicht in Git. Halten Sie `.env` nur für ihren Eigentümer lesbar (`chmod 600 .env`).
- Erneuern Sie das Secret regelmäßig.
- Verwenden Sie eine eigene App-Registrierung.
