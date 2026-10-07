# Mi panel de control

El Panel de control es su página de inicio personal en KANAP. Le ofrece una visión rápida de sus tareas, proyectos, tiempo registrado y actividad reciente, todo en un solo lugar. Puede personalizar qué mosaicos aparecen, y el panel oculta cualquier mosaico para el que no tenga permiso.

## Dónde encontrarlo

- Haga clic en el logotipo de **KANAP** o navegue a `/`
- Esta es la página predeterminada después de iniciar sesión para usuarios no administradores.
- No se requieren permisos especiales para ver el propio panel, pero los mosaicos individuales dependen de sus derechos de acceso.

## Acciones rápidas

La franja del encabezado en la parte superior del panel proporciona botones de atajo para el trabajo cotidiano común. Cada botón solo se muestra si tiene el permiso correspondiente.

- **Crear tarea** — abre el flujo de creación de tarea independiente. Requiere `tasks:member` o superior.
- **Registrar tiempo** — abre el diálogo **Registro rápido de tiempo** (vea más abajo). Requiere `portfolio_projects:member` o `tasks:member`.
- **Nueva solicitud** — abre el flujo de creación de solicitud. Requiere `portfolio_requests:member` o superior.
- **Nueva aplicación** — abre el flujo de creación de aplicación. Requiere `applications:member` o superior.
- **Nuevo activo** — abre el flujo de creación de activo. Requiere `infrastructure:member` o superior.
- **Nuevo documento** (botón dividido) — crea un documento de Base de conocimiento en blanco, o abre el selector de plantillas para empezar desde una plantilla publicada. Requiere `knowledge:member` o superior.
- **Configuración** (icono de engranaje) — abre el diálogo de configuración del panel para elegir qué mosaicos mostrar.

### Registro rápido de tiempo

La acción **Registrar tiempo** abre un diálogo enfocado para que pueda registrar horas sin salir del panel.

- Elija el destino — **Proyecto** o **Tarea**.
  - Las entradas de proyecto registran tiempo directamente contra un proyecto del portafolio.
  - Las entradas de tarea registran tiempo contra una de sus tareas activas (tareas de proyecto o tareas independientes). Las tareas OPEX, CAPEX y de contrato están intencionalmente excluidas del selector.
- Elija el proyecto o tarea del desplegable.
- Introduzca las **Horas** (en incrementos de 0,25).
- Elija una **Categoría**: **IT** o **Negocio**.
- Añada **Notas** si desea contexto sobre en qué trabajó.

Después de guardar, el mosaico de resumen de tiempo del panel se actualiza automáticamente.

## Línea de datos de ejemplo

En un espacio de trabajo en la nube que todavía está vacío, los administradores ven una línea sobre los mosaicos: «Descubra KANAP con datos de ejemplo.» **Cargar** abre el cuadro de diálogo de datos de ejemplo y **Ocultar** elimina la línea de forma definitiva. La línea desaparece en cuanto el espacio de trabajo contiene datos. Véase [Datos de ejemplo](sample-data.md).

## Mosaicos del panel

El panel muestra una cuadrícula de mosaicos, cada uno mostrando un aspecto diferente de su trabajo. Los mosaicos se distribuyen en una cuadrícula adaptable (tres columnas en pantallas grandes, dos en medianas, una en pequeñas). Los mosaicos para los que no tiene permiso de visualización no se cargan en absoluto.

### Mis tareas

Muestra sus tareas activas agrupadas por urgencia:

- **Vencidas** — tareas pasadas su fecha de vencimiento (resaltadas en rojo)
- **Vencen esta semana** — tareas que vencen en los próximos 7 días
- **Más adelante** — todo lo demás

Cada tarea muestra su título, el proyecto vinculado (si lo hay), la fecha de vencimiento y una insignia de prioridad cuando la prioridad está por encima de lo normal. Haga clic en una tarea para abrir su espacio de trabajo.

Muestra hasta 5 elementos en total, distribuidos entre los tres grupos.

**Configuración**: máximo de elementos, ocultar la sección de vencidos.

**Requiere**: `tasks:reader`

---

### Proyectos que lidero

Lista los proyectos donde ocupa un rol de liderazgo (Responsable IT, Responsable de negocio, Patrocinador IT o Patrocinador de negocio). Cada proyecto muestra:

- Su rol
- Estado actual del proyecto (píldora con código de color)
- Próximo hito y su fecha objetivo, si está definido

Hacer clic en un proyecto abre el espacio de trabajo del proyecto.

Muestra hasta 5 elementos.

**Requiere**: `portfolio_projects:reader`

---

### Proyectos en los que contribuyo

Lista los proyectos donde es miembro del equipo. Cada proyecto muestra:

- Su equipo (Equipo IT o Equipo de negocio)
- Estado actual del proyecto
- Número de tareas asignadas a usted en ese proyecto

Hacer clic en un proyecto abre el espacio de trabajo del proyecto.

Muestra hasta 5 elementos.

**Requiere**: `portfolio_projects:reader` y `tasks:reader`

---

### Vistos recientemente

Muestra elementos que ha abierto recientemente en toda la aplicación — proyectos, solicitudes, aplicaciones, activos, interfaces, conexiones, contratos, tareas, partidas OPEX y CAPEX, y documentos de la Base de conocimiento. Cada entrada muestra el nombre del elemento, su tipo y cuándo lo vio por última vez.

