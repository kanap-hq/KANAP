# Operaciones locales

## Procedimiento de actualización

```bash
# 1. Respaldar base de datos y almacenamiento (es su responsabilidad)

# 2. Obtener los últimos cambios
cd kanap
git pull origin main

# 3. Construir las imágenes a partir de las fuentes descargadas
docker compose -f infra/compose.onprem.yml build --pull

# 4. Reiniciar contenedores (las migraciones se ejecutan automáticamente)
docker compose -f infra/compose.onprem.yml up -d
# El contenedor de API anterior primero termina las solicitudes en curso, los correos en cola
# y sus trabajos en segundo plano en curso (hasta 20 s), y luego se detiene.
```

Docker Compose construye por sí mismo las imágenes `api` y `web`, a partir de las fuentes que acaba de descargar. `--pull` también descarga las imágenes base actualizadas. Si ejecuta solo `up -d`, se mantiene la versión anterior, porque Compose reutiliza las imágenes que ya tiene. Ejecute siempre `build` primero.

**Comprobar la actualización:**

```bash
docker compose -f infra/compose.onprem.yml logs --tail=100 api
curl https://kanap.company.com/api/health
```

El registro de la API muestra las migraciones (`[entrypoint] Migrations complete (N executed).`) y después el inicio de la API, sin errores. La dirección de salud responde `{ "status": "ok" }`.

**Cambios importantes:** Revise `CHANGELOG.md` antes de actualizar.

**Reversión:** Restaure la base de datos desde la copia de seguridad. Las migraciones son solo hacia adelante. Después, vuelva a la versión anterior con `git checkout <commit anterior>`, ejecute los mismos comandos `build --pull` y `up -d` y compruebe de nuevo la actualización. Ejecute `git checkout main` antes de la siguiente actualización.

## Soporte de versiones

KANAP es una solución en rápida evolución y recomendamos actualizar mensualmente.
Para clientes bajo soporte, se puede solicitar una actualización a la última versión antes de gestionar una solicitud de soporte.

## Copia de seguridad y restauración

- **PostgreSQL:** Use `pg_dump`/`pg_restore` o copias de seguridad de BD gestionadas
- **Almacenamiento S3:** Use versionado de buckets, replicación o copias de seguridad del proveedor

**Recomendación:** Copias de seguridad diarias de la base de datos, retener al menos 30 días.

## Configuración de PostgreSQL

Los valores predeterminados de PostgreSQL están dimensionados para una máquina pequeña. `infra/postgres/kanap-pg-tune.sh` imprime ajustes dimensionados según la memoria de su servidor (memoria, costes de SSD, registro de consultas lentas, estadísticas de consultas). Ejecútelo en el servidor PostgreSQL y lea el archivo antes de aplicarlo: su cabecera explica cada valor.

```bash
# Las bibliotecas que PostgreSQL ya precarga (a menudo ninguna): el script las conserva.
CURRENT=$(sudo -u postgres psql -XAtc 'SHOW shared_preload_libraries')
# PostgreSQL en el mismo servidor que KANAP (añada --dedicated si tiene el servidor solo para él)
sh infra/postgres/kanap-pg-tune.sh --preload "$CURRENT" | sudo tee /etc/postgresql/16/main/conf.d/kanap.conf
sudo systemctl restart postgresql
sudo -u postgres psql -d kanap -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
```

Dos comprobaciones antes del reinicio, ambas hechas por el script, que escribe la línea `shared_preload_libraries` comentada si alguna falla:

- **La lista de bibliotecas precargadas.** `shared_preload_libraries` es una sola lista, y el valor de `kanap.conf` sustituye al de `postgresql.conf`. Sin `--preload`, añada usted mismo el valor de `SHOW shared_preload_libraries` por delante (por ejemplo `'pg_cron,pg_stat_statements'`), y luego quite el `#`.
- **La biblioteca en sí.** PostgreSQL no arranca si falta una biblioteca precargada. Viene incluida con PostgreSQL en Debian y Ubuntu; en RHEL y derivados, instale el paquete contrib (`postgresql16-contrib`). Compruebe con `ls "$(pg_config --pkglibdir)/pg_stat_statements.so"`.

El reinicio es necesario una sola vez, para el ajuste de memoria y las estadísticas de consultas: prográmelo en una ventana de mantenimiento, KANAP no puede alcanzar su base de datos mientras PostgreSQL se reinicia. Las consultas de más de 500 ms aparecen después en el registro de PostgreSQL, sin sus parámetros (`log_parameter_max_length = 0`: pueden contener datos personales). `pg_stat_statements` lista las consultas más costosas:

```sql
SELECT calls, round(mean_exec_time) AS avg_ms, left(query, 80) AS query
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;
```

Las migraciones de KANAP también hacen que el autovacuum empiece antes en las dos tablas más grandes (los importes de presupuesto). Eso no necesita reinicio ni memoria.

## Monitorización

**Endpoint de salud:**

`GET /api/health` → `{ "status": "ok" }`

```bash
curl https://kanap.empresa.com/api/health
```

**Salud de contenedores:**
```bash
docker compose -f infra/compose.onprem.yml ps
docker compose -f infra/compose.onprem.yml logs -f api
```

