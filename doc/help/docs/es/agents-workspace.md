# Agentes IA — Espacio del agente

El espacio del agente es donde vive un único agente: usted lo maneja, observa lo que hace, revisa sus propuestas, juzga su rendimiento y —si es administrador— configura cada detalle de su funcionamiento. Es la superficie más profunda del área de Agentes IA. Todo lo relativo a un agente que no sea un control aplicable a toda la flota está aquí: una barra de acciones que le acompaña en todas las pestañas y cuatro pestañas debajo de ella. Los administradores pueden hacer clic en el nombre del agente o en la descripción breve debajo para cambiarlo o actualizar ese resumen; ambos siguen apareciendo en la tarjeta del agente en la flota.

Abra un agente haciendo clic en su tarjeta en [Agentes IA — Vista general](agents-overview.md). El espacio siempre se abre en **Monitor**; puede enlazar directamente a cualquier pestaña, y los enlaces desde otras partes del producto le llevan a la correcta.

## Dónde encontrarlo

- **Espacio de trabajo:** Agentes IA
- **Ruta:** **Agentes IA → Vista general →** abra la tarjeta de un agente
- **Ruta URL:** `/agents/:agentKey`
- **Permiso:** la visualización requiere el rol Lector de Agentes IA (`ai_agents:reader`). Ejecutar una comprobación, probar el agente y decidir sobre las propuestas requieren el nivel de colaborador (`ai_agents:contributor`). Cambiar el modo de funcionamiento, pausar el agente y la pestaña **Configuración** requieren el nivel Administrador de Agentes IA (`ai_agents:admin`); el administrador de Configuración de IA (`ai_settings:admin`) también lo desbloquea todo.
- **Disponibilidad:** toda el área de Agentes IA requiere que la IA esté habilitada en la instancia. Si abre un enlace a un agente que no existe en su espacio de trabajo, verá **Agente no encontrado** —«Este agente no está disponible en el espacio actual.»— con una forma de volver a la flota.

Las pestañas son **Monitor**, **Aprobaciones**, **Rendimiento y autonomía** y **Configuración**. Los lectores ven las tres primeras; solo los administradores ven **Configuración**.

---

## La barra de acciones

Justo debajo del nombre del agente hay una barra estrecha de controles, alineada a la derecha, que permanece visible en **todas** las pestañas. Contiene únicamente acciones: las cifras de solo lectura del agente están en la sección **Estado** de la pestaña **Monitor**. La idea es que nunca tenga que abandonar lo que está haciendo para iniciar, detener o probar el agente.

### El control de modo de funcionamiento

El primer control es el agente en sí. Cerrado, muestra su estado real como un punto de color y una etiqueta: **Vigilancia — con aprobación**, **Vigilancia — parcialmente automática**, **Prueba**, **Desactivado**, **Pausado**, **No iniciado** o **Archivado**. Ábralo (los administradores, en un agente que no esté ni pausado ni archivado) y le ofrece los tres modos de funcionamiento:

| Modo | Qué significa |
| --- | --- |
| **Apagado** | No se ejecuta nada, ni siquiera una comprobación manual. |
| **Solo manual** | Solo se ejecuta cuando usted se lo pide: **Comprobar ahora** y las pruebas funcionan, pero el agente nunca mira por su cuenta. |
| **Vigilancia** | Comprueba por su cuenta con la frecuencia que usted defina, además de todo lo que hace **Solo manual**. |

Lea la etiqueta cerrada como la realidad y el menú como la intención: un agente configurado en **Vigilancia** que está retenido por una pausa muestra **Pausado**, no **Vigilancia**, de modo que el control nunca le dice que el agente está trabajando cuando no lo está.

**Solo manual** es el modo que hace que un agente nuevo se pueda probar sin riesgo. Es donde conviene quedarse mientras ajusta una persona y su segmentación: puede ejecutar el agente tantas veces como quiera sobre tickets reales, pero no ocurre nada si usted no lo pide. Pase a **Vigilancia** solo cuando esté satisfecho con lo que redacta.

### Los demás controles

