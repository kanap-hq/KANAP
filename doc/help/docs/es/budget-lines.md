# Líneas presupuestarias

Una línea presupuestaria, o línea, es algo que su presupuesto IT paga y que se sigue año tras año. Su **Tipo** indica qué clase de gasto es:

- **OPEX** (gasto operativo): costes recurrentes como licencias de software, suscripciones cloud, contratos de mantenimiento y servicios
- **CAPEX** (gasto de capital): inversiones en activos a largo plazo como compras de hardware, proyectos de infraestructura y equipamiento

Ambos tipos están en una sola lista y se abren en el mismo espacio de trabajo, con columnas presupuestarias año a año, asignaciones y vínculos a proveedores, contratos, aplicaciones y proyectos. El tipo cambia algunas reglas (cuentas, dimensiones, contracargo, congelaciones). [OPEX y CAPEX](#opex-y-capex) las enumera.

## Primeros pasos

Navegue a **Gestión presupuestaria > Líneas presupuestarias** para ver la lista. Haga clic en **Nueva línea** para crear una línea.

El espacio de trabajo se abre en modo de creación, con el título **Nueva línea OPEX** o **Nueva línea CAPEX** y el panel **Propiedades** abierto a la derecha. Su primera fila es **Tipo**: elija **OPEX** o **CAPEX**. Parte del tipo por el que está filtrada la lista en su columna **Tipo** y, si no, de **OPEX**. Escriba el nombre de la línea en el título de arriba, complete las propiedades y haga clic en **Crear**.

**Campos obligatorios**:

- **Título**: En qué gasta o invierte (p. ej., "Licencias Salesforce", "Nueva infraestructura de servidores"). Aparece en la columna **Nombre del producto** de la lista
- **Empresa pagadora**: Qué empresa paga (obligatorio para contabilidad)
- **Cuenta**: La cuenta contable. Solo aparecen las cuentas del plan de cuentas de la empresa pagadora, y solo las que corresponden al tipo de la línea en [Planes de cuentas y gestión de cuentas](chart-of-accounts.md#cuentas-opex-o-capex): **OPEX y CAPEX**, o bien **Solo OPEX** para una línea OPEX y **Solo CAPEX** para una línea CAPEX. Una línea que ya tiene una cuenta del otro tipo la conserva y sigue siendo editable. Elegir una cuenta así en una línea nueva, o al cambiar la cuenta, se rechaza
- **Moneda**: Código ISO (p. ej., USD, EUR). Por defecto la moneda de su espacio de trabajo; puede cambiarla por línea
- **Inicio de vigencia**: Cuándo comienza este gasto (DD/MM/AAAA)
- **Dimensiones obligatorias**: un campo por cada dimensión obligatoria para el tipo de la línea. Un espacio de trabajo nuevo no tiene ninguna dimensión obligatoria. Consulte [Dimensiones recomendadas](#dimensiones-recomendadas)

**Opcional pero útil**:

- **Proveedor**: A quién paga. Vinculado a sus proveedores en datos maestros
- **Centro de coste**: Quién es responsable del gasto. Consulte [Centros de coste](cost-centers.md). Una vez elegida la empresa pagadora, la lista muestra los centros de coste de esa empresa. Cuando la empresa pagadora aún está vacía, elegir un centro de coste la completa con la empresa del centro de coste
- **Run o build**: **Run** para el gasto que mantiene en funcionamiento los servicios existentes, **Build** para el gasto que los crea o los modifica
- **Dimensiones analíticas**: Un campo por dimensión usada para el tipo de la línea, con el nombre de la dimensión, para agrupar a medida en los informes (p. ej., **Software** en **Tipo de coste**). La dimensión por defecto se muestra como **Dimensión analítica** hasta que se le da un nombre. Consulte [Dimensiones analíticas](analytics.md)
- **Fin de validez**: La fecha en que termina esta línea. Déjela en blanco si no hay fin. Después de esa fecha, la línea queda desactivada y los años posteriores dejan de contar en las vistas presupuestarias
- **Responsable de TI** / **Responsable de negocio**: Quién es responsable
- **Descripción** y **Notas**: Texto libre en la pestaña **Vista general**, para ambos tipos

Una vez definidas, **Empresa pagadora** y **Cuenta** se pueden cambiar, pero no vaciar. **Proveedor** se puede borrar en cualquier momento.

Cuando cambia la empresa pagadora de una línea que tiene una cuenta y la nueva empresa usa otro plan de cuentas, la cuenta se borra en el mismo guardado. **Cuenta** aparece entonces como obligatoria, con la lista en el plan de la nueva empresa. Elija la nueva cuenta para terminar.

Una vez creada la línea, el espacio de trabajo desbloquea las cuatro pestañas: **Vista general**, **Presupuesto**, **Asignaciones** y **Relaciones**.

**Consejo**: Puede crear líneas rápidamente y completar presupuestos y asignaciones más tarde. Empiece por lo esencial y vaya iterando.

---

## OPEX y CAPEX

Cada línea tiene un tipo, visible en la columna **Tipo** de la lista y en la primera fila del panel **Propiedades**. La mayor parte del espacio de trabajo funciona igual para ambos. El tipo decide:

- **Cuentas**: una cuenta puede estar como **OPEX y CAPEX**, **Solo OPEX** o **Solo CAPEX**. Consulte [Cuentas OPEX o CAPEX](chart-of-accounts.md#cuentas-opex-o-capex)
- **Dimensiones y valores**: una dimensión o un valor puede usarse solo para un tipo, y una dimensión puede ser obligatoria para un tipo. El panel **Propiedades** muestra solo las dimensiones usadas para el tipo de la línea. Consulte [Dimensiones OPEX o CAPEX](analytics.md#dimensiones-opex-o-capex)
- **Contracargo**: los informes de contracargo se abren en las líneas OPEX y ofrecen las líneas CAPEX o ambas. Consulte [Informes](reports.md)
- **Congelaciones**: una columna presupuestaria se congela por año y por tipo. Consulte [Congelar / descongelar datos](budget-operations.md#congelar-descongelar-datos)

El tipo de una línea se cambia con **Cambiar el tipo…**. Consulte [Cambiar el tipo](#cambiar-el-tipo).

### Dimensiones recomendadas

Un espacio de trabajo nuevo empieza con cuatro dimensiones recomendadas, con sus valores, en el idioma del espacio de trabajo:

| Dimensión | Qué indica |
|---|---|
| **Tipo de coste** | Lo que paga el gasto: hardware, software, personal interno y externo, servicios externos, instalaciones y energía, telecomunicaciones, otros. Es la dimensión por defecto |
| **Dominio TI** | La parte de TI a la que sirve el gasto: centro de datos, cómputo, almacenamiento, red, plataforma, impresión, puesto de trabajo, aplicación, soporte y operación, seguridad y conformidad, gestión de TI |
| **Motivo** | Por qué se gasta el dinero: sustitución, capacidad, productividad, seguridad, conformidad, crecimiento, otro |
| **Prioridad** | Obligatoria, alta, media o baja |

Se aplican a las líneas OPEX y CAPEX y ninguna es obligatoria. Funcionan como cualquier otra dimensión: sus campos están en el panel **Propiedades**, y un administrador puede renombrarlas, añadir valores, hacer obligatoria una de ellas, desactivarlas o eliminarlas. Un administrador puede añadirlas a un espacio de trabajo existente. Consulte [Dimensiones recomendadas](analytics.md#dimensiones-recomendadas) en Dimensiones analíticas.

Los espacios de trabajo creados antes de las dimensiones recomendadas conservan tres dimensiones solo para líneas CAPEX, todas obligatorias: **PP&E type**, **Investment type** y **Priority**. Una línea CAPEX nueva necesita allí un valor en cada una.

---

## Referencias

Cada línea tiene una referencia, por ejemplo `BL-12`, de una sola serie para OPEX y CAPEX. Aparece en la columna **Ref**, en la cabecera del espacio de trabajo y en la dirección de la página (`/ops/budget/BL-12`).

Las líneas creadas antes de la serie única tenían además un número `OPX-12` o `CPX-3`. Estos números siguen funcionando:

- Un enlace o un marcador a una antigua página OPEX o CAPEX abre la línea
- La búsqueda rápida de la lista encuentra una línea por su número anterior
- El archivo de presupuesto los lee en `item_number`. Consulte [Cargar un presupuesto desde una hoja de cálculo](budget-file.md)
- Plaid encuentra una línea por cualquiera de los dos números. Consulte [Plaid](ai-assistant.md#mencionar-registros-con)

---

## Trabajar con la lista

La lista (en **Gestión presupuestaria > Líneas presupuestarias**) reúne las líneas OPEX y CAPEX. Su título indica la moneda de reporte, por ejemplo **Líneas presupuestarias (EUR)**. Todos los importes de la lista están en esa moneda.

**Columnas predeterminadas**:

- **Ref**: La referencia de la línea, por ejemplo `BL-12` (enlaza a la pestaña **Vista general**)
- **Tipo**: **OPEX** o **CAPEX**
- **Nombre del producto**: El título de la línea (enlaza a la pestaña **Vista general**)
- **Proveedor**: El nombre del proveedor
- **Empresa pagadora**: Qué empresa paga esta línea
- **Contrato**: El nombre del último contrato vinculado (enlaza al espacio de trabajo del Contrato)
- **Cuenta**: El número y nombre de cuenta contable
- **Asignación**: La etiqueta del método de asignación del año actual (enlaza a la pestaña **Asignaciones**)
- **Presupuesto A** y **Aterrizaje previsto A**: Los importes del año actual de la columna por defecto y de la última columna visible (enlazan a la pestaña **Presupuesto** de este año). Con la configuración estándar son Presupuesto y Aterrizaje previsto. Cuando la columna por defecto es también la última visible, aparece una sola columna de importe. Consulte [Columnas presupuestarias](budget-operations.md#columnas-presupuestarias)
- **Dimensiones obligatorias**: Una columna por dimensión activada que es obligatoria para alguno de los dos tipos, con el nombre de la dimensión. Un espacio de trabajo nuevo no tiene ninguna
- **Tarea**: El título de la última tarea (enlaza a la pestaña **Vista general**, donde está el panel de tareas)

**Columnas adicionales** (ocultas por defecto, habilítelas mediante el selector de columnas):

- **Columnas de importes**: Cada columna presupuestaria visible para A-1, A, A+1 y A+2, con los nombres que eligió su organización. El encabezado indica la columna, el año respecto a hoy y el año natural, por ejemplo **Revisión A+1 (2027)**. Las columnas ocultas no se ofrecen
- **Columnas de ETC**: El ETC de cada columna presupuestaria visible para A-1, A, A+1 y A+2, con los nombres que eligió su organización, justo después de las columnas de importes en el selector de columnas. El encabezado indica la columna y el año natural, por ejemplo **ETC Presupuesto (2026)**. El ETC de una línea es la suma del ETC de sus líneas de cantidad y precio en esa columna. Consulte [ETC](#etc). La celda queda vacía cuando la columna no tiene líneas
- **ETC declarados**: **Sí** cuando la línea declara ETC en al menos una columna presupuestaria de cualquier año; si no, vacía. Son las líneas que conserva el filtro **Líneas con ETC** de los informes
- **Habilitado**: Estado de la línea (habilitado o deshabilitado)
- **Descripción**: La descripción de la línea
- **Moneda**: Código de moneda ISO
- **Inicio efectivo**: Fecha de inicio
- **Fin de validez**: Fecha en que la línea termina (en blanco significa sin fin)
- **Responsable IT** / **Responsable de negocio**: Usuarios responsables
- **Dimensiones analíticas**: Una columna por dimensión activada, con el nombre de la dimensión y el valor de la línea, en el orden de las dimensiones. La columna de la dimensión por defecto se titula **Dimensión analítica** hasta que se le da un nombre
- **Centro de coste**: El código y el nombre del centro de coste. Pase el cursor por encima para ver su ruta completa en el árbol; haga clic para abrir el centro de coste
- **Responsable del presupuesto**: El responsable del presupuesto del centro de coste de la línea. Se deriva del centro de coste y no se almacena en la línea: cambie el responsable del presupuesto de un centro de coste y todas sus líneas lo siguen
- **Run o build**: **Run** o **Build**
- **Proyecto**: Nombres de los proyectos vinculados en la pestaña **Relaciones**
- **Notas**: Notas internas
- **Creado / Actualizado**: Marcas de tiempo

Una disposición de columnas que haya guardado conserva su propia elección de columnas. La disposición que tenía guardada en la antigua lista OPEX pasa a esta lista.

**Filtrar por tipo**:

- La columna **Tipo** tiene un filtro de casillas con **OPEX** y **CAPEX**. Marque uno para ver solo las líneas de ese tipo
- **Nueva línea** parte del tipo que conserva el filtro. Con ambos tipos, o sin filtro, parte de OPEX
- Una dirección de las antiguas listas OPEX o CAPEX abre esta lista con el filtro **Tipo** aplicado, y conserva la ordenación, la búsqueda y los filtros que llevaba

**Filtrado**:

- **Búsqueda rápida**: Busca en la referencia (`BL-12`, y los antiguos `OPX-12` o `CPX-3`), el nombre del producto, la descripción, el proveedor, la empresa pagadora, la cuenta, el contrato, los nombres de proyectos, la asignación, los responsables, los valores analíticos, el centro de coste (código, nombre y ruta), el responsable del presupuesto, las notas, la moneda y el estado. Filtra la lista en tiempo real mientras escribe, sin distinguir acentos ni mayúsculas y minúsculas
- **Filtros de columna**: Haga clic en el icono de filtro en cualquier encabezado de columna. **Tipo**, **Proveedor**, **Empresa pagadora**, **Cuenta**, **Asignación**, **Moneda**, **Responsable IT**, **Responsable de negocio**, cada dimensión analítica, **Centro de coste**, **Responsable del presupuesto**, **Run o build** y **ETC declarados** usan filtros de conjunto de casillas (selección múltiple). El filtro **ETC declarados** ofrece **Sí** y **No**. El filtro **Habilitado** muestra la opción de **Mostrar** (**Todos**, **Activos** o **Desactivados**): cambiar uno cambia el otro
- **Todos menos algunos**: Marque **Todos** y luego desmarque los valores que quiera excluir: el filtro conserva todo salvo esos (el encabezado muestra, por ejemplo, **Todos menos 3**), y un valor creado más tarde se incluye automáticamente
- **Filtros de importe**: Cada columna de importe tiene un filtro numérico. Un número escrito en el cuadro bajo el encabezado conserva las líneas con al menos ese importe. Abra el menú del filtro para las demás condiciones: mayor que, menor que, igual, distinto o entre dos importes
- **Filtros de ETC**: Cada columna de ETC tiene un filtro numérico con las mismas condiciones, más vacío y no vacío. **Vacío** conserva las líneas cuya columna no tiene líneas de cantidad y precio
- **Filtros de fecha**: **Inicio efectivo**, **Fin de validez**, **Creado** y **Actualizado** tienen filtros de fecha. El cuadro bajo el encabezado muestra el filtro en palabras, con todas sus condiciones, por ejemplo «Vacío o después del 31 dic 2024». Haga clic en él para abrir el menú del filtro (el día, antes de, después de, entre, vacío o no vacío), o haga clic en × para quitar el filtro. **Fin de validez** admite dos condiciones unidas por Y u O, por ejemplo vacío o posterior a una fecha
- **Columnas de texto**: usan filtros de texto, sin distinguir acentos ni mayúsculas y minúsculas. En **Ref**, escriba el número o la referencia completa, por ejemplo `12` o `BL-12`
- **Alcance de estado**: Utilice el conmutador **Mostrar: Todos / Activos / Desactivados** encima de la cuadrícula (predeterminado: **Activos**). **Activos** muestra las líneas sin fin de validez o con un fin de validez en el año en curso o posterior: las líneas que terminan durante el año en curso permanecen en **Activos** hasta el 31 de diciembre. **Desactivados** muestra las líneas que terminaron antes del 1 de enero del año en curso
- **Compartir una vista**: Su orden, búsqueda y filtros se guardan en la dirección web de la página, de modo que recargar la página o compartir el enlace reabre la misma vista. Un enlace cuyos filtros ya no están disponibles muestra «Los filtros de este enlace ya no están disponibles.» Cuando un enlace filtra una columna oculta, por ejemplo una fila de un informe que abre la lista, la lista muestra esa columna justo después del nombre del producto durante esta visita. La disposición de columnas que guardó no cambia. La opción de **Mostrar** también se guarda en la dirección. Una lista abierta desde un informe es una vista de ese informe: lo que cambie en ella queda en su dirección, y la lista abierta desde el menú conserva su propio orden, búsqueda y filtros

**Ordenación**:

- Haga clic en un encabezado de columna para ordenar ascendente/descendente. Todas las columnas se pueden ordenar, incluida cada columna de importe y de ETC. Las líneas sin ETC van al final en orden ascendente
- Las columnas de texto se ordenan en orden de lectura natural: un nombre con tilde se ordena junto a su forma sin tilde (por ejemplo «Électricité» junto a «Electricite»), y las minúsculas van antes que las mayúsculas cuando las letras son iguales
- Una columna de dimensión se ordena según el orden de los valores de la dimensión, definido en [Dimensiones analíticas](analytics.md#ordenar-los-valores), y después por nombre. Las líneas sin valor van al final en orden ascendente
- La ordenación predeterminada es por la columna por defecto del año actual, de mayor a menor (**Presupuesto A** con la configuración estándar). Los botones **Ant.** y **Sig.** del espacio de trabajo siguen el mismo orden
- La lista recuerda su última ordenación, búsqueda y filtros cuando regresa

**Fila de totales**:

- Una sola fila **Total** queda fijada bajo la lista. Muestra **Total (12 líneas)**, con el número de líneas de la lista, y el total de cada columna de importe
- Un icono de candado delante de un total indica que la columna está congelada para ese año. Sigue la congelación de cada tipo que contiene la lista. Si la lista está filtrada por un tipo, el candado aparece cuando ese tipo está congelado. Si contiene ambos tipos, aparece cuando la columna está congelada para los dos. Pase el cursor por encima para leer **Congelado**. Consulte [Congelar / descongelar datos](budget-operations.md#congelar-descongelar-datos)
- Cada columna de ETC visible muestra la suma del ETC de las líneas. Cuando algunas líneas no tienen ETC, el recuento sigue al total, por ejemplo «3.50 · 12 desconocidas». Pase el cursor por encima para ver la frase completa: «Desconocido para 12 líneas». Cuando ninguna línea tiene ETC, el total queda vacío y solo se muestra el recuento
- Los totales respetan sus filtros y búsqueda actuales

**Importes sin tipo de cambio**:

- Cuando la moneda de una línea no tiene tipo de cambio para un año, su importe de ese año aparece en su propia moneda con una pequeña marca naranja. Pase el cursor sobre la marca para leer, por ejemplo, «Sin tipo de cambio de USD para 2026: excluido de los totales.»
- Los totales excluyen estos importes, y un aviso de una línea bajo la lista los indica, por ejemplo «Se excluyen 3 líneas sin tipo de cambio: USD 2026.» Los usuarios de la administración presupuestaria con nivel de administrador ven además **Introducir un tipo**, que abre los ajustes de monedas en el tipo faltante. Cuando el aviso solo cita una moneda y un año, el diálogo del tipo manual se abre directamente.
- En una columna ordenada, estas líneas van al final. Un filtro de importe nunca las conserva.
- Vea [Tipos manuales](currencies.md#tipos-manuales) para introducir usted mismo el tipo que falta.

**Enlace directo**:

- Hacer clic en cualquier celda abre el espacio de trabajo en la pestaña más relevante:
    - **Ref**, **Nombre del producto**, **Proveedor**, **Empresa pagadora**, **Cuenta**, las columnas de dimensión y otras columnas generales: Abre la pestaña **Vista general**
    - **Columnas de importes** (Presupuesto A, Aterrizaje previsto A, Revisión A+1, etc.) y **Columnas de ETC**: Abre la pestaña **Presupuesto** preconfigurada en el año de la columna
    - **Asignación**: Abre la pestaña **Asignaciones** para el año actual
    - **Tarea**: Abre la pestaña **Vista general**, donde está el panel de tareas
    - **Contrato**: Abre directamente el espacio de trabajo del Contrato vinculado
    - **Centro de coste**: Abre el espacio de trabajo del centro de coste

**Acciones**:

- **Nueva línea**: Crear una línea (requiere `budget:member`)
- **Importar**: Carga masiva de líneas desde un archivo de presupuesto (requiere `budget:admin`)
- **Exportar**: Exportar las líneas a un archivo de presupuesto (requiere `budget:admin`)
- **Eliminar seleccionadas**: Eliminación masiva de líneas seleccionadas (requiere `budget:admin`; seleccione filas mediante casillas de verificación). Una línea con importes en una columna congelada no se puede eliminar. Antes de eliminar nada, la confirmación enumera las líneas que se conservan, con la columna congelada. Las demás se eliminan

**Navegación Anterior/Siguiente**:

- Cuando abre una línea, el espacio de trabajo muestra los botones **Ant.** y **Sig.** y un contador, por ejemplo «Línea 3 de 47»
- Estos navegan por la lista en el orden actual, respetando filtros y búsqueda
- Pasar a otra línea guarda primero sus cambios pendientes
- Su contexto de lista (ordenación, filtros, búsqueda) se preserva cuando cierra el espacio de trabajo

**Consejo**: Utilice filtros de columna y búsqueda rápida para construir vistas enfocadas (p. ej., "Todo el gasto en nube superior a 10k", o **CAPEX** en **Tipo** con **High** en **Priority**), luego navegue línea por línea con **Ant.**/**Sig.** para revisar presupuestos.

---

## El espacio de trabajo

Haga clic en cualquier fila de la lista para abrir el espacio de trabajo. Su dirección nombra la línea por su referencia, por ejemplo `/ops/budget/BL-12/overview`. Tiene cuatro partes:

- **Cabecera**: la referencia de la línea (p. ej., `BL-12`) con un botón para copiarla, el título de la línea (haga clic en él para cambiar el nombre de la línea), **Ant.** / **Sig.**, **Compartir** y el botón de cierre
- **Barra de metadatos** bajo el título: **Estado**, **Responsable de TI** y **Responsable de negocio**, editables en el sitio. Cuando el centro de coste de la línea tiene un responsable del presupuesto, **Responsable del presupuesto** aparece a continuación. Es de solo lectura y se deriva del centro de coste, no se almacena en la línea: pase el cursor por encima para ver de qué centro de coste procede, y cámbielo en el centro de coste (consulte [Centros de coste](cost-centers.md#responsable-del-presupuesto-en-las-lineas-de-presupuesto))
- **Cinco pestañas**: **Vista general**, **Presupuesto**, **Asignaciones**, **Relaciones** (la pestaña Relaciones muestra cuántos vínculos tiene la línea) e **Historial**
- **Panel Propiedades** a la derecha: los campos principales de la línea, empezando por **Tipo** (con **Cambiar el tipo…** junto a él en una línea existente, consulte [Cambiar el tipo](#cambiar-el-tipo)). Ábralo o ciérrelo con el botón de propiedades; el espacio de trabajo recuerda su elección

**Elección de responsables**:

- En el panel **Propiedades** de una línea nueva y en la barra de metadatos de una línea existente, las listas **Responsable de TI** y **Responsable de negocio** empiezan, bajo **Acceso al centro de coste**, por las personas que tienen acceso al presupuesto y pueden leer las líneas del centro de coste de la línea. Las demás siguen tras un separador
- Al escribir se busca entre todas las personas, como antes. Puede elegir a cualquiera
- Sin centro de coste, la lista es la habitual. El grupo no aparece cuando incluiría a todo el mundo, por ejemplo cuando nadie tiene un [acceso a los datos](data-access.md) limitado
- Cuando su propio acceso a los datos está limitado, el grupo aparece para los centros de coste de su acceso y para la línea que está editando
- Elegir a un responsable le da acceso a la línea

**Guardado automático**:

- Cada cambio se guarda automáticamente. La indicación **Guardando...** / **Guardado** aparece en la cabecera
- Cambiar de pestaña, pasar a la línea anterior o siguiente, o cerrar el espacio de trabajo guarda primero los cambios pendientes. Si un guardado falla, usted se queda donde está y un mensaje explica el motivo, de modo que ningún cambio se pierde sin que lo sepa
- **Ctrl+S** (**Cmd+S** en Mac) guarda de inmediato
- Si un guardado no puede completarse de inmediato porque hay otro guardado en curso sobre los mismos datos, KANAP lo reintenta automáticamente
- Si hay una operación de presupuesto masiva en curso (por ejemplo, una copia o un restablecimiento de columna en la Administración presupuestaria), las ediciones aquí se detienen con el mensaje «Hay otra operación de presupuesto en curso. Vuelva a intentarlo cuando haya terminado.» Vuelva a intentarlo cuando haya terminado

**Edición simultánea**:

- Dos personas pueden trabajar en la misma línea a la vez sin estorbarse. Editar campos distintos, meses de presupuesto distintos o columnas de presupuesto distintas nunca genera un conflicto, incluso en la misma línea y en el mismo momento
- Cuando otra persona cambia el mismo campo, la misma columna de presupuesto o la asignación mientras usted la está editando, un aviso muestra su valor y el de usted, con quién lo cambió y cuándo. Elija **Conservar el otro valor** para quedarse con el suyo, o **Aplicar mi valor** para conservar lo que escribió. Para una columna de presupuesto, las opciones son **Recargar la columna** o **Sobrescribir**; para la asignación, **Recargar la asignación** o **Sobrescribir**
- Solo el campo, la columna o la asignación que cambió espera su decisión; todo lo demás sigue guardándose con normalidad
- Una decisión pendiente se conserva al cambiar de pestaña. Se pierde, tras un aviso, si sale de la línea o cambia de año
- Si el cambio anterior fue suyo, desde otra ventana o pestaña, el aviso lo indica así en lugar de nombrar a otra persona

### Vista general

La pestaña Vista general contiene los campos de texto libre y las tareas de la línea.

**Qué puede editar**:

- **Descripción**: Qué cubre la línea
- **Notas**: Notas internas de texto libre

Cuando la línea sustituye a otra, o fue sustituida a partir de un año posterior tras un cambio de tipo, la parte superior de la pestaña enlaza las dos líneas: **Sustituida por** en la línea más antigua, **Sucede a** en la más reciente.

**Panel de tareas**:

- Muestra todas las tareas vinculadas a esta línea, con las columnas **Título**, **Estado**, **Prioridad**, **Fecha de vencimiento** y **Acciones**. El título del panel indica el número de tareas
- Filtro **Estado**: Todos (por defecto), Activas (no completadas), Abierta, En curso, Pendiente, En pruebas, Completada o Cancelada. El botón de borrar lo restablece
- Haga clic en **Agregar tarea** para abrir una tarea nueva ya vinculada a esta línea. Complete el título, la descripción, la prioridad, el responsable y la fecha de vencimiento en el espacio de trabajo de la tarea
- Use el icono de abrir para ir a una tarea y el icono de eliminar para borrarla (tras confirmar)
- Las tareas tienen sus propios permisos (`tasks:member` para crear y editar). El nivel Miembro en Presupuesto no da por sí solo derechos de edición de tareas; consulte a su administrador si no puede crear tareas
- Las tareas también se pueden ver y gestionar desde **Portafolio > Tareas**, que muestra todas las tareas de su organización

**Panel Propiedades**:

- **Tipo**: **OPEX** o **CAPEX**. En una línea existente, **Cambiar el tipo…** junto a él abre el diálogo descrito en [Cambiar el tipo](#cambiar-el-tipo)
- **Proveedor**, **Centro de coste**, **Empresa pagadora**, **Cuenta** (filtrada por el plan de cuentas de la empresa pagadora y el tipo de la línea), **Moneda** (solo las monedas permitidas en su espacio de trabajo), un campo por dimensión analítica usada para el tipo de la línea, **Run o build** e **Inicio de vigencia**
- **Ciclo de vida**: el interruptor de estado, cuya etiqueta muestra el estado actual (**Activado** o **Desactivado**), y la fecha de **Fin de validez**. Consulte [Estado y ciclo de vida](#estado-y-ciclo-de-vida)
- Fechas **Creado** y **Actualizado** (solo lectura)
- Escriba en **Proveedor**, **Empresa pagadora**, **Cuenta**, **Responsable de TI**, **Responsable de negocio** o un campo de dimensión analítica para buscar por nombre. Las coincidencias aparecen mientras escribe, de modo que puede encontrar cualquier valor incluso en una lista muy larga; una línea bajo la lista muestra «Escriba para acotar: hay más resultados» cuando hay más coincidencias de las que se muestran

**Centro de coste**:

- La lista muestra el árbol de centros de coste. Los grupos se muestran para ayudarle a orientarse y no se pueden elegir. Busque por código, nombre o nombre de grupo
- Cuando la empresa pagadora está elegida, la lista muestra solo los centros de coste de esa empresa, con los grupos por encima de ellos. Una línea que ya tiene un centro de coste de otra empresa lo conserva en la lista. Cuando la empresa no tiene ningún centro de coste, la lista lo indica
- Un centro de coste desactivado aparece marcado como **Desactivado**. Se mantiene en las líneas que ya lo tienen y no se puede elegir para otra línea
- Cuando crea una línea y la empresa pagadora está vacía, la lista muestra todos los centros de coste. Elegir uno completa la empresa pagadora con la empresa del centro de coste, de modo que la lista **Cuenta** se abre en el plan de cuentas de esa empresa. Hasta que usted elija una empresa o una cuenta, la lista conserva todos los centros de coste y elegir otro también actualiza la empresa
- Cuando cambia la empresa pagadora, un centro de coste de otra empresa se borra en el mismo guardado. **Centro de coste** muestra entonces los centros de coste de la nueva empresa
- Una línea cuyo centro de coste pertenece a otra empresa, desde un archivo o la API, conserva ambas. Una indicación bajo el campo dice "Este centro de coste pertenece a" seguido del nombre de la empresa
- Una línea guardada mediante la API con un centro de coste y sin empresa pagadora toma la empresa del centro de coste. Para los archivos importados, consulte [Importación/exportación CSV](#importacionexportacion-csv)

**Run o build**: **Run**, **Build** o **Sin definir**. Úselo para repartir el presupuesto entre mantener los servicios en funcionamiento y modificarlos.

**Dimensiones analíticas**:

- Cada dimensión activada usada para el tipo de la línea tiene su propio campo, con el nombre de la dimensión, en el orden de las dimensiones. Una dimensión usada solo para el otro tipo no tiene campo, y el valor que una línea tenga en ella sigue oculto. Elija un valor o vacíe el campo; el cambio se guarda de inmediato
- Cada campo lista los valores activados de su dimensión. Un valor desactivado se mantiene en las líneas que ya lo tienen y no se puede elegir para otra línea
- Un valor usado solo para el otro tipo no se ofrece, y elegirlo como valor nuevo se rechaza. Una línea que ya lo tiene lo conserva y sigue siendo editable. Consulte [Valores OPEX o CAPEX](analytics.md#valores-opex-o-capex)
- El campo no puede crear un valor: créelo en [Dimensiones analíticas](analytics.md) o deje que lo cree una importación
- Una dimensión obligatoria está marcada con un asterisco. Una línea nueva necesita un valor en ella: **Crear** se detiene con "El campo Tipo de coste es obligatorio" hasta que elija uno. En una línea que tiene un valor, el campo no se puede vaciar, solo cambiar. Una línea sin valor sigue siendo editable. Si modifica una línea así, al salir se le pregunta primero: "El campo Tipo de coste es obligatorio. Elija un valor antes de salir." **Quedarse** coloca el cursor en el campo que falta. **Salir de todos modos** sale de la línea. Consulte [Dimensiones obligatorias](analytics.md#dimensiones-obligatorias)
- Si las dimensiones no se pueden cargar, una línea sustituye a estos campos: "No se pudieron cargar las dimensiones."

**Consejo**: Al crear una línea, una advertencia de "Cuenta obsoleta" significa que la cuenta seleccionada no pertenece al plan de cuentas de la empresa pagadora. Elija otra cuenta para resolver la advertencia. Una línea existente cuya cuenta está fuera del plan de su empresa se puede seguir editando: el plan solo se comprueba cuando cambia la empresa o la cuenta.

---

### Presupuesto

La pestaña Presupuesto contiene los importes de la línea, año por año y columna por columna. Para el año elegido, elija una columna, indique cómo se construye y lea después el resultado mes a mes.

**Selección de año**:

- Utilice las pestañas de año en la parte superior para alternar entre A-2, A-1, A (año actual), A+1 y A+2
- Cada año tiene sus propios importes
- Al cambiar de año se guardan primero sus cambios pendientes. Si una columna sigue pendiente de su elección tras el cambio de otra persona, KANAP pregunta primero: **Cambiar de año** descarta sus valores en esa columna

**Columnas presupuestarias**:

- La pestaña muestra las columnas que muestra su organización, con sus nombres, siempre en el mismo orden. Las columnas estándar son:
    - **Presupuesto**: Presupuesto anual inicial aprobado a principios de año
    - **Revisión**: Actualización presupuestaria a mitad de año (p. ej., tras una reprevisión o un cambio de alcance)
    - **Previsión**: Una columna de planificación adicional, oculta por defecto
    - **Realizado**: El gasto real, tal como se registra durante el año
    - **Aterrizaje previsto**: Su mejor estimación de la cifra de fin de año
- Un administrador de presupuesto puede renombrar las columnas, ocultar algunas y elegir la columna por defecto en **Gestión presupuestaria > Administración > Columnas presupuestarias** (consulte [Columnas presupuestarias](budget-operations.md#columnas-presupuestarias)). Una columna oculta conserva sus importes
- Cada columna visible tiene una tarjeta bajo las pestañas de año: su nombre, su total del año, el origen de sus importes y su periodo, por ejemplo «Reparto uniforme» y «9 meses, abril a diciembre». Una columna vacía indica «Aún sin introducir». Pase el cursor sobre una tarjeta para ver sus líneas de cantidad y precio
- Haga clic en una tarjeta para trabajar en esa columna. La pestaña se abre en la primera columna visible que no está congelada
- Con una sola columna visible no hay tarjetas: el editor muestra la columna directamente

**Periodo de una columna**:

- Cada columna tiene un periodo dentro del año, por ejemplo de abril a diciembre
- Un mes cuenta cuando el periodo cubre su día 15. Un periodo que empieza el 10 de abril incluye abril; uno que empieza el 20 de abril comienza en mayo
- Una columna sin importe y sin periodo recibe una sugerencia: el **Inicio de vigencia** y el **Fin de validez** de la línea, limitados al año. Una línea que empieza el 1 de abril sugiere de abril a diciembre
- Una columna que ya tiene importes y no tiene periodo se lee como todo el año, de modo que los datos existentes se comportan como antes
- Cuando el periodo guardado de una columna va más allá de las fechas de la línea, el editor indica el periodo que usa un guardado, por ejemplo «Periodo guardado: enero a diciembre. Al guardar se usará abril a diciembre, según las fechas de la línea.»

**Cómo se construye una columna**:

El editor bajo las tarjetas lleva el nombre de la columna y el año, por ejemplo **Presupuesto 2026**. Tres pestañas indican cómo se construye la columna:

- **Importe**: un importe anual, repartido entre los meses
- **Cantidad y precio**: líneas, cada una una cantidad por un precio unitario. Consulte [Cantidad y precio](#cantidad-y-precio)
- **Por mes**: doce importes introducidos en la tabla

Las tres pestañas se ofrecen siempre. Una columna se abre en la pestaña que corresponde al origen de sus importes: **Cantidad y precio** cuando se calculan a partir de sus líneas, **Por mes** tras una edición a mano, e **Importe** para una columna vacía, repartida o copiada.

En una columna vacía, un clic en una pestaña cambia de inmediato. En una columna con importes, aparece primero una pregunta en el editor que dice qué cambia. Haga clic en **Cambiar** para seguir, o en **Cancelar**:

- A **Importe**: el total actual pasa a ser el importe, repartido de forma uniforme en el periodo de la columna. Las líneas de la columna se conservan como referencia
- A **Por mes**: los meses actuales se conservan y pasan a ser editables en la tabla
- A **Cantidad y precio**: el total viene de las líneas. El importe actual se sustituye, o las líneas conservadas como referencia se vuelven a usar

**Importe**:

- **Importe anual**: el total de la columna para el año
- **Cuándo**: **Todo el año**, **Un periodo** con las fechas **Desde** y **Hasta**, o **En una fecha** con una sola **Fecha**
- **Distribución**: **Uniforme** o **4-4-5**. En una fecha no hay distribución: el mes de la fecha recibe todo el importe
- Una frase indica lo que obtiene, por ejemplo «120.000 repartidos de forma uniforme de abril a diciembre (9 meses).» o «5.000 el 10 de febrero de 2026, todo en febrero.» Pase el cursor sobre el icono de información junto a ella para leer la regla del día 15
- Cuando algunos meses del año quedan fuera del periodo, una nota indica cuáles se pondrán a cero, por ejemplo «Enero a marzo se pondrán a cero.»
- Aparece una advertencia cuando el periodo va más allá de las fechas de la línea. El importe se guarda de todos modos
- Mientras falte una fecha o ningún mes cuente, una nota en rojo explica el motivo y no se guarda nada. Cuando las fechas de la línea no dejan ningún mes en el año, el editor indica «Ningún mes de 2026 está dentro de las fechas de la línea.» Elija **Un periodo** para fijar las fechas usted mismo
- **Cada cambio se guarda de inmediato**: el importe al salir del campo o pulsar Intro, los demás campos en cuanto los cambia. No hay ningún botón que pulsar. Un importe vacío o cero no guarda nada
- Con **4-4-5**, los pesos de los meses que cuentan se aumentan para que todo el importe recaiga en ellos
- Para volver a un reparto uniforme en doce meses, elija **Todo el año** y **Uniforme**
- Un reparto sobre una columna construida a partir de líneas conserva sus líneas como referencia. Consulte [Cantidad y precio](#cantidad-y-precio)

**Por mes**:

- El editor indica, por ejemplo, «Introduzca los importes en la columna Presupuesto de la tabla de abajo.» Introduzca cada mes en esa columna de **Resultado por mes**. Los subtotales trimestrales y el total se actualizan mientras escribe. Solo se guardan los meses que cambia
- Úselo para seguir un plan de pagos o los hitos de un proyecto, por ejemplo todo el importe en un solo mes
- Haga clic en un mes de otra columna de la tabla para introducir esa columna por mes: pasa a ser la columna activa y el cursor se sitúa en ese mes. En una columna con importes, el editor pregunta primero. Pase el cursor sobre un mes para leer «Introducir por mes». Los meses de una columna congelada no se pueden pulsar

**Partir de**:

- Una columna vacía, sin importe ni línea, puede partir de otra columna visible que tenga importes. El editor indica «Partir de», luego la columna con su total, «ajustado en», un porcentaje (0 por defecto) y **Copiar**. También puede introducir la columna usted mismo debajo
- **Copiar** funciona como [Copiar columnas presupuestarias](budget-operations.md#copiar-columnas-presupuestarias) en esta línea y este año: los meses conservan su forma y el porcentaje se aplica a cada uno. Una columna calculada a partir de sus líneas sigue calculada, con sus precios unitarios aumentados en el porcentaje. Una columna congelada puede servir de origen
- Cuando las fechas de la línea excluyen meses del origen, no se copian, y una nota lo indica: «Los meses de la columna Presupuesto fuera de las fechas de la línea no se copiaron.»

**Usar también para otras columnas**:

- Bajo el editor, **Usar también para otras columnas…** da a otras columnas la misma construcción que la columna activa. El enlace aparece cuando la columna activa es un importe con un periodo válido, o sigue sus líneas de cantidad y precio, y otra columna puede recibirla
- El enlace lista las demás columnas visibles bajo **Misma construcción para**, cada una con una casilla. Las columnas configuradas para seguir en [Columnas presupuestarias](budget-operations.md#columnas-presupuestarias) aparecen marcadas al principio. Haga clic en **Aplicar**, o en **Cancelar**
- Desde un importe, las columnas marcadas toman su periodo y su distribución, y cada una conserva su propio total. Las columnas que siguen sus líneas no se ofrecen, y una frase las nombra, por ejemplo «Previsión conserva sus líneas.»
- Desde cantidad y precio, las columnas marcadas reciben las mismas líneas, que sustituyen sus importes
- Las columnas congeladas y las columnas pendientes de su elección no se ofrecen

**Borrar columna**:

- **Borrar columna**, a la derecha bajo el editor, pone a cero todos los meses de la columna activa, por ejemplo antes de introducir todo el importe en un solo mes. Cuando la columna tiene importes, primero confirma: «¿Borrar todos los meses de la columna Presupuesto en 2026? Las demás columnas no cambian.» Cuenta como una edición a mano
- Para eliminar a la vez los importes y el periodo de una columna en todas las líneas, use **Restablecer columna presupuestaria** en la Administración presupuestaria

**Resultado por mes**:

- Bajo el editor, **Resultado por mes** muestra el año mes a mes para cada columna visible, en la moneda de la línea, con un subtotal por trimestre (**T1** a **T4**) y una fila **Total**. La columna activa aparece resaltada
- Con dos columnas o más, una última fila da la diferencia de cada columna con una de ellas, por ejemplo «+12.000 (+1,8 %)». Elija esa columna en **Diferencia con** encima de la tabla. Parte de la columna por defecto
- Mientras cada columna esté vacía, o sea un importe repartido de forma uniforme en todo el año, una frase sustituye la tabla, por ejemplo «Todas las columnas se reparten de forma lineal en todo el año: el detalle mensual no aporta nada más.» **Mostrar el detalle** abre la tabla y **Ocultar el detalle** la vuelve a plegar. Su elección se mantiene mientras siga en la línea
- La tabla sigue abierta mientras la columna activa se introduce por mes o una columna está pendiente de su elección

**Volver a los valores de apertura**:

- La pestaña conserva los valores que tenía cada columna de un año cuando abrió ese año por primera vez durante su visita a la línea. Cambiar de pestaña o de año los conserva. Recargar la página vuelve a partir de los valores de ese momento
- En cuanto cambia una columna, a la derecha de las pestañas de año aparece, por ejemplo, «2 columnas modificadas desde las 10:42», seguido de **Volver a los valores de apertura**
- Haga clic en él para devolver las columnas que cambió a esos valores. No hay confirmación. Sus cambios en curso se guardan primero, y luego cada columna se restaura por separado
- Una nota indica el resultado, por ejemplo «Valores de apertura restaurados: Presupuesto y Revisión.» Una columna queda como está cuando se congeló mientras tanto, cuando otra persona la cambió desde entonces (el aviso de arriba pregunta entonces qué conservar), o mientras esté pendiente de su elección. Una columna que solo cambió otra persona nunca se restaura. Cierre la nota con **Cerrar**
- Si un cambio en curso no se puede guardar, no se restaura nada: «No se restauró nada: un cambio no se pudo guardar antes.»
- El registro de auditoría anota cada columna restaurada con la acción **Restaurar**

**Comportamiento de congelación**:

- Si las columnas presupuestarias de un año están congeladas para el tipo de la línea (a través de la Administración presupuestaria), la tarjeta de cada columna congelada muestra un candado, igual que su cabecera en la tabla
- Una columna congelada es de solo lectura. Su editor indica, por ejemplo, «La columna Presupuesto 2026 está congelada» y «Solo lectura. Un administrador puede descongelarla en Administración › Congelar / descongelar datos.», con su total y el origen de sus importes
- Cuando hay columnas congeladas, una línea bajo el gráfico indica «Algunas columnas están congeladas y son de solo lectura.»
- Cada columna puede congelarse de forma independiente

**Cómo se produjo cada columna**:

- Una etiqueta corta en cada tarjeta indica de dónde vienen los importes de la columna, seguida de su periodo. Con una sola columna, está bajo el título del editor
- **Reparto uniforme**, **Reparto 4-4-5** o **Reparto por trimestre**: los importes vienen de un reparto
- **Copiado de Presupuesto 2025 +2 %**: los importes vienen de **Copiar columnas presupuestarias** en la Administración presupuestaria, o de **Partir de**, con el porcentaje cuando lo hay
- **Cantidad y precio · 3 líneas · 1.00 ETC**: los importes vienen de líneas, con su número y, cuando las líneas cuentan personas o días, el ETC de la columna. El ETC es la media del año. Pase el cursor sobre la tarjeta para ver las líneas, por ejemplo «Jefe de proyecto: 1 persona × 1.200 por día, 5 días al mes, feb. a jul.»
- **Editado a mano**: un mes se cambió en la tabla o mediante la importación de un archivo de presupuesto
- Un importe en una fecha muestra su fecha en lugar de un periodo, por ejemplo «El 10 de febrero de 2026»
- Una columna sin etiqueta conservó los datos que tenía antes de que existieran los periodos

**Cuando otra persona edita la misma columna**:

- Dos personas pueden rellenar meses o columnas distintos de la misma línea a la vez, sin conflicto
- En una entrada mensual, si otra persona cambió alguno de los mismos meses, esos meses esperan su decisión; los demás meses de la columna se guardan como usted los escribió
- Si otra persona cambió el total de la columna, su reparto o sus líneas de Cantidad y precio mientras usted trabajaba en ellas, toda la columna espera: un aviso ofrece **Recargar la columna** o **Sobrescribir**. Su tarjeta muestra un punto naranja (pase el cursor sobre él para leer «Pendiente de su elección») y sus meses aparecen teñidos. El editor queda en solo lectura hasta que decida, con la línea «Elija primero, arriba, si recarga esta columna o la sobrescribe.»
- Guardar recarga el año, así que siempre ve las cifras más recientes de cualquier otra columna; la celda o columna que está editando no se ve afectada

**Tendencia plurianual**:

- Un gráfico bajo la tabla muestra cada columna visible a lo largo de los años, incluida Previsión cuando se muestra, y se actualiza mientras escribe

**Cómo usarlo**:

1. Seleccione el año que está planificando
2. Haga clic en la tarjeta de la columna que va a rellenar (Presupuesto para la planificación inicial, Realizado para el seguimiento, Aterrizaje previsto para la cifra de fin de año)
3. Elija **Importe**, **Cantidad y precio** o **Por mes**, y rellénela
4. Lea el resultado en **Resultado por mes**. Sus cambios se guardan automáticamente; junto a las pestañas de año aparece la indicación **Guardando...** / **Guardado**

**Consejo**: Para la mayoría de las líneas basta un importe en todo el año o en un periodo. Use **Por mes** cuando el gasto varía mucho de un mes a otro (p. ej., licencias estacionales, costes de puesta en marcha puntuales, despliegues por fases). Para rellenar una columna nueva a partir de una existente, use **Partir de**.

#### Cantidad y precio

Construya una columna a partir de líneas en lugar de escribir sus importes. Cada línea se lee como una frase: una cantidad, una unidad, un precio unitario, una frecuencia, cuándo y con qué calendario. Por ejemplo, un jefe de proyecto 5 días por mes a 1.200 por día de febrero a julio, y 50 licencias a 12 por pieza por mes. Los meses de la columna son la suma de sus líneas. Los importes de una columna tienen una sola fuente a la vez: sus líneas, o un reparto, un mes escrito a mano o una copia. La otra fuente sigue visible como referencia, de solo lectura, con un enlace para cambiar.

**Abrirla**: haga clic en la tarjeta de la columna y después en la pestaña **Cantidad y precio** del editor. Una columna calculada a partir de sus líneas se abre en esa pestaña. Las líneas de una columna congelada son de solo lectura.

**Las líneas**:

| Columna | Qué introducir |
|---|---|
| **Descripción** | Lo que paga la línea, por ejemplo «Jefe de proyecto». Opcional, hasta 200 caracteres |
| **Cantidad** | Cuántas, en la unidad de la línea. Cero o más, hasta 3 decimales |
| **Unidad** | **personas**, **días** o **piezas**. La unidad decide a qué corresponde el precio, con qué frecuencia cuenta, cómo se reparte el importe entre los meses y el ETC |
| **Precio unitario** | El precio de una unidad, en la moneda de la línea. Hasta 4 decimales. Se acepta un precio negativo, para un abono. A qué corresponde el precio aparece justo después: **por día** para los días, **por pieza** para las piezas y, para las personas, una pequeña lista para elegir **por día** o **por mes** |
| **Frecuencia** | Depende de la unidad. Personas con precio por día: una casilla **Tiempo completo** y, cuando no está marcada, los **días por mes** que trabajan en la línea (más de 0, hasta 31, con hasta 3 decimales). Personas con precio por mes: «por mes». Días: «en el periodo». Piezas: una lista para elegir **por mes** o **una vez** |
| **Desde** / **Hasta** | El periodo de la línea, dentro del año. Un mes cuenta cuando el periodo cubre su día 15, como en un reparto. Las piezas compradas una vez llevan en su lugar una sola **Fecha** y recaen en su mes. Cuando todas las líneas llevan una fecha, el encabezado indica **Fecha** |
| **Calendario** | Solo se muestra para un precio por día: personas con precio por día, y días. El calendario laboral cuyos días cuentan. La lista ofrece los calendarios activados, más el calendario que ya usa una línea si se desactivó después, marcado «(desactivado)». Cuando aún no hay ningún calendario, la pestaña indica «Aún no hay ningún calendario laboral.», con un enlace **Añadir un calendario** para quienes pueden crear calendarios. Consulte [Calendarios laborales](working-day-calendars.md) |
| **Importe** | El total de la línea, una vez guardada. Solo lectura |

Cada línea tiene un número en el margen. Cuando la columna tiene varias líneas, las notas bajo la tabla lo usan, por ejemplo «Línea 2: Introduzca una cantidad y un precio unitario para guardar esta línea.»

Cuando la pestaña es lo bastante ancha, cada línea ocupa una sola fila. En un panel más estrecho, cada línea ocupa dos filas. La primera se lee como un cálculo: **Descripción**, **Cantidad**, **Unidad**, × **Precio unitario** e **Importe**. La segunda se lee como una frase: **Frecuencia**, «del» una fecha «al» una fecha (o una sola **Fecha**), «calendario» y el **Calendario**. En un panel de anchura media, **Frecuencia** sube a la primera fila. Cerrar el panel **Propiedades** da más espacio a las líneas.

Haga clic en **Añadir una línea** bajo la tabla para añadir una línea, y en la cruz al final de una línea para quitarla. Una columna admite hasta 50 líneas.

**Unidades y precios**:

| Unidad | Precio | Frecuencia | Importe de cada mes del periodo | ETC de cada mes |
|---|---|---|---|---|
| **personas** | **por día** | **Tiempo completo** | Los días laborables del mes en el calendario × cantidad × precio unitario | La cantidad |
| **personas** | **por día** | **5 días por mes** | 5 × cantidad × precio unitario | Cantidad × 5 ÷ los días laborables del mes en el calendario |
| **personas** | **por mes** | por mes | Cantidad × precio unitario | La cantidad |
| **días** | **por día** | en el periodo | Cantidad × precio unitario, contado una vez y repartido uniformemente entre los meses del periodo | La parte de los días que corresponde al mes ÷ los días laborables del mes en el calendario |
| **piezas** | **por pieza** | **por mes** | Cantidad × precio unitario | Ninguno |
| **piezas** | **por pieza** | **una vez** | Cantidad × precio unitario, en el mes de la fecha | Ninguno |

- Use **personas** para el personal que trabaja en la línea mes tras mes. Con precio por día, indique cuánto trabajan: marque **Tiempo completo** para contar todos los días laborables del calendario desde el inicio hasta el fin de la línea, o introduzca los días por mes. Por ejemplo, un jefe de proyecto 5 días por mes a 1.200 por día de febrero a julio cuesta 6.000 al mes. En un calendario con 21 días laborables en marzo, ese mes cuenta 5 ÷ 21, unos 0.24 ETC. Un consultor a tiempo completo a 400 por día cuesta cada mes los días laborables del mes × 400, y cuenta 1 ETC
- Con precio por mes, las personas cuestan cada mes la cantidad × el precio unitario, por ejemplo 1 persona a 8.000 por mes
- Use **días** para un número de días contratados para el periodo, como un solo paquete. Por ejemplo, 30 días a 1.200 por día de febrero a julio dan 36.000, es decir 6.000 al mes. Cada mes tiene 5 días: en un mes con 20 días laborables, la línea cuenta 0.25 ETC
- Use **piezas** para licencias, equipos o suscripciones. Por mes, cuentan en cada mes del periodo: 50 licencias a 12 por pieza dan 600 al mes. Una vez, llevan una fecha y recaen en su mes: un portátil a 2.000 el 15 de marzo recae en marzo. Las piezas nunca cuentan como ETC
- Cada mes se redondea al céntimo. Cuando un importe se reparte a lo largo del periodo, la diferencia de redondeo recae en el último mes. Los meses fuera del periodo de una línea no reciben nada de ella
- Al cambiar la unidad, el resto de la línea se adapta. Las personas conservan un precio por mes cuando lo eligió, y si no tienen un precio por día. Los días tienen un precio por día, en el periodo. Las piezas tienen un precio por pieza y se compran una vez, con la fecha de inicio del periodo de la columna. Pasar unas piezas de una vez a por mes les devuelve el periodo de la columna

**Una línea nueva** empieza con la unidad **personas**, una cantidad de 1, un precio por día, **Tiempo completo** sin marcar con los días por mes por introducir, el periodo de la columna (el año completo cuando la columna no tiene ninguno) y el calendario por defecto. El calendario por defecto es el calendario estándar del país de la empresa pagadora o, si no existe, el primer calendario activado. Introduzca el precio unitario y los días por mes, o marque **Tiempo completo**, y la línea se guarda. Sin un calendario activado, una línea nueva empieza con un precio por mes.

**Guardado**: cada campo se guarda al salir de él, al pulsar Intro o al elegir un valor o una fecha. No hay ningún botón que pulsar. Cada guardado envía todas las líneas completas de la columna, y los meses de la columna se actualizan de inmediato. La indicación **Guardando...** junto a las pestañas de año aparece mientras tanto.

- Una línea está completa cuando tiene una cantidad, un precio unitario, un periodo o una fecha válidos, los días por mes o **Tiempo completo** para las personas con precio por día, y un calendario para un precio por día. Hasta entonces permanece en pantalla con una indicación, por ejemplo «Introduzca una cantidad y un precio unitario para guardar esta línea.», «Introduzca los días por mes o marque Tiempo completo.» o «Elija un calendario para un precio por día.», y las líneas guardadas no cambian
- Quitar la última línea quita las líneas de la columna, y sus importes se mantienen. Una columna calculada a partir de sus líneas cuenta entonces como importes introducidos a mano. Una columna repartida o copiada conserva su reparto o su copia
- Cuando se rechaza un guardado, el motivo aparece en rojo bajo la tabla, y lo que escribió se mantiene. Por ejemplo, «Personal de la sede has no working days for 2027. Add them on the Working-day calendars page.» cuando un calendario personalizado aún no contiene el año
- En una columna congelada, las líneas son de solo lectura. También son de solo lectura mientras la columna las conserva como referencia, vea la parte siguiente

**Bajo la tabla**:

- El ETC de las líneas, cuando una línea cuenta personas o días, por ejemplo «ETC en el periodo 0.24 · Media anual 0.12». Consulte [ETC](#etc). El total de la columna aparece en la propia columna
- De dónde vienen los importes, cuando ya no vienen de las líneas: una de las frases del apartado siguiente
- Notas cuando corresponde: «El periodo va más allá de las fechas de la línea.», un calendario desactivado después, por ejemplo «Personal de la sede está desactivado. Las líneas aún lo usan.», y días laborables modificados desde el último guardado de las líneas
- Para dar las mismas líneas a otras columnas, use **Usar también para otras columnas…** bajo el editor. Consulte [Presupuesto](#presupuesto)

**Cuando los importes cambian de otra forma**: las líneas se quedan en la columna como referencia, en solo lectura. Bajo **Importe** o **Por mes**, una línea indica cuántas líneas se conservan, por ejemplo «4 líneas conservadas como referencia (48.000).», seguida del enlace **Usar de nuevo las líneas**. El enlace guarda las líneas tal como están y vuelve a calcular la columna a partir de ellas. Elegir la pestaña **Cantidad y precio** hace lo mismo, tras una pregunta. Para cambiar una línea conservada como referencia, use primero de nuevo las líneas y luego modifíquela.

- Pasar la columna a **Importe** o **Por mes**, introducir un mes en la tabla, o **Borrar columna**
- **Copiar columnas presupuestarias** en la Administración presupuestaria, o **Partir de**: cuando los importes de origen no se calcularon a partir de líneas, la copia lleva las líneas de la columna de origen como referencia. Una columna calculada a partir de sus líneas sigue calculada, con sus precios aumentados por el porcentaje. Consulte [Copiar una columna construida a partir de líneas](budget-operations.md#copiar-una-columna-construida-a-partir-de-lineas)
- Los días laborables de un calendario cambiaron: la pestaña **Cantidad y precio** indica, por ejemplo, «Días laborables modificados desde el último cálculo: marzo: 20 días, ahora 19.», seguido de **Usar de nuevo las líneas**. Nada cambia en la columna hasta que haga clic en **Usar de nuevo las líneas**. Las líneas siguen siendo editables mientras tanto
- **Restablecer columna presupuestaria** en la Administración presupuestaria quita las líneas junto con los importes. Consulte [Restablecer columna presupuestaria](budget-operations.md#restablecer-columna-presupuestaria)
- Un archivo de presupuesto cambia los meses de una columna y deja sus líneas. Consulte [Cargar un presupuesto desde una hoja de cálculo](budget-file.md)

#### ETC

El ETC (equivalente a tiempo completo) indica cuántas personas paga una columna. Procede de las líneas de cantidad y precio: cada mes suma el ETC de sus líneas (consulte la tabla anterior). De ahí salen dos cifras, cada una redondeada a 2 decimales:

- **Media anual**: la suma de los doce meses dividida entre 12. Es el ETC de la columna, visible en la etiqueta de la columna y en las columnas de ETC de la lista
- **ETC en el periodo**: la suma de los meses con personas o días, dividida entre el número de esos meses. Las piezas no cuentan, así que las licencias o un portátil nunca lo reducen. Aparece bajo las líneas mientras los importes vienen de ellas. Tras una edición a mano, un reparto o una copia, no se muestra hasta que use de nuevo las líneas

Por ejemplo, un consultor a tiempo completo de febrero a octubre cuenta 1 ETC en cada uno de esos 9 meses: 1.00 en el periodo, y 9 × 1 ÷ 12 = 0.75 para el año completo. Un jefe de proyecto 5 días por mes de febrero a julio cuenta unos 0.24 en el periodo, y 0.12 para el año completo. Unas licencias durante todo el año o un portátil en diciembre en la misma columna dejan ambas cifras como están.

- **Contado**: una columna con líneas en personas o días
- **Cero**: una columna cuyas líneas están todas en piezas. Su ETC es 0
- **Vacío**: una columna sin líneas, una línea sin versión para ese año o un año posterior al fin de validez de la línea. Su celda de ETC queda vacía, porque KANAP no puede saber cuántas personas paga
- El ETC se queda con las líneas. Tras una edición a mano, un reparto o una copia, la columna conserva el ETC de sus líneas. Una copia recalcula el ETC a partir de las líneas copiadas, con los calendarios laborales del año de destino

---

### Asignaciones

La pestaña Asignaciones distribuye el gasto de un año entre sus empresas y departamentos. Las asignaciones alimentan los informes de contracargo y los KPI de coste por usuario, para las líneas OPEX y CAPEX.

**Selección de año**:

- Funciona igual que Presupuesto: use las pestañas de año para alternar entre A-2, A-1, A, A+1, A+2
- Cada año puede tener un método de asignación diferente
- El total anual de la columna por defecto aparece a la derecha, por ejemplo **Presupuesto, total del año**, y la tabla muestra cada parte como porcentaje y como importe, con una fila de total

**Métodos de asignación**:

| Método | Cómo funciona |
|---|---|
| **Plantilla (por defecto)** | Reparte el gasto proporcionalmente según la plantilla de cada empresa para el año seleccionado. No requiere selección manual: los porcentajes se calculan automáticamente a partir de las métricas de las empresas. Es el método estándar. |
| **Usuarios IT** | Reparte el gasto proporcionalmente según el número de usuarios IT de cada empresa para el año seleccionado. |
| **Facturación** | Reparte el gasto proporcionalmente según la facturación de cada empresa para el año seleccionado, convertida a la moneda de reporte. |
| **Manual por empresa** | Usted selecciona qué empresas reciben este gasto y elige un inductor en **Asignar por** (Plantilla, Usuarios IT o Facturación) para calcular los porcentajes solo entre las empresas seleccionadas. |
| **Manual por departamento** | Usted selecciona pares empresa/departamento concretos. Los porcentajes se calculan a partir de la plantilla de cada departamento. Útil cuando una línea solo beneficia a ciertos departamentos (p. ej., un CRM usado por Ventas). |
| **Porcentajes manuales** | Usted elige las empresas y escribe cada porcentaje. El total debe sumar 100 %. |

**Métodos por defecto y fijados**:

- La opción **por defecto**, mostrada como *Plantilla (por defecto)* hasta que su organización configure otro método, sigue la configuración de **Gestión presupuestaria > Administración > Método de asignación por defecto**. Cada línea que se deje en el valor por defecto se recalcula cuando un administrador cambia esa configuración
- Esa configuración también puede restringir el valor por defecto a una **selección de empresas** (por ejemplo la entidad que lleva el presupuesto IT): el inductor se aplica entonces solo a esas empresas, y la opción muestra *Por defecto (n sociedades)*
- **Plantilla**, **Usuarios IT** y **Facturación** fijan ese método en la línea: un método fijado sigue funcionando aunque el valor por defecto de la organización cambie más adelante
- Las líneas con una asignación manual nunca se ven afectadas por la configuración por defecto

**Cómo funcionan los porcentajes**:

- En los **métodos automáticos** (Plantilla, Usuarios IT, Facturación): los porcentajes se calculan a partir de las métricas más recientes de sus empresas activas. No se editan directamente
- En **Manual por empresa** y **Manual por departamento**: usted elige las empresas o departamentos y el sistema calcula los porcentajes según el inductor elegido y las métricas actuales
- En **Porcentajes manuales**: escribir un porcentaje fija esa fila y las demás filas se reparten el resto. **Repartir equitativamente** da la misma parte a cada fila; **Borrar fijaciones manuales** libera las filas fijadas
- Los porcentajes reflejan datos en tiempo real. Si actualiza la plantilla de una empresa, las asignaciones se recalculan
- La columna **Generador** muestra el valor de cada empresa para el generador. Una facturación se muestra con la moneda base de la empresa, por ejemplo **35 M USD**

**Facturación en varias monedas**:

- Cada empresa introduce su facturación en millones de su moneda base. Antes del reparto, KANAP convierte cada facturación a la moneda de reporte, a los tipos de la versión presupuestaria del año: los tipos fijados al congelar su columna por defecto, si no los tipos actuales del año. Consulte [Configuración de monedas](currencies.md)
- Cuando una moneda no tiene tipo para el año, las empresas en esa moneda quedan fuera del reparto: no reciben ninguna parte, y las demás empresas se reparten el 100 %. Un aviso sobre la tabla nombra cada empresa excluida. KANAP obtiene el tipo que falta en segundo plano, y el reparto se corrige solo en cuanto el tipo está disponible. Un [tipo manual](currencies.md#tipos-manuales) lo corrige al momento
- Con **Manual por empresa** y el inductor Facturación, cuando ninguna de las empresas seleccionadas tiene tipo, la asignación se rechaza con un mensaje que cita las monedas y el año. Introduzca el tipo o elija otro inductor

**Cómo usarlo**:

1. Seleccione el año
2. Elija un método de asignación en **Método**
3. Para un método manual, use **Agregar fila** para añadir empresas (o pares empresa/departamento) y el icono de quitar para eliminar una. Para **Manual por empresa**, elija un inductor en **Asignar por**
4. Los cambios se guardan automáticamente

**Problemas comunes**:

- **Métricas faltantes**: Una o más empresas tienen la plantilla, los usuarios IT o la facturación en cero o sin informar para el año seleccionado. Complete las métricas en **Datos maestros > Empresas** (pestaña Detalles)
- **"Los porcentajes manuales deben sumar 100 %."**: Ajuste las filas o haga clic en **Repartir equitativamente**

**Cuando otra persona edita la asignación**:

- El método, el inductor y las filas se guardan juntos. Si otra persona cambió la asignación mientras usted la editaba, un aviso ofrece **Recargar la asignación** o **Sobrescribir**
- Cambiar de año con una decisión pendiente pide confirmación primero

**Consejo**: Use Plantilla (por defecto) para la mayoría de líneas: es lo más sencillo y se actualiza automáticamente. Reserve los métodos manuales para gastos que solo benefician a empresas o departamentos concretos.

---

### Relaciones

La pestaña Relaciones muestra lo que paga esta línea: sus proyectos, aplicaciones, tecnologías, contratos y activos, cada uno en su propia tabla, y después sugerencias, los contactos, y los enlaces y archivos. Haga clic en una fila para abrir el registro. La insignia de la pestaña cuenta los proyectos, aplicaciones, tecnologías, contratos y activos vinculados, además de los enlaces y archivos. Los contactos no se cuentan. Las tecnologías y los activos solo cuentan si puede leer la infraestructura.

**Registros vinculados**, una tabla cada uno:

| Sección | Columnas |
|---|---|
| **Proyectos** | Referencia (`PRJ-7`), nombre, estado, fin previsto |
| **Aplicaciones** | Referencia (`APP-3`), nombre, ciclo de vida, criticidad de negocio |
| **Tecnologías** | Referencia (`TEC-5`), nombre, familia, editor |
| **Contratos** | Nombre, proveedor, fin del periodo en curso, importe anual en la moneda del contrato, renovación (tácita o manual) |
| **Activos** | Referencia (`AST-12`), nombre, tipo, entorno, estado |

Solo ve las secciones de los módulos que puede leer. Las tecnologías y los activos requieren poder leer la infraestructura. Un Colaborador de negocio solo ve los proyectos y las aplicaciones en los que participa. Los nombres de los proyectos también aparecen en la columna **Proyecto** de la lista, donde la búsqueda rápida los encuentra. Los nombres de los contratos aparecen en su columna **Contrato**. Un contrato que difiere de la línea en la empresa pagadora, el centro de coste, el proveedor o la moneda muestra una marca naranja pequeña junto a su nombre. Pase el cursor sobre la marca para ver cada diferencia, con el valor en la línea y el valor en el contrato. El selector muestra la misma marca en un contrato antes de vincularlo. El vínculo sigue siendo posible. La marca aparece para un contrato que usted puede leer.

Una fecha de fin en naranja señala un contrato cuya decisión de renovación cae dentro de su ventana de decisión de contratos. Un contrato desactivado, o un activo retirado o desactivado, sigue en la lista con el nombre atenuado. A partir de dos filas, los contratos terminan con un total por moneda, sin los contratos desactivados.

**Añadir y quitar vínculos** (`budget:member`): **Añadir**, a la derecha de una sección, abre una búsqueda. Escriba un nombre o una referencia y elija un resultado: el vínculo se guarda al instante. Vincular requiere también poder leer el módulo de destino: **Añadir** no aparece en una sección que no puede leer. Para quitar un vínculo, pase el cursor sobre la fila y haga clic en la cruz al final. Quitar un vínculo no elimina nada más. Los lectores ven las tablas en solo lectura.

**Relacionados**: las aplicaciones y los contratos del proveedor de la línea que aún no están vinculados, con el motivo «mismo proveedor». Haga clic en **Vincular** para añadir la sugerencia a su sección. Las sugerencias muestran:

- las aplicaciones en servicio, si puede leer las aplicaciones. Un Colaborador de negocio solo ve las aplicaciones en las que participa;
- los contratos activos, si puede leer los contratos;
- 20 como máximo de cada tipo.

La sección no aparece cuando la línea no tiene proveedor o no hay nada que sugerir.

**Contactos**: personas de esta línea, cada una con un rol (**Comercial**, **Técnico**, **Soporte** u **Otro**). Elija un contacto y luego su rol: al elegir el rol se añade el contacto. La tabla muestra el rol, el nombre, los apellidos, el cargo, el correo electrónico y el móvil. Pase el cursor sobre el rol para ver si el contacto viene del proveedor o se añadió manualmente. Quite un contacto con el icono de quitar.

**Enlaces y archivos**: los enlaces web de la línea (portales de proveedores, documentación, consolas de administración) y sus archivos (presupuestos, facturas, notas de aprobación), una fila cada uno con su nombre, el dominio del enlace o el tamaño del archivo, y la fecha en que se añadió. Haga clic en un enlace para abrirlo en una pestaña nueva, o en un archivo para descargarlo. Con `budget:member`:

- **Añadir enlace** abre un diálogo para una URL y un nombre opcional; el enlace se guarda al instante. Para cambiar un enlace, pase el cursor sobre su fila y haga clic en el lápiz.
- **Adjuntar archivo** abre el selector de archivos. También puede soltar archivos sobre la sección.
- Para quitar un enlace o un archivo, pase el cursor sobre la fila y haga clic en la cruz. Eliminar un archivo pide una confirmación antes.

**Consejo**: Vincule los contratos para seguir las renovaciones en varias líneas. Adjunte presupuestos y facturas para tener todos los documentos de una línea en un solo lugar.

---

### Historial

La pestaña Historial lista los cambios hechos en la línea, el más reciente arriba. Cada entrada muestra la fecha y la hora, el autor (una persona, **Sistema**, **Importación** o **Plaid para** una persona) y cada campo cambiado con su valor antes y después. Un cambio de importe indica el año, la columna y los valores antes y después.

Los cambios en los elementos de la línea también aparecen aquí: importes, dimensiones, asignaciones, enlaces, archivos adjuntos, contactos, aplicaciones, tecnologías, activos y tareas. Cualquier persona que pueda abrir la línea puede leer su historial. Un registro de un módulo que usted no puede leer aparece solo por su tipo, por ejemplo «un contrato».

Vea [Historial de los registros](record-history.md) para más detalles.

---

## Importación/exportación CSV

**Exportar** e **Importar** están en la barra de herramientas de la lista. Ambos requieren el nivel Administrador en Presupuesto (`budget:admin`).

**Exportar** escribe el archivo de presupuesto de las líneas que muestra la lista, OPEX y CAPEX juntas, como `budget.csv` o como libro de Excel, `budget.xlsx`. **Importar** vuelve a leer cualquiera de los dos: primero se comprueba, y no se escribe nada hasta que haga clic en **Cargar**.

El archivo contiene una fila por línea: su `nature` (`opex` o `capex`), su referencia `BL-n`, los detalles de la línea, sus importes en columnas y `kanap_token`. Un archivo sin columna `nature`, exportado por una versión anterior, se lee como líneas OPEX, o como líneas CAPEX cuando el filtro **Tipo** de la lista conserva solo CAPEX. [Cargar un presupuesto desde una hoja de cálculo](budget-file.md) describe las columnas, lo que significa una celda y los dos pasos de la importación.

---

## Estado y ciclo de vida

Cada línea tiene un **estado** (Habilitado o Deshabilitado) y un **Fin de validez** opcional que controla cuándo aparece en informes y listas de selección. Es la única fecha de fin de una línea.

**Cómo funciona**:

- **Habilitado**: La línea está activa y aparece en todas partes (listas, informes, asignaciones)
- **Fin de validez**: La fecha en que la línea termina. Déjelo en blanco si no hay fin. Cuando pasa el fin de validez, el estado cambia a **Desactivado** por sí solo en el plazo de una hora
- Después del fin de validez:
    - La línea ya no aparece en listas de selección para nuevos contratos o asignaciones
    - Se excluye de informes para años estrictamente posteriores al fin de validez
    - Los datos históricos permanecen intactos; la línea sigue apareciendo en informes que cubren años cuando estaba activa

**Establecer estado**:

- Al crear la línea, puede establecer su **Fin de validez** en el panel **Propiedades**
- Más adelante, cambie el **Estado** en la barra de metadatos, o use el campo **Ciclo de vida** del panel **Propiedades** (interruptor de estado y **Fin de validez**). Pasar a **Desactivado** fija el fin de validez en este momento: la desactivación es inmediata. Mientras haya una fecha futura, el interruptor muestra **Activo hasta el** y esa fecha
- Puede programar un fin de validez futuro, por ejemplo el fin de un contrato, una baja planificada o el final de la vida útil de un activo

**Ver líneas deshabilitadas**:

- Por defecto, la lista muestra solo las líneas de **Activos**
- Las líneas que terminan durante el año en curso permanecen en **Activos** hasta el 31 de diciembre, aunque su estado ya indique **Desactivado**. Pasan a **Desactivados** el 1 de enero
- Use el selector **Mostrar: Todos / Activos / Desactivados** y elija **Desactivados** o **Todos** para ver las líneas que terminaron en un año anterior

**Cuándo desactivar o eliminar**:

- **Prefiera desactivar**: Mantiene el historial intacto, asegura que los informes permanezcan consistentes y soporta registros de auditoría
- **Elimine solo si**: La línea se creó por error
- Una línea con importes en una columna congelada no se puede eliminar. Primero descongele la columna, o fije en su lugar una fecha de fin de validez
- Eliminar una línea también elimina sus presupuestos, asignaciones, tareas, sitios web relevantes, adjuntos (con sus archivos) y sus vínculos con contratos. Si una de sus tareas se convirtió en una solicitud, la solicitud se conserva: tiene su propia copia del título, la descripción y los adjuntos, y solo se pierde su vínculo con la tarea

**Consejo**: Utilice el Fin de validez para retirar líneas cuando los contratos terminen, los servicios se detengan, los activos se den de baja o los proyectos concluyan. Elimine solo una línea creada por error.

---

## Cambiar el tipo

Una línea OPEX que resulta ser una inversión pasa a ser una línea CAPEX, y una línea CAPEX que resulta ser gasto operativo pasa a ser una línea OPEX. Haga clic en **Cambiar el tipo…** junto a **Tipo** en el panel **Propiedades**. Necesita el nivel Miembro en Presupuesto (`budget:member`). Los cambios aún no guardados se guardan antes de que se abra el diálogo.

**A partir de** fija dónde empieza el cambio:

- **El primer año de la línea** (por defecto): la propia línea cambia de tipo. Conserva su referencia `BL` y su dirección, sus presupuestos, asignaciones, vínculos, adjuntos y tareas. Su **Tipo** cambia en la lista. Una línea que pasa a CAPEX sale de los informes OPEX y entra en los informes CAPEX, y el contracargo la cuenta en CAPEX. Una línea que pasa a OPEX hace lo contrario
- **Un año posterior**: esta línea termina el 31 de diciembre del año anterior y conserva sus presupuestos anteriores. Una nueva línea del otro tipo, con su propia referencia `BL`, lleva el presupuesto a partir de ese año, con los contactos y los vínculos con aplicaciones, activos, contratos, proyectos y solicitudes. Los adjuntos, los sitios web relevantes y las tareas se quedan en esta línea. La parte superior de la pestaña **Vista general** enlaza las dos líneas: **Sustituida por** en esta línea, **Sucede a** en la nueva

El diálogo también pide:

- **Cuenta**: una cuenta para el nuevo tipo. Cuando la cuenta de la línea es solo para su tipo actual, la línea la conserva en su sitio salvo que elija otra; una nueva línea a partir de un año posterior solo la recibe si corresponde al nuevo tipo
- **Dimensiones**: las dimensiones obligatorias para el nuevo tipo, y los valores de la línea que son solo para su tipo actual. Si la propia línea cambia de tipo, puede completarlos ahora o más tarde. A partir de un año posterior, la nueva línea necesita las dimensiones obligatorias, y los valores solo para el tipo actual no se copian. Una dimensión solo para líneas CAPEX no se aplica a las líneas OPEX: una línea CAPEX que pasa a OPEX en su sitio conserva su valor sin mostrarlo, y lo vuelve a mostrar si más adelante pasa a CAPEX
- **Motivo**: opcional, se guarda en el registro de auditoría de la línea

El cambio se rechaza cuando la línea tiene importes en una columna congelada, de líneas OPEX o CAPEX, en los años que cambian. Descongele primero la columna, o haga empezar el cambio en un año posterior. Se ofrece un año posterior cuando sigue al primer año de presupuesto de la línea, la línea tiene presupuesto en ese año o en uno posterior, empieza antes del 1 de enero de ese año y sigue vigente ese día, y aún no ha sido sustituida por otra línea. Un cambio siempre empieza el 1 de enero.

Un archivo de presupuesto nunca cambia el tipo de una línea. Consulte [Cargar un presupuesto desde una hoja de cálculo](budget-file.md).

---

## Consejos y mejores prácticas

1. **Empiece simple**: Cree líneas con solo lo esencial (título, empresa pagadora, cuenta y las dimensiones obligatorias), luego añada presupuestos y asignaciones a medida que planifica.

2. **Use el método de asignación predeterminado**: Para la mayoría de líneas, Plantilla (por defecto) es suficiente. Reserve las asignaciones manuales para gasto que beneficia solo a empresas o departamentos específicos.

3. **Vincule contratos**: Si gestiona gasto mediante contratos, vincúlelos en la pestaña Relaciones. Facilita el seguimiento de renovaciones y compras.

4. **Vincule aplicaciones**: Asocie líneas con las aplicaciones o servicios que financian. Esto proporciona un mapeo claro de coste a aplicación.

5. **Suba documentación**: Utilice **Adjuntar archivo** en **Enlaces y archivos** de la pestaña Relaciones para almacenar contratos, presupuestos, facturas, notas de aprobación y SOW de proveedores.

6. **Añada enlaces a portales de proveedores**: Utilice **Añadir enlace** en **Enlaces y archivos** para vincular a consolas de administración, portales de soporte y documentación de proveedores para acceso rápido.

7. **Registre contactos**: Añada contactos de proveedor con roles (Comercial, Técnico, Soporte) para que su equipo sepa a quién llamar para cada línea.

8. **Aproveche las dimensiones analíticas**: Dé a las líneas un valor en cada dimensión (por ejemplo **Software** en **Tipo de coste**, o el **Motivo** y la **Prioridad** de una línea CAPEX) para agrupar el gasto en los informes.

9. **Mantenga actualizadas las métricas de empresa**: Las asignaciones dependen de la plantilla, usuarios IT y facturación de la empresa. Las métricas desactualizadas causan errores de asignación.

10. **Use un archivo para la configuración masiva**: Si está migrando desde otro sistema o tiene cientos de líneas, comience con una importación. Exporte un archivo nuevo, rellene sus filas y compruébelo antes de cargar.

11. **Desactive, no elimine**: Preserve el historial desactivando líneas cuando ya no estén activas. Elimine solo si es un error.

12. **Revise la fila de totales**: Antes de finalizar presupuestos, verifique la fila **Total** bajo la lista para asegurar que su gasto suma como se espera. Filtre por **Tipo** para ver el total de OPEX o de CAPEX por separado.

13. **Use enlace directo**: Haga clic directamente en una columna de presupuesto en la lista para ir a la pestaña Presupuesto de ese año. Haga clic en la columna Tarea para ir a las tareas de la línea en la pestaña Vista general. Esto ahorra tiempo de navegación.

14. **Congele presupuestos después del cierre de año**: Utilice Administración presupuestaria para congelar los presupuestos del año anterior una vez que el realizado esté finalizado, previniendo ediciones accidentales.

---

## Permisos

El acceso a las líneas presupuestarias se controla con el recurso Presupuesto, que cubre por igual las líneas OPEX y CAPEX. Tiene tres niveles:

- `budget:reader`: Ver la lista, abrir líneas, ver presupuestos y asignaciones (solo lectura), descargar adjuntos
- `budget:member`: Crear y editar líneas, cambiar su tipo, actualizar presupuestos y asignaciones, subir y eliminar adjuntos, gestionar relaciones, enlaces y contactos
- `budget:admin`: Todos los derechos de miembro más importación y exportación, operaciones presupuestarias (copiar columnas presupuestarias, con sus importes y asignaciones, y restablecer columna presupuestaria) y eliminación masiva

Congelar columnas presupuestarias requiere la administración presupuestaria (`budget_ops:admin`).

El acceso a los datos puede limitar a una persona a las líneas de ciertas empresas o centros de coste. Entonces ve esas líneas y aquellas en las que está nombrada, una línea que ve en Lectura muestra «Solo lectura en su acceso», y la eliminación de líneas y las operaciones en bloque quedan reservadas a las personas con acceso a todos los datos. Vea [Acceso a los datos](data-access.md).

Adicionalmente:

- Las tareas tienen permisos separados (`tasks:member` para crear y editar tareas en las líneas)
- Los usuarios con `tasks:reader` pueden ver tareas pero no crear ni editar

Si no puede realizar una acción (p. ej., falta el botón **Importar**, o no puede subir adjuntos), consulte con su administrador del espacio de trabajo para revisar sus permisos de rol.

---

## ¿Necesita ayuda?

- **Problemas con el archivo**: Exporte un archivo nuevo desde la lista y compruébelo de nuevo. El informe nombra la línea y la columna de cada error, y [Cargar un presupuesto desde una hoja de cálculo](budget-file.md) explica qué significa cada celda
- **Errores de asignación**: Verifique que todas las empresas tengan las métricas requeridas (plantilla, usuarios IT, facturación) para el año seleccionado
- **Advertencia de cuenta obsoleta**: La cuenta no pertenece al plan de cuentas de la empresa pagadora; seleccione una cuenta diferente
- **Faltan botones o pestañas**: Su rol puede no tener el nivel de permiso requerido (miembro o administrador). Contacte a su administrador del espacio de trabajo
