#!/usr/bin/env node
/**
 * Vérification bout en bout de l'export de documents : seules les images des
 * cibles autorisées entrent dans le document exporté.
 *
 * Elle exerce le service compilé (`dist/`) avec le vrai Pandoc : les trois
 * syntaxes d'image par référence, le rejet attendu des cibles interdites,
 * l'absence d'accès réseau, et la présence effective des images dans DOCX, PDF
 * et ODT. Les tests unitaires (`test:security`) couvrent le traitement des nœuds
 * et les plafonds ; eux seuls ne peuvent pas vérifier la résolution des syntaxes
 * Markdown, qui appartient au lecteur Pandoc.
 *
 * Sans Pandoc (cas de la CI), le script s'arrête avec un message explicite :
 * la vérification doit être exécutée dans l'image API.
 *
 * Exécution locale (Pandoc requis) :
 *   cd backend && npm run build && npm run test:security:export
 *
 * Exécution dans l'image API, sans toucher à la pile en cours :
 *   cd backend && npm run build
 *   docker run --rm -v "$PWD/dist:/app/dist:ro" -v "$PWD/scripts:/app/scripts:ro" \
 *     -w /app kanap-api node scripts/document-export-security-e2e.js
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const SERVICE_PATH = path.join(__dirname, '..', 'dist', 'common', 'document-export.service.js');
const WORK = path.join(require('node:os').tmpdir(), 'kanap-export-e2e');
const CANARY_MARKER = 'KANAP-E2E-CANARY-MARKER';

function skip(reason) {
  console.log(`[skip] ${reason}`);
  process.exit(0);
}

try {
  execFileSync('pandoc', ['--version'], { stdio: 'ignore' });
} catch {
  skip('pandoc introuvable : exécuter cette vérification dans l’image API (voir l’en-tête du fichier).');
}

if (!fs.existsSync(SERVICE_PATH)) {
  skip(`build absent (${path.relative(process.cwd(), SERVICE_PATH)}) : lancer « npm run build » d’abord.`);
}

/* eslint-disable @typescript-eslint/no-var-requires */
const { BadRequestException } = require('@nestjs/common');
const AdmZip = require('adm-zip');
const { DocumentExportService } = require(SERVICE_PATH);

