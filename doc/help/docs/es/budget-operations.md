# Administración presupuestaria

La Administración presupuestaria le ofrece un conjunto de herramientas para gestionar y transformar datos presupuestarios entre años y columnas. Estas son las operaciones a las que recurre durante los ciclos de planificación presupuestaria: preparar las cifras del próximo año, bloquear presupuestos aprobados y gestionar las transiciones entre años.

## Dónde encontrarla

- Ruta: **Gestión presupuestaria > Administración**
- Permisos: La mayoría de operaciones requieren `budget_ops:admin`

La página principal muestra siete tarjetas, cada una enlazando a una herramienta dedicada:

| Herramienta | Propósito |
|-------------|-----------|
| **Congelar / Descongelar datos** | Bloquear columnas presupuestarias para prevenir cambios |
| **Copiar columnas presupuestarias** | Copiar datos entre años y columnas con ajustes |
| **Copiar asignaciones** | Copiar métodos de asignación de un año a otro |
| **Restablecer columna presupuestaria** | Borrar todos los datos de una columna específica |
| **Método de asignación por defecto** | Definir el método que las partidas de OPEX y CAPEX siguen por defecto |
| **Archivo de filas presupuestarias** | Exportar o importar los importes mensuales de cada partida OPEX y CAPEX |
| **Columnas presupuestarias** | Nombrar las cinco columnas presupuestarias, elegir cuáles se muestran y cuál es la columna por defecto |

