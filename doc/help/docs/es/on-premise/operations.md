# Operaciones on-premise

Los comandos de esta página se ejecutan en el servidor de KANAP, en `/opt/kanap` salvo que se indique otra cosa. Varios de ellos usan dos variables del shell. Defínalas una vez en su sesión de terminal, con sus valores:

```bash
KANAP_HOST=kanap.example.internal    # el nombre que escriben los usuarios para abrir KANAP, sin https://
ADMIN_EMAIL=admin@example.internal   # el correo de una cuenta de administrador
```

Los comandos `curl` de esta página usan `-k`. Comprueban lo que responde KANAP, así que también aceptan un certificado en el que el servidor no confía (autofirmado, o de una autoridad interna que no está instalada en el servidor).

## Procedimiento de actualización

KANAP publica una nueva versión aproximadamente una vez al mes. La rama `stable` siempre apunta a la última versión publicada. Cada versión tiene una entrada en `CHANGELOG.md` en la raíz del repositorio. Una entrada que requiere algo de usted (un parámetro que cambiar, un paso que ejecutar) lleva "Action required" en su título.

**1. Lea el registro de cambios antes de descargar.** Obtenga el nuevo estado de `stable` y muestre solo las entradas que todavía no tiene. Lea primero las entradas marcadas "Action required" y haga lo que indican. Las mismas entradas están en la página de versiones (releases) del repositorio en GitHub.

```bash
cd /opt/kanap
git fetch origin stable
git diff HEAD origin/stable -- CHANGELOG.md
```

