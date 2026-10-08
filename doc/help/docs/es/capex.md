# CAPEX

Las partidas CAPEX (gasto de capital) son sus inversiones en activos a largo plazo: compras de hardware, licencias de software con valor plurianual, proyectos de infraestructura y equipamiento. Aquí es donde planifica los presupuestos de capital, hace seguimiento del gasto de proyectos y asigna costes en toda su organización.

El espacio de trabajo CAPEX le ayuda a gestionar cada partida de capital desde la presupuestación inicial hasta la ejecución y los informes, todo en un solo lugar con columnas presupuestarias año a año, métodos flexibles de asignación y vínculos directos a proyectos, aplicaciones, contratos y contactos.

## Primeros pasos

Navegue a **Gestión presupuestaria > CAPEX** para ver su lista. Haga clic en **Nuevo** para crear su primera partida.

El espacio de trabajo se abre en modo de creación, con el panel **Propiedades** abierto a la derecha. Escriba el nombre de la inversión en el título de arriba, complete las propiedades y haga clic en **Crear**.

**Campos obligatorios**:

- **Título**: En qué invierte (p. ej., "Nueva infraestructura de servidores", "Licencia de software ERP"). Es la descripción de la partida, que aparece en la columna **Descripción** de la lista
- **Empresa pagadora**: Qué empresa realiza la inversión (obligatorio para contabilidad)
- **Cuenta**: La cuenta contable de este gasto de capital. Solo aparecen las cuentas del plan de cuentas de la empresa pagadora
- **Moneda**: Código ISO (p. ej., USD, EUR). Por defecto la moneda CAPEX de su espacio de trabajo; puede cambiarla por partida
- **Tipo de activo fijo**: Clasificación de propiedad, planta y equipo: Hardware o Software
- **Tipo de inversión**: Propósito de la inversión (vea las opciones más abajo)
- **Prioridad**: Nivel de prioridad de negocio (vea las opciones más abajo)
- **Inicio de vigencia**: Cuándo comienza esta inversión (DD/MM/AAAA)

**Opcional pero útil**:

- **Proveedor**: El proveedor de esta inversión. Selecciónelo entre sus proveedores en datos maestros
- **Centro de coste**: Quién es responsable de la inversión. Consulte [Centros de coste](cost-centers.md). Cuando la empresa pagadora aún está vacía, elegir un centro de coste la completa con la empresa del centro de coste
- **Run o build**: **Run** para el gasto que mantiene en funcionamiento los servicios existentes, **Build** para el gasto que los crea o los modifica
- **Dimensiones analíticas**: Un campo por dimensión, con el nombre de la dimensión, para agrupar a medida en los informes. La dimensión por defecto se muestra como **Dimensión analítica** hasta que se le da un nombre. Consulte [Dimensiones analíticas](analytics.md)
- **Fin de validez**: La fecha en que termina esta inversión, por ejemplo al final de la vida útil del activo o al completarse el proyecto. Déjela en blanco si no hay fin. Después de esa fecha, la partida queda desactivada y los años posteriores dejan de contar en las vistas presupuestarias
- **Responsable de TI** / **Responsable de negocio**: Quién es responsable
- **Descripción** (pestaña Vista general): Detalles en texto libre sobre la inversión

Una vez definidas, **Empresa pagadora** y **Cuenta** se pueden cambiar, pero no vaciar. **Proveedor** se puede borrar en cualquier momento. Cuando cambia la empresa pagadora de una partida que tiene una cuenta y la nueva empresa usa otro plan de cuentas, la cuenta se borra en el mismo guardado: elija la nueva cuenta en el plan de la nueva empresa. El archivo CAPEX también lleva la cuenta, en la columna `account_number`, en el plan de cuentas de la empresa pagadora.

Una vez creada la partida, el espacio de trabajo desbloquea las cuatro pestañas: **Vista general**, **Presupuesto**, **Asignaciones** y **Relaciones**.

**Consejo**: Puede crear partidas rápidamente y completar presupuestos y asignaciones más tarde. Empiece por lo esencial y vaya iterando.

---

## Tipos de inversión

Las partidas CAPEX deben clasificarse por tipo de inversión. Esto ayuda a analizar los patrones de gasto de capital:

- **Reemplazo**: Reemplazar activos existentes obsoletos o al final de su vida útil
- **Capacidad**: Añadir capacidad para soportar el crecimiento del negocio o una demanda creciente
- **Productividad**: Mejorar la eficiencia o reducir costes operativos
- **Seguridad**: Reforzar la postura de seguridad, la conformidad o la mitigación de riesgos
- **Conformidad**: Cumplir requisitos regulatorios o de conformidad
- **Crecimiento del negocio**: Habilitar nuevos productos, mercados o capacidades de negocio
- **Otro**: Inversiones que no encajan en las categorías anteriores

**Niveles de prioridad**:

- **Obligatorio**: Debe hacerse (regulatorio, infraestructura crítica, seguridad)
- **Alto**: Caso de negocio sólido, alto ROI o importancia estratégica
- **Medio**: Valioso pero puede aplazarse si es necesario
- **Bajo**: Deseable, puede posponerse

---

## Trabajar con la lista CAPEX

La lista CAPEX (en **Gestión presupuestaria > CAPEX**) es su vista principal para navegar, filtrar y explorar partidas de capital.

### Columnas predeterminadas

