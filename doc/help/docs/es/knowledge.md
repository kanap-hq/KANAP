# Base de conocimiento

La Base de conocimiento es el espacio de trabajo de documentos de KANAP para políticas, procedimientos, notas técnicas, material de referencia y la documentación que necesita mantenerse conectada al trabajo real. Combina la escritura de forma libre con funcionalidades de gobernanza como plantillas, propiedad, revisión, historial de versiones y relaciones con aplicaciones, activos, proyectos, solicitudes y tareas.

A diferencia de un recurso compartido de archivos, la Base de conocimiento no es solo un lugar para almacenar documentos. La decisión de diseño importante es que cada artículo puede clasificarse, revisarse, versionarse, exportarse y vincularse a objetos operativos en toda la plataforma. Eso facilita encontrar el artículo y le da contexto cuando alguien lo abre desde otro espacio de trabajo.

## Dónde encontrarlo

- Espacio de trabajo: **Base de conocimiento**
- Permisos:
  - `knowledge:reader` le permite abrir y leer documentos
  - `knowledge:member` le permite crear, editar, comentar, organizar carpetas y gestionar metadatos de documentos
  - `knowledge:admin` añade administración de bibliotecas y movimientos entre bibliotecas

Si puede leer un documento pero no editarlo, el espacio de trabajo permanece disponible en modo de solo lectura.

## Cómo está organizada la Base de conocimiento

La Base de conocimiento se construye en torno a cuatro capas de organización: bibliotecas, carpetas, tipos de documento y relaciones.

### Bibliotecas

Las bibliotecas son los contenedores de más alto nivel. Separan poblaciones de documentos que deben gestionarse de forma diferente.

Patrones típicos:
- Use una biblioteca regular para la base de conocimiento operativa de su equipo.
- Use la biblioteca **Plantillas** para documentos iniciales reutilizables.
- Use la biblioteca **Documentos gestionados** para documentos que se originan en otro espacio de trabajo y siguen estando parcialmente controlados allí.

Consecuencias de la elección de la biblioteca:
- La biblioteca activa determina qué árbol de carpetas ve y dónde se crean los nuevos documentos en blanco.
- En una biblioteca normal, los documentos se comportan como artículos de conocimiento estándar.
- En **Plantillas**, los documentos publicados se convierten en puntos de partida reutilizables para nuevos artículos y se agrupan por tipo de documento en el selector de plantillas.
- En **Documentos gestionados**, los artículos pueden seguir siendo legibles y editables, pero algunos metadatos están controlados por el espacio de trabajo de origen en lugar de desde la propia Base de conocimiento.

La administración de bibliotecas es intencionadamente más estricta que la edición de documentos. Crear, renombrar, eliminar o reorganizar bibliotecas es responsabilidad del administrador porque esos cambios afectan a la navegación y la propiedad para todos.

### Bibliotecas restringidas

Por defecto, cada biblioteca está abierta a cualquier persona con el permiso `knowledge`. Un administrador de biblioteca puede cambiar una biblioteca a acceso **Restringido** desde el diálogo de configuración de la biblioteca. Las bibliotecas restringidas se marcan con un pequeño icono de candado en la pestaña de la biblioteca.

En una biblioteca restringida:

- Solo el responsable de la biblioteca, las personas listadas como **Lectores** y las personas listadas como **Escritores** pueden ver la biblioteca y sus documentos.
- Los lectores pueden abrir y leer artículos dentro de la biblioteca pero no pueden editarlos.
- Los escritores pueden leer y editar artículos. Los escritores también necesitan el permiso estándar `knowledge:member` para realmente crear o modificar documentos.
- El responsable siempre puede leer y gestionar la biblioteca.
- Cambiar de **Restringido** de vuelta a **Predeterminado** borra las listas de lectores y escritores. El diálogo pide confirmación antes de descartar la membresía.

