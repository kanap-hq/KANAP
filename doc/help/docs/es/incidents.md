# Registro de incidentes

El registro de incidentes es el libro de bitácora de los eventos destacables que han afectado a su IT: la caída que detuvo la facturación durante tres horas, el intento de ransomware bloqueado por el filtro de correo, el fallo de almacenamiento que costó un día de copias de seguridad. Cada incidente recibe un número permanente, un diario con marcas de tiempo que nadie puede reescribir y enlaces a los activos, aplicaciones, tareas y documentos implicados.

No es un centro de servicios. Los tickets del día a día siguen en su herramienta de ticketing; el registro conserva los eventos por los que su dirección, sus auditores y su aseguradora preguntarán dentro de un año.

## Qué debe entrar en el registro

Registre un incidente cuando el evento merezca ser recordado:

- Interrupciones de servicio que hayan afectado a usuarios, clientes o a un proceso de negocio
- Eventos de seguridad: intentos de intrusión, software malicioso, fugas de datos, dispositivos perdidos
- Pérdida o corrupción de datos, restauraciones fallidas, huecos en las copias de seguridad
- Fallos graves de un proveedor o de un alojamiento, niveles de servicio incumplidos
- Todo lo que tendrá que explicar más adelante o notificar a una autoridad

No registre el trabajo rutinario: restablecimientos de contraseña, problemas de un solo usuario, solicitudes de cambio estándar o un ticket resuelto en diez minutos sin impacto. Un buen registro contiene unas pocas entradas al mes, no miles.

**Consejo**: guarde el número de ticket en el campo **Referencia externa** para que cualquiera pueda volver al rastro operativo en su herramienta de ticketing.

---

## Primeros pasos

Vaya a **Panorama IT > Incidentes** para ver el registro. Haga clic en **Nuevo incidente** para registrar uno.

**Campos obligatorios**:

- **Título**: un resumen breve y objetivo, p. ej.: «Servicio de correo no disponible en la oficina de Lyon»
- **Gravedad**: Crítica, Mayor, Menor o Baja
- **Detectado**: cuándo se advirtió el incidente (por defecto, ahora)

**Recomendados en la misma pantalla**:

