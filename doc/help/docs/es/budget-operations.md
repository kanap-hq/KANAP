# Administración presupuestaria

La Administración presupuestaria le ofrece un conjunto de herramientas para gestionar y transformar datos presupuestarios entre años y columnas. Estas son las operaciones a las que recurre durante los ciclos de planificación presupuestaria -- preparar las cifras del próximo año, bloquear presupuestos aprobados y gestionar las transiciones entre años.

## Dónde encontrarla

- Ruta: **Gestión presupuestaria > Administración**
- Permisos: La mayoría de operaciones requieren `budget_ops:admin`

La página principal muestra seis tarjetas, cada una enlazando a una herramienta dedicada:

| Herramienta | Propósito |
|-------------|-----------|
| **Congelar / Descongelar datos** | Bloquear columnas presupuestarias para prevenir cambios |
| **Copiar columnas presupuestarias** | Copiar datos entre años y columnas con ajustes |
| **Copiar asignaciones** | Copiar métodos de asignación de un año a otro |
| **Restablecer columna presupuestaria** | Borrar todos los datos de una columna específica |
| **Método de asignación por defecto** | Definir el método que las partidas de OPEX y CAPEX siguen por defecto |
| **Archivo de filas presupuestarias** | Exportar o importar los importes mensuales de cada partida OPEX y CAPEX |

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
3. **Seleccione columnas** para cada alcance: Presupuesto, Revisión, Previsión, Realizado, Aterrizaje previsto (las cinco están seleccionadas por defecto)
4. Haga clic en **Congelar datos** para bloquear, o **Descongelar datos** para desbloquear

### Qué hace la congelación

- Previene ediciones en columnas congeladas en los espacios de trabajo OPEX y CAPEX
- Bloquea importaciones CSV a columnas congeladas
- Bloquea operaciones de copia y restablecimiento dirigidas a columnas congeladas
- **No** afecta el acceso de lectura -- los datos siguen siendo visibles

### Estado actual

Debajo de los controles, dos tarjetas muestran el estado de congelación en tiempo real para cada columna en OPEX y CAPEX. Cada columna muestra **Congelado** (en rojo) o **Editable**.

### Permisos

Sin `budget_ops:admin` puede ver el estado de congelación, pero los controles están deshabilitados. Un banner informativo explica qué se necesita.

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
| **Columna de origen** | Presupuesto, Revisión, Realizado o Aterrizaje previsto |
| **Año de destino** | Año al que copiar (mismo rango) |
| **Columna de destino** | Presupuesto, Revisión, Realizado o Aterrizaje previsto |
| **Incremento porcentual** | Ajuste aplicado a cada mes copiado (p. ej., `3` = +3%). Predeterminado: 0. Acepta decimales y valores negativos. |
| **Sobrescribir datos existentes** | Conmutador. Cuando está desactivado, los elementos que ya tienen un valor en el destino se omiten. Cuando está activado, todos los valores de destino se reemplazan. |

### Proceso en dos pasos: Simulación, luego Copiar

1. Haga clic en **Simulación** para generar una vista previa sin cambiar ningún dato
2. Revise la cuadrícula de vista previa, que muestra:
   - Nombre de la **Partida** (las partidas marcadas como **Omitida** conservan su valor actual)
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
- Sin porcentaje, los importes se copian exactamente, al céntimo
- Con un porcentaje, cada mes se redondea a un importe entero. El total anual es el total de origen con el porcentaje aplicado, redondeado a un importe entero. La pequeña diferencia se asigna al último mes que tiene importe. Por ejemplo, 12.000 repartidos de abril a diciembre (1.333,33 al mes y 1.333,36 en diciembre) copiados con +2 % dan 1.360 al mes y 12.240 para el año
- El periodo de la columna se desplaza con la copia: de abril a diciembre de 2026 pasa a ser de abril a diciembre de 2027. Un periodo que termina el 29 de febrero termina el 28 de febrero en un año que no lo tiene
- Un origen sin periodo da un periodo de todo el año
- En la pestaña Presupuesto, la columna de destino muestra «Copiado de Presupuesto 2026 +2 %»
- Copiar una columna sobre sí misma (mismo año y misma columna) se rechaza
- La copia es de todo o nada: si una partida falla, no se guarda nada

### Protección de columnas congeladas

Si la columna de destino está congelada, tanto **Simulación** como **Copiar datos** están deshabilitados. Un banner de error le indica que descongele primero.

---

## Copiar asignaciones