Use bibliotecas restringidas para contenido sensible (procedimientos de seguridad, documentos de RRHH, material ejecutivo) donde desee un control de acceso de grano fino dentro de la Base de conocimiento en lugar de depender solo de roles globales.

Las bibliotecas restringidas también limitan lo que un agente de IA puede leer. Cuando un administrador restringe un agente a un conjunto de bibliotecas elegido en sus ajustes **Fuentes de conocimiento y web**, esa elección se combina con las bibliotecas que el administrador que lo configura ya puede leer: un agente nunca ve más que la persona que lo configuró. Una biblioteca restringida a la que el administrador no puede acceder también permanece invisible para el agente.

### Carpetas

Las carpetas organizan documentos dentro de una biblioteca. No son cosméticas: dan forma a cómo los usuarios navegan por la biblioteca y cómo los equipos mantienen una estructura compartida a lo largo del tiempo.

Comportamiento importante:
- Las carpetas existen dentro de una biblioteca. No se comparten entre bibliotecas.
- En una vista de biblioteca única, los documentos pueden arrastrarse a carpetas para una reorganización rápida.
- Las carpetas pueden anidarse para crear una estructura de navegación.
- Eliminar una carpeta no elimina sus documentos. En su lugar, los documentos vuelven a **Sin archivar**.
- Una carpeta con subcarpetas no puede eliminarse hasta que se limpie la jerarquía.

Use carpetas para áreas temáticas estables, no para estados de flujo de trabajo temporales. El estado y el flujo de trabajo ya existen para eso.

### Filtros de alcance

El filtro de alcance de nivel superior cambia qué documentos se listan:

- **Mis documentos** se centra en los documentos que usted posee.
- **Documentos de mi equipo** se centra en los documentos que posee su equipo.
- **Todos los documentos** elimina el alcance de propiedad y muestra la población completa que tiene permitido ver.

Si no está asignado a un equipo, el alcance de equipo no está disponible. La página se abre en **Todos los documentos**, y su última elección de alcance se recuerda, lo cual es conveniente cuando coincide con su modo de trabajo normal y ligeramente confuso cuando olvida que lo cambió ayer.

### Plantillas y tipos de documento

Las plantillas son documentos ordinarios de la Base de conocimiento almacenados en la biblioteca **Plantillas** y publicados para su reutilización. Crear un documento a partir de una plantilla copia el contenido de la plantilla en un nuevo artículo y preserva la referencia a la plantilla.

Los tipos de documento importan porque:
- clasifican el artículo para filtrado e informes
- agrupan plantillas en el selector de creación
- ayudan a los lectores a entender qué tipo de documento están abriendo

Un comportamiento sutil pero importante: si un documento se creó a partir de una plantilla y luego cambia su tipo de documento a otro distinto, el vínculo a la plantilla se borra. Eso evita que el artículo finja seguir una plantilla que ya no coincide con él.

Al navegar por la biblioteca **Plantillas**, los administradores pueden abrir el panel **Gestionar tipos** para crear, renombrar, desactivar o reordenar tipos de documento.

### Documentos gestionados

Algunos artículos de la Base de conocimiento se crean a partir de Solicitudes, Proyectos, Aplicaciones, Activos, Tareas o Incidentes. Estos aparecen como documentos **Integrados**, agrupados en la biblioteca **Documentos gestionados** por el espacio de trabajo del que proceden.

Los documentos gestionados mantienen la experiencia de escritura dentro de la Base de conocimiento, pero el espacio de trabajo de origen sigue controlando parte de sus metadatos. En la práctica, esto significa:
- el estado puede estar controlado por el objeto de origen
- la ubicación de la carpeta puede estar fijada por el espacio de trabajo de origen
- el tipo de documento o la plantilla pueden estar fijados
- las relaciones directas pueden ser de solo lectura en la Base de conocimiento
- el flujo de trabajo de revisión de la Base de conocimiento no está disponible para estos documentos
- los documentos gestionados no pueden moverse fuera de la Base de conocimiento ni eliminarse de la lista de la Base de conocimiento

