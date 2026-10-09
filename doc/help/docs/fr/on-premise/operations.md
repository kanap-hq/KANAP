# Opérations on-premise

Les commandes de cette page s'exécutent sur le serveur KANAP, dans `/opt/kanap` sauf mention contraire. Plusieurs d'entre elles utilisent deux variables shell. Définissez-les une fois dans votre session de terminal, avec vos valeurs :

```bash
KANAP_HOST=kanap.example.internal    # le nom que saisissent les utilisateurs pour ouvrir KANAP, sans https://
ADMIN_EMAIL=admin@example.internal   # l'e-mail d'un compte administrateur
```

Les commandes `curl` de cette page utilisent `-k`. Elles vérifient ce que KANAP répond : elles acceptent donc aussi un certificat auquel le serveur ne fait pas confiance (auto-signé, ou délivré par une autorité interne qui n'est pas installée sur le serveur).

## Procédure de mise à jour

KANAP publie une nouvelle version environ une fois par mois. La branche `stable` pointe toujours vers la dernière version publiée. Chaque version a une entrée dans `CHANGELOG.md` à la racine du dépôt. Une entrée qui demande une action de votre part (un paramètre à modifier, une étape à exécuter) porte « Action required » dans son titre.

**1. Lisez le changelog avant de récupérer la nouvelle version.** Récupérez le nouvel état de `stable` et affichez uniquement les entrées que vous n'avez pas encore. Lisez d'abord les entrées marquées « Action required », et faites ce qu'elles indiquent. Les mêmes entrées figurent sur la page des releases GitHub du dépôt.

```bash
cd /opt/kanap
git fetch origin stable
git diff HEAD origin/stable -- CHANGELOG.md
```

**2. Sauvegardez la base de données, les fichiers et la configuration.** Exécutez les commandes de [Avant une mise à jour](#avant-une-mise-a-jour). Elles écrivent dans un répertoire qui leur est propre, auquel la sauvegarde quotidienne ne touche jamais. Les migrations vont seulement vers l'avant : cette sauvegarde est le chemin du retour.

**3. Récupérer, construire, démarrer.**

```bash
cd /opt/kanap
git checkout stable
git pull origin stable
docker compose -f infra/compose.onprem.yml build --pull
docker compose -f infra/compose.onprem.yml up -d
# L'ancien conteneur API termine d'abord les requêtes en cours, les e-mails qu'il a mis en file et
# ses tâches de fond en cours (jusqu'à 20 s), puis s'arrête. Les migrations s'exécutent au démarrage du nouveau.
```

Docker Compose construit lui-même les images `api` et `web`, à partir des sources que vous venez de récupérer. `--pull` récupère aussi les images de base mises à jour. Lancer `up -d` seul conserve l'ancienne version, car Compose réutilise les images dont il dispose déjà. Lancez toujours `build` d'abord. Le build a besoin de la mémoire indiquée dans les [prérequis de l'installation](installation.md#prerequis). S'il s'arrête avec `signal: killed`, le serveur a manqué de mémoire : construisez les deux images l'une après l'autre (`build --pull api`, puis `build --pull web`), puis lancez `up -d`.

**Une version précise.** Pour exécuter une version publiée autre que la dernière, récupérez les tags et basculez sur l'un d'eux. Le checkout est détaché. Le `git checkout stable` de l'étape 3 le ramène sur la branche à la mise à jour suivante.

```bash
git fetch --tags
git checkout v26.10.1
```

Lancez ensuite les commandes `build --pull` et `up -d` ci-dessus.

**Suivre `main`.** La branche `main` contient chaque modification fusionnée avant sa publication dans une version. Il est possible de la suivre ; les versions publiées sont la voie recommandée.

**Version en service.**

```bash
cd /opt/kanap
git describe --tags
curl -sSk -w '\n' "https://${KANAP_HOST}/api/config/public"
```

La première commande affiche la version du checkout. La seconde répond par un document JSON dont le champ `version` est la version indiquée par l'API.

**4. Vérifiez la mise à jour.**

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml ps
docker compose -f infra/compose.onprem.yml logs --no-log-prefix api | grep -E '^\[|^Admin seeding|WARN|ERROR|successfully started|Email transport'
curl -sSk -w '\n' "https://${KANAP_HOST}/api/health"
```

- `ps` affiche `api` et `web` à l'état `healthy` au bout d'une minute environ. Quand la nouvelle version ne modifie pas le contenu web, Compose garde le conteneur `web` en service, et `ps` peut afficher un identifiant d'image à la place de `infra-web`. C'est attendu.
- Le journal de l'API montre les migrations (`[entrypoint] Migrations complete (N executed).`), puis le démarrage de l'API (`Nest application successfully started`). Lisez aussi les autres lignes de démarrage : [Configuration](configuration.md#ce-que-le-journal-de-lapi-affiche-au-demarrage) explique chacune d'elles.
- L'adresse de santé répond `{"status":"ok"}`.

Lancez ensuite le test de recette. Il vérifie la base de données, la connexion, les listes principales et les exports à travers l'API publique. Le serveur n'a pas Node.js : le test s'exécute donc dans un conteneur. La première exécution sur un serveur télécharge l'image `node:24-alpine` depuis Docker Hub (environ 240 Mo) et la garde : lancez le test une première fois tant que l'accès sortant est ouvert (voir [Règles de pare-feu](configuration.md#sortant-installation-initiale-et-compilation)). À l'invite, saisissez le mot de passe actuel du compte `ADMIN_EMAIL` ; rien ne s'affiche pendant la saisie. Le `ADMIN_PASSWORD` de `.env` n'est lu qu'au premier démarrage : il n'est donc peut-être plus le bon. Gardez `-e KANAP_INSECURE_TLS=1` quand le certificat est auto-signé (le conteneur ne lui fait pas confiance) ; retirez-le avec un certificat d'une autorité publique. Avec un certificat de votre autorité interne, gardez-le, ou remplacez-le par `-v /opt/kanap/infra/certs:/certs:ro -e NODE_EXTRA_CA_CERTS=/certs/company-ca.pem` pour que le conteneur vérifie le certificat avec le fichier de l'autorité placé dans `/opt/kanap/infra/certs/` (voir [Certificats d'une autorité interne](configuration.md#facultatif-certificats-dune-autorite-interne)). N'ajoutez pas `-e KANAP_WRITE=1` sur une installation de production : cette option crée une tâche temporaire avec une pièce jointe pour vérifier le stockage, ce qui ne convient qu'à une nouvelle installation.

```bash
read -rsp 'Administrator password: ' KANAP_PASSWORD; echo; export KANAP_PASSWORD
docker run --rm --network host \
  -e KANAP_URL="https://${KANAP_HOST}" -e KANAP_EMAIL="${ADMIN_EMAIL}" -e KANAP_PASSWORD \
  -e KANAP_INSECURE_TLS=1 \
  -v /opt/kanap/scripts/smoke:/smoke:ro node:24-alpine node /smoke/recette.mjs
unset KANAP_PASSWORD
```

La dernière ligne de la sortie indique `0 failed`. Avec `KANAP_INSECURE_TLS=1`, deux avertissements TLS en haut de la sortie sont attendus : celui du script et l'avertissement de Node.js à propos de `NODE_TLS_REJECT_UNAUTHORIZED`.

**Retour arrière.** Les migrations vont seulement vers l'avant : un retour arrière remet donc en place la sauvegarde prise avant la mise à jour, sous la version précédente :

1. Arrêtez KANAP : `cd /opt/kanap`, puis `docker compose -f infra/compose.onprem.yml down`. Un retour arrière commence souvent dans un nouveau terminal, hors de `/opt/kanap`.
2. Basculez sur la version précédente et construisez-la. Le build a besoin de l'accès sortant d'une mise à jour : si vous l'avez fermé après la mise à jour, rouvrez-le d'abord (voir [Règles de pare-feu](configuration.md#sortant-installation-initiale-et-compilation)). Lancez ensuite `git checkout v<previous version>` (par exemple `git checkout v26.10.1`), puis `docker compose -f infra/compose.onprem.yml build --pull`.
3. Restaurez la base de données et les fichiers depuis le répertoire `before-upgrade-...` de cette mise à jour : choisissez la sauvegarde, puis exécutez les étapes 1 à 3 de [Restauration](#restauration) dans le même terminal. Si vous avez modifié `.env` pour la nouvelle version, comparez-le avec la copie du répertoire `config` de la sauvegarde. Cette commande compare les noms des paramètres des deux fichiers sans afficher leurs valeurs :

    ```bash
    diff <(cut -d= -f1 /opt/kanap/.env | sort) <(sudo cut -d= -f1 "$BACKUP/config/.env" | sort)
    ```

    Elle liste uniquement les noms qui diffèrent. Pour comparer les valeurs, ouvrez les deux fichiers.
4. Démarrez KANAP : `docker compose -f infra/compose.onprem.yml up -d --wait`.
5. Vérifiez-le comme à l'étape 4 ci-dessus (**Vérifiez la mise à jour**). Ses commandes utilisent `KANAP_HOST` et `ADMIN_EMAIL` définis en haut de cette page : dans un nouveau terminal, définissez-les d'abord. La base restaurée contient les comptes et les mots de passe de la date de la sauvegarde : un mot de passe changé depuis reprend son ancienne valeur. Le test de recette demande donc le mot de passe valable au moment de la sauvegarde.

Construisez la version précédente avant de démarrer KANAP : un démarrage avec la version plus récente exécuterait de nouveau ses migrations sur la base restaurée.

Après un retour arrière, restez sur le tag de la version vers laquelle vous êtes revenu. Le `git checkout stable` de la procédure de mise à jour (son étape 3) ramène le checkout sur la branche à la mise à jour suivante. Le checkout (`git describe --tags`) et l'API en service (`/api/config/public`, voir [Version en service](#procedure-de-mise-a-jour)) doivent afficher la même version. S'ils diffèrent, le prochain `build` change la version en service.

## Support des versions

KANAP est une solution qui évolue rapidement. Les versions sont publiées environ une fois par mois, et nous recommandons de mettre à jour au moins une fois par mois.
Pour les clients sous support, une mise à jour vers la dernière version peut être demandée avant le traitement d'une demande de support.

## Sauvegarde et restauration

Sauvegardez trois choses : la base de données, les fichiers du stockage et la configuration. Les commandes ci-dessous correspondent à l'[exemple d'installation](installation-example.md) : PostgreSQL et RustFS sur le serveur. Avec un service PostgreSQL managé ou un fournisseur S3, utilisez les instantanés, le versionnage ou la réplication qu'ils proposent, et sauvegardez quand même la configuration.

**Préparez le répertoire de sauvegarde** (une fois). Il contient des données personnelles et des secrets : seuls `root` et `postgres` peuvent le lire.

```bash
sudo install -d -o postgres -g postgres -m 0700 /var/backups/kanap
sudo install -d -m 0700 /var/backups/kanap/files /var/backups/kanap/config
```

**Base de données.** `pg_dump -Fc` écrit un dump compressé que `pg_restore` sait relire.

```bash
sudo -u postgres pg_dump -Fc -f /var/backups/kanap/db-$(date +%F).dump kanap
sudo -u postgres pg_restore --list /var/backups/kanap/db-$(date +%F).dump | head -5
```

**Fichiers.** L'outil `rc` de l'exemple d'installation copie le bucket dans un répertoire. Il utilise l'alias `kanapstore` que l'installation a défini dans la configuration de root. La copie est un miroir du bucket : les fichiers supprimés dans KANAP en disparaissent à l'exécution suivante. La copie passe par l'interface S3 du stockage : elle contient donc les fichiers en clair. Protégez le répertoire en conséquence.

```bash
sudo rc mirror --overwrite --remove kanapstore/kanap-files /var/backups/kanap/files
```

Pour tout autre stockage S3, `rclone` fait le même travail (`sudo apt-get install -y rclone`). Remplacez les valeurs d'exemple par celles de votre stockage. `sudo` transmet uniquement les variables que `KEEP` nomme, et il écrit leurs valeurs dans le journal système. Les deux clés se saisissent donc dans le shell `sudo`, aux invites (les `AWS_ACCESS_KEY_ID` et `AWS_SECRET_ACCESS_KEY` de `.env`). `rclone check` compare ensuite la copie avec le bucket :

```bash
export RCLONE_S3_PROVIDER=Other
export RCLONE_S3_ENDPOINT='https://s3.example.com'   # S3_ENDPOINT de .env, tel que le serveur l'atteint
export RCLONE_S3_REGION='us-east-1'                   # S3_REGION de .env
export RCLONE_S3_FORCE_PATH_STYLE=true                # S3_FORCE_PATH_STYLE de .env
export BUCKET=kanap-files                             # S3_BUCKET de .env
export DEST=/var/backups/kanap/files
KEEP=RCLONE_S3_PROVIDER,RCLONE_S3_ENDPOINT,RCLONE_S3_REGION,RCLONE_S3_FORCE_PATH_STYLE,BUCKET,DEST
sudo --preserve-env="$KEEP" bash -c '
  read -rp "Access key: " RCLONE_S3_ACCESS_KEY_ID
  read -rsp "Secret key: " RCLONE_S3_SECRET_ACCESS_KEY; echo
  export RCLONE_S3_ACCESS_KEY_ID RCLONE_S3_SECRET_ACCESS_KEY
  rclone sync ":s3:${BUCKET}" "$DEST" && rclone check ":s3:${BUCKET}" "$DEST"'
```

`rclone check` se termine par `0 differences found`. rclone peut aussi afficher `Config file "/root/.config/rclone/rclone.conf" not found - using defaults` : les variables remplacent ce fichier. Utilisez `RCLONE_S3_PROVIDER=AWS` pour AWS S3. Pour RustFS sur le serveur, le point d'accès est `http://172.17.0.1:9000` : `host.docker.internal` n'existe qu'à l'intérieur des conteneurs.

**Configuration.** Gardez une copie de `/opt/kanap/.env` et de `/etc/default/rustfs`. Le premier contient tous les secrets de l'installation, y compris `AI_SETTINGS_ENCRYPTION_SECRET` si vous l'utilisez. Le second contient la clé de chiffrement de RustFS : les fichiers chiffrés avec elle sont illisibles sans elle. Gardez aussi le fichier du site nginx (`/etc/nginx/sites-available/kanap`) et les fichiers du certificat.

```bash
sudo cp -p /opt/kanap/.env /etc/default/rustfs /var/backups/kanap/config/
```

**Chaque jour, avec 30 jours d'historique.** Ce fichier cron lance les trois sauvegardes la nuit et supprime les dumps de base de données de plus de 30 jours. Il écrit un dump par jour ; la copie des fichiers et la copie de la configuration gardent le dernier état.

```bash
sudo tee /etc/cron.d/kanap-backup >/dev/null <<'EOF'
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
15 2 * * * postgres pg_dump -Fc -f /var/backups/kanap/db-$(date +\%F).dump kanap
30 2 * * * root rc mirror --overwrite --remove kanapstore/kanap-files /var/backups/kanap/files
45 2 * * * root cp -p /opt/kanap/.env /etc/default/rustfs /var/backups/kanap/config/
0 3 * * * root find /var/backups/kanap -maxdepth 1 -name 'db-*.dump' -mtime +30 -delete
EOF
```

**Copiez le répertoire de sauvegarde hors du serveur.** Une sauvegarde sur le même disque ne survit pas à la perte du serveur. Copiez `/var/backups/kanap` sur une autre machine chaque jour, par exemple avec `rsync -a /var/backups/kanap/ <user>@<backup host>:<directory>/` depuis une tâche planifiée, ou avec l'outil de sauvegarde que vous utilisez déjà. La copie contient des secrets et des données personnelles : protégez sa destination.

**Testez une restauration tous les quelques mois**, sur un serveur de secours, pour savoir que les sauvegardes fonctionnent avant d'en avoir besoin.

### Avant une mise à jour

Avant chaque mise à jour, prenez une sauvegarde complète dans un répertoire daté qui lui est propre, par exemple `/var/backups/kanap/before-upgrade-20261009-1400/`. Il contient `db.dump`, `files/` et `config/`. La sauvegarde quotidienne écrit d'autres noms : elle n'écrase donc jamais celle-ci.

```bash
B=/var/backups/kanap/before-upgrade-$(date +%Y%m%d-%H%M)
sudo install -d -o postgres -g postgres -m 0700 "$B"
sudo install -d -m 0700 "$B/files" "$B/config"
sudo -u postgres pg_dump -Fc -f "$B/db.dump" kanap
sudo -u postgres pg_restore --list "$B/db.dump" | head -5
sudo rc mirror --overwrite --remove kanapstore/kanap-files "$B/files"
sudo cp -p /opt/kanap/.env /etc/default/rustfs "$B/config/"
echo "$B"
```

La dernière ligne affiche le répertoire. Notez-le : un retour arrière restaure à partir de lui. Avec un autre stockage S3, remplacez la ligne `rc mirror` par le bloc `rclone` de la sauvegarde des fichiers ci-dessus. Exécutez-le dans le même terminal, après les autres lignes, avec `export DEST="$B/files"` à la place de sa ligne `DEST`.

Gardez ce répertoire jusqu'à ce que la nouvelle version ait fonctionné sans problème pendant quelques semaines. Le `find ... -mtime +30 -delete` quotidien du fichier cron supprime uniquement les anciens dumps quotidiens. Supprimez vous-même un ancien répertoire `before-upgrade-...` : listez-les avec `sudo ls /var/backups/kanap/`, puis lancez `sudo rm -r` suivi du chemin du répertoire.

### Restauration

Ces étapes remplacent la base de données et les fichiers par le contenu d'une sauvegarde. Exécutez-les dans l'ordre, dans un seul terminal : chaque étape utilise les variables que vous définissez au début.

**Choisissez la sauvegarde.** Listez les sauvegardes :

```bash
sudo ls /var/backups/kanap/
```

La liste montre les répertoires `before-upgrade-...` et les dumps quotidiens (`db-YYYY-MM-DD.dump`). Pour restaurer une sauvegarde prise avant une mise à jour, définissez son répertoire :

```bash
BACKUP=/var/backups/kanap/before-upgrade-20261009-1400   # votre répertoire
DUMP="$BACKUP/db.dump"
FILES="$BACKUP/files"
```

Pour restaurer plutôt une sauvegarde quotidienne, définissez le dump de ce jour. La copie quotidienne des fichiers contient le dernier état des fichiers :

```bash
DUMP=/var/backups/kanap/db-2026-10-09.dump   # votre date
FILES=/var/backups/kanap/files
```

**1. Restaurez la base de données.** Ce bloc arrête KANAP, recrée la base de données avec le rôle applicatif comme propriétaire et restaure le dump. Il n'exécute rien si le fichier de dump n'existe pas ou si `pg_restore` ne peut pas le lire :

```bash
cd /opt/kanap
sudo test -s "$DUMP" \
  && sudo -u postgres pg_restore --list "$DUMP" </dev/null >/dev/null \
  && docker compose -f infra/compose.onprem.yml down \
  && sudo -u postgres psql -X -v ON_ERROR_STOP=1 -c 'DROP DATABASE IF EXISTS kanap' \
  && sudo -u postgres psql -X -v ON_ERROR_STOP=1 -c 'CREATE DATABASE kanap OWNER kanap TEMPLATE template0' \
  && sudo -u postgres pg_restore -d kanap "$DUMP" </dev/null \
  && echo 'Database restored' \
  || echo 'Stopped. Read the message above; with no message, DUMP is empty or the file is missing.'
```

La dernière ligne indique `Database restored`. Si elle indique `Stopped`, rien n'a été exécuté après la commande en échec.

Lancez `pg_restore` en tant que `postgres` et sans `--no-owner`. Le dump enregistre le propriétaire de chaque objet (`kanap`) : la restauration rend donc les tables au rôle applicatif, avec leurs paramètres de sécurité au niveau des lignes. Avec `--no-owner`, les tables appartiendraient à `postgres` et l'API ne pourrait pas les utiliser. Le rôle `kanap` doit exister : sur un nouveau serveur, créez-le comme à l'[étape 4 de l'exemple d'installation](installation-example.md#4-postgresql) avant cette étape.

**2. Restaurez les fichiers.** La copie remplace le contenu du bucket. La commande ne s'exécute que si la copie existe :

```bash
sudo test -d "$FILES" \
  && sudo rc mirror --overwrite --remove "$FILES" kanapstore/kanap-files \
  && echo 'Files restored' \
  || echo 'Files not restored. Read the message above; with no message, FILES is empty or the directory is missing.'
```

Si le stockage a été perdu lui aussi, remettez-le en place comme à l'[étape 5 de l'exemple d'installation](installation-example.md#5-stockage-objet-rustfs), avec le même `/etc/default/rustfs`, avant cette étape.

**3. Vérifiez le résultat.** La première requête affiche `0` (aucune table détenue par un autre rôle) et la seconde affiche un nombre supérieur à `0` (les tables qui portent la sécurité au niveau des lignes) :

```bash
sudo -u postgres psql -d kanap -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tableowner <> 'kanap'"
sudo -u postgres psql -d kanap -Atc "SELECT count(*) FROM pg_class WHERE relrowsecurity AND relforcerowsecurity"
```

**4. Démarrez KANAP.**

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml up -d --wait
```

Lancez ensuite le test de recette de [Vérifiez la mise à jour](#procedure-de-mise-a-jour) et ouvrez KANAP dans un navigateur. Les comptes et les mots de passe sont ceux de la date de la sauvegarde : connectez-vous avec le mot de passe valable à ce moment-là.

## Image des outils de maintenance

L'image de l'API contient uniquement l'application compilée. Une commande de maintenance qui a besoin de TypeScript, comme `npm run typeorm`, s'exécute dans une seconde image construite à partir des mêmes sources. Construisez-la à partir du checkout actuel juste avant chaque utilisation, pour qu'elle corresponde à la version en service. Le build réutilise les couches en cache de l'image de l'API et prend environ 10 à 20 secondes lorsque l'image de l'API est déjà construite :

```bash
cd /opt/kanap
docker build --target dev -t kanap-api-tools backend
```

Exécutez-y une commande avec le même `.env` et le même répertoire de certificats que l'API (voir [Certificats d'une autorité interne](configuration.md#facultatif-certificats-dune-autorite-interne)). Cet exemple liste les migrations et indique si elles sont appliquées :

```bash
cd /opt/kanap
docker run --rm --env-file .env --add-host host.docker.internal:host-gateway \
  -v /opt/kanap/infra/certs:/etc/kanap/certs:ro \
  kanap-api-tools npm run typeorm -- migration:show
```

## Paramètres PostgreSQL

Les valeurs par défaut de PostgreSQL sont prévues pour une petite machine. `infra/postgres/kanap-pg-tune.sh` affiche des paramètres dimensionnés d'après la mémoire de votre serveur (mémoire, coûts SSD, journal des requêtes lentes, statistiques des requêtes). Exécutez-le sur le serveur PostgreSQL et lisez le fichier avant de l'appliquer : son en-tête explique chaque valeur. L'exemple d'installation l'applique à l'[étape 4](installation-example.md#dimensionner-postgresql-pour-ce-serveur).

```bash
cd /opt/kanap
PGVER=18   # 16 sur Ubuntu 24.04
# Les bibliothèques que PostgreSQL précharge déjà (souvent aucune) : le script les conserve.
CURRENT=$(sudo -u postgres psql -XAtc 'SHOW shared_preload_libraries')
# PostgreSQL sur le même serveur que KANAP (ajoutez --dedicated s'il dispose du serveur pour lui seul)
sh infra/postgres/kanap-pg-tune.sh --preload "$CURRENT" | sudo tee /etc/postgresql/${PGVER}/main/conf.d/kanap.conf >/dev/null
sudo systemctl restart postgresql
sudo -u postgres psql -d kanap -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
```

Lorsque la base de données a déjà l'extension, comme après l'exemple d'installation, la dernière commande affiche `NOTICE:  extension "pg_stat_statements" already exists, skipping`. C'est attendu.

Deux vérifications avant le redémarrage, toutes deux faites par le script, qui écrit la ligne `shared_preload_libraries` en commentaire lorsque l'une échoue :

- **La liste des bibliothèques préchargées.** `shared_preload_libraries` est une liste unique, et la valeur de `kanap.conf` remplace celle de `postgresql.conf`. Sans `--preload`, ajoutez vous-même en tête la valeur de `SHOW shared_preload_libraries` (par exemple `'pg_cron,pg_stat_statements'`), puis retirez le `#`.
- **La bibliothèque elle-même.** PostgreSQL ne démarre pas lorsqu'une bibliothèque préchargée manque. Elle est fournie avec PostgreSQL sur Debian et Ubuntu ; sur RHEL et ses dérivés, installez le paquet contrib (`postgresql16-contrib`). Vérifiez avec `ls "$(pg_config --pkglibdir)/pg_stat_statements.so"`.

Le redémarrage est nécessaire une seule fois, pour le paramètre de mémoire et les statistiques des requêtes : prévoyez-le dans une fenêtre de maintenance, car KANAP ne peut pas joindre sa base de données pendant le redémarrage de PostgreSQL. Les requêtes de plus de 500 ms apparaissent ensuite dans le journal de PostgreSQL, sans leurs paramètres (`log_parameter_max_length = 0` : ils peuvent contenir des données personnelles). `pg_stat_statements` liste les requêtes les plus coûteuses :

```sql
SELECT calls, round(mean_exec_time) AS avg_ms, left(query, 80) AS query
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;
```

Les migrations de KANAP font aussi démarrer l'autovacuum plus tôt sur les deux plus grandes tables (les montants budgétaires). Cela ne demande ni redémarrage ni mémoire.

## Supervision

**Santé.** L'API répond à `GET /health` sur son propre port et à `GET /api/health` à travers le reverse proxy. Les deux renvoient `{"status":"ok"}` :

```bash
curl -sSk -w '\n' http://127.0.0.1:8080/health
curl -sSk -w '\n' "https://${KANAP_HOST}/api/health"
```

**Conteneurs.** `docker compose -f infra/compose.onprem.yml ps` affiche `healthy` pour `api` et `web` dès qu'ils répondent. Docker se contente de le signaler : rien ne redémarre en fonction de cet état.

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml ps
docker compose -f infra/compose.onprem.yml logs -f api
```

Docker garde au plus 5 fichiers de 10 Mo de journaux par conteneur (environ 50 Mo) : le journal ne remonte donc pas plus loin.

**Indicateurs clés :**

- Conteneurs en service (`api`, `web`)
- Mémoire de l'API inférieure à ~1 Go par processus API
- Connexions à la base de données
- Utilisation du stockage

### Après un redémarrage

Rien à faire : tout démarre de soi-même. PostgreSQL et nginx démarrent comme services, le stockage de l'exemple d'installation démarre après Docker, et Docker relance les conteneurs `api` et `web`. L'API répond environ 10 secondes après le démarrage du serveur. Si PostgreSQL est plus lent que Docker, l'API réessaie de joindre la base de données (30 fois, à 2 secondes d'intervalle). Trois vérifications :

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml ps
curl -sSk -w '\n' "https://${KANAP_HOST}/api/health"
ss -ltn | grep 172.17.0.1:9000
```

- `ps` affiche `api` et `web` à l'état `healthy`. Pendant les 30 premières secondes environ après le démarrage, il peut encore afficher `health: starting` : relancez-le.
- L'adresse de santé répond `{"status":"ok"}`.
- La dernière commande affiche une ligne avec `172.17.0.1:9000` : le stockage de l'exemple d'installation est à l'écoute. Avec un autre stockage, vérifiez-le à votre manière.

### Métriques de l'API pour un outil de supervision

Renseignez `OPS_METRICS_TOKEN` dans `.env` (24 caractères ou plus, par exemple `openssl rand -hex 32`) et recréez l'API (`docker compose -f infra/compose.onprem.yml up -d api`). Votre outil de supervision peut alors lire :

```bash
OPS_METRICS_TOKEN=$(grep '^OPS_METRICS_TOKEN=' /opt/kanap/.env | cut -d= -f2-)
curl -sSk -w '\n' -H "Authorization: Bearer ${OPS_METRICS_TOKEN}" "https://${KANAP_HOST}/api/ops/metrics"
```

La réponse est en JSON. Sans ce paramètre, l'adresse répond 404. Elle répond même quand l'API est surchargée : les chiffres qui ont besoin de la base de données sont alors marqués `db.statsStale`. Les champs à surveiller :

| Champ | Ce qu'il indique |
|---|---|
| `health.status` | `ok`, `warn` ou `critical`, d'après les seuils ci-dessous. `health.alerts` liste ce qui ne va pas et ce qu'il faut faire |
| `topRoutes` | Requêtes par route sur 5 minutes, avec les temps de réponse p50, p95 et p99 en millisecondes |
| `process.eventLoopLagMs.p95` | Combien de temps le fil principal de l'API a fait attendre les requêtes au cours de la dernière minute (la fraction de minute écoulée juste après un démarrage) |
| `db.pool.inUse`, `db.pool.inUseMax1m`, `db.pool.waitingCount` | Connexions à la base de données utilisées en ce moment, le maximum de la dernière minute, les requêtes qui en attendent une |
| `db.pool.wait.p95Ms1m`, `db.pool.wait.failures5m` | Temps pour obtenir une connexion à la base de données ; requêtes qui n'en ont obtenu aucune (réponse « occupé ») |
| `windows.5m.statusClasses` | Réponses par classe de statut sur 5 minutes |
| `processes`, `aggregate` | Avec plusieurs processus API : chacun d'eux, et tous ensemble |

Seuils d'alerte (`health` les applique ; avec plusieurs processus API, à l'ensemble des processus, et pour le pool de la base de données, au plus chargé). Une alerte se déclenche au-dessus du seuil :

| Alerte | Avertissement | Critique | Que faire |
|---|---|---|---|
| Boucle d'événements p95 (1 min) | 100 ms | 500 ms | Ajoutez des processus API (`API_WORKERS`) si le serveur a des cœurs libres |
| Attente d'une connexion à la base de données, p95 (1 min) | 50 ms | 1 s | Augmentez `DB_POOL_MAX` dans la limite du `max_connections` de PostgreSQL |
| Connexions utilisées, maximum sur 1 min | 90 % du pool | | Idem |
| Requêtes qui n'ont obtenu aucune connexion (5 min) | | toute occurrence | Vérifiez que PostgreSQL fonctionne et que `max_connections` n'est pas atteint |
| Erreurs serveur (5 min, à partir de 20 requêtes) | 1 % | 5 % | Lisez le journal de l'API |
| p95 d'une route (5 min, à partir de 20 requêtes) | 1 s | 3 s | Signalez-le avec le nom de la route ; les routes d'import, d'export et d'IA ne sont pas comptées |
| Mémoire d'un processus API | 1 Go | | Redémarrez l'API ; signalez-le si cela se reproduit |

## Dépannage

Commencez par le journal de l'API : `docker compose -f infra/compose.onprem.yml logs --no-log-prefix --tail=200 api`.

| Symptôme | Vérification | Solution |
|---------|-------|----------|
| Les conteneurs ne démarrent pas | `docker compose -f infra/compose.onprem.yml logs api` | Recherchez les erreurs de démarrage |
| Le journal répète `[entrypoint] DB not ready or migration failed (attempt N)` | Le texte après `attempt N`, `DATABASE_URL`, `pg_hba.conf`, le pare-feu | L'API essaie 30 fois, à 2 secondes d'intervalle, puis s'arrête. Corrigez la cause indiquée par le message, puis lancez `docker compose -f infra/compose.onprem.yml up -d api` |
| Le message ci-dessus contient `self-signed certificate`, `unable to verify the first certificate` ou `unable to get local issuer certificate` | La fin de `DATABASE_URL` | `sslmode=require` vérifie entièrement le certificat du serveur. Utilisez `sslmode=disable` pour un PostgreSQL sur le même serveur. Si l'autorité de votre entreprise a signé le certificat, gardez `require` et faites en sorte que l'API fasse confiance à l'autorité (voir [Certificats d'une autorité interne](configuration.md#facultatif-certificats-dune-autorite-interne)). Sinon, utilisez `sslmode=no-verify` pour une connexion chiffrée sans vérification. Voir [Configuration](configuration.md#requis-base-de-donnees) |
| Le message ci-dessus contient `The server does not support SSL connections` | La fin de `DATABASE_URL` | Utilisez `sslmode=disable`, ou activez TLS sur PostgreSQL |
| `curl: (6) Could not resolve host` | Le nom dans l'adresse | Le serveur résout le nom par le DNS ou par `/etc/hosts`. Ajoutez l'enregistrement, ou une ligne `127.0.0.1 <name>` (votre nom à la place de `<name>`) dans `/etc/hosts` pour les vérifications lancées sur le serveur |
| `[DB] pool budget exceeded` dans le journal de l'API | `API_WORKERS`, `DB_POOL_MAX`, `max_connections` de PostgreSQL | Abaissez `DB_POOL_MAX` à la valeur indiquée par le message (ou `API_WORKERS`), ou augmentez `max_connections` |
| « Database connection failed » | Vérifiez `DATABASE_URL` | Vérifiez l'accessibilité de PostgreSQL et les identifiants. Un mot de passe qui contient `@ : / # ? %` doit être encodé en pourcentage dans l'URL |
| Les envois ou téléchargements échouent (« S3 error », `S3_BUCKET is not configured`) | Les variables `S3_*` | Vérifiez que le bucket existe, que les clés et les autorisations sont correctes |
| `Authorization header malformed` ou `unexpected scope` dans une erreur de stockage | `S3_REGION` | Utilisez la région attendue par votre stockage (`us-east-1` pour RustFS, celle définie dans sa configuration pour Garage) |
| `getaddrinfo ENOTFOUND <bucket>.host.docker.internal` | `S3_FORCE_PATH_STYLE` | Renseignez `S3_FORCE_PATH_STYLE=true` pour RustFS, MinIO, Garage et les autres stockages auto-hébergés |
| Avertissement `PutObject fallback used` | Le chiffrement du stockage | Le stockage a refusé la demande de chiffrement. Avec RustFS, renseignez `RUSTFS_SSE_S3_MASTER_KEY` dans `/etc/default/rustfs` et redémarrez-le (`sudo systemctl restart rustfs`) |
| Avertissement `[RATE-LIMIT] ... RATE_LIMIT_TRUST_PROXY not set` | `.env` | Renseignez `RATE_LIMIT_TRUST_PROXY=true` (nginx devant) ou `false` (rien devant), puis `up -d api`. Voir [Configuration](configuration.md#facultatif-avance) |
| Tout le monde partage une seule limite de connexion (`429` pour de nombreux utilisateurs) | `RATE_LIMIT_TRUST_PROXY` et le proxy | Avec un proxy devant, renseignez `true` et faites envoyer `X-Forwarded-For` par le proxy |
| Avertissement `[SECURITY]` à chaque démarrage | `ADMIN_PASSWORD`, `JWT_SECRET` | Changez le mot de passe de l'administrateur dans l'application, ou voir [Réinitialisation du mot de passe](#reinitialisation-du-mot-de-passe). Utilisez un `JWT_SECRET` de 32 caractères ou plus |
| Échec de migration | Version de PostgreSQL | Doit être 16+, extensions disponibles |
| 502 renvoyé par le reverse proxy | `docker compose -f infra/compose.onprem.yml ps` | Vérifiez que le conteneur api tourne sur le port 8080 |
| 413 renvoyé par le reverse proxy lors d'un envoi | `client_max_body_size` | Renseignez `client_max_body_size 50m;` dans le fichier nginx |
| Un e-mail de réinitialisation n'arrive pas, et le journal de l'API contient une ligne `ERROR` avec `unable to verify the first certificate` ou `self-signed certificate` et le code `ESOCKET` | Le certificat du relais de messagerie | L'API ne fait pas confiance à l'autorité qui a signé le certificat du relais. Donnez-lui le fichier de l'autorité (voir [Certificats d'une autorité interne](configuration.md#facultatif-certificats-dune-autorite-interne)). Installer l'autorité sur le serveur lui-même ne change rien pour le conteneur |
| Impossible de se connecter | Le mot de passe | `.env` crée l'administrateur au premier démarrage uniquement. Changez le mot de passe dans l'application, ou utilisez la [réinitialisation du mot de passe](#reinitialisation-du-mot-de-passe) |

## Réinitialisation du mot de passe

**Recommandé :** configurez l'e-mail (API Resend ou SMTP en single-tenant) et utilisez **Mot de passe oublié** sur la page de connexion.

**Solution de secours (SQL) :** si l'e-mail n'est pas configuré, réinitialisez le mot de passe directement dans la base de données. Cela se fait en deux étapes : calculer le hash du nouveau mot de passe dans le conteneur API, puis écrire ce hash en tant que superutilisateur PostgreSQL. Le rôle applicatif ne peut pas faire la seconde étape : la sécurité au niveau des lignes lui masque tous les utilisateurs quand aucun espace de travail n'est sélectionné.

Indiquez l'e-mail du compte dans la première ligne, puis saisissez le nouveau mot de passe à l'invite (rien ne s'affiche pendant la saisie) :

```bash
cd /opt/kanap
USER_EMAIL=admin@example.internal   # le compte à réinitialiser
read -rsp 'New password: ' NEW_PASSWORD; echo
HASH=$(printf '%s' "$NEW_PASSWORD" | docker compose -f infra/compose.onprem.yml exec -T api node -e "let p='';process.stdin.on('data',d=>p+=d).on('end',()=>require('argon2').hash(p).then(console.log))")
unset NEW_PASSWORD
sudo -u postgres psql -d kanap -v email="${USER_EMAIL}" <<SQL
UPDATE users SET password_hash = '${HASH}' WHERE lower(email) = lower(:'email');
SQL
```

Le mot de passe et son hash passent par l'entrée standard : aucun des deux n'apparaît dans la liste des processus ni dans le journal système. `psql` répond `UPDATE 1`. `UPDATE 0` signifie qu'aucun compte n'a cet e-mail.

Cette méthode SQL est une solution de dernier recours pour les administrateurs bloqués.