- **Descripción**: qué ocurrió, tal como se observó
- **Categoría**: infraestructura, seguridad, aplicación, datos, proveedor, otros (configurable, véase [Categorías](#categorias))
- **Inicio**: cuándo empezó realmente el incidente, si difiere del momento en que lo advirtió
- **Responsable**: quién se encarga de gestionarlo

El **Notificante** es usted por defecto. Ambas fechas admiten valores pasados: un incidente descubierto el lunes por la mañana puede registrarse como iniciado el sábado por la noche.

**Permisos**:

- Consulta: `incidents:reader`
- Creación, edición, diario, enlaces, archivos adjuntos: `incidents:contributor`
- Reabrir, cancelar, eliminar y levantar una restricción: `incidents:admin`

Estos permisos cubren también la revisión del incidente y la exportación PDF: quien trabaja con incidentes no necesita ningún permiso sobre la base de conocimiento para redactar la revisión. Consulte [Vista general](#vista-general).

Un incidente restringido queda oculto para todos excepto los administradores del registro, el notificante y el responsable. En un espacio de trabajo de fábrica eso equivale a Administrador y Administrador de panorama IT, más quien lo registró o es responsable de la ficha. Un lector o colaborador que no sea el notificante ni el responsable no lo ve en la lista, en la búsqueda, en el chat ni en una exportación: abrirlo por su referencia devuelve el mismo «no encontrado» que un número inexistente. Sus tareas vinculadas también les quedan ocultas: en la lista de tareas, en la búsqueda, en el panel de control, en Plaid y entre los objetos vinculados. La revisión del incidente está sujeta a la misma restricción, se llegue a ella por donde se llegue: base de conocimiento, búsqueda, asistente, exportaciones e imágenes pegadas en el texto.

**Restringir a los administradores del registro** está en el cajón de propiedades, bajo Clasificación. Un colaborador puede activarlo mientras aún vea la ficha; solo un administrador puede desactivarlo, también después del cierre. El cambio se escribe en el diario. El registro de auditoría solo muestra las líneas de un incidente restringido, de su revisión y de sus tareas a las personas que ven el incidente, y las pastillas de relación documental omiten su título. Solo la lista «vistos recientemente», guardada en el navegador de cada persona, puede seguir mostrando el título a quien abrió el incidente antes de la restricción.

---

## Trabajar con la lista

La lista es el registro en sí: todos los incidentes, con la detección más reciente primero.

**Columnas por defecto**:

| Columna | Qué muestra |
|---------|-------------|
| **Ref** | Referencia del incidente (p. ej.: `INC-14`), monoespaciada |
| **Título** | Resumen breve (haga clic para abrir el incidente) |
| **Categoría** | Clasificación procedente de la configuración de Panorama IT |
| **Gravedad** | Crítica, Mayor, Menor, Baja, con un punto de color |
| **Estado** | Abierto, En curso, Resuelto, Cerrado, Cancelado, con un punto de color |
| **Detectado** | Cuándo se advirtió el incidente |
| **Resuelto** | Cuándo se restableció el servicio |
| **Responsable** | Persona a cargo |
| **Activos** | Número de activos enlazados |
| **Tareas** | Número de tareas de seguimiento |

**Orden por defecto**: **Detectado** descendente (el más reciente primero).

**Columnas adicionales** (ocultas por defecto, disponibles en el selector de columnas): **Cerrado**, **Aplicaciones**, **Creado**, **Datos personales**, **Requiere notificación** y **Notificado el**. **Datos personales** y **Requiere notificación** ofrecen un filtro sí/no.

**Filtrado**: Categoría, Gravedad, Estado y Responsable ofrecen filtros de casillas cuyas opciones se calculan a partir de los incidentes visibles, por lo que solo verá valores presentes en el conjunto de resultados. Las columnas de fecha ofrecen filtros de fecha, incluido un rango: filtre **Detectado** entre dos fechas para obtener un extracto trimestral o anual. La búsqueda cubre el título, la descripción, la referencia (`INC-14`) y los nombres y referencias de los activos y aplicaciones vinculados, de modo que una búsqueda por un nombre de host como `PAR-ESX-01` lista los incidentes de ese activo. Las palabras que solo aparecen en la revisión del incidente se encuentran mediante la búsqueda global y el asistente, no mediante este cuadro. La búsqueda global, el selector `@` de Plaid y el servidor MCP también encuentran un incidente por el nombre, la referencia `AST-N`, el nombre de host o el FQDN de sus activos vinculados.

**Consejo**: combine Gravedad = Crítica, Mayor con un rango de **Detectado** para construir la lista corta que piden la mayoría de los comités de dirección y las auditorías.

Los filtros aplicados se conservan al abrir un incidente: **Anterior / Siguiente** en el espacio de trabajo recorre esa misma lista corta.

---

## El espacio de trabajo del incidente

Haga clic en cualquier fila para abrir el incidente. El espacio de trabajo tiene un **encabezado** con la referencia y metadatos rápidos, un **cajón de propiedades** a la derecha y un **área de contenido** en el centro que cambia con cada pestaña.

Las pestañas son **Vista general**, **Diario**, **Relaciones**, **Documentos** e **Historial** (los cambios del incidente, vea [Historial de los registros](record-history.md)).

### Encabezado y metadatos

El encabezado muestra el título (editable en el sitio), la referencia `INC-N` (haga clic para copiarla), las acciones de ciclo de vida y **Anterior / Siguiente** para recorrer la lista filtrada.

La línea de metadatos inferior muestra **Estado**, **Gravedad**, **Responsable**, **Detectado** y, una vez resuelto el incidente, la **Duración** entre la detección y la resolución. Gravedad, Responsable y Detectado se cambian directamente desde esa línea.

### Cajón de propiedades

El cajón permanece visible en todas las pestañas y guarda a medida que edita.

**Clasificación**:

- **Categoría**: de la lista configurada en la configuración de Panorama IT
- **Gravedad**: Crítica, Mayor, Menor, Baja. Elija el nivel que refleje el impacto de negocio en ese momento; cada cambio queda anotado en el diario, así que subirlo o bajarlo después es normal y trazable
- **Estado**: Abierto, En curso, Resuelto, Cerrado. El estado solo avanza. Volver atrás se hace con **Reabrir**, para que el registro no pueda rebobinarse discretamente
- **Restringir a los administradores del registro**: ocultar el incidente a los demás lectores y colaboradores. El notificante y el responsable siguen viéndolo. Solo un administrador puede levantar la restricción, también después del cierre. Cuando está activa, la línea de metadatos muestra **Restringido**

**Fechas**:

- **Inicio**: cuándo empezó realmente el incidente
- **Detectado**: cuándo se advirtió (obligatorio)
- **Resuelto**: se rellena automáticamente al pasar el estado a Resuelto y sigue siendo editable mientras el incidente está abierto, para corregirlo a la hora real del restablecimiento
- **Cerrado**: de solo lectura, se marca al cerrar el incidente

**Personas**: **Notificante** (quien lo registró) y **Responsable** (quien lo gestiona).

**Origen**: **Referencia externa** para el número de ticket, el identificador de alerta o la referencia de correo por la que se comunicó el incidente por primera vez.

**Conformidad**: **Datos personales afectados**, **Notificación a la autoridad requerida**, **Notificado el** (aparece cuando la notificación es requerida) y **Partes informadas**.

**Registro**: fechas de **Creación** y **Actualización**, de solo lectura.

---

### Vista general

La vista general cuenta el incidente en dos partes: una descripción breve y, después, la revisión del incidente. Ambas se guardan automáticamente mientras escribe. Los archivos adjuntos cierran la página.

La **Descripción** ocupa una o dos frases sobre qué ocurrió, tal como se observó. Es el resumen que aparece en la lista, en los resultados de búsqueda y al principio del informe PDF.

La **Revisión del incidente** es el relato completo, redactado en un documento y no en cuadros de texto simple. Admite títulos, listas, tablas, enlaces e imágenes pegadas directamente en el texto.

Un incidente nuevo parte de la plantilla **Revisión del incidente**, que propone las cinco partes en el orden en que se lee normalmente un informe de incidente:

- **Descripción detallada**: qué ocurrió, en detalle
- **Impacto**: servicios, ubicaciones y usuarios afectados
- **Causa raíz**: por qué ocurrió
- **Acciones correctivas**: qué se hizo para corregirlo y para prevenirlo. Haga el seguimiento del trabajo real como tareas enlazadas
- **Lecciones aprendidas**: qué conviene retener de este incidente

Reescríbalas, elimine las que no necesite, añada las suyas. Para un incidente menor basta con la descripción breve. Para uno mayor, la revisión es el post-mortem.

Los títulos aparecen en el idioma de la persona que registra el incidente (inglés, francés, alemán o español). Una plantilla que sus administradores hayan reescrito conserva sus propios términos.

La plantilla es un documento ordinario de la base de conocimiento, almacenado en la biblioteca **Plantillas** bajo el tipo de documento **Revisión del incidente**. Quien tenga `knowledge:admin` la edita como cualquier otro documento de esa biblioteca, para adaptarla a su propio formato de post-mortem. Una plantilla nueva se aplica a los incidentes registrados después y nunca reescribe una revisión que ya existe.

Cada guardado que modifica la revisión conserva una versión, así que el texto puede releerse tal como estaba en cualquier momento, incluido el cierre del incidente. Consulte [Diario](#diario).

La revisión es en sí misma un documento de la base de conocimiento, con su propia referencia `DOC-N`, archivado en la carpeta **Incidentes** de la biblioteca **Documentos gestionados**. Redactarla desde el incidente y exportar el PDF solo usan los permisos de incidentes. Abrir ese mismo documento directamente en la base de conocimiento requiere además los permisos de la base de conocimiento sobre esa biblioteca. En ambos casos sigue ligada al incidente: se congela cuando el incidente se cierra o se cancela, y queda oculta para quien no pueda ver un incidente restringido.

**Archivos adjuntos**: los archivos que respaldan el registro, como capturas de pantalla, extractos de registros, exportaciones de correo o el informe de incidente del proveedor. Con `incidents:contributor`, arrastre y suelte archivos o haga clic para seleccionarlos. Haga clic en un archivo adjunto para descargarlo. La sección aparece en cuanto el incidente tiene un archivo, o cuando puede modificarlo. En un incidente cerrado o cancelado, los archivos siguen siendo legibles; añadirlos y eliminarlos vuelve a ser posible tras la reapertura.

---

### Diario

El diario es lo que convierte esto en un registro y no en un formulario. Enumera todo lo que le ha ocurrido al incidente, de lo más reciente a lo más antiguo, y **nada de lo que contiene puede editarse ni eliminarse**, por nadie, en ningún momento.

**Añadir una nota**: escríbala en el redactor de la parte superior y haga clic en **Añadir** (o pulse Ctrl+Intro). La fecha y la hora junto al botón fijan el momento al que se refiere la nota. La hora se escribe en formato de 24 horas (23:40). Por defecto es ahora, y puede situarla en el pasado: una nota añadida el martes puede registrarse como ocurrida a las 23:40 del sábado, y se ordenará en ese punto de la cronología. KANAP guarda por separado el momento en que la nota se grabó realmente, y nadie puede cambiarlo: así el registro retroactivo sigue siendo honesto. Cuando una nota se refiere a un momento anterior a su grabación, su fila muestra también la hora de registro, por ejemplo «registrada el 27 oct., 10:12». El informe PDF da las dos horas en dos columnas.

**Las entradas automáticas** aparecen junto a sus notas:

| Entrada | Cuándo se escribe |
|---------|-------------------|
| **Sistema** | Al crear: «Incidente registrado» |
| **Cambio de estado** | En cada cambio de estado, mostrado como «Estado: En curso → Resuelto» |
| **Cambio de gravedad** | En cada cambio de gravedad, mismo formato |
| **Reabierto** | Al reabrir, con el motivo indicado |
| **Enlaces actualizados** | Cuando se enlazan o desenlazan activos o aplicaciones, nombrándolos |

Cada fila muestra el autor, la hora a la que se refiere (pase el cursor para ver «hace 3 días») y el tipo de entrada para todo lo que no sea una nota simple.

Una entrada **Vínculos actualizados** solo se muestra a las personas que pueden leer el módulo que nombra: los activos y las tecnologías requieren la infraestructura, las aplicaciones las aplicaciones. Las notas conservan su texto, mencionen lo que mencionen.

El redactor desaparece en cuanto el incidente se cierra o se cancela. Las modificaciones de campos hechas fuera del diario, como corregir la descripción, aparecen en la pestaña **Historial**.

La revisión del incidente conserva su propio historial. Cada guardado que la modifica produce una versión, y las versiones se conservan para siempre. La edición corriente no añade entradas al diario: redactar la revisión no es un acontecimiento del incidente, y el registro de auditoría recoge quién cambió qué. El cierre, la cancelación y las importaciones sí escriben una entrada de diario, y esa entrada nombra la versión de la revisión a la que se aplica, mostrada como «Versión 4 de la revisión del incidente (DOC-12)».

Reabrir un incidente no cambia nada de eso. Las versiones se mantienen, la entrada de cierre sigue apuntando a la versión vigente cuando se cerró la ficha, y ese texto puede releerse más adelante con las imágenes que contenía, bajo las reglas de acceso que tenga el incidente en ese momento.

---

### Relaciones

La pestaña Relaciones muestra lo que afecta el incidente: sus activos, aplicaciones y tecnologías, cada uno en su propia tabla, y después sugerencias y las tareas. Haga clic en una fila para abrir el registro. La insignia de la pestaña cuenta los activos, aplicaciones y tecnologías vinculados que puede ver, además de las tareas.

**Registros vinculados**, una tabla cada uno:

| Sección | Columnas |
|---|---|
| **Activos** | Referencia (`AST-12`), nombre, tipo, entorno, estado |
| **Aplicaciones** | Referencia (`APP-3`), nombre, ciclo de vida, criticidad de negocio |
| **Tecnologías** | Referencia (`TEC-5`), nombre, familia, editor |

Solo ve las secciones de los módulos que puede leer. Los activos y las tecnologías requieren poder leer la infraestructura. Un Colaborador de negocio solo ve las aplicaciones en las que participa.

**Añadir y quitar vínculos** (`incidents:contributor`): **Añadir**, a la derecha de una sección, abre una búsqueda. Escriba un nombre o una referencia y elija un resultado: el vínculo se guarda al instante y queda anotado en el diario. Vincular requiere también poder leer el módulo de destino: **Añadir** no aparece en una sección que no puede leer. Para quitar un vínculo, pase el cursor sobre la fila y haga clic en la cruz al final. Quitar un vínculo no elimina nada más y también queda anotado en el diario. Un incidente cerrado o cancelado es de solo lectura: reábralo para cambiar sus vínculos.

**Relacionados**: las tecnologías de los activos y las aplicaciones vinculados que el incidente aún no lista. El motivo indica el origen, por ejemplo «tecnología del activo AST-12» o «tecnología de la aplicación APP-3». Haga clic en **Vincular** para añadir la sugerencia a la sección Tecnologías. Las sugerencias requieren poder leer la infraestructura, muestran como máximo 20 tecnologías y no aparecen en un incidente cerrado o cancelado.

**Tareas**: el trabajo de seguimiento. Cree una tarea directamente desde el incidente y quedará vinculada a él. La tarea muestra «Incidente · INC-14» en su propia barra lateral, y la columna Tareas del incidente la cuenta.

Un activo, una aplicación o una tecnología vinculados muestran el incidente en una sección **Incidentes** de su propia pestaña Relaciones: quien mire un servidor verá su historial de incidencias. Con `incidents:contributor`, también puede vincular un incidente desde allí. Los documentos tienen su propia pestaña.

---

### Documentos

Documentos de la base de conocimiento enlazados a este incidente: el informe del proveedor, el procedimiento seguido, la nota que redactó el equipo de red. Con `knowledge:member` puede crear un documento directamente desde esta pestaña.

La revisión del incidente no aparece aquí. Pertenece al incidente en sí y se edita en la pestaña Vista general.

---

## Cerrar, reabrir y cancelar

**Resuelto** significa que el servicio está restablecido. **Cerrado** significa que el registro es definitivo.

Cerrar bloquea el incidente. Campos, revisión del incidente, notas del diario, enlaces, archivos adjuntos y creación de tareas se rechazan, en la interfaz, en la base de conocimiento, en el asistente y a través de la API. La Vista general muestra un aviso de una línea: «Cerrado el 12 de marzo de 2026. Reábralo para hacer cambios.» La revisión se congela en la versión que nombra la entrada del diario, tanto si el cierre se hizo desde el incidente como por una importación.

**Reabrir** (`incidents:admin`) devuelve un incidente resuelto, cerrado o cancelado a En curso y borra las fechas de resolución y de cierre. El motivo es obligatorio y se escribe en el diario, de modo que el registro muestra por qué se volvió a tocar.

**Cancelar incidente** (`incidents:admin`) es para un registro que nunca debió existir: un duplicado o un evento registrado por error. El motivo es obligatorio, el estado pasa a Cancelado y el incidente queda bloqueado como uno cerrado. No se elimina nada y el número se mantiene: `INC-13` nunca desaparece entre `INC-12` e `INC-14`. Un hueco en la numeración sería lo primero por lo que preguntaría un auditor.

### Eliminar un incidente

**Eliminar** (`incidents:admin`) es un icono de papelera en la página del incidente y en la lista una vez seleccionadas las filas. Retira un incidente registrado por error, como un duplicado o una entrada de prueba. Solo se puede eliminar un incidente abierto, en curso o resuelto. Un incidente cerrado o cancelado permanece en el registro y conserva su número `INC-N`. Los demás usuarios no ven ni el botón ni la selección.

Antes de retirar nada, una confirmación indica lo que se va con el incidente: su revisión de incidente, sus tareas, sus entradas del diario y sus adjuntos (también los archivos). También indica los vínculos que se quitan: las aplicaciones, los activos y los documentos de Knowledge se mantienen, solo desaparece su vínculo con el incidente. La eliminación queda registrada en la pista de auditoría.

Un incidente con datos de notificación regulatoria no se puede eliminar: **Datos personales afectados** o **Requiere notificación a la autoridad** marcada, **Notificado el** o **Partes informadas** completados. Ese registro es evidencia de auditoría (notificación a la autoridad según NIS2, y artículo 33(5) del RGPD, que exige documentar toda violación de datos personales). La confirmación lo indica antes de hacer nada: cancele o cierre el incidente en su lugar. En una selección, los incidentes que no se pueden eliminar se conservan y los demás se eliminan.

---

## Conformidad y evidencia para auditoría

Dos interruptores del cajón sostienen la parte normativa del registro:

- **Datos personales afectados**: actívelo en cuanto se hayan expuesto, alterado o perdido datos personales. Es el indicador por el que filtra su delegado de protección de datos
- **Notificación a la autoridad requerida**: actívelo cuando el evento deba comunicarse, por ejemplo a una autoridad de protección de datos, a una agencia nacional de ciberseguridad o a un regulador sectorial. **Notificado el** recoge entonces cuándo lo presentó, y **Partes informadas** enumera a quién se avisó: regulador, aseguradora, clientes afectados, seguridad del grupo

Los plazos y umbrales dependen de su jurisdicción y de su sector. KANAP registra los hechos y las fechas; no decide si usted debe notificar.

**Lo que el registro aporta a un auditor**:

- Una secuencia numerada en la que los incidentes cerrados y cancelados nunca se eliminan
- Para cada incidente: cuándo empezó, cuándo se advirtió, cuándo se resolvió y se cerró, y quién era el responsable
- Un diario imposible de reescribir, con cada cambio de estado y de gravedad fechado y atribuido
- La evidencia en sí, como archivos adjuntos y documentos enlazados
- La revisión del incidente, con la causa raíz, las acciones correctivas y las lecciones aprendidas, conservada versión a versión, y las tareas de seguimiento que demuestran que las acciones se llevaron a cabo
- Vistas filtradas por periodo, gravedad, categoría o indicador de conformidad, directamente desde la lista
- Una exportación del registro en CSV o Excel (**Exportar** en la lista), para los auditores y para su propio archivo. El archivo empieza por la referencia INC. Sigue los filtros, la búsqueda y el orden de la lista, y cuando hay un filtro activo el diálogo indica cuántos incidentes se exportan. Los incidentes restringidos se omiten salvo que tenga derecho a verlos; el archivo incluye una columna importable **Restringir a los administradores del registro**
- Un informe PDF de un solo incidente (**Exportar PDF** en el espacio de trabajo), para el auditor que quiere una ficha en lugar de todo el registro

**Importar un registro existente**: **Importar** en la lista acepta un archivo CSV o un libro de Excel (`.xlsx`). Deje la columna de referencia vacía para crear incidentes (KANAP asigna los siguientes números INC), o conserve la referencia INC-N para actualizar los registros correspondientes. Cada incidente importado recibe una entrada de diario que indica que procede de un archivo. Exporte primero, o descargue la plantilla vacía, si quiere la disposición exacta de las columnas. La plantilla no tiene en cuenta los filtros de la lista.

Los encabezados, la gravedad y el estado se escriben en el idioma de la exportación. La importación acepta encabezados y valores en cualquiera de los cuatro idiomas, así como los códigos técnicos (`major`, `in_progress`).

Un estado puede avanzar mediante un archivo. Hacerlo retroceder, o cancelar un incidente, requiere `incidents:admin`: el diario recibe entonces una reapertura o una cancelación con el motivo «Imported from CSV». Para un colaborador, esa línea se rechaza con un mensaje.

El archivo lleva la **Descripción** breve en una columna y toda la **Revisión del incidente** en otra, como texto con formato. Esa única columna de revisión sustituye a las antiguas columnas Impacto, Causa raíz, Acciones correctivas y Lecciones aprendidas. Los títulos, las listas y los enlaces sobreviven al viaje de ida y vuelta; las imágenes pegadas no, porque viven en el documento. Una celda de revisión vacía deja intacto el texto existente.

Las fechas y horas se escriben en la hora local de su navegador, como la lengua de la exportación escribe las fechas: un incidente detectado a las 10:38 en París se escribe `16/10/2026 10:38` en español. El encabezado de cada columna de fecha y hora indica esa zona horaria después del nombre de la columna, por ejemplo `detected_at (Europe/Paris)`, y la plantilla también la indica. La importación lee cada columna en la zona horaria que indica su encabezado, así que un archivo exportado se vuelve a cargar sin cambios dondequiera que se importe. Un encabezado sin zona horaria, como en archivos más antiguos o hechos a mano, se lee en UTC (tiempo universal coordinado). Una zona horaria que KANAP no reconoce detiene la importación. La importación también acepta `2026-10-16T08:38:00Z`, que lleva su propia zona horaria.

La importación es la única operación que sigue escribiendo en un incidente cerrado o cancelado, para que una corrección que llega meses después pueda archivarse sin reabrir la ficha. Crea una versión nueva de la revisión y una entrada de diario que apunta a ella, y nunca reescribe la versión a la que se refiere el cierre. Nada más se relaja: los permisos del registro se aplican, y un incidente restringido que usted no tenga derecho a ver se rechaza.

---

## Exportar un informe PDF para un auditor

Abra un incidente y haga clic en **Exportar PDF** en las acciones de la cabecera. KANAP descarga un PDF de ese registro: `INC-12-incident-report.pdf`. La descarga usa su sesión iniciada; no es un enlace público.

El informe sigue el idioma de la interfaz (inglés, francés, alemán o español). Se compone en este orden:

1. Cabecera y propiedades del incidente
2. La descripción breve
3. La revisión del incidente tal como está redactada en ese momento, con su formato y sus imágenes
4. El diario en orden cronológico, incluidas las versiones de la revisión a las que remiten las entradas
5. Los activos, aplicaciones, tecnologías, tareas (con su asignado y su fecha límite) y documentos vinculados
6. Los campos de conformidad
7. Los archivos adjuntos (nombre de archivo, tamaño y fecha)

Las secciones vacías se omiten, y una revisión que solo contenga los títulos intactos de la plantilla cuenta como vacía. Cada sección vinculada sigue los permisos del lector: los activos y las tecnologías requieren poder leer la infraestructura, las aplicaciones poder leer las aplicaciones (un Colaborador de negocio ve aquellas en las que participa) y las tareas poder leer las tareas. Una sección que usted no puede leer no aparece.

La exportación es una lectura. Funciona en un incidente cerrado o cancelado; el registro permanece bloqueado. El botón no aparece en **Nuevo incidente**.

---

## Categorías

Las categorías de incidente son suyas: defínalas en **Panorama IT > Configuración**, en **Incidentes > Categorías de incidente**. KANAP incluye de serie infraestructura, seguridad, aplicación, datos, proveedor y otros.

Mantenga la lista corta. Las categorías son aquello por lo que agrupará un año de incidentes, y una lista de treinta es una lista que nadie usa de forma coherente. En lugar de eliminar una categoría que ya está en uso, márquela como obsoleta: desaparece del selector para los nuevos incidentes mientras los existentes conservan su historial.

---

## Preguntar al asistente

Plaid lee y escribe el registro en el chat, con los mismos permisos que en el resto de la aplicación. Cada cambio llega como una vista previa que usted aprueba.

**Lectura**: pida a Plaid un recuento (« ¿Cuántos incidentes críticos este trimestre? »), una lista filtrada (« Lista de incidentes abiertos en PAR-ESX-01 ») o una ficha completa (« Resumen de INC-2 »). La ficha completa incluye el diario y la revisión del incidente, de modo que una pregunta puede responderse a partir de la causa raíz o de las lecciones aprendidas. Las horas se dan en su propia zona horaria. Cuando Plaid lee un incidente, los objetos vinculados siguen los mismos permisos que el informe PDF. Un incidente restringido que usted no puede ver queda fuera de las respuestas, de los recuentos, de las agrupaciones, de las medias y de las fuentes, incluida su revisión.

Plaid filtra los incidentes por activo, aplicación o tecnología, indicados por su referencia o su nombre exacto: `APP-1` no trae los incidentes de `APP-12`. Agrupado por activo, aplicación o tecnología, un incidente cuenta en cada uno de sus registros vinculados, de modo que la suma de los grupos puede superar el total. Un incidente sin vínculos no aparece en ningún grupo. Plaid también agrupa los incidentes por mes de detección o de resolución. Los meses siguen la hora UTC (tiempo universal coordinado): un incidente detectado a las 00:30 del 1 de noviembre en París cuenta en octubre. Plaid lee el tiempo de resolución, de la detección a la resolución en horas, para cada incidente o como media, mínimo o máximo. Los incidentes cancelados y no resueltos quedan excluidos. Pregunte, por ejemplo: « Tiempo medio de resolución de los incidentes de gravedad Alta por mes este año ».

**Escritura** (nivel Colaborador en Incidentes): Plaid registra un incidente, cambia sus campos y hace avanzar su estado hasta Cerrado. Registra un incidente como Abierto o En curso. Un incidente ya resuelto se registra abierto y luego se hace avanzar en una segunda vista previa, para que el paso aparezca en el diario. Plaid puede activar **Restringir a los administradores del registro**. La vista previa le avisa cuando eso le ocultaría el incidente. Plaid también añade notas al diario, con la hora a la que se refiere la nota si usted la indica, y vincula o desvincula activos, aplicaciones y tecnologías, indicados por su referencia o su nombre exacto, o por el nombre de host o el FQDN en el caso de un activo. Con el nivel Miembro en Tareas, crea una tarea de seguimiento en el incidente. Pregunte, por ejemplo: « Registra un incidente de gravedad Alta: correo no disponible en la oficina de Lyon desde las 08:40, vinculado a PAR-MAIL-01 ».

El cierre congela la ficha, y la vista previa del cierre lo indica. Solo un administrador puede reabrir el incidente.

**Acciones de administrador** (nivel Administrador en Incidentes): Plaid reabre un incidente resuelto, cerrado o cancelado, cancela un incidente y activa o desactiva **Restringir a los administradores del registro**, también en un incidente cerrado o cancelado. Reabrir y cancelar requieren un motivo, que se escribe en el diario, por ejemplo: « Reabre INC-14: el problema volvió después de la corrección ».

La eliminación de un incidente y la adición de archivos adjuntos se quedan en la página del incidente (consulte [Eliminar un incidente](#eliminar-un-incidente)). Los asistentes conectados por MCP solo leen.

---

## Consejos

- **Registre pronto, complete después**: cree el incidente mientras está ocurriendo, con un título y una gravedad. El diario está pensado para ir añadiendo hechos según llegan
- **Escriba notas objetivas, con horas**: «13:05 conmutación al sitio secundario, correo restablecido para 40 usuarios». Ajuste la fecha y la hora para que la cronología refleje el incidente y no su velocidad al teclear
- **Feche hacia atrás con honestidad**: Inicio y Detectado están para contener las horas reales. La hora de grabación de cada entrada del diario se guarda aparte y no puede modificarse
- **Un incidente, no uno por ticket**: una única caída que generó cuarenta tickets es un solo incidente, enlazado a los activos implicados
- **Convierta las acciones en tareas**: la sección de acciones correctivas de la revisión describe la intención; una tarea con responsable y fecha de vencimiento es lo que se hace de verdad
- **Cierre de forma deliberada**: el cierre es el momento en que el registro se convierte en evidencia. Termine la revisión antes de cerrar, porque la versión conservada en ese momento es la que leerá un auditor, y después hará falta un administrador para reabrir el incidente
- **Revise el registro cada trimestre**: filtre por periodo y gravedad, observe las categorías recurrentes y los activos que aparecen más de una vez. De ahí sale la próxima solicitud de presupuesto