Esto protege el vínculo entre el documento y el registro operativo que lo posee.

El acceso también sigue al objeto de origen. El caso más claro es la carpeta **Incidentes**: una revisión del incidente solo puede abrirla quien tenga derecho a ver ese incidente, sean cuales sean sus permisos sobre la Base de conocimiento; pasa a ser de solo lectura en cuanto el incidente se cierra o se cancela, y desaparece de las listas, la búsqueda, las exportaciones y el asistente para cualquiera excluido de un incidente restringido. Consulte [Incidentes](incidents.md).

## Trabajar con la lista de la Base de conocimiento

La página principal de la Base de conocimiento es un registro de documentos con herramientas de navegación y organización a su alrededor.

### Qué muestra la lista

La cuadrícula predeterminada se centra en la identidad y la gobernanza del documento:

- **Ref**: la referencia permanente `DOC-{número}`
- **Título**
- **Estado**
- **Tipo**
- **Versión**
- **Responsable**
- **Carpeta**
- **Actualizado**

**Columnas adicionales** (ocultas por defecto, disponibles mediante el selector de columnas):
- **Plantilla**: muestra la plantilla a partir de la cual se creó el documento, si la hay
- **Biblioteca**: aparece automáticamente cuando **Todas las bibliotecas** está activado, y puede mostrarse manualmente en otros casos

### Búsqueda, filtros y navegación

La Base de conocimiento admite dos estilos de navegación:

- Navegar por una biblioteca con su árbol de carpetas cuando ya conoce el área temática.
- Buscar en todas las bibliotecas cuando le importa más el artículo que su ubicación de almacenamiento.

El conmutador **Todas las bibliotecas** cambia la experiencia significativamente:
- el árbol de carpetas ya no es el principal motor
- la búsqueda se vuelve más amplia
- la lista puede comparar contenido entre bibliotecas
- la columna Biblioteca pasa a formar parte del contexto del resultado

La navegación de biblioteca única es mejor para la curación. La búsqueda en todas las bibliotecas es mejor para la recuperación.

**Filtrado**:
- Barra de búsqueda rápida en la parte superior de la cuadrícula
- Filtros de columna en **Estado**, **Tipo**, **Responsable**, **Carpeta**, **Plantilla** y **Biblioteca** mediante selectores de conjunto de casillas

### Mover documentos y carpetas

En una vista de biblioteca única, los documentos pueden arrastrarse a las carpetas. Aparece un controlador de arrastre en cada fila cuando el arrastre está disponible. Esta es la forma más rápida de ordenar una biblioteca sin abrir cada artículo.

Los movimientos entre bibliotecas son más controlados:
- requieren un permiso superior (`knowledge:admin`)
- no están disponibles para documentos gestionados
- los documentos plantilla están intencionadamente restringidos porque las plantillas están destinadas a permanecer en el sistema de plantillas, no a perderse en cualquier sitio
- no funcionarán hacia o desde una biblioteca restringida si el escritor carece de acceso

Las carpetas también pueden arrastrarse entre bibliotecas soltándolas en la pestaña de la biblioteca de destino. Se abre un diálogo de confirmación que le permite elegir una carpeta de destino antes de que se ejecute el movimiento.

Los movimientos de carpetas siguen la misma idea que los movimientos de documentos. Reorganizar una carpeta cambia la estructura de navegación para todos los que usan esa biblioteca, así que trátelo como un cambio de arquitectura de información, no solo como limpieza personal.

### Acciones de la lista

- **Nuevo** (botón dividido): crea un documento en blanco en la biblioteca activa, o abre el selector de plantillas para crear desde una plantilla publicada
- **Mover**: mueve los documentos seleccionados a una carpeta o biblioteca diferente
- **Eliminar**: elimina permanentemente los documentos seleccionados (solo administradores; no disponible para documentos gestionados)
- **Gestionar tipos**: visible solo dentro de la biblioteca **Plantillas** para administradores; abre el editor de tipos de documento