Copie métodos y porcentajes de asignación de un año a otro para todas las partidas OPEX. Esto le ahorra tener que volver a introducir las configuraciones de contracargo al configurar un nuevo ejercicio fiscal.

### Cuándo usarla

- Preparar el presupuesto del próximo año con las mismas asignaciones de costes
- Trasladar las configuraciones de contracargo
- Configurar un nuevo ejercicio fiscal

### Campos

| Campo | Descripción |
|-------|-------------|
| **Año de origen** | Año del que copiar asignaciones (rango: año actual menos uno hasta año actual más cinco) |
| **Año de destino** | Año al que copiar asignaciones (mismo rango). Debe ser diferente del Año de origen. |
| **Sobrescribir datos existentes** | Conmutador. Cuando está desactivado, los elementos que ya tienen asignaciones en el destino se omiten. |

### Proceso en dos pasos: Simulación, luego Copiar

1. Haga clic en **Simulación** para ver una vista previa
2. La cuadrícula de vista previa muestra cada partida OPEX con:
   - Nombre del **Producto**
   - **Acción** -- qué sucederá (Se copiará, Omitir -- sin año de origen, Omitir -- sin asignaciones en origen, Omitir -- el destino tiene datos, Error)
   - Método y etiqueta del **Origen**
   - Método y etiqueta del **Destino** actual
   - **Resultado después de copiar** -- cómo quedará el destino
3. Haga clic en **Copiar datos** para aplicar

### Validación

- Los años de origen y destino deben ser diferentes. Si coinciden, aparece un banner de advertencia y ambos botones se deshabilitan.
- Cambiar cualquier filtro borra la vista previa, requiriendo una nueva simulación.

### Resumen

Después de una simulación, un banner muestra el conteo de elementos listos para copiar, omitidos y con errores. Si se omitieron elementos porque el destino ya tiene asignaciones, aparece una advertencia separada sugiriendo activar la sobrescritura.

---

## Restablecer columna presupuestaria

Borre todos los datos de una columna presupuestaria específica para un año determinado. Esta es una operación destructiva: utilícela cuando necesite comenzar de cero.

El selector **OPEX** / **CAPEX** de la parte superior elige las partidas que se borran. El restablecimiento pone a cero los doce meses de la columna y quita su periodo. En la pestaña Presupuesto, la columna recibe entonces una nueva sugerencia a partir de las fechas de la partida. El restablecimiento es de todo o nada: si una partida falla, no se borra nada.

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
| **Columna presupuestaria** | Presupuesto, Revisión, Realizado o Aterrizaje previsto |

### Vista previa

La página carga una cuadrícula mostrando cada partida OPEX o CAPEX y su valor actual en la columna seleccionada. Los importes que se borrarán aparecen en peso medio; los valores vacíos aparecen atenuados. Debajo de la cuadrícula aparecen tres estadísticas:

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
- Las columnas congeladas no pueden restablecerse -- descongele primero
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
2. **Elija el ámbito de sociedades** -- *Todas las sociedades activas*, o *Sociedades seleccionadas* y después las sociedades concretas
3. **Elija el generador** que pondera las sociedades (Plantilla, Usuarios IT o Facturación)
4. Cada cambio se guarda inmediatamente, no hay botón Guardar
5. Para volver al método estándar, haga clic en **Volver al método estándar** (solo se muestra mientras haya un valor por defecto personalizado configurado)

### Sociedades seleccionadas

- El generador se aplica únicamente a las sociedades seleccionadas: sus porcentajes se calculan a partir de su propia plantilla, sus usuarios IT o su facturación del año
- La página muestra el reparto resultante, para que pueda comprobar el efecto antes de confiar en él
- Una sola sociedad seleccionada siempre asume el **100%**, sin necesidad de un valor del generador
- A partir de dos sociedades, cada sociedad seleccionada necesita un valor para el generador elegido. Una sociedad sin valor se rechaza al guardar -- corrija primero las métricas de la sociedad en **Datos maestros > Empresas**
- Una sociedad desactivada para el año no se puede seleccionar: las sociedades desactivadas quedan excluidas de las asignaciones de ese año

### Qué afecta

- Todas las partidas de OPEX y las inversiones de CAPEX cuyo método de asignación sea **por defecto** -- mostradas como *Plantilla (por defecto)* (o *Por defecto (n sociedades)*) en la pestaña Asignaciones hasta que se defina un valor por defecto para la organización
- Las partidas con un método explícito (Plantilla, Usuarios IT o Facturación fijados en la partida) o una asignación manual conservan su propia configuración
- Los importes asignados se recalculan la próxima vez que se muestren las asignaciones. Los importes presupuestarios en sí nunca se modifican

