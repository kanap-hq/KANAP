# On-premise: configuración del SSO con Microsoft Entra

Esta guía explica cómo activar el SSO con Microsoft Entra (Azure AD) en un despliegue on-premise de KANAP.
El SSO con Entra es opcional; si no lo configura, la autenticación local con correo y contraseña sigue disponible.

## Descripción general

KANAP usa el flujo de código de autorización OAuth2/OIDC como cliente confidencial.
Cada cliente on-premise **debe registrar su propia aplicación Entra** y aportar su ID de cliente y su secreto.

### Lo que aporta el cliente

- Un registro de aplicación Entra **en su propio inquilino**
- `ENTRA_CLIENT_ID` y `ENTRA_CLIENT_SECRET`
- `ENTRA_AUTHORITY` apuntando a su inquilino
- `ENTRA_REDIRECT_URI` que coincida con su URL de KANAP

## Requisitos previos

- Una dirección HTTPS para KANAP a la que puedan llegar los navegadores de sus usuarios (proxy inverso delante de la API). Un nombre interno funciona: Microsoft solo redirige a él el navegador del usuario.
- Poder crear un registro de aplicación y conceder el consentimiento de administrador en Entra
- Conectividad saliente desde el contenedor de la API de KANAP hacia:
  - `login.microsoftonline.com` (metadatos OIDC, intercambio de tokens, JWKS)
  - `graph.microsoft.com` (enriquecimiento del perfil al iniciar sesión y sincronización diaria del directorio)

## Paso 1: crear un registro de aplicación (Entra)

1. Abra **Microsoft Entra ID → Registros de aplicaciones → Nuevo registro**
2. Nombre: `KANAP (on-prem)`
3. Tipos de cuenta admitidos: **Inquilino único** (recomendado)
4. URI de redirección (Web): `https://<your-kanap-domain>/api/auth/entra/callback`
5. Guarde y anote:
   - **Id. de aplicación (cliente)**
   - **Id. de directorio (inquilino)**

## Paso 2: crear un secreto de cliente

1. Vaya a **Certificados y secretos**
2. Cree un nuevo **Secreto de cliente**
3. Copie el **valor del secreto** (solo se muestra una vez)

## Paso 3: permisos de API

KANAP necesita dos conjuntos de permisos: permisos delegados para el inicio de sesión interactivo y un permiso de aplicación para la sincronización diaria del directorio.

### Permisos delegados (inicio de sesión)

Cada solicitud de inicio de sesión pide a Entra exactamente estos ámbitos:

```
openid profile email offline_access User.Read
```

Añada los cinco como permisos **configurados** en el registro de aplicación:

1. Abra **Registros de aplicaciones → su aplicación KANAP → Permisos de API**
2. **Agregar un permiso → Microsoft Graph → Permisos delegados**
3. Seleccione `openid`, `profile`, `email`, `offline_access` y `User.Read`
4. Haga clic en **Agregar permisos**

`User.Read` permite a KANAP leer en Microsoft Graph el perfil de la persona que inicia sesión para rellenar su nombre, cargo, teléfonos, departamento y empresa. Consérvelo. Es un permiso distinto de `User.Read.All`. Sin él, se pide consentimiento a los usuarios en cada inicio de sesión o el inicio de sesión falla.

!!! warning "Añada los ámbitos OIDC antes de conceder el consentimiento de administrador"
    El consentimiento de administrador para todo el inquilino reescribe la concesión de la aplicación según la lista de permisos **configurados**. `openid`, `profile`, `email` y `offline_access` suelen aparecer en "Otros permisos concedidos" y no están configurados por defecto, así que un consentimiento para todo el inquilino los eliminaría y rompería los inicios de sesión existentes. El portal de Azure muestra él mismo esta advertencia. Añada primero los cuatro ámbitos como permisos delegados configurados y conceda después el consentimiento.

### Permiso de aplicación (sincronización diaria del directorio)

La sincronización nocturna del directorio se ejecuta sin ningún usuario conectado, así que necesita un permiso de aplicación:

1. **Permisos de API → Agregar un permiso → Microsoft Graph → Permisos de aplicación**
2. Seleccione **`User.Read.All`**
3. Haga clic en **Agregar permisos**

