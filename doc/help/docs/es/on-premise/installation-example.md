# Ejemplo de instalación: Ubuntu 26.04

Esta guía recorre una instalación on-premise completa en un único servidor Ubuntu 26.04 LTS, con PostgreSQL en el host, RustFS como almacenamiento compatible con S3 y nginx como proxy inverso con TLS. Cada paso indica los comandos que hay que pegar y el resultado esperado.

Ubuntu 24.04 LTS funciona con dos diferencias, indicadas donde corresponde: PostgreSQL está en la versión 16 (defina `PGVER=16` en el paso 0) y nginx en la versión 1.24 (un comando `sed` en el paso 8).

Adapte el ejemplo a su entorno. Las guías principales de [Instalación](installation.md) y [Configuración](configuration.md) siguen siendo la referencia.

!!! tip "¿Prefiere automatizar?"
    Un agente de programación con IA puede realizar toda esta instalación por usted a partir de un solo prompt. Consulte [Instalación asistida por IA](installation-ai.md).

## Arquitectura

```
Browser → nginx (:443, TLS) → Docker containers (api :8080, web :8081)
                             → PostgreSQL (:5432, on host)
                             → RustFS (172.17.0.1:9000, on host)
```

Todos los servicios se ejecutan en un único servidor. Los contenedores llegan a los servicios del host a través de `host.docker.internal`, que es la dirección del puente Docker del servidor (`172.17.0.1`). PostgreSQL escucha en todas las direcciones del servidor, y el cortafuegos y `pg_hba.conf` solo dejan llegar a las redes Docker. El almacenamiento escucha únicamente en la dirección del puente Docker.

---

## 0. Antes de empezar

Necesita:

