# Cargar un presupuesto desde una hoja de cálculo

La mayoría de los equipos preparan su presupuesto en una hoja de cálculo: una fila por partida, una columna por año o por mes. KANAP conserva las mismas partidas en sus listas OPEX y CAPEX, donde alimentan las asignaciones, los informes y la vista general.

El archivo de presupuesto une ambas partes. Exporte las partidas, cambie las celdas que le interesen en Excel o LibreOffice y vuelva a importar el archivo. KANAP compara cada celda con lo que contiene y solo escribe lo que ha cambiado.

Hay un archivo por lista. La lista OPEX exporta e importa el archivo OPEX, y la lista CAPEX el archivo CAPEX. Ambos archivos llevan las mismas columnas y siguen las mismas reglas.

## Dónde encontrarlo

- Ruta: **Gestión presupuestaria > OPEX**, o **Gestión presupuestaria > CAPEX**
- Exportación: **Exportar CSV** en la barra de herramientas de la lista
- Importación: **Importar CSV** en la misma barra de herramientas
- Permisos: ambos botones requieren derechos de administración en esa lista (`opex:admin` o `capex:admin`)

## Exportación

1. Haga clic en **Exportar CSV** en la lista OPEX o CAPEX.
2. Elija lo que contendrá el archivo:

| Ajuste | Efecto |
|---|---|
| **Partidas** | Las partidas que muestra la lista, con su búsqueda, sus filtros y su ámbito de estado. **Todas las partidas** exporta todas las partidas en su lugar, incluidas las finalizadas, sin los filtros de la lista |
| **Años** | **Primer año** y **Último año**, hasta doce años. Por defecto: el año en curso, el anterior y el siguiente |
| **Columnas** | Las columnas presupuestarias que se escribirán. Las columnas que muestra su organización están marcadas, y una columna oculta aparece marcada como **oculta**. Su encabezado se muestra bajo el nombre, por ejemplo `budget_2027` |
| **Detalle** | **Totales anuales**: una columna por columna presupuestaria y año. **Meses**: una columna por columna presupuestaria, año y mes |

3. Haga clic en el botón inferior de la ventana. Nombra lo que contendrá el archivo: **Exportar 120 partidas filtradas**, **Exportar todas las partidas**, **Exportar 3.412 partidas**, etc.

El archivo se escribe en el idioma en que se muestra la pantalla.

| Idioma | Separador | Importes | Fechas |
|---|---|---|---|
| Inglés | `,` | `12280.50` | `2027-03-01` |
| Francés, español | `;` | `12280,50` | `01/03/2027` |
| Alemán | `;` | `12280,50` | `01.03.2027` |

Exportar una lista sin partidas devuelve solo la fila de encabezados. Esa es su plantilla.

## Las columnas

Un archivo contiene una fila por partida: las columnas de detalle, después las columnas de importes y por último `kanap_token`.

### Columnas de detalle

Son iguales en ambos archivos, salvo las columnas propias del tipo al principio de la fila.

**OPEX**

| Columna | Contenido | En una partida nueva |
|---|---|---|
| `item_number` | El número de la partida: `OPX-12` o `12` | Vacío: la fila añade una partida |
| `name` | Nombre del producto | Obligatorio |
| `description` | La descripción larga | Opcional |
| `company_name` | Empresa pagadora | Obligatorio salvo que la partida tenga un centro de coste |
| `supplier_name` | Nombre del proveedor | Opcional |
| `supplier_erp_id` | El ID del proveedor en su ERP | Opcional |
| `account_number` | Número de cuenta, en el plan de cuentas de la empresa pagadora | Obligatorio |
| `cost_center_code` | Código del centro de coste. Se rechaza un grupo | Opcional |
| `run_build` | `run` o `build` | Opcional |
| `analytics:<code>` | El nombre del valor en la dimensión cuyo código es ese. Una columna por dimensión activada usada para las líneas OPEX, la dimensión por defecto incluida | Opcional. La carga crea un valor que no existe |
| `owner_it_email` | Correo de un usuario activo | Opcional |
| `owner_business_email` | Correo de un usuario activo | Opcional |
| `project` | Número de proyecto, por ejemplo `PRJ-3` | Opcional |
| `currency` | Código ISO de tres letras, entre las monedas permitidas en su espacio de trabajo | Obligatorio |
| `effective_start` | El día en que empieza la partida | El 1 de enero del primer año con un importe en la fila, y si no, del año en curso |
| `end_of_validity` | El día en que termina la partida | Sin fin |
| `notes` | Texto libre | Opcional |

**CAPEX**

