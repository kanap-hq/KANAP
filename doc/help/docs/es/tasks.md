# Tareas

Las tareas le ayudan a realizar el seguimiento de elementos de acción, entregables y paquetes de trabajo en todas sus entidades de KANAP. Se utilizan para recordatorios de renovación, seguimientos, verificaciones de conformidad, entregables de proyectos y cualquier otro trabajo que necesite seguimiento.

## Primeros pasos

Navegue a **Portafolio > Tareas** para ver todas las tareas de su organización. Haga clic en **Nuevo** para crear una tarea.

### Crear una nueva tarea

Al hacer clic en **Nuevo**, se abre el espacio de trabajo completo de la tarea. Para crear una tarea:

1. **Introduzca el título** (obligatorio):
   - Escriba el título de la tarea en el campo de texto superior

2. **Elija el contexto**:
   - **Tarea independiente** (predeterminado): Mantenga "Relacionado con" como **Independiente**
   - **Tarea vinculada**: Seleccione **Proyecto**, **OPEX**, **Contrato** o **CAPEX**, luego elija el elemento específico

3. **Complete los detalles opcionales**:
   - **Tipo de tarea**: Seleccione una categoría para el trabajo (p. ej., Tarea, Bug, Problema, Incidente). Por defecto es "Tarea" cuando está disponible
   - **Descripción**: Añada información detallada usando el editor markdown (admite formato, listas, enlaces, imágenes)
   - **Fase**: Para tareas de proyecto, seleccione una fase o deje como "Nivel de proyecto"
   - **Clasificación** (tareas independientes y de proyecto): Establezca **Origen**, **Categoría**, **Flujo** y **Empresa**. Para tareas de proyecto, estos valores se heredan del proyecto padre. Para tareas independientes, los valores de clasificación predeterminados de su organización se rellenan automáticamente cuando están disponibles
   - **Estado**: Por defecto es **Abierto**
   - **Prioridad**: Por defecto es **Normal**
   - **Fechas**: Establezca fechas de inicio y vencimiento
   - **Asignado**: Por defecto es usted; cámbielo si es necesario

4. Haga clic en **Crear** cuando esté listo (se habilita una vez establecido el título). También puede pulsar **Ctrl+S** (o **Cmd+S** en Mac)

**Consejo**: Puede pegar imágenes directamente en la descripción. Se suben automáticamente al almacenamiento cuando crea la tarea.

**Nota**: Las tareas también pueden crearse desde otros espacios de trabajo (partidas OPEX, Contratos, partidas CAPEX, Proyectos del portafolio) donde la relación viene preseleccionada.

**Campos obligatorios**:
  - **Título**: Una descripción corta de lo que necesita hacerse

**Muy recomendado**:
  - **Descripción**: Descripción detallada de la tarea
  - **Asignado**: Quién es responsable
  - **Fecha de vencimiento**: Cuándo debe completarse

---

## Dónde encontrarlo

- Ruta: **Portafolio > Tareas**
- Permisos:
  - Necesita al menos `tasks:reader` para ver tareas
  - Necesita `tasks:member` para crear tareas y editar tareas en contextos independiente/OPEX/Contrato/CAPEX
  - Necesita `portfolio_projects:contributor` para guardar una tarea cuando el contexto destino es un proyecto
  - Necesita `tasks:admin` para eliminación masiva, importación CSV y exportación CSV

Si no ve Tareas en el menú, solicite a su administrador que le otorgue los permisos apropiados.

---

## Trabajar con la lista

La cuadrícula de Tareas muestra todas las tareas de su organización.

**Filtro de alcance superior**:
  - **Mis tareas**: tareas asignadas a usted o creadas por usted
  - **Tareas de mi equipo**: tareas asignadas a cualquier miembro de su equipo de Portafolio (incluyendo las suyas)
  - **Todas las tareas** (predeterminado): la cuadrícula completa de tareas
  - Si no está asignado a un equipo de Portafolio, **Tareas de mi equipo** está deshabilitado
  - La página se abre en **Todas las tareas**. Su selección se recuerda entre sesiones; al volver a la página se restaura su última elección

**Columnas predeterminadas** (visibles por defecto):

| Columna | Qué muestra |
|---------|-------------|
| **#** | Referencia del elemento (p. ej., T-42). Haga clic para abrir el espacio de trabajo |
| **Título de la tarea** | El nombre de la tarea. Haga clic para abrir el espacio de trabajo |
| **Tipo de tarea** | El tipo de trabajo (p. ej., Tarea, Bug, Problema, Incidente) |
| **Contexto** | El tipo de entidad (Proyecto, OPEX, Contrato, CAPEX o "Independiente") |
| **Estado** | Estado actual con un punto de color |
| **Puntuación** | Puntuación de prioridad calculada |
| **Asignado** | Persona asignada |
| **Clasificación** | Categoría del portafolio |
| **Flujo** | Flujo del portafolio |

**Columnas adicionales** (ocultas por defecto, habilitar mediante el menú de columnas):

| Columna | Qué muestra |
|---------|-------------|
| **Entrada relacionada** | El nombre de la entidad vinculada (vacío para tareas independientes) |
| **Fase** | Fase del proyecto (para tareas de proyecto) |
| **Prioridad** | Nivel de prioridad |
| **Fecha de vencimiento** | Cuándo vence la tarea |
| **Creado** | Cuándo se creó la tarea |
| **Última modificación** | Cuándo se actualizó la tarea por última vez |
| **Descripción** | Texto de descripción de la tarea |
| **Origen** | Clasificación de origen del portafolio |
| **Empresa** | Clasificación de empresa |

