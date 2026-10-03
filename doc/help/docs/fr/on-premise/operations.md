# Opérations on-premise

## Procédure de mise à jour

```bash
# 1. Sauvegardez la base de données et le stockage (votre responsabilité)

# 2. Récupérez les dernières modifications et recompilez
cd kanap
git pull origin main
docker build -t kanap-api:latest ./backend
docker build -t kanap-web:latest ./frontend

# 3. Redémarrez les conteneurs (les migrations s'exécutent automatiquement)
docker compose -f infra/compose.onprem.yml up -d
# L'ancien conteneur API termine d'abord les requêtes en cours, les emails mis en file et
# ses tâches de fond en cours (jusqu'à 20 s), puis s'arrête.

# 4. Vérifiez le démarrage
docker compose -f infra/compose.onprem.yml logs -f api
# Attendez le message "Application started"
```

**Changements majeurs :** Consultez le `CHANGELOG.md` avant de mettre à jour.

**Retour arrière :** Restaurez la base de données depuis une sauvegarde. Les migrations sont uniquement progressives.

## Support des versions

KANAP est une solution en évolution rapide et nous recommandons une mise à jour mensuelle.
Pour les clients sous contrat de support, une mise à jour vers la dernière version peut être demandée avant le traitement d'une demande de support.

## Sauvegarde & Restauration

- **PostgreSQL :** Utilisez `pg_dump`/`pg_restore` ou les sauvegardes de base de données managée
- **Stockage S3 :** Utilisez le versionnement de bucket, la réplication ou les sauvegardes du fournisseur

**Recommandation :** Sauvegardes quotidiennes de la base de données, conservation d'au moins 30 jours.

## Paramètres PostgreSQL

Les valeurs par défaut de PostgreSQL sont dimensionnées pour une petite machine. `infra/postgres/kanap-pg-tune.sh` affiche des réglages dimensionnés à partir de la mémoire de votre serveur (mémoire, coûts SSD, journal des requêtes lentes, statistiques de requêtes). Exécutez-le sur le serveur PostgreSQL et lisez le fichier avant de l'appliquer : son en-tête explique chaque valeur.

```bash
# Les bibliothèques déjà préchargées par PostgreSQL (souvent aucune) : le script les conserve.
CURRENT=$(sudo -u postgres psql -XAtc 'SHOW shared_preload_libraries')
# PostgreSQL sur le même serveur que KANAP (ajoutez --dedicated s'il a le serveur pour lui seul)
sh infra/postgres/kanap-pg-tune.sh --preload "$CURRENT" | sudo tee /etc/postgresql/16/main/conf.d/kanap.conf
sudo systemctl restart postgresql
sudo -u postgres psql -d kanap -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
```

Deux vérifications avant le redémarrage, toutes deux faites par le script, qui écrit la ligne `shared_preload_libraries` en commentaire si l'une échoue :

- **La liste des bibliothèques préchargées.** `shared_preload_libraries` est une seule liste, et la valeur de `kanap.conf` remplace celle de `postgresql.conf`. Sans `--preload`, ajoutez vous-même la valeur de `SHOW shared_preload_libraries` devant (par exemple `'pg_cron,pg_stat_statements'`), puis retirez le `#`.
- **La bibliothèque elle-même.** PostgreSQL ne démarre pas si une bibliothèque préchargée manque. Elle est fournie avec PostgreSQL sous Debian et Ubuntu ; sous RHEL et dérivés, installez le paquet contrib (`postgresql16-contrib`). Vérifiez avec `ls "$(pg_config --pkglibdir)/pg_stat_statements.so"`.

Le redémarrage est nécessaire une seule fois, pour le réglage de mémoire et les statistiques de requêtes : planifiez-le dans une fenêtre de maintenance, KANAP ne peut pas atteindre sa base de données pendant le redémarrage de PostgreSQL. Les requêtes plus lentes que 500 ms apparaissent ensuite dans le journal PostgreSQL, sans leurs paramètres (`log_parameter_max_length = 0` : ils peuvent contenir des données personnelles). `pg_stat_statements` liste les requêtes les plus coûteuses :

```sql
SELECT calls, round(mean_exec_time) AS avg_ms, left(query, 80) AS query
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;
```

Les migrations de KANAP font aussi démarrer l'autovacuum plus tôt sur les deux plus grandes tables (les montants budgétaires). Cela ne nécessite ni redémarrage ni mémoire.

## Supervision

**Endpoint de santé :**

`GET /api/health` → `{ "status": "ok" }`

```bash
curl https://kanap.company.com/api/health
```

**Santé des conteneurs :**
```bash
docker compose -f infra/compose.onprem.yml ps
docker compose -f infra/compose.onprem.yml logs -f api
```

**Métriques clés :**
- Conteneurs en cours d'exécution (`api`, `web`)
- Mémoire API sous ~1 Go par processus API
- Connexions à la base de données
- Utilisation du stockage

### Métriques API pour un outil de supervision