| Columna | Qué muestra |
|---------|-------------|
| **Ref** | Referencia de la partida, por ejemplo CPX-12 |
| **Descripción** | Nombre de la inversión |
| **Proveedor** | El nombre del proveedor |
| **Empresa pagadora** | Qué empresa paga esta partida |
| **Contrato** | El nombre del último contrato vinculado |
| **Cuenta** | El número y nombre de la cuenta contable |
| **Tipo de activo fijo** | Hardware o Software |
| **Tipo de inversión** | Propósito de la inversión |
| **Prioridad** | Nivel de prioridad de negocio |
| **Asignación** | Etiqueta del método de asignación del año actual |
| **Presupuesto A** y **Aterrizaje previsto A** | Los importes del año actual de la columna por defecto y de la última columna visible, en la moneda de reporte. Con la configuración estándar son Presupuesto y Aterrizaje previsto. Cuando la columna por defecto es también la última visible, aparece una sola columna de importe. Consulte [Columnas presupuestarias](budget-operations.md#columnas-presupuestarias) |
| **Tarea** | Título de la tarea más reciente vinculada a esta partida |

### Columnas adicionales

Estas columnas están ocultas por defecto. Muéstrelas desde el selector de columnas (menú hamburguesa en el encabezado de la cuadrícula):

| Columna | Qué muestra |
|---------|-------------|
| **Columnas de importes** | Cada columna presupuestaria visible para A-1, A, A+1 y A+2, con los nombres que eligió su organización. El encabezado indica la columna, el año respecto a hoy y el año natural, por ejemplo **Revisión A+1 (2027)**. Los importes están en la moneda de reporte. Las columnas ocultas no se ofrecen |
| **Columnas de ETC** | El ETC de cada columna presupuestaria visible para A-1, A, A+1 y A+2, con los nombres que eligió su organización, justo después de las columnas de importes en el selector de columnas. El encabezado indica la columna y el año natural, por ejemplo **ETC Presupuesto (2026)**. El ETC de una partida es la suma del ETC de sus líneas en esa columna. Consulte [ETC](#etc). La celda queda vacía cuando la columna no tiene líneas |
| **ETC declarados** | **Sí** cuando la partida declara ETC en al menos una columna presupuestaria de cualquier año; si no, vacía. Son las partidas que conserva el filtro **Partidas con ETC** de los informes |
| **Moneda** | Código de moneda de la partida |
| **Inicio efectivo** | Fecha de inicio |
| **Fin de validez** | Fecha en que la partida termina (en blanco significa sin fin) |
| **Responsable IT** / **Responsable de negocio** | Usuarios responsables |
| **Dimensiones analíticas** | Una columna por dimensión activada, con el nombre de la dimensión y el valor de la partida. La columna de la dimensión por defecto va primero (**Dimensión analítica** hasta que se le da un nombre) y después las demás dimensiones en su orden |
| **Centro de coste** | El código y el nombre del centro de coste. Pase el cursor por encima para ver su ruta completa en el árbol; haga clic para abrir el centro de coste |
| **Responsable del presupuesto** | El responsable del presupuesto del centro de coste de la partida. Se deriva del centro de coste y no se almacena en la partida: cambie el responsable del presupuesto de un centro de coste y todas sus partidas lo siguen |
| **Run o build** | **Run** o **Build** |
| **Proyecto** | Nombres de los proyectos vinculados en la pestaña Relaciones |
| **Notas** | Notas de texto libre |
| **Habilitado** | Estado (habilitado o deshabilitado) |
| **Creado** / **Actualizado** | Marcas de tiempo |

### Búsqueda rápida

El cuadro de búsqueda en la parte superior busca en la referencia, la descripción, el proveedor, la empresa pagadora, la cuenta, el contrato, los nombres de proyectos, la asignación, los responsables, los valores analíticos, el centro de coste (código, nombre y ruta), el responsable del presupuesto, el tipo de activo fijo, el tipo de inversión, la prioridad, las notas, la moneda y el estado. Los resultados se actualizan en tiempo real mientras escribe, sin distinguir acentos ni mayúsculas y minúsculas.

### Filtros de columna

Cada encabezado de columna filtrable tiene un icono de filtro. **Proveedor**, **Empresa pagadora**, **Cuenta**, **Tipo de activo fijo**, **Tipo de inversión**, **Prioridad**, **Asignación**, **Moneda**, **Responsable IT**, **Responsable de negocio**, cada dimensión analítica, **Centro de coste**, **Responsable del presupuesto**, **Run o build**, **ETC declarados** y **Habilitado** usan filtros de conjunto de casillas con **Todos**, **Ninguno** y un botón de limpiar. El filtro **ETC declarados** ofrece **Sí** y **No**. El filtro **Habilitado** ofrece **Activado** y **Desactivado** y restringe la lista cuando **Mostrar** está en **Todos**. Si hace clic en **Limpiar** dentro del filtro, o desmarca ambos valores, la lista no muestra nada, sea cual sea la opción de **Mostrar**. Múltiples filtros se combinan con lógica AND.

Marque **Todos** y luego desmarque los valores que quiera excluir: el filtro conserva todo salvo esos (el encabezado muestra, por ejemplo, **Todos menos 3**), y un valor creado más tarde se incluye automáticamente.

Cada columna de importe tiene un filtro numérico. Un número escrito en el cuadro bajo el encabezado conserva las partidas con al menos ese importe. Abra el menú del filtro para las demás condiciones: mayor que, menor que, igual, distinto o entre dos importes.

Cada columna de ETC tiene un filtro numérico con las mismas condiciones, más vacío y no vacío. **Vacío** conserva las partidas cuya columna no tiene líneas.

**Inicio efectivo**, **Fin de validez**, **Creado** y **Actualizado** tienen filtros de fecha. El cuadro bajo el encabezado muestra el filtro en palabras, con todas sus condiciones, por ejemplo «Vacío o después del 31 dic 2024». Haga clic en él para abrir el menú del filtro (el día, antes de, después de, entre, vacío o no vacío), o haga clic en × para quitar el filtro. **Fin de validez** admite dos condiciones unidas por Y u O, por ejemplo vacío o posterior a una fecha.

Las columnas de texto usan filtros de texto, sin distinguir acentos ni mayúsculas y minúsculas. En **Ref**, escriba el número o la referencia completa, por ejemplo `12` o `CPX-12`.

### Ordenación

Haga clic en un encabezado de columna para ordenar ascendente o descendente. Todas las columnas se pueden ordenar, incluida cada columna de importe y de ETC. Las partidas sin ETC van al final en orden ascendente. Las columnas de texto se ordenan en orden de lectura natural: un nombre con tilde se ordena junto a su forma sin tilde (por ejemplo «Électricité» junto a «Electricite»), y las minúsculas van antes que las mayúsculas cuando las letras son iguales. La ordenación predeterminada es la columna por defecto del año actual, de mayor a menor (**Presupuesto A** con la configuración estándar). **Anterior** y **Siguiente** en el espacio de trabajo siguen el mismo orden. La lista recuerda su última ordenación cuando regresa.

### Fila de totales

La fila fijada en la parte inferior muestra el total de cada columna de importe. Los totales respetan sus filtros y búsqueda actuales. Todos los importes se convierten a su moneda de reporte, mostrada en el título de la página.

Cada columna de ETC visible muestra la suma del ETC de las partidas. Cuando algunas partidas no tienen ETC, el recuento sigue al total, por ejemplo «3.50 · 12 desconocidas». Pase el cursor por encima para ver la frase completa: «Desconocido para 12 líneas». Cuando ninguna partida tiene ETC, el total queda vacío y solo se muestra el recuento.

### Enlace directo

Haga clic en cualquier celda de una fila para abrir el espacio de trabajo en la pestaña más relevante para esa columna:

- **Descripción**, **Proveedor**, **Empresa pagadora**, **Tipo de activo fijo**, **Tipo de inversión**, **Prioridad** y las demás columnas generales: Abre **Vista general**
- **Columnas de importes** (Presupuesto A, Aterrizaje previsto A, Revisión A+1, etc.) y **Columnas de ETC**: Abre la pestaña **Presupuesto** en el año de la columna
- **Asignación**: Abre la pestaña **Asignaciones** para el año actual
- **Tarea**: Abre la pestaña **Vista general**, donde está el panel de tareas
- **Contrato**: Abre directamente el contrato vinculado
- **Centro de coste**: Abre el espacio de trabajo del centro de coste

### Filtro de estado

Utilice el conmutador **Mostrar: Todos / Activos / Desactivados** encima de la cuadrícula para controlar el alcance del ciclo de vida (predeterminado: **Activos**). Seleccione **Desactivados** para revisar inversiones archivadas o **Todos** para incluir ambos estados. Los totales se actualizan inmediatamente.

### Preservación del contexto de búsqueda

Su contexto de lista (orden de clasificación, texto de búsqueda y filtros activos) se preserva cuando abre una partida y se restaura al volver a la lista. Esto significa que puede profundizar en varias partidas en secuencia sin perder su lugar.

Estos mismos filtros también se guardan en la dirección web de la página, de modo que recargar la página o compartir el enlace reabre la misma vista. Un enlace cuyos filtros ya no están disponibles muestra «Los filtros de este enlace ya no están disponibles.» Cuando un enlace filtra una columna oculta, por ejemplo una fila de un informe que abre la lista, la lista muestra esa columna justo después del nombre de la partida durante esta visita. La disposición de columnas que guardó no cambia. La opción de **Mostrar** también se guarda en la dirección. Una lista abierta desde un informe es una vista de ese informe: lo que cambie en ella queda en su dirección, y la lista abierta desde el menú conserva su propio orden, búsqueda y filtros.

### Navegación Anterior/Siguiente

Cuando abre una partida, el espacio de trabajo muestra botones **Ant.** y **Sig.**. Estos navegan por la lista en el orden actual, respetando filtros y búsqueda, y guardan primero sus cambios pendientes. El contador (p. ej., "Partida 3 de 47") muestra su posición en la lista filtrada.

**Consejo**: Utilice filtros de columna y búsqueda rápida para construir vistas enfocadas (p. ej., "Todas las inversiones en hardware con prioridad alta"), luego navegue partida por partida con **Ant.**/**Sig.** para revisar presupuestos.

---

## El espacio de trabajo CAPEX

Haga clic en cualquier fila de la lista para abrir el espacio de trabajo. Tiene cuatro partes:

- **Cabecera**: la referencia de la partida (p. ej., `CPX-7`) con un botón para copiarla, el nombre de la inversión (haga clic en él para cambiar el nombre de la partida), **Ant.** / **Sig.**, **Enviar enlace** y el botón de cierre
- **Barra de metadatos** bajo el título: **Estado**, **Prioridad**, **Responsable de TI** y **Responsable de negocio**, editables en el sitio. Cuando el centro de coste de la partida tiene un responsable del presupuesto, **Responsable del presupuesto** aparece a continuación. Es de solo lectura y se deriva del centro de coste, no se almacena en la partida: pase el cursor por encima para ver de qué centro de coste procede, y cámbielo en el centro de coste (consulte [Centros de coste](cost-centers.md#responsable-del-presupuesto-en-las-lineas-de-presupuesto))
- **Cuatro pestañas**: **Vista general**, **Presupuesto**, **Asignaciones** y **Relaciones** (la pestaña Relaciones muestra cuántos vínculos tiene la partida)
- **Panel Propiedades** a la derecha: los campos principales de la partida. Ábralo o ciérrelo con el botón de propiedades; el espacio de trabajo recuerda su elección

**Guardado automático**:

- Cada cambio se guarda automáticamente. La indicación **Guardando...** / **Guardado** aparece en la cabecera
- Cambiar de pestaña, pasar a la partida anterior o siguiente, o cerrar el espacio de trabajo guarda primero los cambios pendientes. Si un guardado falla, usted se queda donde está y un mensaje explica el motivo, de modo que ningún cambio se pierde sin que lo sepa
- **Ctrl+S** (**Cmd+S** en Mac) guarda de inmediato
- Si un guardado no puede completarse de inmediato porque hay otro guardado en curso sobre los mismos datos, KANAP lo reintenta automáticamente
- Si hay una operación de presupuesto masiva en curso (por ejemplo, una copia o un restablecimiento de columna en la Administración presupuestaria), las ediciones aquí se detienen con el mensaje «Hay otra operación de presupuesto en curso. Vuelva a intentarlo cuando haya terminado.» Vuelva a intentarlo cuando haya terminado

**Edición simultánea**:

- Dos personas pueden trabajar en la misma partida a la vez sin estorbarse. Editar campos distintos, meses de presupuesto distintos o columnas de presupuesto distintas nunca genera un conflicto, incluso en la misma partida y en el mismo momento
- Cuando otra persona cambia el mismo campo, la misma columna de presupuesto o la asignación mientras usted la está editando, un aviso muestra su valor y el de usted, con quién lo cambió y cuándo. Elija **Conservar el otro valor** para quedarse con el suyo, o **Aplicar mi valor** para conservar lo que escribió. Para una columna de presupuesto, las opciones son **Recargar la columna** o **Sobrescribir**; para la asignación, **Recargar la asignación** o **Sobrescribir**
- Solo el campo, la columna o la asignación que cambió espera su decisión; todo lo demás sigue guardándose con normalidad
- Una decisión pendiente se conserva al cambiar de pestaña. Se pierde, tras un aviso, si sale de la partida o cambia de año
- Si el cambio anterior fue suyo, desde otra ventana o pestaña, el aviso lo indica así en lugar de nombrar a otra persona

### Vista general

La pestaña Vista general contiene los detalles de la inversión y sus tareas.

**Qué puede editar**:

- **Descripción**: Detalles en texto libre sobre la inversión (la columna `name` del archivo CAPEX). El nombre de la inversión es el título de arriba

**Panel de tareas**:

- Muestra todas las tareas vinculadas a esta partida CAPEX, con las columnas **Título**, **Estado**, **Prioridad**, **Fecha de vencimiento** y **Acciones**. El título del panel indica el número de tareas
- Filtro **Estado**: Todos (por defecto), Activas (no completadas) o un estado concreto. El botón de borrar lo restablece
- Haga clic en **Agregar tarea** para abrir una tarea nueva ya vinculada a esta partida. Complete el título, la descripción, la prioridad, el responsable y la fecha de vencimiento en el espacio de trabajo de la tarea
- Use el icono de abrir para ir a una tarea y el icono de eliminar para borrarla (tras confirmar)
- Las tareas tienen sus propios permisos (`tasks:member` para crear y editar). El acceso de manager de CAPEX no da por sí solo derechos de edición de tareas; consulte a su administrador si no puede crear tareas
- Las tareas también se pueden ver y gestionar desde **Portafolio > Tareas**, que muestra todas las tareas de su organización
- El título de la última tarea también aparece en la columna **Tarea** de la lista (oculta por defecto)

**Panel Propiedades**:

- **Proveedor**, **Centro de coste**, **Empresa pagadora**, **Cuenta** (filtrada por el plan de cuentas de la empresa pagadora), **Moneda** (solo las monedas permitidas en su espacio de trabajo), **Tipo de activo fijo**, **Tipo de inversión**, un campo por dimensión analítica, **Run o build** e **Inicio de vigencia**
- **Ciclo de vida**: el interruptor de estado, cuya etiqueta muestra el estado actual (**Activado** o **Desactivado**), y la fecha de **Fin de validez**. Consulte [Estado y ciclo de vida](#estado-y-ciclo-de-vida)
- Fechas **Creado** y **Actualizado** (solo lectura)
- Escriba en **Proveedor**, **Empresa pagadora**, **Cuenta**, **Responsable IT**, **Responsable de negocio** o un campo de dimensión analítica para buscar por nombre. Las coincidencias aparecen mientras escribe, de modo que puede encontrar cualquier valor incluso en una lista muy larga; una línea bajo la lista muestra «Escriba para acotar: hay más resultados» cuando hay más coincidencias de las que se muestran
- La **Prioridad** se define en el panel Propiedades al crear la partida y después en la barra de metadatos

**Centro de coste**:

- La lista muestra el árbol de centros de coste. Los grupos se muestran para ayudarle a orientarse y no se pueden elegir. Busque por código, nombre o nombre de grupo
- Un centro de coste desactivado aparece marcado como **Desactivado**. Se mantiene en las partidas que ya lo tienen y no se puede elegir para otra partida
- Cuando crea una partida y la empresa pagadora está vacía, elegir un centro de coste completa la empresa pagadora con la empresa del centro de coste, de modo que la lista **Cuenta** se abre en el plan de cuentas de esa empresa. Hasta que usted elija una empresa o una cuenta, elegir otro centro de coste también actualiza la empresa
- Cuando la empresa pagadora difiere de la empresa del centro de coste, se conservan ambas. Una indicación bajo el campo dice "Este centro de coste pertenece a" seguido del nombre de la empresa
- Una partida guardada mediante la API con un centro de coste y sin empresa pagadora toma la empresa del centro de coste. Para los archivos CSV, consulte [Importación/exportación CSV](#importacionexportacion-csv)

**Run o build**: **Run**, **Build** o **Sin definir**. Úselo para repartir el presupuesto entre mantener los servicios en funcionamiento y modificarlos.

**Dimensiones analíticas**:

- Cada dimensión activada tiene su propio campo, con el nombre de la dimensión, en el orden de las dimensiones. Elija un valor o vacíe el campo; el cambio se guarda de inmediato
- Cada campo lista los valores activados de su dimensión. Un valor desactivado se mantiene en las partidas que ya lo tienen y no se puede elegir para otra partida
- El campo no puede crear un valor: créelo en [Dimensiones analíticas](analytics.md) o deje que lo cree una importación CSV
- Si las dimensiones no se pueden cargar, una línea sustituye a estos campos: "No se pudieron cargar las dimensiones."

**Consejo**: Al crear una partida, una advertencia de "cuenta obsoleta" significa que la cuenta seleccionada no pertenece al plan de cuentas de la empresa pagadora. Elija otra cuenta para resolver la advertencia. Una partida existente cuya cuenta está fuera del plan de su empresa se puede seguir editando: el plan solo se comprueba cuando cambia la empresa o la cuenta.

---

### Presupuesto

La pestaña Presupuesto es donde introduce datos financieros por año. Admite varias columnas presupuestarias y dos modos de entrada, mostrados como pestañas: **Anual** (total anual) y **Mensual** (desglose de 12 meses).

**Selección de año**:

- Utilice las pestañas de año en la parte superior para alternar entre A-2, A-1, A (año actual), A+1 y A+2
- Cada año tiene su propia versión, método de asignación e importes
- Al cambiar de año se guardan primero sus cambios pendientes

**Columnas presupuestarias** (todos los años):

La pestaña muestra las columnas que muestra su organización, con sus nombres, siempre en el mismo orden. Las columnas estándar son:

- **Presupuesto**: Presupuesto de capital planificado inicial
- **Revisión**: Actualización presupuestaria a mitad de año (p. ej., después de cambios de alcance o reprevisiones)
- **Previsión**: Una columna de planificación adicional, oculta por defecto
- **Realizado**: El gasto de capital real, tal como se registra durante el año
- **Aterrizaje previsto**: Su mejor estimación del gasto de capital de fin de año

Un administrador de presupuesto puede renombrar las columnas, ocultar algunas y elegir la columna por defecto en **Gestión presupuestaria > Administración > Columnas presupuestarias** (consulte [Columnas presupuestarias](budget-operations.md#columnas-presupuestarias)). Una columna oculta conserva sus importes.

**Periodo de una columna**:

- Cada columna tiene un periodo dentro del año, por ejemplo de abril a diciembre
- Un mes cuenta cuando el periodo cubre su día 15. Un periodo que empieza el 10 de abril incluye abril; uno que empieza el 20 de abril comienza en mayo
- Una columna sin importe y sin periodo recibe una sugerencia: el **Inicio de vigencia** y el **Fin de validez** de la partida, limitados al año. Una inversión que empieza el 1 de abril sugiere de abril a diciembre
- Una columna que ya tiene importes y no tiene periodo se lee como todo el año, de modo que los datos existentes se comportan como antes

**Anual o Mensual**:

- **Anual**: Introduzca un total por columna. El total se reparte uniformemente entre los meses del periodo de la columna, y los meses fuera de él se ponen a cero. El periodo aparece bajo cada total antes de escribir, por ejemplo «9 meses, de abril a diciembre». Solo se guarda el total que usted modifica. Las demás columnas conservan sus importes mensuales.
- Haga clic en el icono de lápiz junto al periodo bajo un total (**Cambiar el periodo**) para abrir el panel de reparto en esa columna, con su total actual. Si las fechas de la partida no dejan ningún mes en el año, el total se deshabilita y muestra «Ningún mes de 2026 está dentro de las fechas de la partida.» Haga clic en el icono de lápiz junto a ese texto (**Elegir el periodo**) para definirlo usted mismo.
- Haga clic en el icono de calculadora junto al lápiz (**Cantidad y precio**) para abrir el mismo cuadro en las líneas de esa columna. Consulte [Cantidad y precio](#cantidad-y-precio).
- Una columna que sigue sus líneas (sus importes se calcularon a partir de sus líneas de Cantidad y precio) tiene un total de solo lectura. Haga clic en el total, o pulse Intro sobre él, para abrir **Cantidad y precio** en esa columna. El lápiz hace lo mismo. Pase el cursor sobre el total para leer «Calculado a partir de sus líneas. Abra Cantidad y precio para cambiarlo.»
- **Mensual**: Introduzca importes por mes (enero a diciembre) para cada columna visible, para un seguimiento detallado del gasto del proyecto. Se muestran subtotales trimestrales y un total anual. Solo se guardan los meses que usted modifica.
- Ambas pestañas muestran las mismas columnas: Previsión también aparece en **Anual** cuando se muestra.
- Cambie de modo con las pestañas **Anual** y **Mensual**
- Su elección entre **Anual** y **Mensual** se guarda en su navegador, solo para usted: cambiar de modo no modifica lo que ven otros usuarios que abren esta partida. Hasta que elija, una columna se abre en el modo en que se introdujeron sus importes por última vez.
- Cambiar de modo no modifica sus importes, solo la vista. Anual muestra el total anual de los meses guardados y Mensual muestra los meses guardados.

**Comportamiento de congelación**:

- Si el presupuesto de un año está congelado (vía Administración presupuestaria), los campos pasan a solo lectura y muestran un candado
- Cada columna puede congelarse independientemente
- Puede ver los datos congelados; los administradores pueden descongelar vía **Gestión presupuestaria > Administración > Congelar / Descongelar datos**

**Repartir un importe**:

- El cuadro del panel tiene dos pestañas: **Repartir un importe** y **Cantidad y precio**. Esta parte trata de la primera
- El panel de reparto siempre está visible en la pestaña **Mensual**. En la pestaña **Anual** se abre desde el icono de lápiz bajo un total, y su botón de cierre lo cierra
- Elija una **Columna** entre las columnas visibles, compruebe el **Importe**, elija una **Distribución** (**Uniforme** o **4-4-5**) y defina las fechas **Desde** y **Hasta**. Las fechas parten del periodo actual de la columna, y la distribución de la que ya tiene la columna
- El panel se abre en la columna por defecto. El importe parte del total actual de la columna, en ambas pestañas, y se actualiza cuando elige otra columna. Queda vacío cuando la columna no tiene importe
- **Cada cambio se guarda de inmediato**: el importe al salir del campo o al pulsar Intro, la distribución y las fechas en cuanto las cambia. No hay ningún botón que pulsar. Un importe vacío o igual a cero no guarda nada
- **Aplicar el reparto a todas las columnas** es un interruptor, activado por defecto: cada columna que lo sigue recibe la misma distribución y el mismo periodo, y cada una conserva su propio total actual. Activarlo reparte esas columnas de inmediato, y queda activado para sus cambios siguientes. Desactivarlo no cambia nada por sí solo: los cambios siguientes se aplican solo a la columna seleccionada. Por defecto, todas las columnas lo siguen. Un administrador de presupuesto elige cuáles en [Columnas presupuestarias](budget-operations.md#columnas-presupuestarias). Las columnas congeladas nunca cambian. Pase el cursor sobre el interruptor para ver qué columnas siguen y cuáles conservan su propio periodo
- Una columna que no sigue el interruptor se reparte sola: el interruptor no aparece cuando la reparte. El interruptor también se oculta cuando ninguna otra columna que lo sigue puede cambiar
- Las columnas que siguen sus líneas quedan fuera del interruptor: conservan los importes de sus líneas, y una frase las nombra, por ejemplo «Previsión conserva sus líneas.» Cuando todas las demás columnas siguen sus líneas, el interruptor no aparece
- Para devolver una columna a un reparto uniforme en doce meses, elija **Uniforme** y defina las fechas del 1 de enero al 31 de diciembre
- Los totales introducidos en la pestaña **Anual** siguen aplicándose solo a su propia columna
- Las fechas **Desde** y **Hasta** muestran el periodo. Cuando algunos meses quedan fuera, el panel indica cuáles se pondrán a cero («De enero a marzo se pondrán a cero.»). Un periodo de todo el año no muestra ninguna línea. Pase el cursor sobre el icono de información junto al título del panel para ver la regla del día 15
- Con **4-4-5**, los pesos de los meses que cuentan se amplían para que todo el importe recaiga en ellos
- Aparece un aviso no bloqueante cuando el periodo va más allá de las fechas de la partida. El reparto se guarda de todos modos
- Mientras falte una fecha o ningún mes cuente, el panel indica el motivo y no guarda nada
- Una columna que sigue sus líneas muestra sus valores actuales en los campos, en gris, bajo la frase «Los importes vienen de las 4 líneas de Cantidad y precio.» Haga clic en **Repartir un importe en su lugar** para desbloquear los campos de esa columna. La frase pasa a decir «Un reparto reemplaza los importes de las líneas. Las líneas se mantienen como referencia.» El bloqueo vuelve cuando cambia de columna, de año o de cuadro
- Un reparto sobre una columna construida a partir de líneas conserva sus líneas como referencia. Consulte [Cantidad y precio](#cantidad-y-precio)

**Cómo se produjo cada columna**:

- Una etiqueta breve indica de dónde vienen los importes de una columna. En la pestaña **Mensual** aparece bajo el encabezado de la columna (pase el cursor por encima para ver el periodo). En la pestaña **Anual** aparece junto al periodo
- **Reparto uniforme**, **Reparto 4-4-5** o **Reparto por trimestre**: los importes proceden de un reparto
- **Copiado de Presupuesto 2025 +2 %**: los importes proceden de **Copiar columnas presupuestarias** en la Administración presupuestaria, con el porcentaje visible cuando lo hay
- **Cantidad y precio · 3 líneas · 1.00 ETC**: los importes proceden de líneas, con su número y, cuando las líneas cuentan personas o días, el ETC de la columna. El ETC es la media anual. Pase el cursor sobre la etiqueta para ver las líneas, por ejemplo «Jefe de proyecto: 1 persona × 1.200 por día, 5 días por mes, de feb a jul»
- **Editado a mano**: se modificó un mes en la cuadrícula o mediante la importación de un archivo de presupuesto
- Una columna sin etiqueta conserva los datos que tenía antes de que existieran los periodos

**Cuando otra persona edita la misma columna**:

- Dos personas pueden rellenar meses o columnas distintos de la misma partida a la vez, sin conflicto
- En una entrada mensual, si otra persona cambió alguno de los mismos meses, esos meses esperan su decisión; los demás meses de la columna se guardan como usted los escribió
- Si otra persona cambió el total de la columna, su reparto o sus líneas de Cantidad y precio mientras usted trabajaba en ellas, toda la columna espera: un aviso ofrece **Recargar la columna** o **Sobrescribir**. Los importes, el panel de reparto y las líneas de la columna quedan en solo lectura hasta que decida
- Guardar recarga el año, así que siempre ve las cifras más recientes de cualquier otra columna; la celda o columna que está editando no se ve afectada

**Herramientas del modo mensual** (solo modo Mensual):

- **Borrar columna**: el icono junto al encabezado de una columna pone a cero todos los meses de esa columna. Cuando la columna contiene importes, primero lo confirma
- Útil para introducir a mano un plan de desembolsos, por ejemplo todo el importe en un solo mes
- Borrar de esta forma cuenta como una edición a mano. Para quitar a la vez los importes y el periodo de una columna en todas las inversiones, use **Restablecer columna presupuestaria** en la Administración presupuestaria

**Tendencia plurianual**:

- Un gráfico bajo la tabla muestra cada columna visible a lo largo de los años, incluida Previsión cuando se muestra, y se actualiza mientras escribe

**Cómo usarlo**:

1. Seleccione el año que está planificando
2. Elija la pestaña **Anual** o **Mensual**
3. Complete las columnas relevantes (Presupuesto para la planificación inicial, Realizado para el seguimiento, Aterrizaje previsto para la cifra de cierre de año)
4. Sus cambios se guardan automáticamente; junto a las pestañas de año aparece la indicación **Guardando...** / **Guardado**

**Consejo**: Para la mayoría de partidas, el modo Anual es más rápido. Utilice el modo Mensual cuando necesite hacer seguimiento del ritmo del gasto de proyectos o despliegues por fases.

#### Cantidad y precio

Construya una columna a partir de líneas en lugar de escribir sus importes. Cada línea se lee como una frase: una cantidad, una unidad, un precio unitario, una frecuencia, cuándo y con qué calendario. Por ejemplo, un contratista en un proyecto de build a tiempo completo a 400 por día de febrero a octubre, y 20 portátiles a 1.200 por pieza, comprados una vez el 15 de marzo. Los meses de la columna son la suma de sus líneas. Los importes de una columna tienen una sola fuente a la vez: sus líneas, o un reparto, un mes escrito a mano o una copia. La otra fuente sigue visible como referencia, de solo lectura, con un enlace para cambiar.

**Abrir la pestaña**:

- Pestaña **Anual**: haga clic en el icono de calculadora junto al periodo bajo un total. El cuadro se abre en **Cantidad y precio** para esa columna. En una columna que sigue sus líneas, el lápiz y el total también lo abren
- Pestaña **Mensual**: haga clic en **Cantidad y precio** en la parte superior del cuadro del panel. Elegir una columna que sigue sus líneas, o tener una como columna por defecto, cambia el cuadro a **Cantidad y precio**
- Elija la **Columna** en la parte superior de la pestaña. Las columnas congeladas no se pueden elegir

**Las líneas**:

| Columna | Qué introducir |
|---|---|
| **Descripción** | Lo que paga la línea, por ejemplo «Jefe de proyecto». Opcional, hasta 200 caracteres |
| **Cantidad** | Cuántas, en la unidad de la línea. Cero o más, hasta 3 decimales |
| **Unidad** | **personas**, **días** o **piezas**. La unidad decide a qué corresponde el precio, con qué frecuencia cuenta, cómo se reparte el importe entre los meses y el ETC |
| **Precio unitario** | El precio de una unidad, en la moneda de la partida. Hasta 4 decimales. Se acepta un precio negativo, para un abono. A qué corresponde el precio aparece justo después: **por día** para los días, **por pieza** para las piezas y, para las personas, una pequeña lista para elegir **por día** o **por mes** |
| **Frecuencia** | Depende de la unidad. Personas con precio por día: una casilla **Tiempo completo** y, cuando no está marcada, los **días por mes** que trabajan en la partida (más de 0, hasta 31, con hasta 3 decimales). Personas con precio por mes: «por mes». Días: «en el periodo». Piezas: una lista para elegir **por mes** o **una vez** |
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

- Use **personas** para el personal que trabaja en la partida mes tras mes. Con precio por día, indique cuánto trabajan: marque **Tiempo completo** para contar todos los días laborables del calendario desde el inicio hasta el fin de la línea, o introduzca los días por mes. Por ejemplo, un jefe de proyecto 5 días por mes a 1.200 por día de febrero a julio cuesta 6.000 al mes. En un calendario con 21 días laborables en marzo, ese mes cuenta 5 ÷ 21, unos 0.24 ETC. Un consultor a tiempo completo a 400 por día cuesta cada mes los días laborables del mes × 400, y cuenta 1 ETC
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
- Notas cuando corresponde: «El periodo va más allá de las fechas de la partida.», un calendario desactivado después, por ejemplo «Personal de la sede está desactivado. Las líneas aún lo usan.», y días laborables modificados desde el último guardado de las líneas
- **Aplicar estas líneas a todas las columnas**: un interruptor para las mismas columnas que el interruptor de la pestaña de reparto, desactivado por defecto aquí. Activarlo escribe las líneas en cada columna que lo sigue de inmediato, y queda activado: cada guardado posterior escribe también las líneas en esas columnas. Desactivarlo no cambia nada por sí solo

**Cuando los importes cambian de otra forma**: las líneas se quedan en la columna como referencia, y la pestaña indica de dónde vienen ahora los importes, seguido de un enlace **Usar de nuevo las líneas**. Las líneas pasan entonces a solo lectura: no puede añadir, quitar ni editar una línea, y la pestaña no muestra importe por línea, ni ETC, ni **Aplicar estas líneas a todas las columnas**. El enlace guarda las líneas tal como están y vuelve a calcular la columna a partir de ellas, y las líneas vuelven a ser editables. Para cambiar una línea conservada como referencia, haga clic primero en **Usar de nuevo las líneas** y edítela después.

- Un mes introducido en la pestaña **Mensual**: «Los importes se introdujeron a mano. Usar de nuevo las líneas.»
- Un reparto: «Los importes vienen de un reparto. Usar de nuevo las líneas.»
- **Copiar columnas presupuestarias** en la Administración presupuestaria: «Los importes se copiaron de Presupuesto 2025. Usar de nuevo las líneas.» Cuando los importes de origen no se calcularon a partir de líneas, la copia lleva las líneas de la columna de origen como referencia. Una columna calculada a partir de sus líneas sigue calculada, con sus precios aumentados por el porcentaje. Consulte [Copiar una columna construida a partir de líneas](budget-operations.md#copiar-una-columna-construida-a-partir-de-lineas)
- Los días laborables de un calendario cambiaron: «Días laborables modificados desde el último cálculo: marzo: 20 días, ahora 19.» Nada cambia en la columna hasta que haga clic en **Usar de nuevo las líneas**. Las líneas siguen siendo editables mientras tanto
- **Restablecer columna presupuestaria** en la Administración presupuestaria quita las líneas junto con los importes. Consulte [Restablecer columna presupuestaria](budget-operations.md#restablecer-columna-presupuestaria)
- Un archivo de presupuesto cambia los meses de una columna y deja sus líneas. Consulte [Cargar un presupuesto desde una hoja de cálculo](budget-file.md)

#### ETC

El ETC (equivalente a tiempo completo) indica cuántas personas paga una columna. Procede de las líneas: cada mes suma el ETC de sus líneas (consulte la tabla anterior). De ahí salen dos cifras, cada una redondeada a 2 decimales:

- **Media anual**: la suma de los doce meses dividida entre 12. Es el ETC de la columna, visible en la etiqueta de la columna y en las columnas de ETC de la lista CAPEX
- **ETC en el periodo**: la suma de los meses con personas o días, dividida entre el número de esos meses. Las piezas no cuentan, así que las licencias o un portátil nunca lo reducen. Aparece bajo las líneas mientras los importes vienen de ellas. Tras una edición a mano, un reparto o una copia, no se muestra hasta que use de nuevo las líneas

Por ejemplo, un consultor a tiempo completo de febrero a octubre cuenta 1 ETC en cada uno de esos 9 meses: 1.00 en el periodo, y 9 × 1 ÷ 12 = 0.75 para el año completo. Un jefe de proyecto 5 días por mes de febrero a julio cuenta unos 0.24 en el periodo, y 0.12 para el año completo. Unas licencias durante todo el año o un portátil en diciembre en la misma columna dejan ambas cifras como están.

- **Contado**: una columna con líneas en personas o días
- **Cero**: una columna cuyas líneas están todas en piezas. Su ETC es 0
- **Vacío**: una columna sin líneas, una partida sin versión para ese año o un año posterior al fin de validez de la partida. Su celda de ETC queda vacía, porque KANAP no puede saber cuántas personas paga
- El ETC se queda con las líneas. Tras una edición a mano, un reparto o una copia, la columna conserva el ETC de sus líneas. Una copia recalcula el ETC a partir de las líneas copiadas, con los calendarios laborales del año de destino

---

### Asignaciones

La pestaña Asignaciones distribuye el gasto de capital entre sus empresas y departamentos. Esto alimenta los informes de contracargo y ayuda a asignar los costes de los activos.

**Selección de año**:

- Funciona igual que Presupuesto: use las pestañas de año para alternar entre A-2, A-1, A, A+1, A+2
- Cada año puede tener un método de asignación diferente
- El total anual de la columna por defecto aparece a la derecha, por ejemplo **Presupuesto, total del año**

**Métodos de asignación**:

1. **Plantilla (por defecto)**: Reparte el gasto de capital proporcionalmente según la plantilla de cada empresa para el año seleccionado. Los porcentajes se actualizan automáticamente cuando edita las métricas de las empresas. Es el método estándar.

2. **Usuarios IT**: Reparte el gasto proporcionalmente según el número de usuarios IT de cada empresa para el año seleccionado. Útil para inversiones de infraestructura IT que crecen con el personal IT.

3. **Facturación**: Reparte el gasto proporcionalmente según la facturación de cada empresa para el año seleccionado. Útil para plataformas o infraestructuras de toda la empresa.

4. **Manual por empresa**: Usted selecciona qué empresas reciben esta inversión. Elija un inductor en **Asignar por** (Plantilla, Usuarios IT o Facturación) para calcular los porcentajes entre las empresas seleccionadas. Solo las empresas seleccionadas entran en el reparto.

5. **Manual por departamento**: Usted selecciona pares empresa/departamento concretos. Los porcentajes se calculan a partir de la plantilla de cada departamento. Útil cuando una inversión solo beneficia a ciertos departamentos (p. ej., equipos de fabricación).

6. **Porcentajes manuales**: Usted elige las empresas y escribe cada porcentaje. El total debe sumar 100 %.

**Métodos por defecto y fijados**:

- La opción **por defecto**, mostrada como *Plantilla (por defecto)* hasta que su organización configure otro método, sigue la configuración de **Gestión presupuestaria > Administración > Método de asignación por defecto**. Cada inversión que se deje en el valor por defecto se recalcula cuando un administrador cambia esa configuración.
- Esa configuración también puede restringir el valor por defecto a una **selección de empresas** (por ejemplo la entidad que lleva el presupuesto IT): el inductor se aplica entonces solo a esas empresas, y la opción muestra *Por defecto (n sociedades)*.
- **Plantilla**, **Usuarios IT** y **Facturación** fijan ese método en la inversión: un método fijado sigue funcionando aunque el valor por defecto de la organización cambie más adelante.
- Las inversiones con una asignación manual nunca se ven afectadas por la configuración por defecto.

**Cómo funcionan los porcentajes**:

- En los **métodos automáticos** (Plantilla, Usuarios IT, Facturación): los porcentajes se calculan a partir de las métricas más recientes de sus empresas activas. No se editan directamente.
- En **Manual por empresa** y **Manual por departamento**: usted elige las empresas o departamentos y el sistema calcula los porcentajes según el inductor elegido y las métricas actuales.
- En **Porcentajes manuales**: escribir un porcentaje fija esa fila y las demás filas se reparten el resto. **Repartir equitativamente** da la misma parte a cada fila; **Borrar fijaciones manuales** libera las filas fijadas.
- Los porcentajes reflejan datos en tiempo real. Si actualiza la plantilla de una empresa, las asignaciones se recalculan.

**Ver las asignaciones**:

- La tabla muestra la empresa (o empresa / departamento), el valor del inductor, el porcentaje y el importe, con una fila de total
- El porcentaje total debe ser igual a 100 %; en Porcentajes manuales aparece una advertencia mientras no lo sea

**Cómo usarlo**:

1. Seleccione el año
2. Elija un método de asignación en **Método**
3. Para un método manual, use **Agregar fila** para añadir empresas (o pares empresa/departamento) y el icono de quitar para eliminar las que no se benefician de esta inversión
4. Los cambios se guardan automáticamente

**Problemas comunes**:

- **Métricas faltantes**: Una o más empresas tienen la plantilla, los usuarios IT o la facturación en cero o sin informar para el año seleccionado. Complete las métricas en **Datos maestros > Empresas** (pestaña Detalles).
- **"Los porcentajes manuales deben sumar 100 %."**: Ajuste las filas o haga clic en **Repartir equitativamente**.

**Cuando otra persona edita la asignación**:

- El método, el inductor y las filas se guardan juntos. Si otra persona cambió la asignación mientras usted la editaba, un aviso ofrece **Recargar la asignación** o **Sobrescribir**
- Cambiar de año con una decisión pendiente pide confirmación primero

**Consejo**: Use Plantilla para la mayoría de partidas (es lo más sencillo y se actualiza automáticamente). Reserve Manual por empresa para inversiones que solo benefician a entidades concretas (p. ej., un centro de datos regional). Use Manual por departamento para inversiones muy específicas.

---

### Relaciones

La pestaña Relaciones vincula esta partida CAPEX con objetos relacionados: Proyectos, Aplicaciones, Contratos, Contactos, Sitios web relevantes y Adjuntos. Todo lo de esta pestaña se guarda automáticamente.

**Proyectos**:

- Use el autocompletado para vincular uno o más proyectos
- Esto ayuda a agrupar el gasto de capital por proyecto en los informes y permite la contabilidad de proyectos
- Los nombres de los proyectos aparecen en la columna **Proyecto** de la lista CAPEX, y la búsqueda rápida los encuentra
- Quite un proyecto haciendo clic en la X de su chip

**Aplicaciones**:

- Use el autocompletado para vincular una o más aplicaciones o servicios de su catálogo IT
- Esto ayuda a saber qué partidas CAPEX financian qué aplicaciones o servicios
- Quite una aplicación haciendo clic en la X de su chip

**Contratos**:

- Use el autocompletado para vincular uno o más contratos
- Una vez vinculado, el nombre del contrato aparece en la columna **Contrato** de la lista CAPEX como referencia rápida
- Un contrato también puede vincularse a varias partidas CAPEX (relación de muchos a muchos)
- Quite un contrato haciendo clic en la X de su chip

**Contactos**:

- Vincule contactos a esta partida CAPEX: elija un contacto y luego su rol (**Comercial**, **Técnico**, **Soporte** u **Otro**). Al elegir el rol se añade el contacto
- La tabla muestra el rol, el nombre, el apellido, el cargo, el correo y el móvil. Pase el ratón sobre el rol para ver si el contacto viene del proveedor o se añadió manualmente
- Quite un contacto con el icono de quitar

**Sitios web relevantes**:

- Haga clic en **Agregar URL** para añadir un enlace (p. ej., páginas de producto del proveedor, documentación técnica, wikis internos). Cada enlace tiene un **Nombre** y una **URL**
- Haga clic en la fila de un enlace para editarlo, o use el icono de eliminar para quitarlo

**Adjuntos**:

- Suba archivos relacionados con esta partida de capital (p. ej., presupuestos, propuestas de proveedores, especificaciones técnicas, memorandos de aprobación)
- Arrastre y suelte archivos en la zona de adjuntos, o haga clic en **Seleccionar archivos** para buscarlos
- Haga clic en el chip de un archivo para descargarlo
- Elimine un adjunto con el icono de eliminar de su chip (tras confirmar; requiere el permiso `capex:manager`)

**¿Por qué vincular?**:

- **Proyectos**: Consolidar el gasto de capital por proyecto para la contabilidad y los informes de proyectos
- **Aplicaciones**: Ver qué aplicaciones o servicios financia una inversión
- **Contratos**: Saber qué partidas de capital están cubiertas por acuerdos de compra o contratos de servicio
- **Contactos**: Mantener los datos de contacto de proveedores y partes interesadas asociados a la inversión
- **Sitios web relevantes y adjuntos**: Centralizar toda la documentación y las referencias de la inversión para acceder fácilmente

**Consejo**: Suba presupuestos de proveedores, memorandos de aprobación y especificaciones técnicas como adjuntos. Vincule contratos para seguir las compras. Use los contactos para asociar los interlocutores del proveedor a cada partida de capital.

---

## Importación/exportación CSV

**Exportar CSV** e **Importar CSV** están en la barra de herramientas de la lista CAPEX. Ambos requieren derechos de administración en CAPEX (`capex:admin`).

**Exportar CSV** escribe el archivo de presupuesto CAPEX de las partidas que muestra la lista. **Importar CSV** vuelve a leer un archivo: primero se comprueba, y no se escribe nada hasta que haga clic en **Cargar**.

El archivo contiene una fila por partida, los detalles de la partida, sus importes en columnas y `kanap_token`. [Cargar un presupuesto desde una hoja de cálculo](budget-file.md) describe las columnas, lo que significa una celda y los dos pasos de la importación.

## Estado y ciclo de vida

Cada partida CAPEX tiene un **estado** (Habilitado o Deshabilitado) y un **Fin de validez** opcional que controla cuándo aparece en informes y listas de selección. Es la única fecha de fin de una partida.

**Cómo funciona**:

- **Habilitado**: La partida está activa y aparece en todas partes (listas, informes, asignaciones)
- **Fin de validez**: La fecha en que la partida termina. Déjelo en blanco si no hay fin. Cuando pasa el fin de validez, el estado cambia a **Desactivado** por sí solo en el plazo de una hora
- Después del fin de validez:
  - La partida ya no aparece en listas de selección para nuevos contratos o asignaciones
  - Se excluye de informes para años estrictamente posteriores al fin de validez
  - Los datos históricos permanecen intactos; la partida sigue apareciendo en informes que cubren años cuando estaba activa

**Establecer estado**:

- Al crear la partida, puede establecer su **Fin de validez** en el panel **Propiedades**
- Más adelante, cambie el **Estado** en la barra de metadatos, o use el campo **Ciclo de vida** del panel **Propiedades** (interruptor de estado y **Fin de validez**). Desactivar una partida sin fecha fija su fin de validez en el día de hoy
- Puede programar un fin de validez futuro (útil para disposiciones de activos planificadas o fechas de fin de vida)

**Ver partidas deshabilitadas**:

- Por defecto, la lista CAPEX muestra solo partidas **Habilitadas**
- Utilice el conmutador **Mostrar: Todos / Activos / Desactivados** para cambiar el alcance

**Cuándo desactivar vs eliminar**:

- **Prefiera desactivar**: Mantiene el historial intacto, asegura que los informes permanezcan consistentes y soporta registros de auditoría
- **Elimine solo si**: La partida se creó por error
- Una partida con importes en una columna congelada no se puede eliminar. Primero descongele la columna, o fije en su lugar una fecha de fin de validez. Cuando elimina varias partidas a la vez, las demás se eliminan, y el mensaje nombra cada partida rechazada con su motivo
- Eliminar una partida también elimina sus presupuestos, asignaciones, tareas, sitios web relevantes, adjuntos (con sus archivos) y sus vínculos con contratos. Si una de sus tareas se convirtió en una solicitud, la solicitud se conserva: tiene su propia copia del título, la descripción y los adjuntos, y solo se pierde su vínculo con la tarea

**Consejo**: Utilice el Fin de validez para marcar activos que han sido completamente depreciados, eliminados o proyectos completados. No elimine a menos que sea un verdadero error.

---

## Permisos

El acceso a CAPEX se controla por tres niveles:

- `capex:reader`: Ver la lista CAPEX, abrir partidas, ver presupuestos y asignaciones (solo lectura)
- `capex:manager`: Crear y editar partidas CAPEX, actualizar presupuestos y asignaciones, subir adjuntos, gestionar enlaces y contactos
- `capex:admin`: Todos los derechos de gestor más importación CSV, operaciones presupuestarias (congelar, copiar, restablecer) y eliminación masiva

Adicionalmente:

- Las tareas tienen permisos separados (`tasks:member` para crear/editar tareas en partidas CAPEX)
- Los usuarios con `tasks:reader` pueden ver tareas pero no crear ni editar

Si no puede realizar una acción (p. ej., falta el botón **Importar CSV**), consulte con su administrador del espacio de trabajo para revisar sus permisos de rol.

---

## Consejos

- **Empiece simple**: Cree partidas con solo lo esencial (descripción, tipo de activo fijo, tipo de inversión, empresa pagadora, cuenta), luego añada presupuestos y asignaciones a medida que planifica.
- **Use asignación por Plantilla**: Para la mayoría de inversiones de capital, Plantilla es suficiente. Reserve asignaciones manuales para inversiones que benefician solo a empresas o departamentos específicos.
- **Vincule contratos**: Si gestiona compras de capital mediante contratos, vincúlelos en la pestaña Relaciones para el seguimiento de adquisiciones.
- **Suba documentación**: Utilice la funcionalidad de adjuntos para almacenar presupuestos de proveedores, memorandos de aprobación y especificaciones técnicas junto a la partida.
- **Clasifique con precisión**: Utilice Tipo de inversión y Prioridad consistentemente para habilitar análisis significativos del gasto de capital y la priorización.
- **Mantenga actualizadas las métricas de empresa**: Las asignaciones dependen de la plantilla, usuarios IT y facturación de la empresa. Las métricas desactualizadas causan errores de asignación.
- **Use CSV para configuración masiva**: Si está migrando desde otro sistema o tiene muchas partidas de capital, comience con importación CSV. Exporte un archivo nuevo, rellene sus filas y compruébelo antes de cargar.
- **Desactive, no elimine**: Preserve el historial desactivando partidas cuando los activos se eliminen o los proyectos se completen.
- **Revise la fila de totales**: Antes de finalizar presupuestos de capital, verifique la fila de totales fijada para asegurar que su gasto de capital suma como se espera.
- **Use enlace directo**: Haga clic directamente en una columna de presupuesto o asignación en la lista para ir directamente a esa pestaña y año.
- **Haga seguimiento del ritmo de gasto**: Para proyectos grandes con gasto por fases, utilice el modo Mensual para hacer seguimiento del gasto contra los hitos del proyecto.
- **Congele después del cierre de año**: Utilice Administración presupuestaria para congelar los presupuestos del año anterior una vez que el realizado esté finalizado, previniendo ediciones accidentales.