| Columna | Contenido | En una partida nueva |
|---|---|---|
| `item_number` | El número de la partida: `CPX-3` o `3` | Vacío: la fila añade una partida |
| `name` | El título de la inversión | Obligatorio |
| `ppe_type` | `hardware` o `software` | Obligatorio |
| `investment_type` | `replacement`, `capacity`, `productivity`, `security`, `conformity`, `business_growth` u `other` | Obligatorio |
| `priority` | `mandatory`, `high`, `medium` o `low` | Obligatorio |
| `company_name` | Empresa pagadora | Obligatorio salvo que la partida tenga un centro de coste |
| `supplier_name` | Nombre del proveedor | Opcional |
| `supplier_erp_id` | El ID del proveedor en su ERP | Opcional |
| `account_number` | Número de cuenta, en el plan de cuentas de la empresa pagadora | Obligatorio |
| `cost_center_code` | Código del centro de coste. Se rechaza un grupo | Opcional |
| `run_build` | `run` o `build` | Opcional |
| `analytics:<code>` | El nombre del valor en la dimensión cuyo código es ese. Una columna por dimensión activada usada para las líneas CAPEX, la dimensión por defecto incluida | Opcional. La carga crea un valor que no existe |
| `owner_it_email` | Correo de un usuario activo | Opcional |
| `owner_business_email` | Correo de un usuario activo | Opcional |
| `project` | Número de proyecto, por ejemplo `PRJ-3` | Opcional |
| `currency` | Código ISO de tres letras, entre las monedas permitidas en su espacio de trabajo | Obligatorio |
| `effective_start` | El día en que empieza la partida | El 1 de enero del primer año con un importe en la fila, y si no, del año en curso |
| `end_of_validity` | El día en que termina la partida | Sin fin |
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

`kanap_token` lo escribe KANAP. Déjelo tal como está. KANAP lo usa para avisarle de que una partida ha cambiado después de su exportación. Déjelo vacío en una fila que añada.

## Qué significa una celda

- Una celda vacía conserva el valor guardado.
- `-` borra un detalle de la partida: descripción, notas, nombre e ID de ERP del proveedor, centro de coste, run o build, un valor de dimensión, un responsable, el proyecto, el fin de validez. En una columna que una partida nueva debe rellenar, `-` es un error de fila.
- `0` escribe cero.
- Un total anual igual al total guardado no escribe nada. Un total distinto se reparte por el periodo de la columna, exactamente como cuando escribe el total en la pestaña **Presupuesto**.
- Una celda de mes escribe ese mes, y marca la columna como editada a mano, igual que un mes escrito en la pestaña **Presupuesto**.
- Un importe tiene como máximo dos decimales. Una celda de importe no se borra con `-`: escriba `0`, o deje la celda vacía.
- Un archivo puede contener el total anual de una columna y un año, o sus doce meses, nunca ambos.

Una columna ausente conserva todos los valores guardados de esa columna. Un archivo que solo contenga `item_number` y unas pocas columnas de importes es un archivo válido.

## Añadir y hacer coincidir partidas

