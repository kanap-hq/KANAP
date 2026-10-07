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

En el primer arranque, KANAP crea automáticamente un espacio de trabajo usando estos valores. Los valores predeterminados funcionan bien para la mayoría de despliegues — solo necesita cambiarlos si desea que un nombre de organización específico aparezca en la aplicación. Una instalación nueva recibe también el plan de cuentas IFRS predeterminado, definido como plan de cuentas predeterminado y plan de consolidación (actualizar una instalación existente no lo añade).

## Requerido: Credenciales de administrador

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `ADMIN_EMAIL` | Correo del usuario administrador inicial | `admin@empresa.com` |
| `ADMIN_PASSWORD` | Contraseña del administrador inicial (**cambie después del primer inicio de sesión**) | `CambieMe123!` |
| `JWT_SECRET` | Clave de firma JWT (generar: `openssl rand -hex 32`) | 64 caracteres hex |
| `APP_BASE_URL` | La dirección exacta con la que los usuarios abren KANAP: esquema, host y puerto cuando no es el estándar (base de todos los enlaces que envía KANAP) | `https://kanap.company.com` |
| `CORS_ORIGINS` | La dirección exacta con la que los usuarios abren KANAP, separada por comas si hay varias (orígenes de navegador autorizados a llamar a la API) | `https://kanap.company.com` |

**Dirección de la aplicación (`APP_BASE_URL`):** Los correos de restablecimiento de contraseña y de invitación, los correos de notificación, la redirección de inicio de sesión de Microsoft Entra y los enlaces de las exportaciones parten todos de `APP_BASE_URL`. Escriba la dirección exactamente como la teclean los usuarios, con el puerto cuando no sea 443 para HTTPS ni 80 para HTTP (por ejemplo `https://kanap.company.com:8443`). KANAP no lee las cabeceras `Host` ni `X-Forwarded-Host` de una solicitud para construir estos enlaces, salvo en un equipo de desarrollo local (`APP_ENV=development`). Sin `APP_BASE_URL`:

- el restablecimiento de contraseña, la invitación y el inicio de sesión con Microsoft Entra responden «application URL is not configured: set APP_BASE_URL»;
- los recordatorios programados se omiten, con una línea en el registro de la API.

**Orígenes de navegador autorizados (`CORS_ORIGINS`):** `CORS_ORIGINS` controla qué direcciones web pueden llamar a la API desde un navegador. Introduzca la dirección exacta: esquema, host y puerto cuando no sea el estándar.

```bash
# La misma dirección que APP_BASE_URL
CORS_ORIGINS=https://kanap.company.com
```

KANAP también acepta, sin ninguna entrada en `CORS_ORIGINS`:

- la dirección de la aplicación (`APP_BASE_URL`);
- la dirección de la propia solicitud: el host y el puerto de la dirección del navegador coinciden con la cabecera `Host` que llega a KANAP. Cuando su proxy inverso reenvía `Host` sin el puerto, cuenta el mismo nombre de host en cualquier puerto, salvo con `APP_ENV=production`. En producción, añada a `CORS_ORIGINS` la dirección exacta con su puerto.

Una solicitud desde cualquier otra dirección recibe una respuesta 403, y la API registra una línea `[CORS] Rejected origin` por dirección y por minuto. Las solicitudes de renovación de sesión y de cierre de sesión siguen la misma regla: una renovación o un cierre de sesión enviado desde una dirección no autorizada se rechaza con 403.

Un patrón como `https://*.company.com` sigue funcionando en una instalación de inquilino único. La API muestra una advertencia al arrancar, y una versión posterior aceptará solo direcciones exactas. Sustituya ya los patrones por la dirección exacta.

Si faltan tanto `CORS_ORIGINS` como la dirección de la aplicación (`APP_BASE_URL`) y `APP_ENV` no está definido, todos los orígenes siguen permitidos en esta versión, y la API muestra una advertencia al arrancar. Una versión posterior exigirá ambos.

## Opcional: Modo de ejecución (`APP_ENV`)

| Variable | Descripción | Predeterminado |
|----------|-------------|----------------|
| `APP_ENV` | Modo de ejecución de la API: `production`, `development` o sin definir | *sin definir* |

`APP_ENV` tiene tres estados:

| Estado | Valores | Qué cambia |
|--------|---------|------------|
| Producción | `production`, `prod` | La API se niega a arrancar sin `APP_BASE_URL` y `CORS_ORIGINS`. La cookie de sesión siempre se marca como Secure, por lo que solo funciona con HTTPS. |
| Desarrollo | `development`, `dev`, `local`, `test` | Comodidades de un equipo de desarrollo: los enlaces pueden seguir a un host de desarrollo local, se permiten todos los orígenes cuando `CORS_ORIGINS` está vacío y se acepta `PLATFORM_ADMIN_EMAILS=*`. No lo use en un servidor. |
| Sin especificar | cualquier otro valor, o sin `APP_ENV` | Las mismas reglas de enlaces y orígenes que en producción. Un `APP_BASE_URL` o `CORS_ORIGINS` ausente produce una advertencia al arrancar y la API arranca igualmente. La cookie de sesión sigue a la solicitud: Secure cuando la solicitud llega por HTTPS. |

