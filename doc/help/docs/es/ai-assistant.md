# Kad

Kad es el asistente de chat integrado de Kadratis. Está conectado a los mismos datos con los que ya trabaja (aplicaciones, activos, tecnologías, incidentes, proyectos, solicitudes, tareas, contratos, documentos de la base de conocimiento y datos maestros), para que pueda hacer preguntas en lenguaje sencillo en lugar de hacer clic por varias pantallas para encontrar una respuesta.

Kad no reemplaza al resto de la aplicación. Es una forma más rápida de resumir contexto, localizar registros, redactar texto o preparar cambios. Las operaciones sensibles siempre se muestran como vistas previas que debe aprobar antes de que se escriba nada de vuelta en Kadratis.

!!! note "Kad frente a Agentes IA"
    Kad es el asistente interactivo que **usted** dirige: usted pregunta, él responde y usted aprueba los cambios de uno en uno. Los **Agentes IA** son distintos: son ayudantes autónomos que vigilan su centro de servicios y proponen o gestionan el trabajo con tickets por su cuenta, dentro de los límites de aprobación que usted defina. Consulte [Agentes IA: vista general](agents-overview.md).

## Dónde encontrarlo

- Espacio de trabajo: **Kad** (navegación superior)
- Ruta: `/ai`
- Permiso: `ai_chat:reader` le permite abrir el espacio de trabajo del chat e iniciar conversaciones
- Indicador de funcionalidad: requiere que la superficie de chat esté habilitada en su instancia. Si está desactivada, el espacio de trabajo muestra un aviso en lugar de la interfaz del chat.

El espacio de trabajo también está disponible para los administradores con `ai_chat:admin`, que pueden ver y moderar todo lo que hacen los usuarios habituales.

### Antes de aceptar el modelo incluido { #included-model-acceptance }

En el servicio alojado, Kad puede funcionar con el modelo incluido de Kadratis. Antes, un administrador acepta el proveedor y el lugar donde trata los datos. Los nuevos espacios de trabajo en prueba empiezan en este estado, con Kad desactivado.

Hasta entonces, la página de Kad se abre con normalidad, con sus sugerencias. Una casilla ocupa el lugar del campo de mensaje: *Acepto que {proveedor} ({lugar}) trate mis preguntas y los datos a los que se refieren para las respuestas de Kad. No se usan para entrenar sus modelos.*, seguida de *Otro modelo o desactivación: Administración › Kad*.

- Un administrador de la configuración de Kad marca la casilla. Esto activa Kad y registra la aceptación, con quién y cuándo. A continuación aparece el campo de mensaje.
- Las demás personas leen *Kad espera a que un administrador lo active.*

