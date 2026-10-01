# Configuración local

Esta guía cubre las variables de entorno requeridas y opcionales para despliegues locales.
Una plantilla completa está disponible en `infra/.env.onprem.example`.

## Requerido: Modo de despliegue

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DEPLOYMENT_MODE` | **Debe ser `single-tenant`** para despliegues locales | `single-tenant` |

## Opcional: Identidad del espacio de trabajo

| Variable              | Requerido | Predeterminado    | Descripción                                                          |
| --------------------- | --------- | ----------------- | -------------------------------------------------------------------- |
| `DEFAULT_TENANT_SLUG` | No        | `default`         | Identificador interno del espacio de trabajo (seguro para URL, minúsculas) |
| `DEFAULT_TENANT_NAME` | No        | `My Organization` | Nombre de su organización, mostrado en el encabezado de la interfaz y los informes |

En el primer arranque, KANAP crea automáticamente un espacio de trabajo usando estos valores. Los valores predeterminados funcionan bien para la mayoría de despliegues — solo necesita cambiarlos si desea que un nombre de organización específico aparezca en la aplicación.

## Requerido: Credenciales de administrador

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `ADMIN_EMAIL` | Correo del usuario administrador inicial | `admin@empresa.com` |
| `ADMIN_PASSWORD` | Contraseña del administrador inicial (**cambie después del primer inicio de sesión**) | `CambieMe123!` |
| `JWT_SECRET` | Clave de firma JWT (generar: `openssl rand -hex 32`) | 64 caracteres hex |
| `APP_BASE_URL` | URL pública (usada en enlaces de correo) | `https://kanap.empresa.com` |
| `CORS_ORIGINS` | Orígenes de navegador permitidos separados por comas (**requerido en producción**) | `https://*.empresa.com` |

**Enlaces de correo:** Las URLs de restablecimiento de contraseña/invitación usan `APP_BASE_URL` (o host/proto reenviado). Los despliegues locales deben establecer `APP_BASE_URL` a la URL accesible externamente y configurar el proxy inverso para pasar `Host` / `X-Forwarded-Proto`.

**CORS:** Configure `CORS_ORIGINS` para controlar qué orígenes de navegador pueden acceder a la API. La aplicación **fallará al iniciar en producción** si `CORS_ORIGINS` no está establecido. Establézcalo a la URL exacta desde la que los usuarios acceden a KANAP.

```bash
# Coincidir con su APP_BASE_URL
CORS_ORIGINS=https://kanap.empresa.com
```

**Validación de inicio:** La aplicación rechazará iniciar si `JWT_SECRET`, `DATABASE_URL` o `APP_BASE_URL` faltan o están vacíos. También rechaza ejecutarse si el rol PostgreSQL de `DATABASE_URL` sigue siendo `SUPERUSER` o `BYPASSRLS`.

## Requerido: Base de datos

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | Cadena de conexión PostgreSQL | `postgres://user:pass@host:5432/kanap?sslmode=require` |

**Requisitos de base de datos:**
- PostgreSQL 16 o superior (mínimo probado; versiones anteriores pueden funcionar pero no son soportadas)
- Extensiones: `citext`, `pgcrypto`, `uuid-ossp`
- El usuario necesita permisos CREATE TABLE / ALTER TABLE para migraciones
- Recomendado: base de datos dedicada
- `DATABASE_URL` debe usar un rol de aplicación dedicado, no `postgres` u otro rol de administrador del clúster
- Recomendado: crear el rol de aplicación como `NOSUPERUSER NOBYPASSRLS` desde el inicio

**Configuración de base de datos (ejemplo):**

```sql
-- 1. Crear base de datos y rol de aplicación dedicado
CREATE DATABASE kanap;
CREATE USER kanap WITH PASSWORD 'contraseña-segura' NOSUPERUSER NOBYPASSRLS;
GRANT ALL PRIVILEGES ON DATABASE kanap TO kanap;

-- 2. Conectar a la base de datos kanap y habilitar extensiones
\c kanap
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 3. Otorgar permisos de esquema (para migraciones)
GRANT ALL ON SCHEMA public TO kanap;
```

