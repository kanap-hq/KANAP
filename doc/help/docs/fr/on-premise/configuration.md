# Configuration on-premise

Ce guide décrit les variables d'environnement d'une installation on-premise.
Un modèle complet est disponible dans `infra/.env.onprem.example`. Copiez-le en `.env` à la racine du dépôt et rendez-le lisible par son seul propriétaire (`chmod 600 .env`) : il contient tous les secrets de l'installation.

Une modification de `.env` prend effet quand le conteneur API est recréé. Exécutez ceci après chaque modification :

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml up -d api
```

`docker compose -f infra/compose.onprem.yml restart api` conserve les anciennes valeurs.

## Requis : mode de déploiement

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DEPLOYMENT_MODE` | **Doit valoir `single-tenant`** pour les déploiements on-premise | `single-tenant` |

Écrivez la valeur exactement. Une valeur mal orthographiée (`single_tenant`) démarre KANAP en mode cloud sans aucun avertissement.

## Facultatif : identité du tenant

| Variable              | Requis   | Défaut            | Description                                                     |
| --------------------- | -------- | ----------------- | --------------------------------------------------------------- |
| `DEFAULT_TENANT_SLUG` | Non      | `default`         | Identifiant interne du tenant (compatible URL, en minuscules)   |
| `DEFAULT_TENANT_NAME` | Non      | `My Organization` | Le nom de votre organisation : le texte alternatif du logo, et le nom qu'utilise l'assistant IA |

Au premier démarrage, KANAP crée un tenant avec ces valeurs. Les valeurs par défaut conviennent à la plupart des déploiements. Une nouvelle installation reçoit aussi le plan comptable IFRS par défaut, défini comme plan par défaut et plan de consolidation (la mise à jour d'une installation existante ne l'ajoute pas).

Définissez les deux avant le premier démarrage :

- Modifier `DEFAULT_TENANT_SLUG` par la suite fait créer à KANAP un second espace de travail, vide, et c'est celui-là qui est servi. Le premier espace de travail reste dans la base de données, hors d'atteinte.
- Modifier `DEFAULT_TENANT_NAME` par la suite n'a aucun effet, et l'application n'a aucune page pour renommer l'organisation. Définissez le nom avant le premier démarrage.

Pour donner à KANAP l'apparence de votre organisation, ajoutez votre logo et vos couleurs dans **Administration → Personnalisation**.

## Requis : identifiants administrateur

