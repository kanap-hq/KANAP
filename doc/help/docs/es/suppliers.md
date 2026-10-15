# Proveedores

Los Proveedores (también conocidos como vendedores) representan las empresas a las que compra software, servicios y soporte. Vincule proveedores a aplicaciones, contratos y líneas OPEX para hacer seguimiento de las relaciones con proveedores y el gasto en todo su portafolio IT.

## Primeros pasos

Navegue a **Datos maestros > Proveedores** para abrir el directorio de proveedores. Haga clic en **Nuevo** para crear su primera entrada.

**Campos obligatorios**:
- **Nombre**: El nombre del proveedor o vendedor

**Opcionales pero útiles**:
- **ID de proveedor ERP**: ID de referencia de su sistema ERP o de compras
- **Notas**: Notas de texto libre sobre la relación con el proveedor

**Consejo**: Cree proveedores antes de añadir aplicaciones o contratos -- podrá vincularlos durante la creación.

---

## Trabajar con la lista

La lista de Proveedores ofrece un directorio buscable y ordenable de todos sus vendedores.

**Columnas predeterminadas**:
- **Nombre**: Nombre del proveedor (haga clic para abrir la página del proveedor)
- **ID de proveedor ERP**: ID de referencia de sistemas externos

**Columnas adicionales** (mediante el selector de columnas):
- **Estado**: Habilitado o Deshabilitado
- **Notas**: Información adicional
- **Creado**: Cuándo se creó el registro

Cada celda de una fila es clicable y abre la página de ese proveedor.

**Ordenación predeterminada**: Por nombre, alfabético. La ordenación de una columna de texto ignora mayúsculas, minúsculas y acentos.

**Filtrado**:
- Búsqueda rápida: Busca en los campos del proveedor
- Alcance de estado: Utilice el selector **Mostrar: Todos / Activos / Desactivados** encima de la cuadrícula para filtrar por estado. La lista muestra por defecto los proveedores activados

**Acciones**:
- **Nuevo**: Crear un nuevo proveedor (requiere `suppliers:manager`)
- **Importar CSV**: Importación masiva de proveedores (requiere `suppliers:admin`)
- **Exportar CSV**: Exportar la lista a CSV (requiere `suppliers:admin`)
- **Eliminar seleccionados**: Eliminar proveedores seleccionados (requiere `suppliers:admin`)

---

## La página del proveedor

Haga clic en una fila para abrir la página del proveedor. Use las flechas de la parte superior, o las teclas de flecha izquierda y derecha, para pasar de un proveedor a otro sin volver a la lista. Cada cambio se guarda solo: no hay botón de guardar.

La página tiene dos pestañas: **Vista general** y **Contactos**.

**Título**: el nombre del proveedor. Haga clic en él para editarlo; el cambio se guarda al salir del campo o al pulsar Intro, y Escape lo cancela. El nombre es obligatorio y debe ser distinto del de todos los demás proveedores, sin distinguir mayúsculas y minúsculas (`SAP` y `sap` son el mismo nombre): KANAP muestra el mensaje bajo el nombre y conserva el nombre guardado.

**Referencia**: el ID de proveedor ERP, cuando el proveedor tiene uno, aparece antes del nombre. Haga clic en él para copiarlo.

**Encabezado**, bajo el nombre:
- **Estado**: **Activado** o **Desactivado**. Haga clic para cambiarlo. Elegir **Desactivado** desactiva el proveedor de inmediato: el fin de validez pasa a ser la hora actual.
- **Contactos**: cuántos contactos están vinculados al proveedor. Haga clic para abrir la pestaña **Contactos**.
- **Usado en**: cuántas líneas presupuestarias, contratos, aplicaciones y activos usan el proveedor. Haga clic para ir a la sección **Usado en** de la pestaña **Vista general**.

**Propiedades** (el panel de la derecha, que se abre con su pestaña o la tecla `P`):
- **ID de proveedor ERP**: el ID del proveedor en su sistema ERP o de compras. Se guarda al salir del campo o al pulsar Intro.
- **Ciclo de vida**: el interruptor de estado y la fecha de **Fin de validez**. Deje la fecha vacía para que el proveedor siga activo indefinidamente, o indique una fecha futura para programar su fin.

**Notas**: notas libres sobre el proveedor, en la pestaña **Vista general**. Se guardan un momento después de dejar de escribir, y al salir del campo.

Editar requiere el permiso `suppliers:manager`. Los usuarios de solo lectura ven la misma página pero no pueden hacer cambios.

Pulse **Escape** o haga clic en el botón de cierre para volver a la lista.

### Contactos

La pestaña **Contactos** lista los contactos vinculados a este proveedor por tipo de contacto:

| Tipo de contacto | Propósito |
|------|---------|
| **Comercial** | Contactos de ventas y gestión de cuentas |
| **Técnico** | Contactos de ingeniería y soporte técnico |
| **Soporte** | Contactos de helpdesk y atención al cliente |
| **Otro** | Cualquier contacto que no encaje en los tipos anteriores |

**Cómo funciona**:
- Cada sección lista sus contactos por nombre. Haga clic en un nombre para abrir la página del contacto.
- **Añadir existente**: busque un contacto por su nombre y elíjalo. El vínculo se guarda al instante.
- **Nuevo contacto**: abre el formulario de contacto con el proveedor y el tipo de contacto ya rellenados. KANAP le devuelve a esta pestaña una vez creado el contacto.
- El botón de papelera elimina el vínculo. El contacto sigue en sus contactos. Un mensaje lo confirma, con una acción **Deshacer** que vuelve a vincular el contacto.