- **Comprobar ahora** (**Buscar nuevas alertas** en un agente de supervisión) ejecuta una comprobación de inmediato en lugar de esperar a la siguiente programada. Está deshabilitado cuando el agente está en **Apagado** («Active primero el agente.») o pausado («Levante primero la pausa.»), con el motivo en la información sobre herramientas.
- **Probar en un ticket** (**Probar con una alerta** en un agente de supervisión) le lleva a la sección de prueba de la pestaña **Monitor**, esté en la pestaña que esté.
- **Pausar agente** es el freno de emergencia rojo, y deliberadamente no es lo mismo que **Apagado**. Pide un motivo y luego retiene las comprobaciones de este agente *y cualquier escritura pendiente* hasta que la levante. Los demás agentes siguen funcionando. Mientras hay una pausa en vigor, un banner de advertencia muestra **Pausa de emergencia activa: {reason}** y el control pasa a ser **Levantar pausa**. Una pausa establecida para todo el espacio de trabajo muestra en su lugar **En pausa para todos los agentes** y le lleva a la vista general de la flota: no puede levantar una pausa de todo el espacio desde un único agente.
- **Archivar agente** (administradores) retira el agente: deja de vigilar y de ejecutarse, conserva su configuración e historial, y pide confirmación primero. Cuando el agente ya está archivado, este control pasa a ser **Restaurar agente** y lo devuelve a **Apagado**.

Use **Apagado** para dejar un agente en reposo durante un tiempo; use **Pausar agente** cuando algo va mal y quiere congelar también el trabajo pendiente; use **Archivar agente** cuando haya terminado con él.

---

## Monitor

Monitor es el panel en vivo de este agente concreto. Se actualiza a medida que el trabajo avanza, por lo que es la pestaña que conviene mantener abierta cuando quiere vigilar la situación.

### Estado

La sección **Estado** es de solo lectura: es donde ahora reside cada dato sobre el estado actual del agente, en una sola línea de cifras.

- El estado del agente, con las mismas palabras que la barra de acciones.
- **Vigilancia** — **Todos los tickets**, **Filtrado** (cuando su segmentación restringe el alcance) o **Desactivado**. Un agente de supervisión muestra **Todas las alertas**, **Filtrado** o **Desactivado**.
- **Última comprobación** — el resultado de la comprobación más reciente.
- **Próxima comprobación** — **Cada N minutos**, según el ajuste **Comprobar cada (minutos)**, mientras el agente vigila. En caso contrario, **Sin definir**, porque no hay nada programado.
- **Cola** — *N en espera · N en curso*: propuestas que esperan su decisión y tickets en los que el agente está trabajando ahora mismo.
- **N fallidos**, en rojo, cuando algo se atascó y no se reintentará por sí solo. Son los elementos que encontrará en **Requiere atención** en [Aprobaciones](agents-approvals.md).
- **Ejecuciones hoy**, **Tokens hoy** y **Coste hoy**, cada uno como *usado / tope*. Son los límites de seguridad diarios definidos en **Configuración**, y aquí es donde notará que un agente está a punto de quedarse en silencio por hoy. (Solo agentes de servicio: los agentes de supervisión no se miden así, por lo que las cifras se ocultan en lugar de mostrarse como ceros engañosos.)

### Probar en un ticket

**Probar en un ticket** ejecuta el agente una vez sobre un único ticket que usted indica: la forma más rápida de ver cómo se comporta antes de dejarlo vigilar por su cuenta, o de comprobar su razonamiento en un caso concreto. Escriba un número de ticket (por ejemplo, `64`) y pulse **Ejecutar prueba**. El agente hace una pasada completa solo sobre ese ticket; todo lo que proponga aparece en la pestaña **Aprobaciones** para su revisión, como cualquier otro trabajo. No se envía nada al solicitante sin aprobación.

Un agente de supervisión tiene en su lugar **Probar con una alerta**: indíquele un ID de alerta y su diagnóstico aparece debajo, con la misma disposición de expediente que uno guardado.

Las pruebas funcionan tanto en **Solo manual** como en **Vigilancia**, que es justo la idea: son la compañera natural de un agente en el que todavía no confía.

### Actividad reciente

