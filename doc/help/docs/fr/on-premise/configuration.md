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

Au premier démarrage, KANAP crée automatiquement un tenant avec ces valeurs. Les valeurs par défaut conviennent à la plupart des déploiements — vous n'avez besoin de les modifier que si vous souhaitez qu'un nom d'organisation spécifique apparaisse dans l'application.

## Requis : Identifiants admin

| Variable | Description | Exemple |
|----------|-------------|---------|
| `ADMIN_EMAIL` | Email de l'utilisateur admin initial | `admin@company.com` |
| `ADMIN_PASSWORD` | Mot de passe admin initial (**à changer après la première connexion !**) | `ChangeMe123!` |
| `JWT_SECRET` | Clé de signature JWT (générer : `openssl rand -hex 32`) | 64 caractères hex |
| `APP_BASE_URL` | URL publique (utilisée dans les liens email) | `https://kanap.company.com` |
| `CORS_ORIGINS` | Origines navigateur autorisées séparées par des virgules (**requis en production**) | `https://*.company.com` |

**Liens email :** Les URLs de réinitialisation de mot de passe/invitation utilisent `APP_BASE_URL` (ou les en-têtes forwarded host/proto). L'on-premise doit définir `APP_BASE_URL` sur l'URL accessible de l'extérieur et configurer le reverse proxy pour transmettre `Host` / `X-Forwarded-Proto`.

**CORS :** Configurez `CORS_ORIGINS` pour contrôler quelles origines navigateur peuvent accéder à l'API. L'application **refusera de démarrer en production** si `CORS_ORIGINS` n'est pas défini. Définissez-le sur l'URL exacte depuis laquelle les utilisateurs accèdent à KANAP.

```bash
# Correspondre à votre APP_BASE_URL
CORS_ORIGINS=https://kanap.company.com
```

**Validation au démarrage :** L'application refusera de démarrer si `JWT_SECRET`, `DATABASE_URL` ou `APP_BASE_URL` sont manquants ou vides. Elle refuse également de fonctionner si le rôle PostgreSQL de `DATABASE_URL` est toujours `SUPERUSER` ou `BYPASSRLS`.

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
| `APP_URL` | URL de base pour les liens email de notification en mode multi-tenant (le slug du tenant remplace `app`). **Non nécessaire pour l'on-premise** — `APP_BASE_URL` est utilisé à la place. | `https://app.kanap.net` |
| `EMAIL_OVERRIDE` | Rediriger tous les emails vers cette adresse (dev/QA uniquement, **jamais en production**) | *non défini* |

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

# URL DE L'APPLICATION (requis)
APP_BASE_URL=https://kanap.your-domain.com

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
| `registry-1.docker.io`, `production.cloudflare.docker.com` | 443 | Téléchargement des images Docker de base (`node:20-alpine`, `nginx:alpine`) |
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

Ces tâches nécessitent que l'API fonctionne comme un **processus long** (pas une fonction serverless). En mode on-premise, `APP_BASE_URL` est utilisé pour les liens email de notification (pas de dérivation de sous-domaine). Si aucun transport email sortant n'est configuré, ces tâches sautent l'envoi de manière transparente.
