# Agentes IA — Vista general

Los agentes IA son ayudantes automatizados que vigilan su centro de servicios conectado y hacen la primera pasada en los tickets por usted: redactan una respuesta al solicitante, añaden una nota interna o proponen una actualización de la clasificación, el estado, la asignación o los participantes de un ticket, o un cierre/resolución. Esta página es el panel de la flota: el único lugar donde ver todos los agentes de un vistazo, cuánto trabajo espera su decisión, cómo rinde la flota, cuánto le está costando y dónde accionar el freno de emergencia si algo va mal.

La idea importante que hay que recordar: el agente propone, usted dispone. Todo lo que un agente quiere enviar a un solicitante o escribir en un ticket se propone primero para su aprobación, y los límites de seguridad estrictos, los presupuestos, las comprobaciones de frescura y las pausas se aplican siempre, incluso después de que deje que un agente actúe por su cuenta. La configuración diaria de un solo agente se encuentra en su [Espacio del agente](agents-workspace.md); esta página es donde supervisa toda la flota.

## Dónde encontrarlo

- Espacio de trabajo: **Agentes IA**
- Ruta: **Agentes IA → Vista general**
- Ruta URL: `/agents`
- Permiso: `ai_agents:reader` para ver la sección, `ai_agents:contributor` para actuar sobre el trabajo de un agente. Los controles de creación, pausa de emergencia y eliminación descritos a continuación requieren el nivel de administrador de Agentes IA (`ai_agents:admin`); el administrador de Configuración de IA (`ai_settings:admin`) también los desbloquea.
- Indicador de funcionalidad: toda la sección de Agentes IA requiere que la IA esté habilitada en la instancia. Si la IA está desactivada, la sección no está disponible.

---

## Conceptos, en un minuto

Algunas ideas se repiten en todas las páginas de esta sección. Apréndalas una vez aquí.

