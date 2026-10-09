# Configuración on-premise

Esta guía describe las variables de entorno de una instalación on-premise.
Hay una plantilla completa en `infra/.env.onprem.example`. Cópiela a `.env` en la raíz del repositorio y haga que solo su propietario pueda leerla (`chmod 600 .env`): contiene todos los secretos de la instalación.

Un cambio en `.env` se aplica cuando el contenedor de la API se vuelve a crear. Ejecute esto después de cada cambio:

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml up -d api
```

`docker compose -f infra/compose.onprem.yml restart api` conserva los valores anteriores.

## Obligatorio: modo de despliegue

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DEPLOYMENT_MODE` | **Debe ser `single-tenant`** en los despliegues on-premise | `single-tenant` |

Escriba el valor exactamente. Un valor mal escrito (`single_tenant`) arranca KANAP en modo nube sin ninguna advertencia.

## Opcional: identidad del espacio de trabajo

| Variable              | Obligatoria | Valor predeterminado | Descripción                                                  |
| --------------------- | -------- | ----------------- | --------------------------------------------------------------- |
| `DEFAULT_TENANT_SLUG` | No       | `default`         | Identificador interno del espacio de trabajo (apto para URL, en minúsculas) |
| `DEFAULT_TENANT_NAME` | No       | `My Organization` | El nombre de su organización: el texto alternativo del logotipo y el nombre que usa el asistente de IA |

En el primer arranque, KANAP crea un espacio de trabajo con estos valores. Los valores predeterminados sirven para la mayoría de los despliegues. Una instalación nueva recibe también el plan de cuentas IFRS predeterminado, definido como su plan predeterminado y de consolidación (actualizar una instalación existente no lo añade).

Defina ambos antes del primer arranque:

- Cambiar `DEFAULT_TENANT_SLUG` más tarde hace que KANAP cree un segundo espacio de trabajo vacío y sirva ese. El primer espacio de trabajo permanece en la base de datos, fuera de alcance.
- Cambiar `DEFAULT_TENANT_NAME` más tarde no tiene ningún efecto, y la aplicación no tiene ninguna página para cambiar el nombre de la organización. Defina el nombre antes del primer arranque.

Para dar a KANAP la imagen de su organización, añada su logotipo y sus colores en **Administración → Personalización**.

## Obligatorio: credenciales de administrador

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `ADMIN_EMAIL` | Correo de la primera cuenta de administrador | `admin@company.com` |
| `ADMIN_PASSWORD` | Contraseña de la primera cuenta de administrador. Use un valor propio de 12 caracteres o más (ver más abajo) | `ChangeMe123!` |
| `JWT_SECRET` | Clave de firma de los tokens de inicio de sesión. Genérela con `openssl rand -hex 32` (32 caracteres o más) | 64 caracteres hexadecimales |
| `APP_BASE_URL` | La dirección exacta en la que los usuarios abren KANAP: esquema, host y puerto cuando no es el estándar (se usa en todos los enlaces que envía KANAP) | `https://kanap.company.com` |
| `CORS_ORIGINS` | La dirección exacta en la que los usuarios abren KANAP, separadas por comas si hay varias (orígenes de navegador autorizados a llamar a la API) | `https://kanap.company.com` |

**Elija la contraseña del administrador.** El valor de ejemplo de la tabla es público. Sustitúyalo por un valor propio de 12 caracteres o más, por ejemplo la salida de `openssl rand -base64 18`. Un valor de ejemplo o uno más corto hace que la API muestre una advertencia `[SECURITY]` en cada arranque hasta que se cambie la contraseña de la cuenta. Un `JWT_SECRET` de menos de 32 caracteres también muestra una advertencia `[SECURITY]`.

**La cuenta de administrador se crea una sola vez.** KANAP lee `ADMIN_EMAIL` y `ADMIN_PASSWORD` en el primer arranque y crea la cuenta. Después:

- Cambiar cualquiera de las dos variables no cambia nada mientras exista un administrador activo. Cambie la contraseña en la aplicación (página del perfil, o **Contraseña olvidada** en la página de inicio de sesión).
- Si no queda ningún administrador activo (todos desactivados, o ninguno tiene el rol Administrador), el siguiente arranque restablece la cuenta `ADMIN_EMAIL` como administrador habilitado. Su contraseña actual se mantiene. Si la cuenta no existe, se crea con `ADMIN_PASSWORD`.
- Si `ADMIN_EMAIL` o `ADMIN_PASSWORD` está vacío, no se crea ninguna cuenta y el registro no dice nada al respecto.

**Dirección de la aplicación (`APP_BASE_URL`).** Los correos de restablecimiento de contraseña y de invitación, los correos de notificación, la redirección del inicio de sesión con Microsoft Entra y los enlaces de las exportaciones parten todos de `APP_BASE_URL`. Escriba la dirección exactamente como la escriben los usuarios, con el puerto cuando no es 443 para HTTPS u 80 para HTTP (por ejemplo `https://kanap.company.com:8443`). KANAP no lee las cabeceras `Host` ni `X-Forwarded-Host` de una solicitud para construir estos enlaces, salvo en una máquina de desarrollo local (`APP_ENV=development`). Sin `APP_BASE_URL`:

- el restablecimiento de contraseña, la invitación y el inicio de sesión con Microsoft Entra responden "application URL is not configured: set APP_BASE_URL";
- los recordatorios programados se omiten, con una línea en el registro de la API.

**Orígenes de navegador autorizados (`CORS_ORIGINS`).** `CORS_ORIGINS` controla qué direcciones web pueden llamar a la API desde un navegador. Indique la dirección exacta: esquema, host y puerto cuando no es el estándar.

```bash
# La misma dirección que APP_BASE_URL
CORS_ORIGINS=https://kanap.company.com
```

KANAP también acepta, sin ninguna entrada en `CORS_ORIGINS`:

- la dirección de la aplicación (`APP_BASE_URL`);
- la dirección de la propia solicitud: el host y el puerto de la dirección del navegador coinciden con la cabecera `Host` que llega a KANAP. Cuando su proxy inverso transmite `Host` sin el puerto, cuenta el mismo nombre de host en cualquier puerto, salvo con `APP_ENV=production`. En producción, añada a `CORS_ORIGINS` la dirección exacta con su puerto.

Una solicitud desde cualquier otra dirección recibe una respuesta 403 y la API registra una línea `[CORS] Rejected origin` por dirección y por minuto. Las solicitudes de renovación de sesión y de cierre de sesión siguen la misma regla: una renovación o un cierre de sesión enviados desde una dirección no autorizada se rechazan con 403.

Un patrón como `https://*.company.com` sigue funcionando en una instalación single-tenant. La API muestra una advertencia al arrancar, y una versión posterior solo aceptará direcciones exactas. Sustituya ya los patrones por la dirección exacta.

