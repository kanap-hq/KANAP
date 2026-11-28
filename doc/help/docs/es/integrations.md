# Integraciones

Use la página Integraciones para conectar Kadratis con herramientas de terceros que complementan los datos que ya gestiona en la plataforma. La conexión principal es su centro de servicios **GLPI**. Esa única conexión cumple dos propósitos a la vez: permite que **Kad** (el chat interactivo) encuentre e importe tickets en Kadratis como tareas, y alimenta a los **Agentes IA** que vigilan su centro de servicios y proponen o realizan el trabajo sobre los tickets. La página también alberga la conexión **Inventario de Netbox**, que no tiene nada que ver con la IA. Con el tiempo se irán añadiendo aquí nuevas integraciones.

## Dónde encontrarlo

- Espacio de trabajo: **Administración**
- Ruta: **Administración → Integraciones**
- Ruta: `/admin/integrations`
- Permiso: `ai_settings:admin` o `infrastructure:admin`. Cada tarjeta tiene su propio requisito: las conexiones de GLPI y de supervisión necesitan `ai_settings:admin`, la conexión de Netbox necesita `infrastructure:admin`. Solo ve las tarjetas que tiene permiso para configurar.
- Indicador de funcionalidad: las tarjetas de GLPI y de supervisión comparten la misma superficie `ai_settings` que la página de configuración de Kad. Cuando esa superficie está desactivada, quedan ocultas. La tarjeta de Netbox no tiene indicador de funcionalidad y está disponible tanto en la nube como en la edición on-premise.

Las credenciales que introduce aquí son las que usan tanto Kad como cualquier agente IA para llegar a GLPI: la conexión se configura una sola vez, en un único lugar.

---

## Integración GLPI