La parte inferior de Monitor incorpora la cronología en vivo de las comprobaciones, propuestas, decisiones, ejecuciones, pausas y errores de este agente. Es el mismo flujo que la página completa de [Actividad](agents-activity.md), ya filtrado a este agente: los mismos conmutadores de categoría, el mismo **Cargar más** y el mismo diálogo de traza.

---

## Aprobaciones

La pestaña **Aprobaciones** es la cola de revisión —respuestas, notas y cambios de tickets propuestos que esperan su decisión— acotada solo a este agente. Se comporta exactamente igual que la cola independiente, incluida la aprobación en bloque, la confirmación de acción terminal y los controles **Dar por visto** y **Repetir el análisis** de las filas de **Requiere atención**. Consulte [Aprobaciones](agents-approvals.md) para la explicación completa; aquí no cambia nada, salvo que solo ve los elementos de este agente.

---

## Rendimiento y autonomía

Esta pestaña responde a una sola pregunta: ¿se está ganando el agente más independencia? Reúne la evidencia y el interruptor uno al lado del otro, para que nunca tenga que juzgar en un sitio y actuar en otro.

### Las cifras principales

- **Aceptación** — la proporción de sus propuestas que usted aprobó. Es la cifra que más influye en si un tipo de acción puede pasar a automático.
- **Descartadas** — la proporción de propuestas revisadas que usted apartó en lugar de aprobar o rechazar. Un descarte no penaliza al agente, por lo que esta cifra queda al margen de la aceptación. Lea un valor persistentemente alto como un problema de segmentación —el agente está recogiendo tickets que no debería gestionar— y corríjalo en **Configuración → Segmentación**, en lugar de tratarlo como un problema de calidad de las respuestas.
- **Latencia de aprobación** — el tiempo habitual, en minutos, entre la aparición de una propuesta y la decisión de alguien sobre ella. Una cifra en aumento suele significar que la cola necesita más atención de los revisores, no que el agente lo esté haciendo peor.
- **Tasa de conocimiento** — con qué frecuencia sus respuestas se respaldaron con sus fuentes de conocimiento.
- **Coste por ticket** — gasto medio por ticket gestionado, en EUR. (El coste de toda la flota está en la [Vista general](agents-overview.md).)
- **Ejecuciones por ticket** — cuántas comprobaciones hicieron falta, de media, para resolver un ticket.

### Tendencias

Dos gráficos cubren los últimos 14 días. **Tendencias** representa **Propuestas** frente a **Ejecutadas** por día, para que vea cómo el agente va cogiendo ritmo, un pico o un día en que se quedó en silencio. **Coste por día** aparece debajo, como un gráfico más pequeño sobre el mismo eje de días: los recuentos y los euros deliberadamente no comparten escala. Hasta que el agente haya hecho algo, ambos muestran **Todavía no hay actividad registrada.**

### La escala de autonomía

De forma predeterminada, cada tipo de acción **pregunta primero**: el agente propone y le espera. En esta sección promueve un tipo de acción a **Automático**, uno cada vez, una vez que se lo ha ganado.

Cada fila muestra el tipo de acción, su modo actual (**Preguntar primero** o **Automático**) y una línea de progreso: decisiones capturadas frente a las necesarias, tasa de aceptación frente a la tasa exigida y días de actividad frente a los días requeridos. Cuando una fila aún no es elegible, dice por qué en términos sencillos: *Aún no hay suficientes propuestas revisadas.*, *La tasa de aceptación está por debajo del umbral.*, *Aún no hay suficientes días de actividad.*

**No todos los tipos de acción tienen el mismo riesgo, y la escala ahora lo dice.**

- **Nota interna**, **Actualización de clasificación** y **Actualización de estado** son el nivel de menor riesgo. Nada sale de su equipo y nada cambia de manos. Aquí los umbrales de evidencia son recomendaciones: cuando un tipo es elegible, **Activar** abre una breve confirmación; cuando no lo es, **Anular** le permite concederlo igualmente con un motivo por escrito.
- **Respuesta al solicitante**, **Asignación** y **Participantes** son el nivel de mayor riesgo, y sus filas están marcadas con un borde de advertencia y un recordatorio de una línea de lo que estaría aceptando: *El agente respondería al solicitante sin que nadie lo lea antes.* Ahora sí pueden automatizarse, cosa que antes no era posible. Pero la concesión requiere **siempre** una confirmación explícita y un motivo por escrito, incluso cuando todos los umbrales ya se cumplen y la fila es elegible. El motivo se conserva en el historial del agente para que su equipo vea quién lo aceptó y por qué.