**2. Haga una copia de seguridad de la base de datos, los archivos y la configuración.** Ejecute los comandos de [Antes de una actualización](#antes-de-una-actualizacion). Escriben en un directorio propio, que la copia de seguridad diaria nunca toca. Las migraciones solo avanzan: esta copia es el camino de vuelta.

**3. Descargar, compilar, arrancar.**

```bash
cd /opt/kanap
git checkout stable
git pull origin stable
docker compose -f infra/compose.onprem.yml build --pull
docker compose -f infra/compose.onprem.yml up -d
# El contenedor de API anterior termina primero las solicitudes en curso, los correos en cola y
# sus trabajos en segundo plano en ejecución (hasta 20 s), y después se detiene. Las migraciones se ejecutan cuando arranca el nuevo.
```

Docker Compose compila él mismo las imágenes `api` y `web`, a partir de las fuentes que acaba de descargar. `--pull` también descarga las imágenes base actualizadas. Ejecutar solo `up -d` mantiene la versión anterior, porque Compose reutiliza las imágenes que ya tiene. Ejecute siempre `build` primero. La compilación necesita la memoria indicada en los [requisitos previos de la instalación](installation.md#requisitos-previos). Si se detiene con `signal: killed`, el servidor se quedó sin memoria: compile las dos imágenes una tras otra (`build --pull api` y después `build --pull web`) y ejecute `up -d`.

**Una versión concreta.** Para ejecutar una versión publicada distinta de la última, obtenga las etiquetas y cambie a una de ellas. El checkout queda desacoplado (detached). El `git checkout stable` del paso 3 lo devuelve a la rama en la siguiente actualización.

```bash
git fetch --tags
git checkout v26.10.1
```

Después ejecute los comandos `build --pull` y `up -d` anteriores.

**Seguir `main`.** La rama `main` contiene todos los cambios integrados antes de que se publiquen como versión. Es posible seguirla; las versiones publicadas son el camino recomendado.

**Qué versión se ejecuta.**

```bash
cd /opt/kanap
git describe --tags
curl -sSk -w '\n' "https://${KANAP_HOST}/api/config/public"
```

El primer comando muestra la versión del checkout. El segundo responde con un documento JSON cuyo campo `version` es la versión que indica la API.

**4. Compruebe la actualización.**

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml ps
docker compose -f infra/compose.onprem.yml logs --no-log-prefix api | grep -E '^\[|^Admin seeding|WARN|ERROR|successfully started|Email transport'
curl -sSk -w '\n' "https://${KANAP_HOST}/api/health"
```

- `ps` muestra `api` y `web` como `healthy` al cabo de un minuto aproximadamente. Cuando la nueva versión no cambió el contenido web, Compose conserva el contenedor `web` en ejecución, y `ps` puede mostrar un identificador de imagen en lugar de `infra-web`. Es lo esperado.
- El registro de la API muestra las migraciones (`[entrypoint] Migrations complete (N executed).`) y después el arranque de la API (`Nest application successfully started`). Lea también las demás líneas de arranque: [Configuración](configuration.md#que-muestra-el-registro-de-la-api-al-arrancar) explica cada una.
- La dirección de estado responde `{"status":"ok"}`.

Después ejecute la prueba de humo. Comprueba la base de datos, el inicio de sesión, las listas principales y las exportaciones a través de la API pública. El servidor no tiene Node.js, así que la prueba se ejecuta en un contenedor. La primera ejecución en un servidor descarga la imagen `node:24-alpine` de Docker Hub (unos 240 MB) y la conserva: ejecute la prueba una vez mientras el acceso saliente esté abierto (consulte [Reglas de cortafuegos](configuration.md#saliente-instalacion-inicial-y-compilacion)). Cuando se le pida, escriba la contraseña actual de la cuenta `ADMIN_EMAIL`; no se muestra nada mientras escribe. El `ADMIN_PASSWORD` de `.env` solo se lee en el primer arranque, así que puede que ya no sea el correcto. Mantenga `-e KANAP_INSECURE_TLS=1` cuando el certificado es autofirmado (el contenedor no confía en él); quítelo con un certificado de una autoridad pública. Con un certificado de su autoridad interna, manténgalo, o sustitúyalo por `-v /opt/kanap/infra/certs:/certs:ro -e NODE_EXTRA_CA_CERTS=/certs/company-ca.pem` para que el contenedor verifique el certificado con el archivo de la autoridad en `/opt/kanap/infra/certs/` (consulte [Certificados de una autoridad interna](configuration.md#opcional-certificados-de-una-autoridad-interna)). No añada `-e KANAP_WRITE=1` en una instalación de producción: esa opción crea una tarea temporal con un adjunto para comprobar el almacenamiento, lo que solo conviene a una instalación nueva.

```bash
read -rsp 'Administrator password: ' KANAP_PASSWORD; echo; export KANAP_PASSWORD
docker run --rm --network host \
  -e KANAP_URL="https://${KANAP_HOST}" -e KANAP_EMAIL="${ADMIN_EMAIL}" -e KANAP_PASSWORD \
  -e KANAP_INSECURE_TLS=1 \
  -v /opt/kanap/scripts/smoke:/smoke:ro node:24-alpine node /smoke/recette.mjs
unset KANAP_PASSWORD
```

La última línea de la salida dice `0 failed`. Con `KANAP_INSECURE_TLS=1`, dos advertencias TLS al principio de la salida son normales: la del propio script y la advertencia de Node.js sobre `NODE_TLS_REJECT_UNAUTHORIZED`.

**Vuelta atrás.** Las migraciones solo avanzan, así que volver atrás consiste en restaurar la copia de seguridad hecha antes de la actualización, con la versión anterior:

1. Detenga KANAP: `cd /opt/kanap` y después `docker compose -f infra/compose.onprem.yml down`. Una vuelta atrás suele empezar en una terminal nueva, fuera de `/opt/kanap`.
2. Cambie a la versión anterior y compílela. La compilación necesita el acceso saliente de una actualización: si lo cerró después de la actualización, ábralo primero (consulte [Reglas de cortafuegos](configuration.md#saliente-instalacion-inicial-y-compilacion)). Después ejecute `git checkout v<previous version>` (por ejemplo `git checkout v26.10.1`) y luego `docker compose -f infra/compose.onprem.yml build --pull`.
3. Restaure la base de datos y los archivos desde el directorio `before-upgrade-...` de esa actualización: elija la copia de seguridad y ejecute los pasos 1 a 3 de [Restauración](#restauracion) en la misma terminal. Si cambió `.env` para la nueva versión, compárelo con la copia del directorio `config` de la copia de seguridad. Este comando compara los nombres de los parámetros de los dos archivos sin mostrar sus valores:

    ```bash
    diff <(cut -d= -f1 /opt/kanap/.env | sort) <(sudo cut -d= -f1 "$BACKUP/config/.env" | sort)
    ```

    Solo lista los nombres que difieren. Para comparar los valores, abra los dos archivos.
4. Arranque KANAP: `docker compose -f infra/compose.onprem.yml up -d --wait`.
5. Compruébelo como en el paso 4 anterior (**Compruebe la actualización**). Sus comandos usan `KANAP_HOST` y `ADMIN_EMAIL` del principio de esta página: en una terminal nueva, defínalos primero.

Compile la versión anterior antes de arrancar KANAP: un arranque con la versión más reciente volvería a ejecutar sus migraciones sobre la base de datos restaurada.

Tras una vuelta atrás, permanezca en la etiqueta de la versión a la que volvió. El `git checkout stable` del procedimiento de actualización (su paso 3) devuelve el checkout a la rama en la siguiente actualización. El checkout (`git describe --tags`) y la API en ejecución (`/api/config/public`, consulte [Qué versión se ejecuta](#procedimiento-de-actualizacion)) deben mostrar la misma versión. Si difieren, el siguiente `build` cambia la versión en ejecución.

## Soporte de versiones

KANAP es una solución que evoluciona rápidamente. Las versiones se publican aproximadamente una vez al mes, y recomendamos actualizar al menos una vez al mes.
Para los clientes con soporte, puede pedirse una actualización a la última versión antes de atender una solicitud de soporte.

## Copia de seguridad y restauración

Haga copia de seguridad de tres cosas: la base de datos, los archivos del almacenamiento y la configuración. Los comandos siguientes corresponden al [ejemplo de instalación](installation-example.md): PostgreSQL y RustFS en el servidor. Con un servicio PostgreSQL gestionado o un proveedor S3, use las instantáneas, el versionado o la replicación que ofrecen, y haga igualmente copia de seguridad de la configuración.

**Prepare el directorio de copias de seguridad** (una vez). Contiene datos personales y secretos: solo `root` y `postgres` pueden leerlo.

```bash
sudo install -d -o postgres -g postgres -m 0700 /var/backups/kanap
sudo install -d -m 0700 /var/backups/kanap/files /var/backups/kanap/config
```

**Base de datos.** `pg_dump -Fc` escribe un volcado comprimido que `pg_restore` puede leer.

```bash
sudo -u postgres pg_dump -Fc -f /var/backups/kanap/db-$(date +%F).dump kanap
sudo -u postgres pg_restore --list /var/backups/kanap/db-$(date +%F).dump | head -5
```

**Archivos.** La herramienta `rc` del ejemplo de instalación copia el bucket en un directorio. Usa el alias `kanapstore` que la instalación definió en la configuración de root. La copia refleja el bucket: los archivos eliminados en KANAP desaparecen de ella en la siguiente ejecución. La copia se hace a través de la interfaz S3 del almacenamiento, así que contiene los archivos sin cifrar. Proteja el directorio en consecuencia.

```bash
sudo rc mirror --overwrite --remove kanapstore/kanap-files /var/backups/kanap/files
```

Para cualquier otro almacenamiento S3, `rclone` hace el mismo trabajo (`sudo apt-get install -y rclone`). Sustituya los valores de ejemplo por los de su almacenamiento y escriba la clave de acceso y la clave secreta cuando se le pidan (el `AWS_ACCESS_KEY_ID` y el `AWS_SECRET_ACCESS_KEY` de `.env`). `sudo` solo transmite las variables que nombra `KEEP`: el `sudo` de Ubuntu 26.04 ignora `-E`. `rclone check` compara la copia con el bucket:

```bash
export RCLONE_S3_PROVIDER=Other
export RCLONE_S3_ENDPOINT='https://s3.example.com'   # S3_ENDPOINT de .env, tal como lo alcanza el servidor
export RCLONE_S3_REGION='us-east-1'                   # S3_REGION de .env
export RCLONE_S3_FORCE_PATH_STYLE=true                # S3_FORCE_PATH_STYLE de .env
read -rp 'Access key: ' RCLONE_S3_ACCESS_KEY_ID; export RCLONE_S3_ACCESS_KEY_ID
read -rsp 'Secret key: ' RCLONE_S3_SECRET_ACCESS_KEY; echo; export RCLONE_S3_SECRET_ACCESS_KEY
BUCKET=kanap-files                                    # S3_BUCKET de .env
KEEP=RCLONE_S3_PROVIDER,RCLONE_S3_ENDPOINT,RCLONE_S3_REGION,RCLONE_S3_FORCE_PATH_STYLE,RCLONE_S3_ACCESS_KEY_ID,RCLONE_S3_SECRET_ACCESS_KEY
sudo --preserve-env="$KEEP" rclone sync ":s3:${BUCKET}" /var/backups/kanap/files
sudo --preserve-env="$KEEP" rclone check ":s3:${BUCKET}" /var/backups/kanap/files
```

`rclone check` termina con `0 differences found`. rclone también puede mostrar `Config file "/root/.config/rclone/rclone.conf" not found - using defaults`: las variables sustituyen ese archivo. Use `RCLONE_S3_PROVIDER=AWS` para AWS S3. Para RustFS en el servidor, el endpoint es `http://172.17.0.1:9000`: `host.docker.internal` solo existe dentro de los contenedores.

**Configuración.** Guarde una copia de `/opt/kanap/.env` y de `/etc/default/rustfs`. El primero contiene todos los secretos de la instalación, incluido `AI_SETTINGS_ENCRYPTION_SECRET` cuando lo usa. El segundo contiene la clave de cifrado de RustFS: los archivos cifrados con ella no pueden leerse sin ella. Guarde también el archivo del sitio nginx (`/etc/nginx/sites-available/kanap`) y los archivos del certificado.

```bash
sudo cp -p /opt/kanap/.env /etc/default/rustfs /var/backups/kanap/config/
```

**Cada día, con 30 días de historial.** Este archivo cron ejecuta las tres copias de seguridad por la noche y elimina los volcados de la base de datos de más de 30 días. Escribe un volcado al día; la copia de los archivos y la de la configuración conservan el último estado.

```bash
sudo tee /etc/cron.d/kanap-backup >/dev/null <<'EOF'
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
15 2 * * * postgres pg_dump -Fc -f /var/backups/kanap/db-$(date +\%F).dump kanap
30 2 * * * root rc mirror --overwrite --remove kanapstore/kanap-files /var/backups/kanap/files
45 2 * * * root cp -p /opt/kanap/.env /etc/default/rustfs /var/backups/kanap/config/
0 3 * * * root find /var/backups/kanap -maxdepth 1 -name 'db-*.dump' -mtime +30 -delete
EOF
```

**Copie el directorio de copias de seguridad fuera del servidor.** Una copia en el mismo disco no sobrevive a la pérdida del servidor. Copie `/var/backups/kanap` a otra máquina cada día, por ejemplo con `rsync -a /var/backups/kanap/ <user>@<backup host>:<directory>/` desde un trabajo programado, o con la herramienta de copia de seguridad que ya utilice. La copia contiene secretos y datos personales: proteja su destino.

**Pruebe una restauración cada pocos meses**, en un servidor de reserva, para saber que las copias de seguridad funcionan antes de necesitarlas.

### Antes de una actualización

Antes de cada actualización, haga una copia de seguridad completa en un directorio propio con fecha, por ejemplo `/var/backups/kanap/before-upgrade-20261009-1400/`. Contiene `db.dump`, `files/` y `config/`. La copia de seguridad diaria escribe otros nombres, así que nunca la sobrescribe.

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

La última línea muestra el directorio. Anótelo: una vuelta atrás restaura a partir de él. Con otro almacenamiento S3, sustituya la línea `rc mirror` por el comando `rclone sync` de la copia de los archivos anterior, con `"$B/files"` como destino. Defina antes las variables de ese bloque, `KEEP` incluida, en la misma terminal.

Conserve este directorio hasta que la nueva versión haya funcionado sin problemas durante unas semanas. El `find ... -mtime +30 -delete` diario del archivo cron solo elimina los volcados diarios antiguos. Elimine usted mismo un directorio `before-upgrade-...` antiguo: lístelos con `sudo ls /var/backups/kanap/` y después ejecute `sudo rm -r` seguido de la ruta del directorio.

### Restauración

Estos pasos sustituyen la base de datos y los archivos por el contenido de una copia de seguridad. Ejecútelos en orden, en una sola terminal: cada paso usa las variables que definió primero.

**Elija la copia de seguridad.** Liste las copias:

```bash
sudo ls /var/backups/kanap/
```

La lista muestra los directorios `before-upgrade-...` y los volcados diarios (`db-YYYY-MM-DD.dump`). Para restaurar una copia hecha antes de una actualización, defina su directorio:

```bash
BACKUP=/var/backups/kanap/before-upgrade-20261009-1400   # su directorio
DUMP="$BACKUP/db.dump"
FILES="$BACKUP/files"
```

Para restaurar en su lugar una copia diaria, defina el volcado de ese día. La copia diaria de los archivos contiene el último estado de los archivos:

```bash
DUMP=/var/backups/kanap/db-2026-10-09.dump   # su fecha
FILES=/var/backups/kanap/files
```

**1. Restaure la base de datos.** Este bloque detiene KANAP, vuelve a crear la base de datos con el rol de aplicación como propietario y restaura el volcado. No ejecuta nada si el archivo de volcado no existe o si `pg_restore` no puede leerlo:

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

La última línea dice `Database restored`. Si dice `Stopped`, no se ejecutó nada después del comando que falló.

Ejecute `pg_restore` como `postgres` y sin `--no-owner`. El volcado registra el propietario de cada objeto (`kanap`), así que la restauración devuelve las tablas al rol de aplicación, con su configuración de seguridad a nivel de fila. Con `--no-owner`, las tablas pertenecerían a `postgres` y la API no podría usarlas. El rol `kanap` debe existir: en un servidor nuevo, créelo como en el [paso 4 del ejemplo de instalación](installation-example.md#4-postgresql) antes de este paso.

**2. Restaure los archivos.** La copia sustituye el contenido del bucket. El comando solo se ejecuta si la copia existe:

```bash
sudo test -d "$FILES" \
  && sudo rc mirror --overwrite --remove "$FILES" kanapstore/kanap-files \
  && echo 'Files restored' \
  || echo 'Files not restored. Read the message above; with no message, FILES is empty or the directory is missing.'
```

Si el almacenamiento también se perdió, vuelva a configurarlo como en el [paso 5 del ejemplo de instalación](installation-example.md#5-almacenamiento-de-objetos-rustfs), con el mismo `/etc/default/rustfs`, antes de este paso.

**3. Compruebe el resultado.** La primera consulta muestra `0` (ninguna tabla pertenece a otro rol) y la segunda muestra un número mayor que `0` (las tablas con seguridad a nivel de fila):

```bash
sudo -u postgres psql -d kanap -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tableowner <> 'kanap'"
sudo -u postgres psql -d kanap -Atc "SELECT count(*) FROM pg_class WHERE relrowsecurity AND relforcerowsecurity"
```

**4. Arranque KANAP.**

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml up -d --wait
```

Después ejecute la prueba de humo de [Compruebe la actualización](#procedimiento-de-actualizacion) y abra KANAP en un navegador.

## Imagen de herramientas de mantenimiento

La imagen de la API solo contiene la aplicación compilada. Un comando de mantenimiento que necesita TypeScript, como `npm run typeorm`, se ejecuta en una segunda imagen compilada a partir de las mismas fuentes. Compílela a partir del checkout actual justo antes de cada uso, para que corresponda a la versión en ejecución. La compilación reutiliza las capas en caché de la imagen de la API y tarda entre 10 y 20 segundos cuando la imagen de la API ya está compilada:

```bash
cd /opt/kanap
docker build --target dev -t kanap-api-tools backend
```

Ejecute un comando en ella con el mismo `.env` y el mismo directorio de certificados que la API (consulte [Certificados de una autoridad interna](configuration.md#opcional-certificados-de-una-autoridad-interna)). Este ejemplo lista las migraciones e indica si están aplicadas:

```bash
cd /opt/kanap
docker run --rm --env-file .env --add-host host.docker.internal:host-gateway \
  -v /opt/kanap/infra/certs:/etc/kanap/certs:ro \
  kanap-api-tools npm run typeorm -- migration:show
```

## Configuración de PostgreSQL

Los valores predeterminados de PostgreSQL están pensados para una máquina pequeña. `infra/postgres/kanap-pg-tune.sh` muestra parámetros calculados a partir de la memoria de su servidor (memoria, costes para SSD, registro de consultas lentas, estadísticas de consultas). Ejecútelo en el servidor PostgreSQL y lea el archivo antes de aplicarlo: su cabecera explica cada valor. El ejemplo de instalación lo aplica en el [paso 4](installation-example.md#dimensionar-postgresql-para-este-servidor).

```bash
cd /opt/kanap
PGVER=18   # 16 en Ubuntu 24.04
# Las bibliotecas que PostgreSQL ya precarga (a menudo ninguna): el script las conserva.
CURRENT=$(sudo -u postgres psql -XAtc 'SHOW shared_preload_libraries')
# PostgreSQL en el mismo servidor que KANAP (añada --dedicated si tiene el servidor para él solo)
sh infra/postgres/kanap-pg-tune.sh --preload "$CURRENT" | sudo tee /etc/postgresql/${PGVER}/main/conf.d/kanap.conf >/dev/null
sudo systemctl restart postgresql
sudo -u postgres psql -d kanap -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
```

Cuando la base de datos ya tiene la extensión, como después del ejemplo de instalación, el último comando muestra `NOTICE:  extension "pg_stat_statements" already exists, skipping`. Es lo esperado.

Dos comprobaciones antes del reinicio, ambas realizadas por el script, que escribe la línea `shared_preload_libraries` comentada cuando una falla:

- **La lista de bibliotecas precargadas.** `shared_preload_libraries` es una sola lista, y el valor de `kanap.conf` sustituye al de `postgresql.conf`. Sin `--preload`, añada usted mismo delante el valor de `SHOW shared_preload_libraries` (por ejemplo `'pg_cron,pg_stat_statements'`) y después quite el `#`.
- **La propia biblioteca.** PostgreSQL no arranca cuando falta una biblioteca precargada. Viene con PostgreSQL en Debian y Ubuntu; en RHEL y derivados, instale el paquete contrib (`postgresql16-contrib`). Compruébelo con `ls "$(pg_config --pkglibdir)/pg_stat_statements.so"`.

El reinicio es necesario una vez, para el parámetro de memoria y las estadísticas de consultas: prográmelo en una ventana de mantenimiento, porque KANAP no puede llegar a su base de datos mientras PostgreSQL se reinicia. Las consultas de más de 500 ms aparecen entonces en el registro de PostgreSQL, sin sus parámetros (`log_parameter_max_length = 0`: pueden contener datos personales). `pg_stat_statements` lista las consultas más costosas:

```sql
SELECT calls, round(mean_exec_time) AS avg_ms, left(query, 80) AS query
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;
```

Las migraciones de KANAP también hacen que autovacuum empiece antes en las dos tablas más grandes (importes de presupuesto). Esto no necesita ningún reinicio ni memoria.

## Monitorización

**Estado.** La API responde a `GET /health` en su propio puerto y a `GET /api/health` a través del proxy inverso. Ambos devuelven `{"status":"ok"}`:

```bash
curl -sSk -w '\n' http://127.0.0.1:8080/health
curl -sSk -w '\n' "https://${KANAP_HOST}/api/health"
```

**Contenedores.** `docker compose -f infra/compose.onprem.yml ps` muestra `healthy` para `api` y `web` cuando responden. Docker solo lo indica: nada se reinicia por ese estado.

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml ps
docker compose -f infra/compose.onprem.yml logs -f api
```

Docker conserva como máximo 5 archivos de 10 MB de registros por contenedor (unos 50 MB), así que el registro solo llega hasta ahí.

**Métricas clave:**

- Contenedores en ejecución (`api`, `web`)
- Memoria de la API por debajo de ~1 GB por proceso de API
- Conexiones a la base de datos
- Uso del almacenamiento

### Después de un reinicio

No hay nada que hacer: todo arranca solo. PostgreSQL y nginx arrancan como servicios, el almacenamiento del ejemplo de instalación arranca después de Docker, y Docker vuelve a arrancar los contenedores `api` y `web`. La API responde unos 10 segundos después del arranque del servidor. Si PostgreSQL es más lento que Docker, la API reintenta la conexión a la base de datos (30 veces, con 2 segundos de intervalo). Tres comprobaciones:

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml ps
curl -sSk -w '\n' "https://${KANAP_HOST}/api/health"
ss -ltn | grep 172.17.0.1:9000
```

- `ps` muestra `api` y `web` como `healthy`.
- La dirección de estado responde `{"status":"ok"}`.
- El último comando muestra una línea con `172.17.0.1:9000`: el almacenamiento del ejemplo de instalación está a la escucha. Con otro almacenamiento, compruébelo a su manera.

### Métricas de la API para una herramienta de monitorización

Defina `OPS_METRICS_TOKEN` en `.env` (24 caracteres o más, por ejemplo `openssl rand -hex 32`) y vuelva a crear la API (`docker compose -f infra/compose.onprem.yml up -d api`). Su herramienta de monitorización puede entonces leer:

```bash
OPS_METRICS_TOKEN=$(grep '^OPS_METRICS_TOKEN=' /opt/kanap/.env | cut -d= -f2-)
curl -sSk -w '\n' -H "Authorization: Bearer ${OPS_METRICS_TOKEN}" "https://${KANAP_HOST}/api/ops/metrics"
```

La respuesta es JSON. Sin el parámetro, la dirección responde 404. Responde incluso cuando la API está sobrecargada: las cifras que necesitan la base de datos se marcan entonces con `db.statsStale`. Los campos que conviene vigilar:

| Campo | Qué indica |
|---|---|
| `health.status` | `ok`, `warn` o `critical`, según los umbrales siguientes. `health.alerts` lista lo que falla y qué hacer |
| `topRoutes` | Solicitudes por ruta durante 5 minutos, con los tiempos de respuesta p50, p95 y p99 en milisegundos |
| `process.eventLoopLagMs.p95` | Cuánto tiempo hizo esperar a las solicitudes el hilo principal de la API durante el último minuto (la parte transcurrida de un minuto justo después de un arranque) |
| `db.pool.inUse`, `db.pool.inUseMax1m`, `db.pool.waitingCount` | Conexiones a la base de datos en uso ahora, el máximo durante el último minuto, solicitudes que esperan una |
| `db.pool.wait.p95Ms1m`, `db.pool.wait.failures5m` | Tiempo para obtener una conexión a la base de datos; solicitudes que no obtuvieron ninguna (respuesta "ocupado") |
| `windows.5m.statusClasses` | Respuestas por clase de estado durante 5 minutos |
| `processes`, `aggregate` | Con varios procesos de API: cada uno, y todos juntos |

Umbrales de alerta (`health` los aplica; con varios procesos de API, a todos juntos, y el pool de la base de datos al más lleno). Una alerta se dispara por encima del umbral:

| Alerta | Advertencia | Crítico | Qué hacer |
|---|---|---|---|
| Bucle de eventos p95 (1 min) | 100 ms | 500 ms | Añada procesos de API (`API_WORKERS`) si el servidor tiene núcleos libres |
| Espera de una conexión a la base de datos, p95 (1 min) | 50 ms | 1 s | Aumente `DB_POOL_MAX` dentro del `max_connections` de PostgreSQL |
| Conexiones en uso, máximo en 1 min | 90 % del pool | | Igual |
| Solicitudes que no obtuvieron conexión (5 min) | | cualquiera | Compruebe que PostgreSQL funciona y que no se ha alcanzado `max_connections` |
| Errores del servidor (5 min, a partir de 20 solicitudes) | 1 % | 5 % | Lea el registro de la API |
| p95 de una ruta (5 min, a partir de 20 solicitudes) | 1 s | 3 s | Notifíquelo con el nombre de la ruta; las rutas de importación, exportación e IA no se cuentan |
| Memoria de un proceso de API | 1 GB | | Reinicie la API; notifíquelo si se repite |

## Solución de problemas

Empiece por el registro de la API: `docker compose -f infra/compose.onprem.yml logs --no-log-prefix --tail=200 api`.

| Síntoma | Qué comprobar | Solución |
|---------|-------|----------|
| Los contenedores no arrancan | `docker compose -f infra/compose.onprem.yml logs api` | Busque errores de arranque |
| El registro repite `[entrypoint] DB not ready or migration failed (attempt N)` | El texto que sigue a `attempt N`, `DATABASE_URL`, `pg_hba.conf`, el cortafuegos | La API lo intenta 30 veces, con 2 segundos de intervalo, y después se detiene. Corrija la causa que indica el mensaje y después ejecute `docker compose -f infra/compose.onprem.yml up -d api` |
| El mensaje anterior dice `self-signed certificate`, `unable to verify the first certificate` o `unable to get local issuer certificate` | El final de `DATABASE_URL` | `sslmode=require` verifica por completo el certificado del servidor. Use `sslmode=disable` para un PostgreSQL en el mismo servidor. Si la autoridad de su empresa firmó el certificado, mantenga `require` y haga que la API confíe en la autoridad (consulte [Certificados de una autoridad interna](configuration.md#opcional-certificados-de-una-autoridad-interna)). En otro caso, use `sslmode=no-verify` para una conexión cifrada sin verificación. Consulte [Configuración](configuration.md#obligatorio-base-de-datos) |
| El mensaje anterior dice `The server does not support SSL connections` | El final de `DATABASE_URL` | Use `sslmode=disable`, o active TLS en PostgreSQL |
| `curl: (6) Could not resolve host` | El nombre de la dirección | El servidor resuelve el nombre mediante DNS o `/etc/hosts`. Añada el registro, o una línea `127.0.0.1 <name>` (su nombre en lugar de `<name>`) a `/etc/hosts` para las comprobaciones que se ejecutan en el servidor |
| `[DB] pool budget exceeded` en el registro de la API | `API_WORKERS`, `DB_POOL_MAX`, `max_connections` de PostgreSQL | Reduzca `DB_POOL_MAX` al valor que indica el mensaje (o `API_WORKERS`), o aumente `max_connections` |
| "Database connection failed" | Revise `DATABASE_URL` | Compruebe el acceso a PostgreSQL y las credenciales. Una contraseña con `@ : / # ? %` necesita codificación con porcentajes en la URL |
| Las subidas o descargas fallan ("S3 error", `S3_BUCKET is not configured`) | Las variables `S3_*` | Compruebe que el bucket existe y que las claves y los permisos son correctos |
| `Authorization header malformed` o `unexpected scope` en un error de almacenamiento | `S3_REGION` | Use la región que espera su almacenamiento (`us-east-1` para RustFS, la definida en su configuración para Garage) |
| `getaddrinfo ENOTFOUND <bucket>.host.docker.internal` | `S3_FORCE_PATH_STYLE` | Defina `S3_FORCE_PATH_STYLE=true` para RustFS, MinIO, Garage y otros almacenamientos autoalojados |
| Advertencia `PutObject fallback used` | El cifrado del almacenamiento | El almacenamiento rechazó la solicitud de cifrado. Con RustFS, defina `RUSTFS_SSE_S3_MASTER_KEY` en `/etc/default/rustfs` y reinícielo (`sudo systemctl restart rustfs`) |
| Advertencia `[RATE-LIMIT] ... RATE_LIMIT_TRUST_PROXY not set` | `.env` | Defina `RATE_LIMIT_TRUST_PROXY=true` (nginx delante) o `false` (nada delante) y después ejecute `up -d api`. Consulte [Configuración](configuration.md#opcional-avanzado) |
| Todos comparten un mismo límite de inicio de sesión (`429` para muchos usuarios) | `RATE_LIMIT_TRUST_PROXY` y el proxy | Con un proxy delante, defina `true` y haga que el proxy envíe `X-Forwarded-For` |
| Advertencia `[SECURITY]` en cada arranque | `ADMIN_PASSWORD`, `JWT_SECRET` | Cambie la contraseña del administrador en la aplicación, o consulte [Restablecimiento de contraseña](#restablecimiento-de-contrasena). Use un `JWT_SECRET` de 32 caracteres o más |
| La migración falló | Versión de PostgreSQL | Debe ser 16+, con las extensiones disponibles |
| 502 del proxy inverso | `docker compose -f infra/compose.onprem.yml ps` | Compruebe que el contenedor api funciona en el puerto 8080 |
| 413 del proxy inverso en una subida | `client_max_body_size` | Defina `client_max_body_size 50m;` en el archivo de nginx |
| Un correo de restablecimiento no llega, y el registro de la API tiene una línea `ERROR` con `unable to verify the first certificate` o `self-signed certificate` y el código `ESOCKET` | El certificado del relay de correo | La API no confía en la autoridad que firmó el certificado del relay. Entréguele el archivo de la autoridad (consulte [Certificados de una autoridad interna](configuration.md#opcional-certificados-de-una-autoridad-interna)). Instalar la autoridad en el propio servidor no cambia nada en el contenedor |
| No se puede iniciar sesión | La contraseña | `.env` solo crea el administrador en el primer arranque. Cambie la contraseña en la aplicación, o use [Restablecimiento de contraseña](#restablecimiento-de-contrasena) |

## Restablecimiento de contraseña

**Recomendado:** configure el correo (API de Resend o SMTP en single-tenant) y use **Contraseña olvidada** en la página de inicio de sesión.

**Alternativa (SQL):** si el correo no está configurado, restablezca la contraseña directamente en la base de datos. Se hace en dos pasos: calcular el hash de la nueva contraseña en el contenedor de la API y después escribir el hash como superusuario de PostgreSQL. El rol de aplicación no puede hacer el segundo paso: la seguridad a nivel de fila le oculta todos los usuarios cuando no hay ningún espacio de trabajo seleccionado.

Indique el correo de la cuenta en la primera línea y después escriba la nueva contraseña cuando se le pida (no se muestra nada mientras escribe):

```bash
cd /opt/kanap
USER_EMAIL=admin@example.internal   # la cuenta que se restablece
read -rsp 'New password: ' NEW_PASSWORD; echo
HASH=$(docker compose -f infra/compose.onprem.yml exec -T api node -e "require('argon2').hash(process.argv[1]).then(console.log)" "$NEW_PASSWORD" </dev/null)
unset NEW_PASSWORD
sudo -u postgres psql -d kanap -v hash="$HASH" -v email="${USER_EMAIL}" <<'SQL'
UPDATE users SET password_hash = :'hash' WHERE lower(email) = lower(:'email');
SQL
```

`psql` responde `UPDATE 1`. `UPDATE 0` significa que ninguna cuenta tiene ese correo. La contraseña es visible brevemente en la lista de procesos del servidor mientras se ejecuta la línea `HASH=`: inicie sesión y después cámbiela desde su perfil.

Este método SQL es una alternativa de último recurso para los administradores que no pueden acceder.