[GLPI](https://glpi-project.org/) es una popular herramienta de código abierto para la gestión de servicios IT. Esta página almacena las credenciales que Kadratis usa para llegar a su instancia de GLPI. Lo que Kadratis hace con esa conexión depende de la funcionalidad a la que la dirija.

### Cómo funciona

La conexión alimenta dos flujos de trabajo que se habilitan y gobiernan por separado.

**1. Importación desde el chat de Kad (vista previa y aprobación).** Un usuario final pide a Kad algo como «importar los tickets GLPI abiertos asignados a mi equipo». Kad consulta GLPI mediante las credenciales que configura aquí, devuelve los tickets candidatos como vista previa en el chat y crea una tarea por cada ticket solo después de que el usuario revise la vista previa y haga clic en **Aprobar**. Nada se escribe en Kadratis sin esa aprobación explícita, de modo que los administradores pueden entregar esto a los usuarios finales sin preocuparse por una rotación silenciosa de datos.

**2. Agentes IA que vigilan el centro de servicios.** Una vez conectado GLPI aquí, un administrador puede dirigir hacia él un agente **Helpdesk** y dejar que el agente vigile los tickets nuevos y actualizados, y luego proponga el trabajo: respuestas al solicitante, notas internas y actualizaciones de clasificación, estado, asignación, observadores y cierre/resolución. Añadir un observador deja al solicitante igual. Cada cambio del agente se sigue proponiendo para su aprobación antes de enviarse a GLPI, y siempre se aplican límites de seguridad estrictos, presupuestos y comprobaciones de actualidad. Esta página no configura ningún comportamiento del agente; solo proporciona la conexión que los agentes usan.

### Usado por los Agentes IA

Después de guardar aquí una conexión que funcione, un administrador configura los agentes en la sección Agentes IA; consulte [Agentes IA: vista general](agents-overview.md). Desde **Nuevo agente** o desde la **Configuración** de un agente existente, elige esta conexión GLPI como el centro de servicios que el agente vigila. El agente lee y redacta borradores sobre ella, pero de forma predeterminada nunca envía nada por su cuenta: cada respuesta, nota o cambio de estado propuesto pasa primero a la cola de revisión.

### Requisitos previos

- **El chat de Kad debe estar habilitado** en su espacio de trabajo para el flujo de importación desde el chat. La página muestra un tooltip informativo junto al título de la sección para recordarle esta dependencia.
- **Los Agentes IA deben estar habilitados** en la instancia para el flujo de trabajo de agentes, y el agente debe ser configurado por alguien con el nivel Administrador de Agentes IA (`ai_agents:admin`).
- Una instancia de GLPI accesible desde Kadratis por HTTPS.
- Un **Token de usuario** para una cuenta de usuario de GLPI que tenga acceso de lectura a los tickets que desea exponer.
- Un **Token de aplicación** opcional si su instancia de GLPI requiere autenticación a nivel de aplicación.
- **Derechos del perfil para las funciones de agente**: el perfil de GLPI de esa cuenta necesita acceso de lectura a las categorías ITIL y a las entidades, que los agentes usan para sus filtros de segmentación y para la clasificación, además de acceso de lectura a los grupos y a los usuarios para que un agente pueda encaminar un ticket a un grupo de técnicos o a un técnico concreto. El encaminamiento también exige el derecho de asignar tickets. Por último, conceda derechos de actualización sobre los tickets para las acciones que permita realizar al agente: seguimientos, clasificación, estado y asignación.

La integración se configura espacio de trabajo por espacio de trabajo; las credenciales a continuación están limitadas a su espacio de trabajo y nunca salen de él.

### Campos

- **Habilitar importación de tickets GLPI**: conmutador maestro de la conexión. Cuando está desactivado, Kadratis no intentará consultar GLPI aunque las credenciales estén establecidas: ni las importaciones de Kad ni las comprobaciones de los agentes llegarán a su centro de servicios.
- **URL de GLPI**: la dirección con la que abre GLPI, por ejemplo `https://glpi.example.com`. La API de GLPI debe estar activada: en GLPI, **Configuración > General > API**, **Activar Rest API**.
- **Token de usuario**: el token API personal de la cuenta GLPI que Kadratis usará. En GLPI, abra sus preferencias (su nombre arriba a la derecha), luego **Claves de acceso remoto**, y copie el **API token**. Si está vacío, marque **Regenerar** y guarde.
- **Token de aplicación**: opcional. En GLPI, **Configuración > General > API**, abra en **Clientes API** el cliente a través del cual se conecta Kadratis y copie su token de aplicación. Deje el campo vacío si el cliente no tiene ninguno.

El icono de información junto a cada campo indica dónde encontrar su valor. Un token guardado no se vuelve a mostrar: el campo muestra puntos, con **Reemplazar** al lado para introducir uno nuevo. Una URL nueva vacía los tokens guardados: el campo del token de usuario lo vuelve a pedir, y el campo del token de aplicación indica que el token guardado no se envía a la nueva dirección. Vuelva a introducir el token de aplicación para conservarlo.

### Acciones

- **Probar**: ejecuta una ida y vuelta autenticada contra GLPI con los valores de la tarjeta, guardados o no. Disponible en cuanto la URL y el token de usuario están introducidos. La línea de estado arriba a la derecha de la tarjeta indica el resultado: «Última prueba correcta el …» con el tiempo de respuesta, o el motivo del fallo.
- **Guardar**: disponible en cuanto algo cambia. Los tokens introducidos reemplazan los guardados; un token que se deja en puntos se conserva.

La línea de estado conserva la última prueba de los valores guardados: vuelve a mostrarse cuando regresa a la página, con el tiempo de respuesta o el motivo del fallo. La prueba de valores sin guardar se muestra hasta que sale de la página. Sin prueba, la línea de estado indica **Guardado, aún sin probar** o **Nunca probado**, y **Cambios sin guardar** mientras la tarjeta tenga cambios. Salir de la página con cambios en una tarjeta pide primero una confirmación.

### Almacenamiento de secretos

Si su instancia de Kadratis no tiene un almacén de secretos configurado, una línea bajo los campos indica que los tokens no se pueden guardar. Configure el almacenamiento de secretos a nivel de instancia antes de confiar en esta integración en producción.

---

## Monitorización: PRTG

[PRTG](https://www.paessler.com/prtg) es una herramienta de monitorización de red e infraestructura. La tarjeta **Monitorización: PRTG** guarda la dirección y la clave API que los agentes de monitorización usan para leer las alertas y el estado de los sensores. Como la tarjeta de GLPI, necesita `ai_settings:admin` y la superficie `ai_settings`.

### Campos

- **Activar la monitorización PRTG**: conmutador maestro de la conexión. Cuando está desactivado, los agentes no llegan a PRTG.
- **Dirección del servidor**: la dirección con la que abre PRTG en su navegador, por ejemplo `https://prtg.example.com`.
- **Clave API**: cree una en PRTG en **Setup | Account Settings | API Keys**. Basta con acceso de solo lectura. Una clave guardada se muestra en puntos, con **Reemplazar** al lado. Una dirección nueva vacía la clave guardada: el campo la vuelve a pedir.
- **Zona horaria del servidor**: la zona horaria del servidor central de PRTG, tal como está definida en su sistema operativo. Kadratis lee las horas de las alertas en esa zona.
- **Tiempo de espera de las solicitudes (segundos)**: cuánto esperar a PRTG, entre 5 y 120. Déjelo vacío para usar 30.

### Acciones

**Probar** y **Guardar** funcionan como en la tarjeta de GLPI: **Probar** está disponible en cuanto la dirección y la clave están introducidas. Una prueba correcta muestra la versión de PRTG y el número de sensores que la clave puede ver. Una vez guardada y activada una conexión que funcione, la tarjeta ofrece un enlace a la página de agentes, donde se puede crear un agente de monitorización.

---

## Inventario de Netbox

[Netbox](https://netboxlabs.com/docs/netbox/) es la fuente de referencia de muchos equipos de infraestructura: equipos, máquinas virtuales, racks, sitios, direcciones. La tarjeta **Inventario de Netbox** guarda la dirección y el token de API que Kadratis usa para leer ese inventario y mantener sus activos alineados con él. Netbox sigue siendo la referencia para los equipos que describe; Kadratis conserva la capa de negocio a su alrededor.

Esta conexión es independiente de las funcionalidades de IA. Necesita `infrastructure:admin`, funciona en la nube y en la edición on-premise, y sigue disponible cuando la IA está desactivada.

Configure aquí la conexión y abra después la pestaña **Netbox** de **Panorama IT > Configuración** para elegir qué se importa y ejecutar la sincronización. El procedimiento completo, las reglas de asociación y la tabla de resolución de problemas están en [Sincronización con Netbox](netbox.md).

---

## Quitar una conexión

Las tres tarjetas quitan una conexión de la misma manera: vacíe su dirección, guarde y confirme. Kadratis elimina la dirección y los secretos guardados, desactiva la conexión y escribe una entrada en el registro de auditoría. La confirmación indica qué cambia para cada sistema:

- **GLPI**: ya no se pueden importar tickets. Los tickets ya importados se conservan.
- **PRTG**: los agentes de monitorización ya no pueden leer PRTG y lo indican como no disponible en su siguiente ejecución.
- **Netbox**: la sincronización automática se detiene. Lo ya sincronizado se conserva.

El registro de auditoría indica si hay un secreto definido y señala uno reemplazado: la entrada de un guardado que cambia una clave o un token en la misma dirección muestra **Secreto reemplazado**, y para GLPI **Token de usuario de GLPI reemplazado** o **Token de aplicación de GLPI reemplazado**. El secreto en sí nunca se escribe en el registro.

---

## Consejos

- **Use una cuenta GLPI dedicada**: cree una cuenta de servicio en GLPI con justo los permisos suficientes para leer las categorías de tickets que desea exponer. Eso mantiene el registro de auditoría limpio y le permite revocar el acceso sin afectar a un usuario real. Si los agentes van a enviar respuestas y cambios de estado, otorgue a esa misma cuenta el acceso de escritura que esas acciones requieren.
- **Pruebe antes de anunciar**: ejecute **Probar** después de cada cambio de URL o de tokens. El mensaje de error es mucho más accionable que un fallo que aparece dentro de la conversación de chat de alguien o en una comprobación de agente detenida.
- **Combine con los permisos adecuados**: solo los usuarios con `ai_chat:reader` pueden pedir a Kad que importe tickets. Dirigir un agente hacia esta conexión requiere el rol de Agentes IA (`ai_agents:reader` para ver un agente, `ai_agents:admin` para configurar uno), con los Agentes IA habilitados en la instancia. Combine eso con acceso basado en roles a las tareas si desea limitar quién crea realmente registros de tareas a partir de las importaciones.
- **Planifique la rotación de tokens**: los tokens personales de GLPI pueden regenerarse. Cuando lo haga, guarde el nuevo valor aquí y ejecute la prueba de conexión antes de que los usuarios (o los agentes) vuelvan a usar la integración.
