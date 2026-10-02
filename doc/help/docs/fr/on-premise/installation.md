# Installation on-premise

## Prérequis

**Configuration serveur requise :**
- Serveur Linux (Ubuntu 22.04+, Debian 12+, RHEL 9+, ou tout OS compatible Docker)
- Docker Engine 24.0+
- Docker Compose v2.20+
- Git
- 4 Go de RAM minimum (8 Go recommandés ; plus de processus API nécessitent davantage, voir [Configuration](configuration.md#optionnel-capacite-et-performance))
- 20 Go de disque minimum (+ cache de compilation)

**Infrastructure fournie par le client :**

| Composant | Exigence |
|-----------|----------|
| PostgreSQL | Version 16+ avec les extensions `citext`, `pgcrypto`, `uuid-ossp`, et un rôle applicatif dédié pour `DATABASE_URL` |
| Stockage S3 | Tout stockage compatible S3 : AWS S3, MinIO, Cloudflare R2, Hetzner, etc. |
| Reverse Proxy | Terminaison TLS et routage (nginx, Traefik, Caddy, etc.) |
| Domaine | DNS pointant vers votre serveur |

Optionnel :
- Configuration email sortant : clé API Resend ou détails de relais/serveur SMTP
- SSO Microsoft Entra (voir `sso-entra.md`)

## Démarrage rapide

```bash
# 1. Cloner le dépôt
git clone https://github.com/kanap-it/kanap.git
cd kanap

# 2. Configurer l'environnement AVANT de compiler
cp infra/.env.onprem.example .env
nano .env  # Définir DATABASE_URL, identifiants S3, ADMIN_EMAIL, JWT_SECRET, APP_BASE_URL
# Voir le guide de Configuration pour toutes les variables

# 3. Compiler les images Docker
docker build -t kanap-api:latest ./backend
docker build -t kanap-web:latest ./frontend

# 4. Démarrer les conteneurs
docker compose -f infra/compose.onprem.yml up -d

# 5. Vérifier le démarrage
docker compose -f infra/compose.onprem.yml logs -f api
# Attendez le message "Application started"
# Le premier démarrage crée automatiquement le tenant, l'utilisateur admin et l'abonnement

# 6. Configurez votre reverse proxy pour router le trafic vers :
#    - /api/* → api:8080
#    - /*     → web:80
# Assurez-vous que le proxy préserve le Host et définit X-Forwarded-Proto.

# 7. Accéder à l'application
# https://kanap.votre-domaine.com
# Connexion avec ADMIN_EMAIL / ADMIN_PASSWORD depuis .env
```

**Important :** Complétez la configuration (étape 2) avant de démarrer les conteneurs. L'API lit `.env` au démarrage et crée le tenant et l'utilisateur admin au premier démarrage avec ces valeurs.

**Exigence de rôle base de données :** `DATABASE_URL` doit utiliser un rôle applicatif PostgreSQL dédié. Ne le pointez pas vers `postgres` ou un autre rôle d'administration du cluster. KANAP refusera de démarrer plutôt que de fonctionner sans application effective du RLS.

**Choix email :** Les déploiements on-premise peuvent utiliser soit **Resend** soit **SMTP** pour l'email sortant. SMTP est utile lorsque le client dispose déjà d'un relais de messagerie interne ou d'un fournisseur managé tel que Microsoft 365. Configurez l'une de ces options si vous souhaitez que la réinitialisation de mot de passe, les invitations et les emails de notification fonctionnent dès le premier jour.

## Exemple de reverse proxy (nginx)

**Exigences du reverse proxy :**

1. Terminer TLS sur le port 443
2. Router `/api/*` vers le conteneur API (port 8080)
3. Router toutes les autres requêtes vers le conteneur web (port 80)
4. Définir `X-Forwarded-Proto: https` et préserver `Host` / `X-Forwarded-Host`
5. Supporter l'upgrade WebSocket (utilisé par les fonctionnalités temps réel)

Comme les conteneurs sont liés à `127.0.0.1`, nginx tourne sur le même hôte et proxifie vers `localhost`.

```nginx
server {
    # HTTP/2 : le navigateur envoie les dizaines de requêtes d'une page sur une seule connexion.
    # nginx 1.25.1 et plus récent : écrivez `listen 443 ssl;` et `http2 on;` à la place.
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name kanap.company.com;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    # Limite de téléchargement (KANAP supporte jusqu'à 20 Mo)
    client_max_body_size 20m;

    # Canonicaliser /api → /api/
    location = /api { return 301 /api/; }

    # API : retirer le préfixe /api avant le proxy
    location ^~ /api/ {
        proxy_pass http://127.0.0.1:8080/;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;

        # Compresse les réponses JSON et CSV de l'API (une page de liste budgétaire est environ 8 fois plus légère).
        # Les réponses IA en flux (application/x-ndjson) sont volontairement laissées de côté.
        gzip on;
        gzip_proxied any;
        gzip_comp_level 5;
        gzip_min_length 1024;
        gzip_vary on;
        gzip_types application/json text/csv text/plain;

        # Support WebSocket
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
    return 301 https://$host$request_uri;
}
```

**Compression et HTTP/2 :** l'exemple compresse les réponses de l'API et active HTTP/2. Gardez les deux dans votre propre proxy : une page de la liste budgétaire pèse environ 390 Ko de JSON non compressé et 47 Ko compressé. Si votre nginx dispose du module brotli (`libnginx-mod-http-brotli-filter` sous Debian et Ubuntu), `brotli on; brotli_types application/json text/csv text/plain;` dans le même `location` compresse un peu mieux ; gzip suffit.

**TLS auto-signé (sans domaine) :** Si vous n'avez pas de domaine et accédez à KANAP par adresse IP, générez un certificat auto-signé :

```bash
sudo mkdir -p /etc/ssl/kanap
sudo openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout /etc/ssl/kanap/server.key \
  -out /etc/ssl/kanap/server.crt \
  -subj "/CN=YOUR_IP" \
  -addext "subjectAltName=IP:YOUR_IP"
```

Remplacez `YOUR_IP` par l'IP de votre serveur et mettez à jour `server_name`, `APP_BASE_URL` et `CORS_ORIGINS` en conséquence. Les utilisateurs devront accepter l'avertissement de certificat du navigateur lors du premier accès.

**`host.docker.internal` :** Lorsque PostgreSQL ou le stockage S3 tourne sur l'hôte Docker (pas dans un conteneur), utilisez `host.docker.internal` comme nom d'hôte dans `DATABASE_URL` et `S3_ENDPOINT`. Le fichier `compose.onprem.yml` inclut le mapping `extra_hosts` qui rend cela fonctionnel.

## Architecture réseau

```
                    ┌─────────────────────────────────────────────────────┐
                    │              Infrastructure client                   │
                    │                                                      │
    Internet        │  ┌──────────────┐    ┌─────────────────────────┐   │
        │           │  │ Votre Reverse│    │     Hôte Docker         │   │
        │           │  │    Proxy     │    │                         │   │
   ┌────▼────┐      │  │   (TLS)      │    │  ┌─────┐    ┌─────┐    │   │
   │Navigateur│─────┼─▶│   :443       │───▶│  │ api │    │ web │    │   │
   └─────────┘      │  └──────────────┘    │  │:8080│    │ :80 │    │   │
                    │                      │  └─────┘    └─────┘    │   │
                    │  ┌──────────────┐    └─────────────────────────┘   │
                    │  │  PostgreSQL  │                                   │
                    │  │  (le vôtre)  │◀──────── DATABASE_URL            │
                    │  └──────────────┘                                   │
                    │  ┌──────────────┐                                   │
                    │  │ Stockage S3  │◀──────── S3_ENDPOINT             │
                    │  │  (le vôtre)  │                                   │
                    │  └──────────────┘                                   │
                    └─────────────────────────────────────────────────────┘
```

**Modèle de déploiement :** un conteneur API et un conteneur web. L'exécution de plusieurs conteneurs API ou web n'est pas prise en charge. Pour plus d'utilisateurs en même temps, exécutez plusieurs processus API à l'intérieur du conteneur API avec `API_WORKERS` (voir [Configuration](configuration.md#optionnel-capacite-et-performance)). Pour la haute disponibilité, appuyez-vous sur les politiques de redémarrage Docker et la redondance au niveau de l'infrastructure (HA base de données, durabilité S3).

## Première connexion

1. Naviguez vers `https://<votre-domaine>`
2. Connectez-vous avec les identifiants du `.env` (ADMIN_EMAIL / ADMIN_PASSWORD)
3. **Changez immédiatement le mot de passe admin** via le profil utilisateur
4. Configurez les paramètres de l'organisation
5. Invitez des utilisateurs supplémentaires (si l'email est configuré)