Si faltan a la vez `CORS_ORIGINS` y la dirección de la aplicación (`APP_BASE_URL`) y `APP_ENV` no está definido, en esta versión se siguen permitiendo todos los orígenes, y la API muestra una advertencia al arrancar. Una versión posterior los exigirá.

## Opcional: modo de ejecución (`APP_ENV`)

| Variable | Descripción | Valor predeterminado |
|----------|-------------|---------|
| `APP_ENV` | Modo de ejecución de la API: `production`, `development` o sin definir | *sin definir* |

`APP_ENV` tiene tres estados:

| Estado | Valores | Qué cambia |
|-------|--------|--------------|
| Producción | `production`, `prod` | La API se niega a arrancar sin `APP_BASE_URL` y `CORS_ORIGINS`. La cookie de sesión se marca siempre como Secure, así que solo funciona por HTTPS. |
| Desarrollo | `development`, `dev`, `local`, `test` | Facilidades para un puesto de trabajo: los enlaces pueden seguir un host de desarrollo local, se permiten todos los orígenes cuando `CORS_ORIGINS` está vacío y se acepta `PLATFORM_ADMIN_EMAILS=*`. No lo use en un servidor. |
| Sin especificar | cualquier otro valor, o sin `APP_ENV` | Las mismas reglas de enlaces y de orígenes que en producción. La falta de `APP_BASE_URL` o de `CORS_ORIGINS` produce una advertencia al arrancar y la API arranca igualmente. La cookie de sesión sigue a la solicitud: Secure cuando la solicitud llega por HTTPS. |

Defina `APP_ENV=production` cuando los usuarios accedan a KANAP por HTTPS, que es la configuración documentada. Si `NODE_ENV` está definido y `APP_ENV` no, KANAP lee `NODE_ENV` en su lugar.

**Comprobaciones al arrancar.** La API se niega a arrancar si `JWT_SECRET` o `DATABASE_URL` falta o está vacío y, con `APP_ENV=production`, si falta `APP_BASE_URL` o `CORS_ORIGINS`. También se niega a funcionar si el rol de PostgreSQL de `DATABASE_URL` es `SUPERUSER` o `BYPASSRLS`. Esta última comprobación se hace después de las migraciones, así que las migraciones ya se han ejecutado con ese rol cuando aparece el mensaje.

## Qué muestra el registro de la API al arrancar

