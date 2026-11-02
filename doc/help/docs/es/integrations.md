# Integraciones

Use la página Integraciones para conectar KANAP con herramientas de terceros que complementan los datos que ya gestiona en la plataforma. La conexión principal es su centro de servicios **GLPI**. Esa única conexión cumple dos propósitos a la vez: permite que **Plaid** (el chat interactivo) encuentre e importe tickets en KANAP como tareas, y alimenta a los **Agentes IA** que vigilan su centro de servicios y proponen o realizan el trabajo sobre los tickets. La página también alberga la conexión **Inventario de Netbox**, que no tiene nada que ver con la IA. Con el tiempo se irán añadiendo aquí nuevas integraciones.

## Dónde encontrarlo

- Espacio de trabajo: **Administración**
- Ruta: **Administración → Integraciones**
- Ruta: `/admin/integrations`
- Permiso: `ai_settings:admin` o `infrastructure:admin`. Cada tarjeta tiene su propio requisito: las conexiones de GLPI y de supervisión necesitan `ai_settings:admin`, la conexión de Netbox necesita `infrastructure:admin`. Solo ve las tarjetas que tiene permiso para configurar.
- Indicador de funcionalidad: las tarjetas de GLPI y de supervisión comparten la misma superficie `ai_settings` que la página de configuración de Plaid. Cuando esa superficie está desactivada, quedan ocultas. La tarjeta de Netbox no tiene indicador de funcionalidad y está disponible tanto en la nube como en la edición on-premise.

Las credenciales que introduce aquí son las que usan tanto Plaid como cualquier agente IA para llegar a GLPI: la conexión se configura una sola vez, en un único lugar.

---

## Integración GLPI

