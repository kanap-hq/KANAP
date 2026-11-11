import type { LegalContent } from './types';
import en from './en';

/* Deutsche Übersetzung der Datenschutzerklärung. Die französische Fassung
 * (fr.ts) ist maßgeblich: Jede Änderung erfolgt zuerst dort und wird dann
 * hierher übertragen. Nur die Datenschutzerklärung ist übersetzt; die
 * übrigen Dokumente (terms, sales, legal) bleiben die englische Fassung.
 */

const content: LegalContent = {
  ...en,
  privacy: {
    meta: {
      title: 'Datenschutzerklärung',
      description: 'Wie KANAP personenbezogene Daten gemäß der DSGVO erhebt, verwendet und schützt.',
    },
    header: {
      eyebrow: 'Rechtliches',
      title: 'Datenschutzerklärung',
      lastUpdated: 'Zuletzt aktualisiert: 11. November 2026',
    },
    body: `
<h2>Präambel</h2>
<p>KANAP (nachfolgend „KANAP“), eine SARL (Gesellschaft mit beschränkter Haftung), eingetragen im Handels- und Gesellschaftsregister (RCS) Saverne unter der Nummer 939 098 190, mit Sitz in 2, rue du Finhay, 67210 Obernai, Frankreich, misst dem Schutz Ihrer personenbezogenen Daten größte Bedeutung bei. Diese Datenschutzerklärung (nachfolgend die „Erklärung“) informiert Sie klar und transparent über die Verarbeitung personenbezogener Daten, die KANAP im Rahmen der Nutzung der Online-Plattform für IT-Management „Kadratis“ (nachfolgend „die Plattform“) durchführt.</p>
<p>KANAP verpflichtet sich, die Datenschutz-Grundverordnung (DSGVO) und das französische Gesetz Nr. 78-17 vom 6. Januar 1978 über Informatik, Dateien und Freiheiten in seiner geänderten Fassung einzuhalten.</p>

<h2>1. Verantwortlicher</h2>
<p>Verantwortlicher für die über die Plattform erhobenen personenbezogenen Daten ist KANAP, eine SARL (Gesellschaft mit beschränkter Haftung), eingetragen im Handels- und Gesellschaftsregister (RCS) Saverne unter der Nummer 939 098 190, mit Sitz in 2, rue du Finhay, 67210 Obernai, Frankreich.</p>
<p>Für die Daten, die Kunden in die Plattform eingeben (Budgetdaten, Finanzinformationen, Daten der Benutzer in den Kundenbereichen), handelt die Kundenorganisation als Verantwortlicher und KANAP als Auftragsverarbeiter.</p>

<h2>2. Erhobene personenbezogene Daten</h2>
<p>KANAP erhebt von den Benutzern der Plattform die folgenden personenbezogenen Daten:</p>
<ul>
  <li><strong>Kontoinformationen:</strong> Vorname, Nachname, E-Mail-Adresse, Funktion, Name der Organisation</li>
  <li><strong>Authentifizierungsdaten:</strong> Anmeldedaten (Passwörter werden gehasht und nie im Klartext gespeichert)</li>
  <li><strong>Nutzungsdaten:</strong> Nutzungsprotokolle der Plattform, Sitzungsinformationen, IP-Adressen</li>
  <li><strong>Finanzdaten:</strong> Budgetposten, CAPEX/OPEX-Daten, Verteilungsinformationen, von den Benutzern erfasste Vertragsdetails</li>
  <li><strong>Rechnungsinformationen:</strong> Firmenname, Rechnungsadresse, Umsatzsteuer-Identifikationsnummer</li>
  <li><strong>Kennenlerngespräch:</strong> wenn Sie eines vereinbaren, Ihr Name, Ihre E-Mail-Adresse, der gewählte Termin und die optionale Nachricht, die Sie hinterlassen</li>
</ul>
<p>Zahlungsinformationen (Kreditkartendaten) sind KANAP nicht bekannt. Sie werden direkt von der sicheren Zahlungsplattform (Stripe) verarbeitet.</p>

<h2>3. Zwecke der Verarbeitung</h2>
<ul>
  <li><strong>Bereitstellung des Dienstes:</strong> Die Daten sind erforderlich, um Zugang zur Plattform zu gewähren, Benutzerkonten zu verwalten und den IT-Management-Dienst zu erbringen.</li>
  <li><strong>Verbesserung des Dienstes:</strong> Die Nutzungsdaten dienen dazu, die Qualität und die Funktionen des Dienstes zu verbessern, technische Probleme zu erkennen und die Leistung zu optimieren.</li>
  <li><strong>Kundensupport:</strong> Die Daten dienen dazu, Anfragen der Benutzer zu beantworten, technische Unterstützung zu leisten und Probleme zu lösen.</li>
  <li><strong>Abrechnung:</strong> Die Daten sind erforderlich, um Abonnements zu verarbeiten, Rechnungen auszustellen und Zahlungen zu verwalten.</li>
  <li><strong>Sicherheit:</strong> Die Daten werden verarbeitet, um die Sicherheit der Plattform zu gewährleisten sowie Betrug, unbefugte Zugriffe und Sicherheitsvorfälle zu erkennen und zu verhindern.</li>
  <li><strong>Erfüllung gesetzlicher Pflichten:</strong> Die Daten werden verarbeitet, um gesetzliche und regulatorische Pflichten zu erfüllen.</li>
  <li><strong>Nachrichten der Testphase:</strong> während einer Testphase drei begleitende Nachrichten und die Mitteilung zum Ende der Testphase. Jede Nachricht enthält einen Abmeldelink.</li>
  <li><strong>Kennenlerngespräch:</strong> das von Ihnen gewünschte Gespräch organisieren.</li>
</ul>

<h2>4. Rechtsgrundlage der Verarbeitung</h2>
<ul>
  <li><strong>Vertragserfüllung:</strong> Die Verarbeitung ist für die Erbringung des Dienstes Kadratis erforderlich (Kontoverwaltung, Zugang zur Plattform usw.), einschließlich der Maßnahmen, die auf Ihre Anfrage vor einem Abonnement getroffen werden (Testphase, Kennenlerngespräch).</li>
  <li><strong>Berechtigtes Interesse:</strong> Die Verarbeitungen zur Verbesserung des Dienstes, zur Sicherheit und zur Betrugsprävention beruhen auf dem berechtigten Interesse von KANAP, einen hochwertigen und sicheren Dienst zu entwickeln und bereitzustellen, ebenso die Nachrichten der Testphase, von denen Sie sich jederzeit abmelden können.</li>
  <li><strong>Rechtliche Verpflichtung:</strong> Die Verarbeitung kann zur Erfüllung rechtlicher Verpflichtungen erforderlich sein (Buchführung, Steuern, Bekämpfung der Geldwäsche usw.).</li>
  <li><strong>Einwilligung:</strong> Für bestimmte optionale Funktionen oder Mitteilungen kann die Verarbeitung auf der ausdrücklichen Einwilligung des Benutzers beruhen.</li>
</ul>

<h2>5. Empfänger der Daten</h2>
<p>KANAP kann Ihre personenbezogenen Daten in folgenden Fällen weitergeben:</p>
<ul>
  <li><strong>Dienstleister:</strong> KANAP kann Dienstleister (Hosting, Infrastruktur, Zahlungsabwicklung, E-Mail-Dienste usw.) beauftragen, die im Rahmen ihrer Aufgaben Zugang zu personenbezogenen Daten haben können. Diese Dienstleister unterliegen Vertraulichkeits- und Sicherheitspflichten und handeln als Auftragsverarbeiter auf Weisung von KANAP.</li>
  <li><strong>Rechtliche Verpflichtungen:</strong> KANAP kann verpflichtet sein, personenbezogene Daten an Verwaltungs- oder Justizbehörden weiterzugeben, wenn das Gesetz dies verlangt.</li>
</ul>
<p>KANAP verpflichtet sich, die personenbezogenen Daten der Benutzer nicht zu anderen als den oben genannten geschäftlichen Zwecken weiterzugeben. KANAP wird Ihre personenbezogenen Daten niemals an Dritte verkaufen oder vermieten.</p>
<p>Die Dienstleister (Unterauftragsverarbeiter), die im Rahmen des Cloud-Dienstes personenbezogene Daten im Auftrag von KANAP verarbeiten, sind:</p>
<ul>
  <li><strong>Hetzner Online GmbH</strong> (Deutschland): Hosting der Server, der Datenbank und der Dateispeicherung.</li>
  <li><strong>Cloudflare</strong> (Vereinigte Staaten): Netzwerk, CDN und TLS-Terminierung vor den Servern, mit vertraglichen Garantien für Übermittlungen außerhalb der Europäischen Union.</li>
  <li><strong>Resend</strong> (Transaktions-E-Mails, Vereinigte Staaten): E-Mails zur Kontoaktivierung, zum Zurücksetzen des Passworts, Benachrichtigungen und Nachrichten der Testphase.</li>
  <li><strong>Stripe</strong> (Zahlungen, Irland und Vereinigte Staaten): Zahlungsabwicklung und Abrechnung der Abonnements.</li>
  <li><strong>Anthropic</strong> (Vereinigte Staaten) oder <strong>Mistral AI</strong> (Europäische Union), Anbieter des integrierten KI-Modells des Cloud-Dienstes, je nachdem, welchen KANAP ausgewählt hat und die Anwendung angibt: Die KI-Funktionen sind standardmäßig deaktiviert. Das integrierte Modell erhält keine Daten, solange der Arbeitsbereich seinen Anbieter und den Ort, an dem er die Daten verarbeitet, nicht akzeptiert hat; beide werden in der Anwendung angegeben. Ein Administrator des Arbeitsbereichs erteilt diese Bestätigung, die den Assistenten, die Agenten und die geplanten Verarbeitungen abdeckt. Ändert sich der Anbieter oder der Ort, wird eine neue Bestätigung eingeholt und diese Erklärung aktualisiert. KANAP wählt nur einen Anbieter und ein Angebot, deren Bedingungen das Training seiner Modelle mit den übermittelten Daten ausschließen. Administratoren können stattdessen ihren eigenen Modellanbieter verwenden.</li>
  <li><strong>Cal.com</strong> (Vereinigte Staaten): Terminvereinbarung für die Kennenlerngespräche.</li>
</ul>
<p>Kunden, die Kadratis selbst hosten, wählen ihre eigenen Dienstleister, und KANAP verarbeitet ihre Daten nicht. Kunden des Cloud-Dienstes, die ihren eigenen KI-Modellanbieter anbinden, wählen diesen Anbieter, und KANAP sendet ihre Daten nicht an sein integriertes Modell.</p>

<h2>6. Speicherdauer der Daten</h2>
<ul>
  <li>Die Kontodaten und die von den Kunden in die Plattform eingegebenen Daten werden für die Dauer des Vertrags gespeichert. Am Ende des Vertrags werden sie auf Anfrage des Kunden gelöscht.</li>
  <li>Ein Testarbeitsbereich ohne Abonnement wird mit all seinen Daten dreißig Tage nach dem Ende der Testphase endgültig gelöscht.</li>
  <li>Eine Registrierung, deren Aktivierungslink nie verwendet wurde, wird nach 90 Tagen gelöscht.</li>
  <li>Die Daten eines Kennenlerngesprächs werden höchstens sechzig Tage nach dem Gespräch aufbewahrt.</li>
  <li>Rechnungsdaten werden gemäß den französischen Buchführungs- und Steuervorschriften 10 Jahre lang aufbewahrt.</li>
  <li>Zahlungsdaten werden nicht von KANAP gespeichert, sondern direkt vom Zahlungsdienstleister (Stripe) verwaltet.</li>
</ul>

<h2>7. Datensicherheit</h2>
<ul>
  <li>HTTPS für alle Verbindungen zur Plattform</li>
  <li>Verschlüsselung ruhender Daten für die von der Plattform gespeicherten Geheimnisse und Zugangsdaten (AES-256-GCM)</li>
  <li>Rollenbasierte Zugriffskontrolle und Authentifizierungsmechanismen</li>
  <li>Hosting in der Europäischen Union (Hetzner, Deutschland)</li>
  <li>Hashing der Passwörter mit anerkannten Algorithmen (Argon2id)</li>
  <li>Mandantentrennung durch Sicherheit auf Zeilenebene (Row-Level Security, RLS) in der Datenbank</li>
  <li>Unter der Lizenz AGPL v3 veröffentlichter Quellcode und ein vertraulicher Kanal zur Meldung von Sicherheitslücken</li>
</ul>

<h2>8. Rechte der Benutzer</h2>
<p>Gemäß der DSGVO haben Sie in Bezug auf Ihre personenbezogenen Daten folgende Rechte:</p>
<ul>
  <li>Recht auf Auskunft</li>
  <li>Recht auf Berichtigung</li>
  <li>Recht auf Löschung</li>
  <li>Recht auf Einschränkung der Verarbeitung</li>
  <li>Widerspruchsrecht</li>
  <li>Recht auf Datenübertragbarkeit</li>
  <li>Recht auf Widerruf Ihrer Einwilligung</li>
</ul>
<p>Um Ihre Rechte auszuüben, können Sie KANAP unter <a href="mailto:contact@kadratis.com">contact@kadratis.com</a> kontaktieren. Sie haben außerdem das Recht, eine Beschwerde bei der französischen Datenschutzbehörde (Commission nationale de l'informatique et des libertés, CNIL) einzureichen.</p>

<h2>9. Internationale Datenübermittlungen</h2>
<p>Die Plattform wird in der Europäischen Union, in Deutschland, gehostet. Einige der in Abschnitt 5 genannten Dienstleister können personenbezogene Daten außerhalb der Europäischen Union verarbeiten, zum Beispiel Cloudflare für den Netzwerkverkehr. In diesem Fall stellt KANAP sicher, dass geeignete Garantien bestehen (der EU-US-Datenschutzrahmen oder Standardvertragsklauseln).</p>

<h2>10. Cookies und Tracking-Technologien</h2>
<p>Die Website kadratis.com setzt keine Werbe- oder Analyse-Cookies und zeigt kein Cookie-Banner. Wir messen die Besucherzahlen mit Cloudflare Web Analytics, das ohne Cookies und ohne Speicherung auf Ihrem Gerät funktioniert. Die Kontakt- und Testformulare verwenden Cloudflare Turnstile, eine Sicherheitsprüfung, die Menschen von automatisierten Programmen unterscheidet. Die Website speichert Ihre Wahl zwischen hellem und dunklem Design in Ihrem Browser, nur wenn Sie eines auswählen.</p>
<p>Die Anwendung verwendet nur die Cookies, die für die Anmeldung und die Aufrechterhaltung Ihrer Sitzung erforderlich sind. Sie speichert außerdem Oberflächeneinstellungen, etwa Ihr Design und die Anordnung der Tabellen, in Ihrem Browser. Sie können diese jederzeit in den Einstellungen Ihres Browsers löschen.</p>

<h2>11. Änderungen der Erklärung</h2>
<p>KANAP behält sich das Recht vor, diese Erklärung jederzeit zu ändern. Die Benutzer werden über Änderungen auf jedem geeigneten Weg informiert, insbesondere durch eine Benachrichtigung auf der Plattform oder per E-Mail.</p>

<p class="mk-legal__foot">Bei Fragen zu dieser Datenschutzerklärung wenden Sie sich an <a href="mailto:contact@kadratis.com">contact@kadratis.com</a>.</p>
`,
  },
};

export default content;
