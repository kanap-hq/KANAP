# Informes

La sección de Informes ofrece informes interactivos predefinidos para analizar datos presupuestarios, asignaciones de costes y tendencias de gasto. Cada informe combina una tabla resumen con un gráfico, y todos exportan su tabla en CSV o Excel y su gráfico como imagen.

## Dónde encontrarlos

Navegue a **Informes** desde el menú principal para abrir el centro de informes.

- Ruta: **Informes**
- Permisos: `reporting:reader` (mínimo)

Para una persona con el [acceso a los datos](data-access.md) limitado, cada informe cuenta las líneas que ve, sin total del grupo.

---

## Centro de informes

La página principal muestra una tarjeta para cada informe disponible con una breve descripción. Haga clic en cualquier tarjeta para abrir el informe.

| Informe | Qué cubre |
|---------|-----------|
| **Contracargo global** | Totales de asignación por empresa, KPI y flujos intercompañía |
| **Contracargo por empresa** | Detalle de una empresa con departamentos, líneas y KPI |
| **Top líneas** | Mayores líneas presupuestarias para un año seleccionado (top N personalizable) |
| **Top aumento / disminución** | Mayores cambios entre dos columnas presupuestarias (top N personalizable) |
| **Comparación presupuestaria** | Comparar métricas presupuestarias en un rango de años |
| **Comparación de columnas presupuestarias** | Seleccione hasta 10 combinaciones de año+columna |
| **Cuentas de consolidación** | Presupuesto agrupado por cuenta de consolidación |
| **Dimensiones analíticas** | Presupuesto agrupado por dimensión analítica |
| **Plantilla por mes** | ETC mensuales por centro de coste, línea, proveedor o dimensión analítica |
| **Coste por ETC** | Coste anual de un ETC o tarifa diaria media, por centro de coste, línea, proveedor o dimensión analítica, en varias columnas de presupuesto y años |

### Elegir el tipo de líneas

**Top líneas**, **Top aumento / disminución**, **Comparación presupuestaria**, **Comparación de columnas presupuestarias**, **Cuentas de consolidación**, **Dimensiones analíticas**, **Plantilla por mes** y **Coste por ETC** empiezan con las pestañas **Todo**, **OPEX** y **CAPEX**, el primer control de la barra de filtros.

- El informe se abre en **Todo**: las líneas OPEX y CAPEX juntas. **OPEX** o **CAPEX** conserva las líneas de ese tipo. Las tres opciones requieren acceso de lectura a las líneas presupuestarias (`budget:reader`). Sin ese acceso, las pestañas aparecen desactivadas.
- La dirección de la página conserva el tipo elegido (`?scope=all`, `?scope=opex` o `?scope=capex`), de modo que un enlace guardado o compartido se abre en el mismo tipo.
- El subtítulo y el título del gráfico indican el tipo, de modo que una impresión o un PNG exportado muestra qué líneas cubre.
- Cambiar de tipo borra las líneas que excluyó.