Los administradores también pueden aceptar en la página [Configuración de Kad](ai-settings.md#confirmar-el-modelo-incluido-de-kanap). Las organizaciones que usan un modelo propio nunca ven esta casilla.

!!! note "Chat desactivado"
    Cuando un administrador desactiva el chat en **Administración › Kad**, una persona que puede usar el chat sigue abriendo esta página, y la entrada Kad permanece en la navegación superior. La página dice *Kad está desactivado para este espacio de trabajo.* Un administrador del asistente también ve *Actívelo en Administración › Kad*, que abre la configuración de Kad. Las demás personas ven *Pida a un administrador que lo active.* Una persona sin el permiso de chat ve la página de acceso denegado. Mientras el modelo incluido espera su aceptación, la página muestra en su lugar la casilla de aceptación, incluso con el chat desactivado: véase [Antes de aceptar el modelo incluido](#included-model-acceptance).

## Iniciar una conversación

Cuando abre Kad por primera vez, llega a una pantalla de bienvenida con:

- Un breve eslogan ("Kad está listo") y una descripción de lo que puede preguntar
- Una sección **Para comenzar** con ejemplos de preguntas en los que puede hacer clic para enviarlos
- El cuadro de redacción en la parte inferior, listo para aceptar su primer mensaje

Haga clic en cualquier sugerencia para enviarla directamente o, en el caso de las preguntas que contienen un marcador `@`, colocar la sugerencia en el cuadro de redacción para que pueda terminarla.

Cuando se eligió un recorrido para el espacio de trabajo en su primera apertura, durante la prueba, las sugerencias empiezan por sus dos preguntas, entre las que usted puede leer, y luego las habituales, cinco como máximo:

| Recorrido | Preguntas |
|---|---|
| Presupuesto de TI | *¿Cuáles son las principales oportunidades de ahorro en el OPEX de TI?*, *¿Qué líneas presupuestarias no tienen responsable?* |
| Mapa del SI | *¿Qué tecnologías llegan al fin de soporte en los próximos seis meses?*, *¿Qué aplicaciones críticas no tienen plan de recuperación?* |
| Proyectos y solicitudes | *¿Qué proyectos superan su presupuesto?*, *¿Qué solicitudes esperan una decisión?* |

Escriba un mensaje y pulse **Intro** para enviarlo. **Mayús+Intro** inserta un salto de línea. El botón de enviar se desactiva cuando no hay nada que enviar y se transforma en un botón rojo **Detener** mientras Kad responde.

## La lista de conversaciones

La barra lateral izquierda muestra sus conversaciones anteriores. Use el icono de menú en la parte superior izquierda del área de chat para contraerla o expandirla.

La lista contiene:

- Un botón **Nueva conversación** en la parte superior
- Un campo de búsqueda que aparece en cuanto tiene al menos una conversación
- Conversaciones agrupadas por fecha: **Hoy**, **Ayer**, **Últimos 7 días**, **Más antiguo**

Cada fila muestra el título de la conversación (o **Sin título** cuando aún no se ha definido ninguno). Pase el cursor por encima de una fila o sitúe el foco en ella para mostrar:

- Un icono de lápiz: **Renombrar** la conversación. Haga doble clic en el título para hacer lo mismo.
- Un icono de papelera: **Eliminar** la conversación. La conversación y sus mensajes se eliminan. Esta acción no se puede deshacer. Si elimina la conversación que tiene abierta en ese momento, Kad cambia a un chat vacío nuevo.

La búsqueda filtra la lista por título a medida que escribe. El cambio de nombre y la eliminación se guardan de inmediato.

## Escribir un mensaje

El cuadro de redacción es el principal punto de control del espacio de trabajo. Admite:

- Texto de varias líneas, hasta 10 filas visibles antes de que se desplace
- Adjuntos: imágenes (PNG, JPG, GIF, WEBP) y hojas de cálculo (.xlsx, CSV)
- Menciones con `@` de registros de Kadratis
- Un recordatorio de atajos de teclado ("Intro para enviar · Mayús+Intro para nueva línea")

### Adjuntar imágenes y hojas de cálculo

Puede adjuntar imágenes (PNG, JPG, GIF, WEBP) y hojas de cálculo: libros de Excel (.xlsx) y archivos CSV. Hay tres maneras de añadirlos:

- Haga clic en el icono de clip (**Adjuntar un archivo**) y seleccione archivos de su ordenador
- Arrastre y suelte archivos sobre el cuadro de redacción (una superposición de ayuda confirma la zona de destino)
- Pegue un archivo directamente desde el portapapeles

Cada imagen pendiente aparece como una miniatura encima del texto. Cada hoja de cálculo pendiente aparece como un pequeño mosaico con su nombre y su tamaño. Haga clic en la pequeña **X** para quitar uno. Un mensaje admite hasta 8 adjuntos, entre imágenes y hojas de cálculo. Una vez alcanzado el límite, el clip se desactiva hasta que quite o envíe los adjuntos actuales.

Las imágenes se cargan junto con su mensaje para que Kad pueda describirlas, compararlas o extraer detalles.

Kadratis lee una hoja de cálculo cuando usted envía el mensaje:

- Un archivo puede tener hasta 5 MB y 20 000 filas. Solo se lee la primera hoja de un libro.
- Un archivo que no se puede leer (dañado, vacío, formato .xls antiguo, demasiado grande) se rechaza de inmediato, con el motivo. El mensaje no se envía.
- Kad recibe un resumen del archivo: los encabezados de columna, el tipo de cada columna (texto, número o fecha), las diez primeras filas y el número de filas. Puede describir el archivo, decir qué contiene cada columna y detectar problemas en las primeras filas. No puede responder sobre las filas posteriores a las diez primeras.
- El resumen queda adjunto al mensaje durante el resto de la conversación.

### Importar una hoja de cálculo

Adjunte una hoja de cálculo y pida a Kad que la importe en una lista de Kadratis: aplicaciones, activos, proyectos, solicitudes, tareas, incidentes, líneas presupuestarias, contratos, proveedores, contactos, empresas, departamentos, centros de coste, cuentas, valores de dimensiones analíticas, procesos de negocio, calendarios laborales, o los vínculos de las tecnologías con los servidores y las aplicaciones. Kad relaciona las columnas de su archivo con las columnas de la importación de la lista y muestra una vista previa:

- Cada columna de la importación, con la columna del archivo que lee (o un mismo valor para todas las filas), la confianza de Kad y cuántos valores leyó. Después, los valores que no pudo leer, las columnas del archivo que deja fuera, lo que supuso y las primeras filas tal como se importarán.
- La **Comprobación de la importación**: la misma comprobación que la importación de la lista. Cuenta las filas que se crearán y las que se actualizarán, y lista los errores y las advertencias con los números de línea de su archivo.
- Cuando la comprobación encuentra errores, **Aprobar** no está disponible. Diga a Kad qué significa un valor, o corrija su archivo y adjúntelo de nuevo. Kad prepara una nueva vista previa, que sustituye a la anterior.
- **Aprobar** ejecuta la importación con sus propios derechos, como lo haría la importación de la lista. Necesita el mismo derecho que para esa importación: `applications:admin` para importar aplicaciones, `incidents:contributor` para importar incidentes. Un acceso de solo lectura se rechaza. La vista previa muestra después lo que se creó y se actualizó.
- Un archivo de presupuesto crea los proveedores que nombra y que Kadratis aún no tiene, como la importación de la lista con **Crear los proveedores que faltan** marcada: la comprobación los lista. Para ello hace falta el derecho de crear proveedores (`suppliers:member`); sin él, la comprobación los señala como errores. Una línea nueva sin empresa la paga la empresa de su centro de coste, o la única empresa del espacio de trabajo.
- En las aplicaciones, los activos, los proyectos, las solicitudes, las tareas y los incidentes, una celda vacía conserva el valor ya guardado en un registro que el archivo actualiza.
- Los contratos, proveedores, contactos, empresas, departamentos, centros de coste, cuentas, valores de dimensiones analíticas, procesos de negocio, calendarios laborales y vínculos de tecnologías sustituyen todos los valores de un registro que actualizan. Cuando filas del archivo corresponden a registros existentes y al archivo le faltan columnas de la importación, la comprobación señala un error y la vista previa no se puede aprobar, porque esos valores se vaciarían. Asocie las columnas que faltan, o deje en el archivo solo registros nuevos.
- El botón **Descargar el archivo (.xlsx)**, junto a **Rechazar**, da el archivo que Kad preparó, en .xlsx con el formato de la importación de la lista: las columnas de la importación, sus valores tal como los lee la importación (códigos de lista, fechas), una fila por cada fila de su archivo. En las importaciones que sustituyen todos los valores, el archivo tiene todas las columnas de la importación, vacías donde su archivo no tenía ninguna. Complete los valores que faltan e importe el archivo con el botón **Importar** de la lista. El [Registro de auditoría](admin.md#registro-de-auditoria) anota cada descarga, como cualquier exportación.
- En las líneas presupuestarias, cada fila del archivo crea una nueva línea. Los proveedores que nombra el archivo deben existir ya: Kad no los crea.
- El [Registro de auditoría](admin.md#registro-de-auditoria) anota cada importación hecha con Kad, con el nombre del archivo y los recuentos, bajo el origen **Chat de IA**.
- El modelo de IA solo recibe el resumen del archivo (encabezados, tipos de columna, diez primeras filas) y los recuentos de la comprobación, con el código y la columna de cada error. Las demás celdas y los mensajes de la importación se quedan en la vista previa.

### Mencionar registros con `@`

Escribir `@` abre el **selector de menciones** encima del cuadro de redacción. Le permite hacer referencia a cualquier registro de Kadratis al que tenga acceso, con dos modos complementarios:

- **Prefijo de tipo**: códigos cortos que corresponden a una única familia de entidades. Ejemplos:
  - `@T-5`: tarea con la referencia T-5
  - `@DOC`: documentos de la base de conocimiento recientes
  - `@APP backup`: aplicaciones que coinciden con "backup"
  - `@BL-12`: la línea presupuestaria con la referencia BL-12. `@BL` solo lista líneas presupuestarias de ambos tipos. Los antiguos números siguen funcionando: `@OPX-12` o `@CPX-3` encuentra su línea
  - `@PRJ`, `@REQ`, `@INC`, `@TEC`, `@AST`, `@CONN`, `@INT`, `@LOC`, `@CTR`, `@COMP`, `@CONT`, `@DEPT`, `@SUP`, `@BP`
- **Texto simple**: cualquier otra cosa (`@payroll`, `@server-2`) ejecuta una búsqueda entre tipos ordenada por relevancia. También encuentra las líneas presupuestarias por el nombre de sus valores analíticos.

Use las teclas de flecha para desplazarse por las sugerencias, **Intro** o **Tab** para confirmar y **Escape** para cerrar el selector. Los resultados se agrupan por tipo de entidad (Conocimiento, Tareas, Proyectos, Aplicaciones, Activos, Contratos, etc.) para que pueda distinguir de un vistazo qué tipo de registro va a insertar.

Cuando confirma una sugerencia, el cuadro de redacción sigue mostrando una etiqueta legible (`@DOC-152`, `@SAP S/4HANA`). Cuando se envía el mensaje, cada mención se expande en un enlace real que Kad puede seguir hasta el registro de origen.

### Editar o regenerar un mensaje

Pase el cursor sobre cualquiera de sus mensajes anteriores para obtener acciones a nivel de mensaje:

- **Copiar**: copia el texto del mensaje al portapapeles
- **Editar**: vuelve a abrir el mensaje en un editor en línea; al guardar se envía la nueva versión y se trunca todo lo que vino después (la conversación se vuelve a ejecutar desde ese punto)
- **Regenerar** (en las respuestas del asistente): pide a Kad que produzca otra respuesta a la misma pregunta

Editar es la herramienta adecuada cuando se da cuenta de que su pregunta anterior no era clara. Regenerar es la herramienta adecuada cuando la pregunta estaba bien pero la respuesta no.

## Cómo responde Kad

Kad va mostrando su respuesta carácter a carácter. Mientras la genera:

- El cuadro de redacción sigue disponible para que pueda preparar una pregunta de seguimiento
- El botón de enviar muestra un icono rojo **Detener**. Al hacer clic se cancela la respuesta en curso
- Aparece un pequeño indicador "Usando herramientas…" cuando Kad busca en Kadratis, obtiene un documento o ejecuta otra llamada a herramienta
- El número y el tipo de herramientas utilizadas se resumen debajo de la respuesta una vez completada

Cuando termina la generación, el foco vuelve al cuadro de redacción para que pueda continuar la conversación sin recurrir al ratón.

Las imágenes almacenadas en Kadratis, como los archivos adjuntos, se muestran con normalidad. Una imagen alojada en otro sitio web no se carga por sí sola, ni en una respuesta, ni en sus propios mensajes, ni en la vista previa de un cambio propuesto. Aparece como un enlace con un icono de imagen: haga clic en él para abrir la imagen en una pestaña nueva. No se envía ninguna solicitud a ese sitio hasta que usted hace clic.

### Llamadas a herramientas { #tool-calls }

Kad usa un pequeño conjunto de herramientas internas para responder preguntas: `Search all`, `Search knowledge`, `Get document`, `Get entity context` y algunas otras. Cada llamada a herramienta aparece como una línea compacta debajo del mensaje ("ha usado Buscar todo · 8 resultados"). Normalmente no necesita leer los detalles de las herramientas, pero están ahí si quiere ver exactamente en qué registros se basó la respuesta.

Cuando pregunta cómo hacer algo en Kadratis, por ejemplo dónde está un ajuste o los pasos de una tarea, Kad lee el manual de usuario de su versión de Kadratis, en su idioma (`Explorar el manual de usuario`, `Leer el manual de usuario`). Describe las pantallas como lo hace el manual y enlaza la sección que ha leído en doc.kadratis.com.

`Search all` encuentra las líneas presupuestarias por el nombre de sus valores analíticos e indica a Kad qué valores tiene cada línea. Kad nombra una línea presupuestaria por su referencia `BL-12`, y sus enlaces abren la línea. Un número solo, como 21, designa `BL-21`. Los antiguos números siguen funcionando: `OPX-12` o `CPX-3` encuentra su línea.

Kad lee las líneas OPEX y CAPEX juntas. Una pregunta que no nombra ninguno de los dos tipos abarca ambos, y Kad puede filtrar o agrupar las líneas por tipo.

Kad lista y lee las tecnologías para los usuarios que pueden leer la infraestructura. Puede filtrarlas por familia, editor, versión, responsable, fin de soporte o número de servidores, y leer las versiones, los servidores, las aplicaciones, los responsables, los contactos de soporte, los enlaces web y el ajuste de las alertas de vulnerabilidad de una tecnología. También lee las dos vistas del informe [Fin de soporte](end-of-support.md#preguntar-al-asistente), así como la versión y las fechas de cada aplicación. Si se le pregunta por un servidor, una aplicación o una tecnología por su nombre, sin su referencia, también lee los registros relacionados. Pregunte, por ejemplo: «¿Qué tecnologías no tienen responsable de TI?» Los asistentes conectados por MCP obtienen las mismas respuestas.

Cuando se siguen las vulnerabilidades, Kad también lista, cuenta y lee las vulnerabilidades, para los usuarios que leen la infraestructura. Un elemento es una CVE en una versión de una tecnología, como en la página [Vulnerabilidades](vulnerabilities.md). Kad puede filtrarlas por gravedad, explotación, estado, alertas, tecnología, fecha de publicación, activo o aplicación. También puede conservar las tecnologías en uso en el parque, o las filas que ya no coinciden. Las cuenta por gravedad, por tecnología o por versión, en filas y en CVE distintas, como la página: «117 filas (112 CVE)». Salvo que pida otra cosa, Kad conserva las vulnerabilidades por revisar que están en las alertas, como la página. También dice cuándo leyó Kadratis la NVD y CVE.org por última vez, y si la última lectura falló. Los servidores y las aplicaciones que alcanza una vulnerabilidad siguen los vínculos directos, como los cuenta la página (consulte [Lo que Kadratis cuenta](vulnerabilities.md#what-kanap-counts)). En los activos y las aplicaciones, Kad lee cuántas vulnerabilidades quedan por revisar y cuántas son críticas o altas. Pregunte, por ejemplo: «¿Qué aplicaciones críticas están afectadas por una CVE explotada?» Los asistentes conectados por MCP obtienen las mismas respuestas.

Kad lista, cuenta y lee los incidentes. Los filtra por activo, aplicación o tecnología, los agrupa por registro vinculado o por mes y lee el tiempo de resolución. Un incidente restringido que usted no puede ver no aparece en ninguna parte. Consulte [Preguntar al asistente](incidents.md#preguntar-al-asistente).

Kad lee los contratos como los muestra la lista de [Contratos](contracts.md): el estado del periodo en curso (por decidir, en curso, renovado, termina sin renovación, vencido), el próximo vencimiento y la fecha límite de rescisión, con el plazo de decisión de su espacio de trabajo y las decisiones de renovación ya registradas. También lee lo que cubre un contrato: sus aplicaciones, activos, tecnologías y líneas presupuestarias. Pregunte, por ejemplo: «¿Qué contratos están por decidir y qué aplicaciones cubren?» o «¿Qué contratos cubren APP-8?» Los asistentes conectados por MCP obtienen las mismas respuestas.

Kad nombra un registro por su referencia, como `APP-8` o `BL-14`, o por su nombre cuando no tiene, como un contrato, un proveedor o una ubicación. La referencia o el nombre lleva a la página del registro cuando usted puede abrirla.

Kad nombra un registro vinculado al que usted consulta solo si puede leer su módulo, como la página del registro: las aplicaciones de un proyecto requieren las aplicaciones, sus activos la infraestructura, sus solicitudes de origen las solicitudes. Un Business Contributor solo obtiene los proyectos, solicitudes y aplicaciones en los que participa. Los servidores en los que se ejecuta una aplicación son la excepción: vienen con la aplicación, como en su pestaña **Despliegues**. Si se le pregunta por una persona, Kad da lo que le muestra la lista de usuarios: un administrador de usuarios obtiene el perfil completo, los demás el nombre, el correo electrónico y el estado. Los asistentes conectados por MCP obtienen las mismas respuestas.

Un administrador de usuarios con acceso a todos los datos lee con Kad lo que muestran **Administración › Roles** y **Administración › Acceso a los datos**. Kad lista los roles, el número de personas de cada uno y los derechos que da cada rol, con las palabras de la pantalla Roles. Indica quién está limitado a qué empresas, centros de coste o grupos, en Lectura o en Edición, quién está limitado sin ningún nodo y quién ve una empresa. La lista de usuarios incluye también todos los roles de una persona y su acceso. Pregunte, por ejemplo: «¿Quién está limitado a Alpha Spain, y con qué acceso?» o «¿Qué roles dan el nivel Administrador en presupuesto?» Una persona cuyo propio acceso está limitado no lee estos datos, aunque sea administradora de usuarios, y Kad lo indica. Kad no cambia nada de esto: el acceso a los datos de una persona, sus roles, los derechos de un rol y la creación o desactivación de una persona se quedan en las pantallas de **Administración**. Los asistentes conectados por MCP obtienen las mismas respuestas.

Kad lee el [historial](record-history.md) de un registro, tal como lo muestra su pestaña **Historial**, para cualquier persona que pueda abrir el registro. Pregunte, por ejemplo: «¿Quién cambió los importes de BL-12?» Un registro sin pestaña Historial, como un usuario o un rol, no tiene historial en Kadratis: Kad lo indica y no reconstruye ninguno a partir de otros datos. Los asistentes conectados por MCP obtienen las mismas respuestas.

Cuando Kad suma importes presupuestarios, una línea cuya moneda no tiene tipo de cambio para el año queda excluida de la suma. Kad indica entonces qué monedas y años ha excluido. Los asistentes conectados por MCP reciben la misma respuesta.

Kad lee las cifras de personal del informe [Coste por ETC](reports.md#coste-por-etc) para cada año y columna presupuestaria: el coste y los ETC de las líneas en personas o días, el coste de las líneas con precio diario y los días que compran. Kadratis calcula el coste por ETC y la tarifa diaria media por proveedor, empresa, centro de coste o cualquier otra agrupación, como hace el informe, y Kad los cita. Pregunte, por ejemplo: "¿Cuáles son los ETC externos y la tarifa diaria media por proveedor en 2026?" Cuando usted no nombra ni OPEX ni CAPEX, Kad responde para ambos tipos. Los asistentes conectados por MCP reciben las mismas respuestas.

Kad también da las cifras de otros informes presupuestarios. Con derecho de lectura sobre las cuentas, totaliza el presupuesto por cuenta de consolidación, como el informe [Cuentas de consolidación](reports.md#cuentas-de-consolidacion). Sin ese derecho, Kad dice que hace falta el derecho sobre las cuentas. Mide varias columnas o años en una misma respuesta y añade una segunda agrupación, por ejemplo el presupuesto, la revisión y el aterrizaje previsto de cada empresa, o cada proveedor a lo largo de tres años. Encuentra los mayores aumentos o disminuciones entre dos columnas, 10 por defecto, como el informe [Top aumento / disminución](reports.md#top-aumento-disminucion). Da los ETC mes a mes con la media y el mes más alto, como [Plantilla por mes](reports.md#plantilla-por-mes). Pregunte, por ejemplo: "¿Qué líneas suben más del presupuesto 2026 a la revisión?" o "¿Cuál es el presupuesto de cada proveedor en 2025, 2026 y 2027?" Kad lee todas las líneas presupuestarias, mientras que los informes leen las líneas aún activas el 1 de enero del año anterior al primer año mostrado, así que una línea terminada antes puede hacer que una cifra difiera del informe. Los asistentes conectados por MCP reciben las mismas respuestas.

Con derecho de lectura sobre Informes, Kad lee el contracargo tal como lo muestran los informes [Contracargo global](reports.md#contracargo-global) y [Contracargo por empresa](reports.md#contracargo-por-empresa): el importe imputado a cada empresa y departamento beneficiarios, lo que paga cada empresa, el neto, las ratios por usuario y sobre la facturación, y las líneas imputadas a una empresa. Cuando usted no nombra ni OPEX ni CAPEX, cubre ambos tipos. Kad repite los avisos del informe, como una línea que no pudo repartir, una línea sin empresa pagadora o un importe sin tipo de cambio. Cuando su acceso a los datos está limitado, las cifras cubren las líneas que usted puede leer, sin el total del grupo, y Kad lista las líneas imputadas a una empresa solo para las empresas de su acceso. Los asistentes conectados por MCP reciben las mismas respuestas.

Kad lee cuatro clases de datos de referencia, tal como los muestran sus pantallas. No modifica ninguna.

- **Centros de coste**, con derecho de lectura sobre los centros de coste: el árbol de grupos de centros y centros de coste, la empresa y el responsable del presupuesto de cada nodo, y el número de líneas OPEX y CAPEX que lo usan. Kad lista todos los nodos bajo un grupo, en todos los niveles, o solo los nodos situados justo debajo.
- **Calendarios laborales**, con derecho de lectura sobre los calendarios laborales: los días laborables de un año, mes a mes, y los festivos de un calendario estándar. Kadratis calcula el total del año y Kad lo cita. Un país sin calendario en su espacio de trabajo no tiene ninguno, y Kad no calcula sus días.
- **Dimensiones analíticas**, con derecho de lectura sobre la analítica: los ajustes de cada dimensión (los tipos de línea a los que se aplica, si un valor es obligatorio, si cualquiera puede añadir un valor), su número de valores y las líneas que la usan. Una dimensión obligatoria solo cuenta como obligatoria mientras está activada.
- **Tipos de cambio y moneda de reporting**, con derecho de lectura sobre el presupuesto: la moneda de reporting, las monedas por defecto y permitidas, el tipo de cada moneda para cada año con su fuente, los tipos introducidos a mano y los tipos que faltan.

Un tipo de cambio es el importe en la moneda de reporting por 1 unidad de la moneda. En un espacio de trabajo que informa en euros, un tipo de 0,89 para USD significa 1 USD = 0,89 EUR. Kadratis calcula el tipo inverso y el tipo entre otras dos monedas, por ejemplo de USD a CHF, y Kad los cita.

Sin el derecho que pide una clase de datos de referencia, Kad nombra el derecho que falta. Cuando su acceso a los datos está limitado, usted lee todos los datos de referencia, como en las pantallas. Solo los recuentos de líneas presupuestarias cubren su acceso, y las monedas listadas con sus tipos son las de las líneas y contratos que usted puede leer.

Kad lee el historial de un centro de coste, un calendario o una dimensión, tal como lo muestra su pestaña **Historial**. `Search all` encuentra un centro de coste, un calendario o una dimensión por su código o su nombre. No busca los tipos de cambio: Kad los lista en su lugar.

Pregunte, por ejemplo: «¿Qué centros de coste dependen de Group IT?», «¿Quién es el responsable del presupuesto de FR-TRV-600?», «¿Cuántos días laborables tiene Francia en 2026?», «¿Qué dimensiones son obligatorias?» o «¿Cuál es el tipo del USD para 2026?» Los asistentes conectados por MCP reciben las mismas respuestas.

Los totales vienen de Kadratis. Una lista de líneas presupuestarias o de contratos llega con el total de todos los registros que coinciden, todas las páginas incluidas, y con el total de los registros listados, así que Kad cita uno de los dos o pide una suma a Kadratis. Si usted pide las diez líneas más grandes y su total, Kad da el total de esas diez líneas. Cuando su acceso a los datos está limitado a algunas empresas o centros de coste, Kad indica que sus recuentos y totales cubren su acceso, y no los presenta como el total del espacio de trabajo.

Cuando Kad prueba un valor de filtro que un campo no admite, por ejemplo «activa» para el estado de una aplicación (que es «activado» o «desactivado»), Kadratis lo rechaza y lista los valores aceptados. Kad vuelve entonces a buscar con el valor correcto.

Cuando usted pide un cambio que su rol no permite, Kad nombra el derecho que le falta, por ejemplo «necesita el derecho de modificar los proyectos». Un administrador lo añade a su rol.

Kad solo hace los cambios que sus pantallas le permiten hacer, en los registros a los que puede llegar desde ellas. Con el derecho de contribuir a los proyectos, puede pedir a Kad que cambie el propósito de un proyecto y sus vínculos con aplicaciones, activos y líneas presupuestarias. El derecho de contribuir a las solicitudes cubre los mismos vínculos en las solicitudes. Un Business Contributor solo hace estos cambios en los proyectos y solicitudes en los que participa. Vincular un registro requiere el derecho de leer su módulo. Cambiar el nombre de un proyecto o sus demás campos requiere el derecho de modificar los proyectos, como en la página del proyecto.

Con el nivel Colaborador en los incidentes, Kad registra un incidente, cambia sus campos, hace avanzar su estado hasta Cerrado, añade notas al diario y vincula activos, aplicaciones y tecnologías. Con el nivel Miembro en las tareas, crea una tarea de seguimiento en un incidente. Con el nivel Administrador en los incidentes, reabre o cancela un incidente, con un motivo, y activa o desactiva su restricción. El cierre congela el incidente. Su eliminación se queda en su pantalla. Consulte [Preguntar al asistente](incidents.md#preguntar-al-asistente).

Con el nivel Miembro en la infraestructura, Kad crea una tecnología, la adopta del catálogo de Kadratis o completa una tecnología introducida a mano. Cambia sus campos, añade versiones y cambia sus fechas, la vincula a aplicaciones y servidores, añade o quita sus responsables, sus contactos de soporte y sus enlaces web, y activa o desactiva sus alertas de vulnerabilidad, para toda la tecnología o para una versión. Vincular una aplicación también requiere el derecho de leer las aplicaciones. Añadir un contacto de soporte requiere el derecho de leer los contactos. Pida a Kad que deshaga un cambio que hizo en la conversación: prepara una vista previa que restablece lo anterior. La creación o la adopción de una tecnología no se puede deshacer, y una versión añadida de paso se queda. La eliminación de una tecnología o de una versión, los archivos adjuntos, los identificadores de vulnerabilidad y el nuevo cotejo de las vulnerabilidades (**Actualizar**) se quedan en las pantallas. Consulte [Preguntar al asistente](technologies.md#preguntar-al-asistente).

Con el mismo nivel, cuando se siguen las vulnerabilidades, Kad cambia el estado de las vulnerabilidades a **Por revisar**, **Tratada** o **No afectada**, con una nota si usted la da. Nombre una CVE para cambiar todas sus filas, añada una tecnología, o una tecnología y una versión, para acotar, o describa las filas con los filtros de la página. Un cambio abarca 5000 filas como máximo, como en la página. La vista previa dice cuántas filas y CVE cambian. **Aceptada** no es un estado: Kad propone **Tratada** con una nota, o **No afectada**. Pida a Kad que deshaga el cambio en la conversación. Pregunte, por ejemplo: «Marca CVE-2024-3094 como no afectada en TEC-3, el paquete no está instalado». Consulte [Preguntar al asistente](vulnerabilities.md#preguntar-al-asistente).

Cuando Kad crea una línea presupuestaria, pregunta si la línea es OPEX o CAPEX si usted no lo ha dicho. No cambia el tipo de una línea existente: use **Cambiar el tipo...** en el espacio de trabajo de la línea (consulte [Cambiar el tipo](budget-lines.md#cambiar-el-tipo)). Kad solo define el contrato de las líneas OPEX. Una línea CAPEX llega a sus contratos mediante los vínculos de su pestaña **Relaciones**.

### Eliminar un registro { #deleting-a-record }

Kad elimina un registro cada vez: una tarea, un contacto, una ubicación, un documento, una línea presupuestaria (OPEX o CAPEX), una conexión o una interfaz. Cada eliminación llega como una vista previa que usted aprueba. Una eliminación no se puede deshacer.

La vista previa lista lo que se va con el registro, como los comentarios, los registros de tiempo, los adjuntos, las versiones y los vínculos. Solo nombra lo que usted puede leer y cuenta el resto entre los demás vínculos. Si el registro cambia entre la vista previa y su aprobación, Kadratis rechaza la eliminación. Pídala de nuevo a Kad para obtener una vista previa nueva.

En una conversación, solo una eliminación espera su aprobación a la vez. Cuando usted pide eliminar varios registros, Kad los prepara uno tras otro.

Kad necesita el nivel que pide la pantalla:

| Registro | Nivel |
|---|---|
| Tarea | Administrador de las tareas |
| Contacto | Administrador de los contactos |
| Ubicación | Miembro de las ubicaciones |
| Documento | Administrador de la base de conocimiento, con el derecho de escribir en su biblioteca |
| Línea presupuestaria | Administrador del presupuesto |
| Conexión | Miembro de la infraestructura |
| Interfaz | Administrador de las aplicaciones |

Cuando su acceso a los datos está limitado a algunas empresas o centros de coste, Kad no elimina contactos ni líneas presupuestarias, como las pantallas.

Kad rechaza lo que las pantallas rechazan:

- Una tarea que una solicitud nombra como su origen
- Una línea presupuestaria con importes en una columna congelada
- Una interfaz con enlaces, salvo que usted pida eliminar sus enlaces con ella
- Un documento integrado en un registro. Se va cuando se elimina su registro.

Los demás registros, como las aplicaciones, los activos, los contratos, los proyectos, las solicitudes, los incidentes y las tecnologías, se eliminan en sus pantallas. Kad lo dice e indica la pantalla. Los asistentes conectados por MCP solo leen.

### Lo que Kad no lee { #what-plaid-does-not-read }

Kad no lee:

- El registro de auditoría (**Administración › Registro de auditoría**)
- Los agentes IA

Cuando una pregunta toca uno de estos elementos, Kad dice que no puede leerlo y nombra la pantalla que lo muestra, como la nombran sus menús en el idioma de su perfil. Una búsqueda sin resultado indica a Kad lo que no ha buscado, para que la respuesta no afirme que el registro no existe. Lo mismo ocurre con un campo: el contexto de un registro incluye sus campos principales, y Kad lee el registro completo antes de decir que un campo está vacío. Los asistentes conectados por MCP obtienen las mismas respuestas.

## Artefactos y vistas previas

Algunas respuestas incluyen material adicional que no encaja de forma natural dentro del hilo de chat. Kadratis los llama **artefactos**.

Casos habituales:

- Un bloque largo de texto o markdown que Kad preparó para usted
- Una comparación **Antes / Después** en paralelo de un registro que Kad quiere actualizar
- Un borrador de importación o conjunto de cambios que requiere su aprobación

Los artefactos se abren en un panel lateral a la derecha del espacio de trabajo. El panel se puede mostrar u ocultar haciendo clic en el botón de pestaña **Artefactos** en el borde derecho de la pantalla.

El panel se abre automáticamente cuando:

- Llega una vista previa larga durante una respuesta en streaming
- Una vista previa pendiente necesita su decisión (estas siempre abren el panel, ya que debe actuar sobre ellas)

Para las vistas previas de cambios pendientes, el panel ofrece dos botones:

- **Aprobar**: confirma el cambio y permite que Kad lo aplique
- **Rechazar**: cancela el cambio. Kad indica que el cambio se ha rechazado y no prepara nada en su lugar. Si su solicitud pedía varios cambios, continúa con los demás.

Una vista previa, y el mensaje que Kad escribe después de que usted la apruebe o la rechace, están en el idioma de su perfil, con los nombres de campo y los valores de las pantallas. Una línea presupuestaria pedida con un importe llega como una sola vista previa: una sola aprobación crea la línea, su versión presupuestaria del año y el importe.

Cuando usted pide un cambio que Kad no puede hacer, como eliminar un proyecto o volver a lanzar el cotejo de las vulnerabilidades, Kad lo dice e indica la pantalla donde puede hacerlo. No prepara ningún otro cambio en su lugar.

Nada que modifique los datos de Kadratis se aplica de forma silenciosa. La vista previa es la barrera de control.

## Indicadores de uso

Encima del cuadro de redacción, un pequeño indicador muestra cuánto queda del volumen mensual incluido:

- **Uso integrado**: cuando Kad funciona con el modelo incluido de Kadratis en lugar de con uno de los modelos propios de su organización, esto muestra cuántos mensajes quedan en el mes actual y la fecha en la que se restablece la cuota. Un administrador ha confirmado ese modelo antes (consulte [Configuración de Kad](ai-settings.md#confirmar-el-modelo-incluido-de-kanap)). Cuando se alcanza el límite, el cuadro de redacción se desactiva y un texto de ayuda invita a los administradores a cambiar a un modelo propio; consulte [Modelos IA](ai-models.md).

Las personas que pueden abrir **Administración > Kad** ven también una barra fina bajo el cuadro de redacción, cuando la conversación tiene al menos un intercambio. **Volumen procesado** suma los tokens de entrada y de salida de cada mensaje de esta conversación. Cada pregunta reenvía los mensajes anteriores, de modo que el volumen crece más rápido que el número de turnos. **Contexto de la última solicitud** es la entrada de la última pregunta. La barra muestra también los tokens de entrada y los tokens de salida de la conversación.

## Consejos

- **Use prefijos para mayor precisión**: `@T-`, `@DOC-`, `@PRJ-`, `@REQ-`, `@INC-`, `@TEC-` corresponden directamente a las referencias nativas de Kadratis. Son la forma más rápida de apuntar Kad a un registro concreto y sobreviven al copiar y pegar porque son idénticos a lo que ve en el resto de la aplicación.
- **Inicie una nueva conversación por tema**: mantener las preguntas no relacionadas en conversaciones separadas reduce la ventana de contexto, acelera las respuestas y disminuye el gasto en tokens. La lista de conversaciones está agrupada por fecha para que pueda encontrarlas de nuevo con facilidad.
- **Apruebe y rechace con criterio**: las vistas previas son lo único que se interpone entre Kad y sus datos reales. Tómese el segundo extra para leer la comparación antes de hacer clic en **Aprobar**.
- **Detenga en lugar de esperar**: si Kad toma un camino equivocado a mitad de la generación, pulse el botón **Detener** en lugar de esperar a que termine. Ahorrará tokens y su siguiente mensaje puede corregir el rumbo.
- **Suelte las imágenes directamente**: arrastrar una captura de pantalla sobre el cuadro de redacción es más rápido que el selector de archivos, y pegar desde el portapapeles también funciona. Úselo al describir un problema de interfaz o al pedir a Kad que lea un gráfico.