## Crear y dar forma a un documento

Los nuevos artículos pueden empezar de dos formas:

- **Documento en blanco**: mejor cuando ya conoce la estructura que necesita
- **Desde plantilla**: mejor cuando el equipo desea secciones, lenguaje o expectativas de revisión coherentes

Cuando crea desde una plantilla, el contenido de la plantilla se copia en el nuevo documento. A partir de ese momento, el nuevo artículo es independiente. Actualizar la plantilla más tarde no reescribe los documentos existentes.

El espacio de trabajo del documento mantiene la escritura en el centro y la gobernanza en la barra lateral.

Las propiedades principales incluyen:
- **Título**: la etiqueta principal por la que los lectores buscarán y citarán
- **Estado**: el ciclo de vida del artículo
- **Carpeta**: dónde vive el artículo dentro de su biblioteca
- **Tipo**: qué tipo de documento es
- **Basado en plantilla**: el linaje de la plantilla, cuando sea relevante
- **Resumen**: una breve descripción para contexto

Después del primer guardado, el modelo completo de gobernanza del documento queda disponible. Es entonces cuando puede gestionar colaboradores, clasificaciones, relaciones, comentarios e historial de versiones contra una referencia de documento estable.

### Estado y qué significa

El estado no es decoración. Le dice a los lectores con qué seriedad deben tratar el artículo.

| Estado | Significado | Consecuencia práctica |
|--------|-------------|----------------------|
| **Borrador** | Trabajo en progreso | Adecuado para la autoría e iteración interna |
| **En revisión** | Bajo revisión formal | La edición está bloqueada mientras el flujo de trabajo está activo |
| **Publicado** | Aprobado para uso normal | Mejor opción para contenido en el que la gente debe confiar |
| **Archivado** | Conservado para registro | Generalmente sigue siendo útil para historial, no para guía activa |
| **Obsoleto** | Reemplazado o ya no válido | Los lectores no deben seguirlo como práctica actual |

La Base de conocimiento permite la publicación directa incluso sin un flujo de trabajo de revisión formal. Eso es útil para material de bajo riesgo, pero también significa que los equipos necesitan disciplina sobre cuándo la revisión es opcional y cuándo debería esperarse.

## Escritura, bloqueos y autoguardado

La Base de conocimiento usa un bloqueo de edición para que solo una persona edite activamente un documento a la vez.

Cómo funciona:
- entrar en modo de edición adquiere el bloqueo
- otros usuarios aún pueden abrir y leer el artículo
- no pueden editar mientras el bloqueo lo tiene otra persona
- si el bloqueo expira o se pierde, el modo de edición se detiene y debe volver a entrar

Esto evita las sobrescrituras silenciosas, lo cual es excelente para la integridad del documento y menos excelente si dos personas pensaban que solo iban a hacer "un pequeño retoque".

Mientras edita:
- los cambios se guardan manualmente con **Guardar**
- el contenido sin guardar también se autoguarda periódicamente mientras su bloqueo está activo
- **Descartar** vuelve al último estado guardado

El espacio de trabajo también admite la subida de imágenes en línea dentro del área de contenido markdown, de modo que las capturas de pantalla y los diagramas pueden vivir con el artículo en lugar de en una carpeta misteriosa en el escritorio de alguien. Cuando pega o hace referencia a una imagen desde una URL externa, la imagen se importa automáticamente y se almacena dentro del documento, de modo que sigue estando disponible incluso si la URL original se cae.

## Importar un documento Word

Puede importar un documento Word (`.docx`) a un artículo existente de la Base de conocimiento. El botón **Importar** aparece en la barra de herramientas del espacio de trabajo una vez que el documento se ha guardado al menos una vez y está en modo de edición.