Si un rol de aplicación dedicado fue creado inicialmente con demasiados privilegios, la primera migración de KANAP lo endurecerá automáticamente a `NOSUPERUSER NOBYPASSRLS`. Si `DATABASE_URL` apunta a un rol protegido de administrador del clúster como `postgres`, el inicio falla y debe cambiar a un rol de aplicación dedicado.

## Requerido: Almacenamiento

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `S3_ENDPOINT` | Endpoint compatible con S3 | `https://s3.amazonaws.com` |
| `S3_BUCKET` | Nombre del bucket (debe existir) | `kanap-files` |
| `S3_REGION` | Región | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | Clave de acceso | `AKIA...` |
| `AWS_SECRET_ACCESS_KEY` | Clave secreta | `secret` |
| `S3_FORCE_PATH_STYLE` | `true` para MinIO, `false` para AWS/R2 | `false` |

**Requisitos del bucket:**
- Cree el bucket antes de iniciar KANAP (no se crea automáticamente)
- Permisos: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket`

KANAP usa el cliente S3 del AWS SDK v3 para el acceso al almacenamiento de objetos; cualquier proveedor con comportamiento de API compatible con S3 es soportado.

**Proveedores probados:**
- AWS S3 (`S3_ENDPOINT=https://s3.amazonaws.com`, `S3_FORCE_PATH_STYLE=false`)
- MinIO (`S3_ENDPOINT=http://minio:9000`, `S3_FORCE_PATH_STYLE=true`)
- Cloudflare R2 (`https://<account>.r2.cloudflarestorage.com`)
- Hetzner (`https://<region>.your-objectstorage.com`)

## Opcional: Correo vía Resend

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `RESEND_API_KEY` | Clave API de Resend | `re_xxxxx` |
| `RESEND_FROM_EMAIL` | Dirección de origen | `KANAP <noreply@sudominio.com>` |

Si no está configurado, KANAP puede enviar correo a través de SMTP en despliegues de inquilino único. Si ni Resend ni SMTP están configurados, las funciones de correo están deshabilitadas, incluyendo invitaciones de usuarios y restablecimiento de contraseña. Consulte Operaciones para el respaldo de restablecimiento de contraseña por SQL.

## Opcional: Correo vía SMTP (solo inquilino único / local)

SMTP se soporta solo en `DEPLOYMENT_MODE=single-tenant`. Los despliegues multi-inquilino/en la nube continúan usando Resend.

| Variable        | Descripción                          | Ejemplo                       |
| --------------- | ------------------------------------ | ----------------------------- |
| `SMTP_HOST`     | Nombre de host del servidor SMTP     | `smtp.empresa.com`            |
| `SMTP_PORT`     | Puerto SMTP                          | `587`                         |
| `SMTP_USER`     | Nombre de usuario SMTP               | `kanap`                       |
| `SMTP_PASSWORD` | Contraseña SMTP                      | `secret`                      |
| `SMTP_FROM`     | Dirección de origen                  | `KANAP <noreply@empresa.com>` |
| `SMTP_SECURE`   | `true` para TLS implícito (465), `false` para STARTTLS/conexión plana (587/25) | `false` |

Notas:
- `SMTP_USER` y `SMTP_PASSWORD` son opcionales. Deje ambos sin establecer para relays que confían en el host/IP de origen.
- Si `SMTP_SECURE` no está establecido, KANAP usa `true` para el puerto `465` y `false` en caso contrario.
- Si tanto SMTP como Resend están configurados en modo de inquilino único, SMTP tiene precedencia.
- `SMTP_FROM` debe ser una dirección desde la que su servidor SMTP está autorizado a enviar.
- Si el correo se envía fuera de su red, configure SPF, DKIM y DMARC en el dominio del remitente a través de su administrador de correo o proveedor.

**Perfiles SMTP comunes**

Relay interno sin autenticación:

```env
SMTP_HOST=mail.empresa.local
SMTP_PORT=25
SMTP_SECURE=false
SMTP_FROM=KANAP <noreply@empresa.com>
```

Relay o proveedor autenticado:

```env
SMTP_HOST=smtp.empresa.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@empresa.com
SMTP_PASSWORD=secret
SMTP_FROM=KANAP <noreply@empresa.com>
```

