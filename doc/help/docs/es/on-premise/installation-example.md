# Ejemplo de instalación: Ubuntu 24.04

Esta guía describe una instalación local completa en un único servidor Ubuntu 24.04, usando PostgreSQL en el host, MinIO para almacenamiento compatible con S3 y nginx como proxy inverso TLS. Se basa en un despliegue real y funcional.

Adáptela a su entorno — las guías centrales de [Instalación](installation.md) y [Configuración](configuration.md) siguen siendo la referencia.

!!! tip "¿Prefiere automatización?"
    Un agente de programación con IA puede ejecutar toda esta instalación por usted con un solo prompt. Consulte [Instalación asistida por IA](installation-ai.md).

## Arquitectura

```
Navegador → nginx (:443, TLS) → Contenedores Docker (api :8080, web :8081)
                              → PostgreSQL (:5432, en el host)
                              → MinIO (:9000, en el host)
```

Todos los servicios se ejecutan en un único servidor. Los contenedores acceden a los servicios del host vía `host.docker.internal`.

---

## 1. Docker Engine

Instale Docker desde el repositorio oficial:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg

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

Añada su usuario al grupo `docker` (cierre la sesión y vuelva a entrar para que surta efecto):

```bash
sudo usermod -aG docker $USER
```

---

## 2. PostgreSQL 16

```bash
sudo apt-get install -y postgresql-16
```

Cree la base de datos, el usuario y las extensiones requeridas:

```bash
sudo -u postgres psql <<'SQL'
CREATE DATABASE kanap;
CREATE USER kanap WITH PASSWORD 'your-secure-password' NOSUPERUSER NOBYPASSRLS;
GRANT ALL PRIVILEGES ON DATABASE kanap TO kanap;
SQL

sudo -u postgres psql -d kanap <<'SQL'
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
GRANT ALL ON SCHEMA public TO kanap;
SQL
```

### Permitir conexiones desde contenedores Docker

Edite `/etc/postgresql/16/main/postgresql.conf`:

```
listen_addresses = '*'
```

Edite `/etc/postgresql/16/main/pg_hba.conf` — añada antes de las reglas de host predeterminadas:

```
host    kanap    kanap    172.16.0.0/12    scram-sha-256
```

Esto permite conexiones desde la red puente de Docker. Para mayor seguridad, use la subred Docker exacta (`docker network inspect bridge` para encontrarla).

Reinicie PostgreSQL y verifique:

```bash
sudo systemctl restart postgresql
PGPASSWORD='your-secure-password' psql -h 127.0.0.1 -U kanap -d kanap -c "SELECT 1;"
```

---

## 3. MinIO (almacenamiento compatible con S3)

Descargue el servidor y el cliente de MinIO:

```bash
wget -q https://dl.min.io/server/minio/release/linux-amd64/minio -O /tmp/minio
sudo mv /tmp/minio /usr/local/bin/minio
sudo chmod +x /usr/local/bin/minio

wget -q https://dl.min.io/client/mc/release/linux-amd64/mc -O /tmp/mc
sudo mv /tmp/mc /usr/local/bin/mc
sudo chmod +x /usr/local/bin/mc
```

Cree un usuario del sistema y un directorio de datos:

```bash
sudo useradd -r -s /sbin/nologin minio-user
sudo mkdir -p /opt/minio/data
sudo chown -R minio-user:minio-user /opt/minio
```

Configure MinIO — cree `/etc/default/minio`:

```
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=your-minio-admin-password
MINIO_VOLUMES="/opt/minio/data"
MINIO_OPTS="--address :9000 --console-address :9001"
```

Cree el servicio systemd — `/etc/systemd/system/minio.service`:

```ini
[Unit]
Description=MinIO Object Storage
After=network-online.target
Wants=network-online.target

[Service]
User=minio-user
Group=minio-user
EnvironmentFile=/etc/default/minio
ExecStart=/usr/local/bin/minio server $MINIO_VOLUMES $MINIO_OPTS
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

Active e inicie MinIO, luego cree el bucket y una cuenta de servicio:

```bash
sudo systemctl daemon-reload
sudo systemctl enable minio
sudo systemctl start minio