En ambos casos, la confirmación le recuerda que las acciones automáticas siguen respetando los límites diarios y la pausa de emergencia, y que KANAP puede devolverlas por sí mismo a preguntar primero (véase más abajo). **Desactivar** devuelve cualquier tipo de acción automático a preguntar primero, de inmediato.

**Cuándo retrocede un tipo de acción automático.** Dos salvaguardas actúan sin que usted intervenga:

- **Una mala hora retiene la acción siguiente.** Si un tipo de acción tuvo en los últimos 60 minutos una acción fallida, una propuesta rechazada, un error del sistema conectado o un pico de coste inusual, la siguiente acción de ese tipo espera en la cola de aprobaciones en lugar de aplicarse. El tipo sigue en **Automático**, y las acciones se vuelven a aplicar cuando la hora vuelve a estar tranquila.
- **Una aceptación baja desactiva el tipo.** Si se aprobó menos de la mitad de las propuestas resueltas de un tipo de acción, KANAP lo devuelve a **Preguntar primero** y registra *Modo automático degradado* en la [Actividad](agents-activity.md) del agente. Puede volver a promoverlo cuando cumpla las condiciones.

Dos bloqueos son absolutos y ningún motivo los levanta: un tipo de acción que usted desactivó en **Capacidades** (*Esta acción no está habilitada para este agente.*) y un incidente abierto (*Un incidente abierto bloquea la automatización.*).

Automático nunca significa sin supervisión. Los límites de seguridad estrictos, los presupuestos, las comprobaciones de frescura y las pausas se aplican igual sea cual sea el modo de un tipo de acción.

---

## Configuración

La pestaña **Configuración** es solo para administradores y reúne todos los ajustes del agente. Se **guarda automáticamente**: no hay botones de guardar, y cada sección muestra un pequeño indicador **Guardando…** / **Guardado** en su encabezado a medida que se escriben sus ediciones. Si cambia de pestaña con un guardado todavía en curso, primero se completa el guardado; y si falla, el cambio de pestaña se cancela para que el error y su edición sigan en pantalla.

Las secciones siguen el orden en el que realmente se configura un agente: decida qué mira, luego qué puede hacer, luego qué es, luego qué sabe y por último cuánto puede trabajar.

### Segmentación

La segmentación decide qué tickets vigila el agente. (Si vigila o no es el modo de funcionamiento de la barra de acciones; la segmentación solo describe el alcance.)

Los preajustes rápidos —**Tickets nuevos**, **Todos abiertos**, **Gestionados por este agente**— introducen un conjunto de filtros inicial; si ya tiene filtros, se le pregunta antes de sustituirlos. El generador de filtros le permite combinar condiciones: todos los filtros se combinan entre sí, y los valores disponibles proceden directamente del sistema de tickets conectado. Al seleccionar una categoría o una entidad se incluye todo lo que hay por debajo, y el generador así lo indica.

Una línea bajo los filtros indica cuántos tickets coinciden ahora. Si otro agente ya vigila algunos de esos tickets, también se indica ese número: es la señal de que dos agentes pueden disputarse el mismo trabajo. Cuando la línea dice **al menos N**, la cola real es mayor que la vista previa (sus topes por comprobación limitan cuántos tickets se inspeccionan).

Los agentes de supervisión tienen la misma sección, filtrando en su lugar por estado de la alerta, gravedad, reconocimiento, grupo, dispositivo y tipo de comprobación.

### Capacidades

Las capacidades van primero, porque enmarcan todo lo demás: una fila de casillas para decidir qué tipos de cambio puede *llegar a* proponer el agente —**Notas internas**, **Respuestas al solicitante**, **Clasificación**, **Cambios de estado**, **Asignación** y **Participantes**—. Desmarcar una elimina por completo ese tipo de acción: el agente no puede proponerlo, digan lo que digan las instrucciones, y no puede promoverse en la escala de autonomía. Los agentes de supervisión no tienen esta sección.