- Un servidor Ubuntu 26.04 LTS recién instalado con 6 GB de RAM o más (8 GB recomendados), 20 GB de disco y acceso saliente a internet. La compilación de las imágenes, en la instalación y en cada actualización, necesita esa memoria.
- Un usuario con derechos `sudo` (que no sea `root`). Todos los comandos siguientes se ejecutan con ese usuario.
- El nombre que escriben los usuarios para abrir KANAP, por ejemplo `kanap.example.internal`. Consulte [Nombre y certificado](installation.md#nombre-y-certificado). Este ejemplo usa un nombre interno con un certificado autofirmado. El paso 8 muestra los otros dos casos.
- La dirección de correo del primer administrador.
- El nombre de su organización.

Elija los cuatro valores de las primeras líneas y pegue el bloque completo. Mantenga las comillas simples alrededor del nombre de la organización: puede contener espacios. Si el nombre contiene un apóstrofo, use comillas dobles: `ORG_NAME="Caisse d'Epargne"`. No ponga `$` ni comillas invertidas en el nombre. El bloque escribe los valores, con los secretos que genera, en `~/kanap-install.env`, un archivo que solo usted puede leer. Los pasos siguientes leen ese archivo con `. ~/kanap-install.env`, así que cada bloque funciona en una nueva sesión de terminal. Ningún comando muestra los secretos.

```bash
PGVER=18                            # 16 en Ubuntu 24.04
KANAP_HOST=kanap.example.internal   # el nombre que escriben los usuarios, sin https://
ADMIN_EMAIL=admin@example.internal  # correo del primer administrador
ORG_NAME='Example Company'          # nombre de su organización, se define una vez: la aplicación no puede cambiarlo después

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

La contraseña de la base de datos es hexadecimal (letras y cifras), así que no necesita codificación en la URL de la base de datos. Una contraseña que contenga `@ : / # ? %` debe codificarse con porcentajes en ella.

---

## 1. Docker Engine

Instale Docker desde el repositorio oficial:

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

Añada su usuario al grupo `docker`:

```bash
sudo usermod -aG docker "$USER"
```

Cierre la sesión y abra una nueva para que se aplique el grupo. Después compruebe que Docker responde sin `sudo`:

```bash
docker ps
```

Muestra una línea de cabecera que empieza por `CONTAINER ID`, y todavía ningún contenedor.

---

## 2. Cortafuegos

Un servidor recién instalado acepta todas las conexiones. Configure el cortafuegos antes de instalar PostgreSQL y el almacenamiento, para que ninguno de los dos quede nunca abierto a la red. Cierre todo salvo SSH, HTTP y HTTPS, y deje que solo las redes Docker lleguen a PostgreSQL (5432) y al almacenamiento (9000). Las reglas pueden nombrar puertos en los que todavía no escucha nada. **Permita SSH primero**, o perderá el acceso cuando arranque el cortafuegos.

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

El estado lista `OpenSSH`, `80/tcp`, `443/tcp` y las dos reglas desde `172.16.0.0/12`. También lista `OpenSSH (v6)`, `80/tcp (v6)` y `443/tcp (v6)`: las mismas tres reglas para IPv6. Si SSH escucha en otro puerto, permita también ese puerto antes de activar el cortafuegos.

---

## 3. Obtener KANAP

Obtenga primero los archivos: el script de dimensionamiento de PostgreSQL del paso siguiente viene con ellos. La rama `stable` siempre apunta a la última versión publicada.

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

`pg_lsclusters` muestra el clúster `main` de su versión, en línea (`online`). Las rutas siguientes usan `/etc/postgresql/${PGVER}/main`.

Cree la base de datos, el rol de aplicación y las extensiones necesarias:

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

Los comandos muestran `CREATE DATABASE`, `CREATE ROLE` y `GRANT`, después `CREATE EXTENSION` tres veces y `GRANT`.

### Permitir conexiones desde los contenedores Docker

PostgreSQL debe escuchar más allá de `localhost` y aceptar el rol de aplicación desde las redes Docker. En un servidor nuevo, Docker coloca la red de KANAP en `172.16.0.0/12` (normalmente `172.18.0.0/16`), así que la línea siguiente la permite. El paso 5 explica cómo comprobarlo tras el primer arranque. El cortafuegos del paso 2 mantiene el puerto cerrado para el resto de la red.

```bash
. ~/kanap-install.env
echo "listen_addresses = '*'" | sudo tee /etc/postgresql/${PGVER}/main/conf.d/kanap-network.conf >/dev/null
echo "host    kanap    kanap    172.16.0.0/12    scram-sha-256" | sudo tee -a /etc/postgresql/${PGVER}/main/pg_hba.conf >/dev/null
sudo systemctl restart postgresql
PGPASSWORD="${PG_PASSWORD}" psql -h 127.0.0.1 -U kanap -d kanap -c "SELECT 1;"
```

El último comando debe mostrar una tabla con `1`. Para restringir la regla más adelante, use la subred de los contenedores de KANAP: tras el primer arranque, `docker network inspect infra_default` la muestra.

### Dimensionar PostgreSQL para este servidor

Los valores predeterminados de PostgreSQL están pensados para una máquina pequeña. El repositorio incluye un script que muestra parámetros calculados a partir de la memoria de este servidor; por sí solo no cambia nada. Conserva las bibliotecas que PostgreSQL ya precarga (toma su lista) y añade la biblioteca de estadísticas de consultas cuando la encuentra en este servidor. Los comandos escriben el resultado en un archivo de configuración adicional, reinician PostgreSQL y activan las estadísticas de consultas:

```bash
cd /opt/kanap
. ~/kanap-install.env
CURRENT=$(sudo -u postgres psql -XAtc 'SHOW shared_preload_libraries')
sh infra/postgres/kanap-pg-tune.sh --preload "$CURRENT" | sudo tee /etc/postgresql/${PGVER}/main/conf.d/kanap.conf >/dev/null
sudo systemctl restart postgresql
sudo -u postgres psql -d kanap -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
```

El último comando muestra `CREATE EXTENSION`. Para leer los parámetros, muestre el archivo (su cabecera explica cada valor):

```bash
. ~/kanap-install.env
cat /etc/postgresql/${PGVER}/main/conf.d/kanap.conf
```

Los detalles están en [Operaciones](operations.md#configuracion-de-postgresql).

---

## 5. Almacenamiento de objetos (RustFS)

KANAP guarda los adjuntos, los logotipos y las exportaciones en un almacenamiento compatible con S3. Este ejemplo ejecuta RustFS (Apache 2.0) en el mismo servidor. Funciona cualquier otro almacenamiento compatible con S3: omita este paso y defina las variables `S3_*` del paso 6 para su almacenamiento (consulte [Configuración](configuration.md#obligatorio-almacenamiento)).

MinIO ya no publica nuevas descargas ni imágenes, así que una instalación nueva usa otro almacenamiento. Una instalación que ya funciona con MinIO sigue funcionando con KANAP.

El almacenamiento escucha únicamente en la dirección del puente Docker `172.17.0.1`, así que no es accesible desde la red. La consola está desactivada.

**Instale RustFS y su herramienta de línea de comandos.** Los números de versión están en las dos primeras líneas: use la última versión que figura en la [página de versiones de RustFS](https://github.com/rustfs/rustfs/releases) y en la [página de versiones de RustFS CLI](https://github.com/rustfs/cli/releases). Si cambia una versión, compruebe los nombres de archivo en su página de versión. Cada descarga se verifica con el archivo `SHA256SUMS` de su versión; el comando se detiene si la verificación falla.

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

Cada línea `sha256sum` debe mostrar `OK`. Las dos últimas líneas eliminan los archivos descargados. El paquete crea el usuario `rustfs`, el directorio de datos `/data/rustfs`, el directorio `/opt/rustfs` y un servicio systemd. También instala un `/etc/default/rustfs` comentado, que el bloque siguiente sustituye por un archivo que solo root puede leer (modo 600). No arranca el servicio.

**Configure y arranque el servicio.**

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

La última línea debe mostrar `172.17.0.1:9000` en escucha. El archivo adicional `After=docker.service` hace que el servicio arranque cuando Docker ya ha creado la dirección del puente. Si Docker usa otra dirección de puente (`ip -4 addr show docker0`), ponga esa dirección en `RUSTFS_ADDRESS`. Por defecto, Docker asigna a sus 15 primeras redes los rangos `172.17.0.0/16` a `172.31.0.0/16`, todos dentro de `172.16.0.0/12`. Las redes siguientes reciben bloques `/20` de `192.168.0.0/16`. En un servidor nuevo, la red de KANAP es `172.18.0.0/16`. En un servidor que ya tiene 13 redes Docker o más además del puente predeterminado, puede acabar en `192.168.x.x`. Tras el primer arranque (paso 7), `docker network inspect infra_default` muestra la red de KANAP. Si está fuera de `172.16.0.0/12`, añada su rango a las reglas de cortafuegos del paso 2 y a la línea de `pg_hba.conf` del paso 4. Si su parámetro `default-address-pools` es distinto, sustituya el rango en su lugar.

`RUSTFS_SSE_S3_MASTER_KEY` es la clave que cifra los archivos en reposo. KANAP pide el cifrado en reposo al subir archivos. Sin la clave, RustFS rechaza la solicitud y la API registra una advertencia `PutObject fallback used`. **Guarde esta clave con la copia de seguridad de la configuración del servidor**: los archivos cifrados con ella no pueden leerse sin ella.

**Cree el bucket, una política de privilegios mínimos y el usuario de la aplicación.** El usuario de la aplicación puede leer, escribir y eliminar objetos en `kanap-files` y nada más. Su clave de acceso es `kanap-app`; su clave secreta es el `S3_SECRET_KEY` generado de 64 caracteres (RustFS acepta de 8 a 128 caracteres). Ningún secreto aparece en los comandos que `sudo` registra en el registro del sistema: la herramienta `rc` lee las claves de administrador de un archivo reservado a root, y el secreto del usuario de la aplicación le llega por la entrada estándar.

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

El último comando muestra `Status: enabled` y la política `kanap-app`.

Para actualizar RustFS más adelante, instale el `.deb` más reciente de la misma manera. Cuando `dpkg` pregunte por `/etc/default/rustfs`, conserve su versión.

---

## 6. Configurar KANAP

Cree el archivo `.env`. La plantilla lista cada parámetro con su explicación; este ejemplo la sustituye por un archivo funcional para esta instalación. Solo usted puede leer el archivo.

```bash
cd /opt/kanap
. ~/kanap-install.env
cp infra/.env.onprem.example .env
chmod 600 .env
cat > .env <<EOF
# DEPLOYMENT MODE
DEPLOYMENT_MODE=single-tenant

# TENANT (set before the first start)
DEFAULT_TENANT_SLUG=default
DEFAULT_TENANT_NAME=${ORG_NAME}

# ADMIN CREDENTIALS (read at the first start only)
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=ChangeThisAfterFirstLogin!

# SECURITY
JWT_SECRET=${JWT_SECRET}

# RUN MODE: users reach KANAP over HTTPS
APP_ENV=production

# APPLICATION URL AND CORS: the exact address users open
APP_BASE_URL=https://${KANAP_HOST}
CORS_ORIGINS=https://${KANAP_HOST}

# CLIENT ADDRESS: one reverse proxy (nginx) in front of the API
RATE_LIMIT_TRUST_PROXY=true

# DATABASE: host.docker.internal reaches the host from inside Docker
DATABASE_URL=postgres://kanap:${PG_PASSWORD}@host.docker.internal:5432/kanap?sslmode=disable

# STORAGE: RustFS on the host
S3_ENDPOINT=http://host.docker.internal:9000
S3_BUCKET=kanap-files
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=kanap-app
AWS_SECRET_ACCESS_KEY=${S3_SECRET_KEY}
S3_FORCE_PATH_STYLE=true

# EMAIL (optional: choose one transport to enable invitations, password reset, notifications)
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

**Defina su propia contraseña de administrador.** `ADMIN_PASSWORD` debe ser un valor propio de 12 caracteres o más. El valor de ejemplo anterior es público, y un valor de ejemplo o uno más corto hace que la API muestre una advertencia `[SECURITY]` en cada arranque hasta que se cambie la contraseña de la cuenta. Este comando lo sustituye por la contraseña aleatoria generada en el paso 0 (`openssl rand -base64 18`):

```bash
cd /opt/kanap
. ~/kanap-install.env
sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${KANAP_ADMIN_PASSWORD}|" .env
```

La prueba de humo del paso 9 la lee de `.env` sin mostrarla. El paso 10 la muestra una vez para su primer inicio de sesión.

Notas sobre el archivo:

- La cuenta de administrador se crea en el primer arranque a partir de `ADMIN_EMAIL` y `ADMIN_PASSWORD`. Cambiarlos más tarde no cambia nada mientras exista un administrador activo.
- `DEFAULT_TENANT_NAME` es el nombre de su organización, del paso 0. KANAP solo lo lee en el primer arranque, y la aplicación no tiene ninguna página para cambiarlo.
- La contraseña de `DATABASE_URL` y `JWT_SECRET` se generaron en el paso 0. No reutilice valores de ejemplo.
- Con `sslmode=disable`, la conexión con PostgreSQL no sale del servidor. Para otro servidor PostgreSQL, consulte [`sslmode`](configuration.md#obligatorio-base-de-datos).
- Si accede a KANAP por dirección IP en lugar de un nombre, defina `APP_BASE_URL` y `CORS_ORIGINS` como `https://<dirección ip>`.
- Para el correo saliente, quite el `#` de un bloque y rellene los valores. Si usa SMTP, compruebe que el servidor acepta el correo de la dirección `SMTP_FROM` y que SPF, DKIM y DMARC están configurados si los mensajes salen de su red.
- Para las funciones de IA, añada las cuatro variables `AI_*` de [Configuración](configuration.md#opcional-funciones-de-ia).

---

## 7. Compilar e iniciar

Compile las imágenes y arranque los contenedores. La compilación tarda uno o dos minutos. `--wait` termina cuando ambos contenedores indican `healthy`; el primer arranque ejecuta las migraciones de la base de datos y tarda entre unos segundos y un minuto.

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml build --pull
docker compose -f infra/compose.onprem.yml up -d --wait
docker compose -f infra/compose.onprem.yml ps
docker compose -f infra/compose.onprem.yml logs --no-log-prefix api | grep -E '^\[|^Admin seeding|WARN|ERROR|successfully started|Email transport'
```

Si la compilación se detiene con `signal: killed`, el servidor se quedó sin memoria. `sudo dmesg | grep -i oom` lo confirma. Compruebe la memoria libre con `free -m` y detenga los demás servicios que la usan. Compruebe que PostgreSQL y el almacenamiento siguen funcionando (`pg_lsclusters`, `systemctl status --no-pager rustfs`). Después reinicie Docker, lo que detiene lo que queda de la compilación interrumpida, compile las dos imágenes una tras otra, lo que necesita menos memoria, y arranque KANAP:

```bash
sudo systemctl restart docker
cd /opt/kanap
docker compose -f infra/compose.onprem.yml build --pull api
docker compose -f infra/compose.onprem.yml build --pull web
docker compose -f infra/compose.onprem.yml up -d --wait
```

`ps` muestra `api` y `web` como `healthy`. El último comando conserva las líneas de arranque del registro de la API y omite los detalles del framework. En el primer arranque muestra estas líneas, en este orden (la primera línea `[SECRETS]` está abreviada aquí):

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

El número de migraciones depende de la versión, y las cifras del pool dependen de su PostgreSQL.

El bloque omite las líneas de migración: unas 40 líneas que empiezan por `[Migration]` o `[migration:` siguen a `Running migrations...`. Son informativas. En una base de datos nueva, algunas indican cambios en datos de referencia integrados o nombran un identificador de espacio de trabajo que no es el suyo: KANAP mantiene un espacio de trabajo del sistema para las funciones de la plataforma. No requieren ninguna acción. `...` representa el prefijo `[Nest]` con el identificador del proceso y la hora, y el origen entre corchetes (por ejemplo `LOG [NestApplication]`). Algunas de estas líneas terminan con una duración como `+0ms`. La última línea de la salida filtrada es `[DB] pool budget ...`. Un registro guardado en un archivo puede contener códigos de color como `[33m`.

Dos líneas son esperadas y no requieren ninguna acción: `Admin seeding disabled ...` y, mientras no configure el correo, la advertencia de `EmailService`. Una advertencia `[SECURITY]`, `[CONFIG]`, `[CORS]` o `[ENV] APP_ENV is not set` indica que un parámetro requiere atención: [Configuración](configuration.md#que-muestra-el-registro-de-la-api-al-arrancar) explica cada línea.

---

## 8. nginx y TLS

Instale nginx:

```bash
sudo apt-get install -y nginx
```

### El servidor resuelve el nombre

Las comprobaciones de los pasos siguientes se ejecutan en este servidor y llaman a KANAP por su nombre, así que el servidor debe resolverlo. Con un registro DNS, ya funciona. Sin él, este comando añade el nombre al archivo hosts del servidor (no hace nada si el nombre ya se resuelve):

```bash
. ~/kanap-install.env
getent hosts "${KANAP_HOST}" || echo "127.0.0.1 ${KANAP_HOST}" | sudo tee -a /etc/hosts
```

Los puestos de los usuarios necesitan el registro DNS o, para una prueba, una línea en su propio archivo hosts que apunte el nombre a la dirección de este servidor.

### Certificado TLS

Use uno de los tres casos de [Nombre y certificado](installation.md#nombre-y-certificado). Cada uno termina escribiendo las rutas del certificado y de la clave en `~/kanap-install.env`.

**Autofirmado (solo para pruebas, usado en este ejemplo).** Todos los navegadores muestran una advertencia que cada usuario debe aceptar.

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

**Certificado de su autoridad interna.** Pida un certificado para el mismo nombre. Copie la cadena completa y la clave privada en `/etc/ssl/kanap/fullchain.pem` y `/etc/ssl/kanap/privkey.pem` (clave en modo `600`), y después registre las rutas. Los navegadores de los puestos gestionados ya confían en la autoridad, así que los usuarios no ven ninguna advertencia.

```bash
printf 'KANAP_CERT=%s\nKANAP_KEY=%s\n' /etc/ssl/kanap/fullchain.pem /etc/ssl/kanap/privkey.pem >> ~/kanap-install.env
```

**Let's Encrypt (nombre público).** El nombre debe resolver a este servidor desde internet y el puerto 80 debe ser accesible. La página predeterminada de nginx responde al desafío, así que ejecute esto antes de activar el sitio de KANAP. El paquete `certbot` renueva el certificado por sí solo; el hook de despliegue recarga nginx después de cada renovación.

```bash
. ~/kanap-install.env
sudo apt-get install -y certbot
sudo certbot certonly --webroot -w /var/www/html -d "${KANAP_HOST}" \
  -m "${ADMIN_EMAIL}" --agree-tos --no-eff-email --non-interactive \
  --deploy-hook 'systemctl reload nginx'
printf 'KANAP_CERT=%s\nKANAP_KEY=%s\n' "/etc/letsencrypt/live/${KANAP_HOST}/fullchain.pem" "/etc/letsencrypt/live/${KANAP_HOST}/privkey.pem" >> ~/kanap-install.env
sudo certbot renew --dry-run
```

### Configuración del sitio

Escriba el archivo del sitio con marcadores para el nombre y el certificado, y después rellénelos. El archivo es para nginx 1.25.1 y posteriores (Ubuntu 26.04 incluye la 1.28). Envía `/api/` directamente al puerto de la API (`127.0.0.1:8080`) para que KANAP vea la dirección de cada usuario.

```bash
sudo tee /etc/nginx/sites-available/kanap >/dev/null <<'EOF'
server {
    # HTTP/2: the browser sends the dozens of requests of a page over one connection.
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name KANAP_HOST;

    ssl_certificate     KANAP_CERT;
    ssl_certificate_key KANAP_KEY;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    # Upload limit: budget files up to 48 MB, attachments up to 20 MB
    client_max_body_size 50m;

    # Canonicalize /api → /api/
    location = /api { return 301 /api/; }

    # API: strip /api prefix before proxying
    location ^~ /api/ {
        proxy_pass http://127.0.0.1:8080/;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;

        # Compress the API's JSON and CSV answers (a budget list page shrinks about 8 times).
        # Streamed AI answers (application/x-ndjson) are left out on purpose.
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

    # Everything else → SPA
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

    # Certificate renewal with Let's Encrypt (webroot); harmless otherwise
    location /.well-known/acme-challenge/ { root /var/www/html; }

    location / { return 301 https://$host$request_uri; }
}
EOF

. ~/kanap-install.env
sudo sed -i -e "s|KANAP_HOST|${KANAP_HOST}|g" -e "s|KANAP_CERT|${KANAP_CERT}|g" -e "s|KANAP_KEY|${KANAP_KEY}|g" /etc/nginx/sites-available/kanap
```

**Ubuntu 24.04 (nginx 1.24):** no conoce la directiva `http2 on;`. Ejecute esto una vez después de los comandos anteriores:

```bash
sudo sed -i -e 's/listen 443 ssl;/listen 443 ssl http2;/' -e 's/listen \[::\]:443 ssl;/listen [::]:443 ssl http2;/' -e '/^ *http2 on;$/d' /etc/nginx/sites-available/kanap
```

Active el sitio y reinicie nginx:

```bash
sudo ln -sf /etc/nginx/sites-available/kanap /etc/nginx/sites-enabled/kanap
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
```

`nginx -t` debe mostrar `syntax is ok` y `test is successful`.

---

## 9. Verificar

Compruebe el estado de la API y del frontend a través de nginx. `-S` hace que `curl` muestre un error, por ejemplo un nombre que no se resuelve. `-k` acepta un certificado en el que el servidor no confía: manténgalo con un certificado autofirmado, o con un certificado de su autoridad interna cuando esa autoridad no está instalada en el servidor; quítelo con Let's Encrypt.

```bash
. ~/kanap-install.env
curl -sSk -w '\n' "https://${KANAP_HOST}/api/health"
# Esperado: {"status":"ok"}
curl -sSk -o /dev/null -w "%{http_code}\n" "https://${KANAP_HOST}/"
# Esperado: 200
```

Después ejecute la prueba de humo. Comprueba la base de datos, el almacenamiento, el inicio de sesión y las exportaciones a través de la API pública, como lo hace la aplicación web. El servidor no tiene Node.js, así que la prueba se ejecuta en un contenedor. La línea que empieza por `KANAP_PASSWORD=` lee la contraseña del administrador de `.env` y la pasa al entorno de la prueba sin mostrarla. La primera ejecución descarga la imagen `node:24-alpine` de Docker Hub (unos 240 MB) y la conserva para las siguientes. `KANAP_WRITE=1` también crea una tarea temporal con un adjunto, lo que comprueba el almacenamiento, y después la elimina. Úselo solo justo después de la instalación: escribe en los datos. La tarea temporal consume una referencia de tarea (`T-1` en una instalación nueva), así que su primera tarea será `T-2`. `KANAP_INSECURE_TLS=1` acepta un certificado en el que el contenedor no confía: manténgalo con un certificado autofirmado. Con un certificado de su autoridad interna, puede mantenerlo o dejar que el contenedor verifique el certificado: ponga el archivo de la autoridad en `/opt/kanap/infra/certs/` (consulte [Certificados de una autoridad interna](configuration.md#opcional-certificados-de-una-autoridad-interna)) y sustituya `-e KANAP_INSECURE_TLS=1` por `-v /opt/kanap/infra/certs:/certs:ro -e NODE_EXTRA_CA_CERTS=/certs/company-ca.pem`. Con Let's Encrypt, quite `-e KANAP_INSECURE_TLS=1`.

```bash
. ~/kanap-install.env
KANAP_PASSWORD="$(grep '^ADMIN_PASSWORD=' /opt/kanap/.env | cut -d= -f2-)"; export KANAP_PASSWORD
docker run --rm --network host \
  -e KANAP_URL="https://${KANAP_HOST}" -e KANAP_EMAIL="${ADMIN_EMAIL}" -e KANAP_PASSWORD \
  -e KANAP_INSECURE_TLS=1 -e KANAP_WRITE=1 \
  -v /opt/kanap/scripts/smoke:/smoke:ro node:24-alpine node /smoke/recette.mjs
unset KANAP_PASSWORD
```

La última línea termina con `0 failed`: se parece a `25 OK, 1 skipped, 0 failed (0.5 s)`. Con `KANAP_INSECURE_TLS=1`, dos advertencias TLS al principio de la salida son normales. Un `SKIP` para los parámetros de IA es normal mientras las funciones de IA están desactivadas. Por último, compruebe que el registro de la API no muestra ninguna advertencia de almacenamiento:

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml logs api | grep 'PutObject fallback' || echo "no storage warning"
```

---

## 10. Primer inicio de sesión

1. Abra `https://<su nombre>` en un navegador (acepte la advertencia del certificado si usa un certificado autofirmado; el puesto debe resolver el nombre).
2. Inicie sesión con `ADMIN_EMAIL` y la contraseña del administrador. Para ver la contraseña, ejecute `grep '^ADMIN_PASSWORD=' /opt/kanap/.env | cut -d= -f2-` en el servidor. Aparece en pantalla, así que ejecútelo cuando nadie más pueda ver su pantalla.
3. Cambie la contraseña en su perfil justo después de este primer inicio de sesión. KANAP solo lee el valor de `.env` en el primer arranque.
4. Añada su logotipo y sus colores en **Administración → Personalización** (opcional).
5. Invite a más usuarios (si el correo está configurado).

La instalación ha terminado. `~/kanap-install.env` ya ha cumplido su función: todos los valores están ahora en `/opt/kanap/.env`, `/etc/default/rustfs` y el rol de PostgreSQL. Elimine el archivo:

```bash
rm ~/kanap-install.env
```

A continuación, configure las [copias de seguridad](operations.md#copia-de-seguridad-y-restauracion).

---

## Resumen de servicios

| Servicio   | Gestionado por | Configuración                                         |
|------------|----------------|-------------------------------------------------------|
| Docker     | systemd        | ninguna                                               |
| PostgreSQL | systemd (`postgresql@<version>-main`) | `/etc/postgresql/<version>/main/conf.d/`, `pg_hba.conf` |
| RustFS     | systemd        | `/etc/default/rustfs` (contiene la clave de cifrado), `/root/.config/rc/config.toml` (contiene las claves de administrador del almacenamiento para la herramienta `rc`) |
| Cortafuegos | ufw           | `sudo ufw status`                                     |
| KANAP API  | Docker Compose | `/opt/kanap/.env` + `infra/compose.onprem.yml`        |
| KANAP Web  | Docker Compose | `/opt/kanap/.env` + `infra/compose.onprem.yml`        |
| nginx      | systemd        | `/etc/nginx/sites-available/kanap`                    |

## Comandos útiles

Ejecute estos comandos de uno en uno. `logs -f` sigue el registro hasta que pulse Ctrl+C, y `down` detiene KANAP.

```bash
cd /opt/kanap

# Ver los registros
docker compose -f infra/compose.onprem.yml logs -f

# Reiniciar KANAP
docker compose -f infra/compose.onprem.yml restart

# Aplicar un cambio de .env
docker compose -f infra/compose.onprem.yml up -d api

# Detener KANAP
docker compose -f infra/compose.onprem.yml down

# Comprobar todos los servicios (pg_lsclusters muestra el clúster en línea)
pg_lsclusters
sudo systemctl status --no-pager nginx rustfs
docker compose -f infra/compose.onprem.yml ps

# Qué versión se ejecuta: la del checkout y después la de la API (-k: ver el paso 9)
git describe --tags
curl -sSk -w '\n' "$(grep '^APP_BASE_URL=' .env | cut -d= -f2-)/api/config/public"
```

Compruebe PostgreSQL con `pg_lsclusters`. `systemctl status postgresql` sigue en `active` aunque el clúster esté detenido. El campo `version` de la última respuesta es la versión que indica la API.

Para actualizar KANAP, siga el [procedimiento de actualización](operations.md#procedimiento-de-actualizacion): lea el registro de cambios y después ejecute `git pull origin stable`, `build --pull` y `up -d`.
