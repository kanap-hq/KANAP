# Plaid

Plaid es el asistente de chat integrado de KANAP. Está conectado a los mismos datos con los que ya trabaja — aplicaciones, activos, incidentes, proyectos, solicitudes, tareas, contratos, documentos de la base de conocimiento y datos maestros — para que pueda hacer preguntas en lenguaje sencillo en lugar de hacer clic por varias pantallas para encontrar una respuesta.

Plaid no reemplaza al resto de la aplicación. Es una forma más rápida de resumir contexto, localizar registros, redactar texto o preparar cambios. Las operaciones sensibles siempre se muestran como vistas previas que debe aprobar antes de que se escriba nada de vuelta en KANAP.

!!! note "Plaid frente a Agentes IA"
    Plaid es el asistente interactivo que **usted** dirige: usted pregunta, él responde y usted aprueba los cambios de uno en uno. Los **Agentes IA** son distintos: son ayudantes autónomos que vigilan su centro de servicios y proponen o gestionan el trabajo con tickets por su cuenta, dentro de los límites de aprobación que usted defina. Consulte [Agentes IA — Vista general](agents-overview.md).

## Dónde encontrarlo

- Espacio de trabajo: **Plaid** (navegación superior)
- Ruta: `/ai`
- Permiso: `ai_chat:reader` le permite abrir el espacio de trabajo del chat e iniciar conversaciones
- Indicador de funcionalidad: requiere que la superficie de chat esté habilitada en su instancia. Si está desactivada, el espacio de trabajo muestra un aviso en lugar de la interfaz del chat.

El espacio de trabajo también está disponible para los administradores con `ai_chat:admin`, que pueden ver y moderar todo lo que hacen los usuarios habituales.

