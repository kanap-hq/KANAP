# Despliegue local: Configuración de SSO con Microsoft Entra

Esta guía explica cómo habilitar SSO con Microsoft Entra (Azure AD) para un despliegue local de KANAP.
El SSO con Entra es opcional; si no lo configura, la autenticación local con correo/contraseña sigue disponible.

## Descripción general

KANAP usa el flujo de código de autorización OAuth2/OIDC como cliente confidencial.
Cada cliente local **debe registrar su propia aplicación Entra** y proporcionar su ID de cliente/secreto.

### Lo que proporciona el cliente

- Un registro de aplicación Entra **en su inquilino**
- `ENTRA_CLIENT_ID` y `ENTRA_CLIENT_SECRET`
- `ENTRA_AUTHORITY` apuntando a su inquilino
- `ENTRA_REDIRECT_URI` que coincida con su URL de KANAP

## Requisitos previos

- Una URL HTTPS pública para KANAP (proxy inverso delante de la API)
- Capacidad de crear un registro de aplicación y otorgar consentimiento de administrador en Entra
- Conectividad de salida desde el contenedor de la API de KANAP a:
  - `login.microsoftonline.com` (metadatos OIDC, intercambio de tokens, JWKS)
  - `graph.microsoft.com` (enriquecimiento del perfil al iniciar sesión y sincronización diaria del directorio)

## Paso 1: Crear un registro de aplicación (Entra)

1. Abra **Microsoft Entra ID > Registros de aplicaciones > Nuevo registro**
2. Nombre: `KANAP (local)`
3. Tipos de cuenta soportados: **Inquilino único** (recomendado)
4. URI de redirección (Web):
   `https://<su-dominio-kanap>/api/auth/entra/callback`
5. Guarde y anote:
   - **ID de aplicación (cliente)**
   - **ID de directorio (inquilino)**

## Paso 2: Crear un secreto de cliente

1. Vaya a **Certificados y secretos**
2. Cree un nuevo **Secreto de cliente**
3. Copie el **valor del secreto** (se muestra solo una vez)

## Paso 3: Permisos de API

KANAP necesita dos conjuntos de permisos: permisos delegados para el inicio de sesión interactivo y un permiso de aplicación para la sincronización diaria del directorio.

### Permisos delegados (inicio de sesión)

Cada solicitud de inicio de sesión pide a Entra exactamente estos ámbitos:

```
openid profile email offline_access User.Read
```

Añada los cinco como permisos **configurados** en el registro de aplicación:

1. Abra **Registros de aplicaciones > su aplicación KANAP > Permisos de API**
2. **Agregar un permiso > Microsoft Graph > Permisos delegados**
3. Seleccione `openid`, `profile`, `email`, `offline_access` y `User.Read`
4. Haga clic en **Agregar permisos**

`User.Read` permite a KANAP leer el perfil de la persona que inicia sesión desde Microsoft Graph, para rellenar su nombre, cargo, teléfonos, departamento y empresa. Consérvelo. Es un permiso distinto de `User.Read.All`, no una versión anterior del mismo. Sin él, se pide consentimiento a los usuarios en cada inicio de sesión o el inicio de sesión falla.

!!! warning "Añada los ámbitos OIDC antes de otorgar el consentimiento de administrador"
    El consentimiento de administrador para todo el inquilino reescribe la concesión de la aplicación para que coincida con la lista de permisos **configurados**. `openid`, `profile`, `email` y `offline_access` suelen aparecer en "Otros permisos concedidos" y no están configurados de forma predeterminada, por lo que un consentimiento para todo el inquilino los eliminaría y rompería los inicios de sesión existentes. El portal de Azure muestra esta advertencia por sí mismo. Añada primero los cuatro ámbitos como permisos delegados configurados y otorgue después el consentimiento.

### Permiso de aplicación (sincronización diaria del directorio)

La sincronización nocturna del directorio se ejecuta sin ningún usuario conectado, así que necesita un permiso de aplicación:

1. **Permisos de API > Agregar un permiso > Microsoft Graph > Permisos de aplicación**
2. Seleccione **`User.Read.All`**
3. Haga clic en **Agregar permisos**