`User.Read.All` cubre también el responsable jerárquico de cada cuenta, que KANAP escribe en el perfil de colaborador de las personas que son colaboradores. No hay nada más que añadir para ello.

La nueva fila muestra ahora el estado **No concedido** con una advertencia naranja. Es lo esperado. El permiso pasa a ser utilizable cuando un administrador de Microsoft Entra concede el consentimiento para todo el inquilino, lo que se hace desde KANAP en el [Paso 7](#paso-7-autorizar-la-sincronizacion-diaria-del-directorio).

Quién hace qué:

- **KANAP alojado**: el operador de KANAP es propietario del registro de aplicación y añade el permiso. El administrador de Entra del cliente solo concede el consentimiento.
- **On-premise**: el propio departamento IT del cliente es propietario del registro de aplicación, así que añade el permiso y concede el consentimiento.

### Si no desea llamadas a Graph al iniciar sesión

```
ENTRA_ENRICH_PROFILE=false
```

Esto solo omite la llamada `/me` a Microsoft Graph durante el inicio de sesión. Los nombres y los demás campos del perfil proceden entonces únicamente del token de ID. No desactiva la sincronización diaria del directorio, que usa su propio permiso de aplicación.

## Paso 4: configurar las variables de entorno de KANAP

Defina lo siguiente en el `.env` de su instalación on-premise:

```bash
# SSO con Entra (on-premise): las cuatro son obligatorias juntas
ENTRA_CLIENT_ID=<application-client-id>
ENTRA_CLIENT_SECRET=<client-secret>
ENTRA_AUTHORITY=https://login.microsoftonline.com/<tenant-id>
ENTRA_REDIRECT_URI=https://kanap.company.com/api/auth/entra/callback
```

Notas:
- `ENTRA_AUTHORITY` debe ser **específica del inquilino** en on-premise.
- `ENTRA_REDIRECT_URI` debe coincidir **exactamente** con lo que registró en Entra.
- Compruebe que `APP_BASE_URL` contiene la dirección exacta que abren los usuarios (esquema, host y puerto cuando no es el estándar). La redirección posterior al inicio de sesión se construye a partir de ella. Sin ella, el inicio de sesión con Microsoft responde "application URL is not configured".

## Paso 5: reiniciar KANAP

Después de actualizar `.env`, vuelva a crear el contenedor de la API para que tome la nueva configuración. Un simple `restart` conserva los valores anteriores.

```bash
cd /opt/kanap
docker compose -f infra/compose.onprem.yml up -d api
```

## Paso 6: conectar Entra en KANAP

1. Inicie sesión como administrador
2. Vaya a **Administración → Autenticación**
3. En la tarjeta **Microsoft Entra ID**, haga clic en **Conectar**
4. Apruebe el consentimiento en Entra
5. Use **Probar inicio de sesión** para confirmar el inicio de sesión de principio a fin

## Paso 7: autorizar la sincronización diaria del directorio

El bloque **Sincronización diaria del directorio** aparece en **Administración → Autenticación** cuando Entra está conectado. Mientras un administrador de Microsoft Entra no lo aprueba, el bloque muestra:

> Aún no autorizado. Un administrador de Microsoft Entra debe conceder a KANAP permiso para leer los usuarios del directorio.

Para aprobarlo:

1. Inicie sesión en KANAP como un administrador que también sea administrador de Microsoft Entra
2. Vaya a **Administración → Autenticación → Sincronización diaria del directorio**
3. Haga clic en **Conceder acceso en Microsoft Entra**
4. Apruebe la solicitud en la página de consentimiento de Microsoft

Vuelve a KANAP con el mensaje **Acceso concedido. La primera sincronización está en curso.** La línea "Aún no autorizado" desaparece.

También puede conceder el consentimiento desde el portal de Azure con **Conceder consentimiento de administrador para &lt;inquilino&gt;** en la página de permisos de API. KANAP solo lo detecta entonces en la siguiente sincronización. Haga clic en **Sincronizar ahora** para comprobarlo de inmediato. Como KANAP guarda en caché su token de Microsoft, el primer intento justo después de una concesión en el portal puede indicar todavía "no autorizado". Haga clic de nuevo en **Sincronizar ahora** y funcionará. En cualquier caso, la ejecución nocturna se recupera por sí sola.

## La sincronización diaria del directorio

Una vez autorizada, KANAP consulta Microsoft Graph cada noche a las 03:00 UTC (el reloj del contenedor de la API) y, para cada usuario vinculado a Entra:

- Actualiza el nombre, los apellidos, el cargo, el teléfono profesional y el teléfono móvil
- Compara el departamento y la empresa del directorio **por nombre** con los registros existentes en KANAP. No se crea nada automáticamente, y un nombre sin coincidencia deja la asignación sin cambios.
- Define el idioma de la interfaz solo si la persona no ha elegido uno
- Desactiva la cuenta de KANAP si la persona se eliminó del directorio o si su cuenta del directorio se desactivó (`accountEnabled` es false)

Los valores vacíos del directorio nunca borran datos ya presentes en KANAP.

Desactivar una cuenta cierra la sesión de la persona de inmediato y bloquea cualquier nuevo inicio de sesión. Sus datos y su historial se conservan.

El bloque de **Administración → Autenticación** indica el resultado: **Última sincronización {fecha}: N cuentas actualizadas, N desactivadas.** después de una ejecución correcta o, en caso contrario, **La última sincronización falló: {mensaje}**. **Sincronizar ahora** ejecuta el mismo trabajo bajo demanda.

## Solución de problemas

- **SSO_NOT_CONFIGURED**: faltan las variables de entorno de Entra o el inquilino no está conectado. Los usuarios ven "El inicio de sesión con Microsoft no está configurado para este espacio de trabajo."
- **ENTRA_TENANT_MISMATCH**: conectó un inquilino pero intenta iniciar sesión desde otro. Los usuarios ven "Esta cuenta de Microsoft pertenece a una organización distinta de la conectada a este espacio de trabajo."
- **ENTRA_EMAIL_UNVERIFIED**: la dirección de correo de la cuenta de Microsoft no está verificada, así que no puede usarse para iniciar sesión.
- **Estado o nonce de Entra no válido**: el estado del inicio de sesión caducó o la redirección de Entra no volvió a la URL de retorno configurada. Vuelva a intentar el inicio de sesión y compruebe que `ENTRA_REDIRECT_URI` coincide exactamente con el registro de aplicación de Entra.
- **Redirección incorrecta tras el inicio de sesión**: compruebe que `APP_BASE_URL` es la dirección exacta que abren los usuarios. La redirección procede de `APP_BASE_URL`, y las cabeceras `Host` y `X-Forwarded-Host` no la cambian. Compruebe también que el proxy envía `X-Forwarded-Proto`.
- **"Aún no autorizado" en la sincronización del directorio**: o bien el permiso de aplicación `User.Read.All` nunca se añadió al registro de aplicación, o bien un administrador de Microsoft Entra todavía no ha concedido el consentimiento para todo el inquilino. Compruebe ambos puntos y haga clic en **Sincronizar ahora**.
- **Los inicios de sesión empezaron a fallar justo después de conceder el consentimiento de administrador**: el consentimiento sustituyó la concesión de la aplicación por la lista de permisos configurados y eliminó `openid`, `profile`, `email` y `offline_access`. Añádalos como permisos delegados configurados y vuelva a conceder el consentimiento.
- **Secreto de cliente caducado**: Microsoft devuelve `AADSTS7000222`. En la página de inicio de sesión, los usuarios solo ven el mensaje genérico "El inicio de sesión con Microsoft no se completó. Inténtelo de nuevo o contacte con su administrador.". Para confirmar la causa, consulte **Administración → Autenticación → Sincronización diaria del directorio**: la línea de error cita el código de error de Microsoft. Volver a ejecutar **Conectar** también lo muestra. Cree un nuevo secreto de cliente en **Certificados y secretos**, actualice `ENTRA_CLIENT_SECRET` y vuelva a crear la API (`docker compose -f infra/compose.onprem.yml up -d api`).

## Notas de seguridad

- No confirme `ENTRA_CLIENT_SECRET` en git. Mantenga `.env` legible solo por su propietario (`chmod 600 .env`).
- Renueve el secreto periódicamente.
- Use un registro de aplicación dedicado.
