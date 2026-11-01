# Administración presupuestaria

La Administración presupuestaria le ofrece un conjunto de herramientas para gestionar y transformar datos presupuestarios entre años y columnas. Estas son las operaciones a las que recurre durante los ciclos de planificación presupuestaria: preparar las cifras del próximo año, bloquear presupuestos aprobados y gestionar las transiciones entre años.

## Dónde encontrarla

- Ruta: **Gestión presupuestaria > Administración**
- Permisos: cada tarjeta se muestra solo a los usuarios que pueden usarla (consulte la tabla a continuación). **Administración** aparece en el menú cuando puede usar al menos una tarjeta.

La página principal tiene dos secciones. Cada tarjeta enlaza a una herramienta dedicada. Una sección vacía se oculta.

**Configuración**

| Herramienta | Propósito |
|-------------|-----------|
| **Monedas** | Definir las monedas de reporting y predeterminadas, y consultar los tipos de cambio. Consulte [Configuración de monedas](currencies.md) |
| **Columnas presupuestarias** | Nombrar las cinco columnas presupuestarias, elegir cuáles se muestran y cuál es la columna por defecto |
| **Método de asignación por defecto** | Definir el método que las líneas de OPEX y CAPEX siguen por defecto |

**Operaciones**

| Herramienta | Propósito |
|-------------|-----------|
| **Congelar / descongelar datos** | Bloquear columnas presupuestarias para prevenir cambios |
| **Copiar columnas presupuestarias** | Copiar importes entre años y columnas, con un porcentaje opcional, y asignaciones a otro año |
| **Restablecer columna presupuestaria** | Borrar todos los datos de una columna específica |
| **Congelar datos maestros** | Bloquear los indicadores de empresas y departamentos para un año. Consulte [Congelar datos maestros y copiar indicadores anuales](master-data-operations.md) |
| **Copiar indicadores anuales** | Copiar los indicadores de empresas y departamentos de un año a otro. Consulte [Congelar datos maestros y copiar indicadores anuales](master-data-operations.md) |

| Tarjetas | Quién las ve |
|---|---|
| Monedas, Columnas presupuestarias, Método de asignación por defecto, Congelar / descongelar datos | Administración presupuestaria con nivel de administrador (`budget_ops:admin`) |
| Copiar columnas presupuestarias, Restablecer columna presupuestaria | Presupuesto con nivel de administrador (`budget:admin`). Las pestañas **Todo**, **OPEX** y **CAPEX** se abren todas con este nivel |
| Congelar datos maestros, Copiar indicadores anuales | Usuarios con acceso al presupuesto que son administradores de la administración presupuestaria, de empresas o de departamentos. Los administradores de empresas y departamentos actúan sobre su propio alcance |

El rol integrado Administrador de presupuesto ve todas las tarjetas. Miembro de presupuesto y Lector de presupuesto no ven ninguna, así que **Administración** no aparece en su menú.

