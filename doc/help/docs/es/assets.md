# Activos

Los activos documentan el inventario de su infraestructura: servidores físicos, máquinas virtuales, contenedores, instancias de nube y dispositivos de red. Vincule activos a ubicaciones, aplicaciones, conexiones, contratos, proyectos y tareas para construir una imagen completa de su infraestructura IT.

## Primeros pasos

Navegue a **Panorama IT > Activos** para ver su inventario de activos. Haga clic en **Añadir activo** para crear su primera entrada.

**Campos obligatorios**:
- **Nombre**: El nombre del activo o su nombre de host, 200 caracteres como máximo
- **Tipo de activo**: Servidor web, Máquina virtual, Servidor físico, Contenedor, etc. (configurable en **Panorama IT > Configuración**). No hay ningún tipo preseleccionado: **Crear** no está disponible hasta que elija uno
- **Ubicación**: Dónde se aloja el activo (determina el proveedor, el tipo de alojamiento y el país)

**Muy recomendados**:
- **Ciclo de vida**: Estado actual (Activo, Obsoleto, Retirado, etc.)
- **Entorno**: A qué entorno pertenece este activo (Prod, Pre-prod, QA, Test, Dev, Sandbox)

**Nombres únicos**: dos activos no pueden tener el mismo nombre ni el mismo FQDN. Las mayúsculas y los espacios al principio o al final no cuentan. KANAP rechaza el duplicado e indica el activo que ya tiene el valor (`AST-12`). Los duplicados registrados antes siguen siendo editables mientras no cambie ese valor.

**Consejo**: Use convenciones de nomenclatura coherentes que incluyan información de entorno y rol (p. ej., `prod-web-01`, `dev-db-master`). Al crear un nuevo activo, el nombre de host se deriva automáticamente del nombre que escriba.

**Permisos**:
- Ver: `infrastructure:reader`
- Crear / editar: `infrastructure:member`
- Importar / Exportar / Eliminar: `infrastructure:admin`

---

## Trabajar con la lista { #working-with-the-list }

La lista de activos le ofrece una visión filtrable y ordenable de cada activo de su inventario.

**Columnas predeterminadas**:

| Columna | Qué muestra |
|---------|-------------|
| **#** | Referencia del activo (p. ej., `AST-123`), monoespaciado. Se ordena por número |
| **Nombre** | Nombre del activo (haga clic para abrir el espacio de trabajo) |
| **Vulnerabilidades por revisar** | Las vulnerabilidades aún por revisar en las tecnologías registradas en el activo y, en naranja, cuántas son críticas o altas (`5 · 2`). Vacía para un activo retirado o cuando no queda ninguna. Haga clic para abrir la página [Vulnerabilidades](vulnerabilities.md) filtrada por el activo. Presente cuando se siguen las vulnerabilidades |
| **Tipo de activo** | El tipo del activo (p. ej., Máquina Virtual, Servidor Físico) |
| **Clúster** | Los clústeres de los que el activo es miembro. Un clúster muestra en su lugar un icono ("Clúster" en su información emergente). Vacío para un activo que no está en ningún clúster |
| **Entorno** | Prod, Pre-prod, QA, Test, Dev, Sandbox, con un punto de color |
| **Ubicación** | Dónde se aloja el activo |
| **Alojamiento** | Tipo de alojamiento (derivado de la ubicación) |
| **OS** | Sistema operativo: la tecnología marcada como sistema operativo del servidor, con su versión |
| **Zona de red** | La zona de red de la subred de la primera dirección IP. Una subred vinculada a la ubicación del activo tiene prioridad sobre una subred del mismo rango sin ubicación |
| **Ciclo de vida** | Estado actual del ciclo de vida |
| **Asignaciones** | Número de asignaciones de aplicaciones, incluidas las heredadas de sus clústeres |
| **Creado** | Cuándo se creó el registro |

**Ordenación predeterminada**: **Creado** descendente (los más recientes primero).

**Columnas adicionales** (ocultas por defecto, disponibles mediante el selector de columnas):
- **Sublocalización**: Área específica dentro de la ubicación (edificio, sala, rack)
- **Puesta en marcha**: Fecha en que el activo entró en producción
- **Fin de vida**: Fecha planificada o efectiva de retiro
- **Zona de administración**: La zona de su modelo de administración a la que pertenece el activo

**Filtrado**:

La mayoría de columnas admiten filtros de conjunto de casillas para un filtrado rápido de selección múltiple. Las opciones de filtro se actualizan dinámicamente según otros filtros activos y la consulta de búsqueda, de modo que solo ve los valores que existen en el conjunto de resultados actual.

| Columna | Notas |
|---------|-------|
| Tipo de activo | Filtrar por uno o más tipos de activo |
| Clúster | Los nombres de los clústeres, luego **(Es un clúster)** para los propios clústeres y **(Sin clúster)** para los activos que no están en ningún clúster |
| Entorno | Prod, Pre-prod, QA, Test, Dev, Sandbox |
| Ubicación | Incluye "(Sin ubicación)" para activos no asignados |
| Sublocalización | Incluye "(Sin sublocalización)" para activos sin sublocalización |
| Alojamiento | Filtrar por tipo de alojamiento |
| OS | Filtrar por sistema operativo |
| Zona de red | Filtrar por segmento de red |
| Ciclo de vida | Filtrar por estado del ciclo de vida |
| Zona de administración | Incluye "(Vacío)" para los activos sin zona |
| Vulnerabilidades por revisar | **Con vulnerabilidades graves**, **Con vulnerabilidades** o **Sin**. Un activo retirado no entra en ninguno de estos valores |

