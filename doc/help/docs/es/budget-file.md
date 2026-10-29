# Cargar un presupuesto desde una hoja de cálculo

La mayoría de los equipos preparan su presupuesto en una hoja de cálculo: una fila por línea, una columna por año o por mes. KANAP conserva las mismas líneas en su lista de líneas presupuestarias, donde alimentan las asignaciones, los informes y la vista general.

El archivo de presupuesto une ambas partes. Exporte las líneas, cambie las celdas que le interesen en Excel o LibreOffice y vuelva a importar el archivo. KANAP compara cada celda con lo que contiene y solo escribe lo que ha cambiado.

Un solo archivo contiene los dos tipos de línea. Su columna `nature` indica si una fila es una línea OPEX o CAPEX, y cada fila se comprueba con las reglas de su propio tipo. La lista exporta las líneas que muestra, OPEX y CAPEX juntas. Filtre la columna **Tipo** para exportar un solo tipo.

## Dónde encontrarlo

- Ruta: **Gestión presupuestaria > Líneas presupuestarias**
- Exportación: **Exportar** en la barra de herramientas de la lista
- Importación: **Importar** en la misma barra de herramientas
- Permisos: ambos botones requieren el nivel Administrador en Presupuesto (`budget:admin`), que cubre por igual las líneas OPEX y CAPEX

## Exportación

1. Haga clic en **Exportar** en la lista.
2. Elija lo que contendrá el archivo:

| Ajuste | Efecto |
|---|---|
| **Líneas** | Las líneas que muestra la lista, con su búsqueda, sus filtros y su ámbito de estado. **Todas las líneas** exporta todas las líneas en su lugar, incluidas las finalizadas, sin los filtros de la lista |
| **Años** | **Primer año** y **Último año**, hasta doce años. Por defecto: el año en curso, el anterior y el siguiente. Marque **Año en curso** para exportar solo el año en curso |
| **Columnas** | Las columnas presupuestarias que se escribirán. Las columnas que muestra su organización están marcadas, y una columna oculta aparece marcada como **oculta**. Su encabezado se muestra bajo el nombre, por ejemplo `budget_2027` |
| **Detalle** | **Totales anuales**: una columna por columna presupuestaria y año. **Meses**: una columna por columna presupuestaria, año y mes |
| **Formato** | **CSV** o **Excel (.xlsx)**. Su navegador recuerda la elección para la próxima exportación |

3. Haga clic en el botón inferior de la ventana. Nombra lo que contendrá el archivo: **Exportar 120 líneas filtradas**, **Exportar todas las líneas**, **Exportar 3.412 líneas**, etc.

El archivo se guarda como `budget.csv` o `budget.xlsx`. Un archivo CSV se escribe en el idioma en que se muestra la pantalla:

| Idioma | Separador | Importes | Fechas |
|---|---|---|---|
| Inglés | `,` | `12280.50` | `2027-03-01` |
| Francés, español | `;` | `12280,50` | `01/03/2027` |
| Alemán | `;` | `12280,50` | `01.03.2027` |

El archivo Excel tiene las mismas columnas en una hoja llamada `budget`. Los importes son números exactos al céntimo, y las fechas son fechas, mostradas en el orden de día y mes de su idioma. La fila de encabezados queda fija al desplazarse, con un filtro en cada columna.

Exportar una lista sin líneas devuelve solo la fila de encabezados. Esa es su plantilla.