- **Qué vigila un agente.** Cada agente apunta a su sistema de tickets conectado (hoy es GLPI, configurado en **Administración → Integraciones** — consulte [la conexión con GLPI](integrations.md)). En las pantallas del agente se le denomina de forma genérica el sistema de tickets conectado o la conexión. Un agente de supervisión vigila en su lugar una herramienta de supervisión conectada y sus alertas.
- **Sobre qué actúa un agente.** Los tickets. El trabajo que un agente puede proponer es una respuesta al solicitante, una nota interna, un cambio de clasificación, un cambio de estado (incluido cierre/resolución), un cambio de asignación y añadir o quitar participantes.
- **Preguntar primero vs. automático.** Todo tipo de acción empieza en **Preguntar primero**: el agente redacta el cambio y este permanece en su cola de aprobaciones hasta que lo aprueba, lo rechaza o lo descarta. Una vez que un agente ha acumulado suficiente historial en un tipo de acción concreto, un administrador puede promover solo ese tipo de acción a **Automático** para que se aplique sin esperar. La promoción es por tipo de acción, y los límites de seguridad de abajo nunca dejan de aplicarse.
- **Modos de funcionamiento.** Cada agente está en uno de tres modos, que se definen desde la barra de acciones de su [espacio](agents-workspace.md): **Apagado** (no se ejecuta nada en absoluto), **Solo manual** (solo se ejecuta cuando alguien se lo pide: una comprobación que usted lanza o una prueba sobre un único ticket) y **Vigilancia** (comprueba por su cuenta con la frecuencia que usted defina, además de todo lo que hace el modo manual). Los agentes nuevos siempre empiezan sin iniciar, y **Solo manual** es el modo en el que conviene quedarse mientras lo ajusta.
- **La seguridad siempre se aplica.** Los topes por comprobación, los presupuestos por ejecución y diarios, las comprobaciones de frescura (qué hacer si el ticket cambió después de que el agente redactara su trabajo) y las pausas se aplican tanto si un tipo de acción es preguntar primero como automático. Siempre puede detenerlo todo: consulte [Pausa de emergencia](#pausa-de-emergencia) más abajo.

Hoy hay dos tipos de agente utilizables de principio a fin: el agente **Helpdesk**, que es del que trata el resto de esta sección, y el agente de **Supervisión de infraestructura (SRE)**, que lee las alertas de una herramienta de supervisión conectada y prepara notas de diagnóstico para su revisión. Otros tipos pueden aparecer en la lista de tipos de agente, pero no están listos para ejecutarse.

Otras dos superficies de IA se confunden fácilmente con los agentes, pero son cosas distintas: [Plaid](ai-assistant.md) es el asistente de chat interactivo que maneja usted mismo, y [Configuración de Plaid](ai-settings.md) configura ese asistente. Los modelos en sí se gestionan en la página [Modelos IA](ai-models.md), donde se define el modelo de cada agente —y el predeterminado de la organización al que recurre—.

---

## El panel de la flota

!!! note "Agentes a la espera de una confirmación"
    En el servicio alojado, un agente sin modelo propio funciona con el modelo incluido de KANAP cuando un administrador ha confirmado su proveedor. Hasta entonces, un aviso en la parte superior de la página dice *Los agentes que usan el modelo incluido de KANAP están en pausa hasta que un administrador lo confirme en Administración > Plaid.* Los administradores encuentran en él un botón **Abrir la configuración de Plaid**. Los agentes fijados a un modelo que usted añadió siguen funcionando. Consulte [Confirmar el modelo incluido de KANAP](ai-settings.md#confirmar-el-modelo-incluido-de-kanap).

En la parte superior hay cinco cifras agrupadas. Describen toda la flota, no un agente concreto:

- **Aprobaciones pendientes** — cuántas propuestas de toda la flota esperan ahora mismo una decisión humana. Es la misma cifra que alimenta el indicador de la barra lateral.
- **Acciones hoy** — cuántas propuestas se ejecutaron realmente hoy (aprobadas y aplicadas, o aplicadas automáticamente).
- **Aceptación** — la proporción de propuestas decididas que se aprobaron en lugar de rechazarse. Muestra **Datos insuficientes** hasta que haya suficiente historial de decisiones para ser significativa.
- **Descartadas** — la proporción de propuestas revisadas por una persona que se apartaron en lugar de aprobarse o rechazarse. Un descarte no penaliza al agente; por eso un valor persistentemente alto suele apuntar a un problema de segmentación —el agente está recogiendo tickets que no debería gestionar— más que a una mala calidad de las respuestas; corríjalo en la segmentación del agente. También muestra **Datos insuficientes** hasta que haya suficiente historial de revisión.
- **Coste — hoy / 7 días** — lo que sus agentes cuestan realmente en gasto de IA, en EUR: el total de hoy y el de los siete días anteriores (hoy incluido). Cubre **todos** los agentes del espacio de trabajo, tanto de servicio como de supervisión, por lo que es la cifra que hay que consultar cuando quiere saber lo que le cuesta la flota, sin más. Las cifras económicas por agente —coste por ticket, topes por ejecución y diarios— están en las pestañas **Rendimiento y autonomía** y **Configuración** de cada agente.

Considere estas cifras como el estado de salud de la flota, no como la contabilidad por agente. Para las cifras de un solo agente, abra su espacio y use **Rendimiento y autonomía**.

---

## Las tarjetas de la flota

Debajo del panel, la sección **Flota** muestra una tarjeta por agente. Cada tarjeta lleva el **nombre** y la **descripción** del agente (o **Sin descripción.** si no se definió ninguna), su estado, una fila de fichas y —para un agente de servicio— una franja de cifras en vivo.

**El estado** (arriba a la derecha de la tarjeta) le indica lo que el agente está haciendo ahora mismo, como un punto de color y una etiqueta. El color es la lectura rápida: verde significa que el agente está trabajando; azul, que solo se ejecuta cuando se lo piden; rojo, que está retenido; gris, que no se está ejecutando en absoluto.

| Estado | Color | Qué significa |
| --- | --- | --- |
| **Vigilancia — con aprobación** | Verde | Vigila por su cuenta, pero todo tipo de acción sigue dirigiéndose a usted para su aprobación. |
| **Vigilancia — parcialmente automática** | Verde | Vigila, con al menos un tipo de acción promovido para ejecutarse sin aprobación. El resto sigue preguntando primero. |
| **Prueba** | Azul | Encendido, pero sin vigilar: el modo **Solo manual**. Se ejecuta cuando usted lo comprueba o lo prueba manualmente, nunca por su cuenta. |
| **Pausado** | Rojo | Retenido por una pausa de emergencia (de todo el espacio de trabajo o solo de este agente). Las comprobaciones y las escrituras pendientes quedan congeladas hasta que se levanta la pausa. |
| **No iniciado** | Gris | Creado pero nunca ejecutado. Aquí es donde empieza cada agente nuevo. |
| **Desactivado** | Gris | No se ejecuta nada, ni siquiera una comprobación manual. |
| **Archivado** | Gris | Retirado del uso activo, conservando su configuración e historial. |

**Las fichas** resumen el agente de un vistazo:

- **Tipo** — el tipo de agente, p. ej. **Helpdesk** o **SRE**.
- **Entorno** — a qué entorno de conexión apunta: **Producción**, **Preproducción**, **Entorno de pruebas**, **Laboratorio** o **Simulación**. Esta es su señal de si el agente está tocando tickets reales.
- **N pendientes** — propuestas de este agente que esperan su decisión (resaltadas cuando son más de cero).
- **N fallidos** — trabajo de este agente que se atascó y necesita revisión (resaltado cuando es más de cero). Aparecen como **Requiere atención** en la cola diaria.
- **N automático(s)** o **Preguntar primero** — bien el número de tipos de acción promovidos a automático, bien **Preguntar primero** cuando no se ha promovido nada.

**En un agente de servicio**, aparecen cuatro cifras en la tarjeta:

- **Última comprobación** — el resultado de la comprobación más reciente.
- **Alcance** — **Todos los tickets** o **Tickets filtrados**, según si la segmentación del agente restringe lo que mira.
- **Ejecuciones hoy** — cuántas veces se ha ejecutado hasta ahora hoy.
- **Actualizado** — la hora de su última comprobación.

Al hacer clic en cualquier parte de una tarjeta se abre el [espacio](agents-workspace.md) de ese agente, donde lo maneja, lo monitoriza, revisa sus aprobaciones, consulta su rendimiento y cambia su configuración.

Los administradores también ven un pequeño icono de papelera en cada tarjeta: elimina el agente junto con su cola y su historial de vigilancia (los tickets de su sistema de tickets nunca se ven afectados, y esto no se puede deshacer).

---

## Crear un agente

Los administradores disponen de un botón **Nuevo agente** en la parte superior derecha de la página. Abre un diálogo:

- **Tipo de agente** — **Helpdesk** o **Supervisión de infraestructura (SRE)**. El nombre y la descripción vienen rellenados con valores razonables, que se sustituyen si cambia de tipo y no los ha editado usted mismo.
- **Nombre** y **Descripción**.
- **Conexión** — el sistema de tickets (**GLPI**) para un agente helpdesk, o la **Herramienta de supervisión** para uno SRE. **Gestionar integraciones** lleva a **Administración → Integraciones** si la conexión aún no está configurada. Si no hay ninguna herramienta de supervisión conectada, el agente se crea igualmente: simplemente permanece inactivo hasta que la haya.

La vigilancia, el filtrado y los límites no se recogen aquí. **Crear** abre la pestaña **Configuración** del nuevo agente en su [espacio](agents-workspace.md), donde termina esa configuración. El agente siempre se crea como **No iniciado**, así que no se ejecuta nada hasta que fije su modo de ejecución. El camino recomendado es terminar Configuración, poner el agente en **Solo manual** y probarlo con tickets reales (o alertas), y pasarlo a **Vigilancia** una vez que confíe en su salida.

---

## Pausa de emergencia

Si algo parece ir mal en general —respuestas inesperadas que se envían, una mala configuración, un incidente—, los administradores pueden congelarlo todo de una vez con **Pausar todos los agentes**, en la cabecera de la sección **Flota**. Se le pide un motivo (que pasa a formar parte del registro de auditoría), y a continuación un banner persistente muestra **Pausa de emergencia activa: {reason}** en toda la sección. Mientras está activa, las comprobaciones de todos los agentes y cualquier escritura pendiente quedan retenidas para todo el espacio de trabajo. Haga clic en **Levantar pausa** en el banner para reanudar.

Este freno de todo el espacio de trabajo es deliberadamente contundente. Para congelar un único agente que se comporta mal sin tocar el resto de la flota, use en su lugar **Pausar agente** en la barra de acciones del espacio de ese agente: consulte el [Espacio del agente](agents-workspace.md). Y recuerde la diferencia entre pausar y desactivar: **Apagado** simplemente detiene al agente, mientras que una pausa congela además el trabajo que ya está en curso y deja constancia del motivo.

---

## Trabajar con la flota en el día a día

La vista general es donde usted supervisa; dos páginas dedicadas son donde ocurre el trabajo diario real:

- [Aprobaciones](agents-approvals.md) es la cola de revisión: respuestas, notas y actualizaciones de tickets propuestas que esperan su decisión, agrupadas por ticket.
- [Actividad](agents-activity.md) es la cronología de auditoría de solo lectura de cada comprobación, propuesta, decisión, ejecución, pausa y error.

La guía de fondo reutilizable que quiere que varios agentes compartan vive en la página [Contexto compartido](agents-shared-context.md). Tenga en cuenta que el contexto compartido determina cómo interpretan los agentes los tickets, pero nunca se cita en una respuesta: las fuentes que un agente realmente cita provienen de sus [Bibliotecas de conocimiento](knowledge.md).

---

## Consejos

- **Lea la ficha de entorno antes de confiar en una cifra.** Un agente de **Producción** está tocando tickets reales y solicitantes reales; **Entorno de pruebas**, **Laboratorio** y **Simulación** son seguros para experimentar. Cuando ponga en marcha un agente nuevo, manténgalo apartado de los tickets de producción hasta que su salida se vea correcta.
- **La cifra de coste es la factura honesta de la flota.** Cubre todos los agentes que tenga en marcha. Si sube más rápido de lo que esperaba, la causa habitual es un agente que comprueba mucho más a menudo de lo que su cola justifica: mire **Comprobar cada (minutos)** antes que ninguna otra cosa.
- **Un recuento creciente de fallidos es su alerta temprana.** La ficha **N fallidos** muestra el trabajo que se atascó. Abra el agente y despeje los elementos **Requiere atención** antes de que se acumulen: normalmente apuntan a un problema de conexión o a un ticket que cambió bajo el agente.
- **Solo manual antes que Vigilancia.** Un agente creado desde **Nuevo agente** está intencionadamente en **No iniciado**. Ejecútelo primero manualmente sobre un puñado de tickets representativos desde su espacio; páselo a **Vigilancia** solo cuando esté satisfecho con lo que redacta.
- **El modo automático se gana y es reversible.** Promover un tipo de acción a automático no elimina ninguna barrera de protección: los presupuestos diarios y por ejecución, las comprobaciones de frescura y las pausas siguen aplicándose, un tipo de acción que tiene una mala hora espera su aprobación, y uno cuya aceptación cae por debajo de la mitad vuelve a preguntar primero (véase [La escala de autonomía](agents-workspace.md#la-escala-de-autonomia)). Los tipos de acción que el solicitante puede ver piden además una confirmación explícita.
- **Prefiera la pausa por agente.** Recurra a **Pausar todos los agentes** solo ante un problema genuino de toda la flota. Para un único agente ruidoso, la pausa de su propio espacio mantiene el resto de su flota funcionando.