`User.Read.All` cubre también el responsable de cada cuenta, que KANAP escribe en la ficha de las personas que son colaboradores. No hay nada más que añadir para eso.

La nueva fila muestra ahora el estado **No concedido** con una advertencia naranja. Es lo esperado. El permiso pasa a ser utilizable cuando un administrador de Microsoft Entra otorga el consentimiento para todo el inquilino, lo que se hace desde KANAP en el [Paso 7](#paso-7-autorizar-la-sincronizacion-diaria-del-directorio).

Quién hace qué:

- **KANAP alojado**: el operador de KANAP es propietario del registro de aplicación y añade el permiso. El administrador de Entra del cliente solo otorga el consentimiento.
- **Despliegue local**: el propio equipo IT del cliente es propietario del registro de aplicación, así que añade el permiso y otorga el consentimiento.

### Si no desea llamadas a Graph al iniciar sesión

```
ENTRA_ENRICH_PROFILE=false
```

Esto solo omite la llamada `/me` a Microsoft Graph realizada durante el inicio de sesión. Los nombres y otros campos del perfil provienen entonces únicamente del token de ID. No desactiva la sincronización diaria del directorio, que usa su propio permiso de aplicación.

## Paso 4: Configurar las variables de entorno de KANAP

Establezca lo siguiente en su `.env` local:

```bash
# SSO Entra (local)
ENTRA_CLIENT_ID=<id-de-cliente-de-la-aplicacion>
ENTRA_CLIENT_SECRET=<secreto-de-cliente>
ENTRA_AUTHORITY=https://login.microsoftonline.com/<id-de-inquilino>
ENTRA_REDIRECT_URI=https://kanap.empresa.com/api/auth/entra/callback
```

Notas:
- `ENTRA_AUTHORITY` debe ser **específico del inquilino** para despliegue local.
- `ENTRA_REDIRECT_URI` debe coincidir **exactamente** con lo que registró en Entra.
- Asegúrese de que `APP_BASE_URL` esté establecido con la dirección exacta que abren los usuarios (esquema, host y puerto cuando no sea el estándar). La redirección posterior al inicio de sesión se construye a partir de ella. Sin ella, el inicio de sesión con Microsoft responde «application URL is not configured».

## Paso 5: Reiniciar KANAP

Después de actualizar `.env`, reinicie sus contenedores para que la API recoja la nueva configuración.

## Paso 6: Conectar Entra en KANAP

1. Inicie sesión como administrador
2. Vaya a **Administración > Autenticación**
3. En la tarjeta **Microsoft Entra ID**, haga clic en **Conectar**
4. Apruebe el consentimiento en Entra
5. Use **Probar inicio de sesión** para confirmar el inicio de sesión de extremo a extremo

## Paso 7: Autorizar la sincronización diaria del directorio

El bloque **Sincronización diaria del directorio** aparece en **Administración > Autenticación** una vez conectado Entra. Hasta que un administrador de Microsoft Entra lo apruebe, el bloque muestra:

> Aún no autorizado. Un administrador de Microsoft Entra debe conceder a KANAP permiso para leer los usuarios del directorio.

Para aprobarlo:

1. Inicie sesión en KANAP como administrador que además sea administrador de Microsoft Entra
2. Vaya a **Administración > Autenticación > Sincronización diaria del directorio**
3. Haga clic en **Conceder acceso en Microsoft Entra**
4. Apruebe la solicitud en la página de consentimiento de Microsoft

Vuelve a KANAP con el mensaje **Acceso concedido. La primera sincronización está en curso.** La línea "Aún no autorizado" desaparece.

También puede otorgar el consentimiento desde el portal de Azure con **Conceder consentimiento de administrador para &lt;inquilino&gt;** en la página de permisos de API. KANAP solo lo detecta entonces en la siguiente sincronización. Haga clic en **Sincronizar ahora** para comprobarlo de inmediato. Como KANAP almacena en caché su token de Microsoft, el primer intento justo después de otorgar el consentimiento en el portal puede seguir indicando "no autorizado". Haga clic de nuevo en **Sincronizar ahora** y funcionará. En cualquier caso, la ejecución nocturna se recupera por sí sola.

## La sincronización diaria del directorio

Una vez autorizada, KANAP contacta con Microsoft Graph cada noche a las 03:00 hora del servidor y, para cada usuario vinculado a Entra:

- Actualiza nombre, apellido, cargo, teléfono de empresa y teléfono móvil
- Compara el departamento y la empresa del directorio **por nombre** con los registros existentes de KANAP. No se crea nada automáticamente, y un nombre sin coincidencia deja la asignación sin cambios.
- Establece el idioma de la interfaz solo si la persona no ha elegido uno
- Desactiva la cuenta de KANAP si la persona fue eliminada del directorio, o si su cuenta del directorio fue desactivada (`accountEnabled` es false)

Los valores vacíos del directorio nunca borran los datos ya presentes en KANAP.

Al desactivar una cuenta se cierra la sesión de la persona de inmediato y se bloquea cualquier inicio de sesión posterior. Sus datos e historial se conservan.

El bloque en **Administración > Autenticación** informa del resultado: **Última sincronización {fecha} — N cuentas actualizadas, N desactivadas.** tras una ejecución correcta, o **La última sincronización falló: {mensaje}** en caso contrario. **Sincronizar ahora** ejecuta el mismo trabajo bajo demanda.

## Solución de problemas

- **SSO_NOT_CONFIGURED**: Faltan las variables de entorno de Entra o el inquilino no está conectado. Los usuarios ven "El inicio de sesión con Microsoft no está configurado para este espacio de trabajo."
- **ENTRA_TENANT_MISMATCH**: Conectó un inquilino pero está intentando iniciar sesión desde otro. Los usuarios ven "Esta cuenta de Microsoft pertenece a una organización distinta de la conectada a este espacio de trabajo."
- **ENTRA_EMAIL_UNVERIFIED**: La dirección de correo de la cuenta de Microsoft no está verificada, por lo que no puede usarse para iniciar sesión.
- **Invalid Entra state / nonce**: El estado de inicio de sesión expiró o la redirección de Entra no volvió a la URL de callback configurada. Vuelva a intentar iniciar sesión y verifique que `ENTRA_REDIRECT_URI` coincida exactamente con el registro de aplicación de Entra.
- **Mala redirección después del inicio de sesión**: Verifique que `APP_BASE_URL` sea la dirección exacta que abren los usuarios. La redirección procede de `APP_BASE_URL`, y las cabeceras `Host` y `X-Forwarded-Host` no la modifican. Verifique también que el proxy envíe `X-Forwarded-Proto`.
- **"Aún no autorizado" en la sincronización del directorio**: o bien el permiso de aplicación `User.Read.All` nunca se añadió al registro de aplicación, o bien ningún administrador de Microsoft Entra ha otorgado todavía el consentimiento para todo el inquilino. Compruebe ambos y haga clic en **Sincronizar ahora**.
- **Los inicios de sesión empezaron a fallar justo después de otorgar el consentimiento de administrador**: el consentimiento reemplazó la concesión de la aplicación por la lista de permisos configurados, eliminando `openid`, `profile`, `email` y `offline_access`. Añádalos como permisos delegados configurados y otorgue el consentimiento de nuevo.
- **Secreto de cliente expirado**: Microsoft devuelve `AADSTS7000222`. Los usuarios solo ven el mensaje genérico "El inicio de sesión con Microsoft no se completó. Inténtelo de nuevo o contacte con su administrador." en la página de inicio de sesión. Para confirmar la causa, consulte **Administración > Autenticación > Sincronización diaria del directorio**: la línea de error cita el código de error de Microsoft. Volver a ejecutar **Conectar** también lo muestra. Cree un nuevo secreto de cliente en **Certificados y secretos**, actualice `ENTRA_CLIENT_SECRET` y reinicie la API.

## Notas de seguridad

- No incluya `ENTRA_CLIENT_SECRET` en git.
- Rote el secreto periódicamente.
- Use un registro de aplicación dedicado.
