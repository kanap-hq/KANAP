# Sincronización con Netbox

[Netbox](https://netboxlabs.com/docs/netbox/) describe su infraestructura física y virtual: equipos, máquinas virtuales, racks, sitios, direcciones. KANAP lee ese inventario y mantiene sus propios activos alineados con él.

El reparto de responsabilidades es deliberado. Netbox sigue siendo la referencia para los equipos que describe, así que el nombre, el número de serie, la posición en el rack o la dirección principal vienen siempre de ahí. KANAP conserva la capa de negocio alrededor de cada activo: entorno, aplicaciones, contratos y costes, soporte, fechas, relaciones, notas. Deja de reescribir el inventario y conserva todo lo que Netbox no conoce.

## Dónde encontrarlo

- Espacio de trabajo: **Panorama IT**
- Ruta: **Panorama IT > Configuración**, pestaña **Netbox**
- Ruta: `/it/settings?tab=netbox`. La dirección anterior `/it/netbox` abre la misma pestaña.
- Configuración de la conexión: **Administración > Integraciones**
- Permiso: `infrastructure:admin`, tanto para la tarjeta de conexión como para la pestaña **Netbox**. Con este permiso, la entrada **Configuración** del menú del Panorama IT aparece aunque usted no vea las listas de la pestaña **Listas**.
- Disponible en la nube y en la edición on-premise. No hay ningún indicador de funcionalidad que activar.

---

## Antes de empezar

**Una instancia de Netbox accesible para KANAP.** KANAP llama a Netbox desde el servidor, no desde su navegador. La dirección que introduzca tiene que resolverse y responder desde donde se ejecuta KANAP. En la edición en la nube, esa dirección debe ser pública: una dirección privada o interna se rechaza al guardar la conexión, y de nuevo antes de cada llamada. En la edición on-premise, una dirección de su propia red es exactamente lo que se espera.

**Un token de API con acceso de lectura.** En Netbox, abra el menú de usuario arriba a la derecha, luego **API tokens**, y cree uno. Basta con un token de solo lectura: KANAP nunca escribe nada en Netbox. Póngale una descripción para reconocerlo más tarde, y rótelo como haría con cualquier otra credencial de servicio.

**Una decisión sobre el certificado.** Si su Netbox usa un certificado en el que KANAP no confía, normalmente un certificado autofirmado o interno, puede activar **Ignorar los errores de certificado**. La conexión sigue cifrada, pero el certificado deja de comprobarse, así que úselo solo con un certificado que conozca y en el que confíe, en una red que controle. En un Netbox público, instale un certificado de confianza en su lugar.

---

## Conectar KANAP con Netbox

Vaya a **Administración > Integraciones** y abra la tarjeta **Inventario de Netbox**.

| Campo | Qué introducir |
|-------|----------------|
| **Activar la sincronización con Netbox** | El conmutador maestro. Cuando está desactivado, KANAP no llama nunca a Netbox, ni a mano ni de forma programada. |
| **Dirección de Netbox** | La dirección que usa para abrir Netbox en el navegador, por ejemplo `https://netbox.example.com`. |
| **Token de API** | El token que creó en Netbox. Se guarda cifrado y no se vuelve a mostrar. Deje el campo vacío al guardar para conservar el token ya almacenado. |
| **Tiempo de espera (segundos)** | Cuánto esperar a Netbox antes de abandonar, entre 5 y 120. Déjelo vacío para usar 30. |
| **Ignorar los errores de certificado** | Desactivado de forma predeterminada. Véase más arriba. |
| **Sincronización automática** | Se ejecuta cada hora y aplica los cambios por su cuenta. Déjela desactivada hasta que la primera ejecución le parezca correcta. |
| **Entorno de los nuevos activos** | Se aplica a los activos que crea esta integración. Después no se cambia nunca. |

**Probar conexión** hace una llamada de solo lectura e indica la versión de Netbox encontrada, o el motivo del fallo. Ejecútela después de cada cambio de dirección o de token. La tarjeta muestra **Configurado** una vez guardada y activada la conexión. Al lado, indica el resultado y la fecha de la última prueba: «Última prueba correcta el …» o «Última prueba fallida el …». Una vez guardada la configuración, la tarjeta ofrece un enlace **Configurar la sincronización**, que lleva a la pestaña **Netbox** de **Panorama IT > Configuración**.

---

## Elegir qué se importa

En la pestaña **Netbox**, abra **Correspondencias**. Ahí hay cuatro tablas. Las dos primeras deciden todo el alcance de la importación.

- **Rol de Netbox > Tipo de activo KANAP**. Cada rol de equipo que Netbox conoce recibe un tipo de activo, o **No importar**.
- **Sitio de Netbox > Ubicación KANAP**. Cada sitio de Netbox recibe una de sus ubicaciones, o **No importar**.

Todo lo que quede en **No importar** se omite: sus objetos no se crean nunca, no se actualizan nunca y no se señalan nunca como ausentes. Así deja fuera de KANAP las regletas, los paneles de parcheo o un sitio de laboratorio, mientras importa los servidores que están al lado.

Una fila adicional acompaña a los roles: **Máquinas virtuales**. Todas las máquinas virtuales que contiene Netbox pasan por esa única fila, sea cual sea el rol que Netbox les dé, así que una sola decisión cubre el conjunto. Una máquina virtual toma el sitio de su clúster cuando no lleva uno propio.

Cada fila muestra cuántos equipos y máquinas virtuales cubre, de modo que puede ver qué va a traer una elección. Cuando un nombre de Netbox coincide claramente con uno suyo, la fila viene rellenada y marcada como **Sugerido**. Una sugerencia es solo una propuesta: nada se usa hasta que pulse **Guardar correspondencias**. Mientras haya correspondencias sin guardar, un aviso en la parte superior de la pestaña indica cuántas son, con el botón de guardar al lado. Si pulsa **Sincronizar ahora** antes de que haya algún rol o algún sitio guardado, la vista previa lo indica y le devuelve a esta pestaña en lugar de enumerar todos los objetos como omitidos.

Asignar un sitio de Netbox también trae sus ubicaciones de Netbox como sub-ubicaciones de la ubicación que haya elegido. Solo las ubicaciones de primer nivel de ese sitio, y solo aquellas en las que realmente se encuentra un equipo importado. Un equipo situado más abajo, en «Edificio A > Planta 1 > Sala 101», se asocia a «Edificio A»: KANAP registra dónde está un equipo al nivel de un sitio y un edificio, no de una sala. No hay nada que configurar para esto.

### Sistemas operativos

La tercera tabla asocia cada plataforma de Netbox con una tecnología. Netbox dice «Debian 12» donde KANAP tiene la tecnología Debian con su versión «12 (Bookworm)», y es aquí donde se unen los dos. Cada fila indica cuántos objetos usan esa plataforma.

La lista ofrece sus tecnologías de la familia **Sistema operativo**, solas y con cada una de sus versiones, y después los sistemas operativos del catálogo de tecnologías que aún no ha añadido. El valor que se guarda es el nombre de la tecnología, con su versión cuando elige una. En la siguiente ejecución, KANAP registra esa tecnología y esa versión como sistema operativo del servidor, y añade a sus tecnologías una entrada del catálogo cuando ha elegido una.

Las filas vienen rellenadas cuando KANAP ve la respuesta: el mismo nombre, o la única opción cuyo nombre empieza por el nombre de la plataforma. «Debian 12» sugiere «Debian 12 (Bookworm)». Como en las otras tablas, una sugerencia solo cuenta cuando pulsa **Guardar correspondencias**.

Esta tabla no es un filtro. Una plataforma que quede en **Sin correspondencia** nunca deja nada fuera de la importación. El equipo entra y su sistema operativo se queda tal como está en KANAP. Asocie la plataforma más tarde y la siguiente ejecución rellena el campo.

Netbox concede permisos de lectura por tipo de objeto, así que un token autorizado a leer equipos, roles y sitios puede aun así tener vedadas las plataformas. Los roles y los sitios siguen funcionando y la importación no se ve afectada. Solo esta sección queda vacía, y dice por qué.

### Clústeres { #clusters }

La sección **Clústeres** asocia cada clúster de Netbox con un clúster de KANAP: un activo marcado como clúster y en servicio. Cada fila muestra cuántas máquinas virtuales contiene el clúster de Netbox. Se sugiere un clúster de KANAP con el mismo nombre y, como en el resto, una sugerencia solo cuenta cuando pulsa **Guardar correspondencias**.

En la siguiente ejecución, cada máquina virtual de un clúster asociado se añade a las relaciones **Contiene** de su clúster de KANAP. Una tecnología instalada en el clúster llega entonces a la máquina y a las aplicaciones alojadas en ella. Una máquina cuyo único cambio es su clúster aparece en **Por actualizar**, con una línea **Clúster**. Una máquina que crea la ejecución entra en su clúster de inmediato.

Cuando un host miembro del clúster asociado contiene hoy la máquina, vincularla al clúster sustituye el vínculo del host. La vista previa lo muestra en la fila de la máquina, con una línea **Ubicación** del host al clúster. Consulte [Máquinas virtuales en un clúster](assets.md#virtual-machines-on-a-cluster).

Fuera de ese caso, la importación solo añade:

- Una máquina que ya está en otro clúster de KANAP se queda ahí. La vista previa lo indica en la fila de la máquina, para que pueda quitar esa relación a mano si está desfasada.
- Cambiar una correspondencia añade las máquinas al nuevo clúster y las mantiene en el antiguo.
- Una máquina que saca de su clúster vuelve en la siguiente ejecución, mientras esté en ese clúster de Netbox y la correspondencia exista. Para sacarla de forma definitiva, quite primero la correspondencia y después la relación.

Un clúster de Netbox que quede en **Sin correspondencia** no vincula nada y no bloquea la importación. La vista previa lo menciona una vez. Una correspondencia con un activo eliminado, retirado o que ya no es un clúster tampoco vincula nada, y cada ejecución la señala como aviso. No le impide guardar las demás correspondencias.

Los hosts no se vinculan: los miembros de un clúster los sigue gestionando usted desde la ficha del clúster. Si el token de API no puede leer los clústeres, la sección lo indica y el resto de la pestaña sigue funcionando.

---

## La primera sincronización

Pulse **Sincronizar ahora**. KANAP lee Netbox y muestra **Revisar antes de aplicar** antes de escribir nada.

La vista previa está agrupada:

- **Sub-ubicaciones**: las filas compartidas que la ejecución crea, adopta o renombra, enumeradas una vez cada una con la ubicación a la que pertenecen y cuántos equipos acaban en ellas. Renombrar una ubicación de Netbox aparece aquí como una sola línea, no como el movimiento de cada activo.
- **Por crear**: objetos sin equivalente en KANAP. Se van a crear.
- **Por actualizar**: objetos asociados a un activo existente que difiere. Todavía no se ha modificado nada, los valores se escriben cuando usted aplica. Cada uno enumera los campos que cambian, campo por campo, como `antes → después`.
- **Por decidir**: objetos sobre los que KANAP no decide por su cuenta. No les pasa nada hasta que los resuelva, aquí o más tarde en la página.
- **Omitidos**: objetos fuera de alcance, contados por motivo (rol sin correspondencia, sitio sin correspondencia, sin nombre en Netbox, ignorado por usted). Se nombran los 20 primeros objetos de cada motivo y después el número de los demás.
- **Ausentes de Netbox**: activos que una ejecución anterior vinculó y cuyo objeto de Netbox ha desaparecido.
- **Avisos**: valores que Netbox devuelve y que KANAP no ha podido retomar, por ejemplo un sistema operativo que KANAP no encuentra entre sus tecnologías. Un objeto que no tiene nada que cambiar pero sí algo que señalar aparece también aquí.

Léala y pulse **Aplicar**. Los objetos que ya son idénticos se cuentan como sin cambios y no se tocan en absoluto. Un inventario grande se revisa en lotes de 500. **Aplicar este lote** solo escribe lo que la vista previa enumera; todo lo demás se deja exactamente como está. La página indica después cuántos objetos siguen en espera y ofrece **Revisar el lote siguiente**, hasta que no quede nada. Una sincronización que usted inicia nunca crea ni modifica un objeto que no se le haya mostrado. Los objetos fuera de alcance quedan aparte, en **Omitidos**, de modo que nunca ocupan el lugar de un objeto que usted debe leer. El filtro de la parte superior restringe la lista a un objeto o a un nombre de activo.

### Corregir la vista previa antes de aplicar

KANAP solo puede reconocer un activo por su número de serie, su nombre de host o su nombre. Un equipo que usted ha renombrado, sin ninguno de estos datos en común, aparece en **Por crear** y se crearía por segunda vez. La vista previa le permite resolverlo antes. Una fila para la que KANAP propone algo tiene un botón, **Vincular en su lugar** en **Por crear** y **Por actualizar**, **Decidir** en los objetos que necesitan una decisión. Un objeto ya vinculado por una ejecución anterior no lo tiene: está resuelto, y la fila solo muestra lo que cambia. Una primera asociación indica en qué se basa («Reconocido por su número de serie»), para que pueda detectar un error. El botón abre estas opciones:

- **Vincular a un activo existente**: busque el activo y selecciónelo. La fila pasa a **Por actualizar** y muestra lo que Netbox va a cambiar en ese activo, campo por campo, para que siga leyendo antes de aplicar.
- **Crear un activo nuevo**: para un objeto clasificado en **Por decidir**, o para uno que KANAP ha asociado al activo equivocado.
- **No importar este objeto**: el objeto queda fuera de esta sincronización y de las siguientes. Ningún activo se modifica. Pasa a **Resueltos por usted** en la vista previa y, una vez aplicado, a **Ignorados** en la página, donde podrá recuperarlo más tarde.

Una fila sobre la que ha decidido lo indica y ofrece **Deshacer**. Cuando varios objetos clasificados en **Por decidir** tienen un único activo sugerido, **Vincular los N objetos que solo tienen una sugerencia** los resuelve todos de una vez. Pasan a **Por actualizar**, donde lee lo que cambia antes de aplicar.

No se escribe nada mientras decide. Sus decisiones se aplican junto con todo lo demás cuando pulsa **Aplicar**, y se mantienen después: la sincronización automática sigue los vínculos que usted ha creado. Cerrar la vista previa los descarta.

La aplicación se ejecuta en segundo plano. La página la sigue y se actualiza sola cuando termina.

---

## Cómo se asocian los objetos a los activos existentes

Una primera importación en un KANAP ya poblado tiene que encontrar los activos que usted ya tiene en lugar de duplicarlos. KANAP prueba cuatro cosas, en orden, y se detiene en la primera que encuentra algo:

1. **Un vínculo existente**. El objeto ya se asoció a un activo en una ejecución anterior.
2. **El número de serie**. Sobrevive a un cambio de nombre en cualquiera de los dos lados.
3. **El nombre de host**, tomado entero. `par-esx-01.example.com` en Netbox es el activo cuyo nombre de host está escrito así. También es el activo `par-esx-01` cuando `example.com` es uno de sus dominios, porque ese sufijo lo declaró usted mismo.
4. **El nombre del activo**, ignorando mayúsculas, leído de la misma manera.

Si un paso encuentra exactamente un activo, esa es la asociación. Si encuentra varios, KANAP se detiene ahí y clasifica el objeto en **Por decidir** con los candidatos enumerados. Nunca fusiona por conjetura.

**Dos señales son propuestas, nunca asociaciones.** Cuando ninguno de los cuatro pasos identifica el objeto, KANAP busca un parecido en lugar de crear sin más.

- **Un nombre que empieza igual.** Un activo cuyo nombre o nombre de host solo coincide con la primera parte del nombre de Netbox, hasta el primer punto, se ofrece como candidato. En un inventario que nombra los equipos `dl3.robot-15ms.ie2000`, esa primera parte es un edificio y no una máquina, y un único activo llamado `dl3` absorbería toda la planta sin hacer ruido.
- **Una dirección ya asignada.** Un activo que ya lleva la dirección principal del objeto se ofrece del mismo modo. Las direcciones se reutilizan, se comparten entre los miembros de un clúster o simplemente están obsoletas.

En los dos casos el objeto no se crea. Pasa a **Por decidir** con ese activo como sugerencia, bajo «Un activo tiene un nombre parecido. Decida si es el mismo equipo.» o «Un activo ya usa la dirección...», y un clic lo resuelve. Ninguna de las dos señales vincula nada por sí sola, ni siquiera cuando se encuentra un único activo: un vínculo equivocado dejaría que Netbox sobrescribiera el activo equivocado. La sincronización automática sigue la misma regla y no escribe nada para un objeto así, de modo que un equipo nuevo de Netbox nunca se convierte en un duplicado a sus espaldas.

Otras dos reglas mantienen el resultado limpio:

- **Un activo pertenece a un solo objeto de Netbox**, y al revés. La base de datos lo impone. Un activo que ya pertenece a otro objeto queda fuera del alcance de todo lo demás, y vincular un activo ya ocupado se rechaza con un mensaje que nombra el objeto que lo retiene. Si dos objetos de Netbox llegan al mismo activo libre, ambos se le envían para que decida.
- **Un equipo eliminado y recreado en Netbox se recupera.** Vuelve con un identificador de Netbox nuevo, así que el registro antiguo pasa a ausente, libera su activo, y el objeto nuevo lo retoma por nombre de host en la misma ejecución. Si otro objeto se ha quedado con ese activo mientras tanto, el equipo que vuelve se trata como un objeto nuevo.

---

## Qué campos gestiona Netbox

| Gestionado por Netbox | Sigue siendo suyo en KANAP |
|-----------------------|----------------------------|
| Nombre | Entorno |
| Nombre de host y dominio | Notas y descripción |
| Número de serie | Fechas, soporte y garantía |
| Fabricante y modelo | Contratos y costes |
| Ubicación en el rack y unidad de rack | Aplicaciones alojadas en el activo |
| Dirección IP principal | Conexiones y otras relaciones |
| Sistema operativo | Adjuntos, tareas, incidentes |
| Ciclo de vida | Todo lo demás del activo |
| Ubicación | |
| Sub-ubicación | |

En un activo vinculado a Netbox, un campo gestionado aparece como **Gestionado por Netbox** y no se puede editar en KANAP. Cámbielo en Netbox y la siguiente ejecución lo trae. Todo lo demás del activo sigue siendo editable como siempre.

**Solo se bloquean los campos que Netbox rellena de verdad para ese objeto.** Netbox no tiene noción de dominio, un equipo a menudo no tiene plataforma y a veces no tiene dirección principal. Esos campos quedan para que los complete usted y, como una sincronización nunca escribe un valor vacío, lo que escriba ahí nunca se sobrescribe. La página del activo lo dice en una línea: «Netbox rellena los campos que proporciona. Los demás puede completarlos usted.»

Cada ejecución actualiza esa lista, incluso en un objeto en el que no cambió nada. Añada una plataforma en Netbox y el sistema operativo se retoma en la siguiente ejecución, y queda bloqueado a partir de ahí. Un activo importado antes de este comportamiento mantiene todos sus campos bloqueados hasta su próxima sincronización.

La página del activo lleva además una línea **Origen**: cuándo se hizo la última sincronización, un enlace **Abrir en Netbox**, y un aviso cuando el objeto ya no está.

### Reglas que conviene conocer

**Un valor vacío en Netbox nunca borra un valor de KANAP.** Si Netbox no tiene número de serie y KANAP sí, se conserva el número de serie. Solo se escribe un valor que Netbox tenga de verdad.

**Las ediciones manuales se corrigen.** Cada ejecución compara con los valores reales del activo, así que un campo gestionado que se haya cambiado en KANAP por otra vía se vuelve a alinear en la siguiente ejecución.

**Un punto solo es un dominio si usted lo dice.** Un nombre de Netbox se divide en nombre de host y dominio cuando termina con un sufijo DNS de su lista de dominios, en **Panorama IT > Configuración**. Gana el sufijo más largo, así que un nombre acabado en `corp.example.com` toma ese dominio y no `example.com`. Todo lo demás es simplemente un nombre: `dl3.robot-15ms.ie2000` pasa a ser el nombre de host tal cual, puntos incluidos, y el dominio queda intacto. No se señala nada, porque no hay nada que corregir. Para que se reconozca un sufijo, añada el dominio en la configuración: la siguiente ejecución divide el nombre por sí sola.

Los activos importados antes de esta regla, cuyo nombre de host se cortaba en el primer punto, los corrige la siguiente ejecución. La corrección aparece en la vista previa como un cambio de nombre de host cualquiera.

**Los cambios de nombre se entienden.** Una diferencia de mayúsculas no es un cambio de nombre. Un sufijo de dominio que usted haya declarado, tampoco: `PAR-ESX-01` y `par-esx-01.example.com` son la misma máquina que `par-esx-01` cuando `example.com` es uno de sus dominios.

**El ciclo de vida sigue una tabla fija.**

| Estado en Netbox | Ciclo de vida en KANAP |
|------------------|------------------------|
| Planned, Staged, Inventory | Propuesto |
| Active, Offline, Failed, Paused | Activo |
| Decommissioning | Obsoleto |
| Cualquier otro | Se deja sin cambios, con un aviso |

**Offline, Failed y Paused siguen a la vista.** El ciclo de vida se mantiene en Activo, porque el equipo sigue en servicio sobre el papel. KANAP conserva el estado de Netbox y lo muestra como un aviso: en el activo, junto a su origen («Estado en Netbox: Averiado»), en la lista de objetos vinculados y entre las advertencias de la vista previa. Si en Netbox solo cambia este estado, el activo no se reescribe.

Una sincronización nunca pone un activo en **Retirado**. Retirar un equipo es una decisión que toma usted, desde la lista **Ausentes de Netbox**.

**El entorno se establece una sola vez.** Los activos nuevos reciben el entorno elegido en la tarjeta de la integración. Las ejecuciones posteriores no lo tocan nunca, así que puede corregirlo en KANAP y se queda corregido.

**Los valores que KANAP no conoce se omiten, nunca se inventan.** Un estado de ciclo de vida sin equivalente, o un sistema operativo sin correspondencia en **Correspondencias** y sin tecnología de ese nombre en la familia **Sistema operativo** ni en el catálogo, se deja sin cambios y se señala como aviso. Asocie la plataforma, o añada la tecnología, y vuelva a ejecutar. Una dirección principal IPv6 se deja fuera igual, con el aviso «La dirección principal es una dirección IPv6, que todavía no se importa.».

**Las sub-ubicaciones se comparten entre equipos.** Una sub-ubicación es una sola fila en una ubicación, y cada activo colocado ahí apunta a ella. Renombrar la ubicación de Netbox renombra esa única fila, así que todos los equipos que la llevan siguen a la vez, incluidos los que usted mismo haya clasificado ahí. Nada se mueve activo por activo.

**Una sub-ubicación creada a mano se adopta, no se duplica.** Cuando una ubicación de Netbox tiene el mismo nombre que una sub-ubicación que ya usa en esa ubicación, KANAP vincula las dos: su fila conserva su identidad, adopta la grafía de Netbox y queda marcada como **Netbox** a partir de entonces. Sus activos se quedan donde están.

**Nunca se elimina nada.** Una ubicación retirada de Netbox deja su sub-ubicación en su sitio, con los activos que la llevan. Una sub-ubicación vinculada a Netbox sigue siendo editable: renómbrela o elimínela en KANAP y la siguiente ejecución la vuelve a alinear, creándola de nuevo si un activo todavía la necesita.

**Un equipo sin ubicación conserva su sub-ubicación.** Solo se escribe una ubicación que Netbox comunique de verdad, la misma regla que para cualquier otro campo gestionado. Las máquinas virtuales no reciben ninguna: una máquina virtual de Netbox no lleva ubicación.

**Dos ubicaciones con el mismo nombre en un mismo sitio.** Netbox permite «Sala técnica» y «sala técnica» una junto a otra, KANAP no. La primera que se importa gana, y la otra se señala como aviso. Lo mismo ocurre cuando dos sitios de Netbox están asignados a la misma ubicación de KANAP y ambos contienen una ubicación con el mismo nombre.

**Si Netbox no devuelve sus ubicaciones**, la ejecución continúa con los equipos y deja todas las sub-ubicaciones intactas, con una nota en la vista previa que lo indica. Una asignación parcial sería peor que ninguna.

**Un activo nuevo toma el proveedor de su ubicación** cuando ese proveedor existe en su configuración IT, y «Otro» en caso contrario. Netbox no tiene noción de proveedor de alojamiento.

**Una ejecución que falla sin parar se detiene.** Después de 10 objetos seguidos que no se han podido guardar, la ejecución se detiene y se declara fallida, en vez de llenar la lista de filas en error y luego anunciar que todo ha ido bien.

**Una lectura parcial no marca nada como ausente.** Si Netbox contiene más páginas de las que KANAP lee en una ejecución, no se señala nada como ausente y un aviso acompaña al resultado.

**Un reinicio del servidor no bloquea la página.** **Sincronizar ahora** vuelve a funcionar de inmediato; una ejecución interrumpida por el reinicio se declara detenida sin haber terminado.

---

## Sincronización automática

Active **Sincronización automática** en la tarjeta de la integración y KANAP ejecuta el mismo trabajo cada hora, aplicando los cambios sin vista previa. El conmutador es por espacio de trabajo, y solo se visitan los espacios de trabajo que lo han activado. El trabajo horario nunca hace la primera importación: empieza cuando usted ha aplicado una sincronización y esta ha terminado sin errores. Hasta entonces el conmutador puede estar activado sin que se ejecute nada. Lo mismo ocurre mientras una revisión no ha terminado: mientras haya objetos esperando su lote, el trabajo horario queda en pausa, porque importaría lo que nadie ha leído. Se reanuda en cuanto una sincronización que usted aplique no deje nada en espera.

Los objetos que necesitan una decisión no se resuelven nunca de forma automática. Se acumulan en **Por decidir** y le esperan.

Las sub-ubicaciones también las crea y renombra la ejecución automática. Un espacio de trabajo cuyo primer import ya está hecho las recibe en la siguiente ejecución horaria, sin vista previa previa.

Una ejecución manual y una ejecución programada no pueden solaparse: si ya hay una en marcha, la otra no hace nada para ese espacio de trabajo y vuelve a intentarlo más tarde. En la edición en la nube, un espacio de trabajo con la suscripción congelada o con la prueba caducada se omite hasta que se resuelva la suscripción. Las instalaciones on-premise no se ven afectadas.

---

## La pestaña Netbox

La pestaña **Netbox** de **Panorama IT > Configuración** es donde se trabaja una vez configurada la conexión. La banda superior muestra la última ejecución: cuándo fue, si se inició a mano o de forma automática, cuánto duró, su resultado, y cuántos objetos están vinculados o necesitan atención.

Debajo, la pestaña **Objetos** enumera todos los objetos de Netbox dentro del alcance, filtrados por estado.

La columna **Tipo** muestra el tipo de activo KANAP del activo vinculado, «Servidor físico» o «Máquina virtual» en lugar de la palabra «Equipo» para todo. Un objeto que todavía no tiene activo muestra su tipo de Netbox en gris, porque de momento no hay más que decir. Junto a los filtros de estado, un campo de búsqueda acota la lista. Busca en el nombre de Netbox, el nombre del activo y la referencia del activo, y la lista sigue al campo poco después de que deje de escribir.

| Estado | Qué significa | Qué puede hacer |
|--------|---------------|-----------------|
| **Por decidir** | Varios activos podrían ser este objeto, dos objetos han llegado al mismo activo, un activo tiene un nombre parecido, o un activo ya lleva la dirección IP del objeto. | **Vincular a...** uno de los candidatos, **Crear un activo**, o **Ignorar**. |
| **Ausentes de Netbox** | El objeto ha desaparecido de Netbox. El activo queda intacto. | **Marcar el activo como retirado**, **Ignorar**, o dejarlo. |
| **Errores** | El objeto no se ha podido escribir, con el motivo en la columna Mensaje. | Corrija la causa y vuelva a ejecutar, o **Ignorar** el objeto. |
| **Ignorados** | Le ha dicho a KANAP que deje este objeto en paz. Se omite en cada ejecución. | **Dejar de ignorar** lo devuelve a la lista. Cuando el registro no contiene nada que decidir, lo retira en su lugar y el objeto se vuelve a evaluar en la siguiente sincronización. |
| **Vinculados** | El objeto y el activo están asociados y al día. | Abra cualquiera de los dos lados desde la fila. |

Cada fila enlaza con el objeto en Netbox y con el activo en KANAP, con su referencia `AST-`.

Vincular o crear desde esta página aplica los valores de Netbox de inmediato. Lee ese único objeto en Netbox, así que sigue siendo rápido en un inventario grande. Los mensajes y los avisos se muestran en su propio idioma.

### Ausentes de Netbox

**KANAP nunca elimina un activo.** Cuando un objeto desaparece de Netbox, el activo, sus vínculos y su historial se quedan exactamente como están, y el objeto se enumera como ausente para que usted decida. **Marcar el activo como retirado** pone el ciclo de vida en Retirado y conserva todo lo demás.

Se aplican dos salvaguardas. No se señala nada como ausente cuando la llamada a Netbox ha fallado, ni cuando Netbox ha devuelto un inventario vacío: una interrupción no es un desmantelamiento. Y un activo cuyo objeto de Netbox ha desaparecido vuelve a estar libre, así que la misma máquina recreada en Netbox se vincula de nuevo a él en lugar de crear un duplicado.

---

## El widget del panel de control

Hay un widget **Sincronización con Netbox** disponible en su panel de control personal. Está desactivado de forma predeterminada. Para activarlo, haga clic en **Personalizar la página de inicio**, luego en **Añadir un mosaico** en la sección **Panorama IT**, y elija **Sincronización con Netbox**. Consulte [Personalizar su panel](my-dashboard.md#customizing-the-budget-section). El widget necesita `infrastructure:admin`, como el resto de la integración.

El widget no molesta cuando no hay nada que hacer: una línea que dice que la sincronización está al día, con la hora de la última ejecución. Cuando algo necesita atención, enumera solo lo que la necesita: objetos por decidir, activos ausentes de Netbox, errores, o una ejecución fallida. Cada línea abre la lista filtrada correspondiente.

---

## Resolución de problemas

| Lo que ve | Lo que suele significar |
|-----------|-------------------------|
| Netbox ha rechazado el token de API | El token se truncó al pegarlo, ha caducado, o está restringido a otra dirección. Cree uno nuevo en Netbox y vuelva a guardarlo. |
| Esta dirección apunta a una red privada | La edición en la nube solo llega a direcciones públicas. Publique Netbox en una dirección que KANAP pueda alcanzar, o ejecute KANAP on-premise junto a él. |
| No se ha podido comprobar el certificado de Netbox | Netbox presenta un certificado en el que KANAP no confía. Instale un certificado de confianza, o active **Ignorar los errores de certificado** si el certificado es suyo. |
| El servidor de Netbox no ha respondido a tiempo | Netbox está lento, inaccesible, o detrás de un cortafuegos que descarta la llamada. Compruébelo desde el servidor de KANAP y luego suba el tiempo de espera si la instancia es simplemente grande. |
| Los objetos aparecen como omitidos, con el motivo «Rol sin correspondencia» o «Sitio sin correspondencia» | Es lo esperado para todo lo que dejó en **No importar**. Si no debía omitirse, asigne el rol o el sitio y vuelva a ejecutar. |
| Un aviso dice que un sistema operativo no está en su catálogo | La plataforma de Netbox no tiene correspondencia en **Correspondencias > Sistemas operativos**, y su nombre no coincide con ninguna tecnología de la familia **Sistema operativo** ni con ningún sistema operativo del catálogo. Asóciela en la pestaña Correspondencias, o añada la tecnología en **Panorama IT > Tecnologías**, y vuelva a ejecutar. El sistema operativo se deja sin cambios hasta entonces. |
| «Netbox no ha devuelto sus plataformas» | El token de API no puede leer las plataformas. Déle permiso sobre `dcim.platform` en Netbox, o déjelo así: los equipos se siguen importando y solo queda fuera la correspondencia de sistemas operativos. |
| Un activo acaba con el nombre completo de Netbox como nombre de host | El nombre no termina con un sufijo DNS de su lista de dominios, así que KANAP lo conserva tal cual. Es el resultado esperado para un nombre cuyos puntos forman parte del nombre. Si de verdad es un dominio, añádalo en **Panorama IT > Configuración** y vuelva a ejecutar. |
| La ejecución ha fallado después de unos pocos objetos | Diez objetos seguidos no se han podido guardar, así que la ejecución se ha detenido. La causa suele ser la misma para todos, y los detalles están en el registro del servidor. |
| «Netbox ha devuelto más páginas de las previstas. Algunos objetos no se han revisado.» | El inventario es más grande de lo que una ejecución lee. Lo leído se aplica, y no se marca nada como ausente. Reduzca el alcance en **Correspondencias** para que la ejecución cubra lo que le importa. |
| Una sub-ubicación avisa de que su nombre ya está en uso | Dos ubicaciones de Netbox de ese sitio comparten el nombre, o dos sitios asignados apuntan a la misma ubicación de KANAP y cada uno contiene una ubicación con ese nombre. Renombre una de ellas en Netbox, o fusiónelas allí. Los equipos se importan en cualquier caso, sin sub-ubicación. |
| «Netbox no devolvió sus clústeres» | El token de API no puede leer los clústeres. Déle permiso sobre `virtualization.cluster` en Netbox, o déjelo así: los equipos se siguen importando, y solo la vinculación de las máquinas virtuales a su clúster queda fuera de alcance. |
| Una máquina virtual no se vinculó a su clúster | Su clúster de Netbox no tiene correspondencia en **Correspondencias > Clústeres**, o la correspondencia apunta a un activo retirado o que ya no es un clúster. Corrija la correspondencia y vuelva a ejecutar. |
| «Netbox no ha devuelto sus ubicaciones» | El token de API no puede leer las ubicaciones. Déle permiso sobre `dcim.location` en Netbox, o déjelo así: la importación de equipos no se ve afectada. |

---

## Consejos

- **Primero las correspondencias, después la sincronización.** Las correspondencias son el alcance. Empiece por los roles y los sitios de los que esté seguro, ejecute una vez, y amplíe después.
- **Declare antes sus sufijos DNS.** Un nombre de Netbox solo se divide en nombre de host y dominio si termina con un sufijo que tenga en **Panorama IT > Configuración**. Añada los dominios que usa antes de la primera ejecución y los nombres llegarán ya divididos.
- **Lea la vista previa en la primera ejecución.** Es la única ejecución en la que todas las asociaciones son nuevas, así que es la que merece leerse línea por línea.
- **Equipos renombrados: revise la lista Por crear.** Todo lo que reconozca ahí está a punto de duplicarse. Vincúlelo a su activo en la vista previa, o rellene su número de serie o su nombre de host en KANAP y vuelva a abrir la vista previa.
- **Rellene los números de serie.** Es la asociación más sólida que existe. Los activos que llevan número de serie sobreviven a los cambios de nombre en ambos lados sin caer nunca en **Por decidir**.
- **Espere antes de activar la ejecución horaria.** Dos ejecuciones manuales limpias seguidas, la segunda sin nada que cambiar, significan que las correspondencias y las asociaciones son correctas.