[GLPI](https://glpi-project.org/) es una popular herramienta de código abierto para la gestión de servicios IT. Esta página almacena las credenciales que KANAP usa para llegar a su instancia de GLPI. Lo que KANAP hace con esa conexión depende de la funcionalidad a la que la dirija.

### Cómo funciona

La conexión alimenta dos flujos de trabajo que se habilitan y gobiernan por separado.

**1. Importación desde el chat de Plaid (vista previa y aprobación).** Un usuario final pide a Plaid algo como «importar los tickets GLPI abiertos asignados a mi equipo». Plaid consulta GLPI mediante las credenciales que configura aquí, devuelve los tickets candidatos como vista previa en el chat y crea una tarea por cada ticket solo después de que el usuario revise la vista previa y haga clic en **Aprobar**. Nada se escribe en KANAP sin esa aprobación explícita, de modo que los administradores pueden entregar esto a los usuarios finales sin preocuparse por una rotación silenciosa de datos.

**2. Agentes IA que vigilan el centro de servicios.** Una vez conectado GLPI aquí, un administrador puede dirigir hacia él un agente **Helpdesk** y dejar que el agente vigile los tickets nuevos y actualizados, y luego proponga el trabajo: respuestas al solicitante, notas internas y actualizaciones de clasificación, estado, asignación, observadores y cierre/resolución. Añadir un observador deja al solicitante igual. Cada cambio del agente se sigue proponiendo para su aprobación antes de enviarse a GLPI, y siempre se aplican límites de seguridad estrictos, presupuestos y comprobaciones de actualidad. Esta página no configura ningún comportamiento del agente; solo proporciona la conexión que los agentes usan.

### Usado por los Agentes IA

Después de guardar aquí una conexión que funcione, un administrador configura los agentes en la sección Agentes IA; consulte [Agentes IA: vista general](agents-overview.md). Desde **Nuevo agente** o desde la **Configuración** de un agente existente, elige esta conexión GLPI como el centro de servicios que el agente vigila. El agente lee y redacta borradores sobre ella, pero de forma predeterminada nunca envía nada por su cuenta: cada respuesta, nota o cambio de estado propuesto pasa primero a la cola de revisión.

### Requisitos previos

- **El chat de Plaid debe estar habilitado** en su espacio de trabajo para el flujo de importación desde el chat. La página muestra un tooltip informativo junto al título de la sección para recordarle esta dependencia.
- **Los Agentes IA deben estar habilitados** en la instancia para el flujo de trabajo de agentes, y el agente debe ser configurado por alguien con el nivel Administrador de Agentes IA (`ai_agents:admin`).
- Una instancia de GLPI accesible desde KANAP por HTTPS.
- Un **Token de usuario** para una cuenta de usuario de GLPI que tenga acceso de lectura a los tickets que desea exponer.
- Un **Token de aplicación** opcional si su instancia de GLPI requiere autenticación a nivel de aplicación.
- **Derechos del perfil para las funciones de agente**: el perfil de GLPI de esa cuenta necesita acceso de lectura a las categorías ITIL y a las entidades, que los agentes usan para sus filtros de segmentación y para la clasificación, además de acceso de lectura a los grupos y a los usuarios para que un agente pueda encaminar un ticket a un grupo de técnicos o a un técnico concreto. El encaminamiento también exige el derecho de asignar tickets. Por último, conceda derechos de actualización sobre los tickets para las acciones que permita realizar al agente: seguimientos, clasificación, estado y asignación.

La integración se configura espacio de trabajo por espacio de trabajo; las credenciales a continuación están limitadas a su espacio de trabajo y nunca salen de él.

### Campos

El formulario de configuración contiene:

- **Habilitar importación de tickets GLPI**: conmutador maestro de la conexión. Cuando está desactivado, KANAP no intentará consultar GLPI aunque las credenciales estén establecidas: ni las importaciones de Plaid ni las comprobaciones de los agentes llegarán a su centro de servicios.
- **URL de GLPI**: la URL base de su instancia de GLPI, por ejemplo `https://glpi.example.com`.
- **Token de usuario**: el token API personal de la cuenta GLPI que KANAP usará. Los tokens existentes se enmascaran; deje el campo en blanco durante un guardado o una prueba para conservar el valor almacenado.
- **Token de aplicación**: el token de aplicación opcional de GLPI. Mismo comportamiento de dejar en blanco para conservar que el token de usuario.

### Acciones

- **Guardar configuración**: persiste el formulario. Los tokens introducidos en el formulario reemplazan los almacenados; los campos de token en blanco conservan lo que ya está almacenado.
- **Probar conexión**: ejecuta una ida y vuelta autenticada contra la URL de GLPI usando los valores del formulario (o, donde estén en blanco, los valores almacenados). La banda de resultado muestra el éxito o el error subyacente junto con la latencia.

### Almacenamiento de secretos

Si su instancia de KANAP no tiene un almacén de secretos configurado, aparece un texto de ayuda bajo cada campo de token advirtiéndole que los valores no pueden persistirse. Configure el almacenamiento de secretos a nivel de instancia antes de confiar en esta integración en producción.

---

## Inventario de Netbox

[Netbox](https://netboxlabs.com/docs/netbox/) es la fuente de referencia de muchos equipos de infraestructura: equipos, máquinas virtuales, racks, sitios, direcciones. La tarjeta **Inventario de Netbox** guarda la dirección y el token de API que KANAP usa para leer ese inventario y mantener sus activos alineados con él. Netbox sigue siendo la referencia para los equipos que describe; KANAP conserva la capa de negocio a su alrededor.

Esta conexión es independiente de las funcionalidades de IA. Necesita `infrastructure:admin`, funciona en la nube y en la edición on-premise, y sigue disponible cuando la IA está desactivada.

Configure aquí la conexión y abra después la pestaña **Netbox** de **Panorama IT > Configuración** para elegir qué se importa y ejecutar la sincronización. El procedimiento completo, las reglas de asociación y la tabla de resolución de problemas están en [Sincronización con Netbox](netbox.md).

---

## Consejos

- **Use una cuenta GLPI dedicada**: cree una cuenta de servicio en GLPI con justo los permisos suficientes para leer las categorías de tickets que desea exponer. Eso mantiene el registro de auditoría limpio y le permite revocar el acceso sin afectar a un usuario real. Si los agentes van a enviar respuestas y cambios de estado, otorgue a esa misma cuenta el acceso de escritura que esas acciones requieren.
- **Pruebe antes de anunciar**: ejecute **Probar conexión** después de cada cambio de URL o de tokens. El mensaje de error es mucho más accionable que un fallo que aparece dentro de la conversación de chat de alguien o en una comprobación de agente detenida.
- **Combine con los permisos adecuados**: solo los usuarios con `ai_chat:reader` pueden pedir a Plaid que importe tickets. Dirigir un agente hacia esta conexión requiere el rol de Agentes IA (`ai_agents:reader` para ver un agente, `ai_agents:admin` para configurar uno), con los Agentes IA habilitados en la instancia. Combine eso con acceso basado en roles a las tareas si desea limitar quién crea realmente registros de tareas a partir de las importaciones.
- **Planifique la rotación de tokens**: los tokens personales de GLPI pueden regenerarse. Cuando lo haga, guarde el nuevo valor aquí y ejecute la prueba de conexión antes de que los usuarios (o los agentes) vuelvan a usar la integración.
