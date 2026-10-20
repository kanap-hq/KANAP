# Vulnerabilidades

La página Vulnerabilidades lista las vulnerabilidades publicadas (CVE) que afectan a las versiones de sus tecnologías en uso, y lo que alcanza cada una: los servidores que llevan una versión afectada y las aplicaciones que la usan. Usted revisa cada vulnerabilidad y anota lo que hizo al respecto.

Ábrala desde **Panorama IT > Vulnerabilidades**, en el grupo **Operaciones**. Necesita `infrastructure:reader` para consultarla e `infrastructure:member` para cambiar un estado. Los recuentos y las listas de aplicaciones solo aparecen si también puede leer las aplicaciones.

## Disponibilidad

Las vulnerabilidades se siguen por defecto en la nube. En una instalación local están desactivadas hasta que su administrador [las activa](on-premise/configuration.md#optional-vulnerabilities), y el servidor debe entonces alcanzar la NVD (la base de datos nacional de vulnerabilidades de Estados Unidos) o una réplica de ella. El mismo interruptor lee también tres fuentes de explotación, o una réplica de cada una: el catálogo de la CISA, la base europea de vulnerabilidades de la ENISA y las puntuaciones EPSS del día. Mientras están desactivadas, KANAP no muestra nada de ello: ni página, ni columna en la lista de tecnologías, ni sección en una tecnología, ni ajuste de notificación, ni correo.

## Cómo las encuentra KANAP

KANAP lee cada 6 horas las vulnerabilidades publicadas por la NVD y las compara con sus tecnologías:

- **Productos**: una tecnología se compara por sus identificadores de producto CPE (consulte [Tecnologías](technologies.md#resumen)). Una tecnología sin ninguno no recibe ninguna vulnerabilidad. Los sistemas operativos del catálogo también los tienen. SUSE Linux Enterprise Server no tiene: la NVD publica demasiado pocas de sus vulnerabilidades para un cotejo fiable. Las tecnologías retiradas quedan fuera.
- **Versiones**: solo cuentan las versiones en uso: instaladas en un servidor en servicio, o usadas por una aplicación en servicio.
- **Números de versión**: las versiones se comparan por sus números, parte por parte. `2016 SP3` cuenta como 2016 y `19c` como 19. Una versión de menos de tres números vale por toda su rama: `9.0` abarca todas las `9.0.x`. Una versión que KANAP no puede comparar, como una etiqueta sin número, cuenta como afectada.
- **Sistemas operativos**: Red Hat Enterprise Linux, Debian, Oracle Linux, AlmaLinux, Rocky Linux y CentOS se comparan por su versión principal, y Ubuntu por su año y mes, tal como los publica la NVD: `9.4` recibe las vulnerabilidades de `9`, y `22.04.3 LTS` las de `22.04`. Windows Server se compara solo por su año, porque KANAP no sabe qué actualizaciones tiene un servidor: una versión `2019` está afectada por todas las vulnerabilidades de Windows Server 2019, incluidas las que una actualización ya corrigió. 2012 y 2012 R2 se distinguen por su etiqueta, igual que 2008 y 2008 R2.
- **Versión desconocida**: un servidor o una aplicación que no indica ninguna versión está potencialmente afectado por todas las vulnerabilidades del producto. Su fila muestra **Sin registrar** en la columna **Versión**.

Algunas vulnerabilidades solo se aplican cuando dos productos funcionan juntos, por ejemplo Tomcat en Windows. KANAP las muestra para el producto vulnerable solo, de modo que una puede aparecer para una instalación a la que no afecta. Márquela como **No afectada**.

Una vulnerabilidad que la NVD aún no ha analizado aparece en cuanto se analiza.

Los cambios cuentan de inmediato. Cuando añade una tecnología o un identificador de producto CPE, KANAP busca enseguida ese producto en la NVD; la sección **Vulnerabilidades** de la tecnología indica «Búsqueda de vulnerabilidades en curso…» hasta que termina la búsqueda. Cuando cambia una versión, un servidor o una aplicación de una tecnología, KANAP vuelve a cotejar la tecnología en cuanto se guarda el cambio. **Actualizar**, en la sección **Vulnerabilidades** de la tecnología, hace lo mismo a mano.

## Alertas

Cada tecnología y cada versión está en las alertas de vulnerabilidad o fuera de ellas. Usted elige en la tecnología, en su tabla de versiones: el interruptor **Incluir en las alertas de vulnerabilidad** ajusta la tecnología, y la columna **Alertas** tiene un interruptor por versión. Consulte [Alertas de vulnerabilidad](technologies.md#alertas-de-vulnerabilidad). Una versión sigue el ajuste de su tecnología, salvo si tiene uno propio. Un servidor o una aplicación que no indica ninguna versión sigue a la tecnología.

Dos tipos de tecnologías están fuera de las alertas por defecto:

- **Sistemas operativos**: KANAP no conoce el nivel de parches de un servidor, así que un sistema operativo generaría un número muy grande de vulnerabilidades.
- **Servicios en la nube gestionados por un proveedor**: una tecnología alojada en cloud público o como SaaS, o una entrada del catálogo que el proveedor ejecuta. El proveedor corrige un servicio en línea, así que sus vulnerabilidades no le piden ninguna acción. Una tecnología en un cloud privado sigue en las alertas.

Puede volver a incluirlas en la tecnología.

Una versión fuera de las alertas se sigue cotejando con las vulnerabilidades. Sigue en la sección **Vulnerabilidades** de la tecnología, y sus filas siguen en esta página, con el filtro **Alertas**. Todo lo demás las deja fuera:

- Esta página solo muestra por defecto las filas en las alertas.
- Los correos solo anuncian las filas en las alertas.
- La columna **Vulnerabilidades por revisar** de la lista de tecnologías solo cuenta las filas en las alertas.

## La lista

La lista usa la cuadrícula estándar: una fila por tecnología, versión y vulnerabilidad. Las vulnerabilidades explotadas activamente van primero, y después las más graves. Una vulnerabilidad que afecta a tres versiones de SQL Server da tres filas, cada una con su propio estado. Se abre en las filas **Por revisar** que están en las alertas: vacíe el filtro de la columna **Estado** para ver los demás estados.

**Alertas**, **Publicada** y **Solo explotadas** están encima de la cuadrícula. **Alertas** elige las filas según su ajuste de alertas: **Incluidas** (por defecto), **Excluidas** o **Todas**. En **Todas**, las filas fuera de las alertas aparecen atenuadas. Cuando ninguna fila está en las alertas y algunas están excluidas, la lista vacía propone **Mostrar las excluidas**. **Publicada** conserva las vulnerabilidades según su fecha de publicación en la NVD: **Todas** (por defecto), **Menos de 7 días**, **Menos de 30 días**, **Menos de 90 días**, **Menos de un año** o **Más de un año**. El período se cuenta desde hoy, así que un enlace guardado o compartido sigue mostrando las más recientes. **Solo explotadas** conserva las vulnerabilidades incluidas como explotadas activamente. La dirección lleva `exploited=1`. **Restablecer filtros** devuelve la página a su estado de apertura: las filas **Por revisar**, las vulnerabilidades explotadas activamente primero, **Alertas** en **Incluidas**, **Publicada** en todas las fechas y **Solo explotadas** desactivado. La exportación y un cambio de estado en bloque siguen estos tres ajustes.

**Columnas**:

| Columna | Qué muestra |
|---|---|
| **CVE** | El identificador de la vulnerabilidad, por ejemplo `CVE-2024-1234` |
| **Gravedad** | **Crítica**, **Alta**, **Media**, **Baja**, **Ninguna** o **Sin evaluar**. Un icono de alerta sigue al nombre cuando la CISA o la Unión Europea incluye la vulnerabilidad. Su información emergente nombra los catálogos, y el uso en ransomware cuando la CISA lo registra |
| **Explotada** | **Sí** o **No**. Oculta por defecto: el icono de **Gravedad** muestra el mismo hecho |
| **Puntuación** | La puntuación CVSS. Oculta por defecto |
| **EPSS (%)** | La probabilidad de explotación en los próximos 30 días, como porcentaje en el idioma de su pantalla. Por ejemplo, 15,3 %. El panel lateral añade el percentil |
| **Resumen** | La descripción de la NVD |
| **Tecnología** | La tecnología afectada |
| **Versión** | La versión afectada. **Sin registrar** cuando un servidor o una aplicación usa la tecnología sin indicar su versión: la fila está entonces potencialmente afectada |
| **Editor** | El editor de la tecnología. Oculta por defecto |
| **Servidores** | Cuántos servidores llevan esta versión, directamente o a través del servidor en el que se ejecutan |
| **Aplicaciones** | Cuántas aplicaciones usan esta versión, alojadas o declaradas |
| **Estado** | **Por revisar**, **Tratada** o **No afectada** |
| **Nota** | La nota de la fila. Oculta por defecto |
| **Publicación** | La fecha de publicación |

**Filtros**: cada columna tiene su propio filtro bajo su encabezado. **Gravedad**, **Tecnología**, **Versión**, **Editor**, **Estado** y **Explotada** ofrecen casillas (**Versión** ofrece también **Sin registrar**, **Explotada** ofrece **Sí** y **No**), **Puntuación** un número, **EPSS (%)** un porcentaje mínimo de 0 a 100, **Publicación** una fecha, **CVE** y **Resumen** un texto. El cuadro de búsqueda sobre la cuadrícula busca en el identificador CVE, el resumen y el nombre de la tecnología.

**Orden** por **Explotada**, **Gravedad**, **Puntuación**, **EPSS (%)**, **Publicación**, **CVE** o **Tecnología**. La lista se abre con las vulnerabilidades explotadas activamente, y después las más graves. El selector de columnas muestra u oculta columnas, y la cuadrícula recuerda su elección.

**Enlaces**: la página lee sus filtros en su dirección, de modo que puede compartir una lista filtrada. `?technology=TEC-4` conserva una tecnología, `?version=none` las filas sin versión registrada, `?state=all` todos los estados, `?published=30d` las vulnerabilidades publicadas en los últimos 30 días (`7d`, `30d`, `90d`, `1y` u `older1y`, como el filtro **Publicada**), `?period=30` lo mismo mediante el filtro de la columna **Publicada**, `?alerts=excluded` o `?alerts=all` las filas fuera de las alertas, `?exploited=1` las vulnerabilidades explotadas activamente. El enlace de los correos usa `period`.

## Cambiar el estado de varias filas

Con `infrastructure:member`, marque las filas que quiere cambiar. La casilla del encabezado selecciona todas las filas del filtro, incluidas las que aún no se han cargado; después puede desmarcar algunas. Un aviso sobre la cuadrícula indica cuántas filas están seleccionadas, y **Quitar la selección** la vacía.

**Cambiar el estado (n)** pide entonces:

- El **Estado** que se va a establecer.
- Una **Nota común**, opcional. Sin nota, cada fila conserva la suya.

Antes de que confirme, la ventana indica cuántas filas toca el cambio, en cuántas vulnerabilidades. Una fila encontrada después de este recuento queda como estaba. Por encima de 5000 filas, acote los filtros o seleccione menos filas.

Por ejemplo, para marcar todas las versiones sin registrar de PostgreSQL como no afectadas: filtre **Tecnología** por PostgreSQL y **Versión** por **Sin registrar**, marque la casilla del encabezado, haga clic en **Cambiar el estado**, elija **No afectada** y escriba el motivo en la nota.

## Revisar una vulnerabilidad

Haga clic en una fila para abrir su vulnerabilidad en un panel lateral. Su encabezado queda visible, con el identificador CVE, la gravedad y el icono de alerta cuando la vulnerabilidad está explotada activamente. **Cerrar** (la cruz) o Esc cierra el panel. El panel abarca todas las tecnologías y versiones a las que afecta la vulnerabilidad. Verá:

- El resumen, el vector CVSS y los enlaces de referencia (avisos del editor, parches).
- **Tecnologías y versiones**: cada versión afectada, con su **Estado** y una nota.
- **Servidores**: cada servidor que lleva una versión afectada, con la tecnología, la versión y el servidor en el que se ejecuta.
- **Aplicaciones**: cada aplicación que usa una versión afectada, con su servidor.
- **Explotación**, cuando se conoce un catálogo, una puntuación EPSS o un identificador europeo. Consulte [Explotación](#exploitation).

Una versión fuera de las alertas aparece atenuada, con sus servidores y aplicaciones. Cuando solo una parte está en las alertas, una línea encima de la lista indica cuántos, por ejemplo «3 servidores, de ellos 1 en las alertas».

Establezca el estado de cada versión:

| Estado | Significado |
|---|---|
| **Por revisar** | Nadie la ha examinado todavía |
| **Tratada** | La versión está parcheada, o hay una solución alternativa en marcha |
| **No afectada** | La vulnerabilidad no se aplica a su instalación |

La nota registra cómo, por ejemplo «parcheado el 12 de marzo, cambio CHG-123». Se guarda al salir del campo. El registro de auditoría conserva quién cambió un estado y cuándo.

KANAP nunca cambia un estado que usted eligió. Cuando una versión deja de coincidir (la actualizó, la tecnología se retiró, la NVD cambió sus datos), una fila aún **Por revisar** desaparece. Una fila que usted revisó se queda, en gris, con su estado; vuelve tal cual si la versión coincide de nuevo.

## Explotación { #exploitation }

Una vulnerabilidad está **explotada activamente** cuando el catálogo de la CISA (Estados Unidos) o el de la Unión Europea la incluye, o ambos. Un icono de alerta aparece junto a la gravedad, en la lista y en el panel lateral. Su información emergente nombra los catálogos que incluyen la vulnerabilidad. Cuando la CISA registra un uso en campañas de ransomware, la información emergente lo indica.

El **EPSS** es la probabilidad de que la vulnerabilidad se explote en los próximos 30 días. [FIRST](https://www.first.org/epss) la calcula cada día. La columna **EPSS (%)** la muestra como porcentaje. El panel lateral añade el percentil de ese día cuando FIRST publica uno, y el día de la puntuación. El panel nombra el método: EPSS: FIRST.

El panel lateral muestra también el identificador **EUVD** cuando la correspondencia europea tiene uno, con el enlace **Ver en la base europea de vulnerabilidades (ENISA)**. La base europea de vulnerabilidades de la ENISA es el catálogo europeo que se usa al revisar vulnerabilidades en el ámbito de NIS2. El panel nombra la fuente: ENISA, base europea de vulnerabilidades.

La lista se abre con las vulnerabilidades explotadas activamente, y después las más graves. **Solo explotadas**, encima de la cuadrícula, conserva esas filas (`?exploited=1`). **Restablecer filtros** lo desactiva. La exportación y un cambio de estado en bloque lo siguen.

El correo a los responsables de TI anuncia una vulnerabilidad explotada de cualquier gravedad, en las versiones en las alertas, con las mismas reglas que una crítica o alta: publicada en los últimos 30 días, sobre un producto con el que la tecnología ya se comparaba, aún por revisar. Una vulnerabilidad ya detectada que entra después en un catálogo se anuncia una vez, como ahora explotada, si está en las alertas.

## Exportación

**Exportar CSV** descarga las vulnerabilidades que cumplen los filtros, una fila por fila de la cuadrícula, en su orden, en el idioma de su pantalla. Por encima de 10 000 vulnerabilidades, acote primero los filtros.

## Notificaciones por correo electrónico

Tras cada comprobación, los responsables de TI de una tecnología reciben un correo sobre sus nuevas vulnerabilidades aún por revisar, en las versiones en las alertas. El correo incluye una vulnerabilidad crítica o alta, o con explotación conocida de cualquier gravedad:

- **Qué se anuncia**: una vulnerabilidad publicada en los últimos 30 días sobre un producto con el que la tecnología ya se comparaba, cuando es crítica, alta o está incluida como explotada, o una vulnerabilidad conocida que acaba de pasar a crítica o alta.
- **Qué no**: la primera comparación de una tecnología, o de un identificador CPE que acaba de añadir, es silenciosa. Sus resultados esperan en esta página.
- **Cuánto**: 25 líneas como máximo, una por tecnología y vulnerabilidad, y después un enlace a la página, filtrada en las vulnerabilidades publicadas en los últimos 30 días.
- **Cuántas veces**: cada persona recibe aviso de una vulnerabilidad en una tecnología una sola vez. Una vulnerabilidad no anunciada en su comprobación no se anuncia nunca más tarde.

Los destinatarios son los responsables de TI de la tecnología cuya cuenta está activa y que pueden leer la infraestructura. Cada uno puede desactivar estos correos en **Notificaciones de tecnologías**, en sus ajustes de notificación. Consulte [Configuración](admin.md#notificaciones). No sale ningún correo mientras el envío de correo no esté configurado en su instalación.

## Dónde aparecen también las vulnerabilidades

- **Lista de tecnologías**: la columna **Vulnerabilidades por revisar**, en naranja cuando algunas son críticas o altas. Consulte [Tecnologías](technologies.md#trabajar-con-la-lista).
- **Espacio de trabajo de la tecnología**: la sección **Vulnerabilidades** de la pestaña Cumplimiento. Consulte [Tecnologías](technologies.md#vulnerabilidades).

## Consejos

- **Rellene los identificadores CPE**: la mayoría de las tecnologías del catálogo ya los traen, incluidos los sistemas operativos. SUSE Linux Enterprise Server no tiene. Para las demás, busque el producto en el diccionario CPE del NIST.
- **Registre las versiones**: un servidor o una aplicación sin versión está potencialmente afectado por todo, lo que oculta la exposición real.
- **Escriba la nota**: quien lea la vulnerabilidad después verá lo que se hizo.