Cómo funciona:

- Haga clic en **Importar** y seleccione un archivo `.docx` de su ordenador.
- Si el artículo ya tiene contenido, un diálogo de confirmación pregunta si desea reemplazarlo. Elegir **Continuar** sobrescribe el markdown actual con el contenido importado.
- El contenido de Word se convierte a markdown y se carga en el editor. Las imágenes incrustadas en el archivo Word se extraen y se almacenan como adjuntos en línea, de modo que no tiene que volver a subirlas manualmente.
- Después de la importación, sus cambios están sin guardar. Use **Guardar** para persistir el contenido importado.

Si la importación encuentra un conflicto de bloqueo (alguien más adquirió el bloqueo) o un bloqueo expirado, el modo de edición termina y se muestra un mensaje apropiado. Vuelva a entrar en modo de edición e inténtelo de nuevo.

Las advertencias de importación — por ejemplo, formato no soportado que se simplificó durante la conversión — aparecen brevemente como una notificación en la parte inferior de la pantalla.

Use la función de importación al migrar documentos Word existentes a la Base de conocimiento. Es más rápida y segura que copiar y pegar, y preserva las imágenes incrustadas automáticamente.

## Formatos de exportación

Los artículos de la Base de conocimiento pueden exportarse como:

- **PDF**
- **DOCX**
- **ODT**

La exportación está disponible cuando el artículo tiene contenido. Esto es útil cuando:
- un documento necesita circular fuera de KANAP
- un revisor prefiere marcado en formato Word
- se necesita una instantánea PDF estable para compartir o conservar

La exportación no reemplaza el artículo en vivo. La versión de la Base de conocimiento sigue siendo la fuente gobernada, mientras que los archivos exportados son formatos de distribución.

## Generar documentos desde el chat

Si el Asistente IA está habilitado en su KANAP, puede pedirle que redacte un artículo de la Base de conocimiento por usted desde el chat. El asistente prepara una vista previa que usted revisa antes de que se guarde nada. Confirmar la vista previa crea un documento real de la Base de conocimiento con el contenido, el tipo, el linaje de plantilla y cualquier relación que haya especificado — exactamente como si lo hubiera escrito usted mismo.

Los documentos generados siguen las mismas reglas de gobernanza que los escritos a mano: propiedad, estado, historial de versiones, bloqueos y flujo de trabajo de revisión, todo se aplica.

## Colaboradores y flujo de trabajo de revisión

Cada documento puede tener un modelo de colaboradores estructurado:

- **Responsable**: la persona responsable del artículo
- **Autores**: personas que ayudan a mantener el contenido
- **Revisores**: revisores de etapa 1
- **Aprobadores**: aprobadores de etapa 2

El responsable importa operativamente. El filtrado por alcance se basa en la propiedad, y un documento sin un responsable claro tiene muchas más probabilidades de convertirse en "material de fondo importante" que nadie actualiza.

### Flujo de trabajo de revisión

El flujo de trabajo de revisión es opcional pero deliberado:

- los revisores trabajan primero
- los aprobadores actúan después de que la etapa de revisión esté completa
- los aprobadores y revisores pueden registrar notas de decisión
- solicitar cambios envía el documento de vuelta para revisión
- el flujo de trabajo lleva la cuenta de la última revisión aprobada

Consecuencias importantes:
- no puede solicitar revisión mientras hay cambios sin guardar
- necesita revisores o aprobadores asignados antes de poder solicitar una revisión
- los documentos archivados y obsoletos no son candidatos para una nueva solicitud de revisión
- los documentos gestionados (integrados) no usan el flujo de trabajo de revisión de la Base de conocimiento
- una vez que comienza la revisión, la edición normal se deshabilita hasta que la revisión se aprueba, se solicitan cambios o se cancela la revisión

