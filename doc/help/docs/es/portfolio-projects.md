# Proyectos del portafolio

Los Proyectos del portafolio son los espacios de trabajo de ejecución para las iniciativas aprobadas. Es donde se planifica la entrega, se hace seguimiento del progreso, se mide la carga de trabajo, se coordinan las tareas y se conecta el conocimiento específico del proyecto con el resto de KANAP.

Los proyectos suelen provenir de solicitudes aprobadas, pero también pueden crearse directamente como proyectos **Fast-track** o **Legacy** cuando la etapa de solicitud no forma parte del proceso.

Para la secuenciación a nivel de portafolio y el trabajo de hoja de ruta, use [Planificación del portafolio](portfolio-planning.md). El área de Proyectos sirve para ejecutar el trabajo una vez que existe un proyecto.

## Dónde encontrarlo

- Espacio de trabajo: **Portafolio**
- Ruta: **Portafolio > Proyectos**

## Permisos

- `portfolio_projects:reader`: abrir la lista y ver los espacios de trabajo de proyecto
- `portfolio_projects:contributor`: actualizar el documento gestionado **Propósito**, registrar tiempo en el proyecto (entradas de gastos generales del proyecto y entradas en tareas del proyecto) y mantener los registros vinculados, los enlaces y los archivos de la pestaña **Relaciones** (las dependencias requieren `portfolio_projects:member`)
- `portfolio_projects:member`: crear proyectos y gestionar datos del proyecto, estado, equipo, relaciones, cronograma, progreso, tareas, evaluación, comentarios y decisiones
- `portfolio_projects:admin`: incluye las capacidades del nivel miembro y también puede importar y exportar, guardar sobrescrituras de prioridad y mantener entradas de tiempo de gastos generales de otros usuarios
- La visualización del conocimiento también requiere acceso a Base de conocimiento
- Crear o vincular conocimiento independiente también requiere un rol de creación en Base de conocimiento

Si Proyectos no aparece en la navegación, solicite acceso a un administrador.

## Trabajar con la lista

La lista de proyectos está diseñada para responder rápidamente a dos preguntas: "¿qué debería preocuparme?" y "¿qué se está moviendo?".

**Selector de alcance**

- **Mis proyectos** muestra los proyectos donde está explícitamente involucrado como patrocinador, responsable o colaborador
- **Proyectos de mi equipo** amplía esa vista a proyectos que involucran a miembros de su equipo de portafolio
- **Todos los proyectos** elimina el filtro de involucración
- Si no está asignado a un equipo de portafolio, el alcance de equipo no está disponible
- La lista se abre en **Todos los proyectos**. Su preferencia de alcance se recuerda, de modo que la lista vuelve como la dejó

**Columnas predeterminadas**

| Columna | Qué muestra |
|---------|-------------|
| **#** | Número de referencia (p. ej., PRJ-42). Haga clic para abrir el espacio de trabajo |
| **Nombre del proyecto** | El nombre del proyecto |
| **Prioridad** | Puntuación de prioridad calculada |
| **Estado** | Estado de ejecución actual con un punto de color |
| **Origen** | Solicitud, Fast-track o Legacy |
| **Progreso** | Progreso de ejecución como barra |
| **Origen** | Clasificación de origen del portafolio |
| **Categoría** | Categoría del portafolio |
| **Flujo** | Flujo del portafolio |
| **Empresa** | Clasificación de empresa |
| **Inicio** | Fecha de inicio planificada |
| **Fin** | Fecha de fin planificada |
| **Creado** | Fecha de creación |

**Columnas adicionales** (ocultas por defecto):

- **Última modificación**: Cuándo se actualizó por última vez el proyecto

**Comportamiento predeterminado**

- Los proyectos se ordenan por puntuación de prioridad a menos que cambie la ordenación
- Los proyectos en estado **Hecho** están ocultos por defecto
- La búsqueda funciona en el contenido de texto
- Los filtros de estado, origen, fuente, categoría, flujo y empresa están disponibles directamente en la cuadrícula

**Administración masiva**

- **Nuevo proyecto** está disponible con `portfolio_projects:member`
- **Importar** y **Exportar** están disponibles para los administradores

Abrir un proyecto desde la lista preserva el contexto actual de la lista. El espacio de trabajo del proyecto utiliza el mismo contexto para la navegación **Anterior** y **Siguiente**, de modo que pueda revisar un conjunto filtrado sin perder su lugar.

