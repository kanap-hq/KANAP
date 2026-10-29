# Tecnologías

Las tecnologías registran lo que el departamento de TI ejecuta o contrata para que las aplicaciones funcionen: SQL Server, vSphere, Active Directory, Entra ID, Tomcat. Cada tecnología lista sus versiones y sus fechas de fin de soporte, para saber cuáles requieren atención antes de convertirse en un riesgo.

## Qué es una tecnología

KANAP describe su panorama en tres bloques:

| Bloque | Qué contiene | Ejemplos |
|---|---|---|
| **Aplicaciones** | Con lo que trabajan las áreas de negocio | ERP, CRM, nómina, intranet |
| **Tecnologías** | Lo que TI ejecuta o contrata para esas aplicaciones | SQL Server, vSphere, Active Directory, Entra ID, Tomcat |
| **Activos** | Dónde se ejecuta | Servidores, máquinas virtuales, clústeres, bases de datos en la nube |

Un servidor lleva tecnologías. Una aplicación se aloja en servidores y depende de tecnologías.

Registre como aplicación lo que gestiona como un servicio, con sus responsables, su criticidad, sus contratos y sus costes. Registre como tecnología un producto instalado en sus servidores, seguido por sus versiones, sus fechas de fin de soporte y sus vulnerabilidades. Rara vez alguien trabaja en una tecnología en sí, y sin embargo otras aplicaciones caen o quedan expuestas cuando ella cae. Un mismo producto puede ser ambas cosas: consulte VMware vSphere más abajo.

Algunos ejemplos:

