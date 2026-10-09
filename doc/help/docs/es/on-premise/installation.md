# Instalación on-premise

## Requisitos previos

**Requisitos del servidor:**

- Servidor Linux: Ubuntu 26.04 o 24.04 LTS, Debian 12 o 13, RHEL 9 o 10, o cualquier sistema operativo con Docker Engine 24.0+ y el plugin Docker Compose
- Docker Engine 24.0+
- Plugin Docker Compose 2.20 o posterior (las versiones actuales son 5.x)
- Git
- 6 GB de RAM como mínimo, 8 GB recomendados. La compilación de las imágenes, en la instalación y en cada actualización, necesita ese margen. Más procesos de API necesitan más memoria, consulte [Configuración](configuration.md#opcional-capacidad-y-rendimiento).
- 20 GB de disco como mínimo. Tras la instalación, KANAP ocupa unos 4 GB (imágenes 1,3 GB, caché de compilación 2,5 GB). La base de datos, los archivos almacenados y la caché de compilación crecen con el tiempo; la caché crece en cada actualización, y `docker builder prune` la libera.

**Infraestructura aportada por el cliente:**

| Componente | Requisito |
|-----------|-------------|
| PostgreSQL | Versión 16+ con las extensiones `citext`, `pgcrypto`, `uuid-ossp`, y un rol de aplicación dedicado para `DATABASE_URL` |
| Almacenamiento S3 | Cualquier almacenamiento compatible con S3 con un bucket: AWS S3, Cloudflare R2, Hetzner Object Storage, Garage, RustFS, un MinIO existente y otros. KANAP necesita `PutObject`, `GetObject`, `HeadObject`, `DeleteObject`, `ListObjectsV2` y `GET` prefirmado en ese bucket. |
| Proxy inverso | Terminación TLS y enrutamiento (nginx, Traefik, Caddy, etc.) |
| Nombre y certificado | Un nombre que resuelvan los usuarios y el servidor, y un certificado para ese nombre (ver más abajo) |

Un MinIO que ya funciona sigue funcionando con KANAP: no hay nada que cambiar. MinIO ya no publica nuevas descargas ni imágenes, por eso el [ejemplo de instalación](installation-example.md) usa RustFS.

Opcional:

- Configuración del correo saliente: clave API de Resend o datos de un relay o servidor SMTP
- SSO con Microsoft Entra (consulte [SSO con Microsoft Entra](sso-entra.md))
- Un agente de programación con IA que realice la instalación por usted (consulte [Instalación asistida por IA](installation-ai.md))

## Nombre y certificado

Los usuarios abren KANAP en una dirección HTTPS, por ejemplo `https://kanap.company.com`. Esa dirección necesita un nombre que resuelva a su servidor y un certificado que corresponda a ese nombre. Tres casos cubren la mayoría de las redes:

| Caso | Nombre | Certificado |
|------|------|-------------|
| **Nombre público** | Un registro en el DNS público que apunta al servidor (o al cortafuegos situado delante) | De una autoridad pública, por ejemplo Let's Encrypt con `certbot`. El puerto 80 debe ser accesible desde internet. |
| **Nombre interno** | Un registro en el DNS de su empresa. Para una prueba, una línea en `/etc/hosts` en el servidor y en cada cliente. | De la autoridad de certificación interna de su empresa. Los navegadores de los puestos gestionados ya confían en ella, así que los usuarios no ven ninguna advertencia. |
| **Autofirmado** | Igual que el nombre interno | Creado en el servidor. Solo para pruebas: todos los navegadores muestran una advertencia que cada usuario debe aceptar. |

Muchas instalaciones no tienen DNS público. El nombre interno con un certificado interno es una configuración normal y admitida. El certificado del proxy inverso sirve a los navegadores. La API también abre sus propias conexiones, hacia SMTP, PostgreSQL o S3: si su autoridad firmó los certificados de esos servidores, consulte [Certificados de una autoridad interna](configuration.md#opcional-certificados-de-una-autoridad-interna).

**El servidor también debe resolver el nombre.** Los comandos de verificación de esta guía, y la prueba de humo, se ejecutan en el servidor y llaman a KANAP por su nombre. Si todavía no existe ningún registro DNS, añada el nombre al archivo hosts del servidor:

```bash
echo "127.0.0.1 kanap.company.com" | sudo tee -a /etc/hosts
```

Sustituya `kanap.company.com` por su nombre. Los clientes necesitan su propia entrada (o el registro DNS) que apunte a la dirección del servidor.

**Certificado autofirmado (solo para pruebas):**

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

Sustituya `kanap.company.com` por su nombre. Para un acceso por dirección IP, use `IP:192.0.2.10` en `subjectAltName` y ponga la IP en `-subj` y en `server_name`. Para usar su autoridad interna, pida un certificado para el mismo nombre y haga que `ssl_certificate` y `ssl_certificate_key` del archivo de nginx apunten a los archivos que le entregue (la cadena completa y la clave privada). Nada más cambia.

**Let's Encrypt:** `sudo apt-get install -y certbot`, después `sudo certbot certonly --webroot -w /var/www/html -d kanap.company.com`, con la página predeterminada de nginx respondiendo en el puerto 80. Los archivos del certificado son `/etc/letsencrypt/live/kanap.company.com/fullchain.pem` y `privkey.pem`. El [ejemplo de instalación](installation-example.md#8-nginx-y-tls) muestra la secuencia completa, renovación incluida.

## Inicio rápido

```bash
# 1. Obtener KANAP. La rama "stable" siempre apunta a la última versión publicada.
sudo install -d -o "$USER" -g "$USER" /opt/kanap
git clone https://github.com/kanap-hq/KANAP.git /opt/kanap
cd /opt/kanap
git checkout stable

# 2. Configurar ANTES de compilar
cp infra/.env.onprem.example .env
chmod 600 .env
nano .env  # Definir DATABASE_URL, las credenciales S3, ADMIN_EMAIL, ADMIN_PASSWORD, JWT_SECRET,
#          DEFAULT_TENANT_NAME (el nombre de su organización, leído solo en el primer arranque),
#          APP_BASE_URL y CORS_ORIGINS (la dirección exacta que abren los usuarios),
#          APP_ENV=production (los usuarios acceden a KANAP por HTTPS) y RATE_LIMIT_TRUST_PROXY=true
# Todas las variables están en la guía de Configuración

# 3. Compilar las imágenes Docker (Compose las compila a partir del repositorio)
docker compose -f infra/compose.onprem.yml build --pull

# 4. Arrancar los contenedores
docker compose -f infra/compose.onprem.yml up -d

# 5. Verificar el arranque
docker compose -f infra/compose.onprem.yml logs -f api
# Esperar "[entrypoint] Migrations complete" y después "Nest application successfully started"
# El primer arranque crea automáticamente el espacio de trabajo, el usuario administrador y la suscripción
# Pulsar Ctrl+C para dejar de seguir el registro

# 6. Configurar el proxy inverso para enrutar el tráfico hacia:
#    - /api/* → 127.0.0.1:8080 (el contenedor api)
#    - /*     → 127.0.0.1:8081 (el contenedor web, puerto 80 dentro del contenedor)
# Comprobar que el proxy conserva Host y define X-Forwarded-Proto y X-Forwarded-For.
# Tras el primer arranque, leer las líneas [ENV], [CONFIG], [CORS], [RATE-LIMIT] y [SECURITY] del registro de la API.

# 7. Acceder a la aplicación
# https://kanap.company.com
# Iniciar sesión con ADMIN_EMAIL / ADMIN_PASSWORD de .env
```

**Importante:** complete la configuración (paso 2) antes de arrancar los contenedores. La API lee `.env` al arrancar y crea el espacio de trabajo y el usuario administrador en el primer arranque con esos valores. El archivo contiene todos los secretos de la instalación: `chmod 600` hace que solo su propietario pueda leerlo.

**Versiones.** KANAP publica una nueva versión aproximadamente una vez al mes (`26.10.1` es la primera). La rama `stable` siempre apunta a la última versión publicada. Consulte [Operaciones](operations.md#procedimiento-de-actualizacion) para actualizar, fijar una versión concreta y volver atrás. La rama `main` contiene todos los cambios integrados antes de que se publiquen como versión. Es posible seguirla, pero no se recomienda para un servidor de producción.

**Requisito del rol de base de datos:** `DATABASE_URL` debe usar un rol de aplicación de PostgreSQL dedicado. No lo apunte a `postgres` ni a otro rol de administración del clúster. KANAP se niega a arrancar si no puede aplicar RLS de forma efectiva.

**Dirección y orígenes:** defina `APP_BASE_URL` y `CORS_ORIGINS` con la dirección exacta que abren los usuarios, con el puerto cuando no es el estándar. Todos los enlaces que envía KANAP proceden de `APP_BASE_URL`. Defina `APP_ENV=production` cuando los usuarios accedan a KANAP por HTTPS: la API se niega entonces a arrancar sin estos dos valores y marca siempre la cookie de sesión como Secure. Consulte [Configuración](configuration.md#obligatorio-credenciales-de-administrador).

**Elección del correo:** los despliegues on-premise pueden usar **Resend** o **SMTP** para el correo saliente. SMTP es útil cuando el cliente ya tiene un relay de correo interno o un proveedor gestionado como Microsoft 365. Configure una de estas opciones si desea que el restablecimiento de contraseña, las invitaciones y los correos de notificación funcionen desde el primer día.

## Ejemplo de proxy inverso (nginx)

**Requisitos del proxy inverso:**

1. Terminar TLS en el puerto 443
2. Enrutar `/api/*` directamente al contenedor de la API (puerto 8080 en `127.0.0.1`), sin el prefijo `/api`. No envíe `/api/` a través del contenedor web (puerto 8081): su propia ruta `/api/` no transmite `X-Forwarded-For`, así que KANAP contaría y registraría cada solicitud con la dirección del contenedor web.
3. Enrutar todas las demás solicitudes al contenedor web (puerto 8081 en `127.0.0.1`)
4. Definir `X-Forwarded-Proto: https` y conservar `Host`. KANAP construye todos los enlaces que envía a partir de `APP_BASE_URL`. El ejemplo también envía `X-Forwarded-Host`, con el mismo valor que `Host`. Cuando el sitio usa un puerto no estándar, añada a `CORS_ORIGINS` la dirección exacta con su puerto.
5. Enviar `X-Forwarded-For` con la dirección del cliente (el ejemplo lo hace) y definir `RATE_LIMIT_TRUST_PROXY=true`. KANAP usa esa dirección para sus límites de inicio de sesión. El puerto de la API debe seguir vinculado a `127.0.0.1`, como hace `compose.onprem.yml`. Si no hay nada delante de la API, defina `RATE_LIMIT_TRUST_PROXY=false`.
6. Aceptar cuerpos de 50 MB (`client_max_body_size 50m`): los archivos de presupuesto llegan a 48 MB y los adjuntos a 20 MB.

Como los contenedores se vinculan a `127.0.0.1`, nginx se ejecuta en el mismo host y hace de proxy hacia `localhost`.

El archivo está escrito para nginx 1.25.1 y posteriores (Ubuntu 26.04 incluye la 1.28). Ubuntu 24.04 incluye nginx 1.24: en ese caso, escriba `listen 443 ssl http2;` y `listen [::]:443 ssl http2;` y elimine la línea `http2 on;`.

```nginx
server {
    # HTTP/2: el navegador envía las decenas de solicitudes de una página por una sola conexión.
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name kanap.company.com;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    # Límite de subida: archivos de presupuesto hasta 48 MB, adjuntos hasta 20 MB
    client_max_body_size 50m;

    # Normalizar /api → /api/
    location = /api { return 301 /api/; }

    # API: quitar el prefijo /api antes de reenviar
    location ^~ /api/ {
        proxy_pass http://127.0.0.1:8080/;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;

        # Comprimir las respuestas JSON y CSV de la API (una página de la lista de presupuesto se reduce unas 8 veces).
        # Las respuestas de IA en streaming (application/x-ndjson) quedan fuera a propósito.
        gzip on;
        gzip_proxied any;
        gzip_comp_level 5;
        gzip_min_length 1024;
        gzip_vary on;
        gzip_types application/json text/csv text/plain;

        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Solicitudes largas (exportaciones, importaciones)
        proxy_read_timeout  300s;
        proxy_send_timeout  300s;
        proxy_redirect off;
    }

    # Todo lo demás → SPA
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

    # Renovación del certificado con Let's Encrypt (webroot); inofensivo en otro caso
    location /.well-known/acme-challenge/ { root /var/www/html; }

    location / { return 301 https://$host$request_uri; }
}
```

**Compresión y HTTP/2:** el ejemplo comprime las respuestas de la API y activa HTTP/2. Mantenga ambos en su propio proxy: una página de la lista de presupuesto ocupa unos 390 KB de JSON sin comprimir y 47 KB comprimida. Si su nginx tiene el módulo brotli (`libnginx-mod-http-brotli-filter` en Debian y Ubuntu), `brotli on; brotli_types application/json text/csv text/plain;` en el mismo `location` comprime un poco mejor; gzip es suficiente.

**`host.docker.internal`:** cuando PostgreSQL o el almacenamiento S3 se ejecutan en el host Docker (fuera de un contenedor), use `host.docker.internal` como nombre de host en `DATABASE_URL` y `S3_ENDPOINT`. El archivo `compose.onprem.yml` incluye la asignación `extra_hosts` que lo hace posible. Apunta a la dirección del puente Docker del servidor (`172.17.0.1` por defecto), así que los servicios del host deben aceptar conexiones desde esa red (consulte el [ejemplo de instalación](installation-example.md)).

**Estado.** La API responde a `GET /health` en su propio puerto (`http://127.0.0.1:8080/health`) y a `GET /api/health` a través del proxy. Ambos devuelven `{"status":"ok"}`. `docker compose -f infra/compose.onprem.yml ps` muestra `healthy` para los contenedores `api` y `web` cuando responden.

## Arquitectura de red

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

**Modelo de despliegue:** un contenedor de API y un contenedor web. No se admite ejecutar varios contenedores de API o web. Para más usuarios simultáneos, ejecute varios procesos de API dentro del contenedor de la API con `API_WORKERS` (consulte [Configuración](configuration.md#opcional-capacidad-y-rendimiento)). Para la alta disponibilidad, confíe en las políticas de reinicio de Docker y en la redundancia de la infraestructura (alta disponibilidad de la base de datos, durabilidad de S3).

## Primer inicio de sesión

1. Abra `https://<su-nombre>`
2. Inicie sesión con `ADMIN_EMAIL` y `ADMIN_PASSWORD` de `.env`
3. **Cambie la contraseña del administrador** en su perfil si empezó con un valor que no desea conservar. La advertencia `[SECURITY]` del registro de la API desaparece cuando se cambia la contraseña (ver más abajo).
4. Añada su logotipo y sus colores en **Administración → Personalización** (opcional)
5. Invite a más usuarios (si el correo está configurado)

**Sobre la cuenta de administrador.** KANAP la crea en el primer arranque a partir de `ADMIN_EMAIL` y `ADMIN_PASSWORD`, y solo entonces. Cambiar esas dos líneas más tarde no cambia nada mientras exista un administrador activo: cambie la contraseña en la aplicación. Si no queda ningún administrador activo, el siguiente arranque restablece la cuenta `ADMIN_EMAIL` como administrador habilitado y conserva su contraseña actual. `ADMIN_PASSWORD` debe ser un valor propio de 12 caracteres o más: `openssl rand -base64 18` genera uno. Un valor de ejemplo o uno más corto hace que la API muestre una advertencia `[SECURITY]` en cada arranque hasta que se cambie la contraseña de la cuenta. Consulte [Configuración](configuration.md#obligatorio-credenciales-de-administrador).
