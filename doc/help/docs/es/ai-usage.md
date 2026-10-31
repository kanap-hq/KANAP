# Uso y costes

Esta página responde a dos preguntas que un administrador se hace con frecuencia: *¿cuánta IA estamos usando?* y *¿cuánto nos está costando?* Cubre toda la organización (el [asistente de chat Plaid](ai-assistant.md) y todos los [agentes IA](agents-overview.md) juntos), con costes valorados a partir de los precios reales que registró en la página [Modelos IA](ai-models.md). Las cifras de conversaciones y tokens estaban antes al final de la página de configuración de Plaid; ahora viven aquí, junto al dinero.

## Dónde encontrarlo

- Espacio de trabajo: **Administración**
- Ruta: **Administración → Inteligencia artificial → Uso y costes**
- Ruta URL: `/admin/ai-usage`
- Permiso: `ai_settings:admin`

Todo lo de esta página es de solo lectura: es un informe, no un conjunto de controles. Dos ventanas temporales la recorren de principio a fin: **Mes actual** (desde el día 1) y **Últimos 30 días** (una ventana móvil). Rara vez coinciden, y ambas son útiles: el mes para los presupuestos, la ventana móvil para detectar un cambio de ritmo.

---

## Costes

Tres tarjetas en la parte superior:

- **Total este mes**: los agentes más Plaid, con la cifra de los últimos 30 días debajo.
- **Agentes este mes**: lo que costó realmente la flota de agentes, con la cifra de los últimos 30 días debajo.
- **Plaid este mes**: lo que costó el asistente de chat. En lugar de una cifra a 30 días, su pie muestra las notas que se describen más abajo.

Los costes se muestran en euros al céntimo, y con cuatro decimales cuando el importe es inferior a un céntimo: al principio, o con un modelo barato, un total real puede ser perfectamente `0,0034 €`.

**El coste de los agentes se mide.** Cada llamada al modelo que hace un agente registra sus tokens de entrada y de salida, valorados en ese mismo momento a las tarifas del modelo que ese agente estaba usando, y el resultado se conserva. Por eso importan los precios de [Modelos IA](ai-models.md), por eso un modelo registrado sin precios no aporta nada aquí y por eso editar un precio más tarde no reescribe lo que los agentes ya costaron. (Cuando un proveedor no devuelve sus propios recuentos de tokens, KANAP los estima a partir del tamaño del intercambio, de modo que una pequeña parte de la cifra puede ser aproximada.)

**El coste de Plaid también se mide.** Cada respuesta de Plaid registra el modelo que la produjo, los precios de ese modelo en ese momento y lo que costó la respuesta. Cambiar Plaid a otro modelo a mitad de mes o corregir un precio más tarde no modifica las respuestas ya registradas.

El coste tiene en cuenta la caché de prompts del proveedor. Con Anthropic, un token leído de la caché cuenta 0,1 veces el precio de entrada y un token escrito en ella, 1,25 veces. Con los demás proveedores no se conoce el descuento de la caché: los tokens en caché cuentan al precio de entrada completo y la cifra es un máximo.

Las respuestas registradas antes de que KANAP guardara su coste se valoran a las tarifas del modelo asignado hoy a Plaid. Cuando el mes contiene respuestas así, la tarjeta indica *Estimado en parte con las tarifas del modelo asignado actualmente*. Cuando la cifra es cero porque el modelo asignado no tiene precios, indica *El modelo asignado no tiene coste*. En los demás casos, la tarjeta no muestra ninguna nota.

El **Modelo incluido de KANAP** cuesta 0 € por diseño: forma parte de su suscripción. Una organización que funcione íntegramente con el modelo incluido verá ceros aquí, y en su lugar debería vigilar el volumen de mensajes incluidos en la página [Modelos IA](ai-models.md).

### Coste por agente y Coste por modelo

Debajo aparecen dos tablas en cuanto hay actividad de la que informar, cada una con una columna **Mes actual** y otra **Últimos 30 días**.

