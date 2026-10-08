# Configuration on-premise

Ce guide couvre les variables d'environnement requises et optionnelles pour les déploiements on-premise.
Un modèle complet est disponible dans `infra/.env.onprem.example`.

## Requis : Mode de déploiement

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DEPLOYMENT_MODE` | **Doit être `single-tenant`** pour les déploiements on-premise | `single-tenant` |

## Optionnel : Identité du tenant

| Variable              | Requis | Défaut            | Description                                                         |
| --------------------- | ------ | ----------------- | ------------------------------------------------------------------- |
| `DEFAULT_TENANT_SLUG` | Non    | `default`         | Identifiant interne du tenant (compatible URL, minuscules)          |
| `DEFAULT_TENANT_NAME` | Non    | `My Organization` | Le nom de votre organisation, affiché dans l'en-tête et les rapports |

Au premier démarrage, KANAP crée automatiquement un tenant avec ces valeurs. Les valeurs par défaut conviennent à la plupart des déploiements — vous n'avez besoin de les modifier que si vous souhaitez qu'un nom d'organisation spécifique apparaisse dans l'application. Une nouvelle installation reçoit aussi le plan comptable IFRS par défaut, défini comme plan comptable par défaut et plan de consolidation (la mise à jour d'une installation existante ne l'ajoute pas).

## Requis : Identifiants admin

| Variable | Description | Exemple |
|----------|-------------|---------|
| `ADMIN_EMAIL` | Email de l'utilisateur admin initial | `admin@company.com` |
| `ADMIN_PASSWORD` | Mot de passe admin initial (**à changer après la première connexion !**) | `ChangeMe123!` |
| `JWT_SECRET` | Clé de signature JWT (générer : `openssl rand -hex 32`) | 64 caractères hex |
| `APP_BASE_URL` | L'adresse exacte à laquelle les utilisateurs ouvrent KANAP : schéma, hôte et port s'il n'est pas standard (utilisée dans tous les liens envoyés par KANAP) | `https://kanap.company.com` |
| `CORS_ORIGINS` | L'adresse exacte à laquelle les utilisateurs ouvrent KANAP, séparée par des virgules s'il y en a plusieurs (origines navigateur autorisées à appeler l'API) | `https://kanap.company.com` |

**Adresse de l'application (`APP_BASE_URL`) :** Les e-mails de réinitialisation de mot de passe et d'invitation, les e-mails de notification, la redirection de connexion Microsoft Entra et les liens des exports partent tous de `APP_BASE_URL`. Saisissez l'adresse exactement comme les utilisateurs la tapent, avec le port s'il n'est pas 443 pour HTTPS ou 80 pour HTTP (par exemple `https://kanap.company.com:8443`). KANAP ne lit pas les en-têtes `Host` ou `X-Forwarded-Host` d'une requête pour construire ces liens, sauf sur un poste de développement local (`APP_ENV=development`). Sans `APP_BASE_URL` :

- la réinitialisation de mot de passe, l'invitation et la connexion Microsoft Entra répondent « application URL is not configured: set APP_BASE_URL » ;
- les rappels planifiés sont ignorés, avec une ligne dans le journal de l'API.

**Origines navigateur autorisées (`CORS_ORIGINS`) :** `CORS_ORIGINS` contrôle quelles adresses web peuvent appeler l'API depuis un navigateur. Saisissez l'adresse exacte : schéma, hôte et port s'il n'est pas standard.

```bash
# Même adresse que APP_BASE_URL
CORS_ORIGINS=https://kanap.company.com
```

KANAP accepte aussi, sans aucune entrée dans `CORS_ORIGINS` :

- l'adresse de l'application (`APP_BASE_URL`) ;
- l'adresse de la requête elle-même : l'hôte et le port de l'adresse du navigateur sont identiques à l'en-tête `Host` reçu par KANAP. Quand votre reverse proxy transmet `Host` sans le port, le même nom d'hôte sur n'importe quel port est accepté, sauf avec `APP_ENV=production`. En production, ajoutez l'adresse exacte avec son port à `CORS_ORIGINS`.

Une requête provenant de toute autre adresse reçoit une réponse 403, et l'API journalise une ligne `[CORS] Rejected origin` par adresse et par minute. Les requêtes d'actualisation de session et de déconnexion suivent la même règle : une actualisation ou une déconnexion envoyée depuis une adresse non autorisée est refusée avec un 403.

Un motif tel que `https://*.company.com` fonctionne encore sur une installation single-tenant. L'API affiche un avertissement au démarrage, et une version ultérieure n'acceptera que des adresses exactes. Remplacez dès maintenant les motifs par l'adresse exacte.

Si `CORS_ORIGINS` et l'adresse de l'application (`APP_BASE_URL`) sont tous deux absents et que `APP_ENV` n'est pas défini, toutes les origines restent autorisées dans cette version, et l'API affiche un avertissement au démarrage. Une version ultérieure les exigera.

## Optionnel : Mode d'exécution (`APP_ENV`)

| Variable | Description | Défaut |
|----------|-------------|--------|
| `APP_ENV` | Mode d'exécution de l'API : `production`, `development` ou non défini | *non défini* |

`APP_ENV` a trois états :

| État | Valeurs | Ce qui change |
|------|---------|---------------|
| Production | `production`, `prod` | L'API refuse de démarrer sans `APP_BASE_URL` et `CORS_ORIGINS`. Le cookie de session est toujours marqué Secure : il ne fonctionne qu'en HTTPS. |
| Développement | `development`, `dev`, `local`, `test` | Confort de poste de travail : les liens peuvent suivre un hôte de développement local, toutes les origines sont autorisées quand `CORS_ORIGINS` est vide et `PLATFORM_ADMIN_EMAILS=*` est accepté. Ne l'utilisez pas sur un serveur. |
| Non précisé | toute autre valeur, ou pas d'`APP_ENV` | Les mêmes règles de liens et d'origines que la production. Un `APP_BASE_URL` ou `CORS_ORIGINS` manquant produit un avertissement au démarrage et l'API démarre quand même. Le cookie de session suit la requête : Secure quand la requête arrive en HTTPS. |

Définissez `APP_ENV=production` uniquement lorsque les utilisateurs accèdent à KANAP en HTTPS. Si `NODE_ENV` est défini et `APP_ENV` ne l'est pas, KANAP lit `NODE_ENV`.

**Validation au démarrage :** L'application refuse de démarrer si `JWT_SECRET` ou `DATABASE_URL` est manquant ou vide, et, avec `APP_ENV=production`, si `APP_BASE_URL` ou `CORS_ORIGINS` est manquant. Elle refuse également de fonctionner si le rôle PostgreSQL de `DATABASE_URL` est toujours `SUPERUSER` ou `BYPASSRLS`.

**Messages au démarrage :** Le journal de l'API affiche ces lignes au démarrage. Relisez-les après chaque modification du fichier `.env`.

| Ligne | Signification |
|-------|---------------|
| `[ENV] run mode: ...` | Toujours affichée. Indique le mode dans lequel l'API s'exécute : `development`, `production` ou `unspecified`. |
| `[ENV] APP_ENV is not set: production rules apply to links, browser origins and platform administration. Set APP_ENV=production (or development on a workstation).` | Affichée en mode non précisé (le message montre la valeur quand `APP_ENV` a une autre valeur). Définissez `APP_ENV=production` si les utilisateurs accèdent à KANAP en HTTPS. |
| `[CONFIG] APP_BASE_URL is not set: ...` | Les e-mails de réinitialisation de mot de passe et d'invitation, les liens de notification et les redirections de connexion sont refusés. Définissez `APP_BASE_URL`. |
| `[CONFIG] APP_BASE_URL is not a valid http(s) address: ...` | La valeur n'est pas une adresse web. Écrivez-la avec `https://` ou `http://`. |
| `[CORS] CORS_ORIGINS is not set: browsers are allowed only from APP_BASE_URL and from the address of each request. ...` | Définissez `CORS_ORIGINS` sur l'adresse exacte que les utilisateurs ouvrent. |
| `[CORS] CORS_ORIGINS and APP_BASE_URL are not set: browsers are still allowed from every origin in this version; ...` | Définissez les deux. Une version ultérieure n'autorisera que les adresses configurées. |
| `[CORS] CORS_ORIGINS entry ... is a pattern: it is still accepted in this version. ...` | Remplacez le motif par l'adresse exacte. |

## Mise à jour : adresse de l'application et origines autorisées

Cette version change la façon dont KANAP construit les liens et les origines navigateur qu'il accepte. Avant de mettre à jour, vérifiez votre fichier `.env` :

1. Définissez `APP_BASE_URL` sur l'adresse exacte que les utilisateurs ouvrent (schéma, hôte et port s'il n'est pas standard). C'est la seule source des liens des e-mails, des redirections de connexion et des exports. Les en-têtes de requête ne les modifient plus. Sans elle, la réinitialisation de mot de passe, l'invitation et la connexion Microsoft Entra ne fonctionnent plus, et les rappels planifiés sont ignorés.
2. Mettez cette adresse exacte dans `CORS_ORIGINS`, à la place de tout motif. Si votre proxy ne conserve pas l'en-tête `Host`, ou si l'adresse utilise un port non standard, l'origine exacte avec son port est indispensable.
3. Définissez `APP_ENV=production` uniquement si les utilisateurs accèdent à KANAP en HTTPS. Le cookie de session porte alors toujours l'attribut Secure et l'API refuse de démarrer sans `APP_BASE_URL` et `CORS_ORIGINS`.
4. Après la mise à jour, lisez les lignes `[ENV]`, `[CONFIG]` et `[CORS]` du journal de l'API et corrigez chaque avertissement.
5. Les requêtes d'actualisation de session et de déconnexion venant d'une adresse non autorisée reçoivent désormais un 403, et `PLATFORM_ADMIN_EMAILS=*` n'est accepté que si `APP_ENV` a une valeur de développement.

Autres changements visibles :

- Si `APP_BASE_URL` commence par `app.`, la connexion Microsoft Entra et les liens de la base de connaissances utilisent l'adresse exactement comme elle est configurée.
- Sans `CORS_ORIGINS` ni adresse d'application, et avec `APP_ENV` non défini, rien ne change encore : toutes les origines restent autorisées et l'API affiche un avertissement.
- Sans `CORS_ORIGINS` mais avec une adresse d'application, hors développement, seules l'adresse de l'application et l'adresse de la requête sont autorisées (avant : toutes les origines).
- L'e-mail de test du résumé hebdomadaire renvoie une erreur quand aucune adresse d'application n'est configurée.

## Requis : Base de données

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL | `postgres://user:pass@host:5432/kanap?sslmode=require` |

**Exigences base de données :**
- PostgreSQL 16 ou supérieur (minimum testé ; les versions antérieures peuvent fonctionner mais ne sont pas supportées)
- Extensions : `citext`, `pgcrypto`, `uuid-ossp`
- L'utilisateur doit avoir les permissions CREATE TABLE / ALTER TABLE pour les migrations
- Recommandé : base de données dédiée
- `DATABASE_URL` doit utiliser un rôle applicatif dédié, pas `postgres` ou un autre rôle d'administration du cluster
- Recommandé : créer le rôle applicatif comme `NOSUPERUSER NOBYPASSRLS` dès le départ

**Configuration base de données (exemple) :**

```sql
-- 1. Créer la base de données et le rôle applicatif dédié
CREATE DATABASE kanap;
CREATE USER kanap WITH PASSWORD 'secure-password' NOSUPERUSER NOBYPASSRLS;
GRANT ALL PRIVILEGES ON DATABASE kanap TO kanap;

-- 2. Se connecter à la base kanap et activer les extensions
\c kanap
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 3. Accorder les permissions de schéma (pour les migrations)
GRANT ALL ON SCHEMA public TO kanap;
```

Si un rôle applicatif dédié a été initialement créé avec trop de privilèges, la première migration de KANAP le durcira automatiquement en `NOSUPERUSER NOBYPASSRLS`. Si `DATABASE_URL` pointe vers un rôle d'administration de cluster protégé tel que `postgres`, le démarrage échoue et vous devez basculer vers un rôle applicatif dédié.

## Requis : Stockage

| Variable | Description | Exemple |
|----------|-------------|---------|
| `S3_ENDPOINT` | Endpoint compatible S3 | `https://s3.amazonaws.com` |
| `S3_BUCKET` | Nom du bucket (doit exister) | `kanap-files` |
| `S3_REGION` | Région | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | Clé d'accès | `AKIA...` |
| `AWS_SECRET_ACCESS_KEY` | Clé secrète | `secret` |
| `S3_FORCE_PATH_STYLE` | `true` pour MinIO, `false` pour AWS/R2 | `false` |

**Exigences du bucket :**
- Créez le bucket avant de démarrer KANAP (non créé automatiquement)
- Permissions : `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket`

KANAP utilise le client S3 du SDK AWS v3 pour l'accès au stockage objet ; tout fournisseur avec un comportement d'API compatible S3 est supporté.

**Fournisseurs testés :**
- AWS S3 (`S3_ENDPOINT=https://s3.amazonaws.com`, `S3_FORCE_PATH_STYLE=false`)
- MinIO (`S3_ENDPOINT=http://minio:9000`, `S3_FORCE_PATH_STYLE=true`)
- Cloudflare R2 (`https://<account>.r2.cloudflarestorage.com`)
- Hetzner (`https://<region>.your-objectstorage.com`)

## Optionnel : Email via Resend

| Variable | Description | Exemple |
|----------|-------------|---------|
| `RESEND_API_KEY` | Clé API Resend | `re_xxxxx` |
| `RESEND_FROM_EMAIL` | Adresse d'expédition | `KANAP <noreply@yourdomain.com>` |

Si non configuré, KANAP peut toujours envoyer des emails via SMTP dans les déploiements single-tenant. Si ni Resend ni SMTP ne sont configurés, les fonctionnalités email sont désactivées, y compris les invitations utilisateur et la réinitialisation de mot de passe. Voir Opérations pour la réinitialisation de mot de passe SQL en secours.

## Optionnel : Email via SMTP (single-tenant / on-prem uniquement)

SMTP n'est supporté qu'en `DEPLOYMENT_MODE=single-tenant`. Les déploiements multi-tenant/cloud continuent d'utiliser Resend.

| Variable        | Description                          | Exemple                       |
| --------------- | ------------------------------------ | ----------------------------- |
| `SMTP_HOST`     | Nom d'hôte du serveur SMTP           | `smtp.company.com`            |
| `SMTP_PORT`     | Port SMTP                            | `587`                         |
| `SMTP_USER`     | Nom d'utilisateur SMTP               | `kanap`                       |
| `SMTP_PASSWORD` | Mot de passe SMTP                    | `secret`                      |
| `SMTP_FROM`     | Adresse d'expédition                 | `KANAP <noreply@company.com>` |
| `SMTP_SECURE`   | `true` pour TLS implicite (465), `false` pour STARTTLS/connexion non chiffrée (587/25) | `false` |

Notes :
- `SMTP_USER` et `SMTP_PASSWORD` sont optionnels. Laissez les deux non définis pour les relais qui font confiance à l'hôte/IP source.
- Si `SMTP_SECURE` n'est pas défini, KANAP utilise par défaut `true` pour le port `465` et `false` autrement.
- Si SMTP et Resend sont tous deux configurés en mode single-tenant, SMTP a la priorité.
- `SMTP_FROM` doit être une adresse depuis laquelle votre serveur SMTP est autorisé à envoyer.
- Si les messages sortent de votre réseau, configurez SPF, DKIM et DMARC sur le domaine expéditeur via votre administrateur mail ou fournisseur.

**Profils SMTP courants**

Relais interne sans authentification :

```env
SMTP_HOST=mail.company.local
SMTP_PORT=25
SMTP_SECURE=false
SMTP_FROM=KANAP <noreply@company.com>
```

Relais ou fournisseur authentifié :

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

Utilisez le profil Microsoft 365 uniquement si l'authentification SMTP est autorisée pour la boîte aux lettres et le tenant.

## Optionnel : SSO Entra

Voir le guide dédié : [SSO Microsoft Entra](sso-entra.md).

Il couvre l'enregistrement d'application, les autorisations déléguées et d'application, ainsi que la synchronisation quotidienne de l'annuaire qui actualise les attributs des utilisateurs et désactive les comptes supprimés de l'annuaire. L'API a besoin d'un accès sortant vers `login.microsoftonline.com` et `graph.microsoft.com`.

## Optionnel : Avancé

| Variable | Description | Défaut |
|----------|-------------|--------|
| `LOG_LEVEL` | Verbosité des logs (`debug`, `info`, `warn`, `error`) | `info` |
| `JWT_ACCESS_TOKEN_TTL` | Durée de vie du token d'accès | `15m` |
| `JWT_REFRESH_TOKEN_TTL` | Durée de vie du token de rafraîchissement | `4h` |
| `RATE_LIMIT_ENABLED` | Activation du limiteur de débit applicatif | `true` |
| `RATE_LIMIT_TRUST_PROXY` | Faire confiance aux en-têtes proxy pour la détection de l'IP client | `false` |
| `APP_URL` | Multi-tenant (cloud) uniquement : troisième source de l'adresse de l'application, après `APP_BASE_URL` et `PUBLIC_APP_URL` (le slug du tenant remplace `app`). **Non nécessaire pour l'on-premise** : `APP_BASE_URL` est utilisé. | *non défini* |
| `EMAIL_OVERRIDE` | Rediriger tous les emails vers cette adresse (dev/QA uniquement, **jamais en production**) | *non défini* |

## Optionnel : Capacité et performance

Les valeurs par défaut conviennent à quelques dizaines d'utilisateurs. Pour plus d'utilisateurs en même temps, exécutez plusieurs processus API et dimensionnez les connexions à la base de données.

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `API_WORKERS` | Nombre de processus API dans le conteneur API (1 à 16). Au-delà d'un seul, une requête qui calcule ne fait plus attendre tout le monde. | `1` |
| `DB_POOL_MAX` | Connexions à la base de données par processus API (2 au minimum : une valeur plus basse est relevée à 2) | `20` |
| `SHUTDOWN_DRAIN_TIMEOUT_MS` | À l'arrêt ou à la mise à jour, durée pendant laquelle l'API laisse se terminer les requêtes en cours, les notifications qu'elles ont déclenchées, les tâches de fond en cours et les emails en file (millisecondes, 120000 au maximum). Le conteneur est arrêté après 30 s dans tous les cas. | `20000` |
| `OPS_METRICS_TOKEN` | Active `GET /api/ops/metrics` pour votre outil de supervision (24 caractères ou plus, par exemple `openssl rand -hex 32` ; une valeur plus courte le laisse désactivé et l'API le signale au démarrage). Voir [Opérations](operations.md#metriques-api-pour-un-outil-de-supervision). | *non défini (désactivé)* |

**Ce que chacun coûte.** Chaque processus API utilise environ 200 Mo de mémoire au démarrage et jusqu'à 300 Mo en charge (mesuré avec 50 utilisateurs sur 5 000 lignes budgétaires) ; avec plusieurs processus, un petit processus de supervision ajoute environ 100 Mo. Chaque processus API peut ouvrir jusqu'à `DB_POOL_MAX` connexions à PostgreSQL. À compter :

- mémoire : `API_WORKERS` × 0,4 Go pour l'API, plus ce que PostgreSQL utilise s'il tourne sur le même serveur, plus environ 1 Go de marge (nécessaire aux compilations d'image pendant les mises à jour) ;
- connexions : `API_WORKERS` × `DB_POOL_MAX` doit rester sous `max_connections` de PostgreSQL (100 par défaut) moins environ 15. L'API vérifie cela au démarrage et écrit un avertissement dans son journal lorsque ça ne rentre pas, avec une valeur qui convient.

**Valeurs suggérées.**

| Utilisateurs travaillant en même temps | `API_WORKERS` | `DB_POOL_MAX` | Mémoire serveur (API + PostgreSQL) |
|---|---|---|---|
| Jusqu'à 20 | 1 | 20 | 4 Go |
| 20 à 50 | 2 | 15 | 8 Go |
| 50 et plus | 4 | 10 | 8 à 16 Go |

Mesuré sur 5 000 lignes budgétaires : à 10 utilisateurs, un seul processus répond aussi vite que quatre. À 50 utilisateurs, ouvrir une ligne a pris 237 ms (95e centile) avec un seul processus, 142 ms avec deux et 82 ms avec quatre, et le processus unique gardait toutes ses connexions à la base occupées.

Gardez `API_WORKERS` au nombre de cœurs CPU que le serveur donne à KANAP, ou moins. Les changements prennent effet au redémarrage du conteneur API (`docker compose -f infra/compose.onprem.yml up -d api`).

## Exemple complet (.env)

```bash
# =============================================================================
# Configuration KANAP On-Premise
# =============================================================================

# MODE DE DÉPLOIEMENT (requis)
DEPLOYMENT_MODE=single-tenant

# CONFIGURATION TENANT (optionnel - valeurs par défaut indiquées)
DEFAULT_TENANT_SLUG=default
DEFAULT_TENANT_NAME=My Organization

# IDENTIFIANTS ADMIN (requis)
ADMIN_EMAIL=admin@company.com
ADMIN_PASSWORD=ChangeThisPassword123!

# SÉCURITÉ (requis)
JWT_SECRET=

# MODE D'EXÉCUTION (optionnel - production quand les utilisateurs accèdent à KANAP en HTTPS)
# APP_ENV=production

# URL DE L'APPLICATION (requis - l'adresse exacte ouverte par les utilisateurs)
APP_BASE_URL=https://kanap.your-domain.com

# ORIGINES NAVIGATEUR AUTORISÉES (requis - l'adresse exacte ouverte par les utilisateurs)
CORS_ORIGINS=https://kanap.your-domain.com

# BASE DE DONNÉES (requis - utilisez un rôle app dédié, jamais postgres)
DATABASE_URL=postgres://kanap:password@your-postgres:5432/kanap?sslmode=require

# STOCKAGE (requis)
S3_ENDPOINT=https://s3.amazonaws.com
S3_BUCKET=kanap-files
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=false   # true pour MinIO

# EMAIL (optionnel - Resend)
# RESEND_API_KEY=re_xxxxx
# RESEND_FROM_EMAIL=KANAP <noreply@yourdomain.com>

# EMAIL (optionnel - SMTP, single-tenant uniquement)
# SMTP_HOST=smtp.company.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=
# SMTP_PASSWORD=
# SMTP_FROM=KANAP <noreply@company.com>

# AVANCÉ (optionnel - les valeurs par défaut conviennent)
# LOG_LEVEL=info
# JWT_ACCESS_TOKEN_TTL=15m
# JWT_REFRESH_TOKEN_TTL=4h
# RATE_LIMIT_ENABLED=true
# RATE_LIMIT_TRUST_PROXY=false

# CAPACITÉ (optionnel - voir « Capacité et performance »)
# API_WORKERS=1
# DB_POOL_MAX=20
# SHUTDOWN_DRAIN_TIMEOUT_MS=20000
# OPS_METRICS_TOKEN=
```

## Règles de pare-feu

Après la compilation initiale, KANAP peut fonctionner entièrement isolé si les fonctionnalités email, SSO et taux de change FX sont toutes désactivées.

### Entrant

| Port | Protocole | Fonction |
|------|-----------|----------|
| 443 | TCP | HTTPS — reverse proxy nginx servant l'application |
| 80 | TCP | HTTP — redirige vers HTTPS |

### Sortant — Installation initiale & Compilation

Ces destinations ne sont nécessaires que pendant l'installation et `docker build`. Elles peuvent être fermées une fois l'application en cours d'exécution.

| Destination | Port | Fonction |
|-------------|------|----------|
| `github.com` | 443 | Cloner le code source KANAP |
| `download.docker.com` | 443 | Dépôt APT Docker |
| `dl.min.io` | 443 | Téléchargement des binaires MinIO |
| `registry.npmjs.org` | 443 | Dépendances npm pendant `docker build` |
| `registry-1.docker.io`, `production.cloudflare.docker.com` | 443 | Téléchargement des images Docker de base (`node:22-alpine`, `nginx:alpine`) |
| Miroirs APT Ubuntu | 80/443 | Paquets système (PostgreSQL, nginx, etc.) |

### Sortant — Exécution (conditionnel)

Requis uniquement si la fonctionnalité correspondante est activée.

| Destination | Port | Fonction | Quand |
|-------------|------|----------|-------|
| `api.resend.com` | 443 | Email transactionnel | Si `RESEND_API_KEY` est défini |
| Votre relais SMTP ou fournisseur | 25 / 465 / 587 | Email transactionnel via SMTP | Si `SMTP_HOST` est défini |
| `login.microsoftonline.com` | 443 | Métadonnées et tokens SSO Entra ID | Si le SSO Entra est configuré |
| `graph.microsoft.com` | 443 | Enrichissement de profil à la connexion et synchronisation quotidienne de l'annuaire | Si le SSO Entra est configuré |
| `api.worldbank.org` | 443 | Taux de change annuels | Optionnel |
| `v6.exchangerate-api.com` | 443 | Taux de change spot | Optionnel |

### Interne (aucune règle de pare-feu nécessaire)

Ces connexions restent sur le serveur — loopback ou réseau bridge Docker uniquement.

| Connexion | Port | Notes |
|-----------|------|-------|
| nginx → Conteneur API | 8080 | Lié à `127.0.0.1` |
| nginx → Conteneur Web | 8081 | Lié à `127.0.0.1` |
| Conteneur API → PostgreSQL | 5432 | Via `host.docker.internal` (bridge Docker `172.16.0.0/12`) |
| Conteneur API → MinIO | 9000 | Via `host.docker.internal` |
| Console MinIO | 9001 | Administration locale uniquement, non exposée en externe |

## Tâches de fond

Le backend exécute des tâches de fond planifiées pour les notifications email :
- **Alertes d'expiration** : chaque jour à 08h00 UTC. Envoie un e-mail aux responsables des contrats et des postes OPEX 30, 14, 7 et 1 jour(s) avant la date limite de résiliation d'un contrat, la date de fin d'un contrat ou la fin de validité d'un poste OPEX. Seuls les utilisateurs qui ont activé les notifications budgétaires et les alertes d'expiration dans leurs paramètres de notification les reçoivent. Chaque rappel est envoyé une seule fois par jour à chaque destinataire, même si la tâche s'exécute à nouveau ce jour-là, par exemple après un redémarrage.
- **Résumé hebdomadaire** : vérification toutes les heures — envoie des résumés hebdomadaires tenant compte des fuseaux horaires aux utilisateurs qui ont opté pour ce service.

Une tâche planifiée supplémentaire s'exécute lorsque le SSO Entra est configuré :

- **Synchronisation de l'annuaire Microsoft Entra** : quotidiennement à 03h00 (heure du serveur) — actualise les attributs des utilisateurs et désactive les comptes supprimés ou désactivés dans l'annuaire. Elle reste inactive tant qu'un administrateur Microsoft Entra ne l'a pas approuvée. Voir [SSO Microsoft Entra](sso-entra.md).

Une autre tâche tient les statuts à jour :

- **`lifecycle-status-sync`** : toutes les heures, et une fois au démarrage de l'API. Passe les données de référence, les contrats et les postes OPEX et CAPEX à désactivé une fois leur fin de validité passée.

Avec plusieurs processus API (`API_WORKERS`), chaque tâche continue de s'exécuter une seule fois par échéance : les processus se mettent d'accord via la base de données sur celui qui l'exécute. Lorsque l'API s'arrête (une mise à jour), une tâche en cours reçoit le temps de la purge pour se terminer ; une tâche encore en cours à ce moment-là apparaît comme **Échoué** dans la liste des tâches planifiées et s'exécute à nouveau à son prochain horaire.

Ces tâches nécessitent que l'API fonctionne comme un **processus long** (pas une fonction serverless). En mode on-premise, `APP_BASE_URL` est utilisé pour les liens email de notification (pas de dérivation de sous-domaine). Si `APP_BASE_URL` n'est pas défini, les alertes d'expiration et les résumés hebdomadaires sont ignorés et l'API écrit une ligne dans son journal (« application URL is not configured »). Si aucun transport email sortant n'est configuré, ces tâches sautent l'envoi de manière transparente.