**Métricas clave:**
- Contenedores ejecutándose (`api`, `web`)
- Memoria de la API por debajo de ~1 GB por proceso de API
- Conexiones a base de datos
- Uso de almacenamiento

### Métricas de API para una herramienta de monitorización

Defina `OPS_METRICS_TOKEN` en `.env` (24 caracteres o más, por ejemplo `openssl rand -hex 32`) y reinicie la API. Su herramienta de monitorización puede entonces leer:

```bash
curl -s -H "Authorization: Bearer $OPS_METRICS_TOKEN" https://kanap.empresa.com/api/ops/metrics
```

La respuesta es JSON. Sin este ajuste, la dirección responde 404. Responde incluso cuando la API está sobrecargada: los valores que necesitan la base de datos se marcan entonces como `db.statsStale`. Los campos a vigilar:

| Campo | Qué indica |
|---|---|
| `health.status` | `ok`, `warn` o `critical`, según los umbrales siguientes. `health.alerts` enumera qué va mal y qué hacer |
| `topRoutes` | Solicitudes por ruta en 5 minutos, con tiempos de respuesta p50, p95 y p99 en milisegundos |
| `process.eventLoopLagMs.p95` | Cuánto tiempo hizo esperar el hilo principal de la API a las solicitudes durante el último minuto |
| `db.pool.inUse`, `db.pool.inUseMax1m`, `db.pool.waitingCount` | Conexiones a la base de datos en uso ahora, el máximo del último minuto, solicitudes esperando una |
| `db.pool.wait.p95Ms1m`, `db.pool.wait.failures5m` | Tiempo para obtener una conexión a la base de datos; solicitudes que no obtuvieron ninguna (respuesta «ocupado») |
| `windows.5m.statusClasses` | Respuestas por clase de estado en 5 minutos |
| `processes`, `aggregate` | Con varios procesos de API: cada uno, y todos juntos |

Umbrales de alerta (`health` los aplica; con varios procesos de API, a todos juntos, y el grupo de conexiones de base de datos al más saturado). Una alerta se dispara por encima del umbral:

| Alerta | Advertencia | Crítico | Qué hacer |
|---|---|---|---|
| Bucle de eventos p95 (1 min) | 100 ms | 500 ms | Añada procesos de API (`API_WORKERS`) si el servidor tiene núcleos libres |
| Espera por una conexión a la base de datos, p95 (1 min) | 50 ms | 1 s | Aumente `DB_POOL_MAX` dentro del límite de `max_connections` de PostgreSQL |
| Conexiones en uso, máximo en 1 min | 90 % del grupo | | Lo mismo |
| Solicitudes sin ninguna conexión (5 min) | | cualquiera | Compruebe que PostgreSQL funciona y que no se alcanzó `max_connections` |
| Errores del servidor (5 min, desde 20 solicitudes) | 1 % | 5 % | Lea el registro de la API |
| p95 de una ruta (5 min, desde 20 solicitudes) | 1 s | 3 s | Informe con el nombre de la ruta; las rutas de importación, exportación e IA no se cuentan |
| Memoria de un proceso de API | 1 GB | | Reinicie la API; informe si vuelve a ocurrir |

## Solución de problemas

| Síntoma | Verificar | Solución |
|---------|-----------|----------|
| Los contenedores no inician | `docker compose logs api` | Verificar errores de inicio |
| `[DB] pool budget exceeded` en el registro de la API | `API_WORKERS`, `DB_POOL_MAX`, `max_connections` de PostgreSQL | Reduzca `DB_POOL_MAX` al valor que indica el mensaje (o `API_WORKERS`), o aumente `max_connections` |
| "Database connection failed" | Verificar `DATABASE_URL` | Verificar accesibilidad/credenciales de PostgreSQL |
| "S3 error" | Verificar variables S3_* | Asegurar que el bucket existe y los permisos son correctos |
| Migración fallida | Verificar versión de PostgreSQL | Debe ser 16+, extensiones disponibles |
| 502 del proxy inverso | `docker compose ps` | Asegurar que el contenedor api está ejecutándose en el puerto 8080 |
| No puede iniciar sesión | Verificar credenciales de `.env` | Usar restablecimiento de contraseña a continuación |

## Restablecimiento de contraseña

**Recomendado:** Configure correo (API de Resend o SMTP de inquilino único) y use el flujo de "Olvidé mi contraseña".

**Respaldo (SQL):** Si el correo no está configurado, restablezca contraseñas directamente en la base de datos.

**1) Generar un hash de contraseña:**

```bash
# Usando Node.js con argon2
# (argon2 es una dependencia de producción en la imagen de la API)
docker compose -f infra/compose.onprem.yml exec api \
  node -e "require('argon2').hash('NuevaContraseña123!').then(h => console.log(h))"
```

**2) Actualizar el usuario en PostgreSQL:**

```sql
UPDATE users
SET password_hash = '$argon2id$v=19$m=65536,t=3,p=4$...'
WHERE email = 'usuario@empresa.com';
```

Este método SQL es un respaldo de último recurso para administradores bloqueados.
