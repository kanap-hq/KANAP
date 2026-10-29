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

- **Modelo predeterminado (*nombre*)**: el predeterminado de la organización definido en la página [Modelos IA](ai-models.md), con su nombre para que vea lo que está usando. Es la primera opción y la respuesta habitual: déjelo aquí y Plaid seguirá al predeterminado allá donde lo mueva.
- **Modelo incluido de KANAP**: se muestra en lugar del anterior cuando no hay ningún predeterminado definido, en el servicio alojado. Plaid funciona entonces con el modelo incluido en su suscripción, dentro de su volumen mensual de mensajes. Un administrador confirma antes el proveedor y el lugar donde trata los datos: consulte [Confirmar el modelo incluido de KANAP](#confirmar-el-modelo-incluido-de-kanap).
- **Ningún modelo configurado**: se muestra cuando no hay predeterminado *ni* modelo incluido, que es el caso de las instalaciones locales. Tenga en cuenta que esta opción sigue diciendo *Ningún modelo configurado* hasta que algún modelo se marque con la estrella como predeterminado de la organización, aunque ya haya registrado varios: describe la alternativa por defecto, no su registro de modelos.
- **Cualquier modelo activo, por su nombre**: fije Plaid a un modelo concreto, con independencia del predeterminado. Los modelos archivados no se ofrecen.

Así que hay dos formas de poner el chat en marcha: marcar un predeterminado con la estrella en la página [Modelos IA](ai-models.md) y dejar este selector en la primera opción, o elegir aquí un modelo por su nombre. Fijar uno aquí funciona exista o no un predeterminado.

El texto de ayuda de debajo enlaza directamente con la página **Modelos IA**, que es de donde sale cada una de las opciones de la lista. Aquí ya no hay ningún proveedor, endpoint ni clave API que rellenar, ni ningún conmutador multimodal aparte: que el modelo pueda leer imágenes es una propiedad del modelo, que se define una sola vez en su editor.

### Confirmar el modelo incluido de KANAP

En el servicio alojado, un administrador confirma qué proveedor recibe sus datos antes de que Plaid o un agente use el modelo incluido. Hasta entonces, ambos esperan.

Cuando Plaid, o un agente sin modelo propio, funcionaría con el modelo incluido, aparece una línea de estado en la tarjeta Proveedor. Indica el proveedor y el lugar donde trata los datos, por ejemplo *Modelo incluido de KANAP: Anthropic (lugar de tratamiento: Estados Unidos)*. Junto a ella aparece **Pendiente de confirmación** o **Confirmado**. Debajo de la línea se ve quién confirmó y cuándo. Si Plaid y todos sus agentes usan modelos que usted añadió, la línea no se muestra y no hay nada que confirmar.

Una confirmación cubre lo que estas funciones envían al proveedor: las preguntas que se hacen a Plaid, las preguntas en las que trabajan los agentes y los datos de KANAP que leen para responder.

- **Confirmar** registra su confirmación. No activa Plaid.
- **Habilitar chat** pide la confirmación cuando todavía falta. Actívelo y guarde: una ventana muestra el proveedor y el lugar de tratamiento. **Confirmar y activar** guarda sus cambios y la confirmación a la vez. Si cierra la ventana, no se guarda nada. La ventana también enlaza con la página [Modelos IA](ai-models.md), por si prefiere usar su propio modelo.
- Durante una prueba en la nube, la página de inicio también propone activar Plaid, con la misma ventana de confirmación. Véase [Mi panel de control](my-dashboard.md).
- **Retirar** elimina la confirmación, tras una segunda confirmación. Las funciones de IA que usan el modelo incluido se detienen hasta que un administrador vuelva a confirmar. Plaid sigue activado y muestra un aviso a sus usuarios.
- Se vuelve a pedir confirmación cuando cambia el proveedor, su dirección de conexión, el nombre mostrado o el lugar de tratamiento. Un modelo nuevo del mismo proveedor no la pide. Si el proveedor cambia mientras su ventana está abierta, la ventana muestra el nuevo y le pide que lo revise.
- Plaid y los agentes que funcionan con un modelo que usted añadió no necesitan confirmación. Los asistentes externos conectados por MCP tampoco dependen de ella, porque MCP no envía nada al modelo incluido.

En una instalación local no hay modelo incluido, así que esta sección no se aplica.

### Uso integrado

Cuando Plaid funciona con el modelo incluido de KANAP (sin elección explícita y sin predeterminado de la organización), aparece una tarjeta **Uso integrado** con:

- Cuántos **mensajes lleva utilizados este mes** frente al límite, con una barra de progreso que se vuelve ámbar pasadas tres cuartas partes y roja cerca del tope
- La fecha en la que se **restablece** el volumen
- Un recordatorio de que usar sus propias claves API elimina el límite

Como dice la tarjeta, el chat y los agentes de este espacio de trabajo comparten el volumen. Un mensaje es una pregunta de chat o un ticket revisado por un agente. Las solicitudes de asistentes externos por MCP no cuentan. Una flota de agentes muy activa lo agota más rápido, así que si está vigilando esta barra, vigile también la página [Uso y costes](ai-usage.md).

### Chips de estado

El encabezado de la tarjeta Proveedor muestra tres indicadores de un vistazo:

- **Chat habilitado / Chat deshabilitado**: el conmutador maestro para el chat del usuario final
- **MCP habilitado / MCP deshabilitado**: si los clientes MCP externos pueden conectarse
- **Proveedor listo / Proveedor incompleto**: si el modelo al que resuelve Plaid es realmente utilizable. Mientras solo falte la confirmación del modelo incluido, este indicador se oculta y la línea de estado de arriba ocupa su lugar.

Cuando falta algo, **Errores de validación del proveedor actual** lo enumera encima del formulario: un modelo incompleto, o directamente ningún modelo. La solución está normalmente en la página [Modelos IA](ai-models.md) y no aquí.

---

## Funcionalidades

La sección **Funcionalidades** activa o desactiva las superficies de IA opcionales:

- **Habilitar chat**: activa o desactiva el espacio de chat dentro de la app para los usuarios finales. No se puede activar mientras el encabezado diga **Proveedor incompleto**: el guardado se rechaza indicando los motivos, y esos motivos se corrigen antes en la página [Modelos IA](ai-models.md). Una confirmación pendiente del modelo incluido es la excepción: el guardado abre entonces la ventana de confirmación. La misma comprobación se ejecuta en cada guardado mientras el chat ya está activo, de modo que un modelo que quede incompleto más adelante bloqueará cambios sin ninguna relación en esta página hasta que se resuelva.
- **Habilitar MCP**: activa o desactiva la API MCP para los clientes externos. No espera a la confirmación del modelo incluido. Las solicitudes MCP no cuentan en el volumen mensual incluido.
- **Búsqueda web**: permite al asistente de chat Plaid buscar en la web. Requiere que la clave de búsqueda web a nivel de instancia esté configurada; sin ella, el conmutador está deshabilitado y un tooltip explica por qué. Al activarlo se ejecuta automáticamente una prueba de conectividad y se informa del resultado. Este conmutador se aplica **solo al asistente de chat**: los agentes IA tienen su propia configuración de búsqueda web independiente, en la [pestaña Configuración](agents-workspace.md) de cada agente, que se basa en la misma configuración a nivel de instancia.

---

## Retención

- **Retención de conversaciones (días)**: las conversaciones de chat y sus mensajes con una antigüedad superior a este valor pasan a ser elegibles para la limpieza automática. Déjelo vacío para conservarlas indefinidamente.

Los cambios en **Proveedor**, **Funcionalidades**, **Retención** *y* el campo **Vida útil máxima de la clave (días)** de más abajo se aplican todos con el único botón **Guardar configuración** del final de esta tarjeta. Nada de esta página se guarda por sí solo.

---

## Claves y conexiones MCP

Los asistentes externos y los IDE acceden a KANAP a través del Model Context Protocol (MCP), con los mismos datos que ve Plaid. Se conectan de una de dos formas:

- **Conexión** (OAuth): Claude, Claude Desktop, Claude Code, ChatGPT y Grok inician sesión en KANAP con la cuenta del propio usuario. Nadie crea ni copia una clave. Consulte [Conectar un cliente MCP](#connecting-an-mcp-client).
- **Clave API**: una clave de larga duración para Cursor, scripts y cualquier otro cliente MCP capaz de enviar un encabezado.

### Conexión o clave API { #connection-or-api-key }

| | Conexión (OAuth) | Clave API |
|---|---|---|
| Para | Cada persona que usa un asistente de IA con su propia cuenta de KANAP | Un script, una herramienta compartida o un cliente que no puede iniciar sesión |
| Clientes | Claude (claude.ai), Claude Desktop, Claude Code, ChatGPT, Grok | Claude Code, Cursor, scripts, cualquier cliente MCP capaz de enviar un encabezado `Authorization` o `X-API-Key` |
| Configuración | Pegar la dirección del servidor en el cliente, iniciar sesión en KANAP y hacer clic en **Autorizar** | Alguien que puede abrir esta página crea una clave; el secreto se pega en el cliente |
| Lee con | El acceso de la persona que inició sesión | El acceso de la persona que creó la clave |
| Duración | Se renueva de forma transparente durante 90 días, o menos si la **Vida útil máxima de la clave (días)** es más corta. Después, el usuario vuelve a conectarse | Hasta su revocación, o hasta la **Vida útil máxima de la clave (días)** |
| Red | HTTPS. Claude, Claude Desktop, ChatGPT y Grok: KANAP accesible desde Internet. Todos los clientes: KANAP llega al host del cliente por HTTPS (`claude.ai`, `chatgpt.com` o `grok.com`) | El cliente llega a KANAP. Funciona dentro de una red privada, también por HTTP simple |
| Límites | Solo los clientes que publican un documento de metadatos de cliente: Claude, ChatGPT y Grok | Los conectores personalizados de Claude y Claude Desktop no la aceptan. Un secreto que hay que guardar de forma segura, rotar y revocar |

En el servicio alojado, KANAP ya es accesible desde Internet por HTTPS: las conexiones funcionan sin nada que configurar. En una instalación on-premise, consulte [Conectar asistentes de IA mediante MCP](on-premise/configuration.md#connecting-ai-assistants-over-mcp) para saber qué abrir.

Las dos formas comparten el resto:

- **Habilitar MCP** debe estar activado (consulte **Funcionalidades** más arriba).
- Las mismas [herramientas](#herramientas-disponibles) de solo lectura, dentro de los derechos de acceso de la persona detrás de la clave o de la conexión.
- Un límite de 60 solicitudes MCP por minuto para cada clave y cada conexión. Por encima, las solicitudes se rechazan con un encabezado `Retry-After` que indica el número de segundos que hay que esperar.
- El mismo [registro MCP](#mcp-journal).

La tarjeta **Claves y conexiones MCP** muestra un botón **Crear clave**, la **Dirección del servidor** a la que se conectan los clientes (con un botón para copiarla), el límite de **Vida útil máxima de la clave (días)** y una tabla con **Etiqueta**, **Tipo**, **Persona**, **Creada**, **Expira**, **Último uso** y **Estado** (**Activa** o **Revocada**).

La columna **Tipo** indica **Clave API** o **Conexión**. Una fila de conexión muestra el nombre de la aplicación y el host al que vuelve, por ejemplo *Claude · claude.ai*. Una clave API muestra su prefijo junto a su etiqueta, por ejemplo *Portátil · abcd1234*. **Persona** indica quién creó la clave o aprobó la conexión.

### Crear una clave

Las claves se crean solo en esta página, así que solo las crean las personas que pueden abrirla (`ai_settings:admin`, con acceso MCP). Una clave lee con el acceso de la persona que la creó: una clave creada por un administrador lee todo lo que ve un administrador. Trátela como la contraseña de esa persona, y prefiera una conexión cuando cada usuario pueda iniciar sesión.

1. Haga clic en **Crear clave**.
2. Introduzca una **Etiqueta** descriptiva (por ejemplo, «Cursor en mi portátil»).
3. Haga clic en **Crear**. KANAP genera un secreto de un solo uso que empieza por `kanap_mcp_`.
4. Copie el secreto inmediatamente. Se muestra una sola vez y no puede recuperarse más tarde.
5. Si usa Claude Code con una clave, copie el **Comando de Claude Code** que aparece bajo la clave. Ya contiene la dirección del servidor y la clave.

El campo **Vida útil máxima de la clave (días)** limita cuánto tiempo puede vivir cualquier clave recién emitida, independientemente de lo que solicite la petición. También limita cuánto dura una conexión. Déjelo vacío para no tener límite de expiración. Este campo pertenece a la configuración de arriba y no a esta tarjeta: lo escribe el botón **Guardar configuración**, no la creación de una clave.

### Revocar una clave o una conexión

Haga clic en el botón **Revocar** (una llave tachada, o un enlace roto para una conexión) al final de una fila activa y confirme. El cuadro de diálogo nombra la clave o la aplicación. Una clave revocada deja de funcionar de inmediato. Una conexión revocada corta el acceso de la aplicación de inmediato, y el usuario tiene que volver a conectarla. Las filas revocadas permanecen en la tabla con fines de auditoría. Revocar una fila ya revocada no cambia nada: conserva su primera fecha de revocación.

Los usuarios también pueden revocar sus propias claves y desconectar sus propias aplicaciones en su pestaña [Aplicaciones conectadas](connected-apps.md).

### Quién puede conectarse

- **Habilitar MCP** debe estar activado (consulte **Funcionalidades** más arriba).
- El usuario necesita el rol **AI MCP User**, o cualquier rol que dé acceso de lectura a MCP.
- El acceso es de solo lectura. Un cliente ve exactamente lo que el usuario ve en KANAP, y nada más. En el caso de una clave, ese usuario es la persona que la creó.

### Conectar un cliente MCP { #connecting-an-mcp-client }

Cada cliente necesita la **Dirección del servidor**: su dirección de KANAP seguida de `/api/ai/mcp`, por ejemplo `https://acme.kanap.net/api/ai/mcp`. La tarjeta **Claves y conexiones MCP** de esta página la muestra, con un botón para copiarla. Los usuarios que no pueden abrir esta página toman la dirección de KANAP de su navegador y le añaden `/api/ai/mcp`.

Cada clave o aplicación conectada acepta hasta 60 solicitudes por minuto. Por encima, el servidor rechaza la solicitud y el cliente puede volver a intentarlo un minuto después.

#### Claude y Claude Desktop { #connecting-claude }

1. Añada KANAP como conector personalizado: en Claude, abra **Settings > Connectors** y haga clic en **Add custom connector**.
2. Pegue la dirección del servidor. Si Claude pregunta cómo iniciar sesión, elija **Sign in now** y **Use Claude's published identity**. **Register automatically** no funciona con KANAP, y no se necesita ningún ID ni secreto de cliente.
3. Confirme. Claude abre la página de inicio de sesión de KANAP. Inicie sesión con su contraseña o con Microsoft.
4. KANAP muestra *Claude solicita leer sus datos de KANAP*. La pantalla indica lo que Claude puede hacer (leer lo que usted ve, dentro de sus propios derechos de acceso), el host al que vuelve, y la cuenta y el espacio de trabajo con los que ha iniciado sesión. Si la cuenta no es la suya, haga clic en **¿No es usted?** para iniciar sesión con otra.
5. Haga clic en **Autorizar**. Claude queda conectado. **Rechazar** cierra la solicitud y no se conecta nada.

Claude Desktop usa los mismos conectores que claude.ai: añada el conector en cualquiera de los dos. Claude llama a KANAP desde los servidores de Anthropic, así que la dirección del servidor debe ser accesible desde Internet por HTTPS.

En una instalación autoalojada, un administrador puede compartir un enlace que abre el cuadro de diálogo **Add custom connector** con el nombre y la dirección ya rellenados. Sustituya el final por la dirección de su propio servidor, codificada para URL (`:` se convierte en `%3A`, `/` en `%2F`):

```text
https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=KANAP&connectorUrl=https%3A%2F%2Fkanap.example.com%2Fapi%2Fai%2Fmcp
```

#### Claude Team y Enterprise

Un Owner de la organización añade el conector personalizado una sola vez, con la dirección del servidor, para toda la organización de Claude. Después, cada miembro hace clic en **Connect** en el conector e inicia sesión con su propia cuenta de KANAP. Cada miembro ve solo sus propios datos de KANAP.

#### Claude Code

Añada el servidor sin clave:

```bash
claude mcp add --transport http kanap https://acme.kanap.net/api/ai/mcp
```

Después ejecute `claude mcp login kanap`, o simplemente use el servidor: Claude Code abre su navegador en la página de inicio de sesión de KANAP y luego en la misma pantalla descrita arriba. El navegador vuelve a su propio ordenador, así que KANAP no necesita ser accesible desde Internet: su ordenador llega a KANAP por HTTPS, y KANAP llega a `claude.ai` por HTTPS.

#### ChatGPT y Grok { #connecting-chatgpt-grok }

ChatGPT y Grok se conectan de la misma forma que Claude.

1. Añada KANAP como servidor MCP personalizado con la dirección del servidor:
    - **ChatGPT**: añada un servidor MCP personalizado o una aplicación personalizada. El menú depende de su plan y de su espacio de trabajo, y es posible que un administrador del espacio de trabajo tenga que permitirlo antes. Consulte [Developer mode and MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt).
    - **Grok**: abra `grok.com/connectors`, haga clic en **New Connector** y luego en **Custom**. En Grok Business y Enterprise, un administrador del equipo añade primero el conector en la consola de xAI. Consulte [Grok connectors](https://docs.x.ai/grok/connectors).
2. Inicie sesión en KANAP con su contraseña o con Microsoft.
3. KANAP muestra la misma pantalla que para Claude, con el nombre de la aplicación y el host al que vuelve (`chatgpt.com`, `grok.com` o `console.x.ai`).
4. Haga clic en **Autorizar**.

ChatGPT y Grok llaman a KANAP desde sus propios servidores, así que la dirección del servidor debe ser accesible desde Internet por HTTPS. KANAP también lee la descripción pública de cada aplicación en `chatgpt.com` o `grok.com` por HTTPS.

#### Recordar esta aplicación

La casilla **Recordar esta aplicación** está marcada por defecto. Si sigue marcada, la siguiente conexión de la misma aplicación por el mismo usuario es más rápida:

- Claude Code, que vuelve a su propio ordenador, se autoriza sin ninguna pantalla.
- Claude, Claude Desktop, ChatGPT y Grok muestran una pantalla corta con un único botón **Continuar**.

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

Claude Code también acepta una clave, por ejemplo en un equipo sin navegador, o cuando KANAP no puede llegar a `claude.ai`:

```bash
claude mcp add --transport http kanap https://acme.kanap.net/api/ai/mcp --header "Authorization: Bearer kanap_mcp_..."
```

### Herramientas disponibles

El servidor MCP es de solo lectura. Un cliente puede buscar y leer sus datos, sin poder cambiar nada. Una clave o una conexión obtiene las doce herramientas siguientes, y trece cuando la búsqueda web está activada para su organización. Una persona solo ve las herramientas de los datos que su rol le permite leer.

| Herramienta | Qué hace |
|---|---|
| `search_all` | Busca en todos los tipos de registro por palabra clave |
| `describe_entity_filters` | Enumera los filtros disponibles para un tipo de registro |
| `query_entities` | Enumera los registros que coinciden con unos filtros |
| `aggregate_entities` | Cuenta o suma registros, agrupados por un campo |
| `get_filter_values` | Enumera los valores posibles de un filtro |
| `get_application_classification_catalog` | Lee los niveles de clasificación de las aplicaciones: criticidad, tiempo máximo tolerable de interrupción, olas de recuperación |
| `get_entity_detail` | Lee un registro completo |
| `get_entity_context` | Lee los registros vinculados a un registro |
| `get_entity_comments` | Lee los comentarios de un proyecto o una tarea |
| `get_record_history` | Lee el historial de un registro, tal como lo muestra su pestaña Historial |
| `search_knowledge` | Busca en la base de conocimiento |
| `get_document` | Lee un documento de la base de conocimiento |
| `web_search` | Busca en la web, cuando la búsqueda web está activada para su organización |

Cuando un cliente se conecta, el servidor le indica qué espacio de trabajo lee, que solo lee, que lee con los derechos de la persona detrás de la clave o de la conexión, cómo buscar (centros de coste, calendarios y dimensiones incluidos), dónde leer los tipos de cambio y qué datos no lee (el registro de auditoría y los agentes de IA). Solo lee los roles y la configuración de acceso a los datos para una persona que administra los usuarios y tiene acceso a todos los datos.

Una llamada que el servidor rechaza vuelve con su causa, para que el asistente pueda explicarla: una herramienta desconocida, una herramienta que cambiaría datos, una herramienta que la clave no permite o datos que la persona no puede leer.

## Registro MCP { #mcp-journal }

La tarjeta **Registro MCP** enumera cada llamada a herramientas hecha por los clientes MCP de su organización, de la más reciente a la más antigua:

- **Fecha**
- **Persona**: el propietario de la clave o de la conexión
- **Clave o conexión**: el nombre de la clave, o la aplicación y su dominio para una conexión (*Claude · claude.ai*). *Clave eliminada* cuando la clave ya no existe
- **Herramienta**
- **Resultado**: **Completada**, **Rechazada** o **Fallida**, con la causa junto a un rechazo o un fallo (por ejemplo *El servidor es de solo lectura*, *La clave no permite esta herramienta*, *Clave revocada*)
- **Duración**: un guion cuando se desconoce

Filtre la lista por **Persona**, **Clave o conexión**, **Resultado** y **Periodo** (últimas 24 horas, últimos 7 días, últimos 30 días o todo el periodo). Muestra 25 llamadas por página. Use **Anterior** y **Siguiente** para pasar de una página a otra.

Haga clic en una línea para ver los argumentos que envió la llamada, acortados, y para un rechazo o un fallo su causa completa. Los valores secretos aparecen como *Oculto*.

El registro también guarda las llamadas hechas con una clave revocada o caducada. Nunca guarda una clave ni un token.

---

## Consejos

- **Deje Plaid en el modelo predeterminado salvo que tenga un motivo para no hacerlo.** Fijar el chat a un modelo concreto significa que deja de seguir al predeterminado de la organización: útil cuando el chat y los agentes necesitan realmente modelos distintos, y una molestia el resto del tiempo.
- **Es fácil subestimar el volumen del chat.** La página [Uso y costes](ai-usage.md) valora el chat a las tarifas del modelo asignado; un asistente muy usado con un modelo caro aparece allí mucho antes de aparecer en una factura.
- **Un modelo con visión es un requisito de los agentes, no del chat.** Si sus agentes de triaje necesitan leer capturas de pantalla de los tickets, eso corresponde al modelo de *ellos*: consulte **Comprende imágenes** en la página [Modelos IA](ai-models.md).
- **Prefiera las conexiones para Claude.** Cada persona inicia sesión con su propia cuenta y lee con su propio acceso, así que nadie comparte una clave. Reserve las claves para los clientes que las necesitan, rótelas y use **Vida útil máxima de la clave (días)** para imponer un tope que ninguna petición pueda superar.
- **Establezca una ventana de retención.** Conservar las conversaciones para siempre es conveniente hasta que la base de datos crece demasiado o una revisión de conformidad pregunta cuánto tiempo se conserva el contenido del chat: 90 o 180 días es un punto de partida habitual.
- **GLPI se configura en otro sitio.** La conexión de ticketing con la que trabajan sus agentes se configura en **Administración → Integraciones**, no aquí; consulte [Integraciones](integrations.md).
