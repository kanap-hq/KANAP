# Vista general de la gestión presupuestaria

La vista general de la gestión presupuestaria le ofrece una vista de alto nivel de dónde se encuentra su gasto IT en este momento: el presupuesto por tipo y por año, sus propias líneas presupuestarias, los próximos plazos, indicadores de calidad de datos y las líneas que más merecen su atención, todo en un solo lugar.

## Dónde encontrarlo

- Ruta: **Gestión presupuestaria > Vista general** (`/ops`)
- La página que ve después de iniciar sesión es su [panel de control](my-dashboard.md) personal. Abra esta vista general desde el espacio **Gestión presupuestaria**.

## Acciones de la cabecera

La cabecera contiene botones de acceso directo:

- **Nueva línea OPEX** y **Nueva línea CAPEX** abren una nueva línea presupuestaria de ese tipo. Se muestran cuando su rol tiene al menos el nivel Miembro en Presupuesto (`budget:member`)
- **Nuevo contrato** abre un nuevo contrato. Se muestra cuando su rol puede crear contratos
- **Personalizar**, a la derecha, abre la configuración de esta vista general. Consulte [Personalizar la vista general](#personalizar-la-vista-general)

## Diseño

La vista general está construida a partir de mosaicos dispuestos en una cuadrícula adaptable: tres columnas en pantalla ancha, dos en tableta y una sola columna en móvil. El mosaico **Presupuesto** es más ancho: dos columnas en pantalla ancha y todo el ancho en tableta. Cada mosaico tiene un icono, un título y generalmente un botón que le lleva a la página completa detrás de los datos.

Varios mosaicos tienen las pestañas **Todo**, **OPEX** y **CAPEX** en su encabezado para elegir el tipo de líneas que cubren. Cada mosaico recuerda su elección en su navegador.

## Mosaicos

Los mosaicos siguientes aparecen en su orden por defecto.

### Presupuesto

Una tabla que cubre tres ejercicios fiscales: el año anterior (A-1), el año actual (A) y el año siguiente (A+1). Cada año tiene tres filas: **OPEX**, **CAPEX** y **Total**. Las columnas de valores son las columnas presupuestarias que muestra su organización, con sus nombres (**Presupuesto**, **Revisión**, **Realizado** y **Aterrizaje previsto** con la configuración estándar, más **Previsión** cuando se muestra). Puede conservar menos en [Personalizar](#personalizar-la-vista-general). Una columna se muestra cuando contiene un importe para al menos una fila. Las columnas ocultas nunca aparecen. Todos los importes se redondean al millar más cercano y se muestran con el sufijo "k" (por ejemplo, `7 846k`).

Haga clic en un importe para abrir la [lista de líneas presupuestarias](budget-lines.md) en ese tipo. Un importe **Total** abre la lista con ambos tipos. Haga clic en **Ver** para abrir la lista.

### Calidad de datos

Controles que le ayudan a detectar líneas incompletas de un vistazo. El mosaico muestra una columna de recuentos por tipo: **OPEX** y **CAPEX** una junto a la otra. Los recuentos cubren las líneas que la lista muestra por defecto (**Mostrar: Activos**).

- **Sin responsable IT**: líneas sin responsable IT
- **Sin responsable de negocio**: líneas sin responsable de negocio
- **Sin empresa pagadora**: líneas sin empresa pagadora
- **Sin centro de coste**: líneas sin centro de coste
- **Sin Presupuesto para el próximo año**: líneas cuya columna por defecto es cero o está vacía para el próximo año. El control nombra su columna por defecto
- **Cuenta fuera del plan de la empresa**: líneas cuya cuenta no pertenece al plan de cuentas de la empresa pagadora

Un recuento se vuelve naranja (rojo para el control del plan de cuentas) cuando es superior a cero. Haga clic en un recuento para abrir la lista exactamente en las líneas que cuenta.

### Mi presupuesto

Las líneas a su nombre, en la columna por defecto del año actual (el subtítulo la nombra, por ejemplo **Presupuesto, A**). Use las pestañas **Todo** / **OPEX** / **CAPEX** para elegir el tipo.

- **Como responsable IT**, **Como responsable de negocio** y **Como responsable del presupuesto**: cuántas líneas tiene en cada rol, y su total. Haga clic en una fila para abrir la lista en esas líneas
- **Mis líneas**: sus tres líneas más grandes, sea cual sea el rol, con su referencia. Haga clic en una para abrirla

El mosaico indica «No hay líneas de presupuesto a su nombre» cuando no tiene ninguna línea.

### Mis tareas

Muestra el número total de tareas abiertas asignadas a usted (se excluyen las tareas marcadas como "completadas"), seguido de las cinco tareas cuyas fechas de vencimiento están más próximas. Las tareas vencidas se resaltan en rojo. Las tareas que no tienen fecha de vencimiento establecida no aparecen aquí.

Haga clic en **Ver todo** para abrir la página de Tareas.

### Próximas renovaciones

Lista los cinco contratos con el vencimiento más próximo, hoy incluido, en el orden de la columna **Próximo vencimiento** de la lista de contratos: un contrato con renovación tácita aparece con su próxima fecha límite de rescisión, cualquier otro contrato con su fin. Los contratos vencidos no aparecen.

Haga clic en **Ver todo** para abrir la página de Contratos.

### Top líneas

Las cinco líneas más grandes para el año actual, clasificadas por la columna por defecto. El subtítulo nombra la columna, por ejemplo **Presupuesto, A**. Los importes se redondean a miles con sufijo "k".

Use las pestañas **Todo** / **OPEX** / **CAPEX** para elegir el tipo. Haga clic en **Abrir** para ver el informe completo Top líneas sobre el mismo tipo.

### Mayores incrementos

Las cinco líneas con el mayor incremento en la columna por defecto comparado con el año anterior. El subtítulo nombra la columna, por ejemplo **Presupuesto, A vs A-1**. Las líneas cuyo importe se mantuvo o bajó no aparecen.

Use las pestañas **Todo** / **OPEX** / **CAPEX** para elegir el tipo. Haga clic en **Abrir** para ver el informe completo Top aumento / disminución sobre el mismo tipo.

### Por centro de coste

Los cinco centros de coste con el mayor total en la columna por defecto del año actual, con una barra para cada uno. Las líneas sin centro de coste cuentan juntas como **Sin centro de coste**. Use las pestañas **Todo** / **OPEX** / **CAPEX** para elegir el tipo. Haga clic en una fila para abrir la lista en las líneas de ese centro de coste.

### Actualizaciones recientes

Las cinco líneas presupuestarias modificadas más recientemente, OPEX y CAPEX juntas. Cada fila muestra la fecha de la última modificación, la referencia de la línea, su nombre y su tipo. Haga clic en una fila para abrir la línea.

Sin acceso de lectura a las líneas presupuestarias (`budget:reader`), los mosaicos de presupuesto se ocultan. **Mis tareas** requiere acceso de lectura a las tareas, y **Próximas renovaciones** acceso de lectura a los contratos.

### Importes sin tipo de cambio

Cuando la moneda de una línea no tiene tipo de cambio para un año, su importe queda excluido de los totales de ese año. Los mosaicos **Presupuesto** y **Mayores incrementos** muestran entonces un aviso de una línea, por ejemplo «Se excluyen 3 líneas sin tipo de cambio: USD 2026.» Los usuarios de la administración presupuestaria con nivel de administrador ven además **Introducir un tipo**, que abre los ajustes de monedas. En **Top líneas**, una línea así muestra su importe en su propia moneda con una pequeña marca naranja. Vea [Tasas manuales](currencies.md#tasas-manuales).

## Personalizar la vista general

Haga clic en **Personalizar** para abrir **Configuración del panel de control del presupuesto**. Sus elecciones solo se aplican a su propia vista general.

- **Mostrar u ocultar un mosaico**: márquelo o desmárquelo. El diálogo lista los mosaicos que su rol puede ver
- **Cambiar el orden**: arrastre un mosaico por su asa a la derecha
- **Columnas de importes del mosaico Presupuesto**: **Columnas del espacio de trabajo**, marcada por defecto, sigue las columnas que muestra su espacio de trabajo. Desmárquela para elegir usted mismo las columnas. Conserve al menos una: si no, el diálogo indica «Seleccione al menos una columna de importes.»
- **Guardar** aplica sus elecciones. **Restablecer valores predeterminados** vuelve a mostrar todos los mosaicos, en el orden por defecto, con las columnas de la organización

## Consejos

- **Qué columna usan los mosaicos**: Un administrador de presupuesto elige la columna por defecto y los nombres de las columnas en [Columnas presupuestarias](budget-operations.md#columnas-presupuestarias). Los mosaicos y los informes que abren siguen esa elección.
- **Números redondeados**: Cada importe de la vista general se redondea a miles para una vista compacta. Abra la lista de líneas presupuestarias, o los informes, cuando necesite cifras exactas.
- **Botones ausentes**: Si no ve los botones **Nueva línea OPEX** o **Nueva línea CAPEX**, su rol actual no tiene el nivel Miembro en Presupuesto. Solicite a su administrador que verifique su acceso.
- **Mosaicos vacíos**: Un mosaico que muestra "Sin datos" simplemente significa que no hay registros de ese tipo todavía. Una vez que usted o su equipo empiecen a introducir datos, el mosaico se llenará automáticamente.