Esto hace que la revisión tenga sentido. Si los autores pudieran seguir editando el contenido durante la aprobación, el documento aprobado sería un objetivo móvil, lo cual es una espléndida forma de crear discusiones y una pobre forma de crear documentación.

## La barra lateral del espacio de trabajo del documento

La barra lateral tiene dos pestañas: **Propiedades** y **Comentarios**.

### Pestaña Propiedades

La pestaña Propiedades organiza los datos de gobernanza en secciones plegables:

- **Estado, Carpeta, Tipo, Plantilla y Resumen** son siempre visibles en la parte superior.
- **Colaboradores**: asignar responsable, autores, revisores y aprobadores. Cada rol se guarda independientemente del guardado principal del documento.
- **Flujo de trabajo de revisión**: muestra el estado actual del flujo de trabajo cuando hay una revisión activa, incluyendo el progreso de etapa, las decisiones de los participantes y la actividad reciente del flujo de trabajo. Cuando no hay flujo de trabajo activo, puede solicitar una revisión desde aquí.
- **Clasificación**: etiquetar el documento con categorías y flujos del esquema de clasificación de su organización. Pueden añadirse múltiples filas de clasificación.
- **Relaciones**: vincular el documento a aplicaciones, activos, proyectos, solicitudes o tareas. Cada tipo de relación tiene su propio campo de búsqueda y selección.
- **Versiones**: lista las revisiones guardadas con marcas de tiempo. **Revertir** está disponible solo mientras tiene un bloqueo de edición activo.

### Pestaña Comentarios

La pestaña Comentarios muestra la actividad alrededor del documento: comentarios, eventos del flujo de trabajo e historial de cambios. Use comentarios para contexto de revisión, aclaración editorial o justificación de cambios que deben permanecer adjuntos al artículo.

## Relaciones y contexto entre espacios de trabajo

Los documentos de la Base de conocimiento pueden relacionarse directamente con:

- Aplicaciones
- Activos
- Proyectos
- Solicitudes
- Tareas

Las relaciones no son solo etiquetas. Controlan dónde aparece el documento en otras partes de KANAP y cómo los usuarios lo descubren desde los espacios de trabajo operativos.

Consecuencias de añadir relaciones:
- el documento se vuelve más fácil de encontrar desde el objeto vinculado
- los lectores que abren el objeto obtienen documentación contextual sin tener que buscar manualmente
- los informes y la gobernanza alrededor del objeto se vuelven más completos

Consecuencias de relaciones deficientes:
- documentos útiles permanecen invisibles fuera de la Base de conocimiento
- los usuarios crean duplicados porque no pueden encontrar el artículo existente
- el mismo tema empieza a derivar entre múltiples documentos

En los espacios de trabajo relacionados, los paneles de Conocimiento distinguen entre:
- **Documentos vinculados**: directamente adjuntos al objeto
- **Documentos relacionados**: emergen a través del contexto y la procedencia de trabajo conectado

Esa distinción importa. Los enlaces directos expresan una relación intencional. Los documentos relacionados expresan contexto útil, pero no el mismo nivel de propiedad.

## Buenos hábitos operativos

- Use bibliotecas para los límites de gobernanza, carpetas para la navegación y relaciones para el contexto de negocio.
- Mantenga la propiedad actualizada. Un buen artículo con el responsable equivocado suele tener los días contados.
- Use plantillas cuando la coherencia importe entre equipos.
- Use revisión para documentos que impulsan decisiones, controles o procesos repetibles.
- Marque el contenido desactualizado como archivado u obsoleto en lugar de dejar que los lectores adivinen.
- Importe documentos Word al migrar contenido existente a la Base de conocimiento en lugar de copiar y pegar, de modo que las imágenes incrustadas se preserven automáticamente.
- Recurra a las bibliotecas restringidas cuando el acceso importe a nivel de biblioteca — no confíe en el diseño de carpetas para ocultar contenido sensible.
