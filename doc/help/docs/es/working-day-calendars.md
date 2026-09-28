# Calendarios laborales

Un calendario laboral indica el número de días laborables de cada mes, año por año. Es la cifra por la que se multiplica una línea de presupuesto con precio por día. Por ejemplo, un consultor a 400 por día en un calendario con 20 días laborables en marzo cuesta 8.000 en marzo.

Cada columna OPEX y CAPEX calculada con un precio por día usa un calendario. Las demás formas de calcular una línea (por mes o para todo el periodo) no necesitan calendario. Consulte [Calcular a partir de cantidad y precio](opex.md#calcular-a-partir-de-cantidad-y-precio).

---

## Primeros pasos

Navegue a **Datos maestros > Calendarios laborales** (en la sección **Finanzas**) para abrir la lista. Haga clic en **Nuevo** para crear su primer calendario.

**Campos obligatorios**:

- **Código**: un código corto que su equipo reconoce. Los archivos de importación lo usan para encontrar el calendario
- **Nombre**: el nombre que se elige en la pestaña Presupuesto, por ejemplo "Personal de la sede"

**Opcional pero útil**:

- **Descripción**: a quién se aplica el calendario, por ejemplo "Días laborables del personal asalariado, sin festivos"

Una vez creado el calendario, introduzca los días laborables de cada año en su espacio de trabajo.

**Consejo**: Si su equipo de finanzas ya mantiene los días laborables en una hoja de cálculo, impórtelos desde un archivo CSV. Una fila contiene un calendario y un año.

---

## Trabajar con la lista

Cuando el espacio de trabajo aún no tiene ningún calendario, una línea bajo el título lo indica: "Un calendario indica los días laborables de cada mes, para las líneas con precio por día. Cree uno o importe un archivo."

**Columnas**:

- **Código**: el código del calendario
- **Nombre**: el nombre del calendario
- **Años**: los años que contiene el calendario, por ejemplo "2026, 2027"
- **Estado**: **Activado** o **Desactivado** (oculta por defecto, añádala desde el selector de columnas)
- **Actualizado**: la fecha y la hora del último cambio

Haga clic en cualquier celda para abrir el espacio de trabajo.

**Ordenación**: La lista se abre ordenada por nombre. Haga clic en el encabezado de una columna para ordenar por esa columna.

**Filtrado**:

- **Búsqueda rápida**: busca en el código, el nombre y la descripción
- **Estado**: el filtro de columna ofrece **Activado** y **Desactivado**
- **Ámbito de estado**: el selector **Todos / Activos / Desactivados** sobre la lista. La lista muestra por defecto los calendarios activados

**Acciones**:

- **Nuevo**: crear un calendario (requiere `working_day_profiles:member`)
- **Importar CSV**: cargar calendarios y sus días laborables desde un archivo (requiere `working_day_profiles:admin`)
- **Exportar CSV**: descargar todos los calendarios (requiere `working_day_profiles:admin`)
- **Eliminar selección**: eliminar los calendarios seleccionados (requiere `working_day_profiles:admin`). Los calendarios que no se pueden eliminar se conservan y se listan con el motivo

---

## Crear un calendario

Haga clic en **Nuevo**. Complete **Código**, **Nombre** y, si lo desea, **Descripción**, y después haga clic en **Crear**. Un calendario nuevo está activado.

Tras **Crear**, se abre el espacio de trabajo del nuevo calendario, listo para sus días laborables.

---

## El espacio de trabajo del calendario

Haga clic en cualquier fila de la lista para abrir el espacio de trabajo.

- **Encabezado**: el código como referencia, con un botón para copiarlo, y el nombre. Haga clic en el nombre para cambiarlo. **Ant.** / **Sig.** recorren la lista en su orden y con sus filtros actuales, y el botón de cierre vuelve a la lista
- **Zona principal**: una línea como "Usado por 3 líneas OPEX y 1 línea CAPEX." cuando hay líneas de presupuesto que usan el calendario, la **Descripción** y después la sección **Días laborables**
- **Panel Propiedades** a la derecha: **Código** y **Ciclo de vida**

**Guardado automático**: Cada cambio se guarda por sí solo. No hay botón Guardar. Los campos de texto y los meses se guardan al salir de ellos (pulse Intro en **Código** o en un mes para guardar de inmediato); el ciclo de vida se guarda en cuanto lo cambia. Cuando se rechaza un cambio, el motivo aparece bajo el campo que lo causó, por ejemplo un código duplicado bajo **Código**.

### Campos

| Campo | Qué introducir | Dónde encontrar este valor |
|---|---|---|
| **Código** | Hasta 50 caracteres. Los códigos son únicos sin distinguir mayúsculas y minúsculas: `CAL-01` y `cal-01` son el mismo código | El código que usa su equipo de finanzas para este conjunto de días laborables, por ejemplo en su hoja de cálculo presupuestaria |
| **Nombre** | Hasta 200 caracteres. Los nombres son únicos sin distinguir mayúsculas y minúsculas | El nombre con el que su equipo conoce el calendario. Es el nombre que se muestra en la pestaña Presupuesto |
| **Descripción** | Texto libre | A quién se aplica el calendario y qué deja fuera |
| **Ciclo de vida** | El interruptor **Activado** y la fecha de **Fin de validez** | Indique una fecha futura para programar el fin, o desactive el interruptor para desactivarlo hoy |

### Días laborables

La sección **Días laborables** muestra un año cada vez.

- **Pestañas de año**: cada año que contiene el calendario, los años en torno al actual y un año vacío antes y después de los guardados, de modo que siempre se puede añadir el año siguiente
- **Doce meses**: un campo por mes. Introduzca los días laborables de ese mes
- **Total anual**: la línea bajo los meses, por ejemplo "218 días en 2026". Suma los meses mientras escribe, con 2 decimales como máximo, por ejemplo "229 días en 2026" para doce meses de 19.083333
- **Copiar de 2025**: se muestra cuando el año está vacío y el año anterior tiene días laborables. Rellena los doce meses con los valores del año anterior y los guarda. Ajuste después los meses que difieran
- **Quitar 2026**: se muestra en un año que contiene el calendario. Cuando ninguna línea de presupuesto usa el calendario, quita ese año de inmediato. Cuando hay líneas que lo usan, un diálogo pregunta antes: "¿Quitar los días laborables de 2026?" Indica el número de líneas y explica el efecto. Las líneas conservan sus importes y explicaciones, pero ninguna puede recalcularse para ese año, y el archivo de filas presupuestarias no puede calcularlas, hasta que se vuelvan a introducir los días. Haga clic en **Quitar de todos modos** para confirmar

**Un año nuevo** se guarda una vez completados los doce meses. Hasta entonces, una indicación dice "Complete los doce meses para guardar 2027." Después, cada cambio se guarda en cuanto sale del mes.

**Reglas para los meses**:

- **Como máximo los días naturales del mes**: 31 para marzo, 30 para abril, 28 para febrero, 29 para febrero en un año bisiesto. Un valor mayor se rechaza: "marzo de 2027 tiene 31 días: introduzca 31 o menos."
- **Cero o más**: un valor negativo se rechaza.
- **Hasta 6 decimales**: los días laborables pueden ser fracciones, por ejemplo `19.083333` para un total anual repartido en doce meses. Más decimales se rechazan: "Use 6 decimales como máximo."
- **Los doce meses**: un año contiene doce valores. Dejar vacío un mes de un año guardado se rechaza: "Introduzca los días laborables de los doce meses de 2027." Escriba `0` para un mes sin días laborables.

**Cambiar los días laborables nunca modifica por sí solo una línea de presupuesto.** Los importes de las líneas ya calculadas se mantienen, al igual que la explicación de cómo se calcularon. Abra la pestaña Presupuesto de una línea y haga clic en **Recalcular** para aplicar los nuevos días. El panel lista entonces los meses cuyos días cambiaron, por ejemplo "marzo: 20 días, ahora 19".

---

## Calendarios desactivados

Desactive un calendario cuando ya no deba usarse, por ejemplo tras un cambio de convenio de jornada.

- Un calendario desactivado se mantiene en las líneas de presupuesto que ya lo usan. Sus importes no cambian.
- No se puede elegir para otra línea. La pestaña Presupuesto solo ofrece los calendarios activados, más el propio calendario de la línea.
- Una línea que ya lo usa todavía puede recalcularse. El panel avisa entonces: "This calendar is disabled. The computation still uses it."
- En un archivo de filas presupuestarias, una fila que asigna un calendario desactivado a una línea que aún no lo usa se rechaza: "Personal de la sede is disabled. Pick an enabled calendar."

---

## Eliminar

El botón **Eliminar** del encabezado elimina el calendario de inmediato (requiere `working_day_profiles:admin`). Está desactivado, con el motivo en una línea, mientras haya líneas de presupuesto que usen el calendario, por ejemplo "Usado por 3 líneas OPEX y 1 línea CAPEX. Desactívelo en su lugar."

La misma regla se aplica a **Eliminar selección** en la lista: un calendario usado por líneas de presupuesto se conserva, con un motivo como "Personal de la sede is used by 3 OPEX lines and 1 CAPEX line. Disable it instead."

Una línea usa un calendario cuando una de sus columnas, en cualquier año, se calcula con un precio por día sobre él. **Restablecer columna presupuestaria** en la Administración presupuestaria quita ese vínculo para la columna restablecida. Consulte [Restablecer columna presupuestaria](budget-operations.md#restablecer-columna-presupuestaria).

---

## Importación/exportación CSV

Cargue o actualice calendarios y sus días laborables desde un archivo.

**Exportar**: haga clic en **Exportar CSV** y después en **Exportar datos**. El archivo lista todos los calendarios, activados o desactivados, ordenados por código. Para un archivo vacío solo con los encabezados, use **Descargar plantilla** en el diálogo de importación.

**Estructura CSV**:

- Delimitador: punto y coma `;`
- Codificación: UTF-8 (guarde como "CSV UTF-8" en Excel)
- Encabezados: `code;name;description;status;disabled_at;year;jan;feb;mar;apr;may;jun;jul;aug;sep;oct;nov;dec`
- Una fila por calendario y año. Un calendario con tres años ocupa tres filas. Un calendario sin ningún año se exporta como una fila con el año y los meses vacíos

| Columna | Contenido |
|---|---|
| `code` | Obligatoria. El código del calendario. Las filas se emparejan con los calendarios existentes por código, sin distinguir mayúsculas y minúsculas |
| `name` | Obligatoria |
| `description` | Texto libre |
| `status` | `enabled` o `disabled`. Vacía significa `enabled` |
| `disabled_at` | Columna opcional. El fin de validez: una fecha (`2026-12-31`) o una fecha y hora completas. Vacía si no hay fin |
| `year` | Cuatro dígitos, de 2000 a 2100. Vacía en una fila que solo define los campos del calendario |
| `jan` a `dec` | Los días laborables de cada mes, con un punto como separador decimal (también se acepta la coma). Obligatorias en una fila con año |

**Importar**:

1. Haga clic en **Importar CSV** en la lista
2. Elija su archivo
3. Haga clic en **Verificación previa**. El informe indica el número de filas, las inserciones y actualizaciones, y las filas que no cambian nada
4. Si la verificación previa no muestra errores, haga clic en **Cargar**

**Cómo funciona la importación**:

- **Todo el archivo se comprueba antes de escribir nada.** Un archivo con cualquier error no carga nada: corrija las filas y vuelva a ejecutar la verificación previa.
- **Las filas de un mismo código describen un calendario.** Deben coincidir en el nombre, la descripción, el estado y el fin de validez.
- **Los meses siguen las reglas del espacio de trabajo**: los doce meses, cada uno como máximo con los días naturales del mes, hasta 6 decimales.
- **Los años que faltan en el archivo se conservan.** Una importación añade o sustituye años. Nunca quita ninguno. Para quitar un año, use su enlace **Quitar** en el espacio de trabajo.
- **Recuentos**: un calendario nuevo o un año nuevo cuenta como una inserción. Un año modificado, o un cambio de nombre, descripción o ciclo de vida, cuenta como una actualización. Una fila idéntica a lo guardado cuenta como sin cambios. Exportar e importar el mismo archivo indica todas las filas como sin cambios.
- **Los calendarios que faltan en el archivo** se dejan como están. La importación nunca elimina.

**Errores frecuentes**:

- **"Rows of CAL-01 disagree on the name."** (o la descripción, el estado, el fin de validez): haga que las filas de ese código sean idénticas en estos campos.
- **"CAL-01 has 2027 twice (rows 3 and 5)."**: conserve una fila por calendario y año.
- **"Enter the working days of all twelve months of 2027."**: complete todos los meses de la fila. Escriba `0` para un mes sin días laborables.
- **"March 2027 has 31 days: enter 31 or less."**: corrija el mes.
- **"Use at most 6 decimals."**: redondee el valor.
- **"Give the year of these working days."**: la fila tiene meses pero no año.
- **"A calendar named ... already exists."**: otro calendario ya usa este nombre. Los nombres son únicos sin distinguir mayúsculas y minúsculas.
- **"Header mismatch"**: descargue una plantilla nueva.

---

## Permisos

| Nivel | Qué permite |
|---|---|
| `working_day_profiles:reader` | Ver la lista y abrir los calendarios |
| `working_day_profiles:member` | Crear calendarios y editarlos junto con sus días laborables |
| `working_day_profiles:admin` | Todo lo anterior, más la importación y exportación CSV y la eliminación |

Los administradores de presupuesto son administradores de calendarios: el rol integrado Administrador de presupuesto recibe admin. Cada uno de los demás roles empieza con el nivel que tiene en departamentos, de modo que Administrador de datos maestros es admin, Miembro de presupuesto y Miembro de datos maestros son miembros, y los roles de lectura pueden leer.

Cualquier persona que pueda leer OPEX o CAPEX puede elegir un calendario en la pestaña Presupuesto sin acceso a esta página.

---

## Consejos

- **Un calendario por convenio de jornada**: las personas con el mismo convenio comparten los mismos días laborables. Cree un calendario para cada convenio, no uno por persona.
- **Póngale el nombre de las personas que cubre**: la pestaña Presupuesto muestra el nombre, de modo que "Personal de la sede" dice más que un código.
- **Prepare el año siguiente con antelación**: use **Copiar de** en el año nuevo y después ajuste los meses que difieran. Una línea calculada por día no puede recalcularse para un año que su calendario no contiene.
- **Desactive, no elimine**: cuando un calendario ya no se use para líneas nuevas, desactívelo. Las líneas que lo usan conservan sus importes y todavía pueden recalcularse.