Defina `APP_ENV=production` solo cuando los usuarios accedan a KANAP por HTTPS. Si `NODE_ENV` está definido y `APP_ENV` no, KANAP lee `NODE_ENV`.

**Validación al arrancar:** La aplicación se niega a arrancar si falta `JWT_SECRET` o `DATABASE_URL`, o está vacío, y, con `APP_ENV=production`, si falta `APP_BASE_URL` o `CORS_ORIGINS`. También se niega a funcionar si el rol de PostgreSQL de `DATABASE_URL` sigue siendo `SUPERUSER` o `BYPASSRLS`.

**Mensajes al arrancar:** El registro de la API muestra estas líneas al arrancar. Léalas después de cada cambio en el archivo `.env`.

| Línea | Significado |
|-------|-------------|
| `[ENV] run mode: ...` | Siempre se muestra. Indica el modo en que se ejecuta la API: `development`, `production` o `unspecified`. |
| `[ENV] APP_ENV is not set: production rules apply to links, browser origins and platform administration. Set APP_ENV=production (or development on a workstation).` | Se muestra en el modo sin especificar (el mensaje muestra el valor cuando `APP_ENV` tiene otro valor). Defina `APP_ENV=production` si los usuarios acceden a KANAP por HTTPS. |
| `[CONFIG] APP_BASE_URL is not set: ...` | Se rechazan los correos de restablecimiento de contraseña y de invitación, los enlaces de notificación y las redirecciones de inicio de sesión. Defina `APP_BASE_URL`. |
| `[CONFIG] APP_BASE_URL is not a valid http(s) address: ...` | El valor no es una dirección web. Escríbalo con `https://` o `http://`. |
| `[CORS] CORS_ORIGINS is not set: browsers are allowed only from APP_BASE_URL and from the address of each request. ...` | Defina `CORS_ORIGINS` con la dirección exacta que abren los usuarios. |
| `[CORS] CORS_ORIGINS and APP_BASE_URL are not set: browsers are still allowed from every origin in this version; ...` | Defina ambos. Una versión posterior permitirá solo las direcciones configuradas. |
| `[CORS] CORS_ORIGINS entry ... is a pattern: it is still accepted in this version. ...` | Sustituya el patrón por la dirección exacta. |

## Actualización: dirección de la aplicación y orígenes autorizados

Esta versión cambia la forma en que KANAP construye los enlaces y los orígenes de navegador que acepta. Antes de actualizar, revise su archivo `.env`:

1. Defina `APP_BASE_URL` con la dirección exacta que abren los usuarios (esquema, host y puerto cuando no sea el estándar). Es la única fuente de los enlaces de los correos, de las redirecciones de inicio de sesión y de las exportaciones. Las cabeceras de la solicitud ya no los modifican. Sin ella, el restablecimiento de contraseña, la invitación y el inicio de sesión con Microsoft Entra dejan de funcionar, y los recordatorios programados se omiten.
2. Ponga esa dirección exacta en `CORS_ORIGINS`, en lugar de cualquier patrón. Si su proxy no conserva la cabecera `Host`, o si la dirección usa un puerto no estándar, el origen exacto con su puerto es imprescindible.
3. Defina `APP_ENV=production` solo si los usuarios acceden a KANAP por HTTPS. La cookie de sesión lleva entonces siempre el atributo Secure y la API se niega a arrancar sin `APP_BASE_URL` y `CORS_ORIGINS`.
4. Después de actualizar, lea las líneas `[ENV]`, `[CONFIG]` y `[CORS]` del registro de la API y corrija cada advertencia.
5. Las solicitudes de renovación de sesión y de cierre de sesión desde una dirección no autorizada reciben ahora un 403, y `PLATFORM_ADMIN_EMAILS=*` solo se acepta si `APP_ENV` tiene un valor de desarrollo.

Otros cambios visibles:

- Si `APP_BASE_URL` empieza por `app.`, el inicio de sesión con Microsoft Entra y los enlaces de la base de conocimiento usan la dirección exactamente como está configurada.
- Sin `CORS_ORIGINS` ni dirección de la aplicación, y con `APP_ENV` sin definir, todavía no cambia nada: todos los orígenes siguen permitidos y la API muestra una advertencia.
- Sin `CORS_ORIGINS` pero con una dirección de la aplicación, fuera del desarrollo, solo se permiten la dirección de la aplicación y la dirección de la solicitud (antes: todos los orígenes).
- El correo de prueba del resumen semanal devuelve un error cuando no hay dirección de la aplicación configurada.

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
| `APP_URL` | Solo multi-inquilino (nube): tercera fuente de la dirección de la aplicación, después de `APP_BASE_URL` y `PUBLIC_APP_URL` (el slug del inquilino reemplaza `app`). **No necesario para local**: se usa `APP_BASE_URL`. | *sin definir* |
| `EMAIL_OVERRIDE` | Redirigir todos los correos a esta dirección (solo dev/QA, **nunca en producción**) | *sin establecer* |

