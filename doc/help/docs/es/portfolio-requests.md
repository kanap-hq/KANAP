# Solicitudes del portafolio

Las Solicitudes del portafolio son la capa de recepción para el trabajo propuesto. Una solicitud le permite capturar la necesidad de negocio, evaluar la viabilidad, puntuar la prioridad, recopilar conocimiento de soporte y decidir si la iniciativa debe avanzar como proyecto. En la práctica, aquí es donde las ideas se convierten en trabajo gobernado en lugar de folclore de pasillo.

## Dónde encontrarlo

- Espacio de trabajo: **Portafolio**
- Ruta: **Portafolio > Solicitudes**

### Permisos

| Permiso | Qué permite |
| --- | --- |
| `portfolio_requests:reader` | Abrir la lista de solicitudes y ver los espacios de trabajo de solicitud |
| `portfolio_requests:contributor` | Vincular y desvincular líneas presupuestarias, aplicaciones, activos y procesos de negocio en la pestaña **Relaciones** |
| `portfolio_requests:member` | Crear solicitudes, actualizar datos de solicitud, editar los documentos gestionados (Propósito, Riesgos y mitigaciones), mantener equipo y relaciones, añadir comentarios y decisiones, cambiar el estado, enviar recomendaciones de análisis y editar la evaluación |
| `portfolio_requests:admin` | Eliminar solicitudes, usar la importación y exportación y guardar sobrescrituras de prioridad |

Convertir una solicitud en proyecto también requiere `portfolio_projects:member`.

La pestaña **Conocimiento** sigue los permisos de Base de conocimiento para las acciones de creación y vinculación. A un usuario se le puede permitir trabajar en el contenido de la solicitud sin permitirle crear o revincular documentos de conocimiento independientes.

## Trabajar con la lista

La lista está diseñada para el triaje en lugar de para la navegación de archivo. Por defecto, ordena las solicitudes por prioridad para que el trabajo más urgente o estratégicamente importante suba primero.

### Filtros de alcance

Use el selector de alcance encima de la cuadrícula para controlar qué pipeline está mirando:

- **Mis solicitudes** muestra las solicitudes donde está explícitamente involucrado, como solicitante, patrocinador, responsable o colaborador.
- **Solicitudes de mi equipo** amplía esa vista a las solicitudes que involucran a miembros de su equipo de Portafolio. Esta opción no está disponible si no está asignado a un equipo.
- **Todas las solicitudes** elimina el filtro de involucración y muestra el pipeline completo de solicitudes.

La lista se abre en **Todas las solicitudes** y recuerda su elección de alcance. Si abre una solicitud desde la lista y vuelve más tarde, KANAP mantiene el contexto de la lista para que no tenga que reconstruir su pila de filtros cada vez.

### Columnas predeterminadas

La cuadrícula estándar resalta los campos que importan durante la recepción y revisión:

| Columna | Qué muestra |
|---------|-------------|
| **#** | Número de referencia (p. ej., REQ-42). Haga clic para abrir el espacio de trabajo |
| **Nombre de la solicitud** | El nombre de la solicitud |
| **Prioridad** | Puntuación de prioridad calculada |
| **Estado** | Estado actual de recepción |
| **Origen** | Clasificación de origen del portafolio |
| **Categoría** | Categoría del portafolio |
| **Flujo** | Flujo del portafolio |
| **Empresa** | Clasificación de empresa |
| **Solicitante** | Persona que planteó la solicitud |
| **Fecha objetivo** | Fecha de entrega objetivo solicitada |
| **Creado** | Cuándo se creó la solicitud |

**Columnas adicionales** (ocultas por defecto):

- **Última modificación**: Cuándo se actualizó por última vez la solicitud

### Comportamiento de filtrado

- La búsqueda global funciona en el contenido de la solicitud y los metadatos de negocio visibles.
- Hay filtros de columna disponibles para los principales campos de clasificación y propiedad.
- Las solicitudes con estado **Convertida** están ocultas por defecto para que la lista permanezca centrada en la recepción activa. Si necesita revisar decisiones históricas de recepción, incluya **Convertida** en el filtro de Estado.

### Acciones de la lista

- **Nueva solicitud** está disponible con `portfolio_requests:member`.
- **Importar** y **Exportar** están disponibles para los administradores de solicitudes.

## El espacio de trabajo de Solicitud

El espacio de trabajo utiliza un modelo dividido:

- El área principal contiene las pestañas operativas: **Resumen**, **Análisis**, **Evaluación**, **Relaciones**, **Conocimiento** e **Historial** (los cambios de la solicitud, vea [Historial de los registros](record-history.md)).
- Un panel persistente de **Propiedades** en el borde derecho contiene los metadatos estables de la solicitud, la asignación de equipo y los proyectos resultantes. Ábralo o ciérrelo usando la pestaña vertical en el borde derecho.

Esto importa porque no todo se guarda de la misma manera:

- Los cambios en el **panel de Propiedades** se aplican inmediatamente.
- Los cambios en **Resumen**, **Análisis** y **Evaluación** son ediciones del espacio de trabajo y usan **Guardar** / **Restablecer**.
- Los documentos gestionados **Propósito** y **Riesgos y mitigaciones** también usan el flujo de guardado del espacio de trabajo.

Si crea una nueva solicitud, KANAP comienza en **Resumen**. Las otras pestañas se vuelven útiles después de que la solicitud existe como un registro real en lugar de una idea muy sincera.

El encabezado del espacio de trabajo le da contexto operativo sin salir de la página:

- una referencia de solicitud copiable como `REQ-42`
- una franja de metadatos con **Estado**, **Puntuación**, **Solicitante**, **Responsable IT**, **Fecha de entrega objetivo** y (cuando aplica) la **Tarea de origen** desde la que se creó la solicitud
- **Compartir** para enviar un enlace a la solicitud
- **Convertir en proyecto** cuando la solicitud está **Aprobada** o **Convertida**
- **Eliminar**, un icono de papelera, para administradores (cuando la solicitud aún no se ha convertido). Una solicitud convertida sigue siendo el origen de su proyecto y no se puede eliminar
- navegación anterior/siguiente basada en el contexto exacto de la lista del que vino

### Panel de Propiedades

Trate el panel como la columna vertebral estructural de la solicitud. Contiene tres grupos.

#### Propiedades principales

- Nombre de la solicitud
- Estado
- Origen, Categoría, Flujo
- Solicitante
- Empresa, Departamento
- Fecha de entrega objetivo

Estos campos dan forma a cómo se enruta, filtra y revisa la solicitud en otras partes del espacio de trabajo. Por ejemplo:

- cambiar **Estado** afecta a qué decisiones pueden seguir y si la conversión está disponible
- cambiar **Categoría** o **Flujo** cambia el contexto analítico para la viabilidad y la evaluación
- cambiar **Empresa** o **Solicitante** cambia los informes y la visibilidad de propiedad en todo el portafolio

#### Equipo

La asignación de equipo nombra responsabilidad en lugar de simplemente mantener una lista de contactos:

- **Patrocinador de negocio**
- **Responsable de negocio**
- **Patrocinador IT**
- **Responsable IT**
- **Colaboradores de negocio**
- **Colaboradores IT**

Estas asignaciones impulsan la visibilidad compartida y dejan claro quién se espera que patrocine, dé forma y entregue la solicitud. Resumen utiliza estos datos para mostrar si la solicitud tiene suficiente propiedad nombrada para avanzar de forma sensata.

#### Proyectos resultantes

Una lista de solo lectura de los proyectos producidos a partir de esta solicitud después de la conversión. Haga clic en una entrada para navegar al espacio de trabajo del proyecto.

Los mismos proyectos aparecen también en la pestaña **Relaciones**, junto con las dependencias, las líneas presupuestarias, aplicaciones, activos y procesos de negocio vinculados, y los enlaces y archivos de la solicitud.

Los marcadores antiguos pueden seguir apuntando a `overview`, `team` o `relations`. El espacio de trabajo actual coloca este contenido bajo **Resumen**, el panel de Propiedades y la pestaña **Relaciones**.

## Resumen

**Resumen** es la cabina de la solicitud. No es una simple pestaña de visión general; es donde KANAP comprime el estado de la solicitud en una instantánea operativa.

### Propósito como documento gestionado

La sección **Propósito** es un documento markdown gestionado embebido directamente en la solicitud. Es más que un campo de descripción larga:

- da a los revisores una declaración estable de intención
- está disponible durante la conversión de solicitud a proyecto
- puede ser editado por usuarios con `portfolio_requests:member`
- admite **importación DOCX** para que pueda traer documentos Word existentes directamente, y **exportación** para descargar el contenido actual como PDF, DOCX u ODT

### Actividad

Debajo de Propósito, la pestaña Resumen incluye el flujo de actividad de la solicitud: los comentarios para discusión, notas contextuales y decisiones formales. Los cambios de la solicitud están en la pestaña **Historial**.

