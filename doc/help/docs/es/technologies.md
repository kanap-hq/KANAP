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

Cree una tecnología cuando nadie trabaja en el producto en sí, pero otras aplicaciones caen o quedan expuestas cuando él cae. Mantenga una ficha como aplicación cuando los usuarios de negocio inician sesión en ella y la usan para su trabajo.

Algunos ejemplos:

- **Entra ID**: una tecnología **SaaS** de la familia **Directorio e identidad**, editada por Microsoft. No se ejecuta en ninguno de sus servidores. Las aplicaciones cuyos usuarios inician sesión con ella la declaran.
- **Active Directory**: una tecnología **Local** de la misma familia, llevada por sus controladores de dominio. Las aplicaciones que la usan la declaran.
- **vSphere**: una tecnología **Local**, llevada por la máquina virtual de vCenter y por los hosts.
- **SQL Server**: una tecnología con una línea por versión en uso (2016, 2019, 2022). Cada servidor lleva su propia versión, de modo que el informe de fin de soporte puede nombrar los servidores que siguen en una antigua.
- **Windows Server**: una tecnología de la familia **Sistema operativo**. Cada servidor registra su versión, y esa tecnología es el sistema operativo del servidor. Consulte [Sistemas operativos](#sistemas-operativos).
- **Una aplicación SaaS**: ninguna tecnología que registrar. El proveedor mantiene aquello sobre lo que funciona.

Una tecnología abarca un producto en su conjunto. "SQL Server" representa todos los SQL Server que usted ejecuta; las versiones llevan el detalle.

## Primeros pasos

Navegue a **Panorama IT > Tecnologías** y haga clic en **Nueva tecnología**.

La ventana se abre en el **Catálogo**: una lista de productos habituales con una descripción breve, su editor, su familia y su tipo de alojamiento. Busque por nombre y haga clic en una entrada. KANAP crea al instante la tecnología con su editor, su familia, su tipo de alojamiento, sus identificadores de producto CPE, sus versiones con sus fechas de fin de soporte y la descripción breve en su idioma, y la abre. El catálogo solo ofrece los productos que aún no ha añadido.

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

El catálogo ofrece Windows Server, Ubuntu, Red Hat Enterprise Linux, Debian, SUSE Linux Enterprise Server, Rocky Linux, AlmaLinux, Oracle Linux y CentOS. Incluye las versiones cuyo soporte terminó en 2010 o después y, para Windows Server, solo las versiones de soporte largo.

El significado de las dos fechas de soporte depende del editor:

| Sistema operativo | Fin del soporte estándar | Fin del soporte extendido |
|---|---|---|
| **Ubuntu**, **Red Hat Enterprise Linux**, **SUSE Linux Enterprise Server** | Fin de las actualizaciones de seguridad | Fin de la extensión de pago |
| **Windows Server** | Fin del soporte general | Fin del soporte extendido |
| **Debian** | Fin del soporte regular | Fin de Debian LTS |

Cualquier tecnología puede ser un sistema operativo: ponga VMware ESXi o FortiOS en la familia **Sistema operativo** y podrá ser el sistema operativo de un host o de un cortafuegos.

Los sistemas operativos del catálogo aún no tienen identificadores CPE de producto, así que KANAP no los cruza con las vulnerabilidades.

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
| **Servidores** | Los activos que la llevan, directamente o porque están dentro de un activo que la lleva |
| **Aplicaciones** | Las aplicaciones que la declaran o se alojan en un servidor que la lleva |
| **Próximo fin de soporte** | El fin de soporte estándar más cercano por venir entre las versiones en uso. En naranja cuando cae dentro de los próximos 12 meses |
| **Vulnerabilidades por revisar** | Las vulnerabilidades conocidas que quedan por revisar en las versiones en uso que están en las alertas. En naranja con el número de críticas o altas (`3 · 1 críticas o altas`). Haga clic para abrir la página [Vulnerabilidades](vulnerabilities.md) sobre esta tecnología. Presente cuando se siguen las vulnerabilidades |

**Columnas adicionales** (con el selector de columnas): **Ciclo de vida**, **Versiones en uso**, **Responsable de TI**.

Cuando se siguen las vulnerabilidades, la columna **Editor** también abre la página Vulnerabilidades sobre los productos de ese editor. Consulte [Vulnerabilidades](vulnerabilities.md) para saber cuándo se siguen.

**Filtros**: **Familia**, **Editor** y **Ciclo de vida** ofrecen filtros con casillas. El cuadro de búsqueda busca en el nombre, el editor y la referencia.

**Acciones**:

- **Nueva tecnología** (`infrastructure:member`).
- **Importar vínculos** (`infrastructure:member`) y **Exportar vínculos**: cargue o descargue en un archivo CSV los vínculos entre las tecnologías y los servidores o las aplicaciones. Consulte [Importar y exportar vínculos](#importar-y-exportar-vinculos).
- **Eliminar** las filas seleccionadas (`infrastructure:admin`). La confirmación cuenta lo que se va con ellas: vínculos con servidores y aplicaciones, contratos, líneas presupuestarias, proyectos, incidentes y documentos.

---

## El espacio de trabajo de la tecnología

El espacio de trabajo tiene una cabecera, un panel de propiedades a la derecha y seis pestañas: **Resumen**, **Servidores**, **Aplicaciones**, **Operación**, **Cumplimiento** y **Relaciones**. Las pestañas **Servidores**, **Aplicaciones** y **Relaciones** muestran su número en una insignia.

### Cabecera

- **Nombre**: editable en el sitio.
- **Referencia**: haga clic para copiarla.
- **Ciclo de vida**: haga clic para cambiarlo. Una tecnología retirada ya no se ofrece cuando busca una para vincular.
- **Familia**.
- **Eliminar** (`infrastructure:admin`): la confirmación nombra lo que se va con la tecnología.

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

El soporte sigue vigente el día de su fecha de fin. Con una sola fecha, esa fecha es el fin. **Añadir versión** añade una línea; pase el ratón por una línea para editarla o eliminarla. Eliminar una versión que usan servidores o aplicaciones pide confirmación: esos vínculos muestran entonces una versión desconocida.

#### Alertas de vulnerabilidad

La última columna de la tabla de versiones tiene un interruptor por versión. Elige las versiones que cuentan en las alertas de vulnerabilidad. Una versión en las alertas aparece por defecto en la página [Vulnerabilidades](vulnerabilities.md), en los correos y en los contadores. Una versión fuera de las alertas se sigue cotejando con las vulnerabilidades: sus filas siguen en la sección [Vulnerabilidades](#vulnerabilidades) de la tecnología, y la página las muestra con su filtro **Alertas**.

- **Interruptor de la cabecera**: el ajuste de la tecnología. Se aplica a las versiones sin ajuste propio, a las versiones añadidas más tarde, y a los servidores y aplicaciones que no indican ninguna versión. Cambiarlo sustituye los ajustes propios de las versiones; cuando algunas tienen uno, KANAP pregunta primero e indica cuántas.
- **Interruptor de una versión**: una excepción para una versión. Un pequeño punto junto al interruptor marca una versión con ajuste propio. Vuelva a poner el interruptor en el valor de la cabecera y la versión sigue de nuevo a la tecnología.

Las nuevas tecnologías están en las alertas, salvo los sistemas operativos (consulte [Sistemas operativos](#sistemas-operativos)). Cambiar más tarde la familia de una tecnología deja su ajuste como está. Los interruptores requieren `infrastructure:member`.

#### Versiones del catálogo

Una versión que procede del catálogo muestra **Catálogo** junto a su etiqueta, y una tecnología adoptada desde el catálogo indica «Versiones y fechas mantenidas al día desde el catálogo» bajo sus versiones. KANAP consulta el catálogo cada día en la nube. En una instalación local, cada versión de KANAP trae su catálogo al arrancar, salvo que su administrador [active la comprobación diaria](on-premise/configuration.md#optional-technology-catalog).

La comprobación añade las nuevas versiones e identificadores de producto CPE del producto, y actualiza las fechas de fin de soporte y los identificadores que el catálogo cambió. Nunca sobrescribe un valor que usted cambió, y nunca vuelve a crear una versión o un identificador que usted eliminó. Una versión que registró antes de que el catálogo la conociera se vincula a él cuando las etiquetas coinciden, y se rellenan sus fechas vacías.

**Identificadores de producto CPE**: los nombres que las bases de datos de seguridad dan a este producto, con la forma `part:vendor:product` (por ejemplo `a:microsoft:sql_server`). KANAP los coteja con las vulnerabilidades publicadas: una tecnología sin ninguno no recibe ninguna vulnerabilidad. Un producto puede tener varios (vSphere abarca vCenter y ESXi). Dónde encontrar este valor: busque el producto en el [Diccionario CPE del NIST](https://nvd.nist.gov/products/cpe/search) y conserve su parte, su proveedor y su producto. Cópielos como los escribe la NVD, con la barra invertida delante de un signo: `a:veeam:veeam_backup_\&_replication`. Las entradas del catálogo llegan con sus identificadores, salvo los sistemas operativos.

**Notas**: texto libre, como las condiciones de licencia o las fechas de renovación.

### Servidores

Los servidores que llevan la tecnología, una fila por servidor y versión:

| Columna | Qué muestra |
|---|---|
| **Ref.**, **Servidor** | El servidor. Haga clic en la fila para abrirlo |
| **Entorno**, **Sistema operativo** | Tomados del servidor |
| **Versión** | La versión instalada. Un guion indica que la versión es desconocida |
| **Vía** | Para un servidor que lleva la tecnología a través de otro: el servidor o clúster en el que está instalada. La columna solo aparece si la pestaña tiene una fila así |
| **Notas** | Texto libre sobre esta instalación, por ejemplo «nodo del clúster» |

Una tecnología llega a un servidor de dos maneras:

- **Instalada**: alguien vinculó la tecnología a este servidor. Puede cambiar la versión y las notas en el sitio, o quitar la fila.
- **A través de otro servidor**: la tecnología está instalada en el servidor o clúster en el que se ejecuta este, por ejemplo SQL Server instalado en un clúster y mostrado en cada uno de sus miembros. La fila nombra ese servidor en **Vía**. Sigue a la instalación: cámbiela o quítela en ese servidor.

**Añadir** (`infrastructure:member`) abre una búsqueda de servidor y luego el selector de versión: elija una versión, **Versión desconocida**, o escriba una etiqueta nueva y elija **Añadir la versión «…»** para crearla. Cada cambio se guarda de inmediato.

Un servidor retirado sigue en la lista, en gris y marcado como «retirado», para que pueda quitar su vínculo. No cuenta en ninguna parte: ni en la insignia, ni en el total, ni en los contadores de la lista, ni en los informes. La fila **Total** cuenta los servidores en servicio, cada uno una vez.

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

**Exportar CSV** descarga las filas en el idioma de su pantalla.

### Operación

A quién llamar y cómo obtener ayuda:

- **Soporte**: los contactos de soporte, con su **Correo electrónico**, su **Teléfono** y su **Rol**. **Agregar contacto** abre un formulario corto: elija el **Contacto** (obligatorio) e indique un **Rol** opcional. Un contacto figura una sola vez; añadirlo de nuevo conserva su rol. Quite un contacto con la cruz al final de su fila.
- **Notas de soporte**: texto libre, como el número del contrato de soporte, el horario de la línea de ayuda o la vía de escalado. Se guardan al salir del campo.

La tecnología aparece entonces en la sección **Usado en** de la página de cada contacto.

### Cumplimiento

La misma clasificación que para las aplicaciones, para las tecnologías que cuentan en sus planes de continuidad:

- **Criticidad**: **Criticidad cibernética**.
- **Continuidad y recuperación**: **Ola de recuperación**, **Objetivo de tiempo de recuperación (RTO)** y **Objetivo de punto de recuperación (RPO)**.

Los niveles y las olas vienen de **Clasificaciones y continuidad** en la [Configuración del panorama IT](it-ops-settings.md#clasificaciones-y-continuidad). Pase el ratón por el signo de interrogación junto a un campo para ver su significado.

Debajo, cuando se siguen las vulnerabilidades, la sección **Vulnerabilidades** lista las vulnerabilidades conocidas de las versiones en uso. Consulte [Vulnerabilidades](#vulnerabilidades).

#### Vulnerabilidades

Una fila por versión y vulnerabilidad, la más grave primero, con su **CVE**, su **Gravedad**, su **Versión** y su **Estado**. El número junto al título es el número de vulnerabilidades distintas. Haga clic en una fila para abrirla en la página [Vulnerabilidades](vulnerabilities.md), donde la revisa.

La sección lista todas las filas, en las alertas o no. Una fila atenuada indica por qué:

- **Ya no coincide**: usted revisó la fila, y su versión ya no coincide con la vulnerabilidad.
- **Excluida de las alertas**: su versión está fuera de las alertas.

Cuando la tecnología o algunas de sus versiones están fuera de las alertas, una línea al principio de la sección lo indica: **Excluida de las alertas**, **Excluida de las alertas, excepto 2 versiones** o **3 versiones excluidas de las alertas**. Con `infrastructure:member`, **Cambiar** junto a ella abre la tabla de versiones de la pestaña Resumen, donde están los interruptores. Consulte [Alertas de vulnerabilidad](#alertas-de-vulnerabilidad).

KANAP vuelve a cotejar la tecnología en cuanto cambian sus identificadores, versiones, servidores o aplicaciones. Tras un nuevo identificador de producto CPE, la sección indica «Búsqueda de vulnerabilidades en curso…» mientras KANAP lee ese producto en la NVD. **Volver a cotejar** (`infrastructure:member`) lanza la comparación a mano.

### Relaciones

Los registros vinculados a la tecnología, una sección por tipo:

- **Líneas presupuestarias**: con el importe del año en curso en la columna presupuestaria de su espacio de trabajo, y un total. Una línea cuya moneda no tiene tipo de cambio para el año muestra su importe en su propia moneda con una pequeña marca naranja, y el total la excluye. Un aviso de una línea bajo la tabla la indica. Vea [Tipos manuales](currencies.md#tipos-manuales).
- **Contratos**: proveedor, fecha de fin e importe anual, con un total por moneda.
- **Proyectos**: estado y fin previsto.
- **Incidentes**: gravedad, estado y fecha de detección. Vincular un incidente requiere `incidents:contributor`. Un incidente cerrado o cancelado no se puede vincular ni desvincular.
- **Documentos**: los archivos subidos a la tecnología, con su tamaño y su fecha. **Añadir** sube archivos; haga clic en un nombre para descargarlo.
- **Enlaces web**: un nombre y una dirección, como las notas de la versión del editor. Haga clic en el nombre para abrirlo; pase el ratón por una fila para editarla. Las direcciones empiezan por `http://` o `https://`; una dirección sin prefijo se abre como `https://`.

Una sección solo aparece si puede leer su módulo. **Añadir** (`infrastructure:member`) abre una búsqueda en el sitio; la cruz al final de una fila quita el vínculo.

---

## Vincular una tecnología a un servidor

Puede registrar que un servidor lleva una tecnología desde cualquiera de los dos lados:

- Desde la tecnología: pestaña **Servidores**, **Añadir**, y elija el servidor y la versión.
- Desde el servidor: pestaña **Técnico** del activo, sección **Tecnologías**, **Añadir**, y elija la tecnología y la versión. Consulte [Activos](assets.md#tecnico).

Registre la tecnología en el servidor donde está instalada: el host para un hipervisor, cada controlador de dominio para Active Directory, el servidor de base de datos para SQL Server. Los servidores que se ejecutan dentro de él, o los miembros de su clúster, la muestran entonces sin más trabajo. Una tecnología en la nube, como Entra ID, no se ejecuta en ninguno de sus servidores: declárela en las aplicaciones.

---

## Importar y exportar vínculos

La lista de tecnologías carga y descarga vínculos en bloque, un vínculo por fila de un archivo CSV. Existen dos archivos:

- **Servidores y tecnologías**: las tecnologías instaladas en cada servidor.
- **Aplicaciones y tecnologías**: las tecnologías que declara cada aplicación. Las aplicaciones alojadas en un servidor que lleva una tecnología se deducen de los servidores, así que el archivo las deja fuera.

Haga clic en **Importar vínculos** o **Exportar vínculos** en la barra de herramientas y elija el archivo. La exportación ofrece los datos o una plantilla vacía. Se aplican las reglas generales de los archivos CSV: codificación, separador, sí y no en cuatro idiomas, 20.000 filas como máximo. Consulte [Archivos CSV](csv-files.md).

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

- **sí**: el vínculo pasa a ser el sistema operativo del servidor. La importación rechaza la fila cuando la tecnología no es de la familia **Sistema operativo**, cuando el servidor es un clúster o cuando el servidor ya tiene otro sistema operativo.
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

- **Aplicaciones**: la sección **Tecnologías**, arriba en la pestaña Operaciones, lista aquello de lo que depende una aplicación. Consulte [Aplicaciones](applications.md#operaciones).
- **Activos**: la sección **Tecnologías** de la pestaña Técnico de un activo lista lo que lleva el servidor, con su sistema operativo primero. Consulte [Activos](assets.md#tecnico).
- **Contratos**, **líneas presupuestarias** e **incidentes**: un campo **Tecnologías** en su pestaña Relaciones, para los usuarios que pueden leer la infraestructura.
- Informe **Fin de soporte**: las versiones que llegan a su fin de soporte, sistemas operativos incluidos, y lo que afectan. Consulte [Fin de soporte](end-of-support.md).
- **Vulnerabilidades**: las vulnerabilidades conocidas de las versiones en uso, y los servidores y aplicaciones a los que llegan. Consulte [Vulnerabilidades](vulnerabilities.md).
- **Zonas de administración**: los servicios de directorio con su zona, y los servidores que llevan una tecnología de directorio fuera de la zona más sensible. Consulte [Zonas de administración](administration-view.md).
- **Contactos**: la sección **Usado en** de un contacto lista las tecnologías a las que da soporte. Consulte [Contactos](contacts.md#donde-se-usan-los-contactos).
- **Búsqueda**: la búsqueda global y las menciones `@` del asistente encuentran las tecnologías por nombre y por referencia (`@TEC-4`).

## Convertir una aplicación

Una ficha creada como aplicación puede ser en realidad una tecnología, por ejemplo un motor de base de datos o un directorio. Abra la aplicación y use **Convertir en tecnología**. Consulte [Aplicaciones](applications.md#convertir-una-aplicacion-en-tecnologia).

## Consejos

- **Parta del catálogo**: obtiene las versiones y sus fechas de fin de soporte sin escribirlas.
- **Siga las versiones principales**: una línea por versión principal (2019, 2022) basta para seguir el soporte.
- **Nombre a los responsables**: los responsables de TI son las personas a quienes llamar cuando una versión llega a su fin de soporte. También reciben el correo sobre las nuevas vulnerabilidades críticas.
- **Rellene los identificadores de producto CPE**: sin ellos, KANAP no puede cotejar la tecnología con las vulnerabilidades publicadas.
- **Registre la versión en cada servidor**: una versión desconocida está potencialmente afectada por todas las vulnerabilidades del producto.