- **Coste por agente**: una fila por agente, para que vea cuál sale caro. Combínela con el tope **Coste por ejecución** del propio agente, en su [pestaña Configuración](agents-workspace.md), si alguna cifra le parece rara.
- **Coste por modelo**: el gasto de los agentes y de Plaid juntos, troceado por modelo y ordenado con el más caro de los últimos 30 días primero. Las filas son los identificadores de proveedor y modelo a los que se llamó realmente (`anthropic:claude-sonnet-5`, `ollama:mistral`), no los nombres amigables que usted les dio en la página [Modelos IA](ai-models.md). Cuando los agentes y Plaid usan el mismo modelo, comparten una fila. El modelo incluido de KANAP aparece con 0. Una fila etiquetada como **Modelo desconocido** corresponde a actividad antigua de agentes, registrada antes de que existiera la atribución de modelo por llamada.

**Coste por agente** cubre solo las ejecuciones de los agentes. **Coste por modelo** deja fuera las respuestas de Plaid registradas antes de que KANAP guardara su coste, por lo que su total puede ser inferior al de las tarjetas de arriba.

---

## Conversaciones

Entre las tablas de costes y la tabla de tokens hay cuatro tarjetas sin título, todas ellas sobre el asistente de chat:

- **Todas las conversaciones**: todas las conversaciones almacenadas actualmente. Si define un periodo de **Retención de conversaciones (días)** en la página de [configuración de Plaid](ai-settings.md), las conversaciones acaban purgándose y dejan de contar aquí.
- **Conversaciones activas (7d)** y **Conversaciones activas (30d)**: conversaciones actualizadas en los últimos 7 o 30 días.
- **Usuarios activos (30d)**: cuántas personas distintas usaron realmente el chat en los últimos 30 días. La cifra de adopción más honesta de la página.

---

## Uso de tokens

Una tabla, dos filas (**Mes actual** y **Últimos 30 días**) con **Tokens de entrada**, **Tokens de salida**, **Tokens totales** y **Mensajes de usuario** (el número de preguntas hechas en esa ventana).

**Esta tabla trata del chat, no de los agentes.** Son los tokens del asistente Plaid: el recuento de entrada incluye los tokens servidos desde la caché del proveedor. El consumo de los agentes no se cuenta aquí: aparece en **Coste por agente** y en **Mensajes de los agentes**, más abajo. Conviene recordarlo cuando funciona con el modelo incluido o con uno local, donde el coste siempre es cero pero el consumo sigue sin serlo.

---

## Mensajes de los agentes (este mes)

Una tarjeta por agente, empezando por el más activo. **Todos los agentes** da el recuento combinado de tickets revisados este mes, y después cada agente muestra el suyo, con la cifra de los últimos 30 días como pie. Aparecen todos los agentes que tenga, incluidos los que aún no han hecho nada: una tarjeta parada en 0 ya es algo digno de atención. Los agentes archivados quedan fuera.

Esta es la vista, para toda la organización, de lo que el espacio de cada agente muestra individualmente. Léala junto a **Coste por agente**: un agente con muchos mensajes y poco coste funciona con un modelo gratuito o barato; un agente con pocos mensajes y mucho coste hace un trabajo caro por ticket y merece un vistazo.

---

## Consejos

- **Compare las dos ventanas, no solo los totales.** *Mes actual* a día 3 del mes parece minúsculo; la cifra móvil de 30 días que tiene al lado es la que le dice si algo ha cambiado realmente.
- **Precios dentro, costes fuera.** Estas cifras solo son tan buenas como los precios de la página [Modelos IA](ai-models.md). Si un coste parece imposiblemente bajo, compruebe que el modelo tenga precios: un campo de precio vacío se lee como gratuito.
- **Cuente con una diferencia respecto a la factura de su proveedor.** Las cifras usan los precios que usted introdujo en la página [Modelos IA](ai-models.md) y, con proveedores distintos de Anthropic, cuentan los tokens en caché al precio de entrada completo.
- **Use Coste por modelo cuando esté sopesando un cambio.** Muestra lo que le cuesta realmente cada modelo en sus agentes y en Plaid, que es la cifra que hay que comparar antes de mover trabajo a uno más barato.
- **Coste cero no es uso cero.** Con el modelo incluido o con uno local, todas las cifras de coste se quedan en 0 €: **Mensajes de los agentes** es donde se ve la carga de los agentes, y la tabla de tokens es donde se ve la del chat.