Esto coloca la actividad más reciente directamente delante de los revisores sin requerir que naveguen a una pestaña separada.

#### Comentarios

Los comentarios admiten la discusión normal, pero también admiten **decisiones formales**. Una decisión formal puede capturar:

- el contexto de la reunión o decisión
- el resultado de la decisión
- la justificación
- un cambio de estado opcional en la misma acción

Esa combinación mantiene la gobernanza trazable: el registro de *por qué* algo cambió permanece adjunto al cambio en lugar de reconstruirse más tarde a partir de la memoria y el optimismo.

Los comentarios admiten markdown e imágenes en línea, lo cual es útil para notas de diseño, evidencia, capturas de pantalla y material de revisión.

#### Historial

La pestaña **Historial** lista los cambios de la solicitud. Úsela cuando necesite responder preguntas como:

- quién cambió el estado
- cuándo cambiaron las asignaciones de equipo
- si un cambio de evaluación o análisis ocurrió antes o después de una decisión

La lista termina con la entrada de creación (quién creó la solicitud y cuándo), bajo los cambios registrados, que incluyen las ediciones de los documentos Objetivo y Riesgos.

Si necesita narrativa, use los comentarios. Si necesita prueba, use la pestaña **Historial**.

## Análisis

**Análisis** es donde la solicitud pasa de "suena razonable" a "comprendida lo suficiente como para decidir".

Reúne cuatro elementos distintos:

- procesos de negocio impactados
- revisión estructurada de viabilidad
- **Riesgos y mitigaciones** gestionados
- la **Recomendación de análisis** formal

### Procesos de negocio impactados

Vincule los procesos de negocio tocados por la solicitud. Esto cambia el significado de la solicitud en términos de portafolio: una solicitud que afecta a procesos operativos principales no debe evaluarse de la misma manera que una mejora de conveniencia local.

Modificarlos requiere `portfolio_requests:member` y `business_processes:member`.

### Revisión de viabilidad

La revisión de viabilidad es una evaluación estructurada en siete dimensiones:

- Viabilidad técnica
- Compatibilidad de integración
- Necesidades de infraestructura
- Seguridad y conformidad
- Habilidades de recursos
- Restricciones de entrega
- Gestión del cambio

Cada dimensión puede evaluarse con un nivel de preocupación (**No evaluado**, **Sin preocupaciones**, **Preocupaciones menores**, **Preocupaciones mayores**, **Bloqueador**) y notas de soporte.

Use esta sección para exponer la fricción de entrega temprano:

- no todas las solicitudes fallan porque la idea sea pobre
- muchas fallan porque las restricciones de integración, infraestructura, seguridad, tiempo o gestión del cambio se ignoraron hasta que fue demasiado tarde

La pestaña Resumen muestra el nivel de preocupación más fuerte de esta revisión para que los problemas mayores permanezcan visibles incluso cuando nadie abra Análisis.

### Riesgos y mitigaciones

**Riesgos y mitigaciones** es otro documento markdown gestionado. Úselo para documentar el riesgo residual, las acciones de mitigación y la propiedad. Como Propósito, puede ser editado por usuarios con `portfolio_requests:member` y admite **importación DOCX** para traer documentos Word existentes, así como exportación.

Esto es útil cuando las personas mejor posicionadas para describir los riesgos no son las mismas personas que deberían cambiar el estado de la solicitud o la estructura del portafolio.

### Recomendación de análisis

El flujo de recomendación publica una decisión formal en Actividad con el contexto fijo **Recomendación de análisis**. También puede cambiar el estado de la solicitud al mismo tiempo.

Eso significa que Análisis no es un área aislada de toma de notas. Es parte de la pista de gobernanza:

- los revisores pueden ver la recomendación más reciente directamente en Análisis
- la misma recomendación aparece en Actividad como un registro de decisión
- los cambios de estado opcionales permanecen ligados a la recomendación que los justificó
- un atajo **Ver en Actividad** salta directamente a la recomendación en el flujo de actividad de Resumen

Las solicitudes más antiguas también pueden mostrar una sección **Análisis previo (Legacy)**. Ese contenido se conserva por continuidad, pero el modelo actual de solicitud se basa en revisión de viabilidad, riesgos gestionados y recomendaciones formales.

## Evaluación

**Evaluación** evalúa la solicitud contra el modelo de evaluación del portafolio configurado para su espacio de trabajo.

En la práctica:

- cada criterio activo contribuye a la prioridad calculada
- la puntuación resultante alimenta la comparación del portafolio y el orden de la lista
- una sobrescritura puede usarse cuando la puntuación calculada es matemáticamente correcta pero operativamente incorrecta

Si se usa la sobrescritura de prioridad, debe tratarse como una excepción, no como un estilo de vida.

Donde lo habiliten los ajustes del portafolio, las reglas obligatorias de bypass pueden forzar la prioridad máxima para las solicitudes que califiquen. Esto se utiliza típicamente para trabajo que no puede competir sensatamente con la demanda discrecional.

Una vez que una solicitud está **Convertida**, la evaluación se vuelve de solo lectura. En ese punto la solicitud ya ha hecho su trabajo como registro de recepción y priorización.

## Relaciones

La pestaña **Relaciones** reúne los vínculos que explican cómo se conecta la solicitud con el resto del portafolio: primero las dependencias, después una tabla por tipo de registro vinculado y, por último, los enlaces y archivos. La insignia de la pestaña cuenta las dependencias, los registros vinculados que usted ve, los enlaces web y los archivos.

### Dependencias

Las dependencias identifican el trabajo que debe existir, terminarse o permanecer alineado antes de que esta solicitud pueda tener éxito. Use el campo de búsqueda para encontrar y añadir un elemento relacionado; elimine los enlaces que ya no quiera con el icono de eliminar del chip.

Una solicitud con datos débiles de dependencia puede parecer inofensiva hasta que choca con el trabajo existente.

### Registros vinculados

Debajo de las dependencias, cada tipo de registro tiene su propia tabla. Haga clic en una fila para abrir el registro.

| Sección | Columnas |
|---|---|
| **Líneas presupuestarias** | Referencia (`BL-4`), nombre, tipo (OPEX o CAPEX), proveedor, importe del año en la columna presupuestaria por defecto. Una fila de total aparece a partir de dos líneas |
| **Aplicaciones** | Referencia (`APP-3`), nombre, ciclo de vida, criticidad de negocio |
| **Activos** | Referencia (`AST-12`), nombre, tipo, entorno, estado |
| **Procesos de negocio** | Nombre, responsable del proceso |
| **Proyectos resultantes** | Referencia (`PRJ-7`), nombre, estado. Solo lectura: la conversión de la solicitud en proyecto escribe este vínculo |

Una sección no aparece si usted no puede leer su módulo: las líneas presupuestarias requieren el presupuesto, las aplicaciones las aplicaciones, los activos la infraestructura, los procesos de negocio los procesos de negocio, los proyectos resultantes los proyectos. Un Colaborador de negocio solo ve las aplicaciones y los proyectos en los que participa. Una línea presupuestaria o un proceso desactivado, o una aplicación o un activo desactivado o retirado, sigue en la lista con el nombre atenuado.

**Añadir y quitar vínculos** (`portfolio_requests:contributor`): **Añadir**, a la derecha de una sección, abre una búsqueda bajo el botón. Escriba un nombre o una referencia y elija un resultado: el vínculo se guarda al instante. Para quitar un vínculo, pase el cursor sobre la fila y haga clic en la cruz al final. No hay confirmación, y quitar un vínculo no elimina nada más. Vincular un proceso de negocio requiere también `business_processes:member`. Los lectores ven las tablas en solo lectura.

Los vínculos con líneas presupuestarias, aplicaciones y activos quedan registrados en la pestaña **Historial** de la solicitud.

### Enlaces y archivos

**Enlaces y archivos** cierra la pestaña: los enlaces web de la solicitud y sus archivos, una fila cada uno con su nombre, el dominio del enlace o el tamaño del archivo, y la fecha en que se añadió. Haga clic en un enlace para abrirlo en una pestaña nueva, o en un archivo para descargarlo. Con `portfolio_requests:member`:

- **Añadir enlace** abre un diálogo para una URL y un nombre opcional; el enlace se guarda al instante. Para cambiar un enlace, pase el cursor sobre su fila y haga clic en el lápiz.
- **Adjuntar archivo** abre el selector de archivos. También puede soltar archivos sobre la sección.
- Para quitar un enlace o un archivo, pase el cursor sobre la fila y haga clic en la cruz. Quitar un enlace muestra un mensaje y ofrece **Deshacer**, que vuelve a crear el enlace. Eliminar un archivo pide una confirmación antes.

## Conocimiento

