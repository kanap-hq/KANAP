# Configuración de Plaid

Esta página controla el [asistente de chat Plaid](ai-assistant.md): con qué modelo IA habla, si el chat y la API MCP están activados, cuánto tiempo se conservan las conversaciones y qué claves y conexiones permiten a los clientes MCP externos acceder a sus datos. Es una pantalla centrada en el chat. Los modelos en sí (proveedores, claves, precios) se definen una sola vez en la página [Modelos IA](ai-models.md), y cada [agente IA](agents-workspace.md) elige su propio modelo en su pestaña Configuración, así que nada de lo que cambie aquí altera cómo funcionan los agentes.

## Dónde encontrarlo

- Espacio de trabajo: **Administración**
- Ruta: **Administración → Inteligencia artificial → Plaid**
- Ruta URL: `/admin/ai`
- Permiso: `ai_settings:admin`
- Indicador de funcionalidad: requiere que la superficie de configuración de IA esté habilitada. Cuando está desactivada, la página muestra un aviso («La configuración de IA está deshabilitada para esta instancia») y no hay controles disponibles.

---

## Proveedor

### Modelo utilizado por Plaid

Un único selector decide qué modelo responde a las preguntas del chat:

- **Modelo predeterminado (*nombre*)** — el predeterminado de la organización definido en la página [Modelos IA](ai-models.md), con su nombre para que vea lo que está usando. Es la primera opción y la respuesta habitual: déjelo aquí y Plaid seguirá al predeterminado allá donde lo mueva.
- **Modelo incluido de KANAP**: se muestra en lugar del anterior cuando no hay ningún predeterminado definido, en el servicio alojado. Plaid funciona entonces con el modelo incluido en su suscripción, dentro de su volumen mensual de mensajes. Un administrador confirma antes el proveedor y el lugar donde trata los datos: consulte [Confirmar el modelo incluido de KANAP](#confirmar-el-modelo-incluido-de-kanap).
- **Ningún modelo configurado** — se muestra cuando no hay predeterminado *ni* modelo incluido, que es el caso de las instalaciones locales. Tenga en cuenta que esta opción sigue diciendo *Ningún modelo configurado* hasta que algún modelo se marque con la estrella como predeterminado de la organización, aunque ya haya registrado varios: describe la alternativa por defecto, no su registro de modelos.
- **Cualquier modelo activo, por su nombre** — fije Plaid a un modelo concreto, con independencia del predeterminado. Los modelos archivados no se ofrecen.

Así que hay dos formas de poner el chat en marcha: marcar un predeterminado con la estrella en la página [Modelos IA](ai-models.md) y dejar este selector en la primera opción, o elegir aquí un modelo por su nombre. Fijar uno aquí funciona exista o no un predeterminado.

El texto de ayuda de debajo enlaza directamente con la página **Modelos IA**, que es de donde sale cada una de las opciones de la lista. Aquí ya no hay ningún proveedor, endpoint ni clave API que rellenar, ni ningún conmutador multimodal aparte: que el modelo pueda leer imágenes es una propiedad del modelo, que se define una sola vez en su editor.

### Confirmar el modelo incluido de KANAP

En el servicio alojado, un administrador confirma qué proveedor recibe sus datos antes de que Plaid o un agente use el modelo incluido. Hasta entonces, ambos esperan.

Cuando Plaid, o un agente sin modelo propio, funcionaría con el modelo incluido, aparece una línea de estado en la tarjeta Proveedor. Indica el proveedor y el lugar donde trata los datos, por ejemplo *Modelo incluido de KANAP: Anthropic (lugar de tratamiento: Estados Unidos)*. Junto a ella aparece **Pendiente de confirmación** o **Confirmado**. Debajo de la línea se ve quién confirmó y cuándo. Si Plaid y todos sus agentes usan modelos que usted añadió, la línea no se muestra y no hay nada que confirmar.

Una confirmación cubre lo que estas funciones envían al proveedor: las preguntas que se hacen a Plaid, las preguntas en las que trabajan los agentes y los datos de KANAP que leen para responder.

- **Confirmar** registra su confirmación. No activa Plaid.
- **Habilitar chat** pide la confirmación cuando todavía falta. Actívelo y guarde: una ventana muestra el proveedor y el lugar de tratamiento. **Confirmar y activar** guarda sus cambios y la confirmación a la vez. Si cierra la ventana, no se guarda nada. La ventana también enlaza con la página [Modelos IA](ai-models.md), por si prefiere usar su propio modelo.
- **Retirar** elimina la confirmación, tras una segunda confirmación. Las funciones de IA que usan el modelo incluido se detienen hasta que un administrador vuelva a confirmar. Plaid sigue activado y muestra un aviso a sus usuarios.
- Se vuelve a pedir confirmación cuando cambia el proveedor, su dirección de conexión, el nombre mostrado o el lugar de tratamiento. Un modelo nuevo del mismo proveedor no la pide. Si el proveedor cambia mientras su ventana está abierta, la ventana muestra el nuevo y le pide que lo revise.
- Plaid y los agentes que funcionan con un modelo que usted añadió no necesitan confirmación. Los asistentes externos conectados por MCP tampoco dependen de ella, porque MCP no envía nada al modelo incluido.

En una instalación local no hay modelo incluido, así que esta sección no se aplica.

### Uso integrado

Cuando Plaid funciona con el modelo incluido de KANAP —sin elección explícita y sin predeterminado de la organización— aparece una tarjeta **Uso integrado** con:

- Cuántos **mensajes lleva utilizados este mes** frente al límite, con una barra de progreso que se vuelve ámbar pasadas tres cuartas partes y roja cerca del tope
- La fecha en la que se **restablece** el volumen
- Un recordatorio de que usar sus propias claves API elimina el límite

Como dice la tarjeta, el chat y los agentes de este espacio de trabajo comparten el volumen. Un mensaje es una pregunta de chat o un ticket revisado por un agente. Las solicitudes de asistentes externos por MCP no cuentan. Una flota de agentes muy activa lo agota más rápido, así que si está vigilando esta barra, vigile también la página [Uso y costes](ai-usage.md).

### Chips de estado

El encabezado de la tarjeta Proveedor muestra tres indicadores de un vistazo:

- **Chat habilitado / Chat deshabilitado** — el conmutador maestro para el chat del usuario final
- **MCP habilitado / MCP deshabilitado** — si los clientes MCP externos pueden conectarse
- **Proveedor listo / Proveedor incompleto**: si el modelo al que resuelve Plaid es realmente utilizable. Mientras solo falte la confirmación del modelo incluido, este indicador se oculta y la línea de estado de arriba ocupa su lugar.

Cuando falta algo, **Errores de validación del proveedor actual** lo enumera encima del formulario: un modelo incompleto, o directamente ningún modelo. La solución está normalmente en la página [Modelos IA](ai-models.md) y no aquí.

---

## Funcionalidades

La sección **Funcionalidades** activa o desactiva las superficies de IA opcionales:

- **Habilitar chat**: activa o desactiva el espacio de chat dentro de la app para los usuarios finales. No se puede activar mientras el encabezado diga **Proveedor incompleto**: el guardado se rechaza indicando los motivos, y esos motivos se corrigen antes en la página [Modelos IA](ai-models.md). Una confirmación pendiente del modelo incluido es la excepción: el guardado abre entonces la ventana de confirmación. La misma comprobación se ejecuta en cada guardado mientras el chat ya está activo, de modo que un modelo que quede incompleto más adelante bloqueará cambios sin ninguna relación en esta página hasta que se resuelva.
- **Habilitar MCP**: activa o desactiva la API MCP para los clientes externos. No espera a la confirmación del modelo incluido. Las solicitudes MCP no cuentan en el volumen mensual incluido.
- **Búsqueda web** — permite al asistente de chat Plaid buscar en la web. Requiere que la clave de búsqueda web a nivel de instancia esté configurada; sin ella, el conmutador está deshabilitado y un tooltip explica por qué. Al activarlo se ejecuta automáticamente una prueba de conectividad y se informa del resultado. Este conmutador se aplica **solo al asistente de chat**: los agentes IA tienen su propia configuración de búsqueda web independiente, en la [pestaña Configuración](agents-workspace.md) de cada agente, que se basa en la misma configuración a nivel de instancia.

---

## Retención

- **Retención de conversaciones (días)** — las conversaciones de chat y sus mensajes con una antigüedad superior a este valor pasan a ser elegibles para la limpieza automática. Déjelo vacío para conservarlas indefinidamente.

Los cambios en **Proveedor**, **Funcionalidades**, **Retención** *y* el campo **Vida útil máxima de la clave (días)** de más abajo se aplican todos con el único botón **Guardar configuración** del final de esta tarjeta. Nada de esta página se guarda por sí solo.

---

## Claves y conexiones MCP

Los asistentes externos y los IDE acceden a KANAP a través del Model Context Protocol (MCP), con los mismos datos que ve Plaid. Se conectan de una de dos formas:

- **Conexión**: Claude, Claude Desktop y Claude Code inician sesión en KANAP con la cuenta del propio usuario. Nadie crea ni copia una clave. Consulte [Conectar un cliente MCP](#conectar-un-cliente-mcp).
- **Clave API**: una clave de larga duración para Cursor, scripts y otros clientes MCP.

La tarjeta **Claves y conexiones MCP** muestra un botón **Crear clave**, la **Dirección del servidor** a la que se conectan los clientes (con un botón para copiarla), el límite de **Vida útil máxima de la clave (días)** y una tabla con **Etiqueta**, **Tipo**, **Prefijo**, **Creada**, **Expira**, **Último uso** y **Estado** (**Activa** o **Revocada**).

La columna **Tipo** indica **Clave API** o **Conexión**. Una fila de conexión muestra el nombre de la aplicación y el host al que vuelve, por ejemplo *Claude · claude.ai*. Las conexiones no tienen prefijo.

### Crear una clave

1. Haga clic en **Crear clave**.
2. Introduzca una **Etiqueta** descriptiva (por ejemplo, «Cursor en mi portátil»).
3. Haga clic en **Crear**. KANAP genera un secreto de un solo uso.
4. Copie el secreto inmediatamente. Se muestra una sola vez y no puede recuperarse más tarde.
5. Si usa Claude Code con una clave, copie el **Comando de Claude Code** que aparece bajo la clave. Ya contiene la dirección del servidor y la clave.

El campo **Vida útil máxima de la clave (días)** limita cuánto tiempo puede vivir cualquier clave recién emitida, independientemente de lo que solicite la petición. También limita cuánto dura una conexión. Déjelo vacío para no tener límite de expiración. Este campo pertenece a la configuración de arriba y no a esta tarjeta: lo escribe el botón **Guardar configuración**, no la creación de una clave.

### Revocar una clave o una conexión

Haga clic en el icono de papelera de cualquier fila activa. Una clave revocada deja de funcionar de inmediato. Una conexión revocada corta el acceso de la aplicación de inmediato, y el usuario tiene que volver a conectarla. Las filas revocadas permanecen en la tabla con fines de auditoría.

Los usuarios también pueden desconectar sus propias aplicaciones en su pestaña [Aplicaciones conectadas](connected-apps.md).

### Quién puede conectarse

- **Habilitar MCP** debe estar activado (consulte **Funcionalidades** más arriba).
- El usuario necesita el rol **AI MCP User**, o cualquier rol que dé acceso de lectura a MCP.
- El acceso es de solo lectura. Un cliente ve exactamente lo que el usuario ve en KANAP, y nada más. En el caso de una clave, es la persona que la creó: cree las claves desde una cuenta cuyo acceso corresponda a lo que el cliente debe leer.
- Las conexiones y las claves comparten los mismos límites de frecuencia, el mismo registro de auditoría y, con el modelo incluido de KANAP, la misma cuota mensual.

### Conectar un cliente MCP

Cada cliente necesita la **Dirección del servidor**: su dirección de KANAP seguida de `/api/ai/mcp`, por ejemplo `https://acme.kanap.net/api/ai/mcp`. La tarjeta **Claves y conexiones MCP** la muestra para su organización.

Cada clave o aplicación conectada acepta hasta 60 solicitudes por minuto. Por encima, el servidor rechaza la solicitud y el cliente puede volver a intentarlo un minuto después.

#### Claude y Claude Desktop

1. En Claude, abra **Configuración > Conectores** y haga clic en **Añadir conector personalizado**.
2. Pegue la dirección del servidor y confirme.
3. Claude abre la página de inicio de sesión de KANAP. Inicie sesión con su contraseña o con Microsoft.
4. KANAP muestra *Claude solicita leer sus datos de KANAP*. La pantalla indica lo que Claude puede hacer (leer lo que usted ve, dentro de sus propios derechos de acceso), el host al que vuelve, y la cuenta y el espacio de trabajo con los que ha iniciado sesión. Si la cuenta no es la suya, haga clic en **¿No es usted?** para iniciar sesión con otra.
5. Haga clic en **Autorizar**. Claude queda conectado. **Rechazar** cierra la solicitud y no se conecta nada.

Claude Desktop usa los mismos conectores que claude.ai: añada el conector en cualquiera de los dos.

#### Claude Team y Enterprise

Un Owner de la organización añade el conector personalizado una sola vez, con la dirección del servidor, para toda la organización de Claude. Después, cada miembro hace clic en **Conectar** en el conector e inicia sesión con su propia cuenta de KANAP. Cada miembro ve solo sus propios datos de KANAP.

#### Claude Code

Añada el servidor sin clave:

```bash
claude mcp add --transport http kanap https://acme.kanap.net/api/ai/mcp
```

Después ejecute `claude mcp login kanap`, o simplemente use el servidor: Claude Code abre su navegador en la página de inicio de sesión de KANAP y luego en la misma pantalla descrita arriba.

#### Recordar esta aplicación

La casilla **Recordar esta aplicación** está marcada por defecto. Si sigue marcada, la siguiente conexión de la misma aplicación por el mismo usuario es más rápida:

- Claude Code, que vuelve a su propio ordenador, se autoriza sin ninguna pantalla.
- Claude y Claude Desktop muestran una pantalla corta con un único botón **Continuar**.

Desmarque la casilla para ver la pantalla completa cada vez. Desconectar la aplicación olvida esta elección.

Una conexión mantiene la sesión por sí sola hasta 90 días, o menos si la **Vida útil máxima de la clave (días)** es más corta. Después, el usuario vuelve a conectarse.

#### Cursor, scripts y otros clientes

Estos clientes usan una clave API (consulte [Crear una clave](#crear-una-clave)). La clave se envía en el encabezado `Authorization: Bearer kanap_mcp_...` de cada petición. Los clientes que no pueden definir este encabezado pueden usar `X-API-Key: kanap_mcp_...` en su lugar. La clave debe estar activa y sin caducar.

En Cursor, añada un servidor remoto (HTTP) en `mcp.json`:

```json
{
  "mcpServers": {
    "kanap": {
      "url": "https://acme.kanap.net/api/ai/mcp",
      "headers": { "Authorization": "Bearer kanap_mcp_..." }
    }
  }
}
```

Claude Code también acepta una clave, por ejemplo en un equipo sin navegador:

```bash
claude mcp add --transport http kanap https://acme.kanap.net/api/ai/mcp --header "Authorization: Bearer kanap_mcp_..."
```

#### Herramientas disponibles

El servidor MCP es de solo lectura. Un cliente puede buscar y leer sus datos, sin poder cambiar nada.

| Herramienta | Qué hace |
|---|---|
| `search_all` | Busca en todos los tipos de registro por palabra clave |
| `describe_entity_filters` | Enumera los filtros disponibles para un tipo de registro |
| `query_entities` | Enumera los registros que coinciden con unos filtros |
| `aggregate_entities` | Cuenta o suma registros, agrupados por un campo |
| `get_filter_values` | Enumera los valores posibles de un filtro |
| `get_entity_detail` | Lee un registro completo |
| `get_entity_context` | Lee los registros vinculados a un registro |
| `get_entity_comments` | Lee los comentarios de un proyecto o una tarea |
| `search_knowledge` | Busca en la base de conocimiento |
| `get_document` | Lee un documento de la base de conocimiento |
| `web_search` | Busca en la web, cuando la búsqueda web está activada para su organización |

---

## Consejos

- **Deje Plaid en el modelo predeterminado salvo que tenga un motivo para no hacerlo.** Fijar el chat a un modelo concreto significa que deja de seguir al predeterminado de la organización: útil cuando el chat y los agentes necesitan realmente modelos distintos, y una molestia el resto del tiempo.
- **Es fácil subestimar el volumen del chat.** La página [Uso y costes](ai-usage.md) valora el chat a las tarifas del modelo asignado; un asistente muy usado con un modelo caro aparece allí mucho antes de aparecer en una factura.
- **Un modelo con visión es un requisito de los agentes, no del chat.** Si sus agentes de triaje necesitan leer capturas de pantalla de los tickets, eso corresponde al modelo de *ellos*: consulte **Comprende imágenes** en la página [Modelos IA](ai-models.md).
- **Prefiera las conexiones para Claude.** Cada persona inicia sesión con su propia cuenta, así que nadie comparte una clave. Reserve las claves para los clientes que las necesitan, rótelas y use **Vida útil máxima de la clave (días)** para imponer un tope que ninguna petición pueda superar.
- **Establezca una ventana de retención.** Conservar las conversaciones para siempre es conveniente hasta que la base de datos crece demasiado o una revisión de conformidad pregunta cuánto tiempo se conserva el contenido del chat: 90 o 180 días es un punto de partida habitual.
- **GLPI se configura en otro sitio.** La conexión de ticketing con la que trabajan sus agentes se configura en **Administración → Integraciones**, no aquí; consulte [Integraciones](integrations.md).