- **Entra ID**: una tecnología **SaaS** de la familia **Directorio e identidad**, editada por Microsoft. No se ejecuta en ninguno de sus servidores. Las aplicaciones cuyos usuarios inician sesión con ella la declaran.
- **Active Directory**: una tecnología **Local** de la misma familia, llevada por sus controladores de dominio. Las aplicaciones que la usan la declaran.
- **VMware vSphere**: una tecnología **Local** instalada en el servidor vCenter, mientras que los hosts llevan ESXi y el servicio de virtualización se registra como aplicación.
- **SQL Server**: una tecnología con una línea por versión en uso (2016, 2019, 2022). Cada servidor lleva su propia versión, de modo que el informe de fin de soporte puede nombrar los servidores que siguen en una antigua.
- **Windows Server**: una tecnología de la familia **Sistema operativo**. Cada servidor registra su versión, y esa tecnología es el sistema operativo del servidor. Consulte [Sistemas operativos](#sistemas-operativos).
- **Una aplicación SaaS**: ninguna tecnología que registrar. El proveedor mantiene aquello sobre lo que funciona.

Una tecnología abarca un producto en su conjunto. "SQL Server" representa todos los SQL Server que usted ejecuta; las versiones llevan el detalle.

## Primeros pasos

Navegue a **Panorama IT > Tecnologías** y haga clic en **Nueva tecnología**.

La ventana se abre en el **Catálogo**: una lista de productos habituales con una descripción breve, su editor, su familia y su tipo de alojamiento. Busque por nombre y haga clic en una entrada. KANAP crea al instante la tecnología con su editor, su familia, su tipo de alojamiento, sus identificadores de producto CPE, sus nombres CVE.org, sus versiones con sus fechas de fin de soporte y la descripción breve en su idioma, y la abre. Una entrada sigue ofreciéndose cuando una tecnología del mismo nombre se ha escrito a mano. Añadirla completa esa tecnología, y la entrada lo indica (Completa TEC-10).

Una tecnología adoptada desde el catálogo se mantiene al día: cuando el editor publica una nueva versión o cambia una fecha, KANAP añade la versión y mueve la fecha (consulte [Versiones del catálogo](#versiones-del-catalogo)).

Para un producto que el catálogo no conoce, haga clic en **Introducir una tecnología que no está en el catálogo**. Complete:

- **Nombre** (obligatorio): único entre sus tecnologías.
- **Familia**: el tipo de tecnología (base de datos, hipervisor, directorio e identidad, etc.).
- **Editor**: las sugerencias vienen de sus otras tecnologías y del catálogo, para que un mismo editor conserve una sola grafía.
- **Tipo de alojamiento**: dónde se ejecuta la tecnología. **Local** por defecto. Consulte [Tipo de alojamiento](#tipo-de-alojamiento).

**Permisos**:

- Ver: `infrastructure:reader`
- Crear y editar: `infrastructure:member`
- Eliminar: `infrastructure:admin`

## Sistemas operativos

El sistema operativo de un servidor es una tecnología de la familia **Sistema operativo**. Añádala al servidor como cualquier otra tecnología, con su versión: si el servidor aún no tiene ninguno, pasa a ser su sistema operativo. La ficha del servidor la muestra primero en su sección **Tecnologías**, con la mención «Sistema operativo». Consulte [Activos](assets.md#sistema-operativo).

El catálogo ofrece Windows Server, Ubuntu, Red Hat Enterprise Linux, Debian, SUSE Linux Enterprise Server, Rocky Linux, AlmaLinux, Oracle Linux, Amazon Linux, Alpine Linux, CentOS, IBM AIX, IBM i y Oracle Solaris. Incluye las versiones cuyo soporte terminó en 2010 o después y, para Windows Server, solo las versiones de soporte largo.

El significado de las dos fechas de soporte depende del editor:

| Sistema operativo | Fin del soporte estándar | Fin del soporte extendido |
|---|---|---|
| **Ubuntu**, **Red Hat Enterprise Linux**, **SUSE Linux Enterprise Server** | Fin de las actualizaciones de seguridad | Fin de la extensión de pago |
| **Windows Server** | Fin del soporte general | Fin del soporte extendido |
| **Debian** | Fin del soporte regular | Fin de Debian LTS |

Cualquier tecnología puede ser un sistema operativo: ponga VMware ESXi o FortiOS en la familia **Sistema operativo** y podrá ser el sistema operativo de un host o de un cortafuegos.

Los sistemas operativos del catálogo tienen identificadores CPE de producto, y KANAP los cruza con las vulnerabilidades publicadas.

Las distribuciones Linux publican sus vulnerabilidades por paquete. KANAP sigue el soporte de cada versión y cruza las vulnerabilidades que el editor asigna a la versión. No sabe qué paquetes tiene instalados un servidor, ni en qué nivel. Para las distribuciones Linux del catálogo, la tabla de versiones lleva al seguimiento de seguridad del distribuidor, donde puede comprobar cada paquete. Consulte [Versiones del catálogo](#versiones-del-catalogo).

Los sistemas operativos quedan excluidos de las alertas de vulnerabilidad por defecto. KANAP no conoce el nivel de parches de un servidor, así que un sistema operativo generaría un número muy grande de vulnerabilidades, la mayoría ya corregidas. Esto se aplica a una tecnología de la familia **Sistema operativo** y a un sistema operativo adoptado desde el catálogo, sea cual sea su familia. Una tecnología existente que usted adopta desde el catálogo como sistema operativo queda excluida también. Puede volver a incluirla: consulte [Alertas de vulnerabilidad](#alertas-de-vulnerabilidad).

Las instalaciones actualizadas desde una versión anterior conservan sus datos: los sistemas operativos que usaban los servidores, y las entradas añadidas a la antigua lista de sistemas operativos de la configuración, se han convertido en tecnologías, con sus versiones y fechas.

---

## Trabajar con la lista

Cada fila es una tecnología. Haga clic en una fila para abrirla.

**Columnas predeterminadas**:

| Columna | Qué muestra |
|---|---|
| **Referencia** | La referencia de la tecnología (`TEC-4`) |
| **Nombre** | El nombre de la tecnología |
| **Familia** | El tipo de tecnología |
| **Editor** | Quién la edita |
| **Servidores** | Los activos en servicio en los que está instalada. Los clústeres no se cuentan, ni las máquinas virtuales de un host que la lleva. La insignia **Servidores** de la ficha y el informe [Fin de soporte](end-of-support.md) dan el mismo número |
| **Aplicaciones** | Las aplicaciones que la declaran o se alojan en un servidor que la lleva |
| **Próximo fin de soporte** | El fin de soporte estándar más cercano por venir entre las versiones en uso. En naranja cuando cae dentro de los próximos 12 meses |
| **Vulnerabilidades por revisar** | Las vulnerabilidades conocidas que quedan por revisar en las versiones en uso que están en las alertas. En naranja con el número de críticas o altas (`3 · 1 críticas o altas`). Haga clic para abrir la página [Vulnerabilidades](vulnerabilities.md) sobre esta tecnología. Presente cuando se siguen las vulnerabilidades |

**Columnas adicionales** (con el selector de columnas): **Ciclo de vida**, **Versiones en uso**, **Responsable de TI**.

Cuando se siguen las vulnerabilidades, la columna **Editor** también abre la página Vulnerabilidades sobre los productos de ese editor. Consulte [Vulnerabilidades](vulnerabilities.md) para saber cuándo se siguen.

**Filtros**: **Familia**, **Editor** y **Ciclo de vida** ofrecen filtros con casillas. El cuadro de búsqueda busca en el nombre, el editor y la referencia.

**Acciones**:

- **Nueva tecnología** (`infrastructure:member`).
- **Importar vínculos** (`infrastructure:member`) y **Exportar vínculos**: cargue o descargue en un archivo CSV o un libro de Excel los vínculos entre las tecnologías y los servidores o las aplicaciones. Consulte [Importar y exportar vínculos](#importar-y-exportar-vinculos).
- **Eliminar** las filas seleccionadas (`infrastructure:admin`). La confirmación cuenta lo que se va con ellas: vínculos con servidores y aplicaciones, contratos, líneas presupuestarias, proyectos, incidentes y documentos.

---

## El espacio de trabajo de la tecnología

El espacio de trabajo tiene una cabecera, un panel de propiedades a la derecha y siete pestañas: **Resumen**, **Servidores**, **Aplicaciones**, **Operaciones**, **Cumplimiento**, **Relaciones** e **Historial** (los cambios hechos en la tecnología, vea [Historial de los registros](record-history.md)). Las pestañas **Servidores**, **Aplicaciones** y **Relaciones** muestran su número en una insignia.

### Cabecera

- **Nombre**: editable en el sitio.
- **Referencia**: haga clic para copiarla.
- **Ciclo de vida**: haga clic para cambiarlo. Una tecnología retirada ya no se ofrece cuando busca una para vincular.
- **Familia**.
- **Eliminar**, un icono de papelera (`infrastructure:admin`): la confirmación nombra lo que se va con la tecnología.

### Panel de propiedades

- **Editor**, **Familia** y **Tipo de alojamiento**.
- **Zona de administración**: solo se muestra para las tecnologías de la familia **Directorio e identidad**. Sitúa un servicio de directorio en una zona de su modelo de administración, por ejemplo el tier 0 para Entra ID, que no se ejecuta en ninguno de sus servidores. Las zonas vienen de **Panorama IT > Configuración**, y la página [Zonas de administración](administration-view.md) lista los servicios de directorio con su zona. Las demás tecnologías no llevan zona: sitúe en su lugar los servidores que las llevan. Una zona indicada antes en una tecnología de otra familia se sigue mostrando, en solo lectura, con una nota que indica que el valor ya no se utiliza.
- **Reemplazada por**: la tecnología que toma el relevo de esta, por ejemplo un producto más reciente al que migran sus equipos.
- **Responsables de TI**: las personas responsables de la tecnología.

Los cambios se guardan a medida que los hace.

#### Tipo de alojamiento

El tipo de alojamiento indica dónde se ejecuta la tecnología. La lista es la de **Tipos de alojamiento** de **Panorama IT > Configuración**, compartida con las ubicaciones: **Local**, **Colocation**, **Cloud público**, **Cloud privado** y **SaaS** por defecto. Cada tipo es local o en la nube:

- **Local** (Local, Colocation): se espera la tecnología en sus servidores. La que no se ejecuta en ningún servidor aparece en los **Datos que faltan** del informe [Fin de soporte](end-of-support.md#datos-que-faltan).
- **En la nube** (Cloud público, Cloud privado, SaaS): el proveedor la ejecuta, por ejemplo Entra ID o un servicio de Kubernetes gestionado. Declárela en las aplicaciones que la usan.

Un tipo marcado con **Dejar de proponer** se mantiene en las tecnologías que lo tienen. Un tipo eliminado de la configuración, o una lista sin ningún tipo en uso, hace aparecer también la tecnología en los **Datos que faltan**.

### Resumen

**Descripción**: para qué sirve la tecnología.

**Versiones**: una línea por versión que sigue, con **Fin del soporte estándar**, **Fin del soporte extendido** y un **Estado**:

| Estado | Significado |
|---|---|
| **Con soporte** | El soporte estándar termina dentro de más de 12 meses |
| **Finaliza pronto** | El soporte estándar termina dentro de 12 meses |
| **Soporte extendido** | El soporte estándar ha terminado; el soporte extendido sigue vigente |
| **Sin soporte** | Todas las fechas de fin han pasado |
| **Fecha desconocida** | No hay fecha de fin registrada |

El soporte sigue vigente el día de su fecha de fin. Con una sola fecha, esa fecha es el fin. **Añadir versión** añade una línea; pase el ratón por una línea para editarla o eliminarla. Eliminar una versión que usan servidores o aplicaciones pide confirmación, con el número de servidores en los que está instalada y de aplicaciones: esos vínculos muestran entonces una versión desconocida.

**Notas**: al final de la pestaña, texto libre, como las condiciones de licencia o las fechas de renovación.

#### Alertas de vulnerabilidad

Cuando se siguen las vulnerabilidades, la tabla de versiones elige las versiones que cuentan en las alertas de vulnerabilidad. Una versión en las alertas aparece por defecto en la página [Vulnerabilidades](vulnerabilities.md), en los correos y en los contadores. Una versión fuera de las alertas se sigue cotejando con las vulnerabilidades: la sección [Vulnerabilidades](#vulnerabilidades) de la tecnología la sigue mostrando, y la página muestra sus filas con su filtro **Alertas**.

- **Incluir en las alertas de vulnerabilidad**: el interruptor de la línea de título **Versiones**, junto a **Añadir versión**. Es el ajuste de la tecnología. Pase el ratón por encima para un recordatorio: se aplica a las versiones sin ajuste propio, a las versiones añadidas más tarde, y a los servidores y aplicaciones que no indican ninguna versión. Cambiarlo sustituye los ajustes propios de las versiones; cuando algunas tienen uno, KANAP pregunta primero e indica cuántas. Aparece incluso cuando la tecnología no tiene ninguna versión.
- Columna **Alertas**: un interruptor por versión, para una excepción en una versión. Pase el ratón por el icono de información de su cabecera para saber qué hace. Un pequeño punto junto al interruptor marca una versión con ajuste propio. Vuelva a poner el interruptor en el valor de la tecnología y la versión sigue de nuevo a la tecnología.

Las nuevas tecnologías están en las alertas, con dos excepciones:

- **Sistemas operativos**: consulte [Sistemas operativos](#sistemas-operativos).
- **Servicios en la nube gestionados por un proveedor**: una tecnología cuyo [tipo de alojamiento](#tipo-de-alojamiento) está en la nube, como **Cloud público** o **SaaS**, y una entrada del catálogo que el proveedor ejecuta, como Entra ID. El proveedor corrige un servicio en línea, así que sus vulnerabilidades no le piden ninguna acción. Una tecnología en un **Cloud privado** sigue en las alertas.

Cambiar más tarde la familia o el tipo de alojamiento de una tecnología deja su ajuste como está. Los interruptores requieren el nivel Miembro en la infraestructura.

#### Versiones del catálogo

Una versión que procede del catálogo muestra **Catálogo** junto a su etiqueta, y una tecnología adoptada desde el catálogo indica «Versiones y fechas mantenidas al día desde el catálogo» bajo sus versiones. KANAP consulta el catálogo cada día en la nube. En una instalación local, cada versión de KANAP trae su catálogo al arrancar, salvo que su administrador [active la comprobación diaria](on-premise/configuration.md#optional-technology-catalog).

Las fechas proceden de dos fuentes. La mayoría de los productos las toman de endoflife.date. Para los productos que endoflife.date no cubre, como Cisco NX-OS, Juniper Junos o Dell PowerStore, KANAP toma las fechas de las páginas oficiales del editor. Cada versión de KANAP pone al día estas fechas.

Una versión cuyas fechas tomó KANAP muestra su fuente bajo su etiqueta: «Fuente:», el editor y el día en que se verificaron las fechas. El nombre del editor lleva a la página de la que proceden las fechas. La línea permanece mientras las dos fechas de fin coincidan con el catálogo. Desaparece en cuanto usted cambia una de ellas. Cuando el editor no prevé ningún fin de soporte, como en IBM WebSphere 8.5 y 9.0, las dos columnas de fin de soporte indican «Ningún fin previsto por el editor».

Algunos productos no tienen fechas públicas: HPE Aruba Networking AOS-CX, Pure Storage Purity//FA, HPE Alletra 5000/6000 (NimbleOS), Rubrik CDM, Cohesity DataProtect y PRTG Network Monitor. El catálogo los trae sin versiones. Registre usted mismo sus versiones y sus fechas.

Una distribución Linux del catálogo muestra una línea bajo la tabla: «Este distribuidor publica las vulnerabilidades por paquete». La línea lleva al seguimiento de seguridad del distribuidor, por ejemplo el seguimiento de seguridad de Debian o las actualizaciones de seguridad de Red Hat. Allí verá qué paquetes afecta una vulnerabilidad y qué actualizaciones la corrigen. Consulte [Sistemas operativos](#sistemas-operativos).

La comprobación añade las nuevas versiones, identificadores de producto CPE y nombres CVE.org del producto, y actualiza las fechas de fin de soporte, los identificadores y los nombres que el catálogo cambió. Nunca sobrescribe un valor que usted cambió, y nunca vuelve a crear una versión, un identificador o un nombre que usted eliminó. Una versión que registró antes de que el catálogo la conociera se vincula a él cuando las etiquetas coinciden, y se rellenan sus fechas vacías.

#### Identificadores de vulnerabilidad

El grupo **Identificadores de vulnerabilidad**, bajo las versiones, reúne los identificadores de producto CPE y los nombres CVE.org. KANAP encuentra las vulnerabilidades de una tecnología a través de ellos.

- **Plegado**: cuando la tecnología tiene al menos un identificador, el grupo está plegado, con un resumen en su línea de título, por ejemplo `2 identificadores CPE · 3 nombres de CVE.org`. Haga clic en el título para abrirlo.
- **Abierto**: cuando la tecnología no tiene ninguno, el grupo está abierto, con una advertencia: no se busca ninguna vulnerabilidad para esta tecnología. La sección **Versiones** también lo indica. Con el nivel Miembro en la infraestructura, **Añadir un identificador** junto a esa línea abre el grupo.

El cotejo se hace a nivel de la tecnología. Cada versión de la tecnología se compara con las vulnerabilidades de sus identificadores, y una versión que usted añade se coteja de inmediato. Sin identificador, KANAP no busca ninguna vulnerabilidad para ninguna versión.

**Identificadores de producto CPE**: los nombres que las bases de datos de seguridad dan a este producto, con la forma `part:vendor:product` (por ejemplo `a:microsoft:sql_server`). KANAP los coteja con las vulnerabilidades publicadas. Un producto puede tener varios (vSphere abarca vCenter y ESXi). Dónde encontrar este valor: busque el producto en el [Diccionario CPE del NIST](https://nvd.nist.gov/products/cpe/search) y conserve su parte, su proveedor y su producto. Cópielos como los escribe la NVD, con la barra invertida delante de un signo: `a:veeam:veeam_backup_\&_replication`. La mayoría de las entradas del catálogo llegan con sus identificadores, incluidos los sistemas operativos.

**Nombres CVE.org**: los nombres de editor y de producto tal como el editor los escribe en sus propias fichas de vulnerabilidad, por ejemplo el editor `SAP_SE` y el producto `SAP HANA Database`. KANAP los coteja con la lista CVE.org, que también contiene vulnerabilidades que la NVD no ha analizado (consulte [Vulnerabilidades](vulnerabilities.md#como-las-encuentra-kanap)). Los nombres están bajo los identificadores de producto CPE y aparecen cuando KANAP lee la lista CVE.org. Cada nombre aparece por separado.

- **Añadir un nombre**: escriba parte del nombre del producto en la búsqueda. La lista propone los nombres exactos que los editores escriben en sus fichas, cada uno con su número de vulnerabilidades y la fecha de la última. Elija uno, con una versión opcional. No se puede escribir un nombre que no esté en la lista.
- **Sugerencias**: los nombres vistos en las vulnerabilidades de sus identificadores CPE. Cada uno muestra su número de vulnerabilidades y la parte de esas vulnerabilidades que lo llevan.
- **Nombres exactos**: la comparación ignora mayúsculas, minúsculas y puntuación, y por lo demás exige el nombre exacto. Un nombre parecido no coincide: declare cada variante de un producto por separado. Por ejemplo, `Microsoft SQL Server 2008` no coteja nada: las fichas escriben `Microsoft SQL Server 2008 Service Pack 4 (QFE)`. Elija ese nombre, con la versión `2008`.
- **Versión**: una versión limita el nombre a las versiones de la tecnología cuya etiqueta empieza por ella, por ejemplo `2019` para `Windows Server 2019`. Cuando una etiqueta empieza por varias de ellas, solo cuenta la más larga: `2012 R2` recibe el nombre de `2012 R2` y deja el de `2012`.
- **Desde el catálogo**: muchas entradas del catálogo llegan con sus nombres (Microsoft, Apache, bases de datos y otras). La comprobación del catálogo los mantiene al día como los identificadores CPE, y un nombre que usted quitó no vuelve.

Dónde encontrar este valor: en [cve.org](https://www.cve.org), abra la ficha de una vulnerabilidad del producto. El nombre debe ser el de su sección **Product status**. Cambiar los nombres requiere el nivel Miembro en la infraestructura, como para los identificadores CPE.

### Servidores

Los servidores que llevan la tecnología, una fila por servidor y versión:

| Columna | Qué muestra |
|---|---|
| **Ref.**, **Servidor** | El servidor. Un clúster muestra un icono delante de su nombre. Haga clic en la fila para abrirlo |
| **Entorno**, **Sistema operativo** | Tomados del servidor |
| **Versión** | La versión instalada. Un guion indica que la versión es desconocida |
| **Vía** | Para un servidor que lleva la tecnología a través de otro: los activos en los que está instalada. La columna solo aparece si la pestaña tiene una fila así |
| **Notas** | Texto libre sobre esta instalación, por ejemplo «nodo del clúster» |

Una tecnología llega a un servidor de dos maneras:

- **Instalada**: alguien vinculó la tecnología a este servidor. Puede cambiar la versión y las notas en el sitio, o quitar la fila.
- **A través de otro servidor**: para un clúster, la tecnología está instalada en sus miembros. Por ejemplo, SQL Server instalado en los nodos de un clúster aparece en el clúster en una fila por versión, con los nodos que lo llevan en **Vía**. Sigue a la instalación: cámbiela o quítela en esos servidores.

Los servidores que se ejecutan dentro de un host que lleva la tecnología, como las máquinas virtuales de un host ESXi, se agrupan bajo una línea cerrada al final de la tabla, **Activos alojados (n)**. Haga clic en ella para mostrarlos, con su host en **Vía**.

**Añadir** (`infrastructure:member`) abre una búsqueda de servidor y luego el selector de versión: elija una versión, **Versión desconocida**, o escriba una etiqueta nueva y elija **Añadir la versión «…»** para crearla. Cada cambio se guarda de inmediato.

Un servidor retirado sigue en la lista, en gris y marcado como «retirado», para que pueda quitar su vínculo. No cuenta en ninguna parte: ni en la insignia, ni en el total, ni en los contadores de la lista, ni en los informes. La insignia y la fila **Total** cuentan los servidores en servicio en los que la tecnología está instalada, cada uno una vez. Un clúster y un activo alojado aparecen en la lista sin contarse.

### Aplicaciones

Las aplicaciones que usan la tecnología, una fila por aplicación, entorno, servidor y versión. Para ver esta pestaña hay que poder leer las aplicaciones; sin ese derecho, una sola línea lo indica. Un Business Contributor solo ve sus propias aplicaciones.

| Columna | Qué muestra |
|---|---|
| **Ref.**, **Aplicación** | La aplicación. Haga clic en la fila para abrirla |
| **Entorno** | El entorno del despliegue |
| **Criticidad** | La criticidad de negocio de la aplicación |
| **Externa** | «Sí» cuando la aplicación está expuesta al exterior |
| **Servidor** | El servidor que lleva la tecnología para este despliegue, con su host cuando se ejecuta dentro de otro servidor. **Declarada** para una fila añadida a mano |
| **Versión** | La versión usada. Un guion indica que la versión es desconocida |
| **Responsable de TI** | Los responsables de TI de la aplicación |

Una aplicación aparece de dos maneras:

- **Alojada**: uno de sus despliegues se ejecuta en un servidor que lleva la tecnología. KANAP deduce la fila de los servidores; cambie el servidor o el despliegue para modificarla.
- **Declarada**: la aplicación depende de la tecnología sin ejecutarse a su lado, por ejemplo una aplicación cuyos usuarios inician sesión con Entra ID. Cambie la versión en el sitio, o quite la declaración. Quitarla retira todas las versiones declaradas de esa aplicación.

**Añadir** (`infrastructure:member`) abre una búsqueda en la que puede marcar varias aplicaciones y añadirlas de una vez. Se declaran con una versión desconocida: indíquela después en cada fila. Las aplicaciones y los despliegues desactivados no cuentan.

**Exportar** descarga las filas como archivo CSV o Excel, en el idioma de su pantalla.

### Operaciones

A quién llamar y cómo obtener ayuda:

- **Soporte**: los contactos de soporte, con su **Correo electrónico**, su **Teléfono** y su **Rol**. **Agregar contacto** abre un formulario corto: elija el **Contacto** (obligatorio) e indique un **Rol** opcional. Un contacto figura una sola vez; añadirlo de nuevo conserva su rol. Quite un contacto con la cruz al final de su fila.
- **Notas de soporte**: texto libre, como el número del contrato de soporte, el horario de la línea de ayuda o la vía de escalado. Se guardan al salir del campo.

La tecnología aparece entonces en la sección **Usado en** de la página de cada contacto.

### Cumplimiento

La misma clasificación que para las aplicaciones, para las tecnologías que cuentan en sus planes de continuidad:

- **Criticidad**: **Criticidad cibernética**.
- **Continuidad y recuperación**: **Ola de recuperación**, **Objetivo de tiempo de recuperación (RTO)** y **Objetivo de punto de recuperación (RPO)**.

Los niveles y las olas vienen de **Clasificaciones y continuidad** en la [Configuración del panorama IT](it-ops-settings.md#clasificaciones-y-continuidad). Pase el ratón por el signo de interrogación junto a un campo para ver su significado.

Debajo, cuando se siguen las vulnerabilidades, la sección **Vulnerabilidades** resume las vulnerabilidades conocidas de cada versión. Consulte [Vulnerabilidades](#vulnerabilidades).

#### Vulnerabilidades

Un resumen de las vulnerabilidades, una fila por versión instalada de la tecnología, en el orden de la tabla de versiones. El número junto al título es el número de vulnerabilidades distintas, en todos los estados.

| Columna | Qué muestra |
|---|---|
| **Versión** | La versión. Una versión fuera de las alertas aparece atenuada e indica **Excluida de las alertas**. **Versión no registrada (potencialmente afectada)** agrupa los servidores y aplicaciones que no indican ninguna versión; esta fila solo aparece si los hay |
| **Servidores** | Cuántos servidores en servicio tienen esta versión registrada en sí mismos. Los clústeres y los servidores que se ejecutan dentro de otro no se cuentan. Consulte [Lo que KANAP cuenta](vulnerabilities.md#what-kanap-counts) |
| **Crítica**, **Alta**, **Media**, **Baja**, **Sin evaluar** | Una columna por gravedad: las vulnerabilidades aún por revisar. Una vulnerabilidad de gravedad **Ninguna** cuenta con **Baja**. Un punto indica que no queda ninguna. Pase el cursor por un encabezado para un recordatorio |
| **Total** | Las vulnerabilidades distintas de esta versión, en todos los estados |

**Ver** abre la página [Vulnerabilidades](vulnerabilities.md) filtrada en la versión: en sus vulnerabilidades por revisar cuando las tiene, en todos los estados si no. **Ver todo en la página Vulnerabilidades**, debajo de la tabla, abre la página en toda la tecnología, en todos los estados.

Las versiones que ningún servidor ni ninguna aplicación usa no tienen fila. Se nombran juntas debajo de la tabla, por ejemplo «No instaladas: 2016, 2017». KANAP solo busca vulnerabilidades de las versiones instaladas en un servidor o declaradas por una aplicación.

Cuando la tecnología o algunas de sus versiones están fuera de las alertas, una línea al principio de la sección lo indica: **Excluida de las alertas**, **Excluida de las alertas, excepto 2 versiones** o **3 versiones excluidas de las alertas**. Con el nivel Miembro en la infraestructura, **Cambiar** junto a ella abre la tabla de versiones de la pestaña Resumen, donde están los interruptores. Consulte [Alertas de vulnerabilidad](#alertas-de-vulnerabilidad).

KANAP vuelve a cotejar la tecnología en cuanto cambian sus identificadores, nombres CVE.org, versiones, servidores o aplicaciones. Tras un nuevo identificador de producto CPE, la sección indica «Búsqueda de vulnerabilidades en curso…» mientras KANAP lee ese producto en la NVD. Cuando esa lectura no se puede completar, la sección lo dice. **Actualizar** (`infrastructure:member`) lanza la comparación a mano.

### Relaciones

Los registros vinculados a la tecnología, una sección por tipo:

- **Líneas presupuestarias**: con el importe del año en curso en la columna presupuestaria de su espacio de trabajo, y un total. Una línea cuya moneda no tiene tipo de cambio para el año muestra su importe en su propia moneda con una pequeña marca naranja, y el total la excluye. Un aviso de una línea bajo la tabla la indica. Vea [Tipos manuales](currencies.md#tipos-manuales).
- **Contratos**: proveedor, fecha de fin e importe anual, con un total por moneda.
- **Proyectos**: estado y fin previsto.
- **Incidentes**: gravedad, estado y fecha de detección. Vincular un incidente requiere `incidents:contributor`. Un incidente cerrado o cancelado no se puede vincular ni desvincular.
- **Enlaces y archivos**: los enlaces web de la tecnología y sus archivos, una fila cada uno con su nombre, el dominio del enlace o el tamaño del archivo, y la fecha en que se añadió. Haga clic en un enlace para abrirlo en una pestaña nueva, o en un archivo para descargarlo. Con el nivel Miembro en la infraestructura, **Añadir enlace** y **Adjuntar archivo** añaden una fila, y los archivos también se pueden soltar sobre la sección. Pase el cursor sobre una fila para editar un enlace o quitar una fila. Quitar un enlace muestra un mensaje y ofrece **Deshacer**, que vuelve a crear el enlace. Eliminar un archivo pide una confirmación. Una dirección escrita sin `http://` ni `https://` recibe `https://`. Cualquier otro esquema se rechaza.

Una sección solo aparece si puede leer su módulo. **Añadir** (`infrastructure:member`) abre una búsqueda en el sitio; la cruz al final de una fila quita el vínculo.

---

## Vincular una tecnología a un servidor

Puede registrar que un servidor lleva una tecnología desde cualquiera de los dos lados:

- Desde la tecnología: pestaña **Servidores**, **Añadir**, y elija el servidor y la versión.
- Desde el servidor: pestaña **Operaciones** del activo, sección **Tecnologías**, **Añadir**, y elija la tecnología y la versión. Consulte [Activos](assets.md#operations).

Registre la tecnología en el servidor donde está instalada: el host para un hipervisor, cada controlador de dominio para Active Directory, el servidor de base de datos para SQL Server. Los servidores que se ejecutan dentro de él, y el clúster de esos servidores, la muestran entonces sin más trabajo. Una tecnología en la nube, como Entra ID, no se ejecuta en ninguno de sus servidores: declárela en las aplicaciones.

---

## Importar y exportar vínculos

La lista de tecnologías carga y descarga vínculos en bloque, un vínculo por fila de un archivo CSV o de un libro de Excel. Existen dos archivos:

- **Servidores y tecnologías**: las tecnologías instaladas en cada servidor.
- **Aplicaciones y tecnologías**: las tecnologías que declara cada aplicación. Las aplicaciones alojadas en un servidor que lleva una tecnología se deducen de los servidores, así que el archivo las deja fuera.

Haga clic en **Importar vínculos** o **Exportar vínculos** en la barra de herramientas y elija el archivo. La exportación ofrece los datos, en CSV o Excel, o una plantilla CSV vacía. Se aplican las reglas generales de los archivos de importación: codificación, separador, sí y no en cuatro idiomas, 20.000 filas como máximo. Consulte [Archivos CSV y Excel](csv-files.md).

**Permisos**:

- Exportar el archivo de servidores: `infrastructure:reader`.
- Importar el archivo de servidores: `infrastructure:member`.
- El archivo de aplicaciones requiere además el derecho de leer las aplicaciones. Un Business Contributor solo exporta e importa los vínculos de sus propias aplicaciones.

### Columnas

| Columna | Significado |
|---|---|
| `asset_reference`, `asset_name` | El servidor (archivo de servidores). La referencia (`AST-12`) se lee primero. Sin ella, el nombre encuentra el servidor, y un nombre que llevan dos servidores es un error. Una referencia y un nombre que apuntan a dos servidores distintos también son un error |
| `application_reference`, `application_name` | La aplicación (archivo de aplicaciones), primero por su referencia (`APP-4`), luego por su nombre |
| `technology_reference`, `technology_name` | La tecnología, primero por su referencia (`TEC-3`), luego por su nombre |
| `version` | La etiqueta de la versión. Una celda vacía significa que la versión es desconocida |
| `operating_system` | Solo en el archivo de servidores. Indica si la tecnología es el sistema operativo del servidor: vea más abajo |
| `notes` | Texto libre sobre el vínculo |
| `source` | De dónde viene el vínculo: entrada manual, importación, asistente, agente o Netbox. La exportación la escribe; la importación la ignora |

La columna `operating_system` admite tres valores:

- **sí**: el vínculo pasa a ser el sistema operativo del servidor. La importación rechaza la fila cuando la tecnología no es de la familia **Sistema operativo**, cuando el servidor es un clúster que tiene miembros o cuando el servidor ya tiene otro sistema operativo.
- **no**: el vínculo nunca se marca.
- **Vacía**: un vínculo nuevo sigue la regla de la ficha del servidor. Una tecnología de la familia **Sistema operativo** pasa a ser el sistema operativo del servidor cuando este aún no tiene ninguno y no es un clúster. La vista previa lo indica en la fila.

La importación nunca quita la marca de sistema operativo de un vínculo.

### Qué hace una importación

**Verificación previa** lee el archivo y lista lo que haría la carga, con los errores por fila si los hay. Un archivo con un error no carga nada.

- Un vínculo es un servidor o una aplicación, una tecnología y una versión: una fila con otra versión añade un segundo vínculo. El mismo vínculo dos veces en un archivo es un error.
- Cada fila añade un vínculo o actualiza uno existente. Los vínculos que faltan en el archivo se quedan como están: la importación nunca elimina un vínculo.
- Un vínculo existente conserva su origen. Sus notas cambian cuando la celda `notes` contiene un texto distinto, y una celda vacía las deja como están.
- Un vínculo nuevo se marca como procedente de una importación, con el nombre del archivo.
- La tecnología debe figurar ya en su lista. Adóptela desde el catálogo o créela primero.
- Una versión que aún no sigue se crea en la tecnología. La vista previa la nombra.

Un archivo grande tarda en cargarse y retiene los vínculos de sus tecnologías hasta que termina. Varios archivos más pequeños molestan menos a las personas que trabajan al mismo tiempo.

---

## Dónde aparecen las tecnologías

- **Aplicaciones**: la sección **Tecnologías**, arriba en la pestaña Operaciones, lista aquello de lo que depende una aplicación. Consulte [Aplicaciones](applications.md#operations).
- **Activos**: la sección **Tecnologías** de la pestaña Operaciones de un activo lista lo que lleva el servidor, con su sistema operativo primero. Consulte [Activos](assets.md#operations).
- **Contratos**, **líneas presupuestarias** e **incidentes**: un campo **Tecnologías** en su pestaña Relaciones, para los usuarios que pueden leer la infraestructura.
- Informe **Fin de soporte**: las versiones que llegan a su fin de soporte, sistemas operativos incluidos, y lo que afectan. Consulte [Fin de soporte](end-of-support.md).
- **Vulnerabilidades**: las vulnerabilidades conocidas de las versiones en uso, y los servidores y aplicaciones a los que llegan. Consulte [Vulnerabilidades](vulnerabilities.md).
- **Zonas de administración**: los servicios de directorio con su zona, y los servidores que llevan una tecnología de directorio fuera de la zona más sensible. Consulte [Zonas de administración](administration-view.md).
- **Contactos**: la sección **Usado en** de un contacto lista las tecnologías a las que da soporte. Consulte [Contactos](contacts.md#donde-se-usan-los-contactos).
- **Búsqueda**: la búsqueda global y las menciones `@` del asistente encuentran las tecnologías por nombre y por referencia (`@TEC-4`).

## Convertir una aplicación

Una ficha creada como aplicación puede ser en realidad una tecnología, por ejemplo un motor de base de datos o un directorio. Abra la aplicación y use **Convertir en tecnología**. Consulte [Aplicaciones](applications.md#convertir-una-aplicacion-en-tecnologia).

## Preguntar al asistente

[Plaid](ai-assistant.md) lee las tecnologías con los mismos derechos que esta página. Pregunte, por ejemplo: «¿Quién es responsable de TEC-3?», «¿Qué enlaces web tiene PostgreSQL?», «¿Están activas las alertas de vulnerabilidad en TEC-3?» o «¿Qué tecnologías están sin soporte?»

Con el nivel Miembro en la infraestructura, Plaid también escribe, y cada cambio llega como una vista previa que usted aprueba:

- Adoptar una entrada del catálogo, completar una tecnología del mismo nombre introducida a mano o crear una tecnología que el catálogo no conoce.
- Cambiar los campos de la tecnología.
- Añadir versiones y cambiar sus etiquetas, fechas y notas.
- Añadir o quitar responsables de TI, responsables de negocio y contactos de soporte.
- Añadir, cambiar o quitar enlaces web.
- Activar o desactivar las alertas de vulnerabilidad, para la tecnología o para una versión.

Plaid nombra la familia, el ciclo de vida y los demás valores de lista en su idioma, y rechaza un valor que coincide con varios. Rechaza un nombre que llevan dos usuarios o dos contactos, y dos enlaces con la misma dirección. Pregunte, por ejemplo: «Adopta PostgreSQL del catálogo de KANAP», «Añade la versión 17 a TEC-3», «Añade a Camille Roux como responsable de negocio de PostgreSQL», «Añade el contacto Oracle Support al soporte de TEC-3», «Añade a PostgreSQL el enlace de las notas de versión https://www.postgresql.org/docs/release/» o «Excluye la versión 14 de TEC-3 de las alertas».

Añadir un contacto de soporte también requiere el derecho de leer los contactos. Quitar uno no lo requiere. Plaid solo añade usuarios activos como responsables, y quita un responsable aunque su cuenta esté desactivada. Un contacto sin nombre no se puede añadir: dele primero un nombre en Contactos. Cuando Plaid completa una tecnología introducida a mano, solo cambia los campos que difieren, y se detiene si uno de ellos se modificó en la pantalla después de la vista previa.

La eliminación de una tecnología o de una versión, los archivos adjuntos, los identificadores CPE y los nombres CVE.org, y la comparación de las vulnerabilidades se quedan en esta página.

## Consejos

- **Parta del catálogo**: obtiene las versiones y sus fechas de fin de soporte sin escribirlas.
- **Siga las versiones principales**: una línea por versión principal (2019, 2022) basta para seguir el soporte.
- **Nombre a los responsables**: los responsables de TI son las personas a quienes llamar cuando una versión llega a su fin de soporte. También reciben el correo sobre las nuevas vulnerabilidades críticas.
- **Rellene los identificadores de producto CPE y los nombres CVE.org**: sin ninguno de los dos, KANAP no puede cotejar la tecnología con las vulnerabilidades publicadas.
- **Registre la versión en cada servidor**: una versión desconocida está potencialmente afectada por todas las vulnerabilidades del producto.