**Asignación** merece una aclaración, porque funciona a través de las instrucciones y no de un ajuste. Con la casilla marcada, el agente puede proponer asignar un ticket a un **grupo de técnicos** de la herramienta de tickets, y la regla que dice qué grupo se escribe en las **Instrucciones**, en lenguaje corriente —por ejemplo *«Si la pregunta trata de SAP, asigna el ticket al grupo SAP-team. Si trata de Teamcenter, asígnalo a PLM-team. En todos los demás casos, asígnalo a Tech-desk.»*—. El agente solo elige entre los grupos que la herramienta de tickets marca como asignables, y **añade** un grupo: nunca quita a un técnico ni a un grupo ya presente en el ticket. Como cualquier otra acción, se propone para su aprobación mientras no la haya promovido en la escala de autonomía. Las instrucciones también pueden nombrar a un **técnico** concreto, siempre que pertenezca a un grupo asignable —por ejemplo *«los tickets sobre el sistema de credenciales van a Marie Dupont»*—. El agente prefiere un grupo mientras no se nombre a una persona, y una misma ronda de propuestas incluye como máximo un grupo y un técnico. Nombrar a un técnico también es aditivo: no se quita a nadie que ya esté en el ticket.

**Clasificación** también sigue las reglas de **Instrucciones**. Actívela y escriba, por ejemplo: *«Para los tickets de SAP, utilice la categoría Software > SAP, el tipo incident y la prioridad high».* El agente elige entre las opciones del catálogo de la herramienta de tickets y puede modificar varios campos en una propuesta, incluidos valores ya establecidos. Omite los campos sin cambios. Sin una regla en las instrucciones, no completa la clasificación con valores predeterminados. También puede indicar la urgencia mediante la escala de prioridades. Los cambios requieren aprobación, salvo que haya promovido la clasificación en la escala de autonomía.

### Objetivo

El objetivo describe quién es el agente y cómo escribe:

- **Propósito** — para qué está el agente, en una línea. Lo lee en cada ejecución.
- **Instrucciones** — las reglas internas, escritas libremente en líneas o párrafos. No pueden ampliar lo que el agente tiene permitido hacer. Hay un único límite: 10 000 caracteres en total — más allá, parte del texto dejaría de llegar al agente. Un contador discreto aparece al acercarse al límite; superado, la sección no se guarda hasta que acorte el borrador.
- **Idioma de respuesta** — **Idioma del ticket** (responder en el idioma que usó el solicitante), **Francés**, **Inglés**, **Alemán** o **Español**.

Junto a las instrucciones, **Nombres que puede usar en las instrucciones** enumera los estados del ticket y sus claves, los grupos de técnicos y los propios técnicos cuando **Asignación** está activada y las categorías, prioridades y tipos cuando **Clasificación** está activada. Utilice los nombres o las claves mostrados. Los estados, las prioridades y los tipos se enumeran directamente; los grupos de técnicos, los técnicos y las categorías permanecen plegados en una sola línea con su recuento y se abren de uno en uno. El campo de búsqueda de la parte superior recorre todas esas listas a la vez, y al hacer clic en un nombre se inserta en las instrucciones donde está el cursor. La búsqueda abarca todas las categorías; si hay más de 200, el agente limita primero sus opciones a los subárboles de las categorías de su selección y después conserva los primeros 200 nombres completos por orden alfabético. La traza indica cualquier truncamiento restante.

El nombre del agente y su descripción breve viven en el título del espacio, no en esta cuadrícula: haga clic para editarlos. Cómo debe sonar el agente, y cuándo debe pasar el trabajo a una persona, pertenecen a **Instrucciones** como reglas ordinarias.

