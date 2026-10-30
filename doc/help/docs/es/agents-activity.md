# Agentes IA: actividad

Actividad es el historial de solo lectura de todo lo que sus agentes han hecho y de todo lo que usted ha decidido sobre su trabajo: las comprobaciones que ejecutaron, las propuestas que redactaron, sus aprobaciones y rechazos, los cambios que realmente se enviaron a un ticket, los límites de seguridad que se activaron, las pausas, los cambios de configuración y los errores. Nada en esta página cambia un ticket ni un agente: existe para que pueda responder «qué pasó, cuándo y por qué» a posteriori, y para darle un registro documentado cuando un solicitante o un técnico se lo pida. La misma cronología aparece, ya filtrada a un solo agente, al final de la [pestaña Monitor](agents-workspace.md) de ese agente; esta página es la versión completa de todos los agentes.

## Dónde encontrarlo

- Espacio de trabajo: **Agentes IA**
- Ruta: **Agentes IA → Actividad**
- Ruta URL: `/agents/activity`
- Permiso: `ai_agents:reader` (solo consulta: cualquiera que pueda abrir Agentes IA puede leer la cronología)
- Requiere que la IA esté habilitada en la instancia. Esta página es de solo lectura: aquí no se aprueba, rechaza ni envía nada. Para actuar sobre una propuesta, use [Aprobaciones](agents-approvals.md).

---

## Filtros

La cronología muestra primero los eventos más recientes. Dos controles la acotan:

- **Número de ticket**: escriba un número de ticket y pulse **Buscar** (o Intro) para ver solo los eventos vinculados a ese único ticket. Es la forma más rápida de reconstruir la historia completa de un solo ticket: cada comprobación, borrador, decisión y cambio, en orden. Borre el campo y vuelva a buscar para regresar al listado completo.
- **Chips de tipo**: siete conmutadores en la parte superior: **Propuesta**, **Decisión**, **Ejecución**, **Configuración**, **Comprobaciones**, **Pausa** y **Error**. Cada uno es un interruptor de encendido y apagado, no una elección única: un chip relleno está incluido, uno con solo el contorno está excluido, y puede combinar tantos como quiera.

**De forma predeterminada, todas las categorías están activadas salvo Comprobaciones.** Ese valor predeterminado es deliberado. Un agente en vigilancia escribe una entrada de comprobación cada pocos minutos, encuentre algo o no, y dejarlas activadas hace que esas filas sepulten las entradas que realmente lee. Active **Comprobaciones** cuando quiera confirmar que un agente sigue vivo, o cuando esté investigando por qué recogió (o no recogió) algo.

Si desactiva todos los chips no queda nada que mostrar, y la cronología lo dice: *Elige al menos un tipo de actividad para ver el historial.*

La búsqueda por ticket y los chips de tipo se combinan, de modo que puede ver, por ejemplo, solo los errores del ticket #482. Su selección queda en la dirección de la página, así que una vista filtrada es un enlace que puede enviar a un compañero.

---

## Leer una entrada de la cronología

Cada entrada es una cosa que ocurrió y lleva suficiente contexto para entenderla de un vistazo:

- Un **chip de tipo**: a cuál de las siete categorías anteriores pertenece el evento.
- Un **chip de tipo de acción** (cuando el evento trata de un tipo concreto de trabajo sobre el ticket): **Nota interna**, **Respuesta al solicitante**, **Actualización de clasificación**, **Actualización de estado**, **Asignación** u **Observadores**.
- Un **punto de estado** con una etiqueta en lenguaje claro (por ejemplo «Esperando aprobación», «Hecho», «Rechazado», «Descartado», «Requiere atención») que describe en qué situación se encuentra ese elemento.
- El **nombre del agente** y el **ticket** al que se refiere (mostrado como `#N`).
- Un **título de evento**: por ejemplo, «Propuesta creada» o «Comprobación de tickets: 3 tickets nuevos».
- Una **vista previa de una línea** del contenido (la primera línea de un mensaje redactado, un cambio de campo o el motivo), de modo que a menudo no necesita expandir nada.
- Una **marca de tiempo**, además de **Mostrar detalles** y, cuando hay una comprobación detrás del evento, **Traza**.

