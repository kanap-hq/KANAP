# Vista general de la gestión presupuestaria

La vista general de la gestión presupuestaria le ofrece una vista de alto nivel de dónde se encuentra su gasto IT en este momento: resúmenes de OPEX y CAPEX, próximos plazos, indicadores de calidad de datos y los elementos que más merecen su atención, todo en un solo lugar.

## Dónde encontrarlo

- Ruta: **Gestión presupuestaria > Vista general** (`/ops`)
- La página que ve después de iniciar sesión es su [panel de control](my-dashboard.md) personal. Abra esta vista general desde el espacio **Gestión presupuestaria**.

## Diseño

El panel de control está construido a partir de mosaicos dispuestos en una cuadrícula adaptable: tres columnas en pantalla ancha, dos en tableta y una sola columna en móvil. Cada mosaico tiene un icono, un título y generalmente un botón **Ver** que le lleva directamente a la página completa detrás de los datos.

## Mosaicos

### Resumen OPEX

Una tabla compacta que cubre tres ejercicios fiscales: año anterior (A-1), año actual (A) y año siguiente (A+1). Aparecen hasta cinco columnas de valores: las columnas presupuestarias que muestra su organización, con sus nombres (**Presupuesto**, **Revisión**, **Realizado** y **Aterrizaje previsto** con la configuración estándar, más **Previsión** cuando se muestra). Una columna se muestra cuando contiene un importe para al menos uno de los tres años. Las columnas ocultas nunca aparecen. Los mosaicos OPEX y CAPEX muestran las mismas columnas. Todos los importes se redondean al millar más cercano y se muestran con el sufijo "k" (por ejemplo, `7 846k`).

Haga clic en **Ver** para abrir la lista OPEX.

### Resumen CAPEX

Mismo diseño y formato que el Resumen OPEX, pero extraído de sus datos de inversión de capital.

Haga clic en **Ver** para abrir la lista CAPEX.

### Mis tareas

Muestra el número total de tareas abiertas asignadas a usted (se excluyen las tareas marcadas como "completadas"), seguido de las cinco tareas cuyas fechas de vencimiento están más próximas. Las tareas vencidas se resaltan en rojo. Las tareas que no tienen fecha de vencimiento establecida no aparecen aquí.

Haga clic en **Ver todo** para abrir la página de Tareas.

### Próximas renovaciones

Lista los próximos cinco plazos de cancelación de contratos que aún están en el futuro. Los plazos pasados se filtran automáticamente para que solo vea lo que está por venir.

Haga clic en **Ver todo** para abrir la página de Contratos.

### Calidad de datos

Cuatro controles que le ayudan a detectar registros incompletos de un vistazo. El mosaico muestra una columna de recuentos por cada tipo de partida que usted puede consultar: **OPEX** y **CAPEX** uno junto al otro.

- **Sin responsable IT**: partidas sin responsable IT
- **Sin responsable de negocio**: partidas sin responsable de negocio
- **Sin empresa pagadora**: partidas sin empresa pagadora
- **Cuenta fuera del plan de la empresa**: partidas cuya cuenta no pertenece al plan de cuentas de la empresa pagadora

Un recuento se vuelve naranja (rojo para el control del plan de cuentas) cuando es superior a cero. Haga clic en un recuento para abrir la lista de ese tipo.

### Acciones rápidas

Botones de acceso directo para crear una nueva partida OPEX o CAPEX directamente desde el panel de control. Estos botones solo son visibles si su rol le otorga al menos permisos de `opex:manager` o `capex:manager`.

Debajo de los botones, una sección de **Actualizaciones recientes** lista las cinco partidas modificadas más recientemente, OPEX y CAPEX juntas. Cada fila muestra la fecha de la última modificación, el nombre de la partida y su tipo. Haga clic en una fila para abrir la partida.

### Top partidas (A)

Las cinco partidas más grandes para el año actual, clasificadas por la columna por defecto. El título indica la columna, por ejemplo **Top partidas (Presupuesto, A)**. Los importes se redondean a miles con sufijo "k".

Use las pestañas **OPEX** / **CAPEX** del encabezado del mosaico para elegir el tipo de partida. El mosaico recuerda su elección. Haga clic en **Abrir** para ver el informe completo Top partidas sobre el mismo tipo.

### Mayores incrementos (A vs A-1)

Las cinco partidas con el mayor incremento en la columna por defecto comparado con el año anterior, calculado sobre todas las partidas del tipo. El título indica la columna, por ejemplo **Mayores incrementos (Presupuesto, A vs A-1)**. Las partidas cuyo importe se mantuvo o bajó no aparecen. Los importes se redondean a miles con sufijo "k".

Use las pestañas **OPEX** / **CAPEX** del encabezado del mosaico para elegir el tipo de partida. El mosaico recuerda su elección. Haga clic en **Abrir** para ver el informe completo Top aumento / disminución sobre el mismo tipo.

Un tipo que usted no puede consultar aparece desactivado en las pestañas y no tiene columna en **Calidad de datos**. Si no puede consultar ni OPEX ni CAPEX, estos mosaicos se ocultan.

## Consejos

- **Qué columna usan los mosaicos**: Un administrador de presupuesto elige la columna por defecto y los nombres de las columnas en [Columnas presupuestarias](budget-operations.md#columnas-presupuestarias). Los mosaicos de top y los informes que abren siguen esa elección.
- **Números redondeados**: Cada importe en el panel de control se redondea a miles para una vista compacta. Abra la lista OPEX o CAPEX, o los informes, cuando necesite cifras exactas.
- **Botones ausentes**: Si no ve los botones **Nuevo OPEX** o **Nuevo CAPEX**, su rol actual no incluye el permiso de gestor requerido. Solicite a su administrador que verifique su acceso.
- **Mosaicos vacíos**: Un mosaico que muestra "Sin datos" simplemente significa que no hay registros de ese tipo todavía. Una vez que usted o su equipo empiecen a introducir datos, el mosaico se llenará automáticamente.
