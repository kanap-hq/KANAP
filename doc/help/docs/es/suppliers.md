# Proveedores

Los Proveedores (también conocidos como vendedores) representan las empresas a las que compra software, servicios y soporte. Vincule proveedores a aplicaciones, contratos y partidas OPEX para hacer seguimiento de las relaciones con proveedores y el gasto en todo su portafolio IT.

## Primeros pasos

Navegue a **Datos maestros > Proveedores** para abrir el directorio de proveedores. Haga clic en **Nuevo** para crear su primera entrada.

**Campos obligatorios**:
- **Nombre**: El nombre del proveedor o vendedor

**Opcionales pero útiles**:
- **ID proveedor ERP**: ID de referencia de su sistema ERP o de compras
- **Notas**: Notas de texto libre sobre la relación con el proveedor

**Consejo**: Cree proveedores antes de añadir aplicaciones o contratos -- podrá vincularlos durante la creación.

---

## Trabajar con la lista

La lista de Proveedores ofrece un directorio buscable y ordenable de todos sus vendedores.

**Columnas predeterminadas**:
- **Nombre**: Nombre del proveedor (haga clic para abrir el espacio de trabajo)
- **ID proveedor ERP**: ID de referencia de sistemas externos

**Columnas adicionales** (mediante el selector de columnas):
- **Estado**: Habilitado o Deshabilitado
- **Notas**: Información adicional
- **Creado**: Cuándo se creó el registro

Cada celda de una fila es clicable y navega al espacio de trabajo de ese proveedor.

**Ordenación predeterminada**: Por nombre, alfabético.

**Filtrado**:
- Búsqueda rápida: Busca en los campos del proveedor
- Alcance de estado: Utilice el selector **Mostrar: Todos / Activos / Desactivados** encima de la cuadrícula para filtrar por estado. La lista muestra por defecto los proveedores activados

**Acciones**:
- **Nuevo**: Crear un nuevo proveedor (requiere `suppliers:manager`)
- **Importar CSV**: Importación masiva de proveedores (requiere `suppliers:admin`)
- **Exportar CSV**: Exportar la lista a CSV (requiere `suppliers:admin`)
- **Eliminar seleccionados**: Eliminar proveedores seleccionados (requiere `suppliers:admin`)

---

## El espacio de trabajo del Proveedor

Haga clic en cualquier fila para abrir el espacio de trabajo. Utilice **Anterior** y **Siguiente** para recorrer proveedores sin volver a la lista. Si tiene cambios sin guardar, KANAP le solicitará confirmación antes de navegar.

El espacio de trabajo tiene dos pestañas: **Visión general** y **Contactos**.

### Visión general

La pestaña Visión general captura la identidad y estado del proveedor.

**Qué puede editar**:
- **Nombre**: Nombre del proveedor o vendedor (obligatorio)
- **ID proveedor ERP**: ID de referencia de su sistema de compras o ERP
- **Ciclo de vida**: el interruptor de estado, cuya etiqueta muestra el estado actual (**Activado** o **Desactivado**), y la fecha de **Fin de validez**. Deje la fecha en blanco para que el proveedor permanezca activo indefinidamente, o fije una fecha futura para programar su fin. Si cambia el proveedor a **Desactivado** sin fecha, el fin de validez se fija en hoy
- **Notas**: Notas de texto libre sobre el proveedor

La edición requiere el permiso `suppliers:manager`. Los usuarios de solo lectura ven los mismos campos pero no pueden realizar cambios.

---

### Contactos

La pestaña Contactos organiza los contactos vinculados a este proveedor en cuatro categorías de rol:

| Rol | Propósito |
|-----|-----------|
| **Comercial** | Contactos de ventas y gestión de cuentas |
| **Técnico** | Contactos de ingeniería y soporte técnico |
| **Soporte** | Contactos de mesa de ayuda y atención al cliente |
| **Otro** | Cualquier contacto que no encaje en los roles anteriores |

**Cómo funciona**:
- Cada sección de rol lista sus contactos vinculados en una tabla que muestra nombre, apellido, puesto de trabajo, correo electrónico y móvil
- Haga clic en una fila de contacto para abrir el espacio de trabajo de ese contacto
- Utilice **Añadir** para buscar y adjuntar un contacto existente a un rol
- Utilice **Crear** para crear un nuevo contacto y vincularlo en un solo paso -- KANAP le devolverá a esta pestaña después

**Consejo**: Mantenga al menos un contacto por proveedor para que la comunicación con el proveedor esté siempre a un clic de distancia.

Cuando crea un nuevo proveedor, la pestaña Contactos está deshabilitada hasta que guarde el registro.

---

## Importación/exportación CSV

Gestione proveedores de forma masiva usando CSV.

**Exportar**: Descarga todos los proveedores con sus datos actuales.

**Importar**:
- Utilice **Verificación previa** para validar el archivo antes de aplicar cambios
- Las filas se emparejan por nombre de proveedor
- Puede crear nuevos proveedores o actualizar los existentes

**Campos obligatorios**: Nombre

**Campos opcionales**: ID proveedor ERP, Notas, Estado

**Formato**:
- Utilice codificación **UTF-8** y **puntos y coma** como separadores
- Importe proveedores antes de importar aplicaciones o contratos que los referencien

---

## Consejos

- **Sea consistente con los nombres**: Utilice nombres oficiales de proveedores (p. ej., "Microsoft Corporation" en lugar de "MS" o "MSFT") para evitar duplicados.
- **Añada IDs ERP temprano**: Si utiliza un sistema ERP, registrar el ID del proveedor facilita las referencias cruzadas.
- **Desactive, no elimine**: Cuando deje de trabajar con un proveedor, desactívelo en lugar de eliminarlo para preservar los datos históricos en contratos y aplicaciones.
- **Organice los contactos por rol**: Utilice las cuatro categorías de rol para facilitar que los colegas encuentren a la persona adecuada en cada proveedor.
- **Cree antes de vincular**: Añada proveedores a los datos maestros antes de crear aplicaciones o contratos que los referencien.