Cada exportación queda anotada en el [registro de auditoría](admin.md#registro-de-auditoria), con sus ajustes, su formato y su número de líneas.

## Las columnas

Un archivo contiene una fila por línea: las columnas de detalle, después las columnas de importes y por último `kanap_token`.

### Columnas de detalle

Las columnas de detalle son las mismas para los dos tipos de línea.

| Columna | Contenido | En una línea nueva |
|---|---|---|
| `nature` | `opex` o `capex`, el tipo de línea | Obligatorio. Un archivo sin esta columna se lee como líneas OPEX, o como líneas CAPEX cuando el filtro **Tipo** de la lista conserva solo CAPEX |
| `item_number` | La referencia de la línea: `BL-12`, o `12`. También se leen los números `OPX-12` y `CPX-3` de archivos anteriores | Vacío: la fila añade una línea |
| `name` | El título de la línea, que aparece en la columna **Nombre del producto** de la lista | Obligatorio |
| `description` | La descripción larga | Opcional |
| `company_name` | Empresa pagadora. Vacía en una línea nueva: la empresa del centro de coste. Se acepta una empresa distinta de la del centro de coste, con una advertencia | Obligatorio salvo que la línea tenga un centro de coste |
| `supplier_name` | Nombre del proveedor | Opcional |
| `supplier_erp_id` | El ID del proveedor en su ERP | Opcional |
| `account_number` | Número de cuenta, en el plan de cuentas de la empresa pagadora | Obligatorio |
| `cost_center_code` | Código del centro de coste. Se rechaza un grupo | Opcional |
| `cost_center_path` | El lugar del centro de coste en el árbol, desde su grupo raíz hasta el centro, con los nombres separados por ` / `, por ejemplo `TI / Infraestructuras / Red`. Vacío para un centro en la raíz del árbol o una línea sin centro. Úselo para filtrar o agrupar las líneas por dirección en su hoja de cálculo | Solo exportación, se ignora al importar |
| `run_build` | `run` o `build` | Opcional |
| `analytics:<code>` | El nombre del valor en la dimensión cuyo código es ese, sin distinguir mayúsculas y minúsculas. Una columna por dimensión activada, la dimensión por defecto incluida. Una dimensión usada para un solo tipo de línea solo toma un valor en las filas de ese tipo y queda vacía en las demás. En un espacio de trabajo nuevo, las dimensiones recomendadas están en `analytics:default` (el tipo de coste), `analytics:it_tower`, `analytics:purpose` y `analytics:priority`, por ejemplo `Software`, `Aplicación`, `Sustitución` o `Alta` | Opcional, salvo para una dimensión obligatoria del tipo de la línea, como el tipo de activo fijo de una línea CAPEX en un espacio de trabajo creado antes de las dimensiones recomendadas. La carga crea un valor que no existe |
| `owner_it_email` | Correo de un usuario activo | Opcional |
| `owner_business_email` | Correo de un usuario activo | Opcional |
| `project` | Número de proyecto, por ejemplo `PRJ-3` | Opcional |
| `currency` | Código ISO de tres letras, entre las monedas permitidas en su espacio de trabajo | Obligatorio |
| `effective_start` | El día en que empieza la línea | El 1 de enero del primer año con un importe en la fila, y si no, del año en curso |
| `end_of_validity` | El día en que termina la línea | Sin fin |
| `notes` | Texto libre | Opcional |

### Columnas de importes

Una columna de importe lleva el nombre de la columna presupuestaria y el año: `budget_2027`. Con el detalle **Meses** se añade el mes: `budget_2027_03`.

| Nombre en el archivo | La columna en la aplicación |
|---|---|
| `budget` | La primera columna, llamada Presupuesto por defecto |
| `revision` | La segunda columna, llamada Revisión por defecto |
| `forecast` | La tercera columna, llamada Previsión por defecto |
| `actual` | La cuarta columna, llamada Realizado por defecto |
| `landing` | La quinta columna, llamada Aterrizaje previsto por defecto |

Estos son los nombres estándar. Su organización puede renombrar las cinco columnas en [Columnas presupuestarias](budget-operations.md#columnas-presupuestarias), ocultar algunas y elegir una columna por defecto. El archivo escribe siempre el nombre técnico indicado arriba, se llamen como se llamen sus columnas en pantalla.

### La última columna

`kanap_token` lo escribe KANAP. Déjelo tal como está. KANAP lo usa para avisarle de que una línea ha cambiado después de su exportación. Déjelo vacío en una fila que añada.

## Qué significa una celda

- Una celda vacía conserva el valor guardado. Una celda `nature` vacía conserva el tipo de una línea existente.
- `-` borra un detalle de la línea: descripción, notas, nombre e ID de ERP del proveedor, centro de coste, run o build, un valor de dimensión, un responsable, el proyecto, el fin de validez. En una columna que una línea nueva debe rellenar, y en `nature`, `-` es un error de fila. En una dimensión obligatoria, `-` es un error de fila cuando la línea tiene un valor.
- `0` escribe cero.
- Un total anual igual al total guardado no escribe nada. Un total distinto se reparte por el periodo de la columna, exactamente como cuando escribe el total en la pestaña **Presupuesto**.
- Una celda de mes escribe ese mes, y marca la columna como editada a mano, igual que un mes escrito en la pestaña **Presupuesto**.
- Un importe tiene como máximo dos decimales. Una celda de importe no se borra con `-`: escriba `0`, o deje la celda vacía.
- Un archivo puede contener el total anual de una columna y un año, o sus doce meses, nunca ambos.

Una columna ausente conserva todos los valores guardados de esa columna. Un archivo que solo contenga `item_number` y unas pocas columnas de importes es un archivo válido.

## Añadir y hacer coincidir líneas

- `item_number` relleno: esa línea se actualiza. Vacío: se crea una línea nueva, del tipo que indica su celda `nature`.
- `item_number` contiene la referencia de la línea, `BL-12`. En un archivo con columna `nature`, un número solo es la misma referencia. Los números `OPX-12` y `CPX-3` de archivos anteriores siguen designando su línea. Nombrar dos veces la misma línea en un archivo es un error de fila.
- Una línea conserva su tipo. Una fila que nombra una línea existente con la otra `nature` se rechaza, por ejemplo "BL-125 is a CAPEX line, not an OPEX line. A file does not change the type of a line."
- Cada fila se comprueba según su propio tipo: las dimensiones y los valores que puede tener, su cuenta, las columnas congeladas y la advertencia de duplicado. Una columna congelada para CAPEX rechaza un cambio solo en una línea CAPEX.
- No hay otra clave. Una fila nueva que se parezca a una línea existente de su tipo, o a otra fila nueva del mismo tipo en el archivo, es una advertencia que puede ignorar.
- Los proveedores se hacen coincidir por `supplier_erp_id` cuando está relleno, y si no por `supplier_name`. La carga crea un proveedor que el archivo nombra y que KANAP no tiene cuando **Crear los proveedores que faltan** está marcada. Sin esa opción, la verificación lista los que faltan y le pide crearlos en **Datos maestros > Proveedores**.
- La carga crea un valor de dimensión que no existe y lo lista en la verificación. Las cuentas, los centros de coste, las empresas y los usuarios nunca se crean: un elemento desconocido es un error de fila que indica dónde añadirlo. Para una persona con el acceso a los datos limitado, solo en una dimensión con valores abiertos: vea [Acceso a los datos limitado](#limited-data-access).
- Un valor, o `-`, en una dimensión que solo se usa para el otro tipo de línea es un error de fila en su celda `analytics:<code>`, por ejemplo "The Recurrence dimension is for CAPEX lines only. Leave it out." La exportación deja esa celda vacía: un valor oculto en una línea no se exporta, y una carga lo deja en su sitio. El ajuste está en [Dimensiones analíticas](analytics.md#dimensiones-opex-o-capex).
- Un valor que se usa solo para el otro tipo de línea es un error de fila en su celda `analytics:<code>`, por ejemplo "Personal interno is for OPEX lines only. Pick a value for CAPEX lines." Una línea conserva el valor que ya tiene. Los valores que crea la carga se usan para OPEX y CAPEX. El ajuste está en [Dimensiones analíticas](analytics.md#valores-opex-o-capex).
- Una línea nueva necesita un valor en cada dimensión obligatoria de su propio tipo, con el mensaje "The Tipo de coste dimension is required. Choose a value." en la celda `analytics:<code>`. Esto vale cuando la columna falta en el archivo, cuando la celda está vacía y cuando contiene `-`. Un valor que crea la carga cuenta. Una línea existente solo se rechaza por un `-` que borraría el valor que tiene: una celda vacía o una columna ausente la deja como está. El ajuste está en [Dimensiones analíticas](analytics.md#dimensiones-obligatorias).
- Una fila que crea una línea presupuestaria, o que cambia su cuenta, se rechaza cuando la cuenta es del otro tipo de línea, con el mensaje «Account 6061 is for CAPEX lines only.» (o OPEX). Una línea presupuestaria conserva su cuenta actual. El ajuste de las cuentas está en [Planes de cuentas y gestión de cuentas](chart-of-accounts.md#cuentas-opex-o-capex).
- Los proyectos se hacen coincidir por su número, por ejemplo `PRJ-3`.
- Una línea finalizada es una línea cuya `end_of_validity` ha pasado. Indique la fecha para finalizar una línea, o escriba `-` en la celda para borrarla y mantener la línea en curso. No hay columna de estado.

## Comprobar y después cargar

1. Haga clic en **Importar** y elija el archivo, un archivo CSV o un libro de Excel (`.xlsx`), o suéltelo en la ventana. El archivo se comprueba de inmediato. No se escribe nada.
2. Lea el informe:

| Sección | Contenido |
|---|---|
| **Errores** | Las filas que la carga rechaza, por fila del archivo con la columna cuando la conoce. Un archivo con un solo error no carga nada |
| **Cambios** | Las líneas que se crearán, las que se actualizarán y las que el archivo deja tal como están |
| **Modificadas en KANAP desde la exportación** | Las líneas que alguien modificó después de su exportación, con quién y cuándo. Cargar el archivo escribe sus valores sobre esos cambios |
| **Advertencias** | Una fila que se parece a otra línea, un `company_name` distinto de la empresa del centro de coste de la fila, un importe que hace que una columna deje de seguir sus líneas de cálculo, columnas y celdas que el archivo ignora |
| **Creados por la carga** | Los proveedores y los valores de dimensión que la carga añadiría |

3. Haga clic en **Cargar**. La carga escribe todo o nada.

Si una línea cambia entre la comprobación y la carga, la carga se detiene y le pide comprobar el archivo de nuevo. La verificación también indica cómo ha leído el archivo cuando una fecha o un importe podían leerse de dos maneras, con un botón para cambiar la lectura.

### Columnas calculadas por cantidad y precio

Una línea puede calcular una columna a partir de líneas de cálculo, cantidad × precio: consulte [Cantidad y precio](budget-lines.md#cantidad-y-precio). El archivo de presupuesto solo contiene los totales y los meses de una columna. Las líneas de cálculo se editan en la pestaña **Presupuesto** de la línea.

Cuando el archivo cambia el total anual o un mes de una columna así, la comprobación muestra una advertencia por cada línea, columna y año, por ejemplo:

> BL-83 · Revisión 2026: 3 líneas de cálculo (281.280,00) ya no determinarán estos importes.

La carga está permitida. Después, las líneas de cálculo se quedan en la línea como referencia, con su total, y la columna sigue los importes del archivo. Un total anual igual al que dan las líneas no escribe nada: la columna sigue determinada por sus líneas.

## Acceso a los datos limitado { #limited-data-access }

Una persona limitada a una parte del presupuesto usa el archivo dentro de su acceso, cuando su rol lo permite. Vea [Acceso a los datos](data-access.md).

- La exportación contiene las líneas que ve.
- Una fila que nombra una línea que no ve se trata como una línea que no existe. En un archivo procedente de una exportación, el mensaje es «BL-12 ya no está disponible desde la exportación.», el mismo que para una línea eliminada desde entonces.
- Una línea que ve en Lectura se acepta cuando su fila no cambia. Un cambio se rechaza con «BL-12 es de solo lectura en su acceso.»
- Una línea nueva, o una nueva empresa o un nuevo centro de coste en una línea, debe corresponder a uno de sus nodos en Edición. Si no, la fila se rechaza con «Esta empresa o este centro de coste no forma parte de su acceso.»
- Un valor desconocido solo se crea en una dimensión con valores abiertos. En las demás dimensiones, es un error de fila.

Estas filas aparecen entre los **Errores** de la comprobación, como cualquier otra fila rechazada.

## Excel y LibreOffice

Abrir el archivo y guardarlo lo deja cargable, en CSV o en `.xlsx`. Los dos programas conservan las columnas, el separador y los valores.

En un libro, KANAP lee la primera hoja. Cuando el libro tiene otras hojas, la verificación indica qué hoja leyó. Un importe o una fecha introducidos como valor en una celda se leen tal cual, sin dudas sobre la marca decimal ni el orden de día y mes. Un archivo antiguo de Excel (`.xls`) se rechaza: guárdelo como `.xlsx` o CSV.

Una fecha o un importe escrito como texto, que el archivo no puede decidir por sí solo, se lee como lo escribió la exportación, y después en el idioma en que se muestra la pantalla. Toda fecha con un día igual o menor que 12 es ambigua (`01/03/2027` es el 1 de marzo en francés y el 3 de enero en inglés), y un importe escrito como `12,280` también lo es. La verificación indica cómo los ha leído y ofrece un botón para cambiar la lectura.

Una columna que KANAP no conoce se ignora, con una advertencia. Una columna que parece una columna de importes mal escrita, como `budjet_2027`, rechaza el archivo entero. Una columna `analytics:<code>` que no nombra ninguna dimensión activada también rechaza el archivo entero, con "Unknown dimension 'x'."

## Archivos de versiones anteriores

Un archivo con un formato anterior se rechaza por completo: los archivos de líneas con columnas del tipo `y_budget`, y el archivo de líneas presupuestarias con las columnas `measure` y `jan` … `dec`. La pantalla muestra este mensaje:

> Este archivo procede de una versión anterior de KANAP. Exporte un archivo nuevo desde esta lista, copie en él sus cambios y vuelva a importarlo.

Un archivo CAPEX exportado antes de que el tipo de activo fijo, el tipo de inversión y la prioridad pasaran a ser dimensiones, reconocible por sus tres columnas `ppe_type`, `investment_type` y `priority` juntas, también se rechaza por completo. Estos valores van ahora en columnas de dimensión. Una o dos de estas columnas solas son columnas desconocidas, que se ignoran con una advertencia. La pantalla muestra este mensaje:

> The ppe_type, investment_type and priority columns are now dimension columns (analytics:ppe_type, analytics:investment_type, analytics:priority). Export a fresh file from this list, copy your changes into it, and import it again.

Exporte un archivo nuevo y copie en él sus filas.

Se acepta un archivo OPEX o CAPEX exportado antes de que existiera la columna `nature`. Sus filas se leen como líneas OPEX, o como líneas CAPEX cuando el filtro **Tipo** de la lista conserva solo CAPEX, y sus números `OPX-12` y `CPX-3` siguen designando sus líneas: importe un archivo OPEX anterior con la lista en OPEX o en ambos tipos, y un archivo CAPEX anterior con la lista filtrada por CAPEX. Sus celdas `kanap_token` siguen siendo válidas. En un archivo así, un número solo conserva su significado anterior: con el filtro en CAPEX, `3` es `CPX-3`; si no, es el número de la línea OPEX.

KANAP reconoce la columna `nature` por su nombre, sin distinguir mayúsculas y minúsculas. Si un archivo anterior tiene una columna propia llamada Nature, cámbiele el nombre antes de importarlo: KANAP leería esa columna como el tipo de cada línea y rechazaría sus valores.

## Cargar un presupuesto completo

El archivo de presupuesto contiene líneas presupuestarias. La empresa pagadora, la cuenta, el centro de coste, el proveedor y los usuarios que nombra una línea deben existir antes. Un equipo pequeño los carga en este orden:

1. Un plan de cuentas y sus cuentas, en [Planes de cuentas](chart-of-accounts.md)
2. Las empresas, en [Empresas](companies.md)
3. El archivo de presupuesto, con **Crear los proveedores que faltan** marcada. Contiene las líneas OPEX y CAPEX juntas, o carga un archivo por tipo

Una organización más grande añade el resto de los datos maestros entre medias:

1. El plan de cuentas y sus cuentas
2. Las empresas
3. Los usuarios, en [Usuarios](admin.md)
4. Los centros de coste, en [Centros de coste](cost-centers.md)
5. Los proveedores, en [Proveedores](suppliers.md)
6. Los valores de dimensión, en [Dimensiones analíticas](analytics.md). Las dimensiones se crean en esa página
7. Los calendarios laborales, en [Calendarios laborales](working-day-calendars.md), cuando las líneas lleven cantidades y precios
8. El archivo de presupuesto, líneas OPEX y CAPEX

**El plan de cuentas va primero.** En la página Planes de cuentas, haga clic en **Nuevo**, dé un código y un nombre al plan y elija **Todos los países** en **Se usa para**. Después haga clic en **Gestionar planes**, abra el menú **⋯** del plan y haga clic en **Hacer predeterminado para otros países**. Una empresa sin plan de cuentas toma ese, y así se resuelven los números de cuenta de un archivo de presupuesto. Seleccione el plan en la página y haga clic en **Importar** para cargar sus cuentas.

Cada una de estas páginas tiene su propia sección de importación con las columnas de su archivo. Todas leen un archivo CSV o un libro de Excel. Consulte [Archivos CSV y Excel](csv-files.md).