Lea el registro de la API después de cada arranque y de cada cambio en `.env`:

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml logs --no-log-prefix api | grep -E '^\[|^Admin seeding|WARN|ERROR|successfully started|Email transport'
```

El filtro conserva las líneas siguientes y omite los detalles del framework. Sin él, `docker compose -f infra/compose.onprem.yml logs api` lo muestra todo.

**Orden.** Las líneas que escribe el propio KANAP (`[entrypoint]`, `[ENV]`, `[SECRETS]`, `[RATE-LIMIT]`, `[CORS]`, `[DB]`, `[on-prem]`, `[SECURITY]`) aparecen primero. Les siguen las líneas del framework (`Starting Nest application...`, correo, trabajos programados, `Nest application successfully started`). La línea `[DB] pool budget` aparece la última.

**Un primer arranque sin problemas** del [ejemplo de instalación](installation-example.md#7-compilar-e-iniciar) muestra estas líneas, en este orden (la primera línea `[SECRETS]` está abreviada aquí):

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

El bloque omite las líneas de migración: unas 40 líneas que empiezan por `[Migration]` o `[migration:` siguen a `Running migrations...`. Son informativas. En una base de datos nueva, algunas indican cambios en datos de referencia integrados o nombran un identificador de espacio de trabajo que no es el suyo: KANAP mantiene un espacio de trabajo del sistema para las funciones de la plataforma. No requieren ninguna acción. `...` representa el prefijo `[Nest]` con el identificador del proceso y la hora, y el origen entre corchetes (por ejemplo `LOG [NestApplication]`). Algunas de estas líneas terminan con una duración como `+0ms`. La última línea de la salida filtrada es `[DB] pool budget ...`. Un registro guardado en un archivo puede contener códigos de color como `[33m`.

El número de migraciones cambia de una versión a otra. En los arranques siguientes es `0 executed` (o el número de migraciones nuevas tras una actualización), y las cuatro líneas de creación `[on-prem]` dejan paso a `Administrator account ... left unchanged`. La línea del correo depende de su configuración: con un transporte de correo, dice `LOG [EmailService] Email transport selected: ...` en lugar de la advertencia.

**Líneas que conviene conocer.**

| Línea | Significado |
|------|---------|
| `[entrypoint] Migrations complete (N executed).` | La base de datos está al día. N es el número de migraciones ejecutadas en este arranque. |
| `[entrypoint] DB not ready or migration failed (attempt N): ... Retrying` | La API no puede llegar a la base de datos o no puede usarla. Lo intenta 30 veces, con 2 segundos de intervalo, y después se detiene. Compruebe `DATABASE_URL`, las reglas de PostgreSQL y `sslmode` (consulte [Obligatorio: base de datos](#obligatorio-base-de-datos)). |
| `[ENV] run mode: ...` | Se muestra siempre. Indica el modo en que se ejecuta la API: `development`, `production` o `unspecified`. |
| `[ENV] APP_ENV is not set: production rules apply to links, browser origins and platform administration. Set APP_ENV=production (or development on a workstation).` | Se muestra en modo sin especificar (el mensaje indica el valor cuando `APP_ENV` tiene otro valor). Defina `APP_ENV=production` si los usuarios acceden a KANAP por HTTPS. |
| `[CONFIG] APP_BASE_URL is not set: ...` | Se rechazan los correos de restablecimiento de contraseña y de invitación, los enlaces de las notificaciones y las redirecciones de inicio de sesión. Defina `APP_BASE_URL`. |
| `[CONFIG] APP_BASE_URL is not a valid http(s) address: ...` | El valor no es una dirección web. Escríbalo con `https://` o `http://`. |
| `[SECRETS] token families: ...` y `[SECRETS] Access tokens must carry purpose="access" ...` | Informativas. Indican de dónde procede cada clave de firma (nunca su valor). No hay nada que hacer. |
| `[RATE-LIMIT] Client address: ... (RATE_LIMIT_TRUST_PROXY=true)` | Informativa. Indica cómo obtiene KANAP la dirección del cliente. |
| `[RATE-LIMIT] Client address: ... (RATE_LIMIT_TRUST_PROXY not set, single-tenant default; ...)` | Una advertencia. `RATE_LIMIT_TRUST_PROXY` no está definido. Defínalo (consulte [Opcional: avanzado](#opcional-avanzado)). |
| `[CORS] Configured N origin pattern(s)` | Informativa. N es el número de entradas de `CORS_ORIGINS`. |
| `[CORS] CORS_ORIGINS is not set: browsers are allowed only from APP_BASE_URL and from the address of each request. ...` | Defina `CORS_ORIGINS` con la dirección exacta que abren los usuarios. |
| `[CORS] CORS_ORIGINS and APP_BASE_URL are not set: browsers are still allowed from every origin in this version; ...` | Defina ambos. Una versión posterior solo permitirá las direcciones configuradas. |
| `[CORS] CORS_ORIGINS entry ... is a pattern: it is still accepted in this version. ...` | Sustituya el patrón por la dirección exacta. |
| `[DB] Connected as PostgreSQL role "kanap" with native RLS enforcement` | Informativa. La API usa el rol de aplicación. |
| `Admin seeding disabled (set SEED_ADMIN=true to enable)` | Esperada on-premise. No hay nada que hacer: el administrador se crea a partir de `ADMIN_EMAIL` y `ADMIN_PASSWORD`. |
| `[on-prem] Default chart of accounts created`, `[on-prem] Created tenant '...'`, `[on-prem] Created administrator account ...`, `[on-prem] Created default subscription (On-Prem)` | Solo en el primer arranque. |
| `[on-prem] Administrator account ... left unchanged: the workspace has an active administrator` | Arranques siguientes. No hay nada que hacer. |
| `[on-prem] Restored ... as an enabled administrator: the workspace had no active administrator (password unchanged)` | Una advertencia. No quedaba ningún administrador activo, así que KANAP restableció la cuenta `ADMIN_EMAIL`. |
| `[SECURITY] JWT_SECRET is shorter than 32 characters. ...` | Defina un valor aleatorio más largo (`openssl rand -hex 32`) y vuelva a crear la API: todo el mundo vuelve a iniciar sesión y los enlaces de restablecimiento de contraseña pendientes dejan de funcionar. |
| `[SECURITY] The account of ADMIN_EMAIL still has the password from ADMIN_PASSWORD, which is an example value from the documentation or shorter than 12 characters. ...` | Cambie la contraseña del administrador en la aplicación, o siga [Restablecimiento de contraseña](operations.md#restablecimiento-de-contrasena). La línea desaparece cuando se cambia la contraseña. |
| `LOG [EmailService] Email transport selected: smtp (<host>:<port>, secure=false)` | El correo está activo, a través del relay SMTP indicado. `secure=true` significa TLS implícito (`SMTP_SECURE`). Con Resend, la línea termina con `selected: resend`. Para probarlo, consulte [Probar el correo](#probar-el-correo). |
| `WARN [EmailService] No outbound email transport configured; email sending is disabled.` | No hay ningún transporte de correo definido. Las invitaciones, el restablecimiento de contraseña y las notificaciones no envían nada. Consulte [Opcional: correo con SMTP](#opcional-correo-con-smtp-solo-single-tenant-on-premise). |
| `[DB] pool budget: ...` | Informativa. Una advertencia `pool budget exceeded` indica que `API_WORKERS` × `DB_POOL_MAX` es demasiado alto para el `max_connections` de PostgreSQL. |

## Actualizar una instalación anterior a la versión 26.10.1

La primera versión oficial, 26.10.1, cambia la forma en que KANAP construye los enlaces y los orígenes de navegador que acepta. Antes de actualizar una instalación más antigua, revise su archivo `.env`:

1. Defina `APP_BASE_URL` con la dirección exacta que abren los usuarios (esquema, host y puerto cuando no es el estándar). Es la única fuente de los enlaces de los correos, las redirecciones de inicio de sesión y las exportaciones. Las cabeceras de la solicitud ya no los modifican. Sin ella, el restablecimiento de contraseña, la invitación y el inicio de sesión con Microsoft Entra dejan de funcionar, y los recordatorios programados se omiten.
2. Ponga esa dirección exacta en `CORS_ORIGINS`, en lugar de cualquier patrón. Si su proxy no conserva la cabecera `Host`, o si la dirección usa un puerto no estándar, el origen exacto con su puerto es obligatorio.
3. Defina `APP_ENV=production` solo si los usuarios acceden a KANAP por HTTPS. La cookie de sesión lleva entonces siempre el atributo Secure y la API se niega a arrancar sin `APP_BASE_URL` y `CORS_ORIGINS`.
4. Tras la actualización, lea las líneas `[ENV]`, `[CONFIG]` y `[CORS]` del registro de la API y corrija cada advertencia.
5. Las solicitudes de renovación de sesión y de cierre de sesión desde una dirección no autorizada reciben ahora 403, y `PLATFORM_ADMIN_EMAILS=*` solo se acepta cuando `APP_ENV` tiene un valor de desarrollo.

Otros cambios visibles:

- Si `APP_BASE_URL` empieza por `app.`, el inicio de sesión con Microsoft Entra y los enlaces de la base de conocimiento usan la dirección exactamente como está configurada.
- Sin `CORS_ORIGINS` ni dirección de la aplicación, y con `APP_ENV` sin definir, todavía no cambia nada: se siguen permitiendo todos los orígenes y la API muestra una advertencia.
- Sin `CORS_ORIGINS` pero con una dirección de la aplicación, fuera del desarrollo, solo se permiten la dirección de la aplicación y la dirección de la solicitud (antes: todos los orígenes).
- El correo de prueba de la revisión semanal devuelve un error cuando no hay ninguna dirección de la aplicación configurada.

## Obligatorio: base de datos

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | Cadena de conexión de PostgreSQL | `postgres://kanap:<password>@host.docker.internal:5432/kanap?sslmode=disable` |

**Requisitos de la base de datos:**

- PostgreSQL 16 o superior (se prueban la 16 y la 18)
- Extensiones: `citext`, `pgcrypto`, `uuid-ossp`
- El usuario necesita permisos CREATE TABLE / ALTER TABLE para las migraciones
- Recomendado: base de datos dedicada
- `DATABASE_URL` debe usar un rol de aplicación dedicado
- Recomendado: crear el rol de aplicación como `NOSUPERUSER NOBYPASSRLS` desde el principio

**Preparación de la base de datos (ejemplo):**

```sql
-- 1. Crear la base de datos y el rol de aplicación dedicado
CREATE DATABASE kanap;
CREATE USER kanap WITH PASSWORD '<password>' NOSUPERUSER NOBYPASSRLS;
GRANT ALL PRIVILEGES ON DATABASE kanap TO kanap;

-- 2. Conectarse a la base de datos kanap y activar las extensiones
\c kanap
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 3. Conceder los permisos sobre el esquema (para las migraciones)
GRANT ALL ON SCHEMA public TO kanap;
```

Si un rol de aplicación dedicado se creó inicialmente con demasiados privilegios, la primera migración de KANAP lo restringe a `NOSUPERUSER NOBYPASSRLS`. Si `DATABASE_URL` apunta a un rol protegido de administración del clúster como `postgres`, el arranque falla y debe pasar a un rol de aplicación dedicado.

**La contraseña en la URL.** La contraseña forma parte de la URL. Una contraseña que contiene `@ : / # ?` o `%` rompe la URL si no codifica esos caracteres con porcentajes. Genere la contraseña con `openssl rand -hex 24`: las letras y las cifras no necesitan codificación. Lo mismo se aplica a cualquier secreto que ponga en una URL.

**Cifrado de la conexión (`sslmode`).** El final de la URL indica cómo se comunica la API con PostgreSQL:

| Valor | Úselo cuando |
|-------|-------------|
| `sslmode=disable` | PostgreSQL se ejecuta en el mismo servidor que KANAP (el ejemplo de instalación). El tráfico no sale del servidor. |
| `sslmode=require` | PostgreSQL es un servidor aparte o un servicio gestionado cuyo certificado procede de una autoridad pública. La API verifica el certificado. |
| `sslmode=no-verify` | La conexión está cifrada, pero la API no verifica el certificado. Úselo para un certificado privado o autofirmado. |

`require` verifica el certificado por completo. Un servidor con un certificado privado o autofirmado hace entonces que la API no arranque: lo intenta 30 veces y se detiene. Si la autoridad de su empresa firmó ese certificado, haga que la API confíe en la autoridad (consulte [Certificados de una autoridad interna](#opcional-certificados-de-una-autoridad-interna)) y mantenga `require`. En otro caso, use `no-verify`. Sin ningún `sslmode`, la conexión no está cifrada.

## Obligatorio: almacenamiento

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `S3_ENDPOINT` | Endpoint compatible con S3 | `https://s3.amazonaws.com` |
| `S3_BUCKET` | Nombre del bucket (debe existir) | `kanap-files` |
| `S3_REGION` | Región | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | Clave de acceso | `AKIA...` |
| `AWS_SECRET_ACCESS_KEY` | Clave secreta | `secret` |
| `S3_FORCE_PATH_STYLE` | `true` para RustFS, MinIO, Garage y la mayoría de los almacenamientos autoalojados; `false` para AWS S3 y Cloudflare R2 | `false` |

**Región.** Use `us-east-1` con RustFS. Un proveedor puede exigir su propia región (la que muestra en su consola). Con Garage, la región debe ser la definida en su configuración. Una región incorrecta produce errores como "Authorization header malformed".

**Requisitos del bucket:**

- Cree el bucket antes de arrancar KANAP (no se crea automáticamente). KANAP no lo comprueba al arrancar: un bucket que falta se manifiesta en la primera subida o descarga.
- KANAP llama a `PutObject`, `GetObject`, `HeadObject`, `DeleteObject` y `ListObjectsV2`, y construye enlaces `GET` prefirmados, todo en ese único bucket. Los permisos correspondientes son `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` y `s3:ListBucket`.

**Cifrado en reposo.** KANAP pide al almacenamiento que cifre cada subida (cifrado del lado del servidor `AES256`). Un almacenamiento que no lo admite hace que la API escriba la advertencia `PutObject fallback used: provider rejected explicit SSE header; upload retried without SSE request header` y guarde el archivo tal como se envió. RustFS acepta la solicitud cuando `RUSTFS_SSE_S3_MASTER_KEY` está definido, como hace el [ejemplo de instalación](installation-example.md#5-almacenamiento-de-objetos-rustfs). Guarde esa clave con la copia de seguridad de la configuración: los archivos cifrados con ella no pueden leerse sin ella.

KANAP usa el cliente S3 del AWS SDK v3; se admite cualquier proveedor con un comportamiento compatible con S3.

**Almacenamientos compatibles:**

- RustFS (`S3_ENDPOINT=http://host.docker.internal:9000`, `S3_FORCE_PATH_STYLE=true`), usado en el ejemplo de instalación
- AWS S3 (`S3_ENDPOINT=https://s3.amazonaws.com`, `S3_FORCE_PATH_STYLE=false`)
- Cloudflare R2 (`https://<account>.r2.cloudflarestorage.com`)
- Hetzner Object Storage (`https://<region>.your-objectstorage.com`)
- Garage (`S3_FORCE_PATH_STYLE=true`, región según su configuración)
- Un MinIO existente (`S3_FORCE_PATH_STYLE=true`). MinIO ya no publica nuevas descargas ni imágenes, así que las instalaciones nuevas usan otro almacenamiento. Una instalación que ya funciona con MinIO sigue funcionando con KANAP: no hay nada que cambiar.

## Opcional: correo con Resend

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `RESEND_API_KEY` | Clave API de Resend | `re_xxxxx` |
| `RESEND_FROM_EMAIL` | Dirección del remitente. Defínala con una dirección que su cuenta de Resend pueda usar como remitente: sin ella, el correo sale de una dirección de KANAP. | `KANAP <noreply@company.com>` |

Si no está configurado, KANAP puede enviar correo igualmente por SMTP en los despliegues single-tenant. Si no hay ni Resend ni SMTP configurados, las funciones de correo están desactivadas, incluidas las invitaciones de usuarios y el restablecimiento de contraseña. Consulte [Restablecimiento de contraseña](operations.md#restablecimiento-de-contrasena) para la alternativa.

## Opcional: correo con SMTP (solo single-tenant / on-premise)

SMTP solo se admite con `DEPLOYMENT_MODE=single-tenant`. Los despliegues multi-tenant/en la nube siguen usando Resend.

| Variable        | Descripción                          | Ejemplo                       |
| --------------- | ------------------------------------ | ----------------------------- |
| `SMTP_HOST`     | Nombre de host del servidor SMTP     | `smtp.company.com`            |
| `SMTP_PORT`     | Puerto SMTP                          | `587`                         |
| `SMTP_USER`     | Usuario SMTP                         | `kanap`                       |
| `SMTP_PASSWORD` | Contraseña SMTP                      | `secret`                      |
| `SMTP_FROM`     | Dirección del remitente              | `KANAP <noreply@company.com>` |
| `SMTP_SECURE`   | `true` para TLS implícito (465), `false` para STARTTLS o conexión sin cifrar (587/25) | `false` |

Notas:

- `SMTP_HOST` y `SMTP_FROM` son obligatorios los dos. Con solo uno de ellos, SMTP permanece desactivado.
- `SMTP_USER` y `SMTP_PASSWORD` van juntos: defina ambos, o deje ambos sin definir para los relays que confían en el host o la IP de origen. Definir solo uno impide que la API arranque.
- Si `SMTP_SECURE` no está definido, KANAP usa `true` para el puerto `465` y `false` en los demás casos.
- Si SMTP y Resend están configurados a la vez en modo single-tenant, SMTP tiene prioridad.
- `SMTP_FROM` debe ser una dirección que su servidor SMTP pueda usar como remitente.
- Un relay en el propio servidor de KANAP: defina `SMTP_HOST=host.docker.internal`, que es la forma en que el contenedor de la API llega al servidor. El relay debe escuchar en la dirección del puente Docker (`172.17.0.1` por defecto). Un relay instalado en el servidor también necesita una regla de cortafuegos que permita su puerto desde las redes Docker (ver el comando más abajo). Un relay que se ejecuta como contenedor Docker con un puerto publicado no la necesita.
- La dirección `172.17.0.1` solo existe cuando Docker está en marcha. Un relay instalado en el servidor que escucha en ella debe arrancar después de Docker, como hace el almacenamiento en el [ejemplo de instalación](installation-example.md#5-almacenamiento-de-objetos-rustfs). Con systemd, cree el archivo `/etc/systemd/system/<relay service>.service.d/override.conf` (con el nombre del servicio del relay en lugar de `<relay service>`) con dos líneas, `[Unit]` y después `After=docker.service`, y ejecute `sudo systemctl daemon-reload`.
- Un relay cuyo certificado TLS procede de la autoridad de su empresa necesita esa autoridad: consulte [Certificados de una autoridad interna](#opcional-certificados-de-una-autoridad-interna).
- Si el correo sale de su red, configure SPF, DKIM y DMARC en el dominio del remitente con su administrador de correo o su proveedor.

**Perfiles SMTP habituales**

Relay interno sin autenticación:

```env
SMTP_HOST=mail.company.local
SMTP_PORT=25
SMTP_SECURE=false
SMTP_FROM=KANAP <noreply@company.com>
```

Relay o proveedor con autenticación:

```env
SMTP_HOST=smtp.company.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@company.com
SMTP_PASSWORD=secret
SMTP_FROM=KANAP <noreply@company.com>
```

Envío SMTP de Microsoft 365:

```env
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@company.com
SMTP_PASSWORD=secret
SMTP_FROM=KANAP <noreply@company.com>
```

Use el perfil de Microsoft 365 solo si SMTP AUTH está permitido para el buzón y para el inquilino.

**Un relay en el servidor de KANAP.** Permita que el contenedor de la API llegue a él. Indique el puerto de su relay en la primera línea:

```bash
SMTP_PORT=25   # el SMTP_PORT de .env
sudo ufw allow from 172.16.0.0/12 to any port "$SMTP_PORT" proto tcp
```

Esta regla es para un relay instalado en el servidor. Un relay que se ejecuta en un contenedor Docker con un puerto publicado no necesita ninguna regla: Docker publica sus puertos al margen de `ufw`.

### Probar el correo

Después de cambiar la configuración del correo, vuelva a crear la API (`docker compose -f infra/compose.onprem.yml up -d api`). El registro de la API muestra entonces `Email transport selected` (consulte [Qué muestra el registro de la API al arrancar](#que-muestra-el-registro-de-la-api-al-arrancar)). Para enviar un mensaje de prueba, abra la página de inicio de sesión, elija **Contraseña olvidada** e introduzca el correo de una cuenta existente que inicie sesión con contraseña. El mensaje llega con un enlace que empieza por su `APP_BASE_URL`. Las cuentas que inician sesión con Microsoft Entra no reciben ningún mensaje de restablecimiento.

Cuando el envío falla, el mensaje no llega y el registro de la API contiene una línea `ERROR` con el motivo. Para un relay cuyo certificado no reconoce la API, el motivo es `unable to verify the first certificate` (o `self-signed certificate`) y el código es `ESOCKET`. La API no confía en la autoridad que firmó el certificado del relay: consulte [Certificados de una autoridad interna](#opcional-certificados-de-una-autoridad-interna). Instalar la autoridad en el propio servidor no cambia nada en el contenedor.

## Opcional: certificados de una autoridad interna

La API verifica el certificado de cada servidor al que se conecta por TLS. Su relay SMTP, un servidor PostgreSQL con `sslmode=require` o un almacenamiento S3 por HTTPS pueden usar un certificado firmado por la autoridad propia de su empresa. La API rechaza entonces la conexión hasta que confíe en esa autoridad. Entréguele el certificado de la autoridad, como archivo PEM:

```bash
cd /opt/kanap
cp /path/to/company-ca.pem infra/certs/company-ca.pem
chmod 644 infra/certs/company-ca.pem
echo 'NODE_EXTRA_CA_CERTS=/etc/kanap/certs/company-ca.pem' >> .env
docker compose -f infra/compose.onprem.yml up -d api
```

- El archivo contiene la autoridad raíz, seguida de las autoridades intermedias cuando sus servidores no las envían. Ponga solo certificados, ninguna clave privada.
- El modo `644` permite que la API lea el archivo. El certificado de una autoridad es público.
- Git ignora los archivos de `infra/certs/`, así que una actualización los deja en su sitio.
- Su autoridad se añade a las públicas: las conexiones a los servicios públicos siguen funcionando.

Compruebe que la API lee el archivo:

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml exec -T api node -e 'require("tls").createSecureContext()' </dev/null
```

El comando no muestra nada cuando todo está bien. Una línea que empieza por `Warning: Ignoring extra certs from` indica que la API no puede leer el archivo: compruebe la ruta en `.env`, el nombre del archivo y su modo. El registro de la API muestra la misma línea después de su primera conexión TLS.

## Opcional: SSO con Entra

Consulte la guía dedicada: [SSO con Microsoft Entra](sso-entra.md).

Trata el registro de la aplicación, los permisos delegados y de aplicación, y la sincronización diaria del directorio, que actualiza los atributos de los usuarios y desactiva las cuentas eliminadas del directorio. Las variables son `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_AUTHORITY` y `ENTRA_REDIRECT_URI`; las cuatro son necesarias. La API necesita acceso saliente a `login.microsoftonline.com` y `graph.microsoft.com`.

## Opcional: funciones de IA

Todas las funciones de IA están desactivadas por defecto en una instalación on-premise. Tres interruptores las activan, y un secreto permite a KANAP guardar las claves de su proveedor de IA.

| Variable | Descripción | Valor predeterminado |
|----------|-------------|---------|
| `AI_CHAT_ENABLED` | Activa el [asistente de chat Plaid](../ai-assistant.md) para la instalación. | `false` |
| `AI_MCP_ENABLED` | Activa el acceso MCP y las claves API de IA. | `false` |
| `AI_SETTINGS_ENABLED` | Abre **Administración → Inteligencia artificial** (modelos IA, configuración de Plaid) y los [agentes](../agents-overview.md) a los administradores. Sin ella, nadie puede configurar un proveedor. | `false` |
| `AI_SETTINGS_ENCRYPTION_SECRET` | Secreto que cifra las claves de proveedor que introduce en KANAP. Genérelo con `openssl rand -hex 32`. | *sin definir* |

Notas:

- Sin `AI_SETTINGS_ENCRYPTION_SECRET`, KANAP se niega a guardar una clave de proveedor ("AI secret storage is not configured on this instance").
- Cambiar `AI_SETTINGS_ENCRYPTION_SECRET` más tarde hace ilegibles las claves guardadas. Guárdelo con `.env` y vuelva a introducir las claves si lo pierde.
- Una instalación on-premise no incluye ningún modelo: usted añade su propio proveedor o servidor de modelos en **Administración → Inteligencia artificial → Modelos IA**. Consulte [Modelos IA](../ai-models.md) y [Configuración de Plaid](../ai-settings.md). Cada espacio de trabajo tiene también allí sus propios interruptores.
- La API necesita acceso saliente al proveedor que elija (consulte [Reglas de cortafuegos](#reglas-de-cortafuegos)).

## Opcional: avanzado

| Variable | Descripción | Valor predeterminado |
|----------|-------------|---------|
| `RATE_LIMIT_TRUST_PROXY` | Cómo obtiene KANAP la dirección del cliente para sus límites de inicio de sesión y de solicitudes. `true`: un proxy inverso está delante de la API y envía `X-Forwarded-For` (el nginx de esta guía). `false`: no hay nada delante, se usa la dirección de la conexión. `1` a `3`: ese número de proxies en cadena. | Sin definir en single-tenant equivale a un proxy de confianza, con una advertencia `[RATE-LIMIT]` en cada arranque. Defínalo explícitamente. |
| `RATE_LIMIT_ENABLED` | Activa o desactiva la limitación de solicitudes de la aplicación | `true` |
| `JWT_ACCESS_TOKEN_TTL` | Duración del token de acceso: un número seguido de `s`, `m`, `h` o `d`. Cualquier otro formato equivale a 15 minutos. | `15m` |
| `JWT_REFRESH_TOKEN_TTL` | Duración del token de renovación, mismo formato. Cualquier otro formato equivale a 15 minutos. | `4h` |
| `PASSWORD_RESET_TTL` | Duración de un enlace de restablecimiento de contraseña: un número de segundos o una duración como `30m` o `2h`. | `1h` |
| `LOG_LEVEL` | `debug` o `verbose` añade al registro los detalles de cada ejecución de trabajo programado. Cualquier otro valor no cambia nada. | *sin definir* |
| `INTEGRATED_DOCS_AUTO_ROLLOUT` | Repara, al arrancar, los documentos vinculados a solicitudes y proyectos. Desactivado on-premise salvo que lo defina: `if-needed` solo ejecuta la reparación cuando los recuentos difieren, `always` en cada arranque. | *desactivado* |
| `APP_URL` | Solo multi-tenant (nube). **No se necesita on-premise**: se usa `APP_BASE_URL`. | *sin definir* |
| `EMAIL_OVERRIDE` | Redirige todos los correos a esta dirección (solo desarrollo/QA, **nunca en producción**) | *sin definir* |

**Dirección del cliente.** Con la configuración documentada (nginx en el mismo servidor, puerto de la API vinculado a `127.0.0.1`), defina `RATE_LIMIT_TRUST_PROXY=true`. El proxy debe enviar `X-Forwarded-For`; el ejemplo de nginx lo hace. Defina `false` cuando no haya nada delante de la API. Un valor incorrecto da a todos los usuarios la misma dirección, así que los 5 intentos de inicio de sesión por minuto se comparten entre todos.

## Opcional: capacidad y rendimiento

Los valores predeterminados sirven para unas pocas decenas de usuarios. Para más usuarios simultáneos, ejecute varios procesos de API y dimensione las conexiones a la base de datos.

| Variable | Descripción | Valor predeterminado |
|----------|-------------|---------|
| `API_WORKERS` | Número de procesos de API en el contenedor de la API (de 1 a 16). Con más de uno, una solicitud que hace cálculos ya no hace esperar a los demás. | `1` |
| `DB_POOL_MAX` | Conexiones a la base de datos por proceso de API (2 como mínimo: un valor inferior se eleva a 2) | `20` |
| `SHUTDOWN_DRAIN_TIMEOUT_MS` | Al detener o actualizar, el tiempo que la API deja para terminar las solicitudes en curso, las notificaciones que iniciaron, los trabajos en segundo plano en ejecución y los correos en cola (milisegundos, 120000 como máximo). El contenedor se detiene a los 30 s en cualquier caso. | `20000` |
| `OPS_METRICS_TOKEN` | Activa `GET /api/ops/metrics` para su herramienta de monitorización (24 caracteres o más, por ejemplo `openssl rand -hex 32`; un valor más corto la deja desactivada y la API lo indica al arrancar). Consulte [Operaciones](operations.md#metricas-de-la-api-para-una-herramienta-de-monitorizacion). | *sin definir (desactivado)* |

**Lo que cuesta cada uno.** Cada proceso de API usa unos 200 MB de memoria al arrancar y hasta 300 MB bajo carga (medido con 50 usuarios sobre 5000 líneas de presupuesto); con varios, un pequeño proceso supervisor añade unos 100 MB. Cada proceso de API puede abrir hasta `DB_POOL_MAX` conexiones a PostgreSQL. Calcule:

- memoria: `API_WORKERS` × 0,4 GB para la API, más lo que use PostgreSQL si se ejecuta en el mismo servidor, más margen para la compilación de las imágenes en cada actualización. 6 GB es el mínimo para cualquier servidor. En una instalación nueva con PostgreSQL y el almacenamiento en marcha, compilar las dos imágenes a la vez ocupó unos 3,8 GB en total en su punto máximo (unos 3,2 GB para la propia compilación), así que 6 GB dejan unos 2 GB libres;
- conexiones: `API_WORKERS` × `DB_POOL_MAX` debe quedar por debajo del `max_connections` de PostgreSQL (100 por defecto) menos unas 15. La API lo comprueba al arrancar y escribe una advertencia en su registro cuando no cabe, con un valor que sí cabría.

**Valores sugeridos.**

| Usuarios trabajando a la vez | `API_WORKERS` | `DB_POOL_MAX` | Memoria del servidor (API + PostgreSQL) |
|---|---|---|---|
| Hasta 20 | 1 | 20 | 6 GB |
| De 20 a 50 | 2 | 15 | 8 GB |
| 50 o más | 4 | 10 | De 8 a 16 GB |

Medido sobre 5000 líneas de presupuesto: con 10 usuarios, un proceso responde tan rápido como cuatro. Con 50 usuarios, abrir una línea tardó 237 ms (percentil 95) con un proceso, 142 ms con dos y 82 ms con cuatro, y un solo proceso mantenía ocupadas todas sus conexiones a la base de datos.

Mantenga `API_WORKERS` igual o por debajo del número de núcleos de CPU que el servidor asigna a KANAP. Los cambios se aplican cuando el contenedor de la API se vuelve a crear (`docker compose -f infra/compose.onprem.yml up -d api`).

## Ejemplo completo (.env)

```bash
# =============================================================================
# Configuración on-premise de KANAP
# =============================================================================

# MODO DE DESPLIEGUE (obligatorio)
DEPLOYMENT_MODE=single-tenant

# ESPACIO DE TRABAJO (opcional - se muestran los valores predeterminados; definir antes del primer arranque)
DEFAULT_TENANT_SLUG=default
DEFAULT_TENANT_NAME=My Organization

# CREDENCIALES DE ADMINISTRADOR (obligatorio - leídas solo en el primer arranque)
# Sustituya la contraseña de ejemplo por un valor propio de 12 caracteres o más.
ADMIN_EMAIL=admin@company.com
ADMIN_PASSWORD=ChangeThisPassword123!

# SEGURIDAD (obligatorio)
JWT_SECRET=

# MODO DE EJECUCIÓN (production cuando los usuarios acceden a KANAP por HTTPS)
APP_ENV=production

# URL DE LA APLICACIÓN (obligatorio - la dirección exacta que abren los usuarios)
APP_BASE_URL=https://kanap.company.com

# ORÍGENES DE NAVEGADOR AUTORIZADOS (obligatorio - la dirección exacta que abren los usuarios)
CORS_ORIGINS=https://kanap.company.com

# DIRECCIÓN DEL CLIENTE (un proxy inverso delante de la API)
RATE_LIMIT_TRUST_PROXY=true

# BASE DE DATOS (obligatorio - un rol de aplicación dedicado, no postgres)
# sslmode: disable (mismo servidor), require (certificado público), no-verify (certificado privado)
DATABASE_URL=postgres://kanap:password@your-postgres:5432/kanap?sslmode=require

# ALMACENAMIENTO (obligatorio)
S3_ENDPOINT=https://s3.amazonaws.com
S3_BUCKET=kanap-files
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
# true para RustFS, MinIO, Garage; false para AWS S3 y R2
S3_FORCE_PATH_STYLE=false

# CORREO (opcional - Resend)
# RESEND_API_KEY=re_xxxxx
# RESEND_FROM_EMAIL=KANAP <noreply@company.com>

# CORREO (opcional - SMTP, solo single-tenant)
# SMTP_HOST=smtp.company.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=
# SMTP_PASSWORD=
# SMTP_FROM=KANAP <noreply@company.com>

# SSO (opcional - Microsoft Entra ID, las cuatro juntas)
# ENTRA_CLIENT_ID=
# ENTRA_CLIENT_SECRET=
# ENTRA_AUTHORITY=https://login.microsoftonline.com/<tenant-id>
# ENTRA_REDIRECT_URI=https://kanap.company.com/api/auth/entra/callback

# IA (opcional - desactivada por defecto)
# AI_CHAT_ENABLED=false
# AI_MCP_ENABLED=false
# AI_SETTINGS_ENABLED=false
# AI_SETTINGS_ENCRYPTION_SECRET=

# AVANZADO (opcional - los valores predeterminados son adecuados)
# JWT_ACCESS_TOKEN_TTL=15m
# JWT_REFRESH_TOKEN_TTL=4h
# PASSWORD_RESET_TTL=1h
# RATE_LIMIT_ENABLED=true

# CAPACIDAD (opcional - ver "Capacidad y rendimiento")
# API_WORKERS=1
# DB_POOL_MAX=20
# SHUTDOWN_DRAIN_TIMEOUT_MS=20000
# OPS_METRICS_TOKEN=
```

## Reglas de cortafuegos

Tras la compilación inicial, KANAP puede funcionar completamente aislado de la red si las funciones de correo, SSO, IA y tipos de cambio están todas desactivadas.

### Entrante

| Puerto | Protocolo | Uso |
|------|----------|---------|
| 443 | TCP | HTTPS: proxy inverso nginx que sirve la aplicación |
| 80 | TCP | HTTP: redirige a HTTPS (y responde a las renovaciones de certificado cuando usa Let's Encrypt) |
| 22 | TCP | SSH, para la administración. Permítalo antes de activar un cortafuegos |

Nada más necesita ser accesible desde la red. En particular, PostgreSQL (5432) y el almacenamiento de objetos (9000) son solo para las redes Docker del servidor.

### Saliente: instalación inicial y compilación

Estos destinos son necesarios en la instalación, en cada actualización y en cada vuelta atrás (`docker build`), y la primera vez que se ejecuta la prueba de humo. Pueden cerrarse entre esas operaciones.

| Destino | Puerto | Uso |
|-------------|------|---------|
| `github.com`, `*.githubusercontent.com` | 443 | Clonar el código fuente de KANAP; descargar los archivos de las versiones de RustFS (el ejemplo de instalación) |
| `download.docker.com` | 443 | Repositorio APT de Docker |
| `registry.npmjs.org` | 443 | Dependencias npm durante `docker build` |
| `registry-1.docker.io`, `auth.docker.io` | 443 | Descargar las imágenes Docker base (`node:24-alpine`, `nginx:alpine`) y la imagen de la prueba de humo (`node:24-alpine`) la primera vez que se ejecuta la prueba. Cada descarga obtiene primero un token de `auth.docker.io` |
| `production.cloudflare.docker.com`, `production.cloudfront.docker.com` | 443 | Descargar las capas de las imágenes: Docker Hub redirige cada descarga a estos hosts |
| `dl-cdn.alpinelinux.org` | 80/443 | Paquetes Alpine durante `docker build` (las dos imágenes instalan paquetes con `apk add`) |
| Réplicas APT de Ubuntu | 80/443 | Paquetes del sistema (PostgreSQL, nginx, etc.) |
| `acme-v02.api.letsencrypt.org` | 443 | Certificados, solo con Let's Encrypt (también en cada renovación) |

Docker puede cambiar los hosts de descarga de Docker Hub. Docker mantiene la lista actual en su [lista de permitidos](https://docs.docker.com/desktop/enterprise/allow-list/). Una descarga usa dos filas de esa página: "Docker Pull/Push" (`registry-1.docker.io`, `production.cloudfront.docker.com`) y "Authentication" (`auth.docker.io`). Estas filas se aplican también a un servidor con Docker Engine.

### Saliente: ejecución (condicional)

Solo es necesario si la función correspondiente está activada.

| Destino | Puerto | Uso | Cuándo |
|-------------|------|---------|------|
| `api.resend.com` | 443 | Correo transaccional | Si `RESEND_API_KEY` está definido |
| Su relay o proveedor SMTP | 25 / 465 / 587 | Correo transaccional por SMTP | Si `SMTP_HOST` está definido |
| `login.microsoftonline.com` | 443 | Metadatos y tokens del SSO con Entra ID | Si el SSO con Entra está configurado |
| `graph.microsoft.com` | 443 | Enriquecimiento del perfil al iniciar sesión y sincronización diaria del directorio | Si el SSO con Entra está configurado |
| El proveedor de IA que configure (o su propio servidor de modelos) | 443 o el puerto de su servidor | Chat, agentes | Si las funciones de IA están activadas y hay un modelo configurado |
| `api.worldbank.org` | 443 | Tipos de cambio anuales | Opcional |
| `open.er-api.com` | 443 | Tipos de cambio al contado | Opcional |

### Interno (ninguna regla de cortafuegos necesaria desde fuera)

Estas conexiones no salen del servidor: loopback o las redes Docker.

| Conexión | Puerto | Notas |
|------------|------|-------|
| nginx → contenedor de la API | 8080 | Vinculado a `127.0.0.1` |
| nginx → contenedor web | 8081 | Vinculado a `127.0.0.1` |
| Contenedor de la API → PostgreSQL | 5432 | Mediante `host.docker.internal`, que es la dirección del puente Docker del servidor (`172.17.0.1` por defecto). Permítalo solo desde las redes Docker (`172.16.0.0/12`). |
| Contenedor de la API → almacenamiento de objetos | 9000 | Mismo camino. En el ejemplo de instalación, el almacenamiento escucha únicamente en `172.17.0.1`. |
| Contenedor de la API → relay de correo en el servidor | Su `SMTP_PORT` | Solo cuando el relay se ejecuta en el servidor de KANAP. Mismo camino: el relay escucha en `172.17.0.1`, y la regla permite su puerto desde `172.16.0.0/12`. |

Por defecto, Docker asigna a sus 15 primeras redes rangos dentro de `172.16.0.0/12` (`172.17.0.0/16` a `172.31.0.0/16`), y después bloques `/20` de `192.168.0.0/16`. En un servidor nuevo, los contenedores de KANAP usan `172.18.0.0/16`. Un servidor que ya tiene muchas redes Docker puede colocarlos en `192.168.x.x`, fuera de estas reglas. Tras el primer arranque, `docker network inspect infra_default` muestra su subred. Si está fuera de `172.16.0.0/12`, añádala a las reglas de cortafuegos y a la línea de `pg_hba.conf` de PostgreSQL. La misma subred permite también una regla más restrictiva.

## Trabajos en segundo plano

La API ejecuta 15 trabajos programados. Las horas siguientes son los valores predeterminados, en UTC (el reloj del contenedor de la API). Los administradores ven los trabajos en **Administración → Tareas programadas** (consulte [Tareas programadas](../scheduled-tasks.md)), donde cada uno puede desactivarse, reprogramarse o ejecutarse bajo demanda.

| Trabajo | Cuándo | Qué hace |
|-----|------|--------------|
| `check-expirations` | Diario 08:00 | Envía un correo a los responsables de contratos y partidas OPEX 30, 14, 7 y 1 día(s) antes de una fecha límite de cancelación, una fecha de fin o el fin de validez. Solo los reciben los usuarios que activaron estas notificaciones, una vez al día. |
| `send-weekly-reviews` | Cada hora | Envía el resumen de la revisión semanal a los usuarios que lo activaron, en su propio día y zona horaria. |
| `lifecycle-status-sync` | Cada hora, y una vez al arrancar | Pasa a desactivados los datos maestros, contratos y partidas OPEX y CAPEX cuyo fin de validez ha pasado. |
| `entra-directory-sync` | Diario 03:00 | Actualiza los atributos de los usuarios y desactiva las cuentas eliminadas o desactivadas en el directorio. Solo funciona cuando el SSO con Entra está conectado y aprobado. Consulte [SSO con Microsoft Entra](sso-entra.md). |
| `attachment-orphan-cleanup` | Diario 03:00 | Elimina los registros de adjuntos de imágenes insertadas que ya no usa ningún texto. |
| `storage-ghost-cleanup` | Domingo 04:00 | Elimina los archivos almacenados que no tienen registro de adjunto y tienen más de 7 días. |
| `list-context-purge` | Diario 03:30 | Elimina los filtros de lista guardados que nadie ha usado en 90 días. |
| `auth-event-retention` | Diario 03:40 | Elimina del registro de auditoría los eventos de inicio de sesión de más de 365 días. |
| `ai-conversation-retention` | Diario 02:00 | Archiva y purga las conversaciones de IA según la configuración de conservación. |
| `ai-search-index-reindex` | Diario 03:00 | Reconstruye el índice de búsqueda que usan las funciones de IA. |
| `ai-agent-activity-retention-purge` | Diario 03:25 | Elimina la actividad de los agentes más antigua que el periodo de conservación de cada agente. |
| `ai-mutation-preview-expiration` | Cada 5 minutos | Caduca las vistas previas de cambios de IA que nadie aprobó a tiempo. |
| `ai-helpdesk-glpi-new-ticket-ingestion` | Cada 5 minutos | Lee los nuevos tickets de GLPI para el agente del centro de servicios. |
| `ai-sre-monitoring-alert-ingestion` | Cada 5 minutos | Lee las nuevas alertas de la herramienta de monitorización conectada para el agente SRE. |
| `netbox-inventory-sync` | Cada hora | Mantiene los activos alineados con el inventario Netbox conectado. |

Los trabajos de las funciones Entra, Netbox, GLPI, monitorización e IA no tienen nada que hacer hasta que esa función está configurada.

Con varios procesos de API (`API_WORKERS`), cada trabajo se sigue ejecutando una sola vez por hora programada: los procesos acuerdan a través de la base de datos cuál lo ejecuta. Cuando la API se detiene (una actualización), un trabajo en curso dispone del tiempo de vaciado para terminar; uno que siga en ejecución en ese momento aparece como fallido ("interrupted") en la lista de tareas programadas y se vuelve a ejecutar en su siguiente hora.

Los trabajos necesitan que la API funcione como proceso de larga duración, que es lo que hacen los contenedores. `check-expirations` y `send-weekly-reviews` construyen los enlaces de sus correos a partir de `APP_BASE_URL`. Si no está definida, omiten su trabajo y la API escribe una línea en el registro ("application URL is not configured"). Si no hay ningún transporte de correo saliente configurado, omiten el envío.