## Crear un proyecto

La creación directa de proyectos es para trabajo que debe entrar en ejecución sin un registro de solicitud separado.

- Los nuevos proyectos se abren solo en **Resumen**
- Hasta que el proyecto se guarde por primera vez, las otras pestañas no están disponibles
- Los proyectos creados directamente usan un origen de **Fast-track** o **Legacy**
- Los proyectos de origen-solicitud conservan su origen de solicitud y vinculación de fuente

Use **Fast-track** para trabajo que se introduce genuinamente directo en la entrega. Use **Legacy** para trabajo que ya existe fuera del historial normal de captación. Esa distinción afecta a los informes y hace que el análisis posterior del portafolio sea mucho menos confuso.

## Modelo mental del espacio de trabajo

El espacio de trabajo del proyecto tiene dos capas:

- El **área de contenido principal** para las pestañas operativas: **Resumen**, **Tareas**, **Cronograma**, **Progreso**, **Evaluación**, **Relaciones** y **Conocimiento**
- Un panel persistente de **Propiedades** en el borde derecho para las propiedades principales, la asignación de equipo y las solicitudes de origen

Abra o cierre el panel de Propiedades usando la pestaña vertical en el borde derecho.

Para proyectos existentes, el panel de Propiedades se comporta como un panel de propiedades en vivo: los cambios allí se guardan inmediatamente. El contenido de la pestaña principal sigue el flujo habitual de **Guardar** / **Restablecer** cuando esa pestaña contiene cambios en borrador. Si cambia de pestaña o pasa al proyecto anterior o siguiente con cambios sin guardar en el espacio de trabajo, KANAP pregunta si guardar primero.

## Encabezado y metadatos

El encabezado del espacio de trabajo es una franja de control, no decoración.

- Un chip de referencia copiable **PRJ-...**
- El título del proyecto (haga clic para editar cuando tenga derechos de gestión)
- Una fila de metadatos compacta: **Estado**, **Puntuación**, **Progreso**, **Responsable IT**, **Fin planificado** y **Origen** (o la referencia de la solicitud de origen para proyectos de origen-solicitud)
- **Anterior** y **Siguiente** se mueven por el conjunto de resultados de la lista actual, no por todos los proyectos del sistema
- **Compartir** envía por correo la URL actual del proyecto con un mensaje opcional

Enviar un enlace no concede acceso. Solo comparte la ubicación. Los permisos permanecen exactamente como estaban antes de enviar el correo.

Cambiar el estado desde la franja de metadatos abre un diálogo de cambio de estado para que la transición pueda registrarse correctamente. Es ahí donde puede registrar el cambio como una decisión formal, capturar el contexto y almacenar la justificación con la transición en lugar de dejarla desaparecer en la memoria de los pasillos.

El flujo de trabajo está intencionalmente controlado:

- **Lista de espera** puede pasar a **Planificado**, **En espera** o **Cancelado**
- **Planificado** puede pasar a **En progreso**, **En espera** o **Cancelado**
- **En progreso** puede pasar a **En pruebas**, **Hecho**, **En espera** o **Cancelado**
- **En pruebas** puede volver a **En progreso**, o avanzar a **Hecho**, **En espera** o **Cancelado**
- **En espera** puede volver a **Lista de espera**, **Planificado** o **En progreso**, o ser **Cancelado**
- **Hecho** y **Cancelado** son estados terminales

## Panel de Propiedades

Trate el panel de Propiedades como la tarjeta de identidad persistente del proyecto. Está agrupado en tres secciones.

### Propiedades principales

- Nombre del proyecto
- Estado
- Origen (solo durante la creación inicial; bloqueado después)
- Origen, Categoría, Flujo
- Empresa, Departamento
- Inicio planificado, Fin planificado

Estos campos impulsan los informes, la planificación, el filtrado y el contexto predeterminado del portafolio. Las elecciones de clasificación son especialmente importantes porque afectan a dónde aparece el proyecto en el análisis cruzado del portafolio.

### Equipo

La asignación de equipo vive en el panel para que permanezca disponible mientras trabaja en el cronograma, esfuerzo o tareas.

- **Patrocinador de negocio** / **Patrocinador IT** capturan la responsabilidad ejecutiva
- **Responsable de negocio** / **Responsable IT** identifican el liderazgo del día a día
- **Colaboradores de negocio** / **Colaboradores IT** definen el equipo de trabajo más amplio