**Usar contexto compartido** añade a este agente un contexto reutilizable sobre su entorno. El interruptor es lo único que ve hasta que lo activa; una vez activado, aparecen el selector de perfil, un acceso directo **+ Nuevo perfil** y una vista previa de las líneas del perfil seleccionado. El contexto compartido determina cómo interpreta el agente los tickets y redacta las respuestas, pero nunca es una concesión de permisos y **no** es una fuente citable, a diferencia de las [bibliotecas de conocimiento](knowledge.md), cuyos resultados *sí* se citan en las respuestas. Gestione los perfiles en la página [Contexto compartido](agents-shared-context.md). Si un perfil tiene más líneas de las que el agente puede enviar, un aviso indica cuántas líneas de contexto compartido no se envían al modelo: no se omite nada en silencio.

**Ver el prompt efectivo** está contraído de forma predeterminada. Expándalo para leer exactamente lo que recibe el runtime del agente, compilado a partir de todo lo anterior más las propias reglas de la plataforma. Use el selector para inspeccionar cada etapa: **Planificador de acciones**, **Planificador** e **Intérprete** son las etapas donde el agente decide *qué hacer*; **Síntesis** es donde redacta la respuesta fundamentada en sus fuentes de conocimiento; un agente de supervisión tiene **Diagnóstico** en su lugar. La vista previa se actualiza después de cada guardado. Como indica la ayuda, **la guía no puede anular las reglas de seguridad**: nada de lo que escriba en la persona puede relajar los límites estrictos de la plataforma. El mismo aviso de contexto compartido aparece aquí si se omitieron líneas.

### Fuentes de conocimiento y web

De dónde saca el agente sus datos:

- **Buscar en el conocimiento de KANAP** — cuando está activado, el agente recurre a sus [bibliotecas de conocimiento](knowledge.md) y las cita en las respuestas. Con esto desactivado, el agente responde con el conocimiento propio del modelo (y de la web, si está activada).
- **Buscar en todas las bibliotecas disponibles**, o desactívelo para elegir **Bibliotecas** concretas: el agente busca entonces solo en esas, dentro de las que puede acceder. Los nombres de las bibliotecas provienen de la sección de Conocimiento.
- **Buscar en la web** — permite que el agente también consulte la web pública; el conocimiento de KANAP siempre tiene prioridad y los resultados web se citan. Este interruptor solo está disponible si la búsqueda web está habilitada para toda la plataforma. Cuando no lo está, el interruptor aparece deshabilitado y una nota le remite a su administrador; consulte [Configuración de Plaid](ai-settings.md).

Los agentes de supervisión tienen aquí **Buscar en los datos de KANAP** en su lugar, que permite al agente consultar su propio inventario de TI —**Aplicaciones**, **Activos**, **Interfaces**, **Conexiones**, **Ubicaciones**— para añadir contexto de negocio a un diagnóstico.

### Ajustes operativos

Los controles de ritmo y presupuesto. Cuatro de ellos están a la vista: **Comprobar cada (minutos)**, **Tickets por comprobación**, **Ejecuciones por día** y **Coste por día (EUR)**. Todo lo demás, incluido el modelo IA, está en **Más opciones**. Cada campo lleva una información sobre herramientas que explica qué hace y qué ocurre cuando se alcanza.

