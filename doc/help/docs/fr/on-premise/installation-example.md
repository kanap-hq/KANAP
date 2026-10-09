# Exemple d'installation : Ubuntu 26.04

Ce guide décrit une installation on-premise complète sur un seul serveur Ubuntu 26.04 LTS, avec PostgreSQL sur l'hôte, RustFS comme stockage compatible S3 et nginx comme reverse proxy TLS. Chaque étape donne les commandes à coller et le résultat attendu.

Ubuntu 24.04 LTS fonctionne avec deux différences, signalées là où elles s'appliquent : PostgreSQL est en version 16 (renseignez `PGVER=16` à l'étape 0) et nginx en version 1.24 (une commande `sed` à l'étape 8).

Adaptez l'exemple à votre environnement. Les guides [Installation](installation.md) et [Configuration](configuration.md) restent la référence.

!!! tip "Vous préférez l'automatisation ?"
    Un agent IA de programmation peut mener toute cette installation pour vous à partir d'un seul prompt. Voir [Installation assistée par IA](installation-ai.md).

## Architecture

```
Browser → nginx (:443, TLS) → Docker containers (api :8080, web :8081)
                             → PostgreSQL (:5432, on host)
                             → RustFS (172.17.0.1:9000, on host)
```

Tous les services s'exécutent sur un seul serveur. Les conteneurs atteignent les services de l'hôte par `host.docker.internal`, qui est l'adresse du bridge Docker du serveur (`172.17.0.1`). PostgreSQL écoute sur toutes les adresses du serveur, et le pare-feu et `pg_hba.conf` ne laissent que les réseaux Docker l'atteindre. Le stockage écoute uniquement sur l'adresse du bridge Docker.

---

## 0. Avant de commencer

Il vous faut :

- Un serveur Ubuntu 26.04 LTS neuf avec 6 Go de RAM ou plus (8 Go recommandés), 20 Go de disque et un accès sortant à internet. Le build des images, à l'installation et à chaque mise à jour, a besoin de cette mémoire.
- Un utilisateur avec les droits `sudo` (pas `root`). Toutes les commandes ci-dessous s'exécutent sous cet utilisateur.
- Le nom que les utilisateurs saisissent pour ouvrir KANAP, par exemple `kanap.example.internal`. Voir [Nom et certificat](installation.md#nom-et-certificat). Cet exemple utilise un nom interne avec un certificat auto-signé. L'étape 8 montre les deux autres cas.
- L'adresse e-mail du premier administrateur.
- Le nom de votre organisation.

Choisissez les quatre valeurs des premières lignes, puis collez le bloc entier. Gardez les guillemets simples autour du nom de l'organisation : il peut contenir des espaces. Si le nom contient une apostrophe, utilisez des guillemets doubles : `ORG_NAME="Caisse d'Epargne"`. N'utilisez ni `$` ni accent grave dans le nom. Le bloc écrit les valeurs, avec les secrets qu'il génère, dans `~/kanap-install.env`, un fichier lisible par vous seul. Les étapes suivantes lisent ce fichier avec `. ~/kanap-install.env`, si bien que chaque bloc fonctionne dans une nouvelle session de terminal. Aucune commande n'affiche les secrets.

```bash
PGVER=18                            # 16 sur Ubuntu 24.04
KANAP_HOST=kanap.example.internal   # le nom que saisissent les utilisateurs, sans https://
ADMIN_EMAIL=admin@example.internal  # e-mail du premier administrateur
ORG_NAME='Example Company'          # nom de votre organisation, défini une fois : l'application ne peut pas le modifier ensuite

install -m 600 /dev/null ~/kanap-install.env
printf 'ORG_NAME=%q\n' "${ORG_NAME}" >> ~/kanap-install.env
cat >> ~/kanap-install.env <<EOF
PGVER=${PGVER}
KANAP_HOST=${KANAP_HOST}
ADMIN_EMAIL=${ADMIN_EMAIL}
PG_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
KANAP_ADMIN_PASSWORD=$(openssl rand -base64 18)
S3_SECRET_KEY=$(openssl rand -hex 32)
RUSTFS_ROOT_USER=rustfsadmin-$(openssl rand -hex 4)
RUSTFS_ROOT_PASSWORD=$(openssl rand -hex 32)
RUSTFS_SSE_S3_MASTER_KEY=$(openssl rand -base64 32)
EOF
```

Le mot de passe de la base de données est hexadécimal (lettres et chiffres) : il n'a besoin d'aucun encodage dans l'URL de la base de données. Un mot de passe qui contient `@ : / # ? %` doit y être encodé en pourcentage.

---

## 1. Docker Engine

Installez Docker depuis le dépôt officiel :

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
```

Ajoutez votre utilisateur au groupe `docker` :

```bash
sudo usermod -aG docker "$USER"
```

Fermez votre session et ouvrez-en une nouvelle pour que le groupe s'applique. Vérifiez ensuite que Docker répond sans `sudo` :

```bash
docker ps
```

La commande affiche une ligne d'en-tête qui commence par `CONTAINER ID`, et aucun conteneur pour l'instant.

---

## 2. Pare-feu

Un serveur neuf accepte toutes les connexions. Mettez en place le pare-feu avant d'installer PostgreSQL et le stockage, pour qu'aucun des deux ne soit jamais ouvert au réseau. Fermez tout sauf SSH, HTTP et HTTPS, et ne laissez que les réseaux Docker atteindre PostgreSQL (5432) et le stockage (9000). Les règles peuvent citer des ports sur lesquels rien n'écoute encore. **Autorisez SSH en premier**, sinon vous perdez l'accès au serveur au démarrage du pare-feu.

```bash
sudo apt-get install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow from 172.16.0.0/12 to any port 5432 proto tcp
sudo ufw allow from 172.16.0.0/12 to any port 9000 proto tcp
sudo ufw --force enable
sudo ufw status
```

L'état liste `OpenSSH`, `80/tcp`, `443/tcp` et les deux règles depuis `172.16.0.0/12`. Il liste aussi `OpenSSH (v6)`, `80/tcp (v6)` et `443/tcp (v6)` : les trois mêmes règles pour IPv6. Si SSH écoute sur un autre port, autorisez aussi ce port avant d'activer le pare-feu.

---

## 3. Récupérer KANAP

Récupérez d'abord les fichiers : le script de dimensionnement de PostgreSQL de l'étape suivante en fait partie. La branche `stable` pointe toujours vers la dernière version publiée.

```bash
sudo install -d -o "$USER" -g "$USER" /opt/kanap
git clone https://github.com/kanap-hq/KANAP.git /opt/kanap
cd /opt/kanap
git checkout stable
```

---

## 4. PostgreSQL

```bash
. ~/kanap-install.env
sudo apt-get install -y postgresql-${PGVER}
pg_lsclusters
```

`pg_lsclusters` affiche le cluster `main` de votre version, en ligne. Les chemins ci-dessous utilisent `/etc/postgresql/${PGVER}/main`.

Créez la base de données, le rôle applicatif et les extensions nécessaires :

```bash
cd /opt/kanap
. ~/kanap-install.env
sudo -u postgres psql <<SQL
CREATE DATABASE kanap;
CREATE USER kanap WITH PASSWORD '${PG_PASSWORD}' NOSUPERUSER NOBYPASSRLS;
GRANT ALL PRIVILEGES ON DATABASE kanap TO kanap;
SQL

sudo -u postgres psql -d kanap <<'SQL'
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
GRANT ALL ON SCHEMA public TO kanap;
SQL
```

Les commandes affichent `CREATE DATABASE`, `CREATE ROLE` et `GRANT`, puis trois fois `CREATE EXTENSION` et `GRANT`.

### Autoriser les connexions depuis les conteneurs Docker

PostgreSQL doit écouter au-delà de `localhost` et accepter le rôle applicatif depuis les réseaux Docker. Sur un serveur neuf, Docker place le réseau de KANAP dans `172.16.0.0/12` (en général `172.18.0.0/16`) : la ligne ci-dessous l'autorise. L'étape 5 montre comment le vérifier après le premier démarrage. Le pare-feu de l'étape 2 garde le port fermé au reste du réseau.

```bash
. ~/kanap-install.env
echo "listen_addresses = '*'" | sudo tee /etc/postgresql/${PGVER}/main/conf.d/kanap-network.conf >/dev/null
echo "host    kanap    kanap    172.16.0.0/12    scram-sha-256" | sudo tee -a /etc/postgresql/${PGVER}/main/pg_hba.conf >/dev/null
sudo systemctl restart postgresql
PGPASSWORD="${PG_PASSWORD}" psql -h 127.0.0.1 -U kanap -d kanap -c "SELECT 1;"
```

La dernière commande doit afficher un tableau avec `1`. Pour restreindre la règle plus tard, utilisez le sous-réseau des conteneurs KANAP : après le premier démarrage, `docker network inspect infra_default` l'affiche.

### Dimensionner PostgreSQL pour ce serveur

Les valeurs par défaut de PostgreSQL sont prévues pour une petite machine. Le dépôt contient un script qui affiche des paramètres dimensionnés d'après la mémoire de ce serveur ; il ne modifie rien par lui-même. Il conserve les bibliothèques que PostgreSQL précharge déjà (il en reçoit la liste) et ajoute la bibliothèque de statistiques des requêtes lorsqu'il la trouve sur ce serveur. Les commandes écrivent le résultat dans un fichier complémentaire, redémarrent PostgreSQL et activent les statistiques des requêtes :

```bash
cd /opt/kanap
. ~/kanap-install.env
CURRENT=$(sudo -u postgres psql -XAtc 'SHOW shared_preload_libraries')
sh infra/postgres/kanap-pg-tune.sh --preload "$CURRENT" | sudo tee /etc/postgresql/${PGVER}/main/conf.d/kanap.conf >/dev/null
sudo systemctl restart postgresql
sudo -u postgres psql -d kanap -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
```

La dernière commande affiche `CREATE EXTENSION`. Pour lire les paramètres, affichez le fichier (son en-tête explique chaque valeur) :

```bash
. ~/kanap-install.env
cat /etc/postgresql/${PGVER}/main/conf.d/kanap.conf
```

Voir [Opérations](operations.md#parametres-postgresql) pour le détail.

---

## 5. Stockage objet (RustFS)

KANAP stocke les pièces jointes, les logos et les exports dans un stockage compatible S3. Cet exemple exécute RustFS (Apache 2.0) sur le même serveur. Tout autre stockage compatible S3 convient : sautez cette étape et renseignez les variables `S3_*` de l'étape 6 pour votre stockage (voir [Configuration](configuration.md#requis-stockage)).

MinIO ne publie plus de nouveaux téléchargements ni de nouvelles images : une nouvelle installation utilise donc un autre stockage. Une installation qui utilise déjà MinIO continue de fonctionner avec KANAP.

Le stockage écoute uniquement sur l'adresse du bridge Docker `172.17.0.1` : il n'est pas joignable depuis le réseau. La console est désactivée.

**Installez RustFS et son outil en ligne de commande.** Les numéros de version figurent dans les deux premières lignes : utilisez la dernière version listée sur la [page des versions de RustFS](https://github.com/rustfs/rustfs/releases) et sur la [page des versions de RustFS CLI](https://github.com/rustfs/cli/releases). Si vous changez une version, vérifiez les noms de fichiers sur sa page de version. Chaque téléchargement est contrôlé avec le fichier `SHA256SUMS` de sa version ; la commande s'arrête si le contrôle échoue.

```bash
RUSTFS_VERSION=1.0.1
RC_VERSION=0.1.36

RUSTFS_TMP="$(mktemp -d)"
cd "$RUSTFS_TMP"
U=https://github.com/rustfs/rustfs/releases/download/${RUSTFS_VERSION}
curl -fsSLO ${U}/SHA256SUMS
curl -fsSLO ${U}/rustfs-linux-x86_64-gnu-v${RUSTFS_VERSION}.deb
sha256sum --check --ignore-missing SHA256SUMS && sudo dpkg -i rustfs-linux-x86_64-gnu-v${RUSTFS_VERSION}.deb

C=https://github.com/rustfs/cli/releases/download/v${RC_VERSION}
curl -fsSLO ${C}/rustfs-cli-linux-amd64-v${RC_VERSION}.tar.gz
curl -fsSL ${C}/SHA256SUMS -o RC_SHA256SUMS
sha256sum --check --ignore-missing RC_SHA256SUMS && tar xzf rustfs-cli-linux-amd64-v${RC_VERSION}.tar.gz rc && sudo install -m 0755 rc /usr/local/bin/rc

cd ~
rm -rf "$RUSTFS_TMP"
```

Chaque ligne `sha256sum` doit afficher `OK`. Les deux dernières lignes suppriment les fichiers téléchargés. Le paquet crée l'utilisateur `rustfs`, le répertoire de données `/data/rustfs`, le répertoire `/opt/rustfs` et un service systemd. Il installe aussi un fichier `/etc/default/rustfs` commenté, que le bloc suivant remplace par un fichier lisible par root uniquement (mode 600). Il ne démarre pas le service.

**Configurez et démarrez le service.**

```bash
. ~/kanap-install.env
sudo install -m 0600 /dev/null /etc/default/rustfs
sudo tee /etc/default/rustfs >/dev/null <<EOF
RUSTFS_ACCESS_KEY=${RUSTFS_ROOT_USER}
RUSTFS_SECRET_KEY=${RUSTFS_ROOT_PASSWORD}
RUSTFS_VOLUMES=/data/rustfs
RUSTFS_ADDRESS=172.17.0.1:9000
RUSTFS_CONSOLE_ENABLE=false
RUSTFS_OBS_LOGGER_LEVEL=warn
RUSTFS_SSE_S3_MASTER_KEY=${RUSTFS_SSE_S3_MASTER_KEY}
EOF

sudo mkdir -p /etc/systemd/system/rustfs.service.d
printf '[Unit]\nAfter=docker.service\n' | sudo tee /etc/systemd/system/rustfs.service.d/override.conf >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now rustfs

for i in $(seq 1 30); do ss -ltn | grep -q '172.17.0.1:9000' && break; sleep 1; done
ss -ltn | grep '172.17.0.1:9000'
```

La dernière ligne doit montrer `172.17.0.1:9000` à l'écoute. Le fichier complémentaire `After=docker.service` fait démarrer le service une fois que Docker a créé l'adresse du bridge. Si Docker utilise une autre adresse de bridge (`ip -4 addr show docker0`), mettez cette adresse dans `RUSTFS_ADDRESS`. Par défaut, Docker attribue à ses 15 premiers réseaux les plages `172.17.0.0/16` à `172.31.0.0/16`, toutes comprises dans `172.16.0.0/12`. Les réseaux suivants reçoivent des blocs `/20` de `192.168.0.0/16`. Sur un serveur neuf, le réseau de KANAP est `172.18.0.0/16`. Sur un serveur qui a déjà 13 réseaux Docker ou plus en plus du bridge par défaut, il peut se retrouver dans `192.168.x.x`. Après le premier démarrage (étape 7), `docker network inspect infra_default` affiche le réseau de KANAP. S'il est hors de `172.16.0.0/12`, ajoutez sa plage aux règles de pare-feu de l'étape 2 et à la ligne `pg_hba.conf` de l'étape 4. Si votre paramètre `default-address-pools` est différent, remplacez plutôt la plage.

`RUSTFS_SSE_S3_MASTER_KEY` est la clé qui chiffre les fichiers au repos. KANAP demande le chiffrement au repos lors des envois. Sans cette clé, RustFS refuse la demande et l'API journalise un avertissement `PutObject fallback used`. **Conservez cette clé avec la sauvegarde de la configuration du serveur** : les fichiers chiffrés avec elle sont illisibles sans elle.

**Créez le bucket, une politique à privilèges minimaux et l'utilisateur applicatif.** L'utilisateur applicatif peut lire, écrire et supprimer des objets dans `kanap-files`, et rien d'autre. Sa clé d'accès est `kanap-app` ; sa clé secrète est la valeur `S3_SECRET_KEY` de 64 caractères générée plus haut (RustFS accepte de 8 à 128 caractères). Aucun secret n'apparaît dans les commandes que `sudo` enregistre dans le journal système : l'outil `rc` lit les clés d'administration dans un fichier réservé à root, et le secret de l'utilisateur applicatif lui parvient par l'entrée standard.

```bash
. ~/kanap-install.env
sudo install -d -m 0700 /root/.config/rc
sudo install -m 0600 /dev/null /root/.config/rc/config.toml
sudo tee /root/.config/rc/config.toml >/dev/null <<EOF
schema_version = 1

[[aliases]]
name = "kanapstore"
endpoint = "http://172.17.0.1:9000"
access_key = "${RUSTFS_ROOT_USER}"
secret_key = "${RUSTFS_ROOT_PASSWORD}"
region = "us-east-1"
EOF

sudo rc mb kanapstore/kanap-files
sudo tee /root/kanap-app-policy.json >/dev/null <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": ["arn:aws:s3:::kanap-files"] },
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::kanap-files/*"] }
  ]
}
EOF
sudo rc admin policy create kanapstore kanap-app /root/kanap-app-policy.json
sudo rm /root/kanap-app-policy.json
printf '%s' "${S3_SECRET_KEY}" | sudo sh -c 'rc admin user add kanapstore kanap-app "$(cat)"'
sudo rc admin policy attach kanapstore kanap-app --user kanap-app
sudo rc admin user info kanapstore kanap-app
```

La dernière commande affiche `Status: enabled` et la politique `kanap-app`.

Pour mettre à jour RustFS plus tard, installez le `.deb` plus récent de la même manière. Quand `dpkg` pose la question pour `/etc/default/rustfs`, gardez votre version.

---

## 6. Configurer KANAP

Créez le fichier `.env`. Le modèle liste chaque paramètre avec son explication ; cet exemple le remplace par un fichier opérationnel pour cette configuration. Le fichier est lisible par vous seul.

```bash
cd /opt/kanap
. ~/kanap-install.env
cp infra/.env.onprem.example .env
chmod 600 .env
cat > .env <<EOF
# MODE DE DÉPLOIEMENT
DEPLOYMENT_MODE=single-tenant

# TENANT (à définir avant le premier démarrage)
DEFAULT_TENANT_SLUG=default
DEFAULT_TENANT_NAME=${ORG_NAME}

# IDENTIFIANTS ADMINISTRATEUR (lus au premier démarrage uniquement)
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=ChangeThisAfterFirstLogin!

# SÉCURITÉ
JWT_SECRET=${JWT_SECRET}

# MODE D'EXÉCUTION : les utilisateurs accèdent à KANAP en HTTPS
APP_ENV=production

# URL DE L'APPLICATION ET CORS : l'adresse exacte ouverte par les utilisateurs
APP_BASE_URL=https://${KANAP_HOST}
CORS_ORIGINS=https://${KANAP_HOST}

# ADRESSE DU CLIENT : un reverse proxy (nginx) devant l'API
RATE_LIMIT_TRUST_PROXY=true

# BASE DE DONNÉES : host.docker.internal atteint l'hôte depuis Docker
DATABASE_URL=postgres://kanap:${PG_PASSWORD}@host.docker.internal:5432/kanap?sslmode=disable

# STOCKAGE : RustFS sur l'hôte
S3_ENDPOINT=http://host.docker.internal:9000
S3_BUCKET=kanap-files
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=kanap-app
AWS_SECRET_ACCESS_KEY=${S3_SECRET_KEY}
S3_FORCE_PATH_STYLE=true

# E-MAIL (facultatif : choisissez un transport pour activer les invitations, la réinitialisation de mot de passe, les notifications)
# RESEND_API_KEY=re_xxxxx
# RESEND_FROM_EMAIL=KANAP <noreply@company.com>
# SMTP_HOST=smtp.company.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=noreply@company.com
# SMTP_PASSWORD=<smtp password>
# SMTP_FROM=KANAP <noreply@company.com>
EOF
```

**Définissez votre propre mot de passe administrateur.** `ADMIN_PASSWORD` doit être une valeur qui vous est propre, de 12 caractères ou plus. La valeur d'exemple ci-dessus est publiée, et une valeur d'exemple ou une valeur plus courte fait afficher à l'API un avertissement `[SECURITY]` à chaque démarrage, jusqu'à ce que le mot de passe du compte soit changé. Cette commande la remplace par le mot de passe aléatoire généré à l'étape 0 (`openssl rand -base64 18`) :

```bash
cd /opt/kanap
. ~/kanap-install.env
sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${KANAP_ADMIN_PASSWORD}|" .env
```

Le test de recette de l'étape 9 le lit dans `.env` sans l'afficher. L'étape 10 l'affiche une fois pour votre première connexion.

Remarques sur le fichier :

- Le compte administrateur est créé au premier démarrage à partir de `ADMIN_EMAIL` et `ADMIN_PASSWORD`. Les modifier ensuite ne change rien tant qu'un administrateur actif existe.
- `DEFAULT_TENANT_NAME` est le nom de votre organisation, défini à l'étape 0. KANAP le lit au premier démarrage uniquement, et l'application n'a aucune page pour le modifier.
- Le mot de passe de `DATABASE_URL` et `JWT_SECRET` ont été générés à l'étape 0. Ne réutilisez pas de valeurs d'exemple.
- Avec `sslmode=disable`, la connexion à PostgreSQL reste sur le serveur. Pour un autre serveur PostgreSQL, voir [`sslmode`](configuration.md#requis-base-de-donnees).
- Si vous accédez à KANAP par adresse IP plutôt que par un nom, renseignez `APP_BASE_URL` et `CORS_ORIGINS` avec `https://<adresse ip>`.
- Pour l'e-mail sortant, retirez le `#` d'un bloc et complétez les valeurs. Si vous utilisez SMTP, assurez-vous que le serveur accepte le courrier depuis l'adresse `SMTP_FROM` et que SPF, DKIM et DMARC sont en place si les messages sortent de votre réseau.
- Pour les fonctions d'IA, ajoutez les quatre variables `AI_*` décrites dans [Configuration](configuration.md#facultatif-fonctions-dia).

---

## 7. Construire et démarrer

Construisez les images et démarrez les conteneurs. Le build prend une à deux minutes. `--wait` rend la main quand les deux conteneurs indiquent `healthy` ; le premier démarrage exécute les migrations de la base de données et prend de quelques secondes à une minute.

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml build --pull
docker compose -f infra/compose.onprem.yml up -d --wait
docker compose -f infra/compose.onprem.yml ps
docker compose -f infra/compose.onprem.yml logs --no-log-prefix api | grep -E '^\[|^Admin seeding|WARN|ERROR|successfully started|Email transport'
```

Si le build s'arrête avec `signal: killed`, le serveur a manqué de mémoire. `sudo dmesg | grep -i oom` le confirme. Vérifiez la mémoire libre avec `free -m` et arrêtez les autres services qui l'occupent. Vérifiez que PostgreSQL et le stockage tournent toujours (`pg_lsclusters`, `systemctl status --no-pager rustfs`). Redémarrez ensuite Docker, ce qui arrête ce qui reste du build interrompu, construisez les deux images l'une après l'autre, ce qui demande moins de mémoire, et démarrez KANAP :

```bash
sudo systemctl restart docker
cd /opt/kanap
docker compose -f infra/compose.onprem.yml build --pull api
docker compose -f infra/compose.onprem.yml build --pull web
docker compose -f infra/compose.onprem.yml up -d --wait
```

`ps` affiche `api` et `web` à l'état `healthy`. La dernière commande garde les lignes de démarrage du journal de l'API et laisse de côté les détails du framework. Au premier démarrage, elle affiche ces lignes, dans cet ordre (la première ligne `[SECRETS]` est raccourcie ici) :

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

Le nombre de migrations dépend de la version, et les chiffres du pool dépendent de votre PostgreSQL.

Le bloc omet les lignes des migrations : environ 40 lignes qui commencent par `[Migration]` ou `[migration:` suivent `Running migrations...`. Elles sont informatives. Sur une base neuve, certaines signalent des modifications des données de référence intégrées ou citent un identifiant de tenant qui n'est pas le vôtre : KANAP conserve un tenant système pour les fonctions de la plateforme. Elles ne demandent aucune action. `...` remplace le préfixe `[Nest]` avec l'identifiant du processus et l'heure, ainsi que la source entre crochets (par exemple `LOG [NestApplication]`). Certaines de ces lignes se terminent par une durée comme `+0ms`. La dernière ligne de la sortie filtrée est `[DB] pool budget ...`. Un journal enregistré dans un fichier peut contenir des codes de couleur comme `[33m`.

Deux lignes sont attendues et ne demandent aucune action : `Admin seeding disabled ...` et, tant que vous n'avez pas configuré l'e-mail, l'avertissement `EmailService`. Un avertissement `[SECURITY]`, `[CONFIG]`, `[CORS]` ou `[ENV] APP_ENV is not set` signale un paramètre à revoir : [Configuration](configuration.md#ce-que-le-journal-de-lapi-affiche-au-demarrage) explique chaque ligne.

---

## 8. nginx et TLS

Installez nginx :

```bash
sudo apt-get install -y nginx
```

### Le serveur résout le nom

Les vérifications des étapes suivantes s'exécutent sur ce serveur et appellent KANAP par son nom : le serveur doit donc le résoudre. Avec un enregistrement DNS, c'est déjà le cas. Sans enregistrement, cette commande ajoute le nom au fichier hosts du serveur (elle ne fait rien si le nom se résout déjà) :

```bash
. ~/kanap-install.env
getent hosts "${KANAP_HOST}" || echo "127.0.0.1 ${KANAP_HOST}" | sudo tee -a /etc/hosts
```

Les postes des utilisateurs ont besoin de l'enregistrement DNS ou, pour un test, d'une ligne dans leur propre fichier hosts qui fait pointer le nom vers l'adresse de ce serveur.

### Certificat TLS

Utilisez l'un des trois cas de [Nom et certificat](installation.md#nom-et-certificat). Chacun se termine en écrivant les chemins du certificat et de la clé dans `~/kanap-install.env`.

**Auto-signé (tests uniquement, utilisé dans cet exemple).** Chaque navigateur affiche un avertissement que chaque utilisateur doit accepter.

```bash
. ~/kanap-install.env
sudo install -d /etc/ssl/kanap
sudo openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout /etc/ssl/kanap/server.key \
  -out /etc/ssl/kanap/server.crt \
  -subj "/CN=${KANAP_HOST}" \
  -addext "subjectAltName=DNS:${KANAP_HOST}"
sudo chmod 600 /etc/ssl/kanap/server.key
printf 'KANAP_CERT=%s\nKANAP_KEY=%s\n' /etc/ssl/kanap/server.crt /etc/ssl/kanap/server.key >> ~/kanap-install.env
```

**Certificat de votre autorité interne.** Demandez un certificat pour le même nom. Copiez la chaîne complète et la clé privée dans `/etc/ssl/kanap/fullchain.pem` et `/etc/ssl/kanap/privkey.pem` (clé en mode `600`), puis enregistrez les chemins. Les navigateurs des postes gérés font déjà confiance à l'autorité : les utilisateurs ne voient aucun avertissement.

```bash
printf 'KANAP_CERT=%s\nKANAP_KEY=%s\n' /etc/ssl/kanap/fullchain.pem /etc/ssl/kanap/privkey.pem >> ~/kanap-install.env
```

**Let's Encrypt (nom public).** Le nom doit pointer vers ce serveur depuis internet et le port 80 doit être joignable. La page nginx par défaut répond au challenge : lancez donc cette commande avant d'activer le site KANAP. Le paquet `certbot` renouvelle le certificat de lui-même ; le hook de déploiement recharge nginx après chaque renouvellement.

```bash
. ~/kanap-install.env
sudo apt-get install -y certbot
sudo certbot certonly --webroot -w /var/www/html -d "${KANAP_HOST}" \
  -m "${ADMIN_EMAIL}" --agree-tos --no-eff-email --non-interactive \
  --deploy-hook 'systemctl reload nginx'
printf 'KANAP_CERT=%s\nKANAP_KEY=%s\n' "/etc/letsencrypt/live/${KANAP_HOST}/fullchain.pem" "/etc/letsencrypt/live/${KANAP_HOST}/privkey.pem" >> ~/kanap-install.env
sudo certbot renew --dry-run
```

### Configuration du site

Écrivez le fichier du site avec des marqueurs pour le nom et le certificat, puis remplacez-les. Le fichier est prévu pour nginx 1.25.1 et plus récent (Ubuntu 26.04 fournit la 1.28). Il envoie `/api/` directement au port de l'API (`127.0.0.1:8080`) pour que KANAP voie l'adresse de chaque utilisateur.

```bash
sudo tee /etc/nginx/sites-available/kanap >/dev/null <<'EOF'
server {
    # HTTP/2 : le navigateur envoie les dizaines de requêtes d'une page sur une seule connexion.
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name KANAP_HOST;

    ssl_certificate     KANAP_CERT;
    ssl_certificate_key KANAP_KEY;

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
    server_name KANAP_HOST;

    # Renouvellement du certificat avec Let's Encrypt (webroot) ; sans effet sinon
    location /.well-known/acme-challenge/ { root /var/www/html; }

    location / { return 301 https://$host$request_uri; }
}
EOF

. ~/kanap-install.env
sudo sed -i -e "s|KANAP_HOST|${KANAP_HOST}|g" -e "s|KANAP_CERT|${KANAP_CERT}|g" -e "s|KANAP_KEY|${KANAP_KEY}|g" /etc/nginx/sites-available/kanap
```

**Ubuntu 24.04 (nginx 1.24) :** cette version ne connaît pas la directive `http2 on;`. Exécutez une fois cette commande après les commandes ci-dessus :

```bash
sudo sed -i -e 's/listen 443 ssl;/listen 443 ssl http2;/' -e 's/listen \[::\]:443 ssl;/listen [::]:443 ssl http2;/' -e '/^ *http2 on;$/d' /etc/nginx/sites-available/kanap
```

Activez le site et redémarrez nginx :

```bash
sudo ln -sf /etc/nginx/sites-available/kanap /etc/nginx/sites-enabled/kanap
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
```

`nginx -t` doit afficher `syntax is ok` et `test is successful`.

---

## 9. Vérifier

Vérifiez la santé de l'API et du front-end à travers nginx. `-S` fait afficher à `curl` une erreur, par exemple un nom qui ne se résout pas. `-k` accepte un certificat auquel le serveur ne fait pas confiance : gardez-le avec un certificat auto-signé, ou avec un certificat de votre autorité interne lorsque cette autorité n'est pas installée sur le serveur ; retirez-le avec Let's Encrypt.

```bash
. ~/kanap-install.env
curl -sSk -w '\n' "https://${KANAP_HOST}/api/health"
# Attendu : {"status":"ok"}
curl -sSk -o /dev/null -w "%{http_code}\n" "https://${KANAP_HOST}/"
# Attendu : 200
```

Lancez ensuite le test de recette. Il vérifie la base de données, le stockage, la connexion et les exports à travers l'API publique, comme le fait l'application web. Le serveur n'a pas Node.js : le test s'exécute donc dans un conteneur. La ligne qui commence par `KANAP_PASSWORD=` lit le mot de passe administrateur dans `.env` et le place dans l'environnement du test sans l'afficher. La première exécution télécharge l'image `node:24-alpine` depuis Docker Hub (environ 240 Mo) et la garde pour les exécutions suivantes. `KANAP_WRITE=1` crée aussi une tâche temporaire avec une pièce jointe, ce qui vérifie le stockage, puis la supprime. Utilisez-le uniquement juste après l'installation : il écrit dans les données. La tâche temporaire consomme une référence de tâche (`T-1` sur une nouvelle installation) : votre première tâche est donc `T-2`. `KANAP_INSECURE_TLS=1` accepte un certificat auquel le conteneur ne fait pas confiance : gardez-le avec un certificat auto-signé. Avec un certificat de votre autorité interne, vous pouvez le garder ou laisser le conteneur vérifier le certificat : placez le fichier de l'autorité dans `/opt/kanap/infra/certs/` (voir [Certificats d'une autorité interne](configuration.md#facultatif-certificats-dune-autorite-interne)) et remplacez `-e KANAP_INSECURE_TLS=1` par `-v /opt/kanap/infra/certs:/certs:ro -e NODE_EXTRA_CA_CERTS=/certs/company-ca.pem`. Avec Let's Encrypt, retirez `-e KANAP_INSECURE_TLS=1`.

```bash
. ~/kanap-install.env
KANAP_PASSWORD="$(grep '^ADMIN_PASSWORD=' /opt/kanap/.env | cut -d= -f2-)"; export KANAP_PASSWORD
docker run --rm --network host \
  -e KANAP_URL="https://${KANAP_HOST}" -e KANAP_EMAIL="${ADMIN_EMAIL}" -e KANAP_PASSWORD \
  -e KANAP_INSECURE_TLS=1 -e KANAP_WRITE=1 \
  -v /opt/kanap/scripts/smoke:/smoke:ro node:24-alpine node /smoke/recette.mjs
unset KANAP_PASSWORD
```

La dernière ligne se termine par `0 failed` : elle ressemble à `25 OK, 1 skipped, 0 failed (0.5 s)`. Avec `KANAP_INSECURE_TLS=1`, deux avertissements TLS en haut de la sortie sont attendus. Un `SKIP` pour les paramètres d'IA est normal tant que les fonctions d'IA sont désactivées. Pour finir, vérifiez que le journal de l'API ne contient aucun avertissement de stockage :

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml logs api | grep 'PutObject fallback' || echo "no storage warning"
```

---

## 10. Première connexion

1. Ouvrez `https://<votre nom>` dans un navigateur (acceptez l'avertissement de certificat si vous utilisez un certificat auto-signé ; le poste doit résoudre le nom).
2. Connectez-vous avec `ADMIN_EMAIL` et le mot de passe administrateur. Pour voir le mot de passe, exécutez `grep '^ADMIN_PASSWORD=' /opt/kanap/.env | cut -d= -f2-` sur le serveur. Il s'affiche à l'écran : exécutez la commande quand personne d'autre ne voit votre écran.
3. Changez le mot de passe dans votre profil juste après cette première connexion. KANAP lit la valeur de `.env` au premier démarrage uniquement.
4. Ajoutez votre logo et vos couleurs dans **Administration → Personnalisation** (facultatif).
5. Invitez d'autres utilisateurs (si l'e-mail est configuré).

L'installation est terminée. `~/kanap-install.env` a rempli son rôle : chaque valeur se trouve désormais dans `/opt/kanap/.env`, `/etc/default/rustfs` et le rôle PostgreSQL. Supprimez le fichier :

```bash
rm ~/kanap-install.env
```

Mettez ensuite en place les [sauvegardes](operations.md#sauvegarde-et-restauration).

---

## Récapitulatif des services

| Service    | Géré par       | Configuration                                         |
|------------|----------------|-------------------------------------------------------|
| Docker     | systemd        | aucune                                                |
| PostgreSQL | systemd (`postgresql@<version>-main`) | `/etc/postgresql/<version>/main/conf.d/`, `pg_hba.conf` |
| RustFS     | systemd        | `/etc/default/rustfs` (contient la clé de chiffrement), `/root/.config/rc/config.toml` (contient les clés d'administration du stockage pour l'outil `rc`) |
| Pare-feu   | ufw            | `sudo ufw status`                                     |
| API KANAP  | Docker Compose | `/opt/kanap/.env` + `infra/compose.onprem.yml`        |
| Web KANAP  | Docker Compose | `/opt/kanap/.env` + `infra/compose.onprem.yml`        |
| nginx      | systemd        | `/etc/nginx/sites-available/kanap`                    |

## Commandes utiles

Exécutez ces commandes une par une. `logs -f` suit le journal jusqu'à ce que vous appuyiez sur Ctrl+C, et `down` arrête KANAP.

```bash
cd /opt/kanap

# Afficher les journaux
docker compose -f infra/compose.onprem.yml logs -f

# Redémarrer KANAP
docker compose -f infra/compose.onprem.yml restart

# Appliquer une modification de .env
docker compose -f infra/compose.onprem.yml up -d api

# Arrêter KANAP
docker compose -f infra/compose.onprem.yml down

# Vérifier tous les services (pg_lsclusters affiche le cluster en ligne)
pg_lsclusters
sudo systemctl status --no-pager nginx rustfs
docker compose -f infra/compose.onprem.yml ps

# Version en service : le checkout, puis l'API (-k : voir l'étape 9)
git describe --tags
curl -sSk -w '\n' "$(grep '^APP_BASE_URL=' .env | cut -d= -f2-)/api/config/public"
```

Vérifiez PostgreSQL avec `pg_lsclusters`. `systemctl status postgresql` reste `active` même quand le cluster est arrêté. Le champ `version` de la dernière réponse est la version que l'API indique.

Pour mettre à jour KANAP, suivez la [procédure de mise à jour](operations.md#procedure-de-mise-a-jour) : lisez le changelog, puis `git pull origin stable`, `build --pull` et `up -d`.
