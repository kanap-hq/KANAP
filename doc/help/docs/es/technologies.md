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
| **Vulnerabilidades por revisar** | Las vulnerabilidades conocidas que quedan por revisar en las versiones en uso. En naranja con el número de críticas o altas (`3 · 1 críticas o altas`). Haga clic para abrir la página [Vulnerabilidades](vulnerabilities.md) sobre esta tecnología. Presente cuando se siguen las vulnerabilidades |

**Columnas adicionales** (con el selector de columnas): **Ciclo de vida**, **Versiones en uso**, **Responsable de TI**.

Cuando se siguen las vulnerabilidades, la columna **Editor** también abre la página Vulnerabilidades sobre los productos de ese editor. Consulte [Vulnerabilidades](vulnerabilities.md) para saber cuándo se siguen.

**Filtros**: **Familia**, **Editor** y **Ciclo de vida** ofrecen filtros con casillas. El cuadro de búsqueda busca en el nombre, el editor y la referencia.

**Acciones**:

- **Nueva tecnología** (`infrastructure:member`).
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
- **Zona de administración**: solo se muestra para las tecnologías de la familia **Directorio e identidad**. Sitúa un servicio de directorio en una zona de su modelo de administración, por ejemplo el tier 0 para Entra ID, que no se ejecuta en ninguno de sus servidores. Las zonas vienen de **Panorama IT > Configuración**, y la [Vista de la administración](administration-view.md) lista los servicios de directorio de cada zona. Las demás tecnologías no llevan zona: sitúe en su lugar los servidores que las llevan. Una zona indicada antes en una tecnología de otra familia se sigue mostrando, en solo lectura, con una nota que indica que el valor ya no se utiliza.
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

#### Versiones del catálogo

Una versión que procede del catálogo muestra **Catálogo** junto a su etiqueta, y una tecnología adoptada desde el catálogo indica «Versiones y fechas mantenidas al día desde el catálogo» bajo sus versiones. KANAP consulta el catálogo cada día en la nube. En una instalación local, cada versión de KANAP trae su catálogo al arrancar, salvo que su administrador [active la comprobación diaria](on-premise/configuration.md#optional-technology-catalog).

La comprobación añade las nuevas versiones e identificadores de producto CPE del producto, y actualiza las fechas de fin de soporte y los identificadores que el catálogo cambió. Nunca sobrescribe un valor que usted cambió, y nunca vuelve a crear una versión o un identificador que usted eliminó. Una versión que registró antes de que el catálogo la conociera se vincula a él cuando las etiquetas coinciden, y se rellenan sus fechas vacías.

**Identificadores de producto CPE**: los nombres que las bases de datos de seguridad dan a este producto, con la forma `part:vendor:product` (por ejemplo `a:microsoft:sql_server`). KANAP los coteja con las vulnerabilidades publicadas: una tecnología sin ninguno no recibe ninguna vulnerabilidad. Un producto puede tener varios (vSphere abarca vCenter y ESXi). Dónde encontrar este valor: busque el producto en el [Diccionario CPE del NIST](https://nvd.nist.gov/products/cpe/search) y conserve su parte, su proveedor y su producto. Cópielos como los escribe la NVD, con la barra invertida delante de un signo: `a:veeam:veeam_backup_\&_replication`. Las entradas del catálogo llegan con sus identificadores.

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

### Relaciones

Los registros vinculados a la tecnología, una sección por tipo:

- **Líneas presupuestarias**: con el importe del año en curso en la columna presupuestaria de su espacio de trabajo, y un total.
- **Contratos**: proveedor, fecha de fin e importe anual, con un total por moneda.
- **Proyectos**: estado y fin previsto.
- **Incidentes**: gravedad, estado y fecha de detección. Vincular un incidente requiere `incidents:contributor`. Un incidente cerrado o cancelado no se puede vincular ni desvincular.
- **Documentos**: los archivos subidos a la tecnología, con su tamaño y su fecha. **Añadir** sube archivos; haga clic en un nombre para descargarlo.
- **Enlaces web**: un nombre y una dirección, como las notas de la versión del editor. Haga clic en el nombre para abrirlo; pase el ratón por una fila para editarla. Las direcciones empiezan por `http://` o `https://`; una dirección sin prefijo se abre como `https://`.
- **Vulnerabilidades**: cuando se siguen las vulnerabilidades, las vulnerabilidades conocidas de las versiones en uso. Consulte [Vulnerabilidades](#vulnerabilidades).

Una sección solo aparece si puede leer su módulo. **Añadir** (`infrastructure:member`) abre una búsqueda en el sitio; la cruz al final de una fila quita el vínculo.

#### Vulnerabilidades

Una fila por versión y vulnerabilidad, la más grave primero, con su **CVE**, su **Gravedad**, su **Versión** y su **Estado**. El número junto al título es el número de vulnerabilidades distintas. Haga clic en una fila para abrirla en la página [Vulnerabilidades](vulnerabilities.md), donde la revisa.

KANAP vuelve a cotejar la tecnología en cuanto cambian sus identificadores, versiones, servidores o aplicaciones. Tras un nuevo identificador de producto CPE, la sección indica «Búsqueda de vulnerabilidades en curso…» mientras KANAP lee ese producto en la NVD. **Volver a cotejar** (`infrastructure:member`) lanza la comparación a mano.

---

## Vincular una tecnología a un servidor

Puede registrar que un servidor lleva una tecnología desde cualquiera de los dos lados:

- Desde la tecnología: pestaña **Servidores**, **Añadir**, y elija el servidor y la versión.
- Desde el servidor: pestaña **Técnico** del activo, sección **Tecnologías**, **Añadir**, y elija la tecnología y la versión. Consulte [Activos](assets.md#tecnico).

Registre la tecnología en el servidor donde está instalada: el host para un hipervisor, cada controlador de dominio para Active Directory, el servidor de base de datos para SQL Server. Los servidores que se ejecutan dentro de él, o los miembros de su clúster, la muestran entonces sin más trabajo. Una tecnología en la nube, como Entra ID, no se ejecuta en ninguno de sus servidores: declárela en las aplicaciones.

---

## Dónde aparecen las tecnologías

- **Aplicaciones**: la sección **Tecnologías** de la pestaña Relaciones lista aquello de lo que depende una aplicación. Consulte [Aplicaciones](applications.md#relaciones).
- **Activos**: la sección **Tecnologías** de la pestaña Técnico de un activo lista lo que lleva el servidor; la sección **Si este servidor cae** de su pestaña Relaciones lista las tecnologías que se detienen con él. Consulte [Activos](assets.md#tecnico).
- **Contratos**, **líneas presupuestarias** e **incidentes**: un campo **Tecnologías** en su pestaña Relaciones, para los usuarios que pueden leer la infraestructura.
- Informe **Fin de soporte**: las versiones que llegan a su fin de soporte y lo que afectan. Consulte [Fin de soporte](end-of-support.md).
- **Vulnerabilidades**: las vulnerabilidades conocidas de las versiones en uso, y los servidores y aplicaciones a los que llegan. Consulte [Vulnerabilidades](vulnerabilities.md).
- **Vista de la administración**: los servicios de directorio de cada zona de administración, y los servidores que llevan una tecnología de directorio fuera de la zona más sensible. Consulte [Vista de la administración](administration-view.md).
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