Los elementos vistos recientemente se almacenan localmente en su navegador y están limitados al espacio de trabajo y usuario actual. Haga clic en **Limpiar** para restablecer la lista. Los elementos a los que ya no tiene permiso de acceso se filtran automáticamente.

Muestra hasta 5 elementos.

**Requiere**: Sin permisos especiales.

---

### Mi tiempo de la semana pasada

Muestra un resumen del tiempo que ha registrado durante un periodo reciente:

- **Total de horas** registradas (mostrado de forma destacada)
- **Desglose por categoría** — IT, Negocio y Otras tareas (no de proyecto)
- **Principales proyectos** — un pequeño gráfico de barras de los proyectos en los que pasó más tiempo

**Configuración**: periodo de tiempo en días (7-30).

**Requiere**: `portfolio_projects:reader`

---

### Nuevas solicitudes

Muestra las solicitudes del portafolio creadas dentro de un periodo reciente. Cada solicitud muestra el nombre, el solicitante, la fecha de creación y una insignia **Alta** cuando la puntuación de prioridad está por encima de 80.

Hacer clic en una solicitud abre el espacio de trabajo de la solicitud.

Muestra hasta 5 elementos.

**Configuración**: máximo de elementos, días hacia atrás.

**Requiere**: `portfolio_requests:reader`

---

### Base de conocimiento

Muestra dos secciones centradas en Base de conocimiento en el mismo mosaico:

- **Por revisar** — documentos donde es el revisor o aprobador activo, incluyendo hace cuánto tiempo se solicitó la revisión y por quién. El color de la insignia indica si está en la etapa de revisión o de aprobación.
- **Últimos 5 accedidos** — los últimos cinco documentos de Base de conocimiento que abrió en este navegador para el espacio de trabajo actual.

Las bibliotecas restringidas respetan sus reglas de acceso: solo ve elementos de revisión y documentos recientes de las bibliotecas que puede leer. Si ha perdido el acceso a un documento previamente visto, deja de aparecer aquí.

**Requiere**: `knowledge:reader`

---

### Conformidad

Muestra en qué punto está la campaña de clasificación para las aplicaciones que puede ver (aplicaciones retiradas excluidas):

- **Progreso** — una barra y tres contadores: revisadas, por revisar (la clasificación cambió desde la última revisión o nunca se revisó) y por completar (un campo de clasificación sigue vacío). Cada contador abre la lista de aplicaciones filtrada por ese estado.
- **Puntos de atención** — aplicaciones del nivel de criticidad de negocio más alto sin prueba de recuperación en los últimos doce meses, aplicaciones del nivel más crítico sin ola de recuperación y aplicaciones con los datos más confidenciales y la criticidad cibernética más baja. Solo se listan los puntos con al menos una aplicación; cada uno abre la lista filtrada correspondiente. Cuando nada requiere acción, el mosaico lo indica.

Los niveles son los definidos en la configuración del mapa de TI; un nivel que ya no se ofrece nunca cuenta como el más alto ni el más bajo.

**Requiere**: `applications:reader`

---

### Actividad del equipo

Muestra la actividad reciente de proyectos en los proyectos donde está involucrado (cambios, comentarios, decisiones). Cada fila indica el proyecto, el tipo de actividad, el autor y un breve resumen. Haga clic en un elemento para saltar a la pestaña de actividad del proyecto.

**Configuración**: máximo de elementos.

**Requiere**: `portfolio_projects:reader`

---

### Cambios de estado de proyectos

Muestra las transiciones de estado recientes de proyectos (de → a) en proyectos, para que pueda ver qué iniciativas avanzaron, se pausaron o se cerraron en los últimos días.

**Configuración**: días hacia atrás (1-14).

**Requiere**: `portfolio_projects:reader`

---

### Tareas obsoletas

Muestra tareas que no se han actualizado durante mucho tiempo. Cada elemento muestra la píldora de días sin actualizar (advertencia, luego error tras pasar el doble del umbral) y el objeto vinculado, si lo hay.

**Configuración**: alcance (`mías`, `equipo`, `todas`) y umbral en días (30-365).

**Requiere**: `tasks:reader`

## Personalizar su panel

Haga clic en el icono de **Configuración** (engranaje) en el encabezado del panel para abrir el diálogo de configuración del panel.

Desde aquí puede:

- **Activar o desactivar mosaicos** — marque o desmarque cada mosaico para controlar qué aparece en su panel.
- **Restablecer a valores predeterminados** — restaurar la selección original de mosaicos.

Solo aparecen en la lista de configuración los mosaicos para los que tiene permiso de visualización. Los cambios se guardan en su cuenta y persisten entre sesiones y dispositivos.

Si todos los mosaicos están desactivados, el panel muestra un mensaje invitándole a activar algunos.

## Consejos

- **Empiece con los valores predeterminados**: el panel viene con un conjunto útil de mosaicos ya activados. Pruébelo durante unos días antes de personalizarlo.
- **Use las acciones rápidas**: crear una tarea, solicitud o documento — o registrar tiempo — directamente desde el panel le ahorra tener que navegar.
- **Revise las tareas vencidas a diario**: el mosaico Mis tareas resalta los elementos vencidos en rojo para que nada se le escape.
- **Use Tareas obsoletas con alcance de equipo**: con `tasks:admin`, cambie el mosaico Tareas obsoletas a alcance `equipo` o `todas` para encontrar trabajo que nadie está actualizando en toda la organización.