!!! note "A la espera de un administrador"
    En el servicio alojado, Plaid puede funcionar con el modelo incluido de KANAP. Antes, un administrador confirma el proveedor y el lugar donde trata los datos. Hasta entonces, el espacio de trabajo muestra *Un administrador debe confirmar el proveedor de IA en Administración > Plaid.* en lugar del chat. Un administrador lo hace en la página [Configuración de Plaid](ai-settings.md#confirmar-el-modelo-incluido-de-kanap). Las organizaciones que usan un modelo propio nunca ven este aviso.

## Iniciar una conversación

Cuando abre Plaid por primera vez, llega a una pantalla de bienvenida con:

- Un breve eslogan ("Plaid está listo") y una descripción de lo que puede preguntar
- Una sección **Para comenzar** con ejemplos de preguntas en los que puede hacer clic para enviarlos
- El cuadro de redacción en la parte inferior, listo para aceptar su primer mensaje

Haga clic en cualquier sugerencia para enviarla directamente o — en el caso de las preguntas que contienen un marcador `@` — colocar la sugerencia en el cuadro de redacción para que pueda terminarla.

Escriba un mensaje y pulse **Intro** para enviarlo. **Mayús+Intro** inserta un salto de línea. El botón de enviar se desactiva cuando no hay nada que enviar y se transforma en un botón rojo **Detener** mientras Plaid responde.

## La lista de conversaciones

La barra lateral izquierda muestra sus conversaciones anteriores. Use el icono de menú en la parte superior izquierda del área de chat para contraerla o expandirla.

La lista contiene:

- Un botón **Nueva conversación** en la parte superior
- Un campo de búsqueda que aparece en cuanto tiene al menos una conversación
- Conversaciones agrupadas por fecha: **Hoy**, **Ayer**, **Últimos 7 días**, **Más antiguo**

Cada fila muestra el título de la conversación (o **Sin título** cuando aún no se ha definido ninguno). Pase el cursor por encima de una fila o sitúe el foco en ella para mostrar:

- Un icono de lápiz — **Renombrar** la conversación. Haga doble clic en el título para hacer lo mismo.
- Un icono de papelera — **Archivar** la conversación. Las conversaciones archivadas desaparecen de la lista. Si archiva la conversación que tiene abierta en ese momento, Plaid cambia a un chat vacío nuevo.

La búsqueda filtra la lista por título a medida que escribe. El cambio de nombre y el archivado se guardan de inmediato.

## Escribir un mensaje

El cuadro de redacción es el principal punto de control del espacio de trabajo. Admite:

- Texto de varias líneas, hasta 10 filas visibles antes de que se desplace
- Adjuntos de imágenes en línea (PNG, JPG, GIF, WEBP)
- Menciones con `@` de registros de KANAP
- Un recordatorio de atajos de teclado ("Intro para enviar · Mayús+Intro para nueva línea")

### Adjuntar imágenes

Puede añadir imágenes de tres maneras:

- Haga clic en el icono de clip y seleccione archivos de su ordenador
- Arrastre y suelte archivos de imagen sobre el cuadro de redacción (una superposición de ayuda confirma la zona de destino)
- Pegue una imagen directamente desde el portapapeles

Cada imagen pendiente aparece como una miniatura encima del texto. Haga clic en la pequeña **X** de una miniatura para quitarla. Existe un límite de adjuntos por mensaje; una vez alcanzado, el clip se desactiva hasta que quite o envíe los adjuntos actuales.

Las imágenes se cargan junto con su mensaje para que Plaid pueda describirlas, compararlas o extraer detalles.

### Mencionar registros con `@`

Escribir `@` abre el **selector de menciones** encima del cuadro de redacción. Le permite hacer referencia a cualquier registro de KANAP al que tenga acceso, con dos modos complementarios:

- **Prefijo de tipo**: códigos cortos que corresponden a una única familia de entidades. Ejemplos:
  - `@T-5` — tarea con la referencia T-5
  - `@DOC` — documentos de la base de conocimiento recientes
  - `@APP backup` — aplicaciones que coinciden con "backup"
  - `@PRJ`, `@REQ`, `@INC`, `@AST`, `@CONN`, `@INT`, `@LOC`, `@CTR`, `@CPX`, `@COMP`, `@CONT`, `@DEPT`, `@SUP`, `@BP`
- **Texto simple**: cualquier otra cosa (`@payroll`, `@server-2`) ejecuta una búsqueda entre tipos ordenada por relevancia. También encuentra las líneas OPEX y CAPEX por el nombre de sus valores analíticos.

Use las teclas de flecha para desplazarse por las sugerencias, **Intro** o **Tab** para confirmar y **Escape** para cerrar el selector. Los resultados se agrupan por tipo de entidad (Conocimiento, Tareas, Proyectos, Aplicaciones, Activos, Contratos, etc.) para que pueda distinguir de un vistazo qué tipo de registro va a insertar.

Cuando confirma una sugerencia, el cuadro de redacción sigue mostrando una etiqueta legible (`@DOC-152`, `@SAP S/4HANA`). Cuando se envía el mensaje, cada mención se expande en un enlace real que Plaid puede seguir hasta el registro de origen.

### Editar o regenerar un mensaje

Pase el cursor sobre cualquiera de sus mensajes anteriores para obtener acciones a nivel de mensaje:

- **Copiar** — copia el texto del mensaje al portapapeles
- **Editar** — vuelve a abrir el mensaje en un editor en línea; al guardar se envía la nueva versión y se trunca todo lo que vino después (la conversación se vuelve a ejecutar desde ese punto)
- **Regenerar** (en las respuestas del asistente) — pide a Plaid que produzca otra respuesta a la misma pregunta

Editar es la herramienta adecuada cuando se da cuenta de que su pregunta anterior no era clara. Regenerar es la herramienta adecuada cuando la pregunta estaba bien pero la respuesta no.

## Cómo responde Plaid

Plaid va mostrando su respuesta carácter a carácter. Mientras la genera:

- El cuadro de redacción sigue disponible para que pueda preparar una pregunta de seguimiento
- El botón de enviar muestra un icono rojo **Detener** — al hacer clic se cancela la respuesta en curso
- Aparece un pequeño indicador "Usando herramientas…" cuando Plaid busca en KANAP, obtiene un documento o ejecuta otra llamada a herramienta
- El número y el tipo de herramientas utilizadas se resumen debajo de la respuesta una vez completada

Cuando termina la generación, el foco vuelve al cuadro de redacción para que pueda continuar la conversación sin recurrir al ratón.

### Llamadas a herramientas

Plaid usa un pequeño conjunto de herramientas internas para responder preguntas: `Search all`, `Search knowledge`, `Get document`, `Get entity context` y algunas otras. Cada llamada a herramienta aparece como una línea compacta debajo del mensaje ("ha usado Buscar todo · 8 resultados"). Normalmente no necesita leer los detalles de las herramientas, pero están ahí si quiere ver exactamente en qué registros se basó la respuesta.

`Search all` encuentra las líneas OPEX y CAPEX por el nombre de sus valores analíticos e indica a Plaid qué valores tiene cada línea.

## Artefactos y vistas previas

Algunas respuestas incluyen material adicional que no encaja de forma natural dentro del hilo de chat. KANAP los llama **artefactos**.

Casos habituales:

- Un bloque largo de texto o markdown que Plaid preparó para usted
- Una comparación **Antes / Después** en paralelo de un registro que Plaid quiere actualizar
- Un borrador de importación o conjunto de cambios que requiere su aprobación

Los artefactos se abren en un panel lateral a la derecha del espacio de trabajo. El panel se puede mostrar u ocultar haciendo clic en el botón de pestaña **Artefactos** en el borde derecho de la pantalla.

El panel se abre automáticamente cuando:

- Llega una vista previa larga durante una respuesta en streaming
- Una vista previa pendiente necesita su decisión (estas siempre abren el panel, ya que debe actuar sobre ellas)

Para las vistas previas de cambios pendientes, el panel ofrece dos botones:

- **Aprobar** — confirma el cambio y permite que Plaid lo aplique
- **Rechazar** — cancela el cambio. Plaid confirma el rechazo y continúa la conversación.

Nada que modifique los datos de KANAP se aplica de forma silenciosa. La vista previa es la barrera de control.

## Indicadores de uso

Encima del cuadro de redacción, dos pequeños indicadores le ayudan a estar al tanto del coste y los límites:

- **Uso integrado**: cuando Plaid funciona con el modelo incluido de KANAP en lugar de con uno de los modelos propios de su organización, esto muestra cuántos mensajes quedan en el mes actual y la fecha en la que se restablece la cuota. Un administrador ha confirmado ese modelo antes (consulte [Configuración de Plaid](ai-settings.md#confirmar-el-modelo-incluido-de-kanap)). Cuando se alcanza el límite, el cuadro de redacción se desactiva y un texto de ayuda invita a los administradores a cambiar a un modelo propio; consulte [Modelos IA](ai-models.md).
- **Uso de tokens**: una barra fina con contadores de tokens de entrada/salida para la conversación actual, además del tamaño de la última solicitud. Las conversaciones largas se vuelven más caras con el tiempo; la barra hace visible ese coste para que pueda decidir cuándo iniciar un nuevo hilo.

La barra de uso de tokens solo aparece una vez que la conversación tiene al menos un intercambio.

## Consejos

- **Use prefijos para mayor precisión**: `@T-`, `@DOC-`, `@PRJ-`, `@REQ-`, `@INC-` corresponden directamente a las referencias nativas de KANAP. Son la forma más rápida de apuntar Plaid a un registro concreto y sobreviven al copiar y pegar porque son idénticos a lo que ve en el resto de la aplicación.
- **Inicie una nueva conversación por tema**: mantener las preguntas no relacionadas en conversaciones separadas reduce la ventana de contexto, acelera las respuestas y disminuye el gasto en tokens. La lista de conversaciones está agrupada por fecha para que pueda encontrarlas de nuevo con facilidad.
- **Apruebe y rechace con criterio**: las vistas previas son lo único que se interpone entre Plaid y sus datos reales. Tómese el segundo extra para leer la comparación antes de hacer clic en **Aprobar**.
- **Detenga en lugar de esperar**: si Plaid toma un camino equivocado a mitad de la generación, pulse el botón **Detener** en lugar de esperar a que termine. Ahorrará tokens y su siguiente mensaje puede corregir el rumbo.
- **Suelte las imágenes directamente**: arrastrar una captura de pantalla sobre el cuadro de redacción es más rápido que el selector de archivos, y pegar desde el portapapeles también funciona. Úselo al describir un problema de interfaz o al pedir a Plaid que lea un gráfico.