### Método estándar

Mientras una organización no configure un valor por defecto, se aplica el método estándar: **Plantilla** sobre todas las sociedades activas del año. La página siempre indica si el año usa el método estándar o un valor por defecto configurado, y cuál es el método estándar.

### Cambiar el valor por defecto a posteriori

El valor por defecto se resuelve cada vez que se muestran las asignaciones, por lo que editarlo recalcula todas las partidas que siguen en el valor por defecto. Si una sociedad incluida en la selección pierde después su valor de generador o se desactiva, las partidas afectadas muestran un error en lugar de un reparto reequilibrado en silencio -- la página le advierte de los problemas con la selección actual.

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

El archivo incluye cada partida OPEX y CAPEX que puede consultar, para cada año que tiene importes. Cada partida y año recibe cinco filas, en este orden: Presupuesto, Revisión, Previsión, Realizado, Aterrizaje previsto. Las columnas sin importes también se incluyen. Cuando el archivo cubre un solo año, o solo OPEX o solo CAPEX debido a sus permisos, su nombre termina en `partial`.

Se puede importar un archivo de hasta 10 MB. Para un presupuesto más grande, exporte e importe un año cada vez: una exportación limitada a un año genera un archivo más pequeño.

### Columnas

El archivo usa el punto y coma `;` como separador y la codificación UTF-8.

| Columna | Contenido |
|---------|-----------|
| `item_type` | `opex` o `capex` |
| `item_number` | El número de la partida, por ejemplo `7`. Al importar, la referencia también funciona (`OPX-7`, `CPX-7`) |
| `year` | Cuatro dígitos |
| `measure` | La columna: `planned` (Presupuesto), `committed` (Revisión), `forecast` (Previsión), `actual` (Realizado), `expected_landing` (Aterrizaje previsto). Al importar, `budget`, `revision`, `follow_up` y `landing` también funcionan |
| `period_start`, `period_end` | El periodo de la columna en formato `YYYY-MM-DD`, dentro del año de la fila. Al importar, ambos vacíos significan todo el año |
| `jan` a `dec` | Los doce importes mensuales, con un punto como separador decimal. Al importar, también se aceptan la coma y los espacios |
| `method` | Cómo se produjo la columna: `spread`, `copied` o `manual`. Solo informativo, se ignora al importar |

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
- Las filas repetidas (misma partida, año y columna), los números de partida desconocidos y las partidas de un tipo que no puede administrar son errores
- Importar requiere permisos de administración sobre OPEX o sobre CAPEX. Exportar requiere acceso de lectura a uno de los dos

---

## Ejemplo de flujo de trabajo: Ciclo presupuestario anual

A continuación se muestra una secuencia típica usando estas herramientas:

### 1. Fin del año N

1. Congelar el realizado del Año N (proteger datos históricos)
2. Copiar Presupuesto N a Presupuesto N+1 (con un porcentaje de aumento por inflación)
3. Copiar asignaciones de N a N+1

### 2. Durante la planificación presupuestaria (N+1)

1. Los equipos editan la columna Presupuesto N+1
2. El director financiero revisa y aprueba

### 3. Aprobación del presupuesto

1. Congelar el Presupuesto N+1 (bloquear el presupuesto aprobado)
2. Copiar Presupuesto N+1 a Revisión N+1 (punto de partida para el seguimiento intra-anual)

### 4. Revisión a mitad de año

1. Los equipos actualizan la Revisión N+1 con cambios de previsión
2. Cuando se finaliza, congelar la Revisión N+1

---

## Consejos

- **Siempre haga una simulación primero**: Copiar columnas presupuestarias y Copiar asignaciones admiten simulación. Úsela cada vez para verificar el resultado antes de confirmar.
- **Congele después de la aprobación**: Bloquear columnas después de la aprobación mantiene su registro de auditoría y previene ediciones accidentales.
- **Use ajustes porcentuales**: Al copiar entre años, aplique un factor de inflación o crecimiento para no tener que ajustar cada línea manualmente.
- **Verifique el estado de congelación antes de operaciones masivas**: Las columnas congeladas bloquean las operaciones de copia y restablecimiento. Si un botón está en gris, verifique la página de Congelación primero.
- **Defina el valor por defecto del año antes de introducir presupuestos**: Si su base de asignación no es la plantilla, configúrela primero en Método de asignación por defecto, para que las partidas se creen sobre la base correcta en lugar de recalcularse después.
- **Restablezca con precaución**: El restablecimiento de columna es irreversible. Compruebe el año y la columna antes de confirmar.
