# Vulnerabilidades

La página Vulnerabilidades lista las vulnerabilidades publicadas (CVE) que afectan a las versiones de sus tecnologías en uso, y lo que alcanza cada una: los servidores que llevan una versión afectada y las aplicaciones que la usan. Usted revisa cada vulnerabilidad y anota lo que hizo al respecto.

Ábrala desde **Panorama IT > Vulnerabilidades**, en el grupo **Operaciones**. Necesita `infrastructure:reader` para consultarla e `infrastructure:member` para cambiar un estado. Los recuentos y las listas de aplicaciones solo aparecen si también puede leer las aplicaciones.

## Disponibilidad

Las vulnerabilidades se siguen por defecto en la nube. En una instalación local están desactivadas hasta que su administrador [las activa](on-premise/configuration.md#optional-vulnerabilities), y el servidor debe entonces alcanzar la NVD (la base de datos nacional de vulnerabilidades de Estados Unidos) y la lista CVE.org, o una réplica de cada una. El mismo interruptor lee también tres fuentes de explotación, o una réplica de cada una: el catálogo de la CISA, la base europea de vulnerabilidades de la ENISA y las puntuaciones EPSS del día. Mientras están desactivadas, KANAP no muestra nada de ello: ni página, ni columna en las listas de tecnologías, activos y aplicaciones, ni sección o insignia en una ficha, ni mosaico en el panel de control, ni ajuste de notificación, ni correo. Plaid tampoco responde sobre vulnerabilidades.

## Cómo las encuentra KANAP

KANAP lee dos fuentes cada 6 horas y las compara con sus tecnologías:

- **La NVD**: las vulnerabilidades analizadas por la base de datos nacional de vulnerabilidades de Estados Unidos. La NVD no analiza todas las vulnerabilidades. Muchas se quedan mucho tiempo sin identificador de producto, y algunas no lo reciben nunca.
- **La lista CVE.org**: las fichas que los editores redactan ellos mismos para sus propios productos. Una vulnerabilidad que su editor ha publicado aparece aunque la NVD no la haya analizado.

Estas fichas proceden de la lista CVE (CVE.org), según las [condiciones de uso del programa CVE](https://www.cve.org/Legal/TermsOfUse).

Cada tecnología se compara así:

- **Productos**: una tecnología se compara por sus identificadores de producto CPE y sus nombres CVE.org (consulte [Tecnologías](technologies.md#identificadores-de-vulnerabilidad)). Los identificadores CPE también sirven para las fichas CVE.org que los llevan, como las de Red Hat. Una tecnología sin ninguno de los dos no recibe ninguna vulnerabilidad. Los sistemas operativos del catálogo también tienen identificadores CPE. Red Hat Enterprise Linux recibe también las vulnerabilidades que Red Hat clasifica bajo sus flujos de aplicaciones (AppStream). Las tecnologías retiradas quedan fuera.
- **Nombres CVE.org**: los nombres de editor y de producto tal como el editor los escribe en sus fichas, por ejemplo el editor `SAP_SE` y el producto `SAP HANA Database`. La comparación ignora mayúsculas, minúsculas y puntuación, y por lo demás exige el nombre exacto. Un nombre parecido no coincide, así que cada variante de un producto se declara por separado. Un nombre puede llevar una versión: entonces solo vale para las versiones de la tecnología cuya etiqueta empieza por esa versión, por ejemplo `2019` para `Windows Server 2019`. Cuando una etiqueta empieza por varias de ellas, solo cuenta la más larga: `2012 R2` lleva `2012` y `2012 R2`, y solo recibe el nombre de `2012 R2`.
- **Versiones**: solo cuentan las versiones en uso: instaladas en un servidor en servicio, o usadas por una aplicación en servicio.
- **Números de versión**: las versiones se comparan por sus números, parte por parte. `2016 SP3` cuenta como 2016 y `19c` como 19. Una versión de menos de tres números vale por toda su rama: `9.0` abarca todas las `9.0.x`. Una versión que KANAP no puede comparar, como una etiqueta sin número, cuenta como afectada.
- **Versiones de las fichas del editor**: las mismas reglas se aplican a las versiones que lista una ficha CVE.org. Una versión que KANAP no puede comparar con las del editor cuenta como afectada, y la columna **Match** de la exportación indica «Version not comparable». Ocurre cuando su versión lleva el nombre de un año y el editor numera sus componentes, por ejemplo `2021` frente a `106`. Compruebe entonces en la ficha del editor si su versión está afectada.
- **Sistemas operativos**: Red Hat Enterprise Linux, Debian, Oracle Linux, AlmaLinux, Rocky Linux, SUSE Linux Enterprise Server y CentOS se comparan por su versión principal, y Ubuntu por su año y mes, tal como los publica la NVD: `9.4` recibe las vulnerabilidades de `9`, y `22.04.3 LTS` las de `22.04`. IBM AIX, IBM i y Oracle Solaris se comparan por sus dos primeros números: `7.3.2` recibe las vulnerabilidades de `7.3`. Windows Server se compara solo por su año, porque KANAP no sabe qué actualizaciones tiene un servidor: una versión `2019` está afectada por todas las vulnerabilidades de Windows Server 2019, incluidas las que una actualización ya corrigió. 2012 y 2012 R2 se distinguen por su etiqueta, igual que 2008 y 2008 R2.
- **Versión desconocida**: un servidor o una aplicación que no indica ninguna versión está potencialmente afectado por todas las vulnerabilidades del producto. Su fila muestra **Sin registrar** en la columna **Versión**.
- **Distribuciones Linux**: una distribución publica sus vulnerabilidades por paquete. KANAP ve las vulnerabilidades que el editor asigna a una versión de la distribución. No ve los paquetes instalados en un servidor, ni su nivel de actualización. Para saber si un servidor está expuesto, compruebe el paquete en el seguimiento de seguridad del distribuidor: la tecnología lleva a él, bajo su tabla de versiones (consulte [Tecnologías](technologies.md#versiones-del-catalogo)).

Algunas vulnerabilidades solo se aplican cuando dos productos funcionan juntos, por ejemplo Tomcat en Windows. KANAP las muestra para el producto vulnerable solo, de modo que una puede aparecer para una instalación a la que no afecta. Márquela como **No afectada**.

Una fila existe en cuanto una de las dos fuentes la coteja. Cuando la NVD y el editor no dicen lo mismo, la fila se queda. La columna **Fuente** de la lista indica qué fuentes la cotejaron. Cuando la NVD aún no ha puntuado una vulnerabilidad, KANAP muestra la puntuación y la gravedad de la ficha del editor. Una vulnerabilidad que CVE.org o la NVD rechaza deja de cotejarse.

Los cambios cuentan de inmediato. Cuando añade una tecnología o un identificador de producto CPE, KANAP busca enseguida ese producto en la NVD; la sección **Vulnerabilidades** de la tecnología indica «Búsqueda de vulnerabilidades en curso…» hasta que termina la búsqueda. Cuando la búsqueda no se puede completar, la sección lo dice. Cuando cambia un nombre CVE.org, una versión, un servidor o una aplicación de una tecnología, KANAP vuelve a cotejar la tecnología en cuanto se guarda el cambio. **Actualizar**, en la sección **Vulnerabilidades** de la tecnología, hace lo mismo a mano.

## Alertas

Cada tecnología y cada versión está en las alertas de vulnerabilidad o fuera de ellas. Usted elige en la tecnología, en su tabla de versiones: el interruptor **Incluir en las alertas de vulnerabilidad** ajusta la tecnología, y la columna **Alertas** tiene un interruptor por versión. Consulte [Alertas de vulnerabilidad](technologies.md#alertas-de-vulnerabilidad). Una versión sigue el ajuste de su tecnología, salvo si tiene uno propio. Un servidor o una aplicación que no indica ninguna versión sigue a la tecnología.

Dos tipos de tecnologías están fuera de las alertas por defecto:

- **Sistemas operativos**: KANAP no conoce el nivel de parches de un servidor, así que un sistema operativo generaría un número muy grande de vulnerabilidades. La lista CVE.org añade muchas más: los editores de sistemas operativos listan la versión entera como afectada.
- **Servicios en la nube gestionados por un proveedor**: una tecnología alojada en cloud público o como SaaS, o una entrada del catálogo que el proveedor ejecuta. El proveedor corrige un servicio en línea, así que sus vulnerabilidades no le piden ninguna acción. Una tecnología en un cloud privado sigue en las alertas.

Puede volver a incluirlas en la tecnología. Para seguir una sola versión de un sistema operativo, por ejemplo la de sus servidores más expuestos, active su interruptor en la columna **Alertas** de la tabla de versiones. Las demás versiones siguen fuera de las alertas.

En SUSE Linux Enterprise Server, cambiar el interruptor de una versión base cambia igual los interruptores de sus service packs, y un service pack puede cambiarse después por separado.

Una versión fuera de las alertas se sigue cotejando con las vulnerabilidades. Sigue en la sección **Vulnerabilidades** de la tecnología, y sus filas siguen en esta página, con el filtro **Alertas**. Todo lo demás las deja fuera:

- Esta página solo muestra por defecto las filas en las alertas.
- Los correos solo anuncian las filas en las alertas.
- Las columnas **Vulnerabilidades por revisar** de las listas de tecnologías, activos y aplicaciones solo cuentan las filas en las alertas, igual que las fichas, las insignias y el mosaico del panel de control.

## Lo que KANAP cuenta { #what-kanap-counts }

Una vulnerabilidad alcanza un servidor o una aplicación solo por vínculos directos, en todas partes: en esta página, en las listas, en las fichas, en el panel de control y en Plaid.

- **Servidor**: la tecnología y la versión están registradas en el propio servidor. Un servidor retirado no se cuenta.
- **Clúster**: lo registrado en el propio clúster, más lo registrado en sus miembros en servicio. Un clúster cuenta las vulnerabilidades de sus miembros, en su columna de la lista, su insignia y su ficha. Filtrar esta página por un clúster muestra también las filas de sus miembros.
- **Aplicación**: la aplicación declara la tecnología y la versión, o uno de sus servidores de despliegue las tiene registradas en sí mismo. Una aplicación asignada a un clúster cuenta el clúster y sus miembros en servicio. Una tecnología a la vez declarada y alojada cuenta una vez. Una aplicación desactivada, o cuya fecha de desactivación ya pasó, no se cuenta.

Los recuentos por servidor y por aplicación, en las listas, en las fichas, en el panel de control y en Plaid, siguen las mismas reglas:

- **Qué vulnerabilidades**: las que siguen **Por revisar** y cuya tecnología o versión está en las alertas. Cada vulnerabilidad cuenta una vez, aunque afecte a varias versiones.
- **Gravedad**: la de la NVD, o la del editor (CVE.org) cuando la NVD aún no ha evaluado la vulnerabilidad. **Grave** significa crítica o alta.
- **Fuera de servicio**: un servidor retirado o una aplicación desactivada no cuenta nada. Su celda queda vacía.

Una máquina virtual o un invitado no cuenta las vulnerabilidades de su host. Una vulnerabilidad de VMware ESXi solo cuenta en los hosts ESXi. Contar a través de los hosts pondría una sola vulnerabilidad de un hipervisor en casi todos los servidores y aplicaciones de un parque virtualizado.

El alcance a través de otro activo sigue visible, sin contarse: en el panel lateral de una vulnerabilidad, bajo **A través de otro activo**, y en la ficha de un activo, bajo una línea cerrada **Plataforma subyacente (n)** de su sección **Vulnerabilidades**. Esa línea agrupa lo que solo viene de un host, como el ESXi del host en el que se ejecuta una máquina virtual. Consulte [Activos](assets.md#operations).

## La lista

La lista usa la cuadrícula estándar: una fila por tecnología, versión y vulnerabilidad. Las vulnerabilidades explotadas activamente van primero, y después las más graves. Una vulnerabilidad que afecta a tres versiones de SQL Server da tres filas, cada una con su propio estado. Se abre en las filas **Por revisar** que están en las alertas: vacíe el filtro de la columna **Estado** para ver los demás estados.

Una línea encima de la cuadrícula indica cuándo leyó KANAP cada fuente por última vez: **Datos leídos**, y después la NVD y los editores (CVE.org), cada uno con el día y la hora de su última lectura. Una fuente desactivada no aparece. Una advertencia sigue en la misma línea cuando la última lectura de una fuente falló, o cuando una fuente lleva más de 3 días sin leerse. Los datos de esa fuente pueden estar entonces desactualizados.

**Alertas**, **Publicada** y **Solo explotadas** están encima de la cuadrícula. **Alertas** elige las filas según su ajuste de alertas: **Incluidas** (por defecto), **Excluidas** o **Todas**. En **Todas**, las filas fuera de las alertas aparecen atenuadas. Cuando ninguna fila está en las alertas y algunas están excluidas, la lista vacía propone **Mostrar las excluidas**. **Publicada** conserva las vulnerabilidades según su fecha de publicación: **Todas** (por defecto), **Menos de 7 días**, **Menos de 30 días**, **Menos de 90 días**, **Menos de un año** o **Más de un año**. El período se cuenta desde hoy, así que un enlace guardado o compartido sigue mostrando las más recientes. **Solo explotadas** conserva las vulnerabilidades incluidas como explotadas activamente. La dirección lleva `exploited=1`. **Restablecer filtros** devuelve la página a su estado de apertura: las filas **Por revisar**, las vulnerabilidades explotadas activamente primero, **Alertas** en **Incluidas**, **Publicada** en todas las fechas y **Solo explotadas** desactivado. La exportación y un cambio de estado en bloque siguen estos tres ajustes.

**Columnas**:

| Columna | Qué muestra |
|---|---|
| **CVE** | El identificador de la vulnerabilidad, por ejemplo `CVE-2024-1234` |
| **Gravedad** | **Crítica**, **Alta**, **Media**, **Baja**, **Ninguna** o **Sin evaluar**. Un icono de alerta sigue al nombre cuando la CISA o la Unión Europea incluye la vulnerabilidad. Su información emergente nombra los catálogos, y el uso en ransomware cuando la CISA lo registra. Un icono de información marca una puntuación publicada por el editor: la NVD aún no ha evaluado la vulnerabilidad |
| **Explotada** | **Sí** o **No**. Oculta por defecto: el icono de **Gravedad** muestra el mismo hecho |
| **Puntuación** | La puntuación CVSS. Oculta por defecto |
| **EPSS (%)** | La probabilidad de explotación en los próximos 30 días, como porcentaje en el idioma de su pantalla. Por ejemplo, 15,3 %. El panel lateral añade el percentil |
| **Resumen** | La descripción de la vulnerabilidad |
| **Tecnología** | La tecnología afectada |
| **Versión** | La versión afectada. **Sin registrar** cuando un servidor o una aplicación usa la tecnología sin indicar su versión: la fila está entonces potencialmente afectada |
| **Editor** | El editor de la tecnología. Oculta por defecto |
| **Servidores** | Cuántos servidores en servicio tienen esta versión registrada en sí mismos, como los cuenta la [lista de tecnologías](technologies.md). Los clústeres y los servidores que se ejecutan dentro de otro no se cuentan. Consulte [Lo que KANAP cuenta](#what-kanap-counts) |
| **Aplicaciones** | Cuántas aplicaciones declaran esta versión o se ejecutan en un servidor que la tiene registrada |
| **Fuente** | Las fuentes que cotejaron la fila: **NVD**, **Editor** (la ficha que el editor publicó en CVE.org), o ambas |
| **Estado** | **Por revisar**, **Tratada** o **No afectada** |
| **Nota** | La nota de la fila. Oculta por defecto |
| **Publicación** | La fecha de publicación |

**Filtros**: cada columna tiene su propio filtro bajo su encabezado. **Servidores** y **Aplicaciones** listan los servidores y las aplicaciones que una vulnerabilidad alcanza por vínculos directos: busque uno por nombre o referencia y marque uno o varios. Varios valores conservan las filas de cualquiera de ellos, y un filtro en las dos columnas conserva las filas que cumplen ambos. El filtro **Aplicaciones** requiere el derecho de leer las aplicaciones. **Gravedad**, **Tecnología**, **Versión**, **Editor**, **Fuente**, **Estado** y **Explotada** ofrecen casillas (**Versión** ofrece también **Sin registrar**, **Explotada** ofrece **Sí** y **No**), **Puntuación** un número, **EPSS (%)** un porcentaje mínimo de 0 a 100, **Publicación** una fecha, **CVE** y **Resumen** un texto. **Fuente** ofrece **NVD**, **Editor** y **Ambas**: una fila que cotejaron las dos fuentes queda bajo **NVD** y bajo **Editor**, y **Ambas** solo conserva esas filas. La exportación y el cambio de estado en bloque lo siguen, como siguen los demás filtros de columna. El cuadro de búsqueda sobre la cuadrícula busca en el identificador CVE, el resumen y el nombre de la tecnología.

**Orden** por **Explotada**, **Gravedad**, **Puntuación**, **EPSS (%)**, **Publicación**, **CVE** o **Tecnología**. La lista se abre con las vulnerabilidades explotadas activamente, y después las más graves. El selector de columnas muestra u oculta columnas, y la cuadrícula recuerda su elección.

**Enlaces**: la página lee sus filtros en su dirección, de modo que puede compartir una lista filtrada. `?technology=TEC-4` conserva una tecnología, `?version=none` las filas sin versión registrada, `?state=all` todos los estados, `?published=30d` las vulnerabilidades publicadas en los últimos 30 días (`7d`, `30d`, `90d`, `1y` u `older1y`, como el filtro **Publicada**), `?period=30` lo mismo mediante el filtro de la columna **Publicada**, `?alerts=excluded` o `?alerts=all` las filas fuera de las alertas, `?exploited=1` las vulnerabilidades explotadas activamente. El enlace de los correos usa `period`.

**Activo y aplicación**: `?asset=AST-12` abre la página con el filtro de la columna **Servidores** puesto en un activo, y `?application=APP-4` con el filtro de la columna **Aplicaciones** puesto en una aplicación, por vínculos directos (consulte [Lo que KANAP cuenta](#what-kanap-counts)). Las listas de activos y aplicaciones y sus fichas abren la página así. Vacíe el filtro de la columna para ver las demás filas. Para filtrar por una aplicación, debe poder leerla.

**En uso en el parque**: `?estate=1` conserva las vulnerabilidades de las tecnologías instaladas en un activo en servicio o declaradas por una aplicación en servicio. Los enlaces a CVE del mosaico **Vulnerabilidades del parque** del panel de control abren la página con este filtro. Una línea sobre la cuadrícula muestra **En uso en el parque · quitar**. **quitar** lo elimina.

**Restablecer filtros** también elimina estos dos filtros. La exportación y el cambio de estado en bloque los siguen.

## Cambiar el estado de varias filas

Con `infrastructure:member`, marque las filas que quiere cambiar. La casilla del encabezado selecciona todas las filas del filtro, incluidas las que aún no se han cargado; después puede desmarcar algunas. Un aviso sobre la cuadrícula indica cuántas filas están seleccionadas, y **Quitar la selección** la vacía.

**Cambiar el estado (n)** pide entonces:

- El **Estado** que se va a establecer.
- Una **Nota común**, opcional. Sin nota, cada fila conserva la suya.

Antes de que confirme, la ventana indica cuántas filas toca el cambio, en cuántas vulnerabilidades. Una fila encontrada después de este recuento queda como estaba. Por encima de 5000 filas, acote los filtros o seleccione menos filas.

Por ejemplo, para marcar todas las versiones sin registrar de PostgreSQL como no afectadas: filtre **Tecnología** por PostgreSQL y **Versión** por **Sin registrar**, marque la casilla del encabezado, haga clic en **Cambiar el estado**, elija **No afectada** y escriba el motivo en la nota.

## Revisar una vulnerabilidad

Haga clic en una fila para abrir su vulnerabilidad en un panel lateral. Su encabezado queda visible, con el identificador CVE, la gravedad, el icono de información cuando la puntuación viene del editor, y el icono de alerta cuando la vulnerabilidad está explotada activamente. **Cerrar** (la cruz) o Esc cierra el panel. El panel abarca todas las tecnologías y versiones a las que afecta la vulnerabilidad. Verá, en este orden:

- **Tecnologías y versiones**: cada versión afectada, con su **Estado** y una nota. Bajo cada versión, las insignias de las fuentes que la cotejaron. **Por qué esta fila** abre los criterios de cada fuente en lenguaje claro, por ejemplo «Identificador CPE a:apache:tomcat: versiones anteriores a 9.0.99» para la NVD, o «Apache Software Foundation · Apache Tomcat: versiones 9.0.0 a 9.0.98 afectadas» para el editor.
- La descripción, cortada a tres líneas (**Ver más** muestra el resto), el vector CVSS y los enlaces de referencia (avisos del editor, parches).
- **Fuentes**: el estado de la vulnerabilidad en la NVD (**analizada**, **pendiente de análisis**, **no analizada**, **rechazada** o **aún no vinculada a este producto**), con un enlace a su ficha de la NVD. Cuando KANAP ha leído la ficha del editor, una segunda línea indica quién la publicó y cuándo, su última actualización, y **Ver en CVE.org**.
- **Explotación**, cuando se conoce un catálogo, una puntuación EPSS o un identificador europeo. Consulte [Explotación](#exploitation).
- **Servidores**: cada servidor que tiene una versión afectada registrada en sí mismo, con la tecnología y la versión. Los servidores alcanzados a través de otro activo, como una máquina virtual en un host o un clúster a través de sus miembros, quedan ocultos tras un botón, por ejemplo **Mostrar también los 4 servidores alcanzados a través de otro activo**. Aparecen bajo su propio título, **A través de otro activo**, con el activo por el que se alcanzan. No se cuentan.
- **Aplicaciones**: cada aplicación que usa una versión afectada, listada una vez por versión con sus servidores (tres como máximo, y después «y 2 más»). Una aplicación que declara la tecnología, o que se ejecuta en un servidor que la tiene registrada, va primero. Las demás quedan tras el mismo tipo de botón y no se cuentan.

Cuando ningún servidor o ninguna aplicación está afectado directamente, el panel lo indica, y el botón sigue mostrando los demás.

Una versión fuera de las alertas aparece atenuada, con sus servidores y aplicaciones. Cuando solo una parte está en las alertas, una línea encima de la lista indica cuántos, por ejemplo «3 servidores, de ellos 1 en las alertas».

Establezca el estado de cada versión:

| Estado | Significado |
|---|---|
| **Por revisar** | Nadie la ha examinado todavía |
| **Tratada** | La versión está parcheada, o hay una solución alternativa en marcha |
| **No afectada** | La vulnerabilidad no se aplica a su instalación |

La nota registra cómo, por ejemplo «parcheado el 12 de marzo, cambio CHG-123». Se guarda al salir del campo. El registro de auditoría conserva quién cambió un estado y cuándo. También puede pedir a [Plaid](#preguntar-al-asistente) que cambie un estado.

KANAP nunca cambia un estado que usted eligió. Cuando una versión deja de coincidir (la actualizó, la tecnología se retiró, una fuente cambió sus datos), una fila aún **Por revisar** desaparece. Una fila que usted revisó se queda, en gris, con su estado; vuelve tal cual si la versión coincide de nuevo.

## Explotación { #exploitation }

Una vulnerabilidad está **explotada activamente** cuando el catálogo de la CISA (Estados Unidos) o el de la Unión Europea la incluye, o ambos. Un icono de alerta aparece junto a la gravedad, en la lista y en el panel lateral. Su información emergente nombra los catálogos que incluyen la vulnerabilidad. Cuando la CISA registra un uso en campañas de ransomware, la información emergente lo indica.

El **EPSS** es la probabilidad de que la vulnerabilidad se explote en los próximos 30 días. [FIRST](https://www.first.org/epss) la calcula cada día. La columna **EPSS (%)** la muestra como porcentaje. El panel lateral añade el percentil de ese día cuando FIRST publica uno, y el día de la puntuación. El panel nombra el método: EPSS: FIRST.

El panel lateral muestra también el identificador **EUVD** cuando la correspondencia europea tiene uno, con el enlace **Ver en la base europea de vulnerabilidades (ENISA)**. La base europea de vulnerabilidades de la ENISA es el catálogo europeo que se usa al revisar vulnerabilidades en el ámbito de NIS2. El panel nombra la fuente: ENISA, base europea de vulnerabilidades.

La lista se abre con las vulnerabilidades explotadas activamente, y después las más graves. **Solo explotadas**, encima de la cuadrícula, conserva esas filas (`?exploited=1`). **Restablecer filtros** lo desactiva. La exportación y un cambio de estado en bloque lo siguen.

El correo a los responsables de TI anuncia una vulnerabilidad explotada de cualquier gravedad, en las versiones en las alertas, con las mismas reglas que una crítica o alta: publicada en los últimos 30 días, sobre un producto con el que la tecnología ya se comparaba, aún por revisar. Una vulnerabilidad ya detectada que entra después en un catálogo se anuncia una vez, como ahora explotada, si está en las alertas.

## Exportación

**Exportar** descarga las vulnerabilidades que cumplen los filtros como archivo CSV o Excel, una fila por fila de la cuadrícula, en su orden, en el idioma de su pantalla. En el archivo Excel, las puntuaciones, el EPSS y las fechas son valores que Excel puede ordenar y filtrar. Su columna **Source**, después de **Match**, da `NVD`, `CVE.org` o `NVD, CVE.org`. Por encima de 10 000 vulnerabilidades, acote primero los filtros.

## Notificaciones por correo electrónico

Tras cada comprobación, los responsables de TI de una tecnología reciben un correo sobre sus nuevas vulnerabilidades aún por revisar, en las versiones en las alertas. El correo incluye una vulnerabilidad crítica o alta, o con explotación conocida de cualquier gravedad:

- **Qué se anuncia**: una vulnerabilidad publicada en los últimos 30 días sobre un producto con el que la tecnología ya se comparaba, cuando es crítica, alta o está incluida como explotada, o una vulnerabilidad conocida que acaba de pasar a crítica o alta.
- **Qué no**: la primera comparación de una tecnología, o de un identificador CPE o un nombre CVE.org que acaba de añadir, es silenciosa. También lo es la primera comparación de una tecnología con la lista CVE.org. Sus resultados esperan en esta página.
- **Cuánto**: 25 líneas como máximo, una por tecnología y vulnerabilidad, y después un enlace a la página, filtrada en las vulnerabilidades publicadas en los últimos 30 días.
- **Cuántas veces**: cada persona recibe aviso de una vulnerabilidad en una tecnología una sola vez. Una vulnerabilidad no anunciada en su comprobación no se anuncia nunca más tarde.

Los destinatarios son los responsables de TI de la tecnología cuya cuenta está activa y que pueden leer la infraestructura. Cada uno puede desactivar estos correos en **Notificaciones de tecnologías**, en sus ajustes de notificación. Consulte [Configuración](admin.md#notificaciones). No sale ningún correo mientras el envío de correo no esté configurado en su instalación.

## Dónde aparecen también las vulnerabilidades

- **Lista de tecnologías**: la columna **Vulnerabilidades por revisar**, en naranja cuando algunas son críticas o altas. Consulte [Tecnologías](technologies.md#trabajar-con-la-lista).
- **Espacio de trabajo de la tecnología**: la sección **Vulnerabilidades** de la pestaña Cumplimiento. Consulte [Tecnologías](technologies.md#vulnerabilidades).
- **Listas de activos y aplicaciones**: la columna **Vulnerabilidades por revisar**. Consulte [Activos](assets.md#working-with-the-list) y [Aplicaciones](applications.md#working-with-the-list).
- **Fichas de activo y aplicación**: la sección **Vulnerabilidades** y la insignia de vulnerabilidades graves en el encabezado. Consulte [Activos](assets.md#operations) y [Aplicaciones](applications.md#operations).
- **Panel de control**: el mosaico **Vulnerabilidades del parque**. Consulte [Mi panel de control](my-dashboard.md#vulnerabilities).
- **Plaid**: el asistente responde a preguntas sobre vulnerabilidades y cambia su estado. Consulte [Preguntar al asistente](#preguntar-al-asistente).

## Preguntar al asistente

[Plaid](ai-assistant.md) lee las vulnerabilidades con los mismos derechos que esta página. Cuenta las filas y las CVE distintas, como la página, conserva las tecnologías en uso en el parque cuando usted lo pide, y dice cuándo leyó KANAP cada fuente por última vez. Pregunte, por ejemplo: «¿Cuántas vulnerabilidades críticas quedan por revisar en PostgreSQL, por versión?» o «¿Qué CVE explotadas alcanzan APP-4?»

Con `infrastructure:member`, Plaid también cambia el estado de las filas, y cada cambio llega como una vista previa que usted aprueba:

- Nombre una CVE para cambiar todas sus filas, o añada una tecnología, o una tecnología y una versión.
- O describa las filas con los filtros de la página, por ejemplo las filas críticas de una tecnología.
- Dé una nota para escribirla en cada fila. Sin nota, cada fila conserva la suya.

Un cambio abarca 5000 filas como máximo, como **Cambiar el estado**. La vista previa dice cuántas filas y CVE cambian, y cuántas están fuera de las alertas. Cuando filas que ya no coinciden vuelven a **Por revisar**, las cuenta: desaparecen en el siguiente cotejo. **Aceptada** no es un estado: Plaid propone **Tratada** con una nota como «riesgo aceptado», o **No afectada**, y espera su elección. Pida a Plaid que deshaga un cambio que hizo en la conversación. Lo rechaza cuando una fila cambió desde entonces.

Pregunte, por ejemplo: «Marca CVE-2024-3094 como no afectada en TEC-3 versión 5.6, el paquete no está instalado» o «Pasa las filas críticas de PostgreSQL 14 a tratada con la nota "parcheado en marzo"».

El nuevo cotejo (**Actualizar**) se queda en la sección **Vulnerabilidades** de la tecnología. Consulte [Tecnologías](technologies.md#vulnerabilidades).

## Consejos

- **Rellene los identificadores CPE**: la mayoría de las tecnologías del catálogo ya los traen, incluidos los sistemas operativos. Para las demás, busque el producto en el diccionario CPE del NIST.
- **Añada los nombres CVE.org**: aportan vulnerabilidades que la NVD no ha analizado. Muchas tecnologías del catálogo ya los traen.
- **Registre las versiones**: un servidor o una aplicación sin versión está potencialmente afectado por todo, lo que oculta la exposición real.
- **Escriba la nota**: quien lea la vulnerabilidad después verá lo que se hizo.
