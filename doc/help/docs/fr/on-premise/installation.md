# Installation on-premise

## Prérequis

**Configuration requise du serveur :**

- Serveur Linux : Ubuntu 26.04 ou 24.04 LTS, Debian 12 ou 13, RHEL 9 ou 10, ou tout système avec Docker Engine 24.0+ et le plugin Docker Compose
- Docker Engine 24.0+
- Plugin Docker Compose 2.20 ou plus récent (les versions actuelles sont en 5.x)
- Git
- 6 Go de RAM au minimum, 8 Go recommandés. Le build des images, à l'installation et à chaque mise à jour, a besoin de cette marge. Davantage de processus API demandent davantage de mémoire, voir [Configuration](configuration.md#facultatif-capacite-et-performance).
- 20 Go de disque au minimum. Après l'installation, KANAP occupe environ 4 Go (images 1,3 Go, cache de build 2,5 Go). La base de données, les fichiers stockés et le cache de build grossissent avec le temps ; le cache grossit à chaque mise à jour, et `docker builder prune` récupère cet espace.

**Infrastructure fournie par le client :**

| Composant | Exigence |
|-----------|-------------|
| PostgreSQL | Version 16+ avec les extensions `citext`, `pgcrypto`, `uuid-ossp`, et un rôle applicatif dédié pour `DATABASE_URL` |
| Stockage S3 | Tout stockage compatible S3 avec un bucket : AWS S3, Cloudflare R2, Hetzner Object Storage, Garage, RustFS, un MinIO existant, et d'autres. KANAP a besoin de `PutObject`, `GetObject`, `HeadObject`, `DeleteObject`, `ListObjectsV2` et du `GET` présigné sur ce bucket. |
| Reverse proxy | Terminaison TLS et routage (nginx, Traefik, Caddy, etc.) |
| Nom et certificat | Un nom que les utilisateurs et le serveur résolvent, et un certificat pour ce nom (voir ci-dessous) |