mc alias set localminio http://127.0.0.1:9000 minioadmin your-minio-admin-password
mc mb localminio/kanap-files
mc admin user svcacct add localminio minioadmin \
  --access-key your-s3-access-key \
  --secret-key your-s3-secret-key
```

---

## 4. Clonar KANAP y configurar

```bash
cd /opt  # o su directorio preferido
git clone https://github.com/kanap-hq/kanap.git
cd kanap
cp infra/.env.onprem.example .env
```

Edite `.env` con sus valores. Aquí hay un ejemplo funcional para esta configuración:

```env
# DEPLOYMENT MODE
DEPLOYMENT_MODE=single-tenant

# TENANT
DEFAULT_TENANT_SLUG=default
DEFAULT_TENANT_NAME=My Organization

# ADMIN CREDENTIALS
ADMIN_EMAIL=admin@company.com
ADMIN_PASSWORD=ChangeThisAfterFirstLogin!

# SECURITY
JWT_SECRET=<output of: openssl rand -hex 32>

# APPLICATION URL
APP_BASE_URL=https://kanap.company.com

# CORS
CORS_ORIGINS=https://kanap.company.com

# DATABASE — host.docker.internal reaches the host from inside Docker
DATABASE_URL=postgres://kanap:your-secure-password@host.docker.internal:5432/kanap?sslmode=disable

# STORAGE — MinIO on the host
S3_ENDPOINT=http://host.docker.internal:9000
S3_BUCKET=kanap-files
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-s3-access-key
AWS_SECRET_ACCESS_KEY=your-s3-secret-key
S3_FORCE_PATH_STYLE=true

# EMAIL (optional — choose one transport to enable invitations, password reset, notifications)
# RESEND_API_KEY=re_xxxxx
# RESEND_FROM_EMAIL=KANAP <noreply@yourdomain.com>

# SMTP (single-tenant / on-prem only)
# SMTP_HOST=smtp.company.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=noreply@company.com
# SMTP_PASSWORD=your-smtp-password
# SMTP_FROM=KANAP <noreply@company.com>
```

### Dimensionar PostgreSQL para este servidor

Los valores predeterminados de PostgreSQL están dimensionados para una máquina pequeña. El repositorio tiene un script que imprime ajustes dimensionados según la memoria de este servidor; no cambia nada por sí mismo. Conserva las bibliotecas que PostgreSQL ya precarga (déle su lista) y añade la biblioteca de estadísticas de consultas cuando la encuentra en este servidor. Lea el archivo que escribe, luego reinicie PostgreSQL y active las estadísticas de consultas:

```bash
CURRENT=$(sudo -u postgres psql -XAtc 'SHOW shared_preload_libraries')
sh infra/postgres/kanap-pg-tune.sh --preload "$CURRENT" | sudo tee /etc/postgresql/16/main/conf.d/kanap.conf
sudo systemctl restart postgresql
sudo -u postgres psql -d kanap -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
```

**Importante:** Genere un secreto JWT real (`openssl rand -hex 32`) — no reutilice los valores de ejemplo.

Si accede a KANAP por dirección IP en lugar de un dominio, establezca `APP_BASE_URL` y `CORS_ORIGINS` en `https://YOUR_IP`.

Si usa SMTP en lugar de Resend, asegúrese de que el servidor SMTP acepte correo desde la dirección `SMTP_FROM` y de que la configuración SPF, DKIM y DMARC de su dominio esté ya en su lugar si los mensajes salen de su red interna.

---