Los títulos se adaptan al tipo de agente: lo que en un agente helpdesk se lee **Comprobación de tickets**, en uno de supervisión se lee **Comprobación de alertas**, de modo que una flota mixta sigue siendo legible.

### Qué significan los eventos

El catálogo cubre todo el ciclo de vida del trabajo de los agentes. Agrupado por el chip de tipo al que corresponde:

- **Propuesta**: el agente redactó algo para revisión: se creó una respuesta, una nota o una actualización de ticket que espera una decisión.
- **Decisión**: una propuesta fue **aprobada**, **rechazada** o **descartada** (apartada sin penalizar al agente), o un elemento de atención se **dio por visto**. Las aprobaciones y los rechazos también pueden ser automáticos una vez que ese tipo de acción funciona por su cuenta; un descarte y un «dar por visto» son siempre una decisión deliberada de una persona.
- **Ejecución**: un cambio se envió realmente al ticket, o una ejecución **falló**. Las ejecuciones automáticas y sus fallos también aparecen aquí.
- **Configuración**: alguien cambió el funcionamiento de un agente: se actualizó su **configuración de vigilancia** o su **configuración** general, un tipo de acción se pasó a **automático** o se **desactivó** (o se **degradó** para volver a preguntar primero), o se **eliminó un agente**. Los límites de seguridad que entran en juego (**Límite diario alcanzado** y **Límite de seguridad por ejecución alcanzado**) también se archivan aquí en lugar de bajo Error, porque un tope haciendo su trabajo es una parada deliberada, no una avería.
- **Comprobaciones**: el agente buscó trabajo. Una entrada por comprobación, encuentre algo o no. Vea más abajo.
- **Pausa**: se **activó** o **levantó** una **pausa de emergencia**, o se **pausó la vigilancia de tickets** porque había una pausa en vigor.
- **Error**: algo salió mal que usted debería conocer: un solo **ticket no pudo procesarse**, una **ejecución falló**, la **vigilancia de tickets falló** o una ejecución automática falló.

No necesita memorizarlos: los títulos de los eventos están escritos en lenguaje claro y los chips de tipo le permiten filtrar hasta los que le interesan.

### Entradas de comprobación

Una entrada de comprobación le dice qué encontró el agente, en su propio título, sin que tenga que expandir nada:

- **Comprobación de tickets: sin tickets nuevos**: miró y no había nada que hacer. Así se ve un agente sano y tranquilo.
- **Comprobación de tickets: 3 tickets nuevos**: se recogieron tres tickets para trabajar en ellos.
- **Comprobación de tickets: 3 tickets nuevos, 2 ya vistos, 1 error**: lo mismo, más tickets que ya había gestionado y un problema con el que se topó.
- **Comprobación de tickets: Sin vigilancia** / **En pausa** / **Omitida** / **Fallida**: la comprobación no hizo su trabajo habitual, y el motivo sigue a continuación cuando lo hay.

**Mostrar detalles** desglosa esa misma comprobación en cuatro cifras (**Vistos**, **En cola**, **Ya vistos**, **Procesados**) más el motivo y cualquier mensaje de error. Esa es la forma honesta de responder a «¿por qué el agente no recogió el ticket #482?»: si **Vistos** es alto pero **En cola** es cero, el ticket se miró y su segmentación lo descartó; si **Vistos** es cero, el agente nunca llegó a verlo.

---

## Mostrar detalles

**Mostrar detalles** expande una entrada mostrando toda la evidencia que hay detrás. Según el evento, puede ver:

- El **desglose de la comprobación** descrito más arriba.
- El **Mensaje propuesto** completo: el texto íntegro que redactó el agente, no solo la vista previa de una línea.
- **Cambios de campo**, escritos como «Campo: de → a» (por ejemplo «Estado: Asignado → Pendiente»), de modo que un cambio de clasificación, estado, asignación u observador sea legible sin abrir el ticket.
- El **Motivo**: la breve justificación del agente para la propuesta.
- La **Nota del revisor**: la nota registrada cuando se decidió la propuesta.
- Una línea **«{n} fuentes citadas»**: cuántos de los resultados de su [biblioteca de conocimiento](knowledge.md) respaldaron la respuesta redactada. Es la señal honesta de si la respuesta se apoya en sus propias fuentes; una respuesta con fuentes citadas es una que el agente podría defender. Su ausencia en una respuesta administrativa o de procedimiento es normal y no significa que algo haya fallado; para ver cómo se refleja esto durante la revisión, consulte [Aprobaciones](agents-approvals.md).