Estas asignaciones hacen más que rellenar casillas:

- determinan qué aparece en **Mis proyectos** y **Proyectos de mi equipo**
- alimentan el contexto del proyecto en resumen e informes
- definen quién está disponible para la asignación de esfuerzo en la pestaña **Progreso**

Si los responsables y colaboradores son incorrectos, su planificación de esfuerzo también será incorrecta.

### Solicitudes de origen

Una lista de solo lectura de los registros de solicitud que produjeron el proyecto. Haga clic en una entrada para navegar al espacio de trabajo de la solicitud de origen.

Las mismas solicitudes aparecen también en la pestaña **Relaciones**, junto con las dependencias, las líneas presupuestarias, aplicaciones, activos y tecnologías vinculados, y los enlaces y archivos del proyecto.

## Resumen

La pestaña **Resumen** es la cabina del proyecto. Está pensada para responder al estado actual del proyecto en una sola pasada, no para duplicar cada campo en el panel.

### Propósito

La sección **Propósito** es un documento gestionado del proyecto, no un campo de notas desechable.

- úselo para el resumen narrativo del proyecto: intención, resultado esperado, límites del alcance y cualquier encuadre que deba viajar con el proyecto
- los cambios en el propósito siguen el flujo de **Guardar** / **Restablecer** del espacio de trabajo
- los colaboradores pueden actualizar el Propósito incluso cuando no pueden gestionar el resto del proyecto

Esta separación es deliberada. Permite que la propiedad narrativa sea más amplia que la administración estructural del proyecto.

El editor de Propósito incluye importación y exportación de documentos:

- **Importar** acepta un archivo `.docx` y lo convierte al formato markdown interno. Si el Propósito ya tiene contenido, KANAP pide confirmación antes de reemplazarlo.
- **Exportar** le permite descargar el Propósito actual como PDF, DOCX u ODT.

Estas herramientas son útiles cuando un resumen de proyecto se origina en Word o cuando las partes interesadas necesitan una copia con formato fuera de KANAP.

El documento gestionado de Propósito es diferente de la pestaña **Conocimiento**:

- **Propósito** es el resumen embebido, propiedad del proyecto
- **Conocimiento** es para documentos independientes que pueden necesitar su propio ciclo de vida, reutilización o relaciones

### Actividad

Debajo de Propósito, la pestaña Resumen incluye el flujo de actividad del proyecto:

- **Comentarios** para discusión, notas contextuales y decisiones formales
- **Historial** para la pista de auditoría de cambios de campo y estado

**Historial** enumera los cambios registrados (cambios de estado, ediciones de campos, cambios de equipo y relaciones, ediciones del documento Objetivo) y termina con la entrada de creación: quién creó el proyecto y cuándo.

Los usuarios con `portfolio_projects:member` pueden añadir y editar comentarios del proyecto. Los comentarios también pueden registrarse como decisiones formales, con un resultado y un cambio de estado opcional. Use eso cuando la propia discusión cambie el rumbo del proyecto.

Las imágenes pueden incluirse en los comentarios de actividad cuando la evidencia visual sea útil: bocetos de arquitectura, capturas de pantalla o evidencia de revisión.

Use **Historial** cuando necesite saber qué cambió. Use **Comentarios** cuando necesite saber por qué.

## Tareas

La pestaña **Tareas** es la cola de ejecución del proyecto. La insignia de la pestaña muestra el número de tareas del proyecto.

- las tareas creadas aquí se vinculan al proyecto automáticamente
- las tareas también pueden crearse desde una fase del cronograma, lo que las vincula tanto al proyecto como a la fase seleccionada
- la pestaña admite filtrado por estado y filtrado por fase
- la vista de tareas predeterminada se centra en el trabajo activo ocultando los elementos hechos y cancelados

Esta pestaña es para gestionar tareas vinculadas al proyecto en contexto, no para reemplazar el espacio de trabajo completo de tareas. Abrir una tarea le lleva a su propio espacio de trabajo, donde continúa el detalle específico de la tarea y el registro de tiempo.

Desde una perspectiva de proyecto, la consecuencia importante es esta: el estado de la tarea y el tiempo de la tarea no están aislados. Retroalimentan a Resumen y Progreso, así que las tareas descuidadas hacen que toda la imagen del proyecto sea menos fiable.

## Cronograma

La pestaña **Cronograma** es donde la estructura de entrega se hace explícita.

### Fechas del proyecto