**Colores de estado**:
  - **Abierto**: Gris
  - **En progreso**: Azul
  - **Pendiente**: Naranja
  - **En pruebas**: Púrpura
  - **Completado**: Verde
  - **Cancelado**: Rojo

**Colores de prioridad**:
  - **Bloqueante**: Rojo
  - **Alta**: Naranja
  - **Normal**: Gris
  - **Baja**: Azul
  - **Opcional**: Verde

**Filtro predeterminado**: Las tareas activas se muestran por defecto (`Abierto`, `En progreso`, `Pendiente`, `En pruebas`). Incluya `Completado` y `Cancelado` en el filtro de Estado para ver tareas cerradas.

**Acciones**:
  - **Nuevo**: Crear una tarea independiente (requiere `tasks:member`)
  - **Importar CSV**: Subir un archivo CSV para crear o actualizar tareas (requiere `tasks:admin`)
  - **Exportar CSV**: Descargar tareas a un archivo CSV (requiere `tasks:admin`)
  - **Eliminar seleccionados**: Eliminar las tareas seleccionadas (requiere `tasks:admin`)

---

## El espacio de trabajo de la tarea

Haga clic en cualquier fila para abrir el espacio de trabajo de la tarea. El espacio de trabajo coloca el contenido de la tarea (descripción, adjuntos, actividad) en el centro y expone un panel de **Propiedades** en el borde derecho que puede mostrar u ocultar.

### Barra de herramientas del encabezado

El encabezado contiene:
  - Migración de **Volver** a **Tareas** (o al espacio de trabajo del proyecto de origen, cuando viene de uno)
  - **Indicador de posición**: Su posición en la lista filtrada (p. ej., "3 de 12") con flechas **Anterior** / **Siguiente**
  - **Enviar enlace**: Enviar por correo electrónico un enlace a la tarea
  - **Convertir en solicitud**: Promover la tarea a una solicitud del portafolio
  - **Eliminar**: Eliminar la tarea, con sus comentarios y su historial (requiere `tasks:admin`). Primero se pide confirmación, y la eliminación no se puede deshacer
  - **Cerrar**: Volver a la lista de tareas

Debajo de la barra de herramientas, el bloque de título muestra:
  - **Chip de referencia del elemento** (p. ej., T-42): Haga clic para copiar la referencia al portapapeles
  - **Título**: Haga clic para editar en línea (requiere `tasks:member`)
  - **Estado / Prioridad / Puntuación / Asignado / Fecha de vencimiento** como chips de metadatos compactos y clicables
  - **Chip de proyecto** para tareas de proyecto (vincula al espacio de trabajo del proyecto)

### Área de contenido principal

**Descripción**: Un editor markdown que admite formato, listas, enlaces, bloques de código e imágenes. Puede pegar imágenes directamente; se suben automáticamente. Pulsar **Tab** desde el campo de título salta al editor de descripción. La descripción se autoguarda un par de segundos después de que deje de escribir; el encabezado muestra **Guardado** brevemente cada vez que persiste.

**Adjuntos**: Arrastre y suelte archivos sobre la descripción, o use el área de carga cuando aparezca. Los archivos subidos aparecen como chips debajo de la descripción. Haga clic en un chip para descargar; haga clic en el botón **x** para eliminar (requiere permiso de edición). Máximo 20 MB por archivo.

**Sección de actividad**: Alterne entre tres vistas:
  - **Comentarios**: Un formulario de actividad unificado (comentario + cambio de estado opcional + registro de tiempo opcional en un solo envío) más el hilo de comentarios
  - **Historial**: Todos los cambios de campo y estado de la tarea, con marcas de tiempo y autores
  - **Registro de tiempo**: Entradas de tiempo (disponible solo para tareas independientes y de proyecto)

### Panel de Propiedades

El panel es plegable (haga clic en la pestaña vertical **Propiedades** en el borde derecho para abrirlo o cerrarlo; pulse **P** como atajo). Su anchura y estado abierto se recuerdan localmente. El panel contiene cuatro grupos, separados por divisores:

**Contexto**:
  - **Relacionado con**: Independiente, Proyecto, OPEX, Contrato o CAPEX. Puede cambiar el tipo y elegir un nuevo elemento; al guardar, KANAP aplica cualquier efecto secundario relacionado (consulte [Cambiar el contexto de la tarea](#cambiar-el-contexto-de-la-tarea))
  - **Fase** (solo tareas de proyecto): Por defecto es **Nivel de proyecto** a menos que elija una fase del proyecto
  - **Tipo de tarea**: Tarea, Bug, Problema, Incidente o cualquier tipo personalizado configurado por su administrador

**Clasificación** (solo tareas independientes y de proyecto):
  - **Origen**: De dónde provino el trabajo
  - **Categoría**: La categoría del portafolio para el trabajo
  - **Flujo**: El flujo específico dentro de la categoría (filtrado por la categoría seleccionada; deshabilitado hasta que se selecciona una categoría)
  - **Empresa**: La empresa a la que se refiere este trabajo
  - Para tareas OPEX/Contrato/CAPEX, esta sección está oculta a menos que los valores de clasificación se hayan establecido previamente

**Personas**:
  - **Solicitante**: Quién solicitó el trabajo (por defecto el creador)
  - **Observadores**: Personas adicionales que deben ver la tarea

**Seguimiento**:
  - **Fecha de inicio**
  - **Tiempo dedicado**: Tiempo total registrado, con un atajo **+ Registrar tiempo**
  - **Aplicaciones**: Apps y servicios con los que se relaciona esta tarea
  - **Activos**: Activos de hardware/nube con los que se relaciona esta tarea
  - **Conocimiento**: Documentos de conocimiento vinculados y un atajo para crear nuevos (requiere `knowledge:member` para crear)

**Nota**: La edición de campos en el panel se guarda inmediatamente. No hay botón Guardar en el panel.

### Cambiar el contexto de la tarea

Cuando cambia el contexto de una tarea y guarda, KANAP aplica el cambio en una sola operación (contexto más cualquier otro campo editado juntos).

- **Proyecto a Independiente**: La fase se borra, la clasificación se conserva
- **Proyecto a OPEX/Contrato/CAPEX**: La fase y la clasificación se borran
- **Cualquiera a Proyecto**:
  - Se requiere permiso de proyecto (`portfolio_projects:contributor`)
  - La fase se restablece a nivel de proyecto a menos que elija una fase válida para ese proyecto
  - La clasificación existente se conserva; los valores faltantes se completan automáticamente con los valores predeterminados del proyecto

---

## Estados de las tareas

| Estado | Significado | Cuándo usar |
|--------|-------------|-------------|
| **Abierto** | Aún no iniciado | Predeterminado para nuevas tareas |
| **En progreso** | El trabajo ha comenzado | Cuando alguien empieza a trabajar en ella |
| **Pendiente** | Esperando a alguien más | Cuando el asignado está bloqueado y necesita información/decisión |
| **En pruebas** | Listo para validación | Cuando la implementación está completa y pendiente de revisión/pruebas |
| **Completado** | Completado exitosamente | Cuando el trabajo está terminado (requiere tiempo registrado para tareas de proyecto) |
| **Cancelado** | Ya no es necesario | Cuando la tarea se vuelve irrelevante |

**Importante**: Para tareas de proyecto, no puede marcar una tarea como **Completado** hasta que haya registrado al menos algo de tiempo. Esto asegura un seguimiento preciso del esfuerzo.

---

## Niveles de prioridad

| Prioridad | Caso de uso |
|-----------|-------------|
| **Bloqueante** | Bloquea otro trabajo; requiere atención inmediata |
| **Alta** | Importante y urgente |
| **Normal** | Prioridad estándar (predeterminado) |
| **Baja** | Se puede diferir si es necesario |
| **Opcional** | Deseable, abordar cuando la capacidad lo permita |

---

## Seguimiento de tiempo

Las tareas independientes y las tareas de proyecto admiten seguimiento detallado de tiempo mediante el Registro de tiempo. El seguimiento de tiempo no está disponible para tareas OPEX, Contrato o CAPEX.

### Registrar tiempo

1. Haga clic en **+ Registrar tiempo** en el panel de Propiedades (grupo Seguimiento), o abra la pestaña **Registro de tiempo** en la sección de actividad
2. Seleccione la **Categoría**: IT o Negocio (determina cómo el tiempo contribuye al esfuerzo del proyecto)
3. Introduzca la fecha en que se realizó el trabajo
4. Introduzca el tiempo en días y/u horas
5. Añada notas opcionales describiendo el trabajo
6. Haga clic en **Registrar tiempo**

**Categoría**: Para tareas de proyecto, la categoría determina si el tiempo cuenta para el esfuerzo IT o el esfuerzo de Negocio del proyecto. Esto coincide con el propio sistema de registro de tiempo del proyecto.

### Ver entradas de tiempo

La pestaña **Registro de tiempo** en la sección de actividad muestra todas las entradas de tiempo de la tarea:
  - Fecha en que se realizó el trabajo
  - Categoría (IT o Negocio)
  - Persona que registró el tiempo
  - Horas registradas
  - Notas

### Editar o eliminar entradas

Puede editar o eliminar sus propias entradas de tiempo desde la tabla de Registro de tiempo.

---

## Adjuntos

Las tareas admiten adjuntos de archivos para documentos, capturas de pantalla y otros archivos de soporte.

### Añadir adjuntos

- Arrastre y suelte archivos sobre el área de descripción, o
- Haga clic en **Examinar archivos** en el área de carga cuando esté visible
- Los archivos aparecen como chips debajo de la descripción una vez subidos

**Límite de tamaño de archivo**: Máximo 20 MB por archivo.

### Gestionar adjuntos

- **Descargar**: Haga clic en un chip de adjunto para descargar el archivo
- **Eliminar**: Haga clic en el botón **x** del chip para eliminar el adjunto (requiere permiso de edición)

Los adjuntos son visibles para cualquier persona que pueda ver la tarea.

---

## Importación y exportación de descripción

El campo de descripción admite importación y exportación de documentos para que pueda trabajar con contenido fuera de KANAP.

### Importar un documento

1. Abra un espacio de trabajo de tarea existente (la importación no está disponible durante la creación de la tarea)
2. Haga clic en el botón **Importar** junto al encabezado de **Descripción**
3. Seleccione un archivo `.docx` de su ordenador
4. Si la descripción ya tiene contenido, confirme que desea reemplazarlo
5. El documento se convierte a markdown y se carga en el editor
6. Revise el resultado. La descripción importada se guarda al momento, y los cambios que haga después se guardan automáticamente

Las imágenes incrustadas en el documento se suben al almacenamiento automáticamente. Si algún contenido no puede convertirse correctamente, aparece una advertencia en la parte inferior de la pantalla.

### Exportar la descripción

1. Haga clic en el botón **Exportar** junto al encabezado de **Descripción**
2. Elija un formato: **PDF**, **DOCX** u **ODT**
3. El archivo se descarga automáticamente

El botón de exportar solo está habilitado cuando la descripción tiene contenido.

---

## Comentarios e historial

### Añadir comentarios

1. Seleccione la pestaña **Comentarios** en la sección de actividad
2. Escriba su comentario en el editor de texto
3. Opcionalmente establezca un nuevo estado en el desplegable de estado
4. Opcionalmente registre tiempo con el deslizador (`0` significa sin entrada de tiempo)
5. Haga clic en **Enviar** (la etiqueta del botón se actualiza para reflejar sus acciones seleccionadas)

### Comportamiento del formulario de actividad unificado

- Puede enviar cualquier combinación de:
  - Solo comentario
  - Solo cambio de estado
  - Solo registro de tiempo
  - Comentario + estado + tiempo juntos
- Para tareas de proyecto, establecer el estado a **Completado** requiere tiempo registrado (existente + recién añadido)
- El desplegable de estado del panel de Propiedades sigue funcionando de forma independiente si prefiere ese flujo

### Ver historial

La pestaña **Historial** muestra todos los cambios de la tarea:
  - Cambios de estado
  - Modificaciones de campos
  - Quién hizo cada cambio y cuándo
  - La entrada de creación, con la fecha, la hora y el creador, mostrada como último elemento

El campo **Solicitante** es información de trabajo que puede reasignarse en cualquier momento; la línea de creación siempre indica quién creó realmente la tarea.

### Notificaciones por correo electrónico y acciones rápidas

Cuando las notificaciones de tareas están habilitadas, las actualizaciones de estado y comentarios pueden activar notificaciones por correo electrónico.

- Si un cambio de estado y un comentario se envían juntos, los destinatarios pueden recibir un correo combinado (dependiendo de sus preferencias de notificación)
- Los correos de estado pueden incluir botones de acción rápida:
  - **Pendiente**: `Responder y poner En progreso`, `Marcar Completado`
  - **En pruebas**: `Aprobar` (establece `Completado`), `Poner En progreso`
  - **Completado**: `Reabrir` (establece `Abierto`)
- Al hacer clic en un botón de acción se abre la página de la tarea con el estado preseleccionado en el formulario de actividad unificado

---

## Vincular aplicaciones y activos

Las tareas pueden vincularse a una o más **Aplicaciones** (Apps y servicios) y **Activos** (recursos de hardware o nube). Los enlaces viven en el grupo **Seguimiento** del panel de Propiedades.

- Use **Aplicaciones** para marcar el trabajo que toca apps específicas en su panorama IT (p. ej., un despliegue, un cambio de configuración, un incidente acotado a esa app)
- Use **Activos** para trabajo acotado a servidores, dispositivos o activos en la nube específicos

Los enlaces son bidireccionales: desde el espacio de trabajo de la Aplicación o Activo vinculado, la tarea aparece en la relación **Tareas** en el panel de Propiedades de ese espacio de trabajo. Esto facilita el pivote desde "¿qué pasa con esta app/activo?" al trabajo real en marcha.

**Consejo**: Reserve estos enlaces para tareas que tratan operativamente de la app o activo, no cada tarea que mencione una de pasada. De lo contrario, la relación se convierte en ruido en lugar de señal.

---

## Crear tareas desde otros espacios de trabajo

Las tareas se crean comúnmente desde dentro de otros espacios de trabajo. La relación viene preseleccionada para que no tenga que configurarla a mano.

### Desde Proyectos del portafolio
En el espacio de trabajo del Proyecto, use la pestaña **Tareas** para gestionar entregables del proyecto:
- Crear tareas para paquetes de trabajo específicos
- Asignar tareas a fases del proyecto
- Registrar tiempo contra cada tarea

**Consejo**: En la pestaña Cronograma, haga clic en el botón **[+]** junto a una fase para crear una tarea pre-vinculada a esa fase.

### Desde partidas OPEX
En el espacio de trabajo OPEX, use el panel **Tareas** de la pestaña **Vista general** para crear tareas como:
- "Revisar precios del proveedor para 2026"
- "Negociar descuento por volumen"

### Desde Contratos
En el espacio de trabajo del Contrato, use la pestaña **Tareas** para:
- "Revisar contrato antes de la fecha límite de renovación"
- "Solicitar condiciones actualizadas al proveedor"

### Desde partidas CAPEX
En el espacio de trabajo CAPEX, las tareas rastrean hitos del proyecto:
- "Completar la recopilación de requisitos"
- "Obtener aprobación presupuestaria"

Estas tareas se vinculan automáticamente a la entidad padre y aparecen tanto en la lista de tareas como en el espacio de trabajo padre.

---

## Tareas independientes

Las tareas independientes son elementos de trabajo que no están vinculados a ningún proyecto, contrato o partida presupuestaria específica. Son útiles para:
- Trabajo general de operaciones IT
- Solicitudes ad-hoc
- Iniciativas transversales
- Seguimiento de tareas personales

### Crear tareas independientes

1. Haga clic en **Nuevo** en la página de Tareas
2. Deje el desplegable **Relacionado con** como **Independiente**
3. El panel de Propiedades muestra "Tarea independiente" en el grupo Contexto
4. Complete el título, descripción y otros detalles
5. Haga clic en **Crear**

### Campos de clasificación

Las tareas independientes y las tareas de proyecto tienen campos de clasificación editables que ayudan a organizar el trabajo por dimensiones del portafolio:

- **Origen**: De dónde provino el trabajo (p. ej., Solicitud de negocio, Iniciativa IT)
- **Categoría**: La categoría del portafolio para el trabajo
- **Flujo**: El flujo específico dentro de la categoría (filtrado por la categoría seleccionada)
- **Empresa**: La empresa a la que se refiere este trabajo

Estos campos aparecen en el grupo **Clasificación** del panel de Propiedades y pueden editarse en cualquier momento. Al crear una nueva tarea independiente, los valores de clasificación predeterminados de su organización se rellenan automáticamente si están configurados.

Para **tareas de proyecto**, la clasificación se hereda del proyecto padre cuando se crea la tarea, pero puede cambiarse de forma independiente. Esto permite, por ejemplo, que una tarea de infraestructura exista dentro de un proyecto de negocio, o una tarea de conformidad dentro de un proyecto IT. Si la clasificación de una tarea no se establece explícitamente, hereda y muestra la clasificación del proyecto.

### Puntuación de prioridad

Las tareas independientes (y todas las tareas fuera de proyecto) usan una puntuación de prioridad fija basada en su nivel de prioridad:

| Nivel de prioridad | Puntuación |
|--------------------|------------|
| Bloqueante | 110 |
| Alta | 90 |
| Normal | 70 |
| Baja | 50 |
| Opcional | 30 |

Las tareas bloqueantes obtienen una puntuación de 110 para asegurar que siempre se clasifiquen por encima incluso de las tareas de proyecto con mayor prioridad (máximo 100).

---

## Tareas de proyecto

Las tareas de proyecto tienen funcionalidades adicionales comparadas con las tareas regulares:

**Clasificación independiente**: Las tareas de proyecto tienen sus propios campos de Origen, Categoría, Flujo y Empresa. Cuando se crea una tarea dentro de un proyecto, estos valores se heredan de la clasificación del proyecto por conveniencia. Sin embargo, la clasificación de cada tarea puede editarse de forma independiente. Si un campo de clasificación de la tarea no se establece explícitamente, hereda y muestra el valor del proyecto.

**Puntuación de prioridad**: Las tareas de proyecto muestran una puntuación de prioridad calculada que combina:
- La puntuación de prioridad del proyecto padre
- Un ajuste basado en el nivel de prioridad de la tarea (+10 para Bloqueante, +5 para Alta, 0 para Normal, -5 para Baja, -10 para Opcional)

La puntuación aparece en la barra de metadatos en la parte superior del espacio de trabajo y como columna **Puntuación** en la lista de tareas.

**Asignación de fase**: Las tareas pueden asignarse a fases específicas del proyecto o marcarse como "Nivel de proyecto" para trabajo transversal.

**Contribución de tiempo**: El tiempo registrado en tareas de proyecto contribuye a los cálculos de esfuerzo real del proyecto:
- El tiempo de categoría IT se suma al **Esfuerzo real (IT)**
- El tiempo de categoría Negocio se suma al **Esfuerzo real (Negocio)**
- La pestaña Progreso del proyecto muestra un desglose de Gastos generales del proyecto vs Tiempo de tareas
- El Registro de tiempo unificado muestra todas las entradas de tiempo tanto de gastos generales del proyecto como de trabajo en tareas

**Validación de estado**: Las tareas de proyecto no pueden marcarse como **Completado** sin registrar tiempo primero. Esto asegura un seguimiento preciso del esfuerzo del proyecto.

**Filtrado**: La pestaña Tareas del proyecto incluye filtros para:
- Estado (Todos, Activo, estado específico)
- Fase (Todas las fases, Nivel de proyecto, fase específica)

---

## Importación/exportación CSV

Gestione tareas a escala usando importación y exportación CSV. Esta funcionalidad admite operaciones masivas para carga inicial de datos, migración de tareas y extracción de datos para informes.

### Acceder a las funcionalidades CSV

Desde la lista de Tareas:
  - **Exportar CSV**: Descargar tareas a un archivo CSV
  - **Importar CSV**: Subir un archivo CSV para crear o actualizar tareas
  - **Descargar plantilla**: Obtener un CSV en blanco con los encabezados correctos (desde el diálogo de Importación)

**Permisos requeridos**: `tasks:admin` para operaciones de importación/exportación.

### Opciones de exportación

Hay tres modos de exportación disponibles:

| Opción | Descripción |
|--------|-------------|
| **Exportación completa** | Todos los campos exportables — usar para informes y extracción completa de datos |
| **Enriquecimiento de datos** | Todos los campos importables — coincide con el formato de la plantilla de importación, ideal para edición de ida y vuelta (exportar, modificar, reimportar) |
| **Selección personalizada** | Elegir campos específicos para incluir en su exportación |

**Descarga de plantilla** (desde el diálogo de Importación): Descarga un CSV en blanco con todos los encabezados de campos importables — úselo para preparar archivos de importación con la estructura correcta.

### Flujo de trabajo de importación

1. **Prepare su archivo**: Use codificación UTF-8 con separadores de punto y coma (`;`). Descargue una plantilla para asegurar los encabezados correctos.

2. **Elija la configuración de importación**:
   - **Modo**:
     - `Enriquecer` (predeterminado): Las celdas vacías preservan los valores existentes — solo actualiza lo que especifique
     - `Reemplazar`: Las celdas vacías borran los valores existentes — reemplazo completo de todos los campos
   - **Operación**:
     - `Upsert` (predeterminado): Crear nuevas tareas o actualizar existentes
     - `Solo actualizar`: Solo modificar tareas existentes, omitir nuevas
     - `Solo insertar`: Solo crear nuevas tareas, omitir existentes

3. **Valide primero**: Haga clic en **Verificación previa** para validar su archivo sin hacer cambios. Revise errores y advertencias.

4. **Aplique los cambios**: Si la validación pasa, haga clic en **Importar** para confirmar los cambios.

### Referencia de campos

**Campos básicos**:

| Columna CSV | Descripción | Obligatorio | Notas |
|-------------|-------------|-------------|-------|
| `id` | UUID de la tarea | No | Para actualizaciones; dejar en blanco para nuevas tareas |
| `title` | Título de la tarea | Sí | Parte del identificador único |
| `description` | Detalles de la tarea | No | Admite texto plano |

**Campos de contexto**:

| Columna CSV | Descripción | Obligatorio | Notas |
|-------------|-------------|-------------|-------|
| `related_object_type` | Tipo de entidad | No | Vacío para tareas independientes; acepta código o etiqueta |
| `related_object_id` | UUID de la entidad | Condicional | Obligatorio si es tarea vinculada y no se proporciona `related_object_name` |
| `related_object_name` | Nombre de la entidad | Condicional | Obligatorio si es tarea vinculada y no se proporciona `related_object_id` |
| `phase_name` | Fase del proyecto | No | Debe coincidir con un nombre de fase existente (solo tareas de proyecto) |
| `priority_level` | Prioridad de la tarea | No | Acepta código o etiqueta |
| `source_name` | Origen | No | Origen del portafolio (tareas independientes y de proyecto) |
| `category_name` | Categoría | No | Categoría del portafolio (tareas independientes y de proyecto) |
| `stream_name` | Flujo | No | Flujo del portafolio (tareas independientes y de proyecto) |
| `company_name` | Empresa | No | Empresa (tareas independientes y de proyecto) |

**Tareas independientes**: Deje `related_object_type`, `related_object_id` y `related_object_name` vacíos. Puede establecer campos de clasificación (`source_name`, `category_name`, `stream_name`, `company_name`) para tareas independientes y de proyecto. Para tareas de proyecto, los campos de clasificación omitidos se heredan del proyecto padre.

**Consejo**: Para nuevas importaciones de tareas vinculadas, use `related_object_name` en lugar de `related_object_id` — es mucho más fácil de usar. El sistema resuelve el nombre al ID correcto basándose en `related_object_type`. Para importaciones de ida y vuelta (exportar, editar, reimportar), ambos campos se incluyen para que la coincidencia funcione correctamente.

**Estado y fechas**:

| Columna CSV | Descripción | Notas |
|-------------|-------------|-------|
| `status` | Estado de la tarea | Acepta código o etiqueta |
| `start_date` | Fecha de inicio | Formato de fecha: AAAA-MM-DD |
| `due_date` | Fecha de vencimiento | Formato de fecha: AAAA-MM-DD |

**Campos de personas**:

| Columna CSV | Descripción | Notas |
|-------------|-------------|-------|
| `assignee_email` | Persona responsable | Debe coincidir con un correo de usuario existente |
| `creator_email` | Correo del solicitante | Solo exportación (mostrado como **Correo del solicitante** en metadatos de campo) |
| `viewer_email_1` a `_4` | Observadores | Deben coincidir con correos de usuarios existentes |
| `owner_email_1` a `_4` | Responsables | Deben coincidir con correos de usuarios existentes |

**Otros campos**:

| Columna CSV | Descripción | Notas |
|-------------|-------------|-------|
| `labels` | Etiquetas de la tarea | Lista separada por comas |

### Aceptación de etiquetas y códigos

Para los campos **status**, **priority_level** y **related_object_type**, puede usar tanto el código interno como una etiqueta común:

**Valores de estado**:

| Código | Etiquetas aceptadas |
|--------|---------------------|
| `open` | `Open` |
| `in_progress` | `In Progress`, `Active`, `Working` |
| `pending` | `Pending` |
| `in_testing` | `In Testing`, `Testing` |
| `done` | `Done`, `Completed`, `Complete`, `Finished`, `Closed` |
| `cancelled` | `Cancelled`, `Canceled` |

**Valores de nivel de prioridad**:

| Código | Etiquetas aceptadas |
|--------|---------------------|
| `blocker` | `Blocker`, `Critical`, `Urgent` |
| `high` | `High` |
| `normal` | `Normal`, `Medium`, `Default` |
| `low` | `Low` |
| `optional` | `Optional`, `Nice to have` |

**Valores de tipo de objeto relacionado**:

| Código | Etiquetas aceptadas |
|--------|---------------------|
| `project` | `Project` |
| `spend_item` | `Spend Item`, `Spend` |
| `contract` | `Contract` |
| `capex_item` | `CAPEX Item`, `CAPEX` |

El sistema normaliza automáticamente los valores durante la importación.

### Coincidencia y actualizaciones

Las tareas se emparejan por **título + related_object_id** (sin distinción de mayúsculas). Cuando se encuentra una coincidencia:
  - Con modo `Enriquecer`: Solo los valores CSV no vacíos actualizan la tarea
  - Con modo `Reemplazar`: Todos los campos se actualizan, los valores vacíos borran los datos existentes

Si incluye la columna `id` con un UUID válido, la coincidencia usa primero el ID, luego recurre a título + objeto relacionado.

**Nota**: Si proporciona `related_object_name` en lugar de `related_object_id`, el sistema resuelve el nombre al ID antes de la coincidencia. Esto significa que puede usar nombres legibles en todo su archivo de importación.

### Campos de solo exportación

Algunos campos aparecen en las exportaciones pero no pueden importarse. Estos son campos gestionados por el sistema que mantienen la integridad de los datos:

| Campo | Por qué es de solo exportación |
|-------|--------------------------------|
| `creator_email` (Solicitante) | Se establece automáticamente al usuario que crea la tarea. Permitir la importación comprometería la integridad de la pista de auditoría. Para nuevas tareas el sistema establece esto al usuario importador; para tareas existentes se preserva el solicitante original. |

Estos campos se incluyen en la **Exportación completa** para fines de informes pero se excluyen de las exportaciones de **Plantilla** y **Enriquecimiento de datos** ya que no pueden modificarse durante la importación.

### Limitaciones

  - **Máximo 4 observadores/responsables**: Las tareas admiten hasta 4 correos de observadores y 4 correos de responsables vía CSV
  - **Clasificación solo para tareas independientes y de proyecto**: Origen, Categoría, Flujo y Empresa solo pueden establecerse en tareas independientes y de proyecto (no en tareas OPEX, Contrato o CAPEX)
  - **La fase requiere proyecto**: La asignación de fase solo funciona para tareas de proyecto
  - **Enlaces de aplicación/activo no en CSV**: Use el panel de Propiedades del espacio de trabajo para vincular tareas a aplicaciones y activos
  - **Comentarios no incluidos**: Los comentarios e historial de tareas deben gestionarse en el espacio de trabajo
  - **Registro de tiempo no incluido**: Las entradas de tiempo deben registrarse en el espacio de trabajo
  - **Adjuntos no incluidos**: Los archivos adjuntos requieren gestión en el espacio de trabajo

### Solución de problemas

**Error "El archivo no tiene el formato correcto"**: Esto generalmente indica un problema de codificación. Asegúrese de que su CSV está guardado como **UTF-8**:

  - **En LibreOffice**: Al abrir un CSV, seleccione `UTF-8` en el desplegable de conjunto de caracteres (no "Japanese (Macintosh)" u otras codificaciones). Al guardar, marque "Editar configuración de filtro" y elija UTF-8.
  - **En Excel**: Guardar como > CSV UTF-8 (delimitado por comas), luego abra en un editor de texto para cambiar comas por puntos y coma.
  - **Consejo general**: Si ve caracteres ilegibles al inicio de su archivo, la codificación es incorrecta.

### Ejemplo de CSV

Usando nombres legibles (recomendado para nuevas importaciones):

```csv
title;related_object_type;related_object_name;status;priority_level;due_date;assignee_email;source_name;category_name
Review contract terms;Contract;Acme Software License;Open;High;2026-02-28;john.doe@example.com;;
Update documentation;project;Website Redesign;In Progress;Normal;2026-03-15;jane.smith@example.com;;
Schedule kickoff;spend_item;Cloud Hosting 2026;open;low;2026-04-01;bob.wilson@example.com;;
Audit IT security;;;open;high;2026-03-01;security@example.com;IT Initiative;Security
```

La última fila es una **tarea independiente** (sin objeto relacionado) con campos de clasificación establecidos.

Usando UUIDs (típicamente de exportaciones de ida y vuelta):

```csv
title;related_object_type;related_object_id;status;priority_level;due_date;assignee_email
Review contract terms;Contract;550e8400-e29b-41d4-a716-446655440000;Open;High;2026-02-28;john.doe@example.com
Update documentation;project;660e8400-e29b-41d4-a716-446655440001;In Progress;Normal;2026-03-15;jane.smith@example.com
Schedule kickoff;spend_item;770e8400-e29b-41d4-a716-446655440002;open;low;2026-04-01;bob.wilson@example.com
```

---

## Convertir una tarea en solicitud

Puede promover una tarea a una solicitud del portafolio cuando el trabajo merece una evaluación formal, priorización, o eventualmente su propio proyecto. La conversión está disponible desde el encabezado del espacio de trabajo de la tarea.

### Cómo convertir

1. Abra el espacio de trabajo de la tarea
2. Haga clic en **Convertir en solicitud** en la barra de herramientas del encabezado (junto a **Enviar enlace**)
3. En el diálogo:
   - **Nombre de la solicitud**: Por defecto es el título de la tarea — edítelo si es necesario
   - **Vista previa del propósito**: Muestra la descripción de la tarea, que se convierte en el propósito de la solicitud
   - **Cerrar la tarea original después de la conversión**: Marque esta opción si desea que el estado de la tarea se establezca automáticamente a **Completado**
4. Haga clic en **Convertir en solicitud**

Después de la conversión, KANAP le lleva al espacio de trabajo de la solicitud recién creada.

### Qué se traslada

La nueva solicitud hereda lo siguiente de la tarea original:

| Campo de la tarea | Campo de la solicitud |
|-------------------|------------------------|
| Título | Nombre |
| Descripción | Propósito |
| Fecha de vencimiento | Fecha de entrega objetivo |
| Origen, Categoría, Flujo, Empresa | Origen, Categoría, Flujo, Empresa |
| Adjuntos | Adjuntos (copiados) |

La solicitud se crea con estado **Pendiente de revisión** y queda vinculada a la tarea de origen. Se registra una entrada en el historial tanto en la tarea ("Convertida a solicitud") como en la solicitud ("Creada desde tarea" con un enlace a la tarea original).

### Condiciones

- **Permisos**: Necesita tanto `tasks:member` como `portfolio_requests:member`
- **Conversión única**: Cada tarea solo puede convertirse una vez. Después de la conversión, el botón **Convertir en solicitud** se deshabilita y muestra la referencia de la solicitud vinculada (p. ej., "Ya convertida a REQ-42")
- **La tarea permanece**: La tarea original no se elimina. A menos que marque la opción de cerrar, permanece en su estado actual y puede seguir actualizándose de forma independiente

**Consejo**: Esta funcionalidad es útil cuando una tarea revela una iniciativa más grande que necesita su propio ciclo de vida de solicitud — evaluación por criterios, flujo de trabajo de aprobación y eventual conversión a proyecto.

---

## Enviar un enlace

Puede enviar por correo electrónico un enlace a cualquier tarea a colegas o contactos externos.

1. Abra el espacio de trabajo de la tarea
2. Haga clic en **Enviar enlace** en la barra de herramientas del encabezado
3. En el diálogo:
   - **Seleccionar destinatarios**: Busque usuarios existentes de la plataforma por nombre o correo, y/o escriba cualquier dirección de correo y pulse Enter
   - **Añadir un mensaje** (opcional): Incluya una nota personal
   - **Copiar enlace**: Haga clic en el icono de copiar para obtener la URL directa
4. Haga clic en **Enviar**

Los destinatarios reciben un correo con su nombre, el título de la tarea, un enlace directo y su mensaje (si lo proporcionó). Esto no cambia ningún permiso — simplemente notifica a los destinatarios.

**Consejo**: Puede mezclar usuarios de la plataforma y direcciones de correo externas en el mismo envío.

---

## Atajos de teclado

Cuando el foco no está en un campo de entrada, puede usar:

- **J** o **←**: Tarea anterior en la lista actual
- **K** o **→**: Siguiente tarea en la lista actual
- **P**: Alternar el panel de Propiedades
- **Escape**: Cerrar y volver a la lista
- **Ctrl+S** / **Cmd+S**: Guardar (o crear, en modo creación)
- **Tab** desde el campo de título: Saltar directamente al editor de descripción

---

## Consejos

  - **Use fechas de vencimiento**: Establezca fechas de vencimiento realistas para rastrear plazos de forma efectiva.
  - **Asigne responsables**: Cada tarea debe tener un asignado para la rendición de cuentas.
  - **Registre tiempo regularmente**: El seguimiento de tiempo ayuda con la estimación de futuros proyectos.
  - **Filtre por estado**: El filtro predeterminado muestra solo estados activos (`Abierto`, `En progreso`, `Pendiente`, `En pruebas`) — incluya `Completado` y `Cancelado` al revisar tareas históricas.
  - **Cree desde el contexto**: Crear tareas desde dentro de los espacios de trabajo (proyecto, OPEX, contrato, CAPEX) las vincula automáticamente.
  - **Vincule apps y activos**: Use los campos **Aplicaciones** y **Activos** del panel de Propiedades cuando una tarea trate operativamente de una app o activo específico. El enlace aparece también en el espacio de trabajo de la entidad relacionada.
  - **Use la prioridad con criterio**: Reserve **Bloqueante** para problemas que genuinamente bloquean.
  - **Use actualizaciones de envío único**: En la pestaña Comentarios, combine comentario + estado + tiempo en una sola acción para mantener el historial y las notificaciones alineados.
  - **Importe documentos**: Use el botón **Importar** para traer archivos `.docx` como contenido de descripción en lugar de copiar y pegar.
  - **Atajo de teclado**: Pulse **Ctrl+S** (o **Cmd+S** en Mac) para guardar rápidamente sin buscar el botón Guardar.
  - **Vincule artículos de la base de conocimiento**: Use el grupo Conocimiento del panel de Propiedades para conectar documentación relevante a sus tareas.