| Variable | Description | Exemple |
|----------|-------------|---------|
| `ADMIN_EMAIL` | E-mail du premier compte administrateur | `admin@company.com` |
| `ADMIN_PASSWORD` | Mot de passe du premier compte administrateur. Utilisez une valeur qui vous est propre, de 12 caractères ou plus (voir ci-dessous) | `ChangeMe123!` |
| `JWT_SECRET` | Clé de signature des jetons de connexion. Générez-la avec `openssl rand -hex 32` (32 caractères ou plus) | 64 caractères hexadécimaux |
| `APP_BASE_URL` | L'adresse exacte à laquelle les utilisateurs ouvrent KANAP : schéma, hôte et port lorsqu'il n'est pas standard (utilisée dans chaque lien envoyé par KANAP) | `https://kanap.company.com` |
| `CORS_ORIGINS` | L'adresse exacte à laquelle les utilisateurs ouvrent KANAP, séparées par des virgules s'il y en a plusieurs (origines navigateur autorisées à appeler l'API) | `https://kanap.company.com` |

**Choisissez le mot de passe administrateur.** La valeur d'exemple du tableau est publiée. Remplacez-la par une valeur qui vous est propre, de 12 caractères ou plus, par exemple la sortie de `openssl rand -base64 18`. Une valeur d'exemple ou une valeur plus courte fait afficher à l'API un avertissement `[SECURITY]` à chaque démarrage, jusqu'à ce que le mot de passe du compte soit changé. Un `JWT_SECRET` de moins de 32 caractères affiche aussi un avertissement `[SECURITY]`.

**Le compte administrateur est créé une seule fois.** KANAP lit `ADMIN_EMAIL` et `ADMIN_PASSWORD` au premier démarrage et crée le compte. Ensuite :

- Modifier l'une ou l'autre variable ne change rien tant qu'un administrateur actif existe. Changez le mot de passe dans l'application (page de profil, ou **Mot de passe oublié** sur la page de connexion).
- S'il ne reste aucun administrateur actif (tous désactivés, ou aucun ne détient le rôle Administrateur), le démarrage suivant rétablit le compte `ADMIN_EMAIL` comme administrateur activé. Son mot de passe existant reste tel quel. Si le compte n'existe pas, il est créé avec `ADMIN_PASSWORD`.
- Si `ADMIN_EMAIL` ou `ADMIN_PASSWORD` est vide, aucun compte n'est créé et le journal n'en dit rien.

**Adresse de l'application (`APP_BASE_URL`).** Les e-mails de réinitialisation de mot de passe et d'invitation, les e-mails de notification, la redirection de connexion Microsoft Entra et les liens des exports partent tous de `APP_BASE_URL`. Écrivez l'adresse exactement comme les utilisateurs la saisissent, avec le port lorsqu'il n'est pas 443 pour HTTPS ou 80 pour HTTP (par exemple `https://kanap.company.com:8443`). KANAP ne lit pas les en-têtes `Host` ou `X-Forwarded-Host` d'une requête pour construire ces liens, sauf sur une machine de développement locale (`APP_ENV=development`). Sans `APP_BASE_URL` :

- la réinitialisation de mot de passe, l'invitation et la connexion Microsoft Entra répondent « application URL is not configured: set APP_BASE_URL » ;
- les rappels planifiés sont ignorés, avec une ligne dans le journal de l'API.

**Origines navigateur autorisées (`CORS_ORIGINS`).** `CORS_ORIGINS` détermine quelles adresses web peuvent appeler l'API depuis un navigateur. Saisissez l'adresse exacte : schéma, hôte et port lorsqu'il n'est pas standard.

```bash
# Même adresse que APP_BASE_URL
CORS_ORIGINS=https://kanap.company.com
```

KANAP accepte aussi, sans aucune entrée dans `CORS_ORIGINS` :

- l'adresse de l'application (`APP_BASE_URL`) ;
- l'adresse de la requête elle-même : l'hôte et le port de l'adresse du navigateur sont égaux à l'en-tête `Host` qui parvient à KANAP. Lorsque votre reverse proxy transmet `Host` sans le port, le même nom d'hôte sur n'importe quel port est accepté, sauf avec `APP_ENV=production`. En production, ajoutez l'adresse exacte avec son port à `CORS_ORIGINS`.

Une requête venant de toute autre adresse reçoit une réponse 403, et l'API journalise une ligne `[CORS] Rejected origin` par adresse et par minute. Les requêtes de rafraîchissement de session et de déconnexion suivent la même règle : un rafraîchissement ou une déconnexion envoyé depuis une adresse non autorisée est refusé avec un 403.

Un motif tel que `https://*.company.com` fonctionne encore sur une installation single-tenant. L'API affiche un avertissement au démarrage, et une version ultérieure n'acceptera que des adresses exactes. Remplacez dès maintenant les motifs par l'adresse exacte.

Si `CORS_ORIGINS` et l'adresse de l'application (`APP_BASE_URL`) manquent tous les deux et que `APP_ENV` n'est pas défini, toutes les origines restent autorisées dans cette version, et l'API affiche un avertissement au démarrage. Une version ultérieure les exigera.

## Facultatif : mode d'exécution (`APP_ENV`)

| Variable | Description | Défaut |
|----------|-------------|---------|
| `APP_ENV` | Mode d'exécution de l'API : `production`, `development` ou non défini | *non défini* |

`APP_ENV` a trois états :

| État | Valeurs | Ce qui change |
|-------|--------|--------------|
| Production | `production`, `prod` | L'API refuse de démarrer sans `APP_BASE_URL` et `CORS_ORIGINS`. Le cookie de session est toujours marqué Secure : il ne fonctionne donc qu'en HTTPS. |
| Développement | `development`, `dev`, `local`, `test` | Facilités pour un poste de travail : les liens peuvent suivre un hôte de développement local, toutes les origines sont autorisées quand `CORS_ORIGINS` est vide, et `PLATFORM_ADMIN_EMAILS=*` est accepté. Ne l'utilisez pas sur un serveur. |
| Non spécifié | toute autre valeur, ou pas de `APP_ENV` | Les mêmes règles de liens et d'origines qu'en production. Un `APP_BASE_URL` ou un `CORS_ORIGINS` manquant produit un avertissement au démarrage, et l'API démarre quand même. Le cookie de session suit la requête : Secure quand la requête arrive en HTTPS. |

Renseignez `APP_ENV=production` lorsque les utilisateurs accèdent à KANAP en HTTPS, ce qui est la configuration documentée. Si `NODE_ENV` est défini et `APP_ENV` ne l'est pas, KANAP lit `NODE_ENV` à la place.

**Contrôles au démarrage.** L'API refuse de démarrer si `JWT_SECRET` ou `DATABASE_URL` manque ou est vide, et, avec `APP_ENV=production`, si `APP_BASE_URL` ou `CORS_ORIGINS` manque. Elle refuse aussi de fonctionner si le rôle PostgreSQL de `DATABASE_URL` est `SUPERUSER` ou `BYPASSRLS`. Ce dernier contrôle s'exécute après les migrations : quand le message apparaît, les migrations ont donc déjà été exécutées avec ce rôle.

## Ce que le journal de l'API affiche au démarrage

Lisez le journal de l'API après chaque démarrage et après chaque modification de `.env` :

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml logs --no-log-prefix api | grep -E '^\[|^Admin seeding|WARN|ERROR|successfully started|Email transport'
```

Le filtre garde les lignes ci-dessous et laisse de côté les détails du framework. Sans lui, `docker compose -f infra/compose.onprem.yml logs api` affiche tout.

**Ordre.** Les lignes que KANAP écrit lui-même (`[entrypoint]`, `[ENV]`, `[SECRETS]`, `[RATE-LIMIT]`, `[CORS]`, `[DB]`, `[on-prem]`, `[SECURITY]`) viennent en premier. Les lignes du framework (`Starting Nest application...`, e-mail, tâches planifiées, `Nest application successfully started`) suivent. La ligne `[DB] pool budget` vient en dernier.

**Un premier démarrage sans problème** de l'[exemple d'installation](installation-example.md#7-construire-et-demarrer) affiche ces lignes, dans cet ordre (la première ligne `[SECRETS]` est raccourcie ici) :

```
[entrypoint] Initializing DB (attempt 1/30) ...
[entrypoint] DB initialized. Running migrations...
[entrypoint] Migrations complete (330 executed).
[ENV] run mode: production
[SECRETS] token families: password-reset=derived-key provisioning=jwt-secret entra-state=derived-key (...)
[SECRETS] Access tokens must carry purpose="access" (legacy untyped access tokens: refused)
[RATE-LIMIT] Client address: taken from X-Forwarded-For behind 1 trusted proxy (RATE_LIMIT_TRUST_PROXY=true)
[CORS] Configured 1 origin pattern(s)
[DB] Connected as PostgreSQL role "kanap" with native RLS enforcement
Admin seeding disabled (set SEED_ADMIN=true to enable)
[on-prem] Default chart of accounts created
[on-prem] Created tenant 'default'
[on-prem] Created administrator account admin@example.internal: the workspace had no active administrator
[on-prem] Created default subscription (On-Prem)
... WARN [EmailService] No outbound email transport configured; email sending is disabled.
... Nest application successfully started
[DB] pool budget: 1 process × 20 connections = 20 of 87 usable (...)
```

Le bloc omet les lignes des migrations : environ 40 lignes qui commencent par `[Migration]` ou `[migration:` suivent `Running migrations...`. Elles sont informatives. Sur une base neuve, certaines signalent des modifications des données de référence intégrées ou citent un identifiant de tenant qui n'est pas le vôtre : KANAP conserve un tenant système pour les fonctions de la plateforme. Elles ne demandent aucune action. `...` remplace le préfixe `[Nest]` avec l'identifiant du processus et l'heure, ainsi que la source entre crochets (par exemple `LOG [NestApplication]`). Certaines de ces lignes se terminent par une durée comme `+0ms`. La dernière ligne de la sortie filtrée est `[DB] pool budget ...`. Un journal enregistré dans un fichier peut contenir des codes de couleur comme `[33m`.

Le nombre de migrations change d'une version à l'autre. Aux démarrages suivants, il vaut `0 executed` (ou le nombre de nouvelles migrations après une mise à jour), et les quatre lignes de création `[on-prem]` laissent la place à `Administrator account ... left unchanged`. La ligne de l'e-mail dépend de vos paramètres : avec un transport d'e-mail, elle indique `LOG [EmailService] Email transport selected: ...` à la place de l'avertissement.

**Lignes à connaître.**

| Ligne | Signification |
|------|---------|
| `[entrypoint] Migrations complete (N executed).` | La base de données est à jour. N est le nombre de migrations exécutées à ce démarrage. |
| `[entrypoint] DB not ready or migration failed (attempt N): ... Retrying` | L'API ne peut pas joindre ou utiliser la base de données. Elle essaie 30 fois, à 2 secondes d'intervalle, puis s'arrête. Vérifiez `DATABASE_URL`, les règles PostgreSQL et `sslmode` (voir [Requis : base de données](#requis-base-de-donnees)). |
| `[ENV] run mode: ...` | Toujours affichée. Indique le mode dans lequel l'API s'exécute : `development`, `production` ou `unspecified`. |
| `[ENV] APP_ENV is not set: production rules apply to links, browser origins and platform administration. Set APP_ENV=production (or development on a workstation).` | Affichée en mode non spécifié (le message montre la valeur quand `APP_ENV` contient autre chose). Renseignez `APP_ENV=production` si les utilisateurs accèdent à KANAP en HTTPS. |
| `[CONFIG] APP_BASE_URL is not set: ...` | Les e-mails de réinitialisation de mot de passe et d'invitation, les liens des notifications et les redirections de connexion sont refusés. Renseignez `APP_BASE_URL`. |
| `[CONFIG] APP_BASE_URL is not a valid http(s) address: ...` | La valeur n'est pas une adresse web. Écrivez-la avec `https://` ou `http://`. |
| `[SECRETS] token families: ...` et `[SECRETS] Access tokens must carry purpose="access" ...` | Informatives. Elles indiquent d'où vient chaque clé de signature (jamais sa valeur). Rien à faire. |
| `[RATE-LIMIT] Client address: ... (RATE_LIMIT_TRUST_PROXY=true)` | Informative. Indique comment KANAP trouve l'adresse du client. |
| `[RATE-LIMIT] Client address: ... (RATE_LIMIT_TRUST_PROXY not set, single-tenant default; ...)` | Un avertissement. `RATE_LIMIT_TRUST_PROXY` n'est pas défini. Définissez-le (voir [Facultatif : avancé](#facultatif-avance)). |
| `[CORS] Configured N origin pattern(s)` | Informative. N est le nombre d'entrées de `CORS_ORIGINS`. |
| `[CORS] CORS_ORIGINS is not set: browsers are allowed only from APP_BASE_URL and from the address of each request. ...` | Renseignez `CORS_ORIGINS` avec l'adresse exacte ouverte par les utilisateurs. |
| `[CORS] CORS_ORIGINS and APP_BASE_URL are not set: browsers are still allowed from every origin in this version; ...` | Renseignez les deux. Une version ultérieure n'autorisera que les adresses configurées. |
| `[CORS] CORS_ORIGINS entry ... is a pattern: it is still accepted in this version. ...` | Remplacez le motif par l'adresse exacte. |
| `[DB] Connected as PostgreSQL role "kanap" with native RLS enforcement` | Informative. L'API utilise le rôle applicatif. |
| `Admin seeding disabled (set SEED_ADMIN=true to enable)` | Attendue en on-premise. Rien à faire : l'administrateur est créé à partir de `ADMIN_EMAIL` et `ADMIN_PASSWORD`. |
| `[on-prem] Default chart of accounts created`, `[on-prem] Created tenant '...'`, `[on-prem] Created administrator account ...`, `[on-prem] Created default subscription (On-Prem)` | Premier démarrage uniquement. |
| `[on-prem] Administrator account ... left unchanged: the workspace has an active administrator` | Démarrages suivants. Rien à faire. |
| `[on-prem] Restored ... as an enabled administrator: the workspace had no active administrator (password unchanged)` | Un avertissement. Il ne restait aucun administrateur actif : KANAP a donc rétabli le compte `ADMIN_EMAIL`. |
| `[SECURITY] JWT_SECRET is shorter than 32 characters. ...` | Définissez une valeur aléatoire plus longue (`openssl rand -hex 32`) et recréez l'API : tout le monde se reconnecte et les liens de réinitialisation de mot de passe en attente cessent de fonctionner. |
| `[SECURITY] The account of ADMIN_EMAIL still has the password from ADMIN_PASSWORD, which is an example value from the documentation or shorter than 12 characters. ...` | Changez le mot de passe de l'administrateur dans l'application, ou suivez [Réinitialisation du mot de passe](operations.md#reinitialisation-du-mot-de-passe). La ligne disparaît une fois le mot de passe changé. |
| `LOG [EmailService] Email transport selected: smtp (<host>:<port>, secure=false)` | L'e-mail est actif, via le relais SMTP indiqué. `secure=true` signifie TLS implicite (`SMTP_SECURE`). Avec Resend, la ligne se termine par `selected: resend`. Pour le tester, voir [Tester l'envoi des e-mails](#tester-lenvoi-des-e-mails). |
| `WARN [EmailService] No outbound email transport configured; email sending is disabled.` | Aucun transport d'e-mail n'est défini. Les invitations, la réinitialisation de mot de passe et les notifications n'envoient rien. Voir [Facultatif : e-mail via SMTP](#facultatif-e-mail-via-smtp-single-tenant-on-premise-uniquement). |
| `[DB] pool budget: ...` | Informative. Un avertissement `pool budget exceeded` signifie que `API_WORKERS` × `DB_POOL_MAX` est trop élevé pour le `max_connections` de PostgreSQL. |

## Mise à jour d'une installation antérieure à la version 26.10.1

La première version officielle, 26.10.1, change la façon dont KANAP construit les liens et les origines navigateur qu'il accepte. Avant de mettre à jour une installation plus ancienne, vérifiez votre fichier `.env` :

1. Renseignez `APP_BASE_URL` avec l'adresse exacte ouverte par les utilisateurs (schéma, hôte et port lorsqu'il n'est pas standard). C'est la seule source des liens des e-mails, des redirections de connexion et des exports. Les en-têtes de la requête ne les modifient plus. Sans elle, la réinitialisation de mot de passe, l'invitation et la connexion Microsoft Entra cessent de fonctionner, et les rappels planifiés sont ignorés.
2. Mettez cette adresse exacte dans `CORS_ORIGINS`, à la place de tout motif. Si votre proxy ne conserve pas l'en-tête `Host`, ou si l'adresse utilise un port non standard, l'origine exacte avec son port est obligatoire.
3. Renseignez `APP_ENV=production` uniquement si les utilisateurs accèdent à KANAP en HTTPS. Le cookie de session porte alors toujours l'attribut Secure, et l'API refuse de démarrer sans `APP_BASE_URL` et `CORS_ORIGINS`.
4. Après la mise à jour, lisez les lignes `[ENV]`, `[CONFIG]` et `[CORS]` du journal de l'API et corrigez chaque avertissement.
5. Les requêtes de rafraîchissement de session et de déconnexion venant d'une adresse non autorisée reçoivent désormais un 403, et `PLATFORM_ADMIN_EMAILS=*` n'est accepté que lorsque `APP_ENV` a une valeur de développement.

Autres changements visibles :

- Si `APP_BASE_URL` commence par `app.`, la connexion Microsoft Entra et les liens de la base de connaissances utilisent l'adresse exactement telle que configurée.
- Sans `CORS_ORIGINS` ni adresse de l'application, et avec `APP_ENV` non défini, rien ne change encore : toutes les origines restent autorisées et l'API affiche un avertissement.
- Sans `CORS_ORIGINS` mais avec une adresse de l'application, hors développement, seules l'adresse de l'application et l'adresse de la requête sont autorisées (auparavant : toutes les origines).
- L'e-mail de test de la revue hebdomadaire renvoie une erreur quand aucune adresse de l'application n'est configurée.

## Requis : base de données

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL | `postgres://kanap:<password>@host.docker.internal:5432/kanap?sslmode=disable` |

**Exigences pour la base de données :**

- PostgreSQL 16 ou plus récent (16 et 18 sont testés)
- Extensions : `citext`, `pgcrypto`, `uuid-ossp`
- L'utilisateur a besoin des droits CREATE TABLE / ALTER TABLE pour les migrations
- Recommandé : une base de données dédiée
- `DATABASE_URL` doit utiliser un rôle applicatif dédié
- Recommandé : créer dès le départ le rôle applicatif en `NOSUPERUSER NOBYPASSRLS`

**Mise en place de la base de données (exemple) :**

```sql
-- 1. Create database and dedicated app role
CREATE DATABASE kanap;
CREATE USER kanap WITH PASSWORD '<password>' NOSUPERUSER NOBYPASSRLS;
GRANT ALL PRIVILEGES ON DATABASE kanap TO kanap;

-- 2. Connect to kanap database and enable extensions
\c kanap
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 3. Grant schema permissions (for migrations)
GRANT ALL ON SCHEMA public TO kanap;
```

Si un rôle applicatif dédié a été créé au départ avec trop de privilèges, la première migration de KANAP le restreint en `NOSUPERUSER NOBYPASSRLS`. Si `DATABASE_URL` pointe vers un rôle d'administration du cluster protégé comme `postgres`, le démarrage échoue et vous devez passer à un rôle applicatif dédié.

**Le mot de passe dans l'URL.** Le mot de passe fait partie de l'URL. Un mot de passe qui contient `@ : / # ?` ou `%` casse l'URL, sauf si vous encodez ces caractères en pourcentage. Générez plutôt le mot de passe avec `openssl rand -hex 24` : les lettres et les chiffres n'ont besoin d'aucun encodage. Il en va de même pour tout secret que vous placez dans une URL.

**Chiffrement de la connexion (`sslmode`).** La fin de l'URL indique comment l'API communique avec PostgreSQL :

| Valeur | À utiliser quand |
|-------|-------------|
| `sslmode=disable` | PostgreSQL s'exécute sur le même serveur que KANAP (l'exemple d'installation). Le trafic reste sur le serveur. |
| `sslmode=require` | PostgreSQL est un serveur distinct ou un service managé dont le certificat provient d'une autorité publique. L'API vérifie le certificat. |
| `sslmode=no-verify` | La connexion est chiffrée, mais l'API ne vérifie pas le certificat. Utilisez-la pour un certificat privé ou auto-signé. |

`require` vérifie entièrement le certificat. Un serveur avec un certificat privé ou auto-signé empêche alors l'API de démarrer : elle essaie 30 fois puis s'arrête. Si l'autorité de votre entreprise a signé ce certificat, faites en sorte que l'API fasse confiance à l'autorité (voir [Certificats d'une autorité interne](#facultatif-certificats-dune-autorite-interne)) et gardez `require`. Sinon, utilisez `no-verify`. Sans aucun `sslmode`, la connexion n'est pas chiffrée.

## Requis : stockage

| Variable | Description | Exemple |
|----------|-------------|---------|
| `S3_ENDPOINT` | Point d'accès compatible S3 | `https://s3.amazonaws.com` |
| `S3_BUCKET` | Nom du bucket (doit exister) | `kanap-files` |
| `S3_REGION` | Région | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | Clé d'accès | `AKIA...` |
| `AWS_SECRET_ACCESS_KEY` | Clé secrète | `secret` |
| `S3_FORCE_PATH_STYLE` | `true` pour RustFS, MinIO, Garage et la plupart des stockages auto-hébergés ; `false` pour AWS S3 et Cloudflare R2 | `false` |

**Région.** Utilisez `us-east-1` avec RustFS. Un fournisseur peut exiger sa propre région (celle qu'il affiche dans sa console). Avec Garage, la région doit être celle définie dans sa configuration. Une région erronée produit des erreurs comme « Authorization header malformed ».

**Exigences pour le bucket :**

- Créez le bucket avant de démarrer KANAP (il n'est pas créé automatiquement). KANAP ne le vérifie pas au démarrage : un bucket manquant se révèle au premier envoi ou téléchargement.
- KANAP appelle `PutObject`, `GetObject`, `HeadObject`, `DeleteObject` et `ListObjectsV2`, et construit des liens `GET` présignés, le tout sur ce seul bucket. Les autorisations correspondantes sont `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` et `s3:ListBucket`.

**Chiffrement au repos.** KANAP demande au stockage de chiffrer chaque envoi (chiffrement côté serveur `AES256`). Un stockage qui ne le prend pas en charge fait écrire à l'API l'avertissement `PutObject fallback used: provider rejected explicit SSE header; upload retried without SSE request header`, et le fichier est conservé tel qu'envoyé. RustFS accepte la demande quand `RUSTFS_SSE_S3_MASTER_KEY` est défini, ce que fait l'[exemple d'installation](installation-example.md#5-stockage-objet-rustfs). Conservez cette clé avec la sauvegarde de votre configuration : les fichiers chiffrés avec elle sont illisibles sans elle.

KANAP utilise le client S3 du SDK AWS v3 ; tout fournisseur au comportement compatible S3 est pris en charge.

**Stockages compatibles :**

- RustFS (`S3_ENDPOINT=http://host.docker.internal:9000`, `S3_FORCE_PATH_STYLE=true`), utilisé dans l'exemple d'installation
- AWS S3 (`S3_ENDPOINT=https://s3.amazonaws.com`, `S3_FORCE_PATH_STYLE=false`)
- Cloudflare R2 (`https://<account>.r2.cloudflarestorage.com`)
- Hetzner Object Storage (`https://<region>.your-objectstorage.com`)
- Garage (`S3_FORCE_PATH_STYLE=true`, région telle que définie dans sa configuration)
- Un MinIO existant (`S3_FORCE_PATH_STYLE=true`). MinIO ne publie plus de nouveaux téléchargements ni de nouvelles images : les nouvelles installations utilisent donc un autre stockage. Une installation qui utilise déjà MinIO continue de fonctionner avec KANAP : rien à changer.

## Facultatif : e-mail via Resend

| Variable | Description | Exemple |
|----------|-------------|---------|
| `RESEND_API_KEY` | Clé d'API Resend | `re_xxxxx` |
| `RESEND_FROM_EMAIL` | Adresse d'expédition. Renseignez une adresse que votre compte Resend est autorisé à utiliser : sans elle, le courrier part d'une adresse KANAP. | `KANAP <noreply@company.com>` |

Sans cette configuration, KANAP peut quand même envoyer des e-mails par SMTP dans les déploiements single-tenant. Si ni Resend ni SMTP n'est configuré, les fonctions d'e-mail sont désactivées, y compris les invitations d'utilisateurs et la réinitialisation de mot de passe. Voir [Réinitialisation du mot de passe](operations.md#reinitialisation-du-mot-de-passe) pour la solution de secours.

## Facultatif : e-mail via SMTP (single-tenant / on-premise uniquement)

SMTP n'est pris en charge qu'avec `DEPLOYMENT_MODE=single-tenant`. Les déploiements multi-tenant / cloud continuent d'utiliser Resend.

| Variable        | Description                          | Exemple                       |
| --------------- | ------------------------------------ | ----------------------------- |
| `SMTP_HOST`     | Nom d'hôte du serveur SMTP           | `smtp.company.com`            |
| `SMTP_PORT`     | Port SMTP                            | `587`                         |
| `SMTP_USER`     | Nom d'utilisateur SMTP               | `kanap`                       |
| `SMTP_PASSWORD` | Mot de passe SMTP                    | `secret`                      |
| `SMTP_FROM`     | Adresse d'expédition                 | `KANAP <noreply@company.com>` |
| `SMTP_SECURE`   | `true` pour TLS implicite (465), `false` pour STARTTLS ou une connexion simple (587/25) | `false` |

Remarques :

- `SMTP_HOST` et `SMTP_FROM` sont tous deux requis. Avec un seul des deux, SMTP reste désactivé.
- `SMTP_USER` et `SMTP_PASSWORD` vont ensemble : renseignez les deux, ou laissez les deux vides pour les relais qui font confiance à l'hôte ou à l'IP source. En renseigner un seul empêche l'API de démarrer.
- Si `SMTP_SECURE` n'est pas défini, KANAP utilise `true` par défaut pour le port `465` et `false` sinon.
- Si SMTP et Resend sont tous deux configurés en mode single-tenant, SMTP est prioritaire.
- `SMTP_FROM` doit être une adresse que votre serveur SMTP est autorisé à utiliser comme expéditeur.
- Un relais sur le serveur KANAP lui-même : renseignez `SMTP_HOST=host.docker.internal`, qui est le chemin par lequel le conteneur API atteint le serveur. Le relais doit écouter sur l'adresse du bridge Docker (`172.17.0.1` par défaut). Un relais installé sur le serveur a aussi besoin d'une règle de pare-feu qui autorise son port depuis les réseaux Docker (voir la commande ci-dessous). Un relais exécuté comme conteneur Docker avec un port publié n'en a pas besoin.
- L'adresse `172.17.0.1` n'existe qu'une fois Docker démarré. Un relais installé sur le serveur qui écoute sur cette adresse doit démarrer après Docker, comme le stockage dans l'[exemple d'installation](installation-example.md#5-stockage-objet-rustfs). Avec systemd, créez le fichier `/etc/systemd/system/<relay service>.service.d/override.conf` (le nom du service du relais à la place de `<relay service>`) avec deux lignes, `[Unit]` puis `After=docker.service`, et lancez `sudo systemctl daemon-reload`.
- Un relais dont le certificat TLS provient de l'autorité de votre entreprise a besoin de cette autorité : voir [Certificats d'une autorité interne](#facultatif-certificats-dune-autorite-interne).
- Si le courrier sort de votre réseau, configurez SPF, DKIM et DMARC sur le domaine expéditeur avec votre administrateur de messagerie ou votre fournisseur.

**Profils SMTP courants**

Relais interne sans authentification :

```env
SMTP_HOST=mail.company.local
SMTP_PORT=25
SMTP_SECURE=false
SMTP_FROM=KANAP <noreply@company.com>
```

Relais ou fournisseur avec authentification :

```env
SMTP_HOST=smtp.company.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@company.com
SMTP_PASSWORD=secret
SMTP_FROM=KANAP <noreply@company.com>
```

Soumission SMTP Microsoft 365 :

```env
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@company.com
SMTP_PASSWORD=secret
SMTP_FROM=KANAP <noreply@company.com>
```

N'utilisez le profil Microsoft 365 que si SMTP AUTH est autorisé pour la boîte aux lettres et pour le tenant.

**Un relais sur le serveur KANAP.** Autorisez le conteneur API à le joindre. Indiquez le port de votre relais dans la première ligne :

```bash
SMTP_PORT=25   # le SMTP_PORT de .env
sudo ufw allow from 172.16.0.0/12 to any port "$SMTP_PORT" proto tcp
```

Cette règle concerne un relais installé sur le serveur. Un relais qui s'exécute dans un conteneur Docker avec un port publié n'a besoin d'aucune règle : Docker publie ses ports en dehors de `ufw`.

### Tester l'envoi des e-mails

Après une modification des paramètres d'e-mail, recréez l'API (`docker compose -f infra/compose.onprem.yml up -d api`). Le journal de l'API affiche alors `Email transport selected` (voir [Ce que le journal de l'API affiche au démarrage](#ce-que-le-journal-de-lapi-affiche-au-demarrage)). Pour envoyer un message de test, ouvrez la page de connexion, choisissez **Mot de passe oublié** et saisissez l'e-mail d'un compte existant qui se connecte avec un mot de passe. Le message arrive avec un lien qui commence par votre `APP_BASE_URL`. Les comptes qui se connectent avec Microsoft Entra ne reçoivent aucun message de réinitialisation.

Quand l'envoi échoue, le message n'arrive pas et le journal de l'API contient une ligne `ERROR` avec la raison. Pour un relais dont l'API ne reconnaît pas le certificat, la raison est `unable to verify the first certificate` (ou `self-signed certificate`) et le code est `ESOCKET`. L'API ne fait pas confiance à l'autorité qui a signé le certificat du relais : voir [Certificats d'une autorité interne](#facultatif-certificats-dune-autorite-interne). Installer l'autorité sur le serveur lui-même ne change rien pour le conteneur.

## Facultatif : certificats d'une autorité interne

L'API vérifie le certificat de chaque serveur qu'elle joint en TLS. Votre relais SMTP, un serveur PostgreSQL avec `sslmode=require` ou un stockage S3 en HTTPS peuvent utiliser un certificat signé par l'autorité propre à votre entreprise. L'API refuse alors la connexion tant qu'elle ne fait pas confiance à cette autorité. Donnez-lui le certificat de l'autorité, sous forme de fichier PEM :

```bash
cd /opt/kanap
cp /path/to/company-ca.pem infra/certs/company-ca.pem
chmod 644 infra/certs/company-ca.pem
echo 'NODE_EXTRA_CA_CERTS=/etc/kanap/certs/company-ca.pem' >> .env
docker compose -f infra/compose.onprem.yml up -d api
```

- Le fichier contient l'autorité racine, suivie des autorités intermédiaires lorsque vos serveurs ne les envoient pas. Mettez-y uniquement des certificats, aucune clé privée.
- Le mode `644` permet à l'API de lire le fichier. Le certificat d'une autorité est public.
- Git ignore les fichiers de `infra/certs/` : une mise à jour les laisse donc en place.
- Votre autorité s'ajoute aux autorités publiques : les connexions aux services publics continuent de fonctionner.

Vérifiez que l'API lit le fichier :

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml exec -T api node -e 'require("tls").createSecureContext()' </dev/null
```

La commande n'affiche rien quand tout va bien. Une ligne qui commence par `Warning: Ignoring extra certs from` signifie que l'API ne peut pas lire le fichier : vérifiez le chemin dans `.env`, le nom du fichier et son mode. Le journal de l'API affiche la même ligne après sa première connexion TLS.

## Facultatif : SSO Entra

Voir le guide dédié : [SSO Microsoft Entra](sso-entra.md).

Il couvre l'enregistrement d'application, les autorisations déléguées et d'application, et la synchronisation quotidienne de l'annuaire qui actualise les attributs des utilisateurs et désactive les comptes retirés de l'annuaire. Les variables sont `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_AUTHORITY` et `ENTRA_REDIRECT_URI` ; les quatre sont nécessaires. L'API a besoin d'un accès sortant vers `login.microsoftonline.com` et `graph.microsoft.com`.

## Facultatif : fonctions d'IA

Toutes les fonctions d'IA sont désactivées par défaut sur une installation on-premise. Trois interrupteurs les activent, et un secret permet à KANAP de stocker les clés de votre fournisseur d'IA.

| Variable | Description | Défaut |
|----------|-------------|---------|
| `AI_CHAT_ENABLED` | Active l'[assistant conversationnel Plaid](../ai-assistant.md) pour l'installation. | `false` |
| `AI_MCP_ENABLED` | Active l'accès MCP et les clés d'API IA. | `false` |
| `AI_SETTINGS_ENABLED` | Ouvre **Administration → Intelligence artificielle** (modèles IA, paramètres Plaid) et les [agents](../agents-overview.md) aux administrateurs. Sans lui, personne ne peut configurer de fournisseur. | `false` |
| `AI_SETTINGS_ENCRYPTION_SECRET` | Secret qui chiffre les clés de fournisseur que vous saisissez dans KANAP. Générez-le avec `openssl rand -hex 32`. | *non défini* |

Remarques :

- Sans `AI_SETTINGS_ENCRYPTION_SECRET`, KANAP refuse de stocker une clé de fournisseur (« AI secret storage is not configured on this instance »).
- Modifier `AI_SETTINGS_ENCRYPTION_SECRET` par la suite rend les clés stockées illisibles. Sauvegardez-le avec `.env`, et saisissez de nouveau les clés si vous le perdez.
- Une installation on-premise ne comprend aucun modèle : vous ajoutez votre propre fournisseur ou serveur de modèles dans **Administration → Intelligence artificielle → Modèles IA**. Voir [Modèles IA](../ai-models.md) et [Paramètres Plaid](../ai-settings.md). Chaque tenant y a aussi ses propres interrupteurs.
- L'API a besoin d'un accès sortant vers le fournisseur que vous choisissez (voir [Règles de pare-feu](#regles-de-pare-feu)).

## Facultatif : avancé

| Variable | Description | Défaut |
|----------|-------------|---------|
| `RATE_LIMIT_TRUST_PROXY` | Comment KANAP trouve l'adresse du client pour ses limites de connexion et de requêtes. `true` : un reverse proxy est placé devant l'API et envoie `X-Forwarded-For` (le nginx de ce guide). `false` : rien n'est placé devant, l'adresse de la connexion est utilisée. `1` à `3` : autant de proxys en série. | Non défini en single-tenant, cela vaut un proxy de confiance, avec un avertissement `[RATE-LIMIT]` à chaque démarrage. Définissez-le explicitement. |
| `RATE_LIMIT_ENABLED` | Active ou désactive la limitation de débit dans l'application | `true` |
| `JWT_ACCESS_TOKEN_TTL` | Durée de vie du jeton d'accès : un nombre suivi de `s`, `m`, `h` ou `d`. Tout autre format donne 15 minutes. | `15m` |
| `JWT_REFRESH_TOKEN_TTL` | Durée de vie du jeton de rafraîchissement, même format. Tout autre format donne 15 minutes. | `4h` |
| `PASSWORD_RESET_TTL` | Durée de validité d'un lien de réinitialisation de mot de passe : un nombre de secondes ou une durée comme `30m` ou `2h`. | `1h` |
| `LOG_LEVEL` | `debug` ou `verbose` ajoute au journal le détail de chaque exécution de tâche planifiée. Toute autre valeur ne change rien. | *non défini* |
| `INTEGRATED_DOCS_AUTO_ROLLOUT` | Répare, au démarrage, les documents liés aux demandes et aux projets. Désactivé on-premise sauf si vous le définissez : `if-needed` lance la réparation seulement quand les comptages diffèrent, `always` à chaque démarrage. | *désactivé* |
| `APP_URL` | Multi-tenant (cloud) uniquement. **Inutile on-premise** : c'est `APP_BASE_URL` qui est utilisé. | *non défini* |
| `EMAIL_OVERRIDE` | Redirige tous les e-mails vers cette adresse (dev/QA uniquement, **jamais en production**) | *non défini* |

**Adresse du client.** Avec la configuration documentée (nginx sur le même serveur, port de l'API lié à `127.0.0.1`), renseignez `RATE_LIMIT_TRUST_PROXY=true`. Le proxy doit envoyer `X-Forwarded-For` ; l'exemple nginx le fait. Renseignez `false` quand rien n'est placé devant l'API. Une valeur erronée donne à tous les utilisateurs la même adresse : les 5 tentatives de connexion par minute sont alors partagées par tout le monde.

## Facultatif : capacité et performance

Les valeurs par défaut conviennent à quelques dizaines d'utilisateurs. Pour davantage d'utilisateurs simultanés, exécutez plusieurs processus API et dimensionnez les connexions à la base de données.

| Variable | Description | Défaut |
|----------|-------------|---------|
| `API_WORKERS` | Nombre de processus API dans le conteneur API (1 à 16). Avec plus d'un processus, une requête qui calcule ne fait plus attendre tous les autres. | `1` |
| `DB_POOL_MAX` | Connexions à la base de données par processus API (2 au minimum : une valeur plus basse est portée à 2) | `20` |
| `SHUTDOWN_DRAIN_TIMEOUT_MS` | À l'arrêt ou lors d'une mise à jour, le temps que l'API laisse aux requêtes en cours, aux notifications qu'elles ont lancées, aux tâches de fond en cours et aux e-mails en file pour se terminer (en millisecondes, 120000 au maximum). Le conteneur est arrêté au bout de 30 s quoi qu'il arrive. | `20000` |
| `OPS_METRICS_TOKEN` | Active `GET /api/ops/metrics` pour votre outil de supervision (24 caractères ou plus, par exemple `openssl rand -hex 32` ; une valeur plus courte le laisse désactivé et l'API le signale au démarrage). Voir [Opérations](operations.md#metriques-de-lapi-pour-un-outil-de-supervision). | *non défini (désactivé)* |

**Ce que chacun coûte.** Chaque processus API utilise environ 200 Mo de mémoire au démarrage et jusqu'à 300 Mo sous charge (mesuré avec 50 utilisateurs sur 5 000 lignes de budget) ; avec plusieurs processus, un petit processus de supervision ajoute environ 100 Mo. Chaque processus API peut ouvrir jusqu'à `DB_POOL_MAX` connexions vers PostgreSQL. Comptez :

- mémoire : `API_WORKERS` × 0,4 Go pour l'API, plus ce qu'utilise PostgreSQL s'il s'exécute sur le même serveur, plus la marge pour le build des images à chaque mise à jour. 6 Go est le minimum pour tout serveur. Sur une nouvelle installation avec PostgreSQL et le stockage en service, le build simultané des deux images a pris environ 3,8 Go au total à son maximum (environ 3,2 Go pour le build lui-même) : 6 Go laissent donc environ 2 Go libres ;
- connexions : `API_WORKERS` × `DB_POOL_MAX` doit rester inférieur au `max_connections` de PostgreSQL (100 par défaut) moins environ 15. L'API le vérifie au démarrage et écrit un avertissement dans son journal quand le compte n'y est pas, avec une valeur qui conviendrait.

**Valeurs suggérées.**

| Utilisateurs travaillant en même temps | `API_WORKERS` | `DB_POOL_MAX` | Mémoire du serveur (API + PostgreSQL) |
|---|---|---|---|
| Jusqu'à 20 | 1 | 20 | 6 Go |
| De 20 à 50 | 2 | 15 | 8 Go |
| 50 et plus | 4 | 10 | 8 à 16 Go |

Mesures sur 5 000 lignes de budget : à 10 utilisateurs, un processus répond aussi vite que quatre. À 50 utilisateurs, l'ouverture d'une ligne a pris 237 ms (95e centile) avec un processus, 142 ms avec deux et 82 ms avec quatre, et un processus seul occupait toutes ses connexions à la base de données.

Gardez `API_WORKERS` inférieur ou égal au nombre de cœurs CPU que le serveur attribue à KANAP. Les modifications prennent effet quand le conteneur API est recréé (`docker compose -f infra/compose.onprem.yml up -d api`).

## Exemple complet (.env)

```bash
# =============================================================================
# Configuration on-premise de KANAP
# =============================================================================

# MODE DE DÉPLOIEMENT (requis)
DEPLOYMENT_MODE=single-tenant

# CONFIGURATION DU TENANT (facultatif - valeurs par défaut indiquées ; à définir avant le premier démarrage)
DEFAULT_TENANT_SLUG=default
DEFAULT_TENANT_NAME=My Organization

# IDENTIFIANTS ADMINISTRATEUR (requis - lus au premier démarrage uniquement)
# Remplacez le mot de passe d'exemple par une valeur qui vous est propre, de 12 caractères ou plus.
ADMIN_EMAIL=admin@company.com
ADMIN_PASSWORD=ChangeThisPassword123!

# SÉCURITÉ (requis)
JWT_SECRET=

# MODE D'EXÉCUTION (production lorsque les utilisateurs accèdent à KANAP en HTTPS)
APP_ENV=production

# URL DE L'APPLICATION (requis - l'adresse exacte ouverte par les utilisateurs)
APP_BASE_URL=https://kanap.company.com

# ORIGINES NAVIGATEUR AUTORISÉES (requis - l'adresse exacte ouverte par les utilisateurs)
CORS_ORIGINS=https://kanap.company.com

# ADRESSE DU CLIENT (un reverse proxy devant l'API)
RATE_LIMIT_TRUST_PROXY=true

# BASE DE DONNÉES (requis - un rôle applicatif dédié, pas postgres)
# sslmode : disable (même serveur), require (certificat public), no-verify (certificat privé)
DATABASE_URL=postgres://kanap:password@your-postgres:5432/kanap?sslmode=require

# STOCKAGE (requis)
S3_ENDPOINT=https://s3.amazonaws.com
S3_BUCKET=kanap-files
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
# true pour RustFS, MinIO, Garage ; false pour AWS S3 et R2
S3_FORCE_PATH_STYLE=false

# E-MAIL (facultatif - Resend)
# RESEND_API_KEY=re_xxxxx
# RESEND_FROM_EMAIL=KANAP <noreply@company.com>

# E-MAIL (facultatif - SMTP, single-tenant uniquement)
# SMTP_HOST=smtp.company.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=
# SMTP_PASSWORD=
# SMTP_FROM=KANAP <noreply@company.com>

# SSO (facultatif - Microsoft Entra ID, les quatre ensemble)
# ENTRA_CLIENT_ID=
# ENTRA_CLIENT_SECRET=
# ENTRA_AUTHORITY=https://login.microsoftonline.com/<tenant-id>
# ENTRA_REDIRECT_URI=https://kanap.company.com/api/auth/entra/callback

# IA (facultatif - désactivée par défaut)
# AI_CHAT_ENABLED=false
# AI_MCP_ENABLED=false
# AI_SETTINGS_ENABLED=false
# AI_SETTINGS_ENCRYPTION_SECRET=

# AVANCÉ (facultatif - les valeurs par défaut conviennent)
# JWT_ACCESS_TOKEN_TTL=15m
# JWT_REFRESH_TOKEN_TTL=4h
# PASSWORD_RESET_TTL=1h
# RATE_LIMIT_ENABLED=true

# CAPACITÉ (facultatif - voir « Capacité et performance »)
# API_WORKERS=1
# DB_POOL_MAX=20
# SHUTDOWN_DRAIN_TIMEOUT_MS=20000
# OPS_METRICS_TOKEN=
```

## Règles de pare-feu

Après le build initial, KANAP peut fonctionner de manière entièrement isolée (air-gapped) si l'e-mail, le SSO, l'IA et les taux de change sont tous désactivés.

### Entrant

| Port | Protocole | Usage |
|------|----------|---------|
| 443 | TCP | HTTPS : reverse proxy nginx qui sert l'application |
| 80 | TCP | HTTP : redirige vers HTTPS (et répond aux renouvellements de certificat si vous utilisez Let's Encrypt) |
| 22 | TCP | SSH, pour l'administration. Autorisez-le avant d'activer un pare-feu |

Rien d'autre n'a besoin d'être joignable depuis le réseau. En particulier, PostgreSQL (5432) et le stockage objet (9000) sont réservés aux réseaux Docker du serveur.

### Sortant : installation initiale et compilation

Ces destinations sont nécessaires à l'installation, à chaque mise à jour et à chaque retour arrière (`docker build`), ainsi qu'à la première exécution du test de recette. Elles peuvent être fermées entre ces opérations.

| Destination | Port | Usage |
|-------------|------|---------|
| `github.com`, `*.githubusercontent.com` | 443 | Cloner le code source de KANAP ; télécharger les fichiers de version de RustFS (l'exemple d'installation) |
| `download.docker.com` | 443 | Dépôt APT de Docker |
| `registry.npmjs.org` | 443 | Dépendances npm pendant `docker build` |
| `registry-1.docker.io`, `auth.docker.io` | 443 | Récupérer les images Docker de base (`node:24-alpine`, `nginx:alpine`), et l'image du test de recette (`node:24-alpine`) à la première exécution du test. Chaque récupération obtient d'abord un jeton auprès de `auth.docker.io` |
| `production.cloudflare.docker.com`, `production.cloudfront.docker.com` | 443 | Télécharger les couches des images : Docker Hub redirige chaque récupération vers ces hôtes |
| `dl-cdn.alpinelinux.org` | 80/443 | Paquets Alpine pendant `docker build` (les deux images installent des paquets avec `apk add`) |
| Miroirs APT d'Ubuntu | 80/443 | Paquets système (PostgreSQL, nginx, etc.) |
| `acme-v02.api.letsencrypt.org` | 443 | Certificats, uniquement avec Let's Encrypt (aussi à chaque renouvellement) |

Docker peut changer les hôtes de téléchargement de Docker Hub. Docker tient la liste à jour dans sa [liste d'autorisation](https://docs.docker.com/desktop/enterprise/allow-list/). Une récupération utilise deux lignes de cette page : « Docker Pull/Push » (`registry-1.docker.io`, `production.cloudfront.docker.com`) et « Authentication » (`auth.docker.io`). Ces lignes s'appliquent aussi à un serveur avec Docker Engine.

### Sortant : exécution (conditionnel)

Nécessaire uniquement si la fonction correspondante est activée.

| Destination | Port | Usage | Quand |
|-------------|------|---------|------|
| `api.resend.com` | 443 | E-mail transactionnel | Si `RESEND_API_KEY` est défini |
| Votre relais ou fournisseur SMTP | 25 / 465 / 587 | E-mail transactionnel via SMTP | Si `SMTP_HOST` est défini |
| `login.microsoftonline.com` | 443 | Métadonnées et jetons du SSO Entra ID | Si le SSO Entra est configuré |
| `graph.microsoft.com` | 443 | Enrichissement du profil à la connexion et synchronisation quotidienne de l'annuaire | Si le SSO Entra est configuré |
| Le fournisseur d'IA que vous configurez (ou votre propre serveur de modèles) | 443 ou le port de votre serveur | Assistant conversationnel, agents | Si les fonctions d'IA sont activées et qu'un modèle est configuré |
| `api.worldbank.org` | 443 | Taux de change annuels | Facultatif |
| `open.er-api.com` | 443 | Taux de change au comptant | Facultatif |

### Interne (aucune règle de pare-feu nécessaire depuis l'extérieur)

Ces connexions restent sur le serveur : boucle locale ou réseaux Docker.

| Connexion | Port | Remarques |
|------------|------|-------|
| nginx → conteneur API | 8080 | Lié à `127.0.0.1` |
| nginx → conteneur web | 8081 | Lié à `127.0.0.1` |
| Conteneur API → PostgreSQL | 5432 | Via `host.docker.internal`, qui est l'adresse du bridge Docker du serveur (`172.17.0.1` par défaut). Autorisez-le depuis les réseaux Docker uniquement (`172.16.0.0/12`). |
| Conteneur API → stockage objet | 9000 | Même chemin. Dans l'exemple d'installation, le stockage écoute uniquement sur `172.17.0.1`. |
| Conteneur API → relais de messagerie sur le serveur | Son `SMTP_PORT` | Uniquement quand le relais s'exécute sur le serveur KANAP. Même chemin : le relais écoute sur `172.17.0.1`, et la règle autorise son port depuis `172.16.0.0/12`. |

Par défaut, Docker attribue à ses 15 premiers réseaux des plages comprises dans `172.16.0.0/12` (`172.17.0.0/16` à `172.31.0.0/16`), puis des blocs `/20` de `192.168.0.0/16`. Sur un serveur neuf, les conteneurs KANAP utilisent `172.18.0.0/16`. Un serveur qui a déjà de nombreux réseaux Docker peut les placer dans `192.168.x.x`, hors de ces règles. Après le premier démarrage, `docker network inspect infra_default` affiche leur sous-réseau. S'il est hors de `172.16.0.0/12`, ajoutez-le aux règles de pare-feu et à la ligne `pg_hba.conf` de PostgreSQL. Le même sous-réseau permet aussi une règle plus restreinte.

## Tâches de fond

L'API exécute 15 tâches planifiées. Les heures ci-dessous sont les valeurs par défaut, en UTC (l'horloge du conteneur API). Les administrateurs voient les tâches dans **Administration → Tâches planifiées** (voir [Tâches planifiées](../scheduled-tasks.md)), où chacune peut être désactivée, reprogrammée ou lancée à la demande.

| Tâche | Quand | Ce qu'elle fait |
|-----|------|--------------|
| `check-expirations` | Tous les jours à 08:00 | Envoie un e-mail aux responsables des contrats et des postes OPEX 30, 14, 7 et 1 jour(s) avant une date limite de résiliation, une date de fin ou la fin de validité. Seuls les utilisateurs qui ont activé ces notifications les reçoivent, une fois par jour. |
| `send-weekly-reviews` | Toutes les heures | Envoie le récapitulatif de la revue hebdomadaire aux utilisateurs qui l'ont demandé, au jour et dans le fuseau horaire qu'ils ont choisis. |
| `lifecycle-status-sync` | Toutes les heures, et une fois au démarrage | Passe à l'état désactivé les master data, contrats, postes OPEX et CAPEX dont la fin de validité est dépassée. |
| `entra-directory-sync` | Tous les jours à 03:00 | Actualise les attributs des utilisateurs et désactive les comptes retirés ou désactivés dans l'annuaire. Fonctionne uniquement quand le SSO Entra est connecté et approuvé. Voir [SSO Microsoft Entra](sso-entra.md). |
| `attachment-orphan-cleanup` | Tous les jours à 03:00 | Supprime les enregistrements de pièces jointes des images intégrées qu'aucun texte n'utilise plus. |
| `storage-ghost-cleanup` | Le dimanche à 04:00 | Supprime les fichiers stockés qui n'ont aucun enregistrement de pièce jointe et datent de plus de 7 jours. |
| `list-context-purge` | Tous les jours à 03:30 | Supprime les filtres de liste enregistrés que personne n'a utilisés depuis 90 jours. |
| `auth-event-retention` | Tous les jours à 03:40 | Supprime du journal d'audit les événements de connexion de plus de 365 jours. |
| `ai-conversation-retention` | Tous les jours à 02:00 | Archive et purge les conversations d'IA selon les paramètres de conservation. |
| `ai-search-index-reindex` | Tous les jours à 03:00 | Reconstruit l'index de recherche utilisé par les fonctions d'IA. |
| `ai-agent-activity-retention-purge` | Tous les jours à 03:25 | Supprime l'activité des agents plus ancienne que la durée de conservation de chaque agent. |
| `ai-mutation-preview-expiration` | Toutes les 5 minutes | Fait expirer les aperçus de modifications par l'IA que personne n'a approuvés à temps. |
| `ai-helpdesk-glpi-new-ticket-ingestion` | Toutes les 5 minutes | Lit les nouveaux tickets GLPI pour l'agent de helpdesk. |
| `ai-sre-monitoring-alert-ingestion` | Toutes les 5 minutes | Lit les nouvelles alertes de l'outil de supervision connecté pour l'agent SRE. |
| `netbox-inventory-sync` | Toutes les heures | Garde les actifs alignés sur l'inventaire Netbox connecté. |

Les tâches des fonctions Entra, Netbox, GLPI, supervision et IA n'ont rien à faire tant que la fonction correspondante n'est pas configurée.

Avec plusieurs processus API (`API_WORKERS`), chaque tâche ne s'exécute toujours qu'une fois par horaire prévu : les processus s'accordent par la base de données sur celui qui l'exécute. Quand l'API s'arrête (une mise à jour), une tâche en cours dispose du temps de drainage pour se terminer ; une tâche encore en cours à ce moment apparaît en échec (« interrupted ») dans la liste des tâches planifiées et s'exécute de nouveau à son horaire suivant.

Les tâches ont besoin que l'API s'exécute comme un processus de longue durée, ce que font les conteneurs. `check-expirations` et `send-weekly-reviews` construisent les liens de leurs e-mails à partir de `APP_BASE_URL`. S'il n'est pas défini, elles sautent leur travail et l'API écrit une ligne dans le journal (« application URL is not configured »). Si aucun transport d'e-mail sortant n'est configuré, elles n'envoient rien.
