# OPEX

Las partidas OPEX (gasto operativo) son sus costes IT recurrentes: licencias de software, suscripciones cloud, contratos de mantenimiento y servicios. Aquí es donde planifica presupuestos, hace seguimiento del realizado y asigna costes en toda su organización.

El espacio de trabajo OPEX le ayuda a gestionar cada partida de gasto desde la presupuestación inicial hasta la ejecución y los informes, todo en un solo lugar con columnas presupuestarias año a año, métodos flexibles de asignación y vínculos directos a proveedores, contratos, aplicaciones y proyectos.

## Primeros pasos

Navegue a **Gestión presupuestaria > OPEX** para ver su lista. Haga clic en **Nuevo** para crear su primera partida.

El espacio de trabajo se abre en modo de creación, con el panel **Propiedades** abierto a la derecha. Escriba el nombre del producto en el título de arriba, complete las propiedades y haga clic en **Crear**.

**Campos obligatorios**:
  - **Nombre del producto** (el título): En qué gasta (p. ej., "Licencias Salesforce", "AWS Compute")
  - **Empresa pagadora**: Qué empresa paga este gasto (obligatorio para contabilidad)
  - **Cuenta**: La cuenta contable de este gasto. Solo aparecen las cuentas del plan de cuentas de la empresa pagadora
  - **Moneda**: Código ISO (p. ej., USD, EUR). Por defecto la moneda de su espacio de trabajo; puede cambiarla por partida
  - **Inicio de vigencia**: Cuándo comienza este gasto (DD/MM/AAAA)

**Opcional pero útil**:
  - **Proveedor**: A quién paga. Vinculado a sus proveedores en datos maestros
  - **Centro de coste**: Quién es responsable del gasto. Consulte [Centros de coste](cost-centers.md). Cuando la empresa pagadora aún está vacía, elegir un centro de coste la completa con la empresa del centro de coste
  - **Run o build**: **Run** para el gasto que mantiene en funcionamiento los servicios existentes, **Build** para el gasto que los crea o los modifica
  - **Categoría analítica**: Agrupación personalizada para informes (p. ej., "Infraestructura", "Apps de negocio"). Se pueden crear categorías nuevas sobre la marcha
  - **Fin de validez**: La fecha en que termina este gasto. Déjela en blanco si no hay fin. Después de esa fecha, la partida queda desactivada y los años posteriores dejan de contar en las vistas presupuestarias
  - **Responsable de TI** / **Responsable de negocio**: Quién es responsable
  - **Descripción** y **Notas**: Texto libre en la pestaña Vista general

Una vez definidas, **Empresa pagadora** y **Cuenta** se pueden cambiar, pero no vaciar. **Proveedor** se puede borrar en cualquier momento.

Cuando cambia la empresa pagadora de una partida que tiene una cuenta y la nueva empresa usa otro plan de cuentas, la cuenta se borra en el mismo guardado. **Cuenta** aparece entonces como obligatoria, con la lista en el plan de la nueva empresa. Elija la nueva cuenta para terminar.

Una vez creada la partida, el espacio de trabajo desbloquea las cuatro pestañas: **Vista general**, **Presupuesto**, **Asignaciones** y **Relaciones**.

**Consejo**: Puede crear partidas rápidamente y completar presupuestos y asignaciones más tarde. Empiece por lo esencial y vaya iterando.

---

## Trabajar con la lista OPEX

La lista OPEX (en **Gestión presupuestaria > OPEX**) es su vista principal para navegar, filtrar y explorar partidas de gasto.