**Consejo**: mantenga al menos un contacto por proveedor para que la comunicación con él esté siempre a un clic.

### Usado en

La sección **Usado en**, bajo las notas de la pestaña **Vista general**, lista lo que hace referencia a este proveedor, una lista por tipo, cada una con su número:

- **Líneas presupuestarias**: las líneas OPEX y CAPEX cuyo proveedor es, con su referencia (`BL-12`) y su tipo.
- **Contratos**: los contratos con este proveedor.
- **Aplicaciones**: las aplicaciones de las que es el fabricante.
- **Activos**: los activos a los que da soporte (el proveedor de soporte del activo).

Haga clic en una fila para abrir su página. Los elementos desactivados muestran **Desactivado** y aparecen después de los demás. Una lista muestra hasta 50 elementos e indica cuántos hay en total. Con más de 50, las líneas presupuestarias, los contratos y las aplicaciones tienen un enlace como **Ver los 57** que abre su lista filtrada por este proveedor. Solo ve las listas que tiene permiso para leer: un usuario sin acceso a los contratos no ve la lista de contratos. Un proveedor que nada usa muestra una línea que lo indica.

Consulte esta sección antes de desactivar o eliminar un proveedor. Un proveedor que aún usan líneas presupuestarias, contratos, aplicaciones o activos no se puede eliminar. El mensaje cuenta lo que lo usa, por ejemplo "Este proveedor se usa en 2 contratos y 1 aplicación". Desactívelo en su lugar. En la lista, la confirmación nombra los proveedores que se conservan así, con lo que los usa, antes de eliminar nada.

### Crear un proveedor

Haga clic en **Nuevo** en la lista. Rellene el nombre (obligatorio), el ID de proveedor ERP y las notas, y luego haga clic en **Crear**. El proveedor se crea activado y se abre su página, con la pestaña **Contactos** disponible.

---

## Importación/exportación CSV

**Exportar CSV** descarga los proveedores que muestra la lista, con su búsqueda, sus filtros y su orden. Elija **Todo el registro** en el diálogo para descargar todos los proveedores, activados y desactivados. El diálogo se cierra una vez descargado el archivo. **Importar CSV** vuelve a leer un archivo. El diálogo de importación incluye también **Descargar plantilla**: un archivo solo con los encabezados. Indica los valores aceptados.

Las columnas:

| Columna | Contenido |
|---|---|
| `name` | Obligatoria. El nombre del proveedor. Las filas se emparejan por este nombre |
| `erp_supplier_id` | El ID del proveedor en su ERP |
| `commercial_contact` | El correo de un contacto existente. La carga vincula el proveedor con él |
| `technical_contact` | El correo de un contacto, como arriba |
| `support_contact` | El correo de un contacto, como arriba |
| `notes` | Texto libre |
| `status` | `enabled` o `disabled` |
| `disabled_at` | El fin de validez: una fecha (`2026-12-31`) o una fecha y hora completas. Vacío cuando el proveedor no tiene |

**Importación**:

- Use la **Verificación previa** para validar el archivo antes de aplicarlo y después **Cargar**
- Las filas se emparejan por `name`, sin distinguir mayúsculas y minúsculas: una fila actualiza el proveedor que nombra, cualquier otra fila crea uno
- `name` es obligatorio. Cualquier otra celda es opcional
- Cada proveedor ocupa una fila. Dos filas con el mismo nombre, aunque cambien mayúsculas y minúsculas, se rechazan en la verificación previa, con los dos números de fila
- El correo de un contacto debe pertenecer a un contacto que ya existe en **Contactos**. Si no, la fila se rechaza en la verificación previa: cree primero el contacto
- `disabled_at` fija el fin de validez, y el estado se deduce de él. Un estado que contradice la fecha se rechaza. Un archivo sin la columna `disabled_at` se sigue importando: el estado solo fija entonces el ciclo de vida

**Notas**:
- Consulte [Archivos CSV](csv-files.md) para la codificación, el separador y los dos pasos de importación
- Importe los proveedores antes que las aplicaciones o los contratos que los referencian. El archivo de presupuesto también crea un proveedor que falta cuando **Crear los proveedores que faltan** está marcada. Consulte [Cargar un presupuesto desde una hoja de cálculo](budget-file.md)

---

## Consejos

- **Sea consistente con los nombres**: Utilice nombres oficiales de proveedores (p. ej., "Microsoft Corporation" en lugar de "MS" o "MSFT") para evitar duplicados.
- **Añada IDs ERP temprano**: Si utiliza un sistema ERP, registrar el ID del proveedor facilita las referencias cruzadas.
- **Desactive, no elimine**: Cuando deje de trabajar con un proveedor, desactívelo en lugar de eliminarlo para preservar los datos históricos en contratos y aplicaciones.
- **Organice los contactos por rol**: Utilice las cuatro categorías de rol para facilitar que los colegas encuentren a la persona adecuada en cada proveedor.
- **Cree antes de vincular**: Añada proveedores a los datos maestros antes de crear aplicaciones o contratos que los referencien.
