# Agentes IA: aprobaciones

Aprobaciones es la cola de revisión diaria para todo lo que sus agentes IA quieren hacer. Antes de que un agente publique una respuesta, añada una nota, reclasifique un ticket, cambie su estado, lo reasigne o lo cierre, presenta ese trabajo ante usted aquí como una **propuesta**. Nada de lo que hay en esta página ha ocurrido todavía del lado del solicitante: una propuesta es la sugerencia del agente, y solo llega a su sistema de tickets conectado una vez que usted la aprueba. Aquí es donde un operador pasa la mayor parte de su tiempo supervisando un agente de helpdesk: leyendo cada borrador y decidiendo qué hacer con él: aplicar los buenos, rechazar los erróneos y apartar los que son correctos pero no deben enviarse.

## Dónde encontrarlo

- Espacio de trabajo: **Agentes IA**
- Ruta: **Agentes IA → Aprobaciones**
- Ruta URL: `/agents/approvals`
- Permiso: requiere que la IA esté habilitada en la instancia y el rol Lector de Agentes IA (`ai_agents:reader`) para leer la cola. Decidir una propuesta, dar por vista una fila de atención y repetir un análisis requieren el nivel de colaborador (`ai_agents:contributor`).
- La misma cola aparece acotada a un solo agente en la pestaña **Aprobaciones** del [espacio de trabajo](agents-workspace.md) de ese agente. La página en `/agents/approvals` es la vista combinada de todos los agentes; la pestaña del espacio de trabajo muestra solo las propuestas del agente que está viendo. La disposición y los controles son idénticos.

---

## Qué es una propuesta

Cada propuesta es una acción concreta que un agente quiere realizar sobre un ticket. Existen ocho tipos de acción, cada uno con su propia etiqueta e icono:

| Acción | Qué hace |
| --- | --- |
| **Respuesta al solicitante** | Un mensaje que el agente quiere enviar a la persona que abrió el ticket. |
| **Nota interna** | Una nota que el agente quiere añadir para su equipo, no visible para el solicitante. |
| **Clasificación** | Modifica la categoría, el tipo, la prioridad o la urgencia del ticket según las instrucciones. Una propuesta puede contener varios campos y muestra los valores actuales y propuestos con los nombres de las categorías. |
| **Estado** | Un paso a un estado de ticket diferente (por ejemplo, de **Nuevo** a **Pendiente**). |
| **Cerrar ticket** | Cierra el ticket; consulte [Cerrar y resolver tickets](#cerrar-y-resolver-tickets). |
| **Resolver ticket** | Marca el ticket como resuelto; consulte [Cerrar y resolver tickets](#cerrar-y-resolver-tickets). |
| **Asignación** | Añade un grupo de técnicos **o** un técnico concreto al ticket, según la regla de enrutamiento escrita en las instrucciones del agente. No se quita a nadie que ya esté en el ticket. La propuesta muestra quién se añade y quién está asignado actualmente. |
| **Observadores** | Añade un técnico o un grupo asignable como observador. El solicitante permanece igual, y las personas que ya siguen el ticket permanecen. |

En el caso de una **Respuesta al solicitante** o una **Nota interna**, el cuerpo que ve es el mensaje redactado completo, exactamente como se publicaría. Léalo como lo haría el solicitante (o su equipo). Para los otros cinco tipos, el cuerpo es un breve resumen del cambio en lugar de texto libre (por ejemplo `Status: New -> Pending`, `Assignee: Unassigned -> Jane`, o una comparación de clasificación campo por campo), a menudo seguido de una línea **Motivo** que explica por qué el agente lo propone.

Las propuestas se agrupan por ticket. Cada grupo está encabezado por el ticket (**Ticket n.º N**), su estado actual, un recuento como **3 propuestas** y cuándo se actualizó por última vez. Un ticket puede contener varias propuestas a la vez (por ejemplo, una respuesta, una reclasificación y un cambio de estado) y usted puede decidirlas individualmente o todas juntas.

---

## Las cuatro secciones

La cola está organizada en cuatro secciones según dónde se encuentre cada elemento en su ciclo de vida.

### Requiere tu decisión

Las propuestas que esperan por usted, agrupadas por ticket. Esta es la sección donde ocurre la mayor parte de su trabajo; **En curso** y **Finalizadas recientemente** son puramente informativas. Cuando está despejada, muestra *Nada requiere tu decisión.* Una vez que decide una propuesta, se contrae a una única línea de estado dentro de su grupo de ticket, mientras que las propuestas restantes del ticket permanecen abiertas para usted.

### En curso

Trabajo que ya está en marcha y no requiere nada de usted: propuestas que aprobó y que ahora se están aplicando al sistema de tickets conectado, y tickets que un agente está comprobando activamente. Las filas aquí muestran el estado en vivo, como **Esperando para iniciar**, **En curso**, **Ejecutando…** o **Agente trabajando…**. Cuando no hay nada en marcha, la sección no se muestra en absoluto: una lista «en curso» vacía no le dice nada que no pueda leer ya en el propio estado del agente.

### Requiere atención

Cualquier cosa que haya fallado o esté bloqueada: una propuesta que no se pudo enviar al sistema de tickets conectado, o una comprobación que dio error. Cada fila lleva una leyenda en rojo que explica qué salió mal y un botón **Traza** que abre la historia completa sin salir de la página. Cuando está despejada, muestra *No hay trabajo de agentes que requiera atención.*

Esta es la sección que hay que vigilar, y ya no es un callejón sin salida: consulte [Despejar una fila de Requiere atención](#despejar-una-fila-de-requiere-atencion) más abajo.

### Finalizadas recientemente

Un historial contraíble de los elementos completados más recientemente: aplicados, rechazados, descartados, omitidos o hechos. Permanece plegado hasta que lo abre, recuerda esa elección y muestra hasta 30 filas con una línea **+N más** que le indica cuántos elementos más antiguos existen. Úselo para confirmar que una aprobación realmente se realizó, o para comprobar qué hizo un agente mientras usted estaba ausente. Las filas que dio por vistas en **Requiere atención** también acaban aquí.

---

## Tomar una decisión: Aprobar, Rechazar y Descartar

Cada propuesta pendiente ofrece tres acciones.

- **Aprobar** muestra **Aprobar** en una propuesta que aún no ha decidido, y **Ejecutar** en una que ya aprobó pero que no se ha ejecutado. En ambos casos hace lo mismo: envía la acción a su sistema de tickets conectado, donde el agente publica la respuesta o la nota, o aplica el cambio. Aprobar es el momento en que el solicitante (o su equipo) puede verse afectado; hasta ese punto nada ha salido de KANAP.
- **Rechazar** no aplica la acción. La propuesta se desecha pero permanece en el registro de auditoría, de modo que siempre queda constancia de lo que el agente sugirió y de que usted lo rechazó. Rechazar una sola propuesta surte efecto de inmediato. Rechazar es una señal de calidad: penaliza la evaluación del agente y su tasa de aceptación, porque le indica que la propuesta era errónea.
- **Descartar** también aparta la propuesta sin enviar nada, pero, a diferencia de rechazar, **no** penaliza al agente. La tasa de aceptación y el historial de autonomía del agente no se ven afectados. Úselo cuando la propuesta es correcta pero simplemente no debe salir: un ticket sensible, un compañero que ya ha respondido, un duplicado. Es un solo clic, sin solicitar motivo, y su información sobre herramientas indica *Descartar sin penalizar la evaluación del agente*. Una propuesta descartada ya no puede aprobarse.

Si una propuesta está actualmente **bloqueada** (por ejemplo, si una comprobación de frescura o de seguridad ya no se cumple, o si el sistema de tickets no acepta el cambio en este momento), su botón principal se desactiva y el motivo aparece en la información sobre herramientas del botón. La propuesta permanece visible para que pueda ver por qué no puede continuar.

**Aprobar todo**, **Rechazar todo** y **Descartar todo** aparecen en un grupo de ticket cuando hay más de un elemento sobre el que actuar, de modo que puede despachar un ticket completo en un solo paso. **Aprobar todo** es el botón principal y coloreado del grupo: despachar un ticket con una sola decisión es el ritmo previsto de esta página, y los botones de cada propuesta son deliberadamente más discretos para que la vista se dirija primero al grupo. **Rechazar todo** abre un breve diálogo que confirma cuántas propuestas se rechazarán y ofrece una nota opcional para el registro de auditoría; **Descartar todo** abre un breve diálogo de confirmación que indica que no se enviará nada y que la evaluación del agente no se verá afectada.

Todas las propuestas pasan por esta cola hasta que se hayan capturado suficientes decisiones suyas para promover ese tipo de acción de **Preguntar primero** a **Automático** en la pestaña [Rendimiento y autonomía](agents-workspace.md) del agente; y para los tipos de acción que un solicitante puede ver, la promoción exige además una confirmación explícita de un administrador.

### Descartar o rechazar

Tanto Rechazar como Descartar impiden que una propuesta llegue al ticket, pero le transmiten al agente cosas muy distintas, así que la elección importa.

- **Rechace** cuando la propuesta sea errónea o de mala calidad: un borrador incorrecto, una clasificación equivocada, un cambio de estado inapropiado. El rechazo es una señal negativa de aprendizaje y evaluación: reduce la tasa de aceptación del agente y ralentiza su avance hacia actuar por su cuenta, que es justo lo que conviene cuando se equivoca.
- **Descarte** cuando la propuesta sea *correcta* pero no deba enviarse: el ticket es sensible, un compañero ya respondió, duplica algo que ya está en marcha. Como descartar es neutral, no recompensa ni penaliza al agente: su tasa de aceptación y su historial de autonomía quedan intactos.

Recurrir a Descartar cuando en realidad quiere decir «esto estaba mal» oculta un problema real de calidad, y rechazar una propuesta correcta pero no enviable perjudica injustamente a un agente que no hizo nada malo. Una propuesta descartada muestra un estado **Descartado** en gris y pasa a **Finalizadas recientemente**; el agente puede volver a proponer sobre el mismo ticket en un ciclo posterior, igual que tras un rechazo. **Descartado** no es lo mismo que **Caducado**: una propuesta caducada es una que nadie decidió antes de que expirara su ventana de aprobación, mientras que una propuesta descartada es una decisión deliberada que usted tomó.

---

## Cerrar y resolver tickets

Los títulos **Cerrar ticket** y **Resolver ticket** se muestran en rojo, porque ponen fin al ticket y el solicitante ve el cambio de inmediato. Ese título rojo es la única marca extra: no hay una insignia «terminal» aparte.

Aprobar una de estas acciones (por sí sola o como parte de un **Aprobar todo** en el que algún elemento cierre o resuelva el ticket) abre una confirmación con el nombre de la acción (**¿Aplicar Resolver ticket?**). Nombra el ticket, advierte de que el solicitante verá el cambio de inmediato, enumera todos los elementos de cierre en una aprobación masiva y le ofrece un campo de motivo para el registro. Usted confirma con el propio nombre de la acción (**Resolver ticket** o **Cerrar ticket**). Se trata de una fricción deliberada: las respuestas y notas rutinarias se aplican con un solo clic, pero cerrar o resolver un ticket siempre le pide detenerse y confirmar.

---

## Leer las respuestas redactadas: la nota de respaldo

Cuando un agente redacta una **Respuesta al solicitante** o una **Nota interna**, normalmente fundamenta ese borrador en sus bibliotecas de [Base de conocimiento](knowledge.md) y cita las fuentes que utilizó. Ocasionalmente verá la nota **Esta respuesta no está respaldada por su base de conocimiento.** en una propuesta de este tipo. Significa que el agente no pudo respaldar ese borrador concreto con fuentes citadas; por tanto, trátelo como una simple sugerencia y léalo con atención antes de aprobarlo, en lugar de confiar en él como verificado con fuentes.

**Detalles** abre el motivo técnico (para soporte), por ejemplo un error de síntesis o una filtración bloqueada de guía interna. No necesita esos códigos para decidir.

Lo importante que hay que saber es que **la ausencia de esta nota es el caso normal y saludable.** La mayoría de los borradores están fundamentados y no llevan ninguna leyenda. Y una respuesta puede, legítimamente, no tener fuentes citadas (un acuse de recibo administrativo o un escalado puramente interno no está pensado para redactarse a partir de su base de conocimiento) sin que ello active esta advertencia. Por eso, no interprete la ausencia de una nota de respaldo como un problema; significa que el borrador está debidamente fundamentado o que nunca debía estarlo. La nota solo aparece cuando el agente intentó fundamentar una respuesta y no pudo.

---

## Despejar una fila de Requiere atención

Antes, las filas de **Requiere atención** eran de solo lectura: veía que una propuesta había caducado o que una comprobación había fallado, pero no había nada que hacer al respecto salvo mirar cómo se quedaba ahí. Ahora cada fila lleva dos controles.

- **Repetir el análisis** pide al agente que vuelva a mirar ese ticket (o alerta) ahora mismo. Ejecuta exactamente la misma pasada que **Probar en un ticket** en la [pestaña Monitor](agents-workspace.md) del agente, así que lo que produzca vuelve a **Requiere tu decisión** como propuestas nuevas para que las revise. Su información sobre herramientas indica *Pedir al agente que lo vuelva a revisar.* y, mientras trabaja, *El agente lo está revisando de nuevo…* Es el primer movimiento correcto cuando el fallo fue pasajero: un corte de conexión, un ticket que cambió a mitad de camino, una propuesta que caducó antes de que nadie llegara a ella.
- **Dar por visto** despeja la fila definitivamente. Su información sobre herramientas indica *Marcar como visto y quitarlo de la lista definitivamente.* Úselo cuando haya entendido el fallo y lo haya resuelto (o haya decidido que no requiere ninguna acción): la fila desaparece de inmediato, no vuelve en otro dispositivo ni tras recargar, y la confirmación queda registrada en la cronología de [Actividad](agents-activity.md) como una **Decisión**, con quién la despejó y cuándo. Pasa a **Finalizadas recientemente** como cualquier otro elemento cerrado.

**Repetir el análisis** solo aparece donde repetir es realmente posible: la fila tiene que nombrar un ticket (o una alerta) que el agente todavía pueda alcanzar, y el propio agente tiene que seguir existiendo. Cuando no puede, se ofrece **Dar por visto** en solitario, que es el resultado honesto: no hay nada que reintentar, solo algo que cerrar. Las filas que dejó un agente eliminado desde entonces lo indican en lugar del botón: *El agente ya no existe*.

Cuando el atraso es grande (una tanda de propuestas que caducaron antes de que nadie las revisara, por ejemplo), despejar las filas una a una no es la solución. Use en su lugar **Dar todo por visto** en la cabecera de la sección. Le pide confirmar con el número real, que abarca todo el atraso y no solo las filas en pantalla (la sección indica *Se muestran los N más recientes de M* cuando hay más), y después despeja de una vez todos los elementos caducados o fallidos, de forma definitiva o no. Las propuestas que aún se están ejecutando quedan intactas, y el lote se registra una sola vez en la cronología de [Actividad](agents-activity.md) como una **Decisión**. Eliminar un agente hace lo mismo automáticamente con sus propios restos, de modo que un agente que retire no deja una pila detrás.

El emparejamiento es deliberado. **Repetir** es para «vuelve a intentarlo»; **Dar por visto** es para «lo he visto, está resuelto». Entre los dos, **Requiere atención** debería volver a quedarse vacía en lugar de crecer hasta convertirse en una lista que nadie lee.

---

## Rastrear una propuesta hasta su comprobación

Cada grupo de ticket y cada fila de atención lleva un botón **Traza**. Abre el diálogo **Traza técnica** sobre la cola: la página de debajo no se mueve, así que al cerrar el diálogo vuelve exactamente a donde estaba, con su posición de desplazamiento y, en el espacio de un agente, su pestaña actual intactas. Dentro puede seguir la comprobación completa que produjo la propuesta: qué examinó el agente, los pasos que siguió y cuánto tardó cada uno, y la evidencia que recopiló. Úselo siempre que un borrador o una actualización le resulte sorprendente y quiera conocer el razonamiento que hay detrás. Es el mismo diálogo que se describe en la página de [Actividad](agents-activity.md).

---

## Consejos

- Trabaje de arriba abajo: despeje **Requiere tu decisión** y luego despeje **Requiere atención** con **Repetir el análisis** o **Dar por visto**. **En curso** y **Finalizadas recientemente** no requieren nada de usted.
- Nada de lo que hay aquí ha llegado al solicitante hasta que usted lo apruebe. Leer un borrador, rastrearlo o dejarlo en la cola no cambia nada en el ticket.
- Rechace en lugar de ignorar. Una propuesta rechazada permanece en el registro de auditoría con su nota opcional, lo cual resulta mucho más útil después que una propuesta que simplemente caducó sin atender.
- Descarte, en lugar de rechazar, una propuesta que simplemente no va a enviar. Si un borrador es correcto pero no debe salir (un ticket sensible, un compañero que ya respondió), **Descartar** lo aparta sin penalizar al agente. Reserve **Rechazar** para las propuestas que de verdad estaban mal.
- La ausencia de la nota de respaldo es una buena noticia, no información que falte. Dedique su lectura más atenta a los borradores que *sí* la llevan.
- Si un cambio aprobado acaba en **Requiere atención**, la leyenda en rojo y el botón **Traza** le indican si fue el agente, una comprobación de seguridad o el sistema de tickets conectado lo que lo detuvo; corrija la causa subyacente y luego use **Repetir el análisis**, en lugar de volver a aprobar a ciegas.
- No dé algo por visto solo para que una cifra desaparezca. **Dar por visto** deja constancia de que una persona miró el fallo; una cola que despeja sin leer vale menos que una que deja intacta.
- La cola combinada en `/agents/approvals` es más rápida cuando ejecuta varios agentes; cambie a la pestaña **Aprobaciones** propia de un agente cuando quiera centrarse solo en ese.
