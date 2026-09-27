# Vista general de la gestión presupuestaria

El Panel de control de la gestión presupuestaria es la primera página que ve después de iniciar sesión. Le ofrece una vista de alto nivel de dónde se encuentra su gasto IT en este momento -- resúmenes de OPEX y CAPEX, próximos plazos, indicadores de calidad de datos y los elementos que más merecen su atención -- todo en un solo lugar.

## Dónde encontrarlo

- Ruta: **Gestión presupuestaria > Vista general** (`/ops`)
- Esta es también la página de destino predeterminada después del inicio de sesión.

## Diseño

El panel de control está construido a partir de mosaicos dispuestos en una cuadrícula adaptable: tres columnas en pantalla ancha, dos en tableta y una sola columna en móvil. Cada mosaico tiene un icono, un título y generalmente un botón **Ver** que le lleva directamente a la página completa detrás de los datos.

## Mosaicos

### Resumen OPEX

Una tabla compacta que cubre tres ejercicios fiscales: año anterior (A-1), año actual (A) y año siguiente (A+1). Aparecen hasta cinco columnas de valores: **Presupuesto**, **Revisión**, **Previsión**, **Realizado** y **Aterrizaje previsto**. Una columna se muestra cuando contiene un importe para al menos uno de los tres años. Los mosaicos OPEX y CAPEX muestran las mismas columnas. Todos los importes se redondean al millar más cercano y se muestran con el sufijo "k" (por ejemplo, `7 846k`).

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

### Calidad de datos (OPEX)

Cuatro indicadores que le ayudan a detectar registros OPEX incompletos de un vistazo:

- **Sin responsable IT** -- elementos sin asignación de responsable IT
- **Sin responsable de negocio** -- elementos sin asignación de responsable de negocio
- **Sin empresa pagadora** -- elementos sin empresa pagadora establecida
- **Desajustes de CoA** -- elementos donde la cuenta seleccionada no pertenece al plan de cuentas de la empresa pagadora

Los indicadores se vuelven naranja (o rojo para desajustes de CoA) cuando el recuento es superior a cero. Haga clic en cualquier indicador para ir a la lista OPEX.

### Acciones rápidas

Botones de acceso directo para crear una nueva partida OPEX o CAPEX directamente desde el panel de control. Estos botones solo son visibles si su rol le otorga al menos permisos de `opex:manager` o `capex:manager`.

Debajo de los botones, una sección de **Actualizaciones recientes de OPEX** lista las cinco partidas OPEX modificadas más recientemente con su fecha de última modificación.

### Top OPEX (A)

Las cinco partidas OPEX más grandes para el año actual, clasificadas por importe presupuestario. Los importes se redondean a miles con sufijo "k".

Haga clic en **Abrir** para ver el informe completo de Top OPEX.

### Mayores incrementos (A vs A-1)

Las cinco partidas OPEX con el mayor incremento presupuestario comparado con el año anterior. Los importes se redondean a miles con sufijo "k".

Haga clic en **Abrir** para ver el informe completo de Delta OPEX.

## Consejos

- **Números redondeados**: Cada importe en el panel de control se redondea a miles para una vista compacta. Abra la lista OPEX o CAPEX -- o la sección de Informes -- cuando necesite cifras exactas.
- **Botones ausentes**: Si no ve los botones **Nuevo OPEX** o **Nuevo CAPEX**, su rol actual no incluye el permiso de gestor requerido. Solicite a su administrador que verifique su acceso.
- **Mosaicos vacíos**: Un mosaico que muestra "Sin datos" simplemente significa que no hay registros de ese tipo todavía. Una vez que usted o su equipo empiecen a introducir datos, el mosaico se llenará automáticamente.