---

## Cargar más

La cronología carga las 50 entradas coincidentes más recientes y le indica dónde se encuentra: **{n} de {total} mostradas**. **Cargar más** añade las 50 siguientes sin alterar lo que ya ha leído ni los filtros que ha definido. No hay números de página en los que perder su sitio: siga pulsando hasta llegar a lo que busca.

El contador merece leerse por sí solo. «50 de 1.284 mostradas» es una señal de que probablemente convenga acotar los filtros en lugar de seguir haciendo clic.

Las entradas no se conservan para siempre. Cada agente guarda su propio historial durante el tiempo que indique su ajuste **Conservar el historial de actividad (días)** (30 días de forma predeterminada), y todo lo más antiguo se elimina automáticamente durante la noche. Si necesita conservar un registro más allá de ese plazo, cójalo mientras está aquí. El trabajo que usted todavía tiene que decidir nunca se purga.

---

## Traza técnica

El botón **Traza** abre el diálogo **Traza técnica** sobre la página: no se navega a ningún sitio, así que al cerrarlo vuelve exactamente a donde estaba. Es una vista de diagnóstico opcional pensada para administradores que investigan una comprobación concreta; nunca la necesita para la revisión diaria, y todo lo que un solicitante o técnico querría ya está en **Mostrar detalles**.

Reconstruye cómo se desarrolló una única comprobación:

- Cuándo **se inició** y **finalizó** la ejecución, y cuánto **duró** en total.
- Los **Pasos** numerados que siguió el agente, cada uno con su propio estado y su duración.
- Las **Llamadas a herramientas** que realizó, con sus duraciones: útil cuando una comprobación fue lenta o superó el tiempo de espera.
- Las **Fuentes** que recopiló, mostradas como un breve resumen más el tipo de origen del que proceden.

Esos tiempos son el sentido del diálogo: una comprobación que tardó cuatro minutos tiene un paso lento dentro, y aquí es donde lo encuentra.

Un conmutador **Mostrar traza sin procesar** revela el registro subyacente legible por máquina para el raro caso en que necesite el detalle exacto; déjelo contraído en caso contrario.

El mismo botón **Traza** aparece en [Aprobaciones](agents-approvals.md) y en la pestaña **Monitor** de un agente, y abre este mismo diálogo en el sitio, que es la forma habitual de llegar aquí durante la revisión.

---

## Consejos

- Buscar por **número de ticket** es la forma más rápida de entregar a alguien la historia completa y ordenada de un ticket (comprobación, propuesta, decisión y qué se envió) sin tener que navegar por el propio ticket.
- **Active Comprobaciones cuando un agente parezca inactivo, y vuelva a desactivarlo después.** Es la diferencia entre «el agente está roto» y «el agente está vigilando y no hay nada que hacer»; pero es ruidoso, y por eso empieza desactivado.
- Recurra al filtro **Ejecución** para ver solo lo que realmente salió al exterior. Las propuestas y las decisiones son intenciones; las ejecuciones son los cambios que un solicitante o técnico puede ver.
- Una entrada de **Límite diario alcanzado** es el sistema funcionando según lo previsto, no un fallo. Si un agente se quedó en silencio el resto del día, normalmente es por esto; suba sus límites diarios en la [Configuración](agents-workspace.md) del agente si el tope es demasiado estricto para su volumen, y consulte allí las cifras de **Hoy** antes de elegir un número nuevo.
- Use **Traza** solo cuando esté investigando una comprobación lenta o fallida; para «qué dijo y por qué lo aprobamos», **Mostrar detalles** ya tiene la respuesta.
- Esta página nunca cambia nada, por lo que es seguro dar acceso de solo lectura (`ai_agents:reader`) a cualquiera que necesite auditar el comportamiento de los agentes sin poder actuar sobre él.
