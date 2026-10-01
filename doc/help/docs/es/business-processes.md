# Procesos de negocio

Los Procesos de negocio le permiten construir y mantener un catálogo centralizado de los procesos centrales de extremo a extremo de su organización -- como Pedido a cobro, Compra a pago o Contratación a jubilación. Al mantener nombres de procesos, categorías y responsables en un solo lugar, crea un punto de referencia único al que el resto de KANAP puede vincularse para propiedad, informes y auditorías.

## Primeros pasos

Navegue a **Datos maestros > Procesos de negocio** para abrir la lista.

**Campos obligatorios**:

- **Nombre**: el nombre del proceso, idealmente incluyendo un código corto (p. ej., "Pedido a cobro (O2C)").

**Permisos**:

- Ver: `business_processes:reader`
- Crear / editar: `business_processes:manager`
- Eliminar, importar/exportar CSV: `business_processes:admin`

Si la página no aparece o los campos son de solo lectura, solicite a su administrador del espacio de trabajo que ajuste sus permisos de rol.

---

## Trabajar con la lista

La lista muestra todos los procesos de negocio de su espacio de trabajo.

**Columnas predeterminadas**:

- **Nombre** -- el nombre del proceso. Haga clic para abrir el espacio de trabajo.
- **Categorías** -- una o más categorías a las que pertenece el proceso (p. ej., "Cliente y ventas", "Finanzas y control"). Múltiples categorías se muestran como lista separada por comas.
- **Responsable del proceso** -- el usuario responsable del proceso.

**Columnas adicionales** (ocultas por defecto; actívelas con el selector de columnas):

- **Estado** -- `habilitado` o `deshabilitado`.
- **Actualizado** -- cuándo se modificó el proceso por última vez.

**Filtrado y ordenación**:

- La búsqueda rápida filtra en todas las columnas visibles.
- Use el selector **Mostrar: Todos / Activos / Desactivados** sobre la lista para elegir qué procesos aparecen. La lista muestra por defecto los procesos activados.
- La ordenación predeterminada agrupa las filas por **Categorías**, luego por **Nombre**.

**Acciones** (barra de herramientas superior derecha):

- **Nuevo** (Manager+) -- crear un nuevo proceso de negocio.
- **Gestionar categorías** (Manager+) -- abrir el diálogo de gestión de categorías.
- **Importar CSV** (Admin) -- importación masiva de procesos desde un archivo CSV.
- **Exportar CSV** (Admin) -- exportar todos los procesos a CSV.
- **Eliminar seleccionados** (Admin) -- eliminar una o más filas seleccionadas.

---

## El espacio de trabajo de Procesos de negocio

Haga clic en cualquier fila de la lista -- o en el botón **Nuevo** -- para abrir el espacio de trabajo.

El espacio de trabajo tiene una única pestaña **Visión general** a la izquierda, y una barra de herramientas en la parte superior:

- **Anterior / Siguiente** -- recorrer los procesos en el orden actual de la lista.
- **Restablecer** -- descartar cambios no guardados.
- **Guardar** -- persistir los cambios.
- **Cerrar** (icono X) -- volver a la lista, manteniendo sus filtros y ordenación intactos.

Si navega fuera con cambios sin guardar, se le solicitará que guarde o descarte.

### Visión general

La pestaña Visión general está organizada en tres secciones.

**Información básica**

- **Nombre** (obligatorio) -- utilice un nombre claro incluyendo el código corto, p. ej., "Pedido a cobro (O2C)" o "Contratación a jubilación (H2R)".
- **Descripción** -- un breve resumen de lo que cubre el proceso. Una buena descripción captura los puntos de inicio y fin (p. ej., "Desde el pedido del cliente hasta la entrega, facturación y cobro.").
- **Interruptor de estado** -- su etiqueta muestra el estado actual (**Activado** o **Desactivado**). Los procesos activados aparecen en los selectores de toda la aplicación. Desactive un proceso para retirarlo sin eliminarlo, para que las referencias históricas permanezcan intactas.

**Clasificación**

- **Categorías** (selección múltiple) -- asigne una o más categorías. Puede elegir entre categorías existentes, crear una nueva en línea con **Nueva categoría**, o hacer clic en **Editar categorías** para abrir el diálogo completo de gestión de categorías.
- **Responsable del proceso** -- el usuario responsable último del proceso. Se muestra en la cuadrícula de la lista y disponible para futuras notificaciones y aprobaciones.
- **Responsable IT** -- el usuario responsable de los sistemas y herramientas IT que soportan este proceso.

