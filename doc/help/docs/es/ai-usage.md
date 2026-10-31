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

- **Total este mes**: los agentes más Plaid, con la cifra de los últimos 30 días debajo. Los costes de los agentes se miden por llamada. Los costes de Plaid se miden por mensaje, y un mensaje que no registró sus tarifas se estima con el modelo de hoy (véase más abajo).
- **Agentes este mes**: lo que costó realmente la flota de agentes, con la cifra de los últimos 30 días debajo.
- **Plaid este mes**: lo que costó el asistente de chat. Esta tarjeta usa su pie para la advertencia sobre la estimación que se explica más abajo, en lugar de para una cifra a 30 días.

Los costes se muestran en euros al céntimo, y con cuatro decimales cuando el importe es inferior a un céntimo: al principio, o con un modelo barato, un total real puede ser perfectamente `0,0034 €`.

**El coste de los agentes se mide.** Cada llamada al modelo que hace un agente registra sus tokens de entrada y de salida, valorados en ese mismo momento a las tarifas del modelo que ese agente estaba usando, y el resultado se conserva. Por eso importan los precios de [Modelos IA](ai-models.md), por eso un modelo registrado sin precios no aporta nada aquí y por eso editar un precio más tarde no reescribe lo que los agentes ya costaron. (Cuando un proveedor no devuelve sus propios recuentos de tokens, KANAP los estima a partir del tamaño del intercambio, de modo que una pequeña parte de la cifra puede ser aproximada.)

**Plaid se valora mensaje a mensaje**, y la tarjeta lo dice: *Tarifas registradas con cada mensaje. Los mensajes anteriores usan las del modelo asignado actualmente.* Cada mensaje del asistente conserva el proveedor, el modelo y las tarifas aplicadas cuando se escribió, y el mes suma esos importes. Un mensaje escrito antes de ese registro no tiene tarifas propias: KANAP lo valora con el modelo asignado a Plaid hoy. Corregir un precio en la página [Modelos IA](ai-models.md) deja igual un mensaje que ya guardó sus tarifas, y solo mueve la cifra de esos mensajes anteriores. Si el modelo asignado es gratuito y ningún mensaje registró un precio, el pie cambia a *El modelo asignado no tiene coste* y la cifra es cero.

El **Modelo incluido de KANAP** cuesta 0 € por diseño: forma parte de su suscripción. Una organización que funcione íntegramente con el modelo incluido verá ceros aquí, y en su lugar debería vigilar el volumen de mensajes incluidos en la página [Modelos IA](ai-models.md).

### Coste por agente y Coste por modelo

Debajo aparecen dos tablas en cuanto hay actividad de agentes de la que informar, cada una con una columna **Mes actual** y otra **Últimos 30 días**.

- **Coste por agente**: una fila por agente, para que vea cuál sale caro. Combínela con el tope **Coste por ejecución** del propio agente, en su [pestaña Configuración](agents-workspace.md), si alguna cifra le parece rara.
- **Coste por modelo**: el mismo gasto troceado por modelo, ordenado con el más caro de los últimos 30 días primero. Las filas son los identificadores de proveedor y modelo a los que se llamó realmente (`anthropic:claude-sonnet-5`, `ollama:mistral`), no los nombres amigables que usted les dio en la página [Modelos IA](ai-models.md). Una fila etiquetada como **Modelo desconocido** corresponde a actividad antigua, registrada antes de que existiera la atribución de modelo por llamada.

Ambas tablas cubren las **ejecuciones de los agentes**. La cifra de Plaid no se desglosa aquí: aparece únicamente en la tarjeta **Plaid este mes**.

---

## Conversaciones

Entre las tablas de costes y la tabla de tokens hay cuatro tarjetas sin título, todas ellas sobre el asistente de chat:

- **Todas las conversaciones**: todas las conversaciones almacenadas actualmente. Si define un periodo de **Retención de conversaciones (días)** en la página de [configuración de Plaid](ai-settings.md), las conversaciones acaban purgándose y dejan de contar aquí.
- **Conversaciones activas (7d)** y **Conversaciones activas (30d)**: conversaciones actualizadas en los últimos 7 o 30 días.
- **Usuarios activos (30d)**: cuántas personas distintas usaron realmente el chat en los últimos 30 días. La cifra de adopción más honesta de la página.

---

## Uso de tokens

Una tabla, dos filas (**Mes actual** y **Últimos 30 días**) con **Tokens de entrada**, **Tokens de salida**, **Tokens totales** y **Mensajes de usuario** (el número de preguntas hechas en esa ventana).

**Esta tabla trata del chat, no de los agentes.** Son los tokens del asistente Plaid. La tarjeta **Plaid este mes** valora cada mensaje a partir de estos tokens y de las tarifas registradas con ese mensaje. El consumo de los agentes no se cuenta aquí: aparece en **Coste por agente** y en **Mensajes de los agentes**, más abajo. Conviene recordarlo cuando funciona con el modelo incluido o con uno local, donde el coste siempre es cero pero el consumo sigue sin serlo.

---

## Mensajes de los agentes (este mes)

Una tarjeta por agente, empezando por el más activo. **Todos los agentes** da el recuento combinado de tickets revisados este mes, y después cada agente muestra el suyo, con la cifra de los últimos 30 días como pie. Aparecen todos los agentes que tenga, incluidos los que aún no han hecho nada: una tarjeta parada en 0 ya es algo digno de atención. Los agentes archivados quedan fuera.

Esta es la vista, para toda la organización, de lo que el espacio de cada agente muestra individualmente. Léala junto a **Coste por agente**: un agente con muchos mensajes y poco coste funciona con un modelo gratuito o barato; un agente con pocos mensajes y mucho coste hace un trabajo caro por ticket y merece un vistazo.

---

## Consejos

- **Compare las dos ventanas, no solo los totales.** *Mes actual* a día 3 del mes parece minúsculo; la cifra móvil de 30 días que tiene al lado es la que le dice si algo ha cambiado realmente.
- **Precios dentro, costes fuera.** Estas cifras solo son tan buenas como los precios de la página [Modelos IA](ai-models.md). Si un coste parece imposiblemente bajo, compruebe que el modelo tenga precios: un campo de precio vacío se lee como gratuito.
- **Lea la cifra de Plaid a partir de las tarifas registradas en cada mensaje.** Un mensaje del asistente conserva las tarifas aplicadas cuando se escribió. Un mensaje guardado antes usa el modelo asignado hoy, y la tarjeta lo dice. Cambiar un precio más tarde solo mueve esa parte anterior de la cifra.
- **Use Coste por modelo cuando esté sopesando un cambio.** Muestra lo que le cuesta realmente cada modelo en el conjunto de sus agentes, que es la cifra que hay que comparar antes de mover trabajo a uno más barato.
- **Coste cero no es uso cero.** Con el modelo incluido o con uno local, todas las cifras de coste se quedan en 0 €: **Mensajes de los agentes** es donde se ve la carga de los agentes, y la tabla de tokens es donde se ve la del chat.