Las columnas presupuestarias son Presupuesto, Revisión, Previsión, Realizado y Aterrizaje previsto. Son los nombres estándar. Su organización puede renombrarlas, ocultar algunas y elegir una columna por defecto en [Columnas presupuestarias](#columnas-presupuestarias). Cada página a continuación muestra los nombres que eligió su organización.

Mientras una de estas operaciones esté en curso, no se pueden guardar las líneas presupuestarias: una edición muestra el mensaje «Hay otra operación de presupuesto en curso. Vuelva a intentarlo cuando haya terminado.» hasta que la operación termine.

---

## Congelar / descongelar datos

Bloquee columnas presupuestarias para que no puedan editarse, importarse ni modificarse de ninguna manera. La congelación protege las cifras aprobadas de cambios accidentales.

### Cuándo usarla

- Después de que el presupuesto anual sea aprobado
- Al cerrar un período fiscal
- Para proteger el realizado de modificaciones

### Cómo funciona

La página muestra un año a la vez. Elíjalo con las pestañas de año de la parte superior, desde el año pasado hasta cuatro años después.

Bajo las pestañas, una tabla tiene una fila por columna presupuestaria y una columna por tipo, **OPEX** y **CAPEX**. Las columnas ocultas también aparecen, con la marca **Oculta**. Cada celda muestra el estado de esa columna para ese tipo, **Abierto** o **Congelado**, con un candado:

- Haga clic en una celda para cambiarla. Un clic congela o descongela esa columna para ese tipo
- La acción al final de una fila actúa sobre los dos tipos a la vez. Muestra **Congelar ambas** mientras una de las dos celdas está abierta, y congela la que está abierta. Cuando ambas están congeladas, muestra **Descongelar ambas**
- Una celda queda deshabilitada mientras se guarda su cambio. Las pestañas de año esperan a que terminen todos los cambios

Sin el nivel Administrador en la administración presupuestaria, la página muestra los estados en solo lectura, con el mensaje «Necesita derechos de administrador de presupuesto para usar esta página.»

### Qué hace la congelación

- Previene ediciones en columnas congeladas en el espacio de trabajo de las líneas de ese tipo. Los campos muestran un candado
- Bloquea importaciones a columnas congeladas
- Bloquea operaciones de copia y restablecimiento dirigidas a columnas congeladas
- Rechaza eliminar una línea, o cambiar su tipo, mientras tenga importes en una columna congelada de los años afectados
- **No** afecta el acceso de lectura: los datos siguen siendo visibles
- También se aplica a las columnas ocultas. Una columna congelada sigue congelada cuando se oculta, y las importaciones en ella se siguen rechazando

### Candados en la lista

La fila **Total** única de [la lista de líneas presupuestarias](budget-lines.md#trabajar-con-la-lista) muestra un candado delante del total de una columna congelada. Sigue la congelación de cada tipo que contiene la lista. Si la lista está filtrada por un tipo, el candado aparece cuando ese tipo está congelado. Si contiene ambos tipos, aparece cuando la columna está congelada para los dos. Pase el cursor sobre el icono para leer **Congelado**.

### Congelar la columna por defecto fija los tipos de cambio

Congelar la [columna por defecto](#columnas-presupuestarias) de un año también fija los tipos de cambio de ese año para el tipo de línea que congela. KANAP actualiza los tipos del año y luego conserva el último conjunto para cada importe OPEX o CAPEX de ese año. Los informes convierten entonces esos importes con los mismos tipos, aunque lleguen tipos más recientes. Si la moneda de reporte cambia más adelante, estos importes conservan los tipos congelados y luego se convierten a la nueva moneda de reporte al tipo de la anterior en ese mismo año. Sin ese tipo, quedan excluidos de los totales y se señalan como cualquier tipo faltante. Consulte [Años congelados](currencies.md#anos-congelados). Descongelar la columna por defecto los libera.

Congelar otra columna no afecta a los tipos. Cambiar más tarde la columna por defecto no fija ni libera nada por sí solo: los tipos siguen la próxima congelación o descongelación de la nueva columna por defecto. **Congelar ambas** solo congela la celda abierta, así que un tipo de línea cuya columna por defecto ya está congelada conserva los tipos de cambio ya fijados.

### Permisos

Congelar y descongelar requieren `budget_ops:admin`. La tarjeta se oculta a los demás usuarios.

---

## Copiar columnas presupuestarias

Copie los importes de una columna a otro año u otra columna, con un porcentaje opcional, y las asignaciones de un año a otro año. Es la herramienta principal para preparar el presupuesto del año siguiente a partir del año actual.

Las pestañas **Todo** / **OPEX** / **CAPEX** de la parte superior eligen las líneas sobre las que se aplica la copia. **Todo**, la pestaña por defecto, copia juntas las líneas OPEX y CAPEX.

Requiere el nivel Admin en Presupuesto (`budget:admin`).

### Cuándo usarla

- Preparar el presupuesto del año siguiente, importes y asignaciones, a partir del año actual
- Crear una revisión a partir del presupuesto aprobado
- Trasladar proyecciones con un factor de inflación

### Campos

| Campo | Descripción |
|-------|-------------|
| **Año de origen** | Año del que se copia (rango: año actual menos uno hasta año actual más cinco). Empieza en el año actual |
| **Año de destino** | Año al que se copia (mismo rango). Empieza en el año siguiente |
| **Qué copiar** | **Importes**, **Asignaciones**, o ambos. **Asignaciones** se ofrece cuando los dos años son distintos, y aparece marcada al principio. Pase el cursor sobre cada casilla para leer qué copia |
| **Columna de origen** | Con **Importes**: cualquier columna visible, incluida Previsión cuando se muestra. Empieza en la columna por defecto |
| **Columna de destino** | Con **Importes**: cualquier columna visible. Empieza en la columna por defecto |
| **Incremento porcentual** | Con **Importes**: ajuste aplicado a cada mes copiado (p. ej., `3` = +3 %). En una columna calculada a partir de sus líneas, aumenta en su lugar el precio unitario de cada línea. Consulte [Copiar una columna construida a partir de líneas](#copiar-una-columna-construida-a-partir-de-lineas). Por defecto 0. Admite decimales y valores negativos. Un porcentaje de -100 % o menos se rechaza |
| **Sobrescribir datos existentes** | Un interruptor para las dos partes. Desactivado: una columna de destino que ya tiene importes los conserva, y una asignación introducida a mano en el año de destino se conserva. Activado: ambas se reemplazan |

Las columnas ocultas no se ofrecen. Si no hay nada marcado en **Qué copiar**, la página indica «Elija qué copiar: los importes, las asignaciones o ambos.»

### Dos pasos: Vista previa, luego Copiar

1. Haga clic en **Vista previa** para ver qué hace la copia en cada línea, sin cambiar ningún dato
2. Revise la tabla, una fila por línea presupuestaria:
   - **Línea**: el nombre de la línea, un enlace que la abre en una pestaña nueva para que la vista previa siga en su sitio. Las líneas marcadas **Prorrateada** empiezan o terminan durante el año de destino y solo reciben los meses de su vigencia. Las líneas marcadas **Calendario** cambian de calendario (vea más abajo)
   - **Tipo de línea**: **OPEX** o **CAPEX**, en la pestaña **Todo**
   - Para los importes: la columna de origen, la columna de destino actual, la columna de destino tras la copia y el estado de los importes
   - Para las asignaciones: la asignación de origen, la asignación de destino actual, la asignación tras la copia y el estado de las asignaciones
3. Cuando el resultado le convenza, haga clic en **Copiar** para aplicarlo

**Copiar** solo se activa tras una vista previa. Cambiar cualquier campo descarta la vista previa: vuelva a ejecutarla. Tras la copia, la tabla sigue en pantalla bajo el título **Resultado**, con lo que hizo cada línea.

**Exportar la tabla** (icono de descarga) descarga la vista previa de los campos en pantalla como archivo CSV o Excel, una fila por línea, con las columnas y los estados de la tabla. Después de la copia, la exportación queda desactivada: la tabla muestra entonces lo que hizo la copia, que una vista previa ya no describe. Los importes del archivo conservan sus céntimos.

Cada parte tiene su propio estado en cada línea:

| Estado | Significado |
|---|---|
| **Por copiar** / **Copiada** | La parte se copia, o se copió |
| **Sustituye a Plantilla** / **Sustituyó a Plantilla** | La asignación del año de destino sigue otro método, que la asignación copiada sustituye |
| **No válida en 2027** | La línea no es válida en el año de destino. Se excluye |
| **Omitida: nada en 2026** | La línea no tiene presupuesto en el año de origen |
| **Omitida: la columna de origen está vacía** | La columna de origen no tiene importes |
| **Omitida: el destino tiene importes** | La columna de destino ya tiene importes, y **Sobrescribir datos existentes** está desactivado |
| **Omitida: ninguna asignación introducida en 2026** | La línea no tiene ninguna asignación que copiar en el año de origen |
| **Omitida: 2027 tiene una asignación introducida a mano** | El año de destino tiene una asignación introducida a mano, y **Sobrescribir datos existentes** está desactivado |
| **Error** | Las reglas de asignación de la línea rechazan la copia, con el motivo. **Copiar** sigue desactivado mientras una línea tenga un error |

### Resumen

Encima de la tabla, un aviso resume la vista previa, por ejemplo «136 líneas en la vista previa. 6 líneas no válidas en 2027 quedan fuera. Importes: 120 por copiar, 10 omitidos. Asignaciones: 124 por copiar, 6 omitidas.» El número de líneas es el de la tabla. Las líneas no válidas en el año de destino figuran en ella, y los recuentos de importes y asignaciones las dejan fuera. Tras la copia indica «Copia terminada.» con los mismos recuentos.

Aparecen advertencias cuando corresponden:

- Las líneas cuya columna de destino ya tiene un importe, y que se omitirán sin **Sobrescribir datos existentes**
- Las líneas que conservan una asignación introducida a mano en el año de destino, sin **Sobrescribir datos existentes**
- Las líneas cuyo método de asignación cambia en el año de destino. Sin **Sobrescribir datos existentes**, la copia solo conserva las asignaciones introducidas a mano: una línea que sigue un método, sin reparto introducido a mano, toma el método del año de origen
- Las líneas que siguen con la asignación por defecto, cuando el valor por defecto del año de destino difiere del año de origen. Las líneas copiadas siguen usando el valor por defecto de su propio año. Configúrelo en [Método de asignación por defecto](#metodo-de-asignacion-por-defecto) si la base debe mantenerse igual

Bajo la tabla, los totales indican el número de líneas, los importes por copiar, el total de origen, el total actual de destino y el total tras la copia, y las asignaciones por copiar.

### Cómo se copian los importes

- Esta parte describe las columnas cuyos importes se escriben, se reparten o se copian, y los meses de las líneas de referencia. Una columna calculada a partir de sus líneas sigue [sus propias reglas](#copiar-una-columna-construida-a-partir-de-lineas)
- La copia conserva el reparto mensual. Cada uno de los doce meses se copia al mismo mes del destino, de modo que una columna repartida de abril a diciembre sigue repartida de abril a diciembre
- Solo se copian las líneas válidas en el año de destino. Una línea cuenta para los meses cuyo día 15 cae entre su **Inicio de vigencia** y su **Fin de validez**. Una línea sin ninguno de esos meses se excluye, ya que la pestaña Presupuesto tampoco la muestra
- Una línea válida solo una parte del año de destino recibe únicamente esos meses. Los demás meses conservan su importe, y el periodo se ajusta a las fechas de la línea. Por ejemplo, un origen de doce meses copiado a una línea que termina el 30 de junio da de enero a junio
- Sin porcentaje, los importes se copian exactamente, al céntimo
- Con un porcentaje, cada mes se redondea a un importe entero, y el total anual sigue siendo el total de origen con el porcentaje aplicado, redondeado a un importe entero. Las unidades que deja el redondeo van a los meses que perdieron las fracciones más grandes, primero el mes más tardío en caso de empate. Ningún mes cambia de signo. Por ejemplo, 12.000 repartidos de abril a diciembre (1.333,33 al mes y 1.333,36 en diciembre) copiados con +2 % dan 1.360 al mes y 12.240 para el año
- El periodo de la columna se desplaza con la copia: de abril a diciembre de 2026 pasa a ser de abril a diciembre de 2027. Un periodo que termina el 29 de febrero termina el 28 de febrero en un año que no lo tiene
- Un origen sin periodo da un periodo de todo el año
- En la pestaña Presupuesto, la columna de destino muestra «Copiado de Presupuesto 2026 +2 %»
- Copiar una columna sobre sí misma (mismo año y misma columna) se rechaza
- La copia es de todo o nada: si una línea falla, no se guarda nada, ni importes ni asignaciones

### Copiar una columna construida a partir de líneas

Una columna puede construirse a partir de líneas, cada una una cantidad por un precio unitario. Consulte [Cantidad y precio](budget-lines.md#cantidad-y-precio). La copia trata una columna así de una de dos maneras.

**Los importes se calculan a partir de las líneas.** La columna sigue calculada a partir de sus líneas en el destino.

- El porcentaje de incremento sube el precio unitario de cada línea, redondeado a 4 decimales. Las cantidades no cambian
- Los meses se recalculan a partir de las líneas con los calendarios laborales del año de destino. El total copiado puede diferir ligeramente del total de origen con el porcentaje aplicado, porque el número de días laborables cambia de un año a otro
- Las líneas pasan al año de destino con su descripción, cantidad, unidad, frecuencia y calendario. Sus periodos se desplazan igual que el periodo de la columna: de marzo a diciembre de 2026 pasa a ser de marzo a diciembre de 2027, y una línea que termina el 29 de febrero termina el 28 de febrero en un año que no lo tiene. Una pieza comprada una vez el 15 de marzo de 2026 se compra el 15 de marzo de 2027. El ETC se recalcula a partir de las líneas
- Una línea que se conserva solo para una parte del año de destino, por la vigencia de la línea, se ajusta a ese periodo. Una línea que se queda sin ningún mes se elimina
- La columna muestra sus líneas como de costumbre en la pestaña Presupuesto. No lleva la indicación «Copiado de»

**Las líneas son solo una referencia.** Es el caso cuando los importes de origen se escribieron a mano, se repartieron o se copiaron.

- El porcentaje de incremento se aplica a los meses, como en cualquier otra columna. Los precios unitarios de las líneas no cambian
- Las líneas pasan al año de destino con su descripción, cantidad, unidad, frecuencia y calendario, y sus periodos se desplazan igual que el periodo de la columna. Una línea que se conserva solo para una parte del año de destino, por la vigencia de la línea, se ajusta a ese periodo, y una línea que se queda sin ningún mes se elimina
- El ETC se recalcula a partir de las líneas copiadas con los calendarios laborales del año de destino
- En la pestaña Presupuesto, la columna de destino muestra «Copiado de Presupuesto 2026», y su editor indica, por ejemplo, «4 líneas conservadas como referencia (48.000). Usar de nuevo las líneas.»
- Las líneas copiadas son una referencia de solo lectura. Haga clic en **Usar de nuevo las líneas** para calcular la columna a partir de ellas, con sus precios actuales. Para planificar el año de destino con sus propios precios, cambie después los precios unitarios: cada cambio vuelve a calcular la columna

Una copia desde una columna sin líneas deja el destino sin líneas, y su ETC queda vacío.

#### Calendarios sin días para el año de destino

Una línea con precio por día necesita un calendario que contenga el año de destino. Cuando el calendario de una línea no tiene días laborables para ese año, la copia usa en su lugar el calendario estándar del país de la empresa pagadora de la línea. Es el calendario creado con la empresa. Esto vale para una columna construida a partir de líneas y para una columna cuyas líneas son solo una referencia. Si no existe ninguno, la línea se copia de la forma habitual: meses por el porcentaje. Las líneas se conservan sin cambios como referencia, y el ETC sigue siendo el de la columna de origen.

La vista previa señala estas líneas con una nota **Calendario**, con una información emergente por línea, y muestra una advertencia sobre la tabla. La vista previa señala también una línea para la que no existe ningún calendario de sustitución. Para copiar de todos modos, marque **Copiar de todos modos con estos cambios de calendario**. Lo mejor es añadir los días del año en la página **Calendarios laborales** y volver a ejecutar la vista previa.

Un calendario desactivado se sigue usando. La vista previa lo anota y no pide confirmación.

### Copiar asignaciones

**Asignaciones** copia el método de asignación de cada línea del año de origen al año de destino, con el reparto introducido a mano (las empresas o departamentos elegidos, los porcentajes introducidos). Solo se copian las líneas válidas en el año de destino, con la misma regla que los importes.

- Una línea que sigue con la asignación por defecto se queda en el valor por defecto: en el año de destino sigue el valor por defecto de ese año
- Sin **Sobrescribir datos existentes**, una línea conserva la asignación introducida a mano en el año de destino. Una línea cuyo año de destino sigue un método sin reparto introducido a mano recibe la asignación de origen, y la vista previa indica qué método sustituye, por ejemplo «Sustituye a Plantilla»
- Con **Sobrescribir datos existentes**, cada asignación copiada sustituye a la del destino

### Protección de columnas congeladas

Cuando la copia incluye los importes y la columna de destino está congelada, **Vista previa** y **Copiar** quedan desactivados y un aviso de error le pide que la descongele primero. En la pestaña **Todo**, cuando la columna solo está congelada para un tipo, el aviso lo nombra, por ejemplo «La columna Presupuesto de 2027 está congelada en CAPEX. Descongélela, o copie solo el otro tipo.» Las asignaciones solas no dependen de las congelaciones.

---

## Restablecer columna presupuestaria

Borre todos los datos de una columna presupuestaria específica para un año determinado. Esta es una operación destructiva: utilícela cuando necesite comenzar de cero.

Las pestañas **Todo** / **OPEX** / **CAPEX** de la parte superior eligen las líneas que se borran. **Todo**, la pestaña por defecto, borra juntas las líneas OPEX y CAPEX. El restablecimiento pone a cero los doce meses de la columna y quita su periodo, así como sus líneas cuando la columna se construyó a partir de cantidad y precio. En la pestaña Presupuesto, la columna recibe entonces una nueva sugerencia a partir de las fechas de la línea. El restablecimiento abarca todas las líneas, incluidas aquellas cuyo fin de validez ya ha pasado. Es de todo o nada: si una línea falla, no se borra nada.

Requiere el nivel Administrador en Presupuesto (`budget:admin`).

Una columna cuyas líneas no tienen ningún importe también puede restablecerse: en ese caso solo se quitan los periodos de reparto, y la confirmación lo indica.

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

Antes de elegir una columna, una línea sustituye a la cuadrícula: «Elija una columna para ver los importes que contiene.» Una vez elegida la columna, una cuadrícula muestra cada línea del tipo elegido y su valor actual en esa columna. El nombre de la línea la abre en una pestaña nueva, y en la pestaña **Todo** una columna **Tipo de línea** indica **OPEX** o **CAPEX**. Los importes que se borrarán aparecen en peso medio; los valores vacíos aparecen atenuados. Debajo de la cuadrícula aparecen tres estadísticas:

- **Total de elementos**
- **Líneas con un total distinto de cero**
- **Valor total actual**

**Exportar la tabla** (icono de descarga) descarga la cuadrícula como archivo CSV o Excel: las líneas del tipo elegido y su valor actual en la columna elegida.

### Confirmación

Al hacer clic en **Borrar columna** se abre un diálogo de confirmación que muestra:

- La columna y año que se restablecerán
- El número de elementos afectados
- El valor total que se eliminará
- Una advertencia clara de que esta acción no se puede deshacer

Debe hacer clic en **Borrar columna** en el diálogo para proceder, o **Cancelar** para abortar.

### Medidas de seguridad

- El botón **Borrar columna** sigue disponible cuando ninguna línea tiene importe, para poder quitar igualmente los periodos de reparto
- No hay ninguna columna preseleccionada, así que siempre elige usted la columna que se borra
- Las columnas congeladas no pueden restablecerse. Descongélelas primero. En la pestaña **Todo**, cuando la columna solo está congelada para un tipo, el mensaje lo nombra, por ejemplo «La columna Presupuesto de 2026 está congelada en CAPEX. Descongélela antes de borrar los datos, o borre solo el otro tipo.»
- El diálogo de confirmación requiere reconocimiento explícito

---

## Método de asignación por defecto

Defina el método que siguen las líneas de OPEX y las inversiones de CAPEX cuando se dejan en la asignación por defecto. La configuración es por ejercicio: cada año resuelve su propio valor por defecto, por lo que puede cambiar la base de un año sin tocar los demás.

### Cuándo usarla

- Su modelo de contracargo no se basa en la plantilla (por ejemplo, se guía por la facturación)
- El presupuesto de IT lo asume una sola entidad y no debe repartirse entre todas las filiales
- Desea que las nuevas líneas sigan una base compartida sin editarlas una por una
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
- La página muestra el reparto resultante, para que pueda comprobar el efecto antes de confiar en él. La columna **Generador** muestra el valor de cada empresa. Una facturación se muestra con la moneda base de la empresa, por ejemplo **35 M USD**, y el reparto la usa convertida a la moneda de reporte, como en la [pestaña Asignaciones](budget-lines.md#asignaciones). Cuando una moneda no tiene tipo para el año, las empresas en esa moneda quedan fuera del reparto: no reciben ninguna parte, las demás empresas seleccionadas se reparten el 100 %, y un aviso sobre el reparto nombra cada empresa excluida
- Una sola sociedad seleccionada siempre asume el **100%**, sin necesidad de un valor del generador
- A partir de dos sociedades, cada sociedad seleccionada necesita un valor para el generador elegido. Una sociedad sin valor se rechaza al guardar. Corrija primero las métricas de la sociedad en **Datos maestros > Empresas**
- Una sociedad desactivada para el año no se puede seleccionar: las sociedades desactivadas quedan excluidas de las asignaciones de ese año

### Qué afecta

- Todas las líneas de OPEX y las inversiones de CAPEX cuyo método de asignación sea **por defecto**, mostradas como *Plantilla (por defecto)* (o *Por defecto (n sociedades)*) en la pestaña Asignaciones hasta que se defina un valor por defecto para la organización
- Las líneas con un método explícito (Plantilla, Usuarios IT o Facturación fijados en la línea) o una asignación manual conservan su propia configuración
- Los importes asignados se recalculan la próxima vez que se muestren las asignaciones. Los importes presupuestarios en sí nunca se modifican

### Método estándar

Mientras una organización no configure un valor por defecto, se aplica el método estándar: **Plantilla** sobre todas las sociedades activas del año. La página siempre indica si el año usa el método estándar o un valor por defecto configurado, y cuál es el método estándar.

### Cambiar el valor por defecto a posteriori

El valor por defecto se resuelve cada vez que se muestran las asignaciones, por lo que editarlo recalcula todas las líneas que siguen en el valor por defecto. Si una sociedad incluida en la selección pierde después su valor de generador o se desactiva, las líneas afectadas muestran un error en lugar de un reparto reequilibrado en silencio. La página le advierte de los problemas con la selección actual.

### Permisos

Cambiar el método por defecto requiere `budget_ops:admin`. La tarjeta se oculta a los demás usuarios.

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
| **En los archivos** | La línea bajo cada nombre. Indica el nombre técnico de la columna en el archivo de presupuesto y sus importaciones, por ejemplo `budget` para la columna 1. Nunca cambia cuando renombra una columna. Consulte [Cargar un presupuesto desde una hoja de cálculo](budget-file.md) |
| **Visible** | Si la columna aparece en pantalla. Al menos una columna debe seguir visible |
| **Sigue el reparto y las líneas** | Si la columna aparece marcada al principio en **Usar también para otras columnas…** de la pestaña Presupuesto, que da a otras columnas el periodo y la distribución de un importe, o las líneas de cantidad y precio. Allí puede seguir marcando o desmarcando cada columna |
| **Por defecto** | La columna que preseleccionan los informes y que ordena las listas y el panel. Congelarla fija los tipos de cambio del año. La columna por defecto debe estar visible |

Los encabezados **Sigue el reparto y las líneas** y **Por defecto** llevan un icono de información. Pase el ratón por encima, o lleve el foco del teclado hasta él, para leer la misma explicación en la página.

Por defecto, Presupuesto, Revisión, Realizado y Aterrizaje previsto están visibles y Previsión está oculta, todas las columnas siguen el reparto y las líneas, y Presupuesto es la columna por defecto.

### Qué cambia la configuración

- **Las columnas ocultas** desaparecen de las listas, del selector de columnas, de la pestaña Presupuesto, de los selectores de los informes, de las páginas de copia y de restablecimiento y del panel. Conservan sus importes: ocultar una columna nunca borra datos, y volver a mostrarla recupera los importes. Las columnas ocultas siguen aceptando importaciones mediante el archivo de presupuesto, y las congelaciones se les siguen aplicando. La página de congelación también muestra las columnas ocultas, con la marca **Oculta**, para que pueda congelarlas como las demás
- **La columna por defecto** está preseleccionada en todos los informes. Ordena la lista de líneas presupuestarias y su navegación anterior y siguiente. El mosaico **Top líneas**, clasificado por **Importe** o por **Aumento**, y los mosaicos **Mi presupuesto** y **Por centro de coste** del panel la usan. La lista la muestra para el año actual, junto a la última columna visible. También es el importe de referencia de la pestaña Asignaciones y la columna de partida de la fila **Diferencia con** de la pestaña Presupuesto. Congelarla para un año fija los tipos de cambio de ese año (consulte [Congelar la columna por defecto fija los tipos de cambio](#congelar-la-columna-por-defecto-fija-los-tipos-de-cambio))
- **Sigue el reparto y las líneas** decide qué columnas aparecen marcadas al principio cuando usa **Usar también para otras columnas…** en la pestaña Presupuesto. Las columnas congeladas nunca se ofrecen, diga lo que diga esta configuración

### Guardar

Haga clic en **Guardar** para aplicar sus cambios. El botón sigue deshabilitado hasta que algo cambie y todos los nombres sean válidos. **Restablecer** descarta los cambios que aún no ha guardado. Los errores se explican bajo el campo o bajo la tabla, por ejemplo «Al menos una columna debe seguir visible.» o «La columna por defecto debe estar visible: elija antes otra columna por defecto.» Para ocultar la columna por defecto actual, elija antes otra columna por defecto. Ambos cambios se pueden guardar a la vez.

### Permisos

Cambiar la configuración requiere derechos de administración de la Administración presupuestaria (`budget_ops:admin`). La tarjeta se oculta a los demás usuarios.

Si la configuración no se puede cargar, la página muestra una sola línea, «No se pudo cargar la configuración de las columnas.», y ningún control.

---

## Ejemplo de flujo de trabajo: Ciclo presupuestario anual

A continuación se muestra una secuencia típica usando estas herramientas, con los nombres de columna estándar y Presupuesto como columna por defecto:

### 1. Fin del año N

1. Congelar el realizado del Año N (proteger datos históricos)
2. Copiar Presupuesto N a Presupuesto N+1, con las asignaciones (una sola ejecución de **Copiar columnas presupuestarias**, con un porcentaje de aumento por inflación)

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

- **Siempre revise la vista previa primero**: **Copiar columnas presupuestarias** muestra lo que hace en cada línea antes de copiar. Revísela cada vez antes de confirmar.
- **Congele después de la aprobación**: Bloquear columnas después de la aprobación mantiene su registro de auditoría y previene ediciones accidentales.
- **Use ajustes porcentuales**: Al copiar entre años, aplique un factor de inflación o crecimiento para no tener que ajustar cada línea manualmente.
- **Verifique el estado de congelación antes de operaciones masivas**: Las columnas congeladas bloquean las operaciones de copia y restablecimiento. Si un botón está en gris, verifique primero la página de congelación.
- **Defina el valor por defecto del año antes de introducir presupuestos**: Si su base de asignación no es la plantilla, configúrela primero en Método de asignación por defecto, para que las líneas se creen sobre la base correcta en lugar de recalcularse después.
- **Restablezca con precaución**: El restablecimiento de columna es irreversible. Compruebe el año y la columna antes de confirmar.
