# Informes

La sección de Informes ofrece informes interactivos predefinidos para analizar datos presupuestarios, asignaciones de costes y tendencias de gasto. Cada informe combina una tabla resumen con un gráfico, y todos soportan exportación a CSV e imágenes.

## Dónde encontrarlos

Navegue a **Informes** desde el menú principal para abrir el centro de informes.

- Ruta: **Informes**
- Permisos: `reporting:reader` (mínimo)

---

## Centro de informes

La página principal muestra una tarjeta para cada informe disponible con una breve descripción. Haga clic en cualquier tarjeta para abrir el informe.

| Informe | Qué cubre |
|---------|-----------|
| **Contracargo global** | Totales de asignación por empresa, KPI y flujos intercompañía (OPEX) |
| **Contracargo por empresa** | Detalle de una empresa con departamentos, partidas y KPI (OPEX) |
| **Top partidas** | Mayores partidas OPEX o CAPEX para un año seleccionado (top N personalizable) |
| **Top aumento / disminución** | Mayores cambios OPEX o CAPEX entre dos columnas presupuestarias (top N personalizable) |
| **Tendencia presupuestaria (OPEX)** | Comparar métricas OPEX en un rango de años |
| **Tendencia presupuestaria (CAPEX)** | Comparar métricas CAPEX en un rango de años |
| **Comparación de columnas presupuestarias** | Seleccione hasta 10 combinaciones de año+columna para OPEX o CAPEX |
| **Cuentas de consolidación** | Presupuesto OPEX o CAPEX agrupado por cuenta de consolidación |
| **Dimensiones analíticas** | Presupuesto OPEX o CAPEX agrupado por dimensión analítica |

### Elegir OPEX o CAPEX

**Top partidas**, **Top aumento / disminución**, **Cuentas de consolidación** y **Dimensiones analíticas** empiezan con un conmutador **OPEX** / **CAPEX**, el primer control de la barra de filtros.

- El informe se abre en un tipo que usted puede consultar, primero OPEX. Un tipo que no puede consultar aparece desactivado.
- La dirección de la página conserva el tipo elegido (`?scope=opex` o `?scope=capex`), de modo que un enlace guardado o compartido se abre en el mismo tipo.
- El subtítulo y el título del gráfico indican el tipo, de modo que una impresión o un PNG exportado muestra qué tipo cubre.
- Cambiar de tipo borra las partidas que excluyó, ya que cada tipo tiene sus propias partidas.

Los dos informes de contracargo cubren solo OPEX.

### Columnas presupuestarias en los informes

