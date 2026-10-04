# Calendarios laborales

Un calendario laboral indica el número de días laborables de cada mes, año por año. Las líneas de presupuesto con precio por día lo usan: una persona a tiempo completo trabaja todos los días laborables del mes, y los días y los días por mes se convierten en ETC en relación con él. Por ejemplo, un consultor a tiempo completo a 400 por día en un calendario con 20 días laborables en marzo cuesta 8.000 en marzo.

Un calendario es de uno de estos dos tipos:

- **Estándar**: creado a partir de un país, y de una región cuando el país las tiene. Los días laborables de cualquier año son los días de lunes a viernes de cada mes menos los festivos del país. No hay nada que escribir, y aun así puede cambiar cualquier mes de cualquier año
- **Personalizado**: usted introduce los días laborables de cada año, por ejemplo para un convenio de jornada con sus propios días libres

En la pestaña Presupuesto de una partida OPEX o CAPEX, cada línea con precio por día usa un calendario. Las líneas con precio por mes o por pieza no necesitan ninguno. Consulte [Cantidad y precio](opex.md#cantidad-y-precio).

---

## Primeros pasos

Navegue a **Datos maestros > Calendarios laborales** (en la sección **Finanzas**) para abrir la lista.

La forma más rápida de empezar es un calendario estándar para cada país donde están sus empresas:

- **Cuando crea una empresa** con un país, KANAP crea por usted el calendario estándar de ese país, salvo que el espacio de trabajo ya tenga uno para todo el país
- **Para las empresas que ya tiene**, la página de la lista muestra una línea sobre la cuadrícula, por ejemplo «Sus empresas están en Francia, Países Bajos e Italia. Cree sus calendarios estándar.» Haga clic en **Crear 3 calendarios** para crearlos de una vez

Para crear un calendario usted mismo, haga clic en **Nuevo**.

**Campos obligatorios**:

- **Código**: un código corto que su equipo reconoce. Los archivos de importación lo usan para encontrar el calendario
- **Nombre**: el nombre que se elige en la pestaña Presupuesto, por ejemplo "Personal de la sede"

**Opcional pero útil**:

- **País** y **Región**: convierten el calendario en estándar. Sin país, el calendario es personalizado
- **Descripción**: a quién se aplica el calendario, por ejemplo "Días laborables del personal asalariado, sin festivos"

**Consejo**: Si su equipo de finanzas ya mantiene los días laborables en una hoja de cálculo, impórtelos desde un archivo CSV. Una fila contiene un calendario y un año.

---

## Trabajar con la lista

Cuando el espacio de trabajo aún no tiene ningún calendario, una línea bajo el título lo indica: "Un calendario indica los días laborables de cada mes, para las líneas con precio por día. Cree uno o importe un archivo."

**Columnas**:

- **Código**: el código del calendario
- **Nombre**: el nombre del calendario
- **País**: el país de un calendario estándar, con la región entre paréntesis, por ejemplo "Francia (Département Moselle)". Vacío para un calendario personalizado
- **Años**: "Todos los años" para un calendario estándar, seguido de los años que usted cambió, por ejemplo "Todos los años, 2026 modificado(s)". Para un calendario personalizado, los años que contiene, por ejemplo "2026, 2027"
- **Estado**: **Activado** o **Desactivado** (oculta por defecto, añádala desde el selector de columnas)
- **Actualizado**: la fecha y la hora del último cambio

Haga clic en cualquier celda para abrir el espacio de trabajo.

**Ordenación**: La lista se abre ordenada por nombre. Haga clic en el encabezado de una columna para ordenar por esa columna.

**Filtrado**:

- **Búsqueda rápida**: busca en el código, el nombre, la descripción, y el país y la región de un calendario estándar
- **Estado**: el filtro de columna ofrece **Activado** y **Desactivado**. Si hace clic en **Limpiar** dentro del filtro, o desmarca ambos valores, la lista no muestra nada, sea cual sea la opción de **Mostrar**
- **Ámbito de estado**: el selector **Mostrar: Todos / Activos / Desactivados** sobre la lista. La lista muestra por defecto los calendarios activados

**Calendarios sugeridos**: para los usuarios que pueden crear calendarios, una línea sobre la cuadrícula lista los países de sus empresas activadas que aún no tienen calendario estándar, con un botón que los crea. Cada calendario toma el código del país como código y el nombre del país, en su idioma, como nombre. La línea desaparece cuando cada país tiene su calendario.

**Acciones**:

- **Nuevo**: crear un calendario (requiere `working_day_profiles:member`)
- **Importar CSV**: cargar calendarios y sus días laborables desde un archivo (requiere `working_day_profiles:admin`)
- **Exportar CSV**: descargar todos los calendarios (requiere `working_day_profiles:admin`)
- **Eliminar selección**: eliminar los calendarios seleccionados (requiere `working_day_profiles:admin`). Los calendarios que no se pueden eliminar se conservan y se listan con el motivo

---

## Crear un calendario

Haga clic en **Nuevo** y después:

1. **País** (opcional): escriba para buscar, por nombre o por el código de dos letras. Con un país, el calendario es estándar
2. **Región**: se muestra cuando el país tiene regiones, por ejemplo los estados alemanes o los departamentos franceses con sus propios festivos. Conserve **Todo el país** o elija una región
3. **Código** y **Nombre**: al elegir un país se rellenan, por ejemplo `FR-57` y "Francia (Département Moselle)". Cámbielos si lo desea
4. **Descripción**: opcional
5. Haga clic en **Crear**

Un calendario nuevo está activado, y se abre su espacio de trabajo. Un calendario estándar ya contiene los días laborables de todos los años. En uno personalizado, introdúzcalos año por año.

El país y la región se definen una sola vez, al crear el calendario. Para seguir otro país, cree otro calendario.

---

## El espacio de trabajo del calendario

Haga clic en cualquier fila de la lista para abrir el espacio de trabajo.

- **Encabezado**: el código como referencia, con un botón para copiarlo, y el nombre. Haga clic en el nombre para cambiarlo. **Ant.** / **Sig.** recorren la lista en su orden y con sus filtros actuales, y el botón de cierre vuelve a la lista
- **Zona principal**: una línea como "Usado por 3 líneas OPEX y 1 línea CAPEX." cuando hay líneas de presupuesto que usan el calendario, la **Descripción** y después la sección **Días laborables**
- **Panel Propiedades** a la derecha: **Código**, **Origen** (solo calendarios estándar, por ejemplo "Francia (Département Moselle)", de solo lectura) y **Ciclo de vida**

**Guardado automático**: Cada cambio se guarda por sí solo. No hay botón Guardar. Los campos de texto y los meses se guardan al salir de ellos (pulse Intro en **Código** o en un mes para guardar de inmediato); el ciclo de vida se guarda en cuanto lo cambia. Cuando se rechaza un cambio, el motivo aparece bajo el campo que lo causó, por ejemplo un código duplicado bajo **Código**.

### Campos

| Campo | Qué introducir | Dónde encontrar este valor |
|---|---|---|
| **Código** | Hasta 50 caracteres. Los códigos son únicos sin distinguir mayúsculas y minúsculas: `CAL-01` y `cal-01` son el mismo código | El código que usa su equipo de finanzas para este conjunto de días laborables, por ejemplo en su hoja de cálculo presupuestaria. Para un calendario estándar, el código del país es una buena opción |
| **Nombre** | Hasta 200 caracteres. Los nombres son únicos sin distinguir mayúsculas y minúsculas | El nombre con el que su equipo conoce el calendario. Es el nombre que se muestra en la pestaña Presupuesto |
| **Descripción** | Texto libre | A quién se aplica el calendario y qué deja fuera |
| **País** / **Región** | Solo al crear el calendario. La lista de regiones depende del país | El país, y la región cuando sus festivos difieren, donde trabajan las personas o los servicios del calendario |
| **Ciclo de vida** | El interruptor de estado, cuya etiqueta muestra el estado actual (**Activado** o **Desactivado**), y la fecha de **Fin de validez** | Indique una fecha futura para programar el fin, o desactive el interruptor para desactivarlo hoy |

### Días laborables de un calendario estándar

La sección **Días laborables** muestra un año cada vez, con las mismas pestañas de año que la pestaña Presupuesto: cinco años en torno al actual, y flechas para avanzar o retroceder un año cada vez, de 2000 a 2100. Todos los años están ahí: no hay que añadir nada.

- **Doce meses**: cada mes muestra sus días laborables, los días de lunes a viernes que no son festivos
- **Total anual**: la línea bajo los meses, por ejemplo "252 días en 2026"
- **Festivos**: una línea lista los festivos del año con sus fechas, por ejemplo "Festivos: 1 ene Año Nuevo, 6 abr Lunes de Pascua, …". Un festivo que cae en sábado o domingo aparece con "(fin de semana)": no quita ningún día laborable, lo que explica el recuento

**Cambiar un mes**: escriba el valor que necesita, por ejemplo para quitar un día de cierre de la empresa. El año pasa a ser un año modificado: sus doce meses se conservan tal como están ahora, y los demás años siguen los festivos.

- Bajo el total de un año modificado, una línea indica los valores estándar, por ejemplo "Valores estándar: 252 días"
- **Volver a los valores estándar** devuelve de inmediato el año a los festivos. No hay confirmación: los valores que escribió se sustituyen por los estándar

**De dónde vienen los valores estándar**: las reglas de los festivos proceden de [`date-holidays`](https://github.com/commenthol/date-holidays), una biblioteca de código abierto incluida en KANAP. Las reglas se distribuyen con la aplicación, de modo que los calendarios estándar funcionan sin acceso a internet. Los datos de festivos se publican bajo la licencia Creative Commons Reconocimiento-CompartirIgual 3.0 (CC BY-SA 3.0), y KANAP los usa sin modificarlos. Solo cuentan los festivos oficiales: los días bancarios, las vacaciones escolares y las celebraciones no cuentan. Un festivo que empieza por la tarde (a las 18:00 o más tarde), como la Nochebuena en el Territorio del Norte de Australia, no quita el día; uno que empieza antes en el día quita el día entero.

### Días laborables de un calendario personalizado

La sección **Días laborables** muestra un año cada vez.

- **Pestañas de año**: cada año que contiene el calendario, los años en torno al actual y un año vacío antes y después de los guardados, de modo que siempre se puede añadir el año siguiente
- **Doce meses**: un campo por mes. Introduzca los días laborables de ese mes
- **Total anual**: la línea bajo los meses, por ejemplo "218 días en 2026". Suma los meses mientras escribe, con 2 decimales como máximo, por ejemplo "229 días en 2026" para doce meses de 19.083333
- **Copiar de 2025**: se muestra cuando el año está vacío y el año anterior tiene días laborables. Rellena los doce meses con los valores del año anterior y los guarda. Ajuste después los meses que difieran
- **Quitar 2026**: se muestra en un año que contiene el calendario. Cuando ninguna línea de presupuesto usa el calendario, quita ese año de inmediato. Cuando hay líneas que lo usan, un diálogo pregunta antes: "¿Quitar los días laborables de 2026?" Indica el número de líneas y explica el efecto. Las líneas conservan sus importes, pero las líneas con precio por día en este calendario no pueden guardarse para ese año hasta que se vuelvan a introducir los días. Haga clic en **Quitar de todos modos** para confirmar

**Un año nuevo** se guarda una vez completados los doce meses. Hasta entonces, una indicación dice "Complete los doce meses para guardar 2027." Después, cada cambio se guarda en cuanto sale del mes.

### Reglas para los meses

Estas reglas se aplican a los dos tipos de calendario:

- **Como máximo los días naturales del mes**: 31 para marzo, 30 para abril, 28 para febrero, 29 para febrero en un año bisiesto. Un valor mayor se rechaza: "marzo de 2027 tiene 31 días: introduzca 31 o menos."
- **Cero o más**: un valor negativo se rechaza.
- **Hasta 6 decimales**: los días laborables pueden ser fracciones, por ejemplo `19.083333` para un total anual repartido en doce meses. Más decimales se rechazan: "Use 6 decimales como máximo."
- **Los doce meses**: un año contiene doce valores. Dejar vacío un mes de un año guardado se rechaza: "Introduzca los días laborables de los doce meses de 2027." Escriba `0` para un mes sin días laborables.

### Cuando cambian los días laborables

**Cambiar los días laborables nunca modifica por sí solo una línea de presupuesto.** Los importes ya guardados en una línea de presupuesto se mantienen. Cuando abre la pestaña Presupuesto de la línea, la pestaña **Cantidad y precio** lo indica, por ejemplo "Días laborables modificados desde el último cálculo: marzo: 20 días, ahora 19." Haga clic allí en **Usar de nuevo las líneas** para aplicar los nuevos días.

---

## Calendarios desactivados

Desactive un calendario cuando ya no deba usarse, por ejemplo tras un cambio de convenio de jornada.

- Un calendario desactivado se mantiene en las líneas de presupuesto que ya lo usan. Sus importes no cambian.
- No se puede elegir para otra línea. La pestaña Presupuesto solo ofrece los calendarios activados, más el calendario que ya usa una línea, marcado "(desactivado)".
- Las líneas que ya lo usan todavía pueden guardarse. El panel avisa entonces, por ejemplo: "Personal de la sede está desactivado. Las líneas aún lo usan."

---

## Eliminar

El botón **Eliminar** del encabezado elimina el calendario de inmediato (requiere `working_day_profiles:admin`). Está desactivado, con el motivo en una línea, mientras haya líneas de presupuesto que usen el calendario, por ejemplo "Usado por 3 líneas OPEX y 1 línea CAPEX. Desactívelo en su lugar."

La misma regla se aplica a **Eliminar selección** en la lista: un calendario usado por líneas de presupuesto se conserva, con un motivo como "Personal de la sede is used by 3 OPEX lines and 1 CAPEX line. Disable it instead."

Una línea de presupuesto usa un calendario cuando una de sus columnas, en cualquier año, tiene una línea con precio por día sobre él. Quitar esa línea en la pestaña Presupuesto, o **Restablecer columna presupuestaria** en la Administración presupuestaria, quita el vínculo. Consulte [Restablecer columna presupuestaria](budget-operations.md#restablecer-columna-presupuestaria).

---

## Importación/exportación CSV

Cargue o actualice calendarios y sus días laborables desde un archivo.

**Exportar**: haga clic en **Exportar CSV** y después en **Exportar datos**. El archivo lista todos los calendarios, activados o desactivados, ordenados por código. Para un archivo vacío solo con los encabezados, use **Descargar plantilla** en el diálogo de importación.

**Estructura CSV**:

- Encabezados: `code`, `name`, `description`, `country`, `region`, `status`, `disabled_at`, `year`, `jan`, `feb`, `mar`, `apr`, `may`, `jun`, `jul`, `aug`, `sep`, `oct`, `nov`, `dec`
- La exportación escribe el separador del idioma de la pantalla. Consulte [Archivos CSV](master-data-operations.md#archivos-csv) para la codificación, el separador, los formatos de fecha y los dos pasos de importación
- Una fila por calendario y año. Un calendario con tres años ocupa tres filas. Un calendario sin ningún año se exporta como una fila con el año y los meses vacíos
- Un calendario estándar solo exporta los años que usted modificó. Los demás años siguen los festivos y no necesitan fila
- Las columnas `country`, `region` y `disabled_at` son opcionales al importar. Un archivo sin `country` ni `region` crea calendarios personalizados

| Columna | Contenido |
|---|---|
| `code` | Obligatoria. El código del calendario. Las filas se emparejan con los calendarios existentes por código, sin distinguir mayúsculas y minúsculas |
| `name` | Obligatoria |
| `description` | Texto libre |
| `country` | Opcional. El código de país de dos letras de un calendario estándar, por ejemplo `FR`. Vacía para un calendario personalizado |
| `region` | Opcional. El código de la región, por ejemplo `57` para Mosela o `BY` para Baviera. Necesita un país. Vacía para todo el país |
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
- **Las filas de un mismo código describen un calendario.** Deben coincidir en el nombre, la descripción, el país, la región, el estado y el fin de validez.
- **El país y la región se aplican cuando el archivo crea un calendario.** En un calendario existente, déjelos vacíos o indique los valores del propio calendario. Un valor distinto se rechaza.
- **Los años de un calendario estándar pasan a ser años modificados.** Los demás años siguen los festivos.
- **Los meses siguen las reglas del espacio de trabajo**: los doce meses, cada uno como máximo con los días naturales del mes, hasta 6 decimales.
- **Los años que faltan en el archivo se conservan.** Una importación añade o sustituye años. Nunca quita ninguno. Para quitar un año, use su enlace **Quitar** en el espacio de trabajo, o **Volver a los valores estándar** en un calendario estándar.
- **Recuentos**: un calendario nuevo o un año nuevo cuenta como una inserción. Un año modificado, o un cambio de nombre, descripción o ciclo de vida, cuenta como una actualización. Una fila idéntica a lo guardado cuenta como sin cambios. Exportar e importar el mismo archivo indica todas las filas como sin cambios.
- **Los calendarios que faltan en el archivo** se dejan como están. La importación nunca elimina.

**Errores frecuentes**:

- **"Rows of CAL-01 disagree on the name."** (o la descripción, el país, la región, el estado, el fin de validez): haga que las filas de ese código sean idénticas en estos campos.
- **"CAL-01 has 2027 twice (rows 3 and 5)."**: conserve una fila por calendario y año.
- **"Enter the working days of all twelve months of 2027."**: complete todos los meses de la fila. Escriba `0` para un mes sin días laborables.
- **"March 2027 has 31 days: enter 31 or less."**: corrija el mes.
- **"Use at most 6 decimals."**: redondee el valor.
- **"Give the year of these working days."**: la fila tiene meses pero no año.
- **"Country XX is not in the list."**: use un código de país de dos letras, por ejemplo `FR` o `DE`.
- **"BY is not a region of France."**: la región no pertenece al país. Corrija la región, o déjela vacía para todo el país.
- **"Give the country of region BY."**: una región necesita su país.
- **"The country of a calendar cannot be changed. Create another calendar."**: la fila indica otro país u otra región que el calendario guardado. Deje las dos celdas vacías, o indique los valores del propio calendario.
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

- **Empiece por los calendarios estándar**: uno por país cubre la mayoría de los presupuestos. Añada una región solo cuando sus festivos difieran, por ejemplo Mosela en Francia o Baviera en Alemania.
- **Un calendario por convenio de jornada**: cuando las personas tienen días libres propios, cree un calendario personalizado para su convenio, no uno por persona.
- **Póngale el nombre de las personas que cubre**: la pestaña Presupuesto muestra el nombre, de modo que "Personal de la sede" dice más que un código.
- **Prepare con antelación el año siguiente en un calendario personalizado**: use **Copiar de** en el año nuevo y después ajuste los meses que difieran. Una línea con precio por día no puede guardarse para un año que su calendario no contiene. Los calendarios estándar no necesitan nada: todos los años ya están ahí.
- **Desactive, no elimine**: cuando un calendario ya no se use para líneas nuevas, desactívelo. Las líneas que lo usan conservan sus importes y todavía pueden guardarse.