## 5. Compilar e iniciar

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml build --pull
docker compose -f infra/compose.onprem.yml up -d
```

Compruebe los registros. Espere la línea "[entrypoint] Migrations complete" y después "Nest application successfully started":

```bash
docker compose -f infra/compose.onprem.yml logs -f api
```

En el primer arranque, KANAP ejecuta las migraciones y crea automáticamente el espacio de trabajo, el usuario administrador y la suscripción.

---

## 6. Proxy inverso nginx con TLS

```bash
sudo apt-get install -y nginx
```

### Certificado TLS

Si tiene un dominio con un certificado adecuado, úselo. De lo contrario, genere un certificado autofirmado:

```bash
sudo mkdir -p /etc/ssl/kanap
sudo openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout /etc/ssl/kanap/server.key \
  -out /etc/ssl/kanap/server.crt \
  -subj "/CN=kanap.company.com" \
  -addext "subjectAltName=DNS:kanap.company.com"
```

Para acceso basado en IP (sin dominio), reemplace los valores de `-subj` y `-addext`:

```bash
  -subj "/CN=192.168.1.83" \
  -addext "subjectAltName=IP:192.168.1.83"
```

### Configuración del sitio

Cree `/etc/nginx/sites-available/kanap`:

```nginx
server {
    # HTTP/2: el navegador envía las decenas de solicitudes de una página por una sola conexión.
    # nginx 1.25.1 y posteriores: escriba `listen 443 ssl;` y `http2 on;` en su lugar.
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name kanap.company.com;

    ssl_certificate     /etc/ssl/kanap/server.crt;
    ssl_certificate_key /etc/ssl/kanap/server.key;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    client_max_body_size 20m;

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

        # Comprime las respuestas JSON y CSV de la API (una página de la lista de presupuesto pesa unas 8 veces menos).
        # Las respuestas de IA en flujo (application/x-ndjson) se dejan fuera a propósito.
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
    server_name kanap.company.com;
    return 301 https://$host$request_uri;
}
```

Active el sitio y reinicie nginx:

```bash
sudo ln -sf /etc/nginx/sites-available/kanap /etc/nginx/sites-enabled/kanap
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

---

## 7. Verificar

```bash
# Verificación de salud de la API
curl -sk https://kanap.company.com/api/health
# Esperado: {"status":"ok"}

# Frontend
curl -sk -o /dev/null -w "%{http_code}" https://kanap.company.com/
# Esperado: 200
```

---

## 8. Primer inicio de sesión

1. Abra su URL de KANAP en un navegador (acepte la advertencia del certificado si usa TLS autofirmado)
2. Inicie sesión con el `ADMIN_EMAIL` / `ADMIN_PASSWORD` de `.env`
3. **Cambie inmediatamente la contraseña del administrador** mediante el perfil de usuario
4. Configure el nombre de su organización en la configuración de Administración
5. Invite a usuarios adicionales (si el correo electrónico está configurado)

---

## Resumen de servicios

| Servicio   | Gestionado por | Ubicación de la configuración            |
|------------|----------------|------------------------------------------|
| Docker     | systemd        | —                                        |
| PostgreSQL | systemd        | `/etc/postgresql/16/main/postgresql.conf` |
| MinIO      | systemd        | `/etc/default/minio`                     |
| KANAP API  | Docker Compose | `.env` + `infra/compose.onprem.yml`      |
| KANAP Web  | Docker Compose | `.env` + `infra/compose.onprem.yml`      |
| nginx      | systemd        | `/etc/nginx/sites-available/kanap`       |

## Comandos útiles

```bash
# Ver registros
docker compose -f infra/compose.onprem.yml logs -f

# Reiniciar KANAP
docker compose -f infra/compose.onprem.yml restart

# Detener KANAP
docker compose -f infra/compose.onprem.yml down

# Recompilar tras una actualización
git pull origin main
docker compose -f infra/compose.onprem.yml build --pull
docker compose -f infra/compose.onprem.yml up -d

# Comprobar todos los servicios
sudo systemctl status postgresql nginx minio
docker compose -f infra/compose.onprem.yml ps
```
