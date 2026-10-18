# Vulnerabilidades

La página Vulnerabilidades lista las vulnerabilidades publicadas (CVE) que afectan a las versiones de sus tecnologías en uso, y lo que alcanza cada una: los servidores que llevan una versión afectada y las aplicaciones que la usan. Usted revisa cada vulnerabilidad y anota lo que hizo al respecto.

Ábrala desde **Panorama IT > Vulnerabilidades**, en el grupo **Operaciones**. Necesita `infrastructure:reader` para consultarla e `infrastructure:member` para cambiar un estado. Los recuentos y las listas de aplicaciones solo aparecen si también puede leer las aplicaciones.

## Disponibilidad

Las vulnerabilidades se siguen por defecto en la nube. En una instalación local están desactivadas hasta que su administrador [las activa](on-premise/configuration.md#optional-vulnerabilities), y el servidor debe entonces alcanzar la NVD (la base de datos nacional de vulnerabilidades de Estados Unidos) o una réplica de ella. Mientras están desactivadas, KANAP no muestra nada de ello: ni página, ni columna en la lista de tecnologías, ni sección en una tecnología, ni ajuste de notificación, ni correo.

## Cómo las encuentra KANAP

KANAP lee cada 6 horas las vulnerabilidades publicadas por la NVD y las compara con sus tecnologías:

- **Productos**: una tecnología se compara por sus identificadores de producto CPE (consulte [Tecnologías](technologies.md#resumen)). Una tecnología sin ninguno no recibe ninguna vulnerabilidad. Las tecnologías retiradas quedan fuera.
- **Versiones**: solo cuentan las versiones en uso: instaladas en un servidor en servicio, o usadas por una aplicación en servicio.
- **Números de versión**: las versiones se comparan por sus números, parte por parte. `2016 SP3` cuenta como 2016 y `19c` como 19. Una versión de menos de tres números vale por toda su rama: `9.0` abarca todas las `9.0.x`. Una versión que KANAP no puede comparar, como una etiqueta sin número, cuenta como afectada.
- **Versión desconocida**: un servidor o una aplicación que no indica ninguna versión está potencialmente afectado por todas las vulnerabilidades del producto. Su fila muestra **Sin registrar** en la columna **Versión**.

Algunas vulnerabilidades solo se aplican cuando dos productos funcionan juntos, por ejemplo Tomcat en Windows. KANAP las muestra para el producto vulnerable solo, de modo que una puede aparecer para una instalación a la que no afecta. Márquela como **No afectada**.

Una vulnerabilidad que la NVD aún no ha analizado aparece en cuanto se analiza.

Los cambios cuentan de inmediato. Cuando añade una tecnología o un identificador de producto CPE, KANAP busca enseguida ese producto en la NVD; la sección **Vulnerabilidades** de la tecnología indica «Búsqueda de vulnerabilidades en curso…» hasta que termina la búsqueda. Cuando cambia una versión, un servidor o una aplicación de una tecnología, KANAP vuelve a cotejar la tecnología en cuanto se guarda el cambio. **Volver a cotejar** en la tecnología hace lo mismo a mano.

## La lista

La lista usa la cuadrícula estándar: una fila por tecnología, versión y vulnerabilidad, la más grave primero. Una vulnerabilidad que afecta a tres versiones de SQL Server da tres filas, cada una con su propio estado. Se abre en las filas **Por revisar**: vacíe el filtro de la columna **Estado** para ver las demás.

**Columnas**:

| Columna | Qué muestra |
|---|---|
| **CVE** | El identificador de la vulnerabilidad, por ejemplo `CVE-2024-1234` |
| **Gravedad** | **Crítica**, **Alta**, **Media**, **Baja**, **Ninguna** o **Sin evaluar** |
| **Puntuación** | La puntuación CVSS. Oculta por defecto |
| **Resumen** | La descripción de la NVD |
| **Tecnología** | La tecnología afectada |
| **Versión** | La versión afectada. **Sin registrar** cuando un servidor o una aplicación usa la tecnología sin indicar su versión: la fila está entonces potencialmente afectada |
| **Editor** | El editor de la tecnología. Oculta por defecto |
| **Servidores** | Cuántos servidores llevan esta versión, directamente o a través del servidor en el que se ejecutan |
| **Aplicaciones** | Cuántas aplicaciones usan esta versión, alojadas o declaradas |
| **Estado** | **Por revisar**, **Tratada** o **No afectada** |
| **Nota** | La nota de la fila. Oculta por defecto |
| **Publicación** | La fecha de publicación |

**Filtros**: cada columna tiene su propio filtro bajo su encabezado. **Gravedad**, **Tecnología**, **Versión**, **Editor** y **Estado** ofrecen casillas (**Versión** ofrece también **Sin registrar**), **Puntuación** un número, **Publicación** una fecha, **CVE** y **Resumen** un texto. El cuadro de búsqueda sobre la cuadrícula busca en el identificador CVE, el resumen y el nombre de la tecnología.

**Orden** por **Gravedad**, **Puntuación**, **Publicación**, **CVE** o **Tecnología**. El selector de columnas muestra u oculta columnas, y la cuadrícula recuerda su elección.

**Enlaces**: la página lee sus filtros en su dirección, de modo que puede compartir una lista filtrada. `?technology=TEC-4` conserva una tecnología, `?version=none` las filas sin versión registrada, `?state=all` todos los estados, `?period=30` las vulnerabilidades publicadas en los últimos 30 días. El enlace de los correos usa `period`.

## Cambiar el estado de varias filas

Con `infrastructure:member`, marque las filas que quiere cambiar. La casilla del encabezado selecciona todas las filas del filtro, incluidas las que aún no se han cargado; después puede desmarcar algunas. Un aviso sobre la cuadrícula indica cuántas filas están seleccionadas, y **Quitar la selección** la vacía.

**Cambiar el estado (n)** pide entonces:

- El **Estado** que se va a establecer.
- Una **Nota común**, opcional. Sin nota, cada fila conserva la suya.

Antes de que confirme, la ventana indica cuántas filas toca el cambio, en cuántas vulnerabilidades. Una fila encontrada después de este recuento queda como estaba. Por encima de 5000 filas, acote los filtros o seleccione menos filas.

Por ejemplo, para marcar todas las versiones sin registrar de PostgreSQL como no afectadas: filtre **Tecnología** por PostgreSQL y **Versión** por **Sin registrar**, marque la casilla del encabezado, haga clic en **Cambiar el estado**, elija **No afectada** y escriba el motivo en la nota.

## Revisar una vulnerabilidad

Haga clic en una fila para abrir su vulnerabilidad en un panel lateral. El panel abarca todas las tecnologías y versiones a las que afecta la vulnerabilidad. Verá:

- El resumen, el vector CVSS y los enlaces de referencia (avisos del editor, parches).
- **Tecnologías y versiones**: cada versión afectada, con su **Estado** y una nota.
- **Servidores**: cada servidor que lleva una versión afectada, con la tecnología, la versión y el servidor en el que se ejecuta.
- **Aplicaciones**: cada aplicación que usa una versión afectada, con su servidor.

Establezca el estado de cada versión:

| Estado | Significado |
|---|---|
| **Por revisar** | Nadie la ha examinado todavía |
| **Tratada** | La versión está parcheada, o hay una solución alternativa en marcha |
| **No afectada** | La vulnerabilidad no se aplica a su instalación |

La nota registra cómo, por ejemplo «parcheado el 12 de marzo, cambio CHG-123». Se guarda al salir del campo. El registro de auditoría conserva quién cambió un estado y cuándo.

KANAP nunca cambia un estado que usted eligió. Cuando una versión deja de coincidir (la actualizó, la tecnología se retiró, la NVD cambió sus datos), una fila aún **Por revisar** desaparece. Una fila que usted revisó se queda, en gris, con su estado; vuelve tal cual si la versión coincide de nuevo.

## Exportación

**Exportar CSV** descarga las vulnerabilidades que cumplen los filtros, una fila por fila de la cuadrícula, en su orden, en el idioma de su pantalla. Por encima de 10 000 vulnerabilidades, acote primero los filtros.

## Notificaciones por correo electrónico

Tras cada comprobación, los responsables de TI de una tecnología reciben un correo sobre sus nuevas vulnerabilidades críticas o altas aún por revisar:

- **Qué se anuncia**: una vulnerabilidad publicada en los últimos 30 días sobre un producto con el que la tecnología ya se comparaba, o una vulnerabilidad conocida que acaba de pasar a crítica o alta.
- **Qué no**: la primera comparación de una tecnología, o de un identificador CPE que acaba de añadir, es silenciosa. Sus resultados esperan en esta página.
- **Cuánto**: 25 líneas como máximo, una por tecnología y vulnerabilidad, y después un enlace a la página, filtrada en las vulnerabilidades publicadas en los últimos 30 días.
- **Cuántas veces**: cada persona recibe aviso de una vulnerabilidad en una tecnología una sola vez. Una vulnerabilidad no anunciada en su comprobación no se anuncia nunca más tarde.

Los destinatarios son los responsables de TI de la tecnología cuya cuenta está activa y que pueden leer la infraestructura. Cada uno puede desactivar estos correos en **Notificaciones de tecnologías**, en sus ajustes de notificación. Consulte [Configuración](admin.md#notificaciones). No sale ningún correo mientras el envío de correo no esté configurado en su instalación.

## Dónde aparecen también las vulnerabilidades

- **Lista de tecnologías**: la columna **Vulnerabilidades por revisar**, en naranja cuando algunas son críticas o altas. Consulte [Tecnologías](technologies.md#trabajar-con-la-lista).
- **Espacio de trabajo de la tecnología**: la sección **Vulnerabilidades** de la pestaña Relaciones. Consulte [Tecnologías](technologies.md#vulnerabilidades).

## Consejos

- **Rellene los identificadores CPE**: las tecnologías del catálogo ya los traen. Para las demás, busque el producto en el diccionario CPE del NIST.
- **Registre las versiones**: un servidor o una aplicación sin versión está potencialmente afectado por todo, lo que oculta la exposición real.
- **Escriba la nota**: quien lea la vulnerabilidad después verá lo que se hizo.