La parte inferior de la pestaña muestra tres líneas:

- **Real**: fechas capturadas por eventos de ejecución (cuando el proyecto pasó a En progreso y cuando alcanzó Hecho). Solo lectura en el espacio de trabajo.
- **Planificado**: la ventana de entrega prevista. Edite esto en el panel de Propiedades.
- **Línea base**: una instantánea de las fechas planificadas capturada cuando el proyecto pasó a **En progreso**. La variación contra la línea base se muestra como `Nd tarde` o `Nd temprano`.

### Fases

Los proyectos pueden empezar con una plantilla de fases o un plan de fases totalmente personalizado.

- si aún no existen fases, elija una plantilla y haga clic en **Aplicar plantilla** para crear la estructura inicial
- una vez que existen fases, pueden reordenarse (arrastre el controlador), renombrarse, fecharse y gestionarse en estado
- cada fila de fase incluye una casilla de hito; marcarla crea un hito de finalización de fase para esa fase
- cada fase tiene un atajo para crear una tarea ya vinculada a esa fase y proyecto
- **Añadir fase** añade una nueva fase vacía
- **Reemplazar con plantilla** reconstruye la estructura de fases a partir de una plantilla. Úselo solo cuando realmente quiera decir "empezar de nuevo el modelo de fases"

El modelo de fases afecta a más que el cronograma:

- la fase activa aparece de vuelta en Resumen y la barra de metadatos
- las tareas vinculadas a fases heredan el contexto de entrega inmediatamente
- los hitos de fase proporcionan marcadores de finalización sin crear un esquema de seguimiento separado

### Hitos

Los hitos independientes viven en su propia sección debajo de las fases. Use **+ Añadir hito** para crearlos. Cada hito tiene un nombre, fecha objetivo, estado y (cuando se activa desde una fase) un vínculo a la fase que representa.

Los hitos de finalización de fase siguen a la fase a la que están adjuntos. Los hitos independientes son para puntos de control que deben existir fuera de la estructura de fases.

### Vistas de Tabla y Gantt

Encima de la lista de fases, alterne entre las vistas **Tabla** y **Gantt**:

- use la vista **Tabla** cuando esté dando forma a la estructura
- use la vista **Gantt** cuando necesite ver solapamiento, secuenciación y distribución de fechas

Solo las fases con fechas de inicio y fin utilizables aparecen significativamente en el Gantt. Si las fechas son vagas, el gráfico será igualmente vago. En la vista Gantt, puede arrastrar las barras de fase para ajustar las fechas de inicio/fin (con permiso de gestión).

## Progreso

La pestaña **Progreso** combina el progreso de ejecución, la planificación de carga de trabajo y el consumo de tiempo real. Esa combinación importa porque un proyecto que reporta 80% de progreso con 20% del esfuerzo consumido no es necesariamente eficiente; puede simplemente estar mal estimado.

### Progreso y carga de trabajo

- **Progreso de ejecución** es la señal global de finalización del proyecto
- **Consumo de carga de trabajo** compara el esfuerzo real con el esfuerzo planificado

Mantenga estos dos números alineados con la realidad. Si el progreso avanza sin esfuerzo correspondiente, o el esfuerzo se acumula sin movimiento de entrega, la discrepancia generalmente le está diciendo algo importante sobre el alcance, la estimación o la disciplina de informes.

### Esfuerzo estimado y asignaciones

El progreso separa el esfuerzo estimado en:

- **Esfuerzo IT**
- **Esfuerzo de negocio**

Cada lado puede asignarse entre el responsable y los colaboradores relevantes. Las asignaciones dependen del equipo configurado en el panel de Propiedades, así que los cambios de equipo también tienen consecuencias de planificación aquí.

### Esfuerzo real y registro de tiempo

El esfuerzo real se calcula a partir de dos fuentes:

- **Gastos generales del proyecto**: tiempo registrado directamente en el proyecto
- **Tiempo de tareas**: tiempo registrado desde las tareas del proyecto

El registro de tiempo fusiona ambos en una sola vista e identifica la fuente para cada entrada. Esto es intencional: el esfuerzo del proyecto debe entenderse como toda la huella de entrega, no como una pelea entre "trabajo de proyecto" y "trabajo de tareas".

Consecuencias importantes:

- el tiempo de tareas contribuye al esfuerzo real del proyecto automáticamente
- el tiempo de tareas es visible aquí pero debe corregirse en el espacio de trabajo de la tarea
- las entradas de gastos generales del proyecto se mantienen desde la pestaña Progreso
- los colaboradores pueden mantener sus propias entradas de gastos generales del proyecto
- los administradores pueden mantener entradas de gastos generales del proyecto entre usuarios

### Esfuerzo de línea base

Cuando el proyecto pasa a **En progreso**, KANAP captura los valores de esfuerzo de línea base. Los cambios posteriores se muestran como variación contra esa línea base, lo cual es útil para distinguir las actualizaciones normales de entrega del aumento silencioso del alcance.

## Evaluación

La pestaña **Evaluación** mantiene la entrega ligada a la priorización.

- para proyectos de origen-solicitud, la solicitud de origen permanece visible como referencia de evaluación
- para proyectos fast-track y legacy, la evaluación se mantiene directamente en el proyecto
- los usuarios con `portfolio_projects:member` pueden revisar o actualizar la evaluación; guardar una sobrescritura de prioridad requiere `portfolio_projects:admin`

La puntuación de prioridad resultante importa fuera de esta pestaña:

- aparece en el encabezado del proyecto
- es visible en la lista
- afecta a cómo se clasifican los proyectos cuando la lista se ordena por prioridad

Si la evaluación se desvía de la realidad de la entrega, las discusiones del portafolio se vuelven más difíciles de lo necesario.

## Relaciones

La pestaña **Relaciones** reúne los vínculos que explican cómo encaja el proyecto en el resto del portafolio: primero las dependencias, después una tabla por tipo de registro vinculado y, por último, los enlaces y archivos. La insignia de la pestaña cuenta las dependencias, los registros vinculados que usted ve, los enlaces web y los archivos.

### Dependencias

Haga seguimiento de las dependencias de entrega con otras solicitudes o proyectos. Use el campo de búsqueda para encontrar y añadir un elemento relacionado; elimine los enlaces que ya no quiera con el icono de eliminar del chip.

Las dependencias son operativas, no cosméticas. Dan forma a cómo deben interpretarse los retrasos y la secuenciación.

### Registros vinculados

Debajo de las dependencias, cada tipo de registro tiene su propia tabla. Haga clic en una fila para abrir el registro.

| Sección | Columnas |
|---|---|
| **Líneas presupuestarias** | Referencia (`BL-4`), nombre, tipo (OPEX o CAPEX), proveedor, importe del año en la columna presupuestaria por defecto. Una fila de total aparece a partir de dos líneas |
| **Aplicaciones** | Referencia (`APP-3`), nombre, ciclo de vida, criticidad de negocio |
| **Activos** | Referencia (`AST-12`), nombre, tipo, entorno, estado |
| **Tecnologías** | Referencia (`TEC-5`), nombre, familia, editor |
| **Solicitudes de origen** | Referencia (`REQ-2`), nombre, estado. Solo lectura: la conversión de una solicitud en este proyecto escribe este vínculo |

Una sección no aparece si usted no puede leer su módulo: las líneas presupuestarias requieren el presupuesto, las aplicaciones las aplicaciones, los activos y las tecnologías la infraestructura, las solicitudes de origen las solicitudes. Un Colaborador de negocio solo ve las aplicaciones y las solicitudes en las que participa. Una línea presupuestaria desactivada, o una aplicación o un activo desactivado o retirado, sigue en la lista con el nombre atenuado.

**Añadir y quitar vínculos** (`portfolio_projects:contributor`): **Añadir**, a la derecha de una sección, abre una búsqueda bajo el botón. Escriba un nombre o una referencia y elija un resultado: el vínculo se guarda al instante. Para quitar un vínculo, pase el cursor sobre la fila y haga clic en la cruz al final. No hay confirmación, y quitar un vínculo no elimina nada más. Vincular una tecnología requiere también poder leer la infraestructura. Los lectores ven las tablas en solo lectura.

Los vínculos con líneas presupuestarias, aplicaciones y activos quedan registrados en el **Historial** del proyecto.

### Enlaces y archivos

**Enlaces y archivos** cierra la pestaña: los enlaces web del proyecto y sus archivos, una fila cada uno con su nombre, el dominio del enlace o el tamaño del archivo, y la fecha en que se añadió. Haga clic en un enlace para abrirlo en una pestaña nueva, o en un archivo para descargarlo. Con `portfolio_projects:contributor`:

- **Añadir enlace** abre un diálogo para una URL y un nombre opcional; el enlace se guarda al instante. Para cambiar un enlace, pase el cursor sobre su fila y haga clic en el lápiz.
- **Adjuntar archivo** abre el selector de archivos. También puede soltar archivos sobre la sección.
- Para quitar un enlace o un archivo, pase el cursor sobre la fila y haga clic en la cruz. Quitar un enlace muestra un mensaje y ofrece **Deshacer**, que vuelve a crear el enlace. Eliminar un archivo pide una confirmación antes.

## Conocimiento

La pestaña **Conocimiento** conecta el proyecto a documentos independientes de la Base de conocimiento. La insignia de la pestaña muestra el conteo de documentos de conocimiento relacionados.

Distingue entre:

- **documentos vinculados**: documentos directamente adjuntos al proyecto
- **documentos relacionados**: documentos descubiertos a través de otras entidades vinculadas como solicitudes de origen, dependencias o elementos conectados

Esta distinción importa:

- los enlaces directos representan documentación que el proyecto explícitamente posee o usa
- los enlaces relacionados proporcionan contexto sin pretender que todo pertenece directamente al proyecto

Dependiendo de sus permisos de Base de conocimiento, puede:

- crear un nuevo documento en blanco ya vinculado al proyecto
- crear un documento vinculado desde una plantilla
- vincular un documento existente
- desvincular documentos vinculados directamente
- abrir cualquier documento vinculado o relacionado en la Base de conocimiento

Si puede abrir el proyecto pero no tiene derechos de visualización de Base de conocimiento, KANAP le dirá que existe conocimiento sin exponer el contenido del documento. Ese es el comportamiento esperado, no una pestaña rota.

## Importación y exportación CSV

**Exportar** e **Importar** están disponibles desde la página de lista para administradores.

### Exportar

El archivo contiene los proyectos que muestra la lista, con sus filtros, su búsqueda y su orden. **Formato**: **CSV** o **Excel (.xlsx)**, elegido en el diálogo y recordado por su navegador. El libro contiene las mismas columnas que el CSV en una hoja, con los números y las fechas como valores que Excel puede ordenar y filtrar. La importación lee los dos; en un libro, lee la primera hoja. Consulte [Archivos CSV y Excel](csv-files.md).

**Columnas**: el archivo empieza por `id` y `reference` (`PRJ-12`), y después las columnas siguen el espacio de trabajo, pestaña por pestaña. La importación ignora `reference`.

Las exportaciones admiten:

- **Exportación completa**
- **Enriquecimiento de datos**
- **Selección personalizada**

Use **Enriquecimiento de datos** cuando desee exportar, ajustar campos seleccionados externamente y volver a importar el resultado en KANAP con el mínimo drama.

### Importar

Las importaciones están diseñadas para cambios masivos controlados:

- descargue primero una plantilla cuando necesite la estructura correcta
- valide antes de importar
- use opciones avanzadas para elegir el comportamiento de enriquecimiento vs reemplazo y las reglas de inserción/actualización

La importación masiva es útil para mantenimiento del portafolio a gran escala, pero no es un atajo a la gobernanza del proyecto. La planificación de fases, las tareas, el conocimiento y el control continuo de entrega siguen perteneciendo al espacio de trabajo.

## Enviar un enlace

Use **Compartir** desde el encabezado del espacio de trabajo para enviar por correo un enlace directo del proyecto a destinatarios internos o externos.

- puede enviarlo a usuarios de la plataforma o a cualquier dirección de correo
- puede incluir un mensaje opcional
- el enlace copiado o enviado por correo apunta directamente al espacio de trabajo del proyecto

De nuevo, enviar un enlace no concede acceso. Solo evita que la gente tenga que buscar el proyecto por sí misma.

## Orientación práctica

- Use el panel de Propiedades para datos estructurales que deben permanecer visibles mientras trabaja.
- Use **Resumen** para la narrativa del proyecto, la actividad más reciente y la imagen operativa de alto nivel.
- Use **Cronograma** para definir la estructura de entrega antes de que crezca el volumen de tareas.
- Use **Progreso** regularmente, de lo contrario la variación de esfuerzo llega como una sorpresa aunque los datos ya le estuvieran avisando.
- Use **Conocimiento** para documentación reutilizable o gobernada, no como una segunda copia del resumen del Propósito.
- Use **Importar** en el editor de Propósito cuando un resumen de proyecto ya existe como documento Word, en lugar de reformatearlo a mano.