- `item_number` relleno: esa partida se actualiza. Vacío: se crea una partida nueva.
- No hay otra clave. Una fila nueva que se parezca a una partida existente, o a otra fila nueva del mismo archivo, es una advertencia que puede ignorar.
- Los proveedores se hacen coincidir por `supplier_erp_id` cuando está relleno, y si no por `supplier_name`. La carga crea un proveedor que el archivo nombra y que KANAP no tiene cuando **Crear los proveedores que faltan** está marcada. Sin esa opción, la verificación lista los que faltan y le pide crearlos en **Datos maestros > Proveedores**.
- La carga crea un valor de dimensión que no existe y lo lista en la verificación. Las cuentas, los centros de coste, las empresas y los usuarios nunca se crean: un elemento desconocido es un error de fila que indica dónde añadirlo.
- Un archivo con una columna `analytics:<code>` de una dimensión que solo se usa para el otro tipo de línea se rechaza por completo, por ejemplo "The Recurrence dimension is for CAPEX lines only. Remove the analytics:recurrence column from this OPEX file." La exportación no escribe ninguna columna para esa dimensión: un valor oculto en una línea no se exporta, y una carga lo deja en su sitio. El ajuste está en [Dimensiones analíticas](analytics.md#dimensiones-opex-o-capex).
- Una fila que crea una línea presupuestaria, o que cambia su cuenta, se rechaza cuando la cuenta es del otro tipo de línea, con el mensaje «Account 6061 is for CAPEX lines only.» (o OPEX). Una línea presupuestaria conserva su cuenta actual. El ajuste de las cuentas está en [Planes de cuentas y gestión de cuentas](chart-of-accounts.md#cuentas-opex-o-capex).
- Los proyectos se hacen coincidir por su número, por ejemplo `PRJ-3`.
- Una partida finalizada es una partida cuya `end_of_validity` ha pasado. Indique la fecha para finalizar una partida, o escriba `-` en la celda para borrarla y mantener la partida en curso. No hay columna de estado.

## Comprobar y después cargar

1. Haga clic en **Importar CSV** y elija el archivo, o suéltelo en la ventana. El archivo se comprueba de inmediato. No se escribe nada.
2. Lea el informe:

| Sección | Contenido |
|---|---|
| **Errores** | Las filas que la carga rechaza, por fila del archivo con la columna cuando la conoce. Un archivo con un solo error no carga nada |
| **Cambios** | Las partidas que se crearán, las que se actualizarán y las que el archivo deja tal como están |
| **Modificadas en KANAP desde la exportación** | Las partidas que alguien modificó después de su exportación, con quién y cuándo. Cargar el archivo escribe sus valores sobre esos cambios |
| **Advertencias** | Una fila que se parece a otra partida, columnas que el archivo ignora |
| **Creados por la carga** | Los proveedores y los valores de dimensión que la carga añadiría |

3. Haga clic en **Cargar**. La carga escribe todo o nada.

Si una partida cambia entre la comprobación y la carga, la carga se detiene y le pide comprobar el archivo de nuevo. La verificación también indica cómo ha leído el archivo cuando una fecha o un importe podían leerse de dos maneras, con un botón para cambiar la lectura.

## Excel y LibreOffice

Abrir el archivo y guardarlo lo deja cargable. Los dos programas conservan las columnas, el separador y los valores.

Una fecha o un importe que el archivo no puede decidir por sí solo se lee como lo escribió la exportación, y después en el idioma en que se muestra la pantalla. Toda fecha con un día igual o menor que 12 es ambigua (`01/03/2027` es el 1 de marzo en francés y el 3 de enero en inglés), y un importe escrito como `12,280` también lo es. La verificación indica cómo los ha leído y ofrece un botón para cambiar la lectura.

Una columna que KANAP no conoce se ignora, con una advertencia. Una columna que parece una columna de importes mal escrita, como `budjet_2027`, rechaza el archivo entero.

## Archivos de versiones anteriores

Un archivo con un formato anterior se rechaza por completo: los archivos de partidas con columnas del tipo `y_budget`, y el archivo de líneas presupuestarias con las columnas `measure` y `jan` … `dec`. La pantalla muestra este mensaje:

> Este archivo procede de una versión anterior de KANAP. Exporte un archivo nuevo desde esta lista, copie en él sus cambios y vuelva a importarlo.

Exporte un archivo nuevo y copie en él sus filas.

## Cargar un presupuesto completo

El archivo de presupuesto contiene partidas presupuestarias. La empresa pagadora, la cuenta, el centro de coste, el proveedor y los usuarios que nombra una partida deben existir antes. Un equipo pequeño los carga en este orden:

1. Un plan de cuentas y sus cuentas, en [Planes de cuentas](chart-of-accounts.md)
2. Las empresas, en [Empresas](companies.md)
3. El archivo OPEX, con **Crear los proveedores que faltan** marcada
4. El archivo CAPEX, con **Crear los proveedores que faltan** marcada

Una organización más grande añade el resto de los datos maestros entre medias:

1. El plan de cuentas y sus cuentas
2. Las empresas
3. Los usuarios, en [Usuarios](admin.md)
4. Los centros de coste, en [Centros de coste](cost-centers.md)
5. Los proveedores, en [Proveedores](suppliers.md)
6. Los valores de dimensión, en [Dimensiones analíticas](analytics.md). Las dimensiones se crean en esa página
7. Los calendarios laborales, en [Calendarios laborales](working-day-calendars.md), cuando las partidas lleven cantidades y precios
8. El archivo OPEX
9. El archivo CAPEX

**El plan de cuentas va primero.** En la página Planes de cuentas, haga clic en **Nuevo**, dé un código y un nombre al plan y elija **Todos los países** en **Se usa para**. Después haga clic en **Gestionar planes**, abra el menú **⋯** del plan y haga clic en **Hacer predeterminado para otros países**. Una empresa sin plan de cuentas toma ese, y así se resuelven los números de cuenta de un archivo de presupuesto. Seleccione el plan en la página y haga clic en **Importar CSV** para cargar sus cuentas.

Cada una de estas páginas tiene su propia sección **Importar CSV** con las columnas de su archivo.