**Detalles**

- **Notas** -- campo de texto libre para información interna como enlaces a mapas de procesos, procedimientos operativos estándar, notas de alcance o planes de mejora.

---

## Gestión de categorías

Las categorías se comparten entre todos los procesos de negocio. Puede gestionarlas desde dos lugares:

1. En la página de la lista, haga clic en **Gestionar categorías**.
2. En el espacio de trabajo, bajo el campo **Categorías**, haga clic en **Editar categorías**.

Ambos abren el diálogo **Gestionar categorías de procesos de negocio**.

**Qué puede hacer**:

- **Renombrar** -- edite el nombre directamente en el campo de texto.
- **Activar / Desactivar** -- controle si una categoría aparece en los selectores. Las categorías inactivas se ocultan de las nuevas asignaciones pero se conservan en los procesos existentes.
- **Eliminar** -- eliminar una categoría. La eliminación solo funciona si ningún proceso la utiliza; de lo contrario, verá un error.
- **Nueva categoría** -- añadir una nueva fila en la parte superior del diálogo.

**Comportamiento de guardar y cancelar**:

- Nada se guarda hasta que haga clic en **Guardar**. Mientras el diálogo está abierto, todos los cambios se registran localmente.
- **Cancelar** cierra el diálogo y descarta todo lo que haya cambiado.
- Si ocurre un error al guardar (p. ej., un nombre duplicado o una categoría aún en uso), el diálogo permanece abierto para que pueda corregir el problema.

---

## Importación/exportación CSV

Utilice la importación y exportación CSV para la incorporación masiva o edición fuera de línea de su catálogo de procesos. Ambas requieren acceso **Admin**.

### Exportar

Haga clic en **Exportar CSV** en la página de la lista. Puede exportar:

- Una **plantilla** (solo fila de encabezados) para usar como punto de partida.
- **Datos** (todos los procesos del espacio de trabajo actual).

El archivo utiliza puntos y coma (`;`) como separadores y está codificado como UTF-8 con BOM para compatibilidad con Excel.

**Columnas**: `name`, `categories`, `description`, `notes`, `status`.

La columna `categories` puede contener múltiples nombres de categorías separados por puntos y coma dentro de la celda (p. ej., `Cliente y ventas; Finanzas y control`).

### Importar

Haga clic en **Importar CSV** en la página de la lista, luego:

1. Suba su archivo CSV (debe coincidir con los encabezados de la plantilla y usar `;` como separador).
2. Ejecute la **Verificación previa** -- esto valida encabezados y datos, y muestra cuántas filas se crearán vs. actualizarán.
3. Si la verificación previa es correcta, haga clic en **Cargar** para aplicar los cambios.

**Reglas de coincidencia**:

- Las filas se emparejan por **Nombre** (sin distinguir mayúsculas). Un nombre coincidente actualiza el proceso existente; un nuevo nombre crea un nuevo proceso.
- Cada categoría en la celda `categories` se recorta y empareja por nombre. Si una categoría no existe aún, se crea automáticamente como categoría activa.
- La columna `status` establece el estado habilitado/deshabilitado. Las fechas del ciclo de vida no se importan -- ajústelas en el espacio de trabajo si es necesario.

**Consejo**: exporte sus datos actuales primero, modifique el CSV y vuelva a importar. Esto evita duplicados accidentales y garantiza que esté trabajando desde el estado más reciente.

---

## Consejos

- **Convención de nomenclatura** -- siga el formato "Nombre descriptivo (CÓDIGO)" (p. ej., "Pedido a cobro (O2C)") para que los procesos sean fáciles de buscar y reconocibles de un vistazo.
- **Retire, no elimine** -- desactive los procesos que ya no utilice en lugar de eliminarlos. Esto preserva las referencias históricas y los registros de auditoría.
- **Categorías primero** -- configure su estructura de categorías antes de importar procesos de forma masiva. La importación creará automáticamente las categorías faltantes, pero planificar con antelación mantiene todo ordenado.
- **Responsable del proceso desde el principio** -- asignar un responsable del proceso ahora significa que los datos de propiedad ya están en su lugar cuando futuras funcionalidades como notificaciones y enrutamiento de tareas entren en funcionamiento.