- **Comprobar cada (minutos)** — con qué frecuencia busca el agente tickets nuevos mientras vigila, entre **5** minutos y 24 horas (1440). Es la palanca que más influye en lo ocupado —y lo caro— que resulta un agente en vigilancia. **Comprobar ahora** siempre se ejecuta al momento, diga lo que diga este valor, y esta es la cifra que informa **Próxima comprobación** en la pestaña Monitor.
- **Tickets por comprobación** — el máximo de tickets que el agente toma en una comprobación (el resto espera a la siguiente).
- **Ejecuciones por día** y **Coste por día (EUR)** — los topes diarios, cada uno con el consumo real de hoy debajo (**Hoy: …**). Una *ejecución* es una pasada sobre un ticket, no una comprobación programada.
- **Modelo IA** (en **Más opciones**): con qué modelo funciona este agente. **Predeterminado de la organización** es el valor de partida y normalmente el acertado: el agente sigue el modelo que su organización tenga definido como predeterminado y se mueve con él. Elija un modelo concreto por su nombre para fijar este agente a él: un modelo que entienda imágenes para colas con muchas capturas de pantalla, uno local y barato para el triaje de gran volumen. Solo aparecen los modelos activos; se definen en la página [Modelos IA](ai-models.md). Cuando su organización no tiene ningún modelo predeterminado, el agente funciona con el modelo incluido de KANAP, y solo después de que un administrador haya confirmado su proveedor en la página [Configuración de Plaid](ai-settings.md#confirmar-el-modelo-incluido-de-kanap). Hasta entonces el agente está en pausa: las comprobaciones programadas esperan, los tickets en cola siguen en espera y una comprobación lanzada a mano se detiene con un mensaje que indica el motivo. Un agente fijado a un modelo que usted añadió no se ve afectado. Un modelo al que hay un agente fijado no puede archivarse a sus espaldas: primero hay que sacar al agente de él. Tenga en cuenta que leer la lista de modelos requiere el permiso de administrador de configuración de IA (`ai_settings:admin`): con el rol **Administrador de Agentes IA** por sí solo, el desplegable únicamente ofrece **Predeterminado de la organización**, lo cual es una carencia de permisos y no un registro vacío.
- **Solicitudes máximas al proveedor** (en **Más opciones**) — el máximo de llamadas que el agente hace al sistema de tickets en una comprobación, para no saturarlo.
- **Revisar cada (horas)** — cuánto tarda el agente en volver a mirar el mismo ticket cuando ya no hay nada en espera (aplicado, rechazado, descartado o ventana agotada). Una propuesta en espera ocupa el ticket: el agente no escribe otro par hasta que esa propuesta desaparezca, salvo que el propio ticket haya cambiado.
- **Prioridad del agente** y **Colisión de ticket** — qué agente gana cuando varios apuntan al mismo ticket (cuanto menor es el número, mayor es la prioridad) y qué hace este cuando otro ya está trabajando en él: **Diferir** (apartarse) o **Sustituir misma prioridad** (relevar a un agente de igual prioridad).
- **Ventana de aprobación (horas)** — cuánto tiempo tiene para aprobar. Todas las propuestas de una misma comprobación comparten esta ventana y expiran juntas. Una propuesta activa ocupa el ticket durante toda esa ventana, así que **Revisar cada (horas)** 24 horas con una ventana de aprobación de 168 horas es un par válido: tiene una semana para decidir y el agente no escribe otro par entretanto, salvo que el ticket cambie.
- **Si el ticket cambió** — qué ocurre con una propuesta en espera si el ticket avanza antes de que usted decida: **Revisar de nuevo**, **Cancelar** o **Aplicar igualmente**.
- **El agente en el ticket** — cómo aparece el agente entre los actores del ticket una vez aplicada una de sus respuestas. **Toma el ticket (asignado)** es el valor por defecto: el ticket se asigna al usuario del agente en la herramienta de tickets y pasa a su estado «en curso» como con cualquier técnico. **Sigue el ticket (observador)** mantiene al agente visible en el ticket sin tomarlo. **No aparece entre los actores** deja los actores intactos: la respuesta se publica y nada más cambia. Las notas internas nunca toman un ticket; como mucho añaden al agente como observador.
- **Conservar el historial de actividad (días)** — cuánto tiempo se conserva la cronología de este agente, entre **7** y **90** días, **30** de forma predeterminada. Las entradas, ejecuciones y propuestas finalizadas más antiguas se eliminan automáticamente cada noche. Vea la advertencia más abajo.

#### Límites de seguridad

Los cinco topes económicos ocupan su propio grupo, bajo una advertencia clara: son **paradas en firme, no estimaciones**. Cuando el agente alcanza uno de ellos, deja de trabajar el resto del día y le espera; vuelve a empezar al día siguiente.

- **Tokens por ejecución** y **Coste por ejecución (EUR)** — el máximo que el agente puede gastar en *un solo ticket*. Al alcanzar uno de ellos, ese ticket se detiene y no se propone nada para él. Una *ejecución* es una pasada sobre un ticket, no una comprobación: una sola comprobación puede gastar el presupuesto por ejecución una vez por cada ticket que recoge, así que léalos junto a **Tickets máximos por comprobación**.
- **Ejecuciones por día**, **Tokens por día** y **Coste por día (EUR)** — los techos diarios. Cada uno de los tres muestra debajo el consumo real de hoy (**Hoy: …**), para que pueda dimensionar un tope según lo que el agente consume realmente en lugar de adivinarlo. Son las mismas cifras que muestra la sección **Estado** de Monitor.

Los dos topes de coste se calculan con el **Modelo IA** asignado más arriba, usando los precios registrados para él en la página [Modelos IA](ai-models.md). Esto tiene una consecuencia que conviene conocer: **un modelo gratuito (0 €) nunca alcanza un tope de coste**, porque todo lo que hace cuesta cero. Con el modelo incluido de KANAP, con un modelo local o con cualquier modelo que haya registrado sin precios, los topes de coste quedan inertes y los topes de **tokens** y de **ejecuciones** son su única protección real. Ajústelos en consecuencia.

Los agentes de supervisión tienen la misma sección en una versión más corta: **Modelo IA**, **Comprobar cada (minutos)**, **Alertas gestionadas por comprobación**, **Solicitudes a la herramienta de supervisión por comprobación** y **Conservar el historial de actividad (días)**.

!!! warning "Conserve al menos 30 días de historial si piensa usar el modo automático"
    El historial de un agente se mide sobre los últimos **28 días**. Poner **Conservar el historial de actividad (días)** por debajo de 30 elimina justamente la evidencia que cuenta la escala de autonomía, de modo que un agente puede parecer que pierde terreno que ya se había ganado. El valor predeterminado de 30 días está elegido para quedar con holgura por encima de esa ventana; redúzcalo solo en un agente que no tenga intención de promover. Nunca se purga nada que usted todavía tenga que decidir: las propuestas pendientes y las trazas que hay detrás se conservan sea cual sea el ajuste.

---

## Consejos

- **Pase por Solo manual antes de pasar a Vigilancia.** Es la forma honesta de ajustar un agente: ejecútelo manualmente sobre tickets reales, lea lo que redacta, ajuste y repita. No ocurre nada que usted no haya pedido.
- **Apagado y Pausa son herramientas distintas.** **Apagado** deja al agente en reposo. **Pausar agente** lo congela *y* congela el trabajo que ya está en curso, y pide un motivo que queda registrado: recurra a él cuando algo va mal, no cuando termina la semana.
- **La frecuencia de comprobación es su mando de coste.** Antes de subir un tope diario, pregúntese si el agente necesita mirar cada cinco minutos. En una cola tranquila, comprobar cada 30 o 60 minutos no cambia nada de la capacidad de respuesta que sus solicitantes vayan a notar, y reduce la factura en consecuencia.
- **Dimensione los topes con las cifras de «Hoy».** Cada límite diario muestra justo debajo lo que el agente ha consumido realmente hoy. Es una base mucho mejor para fijar un tope que una cifra redonda.
- **La sección Estado es su luz de aviso temprano.** Un agente que de repente se queda en silencio suele haber alcanzado un tope diario; revise *Ejecuciones / Tokens / Coste hoy* en Monitor antes de dar por hecho que algo se rompió. Con un modelo gratuito, solo los topes de tokens y de ejecuciones pueden ser la causa.
- **Aumente la autonomía de un tipo de acción cada vez.** Promueva primero los tipos de menor riesgo y deje las respuestas al solicitante preguntando primero hasta que la aceptación sea alta de forma constante. Los tipos de mayor riesgo ya están a su alcance, pero la confirmación está ahí por algo: lea lo que la fila dice que haría el agente antes de aceptarlo.
- **Lea el prompt efectivo tras un cambio en la persona.** Es la verdad de fondo de lo que el agente recibe realmente, y deja claro cuándo una instrucción quedó como usted pretendía.
- **Prefiera el contexto compartido para el trasfondo y las bibliotecas para los datos.** El contexto compartido matiza el criterio del agente pero nunca se cita; solo las bibliotecas de conocimiento (y, si está habilitada, la web) aparecen como fuentes en una respuesta.
- **Vigile el Solape en la vista previa de segmentación.** Un número de solape alto significa que dos agentes compiten por los mismos tickets; restrinja los filtros de un agente, o use **Prioridad del agente** y **Colisión de ticket** para decidir quién gana.