Las columnas presupuestarias son Presupuesto, Revisión, Previsión, Realizado y Aterrizaje previsto. Son los nombres estándar. Su organización puede renombrarlas, ocultar algunas y elegir una columna por defecto en [Columnas presupuestarias](#columnas-presupuestarias). Cada página a continuación muestra los nombres que eligió su organización.

---

## Congelar / Descongelar datos

Bloquee columnas presupuestarias para que no puedan editarse, importarse ni modificarse de ninguna manera. La congelación protege las cifras aprobadas de cambios accidentales.

### Cuándo usarla

- Después de que el presupuesto anual sea aprobado
- Al cerrar un período fiscal
- Para proteger el realizado de modificaciones

### Cómo funciona

1. **Seleccione un año** del desplegable (rango: año actual menos uno hasta año actual más cuatro)
2. **Seleccione alcances**: marque **OPEX**, **CAPEX** o ambos
3. **Seleccione columnas** para cada alcance. La lista ofrece las cinco columnas. Las columnas ocultas llevan la marca **Oculta**. Todas las columnas están seleccionadas por defecto, así que congelar un año congela todas las columnas, también las ocultas. Desmarque una columna para dejarla fuera
4. Haga clic en **Congelar datos** para bloquear, o **Descongelar datos** para desbloquear. Ambos botones siguen deshabilitados mientras un alcance seleccionado no tenga ninguna columna marcada

### Qué hace la congelación

- Previene ediciones en columnas congeladas en los espacios de trabajo OPEX y CAPEX
- Bloquea importaciones CSV a columnas congeladas
- Bloquea operaciones de copia y restablecimiento dirigidas a columnas congeladas
- **No** afecta el acceso de lectura: los datos siguen siendo visibles
- También se aplica a las columnas ocultas. Una columna congelada sigue congelada cuando se oculta, y las importaciones en ella se siguen rechazando

### Congelar la columna por defecto fija los tipos de cambio

Congelar la [columna por defecto](#columnas-presupuestarias) de un año también fija los tipos de cambio de ese año para el alcance que congela. KANAP actualiza los tipos del año y luego conserva el último conjunto para cada importe OPEX o CAPEX de ese año. Los informes convierten entonces esos importes con los mismos tipos, aunque lleguen tipos más recientes. Descongelar la columna por defecto los libera.

Congelar otra columna no afecta a los tipos. Cambiar más tarde la columna por defecto no fija ni libera nada por sí solo: los tipos siguen la próxima congelación o descongelación de la nueva columna por defecto.

### Estado actual

Debajo de los controles, dos tarjetas muestran el estado de congelación en tiempo real de las cinco columnas en OPEX y CAPEX. Cada columna muestra **Congelado** (en rojo) o **Editable**. Las columnas ocultas llevan la marca **Oculta**.

### Permisos

Sin `budget_ops:admin` puede ver el estado de congelación, pero los controles están deshabilitados. Un banner indica «Solo los administradores de presupuesto pueden cambiar esta página.»

---

## Copiar columnas presupuestarias

Copie datos presupuestarios de un año y columna a otro, con un ajuste porcentual opcional. Esta es la herramienta principal para inicializar el presupuesto del próximo año a partir del actual.

El selector **OPEX** / **CAPEX** de la parte superior elige las partidas sobre las que se aplica la copia. OPEX está seleccionado por defecto si puede consultar las partidas OPEX; de lo contrario, CAPEX.

Requiere permisos de administración sobre OPEX, o sobre CAPEX para las partidas CAPEX.

### Cuándo usarla

- Preparar el presupuesto del próximo año a partir del actual
- Crear una revisión a partir del presupuesto aprobado
- Trasladar proyecciones con un factor de inflación

### Campos

| Campo | Descripción |
|-------|-------------|
| **Año de origen** | Año del que copiar (rango: año actual menos uno hasta año actual más cinco) |
| **Columna de origen** | Cualquier columna visible, incluida Previsión cuando se muestra. Empieza en la columna por defecto |
| **Año de destino** | Año al que copiar (mismo rango) |
| **Columna de destino** | Cualquier columna visible. Empieza en la columna por defecto |
| **Incremento porcentual** | Ajuste aplicado a cada mes copiado (p. ej., `3` = +3%). Predeterminado: 0. Acepta decimales y valores negativos. |
| **Sobrescribir datos existentes** | Conmutador. Cuando está desactivado, los elementos que ya tienen un valor en el destino se omiten. Cuando está activado, todos los valores de destino se reemplazan. |

La página se abre con la columna por defecto del año actual como origen y la columna por defecto del año siguiente como destino. Las columnas ocultas no se ofrecen.

### Proceso en dos pasos: Simulación, luego Copiar

1. Haga clic en **Simulación** para generar una vista previa sin cambiar ningún dato
2. Revise la cuadrícula de vista previa, que muestra:
   - Nombre de la **Partida** (las partidas marcadas como **Omitida** conservan su valor actual; las marcadas como **Prorrateada** empiezan o terminan durante el año de destino y solo reciben los meses dentro de su periodo de validez)
   - **Valor de origen** (del año/columna de origen)
   - **Valor actual de destino**
   - **Valor de vista previa** (lo que será el destino después de la copia)
3. Cuando esté satisfecho, haga clic en **Copiar datos** para aplicar

El botón **Copiar datos** solo se habilita después de una simulación exitosa.

### Estadísticas resumen

Debajo de la cuadrícula, una barra de estadísticas muestra:

- **Total de elementos** en el conjunto de datos
- **Elementos a procesar** (no omitidos)
- **Total de origen** (suma de valores de origen)
- **Total actual de destino**
- **Total de vista previa** (mostrado después de la simulación)

### Comportamiento de sobrescritura

| Sobrescribir | El destino tiene datos | Resultado |
|--------------|------------------------|-----------|
| Desactivado | Sí | Omitido |
| Desactivado | No (cero) | Copiado |
| Activado | Sí | Reemplazado |
| Activado | No (cero) | Copiado |

### Cómo se copian los importes

- La copia conserva el reparto mensual. Cada uno de los doce meses se copia al mismo mes del destino, de modo que una columna repartida de abril a diciembre sigue repartida de abril a diciembre
- Solo se copian las partidas válidas en el año de destino. Una partida cuenta para los meses cuyo día 15 cae entre su **Inicio de vigencia** y su **Fin de validez**. Una partida sin ninguno de esos meses se excluye, ya que la pestaña Presupuesto tampoco la muestra
- Una partida válida solo una parte del año de destino recibe únicamente esos meses. Los demás meses conservan su importe, y el periodo se ajusta a las fechas de la partida. Por ejemplo, un origen de doce meses copiado a una partida que termina el 30 de junio da de enero a junio
- Sin porcentaje, los importes se copian exactamente, al céntimo
- Con un porcentaje, cada mes se redondea a un importe entero. El total anual es el total de origen con el porcentaje aplicado, redondeado a un importe entero. La pequeña diferencia se asigna al último mes que tiene importe. Por ejemplo, 12.000 repartidos de abril a diciembre (1.333,33 al mes y 1.333,36 en diciembre) copiados con +2 % dan 1.360 al mes y 12.240 para el año
- El periodo de la columna se desplaza con la copia: de abril a diciembre de 2026 pasa a ser de abril a diciembre de 2027. Un periodo que termina el 29 de febrero termina el 28 de febrero en un año que no lo tiene
- Un origen sin periodo da un periodo de todo el año
- En la pestaña Presupuesto, la columna de destino muestra «Copiado de Presupuesto 2026 +2 %»
- Copiar una columna sobre sí misma (mismo año y misma columna) se rechaza
- La copia es de todo o nada: si una partida falla, no se guarda nada

### Copiar una columna calculada

Una columna calculada a partir de cantidad y precio lleva una receta: la base de cálculo, la cantidad, el precio unitario, el índice de precios, el calendario y **Cuenta como ETC**. Consulte [Calcular a partir de cantidad y precio](opex.md#calcular-a-partir-de-cantidad-y-precio).

- La copia lleva la receta del origen al destino tal cual: misma cantidad, mismo precio unitario, mismo índice y mismo calendario
- Los meses se copian como en cualquier otra columna. El porcentaje de incremento solo se aplica a los importes copiados. La receta no cambia, y el índice de precios nunca se aplica una segunda vez
- Una copia desde una columna sin receta elimina la receta de la columna de destino: después no tiene ninguna, y su ETC pasa a ser desconocido.
- En la pestaña Presupuesto, la columna de destino muestra «Copiado de Presupuesto 2026» con la receta en su información emergente, y **Recalcular** está disponible
- Para calcular el año de destino a partir de la receta, abra la pestaña Presupuesto de la línea y haga clic en **Recalcular**. El panel muestra primero lo que cambiaría. El calendario debe contener el año de destino: de lo contrario, Recalcular se rechaza, por ejemplo «Personal de la sede has no working days for 2027. Add them on the Working-day calendars page.»
- Para subir el precio del nuevo año, cambie el **Índice de precios (%)** en el panel antes de hacer clic en **Recalcular**

### Protección de columnas congeladas

Si la columna de destino está congelada, tanto **Simulación** como **Copiar datos** están deshabilitados. Un banner de error le indica que descongele primero.

---

## Copiar asignaciones

Copie métodos y porcentajes de asignación de un año a otro. Esto le ahorra tener que volver a introducir las configuraciones de contracargo al configurar un nuevo ejercicio fiscal.

El conmutador **OPEX** / **CAPEX** de la parte superior elige qué partidas se copian. Solo se copian las partidas válidas en el año de destino, con la misma regla que **Copiar columnas presupuestarias**. La copia es de todo o nada: si una partida falla, no se copia nada.

Requiere derechos de administración sobre OPEX, o sobre CAPEX para las partidas CAPEX.

### Cuándo usarla

- Preparar el presupuesto del próximo año con las mismas asignaciones de costes
- Trasladar las configuraciones de contracargo
- Configurar un nuevo ejercicio fiscal

### Campos

| Campo | Descripción |
|-------|-------------|
| **Año de origen** | Año del que copiar asignaciones (rango: año actual menos uno hasta año actual más cinco) |
| **Año de destino** | Año al que copiar asignaciones (mismo rango). Debe ser diferente del año de origen. |
| **Sobrescribir datos existentes** | Conmutador. Cuando está desactivado, los elementos que ya tienen asignaciones en el destino se omiten. |

### Proceso en dos pasos: Simulación, luego Copiar

1. Haga clic en **Simulación** para ver una vista previa
2. La cuadrícula de vista previa muestra cada partida OPEX o CAPEX con:
   - Nombre de la **Partida**
   - **Acción**: qué sucederá (Se copiará, Omitida – sin año de origen, Omitida – sin asignaciones en el origen, Omitida – el destino tiene datos, Error)
   - Método y etiqueta del **Origen**
   - Método y etiqueta del **Destino** actual
   - **Resultado tras la copia**: cómo quedará el destino
3. Haga clic en **Copiar datos** para aplicar

### Validación

- Los años de origen y destino deben ser diferentes. Si coinciden, aparece un banner de advertencia y ambos botones se deshabilitan.
- Cambiar cualquier filtro borra la vista previa, requiriendo una nueva simulación.

### Resumen

Después de una simulación, un banner muestra el conteo de elementos listos para copiar, omitidos y con errores. Si se omitieron elementos porque el destino ya tiene asignaciones, aparece una advertencia separada sugiriendo activar la sobrescritura.

---

## Restablecer columna presupuestaria

Borre todos los datos de una columna presupuestaria específica para un año determinado. Esta es una operación destructiva: utilícela cuando necesite comenzar de cero.

El selector **OPEX** / **CAPEX** de la parte superior elige las partidas que se borran. El restablecimiento pone a cero los doce meses de la columna y quita su periodo, así como su receta cuando la columna se calculó a partir de cantidad y precio. En la pestaña Presupuesto, la columna recibe entonces una nueva sugerencia a partir de las fechas de la partida. El restablecimiento abarca todas las partidas, incluidas aquellas cuyo fin de validez ya ha pasado. Es de todo o nada: si una partida falla, no se borra nada.

Requiere permisos de administración sobre OPEX, o sobre CAPEX para las partidas CAPEX.

Una columna cuyas partidas no tienen ningún importe también puede restablecerse: en ese caso solo se quitan los periodos de reparto, y la confirmación lo indica.

### Cuándo usarla

- Comenzar de nuevo con la planificación presupuestaria
- Corregir errores masivos de entrada de datos
- Borrar datos de prueba

### Campos

| Campo | Descripción |
|-------|-------------|
| **Año** | El ejercicio fiscal a borrar (rango: año actual menos uno hasta año actual más cinco) |
| **Columna presupuestaria** | Cualquier columna visible, incluida Previsión cuando se muestra. No hay ninguna columna preseleccionada: el campo indica **Elegir una columna** y **Borrar columna** sigue deshabilitado hasta que elija una |

### Vista previa

Antes de elegir una columna, una línea sustituye a la cuadrícula: «Elija una columna para ver los importes que contiene.» Una vez elegida la columna, una cuadrícula muestra cada partida OPEX o CAPEX y su valor actual en esa columna. Los importes que se borrarán aparecen en peso medio; los valores vacíos aparecen atenuados. Debajo de la cuadrícula aparecen tres estadísticas:

- **Total de elementos**
- **Partidas con un total distinto de cero**
- **Valor total actual**

### Confirmación

Al hacer clic en **Borrar columna** se abre un diálogo de confirmación que muestra:

- La columna y año que se restablecerán
- El número de elementos afectados
- El valor total que se eliminará
- Una advertencia clara de que esta acción no se puede deshacer

Debe hacer clic en **Borrar columna** en el diálogo para proceder, o **Cancelar** para abortar.

### Medidas de seguridad

- El botón **Borrar columna** sigue disponible cuando ninguna partida tiene importe, para poder quitar igualmente los periodos de reparto
- No hay ninguna columna preseleccionada, así que siempre elige usted la columna que se borra
- Las columnas congeladas no pueden restablecerse. Descongélelas primero
- El diálogo de confirmación requiere reconocimiento explícito

---

## Método de asignación por defecto

Defina el método que siguen las partidas de OPEX y las inversiones de CAPEX cuando se dejan en la asignación por defecto. La configuración es por ejercicio: cada año resuelve su propio valor por defecto, por lo que puede cambiar la base de un año sin tocar los demás.

### Cuándo usarla

- Su modelo de contracargo no se basa en la plantilla (por ejemplo, se guía por la facturación)
- El presupuesto de IT lo asume una sola entidad y no debe repartirse entre todas las filiales
- Desea que las nuevas partidas sigan una base compartida sin editarlas una por una
- Está preparando un ejercicio cuya base de asignación difiere de la anterior

### Campos

| Campo | Descripción |
|-------|-------------|
| **Ejercicio** | El año al que se aplica la configuración (rango: año actual menos uno hasta año actual más cinco) |
| **Sociedades** | **Todas las sociedades activas** (por defecto): el coste se reparte entre todas las sociedades activas del año. **Sociedades seleccionadas**: el reparto se restringe a las sociedades que elija |
| **Método por defecto** | El generador que pondera las sociedades: Plantilla, Usuarios IT o Facturación |

### Cómo funciona

1. **Seleccione un año**
2. **Elija el ámbito de sociedades**: *Todas las sociedades activas*, o *Sociedades seleccionadas* y después las sociedades concretas
3. **Elija el generador** que pondera las sociedades (Plantilla, Usuarios IT o Facturación)
4. Cada cambio se guarda inmediatamente, no hay botón Guardar
5. Para volver al método estándar, haga clic en **Volver al método estándar** (solo se muestra mientras haya un valor por defecto personalizado configurado)

### Sociedades seleccionadas

- El generador se aplica únicamente a las sociedades seleccionadas: sus porcentajes se calculan a partir de su propia plantilla, sus usuarios IT o su facturación del año
- La página muestra el reparto resultante, para que pueda comprobar el efecto antes de confiar en él
- Una sola sociedad seleccionada siempre asume el **100%**, sin necesidad de un valor del generador
- A partir de dos sociedades, cada sociedad seleccionada necesita un valor para el generador elegido. Una sociedad sin valor se rechaza al guardar. Corrija primero las métricas de la sociedad en **Datos maestros > Empresas**
- Una sociedad desactivada para el año no se puede seleccionar: las sociedades desactivadas quedan excluidas de las asignaciones de ese año

### Qué afecta

- Todas las partidas de OPEX y las inversiones de CAPEX cuyo método de asignación sea **por defecto**, mostradas como *Plantilla (por defecto)* (o *Por defecto (n sociedades)*) en la pestaña Asignaciones hasta que se defina un valor por defecto para la organización
- Las partidas con un método explícito (Plantilla, Usuarios IT o Facturación fijados en la partida) o una asignación manual conservan su propia configuración
- Los importes asignados se recalculan la próxima vez que se muestren las asignaciones. Los importes presupuestarios en sí nunca se modifican

### Método estándar

Mientras una organización no configure un valor por defecto, se aplica el método estándar: **Plantilla** sobre todas las sociedades activas del año. La página siempre indica si el año usa el método estándar o un valor por defecto configurado, y cuál es el método estándar.

### Cambiar el valor por defecto a posteriori

El valor por defecto se resuelve cada vez que se muestran las asignaciones, por lo que editarlo recalcula todas las partidas que siguen en el valor por defecto. Si una sociedad incluida en la selección pierde después su valor de generador o se desactiva, las partidas afectadas muestran un error en lugar de un reparto reequilibrado en silencio. La página le advierte de los problemas con la selección actual.

### Permisos

Sin `budget_ops:admin`, puede consultar la configuración actual pero no cambiarla.

---

## Archivo de filas presupuestarias

Exporte o importe los importes mensuales de cada partida OPEX y CAPEX en un solo archivo, con una fila por partida, año y columna.

### Cuándo usarlo

- Cargar presupuestos mensuales preparados en una hoja de cálculo
- Importar el realizado mensual desde su sistema contable
- Revisar o archivar todas las columnas, incluida la Previsión

### Exportación

1. Elija un año, o mantenga **Todos los años**
2. Haga clic en **Exportar** y luego en **Exportar datos**

El archivo incluye cada partida OPEX y CAPEX que puede consultar, para cada año que tiene importes. Cada partida y año recibe cinco filas, una por columna presupuestaria en el orden fijo (Presupuesto, Revisión, Previsión, Realizado, Aterrizaje previsto con sus nombres estándar). Las columnas sin importes y las columnas ocultas también se incluyen.

Bajo la introducción, la página indica qué nombre técnico del archivo corresponde a cada una de sus columnas, por ejemplo «`planned` para Presupuesto». Los mismos nombres técnicos aparecen como **En los archivos** en la página [Columnas presupuestarias](#columnas-presupuestarias). Cuando el archivo cubre un solo año, o solo OPEX o solo CAPEX debido a sus permisos, su nombre termina en `partial`.

Se puede importar un archivo de hasta 10 MB. Para un presupuesto más grande, exporte e importe un año cada vez: una exportación limitada a un año genera un archivo más pequeño.

### Columnas

El archivo usa el punto y coma `;` como separador y la codificación UTF-8.

| Columna | Contenido |
|---------|-----------|
| `item_type` | `opex` o `capex` |
| `item_number` | El número de la partida, por ejemplo `7`. Al importar, la referencia también funciona (`OPX-7`, `CPX-7`) |
| `year` | Cuatro dígitos |
| `measure` | La columna, por su nombre técnico, sea cual sea el nombre que le da su organización: `planned` (columna 1, nombre estándar Presupuesto), `committed` (columna 2, Revisión), `forecast` (columna 3, Previsión), `actual` (columna 4, Realizado), `expected_landing` (columna 5, Aterrizaje previsto). Al importar, `budget`, `revision`, `follow_up` y `landing` también funcionan |
| `period_start`, `period_end` | El periodo de la columna en formato `YYYY-MM-DD`, dentro del año de la fila. Al importar, ambos vacíos significan todo el año |
| `jan` a `dec` | Los doce importes mensuales, con un punto como separador decimal. Al importar, también se aceptan la coma y los espacios |
| `method` | Cómo se produjo la columna: `spread`, `copied`, `manual` o `computed`. Solo informativo, se ignora al importar |
| `pricing_basis` a `counts_as_fte` | Las seis columnas de cálculo. Consulte [Columnas de cálculo](#columnas-de-calculo) |

### Reglas de importación

1. Haga clic en **Importar**, elija el archivo y ejecute la **Verificación previa**
2. Revise el informe y luego haga clic en **Cargar**

- Todo el archivo se verifica antes de guardar nada. Si una fila tiene un error, no se guarda nada y el informe lista los errores por número de línea
- Cada fila reemplaza los doce meses de su partida, año y columna. Las partidas, años y columnas que no están en el archivo no se modifican
- Los doce meses son obligatorios. Escriba `0` para un mes sin importe
- Una fila idéntica a lo guardado no se modifica, incluida la forma en que se produjo la columna. Volver a importar una exportación no cambia nada
- Una fila cuyos importes cambian marca la columna como **Editado a mano**, con el periodo del archivo
- Una fila que solo cambia el periodo actualiza el periodo y conserva el resto
- Las filas de Realizado siguen las mismas reglas, lo que permite importar el realizado mensual
- Una fila modificada en una columna congelada se rechaza. Una fila idéntica en una columna congelada se acepta
- Las filas de una columna oculta se importan como cualquier otra fila. Ocultar una columna nunca bloquea sus importaciones, y una columna oculta congelada sigue rechazando las filas modificadas
- Las filas repetidas (misma partida, año y columna), los números de partida desconocidos y las partidas de un tipo que no puede administrar son errores
- Importar requiere permisos de administración sobre OPEX o sobre CAPEX. Exportar requiere acceso de lectura a uno de los dos

### Columnas de cálculo

Las columnas de cálculo contienen la receta de una columna calculada a partir de cantidad y precio. Consulte [Calcular a partir de cantidad y precio](opex.md#calcular-a-partir-de-cantidad-y-precio). La exportación y la plantilla siempre las escriben, completas cuando la columna tiene una receta y vacías en caso contrario.

| Columna | Contenido |
|---------|-----------|
| `pricing_basis` | `per_day` (Por día), `per_month` (Por mes) o `per_period` (Para todo el periodo). No distingue mayúsculas y minúsculas |
| `quantity` | Cero o más, hasta 3 decimales. Obligatoria con una base de cálculo |
| `unit_price` | Hasta 4 decimales. Se acepta un precio negativo, para un abono. Obligatoria con una base de cálculo |
| `price_index_pct` | El índice de precios en porcentaje, por ejemplo `3` para +3 %. Hasta 4 decimales, no inferior a -100. Vacía significa 0 |
| `working_day_profile_code` | El código de un calendario laboral. Obligatoria con `per_day`, y solo con ella. Se empareja sin distinguir mayúsculas y minúsculas |
| `counts_as_fte` | `true` o `false` (`yes`, `no`, `1` y `0` también funcionan). Vacía significa `false` |

Las columnas de cálculo son opcionales al importar: indique las seis o ninguna. Un archivo sin ellas se importa como antes, y se conservan todas las recetas guardadas.

Con las columnas de cálculo, cada fila entra en uno de tres casos:

1. **Los doce meses indicados**: los meses se guardan tal cual, y las celdas de cálculo de la fila pasan a ser la receta de la columna. Las celdas de cálculo vacías quitan la receta. Cuando los meses cambian, la columna se marca como **Editado a mano**. Cuando solo cambia la receta de una columna calculada, la columna también se marca como **Editado a mano**: sus meses ya no proceden de su receta
2. **Ningún mes indicado, con una receta**: los meses se calculan a partir de la receta sobre el periodo de la fila (todo el año cuando el periodo está vacío), exactamente como hace **Calcular** en la pestaña Presupuesto. La columna se marca como calculada. Una fila cuyos meses calculados, periodo y receta coinciden con lo guardado cuenta como sin cambios
3. **Algunos meses indicados**: la fila se rechaza. Indique los doce meses o ninguno

Todos los cálculos se ejecutan durante la verificación previa, de modo que una verificación previa correcta carga sin sorpresas. Volver a importar una exportación no cambia nada, incluidas las columnas calculadas.

**Errores frecuentes**:

- **"Give all twelve months, or none to compute them from quantity and price."**: la fila solo indica algunos meses
- **"Give all twelve months, or a pricing basis with quantity and unit price."**: la fila no indica ningún mes ni una receta completa
- **"Give the code of a working-day calendar for a price per day."**: complete `working_day_profile_code`
- **"A calendar is used only with a price per day."**: vacíe `working_day_profile_code`, o cambie la base de cálculo a `per_day`
- **"No working-day calendar has the code '...'."**: cree el calendario en **Datos maestros > Calendarios laborales** o corrija el código
- **"... is disabled. Pick an enabled calendar."**: un calendario desactivado se mantiene en las columnas que ya lo usan y no se puede asignar a otra
- **"... has no working days for 2027. Add them on the Working-day calendars page."**: añada el año al calendario y vuelva a ejecutar la verificación previa
- **"counts_as_fte '...' is not understood. Use true or false."**: corrija la celda
- **"Header mismatch"**: faltan algunas columnas de cálculo. Indique las seis o quítelas todas

---

## Columnas presupuestarias

Dé nombre a las cinco columnas presupuestarias, elija cuáles ve todo el mundo y de cuál parten los informes y las listas. La configuración se aplica a toda la organización, tanto para OPEX como para CAPEX.

### Cuándo usarla

- Sus rondas presupuestarias tienen nombres propios, por ejemplo A0, A1, A2 y Real
- Su organización no usa todas las columnas y quiere una pantalla más ligera
- Los informes y las listas deben partir de una columna distinta de Presupuesto

### La tabla

Una fila por columna, siempre en el mismo orden, de la columna 1 a la columna 5. Los nombres estándar son Presupuesto, Revisión, Previsión, Realizado y Aterrizaje previsto.

| Campo | Descripción |
|-------|-------------|
| **Columna** | La posición, de 1 a 5. Las columnas no se pueden reordenar |
| **Nombre** | El nombre que todos ven en las listas, la pestaña Presupuesto, los informes, el panel y la Administración presupuestaria. Déjelo vacío para usar el nombre estándar, que aparece como marcador. Como máximo 40 caracteres, sin caracteres de control ni invisibles. Cada nombre debe ser distinto de los nombres de las demás columnas, incluido el nombre estándar de una columna que no ha renombrado, sin importar las mayúsculas |
| **En los archivos** | La línea bajo cada nombre. Indica el nombre técnico de la columna en el archivo de filas presupuestarias y sus importaciones, por ejemplo `planned` para la columna 1. Nunca cambia cuando renombra una columna |
| **Visible** | Si la columna aparece en pantalla. Al menos una columna debe seguir visible |
| **Sigue «Aplicar a todas las columnas»** | Si la columna toma el mismo periodo cuando un reparto de la pestaña Presupuesto se aplica a todas las columnas. Una columna que no lo sigue conserva su propio periodo y, cuando la reparte, se reparte sola |
| **Por defecto** | La columna que preseleccionan los informes y que ordena las listas y el panel. Congelarla fija los tipos de cambio del año. La columna por defecto debe estar visible |

Los encabezados **Sigue «Aplicar a todas las columnas»** y **Por defecto** llevan un icono de información. Pase el ratón por encima, o lleve el foco del teclado hasta él, para leer la misma explicación en la página.

Por defecto, Presupuesto, Revisión, Realizado y Aterrizaje previsto están visibles y Previsión está oculta, todas las columnas siguen «Aplicar a todas las columnas» y Presupuesto es la columna por defecto.

### Qué cambia la configuración

- **Las columnas ocultas** desaparecen de las listas, del selector de columnas, de la pestaña Presupuesto, de los selectores de los informes, de las páginas de copia y de restablecimiento y del panel. Conservan sus importes: ocultar una columna nunca borra datos, y volver a mostrarla recupera los importes. Las columnas ocultas siguen aceptando importaciones mediante el archivo de filas presupuestarias, y las congelaciones se les siguen aplicando. La página de congelación también muestra las columnas ocultas, con la marca **Oculta**, así que congelar un año las congela junto con las demás
- **La columna por defecto** está preseleccionada en todos los informes. Ordena las listas OPEX y CAPEX, su navegación anterior y siguiente, y los mosaicos **Top partidas** y **Mayores incrementos** del panel. Las listas la muestran para el año actual, junto a la última columna visible. También es el importe de referencia de la pestaña Asignaciones y la columna en la que se abre el panel de reparto. Congelarla para un año fija los tipos de cambio de ese año (consulte [Congelar la columna por defecto fija los tipos de cambio](#congelar-la-columna-por-defecto-fija-los-tipos-de-cambio))
- **Sigue «Aplicar a todas las columnas»** decide qué columnas se mueven juntas cuando un reparto se aplica a todas las columnas. Las columnas congeladas nunca cambian, diga lo que diga esta configuración

### Guardar

Haga clic en **Guardar** para aplicar sus cambios. El botón sigue deshabilitado hasta que algo cambie y todos los nombres sean válidos. **Restablecer** descarta los cambios que aún no ha guardado. Los errores se explican bajo el campo o bajo la tabla, por ejemplo «Al menos una columna debe seguir visible.» o «La columna por defecto debe estar visible: elija antes otra columna por defecto.» Para ocultar la columna por defecto actual, elija antes otra columna por defecto. Ambos cambios se pueden guardar a la vez.

### Permisos

Cambiar la configuración requiere derechos de administración de la Administración presupuestaria (`budget_ops:admin`). Los demás usuarios pueden abrir la página y ver la configuración en modo de solo lectura, bajo el banner «Solo los administradores de presupuesto pueden cambiar esta página.»

Si la configuración no se puede cargar, la página muestra una sola línea, «No se pudo cargar la configuración de las columnas.», y ningún control.

---

## Ejemplo de flujo de trabajo: Ciclo presupuestario anual

A continuación se muestra una secuencia típica usando estas herramientas, con los nombres de columna estándar y Presupuesto como columna por defecto:

### 1. Fin del año N

1. Congelar el realizado del Año N (proteger datos históricos)
2. Copiar Presupuesto N a Presupuesto N+1 (con un porcentaje de aumento por inflación)
3. Copiar asignaciones de N a N+1

### 2. Durante la planificación presupuestaria (N+1)

1. Los equipos editan la columna Presupuesto N+1
2. El director financiero revisa y aprueba

### 3. Aprobación del presupuesto

1. Congelar el Presupuesto N+1 (bloquear el presupuesto aprobado y fijar los tipos de cambio del año)
2. Copiar Presupuesto N+1 a Revisión N+1 (punto de partida para el seguimiento intra-anual)

### 4. Revisión a mitad de año

1. Los equipos actualizan la Revisión N+1 con cambios de previsión
2. Cuando se finaliza, congelar la Revisión N+1

---

## Consejos

- **Siempre haga una simulación primero**: Copiar columnas presupuestarias y Copiar asignaciones admiten simulación. Úsela cada vez para verificar el resultado antes de confirmar.
- **Congele después de la aprobación**: Bloquear columnas después de la aprobación mantiene su registro de auditoría y previene ediciones accidentales.
- **Use ajustes porcentuales**: Al copiar entre años, aplique un factor de inflación o crecimiento para no tener que ajustar cada línea manualmente.
- **Verifique el estado de congelación antes de operaciones masivas**: Las columnas congeladas bloquean las operaciones de copia y restablecimiento. Si un botón está en gris, verifique primero la página de congelación.
- **Defina el valor por defecto del año antes de introducir presupuestos**: Si su base de asignación no es la plantilla, configúrela primero en Método de asignación por defecto, para que las partidas se creen sobre la base correcta en lugar de recalcularse después.
- **Restablezca con precaución**: El restablecimiento de columna es irreversible. Compruebe el año y la columna antes de confirmar.
