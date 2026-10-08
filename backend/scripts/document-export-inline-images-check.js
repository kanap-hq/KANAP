#!/usr/bin/env node
/**
 * Vérification d'intégration du correctif « images inline » de l'export.
 *
 * Le bouton Export de l'interface poste le markdown de l'éditeur à `POST /export`,
 * avec le jeton d'accès mais **sans** cookie transmis au service d'export. Les
 * images inline étaient donc téléchargées par HTTP vers la route `@Public()`
 * `/knowledge/inline/...`, qui exige le cookie `refresh_token` : l'export échouait
 * en `400` avec `Unable to fetch image: ... (HTTP 404)`.
 *
 * Ce script rejoue ce scénario contre une pile en fonctionnement : il exporte un
 * markdown contenant une image inline **sans aucun cookie** et vérifie que
 * l'image est bien embarquée. Il ne nécessite aucun accès à la base : seulement
 * l'URL de l'API, un compte et l'identifiant d'une pièce jointe inline.
 *
 * Exécution (pile locale) :
 *   cd backend
 *   CHECK_BASE=http://fromage.lvh.me/api CHECK_HOST=fromage.lvh.me \
 *   CHECK_EMAIL=thomas.berger@fromage-co.example CHECK_PASSWORD='…' \
 *   CHECK_TENANT_SLUG=fromage CHECK_ATTACHMENT_ID=<uuid> \
 *   npm run test:security:export:live
 *
 * En QA/prod, remplacer CHECK_BASE/CHECK_HOST par l'URL du tenant et utiliser un
 * compte réel. `CHECK_EXPECTED_BYTES` (taille de la pièce jointe) est optionnel et
 * permet de vérifier que les octets embarqués sont exactement ceux du stockage.
 */

const BASE = process.env.CHECK_BASE || 'http://localhost:8080';
const HOST = process.env.CHECK_HOST || '';
const EMAIL = process.env.CHECK_EMAIL || '';
const PASSWORD = process.env.CHECK_PASSWORD || '';
const TENANT_SLUG = process.env.CHECK_TENANT_SLUG || 'default';
const ATTACHMENT_ID = process.env.CHECK_ATTACHMENT_ID || '';
const EXPECTED_BYTES = Number(process.env.CHECK_EXPECTED_BYTES || 0);

const failures = [];
function check(name, ok, detail) {
  if (!ok) failures.push(`${name}: ${JSON.stringify(detail)}`);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail ?? {})}`);
}

function headers(extra = {}) {
  return { 'Content-Type': 'application/json', ...(HOST ? { Host: HOST } : {}), ...extra };
}

/**
 * `POST /export` est limité à 5 requêtes par minute : on réessaie une fois après
 * une attente bornée plutôt que de rapporter un faux échec.
 */
async function postExport(token, body, attempt = 1) {
  const response = await fetch(`${BASE}/export`, {
    method: 'POST',
    headers: headers({ Authorization: `Bearer ${token}` }),
    body: JSON.stringify(body),
  });
  if (response.status === 429 && attempt === 1) {
    console.log('WARN rate-limit atteint (5 exports/minute) : nouvelle tentative dans 20 s…');
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    return postExport(token, body, 2);
  }
  return response;
}

(async () => {
  if (!EMAIL || !PASSWORD || !ATTACHMENT_ID) {
    console.error('CHECK_EMAIL, CHECK_PASSWORD et CHECK_ATTACHMENT_ID sont requis.');
    process.exit(2);
  }

  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const cookies = (login.headers.getSetCookie ? login.headers.getSetCookie() : [])
    .filter(Boolean)
    .map((value) => value.split(';')[0])
    .join('; ');
  const { access_token: token } = await login.json().catch(() => ({}));
  check('session ouverte', login.status === 201 && !!token, { status: login.status });
  if (!token) {
    console.error('Session impossible : vérifier CHECK_BASE, CHECK_HOST et les identifiants.');
    process.exit(1);
  }

  const inlinePath = `/api/knowledge/inline/${TENANT_SLUG}/${ATTACHMENT_ID}`;
  // Forme réellement stockée par l'éditeur : HTML avec URL racine relative.
  const markdown = `# Vérification export\n\n<img height="270" width="428" src="${inlinePath}" />\n`;

  for (const format of ['pdf', 'docx']) {
    // Aucun en-tête Cookie : c'est tout l'enjeu du correctif.
    const response = await postExport(token, { content: markdown, format, title: 'verification' });
    const buffer = Buffer.from(await response.arrayBuffer());
    check(`export ${format} sans cookie`, response.status === 201 && buffer.length > 0, {
      status: response.status,
      bytes: buffer.length,
      erreur: response.status >= 400 ? buffer.toString('utf8').slice(0, 160) : undefined,
    });
    if (response.status !== 201) continue;

    if (format === 'pdf') {
      check('pdf : image présente', buffer.subarray(0, 4).toString('ascii') === '%PDF' && buffer.includes(Buffer.from('/Image')), {});
    }
    if (format === 'docx') {
      const AdmZip = require('adm-zip');
      const media = new AdmZip(buffer)
        .getEntries()
        .filter((entry) => entry.entryName.startsWith('word/media/'))
        .map((entry) => entry.getData());
      check('docx : image embarquée', media.length > 0, { count: media.length });
      if (EXPECTED_BYTES > 0) {
        check('docx : octets conformes au stockage', media.some((data) => data.length === EXPECTED_BYTES), {
          tailles: media.map((data) => data.length),
          attendu: EXPECTED_BYTES,
        });
      }
    }
  }

  // Une cible inexistante doit être refusée explicitement, sans rien servir.
  const bogus = await postExport(token, {
    format: 'pdf',
    content: `![x](/api/knowledge/inline/${TENANT_SLUG}/11111111-2222-3333-4444-555555555555)\n`,
  });
  check('pièce jointe inexistante → 400', bogus.status === 400, { status: bogus.status });

  // Non-régression de la route d'affichage : elle reste gouvernée par le cookie.
  if (cookies) {
    const withCookie = await fetch(`${BASE}/knowledge/inline/${TENANT_SLUG}/${ATTACHMENT_ID}`, {
      headers: HOST ? { Host: HOST, Cookie: cookies } : { Cookie: cookies },
    });
    check('route inline avec cookie → 200', withCookie.status === 200, {
      status: withCookie.status,
      type: withCookie.headers.get('content-type'),
    });
  }
  const withoutCookie = await fetch(`${BASE}/knowledge/inline/${TENANT_SLUG}/${ATTACHMENT_ID}`, {
    headers: HOST ? { Host: HOST } : {},
  });
  check('route inline sans cookie → 404 (comportement inchangé)', withoutCookie.status === 404, {
    status: withoutCookie.status,
  });

  if (failures.length > 0) {
    console.error(`\n${failures.length} vérification(s) en échec :`);
    for (const failure of failures) console.error(` - ${failure}`);
    process.exit(1);
  }
  console.log('\nExport des images inline : toutes les vérifications sont passées.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