Envío SMTP Microsoft 365:

```env
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@empresa.com
SMTP_PASSWORD=secret
SMTP_FROM=KANAP <noreply@empresa.com>
```

Use el perfil de Microsoft 365 solo si SMTP AUTH está permitido para el buzón e inquilino.

## Opcional: SSO Entra

Consulte la guía dedicada: [SSO con Microsoft Entra](sso-entra.md).

Cubre el registro de aplicación, los permisos delegados y de aplicación, y la sincronización diaria del directorio que actualiza los atributos de los usuarios y desactiva las cuentas eliminadas del directorio. La API necesita acceso de salida a `login.microsoftonline.com` y `graph.microsoft.com`.

## Opcional: Avanzado

| Variable | Descripción | Predeterminado |
|----------|-------------|---------------|
| `LOG_LEVEL` | Nivel de detalle de registros (`debug`, `info`, `warn`, `error`) | `info` |
| `JWT_ACCESS_TOKEN_TTL` | Tiempo de vida del token de acceso | `15m` |
| `JWT_REFRESH_TOKEN_TTL` | Tiempo de vida del token de refresco | `4h` |
| `RATE_LIMIT_ENABLED` | Alternador de limitación de tasa a nivel de aplicación | `true` |
| `RATE_LIMIT_TRUST_PROXY` | Confiar en cabeceras del proxy para detección de IP del cliente | `false` |
| `APP_URL` | URL base para enlaces de correo de notificaciones en modo multi-inquilino (el slug del inquilino reemplaza `app`). **No necesario para local** — se usa `APP_BASE_URL` en su lugar. | `https://app.kanap.net` |
| `EMAIL_OVERRIDE` | Redirigir todos los correos a esta dirección (solo dev/QA, **nunca en producción**) | *sin establecer* |

## Ejemplo completo (.env)

```bash
# =============================================================================
# Configuración local de KANAP
# =============================================================================

# MODO DE DESPLIEGUE (requerido)
DEPLOYMENT_MODE=single-tenant

# CONFIGURACIÓN DEL ESPACIO DE TRABAJO (opcional - se muestran los predeterminados)
DEFAULT_TENANT_SLUG=default
DEFAULT_TENANT_NAME=Mi Organización

# CREDENCIALES DE ADMINISTRADOR (requerido)
ADMIN_EMAIL=admin@empresa.com
ADMIN_PASSWORD=CambieEstaContraseña123!

# SEGURIDAD (requerido)
JWT_SECRET=

# URL DE LA APLICACIÓN (requerido)
APP_BASE_URL=https://kanap.su-dominio.com

# BASE DE DATOS (requerido - use un rol de aplicación dedicado, nunca postgres)
DATABASE_URL=postgres://kanap:contraseña@su-postgres:5432/kanap?sslmode=require

# ALMACENAMIENTO (requerido)
S3_ENDPOINT=https://s3.amazonaws.com
S3_BUCKET=kanap-files
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=false   # true para MinIO

# CORREO (opcional - Resend)
# RESEND_API_KEY=re_xxxxx
# RESEND_FROM_EMAIL=KANAP <noreply@sudominio.com>

# CORREO (opcional - SMTP, solo inquilino único)
# SMTP_HOST=smtp.empresa.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=
# SMTP_PASSWORD=
# SMTP_FROM=KANAP <noreply@empresa.com>

# AVANZADO (opcional - los predeterminados son correctos)
# LOG_LEVEL=info
# JWT_ACCESS_TOKEN_TTL=15m
# JWT_REFRESH_TOKEN_TTL=4h
# RATE_LIMIT_ENABLED=true
# RATE_LIMIT_TRUST_PROXY=false
```

## Reglas de firewall

Después de la construcción inicial, KANAP puede ejecutarse completamente aislado si las funciones de correo, SSO y tasas de cambio FX están deshabilitadas.

### Entrante

| Puerto | Protocolo | Propósito |
|--------|-----------|-----------|
| 443 | TCP | HTTPS — proxy inverso nginx sirviendo la aplicación |
| 80 | TCP | HTTP — redirige a HTTPS |

### Saliente — Configuración inicial y construcción

