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

- **Entra ID**: una tecnología suscrita de la familia **Directorio e identidad**, editada por Microsoft. No se ejecuta en ninguno de sus servidores. Las aplicaciones cuyos usuarios inician sesión con ella la declaran.
- **Active Directory**: una tecnología instalada de la misma familia, llevada por sus controladores de dominio. Las aplicaciones que la usan la declaran.
- **vSphere**: una tecnología instalada, llevada por la máquina virtual de vCenter y por los hosts.
- **SQL Server**: una tecnología con una línea por versión en uso (2016, 2019, 2022). Cada servidor lleva su propia versión, de modo que el informe de fin de soporte puede nombrar los servidores que siguen en una antigua.
- **Una aplicación SaaS**: ninguna tecnología que registrar. El proveedor mantiene aquello sobre lo que funciona.

Una tecnología abarca un producto en su conjunto. "SQL Server" representa todos los SQL Server que usted ejecuta; las versiones llevan el detalle.

## Primeros pasos

Navegue a **Panorama IT > Tecnologías** y haga clic en **Nueva tecnología**.

La ventana se abre en el **Catálogo**: una lista de productos habituales con su editor, su familia y sus versiones. Busque por nombre y haga clic en una entrada. KANAP crea al instante la tecnología con su editor, su familia, su modo, sus identificadores de producto CPE y sus versiones con sus fechas de fin de soporte, y la abre. El catálogo solo ofrece los productos que aún no ha añadido.

Para un producto que el catálogo no conoce, haga clic en **Introducir una tecnología que no está en el catálogo**. Complete:

- **Nombre** (obligatorio): único entre sus tecnologías.
- **Familia**: el tipo de tecnología (base de datos, hipervisor, directorio e identidad, etc.).
- **Editor**: las sugerencias vienen de sus otras tecnologías y del catálogo, para que un mismo editor conserve una sola grafía.
- **Modo**: **Instalada** cuando se ejecuta en sus servidores, **Suscrita** para un servicio comprado a un proveedor.

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

**Columnas adicionales** (con el selector de columnas): **Ciclo de vida**, **Versiones en uso**, **Responsable de TI**.

**Filtros**: **Familia**, **Editor** y **Ciclo de vida** ofrecen filtros con casillas. El cuadro de búsqueda busca en el nombre, el editor y la referencia.

**Acciones**:

- **Nueva tecnología** (`infrastructure:member`).
- **Eliminar** las filas seleccionadas (`infrastructure:admin`). La confirmación cuenta lo que se va con ellas: vínculos con servidores y aplicaciones, contratos, líneas presupuestarias, proyectos, incidentes y documentos.

---

## El espacio de trabajo de la tecnología

El espacio de trabajo tiene una cabecera, un panel de propiedades a la derecha y la pestaña **Resumen**.

### Cabecera

- **Nombre**: editable en el sitio.
- **Referencia**: haga clic para copiarla.
- **Ciclo de vida**: haga clic para cambiarlo. Una tecnología retirada ya no se ofrece cuando busca una para vincular.
- **Familia**.
- **Eliminar** (`infrastructure:admin`): la confirmación nombra lo que se va con la tecnología.

### Panel de propiedades

- **Editor**, **Familia** y **Modo**.
- **Reemplazada por**: la tecnología que toma el relevo de esta, por ejemplo un producto más reciente al que migran sus equipos.
- **Responsables de TI**: las personas responsables de la tecnología.

Los cambios se guardan a medida que los hace.

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

**Identificadores de producto CPE**: los nombres que las bases de datos de seguridad dan a este producto, con la forma `part:vendor:product` (por ejemplo `a:microsoft:sql_server`). Un producto puede tener varios (vSphere abarca vCenter y ESXi). Dónde encontrar este valor: busque el producto en el [Diccionario CPE del NIST](https://nvd.nist.gov/products/cpe/search) y conserve su parte, su proveedor y su producto. Las entradas del catálogo llegan con sus identificadores.

**Notas**: texto libre, como las condiciones de licencia o las fechas de renovación.

---

## Dónde aparecen las tecnologías

- **Aplicaciones**: la sección **Tecnologías** de la pestaña Relaciones lista aquello de lo que depende una aplicación. Consulte [Aplicaciones](applications.md#relaciones).
- **Activos**: la sección **Si este servidor cae** de la pestaña Relaciones de un activo lista las tecnologías que se detienen con él. Consulte [Activos](assets.md#relaciones).
- **Contratos**, **líneas presupuestarias** e **incidentes**: un campo **Tecnologías** en su pestaña Relaciones, para los usuarios que pueden leer la infraestructura.
- Informe **Fin de soporte**: las versiones que llegan a su fin de soporte y lo que afectan. Consulte [Fin de soporte](end-of-support.md).
- **Búsqueda**: la búsqueda global y las menciones `@` del asistente encuentran las tecnologías por nombre y por referencia (`@TEC-4`).

## Convertir una aplicación

Una ficha creada como aplicación puede ser en realidad una tecnología, por ejemplo un motor de base de datos o un directorio. Abra la aplicación y use **Convertir en tecnología**. Consulte [Aplicaciones](applications.md#convertir-una-aplicacion-en-tecnologia).

## Consejos

- **Parta del catálogo**: obtiene las versiones y sus fechas de fin de soporte sin escribirlas.
- **Siga las versiones principales**: una línea por versión principal (2019, 2022) basta para seguir el soporte.
- **Nombre a los responsables**: los responsables de TI son las personas a quienes llamar cuando una versión llega a su fin de soporte.