Ordenar por **Vulnerabilidades por revisar** clasifica los activos por sus vulnerabilidades críticas o altas y luego por su total. Los activos retirados van al final. La columna solo cuenta vínculos directos: una máquina virtual no cuenta las vulnerabilidades de su host. Consulte [Lo que KANAP cuenta](vulnerabilities.md#what-kanap-counts).

**La búsqueda rápida** abarca el nombre, la referencia, el nombre de host, el FQDN, las direcciones IP, el clúster, la ubicación, la sububicación y el sistema operativo.

**Consejo**: Combine filtros entre columnas para acotar resultados. Por ejemplo, filtre por Entorno = "Prod" y Ciclo de vida = "Activo" para ver solo los activos activos de producción.

**Acciones**:
- **Añadir activo**: abre un menú (`infrastructure:member`). **Añadir activo** crea un activo; **Añadir clúster** crea uno con el conmutador **Clúster** ya activado
- **Importar** / **Exportar**: Operaciones masivas en CSV o Excel (`infrastructure:admin`). La exportación contiene los activos que muestra la lista. Consulte [Opciones de exportación](#export-options)
- **Eliminar activo** (filas seleccionadas): Eliminar los activos seleccionados (`infrastructure:admin`). Un activo todavía asignado a aplicaciones o vinculado a conexiones no se puede eliminar. La negativa nombra las aplicaciones y hasta cinco conexiones por referencia y nombre. Retire primero el activo de esos vínculos. Una asignación que el activo solo hereda de su clúster no lo impide. Antes de eliminar nada, la confirmación enumera los activos que se conservan, con el motivo, y lo que los demás se llevan consigo (consulte [Eliminar un clúster o un miembro](#deleting-a-cluster-or-a-member))

---

## Clústeres

Los activos pueden organizarse en clústeres:

- **Activo regular**: Una instancia individual de infraestructura
- **Clúster**: Un grupo de activos que actúan como una única unidad lógica

Para crear un clúster, elija **Añadir clúster** en el menú **Añadir activo**, o active el conmutador **Clúster** en el panel de propiedades de un activo. Una conexión puesta en un clúster vale para sus miembros: consulte [Conexiones en un clúster](connections.md#connections-on-a-cluster).

### Aplicaciones en un clúster { #applications-on-a-cluster }

Una aplicación puede asignarse a un clúster, desde la pestaña **Despliegues** de la aplicación o la pestaña **Operaciones** del clúster. Sus miembros en servicio alojan entonces la aplicación con el rol de la asignación del clúster. Un miembro añadido más tarde también la aloja. Un miembro sacado del clúster deja de alojarla. Un miembro retirado no hereda nada, y un clúster retirado no transmite nada.

Dónde asignar depende del clúster:

- **Clúster de conmutación por error** (SQL Server Always On, por ejemplo): la aplicación se ejecuta en cada nodo. Asígnela al clúster.
- **Clúster de virtualización** (vSphere, por ejemplo): las aplicaciones se ejecutan en las máquinas virtuales que el clúster contiene. Asigne cada aplicación a su máquina virtual. Solo la plataforma misma, como vSphere con el rol de virtualización, se asigna al clúster.

Un miembro ejecuta lo que está asignado a su clúster. Un activo que el clúster contiene se ejecuta dentro de él y no hereda nada.

Cuando asigna una aplicación a un miembro de un clúster, KANAP pregunta **¿Asignar al clúster?**: **Asignar al clúster** pone la asignación en el clúster para todos sus miembros, **Solo este servidor** la mantiene en ese servidor. La pregunta nombra a los miembros cuya asignación propia del mismo entorno y rol será sustituida por la del clúster. La asignación del clúster conserva entonces la fecha **Desde** más antigua y sus notas. Cuando el miembro ya aloja la aplicación con ese rol a través de su clúster, no se crea nada y un mensaje lo indica. Una asignación hecha con el asistente sigue las mismas reglas, sin la pregunta.

Allí donde KANAP lee dónde se ejecuta una aplicación, cuenta los miembros del clúster: las vulnerabilidades y el fin de soporte de la aplicación, su tipo de alojamiento (un clúster sin ubicación toma el tipo de alojamiento de sus miembros), las zonas de administración, las aplicaciones de una ubicación o de un contrato sobre un servidor, el asistente y Conocimiento. En el impacto de un miembro caído, el clúster queda degradado y sus aplicaciones siguen funcionando. Consulte [Dependencias](#dependencies).

Los miembros se gestionan en la parte superior de la pestaña **Operaciones** del clúster. Consulte [Operaciones](#operations). Las reglas:

- Un miembro es un activo simple. Un clúster no puede ser miembro, y un activo no puede ser miembro de sí mismo.
- Un clúster que tiene miembros no puede volver a ser un activo simple: quite primero sus miembros.
- Un miembro de un clúster no puede convertirse en clúster: sáquelo primero de sus clústeres.
- Un clúster que tiene miembros no tiene sistema operativo: cada miembro tiene el suyo. Un clúster sin miembros puede conservar uno, por ejemplo un grupo de instancias en la nube cuyos servidores usted no registra. Consulte [Sistema operativo](#sistema-operativo).

Las instalaciones actualizadas desde una versión anterior conservan sus clústeres. Las pertenencias contrarias a estas reglas se retiraron durante la actualización. Un nombre de clúster escrito en el antiguo campo de texto se convirtió en una pertenencia real cuando designaba un único clúster.

### Máquinas virtuales en un clúster { #virtual-machines-on-a-cluster }

Un clúster de virtualización contiene sus máquinas virtuales: añádalas a la sección **Contiene** del clúster, en su pestaña **Dependencias**. Una máquina del clúster puede ejecutarse en cualquiera de sus hosts.

Cuando añade una relación **Contiene** desde un host que pertenece a un clúster, KANAP pregunta **¿Colocar en el clúster?**. **Colocar en el clúster** pone la relación en el clúster. **Solo este host** la mantiene en el host. La misma pregunta aparece cuando añade un host así en **Contenido en**. Un host o un clúster retirado no plantea la pregunta.

- Colocar un activo en el clúster sustituye los vínculos que los hosts miembros tenían con él. Un mensaje nombra los hosts.
- Un host no puede contener un activo que su clúster ya contiene. El mensaje nombra el clúster.
- Un activo con dos contenedores en servicio, por ejemplo un host y un clúster, lleva un icono de advertencia junto a su nombre en **Contiene** y **Contenido en**. La información emergente nombra los demás contenedores. Quite el vínculo que ya no está al día.

El asistente y la [sincronización con Netbox](netbox.md#clusters) siguen las mismas reglas, sin la pregunta.

### Eliminar un clúster o un miembro { #deleting-a-cluster-or-a-member }

Antes de eliminar un activo, la confirmación indica lo que se va con él: los clústeres que abandona, los miembros que pierden su clúster y las relaciones con otros activos que se eliminan. Confirme con **Eliminar de todos modos**. El [Registro de auditoría](admin.md#registro-de-auditoria) registra estas pérdidas: en cada clúster que abandona y en cada activo que tenía una relación con él, y, para sus propios miembros y relaciones, en la entrada de su eliminación.

---

## El espacio de trabajo de Activos

Haga clic en cualquier fila para abrir el espacio de trabajo. El espacio de trabajo tiene un **encabezado** con metadatos rápidos, un **panel de propiedades** a la derecha (la tarjeta de identidad del activo, siempre visible) y un **área de contenido** en el centro que cambia con cada pestaña.

Una dirección que no designa ningún activo abre una página **Activo no encontrado**, con un enlace para volver a la lista.

Las pestañas son **Vista general**, **Operaciones**, **Red**, **Hardware** (solo para tipos de activos físicos), **Dependencias**, **Relaciones** e **Historial** (los cambios hechos en el activo, vea [Historial de los registros](record-history.md)). Al crear un activo, **Vista general** y **Red** están abiertas. Las demás pestañas se abren en cuanto hace clic en **Crear**.

### Encabezado

El encabezado muestra:
- **Nombre del activo** (editable en línea)
- **Referencia del activo** (p. ej., `AST-123`): identificador copiable
- Chip de **Ciclo de vida** (también editable desde el panel de propiedades)
- **Vulnerabilidades graves**, por ejemplo «3 graves»: las vulnerabilidades críticas o altas aún por revisar en el activo, con el color de la más alta. Un icono de alerta aparece cuando algunas se conocen como explotadas. Haga clic para abrir la página [Vulnerabilidades](vulnerabilities.md) filtrada por el activo. Solo se muestra cuando el activo tiene alguna
- **Compartir**: copiar un enlace compartible a este espacio de trabajo
- **Eliminar**, un icono de papelera con su nombre en una información emergente (`infrastructure:admin`). Para un activo todavía en uso, el motivo aparece antes de cualquier confirmación
- **Anterior / Siguiente** (p. ej., "3 de 47"): navegar por la lista filtrada sin volver a ella

### Panel de propiedades (panel derecho)

El panel muestra la tarjeta de identidad del activo en cada pestaña. Las ediciones se guardan automáticamente. Los campos se reparten en tres grupos.

**Tipo y zona**:
- **Tipo de activo** (obligatorio)
- **Clúster**: actívelo para marcar el activo como clúster. El cambio se guarda de inmediato y no quita nada. Se rechaza para un clúster que tiene miembros y para un miembro de un clúster. Consulte [Clústeres](#clusteres)
- **Entorno**: Prod, Pre-prod, QA, Test, Dev, Sandbox
- **Zona de administración**: La zona de su modelo de administración a la que pertenece el activo, por ejemplo el Tier 0 para un controlador de dominio y el hipervisor que lo ejecuta. Elija entre las zonas configuradas en **Panorama IT > Configuración**, o **Sin zona**. El activo aparece entonces en esa zona en la página [Zonas de administración](administration-view.md)

**Ubicación**:
- **Ubicación** (obligatorio)
- **Sub-ubicación** (cuando la ubicación tiene sub-ubicaciones definidas)
- **Tipo de alojamiento**, **Empresa operadora** o **Proveedor cloud**, **País**, **Ciudad**: de solo lectura, derivados de la ubicación. Se actualizan cuando cambia la ubicación

**Ciclo de vida**:
- **Ciclo de vida**: Activo, Obsoleto, Retirado, etc. (configurable en Configuración)
- **Fecha de puesta en marcha**: Cuándo entró el activo en producción
- **Fecha de fin de vida**: Fecha planificada o efectiva de retiro

---

### Vista general

La pestaña Vista general es la página de inicio del activo.

**Netbox**: en un activo vinculado a Netbox, una línea en la parte superior indica cuándo se sincronizó por última vez, con **Abrir en Netbox**. También indica cuando el objeto ya no está en Netbox, cuando su estado en Netbox requiere atención y cuando el activo está **Gestionado por Netbox**. Consulte [Sincronización con Netbox](netbox.md).

**Datos básicos** (al crear un activo): **Nombre**, **Tipo de activo**, **Ubicación** y **Entorno**.

**Descripción**: Una descripción enriquecida del activo. Se guarda automáticamente mientras edita.

**Soporte**: el soporte del proveedor del activo, para cualquier tipo de activo. Aparece una vez creado el activo y se guarda solo mientras escribe.

- **Proveedor**: Seleccionar del directorio de proveedores
- **Contrato de soporte**: Vincular a un registro de contrato
- **Nivel de soporte**: Texto libre (p. ej., Oro, Plata, 24x7)
- **Vencimiento del soporte**: Fecha de expiración
- **Notas**

**Contactos de soporte**: Una tabla donde puede añadir contactos del directorio de contactos, cada uno con una etiqueta de rol de texto libre. La tabla muestra automáticamente el correo, teléfono y móvil de cada contacto.

**Conocimiento**: Artículos de conocimiento vinculados a este activo. Con `knowledge:member` puede crear nuevos artículos directamente desde esta sección. Aparece una vez creado el activo.

---

### Operaciones { #operations }

La pestaña Operaciones muestra el clúster del activo y lo que se ejecuta en él: las aplicaciones que aloja, las tecnologías que lleva y sus vulnerabilidades. Se abre una vez creado el activo.

**Clúster**, en la parte superior de la pestaña:

- En un **clúster**, la sección **Miembros** lista los activos miembros (Nombre, Entorno, Estado, Sistema operativo). Haga clic en un nombre para abrir ese activo. **Añadir miembros** (en un clúster sin miembros) o **Editar miembros** abre un cuadro de diálogo de búsqueda. Solo ofrece activos simples, nunca un clúster ni el propio clúster. Un icono de advertencia señala un miembro cuyo entorno difiere del del clúster. Cuando quita miembros de un clúster que lleva aplicaciones, **¿Quitar miembros?** nombra las aplicaciones que cada uno dejará de alojar. **Quitar de todos modos** guarda.
- En un servidor que pertenece a un clúster, la sección **Pertenencia al clúster** muestra sus clústeres, con su entorno y su estado. Haga clic en un nombre para abrir el clúster. Un servidor que no está en ningún clúster no tiene esta sección.

**Aplicaciones alojadas**: las aplicaciones que se ejecutan en este activo. Cada fila muestra:

| Columna | Qué muestra |
|---------|-------------|
| **Aplicación** | Nombre de la aplicación. Haga clic en él para abrir la aplicación en su pestaña **Despliegues** |
| **Entorno** | El entorno de despliegue al que pertenece la asignación |
| **Rol** | Rol del servidor (Web, Base de datos, Aplicación, etc.) |
| **Desde** | Fecha en que se asignó el servidor |
| **Notas** | Notas de texto libre |

Haga clic en **Añadir asignación** para vincular este activo a un despliegue de aplicación. Elija la aplicación, luego el entorno (la aplicación ya debe tener un despliegue en ese entorno), luego el rol y la fecha / notas opcionales. En un miembro de un clúster, KANAP pregunta primero si asignar el clúster o solo este servidor. Consulte [Aplicaciones en un clúster](#applications-on-a-cluster). El lápiz al final de una fila abre la aplicación: la asignación se edita en su pestaña **Despliegues**. El icono de papelera quita la asignación, tras una confirmación. **Añadir asignación** no está disponible mientras no haya ningún rol de servidor configurado en **Panorama IT > Configuración**. Estos comandos requieren `infrastructure:member` y `applications:member`. Sin ambos, la tabla es de solo lectura.

En un miembro, una aplicación asignada a su clúster se muestra «vía» el nombre del clúster, sin lápiz ni papelera: modifíquela en el clúster.

En un clúster, cuando una aplicación está asignada directamente a cada uno de sus miembros en servicio, una línea bajo la tabla los nombra, con **Asignar al clúster**. Tras una confirmación, el clúster toma la asignación y se quitan las asignaciones propias de los miembros. La aplicación sigue entonces disponible mientras un miembro siga activo.

**Tecnologías**: lo que lleva el servidor, por ejemplo Windows Server, SQL Server, vSphere o Active Directory. Columnas: **Ref.**, **Nombre**, **Familia**, **Versión** y, cuando el servidor lleva una tecnología a través de otro, **Vía**.

- **Sistema operativo**: el sistema operativo del servidor es una de sus tecnologías, de la familia **Sistema operativo**. Aparece primero en la lista, con la mención «Sistema operativo» tras su nombre. Consulte [Sistema operativo](#sistema-operativo) más abajo.
- **Versión**: en naranja cuando el soporte termina en los próximos 12 meses o solo queda el soporte extendido, y en rojo cuando todas las fechas de fin han pasado. Pase el ratón por encima para ver el fin del soporte estándar y del extendido.
- Una tecnología instalada en este servidor se quita con la cruz al final de su fila.
- En un clúster, una tecnología instalada en sus miembros aparece una vez por versión, con los miembros que la llevan en **Vía**. Una línea así sigue a la instalación y se quita allí.
- Una tecnología que solo viene del host en el que se ejecuta este servidor, como el ESXi de su host, es la plataforma subyacente. Se agrupa bajo una línea cerrada al final de la tabla, **Plataforma subyacente (n)**, con el host en **Vía**. Haga clic en la línea para mostrarla. Estas filas no se cuentan en la sección.
- **Añadir** (`infrastructure:member`) abre una búsqueda de tecnología y luego el selector de versión: elija una versión, **Versión desconocida**, o escriba una etiqueta nueva y elija **Añadir la versión «…»** para crearla. Cada cambio se guarda de inmediato.
- **Cambiar una versión** (`infrastructure:member`): haga clic en la versión de una tecnología instalada, o en el lápiz al final de su fila. Se abre el mismo selector de versión.

Las notas de una instalación se cambian desde la pestaña **Servidores** de la tecnología. Consulte [Tecnologías](technologies.md#servidores).

#### Sistema operativo

Un servidor tiene un sistema operativo: una tecnología de la familia **Sistema operativo**, con su versión.

- **Añádalo** como cualquier tecnología. Si el servidor aún no tiene sistema operativo, la primera tecnología de esa familia que añada pasa a serlo.
- **Quítelo** con su cruz. Si queda otra tecnología de la familia en el servidor, esa pasa a ser el sistema operativo.
- **Cambie la versión** haciendo clic en ella, como en cualquier tecnología.
- Un **clúster** que tiene miembros no tiene sistema operativo: cada miembro tiene el suyo. Un clúster sin miembros puede llevar uno, establecido por una importación o por el asistente. En pantalla, una tecnología de esa familia añadida a un clúster sigue siendo una tecnología normal.
- Añadir los primeros miembros a un clúster que tiene sistema operativo hace la pregunta **¿Quitar el sistema operativo?**. **Quitar y guardar** lo quita y guarda los miembros. Si cancela, no se guarda nada.

Para que VMware ESXi o FortiOS sea el sistema operativo de un host, ponga esa tecnología en la familia **Sistema operativo** (su campo **Familia**, en la tecnología).

El sistema operativo aparece en la columna **OS** de la lista, en la tabla de miembros de un clúster y en el [Mapa de conexiones](connection-map.md). Sus versiones y fechas de fin de soporte vienen de la tecnología: consulte [Tecnologías](technologies.md).

#### Vulnerabilidades

Cuando se siguen las vulnerabilidades, la última sección de la pestaña lista las vulnerabilidades aún por revisar en las tecnologías registradas en este activo, en las alertas. El número junto al título es el de vulnerabilidades distintas por revisar: haga clic en él para abrir la página [Vulnerabilidades](vulnerabilities.md) filtrada por el activo. Una línea por tecnología y versión:

| Columna | Qué muestra |
|---|---|
| **Tecnología**, **Versión** | La tecnología y su versión. **Versión no registrada (potencialmente afectada)** cuando el activo no indica ninguna versión |
| **Crít.**, **Alta**, **Media**, **Baja**, **S. eval.** | Una columna por gravedad (Crítica, Alta, Media, Baja, Sin evaluar, el nombre completo en una información emergente del encabezado): las vulnerabilidades aún por revisar. Una vulnerabilidad calificada **Ninguna** cuenta con **Baja** |
| **Total** | Las vulnerabilidades distintas aún por revisar en esta línea |

**Ver** abre la página [Vulnerabilidades](vulnerabilities.md) filtrada por el activo y la tecnología. Cuando no queda nada por revisar, la sección lo dice en una línea. Mientras la primera lectura de un producto en la NVD, o el cotejo de una tecnología recién registrada en este activo, sigue en curso, la sección muestra «Búsqueda de vulnerabilidades en curso…» y se completa sola. Cuando la búsqueda no se puede completar, la sección lo dice. Un activo retirado no tiene sección.

En un **clúster**, **En sus miembros** lista aparte las tecnologías de sus miembros, una línea por tecnología y versión, con los miembros que la llevan en la columna **Activo**. Un clúster cuenta las vulnerabilidades de sus miembros en servicio con las suyas: el número de la sección, la insignia del encabezado (su información emergente dice "miembros incluidos") y la columna de la lista. El **Ver** de una línea abre la página en el miembro que la lleva.

Lo que solo viene del host en el que se ejecutan el activo o sus miembros, como el ESXi del host de una máquina virtual, es la plataforma subyacente. Se agrupa bajo una línea cerrada **Plataforma subyacente (n)**, que se abre con un clic. No se cuenta ni en la sección, ni en la insignia, ni en la columna de la lista: una vulnerabilidad cuenta en el activo donde la tecnología está registrada. Su **Ver** abre la página en ese host. Consulte [Lo que KANAP cuenta](vulnerabilities.md#what-kanap-counts).

---

### Red { #network }

La pestaña Red reúne la identidad de red del activo, sus direcciones IP y sus conexiones. Está abierta al crear un activo. Si el nombre de host no es válido al hacer clic en **Crear**, la pestaña se abre sobre el error.

En un activo gestionado por Netbox, una línea en la parte superior indica que Netbox rellena los campos que proporciona y que los demás quedan a su cargo.

**Identidad**:
- **Nombre de host**: El nombre de host de red del activo. Se rellena previamente desde el nombre del activo en la creación; puede sobrescribirlo en cualquier momento. Obligatorio cuando se selecciona un dominio. Admite letras, dígitos, guiones y puntos, y cada parte entre puntos puede tener 63 caracteres como máximo, de modo que un nombre como `DL3.ROBOT-15MS.IE2000` es válido tal cual.
- **Dominio**: El dominio Active Directory o DNS al que pertenece el activo. Elija entre los dominios configurados en **Panorama IT > Configuración**. Las opciones del sistema incluyen "Workgroup" (independiente) y "N/A" (no aplicable).
- **FQDN**: Nombre de Dominio Completamente Cualificado, calculado automáticamente desde el nombre de host y el sufijo DNS del dominio. Solo lectura.
- **Alias**: Nombres DNS o alias adicionales para este activo. Escriba y pulse Enter para añadir.

**Direcciones IP**:

Los activos admiten múltiples direcciones IP, cada una con su propia configuración de red:

- Haga clic en **Añadir dirección IP** para añadir una nueva entrada.
- **Tipo**: El propósito de la dirección IP (Host, IPMI, Gestión, iSCSI o tipos personalizados de Configuración)
- **Dirección IP**: La dirección en sí. Una dirección mal formada se rechaza, con el mensaje bajo el campo
- **Subred**: Subred de red de la lista configurada (filtrada por la ubicación del activo)
- **Zona de red**: Derivada automáticamente de la subred seleccionada (solo lectura)
- **VLAN**: Derivada automáticamente de la subred seleccionada (solo lectura)

Esto le permite documentar múltiples interfaces de red por activo, por ejemplo, un servidor físico con tanto una IP de host como una dirección de gestión IPMI en subredes diferentes.

**Conexiones**: Una vista de solo lectura de las conexiones de este activo, una vez creado: aquellas en las que es un extremo, un servidor o el equipo de un salto, y las de sus clústeres. Cada fila muestra la referencia y el nombre (haga clic para abrir la conexión), la topología, los protocolos, el origen y el destino, y el estado del ciclo de vida. Bajo el nombre, **Salto 2** indica que el activo es el equipo de ese salto, y **vía** nombra el clúster cuando la conexión llega al activo a través de él. Una conexión multi-servidor nombra sus servidores en lugar del origen y el destino. Para crear o editar una conexión, navegue a **Panorama IT > Conexiones**.

---

### Hardware

*Solo visible para tipos de activos físicos. Se abre una vez creado el activo.*

Hace seguimiento de los detalles físicos del hardware. Se guarda automáticamente mientras escribe.

- **Número de serie**
- **Fabricante**
- **Modelo**
- **Fecha de compra**
- **Ubicación en el rack** (p. ej., Fila A, Rack 12)
- **Unidades de rack** (p. ej., U1-U4)
- **Notas**

---

### Dependencias { #dependencies }

La pestaña Dependencias muestra la posición del activo entre los demás activos: lo que se detiene con él y sus relaciones con otros activos. Se abre una vez creado el activo. La insignia de la pestaña cuenta las relaciones entre activos. Los miembros de un clúster están en la pestaña [Operaciones](#operations).

**Si este servidor cae**: la pestaña empieza por lo que se detiene con este activo. Una línea de resumen cuenta las aplicaciones, activos, clústeres y procesos de negocio afectados, y después una tabla por tipo:

- **Aplicaciones**: las que tienen un despliegue en servicio en un activo caído, con sus entornos, su criticidad y los activos en los que se ejecutan (**Vía**).
- **Activos**: los activos que contiene, hasta tres niveles, y los activos que dependen de él. Un clúster que cae arrastra a todos sus miembros en servicio, y lo que depende de ellos. **Vía** muestra el camino.
- **Clústeres**: los clústeres con un miembro caído. **Degradado** mientras un miembro sigue en pie, con el número de miembros caídos: sus aplicaciones siguen funcionando. **Caído** cuando ningún miembro sigue en pie: sus aplicaciones y los activos que contiene, como sus máquinas virtuales, caen con él.
- **Procesos de negocio**: los procesos de las aplicaciones afectadas.

Los activos retirados cortan la cadena: nada cae a través de ellos. Cada tabla muestra sus 50 primeras filas y cuenta el resto. Las aplicaciones y los procesos requieren el derecho de leerlos. La sección se actualiza en cuanto añade o quita una relación entre activos, cambia los miembros de un clúster o activa o desactiva el conmutador **Clúster**.

**Relaciones entre activos**, una tabla por sentido:

| Sección | Significado |
|---|---|
| **Contiene** | Los activos que están dentro de este, por ejemplo los servidores de un rack |
| **Contenido en** | Los activos en los que se encuentra este |
| **Depende de** | Los activos que este necesita para funcionar, por ejemplo un servidor de base de datos |
| **Requerido por** | Los activos que necesitan este |

Cada tabla muestra la referencia (`AST-12`), el nombre, el tipo, el entorno y el estado. Un activo retirado o desactivado sigue en la lista con el nombre atenuado. Haga clic en una fila para abrir el activo.

En un clúster, **Depende de** termina con una línea plegada, **A través de los miembros (n)**. Enumera los activos de los que dependen los miembros en servicio del clúster, con esos miembros en la columna **Vía**. Estas filas son de solo lectura y no cuentan en la insignia de la pestaña.

Con `infrastructure:member`, **Añadir**, a la derecha de una sección, abre una búsqueda de activo. Elija un resultado: la relación se guarda al instante. Para quitar una relación, pase el cursor sobre la fila y haga clic en la cruz al final. Un mensaje lo confirma y ofrece **Deshacer**. Los lectores ven las tablas en solo lectura. Una relación **Contiene** desde un miembro de un clúster pregunta primero dónde colocar el activo: consulte [Máquinas virtuales en un clúster](#virtual-machines-on-a-cluster).

---

### Relaciones

La pestaña Relaciones muestra con qué está vinculado el activo: líneas presupuestarias, contratos, proyectos, tareas e incidentes, cada uno en su propia tabla, y después sus enlaces y archivos. Las relaciones entre activos están en la pestaña [Dependencias](#dependencies), y las tecnologías del activo en la pestaña [Operaciones](#operations). La pestaña se abre una vez creado el activo. Haga clic en una fila para abrir el registro. La insignia de la pestaña cuenta los registros vinculados que puede ver, así como los enlaces y archivos.

**Registros vinculados**, una tabla cada uno:

| Sección | Columnas |
|---|---|
| **Líneas presupuestarias** | Referencia (`BL-12`), nombre, tipo (OPEX o CAPEX), proveedor y el importe del año en curso en su columna presupuestaria por defecto, en la moneda de reporte. Un guion significa que la línea no tiene presupuesto para el año |
| **Contratos** | Nombre, proveedor, fin del periodo en curso, importe anual en la moneda del contrato, renovación (tácita o manual) |
| **Proyectos** | Referencia (`PRJ-7`), nombre, estado, fin previsto |
| **Tareas** | Referencia (`T-118`), título, estado, asignado, vencimiento. Las tareas abiertas aparecen primero |
| **Incidentes** | Referencia (`INC-14`), título, severidad, estado, fecha de detección |

Solo ve las secciones de los módulos que puede leer: presupuesto, contratos, proyectos del portafolio, tareas e incidentes. Un Colaborador de negocio solo ve los proyectos y las tareas en los que participa. Un incidente confidencial solo aparece para las personas que pueden verlo en el registro de incidentes, sin su título.

Las fechas en naranja requieren atención: un contrato cuya decisión de renovación cae dentro de su ventana de decisión de contratos, o una tarea abierta con el vencimiento pasado. Una línea presupuestaria o un contrato desactivado sigue en la lista con el nombre atenuado. A partir de dos filas, las líneas presupuestarias y los contratos terminan con una fila de total. El total de las líneas presupuestarias está en la moneda de reporte y excluye una línea cuya moneda no tiene tipo de cambio para el año: un aviso de una línea bajo la tabla la indica. Los contratos tienen un total por moneda, sin los contratos desactivados.

**Añadir y quitar vínculos** (`infrastructure:member`): **Añadir**, a la derecha de una sección, abre una búsqueda. Escriba un nombre o una referencia y elija un resultado: el vínculo se guarda al instante. Vincular también requiere poder leer el módulo de destino, así que **Añadir** no aparece en una sección que no puede leer. Para quitar un vínculo, pase el cursor sobre la fila y haga clic en la cruz al final. Un mensaje lo confirma y ofrece **Deshacer**. Quitar un vínculo no elimina nada más. Los lectores ven las tablas en solo lectura.

- Una tarea que vincula o desvincula aquí también aparece en la actividad de la tarea.
- Vincular o desvincular un incidente requiere también `incidents:contributor` y queda registrado en el diario del incidente. Un incidente cerrado o cancelado no se puede vincular ni desvincular: reábralo primero.

**Enlaces y archivos**: los enlaces web del activo (portales de proveedores, paneles de monitoreo, documentación) y sus archivos (archivos de configuración, diagramas, documentos del proveedor), una fila cada uno con su nombre, el dominio del enlace o el tamaño del archivo, y la fecha en que se añadió. Haga clic en un enlace para abrirlo en una pestaña nueva, o en un archivo para descargarlo. Con `infrastructure:member`:

- **Añadir enlace** abre un diálogo para una URL y un nombre opcional; el enlace se guarda al instante. Una dirección escrita sin `http://` ni `https://` recibe `https://`. Cualquier otro esquema se rechaza. Para cambiar un enlace, pase el cursor sobre su fila y haga clic en el lápiz.
- **Adjuntar archivo** abre el selector de archivos. También puede soltar archivos sobre la sección.
- Para quitar un enlace o un archivo, pase el cursor sobre la fila y haga clic en la cruz. Quitar un enlace muestra un mensaje y ofrece **Deshacer**, que vuelve a crear el enlace. Eliminar un archivo pide una confirmación antes.

---

## Importación/exportación CSV

Mantenga su inventario de activos a escala usando la importación y exportación. Esta funcionalidad soporta operaciones masivas para carga inicial de datos, actualizaciones periódicas desde sistemas externos y extracción de datos para informes.

### Acceder a las funciones CSV

Desde la lista de Activos:
- **Exportar**: Descargar activos a un archivo CSV o un libro de Excel
- **Importar**: Subir un archivo CSV o un libro de Excel para crear o actualizar activos

**Permisos requeridos**: `infrastructure:admin` para operaciones de importación/exportación.

### Opciones de exportación { #export-options }

**Contenido del archivo**: los activos que muestra la lista. La exportación sigue los filtros de las columnas y la búsqueda rápida. El diálogo indica cuántos activos tendrá el archivo. También puede exportar todo el registro. Las filas conservan el orden de la lista.

**Formato**: **CSV** o **Excel (.xlsx)**, elegido en el diálogo y recordado por su navegador. El libro contiene las mismas columnas que el CSV en una hoja, con los números y las fechas como valores que Excel puede ordenar y filtrar. La importación lee los dos; en un libro, lee la primera hoja. Consulte [Archivos CSV y Excel](csv-files.md).

**Columnas**: el archivo empieza por `id` y `reference` (`AST-12`), y después las columnas siguen el espacio de trabajo, pestaña por pestaña. La importación ignora `reference`.

Las columnas de tipo de activo, ciclo de vida, dominio, zona de administración y tipo de dirección IP contienen las etiquetas de la pantalla, en el idioma de la pantalla.

| Opción | Descripción |
|--------|-------------|
| **Exportación completa** | Todos los campos exportables. Usar para informes y extracción completa de datos |
| **Enriquecimiento de datos** | Todos los campos importables. Coincide con el formato de la plantilla de importación, ideal para edición de ida y vuelta (exportar, modificar, reimportar) |
| **Selección personalizada** | Elegir campos específicos para incluir en su exportación |

**Descarga de plantilla** (desde el diálogo de Importación): Descarga un CSV en blanco con todos los encabezados de campos importables. Úselo para preparar archivos de importación con la estructura correcta.

### Flujo de trabajo de importación

1. **Prepare su archivo**: un archivo CSV o un libro de Excel (`.xlsx`). Guarde un archivo CSV en UTF-8. Las comas y los puntos y coma funcionan, y también un archivo que Excel guardó como CSV simple (Windows-1252). Descargue una plantilla para asegurar los encabezados correctos. El separador, los importes, las fechas y los sí o no de cada idioma están en [Archivos CSV y Excel](csv-files.md).

2. **Elija la configuración de importación**:
   - **Modo**:
     - `Enriquecer` (predeterminado): Las celdas vacías preservan los valores existentes: solo actualiza lo que especifique
     - `Reemplazar`: Reemplaza los valores de las columnas del archivo. Una celda vacía borra el valor guardado. Una columna que falta en el archivo conserva sus valores. Algunos campos no se pueden vaciar: la **Verificación previa** los señala.
   - **Operación**:
     - `Upsert` (predeterminado): Crear nuevos activos o actualizar existentes
     - `Solo actualizar`: Solo modificar activos existentes, omitir nuevos
     - `Solo insertar`: Solo crear nuevos activos, omitir existentes

3. **Validar primero**: Haga clic en **Verificación previa** para validar su archivo sin hacer cambios. Revise errores y advertencias.

4. **Aplicar cambios**: Si la validación es correcta, haga clic en **Importar** para confirmar los cambios.

### Lo que la verificación previa rechaza

La verificación previa indica un error en la fila, y no se carga nada, en estos casos:

- un nombre de host que no cumple la regla de la pestaña Red;
- una dirección IP mal formada;
- un tipo de activo, dominio, ciclo de vida, zona de administración o tipo de dirección IP que no coincide con nada en **Panorama IT > Configuración**;
- una fecha que no existe en el calendario, como `31/02/2025`, o una fecha escrita en letras. Las formas de fecha aceptadas están en [Archivos CSV y Excel](csv-files.md);
- una posición de dirección IP rellenada mientras una anterior está vacía, por ejemplo `ip_2_address` sin `ip_1_address`;
- un nombre o un FQDN que ya tiene otro activo.

Para un activo existente, el nombre de host y las direcciones IP solo se vuelven a comprobar si el archivo los cambia.

### Referencia de campos

**Campos principales**:

| Columna CSV | Descripción | Obligatorio | Notas |
|-------------|-------------|-------------|-------|
| `id` | UUID del activo | No | Para actualizaciones; deje en blanco para nuevos activos |
| `name` | Nombre del activo | Sí | Se usa como identificador único para coincidencias |
| `location_reference` | Código de ubicación | Sí | El **Código** de una ubicación existente |
| `kind` | Tipo de activo | Sí | Acepta código o etiqueta (p. ej., `vm` o `Virtual Machine`) |
| `environment` | Entorno | Sí | `prod`, `pre_prod`, `qa`, `test`, `dev`, `sandbox` |
| `status` | Estado del ciclo de vida | No | Acepta código o etiqueta (p. ej., `active` o `Active`) |
| `is_cluster` | Si es un clúster | No | `sí` o `no` |
| `hostname` | Nombre de host de red | No | |
| `domain` | Dominio DNS | No | Acepta código o etiqueta de Configuración |
| `admin_zone` | Zona de administración | No | Acepta código o etiqueta de Configuración |
| `aliases` | Alias DNS | No | Lista separada por comas |
| `operating_system` | Sistema operativo | No | El nombre de la tecnología, seguido de su versión (`Windows Server 2019`). Vea más abajo |
| `cluster` | Pertenencia a clústeres | No | Los nombres de los clústeres de los que el activo es miembro, separados por comas. Consulte más abajo |
| `notes` | Notas de texto libre | No | |

**Campos de dirección IP** (hasta 4 direcciones por activo):

| Columna CSV | Descripción | Notas |
|-------------|-------------|-------|
| `ip_1_type` | Tipo de dirección IP | Acepta código o etiqueta (p. ej., `host` o `Host IP`) |
| `ip_1_address` | Dirección IP | |
| `ip_1_subnet_cidr` | Subred en notación CIDR | |
| `ip_2_type` hasta `ip_4_type` | Tipos de IP adicionales | Mismo patrón para los huecos 2-4 |
| `ip_2_address` hasta `ip_4_address` | Direcciones adicionales | |
| `ip_2_subnet_cidr` hasta `ip_4_subnet_cidr` | Subredes adicionales | |

### Aceptación de etiquetas y códigos

Para campos configurados en **Panorama IT > Configuración**, puede usar tanto el código interno como la etiqueta que muestra la pantalla, en inglés, francés, alemán o español:

| Campo | Ejemplos de códigos | Ejemplos de etiquetas |
|-------|---------------------|----------------------|
| Tipo de activo (`kind`) | `vm`, `physical`, `container` | `Virtual Machine`, `Physical Server`, `Container` |
| Ciclo de vida (`status`) | `active`, `inactive`, `decommissioned` | `Active`, `Inactive`, `Decommissioned` |
| Dominio | `corp`, `dmz` | `Corporate Domain`, `DMZ` |
| Zona de administración (`admin_zone`) | `tier_0`, `tier_1` | `Tier 0 (núcleo de confianza)`, `Tier 1 (servidores y aplicaciones)` |
| Tipo de dirección IP | `host`, `ipmi`, `mgmt` | `Host IP`, `IPMI`, `Management` |

El sistema normaliza automáticamente los valores durante la importación, por lo que `Virtual Machine`, `virtual machine` y `vm` se resuelven al mismo tipo de activo. Un valor que coincide con varias entradas se rechaza en lugar de adivinarse. La exportación escribe nombres en estas columnas, en el idioma de la pantalla, de modo que un archivo exportado se puede volver a importar tal cual.

**Sistema operativo**: la columna `operating_system` contiene el nombre de la tecnología seguido de su versión, tal como lo escribe la exportación (`Windows Server 2019`, `Ubuntu 24.04 LTS`). Al importar, KANAP busca la tecnología entre las suyas y después en el catálogo, y registra la versión. Una tecnología o una versión que no encuentra se crea: revise antes la ortografía. El valor pasa a ser el sistema operativo del servidor.

**Pertenencia a clústeres**: la columna `cluster` nombra los clústeres del activo, separados por comas (`ESX-PROD, SQL-CLUSTER`). No distingue mayúsculas de minúsculas. La exportación escribe los clústeres de los que el activo es miembro. En la importación:

- Con el modo `Enriquecer`, el activo se une a los clústeres nombrados en la celda y sigue en sus otros clústeres.
- Con el modo `Reemplazar`, el activo además abandona los clústeres que su celda no nombra.
- Una celda vacía no cambia nada, en ambos modos.

**Verificación previa** señala un error en la fila cuando un nombre no corresponde a ningún activo, corresponde a varios clústeres o designa un activo que no es un clúster. También rechaza una fila que se nombra a sí misma, una fila que es o pasa a ser un clúster, y un clúster que tiene sistema operativo: la importación nunca quita uno. Las columnas `is_cluster` y `operating_system` siguen las reglas de [Clústeres](#clusteres).

### Coincidencia y actualizaciones

Los activos se emparejan por **nombre** (sin distinguir mayúsculas). Cuando se encuentra una coincidencia:
- Con modo `Enriquecer`: Solo los valores CSV no vacíos actualizan el activo
- Con modo `Reemplazar`: Las columnas del archivo se actualizan, y una celda vacía borra el valor guardado. Las columnas que faltan en el archivo conservan sus valores. El nombre, el `id`, el estado y los campos obligatorios no se pueden vaciar: la **Verificación previa** señala un error en la fila. En las columnas de direcciones IP, solo se aplican las subcolumnas presentes en el archivo. Un activo nuevo recibe los valores predeterminados.

Si incluye la columna `id` con un UUID válido, la coincidencia usa primero el ID, luego el nombre como respaldo.

### Campos derivados

Algunos campos se calculan y no pueden importarse:
- **Proveedor**: Derivado automáticamente de la ubicación del activo, y actualizado cuando cambia la ubicación
- **FQDN**: Calculado a partir del nombre de host + dominio
- **Vulnerabilidades**: `vulnerabilities_to_review` (las vulnerabilidades aún por revisar) y `severe_vulnerabilities` (las críticas o altas), contadas como en la columna de la lista. Solo exportación: la importación las ignora. Vacías para un activo retirado. Ausentes del archivo cuando no se siguen las vulnerabilidades

### Limitaciones

- **Máximo 4 direcciones IP**: Los activos admiten hasta 4 entradas de direcciones IP en un archivo
- **Ubicación obligatoria**: Cada activo debe tener el código de una ubicación existente
- **Relaciones no incluidas**: Las asignaciones de aplicaciones, conexiones, vínculos financieros, proyectos, tareas y adjuntos deben gestionarse en el espacio de trabajo

### Solución de problemas

**Error "El archivo no tiene el formato correcto"**: Esto generalmente indica un problema de codificación. Asegúrese de que su CSV esté guardado como **UTF-8**:

- **En LibreOffice**: Al abrir un CSV, seleccione `UTF-8` en el desplegable de Juego de caracteres (no "Japanese (Macintosh)" u otras codificaciones). Al guardar, marque "Editar configuración de filtro" y elija UTF-8.
- **En Excel**: Guardar como > CSV UTF-8 (delimitado por comas).
- **Consejo general**: Si ve caracteres ilegibles al inicio de su archivo, la codificación es incorrecta.

### Ejemplo CSV

```csv
name;location_reference;kind;environment;status;hostname;domain;ip_1_type;ip_1_address
PROD-WEB-01;NYC-DC1;Virtual Machine;prod;Active;prodweb01;corp;Host IP;10.0.1.10
PROD-DB-01;NYC-DC1;vm;prod;active;proddb01;corp;host;10.0.1.20
```

---

## Consejos

- **Nombre de forma coherente**: Incluya entorno, rol y secuencia en los nombres de los activos para facilitar la identificación.
- **Use clústeres**: Agrupe activos relacionados (p. ej., clúster web, clúster de bases de datos) para simplificar la gestión. Asigne al clúster una aplicación que se ejecuta en cada nodo, y una aplicación de una máquina virtual a esa máquina.
- **Haga seguimiento del ciclo de vida**: Marque los activos obsoletos y retirados para mantener los conteos de inventario precisos.
- **Vincule a ubicaciones**: Asigne activos a ubicaciones para que el tipo de alojamiento, país y ciudad se rellenen automáticamente.
- **Asigne a aplicaciones**: Use la sección **Aplicaciones alojadas** de la pestaña Operaciones para vincular activos a despliegues de aplicaciones. Las mismas asignaciones aparecen en la pestaña Despliegues de la aplicación.
- **Use la pestaña Relaciones**: Conecte activos a líneas presupuestarias, contratos y proyectos para visibilidad financiera.
- **Vincule tareas aquí**: Añada una tarea en Relaciones > Tareas. El vínculo también aparece en la actividad de la tarea.
- **Adjunte documentación**: Suba archivos de configuración, diagramas de arquitectura o documentos del proveedor directamente a la pestaña Relaciones.