Los dos informes de contracargo tienen las mismas pestañas **Todo**, **OPEX** y **CAPEX**, y se abren en **OPEX**. Consulte [Contracargo global](#contracargo-global).

### Elegir importe o ETC

Los seis informes presupuestarios tienen un selector **Medida**. Está justo después de las pestañas de tipo. Ofrece **Importe** (por defecto) y **ETC**. Los dos informes de contracargo no tienen medida.

Con **ETC**, un informe suma personas en lugar de dinero:

- Cada columna presupuestaria muestra el ETC medio del año completo que declaran sus líneas de cantidad y precio. Las líneas en personas o en días suman ETC. Las líneas en piezas cuentan 0. Una columna sin líneas no declara ETC y se deja fuera: solo cuentan los ETC declarados. Consulte [Cantidad y precio](budget-lines.md#cantidad-y-precio) y [ETC](budget-lines.md#etc).
- Un año o una columna en la que ninguna línea declara ETC muestra una celda vacía, sin barra ni punto en el gráfico.
- **Top líneas**, **Cuentas de consolidación** y **Dimensiones analíticas** dejan fuera las líneas y los grupos que no declaran ETC. Las proporciones son proporciones del total de ETC.
- **Top aumento / disminución** compara los ETC de las dos columnas línea por línea. Una línea que declara ETC solo en un lado cuenta 0 en el otro.
- Los valores se muestran con dos decimales. Los nombres de columna y los títulos de gráfico llevan la mención ETC.
- La dirección de la página conserva la medida (`?measure=fte`), de modo que un enlace guardado o compartido se abre con la misma medida.
- Los nombres de los archivos exportados llevan `-fte`.

Con ETC, un aviso bajo la tabla indica cuando algunas líneas declaran ETC en una columna cuyo importe ya no sigue sus líneas de cantidad y precio. Ocurre cuando el importe se ha distribuido, cuando sus meses se han editado a mano o cuando la columna se ha copiado de una columna cuyas líneas eran solo una referencia. El aviso indica cuántas líneas y cuántos ETC están afectados, por columna y año. Con varias columnas dice, por ejemplo: «El importe ya no sigue las líneas en: Presupuesto 2026 (2 líneas, 1,50 ETC), Presupuesto 2027 (1 línea, 0,50 ETC).» Con una sola columna dice: «2 líneas declaran 1,50 ETC, pero su importe ya no sigue sus líneas de cantidad y precio.» Sus ETC siguen contando. El aviso le indica que el importe de la columna no es el coste de sus líneas de cantidad y precio.

### Columnas presupuestarias en los informes

Cada selector de columna o de métrica ofrece las columnas presupuestarias que muestra su organización, con sus nombres, en el orden fijo de las columnas. Previsión se ofrece cuando se muestra. Las columnas ocultas no se ofrecen. Cada informe empieza en la columna por defecto, como se describe a continuación. Los administradores de presupuesto definen los nombres, las columnas visibles y la columna por defecto en [Columnas presupuestarias](budget-operations.md#columnas-presupuestarias).

### Filtros de centro de coste, de Run o build y de dimensiones analíticas

Los informes presupuestarios (**Top líneas**, **Top aumento / disminución**, **Comparación presupuestaria**, **Comparación de columnas presupuestarias**, **Cuentas de consolidación** y **Dimensiones analíticas**), **Plantilla por mes** y **Coste por ETC** se pueden limitar a una parte del presupuesto con estos filtros:

- **Centro de coste**: elija un centro de coste o un grupo. Un grupo incluye todo lo que tiene por debajo, también los centros de coste desactivados, ya que sus líneas siguen perteneciendo al grupo. **Todos los centros de coste** quita el filtro. Consulte [Centros de coste](cost-centers.md).
- **Run o build**: **Todos**, **Run**, **Build** o **Sin definir** para las líneas que no tienen ninguno de los dos.
- **Líneas**: **Todas las líneas** o **Líneas con ETC**. **Líneas con ETC** conserva las líneas que declaran ETC en al menos una columna presupuestaria de cualquier año. El filtro funciona con las dos medidas. Un informe de importes limitado a **Líneas con ETC** compara, por ejemplo, los importes de Presupuesto y Realizado de las líneas de personal. El importe Realizado cubre toda la línea.
- **Dimensiones analíticas**: un filtro por dimensión, con el nombre de la dimensión. La dimensión por defecto se muestra como **Dimensión analítica** hasta que se le da un nombre. Elija un valor, **Sin valor** para las líneas sin valor en esa dimensión, o **Todos** para quitar el filtro. Cada filtro ofrece los valores que tienen las líneas del informe. Consulte [Dimensiones analíticas](analytics.md).

Cuándo aparecen los filtros:

- **Centro de coste** aparece en cuanto su espacio de trabajo tiene al menos un centro de coste o un grupo.
- **Run o build** aparece en cuanto una línea del informe está marcada como **Run** o **Build**, o cuando la dirección de la página ya incluye el filtro.
- **Líneas** aparece en cuanto una línea del informe declara ETC, o cuando la dirección de la página ya incluye el filtro.
- El filtro de una dimensión aparece en cuanto una línea del informe tiene un valor en esa dimensión, o cuando la dirección de la página ya lo incluye. Las dimensiones desactivadas no tienen filtro. Un informe solo muestra las dimensiones usadas para las líneas que cubre: cambiar de tipo cambia la lista. Una dimensión en **Solo OPEX** no tiene filtro en un informe CAPEX, y al revés. **Todo** muestra las dimensiones de ambos tipos. Consulte [Dimensiones OPEX o CAPEX](analytics.md#dimensiones-opex-o-capex).
- Sin ninguno de ellos, la barra de filtros solo muestra los controles propios del informe.

Cómo funcionan:

- Los filtros se aplican antes de cualquier total. Los importes, las proporciones, los gráficos y los totales cubren solo las líneas conservadas.
- Los filtros de varias dimensiones se combinan: una línea debe cumplir cada uno de ellos.
- Las listas de líneas, cuentas y valores que se pueden excluir siguen ofreciendo todas las líneas.
- La dirección de la página conserva los filtros (`?costCenter=`, `?runBuild=`, `?fte=with` y `?analytics=`), de modo que un enlace guardado o compartido abre el informe ya filtrado. Un enlace que indica una dimensión desactivada o eliminada desde entonces ignora esa parte.
- Si el enlace indica un centro de coste que se ha eliminado desde entonces, o si los centros de coste no se pudieron cargar, el informe no muestra ninguna línea y sí una línea de texto: "Este centro de coste ya no existe o no se pudo cargar." Haga clic en **Quitar el filtro** para volver a ver el informe.
- Si el enlace incluye un filtro analítico y las dimensiones no se pudieron cargar, el informe no muestra ninguna línea y sí una línea de texto: "No se pudo aplicar el filtro analítico. Quítelo o vuelva a intentarlo." Haga clic en **Quitar el filtro** para quitar los filtros analíticos y volver a ver el informe.
- Los dos informes de contracargo no tienen estos filtros y no se ven afectados.

### Importes sin tipo de cambio

Cuando la moneda de una línea no tiene tipo de cambio para un año, los informes presupuestarios, **Plantilla por mes** y **Coste por ETC** excluyen de sus cifras los importes de esa línea para el año. Un aviso de una línea en la parte superior del informe los indica, por ejemplo «Se excluyen 3 líneas sin tipo de cambio: USD 2026.» Los usuarios de la administración presupuestaria con nivel de administrador ven además **Introducir un tipo**, que abre los ajustes de monedas en el tipo faltante. Cuando el aviso solo cita una moneda y un año, el diálogo del tipo manual se abre directamente. El aviso no se imprime. Vea [Tipos manuales](currencies.md#tipos-manuales).

Los dos informes de contracargo excluyen estos importes de todas sus cifras: pagado, consumido, departamentos y flujos intercompañía. Cada informe queda equilibrado sobre lo que cuenta. El mismo aviso aparece encima del informe.

### Abrir la lista desde un informe

En **Plantilla por mes**, **Coste por ETC**, **Dimensiones analíticas** y **Cuentas de consolidación**, el nombre de un grupo es un enlace que abre la [lista de líneas presupuestarias](budget-lines.md) en una pestaña nueva, con las líneas que cuenta la fila:

- las líneas del grupo, restringidas por la barra de filtros, y por el filtro **Tipo** cuando el informe está en **OPEX** o **CAPEX**;
- todos los estados (**Mostrar: Todos**), con un filtro **Fin de validez** "vacío, o posterior al 31 de diciembre" del año anterior al primer año del informe. Un informe cuenta las líneas todavía activas el 1 de enero de su primer año, incluidas las desactivadas después;
- en **Plantilla por mes** y **Coste por ETC**, y con la medida **ETC**, solo las líneas que declaran ETC (el filtro **ETC declarados**).

Las columnas filtradas aparecen justo después del nombre de la línea durante esta visita, para que vea por qué la lista está restringida. Una cuenta de consolidación filtra por sus cuentas, sin columna propia.

Esta lista es una vista del informe. Lo que cambie en ella queda en su dirección, y **Líneas presupuestarias** abierta después desde el menú muestra su propio orden, búsqueda y filtros.

---

## Contracargo global

Vea las asignaciones de costes entre todas las empresas con KPI resumen y flujos intercompañía.

### Controles

- **Tipo de línea**: **Todo**, **OPEX** o **CAPEX**. El informe se abre en **OPEX**. En **Todo** o **CAPEX**, una nota sobre los resultados indica «Las líneas CAPEX cuentan por su importe del año, sin amortización.»
- **Año**: Ejercicio fiscal anterior, actual o siguiente
- **Columna**: Cualquier columna presupuestaria visible. Empieza en la columna por defecto
- **Totales por empresa** (casilla): Mostrar u ocultar la tabla de totales por empresa y el gráfico de barras
- **Asignaciones detalladas** (casilla): Mostrar u ocultar el desglose empresa-departamento
- **Incluir KPI** (casilla): Mostrar u ocultar la tabla de KPI
- **Flujos intercompañía** (casilla): Mostrar u ocultar los flujos netos pagador/consumidor
- **Ejecutar**: Actualizar manualmente el informe

### Qué verá

**Tarjeta de total general**: El total global para la métrica y año seleccionados, más conteos de empresas, líneas detalladas y cobertura de KPI.

**Tabla de totales por empresa** (cuando está habilitada):

- Nombre de la empresa
- Importe para la métrica seleccionada
- Importe pagado (contabilizado)
- Neto (consumido menos pagado)
- Participación en el total

**Gráfico**: Gráfico de barras horizontales de asignaciones por empresa.

**Tabla de asignaciones detalladas** (cuando está habilitada):

- Columnas de empresa y departamento (agrupadas con filas de subtotal en negrita por empresa)
- Importe, participación en el total, plantilla y coste por usuario
- Las filas etiquetadas "Costes comunes" representan costes sin asignación de departamento

**Tabla de flujos intercompañía** (cuando está habilitada):

- Flujos netos pagador-consumidor por par de empresas (auto-consumo excluido)
- Columnas: Pagador, Consumidor, importe

**Tabla de KPI** (cuando está habilitada):

| Columna | Descripción |
|---------|-------------|
| Empresa | Nombre de la empresa |
| Importe | Total de la métrica seleccionada |
| Plantilla | Plantilla total |
| Usuarios IT | Conteo de usuarios IT |
| Facturación | Facturación anual, en millones de la moneda de reporte |
| Costes IT vs facturación | Ratio porcentual, ambos términos en la moneda de reporte |
| Costes IT por usuario | Importe dividido por plantilla |
| Costes IT por usuario IT | Importe dividido por usuarios IT |

Una fila de totales está fijada en la parte inferior.

### Exportar

- **Exportar la tabla** (icono de descarga): **Excel (.xlsx)** escribe una hoja por tabla: **Asignaciones detalladas**, **Totales globales por empresa**, **Flujos interempresariales** y **KPI de contracargo**, y después la hoja **Parámetros**. **CSV** ofrece una entrada por tabla, por ejemplo **CSV: Flujos interempresariales**. Las asignaciones detalladas contienen una fila por departamento, con su empresa en cada fila, de modo que la suma de la columna de importes da el total. Los totales por empresa están en su propia tabla
- **Exportar gráfico como PNG** (icono de imagen): Exporta el gráfico de barras
- **Imprimir / Guardar como PDF** (icono de impresión)

La exportación contiene todas las tablas, sean cuales sean las que muestran las casillas en pantalla.

---

## Contracargo por empresa

Profundice en las asignaciones de contracargo de una empresa entre departamentos, líneas presupuestarias, flujos intercompañía y KPI.

### Controles

- **Tipo de línea**: **Todo**, **OPEX** o **CAPEX**, como en el contracargo global. El informe se abre en **OPEX**
- **Empresa**: Seleccione qué empresa analizar
- **Año**: Ejercicio fiscal anterior, actual o siguiente
- **Columna**: Cualquier columna presupuestaria visible. Empieza en la columna por defecto
- **Totales por departamento** (casilla): Mostrar u ocultar el desglose por departamento
- **Líneas de contracargo** (casilla): Mostrar u ocultar asignaciones detalladas
- **KPI de contracargo** (casilla): Mostrar u ocultar la tabla comparativa de KPI
- **Flujos intercompañía** (casilla): Mostrar u ocultar flujos con empresas asociadas
- **Ejecutar**: Actualizar manualmente el informe (deshabilitado hasta que se seleccione una empresa)

### Qué verá

**Tarjeta resumen de la empresa**: Nombre de la empresa, importe total, moneda de reporte, plantilla, usuarios IT, coste por usuario, coste por usuario IT y costes IT vs facturación.

**Facturación en los informes de contracargo**: cada empresa introduce su facturación en millones de su moneda base. Los dos informes de contracargo la convierten a la moneda de reporte, a los tipos de la versión presupuestaria del año, como los importes. La facturación, el ratio costes IT vs facturación y la facturación global de las tablas de KPI usan el valor convertido. Cuando una moneda no tiene tipo para el año, las empresas en esa moneda quedan fuera de los indicadores de facturación, y un aviso en la parte superior del informe nombra cada una de ellas. El ratio global costes IT vs facturación se calcula entonces solo sobre las empresas cuya facturación se ha convertido, tanto para los costes como para la facturación. KANAP obtiene el tipo que falta en segundo plano.

**Totales por departamento** (cuando está habilitado):

- Nombre del departamento, importe, participación en el total, plantilla, coste por usuario
- "Costes comunes" agrega las asignaciones sin un departamento específico
- Gráfico de barras horizontales junto a la tabla

**Líneas de contracargo** (cuando está habilitado):

- Nombre de la línea, método de asignación, importe, participación en el total
- Fila de totales fijada en la parte inferior
- El nombre de la línea es un enlace que abre la línea presupuestaria en una nueva pestaña. Los costes comunes y los totales son texto simple.

**Flujos intercompañía** (cuando está habilitado):

- Empresa asociada, cuentas por cobrar, cuentas por pagar, neto
- Fila de totales fijada

**Tabla de KPI** (cuando está habilitada): Mismas columnas que la tabla de KPI del Contracargo global, con una fila de "Totales globales" en la parte inferior para comparación.

**Acceso a los datos limitado**: una persona limitada abre las empresas de sus nodos de empresa, o todas las empresas con **Todo**. Las líneas de contracargo muestran entonces la parte imputada a la empresa, con la empresa que paga, el porcentaje de asignación y los departamentos; una línea que no ve de otro modo muestra su referencia sin enlace. Las cifras de las demás empresas y los totales globales se omiten, y un nodo de centro de coste no abre este informe. Vea [Acceso a los datos](data-access.md#what-a-limited-person-sees).

### Exportar

- **Exportar la tabla**: **Excel (.xlsx)** escribe una hoja por tabla: **Totales por departamento**, **Líneas de contracargo**, **Flujos interempresariales** y **KPI de contracargo**, y después la hoja **Parámetros**. **CSV** ofrece una entrada por tabla, por ejemplo **CSV: Líneas de contracargo**
- **Exportar gráfico como PNG**: Exporta el gráfico de barras por departamento
- **Imprimir / Guardar como PDF**

La exportación contiene todas las tablas, sean cuales sean las que muestran las casillas en pantalla.

---

## Top líneas

Identifique sus mayores líneas presupuestarias para un año dado.

### Controles

- **Tipo de línea**: **Todo**, **OPEX** o **CAPEX** (ver [Elegir el tipo de líneas](#elegir-el-tipo-de-lineas))
- **Medida**: **Importe** o **ETC** (consulte [Elegir importe o ETC](#elegir-importe-o-etc))
- **Año**: Año anterior, actual o siguiente
- **Métrica**: Cualquier columna presupuestaria visible. Empieza en la columna por defecto
- **Cantidad top**: Cuántas líneas mostrar (predeterminado: 10, mínimo: 1)
- **Tipo de gráfico**: Gráfico circular o gráfico de barras horizontales
- **Excluir líneas**: Autocompletado de selección múltiple para excluir líneas específicas
- **Excluir cuentas**: Autocompletado de selección múltiple para excluir cuentas específicas
- **Centro de coste**, **Run o build**, **Líneas** y los filtros de dimensiones analíticas: Consulte [Filtros de centro de coste, de Run o build y de dimensiones analíticas](#filtros-de-centro-de-coste-de-run-o-build-y-de-dimensiones-analiticas)

### Qué verá

**Gráfico**: Gráfico circular o de barras horizontales de las líneas principales. Su título indica el tipo, por ejemplo "Top 10 CAPEX · Presupuesto 2026".

**Columnas de la tabla**:

- Línea
- Valor para la métrica y año seleccionados
- Participación en el total (porcentaje)

El nombre de la línea es un enlace que abre la línea presupuestaria en una nueva pestaña.

**Tarjetas de resumen debajo de la tabla**:

- **Total top N**, con su parte del total filtrado, por ejemplo «45 % del total filtrado»
- El total de la columna seleccionada en todas las líneas, con el nombre de la columna, por ejemplo **Presupuesto, total**

La nota al pie del gráfico da el mismo total, por ejemplo «Presupuesto, total: 1 234».

### Caso de uso

Utilice este informe para detectar rápidamente dónde va la mayor parte de su presupuesto IT e identificar candidatos para optimización de costes.

---

## Top aumento / disminución

Identifique los mayores cambios entre dos columnas presupuestarias (cualquier combinación de año y métrica).

### Controles

- **Tipo de línea**: **Todo**, **OPEX** o **CAPEX** (ver [Elegir el tipo de líneas](#elegir-el-tipo-de-lineas))
- **Medida**: **Importe** o **ETC** (consulte [Elegir importe o ETC](#elegir-importe-o-etc))
- **Año de origen** y **Métrica de origen**: La columna base de comparación
- **Año de destino** y **Métrica de destino**: La columna objetivo de comparación
- **Cantidad top**: Cuántas líneas mostrar por dirección (predeterminado: 10)
- **Tipo de gráfico**: Gráfico circular (solo una dirección) o gráfico de barras horizontales
- **Excluir líneas**: Autocompletado de selección múltiple para excluir líneas específicas
- **Excluir cuentas**: Autocompletado de selección múltiple para excluir cuentas específicas
- **Dirección**: pestañas **Aumentos**, **Disminuciones** o **Ambos**
- **Centro de coste**, **Run o build**, **Líneas** y los filtros de dimensiones analíticas: Consulte [Filtros de centro de coste, de Run o build y de dimensiones analíticas](#filtros-de-centro-de-coste-de-run-o-build-y-de-dimensiones-analiticas)

Los selectores de año muestran los años que contienen datos. Los selectores de métrica ofrecen las columnas presupuestarias visibles. El informe empieza en la columna por defecto del año pasado como origen y en la columna por defecto del año actual como destino.

Cuando se selecciona **Ambos**, la opción de gráfico circular se deshabilita y el informe cambia automáticamente a barras.

### Qué verá

**Gráfico**: Visualización de los principales cambios. Su título indica el tipo, por ejemplo "Top 10 aumentos OPEX".

**Columnas de la tabla**:

- Línea
- Valor de origen (anterior)
- Valor de destino (actual)
- Delta (cambio absoluto)
- Porcentaje de aumento

El nombre de la línea es un enlace que abre la línea presupuestaria en una nueva pestaña.

**Tarjetas de resumen debajo de la tabla**:

- Totales de la selección (importes de aumento y/o disminución, con sumas de origen/destino)
- Cambios brutos en todas las líneas (con porcentaje de cobertura)
- Aumento o disminución neto en todas las líneas

### Caso de uso

Utilice este informe para identificar sobrecostes, detectar oportunidades de ahorro y explicar la variación año a año en revisiones presupuestarias.

---

## Comparación presupuestaria

Compare métricas presupuestarias en múltiples años en un solo gráfico de líneas. La dirección del antiguo informe **Tendencia presupuestaria (CAPEX)** abre este informe en CAPEX.

### Controles

- **Tipo de línea**: **Todo**, **OPEX** o **CAPEX** (ver [Elegir el tipo de líneas](#elegir-el-tipo-de-lineas))
- **Medida**: **Importe** o **ETC** (consulte [Elegir importe o ETC](#elegir-importe-o-etc))
- **Año de inicio**: Inicio del rango (año actual menos 2 hasta más 2)
- **Año de fin**: Fin del rango
- **Métricas**: Selección múltiple entre las columnas presupuestarias visibles. El informe empieza en la columna por defecto y en la última columna visible (Presupuesto y Aterrizaje previsto con la configuración estándar). Si quita todas las métricas, se usa la columna por defecto
- **Centro de coste**, **Run o build**, **Líneas** y los filtros de dimensiones analíticas: Consulte [Filtros de centro de coste, de Run o build y de dimensiones analíticas](#filtros-de-centro-de-coste-de-run-o-build-y-de-dimensiones-analiticas)

### Qué verá

**Gráfico**: Gráfico de líneas con una serie por métrica seleccionada, trazada a lo largo del rango de años.

**Tabla**: Una fila por métrica seleccionada, con columnas de año mostrando totales.

### Exportar

- **Exportar la tabla**: CSV o Excel. Consulte [Opciones de exportación](#export-options)
- **Exportar gráfico como PNG**
- **Imprimir / Guardar como PDF**

---

## Comparación de columnas presupuestarias

Compare de forma flexible hasta 10 combinaciones de año+columna.

### Controles

- **Tipo de línea**: **Todo**, **OPEX** o **CAPEX** (ver [Elegir el tipo de líneas](#elegir-el-tipo-de-lineas))
- **Medida**: **Importe** o **ETC** (consulte [Elegir importe o ETC](#elegir-importe-o-etc))
- **Selecciones**: Cada selección tiene un selector de año y un selector de columna con las columnas presupuestarias visibles. El informe empieza con dos selecciones: la columna por defecto del año actual y la del año siguiente. **Añadir** añade la columna por defecto del año actual, y el icono de borrar elimina una selección. Máximo de 10 selecciones; mínimo de 1.
- **Agrupación por año** (casilla): Cuando está habilitada y al menos dos años comparten una métrica, cambia a un gráfico de líneas agrupado con una serie por métrica y años en el eje X. Cuando está deshabilitada, muestra un gráfico de líneas plano con cada selección como punto de datos.
- **Centro de coste**, **Run o build**, **Líneas** y los filtros de dimensiones analíticas: Consulte [Filtros de centro de coste, de Run o build y de dimensiones analíticas](#filtros-de-centro-de-coste-de-run-o-build-y-de-dimensiones-analiticas)

### Qué verá

**Gráfico**:

- Modo predeterminado: Gráfico de líneas con cada selección en el eje X y su total en el eje Y
- Modo agrupación por año: Gráfico de líneas con años en el eje X y una línea por métrica

**Tabla**:

- Modo predeterminado: Etiqueta de selección, año, nombre de columna, total
- Modo agrupación por año: Columna de año, luego una columna por métrica con totales

### Exportar

- **Exportar la tabla**: CSV o Excel. Consulte [Opciones de exportación](#export-options)
- **Exportar gráfico como PNG**
- **Imprimir / Guardar como PDF**

---

## Cuentas de consolidación

Vea datos presupuestarios agrupados por cuenta de consolidación, con el tipo de gráfico adaptándose al rango de años.

### Controles

- **Tipo de línea**: **Todo**, **OPEX** o **CAPEX** (ver [Elegir el tipo de líneas](#elegir-el-tipo-de-lineas))
- **Medida**: **Importe** o **ETC** (consulte [Elegir importe o ETC](#elegir-importe-o-etc))
- **Año de inicio** y **Año de fin**: Año anterior, actual o siguiente
- **Métrica**: Cualquier columna presupuestaria visible. Empieza en la columna por defecto
- **Tipo de gráfico**: Gráfico circular o de barras horizontales (solo disponible cuando se selecciona un solo año)
- **Excluir cuentas**: Autocompletado de selección múltiple para excluir cuentas específicas. Ofrece todas las cuentas usadas por las líneas del informe, por nombre y número, pueda o no abrir el plan de cuentas. La lista empieza por "Sin asignar": al elegirlo se excluyen las líneas sin cuenta de consolidación
- **Centro de coste**, **Run o build**, **Líneas** y los filtros de dimensiones analíticas: Consulte [Filtros de centro de coste, de Run o build y de dimensiones analíticas](#filtros-de-centro-de-coste-de-run-o-build-y-de-dimensiones-analiticas)

### Qué verá

**Modo un solo año**:

- Gráfico circular o de barras horizontales de totales por cuenta de consolidación
- Nota al pie con el total para la métrica seleccionada

**Modo varios años**:

- Gráfico de líneas con una serie por cuenta de consolidación, trazada a lo largo de los años

**Tabla**: Una fila por cuenta de consolidación con columnas de año. Una fila de totales fijada en la parte inferior suma todos los grupos. Una cuenta de consolidación abre la lista de las líneas de sus cuentas en una pestaña nueva ("Sin asignar": las líneas cuya cuenta no tiene cuenta de consolidación, y las líneas sin cuenta). Consulte [Abrir la lista desde un informe](#abrir-la-lista-desde-un-informe). La fila de totales es texto sin enlace.

Una línea en una cuenta de consolidación desactivada desde entonces sigue contando, en la línea de consolidación de esa cuenta. Los nombres y números de cuenta solo se muestran si puede leer el [plan de cuentas](chart-of-accounts.md); sin ese acceso, todas las líneas aparecen bajo "Sin asignar" en su lugar (los totales siguen siendo correctos, solo se oculta el desglose por cuenta). Las líneas sin cuenta de consolidación también aparecen como "Sin asignar". Las cuentas de consolidación son las cuentas de su [plan de consolidación](chart-of-accounts.md#el-plan-de-consolidacion).

---

## Dimensiones analíticas

Vea datos presupuestarios agrupados por los valores de una dimensión analítica. El diseño es idéntico al informe de Cuentas de consolidación. Consulte [Dimensiones analíticas](analytics.md) para configurar las dimensiones y los valores.

### Controles

- **Tipo de línea**: **Todo**, **OPEX** o **CAPEX** (ver [Elegir el tipo de líneas](#elegir-el-tipo-de-lineas))
- **Medida**: **Importe** o **ETC** (consulte [Elegir importe o ETC](#elegir-importe-o-etc))
- **Dimensión**: la dimensión por la que agrupa el informe. Ofrece las dimensiones activadas usadas para el tipo de línea elegido, aparece cuando hay dos o más, y el informe se abre en la dimensión por defecto. Si cambia a un tipo de línea que no usa la dimensión elegida, el informe vuelve a la dimensión por defecto. La dirección de la página conserva su elección, de modo que un enlace guardado o compartido se abre en la misma dimensión
- **Año de inicio** y **Año de fin**: Año anterior, actual o siguiente
- **Métrica**: Cualquier columna presupuestaria visible. Empieza en la columna por defecto
- **Tipo de gráfico**: Gráfico circular o de barras horizontales. Disponible para un solo año, cuando **Reparto OPEX / CAPEX** no está marcado
- **Detalle por línea**: lista las líneas de cada valor debajo de él
- **Reparto OPEX / CAPEX**: añade las proporciones OPEX y CAPEX de cada valor. Disponible solo con el tipo de línea **Todo**
- **Excluir valores**: Autocompletado de selección múltiple para excluir valores concretos de la dimensión elegida. Ofrece los valores que se usan para el tipo de línea elegido, además de los que tienen las líneas del informe. La lista empieza por "Sin asignar": al elegirlo se excluyen las líneas sin valor en la dimensión. Cambiar el tipo de línea o la dimensión borra esta selección
- **Centro de coste**, **Run o build**, **Líneas** y los filtros de dimensiones analíticas: Consulte [Filtros de centro de coste, de Run o build y de dimensiones analíticas](#filtros-de-centro-de-coste-de-run-o-build-y-de-dimensiones-analiticas)

El subtítulo, el título del gráfico y la primera columna de la tabla indican la dimensión elegida, por ejemplo "OPEX por Nature". La dirección de la página también conserva las dos casillas, de modo que un enlace compartido se abre con el mismo detalle y el mismo reparto.

### Qué verá

**Modo un solo año**:

- Gráfico circular o de barras de totales por valor. El gráfico de barras tiene la altura que necesitan sus barras
- Con **Detalle por línea**, el gráfico muestra las líneas ("BL-12 · nombre") en lugar de los valores
- Con **Reparto OPEX / CAPEX**, una barra horizontal por valor, llevada al 100 %: su parte OPEX y su parte CAPEX, cada una con su porcentaje. Una barra **Total** va primero cuando hay dos valores o más, y una leyenda nombra OPEX y CAPEX. Con **Detalle por línea** también marcado, las barras siguen siendo una por valor
- Nota al pie con el total de la métrica

**Modo varios años**:

- Gráfico de líneas con una serie por valor, o una por línea con **Detalle por línea**. El reparto no cambia el gráfico: la tabla lo muestra

**Tabla**: Una fila por valor con columnas de año, y una columna **Líneas** con el número de líneas de cada valor. Una fila de totales fijada en la parte inferior, con el número total de líneas. Las líneas sin valor en la dimensión elegida aparecen como "Sin asignar".

Con **Detalle por línea**, las líneas de cada valor aparecen con sangría debajo de él, "Sin asignar" incluido, con estas columnas:

- **Nivel**: **Valor** o **Línea**
- **Ref**: la referencia de la línea, que abre la línea en una pestaña nueva
- **Naturaleza**: **OPEX** o **CAPEX**
- **Participación del total** para cada año: la parte de la línea en el total de su valor

La ordenación de columnas está desactivada mientras haya filas anidadas bajo los valores.

Con **Reparto OPEX / CAPEX**, cada año recibe una columna **Proporción OPEX** y una columna **Proporción CAPEX**, en cada valor y en la fila de totales. Con el detalle, cada línea muestra 100 % en su propia naturaleza.

Un valor abre la lista de sus líneas en una pestaña nueva ("Sin asignar": las líneas sin valor). Con la medida **ETC**, la lista muestra las líneas del valor que declaran ETC. Consulte [Abrir la lista desde un informe](#abrir-la-lista-desde-un-informe). La fila de totales es texto sin enlace.

**Acceso a los datos limitado**: una persona con el [acceso a los datos](data-access.md#what-a-limited-person-sees) limitado ve una mención debajo de cada valor, por ejemplo "y 3 líneas fuera de su acceso". Con el detalle, aparece después de las líneas del valor. El recuento sigue el tipo de línea y los años del informe, e ignora los filtros. "Sin asignar" no muestra ninguna mención.

La exportación CSV o Excel contiene la columna **Líneas**, y el detalle y el reparto cuando están marcados. La impresión y la exportación omiten las menciones de líneas fuera de su acceso.

---

## Plantilla por mes

Vea cuántas personas prevé cada parte del presupuesto, mes a mes. El informe lee los ETC mensuales que declaran las líneas de cantidad y precio de una columna presupuestaria. Consulte [Cantidad y precio](budget-lines.md#cantidad-y-precio) y [ETC](budget-lines.md#etc).

### Controles

- **Tipo de línea**: **Todo**, **OPEX** o **CAPEX** (ver [Elegir el tipo de líneas](#elegir-el-tipo-de-lineas))
- **Centro de coste**, **Run o build**, **Líneas** y los filtros de dimensiones analíticas: Consulte [Filtros de centro de coste, de Run o build y de dimensiones analíticas](#filtros-de-centro-de-coste-de-run-o-build-y-de-dimensiones-analiticas)
- **Año**: Año anterior, actual o siguiente
- **Columna**: Cualquier columna presupuestaria visible. Empieza en la columna por defecto
- **Agrupar por**: **Centro de coste** (por defecto), **Línea**, **Proveedor** o **Dimensión analítica**
- **Dimensión**: la dimensión por la que agrupa el informe, con **Dimensión analítica**. Ofrece las dimensiones activadas usadas para las líneas del informe y aparece cuando hay dos o más. El informe se abre en la dimensión por defecto

La dirección de la página conserva la agrupación (`?group=item`, `?group=supplier` o `?group=axis:<dimension id>`), de modo que un enlace guardado o compartido se abre con la misma agrupación. Sin este parámetro, el informe agrupa por centro de coste.

### Qué verá

**Gráfico**: Áreas apiladas sobre los doce meses, una para cada uno de los ocho grupos más grandes por media. Los demás grupos se suman en un área **Otros**. El título indica el tipo, la agrupación, la columna y el año, por ejemplo «Plantilla OPEX por centro de coste, Presupuesto 2026». Pase el cursor sobre un mes para leer los ETC de un grupo.

**Tabla**: Una fila por grupo que declara ETC mensuales, la media más alta primero:

- El grupo: un centro de coste, una línea, un proveedor o un valor de la dimensión. Las líneas sin centro de coste aparecen como «Sin centro de coste», sin proveedor como «Sin proveedor» y sin valor en la dimensión como «Sin valor»
- Una columna por mes
- **Media**: la suma de los doce meses dividida entre 12. Es el ETC medio del año completo que declara la columna
- **Pico**: el mes más alto

Una fila **Total** fijada da los totales mensuales, su media y su pico. Los valores se muestran con dos decimales. Solo cuentan los ETC declarados: las líneas sin líneas de cantidad y precio en la columna se dejan fuera.

El nombre de un grupo es un enlace que se abre en una pestaña nueva. Una línea abre su página. Un centro de coste, un proveedor o un valor abre la lista de líneas presupuestarias con las líneas del grupo que declaran ETC, en el periodo del informe y restringidas por la barra de filtros (consulte [Abrir la lista desde un informe](#abrir-la-lista-desde-un-informe)). «Sin centro de coste», «Sin proveedor» y «Sin valor» abren las líneas que no lo tienen. La fila **Total** es texto sin enlace. La exportación conserva los nombres como texto.

### Avisos

Una línea bajo la tabla para cada caso, cuando se da:

- «2 líneas declaran 1,50 ETC, pero su importe ya no sigue sus líneas de cantidad y precio.» El importe se ha distribuido, sus meses se han editado a mano o la columna se ha copiado. Este aviso cubre las líneas que tienen detalle mensual, y sus ETC siguen contando en los meses. Las líneas sin detalle mensual aparecen solo en el aviso siguiente. Consulte [Elegir importe o ETC](#elegir-importe-o-etc).
- «1 línea declara 3,00 ETC sin detalle mensual. No se incluye en los meses.» Estas líneas declaran un ETC del año completo, sin ETC por mes. Quedan fuera de los meses, de la media y del pico.

### Exportar

- **Exportar la tabla**: CSV o Excel. El nombre del archivo lleva el tipo, el año, la columna, la agrupación y el día de la exportación, por ejemplo `staffing-opex-2026-budget-cost-center-2026-10-27.xlsx`
- **Exportar gráfico como PNG**: El tipo, el año, la columna y la agrupación, como imagen PNG
- **Imprimir / Guardar como PDF**

---

## Coste por ETC

Vea cuánto cuesta un ETC en cada parte del presupuesto y cómo evoluciona ese coste entre columnas presupuestarias y años. El informe divide el coste de las líneas de cantidad y precio en personas o días entre sus ETC. También puede mostrar la tarifa diaria media de las líneas con precio por día (ver [Tarifa diaria](#tarifa-diaria)). Consulte [Cantidad y precio](budget-lines.md#cantidad-y-precio) y [ETC](budget-lines.md#etc).

### Controles

- **Tipo de línea**: **Todo**, **OPEX** o **CAPEX** (ver [Elegir el tipo de líneas](#elegir-el-tipo-de-lineas))
- **Centro de coste**, **Run o build**, **Líneas** y los filtros de dimensiones analíticas: Consulte [Filtros de centro de coste, de Run o build y de dimensiones analíticas](#filtros-de-centro-de-coste-de-run-o-build-y-de-dimensiones-analiticas)
- **Agrupar por** y **Dimensión**: las mismas opciones que en [Plantilla por mes](#plantilla-por-mes). La dirección de la página conserva la agrupación de la misma manera
- **Mostrar**: **Coste por ETC** (por defecto) o **Tarifa diaria**. Al cambiar se conservan el tipo, la agrupación, los pares y los filtros. La dirección de la página conserva la tarifa diaria (`?view=rate`), de modo que un enlace guardado o compartido se abre en ella
- **Columnas**: de uno a cuatro pares de un año y una columna presupuestaria. Los años van de dos años atrás a dos años adelante. **Agregar** añade un par, y el botón de quitar junto a un par lo quita. El informe se abre en la columna por defecto del año pasado y del año actual. La tabla y el gráfico muestran los pares en orden cronológico

### Qué se cuenta

- El coste y los ETC de las líneas en personas o días. Las líneas en piezas quedan fuera de ambos.
- El informe lee los resultados de las líneas, también cuando el importe de la columna ya no las sigue (el importe se ha distribuido, sus meses se han editado a mano o la columna se ha copiado). El coste es entonces el coste de las líneas.
- El coste se convierte a la moneda de reporte al tipo de la versión de cada año, como todos los importes de los informes.
- Las líneas que declaran ETC sin detalle de líneas quedan fuera. Un aviso las indica (ver más abajo).

### Qué verá

**Tabla**: Una fila por grupo con ETC de personal en al menos un par, el mayor número de ETC primero. Se comparan los ETC del primer par en el que algún grupo tiene ETC de personal, de modo que un presupuesto que solo prevé personal para este año sigue ordenado por ETC. Sin ningún ETC de personal, las filas siguen el orden de los nombres. Cada par tiene tres columnas bajo su nombre, por ejemplo «Presupuesto 2026»:

- **ETC**: el ETC medio del año completo de las líneas
- **Coste de personal**: el coste de las mismas líneas en el año, en la moneda de reporte
- **Coste por ETC**: el coste de personal dividido entre los ETC. La celda queda vacía cuando los ETC son 0 o cuando el grupo no tiene líneas de personal en ese par

Los grupos se nombran como en Plantilla por mes («Sin centro de coste», «Sin proveedor», «Sin valor»). Una fila **Total** fijada da, para cada par, el total de ETC, el total del coste de personal y el total del coste de personal dividido entre el total de ETC.

En las dos vistas, el nombre de un grupo abre su línea, o la lista de las líneas del grupo que declaran ETC, en una pestaña nueva, como en [Plantilla por mes](#plantilla-por-mes).

**Gráfico**: Barras horizontales del coste por ETC, una barra por par. La primera categoría es el total, seguida de los diez primeros grupos de la tabla. El título indica el tipo y la agrupación, por ejemplo «Coste por ETC OPEX por centro de coste». Pase el cursor sobre una barra para leer el grupo, el par, el coste por ETC, los ETC y el coste de personal.

### Avisos

Una línea bajo la tabla para cada caso, cuando se da. Cada línea indica los pares afectados:

- «El importe ya no sigue las líneas en: Presupuesto 2026 (2 líneas, 1,50 ETC). Estas cifras usan el coste de sus líneas.» Estas columnas cuentan con el coste de sus líneas. Consulte [Elegir importe o ETC](#elegir-importe-o-etc).
- «Sin detalle de líneas en: Presupuesto 2025 (1 línea, 0,50 ETC). Quedan fuera de estas cifras.» Estas líneas declaran un ETC del año completo, sin resultado por línea, por lo que el informe no puede leer su coste.

### Tarifa diaria

Elija **Mostrar** > **Tarifa diaria** para ver la tarifa diaria media de cada grupo en lugar del coste por ETC.

- Solo cuentan las líneas con precio por día: personas con precio por día y paquetes de días. La tarifa es su coste dividido entre los días que compran, de modo que cada línea pesa según sus días.
- Las líneas con precio por mes no tienen tarifa diaria. Quedan fuera, y un aviso indica su coste (ver más abajo).
- Como en el coste por ETC, el informe lee los resultados de las líneas y convierte el coste a la moneda de reporte.

**Tabla**: Una fila por grupo con días en al menos un par, el mayor número de días primero. Se comparan los días del primer par en el que algún grupo tiene días. Cada par tiene tres columnas bajo su nombre:

- **Días**: los días que compran las líneas con precio por día
- **Coste de los días**: el coste de las mismas líneas en el año, en la moneda de reporte
- **Tarifa diaria**: el coste de los días dividido entre los días. La celda queda vacía cuando los días son 0 o cuando el grupo no tiene líneas con precio por día en ese par

Una fila **Total** fijada da, para cada par, el total de días, el total del coste de los días y el total del coste de los días dividido entre el total de días.

**Gráfico**: Las mismas barras horizontales, con la tarifa diaria. El título indica el tipo y la agrupación, por ejemplo «Tarifa diaria OPEX por centro de coste». Pase el cursor sobre una barra para leer el grupo, el par, la tarifa diaria, los días y el coste de los días.

**Avisos**: Los dos avisos anteriores, y una línea más cuando hay líneas en personas con precio por mes: «Las líneas con precio mensual no se incluyen en la tarifa diaria: Presupuesto 2026 (180 000).» El importe es el coste de esas líneas en cada par afectado, en la moneda de reporte.

### Exportar

- **Exportar la tabla**: CSV o Excel. El nombre del archivo lleva el tipo, la agrupación, el primer par y el día de la exportación, por ejemplo `cost-per-fte-opex-cost-center-2025-budget-2026-10-27.xlsx`. En la tarifa diaria empieza por `daily-rate`, por ejemplo `daily-rate-opex-cost-center-2025-budget-2026-10-27.csv`
- **Exportar gráfico como PNG**: El tipo, la agrupación y el primer par, como imagen PNG
- **Imprimir / Guardar como PDF**

---

## Preguntar al asistente

[Plaid](ai-assistant.md) da las cifras de estos informes, con los mismos derechos: Cuentas de consolidación, Top aumento / disminución (10 líneas por defecto), Plantilla por mes (cada mes, la media y el pico), Coste por ETC, Contracargo global y Contracargo por empresa. También mide varias columnas o años en una misma respuesta, por ejemplo el presupuesto de cada proveedor a lo largo de tres años. En el contracargo, cubre OPEX y CAPEX cuando usted no nombra ninguno de los dos, y repite los avisos del informe. Pregunte, por ejemplo: "¿Qué líneas suben más del presupuesto 2026 a la revisión?" o "¿Cuánto se imputa a cada empresa en 2026, y cuánto paga cada una?"

Plaid lee todas las líneas presupuestarias, incluidas las terminadas. Los informes presupuestarios leen las líneas aún activas el 1 de enero del año anterior al primer año mostrado, así que una línea terminada antes cuenta en la respuesta de Plaid y no en el informe.

## Características comunes

Todos los informes comparten estas capacidades a través de la barra de herramientas compartida:

### Opciones de exportación { #export-options }

- **Exportar la tabla** (icono de descarga): abre un menú con **CSV** y **Excel (.xlsx)**. Su navegador recuerda la última elección y la resalta
- **Exportar gráfico como PNG** (icono de imagen): Descarga el gráfico como imagen PNG
- **Imprimir / Guardar como PDF** (icono de impresión): Abre el diálogo de impresión del navegador. También puede añadir `?print=1` a cualquier URL de informe para activar la impresión automáticamente al cargar.

KANAP construye el archivo de la tabla con las mismas cifras que la pantalla, con los filtros en pantalla:

- **Valores**: los importes conservan sus céntimos, los ETC y los días sus decimales, las partes son porcentajes. La pantalla los redondea para leerlos; el archivo conserva los valores, de modo que una suma en Excel coincide con el informe.
- **Orden**: las filas siguen el orden propio del informe. Un orden elegido con un clic en un encabezado de columna se queda en la pantalla.
- **Idioma**: los encabezados, los nombres de grupo («Sin centro de coste») y las fechas siguen el idioma de su pantalla. Un archivo CSV toma también el separador y la marca decimal de ese idioma (consulte [Archivos CSV y Excel](csv-files.md)).
- **Excel**: una hoja por tabla, con las filas de total en negrita después de los datos. Un orden o un filtro en Excel deja los totales en su sitio. Una última hoja, **Parámetros**, lista los filtros aplicados, la fecha y la hora de la exportación en su zona horaria, y su nombre.
- **Acceso a los datos limitado**: para una persona con el [acceso a los datos](data-access.md) limitado, el archivo cuenta las líneas que ve y no contiene ninguna fila de total. La hoja **Parámetros** indica **Calculado sobre sus accesos**.

Cada exportación de tabla queda anotada en el [registro de auditoría](admin.md#registro-de-auditoria).

Los nombres de los archivos exportados llevan el nombre de la columna, por ejemplo `top10-opex-2026-presupuesto-bar.png`, y un archivo de tabla termina con el día de la exportación. Con la medida ETC, los nombres llevan `-fte`, antes del día en un archivo de tabla.

### Métricas disponibles

Cada selector de métrica o de columna ofrece las mismas columnas presupuestarias: las que muestra su organización, con sus nombres. Con la configuración estándar son Presupuesto, Revisión, Realizado y Aterrizaje previsto. Previsión se ofrece cuando se muestra. Consulte [Columnas presupuestarias en los informes](#columnas-presupuestarias-en-los-informes).

### Navegación

Para cambiar de informe, haga clic en **Informes** en el panel izquierdo para volver al centro.

---

## Consejos

- **Empiece con el Contracargo global**: Obtenga una imagen general de las asignaciones antes de profundizar en una empresa.
- **Use Top líneas para victorias rápidas**: Las líneas de coste más grandes son sus primeros candidatos para optimización.
- **Compare Presupuesto vs Aterrizaje previsto**: Utilice el informe de Comparación de columnas presupuestarias para medir la precisión de la previsión entre años.
- **Alterne secciones en informes de contracargo**: Los controles de casilla le permiten centrarse solo en los datos que necesita (departamentos, líneas, KPI o flujos) sin ruido visual.
- **Agrupación por año en Comparación de columnas presupuestarias**: Al comparar la misma métrica en múltiples años, active la agrupación por año para un gráfico de líneas más limpio.
- **Exporte para presentaciones**: Los gráficos se exportan como PNG y las tablas como CSV o Excel, listos para diapositivas u hojas de cálculo.