const failures = [];
function check(name, condition, detail) {
  const ok = !!condition;
  if (!ok) failures.push(`${name}: ${JSON.stringify(detail)}`);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`);
}

/** PNG 1x1 valide, pour vérifier les octets réellement embarqués. */
function buildPng() {
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = table[(c ^ byte) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 0, 0]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const png = buildPng();

function configureEnv({ allowLoopback }) {
  for (const key of ['EXPORT_ALLOWED_IMAGE_HOSTS', 'EXPORT_ALLOW_LOOPBACK_IMAGE_HOSTS', 'EXPORT_MEDIA_BASE_URL']) {
    delete process.env[key];
  }
  process.env.APP_ENV = 'production';
  process.env.NODE_ENV = 'production';
  process.env.EXPORT_ALLOWED_IMAGE_HOSTS = 'cdn.example.test';
  if (allowLoopback) process.env.EXPORT_ALLOW_LOOPBACK_IMAGE_HOSTS = 'true';
}

async function main() {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  fs.writeFileSync(path.join(WORK, 'canary.txt'), `${CANARY_MARKER}\n`);

  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url.startsWith('/ok.png')) {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(png);
      return;
    }
    res.writeHead(404);
    res.end('no');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const loopbackImage = `http://127.0.0.1:${port}/ok.png`;

  // ------------------------------------------------ cibles interdites (rejet 400)
  // Boucle locale NON autorisée : toute tentative d'accès serait visible ici.
  configureEnv({ allowLoopback: false });

  const rejectedCases = [
    ['référence abrégée ![r]', `![r]\n\n[r]: http://127.0.0.1:${port}/forbidden.png\n`],
    ['référence complète ![alt][r]', `![audit][r]\n\n[r]: http://127.0.0.1:${port}/forbidden.png\n`],
    ['référence repliée ![r][]', `![r][]\n\n[r]: http://127.0.0.1:${port}/forbidden.png\n`],
    ['chemin absolu via référence', `![a][c]\n\n[c]: ${path.join(WORK, 'canary.txt')}\n`],
    ['traversée relative via référence', `![a][c]\n\n[c]: ../../..${WORK}/canary.txt\n`],
    ['data: fourni par l’auteur', `![x][r]\n\n[r]: data:image/png;base64,${png.toString('base64')}\n`],
    [
      'image imbriquée dans le texte alternatif',
      `![alt ![inner](http://127.0.0.1:${port}/forbidden.png) suite](http://127.0.0.1:${port}/outer.png)\n`,
    ],
  ];

  async function expectRejected(label, content, expectedRequests = []) {
    const before = hits.length;
    const started = Date.now();
    let error = null;
    try {
      await new DocumentExportService().exportMarkdown(content, 'docx', 'E2E');
    } catch (caught) {
      error = caught;
    }
    const durationMs = Date.now() - started;
    const newHits = hits.slice(before);
    check(`${label} — rejet 400`, error instanceof BadRequestException, {
      message: error ? String(error.message).slice(0, 120) : null,
    });
    // Seules les cibles légitimement autorisées peuvent avoir été contactées :
    // une image externe valide est récupérée avant que l'image imbriquée dans son
    // texte alternatif ne soit examinée.
    check(
      `${label} — aucune cible interdite contactée`,
      newHits.length === expectedRequests.length
        && newHits.every((hit, index) => hit === expectedRequests[index]),
      { newHits, attendu: expectedRequests },
    );
    check(`${label} — fichier jamais ouvert`, durationMs < 5000, { durationMs });
  }

  for (const [label, caseContent] of rejectedCases) {
    await expectRejected(label, caseContent);
  }

  // ------------------------------- images légitimes, présentes dans les 3 formats
  configureEnv({ allowLoopback: true });

  // Cible externe autorisée, image imbriquée interdite : isole la validation du
  // texte alternatif, car une `data:` fournie par l'auteur est refusée partout.
  await expectRejected(
    'texte alternatif — data: imbriquée sous une image autorisée',
    `![alt ![inner](data:image/png;base64,${png.toString('base64')})](${loopbackImage})\n`,
    ['/ok.png'],
  );

  const content = [
    '# Titre E2E',
    '',
    'Paragraphe avec une image par référence puis une image inline.',
    '',
    '![logo][img]',
    '',
    `![inline](${loopbackImage})`,
    '',
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    `[img]: ${loopbackImage}`,
    '',
  ].join('\n');

  for (const format of ['docx', 'odt', 'pdf']) {
    let result = null;
    let error = null;
    try {
      result = await new DocumentExportService().exportMarkdown(content, format, 'Titre E2E');
    } catch (caught) {
      error = caught;
    }
    const buffer = result && result.buffer;
    check(`${format} — export réussi`, !!buffer && buffer.length > 0, {
      bytes: buffer ? buffer.length : 0,
      error: error ? `${error.name}: ${String(error.message).slice(0, 140)}` : null,
    });
    if (!buffer) continue;

    check(`${format} — canari absent`, !buffer.includes(Buffer.from(CANARY_MARKER)), {});
    if (format === 'docx' || format === 'odt') {
      const prefix = format === 'docx' ? 'word/media/' : 'Pictures/';
      const entries = new AdmZip(buffer).getEntries().filter((entry) => entry.entryName.startsWith(prefix));
      check(`${format} — image embarquée conforme`, entries.some((entry) => entry.getData().equals(png)), {
        media: entries.map((entry) => entry.entryName),
      });
    }
    if (format === 'pdf') {
      check('pdf — en-tête valide', buffer.subarray(0, 4).toString('ascii') === '%PDF', {});
      check('pdf — image présente', buffer.includes(Buffer.from('/Image')), {});
    }
  }

  server.close();
  if (failures.length > 0) {
    console.error(`\n${failures.length} vérification(s) en échec :`);
    for (const failure of failures) console.error(` - ${failure}`);
    process.exit(1);
  }
  console.log('\nExport de documents : toutes les vérifications sont passées.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