Cada selector de columna o de métrica ofrece las columnas presupuestarias que muestra su organización, con sus nombres, en el orden fijo de las columnas. Previsión se ofrece cuando se muestra. Las columnas ocultas no se ofrecen. Cada informe empieza en la columna por defecto, como se describe a continuación. Los administradores de presupuesto definen los nombres, las columnas visibles y la columna por defecto en [Columnas presupuestarias](budget-operations.md#columnas-presupuestarias).

### Filtros de centro de coste y de Run o build

Los siete informes presupuestarios (**Top partidas**, **Top aumento / disminución**, **Tendencia presupuestaria (OPEX)**, **Tendencia presupuestaria (CAPEX)**, **Comparación de columnas presupuestarias**, **Cuentas de consolidación** y **Dimensiones analíticas**) se pueden limitar a una parte del presupuesto con dos filtros:

- **Centro de coste**: elija un centro de coste o un grupo. Un grupo incluye todo lo que tiene por debajo, también los centros de coste desactivados, ya que sus líneas siguen perteneciendo al grupo. **Todos los centros de coste** quita el filtro. Consulte [Centros de coste](cost-centers.md).
- **Run o build**: **Todos**, **Run**, **Build** o **Sin definir** para las líneas que no tienen ninguno de los dos.

Cuándo aparecen los filtros:

- **Centro de coste** aparece en cuanto su espacio de trabajo tiene al menos un centro de coste o un grupo.
- **Run o build** aparece en cuanto una línea del informe está marcada como **Run** o **Build**, o cuando la dirección de la página ya incluye el filtro.
- Sin ninguno de los dos, la barra de filtros solo muestra los controles propios del informe.

Cómo funcionan:

- Los filtros se aplican antes de cualquier total. Los importes, las proporciones, los gráficos y los totales cubren solo las líneas conservadas.
- Las listas de partidas y cuentas que se pueden excluir siguen ofreciendo todas las líneas.
- La dirección de la página conserva ambos filtros (`?costCenter=` y `?runBuild=`), de modo que un enlace guardado o compartido abre el informe ya filtrado.
- Si el enlace indica un centro de coste que se ha eliminado desde entonces, o si los centros de coste no se pudieron cargar, el informe no muestra ninguna línea y sí una línea de texto: "Este centro de coste ya no existe o no se pudo cargar." Haga clic en **Quitar el filtro** para volver a ver el informe.
- Los dos informes de contracargo no tienen estos filtros y no se ven afectados.

---

## Contracargo global

Vea las asignaciones de costes entre todas las empresas con KPI resumen y flujos intercompañía.

### Controles

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
- Botón separado **Exportar flujos netos CSV**

**Tabla de KPI** (cuando está habilitada):

| Columna | Descripción |
|---------|-------------|
| Empresa | Nombre de la empresa |
| Importe | Total de la métrica seleccionada |
| Plantilla | Plantilla total |
| Usuarios IT | Conteo de usuarios IT |
| Facturación | Facturación anual |
| Costes IT vs facturación | Ratio porcentual |
| Costes IT por usuario | Importe dividido por plantilla |
| Costes IT por usuario IT | Importe dividido por usuarios IT |

Una fila de totales está fijada en la parte inferior.

### Exportar

- **Exportar tabla como CSV** (icono de descarga): Exporta la cuadrícula de asignaciones detalladas
- **Exportar gráfico como PNG** (icono de imagen): Exporta el gráfico de barras
- **Imprimir / Guardar como PDF** (icono de impresión)

---

## Contracargo por empresa

Profundice en las asignaciones de contracargo de una empresa entre departamentos, partidas presupuestarias, flujos intercompañía y KPI.

### Controles

- **Empresa**: Seleccione qué empresa analizar
- **Año**: Ejercicio fiscal anterior, actual o siguiente
- **Columna**: Cualquier columna presupuestaria visible. Empieza en la columna por defecto
- **Totales por departamento** (casilla): Mostrar u ocultar el desglose por departamento
- **Partidas de contracargo** (casilla): Mostrar u ocultar asignaciones detalladas
- **KPI de contracargo** (casilla): Mostrar u ocultar la tabla comparativa de KPI
- **Flujos intercompañía** (casilla): Mostrar u ocultar flujos con empresas asociadas
- **Ejecutar**: Actualizar manualmente el informe (deshabilitado hasta que se seleccione una empresa)

### Qué verá

**Tarjeta resumen de la empresa**: Nombre de la empresa, importe total, moneda de reporte, plantilla, usuarios IT, coste por usuario, coste por usuario IT y costes IT vs facturación.

**Totales por departamento** (cuando está habilitado):

- Nombre del departamento, importe, participación en el total, plantilla, coste por usuario
- "Costes comunes" agrega las asignaciones sin un departamento específico
- Gráfico de barras horizontales junto a la tabla

**Partidas de contracargo** (cuando está habilitado):

- Nombre de la partida, método de asignación, importe, participación en el total
- Fila de totales fijada en la parte inferior

**Flujos intercompañía** (cuando está habilitado):

- Empresa asociada, cuentas por cobrar, cuentas por pagar, neto
- Fila de totales fijada
- Botón separado **Exportar flujos CSV**

**Tabla de KPI** (cuando está habilitada): Mismas columnas que la tabla de KPI del Contracargo global, con una fila de "Totales globales" en la parte inferior para comparación.

### Exportar

- **Exportar tabla como CSV**: Exporta la cuadrícula de totales por departamento
- **Exportar gráfico como PNG**: Exporta el gráfico de barras por departamento
- **Imprimir / Guardar como PDF**

---

## Top partidas

Identifique sus mayores partidas OPEX o CAPEX para un año dado.

### Controles

- **Tipo de partida**: OPEX o CAPEX (ver [Elegir OPEX o CAPEX](#elegir-opex-o-capex))
- **Año**: Año anterior, actual o siguiente
- **Métrica**: Cualquier columna presupuestaria visible. Empieza en la columna por defecto
- **Cantidad top**: Cuántas partidas mostrar (predeterminado: 10, mínimo: 1)
- **Tipo de gráfico**: Gráfico circular o gráfico de barras horizontales
- **Excluir partidas**: Autocompletado de selección múltiple para excluir partidas específicas
- **Excluir cuentas**: Autocompletado de selección múltiple para excluir cuentas específicas
- **Centro de coste** y **Run o build**: Consulte [Filtros de centro de coste y de Run o build](#filtros-de-centro-de-coste-y-de-run-o-build)

### Qué verá

**Gráfico**: Gráfico circular o de barras horizontales de las partidas principales. Su título indica el tipo, por ejemplo "Top 10 CAPEX · Presupuesto 2026".

**Columnas de la tabla**:

- Partida
- Valor para la métrica y año seleccionados
- Participación en el total (porcentaje)

**Tarjetas de resumen debajo de la tabla**:

- **Total top N**, con su parte del total filtrado, por ejemplo «45 % del total filtrado»
- El total de la columna seleccionada en todas las partidas, con el nombre de la columna, por ejemplo **Presupuesto, total**

La nota al pie del gráfico da el mismo total, por ejemplo «Presupuesto, total: 1 234».

### Caso de uso

Utilice este informe para detectar rápidamente dónde va la mayor parte de su presupuesto IT e identificar candidatos para optimización de costes.

---

## Top aumento / disminución

Identifique los mayores cambios OPEX o CAPEX entre dos columnas presupuestarias (cualquier combinación de año y métrica).

### Controles

- **Tipo de partida**: OPEX o CAPEX (ver [Elegir OPEX o CAPEX](#elegir-opex-o-capex))
- **Año de origen** y **Métrica de origen**: La columna base de comparación
- **Año de destino** y **Métrica de destino**: La columna objetivo de comparación
- **Cantidad top**: Cuántas partidas mostrar por dirección (predeterminado: 10)
- **Tipo de gráfico**: Gráfico circular (solo una dirección) o gráfico de barras horizontales
- **Excluir partidas**: Autocompletado de selección múltiple para excluir partidas específicas
- **Excluir cuentas**: Autocompletado de selección múltiple para excluir cuentas específicas
- **Dirección**: pestañas **Aumentos**, **Disminuciones** o **Ambos**
- **Centro de coste** y **Run o build**: Consulte [Filtros de centro de coste y de Run o build](#filtros-de-centro-de-coste-y-de-run-o-build)

Los selectores de año muestran los años que contienen datos. Los selectores de métrica ofrecen las columnas presupuestarias visibles. El informe empieza en la columna por defecto del año pasado como origen y en la columna por defecto del año actual como destino.

Cuando se selecciona **Ambos**, la opción de gráfico circular se deshabilita y el informe cambia automáticamente a barras.

### Qué verá

**Gráfico**: Visualización de los principales cambios. Su título indica el tipo, por ejemplo "Top 10 aumentos OPEX".

**Columnas de la tabla**:

- Partida
- Valor de origen (anterior)
- Valor de destino (actual)
- Delta (cambio absoluto)
- Porcentaje de aumento

**Tarjetas de resumen debajo de la tabla**:

- Totales de la selección (importes de aumento y/o disminución, con sumas de origen/destino)
- Cambios brutos en todas las partidas (con porcentaje de cobertura)
- Aumento o disminución neto en todas las partidas

### Caso de uso

Utilice este informe para identificar sobrecostes, detectar oportunidades de ahorro y explicar la variación año a año en revisiones presupuestarias.

---

## Tendencia presupuestaria (OPEX)

Compare métricas OPEX en múltiples años en un solo gráfico de líneas.

### Controles

- **Año de inicio**: Inicio del rango (año actual menos 2 hasta más 2)
- **Año de fin**: Fin del rango
- **Métricas**: Selección múltiple entre las columnas presupuestarias visibles. El informe empieza en la columna por defecto y en la última columna visible (Presupuesto y Aterrizaje previsto con la configuración estándar). Si quita todas las métricas, se usa la columna por defecto
- **Centro de coste** y **Run o build**: Consulte [Filtros de centro de coste y de Run o build](#filtros-de-centro-de-coste-y-de-run-o-build)

### Qué verá

**Gráfico**: Gráfico de líneas con una serie por métrica seleccionada, trazada a lo largo del rango de años.

**Tabla**: Una fila por métrica seleccionada, con columnas de año mostrando totales.

### Exportar

- **Exportar tabla como CSV**
- **Exportar gráfico como PNG**
- **Imprimir / Guardar como PDF**

---

## Tendencia presupuestaria (CAPEX)

Diseño idéntico al informe de tendencia OPEX, pero extrae datos del presupuesto CAPEX.

### Controles

- **Año de inicio**, **Año de fin**, **Métricas**: Igual que el informe de tendencia OPEX
- **Centro de coste** y **Run o build**: Consulte [Filtros de centro de coste y de Run o build](#filtros-de-centro-de-coste-y-de-run-o-build)

### Qué verá

- Gráfico de líneas de totales CAPEX por métrica a lo largo de los años
- Tabla resumen con columnas de año

---

## Comparación de columnas presupuestarias

Compare de forma flexible hasta 10 combinaciones de año+columna para OPEX o CAPEX.

### Controles

- **Tipo de partida**: Conmutador OPEX o CAPEX
- **Selecciones**: Cada selección tiene un selector de año y un selector de columna con las columnas presupuestarias visibles. El informe empieza con dos selecciones: la columna por defecto del año actual y la del año siguiente. **Añadir** añade la columna por defecto del año actual, y el icono de borrar elimina una selección. Máximo de 10 selecciones; mínimo de 1.
- **Agrupación por año** (casilla): Cuando está habilitada y al menos dos años comparten una métrica, cambia a un gráfico de líneas agrupado con una serie por métrica y años en el eje X. Cuando está deshabilitada, muestra un gráfico de líneas plano con cada selección como punto de datos.
- **Centro de coste** y **Run o build**: Consulte [Filtros de centro de coste y de Run o build](#filtros-de-centro-de-coste-y-de-run-o-build)

### Qué verá

**Gráfico**:

- Modo predeterminado: Gráfico de líneas con cada selección en el eje X y su total en el eje Y
- Modo agrupación por año: Gráfico de líneas con años en el eje X y una línea por métrica

**Tabla**:

- Modo predeterminado: Etiqueta de selección, año, nombre de columna, total
- Modo agrupación por año: Columna de año, luego una columna por métrica con totales

### Exportar

- **Exportar tabla como CSV**
- **Exportar gráfico como PNG**
- **Imprimir / Guardar como PDF**

---

## Cuentas de consolidación

Vea datos presupuestarios OPEX o CAPEX agrupados por cuenta de consolidación, con el tipo de gráfico adaptándose al rango de años.

### Controles

- **Tipo de partida**: OPEX o CAPEX (ver [Elegir OPEX o CAPEX](#elegir-opex-o-capex))
- **Año de inicio** y **Año de fin**: Año anterior, actual o siguiente
- **Métrica**: Cualquier columna presupuestaria visible. Empieza en la columna por defecto
- **Tipo de gráfico**: Gráfico circular o de barras horizontales (solo disponible cuando se selecciona un solo año)
- **Excluir cuentas**: Autocompletado de selección múltiple para excluir cuentas específicas
- **Centro de coste** y **Run o build**: Consulte [Filtros de centro de coste y de Run o build](#filtros-de-centro-de-coste-y-de-run-o-build)

### Qué verá

**Modo un solo año**:

- Gráfico circular o de barras horizontales de totales por cuenta de consolidación
- Nota al pie con el total para la métrica seleccionada

**Modo varios años**:

- Gráfico de líneas con una serie por cuenta de consolidación, trazada a lo largo de los años

**Tabla**: Una fila por cuenta de consolidación con columnas de año. Una fila de totales fijada en la parte inferior suma todos los grupos.

Las partidas sin cuenta de consolidación aparecen como "Sin asignar".

---

## Dimensiones analíticas

Vea datos presupuestarios OPEX o CAPEX agrupados por dimensión analítica. El diseño es idéntico al informe de Cuentas de consolidación.

### Controles

- **Tipo de partida**: OPEX o CAPEX (ver [Elegir OPEX o CAPEX](#elegir-opex-o-capex))
- **Año de inicio** y **Año de fin**: Año anterior, actual o siguiente
- **Métrica**: Cualquier columna presupuestaria visible. Empieza en la columna por defecto
- **Tipo de gráfico**: Gráfico circular o de barras horizontales (solo un año)
- **Excluir dimensiones analíticas**: Autocompletado de selección múltiple para excluir dimensiones específicas
- **Centro de coste** y **Run o build**: Consulte [Filtros de centro de coste y de Run o build](#filtros-de-centro-de-coste-y-de-run-o-build)

### Qué verá

**Modo un solo año**:

- Gráfico circular o de barras de totales por dimensión analítica
- Nota al pie con el total de la métrica

**Modo varios años**:

- Gráfico de líneas con una serie por dimensión analítica

**Tabla**: Una fila por dimensión analítica con columnas de año. Una fila de totales fijada en la parte inferior. Las partidas sin dimensión analítica aparecen como "Sin asignar".

---

## Características comunes

Todos los informes comparten estas capacidades a través de la barra de herramientas compartida:

### Opciones de exportación

- **Exportar tabla como CSV** (icono de descarga): Descarga los datos de la tabla principal
- **Exportar gráfico como PNG** (icono de imagen): Descarga el gráfico como imagen PNG
- **Imprimir / Guardar como PDF** (icono de impresión): Abre el diálogo de impresión del navegador. También puede añadir `?print=1` a cualquier URL de informe para activar la impresión automáticamente al cargar.

Los nombres de los archivos exportados llevan el nombre de la columna, por ejemplo `top10-opex-2026-presupuesto-bar.png`.

### Métricas disponibles

Cada selector de métrica o de columna ofrece las mismas columnas presupuestarias: las que muestra su organización, con sus nombres. Con la configuración estándar son Presupuesto, Revisión, Realizado y Aterrizaje previsto. Previsión se ofrece cuando se muestra. Consulte [Columnas presupuestarias en los informes](#columnas-presupuestarias-en-los-informes).

### Navegación

Cada informe muestra una ruta de migas de pan de vuelta al centro de **Informes**, para que pueda cambiar entre informes rápidamente.

---

## Consejos

- **Empiece con el Contracargo global**: Obtenga una imagen general de las asignaciones antes de profundizar en una empresa.
- **Use Top partidas para victorias rápidas**: Las partidas de coste más grandes son sus primeros candidatos para optimización.
- **Compare Presupuesto vs Aterrizaje previsto**: Utilice el informe de Comparación de columnas presupuestarias para medir la precisión de la previsión entre años.
- **Alterne secciones en informes de contracargo**: Los controles de casilla le permiten centrarse solo en los datos que necesita (departamentos, partidas, KPI o flujos) sin ruido visual.
- **Agrupación por año en Comparación de columnas presupuestarias**: Al comparar la misma métrica en múltiples años, active la agrupación por año para un gráfico de líneas más limpio.
- **Exporte para presentaciones**: Los gráficos se exportan como PNG y las tablas como CSV, ambos listos para diapositivas u hojas de cálculo.