Un MinIO déjà en service continue de fonctionner avec KANAP : rien à changer. MinIO ne publie plus de nouveaux téléchargements ni de nouvelles images, c'est pourquoi l'[exemple d'installation](installation-example.md) utilise RustFS.

Facultatif :

- Configuration de l'e-mail sortant : clé d'API Resend ou paramètres d'un relais ou serveur SMTP
- SSO Microsoft Entra (voir [SSO Microsoft Entra](sso-entra.md))
- Un agent IA de programmation capable de mener l'installation pour vous (voir [Installation assistée par IA](installation-ai.md))

## Nom et certificat

Les utilisateurs ouvrent KANAP à une adresse HTTPS, par exemple `https://kanap.company.com`. Cette adresse a besoin d'un nom qui pointe vers votre serveur et d'un certificat qui lui correspond. Trois cas couvrent la plupart des réseaux :

| Cas | Nom | Certificat |
|------|------|-------------|
| **Nom public** | Un enregistrement dans le DNS public qui pointe vers le serveur (ou vers le pare-feu placé devant lui) | Délivré par une autorité publique, par exemple Let's Encrypt avec `certbot`. Le port 80 doit être joignable depuis internet. |
| **Nom interne** | Un enregistrement dans le DNS de votre entreprise. Pour un test, une ligne dans `/etc/hosts` sur le serveur et sur chaque poste client. | Délivré par l'autorité de certification interne de votre entreprise. Les navigateurs des postes gérés lui font déjà confiance : les utilisateurs ne voient aucun avertissement. |
| **Auto-signé** | Comme pour le nom interne | Créé sur le serveur. Pour les tests uniquement : chaque navigateur affiche un avertissement que chaque utilisateur doit accepter. |

Beaucoup d'installations n'ont pas de DNS public. Un nom interne avec un certificat interne est une configuration normale et prise en charge. Le certificat du reverse proxy sert les navigateurs. L'API ouvre aussi ses propres connexions, vers SMTP, PostgreSQL ou S3 : si votre autorité a signé les certificats de ces serveurs, voir [Certificats d'une autorité interne](configuration.md#facultatif-certificats-dune-autorite-interne).

**Le serveur doit lui aussi résoudre le nom.** Les commandes de vérification de ce guide, ainsi que le test de recette, s'exécutent sur le serveur et appellent KANAP par son nom. Tant qu'aucun enregistrement DNS n'existe, ajoutez le nom au fichier hosts du serveur :

```bash
echo "127.0.0.1 kanap.company.com" | sudo tee -a /etc/hosts
```

Remplacez `kanap.company.com` par votre nom. Les postes clients ont besoin de leur propre entrée (ou de l'enregistrement DNS) qui pointe vers l'adresse du serveur.

**Certificat auto-signé (tests uniquement) :**

```bash
sudo install -d /etc/ssl/kanap
sudo openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout /etc/ssl/kanap/server.key \
  -out /etc/ssl/kanap/server.crt \
  -subj "/CN=kanap.company.com" \
  -addext "subjectAltName=DNS:kanap.company.com"
sudo chmod 600 /etc/ssl/kanap/server.key
```

Remplacez `kanap.company.com` par votre nom. Pour un accès par adresse IP, utilisez `IP:192.0.2.10` dans `subjectAltName` et mettez l'IP dans `-subj` et dans `server_name`. Pour utiliser votre autorité interne, demandez un certificat pour le même nom et faites pointer `ssl_certificate` et `ssl_certificate_key` du fichier nginx vers les fichiers qu'elle vous remet (la chaîne complète et la clé privée). Rien d'autre ne change.

**Let's Encrypt :** `sudo apt-get install -y certbot`, puis `sudo certbot certonly --webroot -w /var/www/html -d kanap.company.com`, avec la page nginx par défaut qui répond sur le port 80. Les fichiers du certificat sont `/etc/letsencrypt/live/kanap.company.com/fullchain.pem` et `privkey.pem`. L'[exemple d'installation](installation-example.md#8-nginx-et-tls) montre la séquence complète, renouvellement compris.

## Démarrage rapide

```bash
# 1. Récupérer KANAP. La branche "stable" pointe toujours vers la dernière version publiée.
sudo install -d -o "$USER" -g "$USER" /opt/kanap
git clone https://github.com/kanap-hq/KANAP.git /opt/kanap
cd /opt/kanap
git checkout stable

# 2. Configurer AVANT le build
cp infra/.env.onprem.example .env
chmod 600 .env
nano .env  # Renseignez DATABASE_URL, les identifiants S3, ADMIN_EMAIL, ADMIN_PASSWORD, JWT_SECRET,
#          DEFAULT_TENANT_NAME (le nom de votre organisation, lu au premier démarrage uniquement),
#          APP_BASE_URL et CORS_ORIGINS (l'adresse exacte ouverte par les utilisateurs),
#          APP_ENV=production (les utilisateurs accèdent à KANAP en HTTPS) et RATE_LIMIT_TRUST_PROXY=true
# Voir le guide de configuration pour toutes les variables

# 3. Construire les images Docker (Compose les construit à partir du dépôt)
docker compose -f infra/compose.onprem.yml build --pull

# 4. Démarrer les conteneurs
docker compose -f infra/compose.onprem.yml up -d

# 5. Vérifier le démarrage
docker compose -f infra/compose.onprem.yml logs -f api
# Attendez "[entrypoint] Migrations complete", puis "Nest application successfully started"
# Le premier démarrage crée automatiquement le tenant, l'utilisateur administrateur et l'abonnement
# Appuyez sur Ctrl+C pour cesser de suivre le journal

# 6. Configurez votre reverse proxy pour router le trafic vers :
#    - /api/* → 127.0.0.1:8080 (le conteneur api)
#    - /*     → 127.0.0.1:8081 (le conteneur web, port 80 dans le conteneur)
# Assurez-vous que le proxy conserve Host et renseigne X-Forwarded-Proto et X-Forwarded-For.
# Après le premier démarrage, lisez les lignes [ENV], [CONFIG], [CORS], [RATE-LIMIT] et [SECURITY] du journal de l'API.

# 7. Accéder à l'application
# https://kanap.company.com
# Connexion avec ADMIN_EMAIL / ADMIN_PASSWORD du fichier .env
```

**Important :** terminez la configuration (étape 2) avant de démarrer les conteneurs. L'API lit `.env` au démarrage et crée le tenant et l'utilisateur administrateur au premier démarrage avec ces valeurs. Le fichier contient tous les secrets de l'installation : `chmod 600` le rend lisible par son seul propriétaire.

**Versions.** KANAP publie une nouvelle version environ une fois par mois (`26.10.1` est la première). La branche `stable` pointe toujours vers la dernière version publiée. Voir [Opérations](operations.md#procedure-de-mise-a-jour) pour mettre à jour, fixer une version précise et revenir en arrière. La branche `main` contient chaque modification fusionnée avant sa publication dans une version. Il est possible de la suivre, ce qui n'est pas recommandé pour un serveur de production.

**Exigence sur le rôle de base de données :** `DATABASE_URL` doit utiliser un rôle applicatif PostgreSQL dédié. Ne le faites pas pointer vers `postgres` ou un autre rôle d'administration du cluster. KANAP refuse de démarrer plutôt que de fonctionner sans application effective du RLS.

**Adresse et origines :** renseignez `APP_BASE_URL` et `CORS_ORIGINS` avec l'adresse exacte ouverte par les utilisateurs, avec le port lorsqu'il n'est pas standard. Chaque lien envoyé par KANAP provient de `APP_BASE_URL`. Renseignez `APP_ENV=production` lorsque les utilisateurs accèdent à KANAP en HTTPS : l'API refuse alors de démarrer sans ces deux valeurs et marque toujours le cookie de session comme Secure. Voir [Configuration](configuration.md#requis-identifiants-administrateur).

**Choix de l'e-mail :** les déploiements on-premise peuvent utiliser **Resend** ou **SMTP** pour l'e-mail sortant. SMTP est utile lorsque le client dispose déjà d'un relais de messagerie interne ou d'un fournisseur géré comme Microsoft 365. Configurez l'une de ces options si vous voulez que la réinitialisation de mot de passe, les invitations et les notifications par e-mail fonctionnent dès le premier jour.

## Exemple de reverse proxy (nginx)

**Exigences pour le reverse proxy :**

1. Terminer TLS sur le port 443
2. Router `/api/*` directement vers le conteneur API (port 8080 sur `127.0.0.1`), sans le préfixe `/api`. N'envoyez pas `/api/` à travers le conteneur web (port 8081) : sa propre route `/api/` ne transmet pas `X-Forwarded-For`, et KANAP compterait et journaliserait alors chaque requête sous l'adresse du conteneur web.
3. Router toutes les autres requêtes vers le conteneur web (port 8081 sur `127.0.0.1`)
4. Renseigner `X-Forwarded-Proto: https` et conserver `Host`. KANAP construit chaque lien qu'il envoie à partir de `APP_BASE_URL`. L'exemple envoie aussi `X-Forwarded-Host`, avec la même valeur que `Host`. Lorsque le site utilise un port non standard, ajoutez l'adresse exacte avec son port à `CORS_ORIGINS`.
5. Envoyer `X-Forwarded-For` avec l'adresse du client (l'exemple le fait) et renseigner `RATE_LIMIT_TRUST_PROXY=true`. KANAP utilise cette adresse pour ses limites de connexion. Le port de l'API doit rester lié à `127.0.0.1`, comme le fait `compose.onprem.yml`. Si rien n'est placé devant l'API, renseignez `RATE_LIMIT_TRUST_PROXY=false`.
6. Accepter des corps de requête de 50 Mo (`client_max_body_size 50m`) : les fichiers de budget vont jusqu'à 48 Mo et les pièces jointes jusqu'à 20 Mo.

Comme les conteneurs sont liés à `127.0.0.1`, nginx s'exécute sur le même hôte et relaie vers `localhost`.

Le fichier est écrit pour nginx 1.25.1 et plus récent (Ubuntu 26.04 fournit la 1.28). Ubuntu 24.04 fournit nginx 1.24 : sur ce système, écrivez `listen 443 ssl http2;` et `listen [::]:443 ssl http2;` et supprimez la ligne `http2 on;`.

```nginx
server {
    # HTTP/2 : le navigateur envoie les dizaines de requêtes d'une page sur une seule connexion.
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name kanap.company.com;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    # Limite d'envoi : fichiers de budget jusqu'à 48 Mo, pièces jointes jusqu'à 20 Mo
    client_max_body_size 50m;

    # Normaliser /api → /api/
    location = /api { return 301 /api/; }

    # API : retirer le préfixe /api avant de relayer
    location ^~ /api/ {
        proxy_pass http://127.0.0.1:8080/;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;

        # Compresser les réponses JSON et CSV de l'API (une page de la liste des budgets devient environ 8 fois plus petite).
        # Les réponses d'IA en flux (application/x-ndjson) sont exclues volontairement.
        gzip on;
        gzip_proxied any;
        gzip_comp_level 5;
        gzip_min_length 1024;
        gzip_vary on;
        gzip_types application/json text/csv text/plain;

        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Requêtes longues (exports, imports)
        proxy_read_timeout  300s;
        proxy_send_timeout  300s;
        proxy_redirect off;
    }

    # Tout le reste → SPA
    location / {
        proxy_pass http://127.0.0.1:8081;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_redirect off;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name kanap.company.com;

    # Renouvellement du certificat avec Let's Encrypt (webroot) ; sans effet sinon
    location /.well-known/acme-challenge/ { root /var/www/html; }

    location / { return 301 https://$host$request_uri; }
}
```

**Compression et HTTP/2 :** l'exemple compresse les réponses de l'API et active HTTP/2. Gardez les deux dans votre propre proxy : une page de la liste des budgets pèse environ 390 Ko de JSON non compressé et 47 Ko compressé. Si votre nginx dispose du module brotli (`libnginx-mod-http-brotli-filter` sur Debian et Ubuntu), `brotli on; brotli_types application/json text/csv text/plain;` dans le même bloc `location` compresse un peu mieux ; gzip suffit.

**`host.docker.internal` :** lorsque PostgreSQL ou le stockage S3 s'exécute sur l'hôte Docker (hors conteneur), utilisez `host.docker.internal` comme nom d'hôte dans `DATABASE_URL` et `S3_ENDPOINT`. Le fichier `compose.onprem.yml` contient le mappage `extra_hosts` qui rend cela possible. Il pointe vers l'adresse du bridge Docker du serveur (`172.17.0.1` par défaut) : les services de l'hôte doivent donc accepter les connexions depuis ce réseau (voir l'[exemple d'installation](installation-example.md)).

**Santé.** L'API répond à `GET /health` sur son propre port (`http://127.0.0.1:8080/health`) et à `GET /api/health` à travers le proxy. Les deux renvoient `{"status":"ok"}`. `docker compose -f infra/compose.onprem.yml ps` affiche `healthy` pour les conteneurs `api` et `web` dès qu'ils répondent.

## Architecture réseau

```
                    ┌─────────────────────────────────────────────────────┐
                    │              Customer Infrastructure                 │
                    │                                                      │
    Network         │  ┌──────────────┐    ┌─────────────────────────┐   │
        │           │  │ Your Reverse │    │     Docker Host         │   │
        │           │  │    Proxy     │    │                         │   │
   ┌────▼────┐      │  │   (TLS)      │    │  ┌─────┐    ┌─────┐    │   │
   │ Browser │──────┼─▶│   :443       │───▶│  │ api │    │ web │    │   │
   └─────────┘      │  └──────────────┘    │  │:8080│    │:8081│    │   │
                    │                      │  └─────┘    └─────┘    │   │
                    │  ┌──────────────┐    └─────────────────────────┘   │
                    │  │  PostgreSQL  │                                   │
                    │  │   (yours)    │◀──────── DATABASE_URL            │
                    │  └──────────────┘                                   │
                    │  ┌──────────────┐                                   │
                    │  │  S3 Storage  │◀──────── S3_ENDPOINT             │
                    │  │   (yours)    │                                   │
                    │  └──────────────┘                                   │
                    └─────────────────────────────────────────────────────┘
```

**Modèle de déploiement :** un conteneur API et un conteneur web. L'exécution de plusieurs conteneurs API ou web n'est pas prise en charge. Pour davantage d'utilisateurs simultanés, exécutez plusieurs processus API dans le conteneur API avec `API_WORKERS` (voir [Configuration](configuration.md#facultatif-capacite-et-performance)). Pour la haute disponibilité, appuyez-vous sur les politiques de redémarrage de Docker et sur la redondance de l'infrastructure (haute disponibilité de la base de données, durabilité S3).

## Première connexion

1. Ouvrez `https://<votre-nom>`
2. Connectez-vous avec `ADMIN_EMAIL` et `ADMIN_PASSWORD` du fichier `.env`
3. **Changez le mot de passe administrateur** dans votre profil si vous avez démarré avec une valeur que vous ne voulez pas garder. L'avertissement `[SECURITY]` du journal de l'API cesse une fois le mot de passe changé (voir ci-dessous).
4. Ajoutez votre logo et vos couleurs dans **Administration → Personnalisation** (facultatif)
5. Invitez d'autres utilisateurs (si l'e-mail est configuré)

**À propos du compte administrateur.** KANAP le crée au premier démarrage à partir de `ADMIN_EMAIL` et `ADMIN_PASSWORD`, et uniquement à ce moment-là. Modifier ces deux lignes par la suite ne change rien tant qu'un administrateur actif existe : changez le mot de passe dans l'application. S'il ne reste aucun administrateur actif, le démarrage suivant rétablit le compte `ADMIN_EMAIL` comme administrateur activé et conserve son mot de passe existant. `ADMIN_PASSWORD` doit être une valeur qui vous est propre, de 12 caractères ou plus : `openssl rand -base64 18` en génère une. Une valeur d'exemple ou une valeur plus courte fait afficher à l'API un avertissement `[SECURITY]` à chaque démarrage, jusqu'à ce que le mot de passe du compte soit changé. Voir [Configuration](configuration.md#requis-identifiants-administrateur).