Estos destinos solo son necesarios durante la instalación y `docker build`. Pueden cerrarse una vez que la aplicación esté ejecutándose.

| Destino | Puerto | Propósito |
|---------|--------|-----------|
| `github.com` | 443 | Clonar código fuente de KANAP |
| `download.docker.com` | 443 | Repositorio APT de Docker |
| `dl.min.io` | 443 | Descarga del binario MinIO |
| `registry.npmjs.org` | 443 | Dependencias npm durante `docker build` |
| `registry-1.docker.io`, `production.cloudflare.docker.com` | 443 | Descargar imágenes base Docker (`node:20-alpine`, `nginx:alpine`) |
| Mirrors APT de Ubuntu | 80/443 | Paquetes del sistema (PostgreSQL, nginx, etc.) |

### Saliente — Tiempo de ejecución (condicional)

Solo requerido si la funcionalidad correspondiente está habilitada.

| Destino | Puerto | Propósito | Cuándo |
|---------|--------|-----------|--------|
| `api.resend.com` | 443 | Correo transaccional | Si `RESEND_API_KEY` está establecido |
| Su relay o proveedor SMTP | 25 / 465 / 587 | Correo transaccional vía SMTP | Si `SMTP_HOST` está establecido |
| `login.microsoftonline.com` | 443 | Metadatos y tokens de SSO Entra ID | Si SSO Entra está configurado |
| `graph.microsoft.com` | 443 | Enriquecimiento del perfil al iniciar sesión y sincronización diaria del directorio | Si SSO Entra está configurado |
| `api.worldbank.org` | 443 | Tasas FX anuales | Opcional |
| `v6.exchangerate-api.com` | 443 | Tasas FX spot | Opcional |

### Interno (sin regla de firewall necesaria)

Estas conexiones permanecen en el servidor — solo loopback o red bridge Docker.

| Conexión | Puerto | Notas |
|----------|--------|-------|
| nginx → Contenedor API | 8080 | Vinculado a `127.0.0.1` |
| nginx → Contenedor Web | 8081 | Vinculado a `127.0.0.1` |
| Contenedor API → PostgreSQL | 5432 | Vía `host.docker.internal` (bridge Docker `172.16.0.0/12`) |
| Contenedor API → MinIO | 9000 | Vía `host.docker.internal` |
| Consola MinIO | 9001 | Solo administración local, no expuesta externamente |

## Trabajos en segundo plano

El backend ejecuta trabajos programados en segundo plano para notificaciones por correo:
- **Alertas de vencimiento**: diariamente a las 08:00 UTC. Envía un correo a los responsables de contratos y partidas OPEX 30, 14, 7 y 1 día(s) antes de el plazo de cancelación de un contrato, la fecha de fin de un contrato o el fin de validez de una partida OPEX. Solo los reciben los usuarios que activaron las notificaciones de presupuesto y las alertas de vencimiento en su configuración de notificaciones. Cada recordatorio se envía una sola vez al día a cada destinatario, aunque el trabajo vuelva a ejecutarse ese día, por ejemplo tras un reinicio.
- **Resumen semanal**: verificación cada hora — envía resúmenes semanales conscientes de la zona horaria a los usuarios que han optado por recibirlos.

Hay un trabajo programado más que se ejecuta cuando el SSO Entra está configurado:

- **Sincronización del directorio de Microsoft Entra**: diariamente a las 03:00 hora del servidor — actualiza los atributos de los usuarios y desactiva las cuentas eliminadas o desactivadas en el directorio. Permanece inactiva hasta que un administrador de Microsoft Entra la apruebe. Consulte [SSO con Microsoft Entra](sso-entra.md).

Otro trabajo mantiene los estados al día:

- **`lifecycle-status-sync`**: cada hora, y una vez al iniciarse la API. Pasa a desactivado los datos maestros, los contratos y las partidas OPEX y CAPEX cuando su fin de validez ha pasado.

Estos trabajos requieren que la API se ejecute como un **proceso de larga duración** (no una función serverless). En modo local, se usa `APP_BASE_URL` para los enlaces de correo de notificaciones (sin derivación de subdominio). Si no hay transporte de correo saliente configurado, estos trabajos omiten el envío de forma elegante.