**Columnas predeterminadas**:
  - **Nombre del producto**: El nombre de la partida (enlaza a la pestaña Vista general)
  - **Proveedor**: El nombre del proveedor
  - **Empresa pagadora**: Qué empresa paga esta partida
  - **Contrato**: El nombre del último contrato vinculado (enlaza al espacio de trabajo del Contrato)
  - **Cuenta**: El número y nombre de cuenta contable
  - **Asignación**: La etiqueta del método de asignación del año actual (enlaza a la pestaña Asignaciones)
  - **Presupuesto A** y **Aterrizaje previsto A**: Los importes del año actual de la columna por defecto y de la última columna visible (enlazan a la pestaña Presupuesto de este año). Con la configuración estándar son Presupuesto y Aterrizaje previsto. Cuando la columna por defecto es también la última visible, aparece una sola columna de importe. Consulte [Columnas presupuestarias](budget-operations.md#columnas-presupuestarias)
  - **Tarea**: El título de la última tarea (enlaza a la pestaña Vista general, donde está el panel de tareas)

**Columnas adicionales** (ocultas por defecto, habilítelas mediante el selector de columnas):
  - **Columnas de importes**: Cada columna presupuestaria visible para A-1, A, A+1 y A+2, con los nombres que eligió su organización. El encabezado indica la columna, el año respecto a hoy y el año natural, por ejemplo **Revisión A+1 (2027)**. Los importes están en la moneda de reporte. Las columnas ocultas no se ofrecen
  - **Habilitado**: Estado de la partida (habilitado o deshabilitado)
  - **Descripción**: Descripción de la partida
  - **Moneda**: Código de moneda ISO
  - **Inicio efectivo**: Fecha de inicio
  - **Fin de validez**: Fecha en que la partida termina (en blanco significa sin fin)
  - **Responsable IT** / **Responsable de negocio**: Usuarios responsables
  - **Analítica**: Nombre de la categoría analítica
  - **Centro de coste**: El código y el nombre del centro de coste. Pase el cursor por encima para ver su ruta completa en el árbol; haga clic para abrir el centro de coste
  - **Responsable del presupuesto**: El responsable del presupuesto del centro de coste de la partida. Se deriva del centro de coste y no se almacena en la partida: cambie el responsable del presupuesto de un centro de coste y todas sus partidas lo siguen
  - **Run o build**: **Run** o **Build**
  - **Proyecto**: Nombres de los proyectos vinculados en la pestaña Relaciones
  - **Notas**: Notas internas
  - **Creado / Actualizado**: Marcas de tiempo

**Filtrado**:
  - **Búsqueda rápida**: Busca en la referencia, el nombre del producto, la descripción, el proveedor, la empresa pagadora, la cuenta, el contrato, los nombres de proyectos, la asignación, los responsables, la categoría analítica, el centro de coste (código, nombre y ruta), el responsable del presupuesto, las notas, la moneda y el estado. Filtra la lista en tiempo real mientras escribe
  - **Filtros de columna**: Haga clic en el icono de filtro en cualquier encabezado de columna. **Proveedor**, **Empresa pagadora**, **Cuenta**, **Asignación**, **Moneda**, **Responsable IT**, **Responsable de negocio**, **Analítica**, **Centro de coste**, **Responsable del presupuesto**, **Run o build** y **Habilitado** usan filtros de conjunto de casillas (selección múltiple). El filtro **Habilitado** ofrece **Activado** y **Desactivado** y restringe la lista cuando **Mostrar** está en **Todos**
  - **Filtros de importe**: Cada columna de importe tiene un filtro numérico. Un número escrito en el cuadro bajo el encabezado conserva las partidas con al menos ese importe. Abra el menú del filtro para las demás condiciones: mayor que, menor que, igual, distinto o entre dos importes
  - **Filtros de fecha**: **Inicio efectivo**, **Fin de validez**, **Creado** y **Actualizado** tienen filtros de fecha. Elija una fecha en el cuadro bajo el encabezado para conservar las partidas de esa fecha, o abra el menú del filtro para antes de, después de, entre, vacío o no vacío
  - **Columnas de texto**: usan filtros de texto. En **Ref**, escriba el número o la referencia completa, por ejemplo `12` u `OPX-12`
  - **Alcance de estado**: Utilice el conmutador **Mostrar: Habilitados / Deshabilitados / Todos** encima de la cuadrícula (predeterminado: **Habilitados**)

**Ordenación**:
  - Haga clic en un encabezado de columna para ordenar ascendente/descendente. Todas las columnas se pueden ordenar, incluida cada columna de importe
  - La ordenación predeterminada es por la columna por defecto del año actual, de mayor a menor (**Presupuesto A** con la configuración estándar). Los botones **Anterior** y **Siguiente** del espacio de trabajo siguen el mismo orden
  - La lista recuerda su última ordenación, búsqueda y filtros cuando regresa

**Fila de totales**:
  - La fila fijada en la parte inferior muestra el total de cada columna de importe, en la moneda de reporte
  - Los totales respetan sus filtros y búsqueda actuales

**Enlace directo**:
  - Hacer clic en cualquier celda abre el espacio de trabajo en la pestaña más relevante:
    - **Nombre del producto**, **Proveedor**, **Empresa pagadora**, **Cuenta** y otras columnas generales: Abre la pestaña **Vista general**
    - **Columnas de importes** (Presupuesto A, Aterrizaje previsto A, Revisión A+1, etc.): Abre la pestaña **Presupuesto** preconfigurada en el año de la columna
    - **Asignación**: Abre la pestaña **Asignaciones** para el año actual
    - **Tarea**: Abre la pestaña **Vista general**, donde está el panel de tareas
    - **Contrato**: Abre directamente el espacio de trabajo del Contrato vinculado (no el espacio de trabajo OPEX)
    - **Centro de coste**: Abre el espacio de trabajo del centro de coste

**Acciones**:
  - **Nuevo**: Crear una nueva partida OPEX (requiere `opex:manager`)
  - **Importar CSV**: Carga masiva de partidas desde CSV (requiere `opex:admin`)
  - **Exportar CSV**: Exportar partidas a CSV (requiere `opex:admin`)
  - **Eliminar seleccionadas**: Eliminación masiva de partidas seleccionadas (requiere `opex:admin`; seleccione filas mediante casillas de verificación)

**Navegación Anterior/Siguiente**:
  - Cuando abre una partida, el espacio de trabajo muestra botones **Ant.** y **Sig.**
  - Estos navegan por la lista en el orden actual, respetando filtros y búsqueda
  - Pasar a otra partida guarda primero sus cambios pendientes
  - Su contexto de lista (ordenación, filtros, búsqueda) se preserva cuando cierra el espacio de trabajo

**Consejo**: Utilice filtros de columna + búsqueda rápida para construir vistas enfocadas (p. ej., "Todo el gasto en nube superior a 10k"), luego navegue partida por partida con Ant./Sig. para revisar presupuestos.

---

## El espacio de trabajo OPEX

Haga clic en cualquier fila de la lista para abrir el espacio de trabajo. Tiene cuatro partes:

  - **Cabecera**: la referencia de la partida (p. ej., `OPX-12`) con un botón para copiarla, el nombre del producto (haga clic en él para cambiar el nombre de la partida), **Ant.** / **Sig.**, **Enviar enlace** y el botón de cierre
  - **Barra de metadatos** bajo el título: **Estado**, **Responsable de TI** y **Responsable de negocio**, editables en el sitio. Cuando el centro de coste de la partida tiene un responsable del presupuesto, **Responsable del presupuesto** aparece a continuación. Es de solo lectura y se deriva del centro de coste, no se almacena en la partida: pase el cursor por encima para ver de qué centro de coste procede, y cámbielo en el centro de coste (consulte [Centros de coste](cost-centers.md#responsable-del-presupuesto-en-las-lineas-de-presupuesto))
  - **Cuatro pestañas**: **Vista general**, **Presupuesto**, **Asignaciones** y **Relaciones** (la pestaña Relaciones muestra cuántos vínculos tiene la partida)
  - **Panel Propiedades** a la derecha: los campos principales de la partida. Ábralo o ciérrelo con el botón de propiedades; el espacio de trabajo recuerda su elección

**Guardado automático**:
  - Cada cambio se guarda automáticamente. La indicación **Guardando...** / **Guardado** aparece en la cabecera
  - Cambiar de pestaña, pasar a la partida anterior o siguiente, o cerrar el espacio de trabajo guarda primero los cambios pendientes. Si un guardado falla, usted se queda donde está y un mensaje explica el motivo, de modo que ningún cambio se pierde sin que lo sepa
  - **Ctrl+S** (**Cmd+S** en Mac) guarda de inmediato

### Vista general

La pestaña Vista general contiene los campos de texto libre y las tareas de la partida.

**Qué puede editar**:
  - **Descripción**: Qué cubre el gasto
  - **Notas**: Notas internas de texto libre

**Panel de tareas**:
  - Muestra todas las tareas vinculadas a esta partida OPEX, con las columnas **Título**, **Estado**, **Prioridad**, **Fecha de vencimiento** y **Acciones**. El título del panel indica el número de tareas
  - Filtro **Estado**: Todos (por defecto), Activas (no completadas), Abierta, En curso, Pendiente, En pruebas, Completada o Cancelada. El botón de borrar lo restablece
  - Haga clic en **Agregar tarea** para abrir una tarea nueva ya vinculada a esta partida. Complete el título, la descripción, la prioridad, el responsable y la fecha de vencimiento en el espacio de trabajo de la tarea
  - Use el icono de abrir para ir a una tarea y el icono de eliminar para borrarla (tras confirmar)
  - Las tareas tienen sus propios permisos (`tasks:member` para crear y editar). El acceso de manager de OPEX no da por sí solo derechos de edición de tareas; consulte a su administrador si no puede crear tareas
  - Las tareas también se pueden ver y gestionar desde **Portafolio > Tareas**, que muestra todas las tareas de su organización

**Panel Propiedades**:
  - **Proveedor**, **Centro de coste**, **Empresa pagadora**, **Cuenta** (filtrada por el plan de cuentas de la empresa pagadora), **Moneda** (solo las monedas permitidas en su espacio de trabajo), **Categoría analítica**, **Run o build** e **Inicio de vigencia**
  - **Ciclo de vida**: el interruptor **Activado** y la fecha de **Fin de validez**. Consulte [Estado y ciclo de vida](#estado-y-ciclo-de-vida)
  - Fechas **Creado** y **Actualizado** (solo lectura)

**Centro de coste**:
  - La lista muestra el árbol de centros de coste. Los grupos se muestran para ayudarle a orientarse y no se pueden elegir. Busque por código, nombre o nombre de grupo
  - Un centro de coste desactivado aparece marcado como **Desactivado**. Se mantiene en las partidas que ya lo tienen y no se puede elegir para otra partida
  - Cuando crea una partida y la empresa pagadora está vacía, elegir un centro de coste completa la empresa pagadora con la empresa del centro de coste, de modo que la lista **Cuenta** se abre en el plan de cuentas de esa empresa. Hasta que usted elija una empresa o una cuenta, elegir otro centro de coste también actualiza la empresa
  - Cuando la empresa pagadora difiere de la empresa del centro de coste, se conservan ambas. Una indicación bajo el campo dice "Este centro de coste pertenece a" seguido del nombre de la empresa
  - Una partida guardada mediante la API con un centro de coste y sin empresa pagadora toma la empresa del centro de coste. Para los archivos CSV, consulte [Importación/exportación CSV](#importacionexportacion-csv)

**Run o build**: **Run**, **Build** o **Sin definir**. Úselo para repartir el presupuesto entre mantener los servicios en funcionamiento y modificarlos.

**Consejo**: Al crear una partida, una advertencia de "Cuenta obsoleta" significa que la cuenta seleccionada no pertenece al plan de cuentas de la empresa pagadora. Elija otra cuenta para resolver la advertencia. Una partida existente cuya cuenta está fuera del plan de su empresa se puede seguir editando: el plan solo se comprueba cuando cambia la empresa o la cuenta.

---

### Presupuesto

La pestaña Presupuesto es donde introduce datos financieros por año. Admite varias columnas presupuestarias y dos modos de entrada, mostrados como pestañas: **Anual** (totales anuales) y **Mensual** (desglose mensual).

**Selección de año**:
  - Utilice las pestañas de año en la parte superior para alternar entre A-2, A-1, A (año actual), A+1 y A+2
  - Cada año tiene su propia versión, modo e importes
  - Al cambiar de año se guardan primero sus cambios pendientes

**Columnas presupuestarias**:
  - La pestaña muestra las columnas que muestra su organización, con sus nombres, siempre en el mismo orden. Las columnas estándar son:
  - **Presupuesto**: Presupuesto anual inicial aprobado a principios de año
  - **Revisión**: Actualización presupuestaria a mitad de año (p. ej., tras una reprevisión)
  - **Previsión**: Una columna de planificación adicional, oculta por defecto
  - **Realizado**: El gasto real, tal como se registra durante el año
  - **Aterrizaje previsto**: Su mejor estimación de la cifra de fin de año
  - Un administrador de presupuesto puede renombrar las columnas, ocultar algunas y elegir la columna por defecto en **Gestión presupuestaria > Administración > Columnas presupuestarias** (consulte [Columnas presupuestarias](budget-operations.md#columnas-presupuestarias)). Una columna oculta conserva sus importes

**Periodo de una columna**:
  - Cada columna tiene un periodo dentro del año, por ejemplo de abril a diciembre
  - Un mes cuenta cuando el periodo cubre su día 15. Un periodo que empieza el 10 de abril incluye abril; uno que empieza el 20 de abril comienza en mayo
  - Una columna sin importe y sin periodo recibe una sugerencia: el **Inicio de vigencia** y el **Fin de validez** de la partida, limitados al año. Una partida que empieza el 1 de abril sugiere de abril a diciembre
  - Una columna que ya tiene importes y no tiene periodo se lee como todo el año, de modo que los datos existentes se comportan como antes

**Anual o Mensual**:
  - **Anual**: Introduzca un total por columna. El total se reparte uniformemente entre los meses del periodo de la columna, y los meses fuera de él se ponen a cero. El periodo aparece bajo cada total antes de escribir, por ejemplo «9 meses, de abril a diciembre». Solo se guarda el total que usted modifica. Las demás columnas conservan sus importes mensuales.
  - Haga clic en el icono de lápiz junto al periodo bajo un total (**Cambiar el periodo**) para abrir el panel de reparto en esa columna, con su total actual. Si las fechas de la partida no dejan ningún mes en el año, el total se deshabilita y muestra «Ningún mes de 2026 está dentro de las fechas de la partida.» Haga clic en el icono de lápiz junto a ese texto (**Elegir el periodo**) para definirlo usted mismo.
  - **Mensual**: Introduzca importes por mes (Ene-Dic) para cada columna visible. Se muestran subtotales trimestrales y un total anual. Solo se guardan los meses que usted modifica.
  - Ambas pestañas muestran las mismas columnas: Previsión también aparece en **Anual** cuando se muestra.
  - Cambie de modo con las pestañas **Anual** y **Mensual**. Cambiar de modo no modifica sus importes.

**Comportamiento de congelación**:
  - Si las columnas presupuestarias de un año están congeladas (vía Administración presupuestaria), los campos correspondientes pasan a solo lectura y muestran un candado
  - Puede ver los datos congelados; los administradores pueden descongelar vía **Gestión presupuestaria > Administración > Congelar / Descongelar datos**
  - Cada columna puede congelarse independientemente

**Repartir un importe**:
  - El panel de reparto siempre está visible en la pestaña **Mensual**. En la pestaña **Anual** se abre desde el icono de lápiz bajo un total
  - Elija una **Columna** entre las columnas visibles, compruebe el **Importe**, elija una **Distribución** (**Uniforme** o **4-4-5**) y defina las fechas **Desde** y **Hasta**. Las fechas parten del periodo actual de la columna, y la distribución de la que ya tiene la columna
  - El panel se abre en la columna por defecto. El importe parte del total actual de la columna, en ambas pestañas, y se actualiza cuando elige otra columna. Queda vacío cuando la columna no tiene importe
  - **Aplicar a todas las columnas** está activado por defecto: cada columna que lo sigue recibe el mismo periodo y la misma distribución, cada una con su propio total actual. Por defecto, todas las columnas lo siguen. Un administrador de presupuesto elige cuáles en [Columnas presupuestarias](budget-operations.md#columnas-presupuestarias). Las columnas congeladas nunca cambian. Pase el cursor sobre el interruptor para ver qué columnas siguen y cuáles conservan su propio periodo. Desactive el interruptor para repartir solo la columna seleccionada
  - Una columna que no sigue «Aplicar a todas las columnas» se reparte sola: el interruptor no aparece cuando la reparte. El interruptor también se oculta cuando ninguna otra columna que lo sigue puede cambiar
  - **Restablecer** rellena el panel con el total actual de la columna, **Uniforme** y el año completo. No guarda nada: haga clic en **Aplicar** para usarlo. Con **Aplicar a todas las columnas** activado, **Restablecer** y luego **Aplicar** devuelven cada columna que lo sigue a un reparto uniforme en doce meses
  - Los totales introducidos en la pestaña **Anual** siguen aplicándose solo a su propia columna
  - Las fechas **Desde** y **Hasta** muestran el periodo. Cuando algunos meses quedan fuera, el panel indica cuáles se pondrán a cero («De enero a marzo se pondrán a cero.»). Un periodo de todo el año no muestra ninguna línea. Pase el cursor sobre el icono de información junto al título del panel para ver la regla del día 15
  - Con **4-4-5**, los pesos de los meses que cuentan se amplían para que todo el importe recaiga en ellos
  - Aparece un aviso no bloqueante cuando el periodo va más allá de las fechas de la partida. Aun así puede aplicar
  - **Aplicar** permanece deshabilitado mientras falte una fecha o ningún mes cuente. No se guarda nada hasta que haga clic en **Aplicar**
  - Desde la pestaña **Mensual**, Aplicar rellena la cuadrícula. Desde la pestaña **Anual**, permanece en la vista Anual

**Cómo se produjo cada columna**:
  - Una etiqueta breve indica de dónde vienen los importes de una columna. En la pestaña **Mensual** aparece bajo el encabezado de la columna (pase el cursor por encima para ver el periodo). En la pestaña **Anual** aparece junto al periodo
  - **Reparto uniforme**, **Reparto 4-4-5** o **Reparto por trimestre**: los importes proceden de un reparto
  - **Copiado de Presupuesto 2025 +2 %**: los importes proceden de **Copiar columnas presupuestarias** en la Administración presupuestaria, con el porcentaje visible cuando lo hay
  - **Editado a mano**: se modificó un mes en la cuadrícula o mediante una importación del archivo de filas presupuestarias
  - Una columna sin etiqueta conserva los datos que tenía antes de que existieran los periodos

**Herramientas del modo mensual**:
  - **Borrar columna**: el icono junto al encabezado de una columna pone a cero todos los meses de esa columna, por ejemplo antes de introducir todo el importe en un solo mes. Cuenta como una edición a mano. Para quitar a la vez los importes y el periodo de una columna en todas las partidas, use **Restablecer columna presupuestaria** en la Administración presupuestaria

**Tendencia plurianual**:
  - Un gráfico bajo la cuadrícula muestra cada columna visible a lo largo de los años, incluida Previsión cuando se muestra, y se actualiza mientras escribe

**Cómo usarlo**:
  1. Seleccione el año que está planificando
  2. Elija la pestaña **Anual** o **Mensual**
  3. Complete las columnas relevantes (Presupuesto para la planificación inicial, Realizado para el seguimiento, Aterrizaje previsto para la cifra de cierre de año)
  4. Sus cambios se guardan automáticamente; junto a las pestañas de año aparece la indicación **Guardando...** / **Guardado**

**Consejo**: Para la mayoría de partidas, el modo Anual es más rápido. Utilice el modo Mensual cuando el gasto varíe significativamente por mes (p. ej., licencias estacionales, cuotas de configuración únicas).

---

### Asignaciones

La pestaña Asignaciones distribuye el gasto entre sus empresas y departamentos. Esto alimenta los informes de contracargo y los KPI de coste por usuario.

**Selección de año**:
  - Funciona igual que Presupuesto: use las pestañas de año para alternar entre A-2, A-1, A, A+1, A+2
  - Cada año puede tener un método de asignación diferente
  - El total anual de la columna por defecto aparece a la derecha, por ejemplo **Presupuesto, total del año**, y la tabla muestra cada parte como porcentaje y como importe

**Métodos de asignación**:

| Método | Cómo funciona |
|---|---|
| **Plantilla (por defecto)** | Reparte el gasto proporcionalmente según la plantilla de cada empresa para el año seleccionado. No requiere selección manual: los porcentajes se calculan automáticamente a partir de las métricas de las empresas. Es el método estándar. |
| **Usuarios IT** | Reparte el gasto proporcionalmente según el número de usuarios IT de cada empresa para el año seleccionado. |
| **Facturación** | Reparte el gasto proporcionalmente según la facturación de cada empresa para el año seleccionado. |
| **Manual por empresa** | Usted selecciona qué empresas reciben este gasto y elige un inductor en **Asignar por** (Plantilla, Usuarios IT o Facturación) para calcular los porcentajes solo entre las empresas seleccionadas. |
| **Manual por departamento** | Usted selecciona pares empresa/departamento concretos. Los porcentajes se calculan a partir de la plantilla de cada departamento. Útil cuando una partida solo beneficia a ciertos departamentos (p. ej., un CRM usado por Ventas). |
| **Porcentajes manuales** | Usted elige las empresas y escribe cada porcentaje. El total debe sumar 100 %. |

**Métodos por defecto y fijados**:
  - La opción **por defecto**, mostrada como *Plantilla (por defecto)* hasta que su organización configure otro método, sigue la configuración de **Gestión presupuestaria > Administración > Método de asignación por defecto**. Cada partida que se deje en el valor por defecto se recalcula cuando un administrador cambia esa configuración
  - Esa configuración también puede restringir el valor por defecto a una **selección de empresas** (por ejemplo la entidad que lleva el presupuesto IT): el inductor se aplica entonces solo a esas empresas, y la opción muestra *Por defecto (n sociedades)*
  - **Plantilla**, **Usuarios IT** y **Facturación** fijan ese método en la partida: un método fijado sigue funcionando aunque el valor por defecto de la organización cambie más adelante
  - Las partidas con una asignación manual nunca se ven afectadas por la configuración por defecto

**Cómo funcionan los porcentajes**:
  - En los **métodos automáticos** (Plantilla, Usuarios IT, Facturación): los porcentajes se calculan a partir de las métricas más recientes de sus empresas activas. No se editan directamente
  - En **Manual por empresa** y **Manual por departamento**: usted elige las empresas o departamentos y el sistema calcula los porcentajes según el inductor elegido y las métricas actuales
  - En **Porcentajes manuales**: escribir un porcentaje fija esa fila y las demás filas se reparten el resto. **Repartir equitativamente** da la misma parte a cada fila; **Borrar fijaciones manuales** libera las filas fijadas
  - Los porcentajes reflejan datos en tiempo real. Si actualiza la plantilla de una empresa, las asignaciones se recalculan

**Cómo usarlo**:
  1. Seleccione el año
  2. Elija un método de asignación en **Método**
  3. Para un método manual, use **Agregar fila** para añadir empresas (o pares empresa/departamento) y el icono de quitar para eliminar una. Para **Manual por empresa**, elija un inductor en **Asignar por**
  4. Los cambios se guardan automáticamente

**Problemas comunes**:
  - **Métricas faltantes**: Una o más empresas tienen la plantilla, los usuarios IT o la facturación en cero o sin informar para el año seleccionado. Complete las métricas en **Datos maestros > Empresas** (pestaña Detalles)
  - **"Los porcentajes manuales deben sumar 100 %."**: Ajuste las filas o haga clic en **Repartir equitativamente**

**Consejo**: Use Plantilla (por defecto) para la mayoría de partidas: es lo más sencillo y se actualiza automáticamente. Reserve los métodos manuales para gastos que solo benefician a empresas o departamentos concretos.

---

### Relaciones

La pestaña Relaciones vincula esta partida OPEX con objetos relacionados: Proyectos, Aplicaciones, Contratos, Contactos, Sitios web relevantes y Adjuntos. Todo lo de esta pestaña se guarda automáticamente.

**Proyectos**:
  - Use el autocompletado para vincular uno o más proyectos de su Portafolio
  - Esto ayuda a agrupar el gasto por proyecto en los informes y permite la contabilidad de proyectos
  - Los nombres de los proyectos aparecen en la columna **Proyecto** de la lista OPEX, y la búsqueda rápida los encuentra
  - Quite un proyecto haciendo clic en la X de su chip

**Aplicaciones**:
  - Use el autocompletado para vincular una o más aplicaciones o servicios de su catálogo IT
  - Esto ayuda a saber qué partidas OPEX financian qué aplicaciones o servicios

**Contratos**:
  - Use el autocompletado para vincular uno o más contratos
  - Una vez vinculado, el nombre del contrato aparece en la columna **Contrato** de la lista OPEX como referencia rápida
  - Un contrato puede vincularse a varias partidas OPEX (relación de muchos a muchos)
  - Quite un contrato haciendo clic en la X de su chip

**Contactos**:
  - Vincule contactos a esta partida: elija un contacto y luego su rol (**Comercial**, **Técnico**, **Soporte** u **Otro**). Al elegir el rol se añade el contacto
  - La tabla muestra el rol, el nombre, el apellido, el cargo, el correo y el móvil. Pase el ratón sobre el rol para ver si el contacto viene del proveedor o se añadió manualmente
  - Quite un contacto con el icono de quitar
  - Útil para saber a quién dirigirse para renovaciones, incidencias de soporte o negociaciones

**Sitios web relevantes**:
  - Haga clic en **Agregar URL** para añadir un enlace (p. ej., portales de proveedores, documentación, consolas de administración, wikis internos). Cada enlace tiene un **Nombre** y una **URL**
  - Haga clic en la fila de un enlace para editarlo, o use el icono de eliminar para quitarlo

**Adjuntos**:
  - Suba archivos relacionados con esta partida (p. ej., contratos, facturas, presupuestos, pliegos, especificaciones técnicas)
  - Arrastre y suelte archivos en la zona de adjuntos, o haga clic en **Seleccionar archivos** para buscarlos
  - Haga clic en el chip de un archivo para descargarlo
  - Elimine un adjunto con el icono de eliminar de su chip (tras confirmar; requiere `opex:manager`)

**Consejo**: Vincule contratos para seguir las renovaciones en varias partidas OPEX. Añada las URL de los portales de proveedores para un acceso rápido. Suba presupuestos y facturas como adjuntos para centralizar toda la documentación del gasto.

---

## Importación/exportación CSV

Puede cargar masivamente partidas OPEX vía CSV para acelerar la configuración inicial o sincronizar con sistemas externos.

**Exportar**:
  1. Haga clic en **Exportar CSV** en la lista OPEX
  2. Elija:
     - **Plantilla**: Solo encabezados (úselo para crear un CSV en blanco para rellenar)
     - **Datos**: Todas las partidas OPEX con presupuestos para A-1, A y A+1

**Estructura del CSV**:
  - Delimitador: punto y coma `;` (no coma)
  - Codificación: UTF-8 (guarde como "CSV UTF-8" en Excel)
  - Encabezados: `product_name;description;supplier_name;company_name;account_number;currency;effective_start;status;disabled_at;owner_it_email;owner_business_email;analytics_category;cost_center_code;run_build;notes;y_minus1_budget;y_minus1_landing;y_budget;y_follow_up;y_landing;y_revision;y_plus1_budget;y_plus1_revision`
  - `disabled_at` es el fin de validez: la fecha en que la partida termina. Utilice una fecha (`2026-12-31`) o una fecha y hora completas. Déjelo vacío si no hay fin
  - Los archivos antiguos con una columna `effective_end` se siguen importando: su fecha rellena el fin de validez cuando `disabled_at` está vacío
  - `cost_center_code` y `run_build` son columnas opcionales: las exportaciones y la plantilla siempre las incluyen, y los archivos sin ellas se siguen importando

**Importar**:
  1. Haga clic en **Importar CSV** en la lista OPEX
  2. Suba su archivo CSV (arrastrar y soltar o selector de archivos)
  3. Haga clic en **Verificación previa** para validar:
     - Los encabezados coinciden exactamente
     - Los campos obligatorios (product_name, account_number) están presentes. Una partida nueva también necesita una moneda, y un company_name salvo que tenga un centro de coste
     - Cada empresa, proveedor, cuenta, centro de coste y responsable del archivo existe en su espacio de trabajo
     - Las fechas son válidas y no hay dos filas que describan la misma partida
     - Las monedas están permitidas en la configuración de monedas de su espacio de trabajo
     - Los responsables son usuarios activos
  4. Revise el informe de verificación previa (muestra conteos y hasta 5 errores de ejemplo). Un archivo con cualquier error no carga nada: corrija las filas y vuelva a ejecutar la verificación previa
  5. Si es correcto, haga clic en **Cargar** para importar

**Notas importantes**:
  - **Correspondencia**: Una fila se asocia a una partida OPEX por nombre del producto y proveedor. Una fila que coincide con una partida existente la actualiza; cualquier otra fila crea una partida nueva. Una fila con `supplier_name` vacío solo coincide con una partida sin proveedor. Dos filas con el mismo nombre del producto y el mismo proveedor son un error ("Same line as row N"): conserve una sola fila por partida
  - **Moneda**: Obligatoria para una partida nueva, y debe estar permitida en la configuración de monedas de su espacio de trabajo. En una partida existente, una celda vacía conserva su moneda
  - **Proveedor**: `supplier_name` es opcional. Si está relleno, se usa el proveedor con exactamente ese nombre. Si no existe, el nombre se compara sin distinguir mayúsculas. Un nombre que no coincide con ningún proveedor es un error, y también lo es un nombre que coincide con varios proveedores que solo difieren en mayúsculas (por ejemplo "Acme" y "ACME" cuando el archivo dice "acme")
  - **Empresa y cuenta**: `company_name` debe coincidir con una empresa por nombre (sin distinguir mayúsculas). Un `company_name` vacío conserva la empresa de una partida existente; una partida nueva toma la empresa de su centro de coste. Sin ninguna de las dos, la fila se rechaza: "Company is required unless the line has a cost center." `account_number` se busca en el plan de cuentas de esa empresa, o en el plan de cuentas por defecto cuando la empresa no tiene ninguno. Un número de cuenta que solo existe en otro plan es un error
  - **Responsables**: `owner_it_email` y `owner_business_email` deben coincidir con usuarios activos por correo electrónico: un usuario invitado o un contacto sin cuenta se rechaza
  - **Fechas**: `effective_start` (y `effective_end` en archivos antiguos) debe ser un día real del calendario en formato `YYYY-MM-DD`, por ejemplo `2026-01-01`. Otros formatos, como `01/03/2026`, son errores. Un `effective_start` vacío conserva la fecha guardada de una partida existente; una partida nueva empieza el 1 de enero del año en curso
  - **Categoría analítica**: Si la categoría no existe, se crea automáticamente durante la importación
  - **Centro de coste**: `cost_center_code` es el código de un centro de coste, sin distinguir mayúsculas. Un grupo se rechaza. Un centro de coste desactivado se acepta en una partida que ya lo tiene y se rechaza como valor nuevo. Una celda vacía borra el centro de coste de la partida. Cuando falta toda la columna, las partidas conservan su centro de coste
  - **Run o build**: `run_build` es `run`, `build` o vacío (sin distinguir mayúsculas). Una celda vacía borra el valor. Cuando falta toda la columna, las partidas conservan su valor
  - **Empresa del centro de coste**: Una partida nueva con `company_name` vacío toma la empresa de su centro de coste, y `account_number` se busca en el plan de cuentas de esa empresa. Un `company_name` informado se conserva, aunque difiera de la empresa del centro de coste
  - **Presupuestos**: Las columnas presupuestarias rellenan las versiones A-1, A y A+1. Los importes se distribuyen uniformemente en 12 meses (modo Anual) y el periodo de la columna pasa a ser todo el año. Una celda vacía deja la columna como está; `0` la borra. Los encabezados conservan sus nombres técnicos sea cual sea el nombre que su organización da a las columnas, y también cargan las columnas ocultas
  - **Importes mensuales**: para cargar o revisar los importes mes a mes, con el periodo de cada columna, use el **Archivo de filas presupuestarias** en la Administración presupuestaria

**Errores comunes**:
  - **"Supplier '...' not found"**: Compruebe la ortografía, o cree el proveedor en **Datos maestros > Proveedores** primero, luego reimporte
  - **"Supplier '...' matches more than one supplier"**: Varios proveedores solo difieren de este nombre en mayúsculas. Escriba el nombre exactamente como uno de ellos, o cambie el nombre de uno en **Datos maestros > Proveedores**, luego reimporte
  - **"Same line as row N"**: Dos filas describen la misma partida. Combínelas en una sola fila, luego reimporte
  - **"Account ... not found in ...'s chart of accounts"**: Use una cuenta del plan de la empresa pagadora, o añada la cuenta en **Datos maestros > Planes de cuentas**, luego reimporte
  - **"effective_start must be a valid date"**: Use el formato `YYYY-MM-DD`
  - **"Company is required unless the line has a cost center."**: Complete `company_name` o `cost_center_code` para la partida nueva
  - **"Cost center ... was not found."**: Compruebe el código o cree el centro de coste en **Datos maestros > Centros de coste** y vuelva a importar
  - **"... is a group. Choose a cost center."**: Use el código de un centro de coste de ese grupo
  - **"Cost center ... is disabled."**: Use un centro de coste activado, o vuelva a activarlo en **Datos maestros > Centros de coste**
  - **"Run or build must be run, build or blank."**: Corrija la celda `run_build`
  - **"Moneda inválida"**: Utilice códigos ISO de 3 letras (USD, EUR, GBP) que estén permitidos en la configuración de monedas de su espacio de trabajo
  - **"Desajuste de encabezados"**: Descargue una plantilla nueva; los encabezados deben coincidir exactamente (incluido el orden)

**Consejo**: Comience con la exportación de plantilla, rellene algunas filas y ejecute una verificación previa para detectar problemas temprano. Corrija errores en el CSV y vuelva a subirlo hasta que la verificación previa pase, luego cargue.

---

## Estado y ciclo de vida

Cada partida OPEX tiene un **estado** (Habilitado o Deshabilitado) y un **Fin de validez** opcional que controla cuándo aparece en informes y listas de selección. Es la única fecha de fin de una partida.

**Cómo funciona**:
  - **Habilitado**: La partida está activa y aparece en todas partes (listas, informes, asignaciones)
  - **Fin de validez**: La fecha en que la partida termina. Déjelo en blanco si no hay fin
  - Después del fin de validez:
    - La partida ya no aparece en listas de selección para nuevos contratos o asignaciones
    - Se excluye de informes para años estrictamente posteriores al fin de validez
    - Los datos históricos permanecen intactos; la partida sigue apareciendo en informes que cubren años cuando estaba activa

**Establecer estado**:
  - Al crear la partida, puede establecer su **Fin de validez** en el panel **Propiedades**
  - Más adelante, cambie el **Estado** en la barra de metadatos, o use el campo **Ciclo de vida** del panel **Propiedades** (interruptor **Activado** y **Fin de validez**). Desactivar una partida sin fecha fija su fin de validez en el día de hoy
  - Puede programar un fin de validez futuro (útil para partidas con fin de contrato planificado)

**Ver partidas deshabilitadas**:
  - Por defecto, la lista OPEX muestra solo partidas **Habilitadas**
  - Utilice el conmutador **Mostrar: Deshabilitados** o **Mostrar: Todos** para ver partidas deshabilitadas

**Cuándo desactivar vs eliminar**:
  - **Prefiera desactivar**: Mantiene el historial intacto, asegura que los informes permanezcan consistentes y soporta registros de auditoría
  - **Elimine solo si**: La partida se creó por error
  - Eliminar una partida también elimina sus presupuestos, asignaciones, tareas, sitios web relevantes, adjuntos (con sus archivos) y sus vínculos con contratos. Si una de sus tareas se convirtió en una solicitud, la solicitud se conserva: tiene su propia copia del título, la descripción y los adjuntos, y solo se pierde su vínculo con la tarea

**Consejo**: Utilice el Fin de validez para retirar partidas OPEX cuando los contratos terminen o los servicios se discontinúen. No elimine a menos que sea un verdadero error.

---

## Consejos y mejores prácticas

1. **Empiece simple**: Cree partidas con solo lo esencial (nombre del producto, empresa pagadora, cuenta), luego añada presupuestos y asignaciones a medida que planifica.

2. **Use el método de asignación predeterminado**: Para la mayoría de partidas, Plantilla (por defecto) es suficiente. Reserve métodos manuales para gasto que beneficia solo a empresas o departamentos específicos.

3. **Vincule contratos**: Si gestiona gasto mediante contratos, vincúlelos en la pestaña Relaciones. Facilita el seguimiento de renovaciones.

4. **Vincule aplicaciones**: Asocie partidas OPEX con las aplicaciones o servicios que financian. Esto proporciona un mapeo claro de coste a aplicación.

5. **Suba documentación**: Utilice la funcionalidad de adjuntos para almacenar contratos, presupuestos, facturas y SOW de proveedores.

6. **Añada enlaces a portales de proveedores**: Utilice Sitios web relevantes para vincular a consolas de administración, portales de soporte y documentación de proveedores para acceso rápido.

7. **Registre contactos**: Añada contactos de proveedor con roles (Comercial, Técnico, Soporte) para que su equipo sepa a quién llamar para cada partida de gasto.

8. **Aproveche las categorías analíticas**: Etiquete partidas con categorías (Infraestructura, Apps de negocio, Seguridad) para agrupar gasto en informes.

9. **Mantenga actualizadas las métricas de empresa**: Las asignaciones dependen de la plantilla, usuarios IT y facturación de la empresa. Las métricas desactualizadas causan errores de asignación.

10. **Use CSV para configuración masiva**: Si está migrando desde otro sistema o tiene cientos de partidas, comience con importación CSV. Exporte una plantilla, rellénela y haga una verificación previa antes de cargar.

11. **Desactive, no elimine**: Preserve el historial desactivando partidas cuando ya no estén activas. Elimine solo si es un error.

12. **Revise la fila de totales**: Antes de finalizar presupuestos, verifique la fila de totales fijada en la lista para asegurar que su gasto suma como se espera.

13. **Use enlace directo**: Haga clic directamente en una columna de presupuesto en la lista para ir a la pestaña Presupuesto de ese año. Haga clic en la columna Tarea para ir a las tareas de la partida en la pestaña Vista general. Esto ahorra tiempo de navegación.

14. **Congele presupuestos después del cierre de año**: Utilice Administración presupuestaria para congelar los presupuestos del año anterior una vez que el realizado esté finalizado, previniendo ediciones accidentales.

---

## Permisos

El acceso a OPEX se controla por tres niveles:

- `opex:reader`: Ver la lista OPEX, abrir partidas, ver presupuestos y asignaciones (solo lectura), descargar adjuntos
- `opex:manager`: Crear y editar partidas OPEX, actualizar presupuestos y asignaciones, subir y eliminar adjuntos, gestionar relaciones y enlaces
- `opex:admin`: Todos los derechos de gestor más importación/exportación CSV, operaciones presupuestarias (congelar, copiar, restablecer) y eliminación masiva

Adicionalmente:
- Las tareas tienen permisos separados (`tasks:member` para crear/editar tareas en partidas OPEX)
- Los usuarios con `tasks:reader` pueden ver tareas pero no crear ni editar

Si no puede realizar una acción (p. ej., falta el botón **Importar CSV**, no puede subir adjuntos), consulte con su administrador del espacio de trabajo para revisar sus permisos de rol.

---

## ¿Necesita ayuda?

- **Problemas con CSV**: Descargue una plantilla nueva, asegure codificación UTF-8 y ejecute la verificación previa para ver errores detallados
- **Errores de asignación**: Verifique que todas las empresas tengan las métricas requeridas (plantilla, usuarios IT, facturación) para el año seleccionado
- **Advertencia de cuenta obsoleta**: La cuenta no pertenece al plan de cuentas de la empresa pagadora; seleccione una cuenta diferente
- **Faltan botones o pestañas**: Su rol puede no tener el nivel de permiso requerido (gestor o administrador). Contacte a su administrador del espacio de trabajo