Définissez `OPS_METRICS_TOKEN` dans `.env` (24 caractères ou plus, par exemple `openssl rand -hex 32`) et redémarrez l'API. Votre outil de supervision peut alors lire :

```bash
curl -s -H "Authorization: Bearer $OPS_METRICS_TOKEN" https://kanap.company.com/api/ops/metrics
```

La réponse est au format JSON. Sans ce réglage, l'adresse répond 404. Elle répond même quand l'API est surchargée : les valeurs qui ont besoin de la base de données sont alors marquées `db.statsStale`. Les champs à surveiller :

| Champ | Ce qu'il indique |
|---|---|
| `health.status` | `ok`, `warn` ou `critical`, d'après les seuils ci-dessous. `health.alerts` liste ce qui ne va pas et quoi faire |
| `topRoutes` | Requêtes par route sur 5 minutes, avec les temps de réponse p50, p95 et p99 en millisecondes |
| `process.eventLoopLagMs.p95` | Combien de temps le thread principal de l'API a fait attendre des requêtes sur la dernière minute |
| `db.pool.inUse`, `db.pool.inUseMax1m`, `db.pool.waitingCount` | Connexions à la base de données utilisées en ce moment, le maximum sur la dernière minute, requêtes qui en attendent une |
| `db.pool.wait.p95Ms1m`, `db.pool.wait.failures5m` | Temps pour obtenir une connexion à la base de données ; requêtes qui n'en ont obtenu aucune (réponse « occupé ») |
| `windows.5m.statusClasses` | Réponses par classe de statut sur 5 minutes |
| `processes`, `aggregate` | Avec plusieurs processus API : chacun, et tous ensemble |

Seuils d'alerte (`health` les applique ; avec plusieurs processus API, à tous ensemble, et le pool de base de données au plus chargé). Une alerte se déclenche au-delà du seuil :

| Alerte | Avertissement | Critique | Que faire |
|---|---|---|---|
| Boucle d'événements p95 (1 min) | 100 ms | 500 ms | Ajoutez des processus API (`API_WORKERS`) si le serveur a des cœurs libres |
| Attente d'une connexion à la base de données, p95 (1 min) | 50 ms | 1 s | Augmentez `DB_POOL_MAX` dans la limite de `max_connections` de PostgreSQL |
| Connexions utilisées, maximum sur 1 min | 90 % du pool | | Pareil |
| Requêtes n'ayant obtenu aucune connexion (5 min) | | n'importe laquelle | Vérifiez que PostgreSQL fonctionne et que `max_connections` n'est pas atteint |
| Erreurs serveur (5 min, à partir de 20 requêtes) | 1 % | 5 % | Lisez le journal de l'API |
| p95 d'une route (5 min, à partir de 20 requêtes) | 1 s | 3 s | Signalez-la avec le nom de la route ; les routes d'import, d'export et d'IA ne sont pas comptées |
| Mémoire d'un processus API | 1 Go | | Redémarrez l'API ; signalez-le si cela revient |

## Dépannage

| Symptôme | Vérification | Solution |
|---------|-------|----------|
| Les conteneurs ne démarrent pas | `docker compose logs api` | Vérifiez les erreurs de démarrage |
| `[DB] pool budget exceeded` dans le journal de l'API | `API_WORKERS`, `DB_POOL_MAX`, `max_connections` de PostgreSQL | Réduisez `DB_POOL_MAX` à la valeur donnée par le message (ou `API_WORKERS`), ou augmentez `max_connections` |
| « Database connection failed » | Vérifiez `DATABASE_URL` | Vérifiez l'accessibilité/les identifiants PostgreSQL |
| « S3 error » | Vérifiez les variables S3_* | Assurez-vous que le bucket existe et que les autorisations sont correctes |
| Échec de migration | Vérifiez la version PostgreSQL | Doit être 16+, extensions disponibles |
| 502 du reverse proxy | `docker compose ps` | Assurez-vous que le conteneur api est en cours d'exécution sur le port 8080 |
| Impossible de se connecter | Vérifiez les identifiants `.env` | Utilisez la réinitialisation de mot de passe ci-dessous |

## Réinitialisation de mot de passe

**Recommandé :** Configurez l'email (API Resend ou SMTP single-tenant) et utilisez le flux « Mot de passe oublié ».

**Solution de secours (SQL) :** Si l'email n'est pas configuré, réinitialisez les mots de passe directement dans la base de données.

**1) Générez un hash de mot de passe :**

```bash
# En utilisant Node.js avec argon2
# (argon2 est une dépendance de production dans l'image API)
docker compose -f infra/compose.onprem.yml exec api \
  node -e "require('argon2').hash('NewPassword123!').then(h => console.log(h))"
```

**2) Mettez à jour l'utilisateur dans PostgreSQL :**

```sql
UPDATE users
SET password_hash = '$argon2id$v=19$m=65536,t=3,p=4$...'
WHERE email = 'user@company.com';
```

Cette méthode SQL est une solution de dernier recours pour les administrateurs bloqués.
