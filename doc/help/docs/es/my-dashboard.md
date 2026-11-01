# Mi panel de control

El Panel de control es su página de inicio personal en KANAP. Le ofrece una visión rápida de sus tareas, proyectos, tiempo registrado y actividad reciente, todo en un solo lugar. Puede personalizar qué mosaicos aparecen, y el panel oculta cualquier mosaico para el que no tenga permiso.

## Dónde encontrarlo

- Haga clic en el logotipo de **KANAP** o navegue a `/`
- Esta es la página predeterminada después de iniciar sesión para usuarios no administradores.
- No se requieren permisos especiales para ver el propio panel, pero los mosaicos individuales dependen de sus derechos de acceso.

## Acciones rápidas

La franja del encabezado en la parte superior del panel proporciona botones de atajo para el trabajo cotidiano común. Cada botón solo se muestra si tiene el permiso correspondiente.

- **Crear tarea**: abre el flujo de creación de tarea independiente. Requiere `tasks:member` o superior.
- **Registrar tiempo**: abre el diálogo **Registro rápido de tiempo** (vea más abajo). Requiere `portfolio_projects:contributor` o `tasks:member`.
- **Nueva línea presupuestaria**: abre una nueva línea presupuestaria. Empieza como OPEX, y la fila **Tipo** de su panel Propiedades la cambia a CAPEX (consulte [Líneas presupuestarias](budget-lines.md#el-espacio-de-trabajo)). Requiere `budget:member` o superior.
- **Nueva aplicación**: abre el flujo de creación de aplicación. Requiere `applications:member` o superior.
- **Nuevo activo**: abre el flujo de creación de activo. Requiere `infrastructure:member` o superior.
- **Nuevo documento** (botón dividido): crea un documento de Base de conocimiento en blanco, o abre el selector de plantillas para empezar desde una plantilla publicada. Requiere `knowledge:member` o superior.
- **Configuración** (icono de engranaje): abre el diálogo de configuración del panel. Consulte [Personalizar su panel](#customizing-the-budget-section).

### Registro rápido de tiempo

La acción **Registrar tiempo** abre un diálogo enfocado para que pueda registrar horas sin salir del panel.

- Elija el destino: **Proyecto** o **Tarea**. Esta elección solo aparece si puede registrar tiempo en ambos.
  - Las entradas de proyecto registran tiempo directamente contra un proyecto del portafolio. La lista solo contiene los proyectos en los que puede registrar tiempo.
  - Las entradas de tarea registran tiempo contra una de sus tareas activas: las tareas de esos proyectos, y las tareas independientes si tiene `tasks:member`. Las tareas OPEX, CAPEX y de contrato están excluidas del selector.
- Elija el proyecto o tarea del desplegable.
- Introduzca las **Horas** (horas enteras).
- Elija una **Categoría**: **IT** o **Negocio**.
- Añada **Notas** si desea contexto sobre en qué trabajó.

Al guardar se comprueba el permiso sobre el destino: una entrada en un proyecto o en una tarea de proyecto requiere `portfolio_projects:contributor`, una entrada en una tarea independiente requiere `tasks:member`.

Después de guardar, el mosaico de resumen de tiempo del panel se actualiza automáticamente.

## Línea de datos de ejemplo

En un espacio de trabajo en la nube vacío, que nunca ha tenido datos de ejemplo, los administradores ven una línea sobre los mosaicos: «Descubra KANAP con datos de ejemplo.» **Cargar** abre el cuadro de diálogo de datos de ejemplo y **Ocultar** elimina la línea de forma definitiva. La línea desaparece en cuanto el espacio de trabajo contiene datos y no vuelve tras un borrado. Véase [Datos de ejemplo](sample-data.md).

## Prueba: su recorrido y sus primeros pasos { #trial-first-steps }

En un espacio de trabajo en prueba, se abre un cuadro de diálogo la primera vez que abre KANAP. Hace una pregunta por pantalla:

1. **¿Qué le trae a KANAP?** **El presupuesto de TI**, **El mapa del SI**, **Los proyectos y las solicitudes** o **Solo estoy mirando**.
2. **¿Cómo quiere empezar?** **Descubrir con el ejemplo completo** o **Empezar con mis datos**.

Empezar con sus datos borra el ejemplo. Si se crearon elementos desde la carga del ejemplo, una confirmación indica su número antes de borrar nada. Solo un administrador puede elegir sus propios datos mientras el espacio de trabajo contiene el ejemplo.

Mientras se carga el ejemplo, o mientras se borra el espacio de trabajo, una línea de la página de inicio lo indica.

Si cierra el cuadro de diálogo, la elección queda pendiente en **Acerca de KANAP**. La línea **Recorrido: … · Cambiar** muestra el recorrido elegido (**Elegir** mientras no se ha elegido nada). Cualquiera puede cambiarlo mientras falta una respuesta. Después, solo los administradores pueden hacerlo.

### Sus cinco primeros pasos

Una vez elegido el recorrido, el mosaico **Sus cinco primeros pasos** aparece primero en la página de inicio. Enumera los cinco pasos del recorrido y su progreso, por ejemplo **2/5**. Cada paso abre su pantalla, donde el título de la página se resalta con una frase de explicación.

- Con el ejemplo, abrir un paso lo marca como hecho.
- Con sus datos, haga clic en **Hecho** en la explicación, o en la marca junto al paso en el mosaico. La marca también deshace un paso.

Cuando los cinco pasos están hechos, el mosaico ofrece los otros dos recorridos. También ofrece **Reiniciar este recorrido**, que deshace los cinco pasos de este recorrido. El botón de cierre (**×**) oculta el mosaico. Para mostrarlo de nuevo, use **Mostrar los primeros pasos** en **Acerca de KANAP**.

| Recorrido | Con el ejemplo | Con sus datos |
|---|---|---|
| Presupuesto de TI | La vista general, Una línea presupuestaria, Un informe, Una pregunta a Plaid, Sus datos | Su empresa, Sus líneas, Un contrato vinculado, Su primer informe, Un colega |
| Mapa del SI | La lista de aplicaciones, Una ficha de aplicación, Los servidores, Tecnologías, fin de soporte y vulnerabilidades, Sus datos | Sus aplicaciones, Sus tecnologías, Sus servidores, Lo que KANAP ha encontrado, Un colega |
| Proyectos y solicitudes | Una solicitud y su puntuación, El proyecto nacido de la solicitud, Las tareas, Los informes, Sus datos | Su primera solicitud, Su proyecto, Las primeras tareas, El presupuesto del proyecto, Un colega |

### La página de inicio sigue su recorrido

Durante una prueba, la página de inicio coloca primero los mosaicos de su recorrido:

- **Presupuesto de TI**: la [sección Gestión presupuestaria](#budget-management-section) aparece primero, encabezada por el mosaico de los primeros pasos.
- **Mapa del SI**: los mosaicos **Conformidad**, **Vulnerabilidades del parque** y **Sincronización con Netbox** aparecen primero.
- **Proyectos y solicitudes**: los mosaicos de proyectos y solicitudes aparecen primero.

Sin recorrido, los mosaicos mantienen su orden habitual.

## Línea para activar Plaid

Durante una prueba en la nube, los administradores de la configuración de Plaid ven una línea bajo la línea de datos de ejemplo mientras Plaid está desactivado y se ofrece el modelo incluido de KANAP: «Plaid, el asistente de KANAP, está desactivado.» **Activar** abre la confirmación habitual del modelo incluido. Al confirmar, Plaid se activa. El botón de cierre (**×**) oculta la línea en este navegador. La línea no aparece tras el paso a un plan de pago, ni en instalaciones locales. Véase [Configuración de Plaid](ai-settings.md).

## Mosaicos del panel

El panel muestra una cuadrícula de mosaicos, cada uno mostrando un aspecto diferente de su trabajo. Los mosaicos se distribuyen en una cuadrícula adaptable: cuatro columnas en una pantalla muy ancha, tres en una pantalla grande, dos en una mediana, una en el móvil. Los mosaicos para los que no tiene permiso de visualización no se cargan en absoluto.

### Mosaicos predeterminados

Mientras no haya guardado su propia configuración, la página de inicio muestra **Mis tareas**, **Proyectos que lidero**, **Conformidad** y **Vulnerabilidades del parque**, seguidos de los mosaicos **Presupuesto**, **Top líneas** y **Calidad de datos** de la [sección Gestión presupuestaria](#budget-management-section). Esta selección cabe en una sola pantalla en un monitor ancho. Los demás mosaicos están desactivados: actívelos en la [configuración del panel](#customizing-the-budget-section). La configuración que ya haya guardado se conserva.

### Mosaicos sin contenido

Con **Ocultar los mosaicos sin contenido** activado (por defecto), un mosaico que no tiene nada que mostrar queda fuera de la página. Es el caso de una lista vacía, de contadores todos a cero (por ejemplo **Calidad de datos** con todos los controles a cero, o **Vulnerabilidades del parque** con todas las líneas a cero), de **Conformidad** sin ninguna aplicación y de **Sincronización con Netbox** cuando Netbox no está conectado o no hay nada que decidir. Un mosaico vuelve en cuanto tiene algo que mostrar. Un mosaico que todavía se está cargando o cuya carga ha fallado sigue visible.

Cuando todos los mosaicos están vacíos, la página de inicio muestra una sola línea: «Sus mosaicos todavía no tienen nada que mostrar.» Desactive la opción para ver los mosaicos vacíos con su mensaje habitual.

### Mis tareas

Muestra sus tareas activas agrupadas por urgencia:

- **Vencidas**: tareas pasadas su fecha de vencimiento (resaltadas en rojo)
- **Vencen esta semana**: tareas que vencen en los próximos 7 días
- **Más adelante**: todo lo demás

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

Muestra elementos que ha abierto recientemente en toda la aplicación: proyectos, solicitudes, aplicaciones, activos, interfaces, conexiones, contratos, tareas, líneas OPEX y CAPEX, empresas, y documentos de la Base de conocimiento. Cada entrada muestra el nombre del elemento, su tipo y cuándo lo vio por última vez.

Los elementos vistos recientemente se almacenan localmente en su navegador y están limitados al espacio de trabajo y usuario actual. Haga clic en **Limpiar** para restablecer la lista. Los elementos a los que ya no tiene permiso de acceso se filtran automáticamente. Los elementos eliminados desde entonces, solos o con otro elemento (como las tareas de un contrato eliminado), salen de la lista.

Muestra hasta 5 elementos.

**Requiere**: Sin permisos especiales.

---

### Mi tiempo de la semana pasada

Muestra un resumen del tiempo que ha registrado durante un periodo reciente:

- **Total de horas** registradas (mostrado de forma destacada)
- **Desglose por categoría**: IT, Negocio y Otras tareas (no de proyecto)
- **Principales proyectos**: un pequeño gráfico de barras de los proyectos en los que pasó más tiempo

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

- **Por revisar**: documentos donde es el revisor o aprobador activo, incluyendo hace cuánto tiempo se solicitó la revisión y por quién. El color de la insignia indica si está en la etapa de revisión o de aprobación.
- **Últimos 5 accedidos**: los últimos cinco documentos de Base de conocimiento que abrió en este navegador para el espacio de trabajo actual.

Las bibliotecas restringidas respetan sus reglas de acceso: solo ve elementos de revisión y documentos recientes de las bibliotecas que puede leer. Si ha perdido el acceso a un documento previamente visto, deja de aparecer aquí.

**Requiere**: `knowledge:reader`

---

### Conformidad

Muestra en qué punto está la campaña de clasificación para las aplicaciones que puede ver (aplicaciones retiradas excluidas):

- **Progreso**: una barra y tres contadores: revisadas, por revisar (la clasificación cambió desde la última revisión o nunca se revisó) y por completar (un campo de clasificación sigue vacío). Cada contador abre la lista de aplicaciones filtrada por ese estado.
- **Puntos de atención**: aplicaciones del nivel de criticidad de negocio más alto sin prueba de recuperación en los últimos doce meses, aplicaciones del nivel más crítico sin ola de recuperación y aplicaciones con los datos más confidenciales y la criticidad cibernética más baja. Solo se listan los puntos con al menos una aplicación; cada uno abre la lista filtrada correspondiente. Cuando nada requiere acción, el mosaico lo indica.

Los niveles son los definidos en la configuración del mapa de TI; un nivel que ya no se ofrece nunca cuenta como el más alto ni el más bajo.

**Requiere**: `applications:reader`

---

### Vulnerabilidades del parque { #vulnerabilities }

Muestra las vulnerabilidades que requieren atención en su parque, bajo el subtítulo «CVE por revisar en las tecnologías en servicio». Los recuentos siguen [Lo que KANAP cuenta](vulnerabilities.md#what-kanap-counts): vulnerabilidades aún por revisar, en las alertas. Cada línea abre la lista correspondiente:

- **Aplicaciones de la criticidad más alta con una CVE crítica o alta**, por ejemplo «2 aplicaciones de criticidad Crítica con una CVE crítica o alta»: las aplicaciones en el nivel de criticidad de negocio más alto de su catálogo que alcanza una vulnerabilidad crítica o alta. Abre la lista de aplicaciones filtrada por ese nivel y por **Con vulnerabilidades graves**. Requiere `applications:reader` y cuenta las aplicaciones que usted puede leer.
- **CVE críticas publicadas en los últimos 7 días** y **en los últimos 30 días**, en tecnologías en uso en el parque: instaladas en un activo en servicio o declaradas por una aplicación en servicio. Abre la página [Vulnerabilidades](vulnerabilities.md) en esas vulnerabilidades, con el filtro **En uso en el parque**.
- **CVE explotadas**, en tecnologías en uso en el parque. Abre la página Vulnerabilidades en las explotadas, con el mismo filtro.
- **Activos con una CVE crítica o alta**. Abre la lista de activos filtrada por **Con vulnerabilidades graves**.

Una línea en cero se oculta. Cuando todas las líneas están en cero, el mosaico muestra «Ninguna vulnerabilidad crítica por revisar.». Aparece un aviso cuando una fuente no se ha leído desde hace más de 3 días, por ejemplo «La NVD no se ha leído desde hace 4 días»: las cifras pueden estar desactualizadas. **Ver todo** abre la página Vulnerabilidades.

El mosaico está activado por defecto. Solo existe cuando se siguen las vulnerabilidades. Consulte [Vulnerabilidades](vulnerabilities.md#disponibilidad).

**Requiere**: `infrastructure:reader`

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

## Sección Gestión presupuestaria { #budget-management-section }

La sección **Gestión presupuestaria** muestra dónde se encuentra su gasto de TI: el presupuesto por tipo y año, sus propias líneas presupuestarias, las próximas renovaciones, la calidad de los datos y las líneas que merecen su atención. Aparece cuando puede leer las líneas presupuestarias o los contratos. Con **Ocultar los mosaicos sin contenido** activado, desaparece cuando ninguno de sus mosaicos tiene nada que mostrar.

La sección aparece justo después de la primera fila de mosaicos de inicio. Los mosaicos que quedan fuera por estar vacíos no ocupan sitio en esa fila. Los demás mosaicos de inicio siguen a la sección. En el recorrido de prueba Presupuesto de TI, la sección aparece primero (consulte [La página de inicio sigue su recorrido](#la-pagina-de-inicio-sigue-su-recorrido)).

### Diseño de la sección

Los mosaicos de la sección usan las mismas columnas que los mosaicos de inicio. El mosaico **Presupuesto** es más ancho: dos columnas en una pantalla muy ancha o grande, todo el ancho en una tableta. Cada mosaico tiene un icono, un título y normalmente un botón que le lleva a la página completa detrás de los datos.

Varios mosaicos tienen las pestañas **Todo**, **OPEX** y **CAPEX** en su encabezado para elegir el tipo de líneas que cubren. Cada mosaico recuerda su elección en su navegador.

Los mosaicos siguientes aparecen en su orden por defecto. La sección no tiene mosaico de tareas: sus tareas abiertas están en el mosaico **Mis tareas**.

### Presupuesto

Una tabla que cubre tres ejercicios fiscales: el año anterior (A-1), el año actual (A) y el año siguiente (A+1). Cada año tiene tres filas: **OPEX**, **CAPEX** y **Total**. Las columnas de valores son las columnas presupuestarias que muestra su organización, con sus nombres (**Presupuesto**, **Revisión**, **Realizado** y **Aterrizaje previsto** con la configuración estándar, más **Previsión** cuando se muestra). Puede conservar menos en la [configuración del panel](#customizing-the-budget-section). Una columna se muestra cuando contiene un importe para al menos una fila. Las columnas ocultas nunca aparecen. Todos los importes se redondean al millar más cercano y se muestran con el sufijo "k" (por ejemplo, `7.846 k`). Los separadores siguen el idioma de la interfaz.

Haga clic en un importe para abrir la [lista de líneas presupuestarias](budget-lines.md) en ese tipo. Un importe **Total** abre la lista con ambos tipos. Haga clic en **Ver** para abrir la lista.

### Top líneas

Las cinco líneas más grandes para el año actual, clasificadas por la columna por defecto. El subtítulo nombra la columna, por ejemplo **Presupuesto, A**. Los importes se redondean a miles con sufijo "k", con los separadores del idioma de la interfaz.

Use las pestañas **Todo** / **OPEX** / **CAPEX** para elegir el tipo. Haga clic en **Abrir** para ver el informe completo Top líneas sobre el mismo tipo.

### Calidad de datos

Controles que le ayudan a detectar líneas incompletas de un vistazo. El mosaico muestra una columna de recuentos por tipo: **OPEX** y **CAPEX** una junto a la otra. Los recuentos cubren las líneas que la lista muestra por defecto (**Mostrar: Activos**).

- **Sin responsable IT**: líneas sin responsable IT
- **Sin responsable de negocio**: líneas sin responsable de negocio
- **Sin empresa pagadora**: líneas sin empresa pagadora
- **Sin centro de coste**: líneas sin centro de coste
- **Sin Presupuesto para el próximo año**: líneas cuya columna por defecto es cero o está vacía para el próximo año. El control nombra su columna por defecto
- **Cuenta fuera del plan de la empresa**: líneas cuya cuenta no pertenece al plan de cuentas de la empresa pagadora

Un recuento se vuelve naranja (rojo para el control del plan de cuentas) cuando es superior a cero. Haga clic en un recuento para abrir la lista exactamente en las líneas que cuenta.

### Mi presupuesto

Las líneas a su nombre, en la columna por defecto del año actual (el subtítulo la nombra, por ejemplo **Presupuesto, A**). Use las pestañas **Todo** / **OPEX** / **CAPEX** para elegir el tipo.

- **Como responsable IT**, **Como responsable de negocio** y **Como responsable del presupuesto**: cuántas líneas tiene en cada rol, y su total. Haga clic en una fila para abrir la lista en esas líneas
- **Mis líneas**: sus tres líneas más grandes, sea cual sea el rol, con su referencia. Haga clic en una para abrirla

El mosaico indica «No hay líneas de presupuesto a su nombre» cuando no tiene ninguna línea.

### Próximas renovaciones

Lista los cinco contratos con el vencimiento más próximo, hoy incluido, en el orden de la columna **Próximo vencimiento** de la lista de contratos: un contrato con renovación tácita aparece con su próxima fecha límite de rescisión, cualquier otro contrato con su fin. Los contratos vencidos no aparecen.

Haga clic en **Ver todo** para abrir la página de Contratos.

### Mayores incrementos

Las cinco líneas con el mayor incremento en la columna por defecto comparado con el año anterior. El subtítulo nombra la columna, por ejemplo **Presupuesto, A vs A-1**. Las líneas cuyo importe se mantuvo o bajó no aparecen. Un incremento pequeño aparece completo. Uno mayor se acorta, por ejemplo `340,1 k`.

Use las pestañas **Todo** / **OPEX** / **CAPEX** para elegir el tipo. Haga clic en **Abrir** para ver el informe completo Top aumento / disminución sobre el mismo tipo.

### Por centro de coste

Los cinco centros de coste con el mayor total en la columna por defecto del año actual, con una barra para cada uno. Las líneas sin centro de coste cuentan juntas como **Sin centro de coste**. Use las pestañas **Todo** / **OPEX** / **CAPEX** para elegir el tipo. Haga clic en una fila para abrir la lista en las líneas de ese centro de coste.

### Actualizaciones recientes

Las cinco líneas presupuestarias modificadas más recientemente, OPEX y CAPEX juntas. Cada fila muestra la fecha de la última modificación, la referencia de la línea, su nombre y su tipo. Haga clic en una fila para abrir la línea.

Sin acceso de lectura a las líneas presupuestarias (`budget:reader`), los mosaicos de presupuesto se ocultan. **Próximas renovaciones** requiere acceso de lectura a los contratos.

### Importes sin tipo de cambio

Cuando la moneda de una línea no tiene tipo de cambio para un año, su importe queda excluido de los totales de ese año. Los mosaicos **Presupuesto**, **Mayores incrementos**, **Mi presupuesto** y **Por centro de coste** muestran entonces un aviso de una línea, por ejemplo «Se excluyen 3 líneas sin tipo de cambio: USD 2026.» Los usuarios de la administración presupuestaria con nivel de administrador ven además **Introducir un tipo**, que abre los ajustes de monedas en el tipo faltante. Cuando el aviso solo cita una moneda y un año, el diálogo del tipo manual se abre directamente. En **Top líneas**, una línea así muestra su importe en su propia moneda con una pequeña marca naranja. Vea [Tipos manuales](currencies.md#tipos-manuales).

## Personalizar su panel { #customizing-the-budget-section }

Haga clic en el icono de **Configuración** (engranaje) en el encabezado del panel para abrir **Configuración del panel**. El diálogo cubre todos los mosaicos de la página de inicio. Sus elecciones solo se aplican a su propia página de inicio.

- **Ocultar los mosaicos sin contenido**: arriba, activado por defecto. Consulte [Mosaicos sin contenido](#mosaicos-sin-contenido)
- **Mosaicos de inicio**: marque un mosaico para mostrarlo y arrástrelo por su asa para cambiar el orden. Mientras un mosaico está activado, sus opciones (máx. elementos, días, ámbito) aparecen debajo
- **Gestión presupuestaria**: cuando puede leer las líneas presupuestarias o los contratos, un segundo grupo lista los mosaicos del presupuesto. Márquelos y arrástrelos de la misma forma. Bajo el mosaico **Presupuesto**, **Columnas de importes** fija sus columnas: **Columnas del espacio de trabajo**, marcada por defecto, sigue las columnas que muestra su organización. Desmárquela para elegir usted mismo las columnas. Conserve al menos una: si no, el diálogo indica «Seleccione al menos una columna de importes.» **Próximas renovaciones** requiere acceso de lectura a los contratos, los demás mosaicos del presupuesto requieren `budget:reader`
- **Guardar** lo aplica todo. **Restablecer valores predeterminados** devuelve las dos listas a los mosaicos y el orden por defecto, con las columnas de la organización, y vuelve a activar **Ocultar los mosaicos sin contenido**

Solo aparecen en el diálogo los mosaicos para los que tiene permiso de visualización. Los cambios se guardan en su cuenta y persisten entre sesiones y dispositivos.

Un administrador de presupuesto elige la columna por defecto y los nombres de las columnas en [Columnas presupuestarias](budget-operations.md#columnas-presupuestarias). Los mosaicos del presupuesto y los informes que abren siguen esa elección.

Si todos los mosaicos están desactivados, el panel muestra un mensaje invitándole a activar algunos.

## Consejos

- **Empiece con los valores predeterminados**: el panel viene con un conjunto útil de mosaicos ya activados. Pruébelo durante unos días antes de personalizarlo.
- **Use las acciones rápidas**: crear una tarea, una línea presupuestaria o un documento (o registrar tiempo) directamente desde el panel le ahorra tener que navegar.
- **Revise las tareas vencidas a diario**: el mosaico Mis tareas resalta los elementos vencidos en rojo para que nada se le escape.
- **Use Tareas obsoletas con alcance de equipo**: con `tasks:admin`, cambie el mosaico Tareas obsoletas a alcance `equipo` o `todas` para encontrar trabajo que nadie está actualizando en toda la organización.