## Opcional: Capacidad y rendimiento

Los valores predeterminados sirven para unas pocas decenas de usuarios. Para más usuarios a la vez, ejecute varios procesos de API y dimensione las conexiones a la base de datos.

| Variable | Descripción | Predeterminado |
|----------|-------------|---------|
| `API_WORKERS` | Número de procesos de API en el contenedor de API (1 a 16). Con más de uno, una solicitud que calcula ya no hace esperar a todos los demás. | `1` |
| `DB_POOL_MAX` | Conexiones a la base de datos por proceso de API (2 como mínimo: un valor menor se eleva a 2) | `20` |
| `SHUTDOWN_DRAIN_TIMEOUT_MS` | Al detenerse o actualizar, cuánto tiempo deja la API que terminen las solicitudes en curso, las notificaciones que iniciaron, los trabajos en segundo plano en curso y los correos en cola (milisegundos, como máximo 120000). El contenedor se detiene a los 30 s en cualquier caso. | `20000` |
| `OPS_METRICS_TOKEN` | Activa `GET /api/ops/metrics` para su herramienta de monitorización (24 caracteres o más, por ejemplo `openssl rand -hex 32`; un valor más corto lo deja deshabilitado y la API lo indica al iniciar). Consulte [Operaciones](operations.md#metricas-de-api-para-una-herramienta-de-monitorizacion). | *sin definir (deshabilitado)* |

**Qué cuesta cada uno.** Cada proceso de API usa unos 200 MB de memoria al iniciar y hasta 300 MB bajo carga (medido con 50 usuarios sobre 5.000 líneas de presupuesto); con varios procesos, un pequeño proceso supervisor añade unos 100 MB. Cada proceso de API puede abrir hasta `DB_POOL_MAX` conexiones a PostgreSQL. Para calcular:

- memoria: `API_WORKERS` × 0,4 GB para la API, más lo que use PostgreSQL si se ejecuta en el mismo servidor, más alrededor de 1 GB de margen (las compilaciones de imagen lo necesitan durante las actualizaciones);
- conexiones: `API_WORKERS` × `DB_POOL_MAX` debe quedar por debajo de `max_connections` de PostgreSQL (100 por defecto) menos unas 15. La API comprueba esto al iniciar y escribe un aviso en su registro cuando no cabe, con un valor que sí cabría.

**Valores sugeridos.**

| Usuarios trabajando a la vez | `API_WORKERS` | `DB_POOL_MAX` | Memoria del servidor (API + PostgreSQL) |
|---|---|---|---|
| Hasta 20 | 1 | 20 | 4 GB |
| 20 a 50 | 2 | 15 | 8 GB |
| 50 o más | 4 | 10 | 8 a 16 GB |

Medido con 5.000 líneas de presupuesto: con 10 usuarios, un proceso responde tan rápido como cuatro. Con 50 usuarios, abrir una línea tardó 237 ms (percentil 95) con un proceso, 142 ms con dos y 82 ms con cuatro, y el proceso único mantenía ocupadas todas sus conexiones a la base de datos.

Mantenga `API_WORKERS` igual o por debajo del número de núcleos de CPU que el servidor da a KANAP. Los cambios surten efecto al reiniciar el contenedor de API (`docker compose -f infra/compose.onprem.yml up -d api`).

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

# MODO DE EJECUCIÓN (opcional - production cuando los usuarios acceden a KANAP por HTTPS)
# APP_ENV=production

# URL DE LA APLICACIÓN (requerido - la dirección exacta que abren los usuarios)
APP_BASE_URL=https://kanap.su-dominio.com

# ORÍGENES DE NAVEGADOR AUTORIZADOS (requerido - la dirección exacta que abren los usuarios)
CORS_ORIGINS=https://kanap.su-dominio.com

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

# CAPACIDAD (opcional - ver «Capacidad y rendimiento»)
# API_WORKERS=1
# DB_POOL_MAX=20
# SHUTDOWN_DRAIN_TIMEOUT_MS=20000
# OPS_METRICS_TOKEN=
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
| `registry-1.docker.io`, `production.cloudflare.docker.com` | 443 | Descargar imágenes base Docker (`node:22-alpine`, `nginx:alpine`) |
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

Con varios procesos de API (`API_WORKERS`), cada trabajo sigue ejecutándose solo una vez por horario programado: los procesos se ponen de acuerdo a través de la base de datos sobre cuál lo ejecuta. Cuando la API se detiene (una actualización), un trabajo en curso recibe el tiempo de espera para terminar; uno que siga en curso en ese momento aparece como **Fallida** en la lista de tareas programadas y se ejecuta de nuevo en su próximo horario.

Estos trabajos requieren que la API se ejecute como un **proceso de larga duración** (no una función serverless). En modo local, se usa `APP_BASE_URL` para los enlaces de correo de notificaciones (sin derivación de subdominio). Si `APP_BASE_URL` no está definido, las alertas de vencimiento y los resúmenes semanales se omiten y la API escribe una línea en su registro («application URL is not configured»). Si no hay transporte de correo saliente configurado, estos trabajos omiten el envío de forma elegante.
