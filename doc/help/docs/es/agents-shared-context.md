# Agentes IA: contexto compartido

El contexto compartido es una pequeña biblioteca de guía de fondo reutilizable que usted escribe una vez y entrega a sus agentes. Un perfil es un conjunto con nombre de unas pocas líneas en lenguaje sencillo sobre su entorno de TI: cómo se gestiona su parque, qué deben y qué no deben decir sus agentes, las convenciones que sigue su centro de servicios. El mismo perfil puede adjuntarse a cualquier agente, donde moldea cómo ese agente interpreta los tickets entrantes y cómo redacta sus respuestas.

La idea es la coherencia sin repetición. En lugar de reenseñar a cada agente las mismas reglas internas, las mantiene en un solo perfil y apunta cada agente hacia él. Cambie el perfil una vez y todos los agentes que lo usan adoptan la nueva guía.

Hay algo que conviene dejar claro desde el principio, porque condiciona todo buen uso de esta función: el contexto compartido **no es una concesión de permisos ni una fuente citable**. Orienta el tono y la interpretación, pero sus líneas nunca se citan de vuelta a un solicitante y no conceden ningún acceso nuevo a datos. Los hechos que espera que un agente cite pertenecen a una [biblioteca de conocimiento](knowledge.md), no aquí.

---

## Dónde encontrarlo

- Espacio de trabajo: **Agentes IA > Contexto compartido**
- Ruta URL: `/agents/shared-context`
- Permisos:
  - `ai_agents:reader` le permite abrir la página y leer la lista de perfiles
  - `ai_agents:admin` (o `ai_settings:admin`) es necesario para crear, editar, archivar y restaurar perfiles
- Disponibilidad: toda la sección Agentes IA solo aparece cuando la IA está habilitada en la instancia y usted tiene `ai_agents:reader`

Sin un nivel de administrador sigue viendo la lista completa de perfiles, pero el botón **Nuevo perfil** y los controles Editar, Archivar y Restaurar de cada fila quedan ocultos: la página es de solo lectura para usted.

---

## Qué es un perfil

Un perfil agrupa tres cosas:

- Un **Nombre** que lo identifica; por ejemplo, `Default IT environment`.
- Una **Descripción** opcional para su propia referencia; por ejemplo, «Contexto de TI para toda la empresa, para agentes de helpdesk».
- Un conjunto de **Líneas de contexto**: una línea breve de guía de fondo por fila. Cada línea es una única instrucción o hecho sobre su entorno. Las líneas típicas se parecen a «La mayoría de los usuarios usan portátiles gestionados.» o «Nunca pedir contraseñas a los usuarios.»

Piense en las líneas como una guía permanente, no como una base de conocimiento. Las buenas líneas son el tipo de cosas que le diría a un técnico nuevo en su primer día: cómo está configurado el entorno, qué tono adoptar y las reglas tajantes de «nunca hagas esto». Influyen en las etapas donde el agente decide qué hacer y donde redacta la respuesta, sin que usted tenga que repetirlas para cada agente.

---

## La lista de Perfiles

La sección **Perfiles** enumera todos los perfiles de la instancia. Cada fila muestra:

- El **nombre** del perfil, con una etiqueta **Archivado** al lado cuando el perfil ya no está activo (las filas archivadas aparecen atenuadas).
- La **Descripción**, cuando se ha proporcionado una.
- Una línea de resumen: **{n} líneas** y, cuando esté disponible, **Actualizado el {time}**, para que pueda ver cuántas líneas de guía contiene el perfil y cuándo cambió por última vez.

Los administradores disponen de un botón **Nuevo perfil** en la cabecera de la página, de controles Editar y Archivar en cada fila activa, y de un control Restaurar en cada fila archivada. Un perfil archivado permanece en solo lectura hasta que lo restaure: no lleva control Editar.

---

## Crear y editar un perfil

**Nuevo perfil** (solo administradores) abre el cuadro de diálogo del editor. Editar un perfil activo abre el mismo cuadro de diálogo ya rellenado.

Debe rellenar:

- **Nombre**: obligatorio.
- **Descripción**: opcional, para su propia referencia.
- **Líneas de contexto**: una línea de guía de fondo por fila. Las filas en blanco se ignoran.

**Guardar** permanece desactivado hasta que haya un nombre y al menos una línea de contexto. Cuando edita un perfil existente, al guardar se actualiza en el sitio: cada agente que ya apunta a ese perfil empieza a funcionar de inmediato con las nuevas líneas, así que trate las ediciones de un perfil de amplio uso como un cambio que repercute en toda su flota de agentes.

---

## Archivar un perfil

Archivar sirve para retirar un perfil que ya no quiere que los agentes usen. Antes de que surta efecto, KANAP le advierte con claridad:

> «{name}» dejará de estar disponible para los agentes. Cualquier agente que lo esté usando funcionará sin contexto compartido hasta que lo apunte a otro perfil.

Esa es la consecuencia importante que hay que asimilar: archivar no traslada automáticamente los agentes afectados a un reemplazo. Cualquier agente que apuntaba al perfil archivado sigue funcionando, pero **sin** contexto compartido, hasta que entre en la configuración de ese agente y seleccione un perfil diferente. Si varios agentes comparten el perfil que va a archivar, planifique el cambio antes.

Los perfiles archivados permanecen en la lista, atenuados y con la etiqueta **Archivado**. Ya no pueden editarse ni adjuntarse a un agente hasta que los restaure.

---

## Restaurar un perfil

**Restaurar** está en cada fila archivada, en el mismo lugar que Archivar en una fila activa. Vuelve a poner el perfil en activo y registra el cambio. Los agentes que siguen apuntando al perfil recuperan sus líneas, y usted puede volver a editarlo o adjuntarlo. El perfil conserva su clave mientras está archivado, así que un perfil nuevo con la misma clave se rechaza. Restaure el perfil existente para volver a usar esa clave.

---

## Cómo se conecta un perfil con un agente

Los perfiles residen aquí, pero se activan por agente desde la pestaña **Configuración** de ese agente, en la sección **Objetivo** (consulte [Espacio del agente](agents-workspace.md)). Hasta que active **Usar contexto compartido**, eso es lo único que ve allí: el interruptor y una descripción de una línea. Al activarlo aparecen el selector de perfil, un acceso directo **+ Nuevo perfil** para crear uno al momento y una vista previa de las líneas del perfil seleccionado. Elija un perfil y el agente funciona con él; déjelo en **Ningún perfil seleccionado** y el agente funciona sin ningún contexto compartido.

Como el vínculo es una referencia, un mismo perfil puede respaldar muchos agentes a la vez, y actualizar el perfil los actualiza todos. Desvincular un agente (o archivar su perfil) simplemente elimina la guía para ese agente; no cambia nada respecto a los demás usuarios del perfil.

---

## La advertencia clave: guía, no una fuente

Tanto el contexto compartido como las [bibliotecas de conocimiento](knowledge.md) alimentan a un agente, pero cumplen funciones fundamentalmente distintas, y confundirlos es el error más común aquí.

- El **contexto compartido** moldea *cómo* se comporta un agente: su tono, sus suposiciones sobre su entorno, sus reglas tajantes de «nunca hagas esto». Sus líneas **nunca se citan** en una respuesta y no conceden al agente **ningún acceso nuevo a datos**. Orientan, no son evidencia.
- Las **bibliotecas de conocimiento** son *lo que* un agente puede citar. Sus resultados SÍ se citan en la respuesta redactada, de modo que el solicitante puede ver la fuente que respalda una respuesta.

La regla práctica: si quiere que el agente afirme un hecho y lo respalde (una política, un procedimiento, una configuración concreta), ponga ese hecho en una biblioteca de conocimiento para que pueda citarse. Reserve el contexto compartido para la guía permanente y las salvaguardas que no deberían aparecer como fuente citada. Y como una línea de contexto no es un permiso, escribir «el agente puede cerrar tickets de facturación» en un perfil no concede nada: los permisos reales y la automatización se rigen por tipo de acción en la propia configuración del agente y por el flujo de aprobación.

---

## Consejos

- Mantenga las líneas breves, en imperativo y con una sola idea cada una. «Nunca pedir contraseñas a los usuarios.» se lee y se aplica de forma más fiable que un párrafo que combina varias reglas.
- Empiece por sus reglas tajantes de «nunca»: vale la pena enunciar de forma clara y temprana las salvaguardas que más quiere que se respeten.
- Prefiera un número reducido de perfiles de amplia utilidad (por ejemplo, una base común para toda la empresa) en lugar de muchos casi duplicados. Cuantos menos perfiles, más fácil es mantenerlos al día, y las ediciones alcanzan a la vez a todos los agentes vinculados.
- No cuele aquí hechos citables. Todo lo que quiera que un solicitante vea citado con una fuente pertenece a una [biblioteca de conocimiento](knowledge.md).
- Antes de archivar un perfil compartido, anote qué agentes lo usan y reasígnelos primero: archivar los deja funcionando sin contexto compartido hasta que lo haga.
- **Restaurar** vuelve a poner en activo un perfil archivado. Los agentes que siguen apuntando a él usan sus líneas de nuevo.
- La **Descripción** es solo para usted y nunca llega al agente; úsela para anotar quién es responsable del perfil o para qué sirve, de modo que un compañero no tenga que adivinarlo más tarde.