La pestaña **Conocimiento** conecta la solicitud a documentos independientes de la Base de conocimiento. La insignia de la pestaña muestra el conteo de documentos de conocimiento relacionados.

La pestaña distingue entre dos tipos de conocimiento:

- Los **documentos vinculados** están directamente adjuntos a la solicitud.
- Los **documentos relacionados** se descubren a través del contexto más amplio de la solicitud, como dependencias, solicitudes relacionadas, proyectos resultantes y otros objetos vinculados.

Esta distinción importa:

- los documentos directos son parte del conjunto de documentación explícita de la solicitud
- los documentos relacionados añaden contexto sin afirmar que la solicitud los posee

### Qué puede hacer

Con permisos suficientes de Base de conocimiento, puede:

- crear un nuevo documento de conocimiento en blanco ya vinculado a la solicitud
- crear un documento vinculado desde una plantilla
- vincular un documento de conocimiento existente
- desvincular un documento vinculado directamente
- abrir cualquier documento vinculado o relacionado en el espacio de trabajo de Base de conocimiento

Sin esos permisos, la pestaña sigue funcionando como vista de referencia siempre que tenga permitido ver el conocimiento subyacente.

### Documentos gestionados versus documentos de Base de conocimiento

Los documentos gestionados **Propósito** y **Riesgos y mitigaciones** son parte de la propia solicitud. No son lo mismo que los documentos de Base de conocimiento.

Use documentos gestionados para la narrativa principal de la solicitud que siempre debe viajar con la solicitud. Use Base de conocimiento para documentos independientes que pueden necesitar su propio ciclo de vida, relaciones, exportaciones, plantillas y reutilización más allá de una sola solicitud.

## Convertir una solicitud en proyecto

Una vez que una solicitud alcanza **Aprobada**, el espacio de trabajo ofrece **Convertir en proyecto** en el encabezado.

El flujo de conversión le permite:

- confirmar o ajustar el nombre del proyecto
- establecer fechas de inicio y fin planificadas
- revisar el texto actual del Propósito
- arrastrar el esfuerzo IT y de Negocio estimado derivado de las entradas de evaluación de la solicitud

Después de la conversión:

- la solicitud se convierte en un registro duradero de recepción y decisión
- el proyecto resultante aparece en el grupo **Proyectos resultantes** de la solicitud
- la evaluación se congela en la solicitud
- la solicitud aún puede abrirse para auditoría, contexto y rastreo de conocimiento

En otras palabras, la conversión no borra la solicitud. La promueve.

## Importación y exportación CSV

**Exportar** e **Importar** están disponibles para `portfolio_requests:admin`.

La exportación contiene las solicitudes que muestra la lista, con sus filtros, su búsqueda y su orden. **Formato**: **CSV** o **Excel (.xlsx)**, elegido en el diálogo y recordado por su navegador. El libro contiene las mismas columnas que el CSV en una hoja, con los números y las fechas como valores que Excel puede ordenar y filtrar. La importación lee los dos; en un libro, lee la primera hoja. Consulte [Archivos CSV y Excel](csv-files.md).

**Columnas**: el archivo empieza por `id` y `reference` (`REQ-12`), y después las columnas siguen el espacio de trabajo, pestaña por pestaña. La importación ignora `reference`.

Use exportar cuando necesite informes del portafolio o enriquecimiento sin conexión. Use importar cuando necesite crear o actualizar solicitudes en masa. Debido a que la importación puede alterar registros de recepción a escala, está intencionadamente reservada para administradores.

## Consejos

- **Use la importación DOCX para contenido existente**: Si ya tiene una declaración de propósito o un registro de riesgos en un documento Word, use el botón **Importar** en el editor de Propósito o Riesgos y mitigaciones en lugar de copiar y pegar. La importación convierte el documento a markdown y le advierte si algún contenido no pudo trasladarse.
- **Los filtros de alcance se mantienen**: La lista se abre en **Todas las solicitudes**. KANAP recuerda su última elección de alcance, de modo que no necesita volver a seleccionarlo cada sesión.
- **Las solicitudes convertidas están ocultas por defecto**: Si está buscando una solicitud que ya se convirtió en proyecto, añada **Convertida** al filtro de Estado en la lista.
- **De tarea a solicitud**: Cuando una tarea revele una iniciativa más grande, use **Convertir en solicitud** desde el espacio de trabajo de la tarea. La nueva solicitud hereda el título, descripción (como Propósito), clasificación y adjuntos de la tarea, y muestra la **Tarea de origen** en su encabezado.
