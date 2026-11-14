# Opérations on-premise

Les commandes de cette page s'exécutent sur le serveur Kadratis, dans `/opt/kanap` sauf mention contraire. Plusieurs d'entre elles utilisent deux variables shell. Définissez-les une fois dans votre session de terminal, avec vos valeurs :

```bash
KANAP_HOST=kanap.example.internal    # le nom que saisissent les utilisateurs pour ouvrir Kadratis, sans https://
ADMIN_EMAIL=admin@example.internal   # l'e-mail d'un compte administrateur
```

Les commandes `curl` de cette page utilisent `-k`. Elles vérifient ce que Kadratis répond : elles acceptent donc aussi un certificat auquel le serveur ne fait pas confiance (auto-signé, ou délivré par une autorité interne qui n'est pas installée sur le serveur).

## Procédure de mise à jour

Kadratis publie une nouvelle version environ une fois par mois. La branche `stable` pointe toujours vers la dernière version publiée. Chaque version a une entrée dans `CHANGELOG.md` à la racine du dépôt. Une entrée qui demande une action de votre part (un paramètre à modifier, une étape à exécuter) porte « Action required » dans son titre.

**1. Lisez le changelog avant de récupérer la nouvelle version.** Récupérez le nouvel état de `stable` avec les étiquettes de version, et affichez uniquement les entrées que vous n'avez pas encore. Lisez d'abord les entrées marquées « Action required », et faites ce qu'elles indiquent. Les mêmes entrées figurent sur la page des releases GitHub du dépôt.

```bash
cd /opt/kanap
git fetch --tags origin stable
git diff HEAD origin/stable -- CHANGELOG.md
```

Gardez `--tags`. Un `git fetch` ou un `git pull` qui nomme une branche ne ramène pas les étiquettes de version. Sans elles, `git describe --tags` affiche une version plus ancienne suivie d'un nombre de commits (par exemple `v26.10.8-254-gcec464031`), et `git checkout v<version>` ne trouve pas les versions plus récentes. La même commande ramène les étiquettes manquantes sur une installation mise à jour sans elle.

**2. Sauvegardez la base de données, les fichiers et la configuration.** Exécutez les commandes de [Avant une mise à jour](#avant-une-mise-a-jour). Elles écrivent dans un répertoire qui leur est propre, auquel la sauvegarde quotidienne ne touche jamais. Les migrations vont seulement vers l'avant : cette sauvegarde est le chemin du retour.

**3. Récupérer et démarrer.**

```bash
cd /opt/kanap
git checkout stable
git pull origin stable
docker compose -f infra/compose.onprem.yml pull
docker compose -f infra/compose.onprem.yml up -d
# L'ancien conteneur API termine d'abord les requêtes en cours, les e-mails qu'il a mis en file et
# ses tâches de fond en cours (jusqu'à 20 s), puis s'arrête. Les migrations s'exécutent au démarrage du nouveau.
```

`infra/compose.onprem.yml` nomme les images de la version que vous avez extraite. `pull` les télécharge depuis `ghcr.io`, et `up -d` recrée les conteneurs sur elles. Si vous construisez les images vous-même (voir [Construire les images vous-même](installation.md#build-the-images-yourself)), lancez les commandes `build` et `up -d` de cette section à la place de `pull` et `up -d`. À partir de cette version, les images s'appellent `kadratis-*`. La mise à jour habituelle les télécharge : rien d'autre à faire. Les versions antérieures gardent leurs images `kanap-*`.

**Première mise à jour vers une version avec images publiées.** Les versions jusqu'à la 26.10.7 se construisaient sur le serveur. La procédure ci-dessus suffit pour passer à une version ultérieure. Une fois la nouvelle version en service et les contrôles de l'étape 4 passés, libérez le cache de build et les anciennes images. Sur un serveur qui a construit Kadratis, ils occupent souvent 20 Go ou plus, selon le nombre de builds qu'il a faits. Ajoutez `kanap-api-tools` à la deuxième ligne si vous aviez construit l'image des outils de maintenance.

```bash
docker builder prune -a
docker image rm infra-api infra-web
docker image prune
```

`docker builder prune -a` et `docker image prune` demandent chacun une confirmation : répondez `y`. Sans `-a`, `docker builder prune` laisse une partie du cache de build. Gardez cet ordre : `docker image rm` seul ne libère presque rien, et l'espace revient avec `docker image prune`. Le total qu'affiche Docker dépasse le gain réel sur le disque, car les images partagent des couches : comparez `df -h /` avant et après. `docker image rm` ne retire que le tag `latest` : si `docker images "infra-*"` liste d'autres tags, supprimez chacun d'eux.

À partir de cette version, les mises à jour ont besoin d'un accès sortant vers `ghcr.io` au lieu de `registry.npmjs.org` et des miroirs de paquets Alpine (voir [Règles de pare-feu](configuration.md#outbound-installation-and-upgrades)).

**Depuis un checkout de `main` antérieur à la 26.10.1.** Une installation mise en place avant la première version suit `main`. Pour la faire passer aux versions publiées :

1. Sauvegardez comme à l'étape 2.
2. Récupérez puis basculez sur la branche des versions publiées. `git checkout stable` avance depuis n'importe quel commit de `main`.

    ```bash
    cd /opt/kanap
    git fetch origin
    git diff HEAD origin/stable -- CHANGELOG.md
    git checkout stable
    ```

3. Lisez chaque entrée du changelog qu'affiche le `git diff`, et faites ce que demandent les lignes « Action required ». Vérifiez en particulier, dans `.env` : `DEPLOYMENT_MODE` vaut `single-tenant` (une valeur non reconnue arrête l'API au démarrage, voir [Mode de déploiement](configuration.md#requis-mode-de-deploiement)), et `APP_BASE_URL` est renseigné (voir [Mise à jour d'une installation antérieure à la version 26.10.1](configuration.md#mise-a-jour-dune-installation-anterieure-a-la-version-26101)). Dans le nginx du serveur, vérifiez `client_max_body_size 80m` (voir l'[exemple de reverse proxy](installation.md#reverse-proxy-example-nginx)).
4. Lancez `docker compose -f infra/compose.onprem.yml pull`, puis `docker compose -f infra/compose.onprem.yml up -d`. Les migrations de toutes les versions intermédiaires s'exécutent au premier démarrage. Celle qui transforme les systèmes d'exploitation des serveurs en technologies dure d'autant plus que les serveurs sont nombreux : l'API affiche `starting` jusqu'à sa fin.
5. Contrôlez la mise à jour comme à l'étape 4, test de recette compris, puis libérez le cache de build comme ci-dessus.

Pour un saut de plusieurs versions, essayez d'abord sur une copie de la base.

**Une version précise.** Pour exécuter une version publiée autre que la dernière, récupérez les tags et basculez sur l'un d'eux. Le checkout est détaché. Le `git checkout stable` de l'étape 3 le ramène sur la branche à la mise à jour suivante.

```bash
cd /opt/kanap
git fetch --tags
git checkout v26.10.9
docker compose -f infra/compose.onprem.yml pull
docker compose -f infra/compose.onprem.yml up -d
```

**Suivre `main`.** La branche `main` contient chaque modification fusionnée avant sa publication dans une version. Il est possible de la suivre, avec des images que vous construisez vous-même (voir [Construire les images vous-même](installation.md#build-the-images-yourself)) ; les versions publiées sont la voie recommandée.

**Version en service.**

```bash
cd /opt/kanap
git describe --tags
docker compose -f infra/compose.onprem.yml images
curl -sSk -w '\n' "https://${KANAP_HOST}/api/config/public"
```

La première commande affiche la version du checkout. La deuxième liste les images des conteneurs, avec leur version dans la colonne `TAG`. La troisième répond par un document JSON dont le champ `version` est la version indiquée par l'API.

Les images publiées portent une attestation signée de leur construction : à partir du tag de la version, par le workflow du dépôt Kadratis lui-même. Avec la CLI GitHub, `gh attestation verify oci://ghcr.io/kanap-hq/kadratis-api:<version> -R kanap-hq/KANAP` la vérifie.

**4. Vérifiez la mise à jour.**

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml ps
docker compose -f infra/compose.onprem.yml logs --no-log-prefix api | grep -E '^\[(entrypoint|VERSION|ENV|CONFIG|SECRETS|RATE-LIMIT|CORS|DB|on-prem|SECURITY|DATA-ACCESS|markdown|cluster|shutdown)\]|WARN|ERROR|successfully started|Email transport'
curl -sSk -w '\n' "https://${KANAP_HOST}/api/health"
```

- `ps` affiche `api` et `web` à l'état `healthy` au bout d'une minute environ.
- Le journal de l'API montre les migrations (`[entrypoint] Migrations complete (N executed).`), la version (`[VERSION] Kadratis <version>`), puis le démarrage de l'API (`Nest application successfully started`). Lisez aussi les autres lignes de démarrage : [Configuration](configuration.md#ce-que-le-journal-de-lapi-affiche-au-demarrage) explique chacune d'elles. Le filtre garde une vingtaine de lignes par démarrage. Le journal couvre chaque démarrage du conteneur depuis la mise à jour : après un redémarrage, les mêmes lignes apparaissent une fois de plus.
- L'adresse de santé répond `{"status":"ok","text_processing":"ready"}` (voir [Supervision](#supervision)).

**Accès aux données par périmètre.** Après une mise à jour vers une version qui comporte l'[accès aux données](../data-access.md), tout le monde continue de travailler avec toutes les données. Pour limiter des personnes à une partie du budget et des contrats, exécutez une fois l'étape facultative de l'[accès aux données par périmètre](installation.md#optional-data-scoped-access), puis redémarrez l'API. L'étape se fait une fois par serveur PostgreSQL : les mises à jour suivantes ne demandent rien de plus, car l'API définit les permissions du rôle à chaque démarrage.

Lancez ensuite le test de recette. Il vérifie la base de données, la connexion, les listes principales et les exports à travers l'API publique. Le serveur n'a pas Node.js : le test s'exécute donc dans un conteneur. La première exécution sur un serveur télécharge l'image `node:24-alpine` depuis Docker Hub (environ 65 Mo, environ 240 Mo sur le disque) et la garde : lancez le test une première fois tant que l'accès sortant est ouvert (voir [Règles de pare-feu](configuration.md#outbound-installation-and-upgrades)). À l'invite, saisissez le mot de passe actuel du compte `ADMIN_EMAIL` ; rien ne s'affiche pendant la saisie. Le `ADMIN_PASSWORD` de `.env` n'est lu qu'au premier démarrage : il n'est donc peut-être plus le bon. Gardez `-e KANAP_INSECURE_TLS=1` quand le certificat est auto-signé (le conteneur ne lui fait pas confiance) ; retirez-le avec un certificat d'une autorité publique. Avec un certificat de votre autorité interne, gardez-le, ou remplacez-le par `-v /opt/kanap/infra/certs:/certs:ro -e NODE_EXTRA_CA_CERTS=/certs/company-ca.pem` pour que le conteneur vérifie le certificat avec le fichier de l'autorité placé dans `/opt/kanap/infra/certs/` (voir [Certificats d'une autorité interne](configuration.md#facultatif-certificats-dune-autorite-interne)). N'ajoutez pas `-e KANAP_WRITE=1` sur une installation de production : cette option crée une tâche temporaire avec une pièce jointe pour vérifier le stockage, ce qui ne convient qu'à une nouvelle installation.

```bash
read -rsp 'Administrator password: ' KANAP_PASSWORD; echo; export KANAP_PASSWORD
docker run --rm --network host \
  -e KANAP_URL="https://${KANAP_HOST}" -e KANAP_EMAIL="${ADMIN_EMAIL}" -e KANAP_PASSWORD \
  -e KANAP_INSECURE_TLS=1 \
  -v /opt/kanap/scripts/smoke:/smoke:ro node:24-alpine node /smoke/recette.mjs
unset KANAP_PASSWORD
```

La dernière ligne de la sortie indique `0 failed`. Avec `KANAP_INSECURE_TLS=1`, deux avertissements TLS en haut de la sortie sont attendus : celui du script et l'avertissement de Node.js à propos de `NODE_TLS_REJECT_UNAUTHORIZED`.

**Retirez les images des versions plus anciennes.** Chaque mise à jour télécharge de nouvelles images et laisse sur le disque celles des versions précédentes, environ 1,4 Go par version (2,8 Go avec l'image des outils de maintenance). Gardez les images de la version que vous venez de quitter tant qu'un retour arrière vers elle reste possible. Retirez les plus anciennes. Listez les images et la place qu'elles prennent :

```bash
docker images "ghcr.io/kanap-hq/*"
```

La liste montre les images `kadratis-*` et, pour les versions jusqu'à 26.11.3, les images `kanap-*`. Mettez dans `OLD` une version à retirer, puis retirez ses images :

```bash
OLD=26.10.8   # une version plus ancienne que celle d'un retour arrière possible
docker image rm $(docker images --format '{{.Repository}}:{{.Tag}}' "ghcr.io/kanap-hq/*" | grep ":${OLD}$")
```

Recommencez pour chaque version plus ancienne. Docker refuse de retirer une image qu'un conteneur utilise : la version en service reste en place. Un retour arrière vers une version dont vous avez retiré les images les télécharge de nouveau (étape 2 du retour arrière ci-dessous).

**Retour arrière.** Les migrations vont seulement vers l'avant : un retour arrière remet donc en place la sauvegarde prise avant la mise à jour, sous la version précédente :

1. Arrêtez Kadratis : `cd /opt/kanap`, puis `docker compose -f infra/compose.onprem.yml down`. Un retour arrière commence souvent dans un nouveau terminal, hors de `/opt/kanap`.
2. Basculez sur la version précédente et téléchargez ses images. Il faut l'accès sortant d'une mise à jour : si vous l'avez fermé après la mise à jour, rouvrez-le d'abord (voir [Règles de pare-feu](configuration.md#outbound-installation-and-upgrades)). Lancez `git checkout v<previous version>` (par exemple `git checkout v26.10.9`), puis `docker compose -f infra/compose.onprem.yml pull`. Une version jusqu'à la 26.10.7 n'a pas d'images publiées : construisez-la comme l'explique le guide de cette version.
3. Restaurez la base de données et les fichiers depuis le répertoire `before-upgrade-...` de cette mise à jour : choisissez la sauvegarde, puis exécutez les étapes 1 à 3 de [Restauration](#restauration) dans le même terminal. Si vous avez modifié `.env` pour la nouvelle version, comparez-le avec la copie du répertoire `config` de la sauvegarde. Cette commande compare les noms des paramètres des deux fichiers sans afficher leurs valeurs :

    ```bash
    diff <(cut -d= -f1 /opt/kanap/.env | sort) <(sudo cut -d= -f1 "$BACKUP/config/.env" | sort)
    ```

    Elle liste uniquement les noms qui diffèrent. Pour comparer les valeurs, ouvrez les deux fichiers.
4. Démarrez Kadratis : `docker compose -f infra/compose.onprem.yml up -d --wait`.
5. Vérifiez-le comme à l'étape 4 ci-dessus (**Vérifiez la mise à jour**). Ses commandes utilisent `KANAP_HOST` et `ADMIN_EMAIL` définis en haut de cette page : dans un nouveau terminal, définissez-les d'abord. La base restaurée contient les comptes et les mots de passe de la date de la sauvegarde : un mot de passe changé depuis reprend son ancienne valeur. Le test de recette demande donc le mot de passe valable au moment de la sauvegarde.

Basculez sur la version précédente avant de démarrer Kadratis : un démarrage avec la version plus récente exécuterait de nouveau ses migrations sur la base restaurée.

Après un retour arrière, restez sur le tag de la version vers laquelle vous êtes revenu. Le `git checkout stable` de la procédure de mise à jour (son étape 3) ramène le checkout sur la branche à la mise à jour suivante. Le checkout (`git describe --tags`) et l'API en service (`/api/config/public`, voir [Version en service](#procedure-de-mise-a-jour)) doivent afficher la même version. S'ils diffèrent, les prochains `pull` et `up -d` changent la version en service.

## Support des versions

Kadratis est une solution qui évolue rapidement. Les versions sont publiées environ une fois par mois, et nous recommandons de mettre à jour au moins une fois par mois.
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

**Fichiers.** L'outil `rc` de l'exemple d'installation copie le bucket dans un répertoire. Il utilise l'alias `kanapstore` que l'installation a défini dans la configuration de root. La copie est un miroir du bucket : les fichiers supprimés dans Kadratis en disparaissent à l'exécution suivante. La copie passe par l'interface S3 du stockage : elle contient donc les fichiers en clair. Protégez le répertoire en conséquence.

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

**Copiez la sauvegarde hors du serveur.** Une sauvegarde sur le même disque ne survit pas à la perte du serveur. La [sauvegarde nocturne chiffrée](#sauvegarde-nocturne-chiffree-vers-un-bucket-s3) ci-dessous envoie chaque nuit la base de données, les fichiers et la configuration vers un bucket S3. Avec un autre outil, copiez `/var/backups/kanap` sur une autre machine chaque jour, par exemple avec `rsync -a /var/backups/kanap/ <user>@<backup host>:<directory>/` depuis une tâche planifiée. La copie contient des secrets et des données personnelles : protégez sa destination.

**Testez une restauration tous les quelques mois**, sur un serveur de secours, pour savoir que les sauvegardes fonctionnent avant d'en avoir besoin.

### Sauvegarde nocturne chiffrée vers un bucket S3

Le script `infra/backup/kadratis-backup` tourne chaque nuit et dépose trois objets dans un dossier nommé d'après la date et l'heure (UTC) : `database.dump.age` (la base de données, telle que `pg_dump -Fc` l'écrit), `attachments.tar.age` (tous les fichiers du stockage) et `config.tar.age` (les fichiers de configuration). `age` les chiffre pour votre clé publique avant qu'ils ne quittent le serveur. Avec l'utilisateur d'écriture décrit plus bas, le serveur dépose et liste, et ne peut ni relire ni supprimer ce qu'il a déposé. Chaque nuit envoie de nouveau tous les fichiers du stockage.

**Préparez le bucket.** Utilisez un service S3 chez un autre hébergeur que celui de votre serveur :

- Un bucket réservé à cette sauvegarde, avec les versions et le verrouillage des objets activés, en mode conformité, avec une durée de conservation par défaut égale au nombre de jours à garder (30, par exemple). En mode conformité, personne ne peut supprimer un objet ni raccourcir sa conservation avant son échéance, pas même le propriétaire du bucket.
- Une règle de cycle de vie qui supprime les objets et leurs versions antérieures une fois la conservation terminée (par exemple après 31 jours), et qui abandonne les envois en plusieurs parties restés inachevés (une nuit arrêtée pendant son envoi laisse des parties facturées).
- Un utilisateur d'écriture pour le serveur, limité à ce bucket, avec ces seules actions : `s3:PutObject`, `s3:ListBucket` et `s3:AbortMultipartUpload`. `s3:PutObject` couvre aussi les envois en plusieurs parties, qu'utilisent les gros objets.
- Un utilisateur de lecture pour les restaurations, limité à ce bucket : `s3:GetObject`, `s3:GetObjectVersion` (chez les hébergeurs qui ont cette action), `s3:GetObjectRetention`, `s3:ListBucket` et `s3:ListBucketVersions`.

Cet utilisateur d'écriture suffit avec le `rclone` de la distribution. `rclone` avant 1.61 (Ubuntu 24.04 fournit la 1.60) joint un en-tête d'ACL à chaque envoi, et une politique qui refuse en plus les écritures d'ACL à l'utilisateur d'écriture refuse ces envois. Dans ce cas, installez `rclone` 1.61 ou plus récent ([installation de rclone](https://rclone.org/install/)), ou ne refusez pas les écritures d'ACL.

Notez le point d'accès (avec `https://`), la région et le nom du bucket. Seules les clés de l'utilisateur d'écriture vont sur le serveur. Les clés du propriétaire du bucket et de l'utilisateur de lecture restent ailleurs.

**Créez la clé de chiffrement** sur une autre machine que le serveur, où `age` est installé :

```bash
age-keygen -o kadratis-backup-key.txt
```

La commande affiche `Public key: age1...` : le serveur a besoin de cette clé publique. Le fichier contient la clé privée. Elle reste hors du serveur, sauf pendant une [restauration](#restauration), et le quitte ensuite. Sans elle, aucune sauvegarde ne peut être relue : gardez-en deux exemplaires dans deux endroits sûrs distincts. `age-keygen -y kadratis-backup-key.txt` affiche de nouveau la clé publique.

**Installez le script** sur le serveur :

```bash
sudo apt-get install -y rclone age
cd /opt/kanap
sudo install -m 0755 -o root -g root infra/backup/kadratis-backup /usr/local/sbin/kadratis-backup
sudo install -m 0644 -o root -g root infra/backup/kadratis-backup.service infra/backup/kadratis-backup.timer /etc/systemd/system/
sudo install -m 0600 -o root -g root infra/backup/kadratis-backup.env.example /etc/kadratis-backup.env
sudo nano /etc/kadratis-backup.env
sudo systemctl daemon-reload
```

Chaque réglage de `/etc/kadratis-backup.env` est commenté. Pour l'[exemple d'installation](installation-example.md) :

- `BACKUP_AGE_RECIPIENTS` : la clé publique `age1...`.
- `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION` et `BACKUP_S3_BUCKET` : ceux du bucket. `BACKUP_S3_ACCESS_KEY_ID` et `BACKUP_S3_SECRET_ACCESS_KEY` : les clés de l'utilisateur d'écriture. `BACKUP_S3_PREFIX` nomme le dossier dans le bucket (`kadratis` par défaut).
- `BACKUP_DB_NAME=kanap`.
- `ATTACHMENTS_S3_ENDPOINT=http://172.17.0.1:9000`. `ATTACHMENTS_S3_REGION`, `ATTACHMENTS_S3_BUCKET`, `ATTACHMENTS_S3_ACCESS_KEY_ID` et `ATTACHMENTS_S3_SECRET_ACCESS_KEY` : les valeurs `S3_REGION`, `S3_BUCKET`, `AWS_ACCESS_KEY_ID` et `AWS_SECRET_ACCESS_KEY` de `/opt/kanap/.env`.
- `BACKUP_CONFIG_FILES` liste `/opt/kanap/.env` et `/etc/default/rustfs`. Ajoutez-y le fichier de site nginx et les fichiers de certificat, séparés par des espaces, pour les garder aussi. Un chemin qui est un lien est archivé avec le contenu vers lequel il pointe (les certificats de `/etc/letsencrypt/live/`, par exemple).

La dernière partie du fichier contrôle les sauvegardes de serveur de Hetzner Cloud : laissez-la vide, sauf si votre serveur y tourne avec ses sauvegardes activées. Ce contrôle demande `jq` (`sudo apt-get install -y jq`). Le script refuse de tourner quand d'autres utilisateurs peuvent lire le fichier, quand il contient une clé privée (`AGE-SECRET-KEY-...`) ou un réglage qu'il ne connaît pas.

**Après une mise à jour**, vérifiez que les copies installées correspondent à la nouvelle version :

```bash
cd /opt/kanap
cmp infra/backup/kadratis-backup /usr/local/sbin/kadratis-backup
cmp infra/backup/kadratis-backup.service /etc/systemd/system/kadratis-backup.service
cmp infra/backup/kadratis-backup.timer /etc/systemd/system/kadratis-backup.timer
```

Aucune sortie : elles correspondent. Une ligne comme `... differ: byte 1201, line 40` nomme un fichier que la mise à jour a changé : relancez sa ligne `install`, puis `sudo systemctl daemon-reload`. Le journal des modifications nomme tout nouveau réglage.

**Lancez la première nuit à la main.** La première commande rend la main à la fin de la nuit :

```bash
sudo systemctl start kadratis-backup.service
sudo journalctl -u kadratis-backup.service -o cat --since -10min
```

Le journal montre les étapes, puis `stored and listed` :

```
kadratis-backup: backup 2026-11-14T092950Z started
kadratis-backup: database: 2.4MB encrypted in 0 s
kadratis-backup: attachments: 303 files, 301MB copied, 301MB encrypted in 2 s
kadratis-backup: configuration: 2 paths, 11KB encrypted
kadratis-backup: upload: 3 objects in 26 s
kadratis-backup: backup 2026-11-14T092950Z stored and listed in 28 s
```

Deux lignes `pam_unix` sur l'utilisateur `postgres` accompagnent l'étape de la base de données : elles sont normales.

**Activez le minuteur.**

```bash
sudo systemctl enable --now kadratis-backup.timer
systemctl list-timers kadratis-backup.timer
```

La liste montre le prochain passage. La sauvegarde part chaque nuit à 02:00, heure du serveur, plus 20 minutes au plus. Une nuit manquée pendant que le serveur était éteint tourne à son redémarrage.

**Supervision (facultatif).** Mettez dans `BACKUP_SUCCESS_URL` l'adresse d'un service de supervision qui alerte quand un appel attendu n'arrive pas. Le script l'appelle une fois la nuit déposée et listée. Une nuit en échec n'appelle rien.

**Contrôlez la sauvegarde depuis une autre machine**, celle qui garde la clé privée, où `rclone` et `age` sont installés. Posez les clés de lecture une fois par terminal : les valeurs sont celles de votre bucket, et les clés de l'utilisateur de lecture se tapent aux invites.

```bash
export RCLONE_CONFIG=/dev/null
export RCLONE_CONFIG_BACKUP_TYPE=s3 RCLONE_CONFIG_BACKUP_PROVIDER=Other
export RCLONE_CONFIG_BACKUP_ENDPOINT='https://s3.example.com'   # BACKUP_S3_ENDPOINT
export RCLONE_CONFIG_BACKUP_REGION='us-east-1'                  # BACKUP_S3_REGION
export RCLONE_CONFIG_BACKUP_FORCE_PATH_STYLE=true
BUCKET=example-backup-bucket                                    # BACKUP_S3_BUCKET
PREFIX=kadratis                                                 # BACKUP_S3_PREFIX
read -rp 'Read access key: ' RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID
read -rsp 'Read secret key: ' RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY; echo
export RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY
rclone lsf --dirs-only "backup:$BUCKET/$PREFIX/"
```

La dernière commande liste un dossier par nuit. Une nuit complète porte trois objets, et `config.tar.age` est déposé le dernier : une nuit arrêtée pendant son envoi laisse un dossier avec un ou deux objets. Choisissez une nuit qui a ses trois objets, puis listez ses trois objets, affichez leur verrouillage et déchiffrez le début de la base de données :

```bash
NIGHT=2026-11-14T092950Z   # a folder of the list, without the final /
rclone lsf --format sp "backup:$BUCKET/$PREFIX/$NIGHT/"
for f in database.dump.age attachments.tar.age config.tar.age; do
  printf 'user = "%s:%s"\n' "$RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID" "$RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY" \
    | curl -sS -K - -I --aws-sigv4 "aws:amz:${RCLONE_CONFIG_BACKUP_REGION}:s3" \
      "${RCLONE_CONFIG_BACKUP_ENDPOINT}/${BUCKET}/${PREFIX}/${NIGHT}/${f}" | grep -i '^x-amz-object-lock'
done
rclone cat "backup:$BUCKET/$PREFIX/$NIGHT/database.dump.age" | age -d -i kadratis-backup-key.txt | head -c 5; echo
```

La liste montre la taille et le nom des trois objets. Chaque objet affiche `x-amz-object-lock-mode: COMPLIANCE` et la date jusqu'à laquelle il est verrouillé. La dernière ligne affiche `PGDMP`, le début d'un dump de base de données.

**Limites.**

- Volume : chaque nuit envoie tous les fichiers du stockage. Le bucket garde une copie complète par jour de conservation. Pendant la nuit, le serveur a besoin d'un espace libre de deux fois la taille des fichiers, et la durée de l'envoi croît avec cette taille.
- Le script garde une copie des fichiers dans `/var/lib/kadratis-backup/files`, en clair, comme la copie des fichiers de la sauvegarde locale. Il crée `/var/lib/kadratis-backup` en mode 700 et refuse un répertoire de travail qui est un lien, appartient à un autre compte ou est inscriptible par d'autres utilisateurs.
- Quand le bucket du stockage est vide alors que la copie locale ne l'est pas, la nuit échoue sans rien effacer : le journal indique `the attachments bucket ... is empty, but the local copy ... holds N files`.
- Un envoi refusé par le bucket arrête la nuit à l'étape `upload`. Avec `rclone` avant 1.61 et une politique qui refuse les écritures d'ACL, le journal indique `ERROR : database.dump.age: Failed to copy: AccessDenied: Access Denied.` (voir « Préparez le bucket » dans [Sauvegarde nocturne chiffrée vers un bucket S3](#sauvegarde-nocturne-chiffree-vers-un-bucket-s3)).
- Une nuit en échec se termine par le code de sortie 1, la ligne `backup FAILED during step '...'` dans le journal, `failed` dans `systemctl status kadratis-backup.service`, et aucun appel à `BACKUP_SUCCESS_URL`.

### Avant une mise à jour

Avant chaque mise à jour, prenez une sauvegarde complète dans un répertoire daté qui lui est propre, par exemple `/var/backups/kanap/before-upgrade-20261009-1400/`. Il contient `db.dump`, `files/` et `config/`. La sauvegarde quotidienne écrit d'autres noms : elle n'écrase donc jamais celle-ci. Sur un serveur où `/var/backups/kanap` n'existe pas encore, [préparez d'abord le répertoire de sauvegarde](#sauvegarde-et-restauration).

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

Pour restaurer une nuit de la [sauvegarde chiffrée](#sauvegarde-nocturne-chiffree-vers-un-bucket-s3), téléchargez-la et déchiffrez-la sur le serveur. Sur un nouveau serveur, installez d'abord `rclone` et `age` (`sudo apt-get install -y rclone age`). Copiez le fichier de la clé privée dans votre répertoire personnel sur le serveur (avec `scp`, par exemple). Posez les clés de lecture avec le premier bloc de « Contrôlez la sauvegarde depuis une autre machine » (dans [Sauvegarde nocturne chiffrée vers un bucket S3](#sauvegarde-nocturne-chiffree-vers-un-bucket-s3)), dans ce terminal. Puis :

```bash
NIGHT=2026-11-14T092950Z   # the folder of the night to restore
rclone copy "backup:$BUCKET/$PREFIX/$NIGHT/" ~/kadratis-night/
BACKUP=/var/backups/kanap-restore-$NIGHT
sudo install -d -o postgres -g postgres -m 0700 "$BACKUP"
sudo install -d -m 0700 "$BACKUP/files" "$BACKUP/config"
sudo age -d -i ~/kadratis-backup-key.txt -o "$BACKUP/db.dump" ~/kadratis-night/database.dump.age
age -d -i ~/kadratis-backup-key.txt ~/kadratis-night/attachments.tar.age | sudo tar -xf - -C "$BACKUP/files"
age -d -i ~/kadratis-backup-key.txt ~/kadratis-night/config.tar.age | sudo tar -xf - -C "$BACKUP/config"
DUMP="$BACKUP/db.dump"
FILES="$BACKUP/files"
```

`$BACKUP/config` contient les fichiers de configuration sous leur chemin complet (`opt/kanap/.env`, `etc/default/rustfs`). Sur un nouveau serveur, remettez-les à leur place avant d'installer Kadratis. Une fois Kadratis relancé, retirez la clé et les objets téléchargés du serveur (`shred -u ~/kadratis-backup-key.txt` et `rm -r ~/kadratis-night`), puis fermez le terminal : les clés de lecture partent avec lui. Supprimez `$BACKUP` quand vous n'en avez plus besoin.

Les clés d'écriture peuvent déposer un nouvel objet sous un nom existant, et les versions gardent le précédent. Si une nuit ne se déchiffre pas, listez les versions de ses objets, puis téléchargez la nuit telle qu'elle était à un instant donné (UTC, après la nuit et avant le remplacement), à la place de la ligne `rclone copy` ci-dessus :

```bash
rclone lsf --s3-versions --format tsp "backup:$BUCKET/$PREFIX/$NIGHT/"
rclone copy --s3-version-at 2026-11-14T09:46:22Z "backup:$BUCKET/$PREFIX/$NIGHT/" ~/kadratis-night/
```

Téléchargez le dossier avec `rclone copy` : `rclone copyto --s3-version-at` sur un seul objet ne copie rien et ne signale aucune erreur.

**1. Restaurez la base de données.** Ce bloc arrête Kadratis, recrée la base de données avec le rôle applicatif comme propriétaire et restaure le dump. Il n'exécute rien si le fichier de dump n'existe pas ou si `pg_restore` ne peut pas le lire :

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

**Accès aux données par périmètre.** Quand le serveur utilise l'[accès aux données par périmètre](installation.md#optional-data-scoped-access), son rôle `kanap_data_limited` doit lui aussi exister avant la restauration. Sur un nouveau serveur, lancez le script de cette section après avoir créé le rôle `kanap`, avec `-d postgres` puisque la base `kanap` n'existe pas encore. Une restauration sur un serveur sans ce rôle ne rétablit ni les règles d'accès ni les droits du rôle, et `pg_restore` signale des erreurs pour eux. Un dump fait avec `pg_dump --no-privileges` omet lui aussi les droits. Dans les deux cas, les personnes limitées sont refusées jusqu'à ce que vous relanciez le script et redémarriez l'API.

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

**4. Démarrez Kadratis.**

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml up -d --wait
```

Lancez ensuite le test de recette de [Vérifiez la mise à jour](#procedure-de-mise-a-jour) et ouvrez Kadratis dans un navigateur. Les comptes et les mots de passe sont ceux de la date de la sauvegarde : connectez-vous avec le mot de passe valable à ce moment-là.

## Image des outils de maintenance

L'image de l'API contient uniquement l'application compilée. Une commande de maintenance qui a besoin de TypeScript, comme `npm run typeorm`, s'exécute dans une seconde image de la même version, `kadratis-api-tools`. Le service `tools` de `infra/compose.onprem.yml` l'utilise, avec le même `.env`, le même accès à `host.docker.internal` et le même répertoire de certificats que l'API (voir [Certificats d'une autorité interne](configuration.md#facultatif-certificats-dune-autorite-interne)). `up` ne le démarre jamais. Le premier `run` télécharge l'image. Cet exemple liste les migrations et indique si elles sont appliquées :

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml run --rm tools npm run typeorm -- migration:show
```

La liste apparaît au bout d'une demi-minute environ : la commande compile d'abord les sources TypeScript.

## Paramètres PostgreSQL

Les valeurs par défaut de PostgreSQL sont prévues pour une petite machine. `infra/postgres/kanap-pg-tune.sh` affiche des paramètres dimensionnés d'après la mémoire de votre serveur (mémoire, coûts SSD, journal des requêtes lentes, statistiques des requêtes). Exécutez-le sur le serveur PostgreSQL et lisez le fichier avant de l'appliquer : son en-tête explique chaque valeur. L'exemple d'installation l'applique à l'[étape 4](installation-example.md#dimensionner-postgresql-pour-ce-serveur).

```bash
cd /opt/kanap
PGVER=18   # 16 sur Ubuntu 24.04
# Les bibliothèques que PostgreSQL précharge déjà (souvent aucune) : le script les conserve.
CURRENT=$(sudo -u postgres psql -XAtc 'SHOW shared_preload_libraries')
# PostgreSQL sur le même serveur que Kadratis (ajoutez --dedicated s'il dispose du serveur pour lui seul)
sh infra/postgres/kanap-pg-tune.sh --preload "$CURRENT" | sudo tee /etc/postgresql/${PGVER}/main/conf.d/kanap.conf >/dev/null
sudo systemctl restart postgresql
sudo -u postgres psql -d kanap -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
```

Lorsque la base de données a déjà l'extension, comme après l'exemple d'installation, la dernière commande affiche `NOTICE:  extension "pg_stat_statements" already exists, skipping`. C'est attendu.

Deux vérifications avant le redémarrage, toutes deux faites par le script, qui écrit la ligne `shared_preload_libraries` en commentaire lorsque l'une échoue :

- **La liste des bibliothèques préchargées.** `shared_preload_libraries` est une liste unique, et la valeur de `kanap.conf` remplace celle de `postgresql.conf`. Sans `--preload`, ajoutez vous-même en tête la valeur de `SHOW shared_preload_libraries` (par exemple `'pg_cron,pg_stat_statements'`), puis retirez le `#`.
- **La bibliothèque elle-même.** PostgreSQL ne démarre pas lorsqu'une bibliothèque préchargée manque. Elle est fournie avec PostgreSQL sur Debian et Ubuntu ; sur RHEL et ses dérivés, installez le paquet contrib (`postgresql16-contrib`). Vérifiez avec `ls "$(pg_config --pkglibdir)/pg_stat_statements.so"`.

Le redémarrage est nécessaire une seule fois, pour le paramètre de mémoire et les statistiques des requêtes : prévoyez-le dans une fenêtre de maintenance, car Kadratis ne peut pas joindre sa base de données pendant le redémarrage de PostgreSQL. Les requêtes de plus de 500 ms apparaissent ensuite dans le journal de PostgreSQL, sans leurs paramètres (`log_parameter_max_length = 0` : ils peuvent contenir des données personnelles). `pg_stat_statements` liste les requêtes les plus coûteuses :

```sql
SELECT calls, round(mean_exec_time) AS avg_ms, left(query, 80) AS query
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;
```

Les migrations de Kadratis font aussi démarrer l'autovacuum plus tôt sur les deux plus grandes tables (les montants budgétaires). Cela ne demande ni redémarrage ni mémoire.

## Supervision

**Santé.** L'API répond à `GET /health` sur son propre port et à `GET /api/health` à travers le reverse proxy. Les deux renvoient `{"status":"ok","text_processing":"ready"}` :

```bash
curl -sSk -w '\n' http://127.0.0.1:8080/health
curl -sSk -w '\n' "https://${KANAP_HOST}/api/health"
```

`text_processing` vaut `starting` pendant quelques secondes après un démarrage. Il vaut `unavailable` quand l'API n'a pas pu démarrer le traitement des textes mis en forme : l'API continue de servir, refuse d'enregistrer les textes mis en forme (descriptions, commentaires) et réessaie toutes les quelques secondes. Le journal de l'API en donne la raison.

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
- L'adresse de santé répond `{"status":"ok","text_processing":"ready"}`.
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
| Le journal répète `[entrypoint] DB not ready (attempt N): ...`, puis affiche `DB not ready after 30 attempts` | Le texte après `attempt N`, `DATABASE_URL`, `pg_hba.conf`, le pare-feu | L'API essaie 30 fois, à 2 secondes d'intervalle, puis s'arrête. Corrigez la cause indiquée par le message, puis lancez `docker compose -f infra/compose.onprem.yml up -d api` |
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
| `[entrypoint] No migration ran.` après un message sur le rôle PostgreSQL | La ligne au-dessus, le rôle de `DATABASE_URL` | Le rôle est un rôle d'administration du cluster, ou il a `SUPERUSER` ou `BYPASSRLS` et Kadratis n'a pas pu les retirer. Utilisez un rôle applicatif dédié, ou lancez en superutilisateur PostgreSQL la commande `ALTER ROLE` que donne le message, puis `up -d api`. Voir [Configuration](configuration.md#requis-base-de-donnees) |
| `[entrypoint] A migration failed, not retried: ...` | Le message, la ligne `[entrypoint] Failed statement: ...` qui le suit, la version de PostgreSQL (16 ou plus) et ses extensions | Les migrations en attente ont été annulées : la base est dans l'état d'avant ce démarrage. Corrigez la cause et relancez `up -d api`, ou déployez la version précédente |
| 502 renvoyé par le reverse proxy | `docker compose -f infra/compose.onprem.yml ps` | Vérifiez que le conteneur api tourne sur le port 8080 |
| 413 renvoyé par le reverse proxy lors d'un envoi | `client_max_body_size` | Renseignez `client_max_body_size 80m;` dans le fichier nginx |
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
